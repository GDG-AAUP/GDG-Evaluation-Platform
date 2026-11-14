
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getTeamRanking
} = require('../dist/phase2/rankings/get-team-ranking.js');

function mockPool(rows = []) {
  const calls = [];

  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows };
    }
  };

  return { pool, calls };
}

test('returns ranking rows from PostgreSQL', async () => {
  const rows = [
    {
      rank: 1,
      userId: 7,
      fullName: 'Sara',
      totalPoints: 90
    },
    {
      rank: 2,
      userId: 8,
      fullName: 'Omar',
      totalPoints: 50
    }
  ];

  const { pool } = mockPool(rows);

  const result = await getTeamRanking(
    pool, 2, 2026, 10
  );

  assert.deepEqual(result, rows);
});

test('uses parameterized query values', async () => {
  const { pool, calls } = mockPool();

  await getTeamRanking(pool, 2, 2026, 10);

  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls[0].params,
    [2, 2026, 10]
  );

  assert.match(calls[0].sql, /\$1/);
  assert.match(calls[0].sql, /\$2/);
  assert.match(calls[0].sql, /\$3/);
});

test('uses monthly historical assignments', async () => {
  const { pool, calls } = mockPool();

  await getTeamRanking(pool, 2, 2026, 10);

  const sql = calls[0].sql;

  assert.match(sql, /assignment_history/i);
  assert.match(sql, /effective_from/i);
  assert.match(sql, /effective_to/i);
  assert.match(sql, /effective_at/i);
  assert.match(sql, /make_date/i);
  assert.match(sql, /EXISTS/i);
});

test('uses dense ranking and point totals', async () => {
  const { pool, calls } = mockPool();

  await getTeamRanking(pool, 2, 2026, 10);

  const sql = calls[0].sql;

  assert.match(sql, /DENSE_RANK\s*\(/i);
  assert.match(sql, /SUM\s*\(\s*p\.points\s*\)/i);
  assert.match(sql, /COALESCE/i);
  assert.match(sql, /ORDER BY/i);
});

test('preserves tied and negative totals', async () => {
  const rows = [
    { rank: 1, userId: 7, fullName: 'Sara', totalPoints: 80 },
    { rank: 1, userId: 8, fullName: 'Omar', totalPoints: 80 },
    { rank: 2, userId: 9, fullName: 'Lina', totalPoints: -10 }
  ];

  const { pool } = mockPool(rows);

  const result = await getTeamRanking(
    pool, 2, 2026, 10
  );

  assert.equal(result[0].rank, 1);
  assert.equal(result[1].rank, 1);
  assert.equal(result[2].rank, 2);
  assert.equal(result[2].totalPoints, -10);
});

test('returns an empty list when there are no rows', async () => {
  const { pool } = mockPool();

  const result = await getTeamRanking(
    pool, 2, 2026, 10
  );

  assert.deepEqual(result, []);
});

test('propagates database errors', async () => {
  const pool = {
    query: async () => {
      throw new Error('Database failure');
    }
  };

  await assert.rejects(
    getTeamRanking(pool, 2, 2026, 10),
    /Database failure/
  );
});
