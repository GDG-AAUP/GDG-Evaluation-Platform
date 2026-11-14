import { Router, type Response } from 'express';
import type { Pool } from 'pg';

import { getCampusRanking } from '../rankings/get-campus-ranking';
import { getTeamRanking } from '../rankings/get-team-ranking';
import { type ProjectRequest, queryInt, sendError } from '../shared/http';
import { instantInPeriodSql, periodBounds } from '../shared/time';

const MAX_INT = 2147483647;
const round2 = (value: number) => Math.round(value * 100) / 100;
const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

function readPeriod(query: Record<string, unknown>) {
  const month = queryInt(query.month, 1, 12);
  const year = queryInt(query.year, 2000, 9999);
  if (month === null || year === null || (year === undefined && month !== undefined)) return null;
  return { year: year ?? null, month: month ?? null };
}

function readRequiredMonth(query: Record<string, unknown>) {
  const period = readPeriod(query);
  if (!period || period.year === null || period.month === null) return null;
  return { year: period.year, month: period.month };
}

function readText(value: unknown): string | null {
  if (value === undefined) return '';
  return typeof value === 'string' && value.length <= 150 ? value.trim() : null;
}

const badQuery = (res: Response) => sendError(res, 400, 'INVALID_ASSISTANT_QUERY', 'Invalid query parameters');
const forbidden = (res: Response, message: string) => sendError(res, 403, 'FORBIDDEN', message);

/**
 * Read-only data for the chatbot. It always runs as the signed-in user, whose Clerk token
 * the chatbot forwards, so every permission rule is enforced here and not by the model.
 */
export function createAssistantDataRouter(pool: Pool) {
  const router = Router();

  async function teamById(teamId: number) {
    const result = await pool.query(
      'SELECT team_id AS id, manager_user_id AS "managerId" FROM teams WHERE team_id = $1',
      [teamId]
    );
    return result.rows[0] ?? null;
  }

  router.get('/my-points-summary', async (req, res) => {
    const { projectUser: actor } = req as ProjectRequest;
    const period = readPeriod(req.query);
    if (!period) return badQuery(res);
    const bounds = periodBounds(period.year, period.month);
    const result = await pool.query(
      `SELECT COALESCE(SUM(points), 0)::int AS "totalPoints", COUNT(*)::int AS "entriesCount"
       FROM point_entries
       WHERE user_id = $1 AND ${instantInPeriodSql('effective_at', 2, 3)}`,
      [actor.id, bounds.start, bounds.end]
    );
    return res.status(200).json({ data: { ...period, ...result.rows[0] } });
  });

  router.get('/member-points', async (req, res) => {
    const { projectUser: actor } = req as ProjectRequest;
    if (actor.role === 'member') return forbidden(res, 'Members can only view their own points');
    const period = readPeriod(req.query);
    const name = readText(req.query.memberName);
    if (!period || !name) return badQuery(res);

    // A Manager's search only ever covers their own team, so other teams' names cannot be probed.
    const managedOnly = actor.role === 'manager';
    const matches = await pool.query(
      `SELECT u.user_id AS id, u.full_name AS name
       FROM users u
       LEFT JOIN teams t ON t.team_id = u.team_id
       WHERE u.role = 'Member' AND u.deleted_at IS NULL
         AND u.full_name ILIKE $1
         AND ($2::boolean = FALSE OR t.manager_user_id = $3)
       ORDER BY u.full_name
       LIMIT 6`,
      [`%${escapeLike(name)}%`, managedOnly, actor.id]
    );

    if (matches.rows.length === 0) return sendError(res, 404, 'USER_NOT_FOUND', 'No member with that name in your scope');
    if (matches.rows.length > 1) {
      return sendError(res, 409, 'AMBIGUOUS_NAME', `More than one match: ${matches.rows.map((m) => m.name).join(', ')}`);
    }

    const member = matches.rows[0];
    const bounds = periodBounds(period.year, period.month);
    const totals = await pool.query(
      `SELECT COALESCE(SUM(points), 0)::int AS "totalPoints", COUNT(*)::int AS "entriesCount"
       FROM point_entries
       WHERE user_id = $1 AND ${instantInPeriodSql('effective_at', 2, 3)}`,
      [member.id, bounds.start, bounds.end]
    );
    return res.status(200).json({ data: { member: member.name, ...period, ...totals.rows[0] } });
  });

  router.get('/points-awarded', async (req, res) => {
    const { projectUser: actor } = req as ProjectRequest;
    if (actor.role === 'member') return forbidden(res, 'Only managers and organizers award points');
    const period = readPeriod(req.query);
    if (!period) return badQuery(res);
    const bounds = periodBounds(period.year, period.month);
    const result = await pool.query(
      `SELECT COALESCE(SUM(points), 0)::int AS "totalAwarded", COUNT(*)::int AS "entriesCount"
       FROM point_entries
       WHERE performed_by_user_id = $1 AND ${instantInPeriodSql('effective_at', 2, 3)}`,
      [actor.id, bounds.start, bounds.end]
    );
    return res.status(200).json({ data: { ...period, ...result.rows[0] } });
  });

  router.get('/leaderboard', async (req, res) => {
    const period = readRequiredMonth(req.query);
    const scope = req.query.scope;
    const campusId = queryInt(req.query.campusId, 1, MAX_INT);
    const teamId = queryInt(req.query.teamId, 1, MAX_INT);
    const limit = queryInt(req.query.limit, 1, 500);
    if (!period || campusId === null || teamId === null || limit === null) return badQuery(res);
    if ((scope !== 'team' || !teamId) && (scope !== 'campus' || !campusId)) return badQuery(res);

    const rows = scope === 'team'
      ? await getTeamRanking(pool, teamId as number, period.year, period.month)
      : await getCampusRanking(pool, campusId as number, period.year, period.month);
    const hasData = rows.some((r) => r.totalPoints !== 0);
    const entries = hasData
      ? rows.map((r) => ({ rank: r.rank, name: r.fullName, totalPoints: r.totalPoints }))
      : [];

    // The board's month total answers "how many points does my team have this month?" in one call.
    const totalPoints = rows.reduce((sum, r) => sum + r.totalPoints, 0);
    return res.status(200).json({
      data: {
        scope, campusId: campusId ?? null, teamId: teamId ?? null, ...period, hasData,
        totalPoints, participants: rows.length,
        entries: limit ? entries.slice(0, limit) : entries
      }
    });
  });

  router.get('/my-ranking', async (req, res) => {
    const { projectUser: actor } = req as ProjectRequest;
    const period = readRequiredMonth(req.query);
    const scope = req.query.scope ?? 'team';
    if (!period || (scope !== 'team' && scope !== 'campus')) return badQuery(res);
    // Members and Managers are both ranked; an Organizer has no team and so no personal rank.
    if (!actor.teamId) return sendError(res, 400, 'NO_TEAM', 'This account has no team, so it has no personal ranking');

    let rows;
    if (scope === 'team') {
      rows = await getTeamRanking(pool, actor.teamId, period.year, period.month);
    } else {
      const team = await pool.query('SELECT campus_id AS "campusId" FROM teams WHERE team_id = $1', [actor.teamId]);
      rows = await getCampusRanking(pool, team.rows[0].campusId, period.year, period.month);
    }

    const mine = rows.find((r) => r.userId === actor.id);
    if (!mine || !rows.some((r) => r.totalPoints !== 0)) {
      return res.status(200).json({ data: { scope, ...period, hasData: false } });
    }
    const topPoints = rows[0].totalPoints;
    return res.status(200).json({
      data: {
        scope, ...period, hasData: true, rank: mine.rank, totalPoints: mine.totalPoints,
        topPoints, gapToFirst: topPoints - mine.totalPoints,
        peopleSharingMyRank: rows.filter((r) => r.rank === mine.rank).length,
        participants: rows.length
      }
    });
  });

  router.get('/my-evaluations', async (req, res) => {
    const { projectUser: actor } = req as ProjectRequest;
    const period = readPeriod(req.query);
    const limit = queryInt(req.query.limit, 1, 200);
    if (!period || limit === null) return badQuery(res);
    const bounds = periodBounds(period.year, period.month);
    const result = await pool.query(
      `SELECT activity_name AS "activityName", activity_date AS "activityDate",
              criteria_total_score AS "totalScore", criteria_max_score AS "maxScore", comments
       FROM performance_evaluations
       WHERE evaluated_user_id = $1
         AND ($2::timestamp IS NULL OR activity_date >= $2::timestamp)
         AND ($3::timestamp IS NULL OR activity_date < $3::timestamp)
       ORDER BY activity_date DESC, evaluation_id DESC`,
      [actor.id, bounds.start, bounds.end]
    );
    const count = result.rows.length;
    return res.status(200).json({
      data: {
        ...period,
        count,
        average: count ? round2(result.rows.reduce((sum, e) => sum + e.totalScore, 0) / count) : null,
        evaluations: limit ? result.rows.slice(0, limit) : result.rows
      }
    });
  });

  router.get('/team-activity', async (req, res) => {
    const { projectUser: actor } = req as ProjectRequest;
    const teamId = queryInt(req.query.teamId, 1, MAX_INT);
    const period = readPeriod(req.query);
    const keyword = readText(req.query.activity);
    if (!teamId || !period || keyword === null) return badQuery(res);

    const team = await teamById(teamId);
    if (!team) return sendError(res, 404, 'TEAM_NOT_FOUND', 'Team not found');
    if (actor.role === 'member' || (actor.role === 'manager' && team.managerId !== actor.id)) {
      return forbidden(res, "Only the team's manager or an organizer can view this");
    }

    const bounds = periodBounds(period.year, period.month);
    const result = await pool.query(
      `SELECT u.full_name AS member, p.points, p.activity_name AS "activityName", p.reason,
              p.effective_at AS "effectiveAt", (p.reverses_entry_id IS NOT NULL) AS "isReversal",
              p.reverses_entry_id::text AS "reversesEntryId"
       FROM point_entries p
       JOIN users u ON u.user_id = p.user_id
       WHERE u.team_id = $1 AND u.deleted_at IS NULL
         AND ${instantInPeriodSql('p.effective_at', 2, 3)}
         AND ($4 = '' OR p.activity_name ILIKE $5 OR p.activity_description ILIKE $5)
       ORDER BY p.effective_at, p.entry_id
       LIMIT 500`,
      [teamId, bounds.start, bounds.end, keyword, `%${escapeLike(keyword)}%`]
    );
    return res.status(200).json({ data: { teamId, ...period, entries: result.rows } });
  });

  router.get('/manager-evaluations', async (req, res) => {
    const { projectUser: actor } = req as ProjectRequest;
    if (actor.role !== 'organizer') return forbidden(res, 'Manager evaluations are restricted');
    const campusId = queryInt(req.query.campusId, 1, MAX_INT);
    const period = readPeriod(req.query);
    const name = readText(req.query.managerName);
    if (!campusId || !period || name === null) return badQuery(res);

    const bounds = periodBounds(period.year, period.month);
    const result = await pool.query(
      `SELECT u.full_name AS manager, COUNT(e.evaluation_id)::int AS "evaluationsCount",
              ROUND(AVG(e.criteria_total_score)::numeric, 2)::float AS average
       FROM users u
       JOIN teams t ON t.team_id = u.team_id
       LEFT JOIN performance_evaluations e
         ON e.evaluated_user_id = u.user_id
         AND ($2::timestamp IS NULL OR e.activity_date >= $2::timestamp)
         AND ($3::timestamp IS NULL OR e.activity_date < $3::timestamp)
       WHERE u.role = 'Manager' AND u.deleted_at IS NULL AND t.campus_id = $1
         AND ($4 = '' OR u.full_name ILIKE $5)
       GROUP BY u.user_id
       ORDER BY average DESC NULLS LAST, u.full_name`,
      [campusId, bounds.start, bounds.end, name, `%${escapeLike(name)}%`]
    );
    const scored = result.rows.filter((r) => r.average !== null).map((r) => r.average as number);
    return res.status(200).json({
      data: {
        campusId, ...period,
        totalEvaluations: result.rows.reduce((sum, r) => sum + r.evaluationsCount, 0),
        campusAverage: scored.length ? round2(scored.reduce((a, b) => a + b, 0) / scored.length) : null,
        managers: result.rows
      }
    });
  });

  router.get('/audit-logs', async (req, res) => {
    const { projectUser: actor } = req as ProjectRequest;
    if (actor.role !== 'organizer') return forbidden(res, 'Audit logs are for organizers only');
    const limit = queryInt(req.query.limit, 1, 50);
    if (limit === null) return badQuery(res);
    const result = await pool.query(
      `SELECT action, entity_name AS entity, entity_id AS "entityId",
              actor_user_id AS "actorUserId", reason, created_at AS "createdAt"
       FROM audit_logs
       ORDER BY created_at DESC, audit_id DESC
       LIMIT $1`,
      [limit ?? 10]
    );
    return res.status(200).json({ data: { logs: result.rows } });
  });

  return router;
}
