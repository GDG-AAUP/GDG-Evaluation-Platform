// First-click reliability of the HTTP client: wait for a Clerk token, never send an unauthenticated
// request that the server can only refuse, and retry a safe POST once after a dropped connection.
// Run: node --test src/services/httpCore.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttp, waitForToken } from './httpCore.js';

const ok = (data, status = 200) => ({ ok: true, status, json: async () => ({ data }) });

test('a token that arrives late is awaited before the request is sent', async () => {
  let calls = 0;
  const getToken = async () => (++calls < 4 ? null : 'tok');
  assert.equal(await waitForToken(getToken, { attempts: 10, delayMs: 1 }), 'tok');
  assert.equal(calls, 4);
});

test('postIdempotent refuses to send without a token (no false "session expired")', async () => {
  let fetched = 0;
  let unauthorized = 0;
  const http = createHttp({
    baseUrl: 'http://api.test/api', getToken: async () => null, onUnauthorized: () => { unauthorized += 1; },
    fetchImpl: async () => { fetched += 1; return ok({}); },
  });
  await assert.rejects(() => http.postIdempotent('/registrations/request', { role: 'member' }),
    (e) => e.status === 0 && e.details.code === 'TOKEN_NOT_READY' && /جلسة الدخول لم تجهز بعد/.test(e.message));
  assert.equal(fetched, 0);
  assert.equal(unauthorized, 0);
});

test('postIdempotent retries once after a dropped connection, then succeeds', async () => {
  const seen = [];
  let attempt = 0;
  const http = createHttp({
    baseUrl: 'http://api.test/api', getToken: async () => 'tok',
    fetchImpl: async (url, init) => {
      seen.push(init.headers.Authorization);
      attempt += 1;
      if (attempt === 1) throw new TypeError('Failed to fetch');
      return ok({ id: 9, status: 'pending' }, 201);
    },
  });
  const res = await http.postIdempotent('/registrations/request', { role: 'member' }, { retryDelayMs: 1 });
  assert.deepEqual(res, { id: 9, status: 'pending' });
  assert.equal(attempt, 2);
  assert.deepEqual(seen, ['Bearer tok', 'Bearer tok']);
});

test('postIdempotent does not retry a real server answer (e.g. 409)', async () => {
  let attempt = 0;
  const http = createHttp({
    baseUrl: 'http://api.test/api', getToken: async () => 'tok',
    fetchImpl: async () => { attempt += 1; return { ok: false, status: 409, json: async () => ({ error: { code: 'REGISTRATION_REJECTED' } }) }; },
  });
  await assert.rejects(() => http.postIdempotent('/registrations/request', {}, { retryDelayMs: 1 }), (e) => e.status === 409);
  assert.equal(attempt, 1);
});
