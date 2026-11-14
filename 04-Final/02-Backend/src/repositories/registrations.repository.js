// Self-registration requests: submitted by a signed-in Clerk user (role, campus, team wishes),
// decided by an organizer. Approval creates the project account in the same transaction that
// closes the request. Every active Organizer (Super Admins included) sees and decides every
// request, on both campuses; only giving the Organizer role is reserved to Super Admins.
const pool = require('../config/db')
const { recordAudit } = require('./audit.repository')

const requestFields = `
  r.request_id::int AS id, r.full_name AS name, r.email,
  r.registration_status AS status, r.rejection_reason AS "rejectionReason",
  r.requested_at AS "requestedAt", r.decided_at AS "decidedAt",
  r.approved_user_id AS "approvedUserId", r.notification_status AS "notificationStatus",
  r.requested_role AS "requestedRole", r.requested_campus_id AS "requestedCampusId",
  rc.campus_name AS "requestedCampusName", r.requested_team_id AS "requestedTeamId",
  rt.team_name AS "requestedTeamName"`

const requestFrom = `
  registration_requests r
  LEFT JOIN campuses rc ON rc.campus_id = r.requested_campus_id
  LEFT JOIN teams rt ON rt.team_id = r.requested_team_id`

// The approver's access ({ isSuperAdmin }) decides only whether the Organizer role may be given.
const isSuperAdmin = (access = {}) => access.isSuperAdmin === true

const findByClerkId = async (clerkUserId, db = pool) => {
  const { rows } = await db.query(
    `SELECT ${requestFields} FROM ${requestFrom} WHERE r.clerk_user_id = $1`, [clerkUserId])
  return rows[0] || null
}

/**
 * The signed-in Clerk user asks to join: email from Clerk (verified), the rest from the form.
 * A pending request is updated in place (one per Clerk account and per email).
 * Outcomes: submitted | already_registered | rejected | campus_not_found | team_not_found |
 * team_campus_mismatch | email_in_use.
 */
const submit = async ({ clerkUserId, email, name, role, campusId, teamId }) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(73014, hashtext($1))', [clerkUserId])
    const fail = async (outcome) => { await client.query('ROLLBACK'); return { outcome } }
    const account = await client.query(
      'SELECT 1 FROM users WHERE clerk_user_id = $1 OR LOWER(email) = LOWER($2)', [clerkUserId, email])
    if (account.rows.length) return fail('already_registered')
    const campus = await client.query('SELECT 1 FROM campuses WHERE campus_id = $1', [campusId])
    if (!campus.rows.length) return fail('campus_not_found')
    if (teamId !== null) {
      const team = await client.query('SELECT campus_id FROM teams WHERE team_id = $1', [teamId])
      if (!team.rows.length) return fail('team_not_found')
      if (team.rows[0].campus_id !== campusId) return fail('team_campus_mismatch')
    }
    const existing = (await client.query(
      'SELECT request_id, registration_status FROM registration_requests WHERE clerk_user_id = $1 FOR UPDATE',
      [clerkUserId])).rows[0]
    if (existing && existing.registration_status === 'rejected') return fail('rejected')
    if (existing && existing.registration_status === 'approved') return fail('already_registered')
    try {
      await client.query('SAVEPOINT submit_request')
      if (existing) {
        await client.query(
          `UPDATE registration_requests SET full_name = $2, email = $3, requested_role = $4,
             requested_campus_id = $5, requested_team_id = $6 WHERE request_id = $1`,
          [existing.request_id, name, email, role, campusId, teamId])
      } else {
        await client.query(
          `INSERT INTO registration_requests
             (clerk_user_id, email, full_name, requested_role, requested_campus_id, requested_team_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [clerkUserId, email, name, role, campusId, teamId])
      }
    } catch (error) {
      // One open request per email: another Clerk account already asked with this address.
      if (error.code === '23505') {
        await client.query('ROLLBACK TO SAVEPOINT submit_request')
        return fail('email_in_use')
      }
      throw error
    }
    const request = await findByClerkId(clerkUserId, client)
    await client.query('COMMIT')
    return { outcome: 'submitted', request, updated: Boolean(existing) }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Records a pending request once. Returns the stored request, or null when another open request
// already holds this email (a second Clerk account with the same address).
const createPending = async ({ clerkUserId, email, name }) => {
  await pool.query(
    `INSERT INTO registration_requests (clerk_user_id, email, full_name)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [clerkUserId, email, name])
  return findByClerkId(clerkUserId)
}

// Every request of that status, both campuses and every requested role (legacy ones included).
const list = async (status) => {
  const { rows } = await pool.query(
    `SELECT ${requestFields} FROM ${requestFrom}
     WHERE r.registration_status = $1
     ORDER BY r.requested_at, r.request_id LIMIT 500`, [status])
  return rows
}

const countPending = async () => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM registration_requests r WHERE r.registration_status = 'pending'`)
  return rows[0].count
}

const ROLE_DB = { organizer: 'Organizer', manager: 'Manager', member: 'Member' }

// One transaction: lock the request, validate the assignment, create the account, close the request.
// `access` ({ isSuperAdmin }) from the route. Any active Organizer approves any request into
// either campus as Member or Manager; the Organizer role needs a Super Admin.
const approve = async (requestId, input, actorId, access = {}) => {
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
      `SELECT request_id, clerk_user_id, email, full_name, registration_status, requested_role, requested_campus_id
       FROM registration_requests WHERE request_id = $1 FOR UPDATE`, [requestId])
    const request = found.rows[0]
    if (!request) return fail('not_found')
    if (request.registration_status !== 'pending') return fail('already_decided')
    if (input.role === 'organizer' && !isSuperAdmin(access)) return fail('organizer_restricted')

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
      `INSERT INTO users (full_name, email, role, team_id, is_active, clerk_user_id, invitation_status, invited_by_user_id, organizer_campus_id)
       VALUES ($1, $2, $3, $4, TRUE, $5, 'not_required', $6, $7)
       RETURNING user_id AS id, full_name AS name, email, LOWER(role) AS role, team_id AS "teamId", is_active AS "isActive"`,
      // An Organizer's campusId (optional) becomes the campus it evaluates in.
      [request.full_name, request.email, role, team ? team.team_id : null, request.clerk_user_id, actorId,
        input.role === 'organizer' ? input.campusId : null])
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
      after: { role, team_id: user.teamId, is_active: true, campus_id: input.campusId,
        requested_role: request.requested_role, requested_campus_id: request.requested_campus_id,
        ...(isSuperAdmin(access) ? { actorIsSuperAdmin: true } : {}) },
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

// Any active Organizer may reject any pending request (`access` is kept for the audit trail).
const reject = async (requestId, reason, actorId, access = {}) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const fail = async (outcome) => { await client.query('ROLLBACK'); return { outcome } }
    const actor = await client.query(
      `SELECT 1 FROM users WHERE user_id = $1 AND role = 'Organizer' AND is_active = TRUE AND deleted_at IS NULL`,
      [actorId])
    if (!actor.rows.length) return fail('actor_forbidden')
    const found = await client.query(
      `SELECT email, registration_status, requested_role, requested_campus_id
       FROM registration_requests WHERE request_id = $1 FOR UPDATE`, [requestId])
    const request = found.rows[0]
    if (!request) return fail('not_found')
    if (request.registration_status !== 'pending') return fail('already_decided')

    await client.query(
      `UPDATE registration_requests SET registration_status = 'rejected', decided_at = CURRENT_TIMESTAMP,
         decided_by_user_id = $2, rejection_reason = $3 WHERE request_id = $1`,
      [requestId, actorId, reason])
    await recordAudit(client, {
      actorId, action: 'reject_registration', entityName: 'registration_requests', entityId: requestId,
      before: { status: 'pending', requested_role: request.requested_role, requested_campus_id: request.requested_campus_id },
      after: { status: 'rejected', ...(isSuperAdmin(access) ? { actorIsSuperAdmin: true } : {}) },
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

module.exports = { findByClerkId, createPending, submit, list, countPending, approve, reject, setNotificationStatus }
