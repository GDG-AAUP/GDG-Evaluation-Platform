
const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../src/app');
const pool = require('../src/config/db');

test('Archived rankings work through the real Express app', {
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

  let teamId = 1;
  let campusId = 1;

  await t.test('Loads actual team and campus IDs', async () => {
    const { response, body } = await request(
      '/api/rankings/options'
    );

    assert.equal(response.status, 200);

    assert.ok(Array.isArray(body.data.teams));
    assert.ok(Array.isArray(body.data.campuses));

    teamId = body.data.teams[0]?.id ?? 1;
    campusId = body.data.campuses[0]?.id ?? 1;
  });

  await t.test('Guest can access archived Team rankings', async () => {
    const { response, body } = await request(
      `/api/rankings/archived?scope=team&teamId=${teamId}&year=2026&month=9`
    );

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.data));
  });

  await t.test('Guest can access archived Campus rankings', async () => {
    const { response, body } = await request(
      `/api/rankings/archived?scope=campus&campusId=${campusId}&year=2026&month=9`
    );

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.data));
  });

  await t.test('Invalid archived month returns 400', async () => {
    const { response, body } = await request(
      `/api/rankings/archived?scope=team&teamId=${teamId}&year=2026&month=13`
    );

    assert.equal(response.status, 400);
    assert.equal(
      body.error.code,
      'INVALID_RANKING_QUERY'
    );
  });

  await t.test('Combined global ranking is rejected', async () => {
    const { response, body } = await request(
      '/api/rankings/archived?scope=global&year=2026&month=9'
    );

    assert.equal(response.status, 400);
    assert.equal(
      body.error.code,
      'INVALID_RANKING_QUERY'
    );
  });

  await t.test('Archived rows contain only public fields', async () => {
    const { response, body } = await request(
      `/api/rankings/archived?scope=team&teamId=${teamId}&year=2026&month=9`
    );

    assert.equal(response.status, 200);

    for (const row of body.data) {
      assert.deepEqual(
        Object.keys(row).sort(),
        ['fullName', 'rank', 'totalPoints', 'userId']
      );
    }
  });
});
