// Updates organizer-managed account fields atomically with team assignments and audit history.
const { recordAudit } = require('./audit.repository')

const publicUser = user => ({
  id: user.user_id, name: user.full_name, email: user.email, role: user.role.toLowerCase(),
  teamId: user.team_id, isActive: user.is_active,
})

const updateUser = async (client, id, input, actorId, prepareEmailChange) => {
  await client.query('BEGIN')
  const reject = async outcome => { await client.query('ROLLBACK'); return { outcome } }
  try {
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')
    await client.query('LOCK TABLE teams IN SHARE ROW EXCLUSIVE MODE')
    await client.query('LOCK TABLE assignment_history IN SHARE ROW EXCLUSIVE MODE')
    const actor = await client.query("SELECT user_id FROM users WHERE user_id=$1 AND role='Organizer' AND is_active=TRUE", [actorId])
    if (!actor.rows.length) return await reject('actor_forbidden')
    const user = (await client.query('SELECT * FROM users WHERE user_id=$1', [id])).rows[0]
    if (!user) return await reject('not_found')
    if (user.deleted_at) return await reject('deleted')
    const next = {
      ...user,
      full_name: input.name ?? user.full_name,
      email: input.email ?? user.email,
      role: input.role ? input.role[0].toUpperCase() + input.role.slice(1) : user.role,
      team_id: Object.hasOwn(input, 'teamId') ? input.teamId : user.team_id,
      is_active: input.isActive ?? user.is_active,
    }
    if (next.role === 'Organizer') {
      if (Object.hasOwn(input, 'teamId') && input.teamId !== null) return await reject('invalid_assignment')
      next.team_id = null
    } else if (!next.team_id) return await reject('team_required')

    if (user.role === 'Organizer' && user.is_active && (next.role !== 'Organizer' || !next.is_active)) {
      const count = await client.query("SELECT count(*)::int AS n FROM users WHERE role='Organizer' AND is_active=TRUE")
      if (count.rows[0].n <= 1) return await reject('last_organizer')
    }
    const duplicate = await client.query('SELECT user_id FROM users WHERE lower(email)=lower($1) AND user_id<>$2', [next.email, id])
    if (duplicate.rows.length) return await reject('email_exists')
    const owned = (await client.query('SELECT * FROM teams WHERE manager_user_id=$1', [id])).rows
    const assignmentChanged = user.role !== next.role || user.team_id !== next.team_id
    if (owned.some(team => team.is_operational && (next.role !== 'Manager' || next.team_id !== team.team_id || !next.is_active))) {
      return await reject('manager_replacement_required')
    }
    let destination
    if (next.team_id !== null) {
      destination = (await client.query('SELECT * FROM teams WHERE team_id=$1', [next.team_id])).rows[0]
      if (!destination) return await reject('team_not_found')
      if (next.role === 'Manager') {
        if (destination.manager_user_id !== null && destination.manager_user_id !== id) return await reject('manager_exists')
        if (destination.is_operational && (!next.is_active || !user.clerk_user_id)) return await reject('invalid_manager')
      }
    }
    let history
    if (assignmentChanged) {
      history = (await client.query('SELECT * FROM assignment_history WHERE user_id=$1 AND effective_to IS NULL', [id])).rows
      if (history.length > 1 || (history.length === 1 &&
          (history[0].team_id !== user.team_id || history[0].role_at_time !== user.role))) return await reject('history_conflict')
      if (user.role !== 'Organizer' && history.length !== 1) return await reject('history_conflict')
    }
    const emailChanged = next.email.toLowerCase() !== user.email.toLowerCase()
    if (emailChanged) {
      const outcome = await prepareEmailChange(user, next)
      if (outcome) return await reject(outcome)
    }
    const changed = ['full_name', 'email', 'role', 'team_id', 'is_active'].some(key => user[key] !== next[key])
    if (!changed) { await client.query('COMMIT'); return { outcome: 'updated', user: publicUser(user), changed: false } }

    if (assignmentChanged) {
      let boundary
      if (history.length) {
        const close = await client.query(`UPDATE assignment_history
          SET effective_to=GREATEST(clock_timestamp()::timestamp,effective_from+INTERVAL '1 microsecond')
          WHERE assignment_id=$1 RETURNING effective_to::text AS boundary`, [history[0].assignment_id])
        boundary = close.rows[0].boundary
      } else {
        boundary = (await client.query('SELECT clock_timestamp()::timestamp::text AS boundary')).rows[0].boundary
      }
      if (next.role !== 'Organizer') await client.query(`INSERT INTO assignment_history
        (user_id,team_id,role_at_time,effective_from,changed_by_user_id,reason) VALUES($1,$2,$3,$4::timestamp,$5,$6)`,
      [id, next.team_id, next.role, boundary, actorId, input.reason])
    }
    for (const team of owned) {
      if (next.role !== 'Manager' || next.team_id !== team.team_id) {
        await client.query('UPDATE teams SET manager_user_id=NULL WHERE team_id=$1', [team.team_id])
        await recordAudit(client, { actorId, action: 'update_team_manager', entityName: 'teams', entityId: team.team_id,
          before: { manager_user_id: id }, after: { manager_user_id: null }, reason: input.reason })
      }
    }
    if (next.role === 'Manager' && destination.manager_user_id !== id) {
      await client.query('UPDATE teams SET manager_user_id=$1 WHERE team_id=$2', [id, next.team_id])
      await recordAudit(client, { actorId, action: 'update_team_manager', entityName: 'teams', entityId: next.team_id,
        before: { manager_user_id: destination.manager_user_id }, after: { manager_user_id: id }, reason: input.reason })
    }
    await client.query(`UPDATE users SET full_name=$1,email=$2,role=$3,team_id=$4,is_active=$5,
      invitation_status=CASE WHEN $6 AND clerk_user_id IS NULL THEN 'pending' ELSE invitation_status END,
      clerk_invitation_id=CASE WHEN $6 AND clerk_user_id IS NULL THEN NULL ELSE clerk_invitation_id END,
      invited_at=CASE WHEN $6 AND clerk_user_id IS NULL THEN NULL ELSE invited_at END,
      invited_by_user_id=CASE WHEN $6 AND clerk_user_id IS NULL THEN $8 ELSE invited_by_user_id END
      WHERE user_id=$7`, [next.full_name, next.email, next.role, next.team_id, next.is_active, emailChanged, id, actorId])
    await recordAudit(client, { actorId, action: 'update_user', entityName: 'users', entityId: id,
      before: publicUser(user), after: publicUser(next), reason: input.reason })
    await client.query('COMMIT')
    return { outcome: 'updated', user: publicUser(next), changed: true,
      invitationRequired: emailChanged && !user.clerk_user_id && next.is_active }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

module.exports = { updateUser }
