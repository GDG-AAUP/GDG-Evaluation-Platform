import { Router } from 'express';
import type { Pool } from 'pg';

import { type ProjectRequest, sendError } from '../shared/http';
import {
  canRate,
  closedMonthIds,
  identity,
  isMonthLocked,
  listPeople,
  lockPerson,
  parseEntityId
} from '../shared/people';
import { currentYearMonth, instantInPeriodSql, monthId, parseMonthId, periodBounds } from '../shared/time';

/** Activity evaluations are entries in the points ledger, so they count toward rankings. */
export function createActivitiesRouter(pool: Pool) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { projectUser: actor } = req as ProjectRequest;
    const period = req.query.month === undefined ? currentYearMonth() : parseMonthId(req.query.month);
    if (!period) return sendError(res, 400, 'INVALID_MONTH', 'Month must be YYYY-MM');

    const bounds = periodBounds(period.year, period.month);
    const [people, entries, closed] = await Promise.all([
      listPeople(pool),
      pool.query(
        `SELECT p.entry_id::text AS id, p.user_id AS "userId", p.points, p.activity_name AS label,
                COALESCE(p.activity_description, p.reason) AS description,
                p.performed_by_user_id AS actor, a.full_name AS "actorName", p.effective_at AS "effectiveAt"
         FROM point_entries p
         JOIN users a ON a.user_id = p.performed_by_user_id
         WHERE ${instantInPeriodSql('p.effective_at', 1, 2)}
         ORDER BY p.effective_at DESC, p.entry_id DESC`,
        [bounds.start, bounds.end]
      ),
      closedMonthIds(pool)
    ]);

    const month = monthId(period);
    const byUser = new Map<number, typeof entries.rows>();
    entries.rows.forEach((entry) => byUser.set(entry.userId, [...(byUser.get(entry.userId) ?? []), entry]));
    const sum = (rows: typeof entries.rows) => rows.reduce((total, entry) => total + entry.points, 0);
    const everyoneTotal = sum(entries.rows);

    return res.status(200).json({
      data: {
        month,
        locked: isMonthLocked(period, closed),
        everyoneTotal,
        rows: people
          .filter((person) => actor.role === 'organizer' || person.id === actor.id || canRate(actor, person))
          .map((person) => {
            const own = byUser.get(person.id) ?? [];
            const total = sum(own);
            return {
              ...identity(person),
              total,
              percentage: everyoneTotal ? (total / everyoneTotal) * 100 : 0,
              canRate: canRate(actor, person),
              entries: own.map((entry) => ({
                id: entry.id,
                targetId: String(entry.userId),
                month,
                label: entry.label,
                points: entry.points,
                description: entry.description,
                actor: String(entry.actor),
                actorName: entry.actorName,
                ts: entry.effectiveAt.getTime()
              }))
            };
          })
      }
    });
  });

  router.post('/', async (req, res) => {
    const { projectUser: actor } = req as ProjectRequest;
    if (actor.role === 'member') return sendError(res, 403, 'FORBIDDEN', 'Members cannot rate others');

    const { userId: rawUserId, label, points, description, month } = req.body ?? {};
    const userId = parseEntityId(rawUserId);
    const title = typeof label === 'string' ? label.trim() : '';
    const explanation = typeof description === 'string' ? description.trim() : '';
    const period = month === undefined ? currentYearMonth() : parseMonthId(month);

    if (userId === null) return sendError(res, 400, 'INVALID_USER_ID', 'Invalid user ID');
    if (!title || title.length > 160 || !explanation || explanation.length > 2000 ||
        !Number.isInteger(points) || points < 0 || points > 99 || !period) {
      return sendError(res, 400, 'INVALID_ACTIVITY', 'Name, description and 0 to 99 points are required');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const person = await lockPerson(client, userId);
      if (!person || !canRate(actor, person)) {
        await client.query('ROLLBACK');
        return sendError(res, 403, 'FORBIDDEN', 'You cannot rate yourself or anyone outside your scope');
      }
      if (isMonthLocked(period, await closedMonthIds(client))) {
        await client.query('ROLLBACK');
        return sendError(res, 409, 'MONTH_LOCKED', 'This month is locked');
      }

      const inserted = await client.query(
        `INSERT INTO point_entries (user_id, performed_by_user_id, points, activity_name, reason, activity_description)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING entry_id::text AS id, effective_at AS "effectiveAt"`,
        [userId, actor.id, points, title, explanation]
      );
      const entry = inserted.rows[0];
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, new_values, reason)
         VALUES ($1, 'create_point_entry', 'point_entries', $2, $3::jsonb, $4)`,
        [actor.id, entry.id, JSON.stringify({ userId, points, activityName: title }), explanation]
      );
      await client.query('COMMIT');

      return res.status(201).json({
        data: {
          id: entry.id,
          targetId: String(userId),
          month: monthId(period),
          label: title,
          points,
          description: explanation,
          actor: String(actor.id),
          ts: entry.effectiveAt.getTime()
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  return router;
}
