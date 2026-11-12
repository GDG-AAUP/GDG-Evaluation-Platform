import type { Pool, PoolClient } from 'pg';

import { getCampusRanking } from './get-campus-ranking';
import { getTeamRanking } from './get-team-ranking';

type Db = Pick<PoolClient, 'query'>;

/** Same advisory lock key as month publication, so a close and a correction never interleave. */
export const SNAPSHOT_LOCK_KEY = 73012;

export async function lockMonth(db: Db, year: number, month: number) {
  await db.query('SELECT pg_advisory_xact_lock($1::integer, $2::integer)', [SNAPSHOT_LOCK_KEY, year * 100 + month]);
}

export async function isMonthClosed(db: Db, year: number, month: number): Promise<boolean> {
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const result = await db.query(
    `SELECT 1 FROM audit_logs
     WHERE action = 'MONTHLY_RANKINGS_PUBLISHED' AND entity_name = 'monthly_rankings' AND entity_id = $1
     LIMIT 1`,
    [period]
  );
  return result.rows.length > 0;
}

export type RankingRevision = {
  rankingId: string;
  userId: number;
  scope: 'Team' | 'Campus';
  before: { totalPoints: number; rankPosition: number } | null;
  after: { totalPoints: number; rankPosition: number };
};

/**
 * Recomputes the published Team and Campus rankings touched by a change to a closed month
 * (DENSE_RANK over that month's points only) and rewrites only the rows whose total or rank
 * moved. Each rewritten row gets last_revised_at and an audit row with its exact before/after.
 * Runs inside the caller's transaction.
 */
export async function reviseClosedMonth(
  db: Db,
  target: { year: number; month: number; teamId: number; campusId: number },
  actorId: number,
  reason: string,
  batchId: string
): Promise<RankingRevision[]> {
  const { year, month, teamId, campusId } = target;
  const pool = db as unknown as Pool;
  const scopes: { scope: 'Team' | 'Campus'; teamId: number | null; rows: { userId: number; rank: number; totalPoints: number }[] }[] = [
    { scope: 'Team', teamId, rows: await getTeamRanking(pool, teamId, year, month) },
    { scope: 'Campus', teamId: null, rows: await getCampusRanking(pool, campusId, year, month) }
  ];

  const revisions: RankingRevision[] = [];
  for (const { scope, teamId: scopeTeam, rows } of scopes) {
    const existing = await db.query(
      `SELECT ranking_id::text AS id, user_id AS "userId", total_points AS total, rank_position AS rank
       FROM monthly_rankings
       WHERE year = $1 AND month = $2 AND ranking_scope = $3 AND campus_id = $4
         AND COALESCE(team_id, 0) = COALESCE($5::int, 0)
       FOR UPDATE`,
      [year, month, scope, campusId, scopeTeam]
    );
    const byUser = new Map(existing.rows.map((row) => [row.userId as number, row]));

    for (const row of rows) {
      const old = byUser.get(row.userId);
      const after = { totalPoints: row.totalPoints, rankPosition: row.rank };
      let rankingId: string;
      if (old) {
        if (old.total === row.totalPoints && old.rank === row.rank) continue;
        await db.query(
          `UPDATE monthly_rankings
           SET total_points = $1, rank_position = $2, last_revised_at = CURRENT_TIMESTAMP
           WHERE ranking_id = $3`,
          [row.totalPoints, row.rank, old.id]
        );
        rankingId = old.id;
      } else {
        const inserted = await db.query(
          `INSERT INTO monthly_rankings
             (user_id, ranking_scope, team_id, campus_id, year, month, total_points, rank_position,
              archived_at, last_revised_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING ranking_id::text AS id`,
          [row.userId, scope, scopeTeam, campusId, year, month, row.totalPoints, row.rank]
        );
        rankingId = inserted.rows[0].id;
      }
      const before = old ? { totalPoints: old.total as number, rankPosition: old.rank as number } : null;
      const context = { userId: row.userId, scope, teamId: scopeTeam, campusId, year, month };
      await db.query(
        `INSERT INTO audit_logs
           (actor_user_id, action, entity_name, entity_id, old_values, new_values, reason, batch_id)
         VALUES ($1, 'MONTHLY_RANKING_REVISED', 'monthly_rankings', $2, $3::jsonb, $4::jsonb, $5, $6)`,
        [actorId, rankingId, before ? JSON.stringify({ ...context, ...before }) : null,
          JSON.stringify({ ...context, ...after }), reason, batchId]
      );
      revisions.push({ rankingId, userId: row.userId, scope, before, after });
    }
  }
  return revisions;
}
