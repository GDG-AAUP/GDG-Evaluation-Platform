// Replaces a team manager atomically, preserving membership history and audit records.
const { randomUUID } = require('node:crypto')
const pool = require('../config/db')

const replaceTeamManager = async (teamId, input, actorId) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Same users-first locking order as account creation and status changes.
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')
    await client.query('LOCK TABLE teams IN SHARE ROW EXCLUSIVE MODE')
    await client.query('LOCK TABLE assignment_history IN SHARE ROW EXCLUSIVE MODE')

    const reject = async (outcome) => {
      await client.query('ROLLBACK')
      return { outcome }
    }

    const actor = await client.query(
      "SELECT user_id FROM users WHERE user_id = $1 AND role = 'Organizer' AND is_active = TRUE",
      [actorId],
    )
    if (!actor.rows.length) return await reject('actor_forbidden')

    const teamResult = await client.query('SELECT * FROM teams WHERE team_id = $1', [teamId])
    const team = teamResult.rows[0]
    if (!team) return await reject('team_not_found')
    if (team.manager_user_id !== input.expectedManagerId) {
      return await reject('manager_changed')
    }
    if (input.managerId === team.manager_user_id) return await reject('invalid_replacement')

    const accounts = await client.query(
      'SELECT user_id, role, team_id, is_active, clerk_user_id FROM users WHERE user_id = ANY($1::integer[])',
      [[team.manager_user_id, input.managerId]],
    )
    const previous = accounts.rows.find((user) => user.user_id === team.manager_user_id)
    const replacement = accounts.rows.find((user) => user.user_id === input.managerId)
    if (!previous || previous.role !== 'Manager' || previous.team_id !== teamId) {
      return await reject('invalid_current_manager')
    }
    // Promote an existing linked, active member of this team; never move users between teams.
    if (!replacement || replacement.role !== 'Member' || replacement.team_id !== teamId ||
        replacement.is_active !== true || !replacement.clerk_user_id) {
      return await reject('invalid_replacement')
    }
    const otherTeam = await client.query(
      'SELECT team_id FROM teams WHERE manager_user_id = ANY($1::integer[]) AND team_id <> $2',
      [[previous.user_id, replacement.user_id], teamId],
    )
    if (otherTeam.rows.length) return await reject('invalid_replacement')

    const history = await client.query(
      'SELECT * FROM assignment_history WHERE user_id = ANY($1::integer[]) AND effective_to IS NULL',
      [[previous.user_id, replacement.user_id]],
    )
    for (const account of [previous, replacement]) {
      const current = history.rows.filter((row) => row.user_id === account.user_id)
      if (current.length !== 1 || current[0].team_id !== teamId || current[0].role_at_time !== account.role) {
        return await reject('history_conflict')
      }
    }

    const batchId = randomUUID()
    for (const [account, newRole] of [[previous, 'Member'], [replacement, 'Manager']]) {
      const current = history.rows.find((row) => row.user_id === account.user_id)
      // Preserve timestamp precision and avoid zero-length intervals in rapid replacements.
      const closed = await client.query(
        `UPDATE assignment_history
         SET effective_to = GREATEST(clock_timestamp()::timestamp, effective_from + INTERVAL '1 microsecond')
         WHERE assignment_id = $1 RETURNING effective_to::text AS boundary`,
        [current.assignment_id],
      )
      await client.query(
        `INSERT INTO assignment_history
           (user_id, team_id, role_at_time, effective_from, changed_by_user_id, reason)
         VALUES ($1, $2, $3, $4::timestamp, $5, $6)`,
        [account.user_id, teamId, newRole, closed.rows[0].boundary, actorId, input.reason],
      )
      await client.query('UPDATE users SET role = $1, is_active = TRUE WHERE user_id = $2',
        [newRole, account.user_id])
      await client.query(
        `INSERT INTO audit_logs
           (actor_user_id, action, entity_name, entity_id, old_values, new_values, reason, batch_id)
         VALUES ($1, 'replace_team_manager', 'users', $2, $3::json, $4::json, $5, $6)`,
        [actorId, String(account.user_id),
          JSON.stringify({ role: account.role, is_active: account.is_active, team_id: teamId }),
          JSON.stringify({ role: newRole, is_active: true, team_id: teamId }), input.reason, batchId],
      )
    }

    await client.query('UPDATE teams SET manager_user_id = $1 WHERE team_id = $2',
      [replacement.user_id, teamId])
    await client.query(
      `INSERT INTO audit_logs
         (actor_user_id, action, entity_name, entity_id, old_values, new_values, reason, batch_id)
       VALUES ($1, 'replace_team_manager', 'teams', $2, $3::json, $4::json, $5, $6)`,
      [actorId, String(teamId), JSON.stringify({ manager_user_id: previous.user_id }),
        JSON.stringify({ manager_user_id: replacement.user_id }), input.reason, batchId],
    )
    await client.query('COMMIT')
    return {
      outcome: 'replaced',
      data: {
        teamId,
        managerId: replacement.user_id,
        previousManagerId: previous.user_id,
        previousManagerRole: 'member',
        previousManagerIsActive: true,
        isOperational: team.is_operational,
      },
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

module.exports = { replaceTeamManager }
