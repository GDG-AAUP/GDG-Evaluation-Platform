
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const {
  createManagerEvaluationsRouter
} = require('../dist/phase2/evaluations/manager-evaluations.routes.js');

const validBody = {
  evaluatedUserId: 5,
  activityName: 'Workshop',
  activityDate: '2026-10-20',
  criteriaScores: [85, 80, 90, 75],
  comments: 'Good performance'
};

function createMockPool() {
  const state = {
    audits: 0,
    targetMissing: false,
    targetRole: 'Manager',
    averageRows: [{
      role: 'Manager',
      evaluationCount: 2,
      averageScore: '76.00'
    }]
  };

  const query = async (sql) => {
    if (
      sql.includes('LEFT JOIN performance_evaluations')
    ) {
      return { rows: state.averageRows };
    }

    if (sql.includes('FROM users u')) {
      return {
        rows: state.targetMissing ? [] : [{
          user_id: 5,
          role: state.targetRole,
          is_active: true,
          team_id: 2,
          campus_id: 1
        }]
      };
    }

    if (sql.includes('FROM users')) {
      return {
        rows: [{
          role: 'Organizer',
          is_active: true
        }]
      };
    }

    if (sql.includes('INSERT INTO performance_evaluations')) {
      return {
        rows: [{
          id: '100',
          evaluatedUserId: 5,
          evaluatedByUserId: 10,
          teamId: 2,
          campusId: 1,
          totalScore: 83
        }]
      };
    }

    if (sql.includes('INSERT INTO audit_logs')) {
      state.audits++;
      return { rows: [] };
    }

    return { rows: [] };
  };

  return {
    state,
    query,
    connect: async () => ({
      query,
      release: () => {}
    })
  };
}

test('Manager Evaluation HTTP API', async (t) => {
  const pool = createMockPool();
  const app = express();

  app.use(express.json());

  // Test-only identity injection. Production uses Clerk
  // and loadProjectUser instead.
  app.use((req, res, next) => {
    const role = req.headers['x-test-role'];

    if (role) {
      req.projectUser = {
        id: role === 'organizer' ? 10 : 11,
        role,
        teamId: role === 'organizer' ? null : 2
      };
    }

    next();
  });

  app.use(
    '/api/evaluations',
    createManagerEvaluationsRouter(pool)
  );

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

  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(
    path,
    { method = 'GET', role, body } = {}
  ) {
    const headers = {};

    if (role) {
      headers['x-test-role'] = role;
    }

    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined
        ? undefined
        : JSON.stringify(body)
    });

    return {
      status: response.status,
      json: await response.json()
    };
  }

  const post = (role, body = validBody) =>
    request('/api/evaluations/managers', {
      method: 'POST',
      role,
      body
    });

  const get = (
    role,
    path = '/api/evaluations/managers/5/average?year=2026&month=10'
  ) => request(path, { role });

  await t.test(
    'POST requires authentication',
    async () => {
      const result = await post(undefined);

      assert.equal(result.status, 401);
      assert.equal(
        result.json.error.code,
        'UNAUTHENTICATED'
      );
    }
  );

  await t.test(
    'POST rejects Members',
    async () => {
      const result = await post('member');

      assert.equal(result.status, 403);
      assert.equal(result.json.error.code, 'FORBIDDEN');
    }
  );

  await t.test(
    'POST rejects Managers',
    async () => {
      const result = await post('manager');

      assert.equal(result.status, 403);
    }
  );

  await t.test(
    'POST rejects invalid score counts',
    async () => {
      const result = await post('organizer', {
        ...validBody,
        criteriaScores: [80, 90, 70]
      });

      assert.equal(result.status, 400);
      assert.equal(
        result.json.error.code,
        'INVALID_EVALUATION_DATA'
      );
    }
  );

  await t.test(
    'POST rejects the old 15-score format',
    async () => {
      const result = await post('organizer', {
        ...validBody,
        criteriaScores: Array(15).fill(5)
      });

      assert.equal(result.status, 400);
    }
  );

  await t.test(
    'POST rejects client-supplied totals',
    async () => {
      const result = await post('organizer', {
        ...validBody,
        criteriaTotalScore: 100
      });

      assert.equal(result.status, 400);
    }
  );

  await t.test(
    'POST rejects client-supplied evaluator IDs',
    async () => {
      const result = await post('organizer', {
        ...validBody,
        evaluatedByUserId: 99
      });

      assert.equal(result.status, 400);
    }
  );

  await t.test(
    'Organizer creates a four-criterion evaluation',
    async () => {
      const before = pool.state.audits;
      const result = await post('organizer');

      assert.equal(result.status, 201);
      assert.equal(result.json.data.totalScore, 83);
      assert.equal(result.json.data.evaluatedUserId, 5);
      assert.equal(pool.state.audits, before + 1);
    }
  );

  await t.test(
    'POST returns 404 for a missing Manager',
    async () => {
      pool.state.targetMissing = true;

      try {
        const result = await post('organizer');

        assert.equal(result.status, 404);
        assert.equal(
          result.json.error.code,
          'MANAGER_NOT_FOUND'
        );
      } finally {
        pool.state.targetMissing = false;
      }
    }
  );

  await t.test(
    'POST rejects a non-Manager target',
    async () => {
      pool.state.targetRole = 'Member';

      try {
        const result = await post('organizer');

        assert.equal(result.status, 422);
        assert.equal(
          result.json.error.code,
          'MANAGER_INELIGIBLE'
        );
      } finally {
        pool.state.targetRole = 'Manager';
      }
    }
  );

  await t.test(
    'GET average requires authentication',
    async () => {
      const result = await get(undefined);

      assert.equal(result.status, 401);
    }
  );

  await t.test(
    'GET average rejects Members',
    async () => {
      const result = await get('member');

      assert.equal(result.status, 403);
    }
  );

  await t.test(
    'GET average rejects Managers',
    async () => {
      const result = await get('manager');

      assert.equal(result.status, 403);
    }
  );

  await t.test(
    'GET rejects invalid Manager IDs',
    async () => {
      const result = await get(
        'organizer',
        '/api/evaluations/managers/abc/average?year=2026&month=10'
      );

      assert.equal(result.status, 400);
    }
  );

  await t.test(
    'GET requires a year and month',
    async () => {
      const result = await get(
        'organizer',
        '/api/evaluations/managers/5/average'
      );

      assert.equal(result.status, 400);
    }
  );

  await t.test(
    'GET rejects invalid months',
    async () => {
      const result = await get(
        'organizer',
        '/api/evaluations/managers/5/average?year=2026&month=13'
      );

      assert.equal(result.status, 400);
    }
  );

  await t.test(
    'Organizer reads a monthly average',
    async () => {
      const result = await get('organizer');

      assert.equal(result.status, 200);

      assert.deepEqual(result.json.data, {
        managerUserId: 5,
        year: 2026,
        month: 10,
        evaluationCount: 2,
        averageScore: 76
      });
    }
  );

  await t.test(
    'GET returns 404 for a missing Manager',
    async () => {
      pool.state.averageRows = [];

      try {
        const result = await get('organizer');

        assert.equal(result.status, 404);
      } finally {
        pool.state.averageRows = [{
          role: 'Manager',
          evaluationCount: 2,
          averageScore: '76.00'
        }];
      }
    }
  );

  await t.test(
    'GET rejects users who are not Managers',
    async () => {
      pool.state.averageRows = [{
        role: 'Member',
        evaluationCount: 0,
        averageScore: null
      }];

      try {
        const result = await get('organizer');

        assert.equal(result.status, 422);
        assert.equal(
          result.json.error.code,
          'NOT_A_MANAGER'
        );
      } finally {
        pool.state.averageRows = [{
          role: 'Manager',
          evaluationCount: 2,
          averageScore: '76.00'
        }];
      }
    }
  );
});
