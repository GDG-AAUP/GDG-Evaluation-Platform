
import type { Pool } from 'pg';

export type CampusRankingRow = {
  rank: number;
  userId: number;
  fullName: string;
  totalPoints: number;
};

export async function getCampusRanking(
  pool: Pool,
  campusId: number,
  year: number,
  month: number
): Promise<CampusRankingRow[]> {

  const sql = `
WITH bounds AS (
  SELECT
    make_date($2::int, $3::int, 1)::timestamp AS month_start,
    (
      make_date($2::int, $3::int, 1)
      + INTERVAL '1 month'
    )::timestamp AS month_end
),

roster AS (
  SELECT DISTINCT h.user_id
  FROM assignment_history h
  JOIN teams t ON t.team_id = h.team_id
  CROSS JOIN bounds b
  WHERE t.campus_id = $1
    AND h.effective_from < b.month_end
    AND (
      h.effective_to IS NULL
      OR h.effective_to > b.month_start
    )
),

totals AS (
  SELECT
    r.user_id,
    COALESCE(SUM(p.points), 0)::int AS total_points

  FROM roster r
  CROSS JOIN bounds b

  LEFT JOIN point_entries p
    ON p.user_id = r.user_id
    AND p.effective_at >= b.month_start
    AND p.effective_at < b.month_end

    AND EXISTS (
      SELECT 1
      FROM assignment_history h
      JOIN teams ht ON ht.team_id = h.team_id
      WHERE h.user_id = p.user_id
        AND ht.campus_id = $1
        AND p.effective_at >= h.effective_from
        AND (
          h.effective_to IS NULL
          OR p.effective_at < h.effective_to
        )
    )

  GROUP BY r.user_id
)

SELECT
  DENSE_RANK() OVER (
    ORDER BY t.total_points DESC
  )::int AS "rank",

  u.user_id AS "userId",
  u.full_name AS "fullName",
  t.total_points AS "totalPoints"

FROM totals t
JOIN users u ON u.user_id = t.user_id

ORDER BY "rank", "fullName", "userId";
`;

const result = await pool.query(sql,[campusId,year,month]);
return result.rows;

}
