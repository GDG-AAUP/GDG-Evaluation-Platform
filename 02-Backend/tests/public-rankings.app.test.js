
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

  await t.test('Visitors can load Team rankings', async () => {
    const teamId = teams[0]?.id ?? 1;

    const { response, body } = await request(
      `/api/rankings?scope=team&teamId=${teamId}&year=2026&month=10`
    );

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.data));
  });

  await t.test('Visitors can load Campus rankings', async () => {
    const campusId = campuses[0]?.id ?? 1;

    const { response, body } = await request(
      `/api/rankings?scope=campus&campusId=${campusId}&year=2026&month=10`
    );

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.data));
  });

  await t.test('Invalid ranking queries return 400', async () => {
    const { response, body } = await request(
      '/api/rankings?scope=team&teamId=2&year=2026&month=15'
    );

    assert.equal(response.status, 400);
    assert.equal(
      body.error.code,
      'INVALID_RANKING_QUERY'
    );
  });

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
