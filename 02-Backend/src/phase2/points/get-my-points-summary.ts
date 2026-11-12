import type { Pool } from 'pg';

import { getTeamRanking } from '../rankings/get-team-ranking';
import { instantInPeriodSql, monthId, periodBounds } from '../shared/time';

type Viewer = { id: number; role: string; teamId: number | null };

export async function getMyPointsSummary(
  pool: Pool,
  viewer: Viewer,
  year: number,
  month: number | null
) {
  const bounds = periodBounds(year, month);

  const result = await pool.query(
    `SELECT
       COALESCE(SUM(points) FILTER (WHERE in_period), 0)::int AS total,
       COALESCE(SUM(points) FILTER (WHERE in_period AND points > 0), 0)::int AS positive,
       COALESCE(SUM(points) FILTER (WHERE in_period AND points < 0), 0)::int AS negative,
       COUNT(*) FILTER (WHERE in_period)::int AS "entryCount",
       COALESCE(SUM(points), 0)::int AS "allTimeTotal"
     FROM (
       SELECT points, (${instantInPeriodSql('effective_at', 2, 3)}) AS in_period
       FROM point_entries
       WHERE user_id = $1
     ) entries`,
    [viewer.id, bounds.start, bounds.end]
  );

  let rank: number | null = null;
  if (month !== null && viewer.role === 'member' && viewer.teamId !== null) {
    const rows = await getTeamRanking(pool, viewer.teamId, year, month);
    rank = rows.find((row) => row.userId === viewer.id)?.rank ?? null;
  }

  return {
    month: month === null ? String(year) : monthId({ year, month }),
    ...result.rows[0],
    rank
  };
}
