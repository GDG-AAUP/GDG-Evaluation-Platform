// Reads exact invitation matches with pagination; never returns invitation URLs to clients.
const normalizeEmail = (email) => email.trim().toLowerCase()

const listMatchingInvitations = async (clerk, email) => {
  const results = new Map()
  for (const status of ['pending', 'accepted', 'expired', 'revoked']) {
    let complete = false
    for (let offset = 0; offset < 2000; offset += 100) {
      let page
      try {
        page = await clerk.invitations.getInvitationList({ query: email, status, limit: 100, offset })
      } catch {
        const error = new Error('Identity provider is temporarily unavailable')
        error.code = 'CLERK_UNAVAILABLE'
        throw error
      }
      for (const invitation of page.data) {
        if (normalizeEmail(invitation.emailAddress) === normalizeEmail(email)) results.set(invitation.id, invitation)
      }
      if (page.data.length < 100 || offset + page.data.length >= page.totalCount) {
        complete = true
        break
      }
    }
    if (!complete) throw new Error('Invitation lookup requires manual review')
  }
  return [...results.values()]
}

const belongsToUser = (invitation, user) =>
  normalizeEmail(invitation.emailAddress) === normalizeEmail(user.email) &&
  invitation.publicMetadata?.projectUserId === String(user.id)

module.exports = { normalizeEmail, listMatchingInvitations, belongsToUser }
