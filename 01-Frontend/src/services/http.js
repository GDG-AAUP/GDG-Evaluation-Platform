import { API_URL } from '../config.js';
import { createHttp } from './httpCore.js';
import { notifyUnauthorized } from './session.js';

// Real REST client (used when VITE_USE_MOCK=false). Conventions of the real backend
// (envelope { data }, Arabic error translation, Bearer token) live in httpCore.js.
//
// Where does the Bearer token come from?
//   - Real backend: a Clerk session token. Register Clerk once at start-up with
//       setAuthProvider({ getToken: () => clerk.session?.getToken(), signOut: () => clerk.signOut() })
//     The token is short-lived, so it is requested for EVERY call and never stored.
//   - Mock mode: a fake token kept in sessionStorage (setAuthToken / getAuthToken).

const TOKEN_KEY = 'gdg-token';
let provider = null;

export function setAuthProvider(p) { provider = p || null; }
export function getAuthProvider() { return provider; }

export function getAuthToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setAuthToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

/** Current Bearer token: from the auth provider (Clerk) when registered, else sessionStorage. */
export async function getAccessToken() {
  if (provider) return provider.getToken();
  return getAuthToken();
}

export const http = createHttp({
  baseUrl: API_URL,
  getToken: getAccessToken,
  onUnauthorized: notifyUnauthorized,
  origin: typeof window !== 'undefined' ? window.location.origin : undefined,
});
