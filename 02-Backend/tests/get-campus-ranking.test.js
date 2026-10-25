
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getCampusRanking
} = require('../dist/phase2/rankings/get-campus-ranking.js');

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

test('returns Campus ranking rows', async () => {
  const rows = [
    {
      rank: 1,
      userId: 7,
      fullName: 'Lina',
      totalPoints: 90
    },
    {
      rank: 2,
      userId: 8,
      fullName: 'Sara',
      totalPoints: 80
    }
  ];

  const { pool } = mockPool(rows);

  const result = await getCampusRanking(
    pool, 1, 2026, 10
  );

  assert.deepEqual(result, rows);
});

test('uses parameterized Campus, year, and month', async () => {
  const { pool, calls } = mockPool();

  await getCampusRanking(pool, 1, 2026, 10);

  assert.equal(calls.length, 1);

  assert.deepEqual(
    calls[0].params,
    [1, 2026, 10]
  );

  assert.match(calls[0].sql, /\$1/);
  assert.match(calls[0].sql, /\$2/);
  assert.match(calls[0].sql, /\$3/);
});

test('uses Campus membership through teams', async () => {
  const { pool, calls } = mockPool();

  await getCampusRanking(pool, 1, 2026, 10);

  const sql = calls[0].sql;

  assert.match(sql, /assignment_history/i);
  assert.match(sql, /JOIN\s+teams/i);
  assert.match(sql, /campus_id/i);
  assert.match(sql, /effective_from/i);
  assert.match(sql, /effective_to/i);
});

test('uses point dates and historical Campus attribution', async () => {
  const { pool, calls } = mockPool();

  await getCampusRanking(pool, 1, 2026, 10);

  const sql = calls[0].sql;

  assert.match(sql, /point_entries/i);
  assert.match(sql, /effective_at/i);
  assert.match(sql, /make_date/i);
  assert.match(sql, /EXISTS/i);
  assert.match(sql, /ht\.campus_id\s*=\s*\$1/i);
});

test('uses dense ranking with aggregated points', async () => {
  const { pool, calls } = mockPool();

  await getCampusRanking(pool, 1, 2026, 10);

  const sql = calls[0].sql;

  assert.match(sql, /DENSE_RANK\s*\(/i);
  assert.match(sql, /SUM\s*\(\s*p\.points\s*\)/i);
  assert.match(sql, /COALESCE/i);
  assert.match(sql, /ORDER BY/i);
});

test('preserves tied scores across different teams', async () => {
  const rows = [
    {
      rank: 1,
      userId: 7,
      fullName: 'Lina',
      totalPoints: 90
    },
    {
      rank: 2,
      userId: 8,
      fullName: 'Sara',
      totalPoints: 40
    },
    {
      rank: 2,
      userId: 9,
      fullName: 'Omar',
      totalPoints: 40
    }
  ];

  const { pool } = mockPool(rows);

  const result = await getCampusRanking(
    pool, 1, 2026, 10
  );

  assert.deepEqual(
    result.map(row => row.rank),
    [1, 2, 2]
  );
});

test('returns empty rankings when no rows exist', async () => {
  const { pool } = mockPool();

  const result = await getCampusRanking(
    pool, 1, 2026, 10
  );

  assert.deepEqual(result, []);
});

test('propagates database failures', async () => {
  const pool = {
    query: async () => {
      throw new Error('Campus database failure');
    }
  };

  await assert.rejects(
    getCampusRanking(pool, 1, 2026, 10),
    /Campus database failure/
  );
});
