import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import { isMonthClosed, lockMonth, reviseClosedMonth } from '../rankings/revise-closed-month';

type Actor = {
  id: number;
  role: 'manager' | 'organizer';
  teamId: number | null;
};

const ENTRY_COLUMNS = `
  entry_id::text AS id,
  user_id AS "userId",
  performed_by_user_id AS "performedByUserId",
  points,
  activity_name AS "activityName",
  reason,
  activity_description AS "activityDescription",
  reverses_entry_id::text AS "reversesEntryId",
  effective_at AS "effectiveAt"`;

/**
 * Reverses an original entry once, with an entry of -points for the same person dated at the
 * original instant, so the original's month changes (and is re-ranked when it is closed).
 * Organizer: any entry. Manager: entries of the team they manage now, as of the entry's date.
 */
export async function reversePoint(
  pool: Pool,
  actor: Actor,
  entryId: string,
  reason: string
) {
  const client = await pool.connect();
  const reject = async <T extends string>(outcome: T) => {
    await client.query('ROLLBACK');
    return { outcome };
  };

  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    await client.query('LOCK TABLE teams IN SHARE ROW EXCLUSIVE MODE');

    const dbActor = (await client.query(
      `SELECT LOWER(role) AS role, is_active AS "isActive", deleted_at AS "deletedAt"
       FROM users WHERE user_id = $1`,
      [actor.id]
    )).rows[0];
    if (!dbActor || dbActor.isActive !== true || dbActor.deletedAt != null ||
        (dbActor.role !== 'manager' && dbActor.role !== 'organizer') || dbActor.role !== actor.role) {
      return await reject('forbidden' as const);
    }

    const original = (await client.query(
      `SELECT ${ENTRY_COLUMNS},
              EXTRACT(YEAR FROM effective_at AT TIME ZONE 'Asia/Hebron')::int AS year,
              EXTRACT(MONTH FROM effective_at AT TIME ZONE 'Asia/Hebron')::int AS month
       FROM point_entries WHERE entry_id = $1 FOR UPDATE`,
      [entryId]
    )).rows[0];
    if (!original) return await reject('entry_not_found' as const);
    if (original.reversesEntryId !== null) return await reject('cannot_reverse_reversal' as const);

    // The team (and campus) the recipient belonged to when the original entry took effect.
    const assignment = (await client.query(
      `SELECT h.team_id AS "teamId", t.campus_id AS "campusId", t.manager_user_id AS "managerId"
       FROM assignment_history h
       JOIN teams t ON t.team_id = h.team_id
       WHERE h.user_id = $1 AND h.role_at_time IN ('Member', 'Manager')
         AND h.effective_from <= $2 AND (h.effective_to IS NULL OR h.effective_to > $2)
       ORDER BY h.effective_from DESC
       LIMIT 1`,
      [original.userId, original.effectiveAt]
    )).rows[0];

    if (actor.role === 'manager' &&
        (original.userId === actor.id || !assignment || assignment.managerId !== actor.id)) {
      return await reject('forbidden' as const);
    }

    const existing = await client.query(
      'SELECT 1 FROM point_entries WHERE reverses_entry_id = $1 LIMIT 1',
      [entryId]
    );
    if (existing.rows.length > 0) return await reject('already_reversed' as const);

    await lockMonth(client, original.year, original.month);

    const inserted = await client.query(
      `INSERT INTO point_entries
         (user_id, performed_by_user_id, points, activity_name, reason, activity_description,
          reverses_entry_id, effective_at)
       -- Copied in SQL so the instant (and so the month) matches the original to the microsecond.
       SELECT $1::int, $2::int, $3::int, $4::varchar, $5::text, $6::text, $7::bigint, effective_at
       FROM point_entries WHERE entry_id = $7::bigint
       RETURNING ${ENTRY_COLUMNS}`,
      [original.userId, actor.id, -original.points, original.activityName, reason,
        original.activityDescription, entryId]
    );
    const reversal = inserted.rows[0];
    const { year, month, ...originalEntry } = original;
    const batchId = randomUUID();

    await client.query(
      `INSERT INTO audit_logs
         (actor_user_id, action, entity_name, entity_id, old_values, new_values, reason, batch_id)
       VALUES ($1, 'reverse_point_entry', 'point_entries', $2, $3::jsonb, $4::jsonb, $5, $6)`,
      [actor.id, reversal.id, JSON.stringify(originalEntry), JSON.stringify(reversal), reason, batchId]
    );

    let rankingRevisions = 0;
    if (assignment && await isMonthClosed(client, year, month)) {
      const revised = await reviseClosedMonth(
        client,
        { year, month, teamId: assignment.teamId, campusId: assignment.campusId },
        actor.id,
        reason,
        batchId
      );
      rankingRevisions = revised.length;
    }

    await client.query('COMMIT');
    return { outcome: 'reversed' as const, entry: reversal, rankingRevisions };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
