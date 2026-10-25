
import type { Pool } from 'pg';
import { previewMonthlySnapshot } from './preview-monthly-snapshot';

export async function publishMonthlySnapshot(
  pool: Pool,
  year: number,
  month: number,
  actorUserId: number,
  getPreview: typeof previewMonthlySnapshot = previewMonthlySnapshot
) {
  if (!Number.isInteger(year) || year < 2000 || year > 32767 ||
      !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('INVALID_SNAPSHOT_PERIOD');
  }

  if (!Number.isInteger(actorUserId) || actorUserId <= 0) {
    throw new Error('INVALID_ACTOR');
  }

  const client = await pool.connect();
  const period = `${year}-${String(month).padStart(2, '0')}`;

  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

    await client.query(
      'SELECT pg_advisory_xact_lock(73012, $1::integer)',
      [year * 100 + month]
    );

    const actor = await client.query(
      `SELECT role, is_active
       FROM users WHERE user_id = $1`,
      [actorUserId]
    );

    if (
      actor.rows[0]?.role !== 'Organizer' ||
      actor.rows[0]?.is_active !== true
    ) {
      throw new Error('FORBIDDEN_SNAPSHOT_PUBLICATION');
    }

    const published = await client.query(
      `SELECT 1 FROM audit_logs
       WHERE action = 'MONTHLY_RANKINGS_PUBLISHED'
         AND entity_name = 'monthly_rankings'
         AND entity_id = $1
       LIMIT 1`,
      [period]
    );

    if (published.rows.length > 0) {
      throw new Error('MONTH_ALREADY_PUBLISHED');
    }

    const existing = await client.query(
      `SELECT 1 FROM monthly_rankings
       WHERE year = $1 AND month = $2
       LIMIT 1`,
      [year, month]
    );

    if (existing.rows.length > 0) {
      throw new Error('EXISTING_SNAPSHOT_ROWS');
    }

    // All ranking reads use the same transaction connection.
    const preview = await getPreview(
      client as unknown as Pool,
      year,
      month
    );

    if (preview.hasConflicts) {
      throw new Error('SNAPSHOT_CONFLICTS');
    }

    for (const row of preview.candidates) {
      await client.query(
        `INSERT INTO monthly_rankings (
          user_id, ranking_scope, team_id, campus_id,
          year, month, total_points, rank_position,
          archived_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                CURRENT_TIMESTAMP)`,
        [
          row.userId,
          row.rankingScope,
          row.teamId,
          row.campusId,
          row.year,
          row.month,
          row.totalPoints,
          row.rankPosition
        ]
      );
    }

    const summary = {
      year,
      month,
      rowCount: preview.candidates.length,
      emptyMonth: preview.emptyMonth
    };

    await client.query(
      `INSERT INTO audit_logs (
        actor_user_id, action, entity_name,
        entity_id, new_values, reason
      )
      VALUES (
        $1, 'MONTHLY_RANKINGS_PUBLISHED',
        'monthly_rankings', $2, $3::jsonb,
        'Monthly ranking snapshot publication'
      )`,
      [
        actorUserId,
        period,
        JSON.stringify(summary)
      ]
    );

    await client.query('COMMIT');

    return {
      published: true,
      ...summary
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    client.release();
  }
}
