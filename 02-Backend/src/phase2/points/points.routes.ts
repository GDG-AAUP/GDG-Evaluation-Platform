
import { Router, type Request } from 'express';
import type { Pool } from 'pg';

import { validateCreatePoint } from './validate-point';
import { createPoint } from './create-point';
import { reversePoint } from './reverse-point';
import {
  parsePointEntryId,
  validateReversePoint
} from './validate-reversal';
import { getMyPointsSummary } from './get-my-points-summary';
import { getTeamPointsHistory } from './get-team-points-history';
import { queryInt } from '../shared/http';
import { currentYearMonth, instantInPeriodSql, periodBounds } from '../shared/time';

const DEFAULT_ENTRY_PAGE = 50;
const MAX_ENTRY_PAGE = 500;

function parsePointsPeriod(query: Record<string, unknown>) {
  const year = queryInt(query.year, 2000, 9999);
  const month = queryInt(query.month, 1, 12);
  if (year === null || month === null || (year === undefined && month !== undefined)) return null;
  return { year: year ?? null, month: month ?? null };
}

type ProjectRequest = Request & {
  projectUser?: {
    id: number;
    role: 'organizer' | 'manager' | 'member';
    teamId: number | null;
  };
};

export function createPointsRouter(pool: Pool) {
  const router = Router();

  // GET /api/points/team-history?year&month&limit: Give Points log (Manager: own team; Organizer: own entries).
  router.get('/team-history', async (req, res, next) => {
    const user = (req as ProjectRequest).projectUser;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required' } });
    }
    if (user.role !== 'manager' && user.role !== 'organizer') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only managers and organizers award points' } });
    }
    const period = parsePointsPeriod(req.query);
    const limit = queryInt(req.query.limit, 1, MAX_ENTRY_PAGE);
    if (period === null || limit === null || (period.year === null) !== (period.month === null)) {
      return res.status(400).json({ error: { code: 'INVALID_POINTS_QUERY', message: 'Provide both year and month, or neither' } });
    }
    const selected = period.year === null ? currentYearMonth() : { year: period.year, month: period.month as number };
    try {
      const result = await getTeamPointsHistory(pool, user, selected.year, selected.month, limit ?? 200);
      if (result.outcome === 'no_team') {
        return res.status(409).json({ error: { code: 'NO_MANAGED_TEAM', message: 'This manager does not manage a team' } });
      }
      return res.status(200).json({ data: result.data });
    } catch (error) {
      return next(error);
    }
  });

  // GET /api/points/me
  router.get('/me', async (req, res, next) => {
    const user = (req as ProjectRequest).projectUser;

    if (!user) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication is required'
        }
      });
    }

    const period = parsePointsPeriod(req.query);
    const limit = queryInt(req.query.limit, 1, MAX_ENTRY_PAGE);

    if (period === null || limit === null) {
      return res.status(400).json({
        error: {
          code: 'INVALID_POINTS_QUERY',
          message: 'Invalid year, month or limit'
        }
      });
    }

    const bounds = periodBounds(period.year, period.month);

    try {
      const result = await pool.query(
        `SELECT
           entry_id::text AS id,
           points,
           activity_name AS "activityName",
           activity_description AS "activityDescription",
           reason,
           reverses_entry_id::text AS "reversesEntryId",
           effective_at AS "effectiveAt"
         FROM point_entries
         WHERE user_id = $1
           AND ${instantInPeriodSql('effective_at', 2, 3)}
         ORDER BY effective_at DESC, entry_id DESC
         LIMIT $4`,
        [user.id, bounds.start, bounds.end, limit ?? DEFAULT_ENTRY_PAGE]
      );

      return res.status(200).json({
        data: result.rows
      });
    } catch (error) {
      return next(error);
    }
  });

  // GET /api/points/me/summary: totals come from SQL SUM over the whole ledger, never a page of rows.
  router.get('/me/summary', async (req, res, next) => {
    const user = (req as ProjectRequest).projectUser;

    if (!user) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication is required'
        }
      });
    }

    const period = parsePointsPeriod(req.query);

    if (period === null || (period.year === null && period.month !== null)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_POINTS_QUERY',
          message: 'Invalid year or month'
        }
      });
    }

    try {
      const selected = period.year === null ? currentYearMonth() : period;

      return res.status(200).json({
        data: await getMyPointsSummary(pool, user, selected.year as number, selected.month)
      });
    } catch (error) {
      return next(error);
    }
  });

  // POST /api/points
  router.post('/', async (req, res, next) => {
    const actor = (req as ProjectRequest).projectUser;

    if (!actor) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication is required'
        }
      });
    }

    if (actor.role !== 'organizer' && actor.role !== 'manager') {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to perform this action'
        }
      });
    }

    const validation = validateCreatePoint(req.body);

    if (validation.error !== undefined) {
      return res.status(400).json({
        error: {
          code: 'INVALID_POINT_DATA',
          message: validation.error
        }
      });
    }

    // Optional Idempotency-Key: a retried request with the same key returns the first entry.
    const rawKey = req.get('Idempotency-Key');
    if (rawKey !== undefined && !/^[A-Za-z0-9._:-]{1,100}$/.test(rawKey)) {
      return res.status(400).json({
        error: { code: 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key must be 1-100 letters, digits or . _ : -' }
      });
    }

    try {
      const result = await createPoint(
        pool,
        {
          id: actor.id,
          role: actor.role,
          teamId: actor.teamId
        },
        validation.value,
        rawKey ?? null
      );

      if (result.outcome === 'created') {
        return res.status(201).json({
          data: result.entry
        });
      }

      if (result.outcome === 'replayed') {
        res.set('Idempotent-Replayed', 'true');
        return res.status(200).json({ data: result.entry });
      }

      if (result.outcome === 'idempotency_key_reused') {
        return res.status(409).json({
          error: { code: 'IDEMPOTENCY_KEY_REUSED', message: 'This Idempotency-Key was already used for a different request' }
        });
      }

      if (result.outcome === 'duplicate') {
        return res.status(409).json({
          error: { code: 'DUPLICATE_POINT_SUBMISSION', message: 'An identical point entry was just recorded', entryId: result.entryId }
        });
      }

      if (result.outcome === 'forbidden') {
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Actor or recipient is not authorized'
          }
        });
      }

      if (result.outcome === 'recipient_not_found') {
        return res.status(404).json({
          error: {
            code: 'RECIPIENT_NOT_FOUND',
            message: 'Recipient does not exist'
          }
        });
      }

      throw new Error('Unexpected point creation outcome');
    } catch (error) {
      return next(error);
    }
  });

  // POST /api/points/:entryId/reverse
  router.post('/:entryId/reverse', async (req, res, next) => {
    const actor = (req as ProjectRequest).projectUser;

    // 1. Authentication
    if (!actor) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication is required'
        }
      });
    }

    // 2. Role authorization
    if (actor.role !== 'organizer' && actor.role !== 'manager') {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to perform this action'
        }
      });
    }

    // 3. Validate entry ID
    const entryId = parsePointEntryId(req.params.entryId);

    if (entryId === null) {
      return res.status(400).json({
        error: {
          code: 'INVALID_ENTRY_ID',
          message: 'Invalid point entry ID'
        }
      });
    }

    // 4. Validate request body
    const validation = validateReversePoint(req.body);

    if ('error' in validation) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REVERSAL_DATA',
          message: validation.error
        }
      });
    }

    // 5. Reverse the point entry
    try {
      const result = await reversePoint(
        pool,
        {
          id: actor.id,
          role: actor.role,
          teamId: actor.teamId
        },
        entryId,
        validation.value.reason
      );

      // Successful reversal
      if (result.outcome === 'reversed') {
        return res.status(201).json({
          data: result.entry,
          rankingRevisions: result.rankingRevisions
        });
      }

      // Authorization failure
      if (result.outcome === 'forbidden') {
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'You are not authorized to reverse this point entry'
          }
        });
      }

      // Original entry doesn't exist
      if (result.outcome === 'entry_not_found') {
        return res.status(404).json({
          error: {
            code: 'ENTRY_NOT_FOUND',
            message: 'Point entry does not exist'
          }
        });
      }

      // Cannot reverse another reversal
      if (result.outcome === 'cannot_reverse_reversal') {
        return res.status(409).json({
          error: {
            code: 'CANNOT_REVERSE_REVERSAL',
            message: 'A reversal entry cannot be reversed'
          }
        });
      }

      // Original entry was already reversed
      if (result.outcome === 'already_reversed') {
        return res.status(409).json({
          error: {
            code: 'ALREADY_REVERSED',
            message: 'This point entry has already been reversed'
          }
        });
      }

      throw new Error('Unexpected point reversal outcome');
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
