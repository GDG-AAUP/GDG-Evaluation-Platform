// Sends, reviews, or explicitly resends invitations while recovering uncertain delivery safely.
const { clerkClient } = require('@clerk/express')
const lifecycle = require('../repositories/invitation-lifecycle.repository')
const { listMatchingInvitations, belongsToUser } = require('./clerk-invitations')
const { getInvitationRedirectUrl } = require('../config/invitation-redirect')

const result = (outcome, user, extra = {}) => ({
  outcome, userId: user.id, invitationStatus: user.invitationStatus, ...extra,
})

const processInvitation = async (userId, actorId, mode) => lifecycle.withInvitationLock(userId, async (client) => {
  let user = await lifecycle.readInvitationUser(client, userId)
  if (!user) return { outcome: 'not_found', userId }
  if (!await lifecycle.isActiveOrganizer(client, actorId)) return result('forbidden', user)
  if (user.deletedAt) return result('deleted', user)
  if (user.isActive !== true) return result('inactive', user)
  if (user.clerkUserId) return result('already_linked', user)
  if (user.invitationStatus === 'not_required') return result('not_invitable', user)

  try {
    const invitations = await listMatchingInvitations(clerkClient, user.email)
    const own = invitations.filter((invitation) => belongsToUser(invitation, user))
    const accepted = own.filter((invitation) => invitation.status === 'accepted')
    if (accepted.length > 1) return result('needs_review', user)
    if (accepted.length === 1) {
      user = await lifecycle.changeInvitationState(client, user, 'sent', actorId, accepted[0])
      return user ? result('accepted_at_clerk', user) : { outcome: 'needs_review', userId }
    }
    const pending = own.filter((invitation) => invitation.status === 'pending')
    if (pending.length > 1) return result('needs_review', user)
    const foreign = invitations.some((invitation) =>
      ['pending', 'accepted'].includes(invitation.status) && !belongsToUser(invitation, user))
    if (foreign) return result('identity_conflict', user)

    if (pending.length === 1 && mode !== 'resend') {
      user = await lifecycle.changeInvitationState(client, user, 'sent', actorId, pending[0])
      return user ? result('existing_invitation', user) : { outcome: 'needs_review', userId }
    }
    if (mode === 'review') return result('no_active_invitation', user)
    if (mode === 'send' && !['pending', 'failed'].includes(user.invitationStatus)) {
      return result('needs_review', user)
    }
    if (user.invitedAt && Date.now() - new Date(user.invitedAt).getTime() < 60000) {
      return result('cooldown', user)
    }
    const accounts = await clerkClient.users.getUserList({ emailAddress: [user.email], limit: 100 })
    if (accounts.data.some((account) => account.emailAddresses.some(
      (address) => address.emailAddress.toLowerCase() === user.email.toLowerCase(),
    ))) return result('identity_conflict', user)

    const redirectUrl = getInvitationRedirectUrl()
    const current = await lifecycle.readInvitationUser(client, userId)
    if (!current?.isActive || !await lifecycle.isActiveOrganizer(client, actorId)) return result('forbidden', user)
    if (current.clerkUserId || current.email !== user.email) return result('needs_review', current)
    user = await lifecycle.changeInvitationState(client, current, 'sending', actorId)
    if (!user) return { outcome: 'needs_review', userId }

    if (pending.length === 1) {
      const revoked = await clerkClient.invitations.revokeInvitation(pending[0].id)
      if (revoked.status !== 'revoked') return result('needs_review', user)
    }
    const invitation = await clerkClient.invitations.createInvitation({
      emailAddress: user.email, notify: true, ignoreExisting: false,
      redirectUrl,
      publicMetadata: { projectUserId: String(user.id) },
    })
    if (!invitation?.id || !belongsToUser(invitation, user) || invitation.status !== 'pending') {
      return result('needs_review', user)
    }
    user = await lifecycle.changeInvitationState(client, user, 'sent', actorId, invitation)
    return user ? result('sent', user) : { outcome: 'needs_review', userId }
  } catch (error) {
    if (error.code === 'INVITATION_REDIRECT_NOT_CONFIGURED') return result('configuration_required', user)
    // Do not expose Clerk payloads, addresses, invitation links, or credentials.
    console.warn('Invitation operation requires review:', Number.isInteger(error.status) ? error.status : 'provider_or_database_error')
    return user ? result('needs_review', user) : { outcome: 'needs_review', userId }
  }
})

const sendUserInvitation = (userId, actorId) => processInvitation(userId, actorId, 'send')
const reviewUserInvitation = (userId, actorId) => processInvitation(userId, actorId, 'review')
const resendUserInvitation = (userId, actorId) => processInvitation(userId, actorId, 'resend')

module.exports = { sendUserInvitation, reviewUserInvitation, resendUserInvitation }
