
import type { Pool } from 'pg';
import { checkPointRecipient } from './check-recipient';
type Actor = {
  id: number;
  role: 'manager' | 'organizer';
  teamId: number | null;
};

export async function reversePoint(
  pool: Pool,
  actor: Actor,
  entryId: string,
  reason: string
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

  const entry = await client.query(`
      SELECT
        entry_id::text AS id,
        user_id AS "userId",
        points,
        activity_name AS "activityName",
        activity_description AS "activityDescription",
        reverses_entry_id::text AS "reversesEntryId"
      FROM point_entries
      WHERE entry_id = $1
      FOR UPDATE;    
    `,[entryId]);
    const ans = entry.rows[0];

    if (!ans){
      await client.query(`ROLLBACK`);
      return {outcome:'entry_not_found' as const};
    }
    if (ans.reversesEntryId !== null){
      await client.query(`ROLLBACK`);
      return {outcome:'cannot_reverse_reversal' as const};
    }

    const access = await checkPointRecipient(
      client,
      actor,
      ans.userId
    );

    if (access === 'not_found') {
      await client.query(`ROLLBACK`);
      return {outcome: 'recipient_not_found' as const };
    }
    if (access === 'forbidden'){
      await client.query(`ROLLBACK`);
      return {outcome: 'forbidden' as const};
    }

    
  const existingReversal = await client.query(
    `SELECT entry_id::text AS id
    FROM point_entries
    WHERE reverses_entry_id = $1
    LIMIT 1`,
    [entryId]
  );

  if (existingReversal.rows.length > 0){
    await client.query(`ROLLBACK`);
    return { outcome: 'already_reversed' as const };
  }

  
  const inserted = await client.query(
    `INSERT INTO point_entries (
        user_id,
        performed_by_user_id,
        points,
        activity_name,
        reason,
        activity_description,
        reverses_entry_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING
        entry_id::text AS id,
        user_id AS "userId",
        performed_by_user_id AS "performedByUserId",
        points,
        activity_name AS "activityName",
        reason,
        activity_description AS "activityDescription",
        reverses_entry_id::text AS "reversesEntryId",
        effective_at AS "effectiveAt"`,
    [
      ans.userId,
      actor.id,
      -ans.points,
      ans.activityName,
      reason,
      ans.activityDescription,
      entryId
    ]
  );

  const reversal = inserted.rows[0];

  
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
        'reverse_point_entry',
        'point_entries',
        $2,
        NULL,
        $3::jsonb,
        $4
      )`,
    [
      actor.id,
      reversal.id,
      JSON.stringify(reversal),
      reason
    ]
  );

  await client.query(`COMMIT`);
  return {outcome:'reversed' as const, entry:reversal};




  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
