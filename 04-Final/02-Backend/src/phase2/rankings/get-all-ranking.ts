
import type { Pool } from 'pg';

export type AllRankingRow = {
  rank: number;
  userId: number;
  fullName: string;
  totalPoints: number;
  campusId: number;
  campusName: string;
};

/**
 * Both campuses together for one month: every Member and Manager who belonged to a team of either
 * campus during the month, ranked by the points earned while in a team that month (DENSE_RANK:
 * 1, 1, 2). Each row carries the campus of the person's latest assignment in that month.
 */
export async function getAllRanking(pool: Pool, year: number, month: number): Promise<AllRankingRow[]> {
  const sql = `
WITH bounds AS (
  SELECT
    make_date($1::int, $2::int, 1)::timestamp AT TIME ZONE 'Asia/Hebron' AS month_start,
    (make_date($1::int, $2::int, 1) + INTERVAL '1 month')::timestamp AT TIME ZONE 'Asia/Hebron' AS month_end
),

-- The latest assignment of each person in the month decides the campus shown.
roster AS (
  SELECT DISTINCT ON (h.user_id) h.user_id, t.campus_id
  FROM assignment_history h
  JOIN teams t ON t.team_id = h.team_id
  JOIN users ru ON ru.user_id = h.user_id
  CROSS JOIN bounds b
  WHERE h.role_at_time IN ('Member', 'Manager')
    AND ru.role IN ('Member', 'Manager')
    AND ru.deleted_at IS NULL
    AND h.effective_from < b.month_end
    AND (h.effective_to IS NULL OR h.effective_to > b.month_start)
  ORDER BY h.user_id, h.effective_from DESC
),

totals AS (
  SELECT r.user_id, r.campus_id, COALESCE(SUM(p.points), 0)::int AS total_points
  FROM roster r
  CROSS JOIN bounds b
  LEFT JOIN point_entries p
    ON p.user_id = r.user_id
    AND p.effective_at >= b.month_start
    AND p.effective_at < b.month_end
    AND EXISTS (
      SELECT 1 FROM assignment_history h
      WHERE h.user_id = p.user_id
        AND h.role_at_time IN ('Member', 'Manager')
        AND p.effective_at >= h.effective_from
        AND (h.effective_to IS NULL OR p.effective_at < h.effective_to)
    )
  GROUP BY r.user_id, r.campus_id
)

SELECT
  DENSE_RANK() OVER (ORDER BY t.total_points DESC)::int AS "rank",
  u.user_id AS "userId",
  u.full_name AS "fullName",
  t.total_points AS "totalPoints",
  c.campus_id AS "campusId",
  c.campus_name AS "campusName"
FROM totals t
JOIN users u ON u.user_id = t.user_id
JOIN campuses c ON c.campus_id = t.campus_id
ORDER BY "rank", "fullName", "userId";
`;
  const result = await pool.query(sql, [year, month]);
  return result.rows;
}
