// Loads active project accounts and securely links accepted Clerk invitations on first access.
const { getAuth } = require('@clerk/express')
const repository = require('../repositories/users.repository')
const { linkClerkAccount } = require('../services/link-clerk-account.service')
const { linkByVerifiedEmail } = require('../services/link-by-verified-email.service')
const { logSystemEventThrottled } = require('../services/system-log.service')
const registrations = require('../repositories/registrations.repository')
const { isSuperAdminClerkId } = require('../services/account-governance')

// Diagnostic output for local sign-in problems. Tokens are never logged.
const authLog = (...details) => {
  if (!['production', 'test'].includes(process.env.NODE_ENV)) console.log('[auth]', ...details)
}

const unauthenticated = (res, reason, message) => res.status(401).json({
  error: { code: 'UNAUTHENTICATED', reason, message },
})

// 403, not 401: the person is signed in correctly but has no project access yet.
const registrationDenied = (res, request) => res.status(403).json({
  error: request.status === 'rejected'
    ? { code: 'REGISTRATION_REJECTED', message: 'The registration request was rejected' }
    : { code: 'REGISTRATION_PENDING', message: 'The registration request is waiting for organizer approval' },
})

const loadProjectUser = async (req, res, next) => {
  const { userId, sessionClaims } = getAuth(req)
  const hasBearer = /^bearer\s+\S+/i.test(req.get('authorization') || '')
  authLog(req.method, req.originalUrl, '| Authorization header:', hasBearer ? 'received' : 'missing')

  if (!userId) {
    if (!hasBearer) return unauthenticated(res, 'TOKEN_MISSING', 'Authentication is required')
    const clerkReason = res.getHeader('x-clerk-auth-reason')
    authLog('token rejected by Clerk | reason:', clerkReason || 'unknown', '|', res.getHeader('x-clerk-auth-message') || '')
    logSystemEventThrottled('invalid-token', 'warning', `Session token rejected (${clerkReason || 'unknown'})`, 'auth')
    return unauthenticated(res, 'INVALID_TOKEN', 'The session token could not be verified')
  }

  authLog('Clerk user:', userId, '| email claim:', sessionClaims?.email || '(not in token)')

  let user = await repository.findUserByClerkId(userId)
  authLog('lookup by Clerk ID:', user ? `found user ${user.id} (${user.role})` : 'no match')
  if (!user) {
    // A self-registered person waiting for (or refused by) an organizer: a cheap lookup, no Clerk call.
    const request = await registrations.findByClerkId(userId)
    if (request && request.status !== 'approved') return registrationDenied(res, request)
  }
  if (!user) {
    user = await linkClerkAccount(userId)
    authLog('invitation link:', user ? `linked user ${user.id}` : 'no match')
  }
  if (!user) {
    user = await linkByVerifiedEmail(userId)
    authLog('verified email match:', user ? `user ${user.id} (active: ${user.isActive})` : 'no match')
  }
  if (!user) {
    // Signed in at Clerk, unknown here: the person submits a registration request
    // (POST /api/registrations/request: name, campus, role, team) for an organizer to approve.
    authLog('no project account: registration request required')
    return res.status(403).json({
      error: {
        code: 'REGISTRATION_REQUIRED',
        message: 'Submit a registration request (POST /api/registrations/request) to join the platform',
      },
    })
  }

  if (user.isActive !== true || user.deletedAt ||
      !['organizer', 'manager', 'member'].includes(user.role)) {
    return res.status(403).json({
      error: { code: 'PROJECT_ACCESS_DENIED', message: 'An active linked project account is required' },
    })
  }

  req.projectUser = {
    id: user.id,
    clerkUserId: userId,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    teamId: user.teamId,
    // Super Admin: an active Organizer whose verified Clerk ID is in SUPER_ADMIN_CLERK_IDS.
    isSuperAdmin: user.role === 'organizer' && isSuperAdminClerkId(userId),
    organizerCampusId: user.role === 'organizer' ? (user.organizerCampusId ?? null) : null,
  }
  return next()
}

module.exports = loadProjectUser
