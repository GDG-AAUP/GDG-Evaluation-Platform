
const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../src/app');
const pool = require('../src/config/db');

test('Archived rankings require login in the real Express app', {
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

  for (const query of [
    'scope=team&teamId=1&year=2026&month=9',
    'scope=campus&campusId=1&year=2026&month=9',
    'scope=team&teamId=1&year=2026&month=13'
  ]) {
    await t.test(`Guest is refused: ${query}`, async () => {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/rankings/archived?${query}`
      );
      const body = await response.json();

      assert.equal(response.status, 401);
      assert.equal(body.error.code, 'UNAUTHENTICATED');
    });
  }
});
