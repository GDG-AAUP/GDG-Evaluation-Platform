
import type { Pool } from 'pg';

export type AuditFilters = {
  actorId?: number;
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
};

export async function getAuditLogs(
  pool: Pool,
  filters: AuditFilters
) {
  const values: (string | number)[] = [];
  const conditions: string[] = [];

  if (filters.actorId !== undefined) {
    values.push(filters.actorId);
    conditions.push(`a.actor_user_id = $${values.length}`);
  }

  if (filters.action !== undefined) {
    values.push(filters.action);
    conditions.push(`a.action = $${values.length}`);
  }

  if (filters.entityType !== undefined) {
    values.push(filters.entityType);
    conditions.push(`a.entity_name = $${values.length}`);
  }

  if (filters.from !== undefined) {
    values.push(filters.from);
    conditions.push(`a.created_at >= $${values.length}::date`);
  }

  if (filters.to !== undefined) {
    values.push(filters.to);
    conditions.push(
      `a.created_at < ($${values.length}::date + INTERVAL '1 day')`
    );
  }

  const where = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM audit_logs a
     ${where}`,
    values
  );

  const offset = (filters.page - 1) * filters.pageSize;

  const result = await pool.query(
    `SELECT
       a.audit_id::text AS id,
       a.actor_user_id AS "actorId",
       u.full_name AS "actorName",
       a.action,
       a.entity_name AS "entityType",
       a.entity_id AS "entityId",
       a.old_values AS "oldValues",
       a.new_values AS "newValues",
       a.reason,
       a.batch_id AS "batchId",
       a.created_at AS "createdAt"
     FROM audit_logs a
     LEFT JOIN users u ON u.user_id = a.actor_user_id
     ${where}
     ORDER BY a.created_at DESC, a.audit_id DESC
     LIMIT $${values.length + 1}
     OFFSET $${values.length + 2}`,
    [...values, filters.pageSize, offset]
  );

  return {
    items: result.rows,
    total: Number(countResult.rows[0].total),
    page: filters.page,
    pageSize: filters.pageSize
  };
}
