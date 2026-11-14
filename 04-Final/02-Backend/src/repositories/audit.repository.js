// Writes caller-selected audit fields using the same database transaction as the action.
const recordAudit = async (client, entry) => {
  await client.query(
    `INSERT INTO audit_logs
       (actor_user_id, action, entity_name, entity_id, old_values, new_values, reason)
     VALUES ($1, $2, $3, $4, $5::json, $6::json, $7)`,
    [entry.actorId, entry.action, entry.entityName, String(entry.entityId),
      entry.before == null ? null : JSON.stringify(entry.before),
      entry.after == null ? null : JSON.stringify(entry.after), entry.reason],
  )
}

module.exports = { recordAudit }
