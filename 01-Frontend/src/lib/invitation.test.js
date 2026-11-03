import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInvitation, invitationRedirect, INVITE_ROUTE } from './invitation.js';

test('parseInvitation reads the Clerk ticket and status', () => {
  assert.deepEqual(parseInvitation('?__clerk_ticket=abc&__clerk_status=sign_up'), { ticket: 'abc', status: 'sign_up' });
  assert.deepEqual(parseInvitation('?__clerk_ticket=abc&__clerk_status=sign_in'), { ticket: 'abc', status: 'sign_in' });
  assert.deepEqual(parseInvitation('?__clerk_ticket=abc&__clerk_status=complete'), { ticket: 'abc', status: 'complete' });
});

test('parseInvitation defaults a ticket without status to sign_up, and no ticket to empty', () => {
  assert.deepEqual(parseInvitation('?__clerk_ticket=abc'), { ticket: 'abc', status: 'sign_up' });
  assert.deepEqual(parseInvitation('?__clerk_ticket=abc&__clerk_status=weird'), { ticket: 'abc', status: 'sign_up' });
  assert.deepEqual(parseInvitation(''), { ticket: '', status: '' });
  assert.deepEqual(parseInvitation(undefined), { ticket: '', status: '' });
});

test('invitationRedirect converts the backend-accepted plain path into a hash route and keeps the query', () => {
  assert.equal(
    invitationRedirect({ pathname: '/accept-invitation', search: '?__clerk_ticket=abc&__clerk_status=sign_up' }),
    '/?__clerk_ticket=abc&__clerk_status=sign_up#/accept-invitation',
  );
  assert.equal(invitationRedirect({ pathname: '/accept-invitation/', search: '' }), `/#${INVITE_ROUTE}`);
});

test('invitationRedirect keeps a sub-path prefix and ignores every other path', () => {
  assert.equal(invitationRedirect({ pathname: '/gdg/accept-invitation', search: '?__clerk_ticket=t' }), '/gdg/?__clerk_ticket=t#/accept-invitation');
  assert.equal(invitationRedirect({ pathname: '/', search: '?__clerk_ticket=t' }), null);
  assert.equal(invitationRedirect({ pathname: '/index.html', search: '' }), null);
  assert.equal(invitationRedirect({ pathname: '/accept-invitation-x', search: '' }), null);
});
