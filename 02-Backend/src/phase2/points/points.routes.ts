
import { Router, type Request } from 'express';
import type { Pool } from 'pg';

import { validateCreatePoint } from './validate-point';
import { createPoint } from './create-point';
import { reversePoint } from './reverse-point';
import {
  parsePointEntryId,
  validateReversePoint
} from './validate-reversal';

type ProjectRequest = Request & {
  projectUser?: {
    id: number;
    role: 'organizer' | 'manager' | 'member';
    teamId: number | null;
  };
};

export function createPointsRouter(pool: Pool) {
  const router = Router();

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

    try {
      const result = await pool.query(
        `SELECT
           entry_id::text AS id,
           points,
           activity_name AS "activityName",
           reason,
           effective_at AS "effectiveAt"
         FROM point_entries
         WHERE user_id = $1
         ORDER BY effective_at DESC, entry_id DESC
         LIMIT 50`,
        [user.id]
      );

      return res.status(200).json({
        data: result.rows
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

    try {
      const result = await createPoint(
        pool,
        {
          id: actor.id,
          role: actor.role,
          teamId: actor.teamId
        },
        validation.value
      );

      if (result.outcome === 'created') {
        return res.status(201).json({
          data: result.entry
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
          data: result.entry
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

      // Recipient doesn't exist
      if (result.outcome === 'recipient_not_found') {
        return res.status(404).json({
          error: {
            code: 'RECIPIENT_NOT_FOUND',
            message: 'Point recipient does not exist'
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
