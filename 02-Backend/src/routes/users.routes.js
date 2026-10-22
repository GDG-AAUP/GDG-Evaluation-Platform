// Handles organizer account administration, invitations, deletion and restoration.
const express = require('express')
const loadProjectUser = require('../middleware/load-project-user')
const requireRole = require('../middleware/require-role')
const repository = require('../repositories/users.repository')
const parsePositiveId = require('../utils/parse-positive-id')
const validateCreateUser = require('../validators/create-user.validator')
const invitationsRepository = require('../repositories/user-invitations.repository')
const invitationsService = require('../services/user-invitations.service')
const validateUpdateUser = require('../validators/update-user.validator')
const userUpdateService = require('../services/update-user.service')
const deletionRepository = require('../repositories/user-deletion.repository')

const router = express.Router()

// Edits business fields while preserving verified identity, manager coverage and assignment history.
router.patch('/:id', loadProjectUser, requireRole('organizer'), async (req, res) => {
  const id = parsePositiveId(req.params.id)
  if (id === null || id > 2147483647) return res.status(400).json({ error: { code: 'INVALID_USER_ID', message: 'A valid positive PostgreSQL user ID is required' } })
  const validation = validateUpdateUser(req.body)
  if (validation.error) return res.status(400).json({ error: { code: 'INVALID_USER_DATA', message: validation.error } })
  const result = await userUpdateService.updateUser(id, validation.value, req.projectUser.id)
  const failures = {
    actor_forbidden: [403, 'FORBIDDEN', 'An active organizer is required'],
    not_found: [404, 'USER_NOT_FOUND', 'User not found'],
    deleted: [409, 'USER_DELETED', 'Restore this account before editing it'],
    team_not_found: [404, 'TEAM_NOT_FOUND', 'Team not found'],
    busy: [409, 'ACCOUNT_BUSY', 'Another account operation is in progress; retry shortly'],
    invalid_assignment: [400, 'INVALID_ASSIGNMENT', 'An organizer cannot belong to a team'],
    team_required: [400, 'TEAM_REQUIRED', 'Members and managers must belong to a team'],
    last_organizer: [409, 'LAST_ACTIVE_ORGANIZER', 'The last active organizer cannot be demoted or deactivated'],
    email_exists: [409, 'EMAIL_ALREADY_EXISTS', 'Another project account already uses this email'],
    manager_replacement_required: [409, 'MANAGER_REPLACEMENT_REQUIRED', 'Assign a replacement before moving, demoting or deactivating an operational team manager'],
    manager_exists: [409, 'TEAM_MANAGER_EXISTS', 'Use the manager replacement operation for a team that already has a manager'],
    invalid_manager: [409, 'INVALID_MANAGER', 'An operational team requires an active linked manager'],
    history_conflict: [409, 'ASSIGNMENT_HISTORY_CONFLICT', 'Current assignment history must be reconciled before changing role or team'],
    email_verification_required: [409, 'EMAIL_VERIFICATION_REQUIRED', 'The user must add and verify the new email in their Clerk account profile before the organizer saves it'],
    identity_conflict: [409, 'EMAIL_IDENTITY_CONFLICT', 'This email belongs to another Clerk account or invitation'],
    link_account_first: [409, 'LINK_ACCOUNT_FIRST', 'Complete the accepted invitation account linking before changing its email'],
    email_change_needs_review: [503, 'EMAIL_CHANGE_NEEDS_REVIEW', 'The email edit was not saved; a previous invitation may have been revoked. Review the old invitation before retrying'],
    identity_provider_unavailable: [503, 'IDENTITY_PROVIDER_UNAVAILABLE', 'Email verification is temporarily unavailable; no changes were saved'],
  }
  if (result.outcome !== 'updated') {
    const failure = failures[result.outcome]
    if (!failure) throw new Error('Unexpected account update outcome')
    if (result.outcome === 'busy') res.set('Retry-After', '2')
    return res.status(failure[0]).json({ error: { code: failure[1], message: failure[2] } })
  }
  return res.status(200).json({ data: result.user, changed: result.changed,
    ...(result.delivery ? { invitation: { status: result.delivery.invitationStatus, deliveryStatus: result.delivery.outcome } } : {}) })
})

router.get(
  '/',
  loadProjectUser,
  requireRole('organizer'),
  async (req, res) => {
    const users = await repository.listUsers()

    return res.status(200).json({
      data: users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        teamId: user.teamId,
        isActive: user.isActive,
      })),
    })
  },
)

router.get('/deleted', loadProjectUser, requireRole('organizer'), async (req, res) => {
  const users = await repository.listUsers({ deleted: true })
  return res.status(200).json({ data: users.map(({ clerkUserId, ...user }) => user) })
})

for (const [method, path, operation] of [
  ['delete', '/:id', deletionRepository.deleteUser],
  ['post', '/:id/restore', deletionRepository.restoreUser],
]) {
  router[method](path, loadProjectUser, requireRole('organizer'), async (req, res) => {
    const id = parsePositiveId(req.params.id)
    if (id === null || id > 2147483647) return res.status(400).json({ error: { code: 'INVALID_USER_ID', message: 'A valid positive PostgreSQL user ID is required' } })
    const body = req.body
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
        typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 1000) {
      return res.status(400).json({ error: { code: 'INVALID_DELETION_DATA', message: 'Provide only a reason of 1 to 1000 characters' } })
    }
    const result = await operation(id, req.projectUser.id, body.reason.trim())
    const failures = {
      actor_forbidden: [403, 'FORBIDDEN', 'An active organizer is required'],
      not_found: [404, 'USER_NOT_FOUND', 'User not found'],
      not_deleted: [409, 'USER_NOT_DELETED', 'This account is not deleted'],
      busy: [409, 'ACCOUNT_BUSY', 'Another account operation is in progress; retry shortly'],
      last_organizer: [409, 'LAST_ACTIVE_ORGANIZER', 'The last active organizer cannot be deleted'],
      manager_replacement_required: [409, 'MANAGER_REPLACEMENT_REQUIRED', 'Assign a replacement before deleting an operational team manager'],
      team_not_found: [409, 'RESTORE_TEAM_NOT_FOUND', 'The original team must exist before restoring this account'],
      manager_restore_conflict: [409, 'MANAGER_RESTORE_CONFLICT', 'The original team must be nonoperational with a vacant manager position before restoring its manager'],
      history_conflict: [409, 'ASSIGNMENT_HISTORY_CONFLICT', 'Assignment history must be reconciled before deletion or restoration'],
    }
    if (!['deleted', 'restored'].includes(result.outcome)) {
      const failure = failures[result.outcome]
      if (!failure) throw new Error('Unexpected deletion outcome')
      if (result.outcome === 'busy') res.set('Retry-After', '2')
      return res.status(failure[0]).json({ error: { code: failure[1], message: failure[2] } })
    }
    return res.status(200).json({ data: result.user, changed: result.changed,
      message: result.outcome === 'restored' ? 'Account restored in inactive state; activate it explicitly before access' : 'Account deleted from project access; historical data and Clerk identity retained' })
  })
}

// Allows organizers to activate or deactivate an account while preserving an active organizer.
router.patch(
  '/:id/status',
  loadProjectUser,
  requireRole('organizer'),
  async (req, res) => {
    const id = parsePositiveId(req.params.id)

    if (id === null) {
      return res.status(400).json({
        error: {
          code: 'INVALID_USER_ID',
          message: 'User ID must be a positive integer',
        },
      })
    }

    const body = req.body

    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      typeof body.isActive !== 'boolean'
    ) {
      return res.status(400).json({
        error: {
          code: 'INVALID_STATUS_DATA',
          message: 'Provide only isActive as a boolean',
        },
      })
    }

    const result = await repository.setUserActiveStatus(
      id,
      body.isActive,
      req.projectUser.id,
    )

    if (result.outcome === 'actor_forbidden') {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'An active organizer account is required' },
      })
    }

    if (result.outcome === 'not_found') {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        },
      })
    }

    if (result.outcome === 'deleted') {
      return res.status(409).json({ error: { code: 'USER_DELETED', message: 'Restore this account before changing its active status' } })
    }

    if (result.outcome === 'manager_replacement_required') {
      return res.status(409).json({
        error: { code: 'MANAGER_REPLACEMENT_REQUIRED', message: 'Replace the manager before deactivating the account of an operational team manager' },
      })
    }

    if (result.outcome === 'last_organizer') {
      return res.status(409).json({
        error: {
          code: 'LAST_ACTIVE_ORGANIZER',
          message: 'The last active organizer cannot be deactivated',
        },
      })
    }

    return res.status(200).json({
      data: result.user,
    })
  },
)
// Creates a member or manager account and attempts to send its Clerk invitation.
router.post(
  '/',
  loadProjectUser,
  requireRole('organizer'),
  async (req, res) => {
    const validation = validateCreateUser(req.body)

    if (validation.error) {
      return res.status(400).json({
        error: {
          code: 'INVALID_USER_DATA',
          message: validation.error,
        },
      })
    }

    const result = await invitationsRepository.createPendingUser(
      validation.value,
      req.projectUser.id,
    )

    const failures = {
      actor_forbidden: {
        status: 403,
        code: 'FORBIDDEN',
        message: 'An active organizer account is required',
      },
      email_exists: {
        status: 409,
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'A project account with this email already exists',
      },
      team_not_found: {
        status: 404,
        code: 'TEAM_NOT_FOUND',
        message: 'Team not found',
      },
      manager_exists: {
        status: 409,
        code: 'TEAM_MANAGER_EXISTS',
        message: 'This team already has a manager',
      },
    }

    if (result.outcome !== 'created') {
      const failure = failures[result.outcome]

      if (!failure) {
        throw new Error('Unexpected account creation outcome')
      }

      return res.status(failure.status).json({
        error: {
          code: failure.code,
          message: failure.message,
        },
      })
    }

    let delivery

    try {
      delivery = await invitationsService.sendUserInvitation(
        result.user.id,
        req.projectUser.id,
      )
    } catch {
      delivery = { outcome: 'needs_review' }
    }

    const sent = ['sent', 'existing_invitation'].includes(delivery.outcome)

    return res.status(201).json({
      data: {
        ...result.user,
        invitationStatus: delivery.invitationStatus || result.user.invitationStatus,
        deliveryStatus: delivery.outcome,
      },
      message: sent
        ? 'Account created and invitation created at Clerk; inbox delivery is not confirmed'
        : 'Account created; invitation delivery requires review. Do not create the account again.',
    })
  },
)
// Reviews reconcile local state without email; explicit resends revoke the previous pending link.
const invitationMessages = {
  sent: [200, 'Invitation created at Clerk; inbox delivery is not confirmed'],
  existing_invitation: [200, 'Existing invitation found; no new email was sent'],
  accepted_at_clerk: [200, 'Invitation accepted; the invited user should sign in to complete account linking'],
  already_linked: [200, 'Account is already linked'],
  not_found: [404, 'User not found'],
  forbidden: [403, 'An active organizer account is required'],
  inactive: [409, 'Activate this account explicitly before managing its invitation'],
  deleted: [409, 'Restore this account before managing its invitation'],
  not_invitable: [409, 'This account was not created through the invitation workflow'],
  busy: [409, 'Another invitation operation is in progress; retry shortly'],
  cooldown: [429, 'Wait at least 60 seconds after the last invitation before resending'],
  identity_conflict: [409, 'A conflicting Clerk account or invitation exists; do not create another local account'],
  no_active_invitation: [409, 'No active invitation found; an explicit resend is required'],
  needs_review: [503, 'Delivery could not be confirmed; review the invitation before resending'],
  configuration_required: [503, 'Configure CLERK_INVITATION_REDIRECT_URL with the frontend acceptance page before sending invitations'],
}

for (const [action, operation] of [
  ['review', invitationsService.reviewUserInvitation],
  ['resend', invitationsService.resendUserInvitation],
]) {
  router.post(`/:id/invitations/${action}`, loadProjectUser, requireRole('organizer'), async (req, res) => {
    const userId = parsePositiveId(req.params.id)
    if (userId === null || userId > 2147483647) {
      return res.status(400).json({ error: { code: 'INVALID_USER_ID', message: 'User ID must be a valid positive PostgreSQL integer' } })
    }
    if (req.body !== undefined && (!req.body || typeof req.body !== 'object' ||
        Array.isArray(req.body) || Object.keys(req.body).length)) {
      return res.status(400).json({ error: { code: 'INVALID_INVITATION_DATA', message: 'No account fields are accepted by this endpoint' } })
    }
    const result = await operation(userId, req.projectUser.id)
    const [status, message] = invitationMessages[result.outcome] || invitationMessages.needs_review
    if (status === 429) res.set('Retry-After', '60')
    if (result.outcome === 'busy') res.set('Retry-After', '2')
    const data = { userId, invitationStatus: result.invitationStatus, deliveryStatus: result.outcome }
    if (status >= 400) return res.status(status).json({
      data, error: { code: `INVITATION_${result.outcome.toUpperCase()}`, message },
    })
    return res.status(status).json({ data, message })
  })
}

module.exports = router
