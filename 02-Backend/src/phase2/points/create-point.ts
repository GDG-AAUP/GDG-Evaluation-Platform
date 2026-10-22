
import type { Pool } from 'pg';
import type { CreatePointInput } from './validate-point';
import { checkPointRecipient } from './check-recipient';
type Actor = {
  id: number;
  role: 'manager' | 'organizer';
  teamId: number | null;
};

export async function createPoint(
  pool: Pool,
  actor: Actor,
  input: CreatePointInput
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
