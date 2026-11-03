import { api } from './call.js';
import { http, setAuthToken, getAuthToken, getAuthProvider } from './http.js';
import * as E from './mock/engine.js';
import { backend } from './backend/index.js';

export async function login(email, password) {
  const res = await api(
    (db, a) => E.login(db, a, { email, password }),
    () => http.post('/auth/login', { email, password }, { auth: false }),
    { public: true },
  );
  setAuthToken(res.token);
  return res.user;
}

export function logout() {
  const provider = getAuthProvider();
  const hadToken = !!getAuthToken();
  setAuthToken(null);
  // Real backend: the session lives in Clerk, so signing out means signing out of Clerk.
  if (provider && provider.signOut) return Promise.resolve(provider.signOut()).catch(() => null);
  // Mock mode (unchanged): clears the simulated session.
  if (hadToken) return api(() => ({ ok: true }), () => http.post('/auth/logout').catch(() => null), { public: true });
  return Promise.resolve();
}

/** Restores the session on page load. Resolves to null when not signed in. */
export async function currentUser() {
  // A Clerk provider (real backend) holds its own session; otherwise the mock token is required.
  if (!getAuthProvider() && !getAuthToken()) return null;
  try {
    return await api((db, a) => E.me(db, a), () => backend.me());
  } catch (e) {
    if (e.status === 401) { setAuthToken(null); return null; }
    throw e;
  }
}

/** Real backend only: links the Clerk account that just accepted an invitation. */
export function completeRegistration() {
  return api(() => { throw new Error('completeRegistration is only available with the real backend'); }, () => backend.completeRegistration());
}
