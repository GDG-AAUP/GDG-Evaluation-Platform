const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createAssistantRouter } = require('../dist/phase2/assistant/assistant.routes.js');

const ENV = { CHATBOT_URL: 'http://chatbot.test/', CHATBOT_INTERNAL_KEY: 'internal' };

async function ask(t, options, body = { question: 'كم نقاطي؟' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.projectUser = { id: 7, role: 'member', teamId: 1, name: 'A' }; next(); });
  app.use('/assistant', createAssistantRouter(options));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-token' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

const replying = (status, json) => async () => new Response(JSON.stringify(json), { status });

test('forwards the question with the user token and internal key', async (t) => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ answer: 'لديك 10 نقاط' }), { status: 200 });
  };
  const { status, body } = await ask(t, { env: ENV, fetchImpl });
  assert.equal(status, 200);
  assert.equal(body.data.answer, 'لديك 10 نقاط');
  assert.equal(seen.url, 'http://chatbot.test/chat');
  assert.equal(seen.init.headers.Authorization, 'Bearer user-token');
  assert.equal(seen.init.headers['X-Internal-Key'], 'internal');
});

test('rejects empty and oversized questions without calling the service', async (t) => {
  const fetchImpl = async () => { throw new Error('must not be called'); };
  assert.equal((await ask(t, { env: ENV, fetchImpl }, { question: '  ' })).status, 400);
  assert.equal((await ask(t, { env: ENV, fetchImpl }, { question: 'x'.repeat(2001) })).status, 400);
});

test('missing configuration is a clean 503', async (t) => {
  const { status, body } = await ask(t, { env: {} });
  assert.equal(status, 503);
  assert.equal(body.error.code, 'ASSISTANT_UNAVAILABLE');
});

test('service failures never leak details', async (t) => {
  const { status, body } = await ask(t, { env: ENV, fetchImpl: replying(500, { detail: 'stack trace' }) });
  assert.equal(status, 503);
  assert.ok(!JSON.stringify(body).includes('stack trace'));
});

test('known chatbot failure codes are passed on as a reason', async (t) => {
  const retired = await ask(t, { env: ENV, fetchImpl: replying(503, { detail: { code: 'AI_MODEL_UNAVAILABLE' } }) });
  assert.equal(retired.status, 503);
  assert.equal(retired.body.error.code, 'ASSISTANT_UNAVAILABLE');
  assert.equal(retired.body.error.reason, 'AI_MODEL_UNAVAILABLE');

  const unknown = await ask(t, { env: ENV, fetchImpl: replying(503, { detail: { code: '<script>' } }) });
  assert.equal(unknown.body.error.reason, 'AI_UNAVAILABLE');

  const wrongKey = await ask(t, { env: ENV, fetchImpl: replying(403, { detail: { code: 'FORBIDDEN' } }) });
  assert.equal(wrongKey.body.error.reason, 'CHATBOT_KEY_MISMATCH');
});

test('network failure and timeout are distinguished', async (t) => {
  const down = await ask(t, { env: ENV, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(down.status, 503);
  const slow = await ask(t, {
    env: ENV,
    fetchImpl: async () => { throw Object.assign(new Error('late'), { name: 'TimeoutError' }); }
  });
  assert.equal(slow.status, 504);
});

test('an expired user token stays a 401', async (t) => {
  assert.equal((await ask(t, { env: ENV, fetchImpl: replying(401, {}) })).status, 401);
});

test('limits each user to 20 questions a minute', async (t) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.projectUser = { id: 7, role: 'member', teamId: 1, name: 'A' }; next(); });
  app.use('/assistant', createAssistantRouter({ env: ENV, fetchImpl: replying(200, { answer: 'ok' }) }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const statuses = [];
  for (let i = 0; i < 21; i += 1) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'q' })
    });
    await response.json();
    statuses.push(response.status);
  }
  assert.equal(statuses[19], 200);
  assert.equal(statuses[20], 429);
});
