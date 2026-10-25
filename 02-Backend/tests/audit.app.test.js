
const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../src/app');
const pool = require('../src/config/db');

test('Audit API is protected in the real Express app', {
  timeout: 120000
}, async (t) => {
  const server = await new Promise(resolve => {
    const listener = app.listen(
      0,
      '127.0.0.1',
      () => resolve(listener)
    );
  });

  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  });

  async function request(path) {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}${path}`
    );

    return {
      response,
      body: await response.json()
    };
  }

  await t.test('Guest cannot access audit logs', async () => {
    const { response, body } = await request('/api/audit');

    assert.equal(response.status, 401);
    assert.equal(body.error.code, 'UNAUTHENTICATED');
  });

  await t.test('Filters cannot bypass authentication', async () => {
    const { response, body } = await request(
      '/api/audit?actorId=1&action=POINT_CREATED&page=1'
    );

    assert.equal(response.status, 401);
    assert.equal(body.error.code, 'UNAUTHENTICATED');
  });

  await t.test('Protected points endpoint still requires login', async () => {
    const { response } = await request('/api/points/me');

    assert.equal(response.status, 401);
  });

  await t.test('Public ranking options still work', async () => {
    const { response, body } = await request(
      '/api/rankings/options'
    );

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.data.campuses));
    assert.ok(Array.isArray(body.data.teams));
  });

  await t.test('Public archived rankings still work', async () => {
    const { response, body } = await request(
      '/api/rankings/archived?scope=team&teamId=2&year=2026&month=9'
    );

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.data));
  });

  await t.test('Invalid public ranking query returns 400', async () => {
    const { response, body } = await request(
      '/api/rankings?scope=global&year=2026&month=10'
    );

    assert.equal(response.status, 400);
    assert.equal(
      body.error.code,
      'INVALID_RANKING_QUERY'
    );
  });
});
