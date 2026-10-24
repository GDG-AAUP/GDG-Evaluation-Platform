import { API_URL } from '../config.js';
import { ApiError } from './errors.js';
import { notifyUnauthorized } from './session.js';

// Real REST client (used when VITE_USE_MOCK=false).
// Auth: Bearer token kept in sessionStorage. The backend should ideally use
// httpOnly cookies instead; switch `credentials: 'include'` below if it does.

const TOKEN_KEY = 'gdg-token';

export function getAuthToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setAuthToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

function buildUrl(path, params) {
  const url = new URL(API_URL.replace(/\/$/, '') + path, window.location.origin);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  return url.toString();
}

async function request(method, path, { params, body, auth = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getAuthToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(buildUrl(path, params), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'تعذّر الاتصال بالخادم. تحقق من الشبكة وأعد المحاولة.');
  }

  let data = null;
  if (res.status !== 204) {
    try { data = await res.json(); } catch { data = null; }
  }

  if (!res.ok) {
    // Expected error body: { "message": "<Arabic sentence>", "details": {...} }
    const message = (data && data.message) || 'حدث خطأ غير متوقع. حاول مرة أخرى.';
    if (res.status === 401 && auth) notifyUnauthorized();
    throw new ApiError(res.status, message, data && data.details);
  }
  return data;
}

export const http = {
  get: (path, params, opts) => request('GET', path, { params, ...opts }),
  post: (path, body, opts) => request('POST', path, { body: body ?? {}, ...opts }),
  put: (path, body) => request('PUT', path, { body: body ?? {} }),
  patch: (path, body) => request('PATCH', path, { body: body ?? {} }),
  del: (path, body) => request('DELETE', path, { body }),
};
