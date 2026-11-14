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
/** Clerk can briefly return no token while a session settles: wait for one before sending. */
export async function waitForToken(getToken, { attempts = 10, delayMs = 150 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const token = await getToken();
    if (token || attempt >= attempts) return token;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export function createHttp({ baseUrl, getToken, onUnauthorized, fetchImpl, origin }) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));

  function buildUrl(path, params) {
    const url = new URL(String(baseUrl).replace(/\/$/, '') + path, origin || 'http://localhost');
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
    return url.toString();
  }

  async function request(method, path, { params, body, auth = true, headers: extra, requireToken = false } = {}) {
    const headers = { Accept: 'application/json', ...(extra || {}) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && getToken) {
      const token = await getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      // The session is still settling: do not send a request the server can only refuse.
      else if (requireToken) throw new ApiError(0, 'جلسة الدخول لم تجهز بعد. انتظر لحظة ثم أعد المحاولة.', { code: 'TOKEN_NOT_READY' });
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
      // A valid Clerk session with no project account is not an expired session.
      if (res.status === 401 && auth && onUnauthorized && details?.code !== 'USER_NOT_FOUND_IN_DB') onUnauthorized();
      throw new ApiError(res.status, message, details);
    }

    if (data && typeof data === 'object' && !Array.isArray(data) && 'data' in data) return data.data;
    return data;
  }

  return {
    get: (path, params, opts) => request('GET', path, { params, ...opts }),
    post: (path, body, opts) => request('POST', path, { body: body ?? {}, ...opts }),
    /**
     * POST that is safe to repeat (the server updates the same record): waits for a token and
     * retries once after a dropped connection (status 0), e.g. while a dev server restarts.
     */
    postIdempotent: async (path, body, opts = {}) => {
      try {
        return await request('POST', path, { body: body ?? {}, requireToken: true, ...opts });
      } catch (error) {
        if (error.status !== 0) throw error;
        await new Promise((resolve) => setTimeout(resolve, opts.retryDelayMs ?? 800));
        return request('POST', path, { body: body ?? {}, requireToken: true, ...opts });
      }
    },
    put: (path, body) => request('PUT', path, { body: body ?? {} }),
    patch: (path, body) => request('PATCH', path, { body: body ?? {} }),
    del: (path, body) => request('DELETE', path, { body }),
  };
}
