// Reads project users from PostgreSQL and normalizes roles for authorization.
const pool = require('../config/db')
const { recordAudit } = require('./audit.repository')

const userFields = `
  user_id AS id,
  clerk_user_id AS "clerkUserId",
  full_name AS name,
  email,
  LOWER(role) AS role,
  team_id AS "teamId",
  is_active AS "isActive",
  deleted_at AS "deletedAt"
`

const listUsers = async ({ deleted = false } = {}) => {
  const result = await pool.query(`
    SELECT ${userFields}
    FROM users
    WHERE (deleted_at IS NOT NULL) = $1
    ORDER BY user_id
  `, [deleted])

  return result.rows
}

const findUserByClerkId = async (clerkUserId) => {
  if (typeof clerkUserId !== 'string' || !clerkUserId) {
    return null
  }

  const result = await pool.query(
    `
      SELECT ${userFields}
      FROM users
      WHERE clerk_user_id = $1
    `,
    [clerkUserId],
  )

  return result.rows.length === 1 ? result.rows[0] : null
}

// Lists active members belonging to a team without exposing authentication fields.
const listTeamMembers = async (teamId) => {
  const result = await pool.query(
    `
      SELECT
        user_id AS id,
        full_name AS name,
        team_id AS "teamId"
      FROM users
      WHERE team_id = $1
        AND role = 'Member'
        AND is_active = TRUE
        AND deleted_at IS NULL
      ORDER BY user_id
    `,
    [teamId],
  )

  return result.rows
}

// Changes account status in a transaction while protecting the last active organizer.
const setUserActiveStatus = async (id, isActive, actorId) => {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    await client.query(
      'LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE',
    )

    const actor = await client.query(
      "SELECT user_id FROM users WHERE user_id = $1 AND role = 'Organizer' AND is_active = TRUE",
      [actorId],
    )
    if (!actor.rows.length) {
      await client.query('ROLLBACK')
      return { outcome: 'actor_forbidden' }
    }

    const targetResult = await client.query(
      `
        SELECT user_id, role, is_active, deleted_at
        FROM users
        WHERE user_id = $1
      `,
      [id],
    )

    const target = targetResult.rows[0]

    if (!target) {
      await client.query('ROLLBACK')
      return { outcome: 'not_found' }
    }

    if (target.deleted_at) {
      await client.query('ROLLBACK')
      return { outcome: 'deleted' }
    }

    if (isActive === false && target.role === 'Manager') {
      await client.query('LOCK TABLE teams IN SHARE ROW EXCLUSIVE MODE')
      const operationalTeam = await client.query(
        'SELECT team_id FROM teams WHERE manager_user_id = $1 AND is_operational = TRUE', [id],
      )
      if (operationalTeam.rows.length) {
        await client.query('ROLLBACK')
        return { outcome: 'manager_replacement_required' }
      }
    }

    if (
      isActive === false &&
      target.role === 'Organizer' &&
      target.is_active === true
    ) {
      const countResult = await client.query(`
        SELECT COUNT(*)::integer AS count
        FROM users
        WHERE role = 'Organizer'
          AND is_active = TRUE
      `)

      if (countResult.rows[0].count <= 1) {
        await client.query('ROLLBACK')
        return { outcome: 'last_organizer' }
      }
    }

    const result = await client.query(
      `
        UPDATE users
        SET is_active = $1
        WHERE user_id = $2
        RETURNING
          user_id AS id,
          full_name AS name,
          LOWER(role) AS role,
          is_active AS "isActive"
      `,
      [isActive, id],
    )

    if (target.is_active !== isActive) {
      await recordAudit(client, {
        actorId, action: 'change_user_status', entityName: 'users', entityId: id,
        before: { is_active: target.is_active }, after: { is_active: isActive },
        reason: isActive ? 'Organizer activated the account' : 'Organizer deactivated the account',
      })
    }

    await client.query('COMMIT')

    return {
      outcome: 'updated',
      user: result.rows[0],
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
module.exports = {
  listUsers,
  findUserByClerkId,
  listTeamMembers,
  setUserActiveStatus,
}
