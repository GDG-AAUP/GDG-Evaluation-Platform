
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { CreatePointInput } from './validate-point';

/** Identical {actor, recipient, points, activity, reason} inside this window is a double submission. */
export const DUPLICATE_WINDOW_SECONDS = 10;

export const requestHash = (input: CreatePointInput) => createHash('sha256').update(JSON.stringify([
  input.userId, input.points, input.activityName, input.reason, input.activityDescription
])).digest('hex');
import { checkPointRecipient } from './check-recipient';
type Actor = {
  id: number;
  role: 'manager' | 'organizer';
  teamId: number | null;
};

export async function createPoint(
  pool: Pool,
  actor: Actor,
  input: CreatePointInput,
  idempotencyKey: string | null = null
) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      'LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE'
    );

    await client.query(
      'LOCK TABLE teams IN SHARE ROW EXCLUSIVE MODE'
    );

    const result = await client.query(`
      SELECT
    LOWER(role) AS role,
    is_active AS "isActive",
    deleted_at AS "deletedAt"
    FROM users
    WHERE user_id = $1;
    `,[actor.id]);
  const dbActor = result.rows[0];

  if (
    !dbActor ||
    dbActor.isActive !== true ||
    dbActor.deletedAt != null ||
    (dbActor.role !== 'manager' && dbActor.role !== 'organizer') ||
    dbActor.role !== actor.role
  ) {
    await client.query('ROLLBACK');
    return { outcome: 'forbidden' as const };
  }

  // One actor's point submissions are serialized, so a double click cannot pass both checks below.
  await client.query('SELECT pg_advisory_xact_lock(73013, $1::integer)', [actor.id]);

  if (idempotencyKey !== null) {
    const seen = await client.query(
      `SELECT k.request_hash AS hash, p.entry_id::text AS id, p.user_id AS "userId",
              p.performed_by_user_id AS "performedByUserId", p.points, p.activity_name AS "activityName",
              p.reason, p.activity_description AS "activityDescription", p.effective_at AS "effectiveAt"
       FROM point_idempotency_keys k JOIN point_entries p ON p.entry_id = k.entry_id
       WHERE k.actor_user_id = $1 AND k.idempotency_key = $2`,
      [actor.id, idempotencyKey]
    );
    if (seen.rows.length) {
      await client.query('ROLLBACK');
      const { hash, ...entry } = seen.rows[0];
      return hash === requestHash(input)
        ? { outcome: 'replayed' as const, entry }
        : { outcome: 'idempotency_key_reused' as const };
    }
  }

  const access = await checkPointRecipient(
    client,
    actor,
    input.userId
  );

  if (access === 'not_found') {
    await client.query(`ROLLBACK`);
    return {outcome: 'recipient_not_found' as const };
  }
  if (access === 'forbidden'){
    await client.query(`ROLLBACK`);
    return {outcome: 'forbidden' as const};
  }

  const duplicate = await client.query(
    `SELECT entry_id::text AS id FROM point_entries
     WHERE performed_by_user_id = $1 AND user_id = $2 AND points = $3
       AND activity_name = $4 AND reason = $5 AND reverses_entry_id IS NULL
       AND created_at > clock_timestamp() - make_interval(secs => $6)
     ORDER BY entry_id DESC LIMIT 1`,
    [actor.id, input.userId, input.points, input.activityName, input.reason, DUPLICATE_WINDOW_SECONDS]
  );
  if (duplicate.rows.length) {
    await client.query('ROLLBACK');
    return { outcome: 'duplicate' as const, entryId: duplicate.rows[0].id as string };
  }

  const inserted = await client.query(
    `INSERT INTO point_entries (
        user_id,
        performed_by_user_id,
        points,
        activity_name,
        reason,
        activity_description
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        entry_id::text AS id,
        user_id AS "userId",
        performed_by_user_id AS "performedByUserId",
        points,
        activity_name AS "activityName",
        reason,
        activity_description AS "activityDescription",
        effective_at AS "effectiveAt"`,
    [
      input.userId,
      actor.id,
      input.points,
      input.activityName,
      input.reason,
      input.activityDescription
    ]
  );
  const entry = inserted.rows[0];
  if (idempotencyKey !== null) {
    await client.query(
      `INSERT INTO point_idempotency_keys (actor_user_id, idempotency_key, request_hash, entry_id)
       VALUES ($1, $2, $3, $4)`,
      [actor.id, idempotencyKey, requestHash(input), entry.id]
    );
  }

  await client.query(
    `INSERT INTO audit_logs (
        actor_user_id,
        action,
        entity_name,
        entity_id,
        old_values,
        new_values,
        reason
      )
      VALUES (
        $1,
        'create_point_entry',
        'point_entries',
        $2,
        NULL,
        $3::jsonb,
        $4
      )`,
    [
      actor.id,
      entry.id,
      JSON.stringify(entry),
      input.reason
    ]
  );

  await client.query(`COMMIT`);
  return {outcome: 'created' as const,entry}

  

  
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
