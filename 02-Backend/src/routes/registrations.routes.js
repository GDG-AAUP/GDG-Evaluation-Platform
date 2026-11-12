// Organizer review of self-registration requests: list, count (header badge), approve, reject.
// Mounted after loadProjectUser + requireRole('organizer').
const express = require('express')
const parsePositiveId = require('../utils/parse-positive-id')
const repository = require('../repositories/registrations.repository')
const service = require('../services/registration.service')

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

router.get('/count', async (req, res) => res.json({ data: { pending: await repository.countPending() } }))

router.post('/:id/approve', async (req, res) => {
  const id = requestId(req, res)
  if (id === null) return undefined
  const validation = validateApproval(req.body)
  if (validation.error) return fail(res, 400, 'INVALID_APPROVAL_DATA', validation.error)
  const result = await service.approveRequest(id, validation.value, req.projectUser.id)
  if (result.outcome !== 'approved') {
    const [status, code, message] = FAILURES[result.outcome] || []
    if (!status) throw new Error('Unexpected approval outcome')
    return fail(res, status, code, message)
  }
  return res.status(200).json({ data: { user: result.user, emailStatus: result.emailStatus } })
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
  const result = await service.rejectRequest(id, reason, req.projectUser.id)
  if (result.outcome !== 'rejected') {
    const [status, code, message] = FAILURES[result.outcome] || []
    if (!status) throw new Error('Unexpected rejection outcome')
    return fail(res, status, code, message)
  }
  return res.status(200).json({ data: { status: 'rejected', emailStatus: result.emailStatus } })
})

module.exports = router
module.exports.validateApproval = validateApproval
