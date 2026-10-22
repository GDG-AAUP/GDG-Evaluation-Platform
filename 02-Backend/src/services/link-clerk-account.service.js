// Links only the authenticated Clerk identity after invitation and verified-email checks.
const { clerkClient } = require('@clerk/express')
const lifecycle = require('../repositories/invitation-lifecycle.repository')
const { listMatchingInvitations, belongsToUser, normalizeEmail } = require('./clerk-invitations')

const linkClerkAccount = async (clerkUserId) => {
  let clerkUser
  try {
    clerkUser = await clerkClient.users.getUser(clerkUserId)
  } catch (cause) {
    if (cause.status === 404) return null
    const error = new Error('Identity provider is temporarily unavailable')
    error.code = 'CLERK_UNAVAILABLE'
    throw error
  }
  const localId = clerkUser.publicMetadata?.projectUserId
  if (typeof localId !== 'string' || !/^[1-9]\d*$/.test(localId)) return null
  const userId = Number(localId)
  if (!Number.isSafeInteger(userId) || userId > 2147483647) return null

  const outcome = await lifecycle.withInvitationLock(userId, async (client) => {
    let user = await lifecycle.readInvitationUser(client, userId)
    if (!user || !user.isActive || user.deletedAt) return null
    if (user.clerkUserId) {
      if (user.clerkUserId !== clerkUserId) return null
      const existing = await client.query(
        `SELECT user_id AS id, full_name AS name, LOWER(role) AS role, team_id AS "teamId",
           is_active AS "isActive", clerk_user_id AS "clerkUserId" FROM users WHERE user_id = $1`, [userId],
      )
      return existing.rows[0] ?? null
    }
    if (!['pending', 'sending', 'sent', 'failed'].includes(user.invitationStatus)) return null
    const verifiedEmail = clerkUser.emailAddresses.some((address) =>
      normalizeEmail(address.emailAddress) === normalizeEmail(user.email) && address.verification?.status === 'verified')
    if (!verifiedEmail) return null

    const invitations = await listMatchingInvitations(clerkClient, user.email)
    const accepted = invitations.filter((invitation) =>
      invitation.status === 'accepted' && belongsToUser(invitation, user))
    if (accepted.length !== 1) return null
    if (user.invitationStatus !== 'sent' || user.invitationId !== accepted[0].id) {
      user = await lifecycle.changeInvitationState(client, user, 'sent', null, accepted[0])
      if (!user) return null
    }
    return lifecycle.saveAcceptedIdentity(client, user, clerkUserId)
  })
  if (outcome?.outcome === 'busy') {
    const error = new Error('Account linking is in progress; retry shortly')
    error.code = 'INVITATION_BUSY'
    throw error
  }
  return outcome
}

module.exports = { linkClerkAccount }
