// Reads, creates, and changes team status in PostgreSQL using the API field format.
const pool = require('../config/db')
const { recordAudit } = require('./audit.repository')

const teamFields = `
  team_id AS id,
  campus_id AS "campusId",
  team_name AS name,
  manager_user_id AS "managerId",
  is_operational AS "isOperational",
  description
`

const listTeams = async ({ campusId } = {}) => {
  const result = await pool.query(
    `
      SELECT ${teamFields}
      FROM teams
      ${campusId === undefined ? '' : 'WHERE campus_id = $1'}
      ORDER BY team_id
    `,
    campusId === undefined ? [] : [campusId],
  )

  return result.rows
}

const findTeamById = async (id) => {
  const result = await pool.query(
    `
      SELECT ${teamFields}
      FROM teams
      WHERE team_id = $1
    `,
    [id],
  )

  return result.rows[0] ?? null
}

// Creates an inactive team and serializes writes to prevent duplicate names.
const createTeam = async (input, actorId) => {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')
    const actor = await client.query(
      "SELECT user_id FROM users WHERE user_id = $1 AND role = 'Organizer' AND is_active = TRUE",
      [actorId],
    )
    if (!actor.rows.length) {
      await client.query('ROLLBACK')
      return { outcome: 'actor_forbidden' }
    }

    const campusResult = await client.query(
      'SELECT campus_id FROM campuses WHERE campus_id = $1 FOR KEY SHARE',
      [input.campusId],
    )

    if (campusResult.rows.length === 0) {
      await client.query('ROLLBACK')
      return { outcome: 'campus_not_found' }
    }

    await client.query('LOCK TABLE teams IN SHARE ROW EXCLUSIVE MODE')

    const existing = await client.query(
      `
        SELECT team_id
        FROM teams
        WHERE campus_id = $1
          AND LOWER(BTRIM(team_name)) = LOWER($2)
      `,
      [input.campusId, input.name],
    )

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK')
      return { outcome: 'team_exists' }
    }

    const result = await client.query(
      `
        INSERT INTO teams (
          campus_id,
          team_name,
          manager_user_id,
          is_operational,
          description
        )
        VALUES ($1, $2, NULL, FALSE, $3)
        RETURNING ${teamFields}
      `,
      [input.campusId, input.name, input.description],
    )

    const team = result.rows[0]
    await recordAudit(client, {
      actorId, action: 'create_team', entityName: 'teams', entityId: team.id,
      before: null,
      after: { campus_id: team.campusId, team_name: team.name,
        manager_user_id: null, is_operational: false, description: team.description },
      reason: 'Organizer created an inactive team',
    })
    await client.query('COMMIT')
    return { outcome: 'created', team }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Changes team status atomically with manager validation and an audit record.
const setTeamOperationalStatus = async (teamId, isOperational, actorId) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Keep the same users-first lock order as manager replacement.
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')
    await client.query('LOCK TABLE teams IN SHARE ROW EXCLUSIVE MODE')

    const actor = await client.query(
      "SELECT user_id FROM users WHERE user_id = $1 AND role = 'Organizer' AND is_active = TRUE",
      [actorId],
    )
    if (!actor.rows.length) {
      await client.query('ROLLBACK')
      return { outcome: 'actor_forbidden' }
    }

    const found = await client.query('SELECT * FROM teams WHERE team_id = $1', [teamId])
    const team = found.rows[0]
    if (!team) {
      await client.query('ROLLBACK')
      return { outcome: 'not_found' }
    }

    if (isOperational) {
      const manager = await client.query(
        `SELECT user_id FROM users
         WHERE user_id = $1 AND role = 'Manager' AND team_id = $2 AND is_active = TRUE`,
        [team.manager_user_id, teamId],
      )
      if (!manager.rows.length) {
        await client.query('ROLLBACK')
        return { outcome: 'manager_required' }
      }
    }

    const updated = await client.query(
      `UPDATE teams SET is_operational = $1 WHERE team_id = $2 RETURNING ${teamFields}`,
      [isOperational, teamId],
    )
    if (team.is_operational !== isOperational) {
      await client.query(
        `INSERT INTO audit_logs
           (actor_user_id, action, entity_name, entity_id, old_values, new_values, reason)
         VALUES ($1, 'change_team_status', 'teams', $2, $3::json, $4::json, $5)`,
        [actorId, String(teamId), JSON.stringify({ is_operational: team.is_operational }),
          JSON.stringify({ is_operational: isOperational }),
          isOperational ? 'Organizer activated the team' : 'Organizer deactivated the team'],
      )
    }
    await client.query('COMMIT')
    return { outcome: 'updated', team: updated.rows[0] }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

module.exports = {
  listTeams,
  findTeamById,
  createTeam,
  setTeamOperationalStatus,
}
