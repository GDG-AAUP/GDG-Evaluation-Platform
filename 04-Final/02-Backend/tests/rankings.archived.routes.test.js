
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const {
  createRankingsRouter
} = require('../dist/phase2/rankings/rankings.routes.js');

const teamPath =
  '/api/rankings/archived?scope=team&teamId=2&year=2026&month=9';

const campusPath =
  '/api/rankings/archived?scope=campus&campusId=1&year=2026&month=9';

const archivedRows = [
  { rank: 1, userId: 5, fullName: 'Sara', totalPoints: 80 },
  { rank: 1, userId: 6, fullName: 'Lina', totalPoints: 80 },
  { rank: 2, userId: 7, fullName: 'Omar', totalPoints: 50 }
];

function createMockPool(rows = archivedRows, failure = null) {
  const queries = [];

  const pool = {
    query: async (sql, params = []) => {
      queries.push({ sql, params });

      if (failure) {
        throw failure;
      }

      return { rows };
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

  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}${path}`
  );

  return {
    response,
    data: await response.json()
  };
}

test('Guests can view archived Team rankings', async t => {
  const mock = createMockPool();

  const { response, data } = await sendRequest(
    t, mock.pool, teamPath
  );

  assert.equal(response.status, 200);
  assert.deepEqual(data, { data: archivedRows });
});

test('Guests can view archived Campus rankings', async t => {
  const mock = createMockPool();

  const { response, data } = await sendRequest(
    t, mock.pool, campusPath
  );

  assert.equal(response.status, 200);
  assert.deepEqual(data, { data: archivedRows });
});

test('Archived Team query uses correct parameters', async t => {
  const mock = createMockPool();

  await sendRequest(t, mock.pool, teamPath);

  assert.equal(mock.queries.length, 1);
  assert.deepEqual(
    mock.queries[0].params,
    ['Team', 2026, 9, 2, null]
  );
});

test('Archived Campus query uses correct parameters', async t => {
  const mock = createMockPool();

  await sendRequest(t, mock.pool, campusPath);

  assert.equal(mock.queries.length, 1);
  assert.deepEqual(
    mock.queries[0].params,
    ['Campus', 2026, 9, null, 1]
  );
});

test('Archived endpoint reads only saved snapshots', async t => {
  const mock = createMockPool();

  await sendRequest(t, mock.pool, teamPath);

  const sql = mock.queries[0].sql;

  assert.match(sql, /\bmonthly_rankings\b/i);
  assert.match(sql, /archived_at\s+IS\s+NOT\s+NULL/i);
});

test('Archived response preserves stored dense ranks', async t => {
  const mock = createMockPool();

  const { data } = await sendRequest(
    t, mock.pool, teamPath
  );

  assert.deepEqual(
    data.data.map(row => row.rank),
    [1, 1, 2]
  );
});

test('Invalid month returns 400 without querying database', async t => {
  const mock = createMockPool();

  const path =
    '/api/rankings/archived?scope=team&teamId=2&year=2026&month=13';

  const { response, data } = await sendRequest(
    t, mock.pool, path
  );

  assert.equal(response.status, 400);
  assert.equal(
    data.error.code,
    'INVALID_RANKING_QUERY'
  );
  assert.equal(mock.queries.length, 0);
});

test('Missing Team ID returns 400', async t => {
  const mock = createMockPool();

  const path =
    '/api/rankings/archived?scope=team&year=2026&month=9';

  const { response, data } = await sendRequest(
    t, mock.pool, path
  );

  assert.equal(response.status, 400);
  assert.equal(
    data.error.code,
    'INVALID_RANKING_QUERY'
  );
  assert.equal(mock.queries.length, 0);
});

test('No matching snapshot rows returns an empty array', async t => {
  const mock = createMockPool([]);

  const { response, data } = await sendRequest(
    t, mock.pool, teamPath
  );

  assert.equal(response.status, 200);
  assert.deepEqual(data, { data: [] });
});

test('Database errors are forwarded safely', async t => {
  const mock = createMockPool(
    archivedRows,
    new Error('Database unavailable')
  );

  const { response, data } = await sendRequest(
    t, mock.pool, teamPath
  );

  assert.equal(response.status, 500);
  assert.equal(data.error.code, 'INTERNAL_ERROR');

  assert.doesNotMatch(
    JSON.stringify(data),
    /Database unavailable/
  );
});
