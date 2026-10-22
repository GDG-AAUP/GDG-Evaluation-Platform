// Creates pending project accounts and records their initial team assignment.
const pool = require('../config/db')
const { recordAudit } = require('./audit.repository')

const createPendingUser = async (input, actorId) => {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    await client.query(
      'LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE',
    )

    const actorResult = await client.query(
      `
        SELECT user_id
        FROM users
        WHERE user_id = $1
          AND role = 'Organizer'
          AND is_active = TRUE
      `,
      [actorId],
    )

    if (actorResult.rows.length === 0) {
      await client.query('ROLLBACK')
      return { outcome: 'actor_forbidden' }
    }

    const existing = await client.query(
      'SELECT user_id FROM users WHERE LOWER(email) = $1',
      [input.email],
    )

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK')
      return { outcome: 'email_exists' }
    }

    const teamResult = await client.query(
      `
        SELECT team_id, manager_user_id
        FROM teams
        WHERE team_id = $1
        FOR UPDATE
      `,
      [input.teamId],
    )

    const team = teamResult.rows[0]

    if (!team) {
      await client.query('ROLLBACK')
      return { outcome: 'team_not_found' }
    }

    if (input.role === 'manager' && team.manager_user_id !== null) {
      await client.query('ROLLBACK')
      return { outcome: 'manager_exists' }
    }

    const databaseRole = input.role === 'manager'
      ? 'Manager'
      : 'Member'

    const result = await client.query(
      `
        INSERT INTO users (
          full_name,
          email,
          role,
          team_id,
          is_active,
          invitation_status,
          invited_by_user_id
        )
        VALUES ($1, $2, $3, $4, TRUE, 'pending', $5)
        RETURNING
          user_id AS id,
          full_name AS name,
          email,
          LOWER(role) AS role,
          team_id AS "teamId",
          invitation_status AS "invitationStatus"
      `,
      [
        input.name,
        input.email,
        databaseRole,
        input.teamId,
        actorId,
      ],
    )

    const user = result.rows[0]

    if (input.role === 'manager') {
      await client.query(
        'UPDATE teams SET manager_user_id = $1 WHERE team_id = $2',
        [user.id, input.teamId],
      )
    }

    await client.query(
      `
        INSERT INTO assignment_history (
          user_id,
          team_id,
          role_at_time,
          effective_from,
          changed_by_user_id,
          reason
        )
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5)
      `,
      [
        user.id,
        input.teamId,
        databaseRole,
        actorId,
        'Initial account creation',
      ],
    )

    await recordAudit(client, {
      actorId, action: 'create_user', entityName: 'users', entityId: user.id,
      before: null,
      after: { full_name: user.name, email: user.email, role: databaseRole,
        team_id: user.teamId, is_active: true, invitation_status: 'pending' },
      reason: 'Organizer created an account pending invitation',
    })
    if (input.role === 'manager') {
      await recordAudit(client, {
        actorId, action: 'assign_team_manager', entityName: 'teams', entityId: input.teamId,
        before: { manager_user_id: null }, after: { manager_user_id: user.id },
        reason: 'Initial manager assignment during account creation',
      })
    }

    await client.query('COMMIT')

    return { outcome: 'created', user }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

module.exports = { createPendingUser }
