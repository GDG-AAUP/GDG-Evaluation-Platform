// Tests trusted invitation destinations for the frontend integration.
const test = require('node:test')
const assert = require('node:assert/strict')
const { getInvitationRedirectUrl } = require('../src/config/invitation-redirect')

test('invitation destinations require configuration and HTTPS outside local development', () => {
  const originalUrl = process.env.CLERK_INVITATION_REDIRECT_URL
  const originalMode = process.env.NODE_ENV
  try {
    process.env.NODE_ENV = 'development'
    delete process.env.CLERK_INVITATION_REDIRECT_URL
    assert.throws(getInvitationRedirectUrl)
    process.env.CLERK_INVITATION_REDIRECT_URL = 'http://localhost:3000/accept-invitation'
    assert.equal(getInvitationRedirectUrl(), 'http://localhost:3000/accept-invitation')
    process.env.NODE_ENV = 'production'
    assert.throws(getInvitationRedirectUrl)
    process.env.CLERK_INVITATION_REDIRECT_URL = 'https://gdg.example/accept-invitation'
    assert.equal(getInvitationRedirectUrl(), 'https://gdg.example/accept-invitation')
    for (const url of ['http://gdg.example/accept', 'https://name:password@gdg.example/accept', 'https://gdg.example/accept?next=elsewhere', 'javascript:alert(1)']) {
      process.env.CLERK_INVITATION_REDIRECT_URL = url
      assert.throws(getInvitationRedirectUrl)
    }
  } finally {
    if (originalUrl === undefined) delete process.env.CLERK_INVITATION_REDIRECT_URL
    else process.env.CLERK_INVITATION_REDIRECT_URL = originalUrl
    if (originalMode === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalMode
  }
})
