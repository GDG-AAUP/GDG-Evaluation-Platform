import { api } from './call.js';
import { http, setAuthToken, getAuthToken } from './http.js';
import * as E from './mock/engine.js';

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
  const hadToken = !!getAuthToken();
  setAuthToken(null);
  // Real backend: invalidate the token server-side (fire and forget).
  if (hadToken) return api(() => ({ ok: true }), () => http.post('/auth/logout').catch(() => null), { public: true });
  return Promise.resolve();
}

/** Restores the session on page load. Resolves to null when not signed in. */
export async function currentUser() {
  if (!getAuthToken()) return null;
  try {
    return await api((db, a) => E.me(db, a), () => http.get('/auth/me'));
  } catch (e) {
    if (e.status === 401) { setAuthToken(null); return null; }
    throw e;
  }
}
