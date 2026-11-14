import { Router } from 'express';
import type { Pool } from 'pg';

import { getCampusRanking } from '../rankings/get-campus-ranking';
import { getTeamRanking } from '../rankings/get-team-ranking';
import { type ProjectRequest, sendError } from '../shared/http';
import { closedMonthIds, isMonthLocked, parseEntityId } from '../shared/people';
import { campusKey, currentYearMonth, instantInPeriodSql, monthId, parseMonthId, periodBounds, type YearMonth } from '../shared/time';

const MAX_GROUPS = 4;

async function findCampus(pool: Pick<Pool, 'query'>, key: string) {
  const result = await pool.query('SELECT campus_id AS id, campus_name AS name FROM campuses');
  return result.rows.find((campus) => campusKey(campus.name) === key) ?? null;
}

async function teamLeaders(pool: Pool, campusId: number, period: YearMonth) {
  const teams = await pool.query(
    `SELECT team_id AS id, team_name AS name FROM teams
     WHERE campus_id = $1 AND is_operational = TRUE ORDER BY team_name, team_id LIMIT ${MAX_GROUPS}`,
    [campusId]
  );
  const rankings = await Promise.all(
    teams.rows.map((team) => getTeamRanking(pool, team.id, period.year, period.month))
  );
  return teams.rows.map((team, i) => {
    const leader = rankings[i].find((row) => row.totalPoints > 0);
    return {
      teamId: String(team.id),
      name: team.name as string,
      leader: leader ? { id: String(leader.userId), name: leader.fullName, photo: null, total: leader.totalPoints } : null
    };
  });
}

/** The month's recognized member, or stale when a current selection is no longer a team leader. */
export async function getAward(
  pool: Pool,
  campus: { id: number; name: string },
  period: YearMonth,
  groups: Awaited<ReturnType<typeof teamLeaders>>,
  closed: string[]
) {
  const result = await pool.query(
    `SELECT a.user_id AS "userId", u.full_name AS name, a.team_id AS "teamId", t.team_name AS "teamName",
            a.total_points AS total, a.selected_by_user_id AS "selectedBy", a.selected_at AS "selectedAt"
     FROM monthly_awards a
     JOIN users u ON u.user_id = a.user_id AND u.deleted_at IS NULL
     JOIN teams t ON t.team_id = a.team_id
     WHERE a.campus_id = $1 AND a.year = $2 AND a.month = $3`,
    [campus.id, period.year, period.month]
  );
  const award = result.rows[0];
  if (!award) return { winner: null, stale: false };

  const month = monthId(period);
  const archived = closed.includes(month);
  const group = groups.find((g) => g.teamId === String(award.teamId) && g.leader?.id === String(award.userId));
  if (!archived && !group) return { winner: null, stale: true };

  return {
    winner: {
      userId: String(award.userId),
      name: award.name as string,
      photo: null,
      total: (!archived && group?.leader ? group.leader.total : award.total) as number,
      teamId: String(award.teamId),
      teamName: award.teamName as string,
      campus: campusKey(campus.name),
      month,
      selectedBy: String(award.selectedBy),
      selectedAt: award.selectedAt.getTime()
    },
    stale: false
  };
}

export async function publicWinner(pool: Pool, campus: { id: number; name: string }, period: YearMonth) {
  const groups = await teamLeaders(pool, campus.id, period);
  const { winner } = await getAward(pool, campus, period, groups, await closedMonthIds(pool));
  return winner ? { name: winner.name, total: winner.total, teamName: winner.teamName } : null;
}

export function createAwardsRouter(pool: Pool) {
  const router = Router();

  // GET /api/awards?campus=jenin&month=YYYY-MM
  router.get('/', async (req, res) => {
    const period = req.query.month === undefined ? currentYearMonth() : parseMonthId(req.query.month);
    if (!period) return sendError(res, 400, 'INVALID_MONTH', 'Month must be YYYY-MM');
    const campus = await findCampus(pool, String(req.query.campus ?? 'jenin'));
    if (!campus) return sendError(res, 400, 'INVALID_CAMPUS', 'Unknown campus');

    const closed = await closedMonthIds(pool);
    const groups = await teamLeaders(pool, campus.id, period);
    const { winner, stale } = await getAward(pool, campus, period, groups, closed);
    const bounds = periodBounds(period.year, period.month);

    const [ranking, members, winnerActivities] = await Promise.all([
      getCampusRanking(pool, campus.id, period.year, period.month),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM users u JOIN teams t ON t.team_id = u.team_id
         WHERE t.campus_id = $1 AND u.role = 'Member' AND u.is_active = TRUE AND u.deleted_at IS NULL`,
        [campus.id]
      ),
      winner
        ? pool.query(
            `SELECT entry_id::text AS id, activity_name AS title,
                    COALESCE(activity_description, reason) AS description
             FROM point_entries
             WHERE user_id = $1 AND ${instantInPeriodSql('effective_at', 2, 3)}
             ORDER BY effective_at DESC, entry_id DESC`,
            [winner.userId, bounds.start, bounds.end]
          )
        : Promise.resolve({ rows: [] })
    ]);

    const current = monthId(currentYearMonth());
    return res.status(200).json({
      data: {
        campus: campusKey(campus.name),
        month: monthId(period),
        months: [...closed.map((id) => ({ id, status: 'archived' })), { id: current, status: 'open' }],
        groups,
        winner,
        winnerActivities: winnerActivities.rows,
        stale,
        ratedCount: ranking.filter((row) => row.totalPoints > 0).length,
        memberCount: members.rows[0].count,
        demo: false,
        news: []
      }
    });
  });

  // POST /api/awards { campus, month, userId }: the choice must be a current team leader.
  router.post('/', async (req, res) => {
    const { projectUser: actor } = req as ProjectRequest;
    if (actor.role !== 'organizer') return sendError(res, 403, 'FORBIDDEN', 'Organizer access is required');

    const { campus: campusName, month, userId: rawUserId } = req.body ?? {};
    const userId = parseEntityId(rawUserId);
    const period = month === undefined ? currentYearMonth() : parseMonthId(month);
    if (userId === null || !period) return sendError(res, 400, 'INVALID_AWARD', 'Invalid user or month');
    const campus = await findCampus(pool, String(campusName ?? ''));
    if (!campus) return sendError(res, 400, 'INVALID_CAMPUS', 'Unknown campus');
    if (isMonthLocked(period, await closedMonthIds(pool))) return sendError(res, 409, 'MONTH_LOCKED', 'This month is locked');

    const groups = await teamLeaders(pool, campus.id, period);
    const group = groups.find((g) => g.leader?.id === String(userId));
    if (!group || !group.leader || actor.id === userId) {
      return sendError(res, 400, 'INVALID_AWARD_CANDIDATE', 'Choose one of the current team leaders');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const previous = await client.query(
        `SELECT user_id AS "userId" FROM monthly_awards
         WHERE campus_id = $1 AND year = $2 AND month = $3 FOR UPDATE`,
        [campus.id, period.year, period.month]
      );
      await client.query(
        `INSERT INTO monthly_awards (campus_id, year, month, user_id, team_id, total_points, selected_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (campus_id, year, month) DO UPDATE SET
           user_id = EXCLUDED.user_id, team_id = EXCLUDED.team_id, total_points = EXCLUDED.total_points,
           selected_by_user_id = EXCLUDED.selected_by_user_id, selected_at = CURRENT_TIMESTAMP`,
        [campus.id, period.year, period.month, userId, Number(group.teamId), group.leader.total, actor.id]
      );
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, old_values, new_values, reason)
         VALUES ($1, 'SELECT_MONTHLY_AWARD', 'monthly_awards', $2, $3::jsonb, $4::jsonb, 'Member of the month selected from team leaders')`,
        [actor.id, `${campus.id}:${monthId(period)}`,
          previous.rows[0] ? JSON.stringify(previous.rows[0]) : null,
          JSON.stringify({ userId, teamId: Number(group.teamId), total: group.leader.total })]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return res.status(201).json({
      data: {
        userId: String(userId),
        name: group.leader.name,
        photo: null,
        total: group.leader.total,
        teamId: group.teamId,
        teamName: group.name,
        campus: campusKey(campus.name),
        month: monthId(period),
        selectedBy: String(actor.id)
      }
    });
  });

  return router;
}
