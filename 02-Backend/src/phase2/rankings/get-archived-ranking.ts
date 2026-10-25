
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
