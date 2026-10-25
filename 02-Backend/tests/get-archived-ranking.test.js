
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getArchivedRanking
} = require('../dist/phase2/rankings/get-archived-ranking.js');

const teamQuery = {
  scope: 'Team',
  year: 2026,
  month: 10,
  teamId: 2,
  campusId: null
};

const campusQuery = {
  scope: 'Campus',
  year: 2026,
  month: 10,
  teamId: null,
  campusId: 1
};

function mockPool(rows = []) {
  const calls = [];

  return {
    calls,
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows };
      }
    }
  };
}

test('returns archived ranking rows', async () => {
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
      totalPoints: 60
    }
  ];

  const mock = mockPool(rows);

  const result = await getArchivedRanking(
    mock.pool,
    teamQuery
  );

  assert.deepEqual(result, rows);
});

test('uses Team scope and parameterized identifiers', async () => {
  const mock = mockPool();

  await getArchivedRanking(mock.pool, teamQuery);

  assert.equal(mock.calls.length, 1);
  assert.deepEqual(
    mock.calls[0].params,
    ['Team', 2026, 10, 2, null]
  );
});

test('uses Campus scope and parameterized identifiers', async () => {
  const mock = mockPool();

  await getArchivedRanking(mock.pool, campusQuery);

  assert.deepEqual(
    mock.calls[0].params,
    ['Campus', 2026, 10, null, 1]
  );
});

test('reads archived snapshots instead of recalculating points', async () => {
  const mock = mockPool();

  await getArchivedRanking(mock.pool, teamQuery);

  const sql = mock.calls[0].sql;

  assert.match(sql, /FROM\s+monthly_rankings/i);
  assert.match(sql, /archived_at\s+IS\s+NOT\s+NULL/i);
  assert.match(sql, /rank_position/i);
  assert.match(sql, /total_points/i);

  assert.doesNotMatch(sql, /\bpoint_entries\b/i);
});

test('filters Team and Campus snapshots by their scope', async () => {
  const mock = mockPool();

  await getArchivedRanking(mock.pool, campusQuery);

  const sql = mock.calls[0].sql;

  assert.match(sql, /ranking_scope\s*=\s*\$1/i);
  assert.match(sql, /r\.team_id\s*=\s*\$4/i);
  assert.match(sql, /r\.campus_id\s*=\s*\$5/i);
  assert.match(sql, /r\.year\s*=\s*\$2/i);
  assert.match(sql, /r\.month\s*=\s*\$3/i);
});

test('returns user names and deterministic rank order', async () => {
  const mock = mockPool();

  await getArchivedRanking(mock.pool, teamQuery);

  const sql = mock.calls[0].sql;

  assert.match(sql, /JOIN\s+users/i);
  assert.match(sql, /full_name/i);
  assert.match(sql, /ORDER\s+BY/i);
  assert.match(sql, /r\.rank_position/i);
});

test('returns an empty array when no archived rows exist', async () => {
  const mock = mockPool([]);

  const result = await getArchivedRanking(
    mock.pool,
    teamQuery
  );

  assert.deepEqual(result, []);
});

test('propagates database errors', async () => {
  const pool = {
    query: async () => {
      throw new Error('Archive database failure');
    }
  };

  await assert.rejects(
    getArchivedRanking(pool, teamQuery),
    /Archive database failure/
  );
});
