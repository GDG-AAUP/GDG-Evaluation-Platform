import { Router } from 'express';
import type { Pool } from 'pg';

import { publishMonthlySnapshot } from '../rankings/publish-monthly-snapshot';
import { applyClosedMonthCorrection, validateCorrection } from './closed-month-correction';
import { type ProjectRequest, sendError } from '../shared/http';
import {
  campusKey,
  currentYearMonth,
  monthId,
  parseMonthId,
  previousYearMonth,
  type YearMonth
} from '../shared/time';

const PUBLISH_FAILURES: Record<string, [number, string, string]> = {
  FORBIDDEN_SNAPSHOT_PUBLICATION: [403, 'FORBIDDEN', 'An active organizer is required'],
  MONTH_ALREADY_PUBLISHED: [409, 'MONTH_ALREADY_PUBLISHED', 'This month has already been closed'],
  EXISTING_SNAPSHOT_ROWS: [409, 'EXISTING_SNAPSHOT_ROWS', 'Snapshot rows already exist for this month'],
  SNAPSHOT_CONFLICTS: [409, 'SNAPSHOT_CONFLICTS', 'The snapshot contains duplicate rows for one team or campus']
};

const CORRECTION_FAILURES: Record<string, [number, string, string]> = {
  forbidden: [403, 'FORBIDDEN', 'Managers can correct only people of the team they manage, never themselves'],
  recipient_not_found: [404, 'RECIPIENT_NOT_FOUND', 'Person not found'],
  recipient_ineligible: [409, 'CORRECTION_RECIPIENT_INELIGIBLE', 'Only a non-deleted Member or Manager can be corrected'],
  no_assignment: [409, 'NO_TEAM_IN_MONTH', 'This person did not belong to a team in that month']
};

async function closedMonths(pool: Pool) {
  const result = await pool.query(
    `SELECT entity_id AS id, created_at AS "closedAt"
     FROM audit_logs
     WHERE action = 'MONTHLY_RANKINGS_PUBLISHED' AND entity_name = 'monthly_rankings'
     ORDER BY entity_id DESC`
  );
  return result.rows as { id: string; closedAt: Date }[];
}

/** The month the close action applies to: last month until it is closed, then the running month. */
function closableMonth(closed: { id: string }[], now: Date = new Date()): YearMonth {
  const current = currentYearMonth(now);
  const previous = previousYearMonth(current);
  return closed.some((m) => m.id === monthId(previous)) ? current : previous;
}

function parseCloseTarget(body: unknown): YearMonth | null | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== 'object' || Array.isArray(body)) return null;
  const { year, month, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (year === undefined && month === undefined) return undefined;
  return parseMonthId(`${year}-${String(month).padStart(2, '0')}`);
}

export function createArchiveRouter(pool: Pool) {
  const router = Router();

  // Organizer: every month, all correctable people. Manager: the people of the team they manage.
  router.get('/', async (req, res) => {
    const actor = (req as ProjectRequest).projectUser;
    const managedOnly = actor.role === 'manager';
    const closed = await closedMonths(pool);
    const open = monthId(closableMonth(closed));
    const [people, corrections] = await Promise.all([
      pool.query(
        `SELECT u.user_id::text AS id, u.full_name AS name, c.campus_name AS "campusName", LOWER(u.role) AS role
         FROM users u
         JOIN teams t ON t.team_id = u.team_id
         JOIN campuses c ON c.campus_id = t.campus_id
         WHERE u.role IN ('Member', 'Manager') AND u.deleted_at IS NULL AND u.user_id <> $1
           AND ($2::boolean = FALSE OR t.manager_user_id = $1)
         ORDER BY u.full_name, u.user_id`,
        [actor.id, managedOnly]
      ),
      pool.query(
        `SELECT p.entry_id::text AS id, p.points AS value, p.reason, p.user_id::text AS "userId",
                u.full_name AS "userName", a.full_name AS "actorName", l.created_at AS ts,
                l.new_values->>'month' AS month
         FROM audit_logs l
         JOIN point_entries p ON p.entry_id::text = l.entity_id
         JOIN users u ON u.user_id = p.user_id
         JOIN users a ON a.user_id = p.performed_by_user_id
         WHERE l.action = 'CLOSED_MONTH_CORRECTION' AND l.entity_name = 'point_entries'
           AND ($2::boolean = FALSE OR p.performed_by_user_id = $1 OR (l.new_values->>'teamId')::int IN
                (SELECT team_id FROM teams WHERE manager_user_id = $1))
         ORDER BY l.created_at DESC
         LIMIT 200`,
        [actor.id, managedOnly]
      )
    ]);

    return res.status(200).json({
      data: {
        curMonth: open,
        months: [
          { id: open, status: 'open' },
          ...closed.map((m) => ({ id: m.id, status: 'archived' }))
        ],
        corrections: corrections.rows.map((c) => ({ ...c, ts: new Date(c.ts).getTime() })),
        members: people.rows.map((m) => ({
          id: m.id,
          name: m.name,
          role: m.role,
          campus: campusKey(m.campusName)
        }))
      }
    });
  });

  // POST /api/archive/close: optional { year, month }; defaults to the month shown as open.
  router.post('/close', async (req, res) => {
    const actor = (req as ProjectRequest).projectUser;
    if (actor.role !== 'organizer') return sendError(res, 403, 'FORBIDDEN', 'Organizer access is required');
    const requested = parseCloseTarget(req.body);
    if (requested === null) {
      return sendError(res, 400, 'INVALID_ARCHIVE_MONTH', 'Provide a valid year and month, or no body');
    }

    const closed = await closedMonths(pool);
    const target = requested ?? closableMonth(closed);
    if (monthId(target) >= monthId(currentYearMonth())) {
      return sendError(res, 409, 'MONTH_NOT_ENDED', 'A month can only be closed after it has ended');
    }

    try {
      const result = await publishMonthlySnapshot(pool, target.year, target.month, actor.id);
      const refreshed = await closedMonths(pool);
      return res.status(201).json({
        data: { ...result, curMonth: monthId(closableMonth(refreshed)) }
      });
    } catch (error) {
      const failure = PUBLISH_FAILURES[(error as Error).message];
      if (failure) return sendError(res, failure[0], failure[1], failure[2]);
      if ((error as { code?: string }).code === '40001') {
        return sendError(res, 409, 'CLOSE_IN_PROGRESS', 'Another change is in progress; retry shortly');
      }
      throw error;
    }
  });

  // POST /api/archive/corrections { month: 'YYYY-MM', userId, value, reason }: a compensating point
  // entry inside a prior month; a closed month's Team and Campus rankings are recomputed atomically.
  router.post('/corrections', async (req, res) => {
    const actor = (req as ProjectRequest).projectUser;
    const validation = validateCorrection(req.body, currentYearMonth());
    if ('error' in validation) return sendError(res, 400, validation.code, validation.error);
    try {
      const result = await applyClosedMonthCorrection(pool, actor, validation.value);
      const failure = CORRECTION_FAILURES[result.outcome];
      if (failure) return sendError(res, failure[0], failure[1], failure[2]);
      if (result.outcome !== 'corrected') throw new Error('Unexpected correction outcome');
      return res.status(201).json({ data: result.data });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return sendError(res, 409, 'SNAPSHOT_CONFLICTS', 'The recomputed snapshot would duplicate a ranking row');
      }
      throw error;
    }
  });

  router.get('/:month', async (req, res) => {
    const actor = (req as unknown as ProjectRequest).projectUser;
    const period = parseMonthId(req.params.month);
    if (!period) return sendError(res, 400, 'INVALID_ARCHIVE_MONTH', 'Month must be YYYY-MM');

    const closed = await closedMonths(pool);
    const entry = closed.find((m) => m.id === monthId(period));
    if (!entry) return sendError(res, 404, 'SNAPSHOT_NOT_FOUND', 'This month has no snapshot');

    const teamFilter = /^[1-9]\d{0,9}$/.test(String(req.query.teamId ?? ''))
      ? Number(req.query.teamId)
      : null;
    if (req.query.teamId && teamFilter === null) {
      return sendError(res, 400, 'INVALID_TEAM_ID', 'Team ID must be a positive integer');
    }

    const result = await pool.query(
      `SELECT r.rank_position AS rank, r.user_id AS "userId", u.full_name AS name,
              r.total_points AS total, r.campus_id AS "campusId", r.team_id AS "teamId",
              c.campus_name AS "campusName", t.team_name AS "teamName"
       FROM monthly_rankings r
       JOIN users u ON u.user_id = r.user_id
       JOIN campuses c ON c.campus_id = r.campus_id
       LEFT JOIN teams t ON t.team_id = r.team_id
       WHERE r.year = $1 AND r.month = $2
         AND r.archived_at IS NOT NULL
         AND u.role IN ('Member', 'Manager') AND u.deleted_at IS NULL
         AND r.ranking_scope = $3
         AND ($4::int IS NULL OR r.team_id = $4)
       ORDER BY r.campus_id, r.rank_position, u.full_name, u.user_id`,
      [period.year, period.month, teamFilter === null ? 'Campus' : 'Team', teamFilter]
    );

    const campus = String(req.query.campus ?? '');
    const rows = result.rows.filter((r) => !campus || campusKey(r.campusName) === campus);
    const shared = new Map<string, number>();
    const keyOf = (r: { campusId: number; rank: number }) => `${r.campusId}-${r.rank}`;
    rows.forEach((r) => shared.set(keyOf(r), (shared.get(keyOf(r)) ?? 0) + 1));

    return res.status(200).json({
      data: {
        month: entry.id,
        closedAt: entry.closedAt.getTime(),
        rows: rows.map((r) => ({
          kind: 'points',
          photo: null,
          rank: r.rank,
          userId: String(r.userId),
          name: r.name,
          campus: campusKey(r.campusName),
          // The page keys rows by user and teamId, and a transferred member has one row per campus.
          teamId: r.teamId === null ? `campus-${r.campusId}` : String(r.teamId),
          teamName: r.teamName ?? '',
          teamsLabel: r.teamName ?? '',
          total: r.total,
          tie: (shared.get(keyOf(r)) ?? 0) > 1,
          isMe: r.userId === actor.id
        }))
      }
    });
  });

  return router;
}
