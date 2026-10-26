import { ApiError } from './errors.js';
import { translateServerError } from './backend/errorsAr.js';

/**
 * HTTP client factory (no browser/Vite globals, so it can be unit-tested in Node).
 *
 * Understands the real backend's conventions (02-Backend/docs/api.md):
 *   - success  -> { "data": ... }   (unwrapped here, services receive the payload)
 *   - failure  -> { "error": { "code": "...", "message": "<English>" } }  (translated to Arabic)
 *   - auth     -> Authorization: Bearer <token>   (token comes from `getToken`, e.g. Clerk)
 * Bodies without a "data"/"error" key (the older mock-style contract) pass through unchanged.
 */
export function createHttp({ baseUrl, getToken, onUnauthorized, fetchImpl, origin }) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));

  function buildUrl(path, params) {
    const url = new URL(String(baseUrl).replace(/\/$/, '') + path, origin || 'http://localhost');
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
    return url.toString();
  }

  async function request(method, path, { params, body, auth = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && getToken) {
      const token = await getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    let res;
    try {
      res = await doFetch(buildUrl(path, params), {
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
      const { message, details } = translateServerError(res.status, data);
      if (res.status === 401 && auth && onUnauthorized) onUnauthorized();
      throw new ApiError(res.status, message, details);
    }

    if (data && typeof data === 'object' && !Array.isArray(data) && 'data' in data) return data.data;
    return data;
  }

  return {
    get: (path, params, opts) => request('GET', path, { params, ...opts }),
    post: (path, body, opts) => request('POST', path, { body: body ?? {}, ...opts }),
    put: (path, body) => request('PUT', path, { body: body ?? {} }),
    patch: (path, body) => request('PATCH', path, { body: body ?? {} }),
    del: (path, body) => request('DELETE', path, { body }),
  };
}
