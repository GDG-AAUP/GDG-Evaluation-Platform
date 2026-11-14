import { Router } from 'express';
import type { Pool } from 'pg';

import { type ProjectRequest, sendError } from '../shared/http';
import { evaluationScope } from '../governance/governance';
import {
  canRate,
  canViewRatings,
  closedMonthIds,
  identity,
  isMonthLocked,
  listPeople,
  lockPerson,
  parseEntityId,
  rateRefusal
} from '../shared/people';
import { currentYearMonth, monthId, parseMonthId, type YearMonth } from '../shared/time';

// Fixed by design: five core items out of 10 and ten further items out of 5, totalling 100.
const CATEGORIES = Array.from({ length: 15 }, (_, i) => ({ id: `cat${i + 1}`, max: i < 5 ? 10 : 5 }));

export function validateScores(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const source = input as Record<string, unknown>;
  if (Object.keys(source).length !== CATEGORIES.length) return null;

  const scores: Record<string, number> = {};
  for (const { id, max } of CATEGORIES) {
    const raw = source[id];
    const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
    if (!/^\d+$/.test(text) || Number(text) > max) return null;
    scores[id] = Number(text);
  }
  const sum = (ids: typeof CATEGORIES) => ids.reduce((total, c) => total + scores[c.id], 0);
  return { scores, total: sum(CATEGORIES), core: sum(CATEGORIES.slice(0, 5)) };
}

function mapScorecard(row: Record<string, any>, month: string) {
  return {
    id: row.id,
    targetId: String(row.targetId),
    month,
    scores: row.scores,
    total: row.total,
    core: row.core,
    rev: row.rev,
    actor: String(row.actor),
    actorName: row.actorName,
    ts: row.createdAt.getTime(),
    reason: row.reason
  };
}

const SCORECARD_COLUMNS = `
  s.scorecard_id::text AS id, s.target_user_id AS "targetId", s.scores, s.total_score AS total,
  s.core_score AS core, s.revision AS rev, s.performed_by_user_id AS actor,
  s.reason, s.created_at AS "createdAt"`;

export function createRatingsRouter(pool: Pool) {
  const router = Router();

  router.get('/targets', async (req, res) => {
    const { projectUser: actor } = req as ProjectRequest;
    if (actor.role === 'member') return sendError(res, 403, 'FORBIDDEN', 'Members cannot rate others');

    const period = currentYearMonth();
    const [people, cards, scope] = await Promise.all([
      listPeople(pool),
      pool.query(
        `SELECT DISTINCT ON (target_user_id) target_user_id AS id, total_score AS total
         FROM performance_scorecards WHERE year = $1 AND month = $2
         ORDER BY target_user_id, revision DESC`,
        [period.year, period.month]
      ),
      evaluationScope(pool, actor)
    ]);
    const totals = new Map(cards.rows.map((card) => [card.id, card.total]));

    return res.status(200).json({
      data: people
        .filter((person) => canRate(actor, person, scope))
        .map((person) => ({ ...identity(person), total: totals.get(person.id) ?? null }))
    });
  });

  router.get('/:userId', async (req, res) => {
    const { projectUser: actor } = req as unknown as ProjectRequest;
    const userId = parseEntityId(req.params.userId);
    if (userId === null) return sendError(res, 400, 'INVALID_USER_ID', 'Invalid user ID');
    const period = req.query.month === undefined ? currentYearMonth() : parseMonthId(req.query.month);
    if (!period) return sendError(res, 400, 'INVALID_MONTH', 'Month must be YYYY-MM');

    const person = (await listPeople(pool)).find((p) => p.id === userId);
    if (!person) return sendError(res, 404, 'USER_NOT_FOUND', 'User not found');
    if (actor.id !== userId && !canViewRatings(actor, person)) return sendError(res, 403, 'FORBIDDEN', 'Access denied');

    const [history, closed] = await Promise.all([
      pool.query(
        `SELECT ${SCORECARD_COLUMNS}, COALESCE(u.full_name, '—') AS "actorName"
         FROM performance_scorecards s
         LEFT JOIN users u ON u.user_id = s.performed_by_user_id
         WHERE s.target_user_id = $1 AND s.year = $2 AND s.month = $3
         ORDER BY s.revision`,
        [userId, period.year, period.month]
      ),
      closedMonthIds(pool)
    ]);
    const month = monthId(period);
    const cards = history.rows.map((row) => mapScorecard(row, month));

    return res.status(200).json({
      data: {
        user: identity(person),
        month,
        current: cards.at(-1) ?? null,
        history: cards,
        categories: CATEGORIES,
        locked: isMonthLocked(period, closed)
      }
    });
  });

  router.post('/', async (req, res) => {
    const { projectUser: actor } = req as ProjectRequest;
    const { userId: rawUserId, scores, reason, month, expectedRev } = req.body ?? {};
    const userId = parseEntityId(rawUserId);
    const validated = validateScores(scores);
    const why = typeof reason === 'string' ? reason.trim() : '';
    const period: YearMonth | null = month === undefined ? currentYearMonth() : parseMonthId(month);

    if (userId === null) return sendError(res, 400, 'INVALID_USER_ID', 'Invalid user ID');
    if (!validated) return sendError(res, 400, 'INVALID_SCORECARD', 'All 15 items are required within their limits');
    if (!why || why.length > 2000) return sendError(res, 400, 'INVALID_SCORECARD_REASON', 'A reason of up to 2000 characters is required');
    if (!period) return sendError(res, 400, 'INVALID_MONTH', 'Month must be YYYY-MM');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const person = await lockPerson(client, userId);
      const refusal = person
        ? rateRefusal(actor, person, await evaluationScope(client, actor, true))
        : { code: 'FORBIDDEN', message: 'You cannot rate yourself or anyone outside your scope' };
      if (refusal) {
        await client.query('ROLLBACK');
        return sendError(res, 403, refusal.code, refusal.message);
      }
      if (isMonthLocked(period, await closedMonthIds(client))) {
        await client.query('ROLLBACK');
        return sendError(res, 409, 'MONTH_LOCKED', 'This month is locked');
      }

      const latest = await client.query(
        `SELECT COALESCE(MAX(revision), 0)::int AS rev FROM performance_scorecards
         WHERE target_user_id = $1 AND year = $2 AND month = $3`,
        [userId, period.year, period.month]
      );
      const currentRev = latest.rows[0].rev;
      if (expectedRev !== undefined && expectedRev !== currentRev) {
        await client.query('ROLLBACK');
        return sendError(res, 409, 'SCORECARD_CHANGED', 'Someone else updated this scorecard');
      }

      const inserted = await client.query(
        `INSERT INTO performance_scorecards AS s
           (target_user_id, year, month, revision, scores, total_score, core_score, performed_by_user_id, reason)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
         RETURNING ${SCORECARD_COLUMNS}`,
        [userId, period.year, period.month, currentRev + 1, JSON.stringify(validated.scores),
          validated.total, validated.core, actor.id, why]
      );
      const row = inserted.rows[0];
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, new_values, reason)
         VALUES ($1, 'SAVE_SCORECARD', 'performance_scorecards', $2, $3::jsonb, $4)`,
        [actor.id, row.id, JSON.stringify({ targetUserId: userId, month: monthId(period), revision: row.rev, total: row.total,
          ...(actor.isSuperAdmin ? { actorIsSuperAdmin: true } : {}) }), why]
      );
      await client.query('COMMIT');
      return res.status(201).json({ data: mapScorecard({ ...row, actorName: actor.name }, monthId(period)) });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  return router;
}
