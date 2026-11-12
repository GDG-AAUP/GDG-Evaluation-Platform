import type { Pool } from 'pg';

import { instantInPeriodSql, periodBounds } from '../shared/time';

type Actor = { id: number; role: 'organizer' | 'manager' | 'member' };

/**
 * The month's point log behind the Give Points page, scoped on the server:
 *  - Manager: every entry whose recipient belonged to the team they manage NOW at the entry's
 *    instant (whoever recorded it), plus month totals per person and for the team.
 *  - Organizer: the entries they recorded themselves (they have no team).
 * Members never reach this (the route refuses them).
 */
export async function getTeamPointsHistory(pool: Pool, actor: Actor, year: number, month: number, limit: number) {
  const bounds = periodBounds(year, month);
  let team: { id: number; name: string } | null = null;
  if (actor.role === 'manager') {
    const managed = await pool.query(
      'SELECT team_id AS id, team_name AS name FROM teams WHERE manager_user_id = $1',
      [actor.id]
    );
    team = managed.rows[0] ?? null;
    if (!team) return { outcome: 'no_team' as const };
  }

  // Scope filter, shared by the entry list and the totals.
  const scopeSql = team
    ? `EXISTS (SELECT 1 FROM assignment_history h
               WHERE h.user_id = p.user_id AND h.team_id = $3
                 AND p.effective_at >= h.effective_from
                 AND (h.effective_to IS NULL OR p.effective_at < h.effective_to))`
    : 'p.performed_by_user_id = $3';
  const params = [bounds.start, bounds.end, team ? team.id : actor.id];

  const [entries, people, totals] = await Promise.all([
    pool.query(
      `SELECT p.entry_id::text AS id, p.user_id::text AS "userId", u.full_name AS "userName",
              p.points, p.activity_name AS "activityName", p.reason, p.effective_at AS "effectiveAt",
              a.full_name AS "actorName", (p.performed_by_user_id = $4) AS "awardedByMe",
              p.reverses_entry_id::text AS "reversesEntryId",
              EXISTS (SELECT 1 FROM point_entries r WHERE r.reverses_entry_id = p.entry_id) AS reversed
       FROM point_entries p
       JOIN users u ON u.user_id = p.user_id
       JOIN users a ON a.user_id = p.performed_by_user_id
       WHERE ${instantInPeriodSql('p.effective_at', 1, 2)} AND ${scopeSql}
       ORDER BY p.effective_at DESC, p.entry_id DESC
       LIMIT $5`,
      [...params, actor.id, limit]
    ),
    pool.query(
      `SELECT p.user_id::text AS "userId", u.full_name AS name, SUM(p.points)::int AS total,
              COUNT(*)::int AS entries
       FROM point_entries p JOIN users u ON u.user_id = p.user_id
       WHERE ${instantInPeriodSql('p.effective_at', 1, 2)} AND ${scopeSql}
       GROUP BY p.user_id, u.full_name
       ORDER BY total DESC, u.full_name`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS entries, COALESCE(SUM(p.points), 0)::int AS points,
              COALESCE(SUM(p.points) FILTER (WHERE p.performed_by_user_id = $4), 0)::int AS "awardedByMe",
              COUNT(*) FILTER (WHERE p.performed_by_user_id = $4)::int AS "awardedByMeEntries"
       FROM point_entries p
       WHERE ${instantInPeriodSql('p.effective_at', 1, 2)} AND ${scopeSql}`,
      [...params, actor.id]
    )
  ]);

  return {
    outcome: 'ok' as const,
    data: {
      scope: team ? 'team' : 'awarded',
      team,
      year,
      month,
      totals: totals.rows[0],
      members: people.rows,
      entries: entries.rows,
      truncated: entries.rows.length === limit
    }
  };
}
