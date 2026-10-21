// Coordinates account edits with verified Clerk addresses and safe replacement of pending invitations.
const { clerkClient } = require('@clerk/express')
const { withInvitationLock } = require('../repositories/invitation-lifecycle.repository')
const repository = require('../repositories/user-update.repository')
const { listMatchingInvitations, belongsToUser } = require('./clerk-invitations')
const { sendUserInvitation } = require('./user-invitations.service')

const updateUser = async (id, input, actorId) => {
  let invitationRevoked = false
  let result
  try {
    result = await withInvitationLock(id, client => repository.updateUser(client, id, input, actorId, async (user, next) => {
      try {
        if (user.clerk_user_id) {
          const account = await clerkClient.users.getUser(user.clerk_user_id)
          if (account.id !== user.clerk_user_id) return 'identity_conflict'
          const verified = account.emailAddresses.some(address =>
            address.emailAddress.toLowerCase() === next.email && address.verification?.status === 'verified')
          return verified ? null : 'email_verification_required'
        }
        const targetAccounts = await clerkClient.users.getUserList({ emailAddress: [next.email], limit: 100 })
        if (targetAccounts.data.some(account => account.emailAddresses.some(address => address.emailAddress.toLowerCase() === next.email))) return 'identity_conflict'
        const targetInvitations = await listMatchingInvitations(clerkClient, next.email)
        if (targetInvitations.some(item => ['pending', 'accepted'].includes(item.status))) return 'identity_conflict'
        const existing = await listMatchingInvitations(clerkClient, user.email)
        const local = { id: user.user_id, email: user.email }
        if (existing.some(item => ['pending', 'accepted'].includes(item.status) && !belongsToUser(item, local))) return 'identity_conflict'
        if (existing.some(item => item.status === 'accepted' && belongsToUser(item, local))) return 'link_account_first'
        // Fail closed when registration has already happened but local linking is unfinished.
        const oldAccounts = await clerkClient.users.getUserList({ emailAddress: [user.email], limit: 100 })
        if (oldAccounts.data.some(account => account.emailAddresses.some(address => address.emailAddress.toLowerCase() === user.email.toLowerCase()))) return 'link_account_first'
        for (const invitation of existing.filter(item => item.status === 'pending' && belongsToUser(item, local))) {
          invitationRevoked = true
          const revoked = await clerkClient.invitations.revokeInvitation(invitation.id)
          if (revoked.status !== 'revoked') return 'email_change_needs_review'
        }
        return null
      } catch {
        return invitationRevoked ? 'email_change_needs_review' : 'identity_provider_unavailable'
      }
    }))
  } catch (error) {
    if (invitationRevoked) return { outcome: 'email_change_needs_review' }
    throw error
  }
  if (result.outcome === 'updated' && result.invitationRequired) {
    // Dispatch only after the database commits and the account lock has been released.
    try { result.delivery = await sendUserInvitation(id, actorId) }
    catch { result.delivery = { outcome: 'needs_review' } }
  }
  return result
}

module.exports = { updateUser }
