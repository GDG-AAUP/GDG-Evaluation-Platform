
const test = require('node:test');
const assert = require('node:assert/strict');

const validBody = {
  evaluatedUserId: 5,
  activityName: 'Technical Workshop',
  activityDate: '2026-10-20',
  criteriaScores: [85, 80, 90, 75],
  comments: 'Good performance'
};

test('Manager Evaluation authorization in the full Express app', {
  timeout: 30000
}, async (t) => {
  const sdkId = require.resolve('@clerk/express');
  const previousSdk = require.cache[sdkId];

  // Replace Clerk only inside this test process.
  require.cache[sdkId] = {
    id: sdkId,
    filename: sdkId,
    loaded: true,
    exports: {
      clerkMiddleware: () => (req, res, next) => {
        req.testUserId = req.headers['x-test-user'] || null;
        next();
      },
      getAuth: req => ({
        userId: req.testUserId || null
      }),
      clerkClient: {
        users: {
          getUser: async () => {
            const error = new Error('User not found');
            error.status = 404;
            throw error;
          }
        }
      }
    }
  };

  const pool = require('../src/config/db');
  const repository = require('../src/repositories/users.repository');

  const originalConnect = pool.connect;
  const originalQuery = pool.query;
  const originalFind = repository.findUserByClerkId;

  const users = {
    clerk_organizer: {
      id: 10,
      name: 'Organizer',
      role: 'organizer',
      teamId: null,
      isActive: true,
      deletedAt: null
    },
    clerk_manager: {
      id: 5,
      name: 'Manager',
      role: 'manager',
      teamId: 2,
      isActive: true,
      deletedAt: null
    },
    clerk_member: {
      id: 11,
      name: 'Member',
      role: 'member',
      teamId: 2,
      isActive: true,
      deletedAt: null
    },
    clerk_inactive: {
      id: 12,
      name: 'Inactive Organizer',
      role: 'organizer',
      teamId: null,
      isActive: false,
      deletedAt: null
    },
    clerk_deleted: {
      id: 13,
      name: 'Deleted Organizer',
      role: 'organizer',
      teamId: null,
      isActive: false,
      deletedAt: new Date()
    }
  };

  repository.findUserByClerkId = async clerkId =>
    users[clerkId] || null;

  const state = {
    actorDbRole: 'Organizer',
    evaluationWrites: 0,
    auditWrites: 0,
    lastEvaluationParams: null
  };

  async function query(sql, params = []) {
    const statement =
      typeof sql === 'string' ? sql : sql.text || '';

    if (statement.includes('LEFT JOIN performance_evaluations e')) {
      return {
        rows: [{
          role: 'Manager',
          evaluationCount: 2,
          averageScore: '76.00'
        }]
      };
    }

    if (/SELECT\s+role,\s*is_active\s+FROM\s+users/i.test(statement)) {
      return {
        rows: [{
          role: state.actorDbRole,
          is_active: true
        }]
      };
    }

    if (statement.includes('FROM users u')) {
      return {
        rows: [{
          user_id: 5,
          role: 'Manager',
          is_active: true,
          team_id: 2,
          campus_id: 1
        }]
      };
    }

    if (statement.includes('INSERT INTO performance_evaluations')) {
      state.evaluationWrites++;
      state.lastEvaluationParams = params;

      return {
        rows: [{
          id: String(100 + state.evaluationWrites),
          evaluatedUserId: 5,
          evaluatedByUserId: 10,
          teamId: 2,
          campusId: 1,
          totalScore: 83
        }]
      };
    }

    if (statement.includes('INSERT INTO audit_logs')) {
      state.auditWrites++;
      return { rows: [] };
    }

    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(statement.trim())) {
      return { rows: [] };
    }

    throw new Error(`Unexpected SQL in test mock: ${statement}`);
  }

  pool.query = query;
  pool.connect = async () => ({
    query,
    release: () => {}
  });

  const app = require('../src/app');

  const server = await new Promise(resolve => {
    const listener = app.listen(
      0,
      '127.0.0.1',
      () => resolve(listener)
    );
  });

  t.after(async () => {
    server.closeAllConnections();

    await new Promise(resolve => server.close(resolve));

    pool.connect = originalConnect;
    pool.query = originalQuery;
    repository.findUserByClerkId = originalFind;

    if (previousSdk) {
      require.cache[sdkId] = previousSdk;
    } else {
      delete require.cache[sdkId];
    }
  });

  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(method, path, identity, body, extraHeaders = {}) {
    const headers = { ...extraHeaders };

    if (identity) {
      headers['x-test-user'] = identity;
    }

    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    const response = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    return {
      status: response.status,
      json: await response.json()
    };
  }

  const averagePath =
    '/api/evaluations/managers/5/average?year=2026&month=10';

  const createPath = '/api/evaluations/managers';

  const get = identity =>
    request('GET', averagePath, identity);

  const post = (identity, body = validBody, headers = {}) =>
    request('POST', createPath, identity, body, headers);

  await t.test('existing health endpoint still works', async () => {
    const result = await request('GET', '/api/health');

    assert.equal(result.status, 200);
  });

  await t.test('guest cannot read averages', async () => {
    assert.equal((await get(null)).status, 401);
  });

  await t.test('guest cannot create evaluations', async () => {
    assert.equal((await post(null)).status, 401);
  });

  await t.test('Member cannot read averages', async () => {
    assert.equal((await get('clerk_member')).status, 403);
  });

  await t.test('Member cannot create evaluations', async () => {
    assert.equal((await post('clerk_member')).status, 403);
  });

  await t.test('Manager cannot read averages', async () => {
    assert.equal((await get('clerk_manager')).status, 403);
  });

  await t.test('Manager cannot create evaluations', async () => {
    assert.equal((await post('clerk_manager')).status, 403);
  });

  await t.test('inactive Organizer is denied', async () => {
    const result = await get('clerk_inactive');

    assert.equal(result.status, 403);
    assert.equal(
      result.json.error.code,
      'PROJECT_ACCESS_DENIED'
    );
  });

  await t.test('deleted Organizer is denied', async () => {
    const result = await post('clerk_deleted');

    assert.equal(result.status, 403);
  });

  await t.test('unlinked account is denied', async () => {
    const result = await get('clerk_unknown');

    assert.equal(result.status, 403);
  });

  await t.test('client role spoofing does not grant access', async () => {
    const result = await post(
      'clerk_member',
      validBody,
      { 'x-test-role': 'organizer' }
    );

    assert.equal(result.status, 403);
  });

  await t.test('Organizer can read a monthly average', async () => {
    const result = await get('clerk_organizer');

    assert.equal(result.status, 200);

    assert.deepEqual(result.json.data, {
      managerUserId: 5,
      year: 2026,
      month: 10,
      evaluationCount: 2,
      averageScore: 76
    });
  });

  await t.test('Organizer can create an evaluation', async () => {
    const beforeEvaluations = state.evaluationWrites;
    const beforeAudits = state.auditWrites;

    const result = await post('clerk_organizer');

    assert.equal(result.status, 201);
    assert.equal(result.json.data.totalScore, 83);
    assert.equal(result.json.data.evaluatedByUserId, 10);

    assert.equal(
      state.evaluationWrites,
      beforeEvaluations + 1
    );

    assert.equal(
      state.auditWrites,
      beforeAudits + 1
    );

    assert.equal(state.lastEvaluationParams[1], 10);
  });

  await t.test('Organizer cannot override evaluator identity', async () => {
    const before = state.evaluationWrites;

    const result = await post('clerk_organizer', {
      ...validBody,
      evaluatedByUserId: 999
    });

    assert.equal(result.status, 400);
    assert.equal(state.evaluationWrites, before);
  });

  await t.test('invalid scores cannot reach the database', async () => {
    const before = state.evaluationWrites;

    const result = await post('clerk_organizer', {
      ...validBody,
      criteriaScores: [85, 80, 90]
    });

    assert.equal(result.status, 400);
    assert.equal(state.evaluationWrites, before);
  });

  await t.test('stale database Organizer role is rejected', async () => {
    const before = state.evaluationWrites;

    state.actorDbRole = 'Member';

    try {
      const result = await post('clerk_organizer');

      assert.equal(result.status, 403);
      assert.equal(state.evaluationWrites, before);
    } finally {
      state.actorDbRole = 'Organizer';
    }
  });
});
