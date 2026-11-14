// Pure helpers for Clerk invitation links (no browser/Vite globals, so they are unit-tested in Node).
//
// The backend (02-Backend, CLERK_INVITATION_REDIRECT_URL) only accepts a redirect URL WITHOUT a
// "#fragment" or query string, e.g.  http://localhost:5173/accept-invitation
// Clerk then appends  ?__clerk_ticket=...&__clerk_status=sign_up  when it opens the invitation.
// The app itself uses a hash router, so the plain path is converted once on start-up:
//   /accept-invitation?__clerk_ticket=..   ->   /?__clerk_ticket=..#/accept-invitation

export const INVITE_ROUTE = '/accept-invitation';

/** Reads the Clerk invitation parameters from a query string ("?__clerk_ticket=...&__clerk_status=..."). */
export function parseInvitation(search) {
  const p = new URLSearchParams(search || '');
  const ticket = p.get('__clerk_ticket') || '';
  const raw = p.get('__clerk_status') || '';
  const known = ['sign_in', 'sign_up', 'complete'];
  const status = known.includes(raw) ? raw : (ticket ? 'sign_up' : '');
  return { ticket, status };
}

/**
 * Where to send the browser when it opened the plain-path invitation URL, or null when no
 * conversion is needed. `pathname` may carry a sub-path prefix ("/app/accept-invitation").
 */
export function invitationRedirect({ pathname, search }) {
  const m = /^(.*\/)accept-invitation\/?$/.exec(pathname || '');
  if (!m) return null;
  return `${m[1]}${search || ''}#${INVITE_ROUTE}`;
}
