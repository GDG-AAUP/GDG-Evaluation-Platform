
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const {
  createAuditRouter
} = require('../dist/phase2/audit/audit.routes.js');

function mockPool(fail = false) {
  const calls = [];

  return {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql, params });

      if (fail) throw new Error('Database failed');

      if (sql.includes('COUNT(*)')) {
        return { rows: [{ total: 2 }] };
      }

      return {
        rows: [{
          id: '9001',
          actorId: 10,
          actorName: 'Organizer',
          action: 'POINT_CREATED',
          entityType: 'point_entries',
          entityId: '5',
          oldValues: null,
          newValues: { points: 20 },
          reason: 'Activity',
          batchId: null,
          createdAt: '2026-10-24'
        }]
      };
    }
  };
}

async function request(t, role, path, pool) {
  const app = express();

  app.use((req, res, next) => {
    if (role) {
      req.projectUser = { id: 10, role };
    }
    next();
  });

  app.use('/api/audit', createAuditRouter(pool));

  app.use((error, req, res, next) => {
    res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR' }
    });
  });

  const server = await new Promise(resolve => {
    const listener = app.listen(
      0, '127.0.0.1', () => resolve(listener)
    );
  });

  t.after(() => new Promise(resolve => server.close(resolve)));


    const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/audit${path}`
    );


  return {
    response,
    body: await response.json()
  };
}

test('Guest cannot access audit logs', async t => {
  const pool = mockPool();

  const { response } = await request(t, null, '/', pool);

  assert.equal(response.status, 401);
  assert.equal(pool.calls.length, 0);
});

test('Member cannot access audit logs', async t => {
  const pool = mockPool();

  const { response } = await request(t, 'member', '/', pool);

  assert.equal(response.status, 403);
  assert.equal(pool.calls.length, 0);
});

test('Manager cannot access audit logs', async t => {
  const pool = mockPool();

  const { response } = await request(t, 'manager', '/', pool);

  assert.equal(response.status, 403);
  assert.equal(pool.calls.length, 0);
});

test('Organizer can read paginated audit logs', async t => {
  const pool = mockPool();

  const { response, body } = await request(
    t, 'organizer', '/', pool
  );

  assert.equal(response.status, 200);
  assert.equal(body.data.total, 2);
  assert.equal(body.data.page, 1);
  assert.equal(body.data.pageSize, 25);
  assert.equal(body.data.items.length, 1);
  assert.equal(pool.calls.length, 2);
});

test('Uses parameterized filters', async t => {
  const pool = mockPool();

  const { response } = await request(
    t,
    'organizer',
    '/?actorId=10&action=POINT_CREATED&entityType=point_entries&from=2026-10-01&to=2026-10-24&page=2&pageSize=10',
    pool
  );

  assert.equal(response.status, 200);

  assert.deepEqual(pool.calls[0].params, [
    10, 'POINT_CREATED', 'point_entries',
    '2026-10-01', '2026-10-24'
  ]);

  assert.deepEqual(pool.calls[1].params, [
    10, 'POINT_CREATED', 'point_entries',
    '2026-10-01', '2026-10-24', 10, 10
  ]);

  assert.match(pool.calls[1].sql, /LEFT JOIN users/i);
  assert.match(pool.calls[1].sql, /ORDER BY a\.created_at DESC/i);
});

test('Rejects invalid dates', async t => {
  const pool = mockPool();

  const { response } = await request(
    t,
    'organizer',
    '/?from=2026-10-31&to=2026-10-01',
    pool
  );

  assert.equal(response.status, 400);
  assert.equal(pool.calls.length, 0);
});

test('Rejects invalid pagination', async t => {
  const pool = mockPool();

  const { response } = await request(
    t, 'organizer', '/?pageSize=1000', pool
  );

  assert.equal(response.status, 400);
  assert.equal(pool.calls.length, 0);
});

test('Handles database failures safely', async t => {
  const pool = mockPool(true);

  const { response, body } = await request(
    t, 'organizer', '/', pool
  );

  assert.equal(response.status, 500);
  assert.equal(body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.doesNotMatch(JSON.stringify(body), /Database failed/);
});
