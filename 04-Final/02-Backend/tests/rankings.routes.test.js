
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const {
  createRankingsRouter
} = require('../dist/phase2/rankings/rankings.routes.js');

const teamPath =
  '/api/rankings?scope=team&teamId=2&year=2026&month=10';

const campusPath =
  '/api/rankings?scope=campus&campusId=1&year=2026&month=10';

const sampleRows = [
  { rank: 1, userId: 5, fullName: 'Sara', totalPoints: 80 },
  { rank: 1, userId: 6, fullName: 'Lina', totalPoints: 80 },
  { rank: 2, userId: 7, fullName: 'Omar', totalPoints: 50 }
];

function createMockPool(rows = sampleRows, failure = null) {
  const queries = [];

  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });

      if (failure) {
        throw failure;
      }

      return { rows };
    }
  };

  return { pool, queries };
}

async function sendRequest(t, pool, path, user = null) {
  const app = express();

  app.use((req, res, next) => {
    if (user) {
      req.projectUser = user;
    }
    next();
  });

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

  const data = await response.json();

  return { response, data };
}

// Public access

test('Guest can view Team rankings without login', async t => {
  const mock = createMockPool();

  const { response, data } = await sendRequest(
    t, mock.pool, teamPath
  );

  assert.equal(response.status, 200);
  assert.deepEqual(data.data, sampleRows);
});

test('Guest can view Campus rankings without login', async t => {
  const mock = createMockPool();

  const { response, data } = await sendRequest(
    t, mock.pool, campusPath
  );

  assert.equal(response.status, 200);
  assert.deepEqual(data.data, sampleRows);
});

test('Member can view another Team ranking', async t => {
  const mock = createMockPool();
  const member = { id: 3, role: 'member', teamId: 9 };

  const { response } = await sendRequest(
    t, mock.pool, teamPath, member
  );

  assert.equal(response.status, 200);
});

test('Member can view another Campus ranking', async t => {
  const mock = createMockPool();
  const member = { id: 3, role: 'member', teamId: 9 };

  const { response } = await sendRequest(
    t, mock.pool, campusPath, member
  );

  assert.equal(response.status, 200);
});

test('Manager can view another Team ranking', async t => {
  const mock = createMockPool();
  const manager = { id: 4, role: 'manager', teamId: 9 };

  const { response } = await sendRequest(
    t, mock.pool, teamPath, manager
  );

  assert.equal(response.status, 200);
});

test('Organizer can view Campus rankings', async t => {
  const mock = createMockPool();
  const organizer = {
    id: 1,
    role: 'organizer',
    teamId: null
  };

  const { response } = await sendRequest(
    t, mock.pool, campusPath, organizer
  );

  assert.equal(response.status, 200);
});

// Database queries

test('Team ranking passes correct parameters', async t => {
  const mock = createMockPool();

  await sendRequest(t, mock.pool, teamPath);

  assert.equal(mock.queries.length, 1);
  assert.deepEqual(mock.queries[0].params, [2, 2026, 10]);
});

test('Campus ranking passes correct parameters', async t => {
  const mock = createMockPool();

  await sendRequest(t, mock.pool, campusPath);

  assert.equal(mock.queries.length, 1);
  assert.deepEqual(mock.queries[0].params, [1, 2026, 10]);
});

test('Team query reads point entries', async t => {
  const mock = createMockPool();

  await sendRequest(t, mock.pool, teamPath);

  assert.match(
    mock.queries[0].sql,
    /point_entries/i
  );
});

test('Campus query filters historical teams', async t => {
  const mock = createMockPool();

  await sendRequest(t, mock.pool, campusPath);

  assert.match(
    mock.queries[0].sql,
    /assignment_history/i
  );

  assert.match(
    mock.queries[0].sql,
    /\bteams\b/i
  );
});

test('Empty leaderboard returns an empty array', async t => {
  const mock = createMockPool([]);

  const { response, data } = await sendRequest(
    t, mock.pool, teamPath
  );

  assert.equal(response.status, 200);
  assert.deepEqual(data, { data: [] });
});

test('Month with leading zero is accepted', async t => {
  const mock = createMockPool([]);

  const path =
    '/api/rankings?scope=team&teamId=2&year=2026&month=02';

  const { response } = await sendRequest(
    t, mock.pool, path
  );

  assert.equal(response.status, 200);
  assert.deepEqual(mock.queries[0].params, [2, 2026, 2]);
});

// Input validation

const invalidCases = [
  [
    'missing scope',
    '/api/rankings?teamId=2&year=2026&month=10'
  ],
  [
    'missing Team ID',
    '/api/rankings?scope=team&year=2026&month=10'
  ],
  [
    'missing Campus ID',
    '/api/rankings?scope=campus&year=2026&month=10'
  ],
  [
    'unknown scope',
    '/api/rankings?scope=global&year=2026&month=10'
  ],
  [
    'zero Team ID',
    '/api/rankings?scope=team&teamId=0&year=2026&month=10'
  ],
  [
    'invalid month',
    '/api/rankings?scope=team&teamId=2&year=2026&month=13'
  ],
  [
    'month zero',
    '/api/rankings?scope=team&teamId=2&year=2026&month=0'
  ],
  [
    'invalid year',
    '/api/rankings?scope=team&teamId=2&year=abc&month=10'
  ],
  [
    'unexpected Team ID for Campus',
    '/api/rankings?scope=campus&campusId=1&teamId=2&year=2026&month=10'
  ],
  [
    'unexpected Campus ID for Team',
    '/api/rankings?scope=team&teamId=2&campusId=1&year=2026&month=10'
  ],
  [
    'repeated scope',
    '/api/rankings?scope=team&scope=campus&teamId=2&year=2026&month=10'
  ],
  [
    'unexpected user ID',
    '/api/rankings?scope=team&teamId=2&year=2026&month=10&userId=5'
  ]
];

for (const [description, path] of invalidCases) {
  test(`Rejects ${description}`, async t => {
    const mock = createMockPool();

    const { response, data } = await sendRequest(
      t, mock.pool, path
    );

    assert.equal(response.status, 400);
    assert.equal(data.error.code, 'INVALID_RANKING_QUERY');
    assert.equal(mock.queries.length, 0);
  });
}

// Error handling

test('Database errors are forwarded to error handler', async t => {
  const mock = createMockPool(
    sampleRows,
    new Error('Database unavailable')
  );

  const { response, data } = await sendRequest(
    t, mock.pool, teamPath
  );

  assert.equal(response.status, 500);
  assert.equal(data.error.code, 'INTERNAL_ERROR');
  assert.equal(
    JSON.stringify(data).includes('Database unavailable'),
    false
  );
});
