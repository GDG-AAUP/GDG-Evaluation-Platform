// Organizer review of self-registration requests: list, count (header badge), approve, reject.
// Mounted after loadProjectUser + requireRole('organizer'). Every active Organizer sees and decides
// every request (both campuses, every requested role); only a Super Admin gives the Organizer role.
// `requestRouter` (POST /api/registrations/request) is for signed-in Clerk users without an account.
const express = require('express')
const { getAuth } = require('@clerk/express')
const parsePositiveId = require('../utils/parse-positive-id')
const repository = require('../repositories/registrations.repository')
const service = require('../services/registration.service')
const { accessOf } = require('../services/account-governance')

const router = express.Router()

const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } })

const FAILURES = {
  actor_forbidden: [403, 'FORBIDDEN', 'An active organizer is required'],
  not_found: [404, 'REGISTRATION_NOT_FOUND', 'Registration request not found'],
  already_decided: [409, 'REGISTRATION_ALREADY_DECIDED', 'This request was already approved or rejected'],
  email_exists: [409, 'EMAIL_ALREADY_EXISTS', 'A project account with this email already exists'],
  campus_not_found: [404, 'CAMPUS_NOT_FOUND', 'Campus not found'],
  team_not_found: [404, 'TEAM_NOT_FOUND', 'Team not found'],
  team_campus_mismatch: [400, 'TEAM_CAMPUS_MISMATCH', 'The team does not belong to the selected campus'],
  manager_exists: [409, 'TEAM_MANAGER_EXISTS', 'This team already has a manager'],
  organizer_restricted: [403, 'ORGANIZER_MANAGEMENT_RESTRICTED', 'Only a Super Admin can create an Organizer account'],
}

const requestId = (req, res) => {
  const id = parsePositiveId(req.params.id)
  if (id === null || id > 2147483647) {
    fail(res, 400, 'INVALID_REGISTRATION_ID', 'A valid positive request ID is required')
    return null
  }
  return id
}

const isId = (v) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647

// role: organizer | manager | member. Managers and members need campusId and teamId;
// an organizer belongs to no team, so teamId must be absent (campusId is optional and unused).
const validateApproval = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Request body must be an object' }
  if (Object.keys(body).some((k) => !['role', 'campusId', 'teamId'].includes(k))) {
    return { error: 'Only role, campusId and teamId are allowed' }
  }
  if (!['organizer', 'manager', 'member'].includes(body.role)) return { error: 'Role must be organizer, manager or member' }
  if (body.role === 'organizer') {
    if (body.teamId != null) return { error: 'An organizer cannot belong to a team' }
    if (body.campusId != null && !isId(body.campusId)) return { error: 'campusId must be a positive integer' }
    return { value: { role: 'organizer', campusId: body.campusId ?? null, teamId: null } }
  }
  if (!isId(body.campusId)) return { error: 'campusId is required for managers and members' }
  if (!isId(body.teamId)) return { error: 'teamId is required for managers and members' }
  return { value: { role: body.role, campusId: body.campusId, teamId: body.teamId } }
}

router.get('/', async (req, res) => {
  const status = req.query.status === undefined ? 'pending' : req.query.status
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return fail(res, 400, 'INVALID_STATUS', 'status must be pending, approved or rejected')
  }
  return res.json({ data: await repository.list(status) })
})

// Every pending request with its count, for notifications (all Organizers see all requests).
router.get('/pending', async (req, res) => {
  const data = await repository.list('pending')
  return res.json({ data, count: data.length })
})

router.get('/count', async (req, res) => res.json({ data: { pending: await repository.countPending() } }))

router.post('/:id/approve', async (req, res) => {
  const id = requestId(req, res)
  if (id === null) return undefined
  const validation = validateApproval(req.body)
  if (validation.error) return fail(res, 400, 'INVALID_APPROVAL_DATA', validation.error)
  // Creating an Organizer account is a Super Admin decision (governance).
  if (validation.value.role === 'organizer' && req.projectUser.isSuperAdmin !== true) {
    return fail(res, 403, 'ORGANIZER_MANAGEMENT_RESTRICTED', 'Only a Super Admin can create an Organizer account')
  }
  const result = await service.approveRequest(id, validation.value, req.projectUser.id, accessOf(req.projectUser))
  if (result.outcome !== 'approved') {
    const [status, code, message] = FAILURES[result.outcome] || []
    if (!status) throw new Error('Unexpected approval outcome')
    return fail(res, status, code, message)
  }
  // emailStatus: sent | failed | skipped; emailError explains a failure (code + hint, no personal data).
  return res.status(200).json({ data: { user: result.user, emailStatus: result.emailStatus, emailError: result.emailError } })
})

router.post('/:id/reject', async (req, res) => {
  const id = requestId(req, res)
  if (id === null) return undefined
  const body = req.body ?? {}
  if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => k !== 'reason') ||
      (body.reason != null && (typeof body.reason !== 'string' || body.reason.trim().length > 1000))) {
    return fail(res, 400, 'INVALID_REJECTION_DATA', 'Provide only an optional reason of up to 1000 characters')
  }
  const reason = body.reason ? body.reason.trim() || null : null
  const result = await service.rejectRequest(id, reason, req.projectUser.id, accessOf(req.projectUser))
  if (result.outcome !== 'rejected') {
    const [status, code, message] = FAILURES[result.outcome] || []
    if (!status) throw new Error('Unexpected rejection outcome')
    return fail(res, status, code, message)
  }
  return res.status(200).json({ data: { status: 'rejected', emailStatus: result.emailStatus, emailError: result.emailError } })
})

// ------------------------------------------------------------------ POST /api/registrations/request
// { fullName?, campusId, role: member|manager|organizer, teamId? } from a signed-in Clerk user that
// has no project account. The email comes from Clerk (verified); a pending request may be resubmitted.
const validateRequest = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Request body must be an object' }
  if (Object.keys(body).some((k) => !['fullName', 'campusId', 'role', 'teamId'].includes(k))) {
    return { error: 'Only fullName, campusId, role and teamId are allowed' }
  }
  let fullName = null
  if (body.fullName !== undefined && body.fullName !== null) {
    if (typeof body.fullName !== 'string') return { error: 'fullName must be text' }
    fullName = body.fullName.normalize('NFC').trim()
    if (!fullName || fullName.length > 100) return { error: 'fullName must contain 1 to 100 characters' }
  }
  if (!['organizer', 'manager', 'member'].includes(body.role)) return { error: 'Role must be organizer, manager or member' }
  if (!isId(body.campusId)) return { error: 'campusId is required' }
  const teamId = body.teamId ?? null
  if (teamId !== null && !isId(teamId)) return { error: 'teamId must be a positive integer' }
  if (body.role === 'organizer' && teamId !== null) return { error: 'An organizer cannot belong to a team' }
  return { value: { fullName, role: body.role, campusId: body.campusId, teamId } }
}

const REQUEST_FAILURES = {
  email_not_verified: [409, 'EMAIL_NOT_VERIFIED', 'Verify your email address in your account before requesting access'],
  already_registered: [409, 'ALREADY_REGISTERED', 'This account already has access; sign in again'],
  rejected: [409, 'REGISTRATION_REJECTED', 'The registration request was rejected'],
  campus_not_found: [404, 'CAMPUS_NOT_FOUND', 'Campus not found'],
  team_not_found: [404, 'TEAM_NOT_FOUND', 'Team not found'],
  team_campus_mismatch: [400, 'TEAM_CAMPUS_MISMATCH', 'The team does not belong to the selected campus'],
  email_in_use: [409, 'EMAIL_ALREADY_REQUESTED', 'Another pending request already uses this email'],
}

const requestRouter = express.Router()
requestRouter.post('/', async (req, res) => {
  const { userId } = getAuth(req)
  if (!userId) return fail(res, 401, 'UNAUTHENTICATED', 'Sign in before requesting access')
  const validation = validateRequest(req.body)
  if (validation.error) return fail(res, 400, 'INVALID_REGISTRATION_REQUEST', validation.error)
  const result = await service.submitRequest(userId, validation.value)
  if (result.outcome !== 'submitted') {
    const [status, code, message] = REQUEST_FAILURES[result.outcome] || []
    if (!status) throw new Error('Unexpected registration request outcome')
    return fail(res, status, code, message)
  }
  return res.status(result.updated ? 200 : 201).json({ data: result.request })
})

module.exports = router
module.exports.validateApproval = validateApproval
module.exports.validateRequest = validateRequest
module.exports.requestRouter = requestRouter
