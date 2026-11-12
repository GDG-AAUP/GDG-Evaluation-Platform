import type { Request, Response } from 'express';
import type { Pool } from 'pg';

import { getTeamRanking } from '../rankings/get-team-ranking';
import { type ProjectRequest, sendError } from '../shared/http';
import {
  campusKey,
  currentYearMonth,
  instantInPeriodSql,
  monthId,
  parseMonthId,
  periodBounds,
  type YearMonth
} from '../shared/time';

const AUDIT_ACTION_AR: Record<string, string> = {
  create_point_entry: 'إضافة نقاط',
  reverse_point_entry: 'عكس عملية نقاط',
  PERFORMANCE_EVALUATION_CREATED: 'إنشاء تقييم أداء',
  MONTHLY_RANKINGS_PUBLISHED: 'إغلاق شهر'
};

type MemberTotal = {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
  teamId: number;
  teamName: string;
  isOperational: boolean;
  campusName: string;
  points: number;
  entries: number;
};

/** Current members with their ledger totals for a Hebron month, optionally for one team. */
async function memberTotals(pool: Pool, period: YearMonth, teamId: number | null, activeOnly: boolean) {
  const bounds = periodBounds(period.year, period.month);
  const result = await pool.query<MemberTotal>(
    `SELECT u.user_id AS id, u.full_name AS name, u.email, u.is_active AS "isActive",
            t.team_id AS "teamId", t.team_name AS "teamName",
            t.is_operational AS "isOperational", c.campus_name AS "campusName",
            COALESCE(SUM(p.points), 0)::int AS points,
            COUNT(p.entry_id)::int AS entries
     FROM users u
     JOIN teams t ON t.team_id = u.team_id
     JOIN campuses c ON c.campus_id = t.campus_id
     LEFT JOIN point_entries p
       ON p.user_id = u.user_id AND ${instantInPeriodSql('p.effective_at', 1, 2)}
     WHERE u.role = 'Member' AND u.deleted_at IS NULL
       AND ($3::int IS NULL OR u.team_id = $3)
       AND ($4::boolean = FALSE OR u.is_active = TRUE)
     GROUP BY u.user_id, t.team_id, c.campus_id
     ORDER BY u.full_name, u.user_id`,
    [bounds.start, bounds.end, teamId, activeOnly]
  );
  return result.rows;
}

const percent = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);

/** Effective (latest revision) 15-item scorecard total per user for a month. */
async function scorecardTotals(pool: Pool, period: YearMonth) {
  const result = await pool.query(
    `SELECT DISTINCT ON (target_user_id) target_user_id AS id, total_score AS total
     FROM performance_scorecards WHERE year = $1 AND month = $2
     ORDER BY target_user_id, revision DESC`,
    [period.year, period.month]
  );
  return new Map<number, number>(result.rows.map((row) => [row.id, row.total]));
}

const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function createDashboardHandlers(pool: Pool) {
  // GET /api/teams/:id/overview: requireTeamAccess has already limited Managers to their own team.
  async function teamOverview(req: Request, res: Response) {
    const { projectUser: actor, projectTeam: team } = req as ProjectRequest;
    if (!team) return sendError(res, 404, 'TEAM_NOT_FOUND', 'Team not found');

    const period = currentYearMonth();
    const [scorecards, members, ranking, campusResult, managerResult] = await Promise.all([
      scorecardTotals(pool, period),
      memberTotals(pool, period, team.id, false),
      getTeamRanking(pool, team.id, period.year, period.month),
      pool.query('SELECT campus_name AS name FROM campuses WHERE campus_id = $1', [team.campusId]),
      pool.query(
        `SELECT email, is_active AS "isActive" FROM users WHERE user_id = $1`,
        [actor.id]
      )
    ]);

    const campus = campusKey(campusResult.rows[0]?.name ?? '');
    const rankCount = new Map<number, number>();
    ranking.forEach((r) => rankCount.set(r.rank, (rankCount.get(r.rank) ?? 0) + 1));

    const people = members.map((m) => ({
      id: String(m.id),
      name: m.name,
      email: m.email,
      role: 'member',
      status: m.isActive ? 'active' : 'disabled',
      total: scorecards.get(m.id) ?? (null as unknown as number),
      isMe: false
    }));
    if (actor.role === 'manager') {
      people.unshift({
        id: String(actor.id),
        name: actor.name,
        email: managerResult.rows[0]?.email ?? '',
        role: 'manager',
        status: 'active',
        total: null as unknown as number,
        isMe: true
      });
    }

    return res.status(200).json({
      data: {
        team: {
          id: String(team.id),
          campus,
          name: team.name,
          status: team.isOperational ? 'active' : 'disabled'
        },
        month: monthId(period),
        metrics: {
          activeMembers: members.filter((m) => m.isActive).length,
          points: ranking.reduce((sum, r) => sum + r.totalPoints, 0)
        },
        top: ranking.slice(0, 5).map((r) => ({
          kind: 'points',
          photo: null,
          rank: r.rank,
          userId: String(r.userId),
          name: r.fullName,
          campus,
          teamId: String(team.id),
          teamName: team.name,
          teamsLabel: team.name,
          total: r.totalPoints,
          tie: (rankCount.get(r.rank) ?? 0) > 1,
          isMe: r.userId === actor.id
        })),
        members: people
      }
    });
  }

  async function recentAudit() {
    const result = await pool.query(
      `SELECT a.audit_id::text AS id, a.action, a.entity_id AS "entityId",
              a.created_at AS "createdAt", COALESCE(u.full_name, '') AS "actorName"
       FROM audit_logs a
       LEFT JOIN users u ON u.user_id = a.actor_user_id
       ORDER BY a.created_at DESC, a.audit_id DESC
       LIMIT 5`
    );
    return result.rows.map((a) => ({
      id: a.id,
      action: AUDIT_ACTION_AR[a.action] ?? a.action,
      entity: a.entityId === null ? '—' : `#${a.entityId}`,
      ts: a.createdAt.getTime(),
      actorName: a.actorName
    }));
  }

  async function activeManagers(campus: string) {
    const result = await pool.query(
      `SELECT c.campus_name AS "campusName"
       FROM users u
       JOIN teams t ON t.team_id = u.team_id
       JOIN campuses c ON c.campus_id = t.campus_id
       WHERE u.role = 'Manager' AND u.is_active = TRUE AND u.deleted_at IS NULL`
    );
    return result.rows.filter((r) => campus === 'all' || campusKey(r.campusName) === campus).length;
  }

  const countCampus = (rows: MemberTotal[], key: string) =>
    rows.filter((m) => campusKey(m.campusName) === key).length;

  function perTeamRows(rows: MemberTotal[]) {
    const teams = new Map<number, { id: number; name: string; campusName: string; points: number; count: number }>();
    rows.forEach((m) => {
      const team = teams.get(m.teamId) ?? {
        id: m.teamId, name: m.teamName, campusName: m.campusName, points: 0, count: 0
      };
      team.points += m.points;
      team.count += 1;
      teams.set(m.teamId, team);
    });
    return [...teams.values()];
  }

  // GET /api/overview
  async function organizerOverview(_req: Request, res: Response) {
    const period = currentYearMonth();
    const [rows, managers, recent] = await Promise.all([
      memberTotals(pool, period, null, true),
      activeManagers('all'),
      recentAudit()
    ]);

    return res.status(200).json({
      data: {
        month: monthId(period),
        members: {
          jenin: countCampus(rows, 'jenin'),
          ramallah: countCampus(rows, 'ramallah'),
          total: rows.length
        },
        managers,
        pointsAdded: rows.reduce((sum, m) => sum + m.points, 0),
        perTeam: perTeamRows(rows).map((t) => ({
          teamId: String(t.id),
          campus: campusKey(t.campusName),
          name: t.name,
          points: t.points
        })),
        recent
      }
    });
  }

  // GET /api/dashboard/ratings?campus=all|jenin|ramallah
  async function organizerDashboard(req: Request, res: Response) {
    const campus = String(req.query.campus ?? 'all');
    if (!['all', 'jenin', 'ramallah'].includes(campus)) {
      return sendError(res, 400, 'INVALID_CAMPUS', 'Campus must be all, jenin or ramallah');
    }

    const period = currentYearMonth();
    const [everyone, managers, scorecards] = await Promise.all([
      memberTotals(pool, period, null, true),
      activeManagers(campus),
      scorecardTotals(pool, period)
    ]);
    const rows = everyone.filter((m) => campus === 'all' || campusKey(m.campusName) === campus);
    const scoresOf = (list: MemberTotal[]) =>
      list.map((m) => scorecards.get(m.id)).filter((score): score is number => score !== undefined);
    const rated = scoresOf(rows);
    const everyoneTotal = everyone.reduce((sum, m) => sum + m.points, 0);
    const scopePoints = rows.reduce((sum, m) => sum + m.points, 0);

    return res.status(200).json({
      data: {
        month: monthId(period),
        campus,
        members: {
          total: rows.length,
          jenin: countCampus(rows, 'jenin'),
          ramallah: countCampus(rows, 'ramallah')
        },
        managers,
        performance: {
          total: rated.reduce((sum, score) => sum + score, 0),
          ratedCount: rated.length,
          average: average(rated) ?? 0
        },
        activities: {
          points: scopePoints,
          count: rows.reduce((sum, m) => sum + m.entries, 0),
          participatingMembers: rows.filter((m) => m.entries > 0).length,
          percentage: percent(scopePoints, everyoneTotal)
        },
        perTeam: perTeamRows(rows).map((t) => ({
          id: String(t.id),
          name: t.name,
          campus: campusKey(t.campusName),
          memberCount: t.count,
          performanceAverage: average(scoresOf(rows.filter((m) => m.teamId === t.id))),
          activityPoints: t.points,
          activityPercentage: percent(t.points, everyoneTotal)
        })),
        people: rows
          .map((m) => ({
            id: String(m.id),
            name: m.name,
            campus: campusKey(m.campusName),
            teams: [String(m.teamId)],
            performance: scorecards.get(m.id) ?? null,
            activityPoints: m.points,
            activityPercentage: percent(m.points, everyoneTotal),
            activityCount: m.entries
          }))
          .sort((a, b) => b.activityPercentage - a.activityPercentage || a.name.localeCompare(b.name, 'ar'))
      }
    });
  }

  // GET /api/ratings/ledger?month&campus&teamId&kind: the read-only point ledger, newest first.
  // Team and campus are the ones the member belonged to when the points were recorded.
  async function pointsLedger(req: Request, res: Response) {
    const { month = '', campus = '', teamId = '', kind = '' } = req.query as Record<string, string>;
    const period = month === '' ? null : parseMonthId(month);
    if (
      (month !== '' && !period) ||
      !['', 'jenin', 'ramallah'].includes(campus) ||
      !/^(|[1-9]\d{0,9})$/.test(teamId) ||
      !['', 'performance', 'activity', 'legacy'].includes(kind)
    ) {
      return sendError(res, 400, 'INVALID_LEDGER_QUERY', 'Invalid ledger filters');
    }

    // Ledger rows are point entries; performance scorecards and legacy types are not listed here.
    if (kind === 'performance' || kind === 'legacy') return res.status(200).json({ data: [] });

    const bounds = periodBounds(period?.year ?? null, period?.month ?? null);
    const [entries, closed] = await Promise.all([
      pool.query(
        `SELECT p.entry_id::text AS id, p.user_id::text AS "userId", u.full_name AS "userName",
                p.points, p.activity_name AS label, p.reason, p.effective_at AS "effectiveAt",
                actor.full_name AS "actorName", c.campus_name AS "campusName",
                t.team_id::text AS "teamId", t.team_name AS "teamName",
                to_char(p.effective_at AT TIME ZONE 'Asia/Hebron', 'YYYY-MM') AS month
         FROM point_entries p
         JOIN users u ON u.user_id = p.user_id
         JOIN users actor ON actor.user_id = p.performed_by_user_id
         LEFT JOIN LATERAL (
           SELECT h.team_id
           FROM assignment_history h
           WHERE h.user_id = p.user_id
             AND p.effective_at >= h.effective_from
             AND (h.effective_to IS NULL OR p.effective_at < h.effective_to)
           ORDER BY h.effective_from DESC
           LIMIT 1
         ) assignment ON TRUE
         LEFT JOIN teams t ON t.team_id = COALESCE(assignment.team_id, u.team_id)
         LEFT JOIN campuses c ON c.campus_id = t.campus_id
         WHERE ${instantInPeriodSql('p.effective_at', 1, 2)}
           AND ($3::int IS NULL OR t.team_id = $3)
           AND ($4 = '' OR LOWER(c.campus_name) = $4)
         ORDER BY p.effective_at DESC, p.entry_id DESC
         LIMIT 1000`,
        [bounds.start, bounds.end, teamId === '' ? null : Number(teamId), campus]
      ),
      pool.query(
        `SELECT entity_id AS id FROM audit_logs
         WHERE action = 'MONTHLY_RANKINGS_PUBLISHED' AND entity_name = 'monthly_rankings'`
      )
    ]);
    const closedMonths = new Set(closed.rows.map((row) => row.id));

    return res.status(200).json({
      data: entries.rows.map((row) => ({
        id: `activity:${row.id}`,
        userId: row.userId,
        userName: row.userName,
        campus: row.campusName ? campusKey(row.campusName) : '',
        teamIds: row.teamId ? [row.teamId] : [],
        teamsLabel: row.teamName ?? '—',
        month: row.month,
        ts: row.effectiveAt.getTime(),
        type: 'activity',
        performance: null,
        activityPoints: row.points,
        legacyPoints: null,
        label: row.label,
        reason: row.reason,
        actorName: row.actorName,
        revision: null,
        archived: closedMonths.has(row.month)
      }))
    });
  }

  return { teamOverview, organizerOverview, organizerDashboard, pointsLedger };
}
