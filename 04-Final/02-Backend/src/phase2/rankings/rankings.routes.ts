
import { Router } from 'express';
import type { Pool } from 'pg';

import { validateRankingQuery } from './validate-ranking';
import { getTeamRanking } from './get-team-ranking';
import { getCampusRanking } from './get-campus-ranking';
import { getRankingOptions } from './get-ranking-options';
import { getArchivedRanking } from './get-archived-ranking';
import { getAllRanking } from './get-all-ranking';

/**
 * Accepts the friendly ?campus=all|jenin|ramallah as well as the explicit scope/campusId form.
 * Returns the query in the explicit form, or null when the campus name is unknown.
 */
async function normalizeCampusQuery(pool: Pool, query: Record<string, unknown>) {
  if (query.campus === undefined) return query;
  const { campus, ...rest } = query;
  if (typeof campus !== 'string') return null;
  const key = campus.trim().toLowerCase();
  if (key === 'all') return { ...rest, scope: rest.scope ?? 'all' };
  const found = await pool.query('SELECT campus_id FROM campuses WHERE LOWER(campus_name) = $1', [key]);
  if (!found.rows.length) return null;
  return { ...rest, scope: rest.scope ?? 'campus', campusId: String(found.rows[0].campus_id) };
}

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


// GET /api/rankings/months: closed months, oldest first, for the month selectors.
router.get('/months', async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT entity_id AS id
       FROM audit_logs
       WHERE action = 'MONTHLY_RANKINGS_PUBLISHED'
         AND entity_name = 'monthly_rankings'
       ORDER BY entity_id`
    );

    return res.status(200).json({
      data: result.rows.map((row) => row.id)
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/archived', async (req, res, next) => {
  const normalized = await normalizeCampusQuery(pool, req.query as Record<string, unknown>);
  const validation = normalized ? validateRankingQuery(normalized) : { error: 'Unknown campus' };

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


  // GET /api/rankings: every signed-in role, either campus or both together (?campus=all).
  router.get('/', async (req, res, next) => {
    const normalized = await normalizeCampusQuery(pool, req.query as Record<string, unknown>);
    const validation = normalized ? validateRankingQuery(normalized) : { error: 'Unknown campus' };

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
      if (scope === 'All') {
        return res.status(200).json({ data: await getAllRanking(pool, year, month) });
      }

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
