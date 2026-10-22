// Loads active project accounts and securely links accepted Clerk invitations on first access.
const { getAuth } = require('@clerk/express')
const repository = require('../repositories/users.repository')
const { linkClerkAccount } = require('../services/link-clerk-account.service')

const loadProjectUser = async (req, res, next) => {
  const { userId } = getAuth(req)

  if (!userId) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication is required' },
    })
  }

  let user = await repository.findUserByClerkId(userId)
  if (!user) {
    user = await linkClerkAccount(userId)
  }
  if (!user || user.isActive !== true || user.deletedAt ||
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
  }
  return next()
}

module.exports = loadProjectUser
