
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getRankingOptions
} = require('../dist/phase2/rankings/get-ranking-options.js');

const campuses = [
  { id: 1, name: 'Jenin' },
  { id: 2, name: 'Ramallah' }
];

const teams = [
  { id: 2, campusId: 1, name: 'Technical' },
  { id: 3, campusId: 1, name: 'Design' },
  { id: 4, campusId: 2, name: 'Media' }
];

function createMockPool({
  campusRows = campuses,
  teamRows = teams,
  failOn = null
} = {}) {
  const queries = [];

  const pool = {
    query: async (sql, params = []) => {
      queries.push({ sql, params });

      if (/\bFROM\s+campuses\b/i.test(sql)) {
        if (failOn === 'campuses') {
          throw new Error('Campus query failed');
        }

        return { rows: campusRows };
      }

      if (/\bFROM\s+teams\b/i.test(sql)) {
        if (failOn === 'teams') {
          throw new Error('Team query failed');
        }

        return { rows: teamRows };
      }

      throw new Error('Unexpected SQL query');
    }
  };

  return { pool, queries };
}

test('returns campuses and teams', async () => {
  const mock = createMockPool();

  const result = await getRankingOptions(mock.pool);

  assert.deepEqual(result, {
    campuses,
    teams
  });
});

test('returns empty arrays when there are no options', async () => {
  const mock = createMockPool({
    campusRows: [],
    teamRows: []
  });

  const result = await getRankingOptions(mock.pool);

  assert.deepEqual(result, {
    campuses: [],
    teams: []
  });
});

test('reads both campuses and teams', async () => {
  const mock = createMockPool();

  await getRankingOptions(mock.pool);

  assert.equal(mock.queries.length, 2);

  assert.ok(
    mock.queries.some(q =>
      /\bFROM\s+campuses\b/i.test(q.sql)
    )
  );

  assert.ok(
    mock.queries.some(q =>
      /\bFROM\s+teams\b/i.test(q.sql)
    )
  );
});

test('queries do not expose private user information', async () => {
  const mock = createMockPool();

  const result = await getRankingOptions(mock.pool);

  const combinedSql =
    mock.queries.map(q => q.sql).join('\n');

  assert.doesNotMatch(
    combinedSql,
    /clerk_user_id|email|password|audit_logs|point_entries/i
  );

  assert.deepEqual(
    Object.keys(result.campuses[0]).sort(),
    ['id', 'name']
  );

  assert.deepEqual(
    Object.keys(result.teams[0]).sort(),
    ['campusId', 'id', 'name']
  );
});

test('does not need SQL parameters for the public lists', async () => {
  const mock = createMockPool();

  await getRankingOptions(mock.pool);

  for (const query of mock.queries) {
    assert.deepEqual(query.params, []);
  }
});

test('propagates campus query errors', async () => {
  const mock = createMockPool({
    failOn: 'campuses'
  });

  await assert.rejects(
    getRankingOptions(mock.pool),
    /Campus query failed/
  );
});

test('propagates team query errors', async () => {
  const mock = createMockPool({
    failOn: 'teams'
  });

  await assert.rejects(
    getRankingOptions(mock.pool),
    /Team query failed/
  );
});
