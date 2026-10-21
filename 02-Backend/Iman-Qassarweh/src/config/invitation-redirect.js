// Chooses a trusted application page for accepting invitations, independent of request headers.
const getInvitationRedirectUrl = () => {
  const configured = process.env.CLERK_INVITATION_REDIRECT_URL
  if (!configured) {
    const error = new Error('CLERK_INVITATION_REDIRECT_URL must point to the frontend invitation acceptance page')
    error.code = 'INVITATION_REDIRECT_NOT_CONFIGURED'
    throw error
  }
  const url = new URL(configured)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && process.env.NODE_ENV !== 'production'))) {
    throw new Error('Invitation redirect must use HTTPS or a local development address')
  }
  return url.href
}

module.exports = { getInvitationRedirectUrl }
