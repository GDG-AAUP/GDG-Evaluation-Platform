
import { Router, type Request } from 'express';
import type { Pool } from 'pg';

type ProjectRequest = Request & {
  projectUser?: {
    id: number;
  };
};

export function createPointsRouter(pool: Pool) {
  const router = Router();

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

  return router;
}

