
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const {
  createRankingsRouter
} = require('../dist/phase2/rankings/rankings.routes.js');

const campuses = [
  { id: 1, name: 'Jenin' },
  { id: 2, name: 'Ramallah' }
];

const teams = [
  { id: 2, campusId: 1, name: 'Technical' },
  { id: 3, campusId: 1, name: 'Design' },
  { id: 4, campusId: 2, name: 'Media' }
];

const rankingRows = [
  {
    rank: 1,
    userId: 5,
    fullName: 'Sara',
    totalPoints: 80
  }
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

      if (/FROM\s+campuses\b/i.test(sql)) {
        if (failOn === 'campuses') {
          throw new Error('Campus database failure');
        }
        return { rows: campusRows };
      }

      if (/FROM\s+teams\b/i.test(sql)) {
        if (failOn === 'teams') {
          throw new Error('Team database failure');
        }
        return { rows: teamRows };
      }

      if (/point_entries/i.test(sql)) {
        return { rows: rankingRows };
      }

      throw new Error('Unexpected SQL query');
    }
  };

  return { pool, queries };
}

async function sendRequest(t, pool, path) {
  const app = express();

  app.use('/api/rankings', createRankingsRouter(pool));

  app.use((error, req, res, next) => {
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error'
      }
    });
  });

  const server = await new Promise(resolve => {
    const listener = app.listen(
      0,
      '127.0.0.1',
      () => resolve(listener)
    );
  });

  t.after(() => new Promise(resolve => {
    server.close(resolve);
  }));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}${path}`
  );

  return {
    response,
    data: await response.json()
  };
}

test('Guests can access ranking options without login', async t => {
  const mock = createMockPool();

  const { response, data } = await sendRequest(
    t,
    mock.pool,
    '/api/rankings/options'
  );

  assert.equal(response.status, 200);
  assert.deepEqual(data, {
    data: { campuses, teams }
  });
});

test('Options endpoint runs exactly two database queries', async t => {
  const mock = createMockPool();

  await sendRequest(
    t,
    mock.pool,
    '/api/rankings/options'
  );

  assert.equal(mock.queries.length, 2);
  assert.match(mock.queries[0].sql, /FROM\s+campuses/i);
  assert.match(mock.queries[1].sql, /FROM\s+teams/i);
});

test('Options response contains only public metadata', async t => {
  const mock = createMockPool();

  const { data } = await sendRequest(
    t,
    mock.pool,
    '/api/rankings/options'
  );

  assert.deepEqual(
    Object.keys(data.data.campuses[0]).sort(),
    ['id', 'name']
  );

  assert.deepEqual(
    Object.keys(data.data.teams[0]).sort(),
    ['campusId', 'id', 'name']
  );

  const sql = mock.queries
    .map(query => query.sql)
    .join('\n');

  assert.doesNotMatch(
    sql,
    /email|clerk_user_id|password|audit_logs/i
  );
});

test('Options queries do not require input parameters', async t => {
  const mock = createMockPool();

  await sendRequest(
    t,
    mock.pool,
    '/api/rankings/options'
  );

  for (const query of mock.queries) {
    assert.deepEqual(query.params, []);
  }
});

test('Empty database lists return empty arrays', async t => {
  const mock = createMockPool({
    campusRows: [],
    teamRows: []
  });

  const { response, data } = await sendRequest(
    t,
    mock.pool,
    '/api/rankings/options'
  );

  assert.equal(response.status, 200);

  assert.deepEqual(data, {
    data: {
      campuses: [],
      teams: []
    }
  });
});

test('Campus database error returns 500 without details', async t => {
  const mock = createMockPool({
    failOn: 'campuses'
  });

  const { response, data } = await sendRequest(
    t,
    mock.pool,
    '/api/rankings/options'
  );

  assert.equal(response.status, 500);
  assert.equal(data.error.code, 'INTERNAL_ERROR');

  assert.doesNotMatch(
    JSON.stringify(data),
    /Campus database failure/
  );
});

test('Team database error returns 500 without details', async t => {
  const mock = createMockPool({
    failOn: 'teams'
  });

  const { response, data } = await sendRequest(
    t,
    mock.pool,
    '/api/rankings/options'
  );

  assert.equal(response.status, 500);
  assert.equal(data.error.code, 'INTERNAL_ERROR');

  assert.doesNotMatch(
    JSON.stringify(data),
    /Team database failure/
  );
});

test('Existing Team rankings endpoint still works', async t => {
  const mock = createMockPool();

  const { response, data } = await sendRequest(
    t,
    mock.pool,
    '/api/rankings?scope=team&teamId=2&year=2026&month=10'
  );

  assert.equal(response.status, 200);
  assert.deepEqual(data, {
    data: rankingRows
  });

  assert.equal(mock.queries.length, 1);
  assert.deepEqual(mock.queries[0].params, [2, 2026, 10]);
});

test('Invalid ranking query still returns 400', async t => {
  const mock = createMockPool();

  const { response, data } = await sendRequest(
    t,
    mock.pool,
    '/api/rankings?scope=team&teamId=2&year=2026&month=15'
  );

  assert.equal(response.status, 400);
  assert.equal(
    data.error.code,
    'INVALID_RANKING_QUERY'
  );
  assert.equal(mock.queries.length, 0);
});
