
import { Router, type Request } from 'express';
import type { Pool } from 'pg';
import { validateCreatePoint } from './validate-point';
import { createPoint } from './create-point';
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

    // 3. Request validation
    const validation = validateCreatePoint(req.body);

    if (validation.error !== undefined) {
      return res.status(400).json({
        error: {
          code: 'INVALID_POINT_DATA',
          message: validation.error
        }
      });
    }

    // 4. Database operation will be implemented next.
    try{
      const result = await createPoint(pool,
        {
          id: actor.id,
          role: actor.role,
          teamId: actor.teamId
        }
        ,validation.value);
      if (result.outcome === 'created'){
        return res.status(201).json({
          data: result.entry
        });
      }
      if (result.outcome === 'forbidden'){
        return res.status(403).json({
          error:{
            code:'FORBIDDEN',
            message:'Actor or recipient is not authorized'
          }
        });
      }
      if (result.outcome === 'recipient_not_found'){
        return res.status(404).json({
          error:{
            code:'RECIPIENT_NOT_FOUND',
            message:'Recipient does not exist'
          }
        });
      }
      throw new Error('Unexpected point creation outcome');
    }catch(error){
      return next(error);
    }
  }
);

  return router;
}
