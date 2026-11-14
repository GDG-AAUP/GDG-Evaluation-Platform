
const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../src/app');
const pool = require('../src/config/db');

test('Public rankings work in the real Express app', {
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

  let campuses = [];
  let teams = [];

  await t.test('Visitors can load ranking filter options', async () => {
    const { response, body } = await request(
      '/api/rankings/options'
    );

    assert.equal(response.status, 200);

    assert.ok(Array.isArray(body.data.campuses));
    assert.ok(Array.isArray(body.data.teams));

    campuses = body.data.campuses;
    teams = body.data.teams;
  });

  await t.test('Options expose only public fields', async () => {
    for (const campus of campuses) {
      assert.deepEqual(
        Object.keys(campus).sort(),
        ['id', 'name']
      );
    }

    for (const team of teams) {
      assert.deepEqual(
        Object.keys(team).sort(),
        ['campusId', 'id', 'name']
      );
    }
  });

  await t.test('Visitors can load the public summary', async () => {
    const campusId = campuses[0]?.id ?? 1;

    const { response, body } = await request(
      `/api/rankings/public-summary?campusId=${campusId}`
    );

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.data.top));
    assert.ok(Array.isArray(body.data.teamLeaders));
  });

  await t.test('Public summary rejects an invalid campus', async () => {
    const { response, body } = await request(
      '/api/rankings/public-summary?campusId=abc'
    );

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'INVALID_RANKING_QUERY');
  });

  await t.test('Full Team rankings require login', async () => {
    const teamId = teams[0]?.id ?? 1;

    const { response, body } = await request(
      `/api/rankings?scope=team&teamId=${teamId}&year=2026&month=10`
    );

    assert.equal(response.status, 401);
    assert.equal(body.error.code, 'UNAUTHENTICATED');
  });

  await t.test('Full Campus rankings require login', async () => {
    const campusId = campuses[0]?.id ?? 1;

    const { response, body } = await request(
      `/api/rankings?scope=campus&campusId=${campusId}&year=2026&month=10`
    );

    assert.equal(response.status, 401);
    assert.equal(body.error.code, 'UNAUTHENTICATED');
  });

  for (const path of ['/api/overview', '/api/archive', '/api/activities', '/api/teams/1/overview', '/api/assistant/data/audit-logs', '/api/policies', '/api/syslog', '/api/awards', '/api/ratings/targets']) {
    await t.test(`${path} requires login`, async () => {
      const { response, body } = await request(path);

      assert.equal(response.status, 401);
      assert.equal(body.error.code, 'UNAUTHENTICATED');
    });
  }

  await t.test('Point history requires login', async () => {
    const { response, body } = await request(
      '/api/points/me'
    );

    assert.equal(response.status, 401);
    assert.equal(
      body.error.code,
      'UNAUTHENTICATED'
    );
  });

  await t.test('Private Campus routes require login', async () => {
    const { response, body } = await request(
      '/api/campuses'
    );

    assert.equal(response.status, 401);
    assert.equal(
      body.error.code,
      'UNAUTHENTICATED'
    );
  });

  await t.test('Private Team routes require login', async () => {
    const { response, body } = await request(
      '/api/teams'
    );

    assert.equal(response.status, 401);
    assert.equal(
      body.error.code,
      'UNAUTHENTICATED'
    );
  });

});
