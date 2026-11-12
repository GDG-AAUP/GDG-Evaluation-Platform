// Self-registration requests: recorded on first sign-in, decided by an organizer.
// Approval creates the project account in the same transaction that closes the request.
const pool = require('../config/db')
const { recordAudit } = require('./audit.repository')

const requestFields = `
  r.request_id::int AS id, r.full_name AS name, r.email,
  r.registration_status AS status, r.rejection_reason AS "rejectionReason",
  r.requested_at AS "requestedAt", r.decided_at AS "decidedAt",
  r.approved_user_id AS "approvedUserId", r.notification_status AS "notificationStatus"`

const findByClerkId = async (clerkUserId, db = pool) => {
  const { rows } = await db.query(
    `SELECT ${requestFields} FROM registration_requests r WHERE r.clerk_user_id = $1`, [clerkUserId])
  return rows[0] || null
}

// Records a pending request once. Returns the stored request, or null when another open request
// already holds this email (a second Clerk account with the same address).
const createPending = async ({ clerkUserId, email, name }) => {
  await pool.query(
    `INSERT INTO registration_requests (clerk_user_id, email, full_name)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [clerkUserId, email, name])
  return findByClerkId(clerkUserId)
}

const list = async (status) => {
  const { rows } = await pool.query(
    `SELECT ${requestFields} FROM registration_requests r
     WHERE r.registration_status = $1 ORDER BY r.requested_at, r.request_id LIMIT 500`, [status])
  return rows
}

const countPending = async () => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM registration_requests WHERE registration_status = 'pending'`)
  return rows[0].count
}

const ROLE_DB = { organizer: 'Organizer', manager: 'Manager', member: 'Member' }

// One transaction: lock the request, validate the assignment, create the account, close the request.
const approve = async (requestId, input, actorId) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Same lock the account workflows use, so two approvals cannot race on email or manager seats.
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')
    const fail = async (outcome) => { await client.query('ROLLBACK'); return { outcome } }

    const actor = await client.query(
      `SELECT 1 FROM users WHERE user_id = $1 AND role = 'Organizer' AND is_active = TRUE AND deleted_at IS NULL`,
      [actorId])
    if (!actor.rows.length) return fail('actor_forbidden')

    const found = await client.query(
      `SELECT request_id, clerk_user_id, email, full_name, registration_status
       FROM registration_requests WHERE request_id = $1 FOR UPDATE`, [requestId])
    const request = found.rows[0]
    if (!request) return fail('not_found')
    if (request.registration_status !== 'pending') return fail('already_decided')

    const taken = await client.query(
      'SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) OR clerk_user_id = $2',
      [request.email, request.clerk_user_id])
    if (taken.rows.length) return fail('email_exists')

    const campus = await client.query(
      'SELECT campus_id, campus_name FROM campuses WHERE campus_id = $1', [input.campusId])
    if (input.campusId !== null && !campus.rows.length) return fail('campus_not_found')

    let team = null
    if (input.role !== 'organizer') {
      const teamRows = await client.query(
        `SELECT team_id, team_name, campus_id, manager_user_id FROM teams WHERE team_id = $1 FOR UPDATE`,
        [input.teamId])
      team = teamRows.rows[0]
      if (!team) return fail('team_not_found')
      if (team.campus_id !== input.campusId) return fail('team_campus_mismatch')
      if (input.role === 'manager' && team.manager_user_id !== null) return fail('manager_exists')
    }

    const role = ROLE_DB[input.role]
    const created = await client.query(
      `INSERT INTO users (full_name, email, role, team_id, is_active, clerk_user_id, invitation_status, invited_by_user_id)
       VALUES ($1, $2, $3, $4, TRUE, $5, 'not_required', $6)
       RETURNING user_id AS id, full_name AS name, email, LOWER(role) AS role, team_id AS "teamId", is_active AS "isActive"`,
      [request.full_name, request.email, role, team ? team.team_id : null, request.clerk_user_id, actorId])
    const user = created.rows[0]

    if (team) {
      if (input.role === 'manager') {
        await client.query('UPDATE teams SET manager_user_id = $1 WHERE team_id = $2', [user.id, team.team_id])
        await recordAudit(client, {
          actorId, action: 'assign_team_manager', entityName: 'teams', entityId: team.team_id,
          before: { manager_user_id: null }, after: { manager_user_id: user.id },
          reason: 'Manager assigned while approving a registration request',
        })
      }
      await client.query(
        `INSERT INTO assignment_history (user_id, team_id, role_at_time, effective_from, changed_by_user_id, reason)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, 'Registration approved')`,
        [user.id, team.team_id, role, actorId])
    }

    await client.query(
      `UPDATE registration_requests SET registration_status = 'approved', decided_at = CURRENT_TIMESTAMP,
         decided_by_user_id = $2, approved_user_id = $3 WHERE request_id = $1`,
      [requestId, actorId, user.id])
    await recordAudit(client, {
      actorId, action: 'approve_registration', entityName: 'users', entityId: user.id,
      before: { registration_request_id: Number(requestId), status: 'pending' },
      after: { role, team_id: user.teamId, is_active: true },
      reason: 'Organizer approved a self-registration request',
    })
    await client.query('COMMIT')
    return {
      outcome: 'approved', user,
      teamName: team ? team.team_name : null,
      campusName: campus.rows[0] ? campus.rows[0].campus_name : null,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const reject = async (requestId, reason, actorId) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const fail = async (outcome) => { await client.query('ROLLBACK'); return { outcome } }
    const actor = await client.query(
      `SELECT 1 FROM users WHERE user_id = $1 AND role = 'Organizer' AND is_active = TRUE AND deleted_at IS NULL`,
      [actorId])
    if (!actor.rows.length) return fail('actor_forbidden')
    const found = await client.query(
      'SELECT email, registration_status FROM registration_requests WHERE request_id = $1 FOR UPDATE', [requestId])
    const request = found.rows[0]
    if (!request) return fail('not_found')
    if (request.registration_status !== 'pending') return fail('already_decided')

    await client.query(
      `UPDATE registration_requests SET registration_status = 'rejected', decided_at = CURRENT_TIMESTAMP,
         decided_by_user_id = $2, rejection_reason = $3 WHERE request_id = $1`,
      [requestId, actorId, reason])
    await recordAudit(client, {
      actorId, action: 'reject_registration', entityName: 'registration_requests', entityId: requestId,
      before: { status: 'pending' }, after: { status: 'rejected' },
      reason: reason || 'Organizer rejected a self-registration request',
    })
    await client.query('COMMIT')
    return { outcome: 'rejected', email: request.email }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const setNotificationStatus = (requestId, status) => pool.query(
  'UPDATE registration_requests SET notification_status = $2 WHERE request_id = $1', [requestId, status])

module.exports = { findByClerkId, createPending, list, countPending, approve, reject, setNotificationStatus }
