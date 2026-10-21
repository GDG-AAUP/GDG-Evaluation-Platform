// Soft-deletes and restores accounts with manager protection, assignment history and atomic auditing.
const { withInvitationLock } = require('./invitation-lifecycle.repository')
const { recordAudit } = require('./audit.repository')

const accountView = user => ({
  id: user.user_id, name: user.full_name, email: user.email, role: user.role.toLowerCase(),
  teamId: user.team_id, isActive: user.is_active, deletedAt: user.deleted_at,
})

const changeDeletion = async (id, actorId, reason, restoring) => withInvitationLock(id, async client => {
  await client.query('BEGIN')
  const reject = async outcome => { await client.query('ROLLBACK'); return { outcome } }
  try {
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')
    await client.query('LOCK TABLE teams IN SHARE ROW EXCLUSIVE MODE')
    await client.query('LOCK TABLE assignment_history IN SHARE ROW EXCLUSIVE MODE')
    const actor = await client.query("SELECT user_id FROM users WHERE user_id=$1 AND role='Organizer' AND is_active=TRUE AND deleted_at IS NULL", [actorId])
    if (!actor.rows.length) return await reject('actor_forbidden')
    const user = (await client.query('SELECT * FROM users WHERE user_id=$1', [id])).rows[0]
    if (!user) return await reject('not_found')
    if (restoring && !user.deleted_at) return await reject('not_deleted')
    if (!restoring && user.deleted_at) {
      await client.query('COMMIT')
      return { outcome: 'deleted', user: accountView(user), changed: false }
    }
    const owned = (await client.query('SELECT * FROM teams WHERE manager_user_id=$1', [id])).rows
    let team
    if (!restoring) {
      if (owned.some(item => item.is_operational)) return await reject('manager_replacement_required')
      if (user.role === 'Organizer' && user.is_active) {
        const others = await client.query("SELECT count(*)::int AS n FROM users WHERE role='Organizer' AND is_active=TRUE AND deleted_at IS NULL AND user_id<>$1", [id])
        if (!others.rows[0].n) return await reject('last_organizer')
      }
    } else if (user.role !== 'Organizer') {
      team = (await client.query('SELECT * FROM teams WHERE team_id=$1', [user.team_id])).rows[0]
      if (!team) return await reject('team_not_found')
      if (user.role === 'Manager' && (team.is_operational || (team.manager_user_id !== null && team.manager_user_id !== id))) {
        return await reject('manager_restore_conflict')
      }
    }
    const history = (await client.query('SELECT * FROM assignment_history WHERE user_id=$1 AND effective_to IS NULL', [id])).rows
    if (restoring) {
      if (history.length) return await reject('history_conflict')
    } else {
      if (history.length > 1 || (history.length && (history[0].team_id !== user.team_id || history[0].role_at_time !== user.role))) return await reject('history_conflict')
      if (user.role !== 'Organizer' && history.length !== 1) return await reject('history_conflict')
    }

    if (!restoring) {
      for (const assignment of history) await client.query(`UPDATE assignment_history
        SET effective_to=GREATEST(clock_timestamp()::timestamp,effective_from+INTERVAL '1 microsecond')
        WHERE assignment_id=$1`, [assignment.assignment_id])
      for (const previous of owned) {
        await client.query('UPDATE teams SET manager_user_id=NULL WHERE team_id=$1', [previous.team_id])
        await recordAudit(client, { actorId, action: 'delete_user_manager_assignment', entityName: 'teams', entityId: previous.team_id,
          before: { manager_user_id: id }, after: { manager_user_id: null }, reason })
      }
    } else if (user.role !== 'Organizer') {
      await client.query(`INSERT INTO assignment_history(user_id,team_id,role_at_time,effective_from,changed_by_user_id,reason)
        SELECT $1::integer,$2::integer,$3::varchar,GREATEST(clock_timestamp()::timestamp,MAX(effective_to)),$4::integer,$5::text
        FROM assignment_history WHERE user_id=$1`, [id, user.team_id, user.role, actorId, reason])
      if (user.role === 'Manager' && team.manager_user_id !== id) {
        await client.query('UPDATE teams SET manager_user_id=$1 WHERE team_id=$2', [id, user.team_id])
        await recordAudit(client, { actorId, action: 'restore_user_manager_assignment', entityName: 'teams', entityId: user.team_id,
          before: { manager_user_id: team.manager_user_id }, after: { manager_user_id: id }, reason })
      }
    }
    const result = await client.query(`UPDATE users SET is_active=FALSE,
      deleted_at=CASE WHEN $2 THEN NULL ELSE clock_timestamp() END,
      deleted_by_user_id=CASE WHEN $2 THEN NULL ELSE $3::integer END WHERE user_id=$1 RETURNING *`, [id, restoring, actorId])
    const updated = result.rows[0]
    await recordAudit(client, { actorId, action: restoring ? 'restore_user' : 'delete_user', entityName: 'users', entityId: id,
      before: accountView(user), after: accountView(updated), reason })
    await client.query('COMMIT')
    return { outcome: restoring ? 'restored' : 'deleted', user: accountView(updated), changed: true }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
})

module.exports = {
  deleteUser: (id, actorId, reason) => changeDeletion(id, actorId, reason, false),
  restoreUser: (id, actorId, reason) => changeDeletion(id, actorId, reason, true),
}
