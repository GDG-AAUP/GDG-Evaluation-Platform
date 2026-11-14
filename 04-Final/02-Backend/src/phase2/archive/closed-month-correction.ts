import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import { isMonthClosed, lockMonth, reviseClosedMonth } from '../rankings/revise-closed-month';
import type { ProjectUser } from '../shared/http';
import { monthId, parseMonthId, type YearMonth } from '../shared/time';

export const CORRECTION_ACTIVITY = 'تصحيح شهر مغلق';

export type CorrectionInput = { period: YearMonth; userId: number; points: number; reason: string };

type Validation = { value: CorrectionInput } | { error: string; code: string };

/** Same point rules as POST /api/points: a nonzero integer from -100 to 100, and a required reason. */
export function validateCorrection(body: unknown, current: YearMonth): Validation {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { code: 'INVALID_CORRECTION', error: 'Request body must be an object' };
  }
  const data = body as Record<string, unknown>;
  if (Object.keys(data).some((key) => !['month', 'userId', 'value', 'reason'].includes(key))) {
    return { code: 'INVALID_CORRECTION', error: 'Only month, userId, value and reason are allowed' };
  }
  const period = parseMonthId(data.month);
  if (!period) return { code: 'INVALID_CORRECTION', error: 'Month must be YYYY-MM' };
  if (monthId(period) >= monthId(current)) {
    return { code: 'MONTH_NOT_CLOSED', error: 'Corrections apply to a past month; use regular points for the current month' };
  }
  const userId = typeof data.userId === 'string' && /^[1-9]\d{0,9}$/.test(data.userId) ? Number(data.userId) : data.userId;
  if (!Number.isInteger(userId) || (userId as number) <= 0 || (userId as number) > 2147483647) {
    return { code: 'INVALID_CORRECTION', error: 'Invalid user ID' };
  }
  const points = data.value;
  if (typeof points !== 'number' || !Number.isInteger(points) || points === 0 || points < -100 || points > 100) {
    return { code: 'INVALID_POINT_DATA', error: 'Points must be a nonzero integer from -100 to 100' };
  }
  const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
  if (!reason || reason.length > 1000) {
    return { code: 'CORRECTION_REASON_REQUIRED', error: 'A reason of 1 to 1000 characters is required' };
  }
  return { value: { period, userId: userId as number, points, reason } };
}

/**
 * Adds an immutable compensating point entry dated inside the person's team assignment of that
 * month. Managers: only people of the team they manage now (who were in it that month), never
 * themselves. Organizers: anyone. A closed month's rankings are then recomputed in the same
 * transaction, with a before/after audit row for every ranking row that moved.
 */
export async function applyClosedMonthCorrection(pool: Pool, actor: ProjectUser, input: CorrectionInput) {
  const client = await pool.connect();
  const reject = async (outcome: string) => {
    await client.query('ROLLBACK');
    return { outcome } as { outcome: string; data?: never };
  };
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    await client.query('LOCK TABLE teams IN SHARE ROW EXCLUSIVE MODE');
    const { year, month } = input.period;
    await lockMonth(client, year, month);

    const dbActor = (await client.query(
      `SELECT LOWER(role) AS role FROM users
       WHERE user_id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
      [actor.id]
    )).rows[0];
    if (!dbActor || dbActor.role !== actor.role || (actor.role !== 'organizer' && actor.role !== 'manager')) {
      return await reject('forbidden');
    }

    const person = (await client.query(
      'SELECT user_id, role, deleted_at FROM users WHERE user_id = $1',
      [input.userId]
    )).rows[0];
    if (!person) return await reject('recipient_not_found');
    if (person.user_id === actor.id) return await reject('forbidden');
    if (person.deleted_at || (person.role !== 'Member' && person.role !== 'Manager')) {
      return await reject('recipient_ineligible');
    }

    // The latest instant of the month at which the person belonged to the (managed) team.
    const assignment = (await client.query(
      `WITH bounds AS (
         SELECT make_date($2::int, $3::int, 1)::timestamp AT TIME ZONE 'Asia/Hebron' AS month_start,
                (make_date($2::int, $3::int, 1) + INTERVAL '1 month')::timestamp AT TIME ZONE 'Asia/Hebron' AS month_end
       )
       SELECT h.team_id AS "teamId", t.campus_id AS "campusId",
              GREATEST(h.effective_from, b.month_start,
                       LEAST(COALESCE(h.effective_to, b.month_end), b.month_end) - INTERVAL '1 microsecond') AS at
       FROM assignment_history h
       JOIN teams t ON t.team_id = h.team_id
       CROSS JOIN bounds b
       WHERE h.user_id = $1 AND h.role_at_time IN ('Member', 'Manager')
         AND h.effective_from < b.month_end AND (h.effective_to IS NULL OR h.effective_to > b.month_start)
         AND ($4::int IS NULL OR t.manager_user_id = $4)
       ORDER BY h.effective_from DESC
       LIMIT 1`,
      [input.userId, year, month, actor.role === 'manager' ? actor.id : null]
    )).rows[0];
    if (!assignment) return await reject(actor.role === 'manager' ? 'forbidden' : 'no_assignment');

    const inserted = await client.query(
      `INSERT INTO point_entries (user_id, performed_by_user_id, points, activity_name, reason, effective_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING entry_id::text AS id, user_id AS "userId", performed_by_user_id AS "performedByUserId",
                 points, activity_name AS "activityName", reason, effective_at AS "effectiveAt"`,
      [input.userId, actor.id, input.points, CORRECTION_ACTIVITY, input.reason, assignment.at]
    );
    const entry = inserted.rows[0];
    const batchId = randomUUID();
    const period = monthId(input.period);
    await client.query(
      `INSERT INTO audit_logs
         (actor_user_id, action, entity_name, entity_id, old_values, new_values, reason, batch_id)
       VALUES ($1, 'CLOSED_MONTH_CORRECTION', 'point_entries', $2, NULL, $3::jsonb, $4, $5)`,
      [actor.id, entry.id,
        JSON.stringify({ ...entry, month: period, teamId: assignment.teamId, campusId: assignment.campusId }),
        input.reason, batchId]
    );

    const closed = await isMonthClosed(client, year, month);
    const revisions = closed
      ? await reviseClosedMonth(client, { year, month, teamId: assignment.teamId, campusId: assignment.campusId },
        actor.id, input.reason, batchId)
      : [];

    await client.query('COMMIT');
    return { outcome: 'corrected', data: { entry, month: period, closed, rankingRevisions: revisions } };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
