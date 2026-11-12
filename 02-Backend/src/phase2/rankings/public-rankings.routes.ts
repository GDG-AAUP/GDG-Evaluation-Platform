import { Router } from 'express';
import type { Pool } from 'pg';

import { getRankingOptions } from './get-ranking-options';
import { getTeamRanking } from './get-team-ranking';
import { getCampusRanking } from './get-campus-ranking';
import { publicWinner } from '../awards/awards.routes';
import { sendError, queryInt } from '../shared/http';
import { currentYearMonth, monthId } from '../shared/time';

/** The only unauthenticated ranking data: filter options and a current-month summary. */
export function createPublicRankingsRouter(pool: Pool) {
  const router = Router();

  router.get('/options', async (_req, res) => {
    res.status(200).json({ data: await getRankingOptions(pool) });
  });

  router.get('/public-summary', async (req, res) => {
    const campusId = queryInt(req.query.campusId, 1, 2147483647);
    if (campusId === undefined || campusId === null) {
      return sendError(res, 400, 'INVALID_RANKING_QUERY', 'A valid campus ID is required');
    }

    const options = await getRankingOptions(pool);
    const campus = options.campuses.find((c) => c.id === campusId);
    if (!campus) return sendError(res, 404, 'CAMPUS_NOT_FOUND', 'Campus not found');

    const period = currentYearMonth();
    const teams = options.teams.filter((t) => t.campusId === campusId);
    const [campusRows, teamRows] = await Promise.all([
      getCampusRanking(pool, campusId, period.year, period.month),
      Promise.all(teams.map((t) => getTeamRanking(pool, t.id, period.year, period.month)))
    ]);

    return res.status(200).json({
      data: {
        campus: { id: campus.id, name: campus.name },
        winner: await publicWinner(pool, campus, period),
        month: monthId(period),
        // Public rows deliberately carry a name and score only, never a user ID.
        top: campusRows
          .filter((r) => r.totalPoints > 0 && r.rank <= 3)
          .map((r) => ({ rank: r.rank, name: r.fullName, totalPoints: r.totalPoints })),
        teamLeaders: teams.map((team, i) => {
          const leader = teamRows[i].find((r) => r.totalPoints > 0);
          return {
            teamId: team.id,
            teamName: team.name,
            leader: leader ? { name: leader.fullName, totalPoints: leader.totalPoints } : null
          };
        }),
        participants: {
          rated: campusRows.filter((r) => r.totalPoints > 0).length,
          total: campusRows.length
        }
      }
    });
  });

  return router;
}
