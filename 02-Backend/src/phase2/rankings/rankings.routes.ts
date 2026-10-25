
import { Router } from 'express';
import type { Pool } from 'pg';

import { validateRankingQuery } from './validate-ranking';
import { getTeamRanking } from './get-team-ranking';
import { getCampusRanking } from './get-campus-ranking';
import { getRankingOptions } from './get-ranking-options';
import { getArchivedRanking } from './get-archived-ranking';

export function createRankingsRouter(pool: Pool) {
  const router = Router();

  router.get('/options', async (req, res, next) => {
  try {
    const options = await getRankingOptions(pool);

    return res.status(200).json({
      data: options
    });
  } catch (error) {
    return next(error);
  }
});


router.get('/archived', async (req, res, next) => {
  const validation = validateRankingQuery(req.query);

  if ('error' in validation) {
    return res.status(400).json({
      error: {
        code: 'INVALID_RANKING_QUERY',
        message: validation.error
      }
    });
  }

  try {
    const result = await getArchivedRanking(
      pool,
      validation.value
    );

    return res.status(200).json({
      data: result
    });
  } catch (error) {
    return next(error);
  }
});


  // GET /api/rankings
  router.get('/', async (req, res, next) => {
    const validation = validateRankingQuery(req.query);

    if ('error' in validation) {
      return res.status(400).json({
        error: {
          code: 'INVALID_RANKING_QUERY',
          message: validation.error
        }
      });
    }

    const { scope, teamId, campusId, year, month } =
      validation.value;

    try {
      if (scope === 'Team') {
        if (teamId === null) {
          return res.status(400).json({
            error: {
              code: 'INVALID_RANKING_QUERY',
              message: 'Team ID is required'
            }
          });
        }

        const result = await getTeamRanking(
          pool,
          teamId,
          year,
          month
        );

        return res.status(200).json({
          data: result
        });
      }

      if (campusId === null) {
        return res.status(400).json({
          error: {
            code: 'INVALID_RANKING_QUERY',
            message: 'Campus ID is required'
          }
        });
      }

      const result = await getCampusRanking(
        pool,
        campusId,
        year,
        month
      );

      return res.status(200).json({
        data: result
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
