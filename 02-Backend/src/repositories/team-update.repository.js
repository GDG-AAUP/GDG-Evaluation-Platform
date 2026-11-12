// Renames a team and assigns or removes its manager in one transaction, keeping
// "one current manager per team, one current team per manager", assignment history and audit rows.
const pool = require('../config/db')
const { recordAudit } = require('./audit.repository')

const teamFields = `team_id AS id, campus_id AS "campusId", team_name AS name,
  manager_user_id AS "managerId", is_operational AS "isOperational", description`

// Closes the user's single open assignment and opens the next one at the same instant.
const moveAssignment = async (client, open, userId, teamId, role, actorId, reason) => {
  const closed = await client.query(
    `UPDATE assignment_history
     SET effective_to = GREATEST(clock_timestamp()::timestamp, effective_from + INTERVAL '1 microsecond')
     WHERE assignment_id = $1 RETURNING effective_to::text AS boundary`,
    [open.assignment_id],
  )
  await client.query(
    `INSERT INTO assignment_history (user_id, team_id, role_at_time, effective_from, changed_by_user_id, reason)
     VALUES ($1, $2, $3, $4::timestamp, $5, $6)`,
    [userId, teamId, role, closed.rows[0].boundary, actorId, reason],
  )
}

// The one open history row of a Manager/Member, or null when history is inconsistent with the account.
const openAssignment = async (client, user) => {
  const rows = (await client.query(
    'SELECT * FROM assignment_history WHERE user_id = $1 AND effective_to IS NULL', [user.user_id],
  )).rows
  if (rows.length !== 1 || rows[0].team_id !== user.team_id || rows[0].role_at_time !== user.role) return null
  return rows[0]
}

const updateTeam = async (teamId, input, actorId) => {
  const client = await pool.connect()
  const reject = async (outcome) => { await client.query('ROLLBACK'); return { outcome } }
  try {
    await client.query('BEGIN')
    // Same users → teams → history lock order as account edits and manager replacement.
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')
    await client.query('LOCK TABLE teams IN SHARE ROW EXCLUSIVE MODE')
    await client.query('LOCK TABLE assignment_history IN SHARE ROW EXCLUSIVE MODE')

    const actor = await client.query(
      "SELECT user_id FROM users WHERE user_id = $1 AND role = 'Organizer' AND is_active = TRUE", [actorId],
    )
    if (!actor.rows.length) return await reject('actor_forbidden')
    const team = (await client.query('SELECT * FROM teams WHERE team_id = $1 FOR UPDATE', [teamId])).rows[0]
    if (!team) return await reject('team_not_found')

    const before = { team_name: team.team_name, manager_user_id: team.manager_user_id }
    const after = { ...before }

    if (input.name !== undefined && input.name !== team.team_name) {
      const duplicate = await client.query(
        `SELECT team_id FROM teams
         WHERE campus_id = $1 AND LOWER(BTRIM(team_name)) = LOWER($2) AND team_id <> $3`,
        [team.campus_id, input.name, teamId],
      )
      if (duplicate.rows.length) return await reject('team_exists')
      after.team_name = input.name
    }

    const managerChanges = Object.hasOwn(input, 'managerId') && input.managerId !== team.manager_user_id
    if (managerChanges && input.managerId === null) {
      // Removing the manager: an operational team must keep one (deactivate it first).
      if (team.is_operational) return await reject('operational_team_needs_manager')
      const current = (await client.query('SELECT * FROM users WHERE user_id = $1', [team.manager_user_id])).rows[0]
      await client.query('UPDATE teams SET manager_user_id = NULL WHERE team_id = $1', [teamId])
      // The former manager stays in the team as a Member (same rule as manager replacement).
      if (current && current.role === 'Manager' && current.team_id === teamId && !current.deleted_at) {
        const open = await openAssignment(client, current)
        if (!open) return await reject('history_conflict')
        await moveAssignment(client, open, current.user_id, teamId, 'Member', actorId, input.reason)
        await client.query("UPDATE users SET role = 'Member' WHERE user_id = $1", [current.user_id])
        await recordAudit(client, { actorId, action: 'update_user', entityName: 'users', entityId: current.user_id,
          before: { role: 'manager', teamId }, after: { role: 'member', teamId }, reason: input.reason })
      }
      after.manager_user_id = null
    } else if (managerChanges) {
      // Each team has at most one current manager: remove the current one before assigning another.
      if (team.manager_user_id !== null) return await reject('manager_exists')
      const candidate = (await client.query('SELECT * FROM users WHERE user_id = $1', [input.managerId])).rows[0]
      if (!candidate || candidate.deleted_at || candidate.role !== 'Manager' || !candidate.is_active) {
        return await reject('invalid_manager')
      }
      // Each manager manages one team: leaving an operational team would leave it without a manager.
      const owned = (await client.query('SELECT * FROM teams WHERE manager_user_id = $1', [candidate.user_id])).rows[0]
      if (owned && owned.is_operational) return await reject('manager_replacement_required')
      const open = await openAssignment(client, candidate)
      if (!open) return await reject('history_conflict')

      if (owned) {
        await client.query('UPDATE teams SET manager_user_id = NULL WHERE team_id = $1', [owned.team_id])
        await recordAudit(client, { actorId, action: 'update_team_manager', entityName: 'teams', entityId: owned.team_id,
          before: { manager_user_id: candidate.user_id }, after: { manager_user_id: null }, reason: input.reason })
      }
      if (candidate.team_id !== teamId) {
        const from = (await client.query('SELECT campus_id FROM teams WHERE team_id = $1', [candidate.team_id])).rows[0]
        await moveAssignment(client, open, candidate.user_id, teamId, 'Manager', actorId, input.reason)
        await client.query('UPDATE users SET team_id = $1 WHERE user_id = $2', [teamId, candidate.user_id])
        await recordAudit(client, { actorId, action: 'update_user', entityName: 'users', entityId: candidate.user_id,
          before: { role: 'manager', teamId: candidate.team_id, campusId: from ? from.campus_id : null },
          after: { role: 'manager', teamId, campusId: team.campus_id }, reason: input.reason })
      }
      after.manager_user_id = candidate.user_id
    }

    const changed = after.team_name !== before.team_name || after.manager_user_id !== before.manager_user_id
    const updated = await client.query(
      `UPDATE teams SET team_name = $1, manager_user_id = $2 WHERE team_id = $3 RETURNING ${teamFields}`,
      [after.team_name, after.manager_user_id, teamId],
    )
    if (changed) {
      await recordAudit(client, { actorId, action: 'update_team', entityName: 'teams', entityId: teamId,
        before, after, reason: input.reason })
    }
    await client.query('COMMIT')
    return { outcome: 'updated', team: updated.rows[0], changed }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

module.exports = { updateTeam }
