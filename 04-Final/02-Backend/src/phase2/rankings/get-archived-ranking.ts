
import type { Pool } from 'pg';
import type { RankingQuery } from './validate-ranking';

export type ArchivedRankingRow = {
  rank: number;
  userId: number;
  fullName: string;
  totalPoints: number;
};

export async function getArchivedRanking(
  pool: Pool,
  query: RankingQuery
): Promise<ArchivedRankingRow[]> {

  // Both campuses: the published Campus snapshots of that month, added up per person and
  // dense-ranked again; the campus shown is the one where the person earned the most.
  if (query.scope === 'All') {
    const combined = await pool.query(
      `WITH rows AS (
         SELECT r.user_id, r.campus_id, r.total_points
         FROM monthly_rankings r
         WHERE r.ranking_scope = 'Campus' AND r.team_id IS NULL
           AND r.year = $1 AND r.month = $2 AND r.archived_at IS NOT NULL
       ),
       per_user AS (
         SELECT user_id, SUM(total_points)::int AS total_points,
                (ARRAY_AGG(campus_id ORDER BY total_points DESC, campus_id))[1] AS campus_id
         FROM rows GROUP BY user_id
       )
       SELECT DENSE_RANK() OVER (ORDER BY p.total_points DESC)::int AS "rank",
              u.user_id AS "userId", u.full_name AS "fullName", p.total_points AS "totalPoints",
              c.campus_id AS "campusId", c.campus_name AS "campusName"
       FROM per_user p
       JOIN users u ON u.user_id = p.user_id
       JOIN campuses c ON c.campus_id = p.campus_id
       WHERE u.role IN ('Member', 'Manager') AND u.deleted_at IS NULL
       ORDER BY "rank", "fullName", "userId"`,
      [query.year, query.month]
    );
    return combined.rows;
  }

  // 1. Store the SQL below in a template string.
  const sql = `
SELECT
  r.rank_position AS "rank",
  r.user_id AS "userId",
  u.full_name AS "fullName",
  r.total_points AS "totalPoints"

FROM monthly_rankings r
JOIN users u ON u.user_id = r.user_id

WHERE r.ranking_scope = $1
  AND r.year = $2
  AND r.month = $3
  AND r.archived_at IS NOT NULL
  AND u.role IN ('Member', 'Manager')
  AND u.deleted_at IS NULL

  AND (
    ($1 = 'Team' AND r.team_id = $4)
    OR
    (
      $1 = 'Campus'
      AND r.team_id IS NULL
      AND r.campus_id = $5
    )
  )

ORDER BY
  r.rank_position,
  u.full_name,
  u.user_id;
`;

const result = await pool.query(sql,[query.scope,query.year,query.month,query.teamId,query.campusId]);
return result.rows;
}
