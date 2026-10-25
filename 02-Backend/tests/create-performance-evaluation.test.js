
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPerformanceEvaluation
} = require('../dist/phase2/evaluations/create-performance-evaluation.js');

const input = {
  evaluatedUserId: 5,
  activityName: 'Workshop',
  activityDate: '2026-10-20',
  criteriaScores: [85, 80, 90, 75],
  criteriaTotalScore: 83,
  comments: 'Excellent'
};

function setup(options = {}) {
  const calls = [];
  let released = false;

  const client = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });

      if (sql.includes('FROM users u')) {
        if (options.missingTarget) {
          return { rows: [] };
        }

        return {
          rows: [{
            user_id: 5,
            role: options.targetRole || 'Manager',
            is_active: !options.inactiveTarget,
            team_id: 2,
            campus_id: 1
          }]
        };
      }

      if (sql.includes('FROM users')) {
        return {
          rows: [{
            role: options.actorRole || 'Organizer',
            is_active: !options.inactiveActor
          }]
        };
      }

      if (sql.includes('INSERT INTO performance_evaluations')) {
        if (options.insertFailure) {
          throw new Error('Evaluation insert failed');
        }

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

      if (
        sql.includes('INSERT INTO audit_logs') &&
        options.auditFailure
      ) {
        throw new Error('Audit insert failed');
      }

      return { rows: [] };
    },

    release: () => {
      released = true;
    }
  };

  return {
    pool: {
      connect: async () => client
    },
    calls,
    get released() {
      return released;
    }
  };
}

function used(mock, text) {
  return mock.calls.some(call => call.sql.includes(text));
}

test('Organizer creates an evaluation', async () => {
  const mock = setup();

  const result = await createPerformanceEvaluation(
    mock.pool,
    10,
    input
  );

  assert.equal(result.outcome, 'created');
  assert.equal(result.evaluation.totalScore, 83);
  assert.ok(used(mock, 'COMMIT'));
  assert.equal(mock.released, true);
});

test('Derives Team and Campus from database', async () => {
  const mock = setup();

  await createPerformanceEvaluation(mock.pool, 10, input);

  const insert = mock.calls.find(call =>
    call.sql.includes('INSERT INTO performance_evaluations')
  );

  assert.equal(insert.params[2], 2);
  assert.equal(insert.params[3], 1);
});

test('Records an audit entry', async () => {
  const mock = setup();

  await createPerformanceEvaluation(mock.pool, 10, input);

  const audit = mock.calls.find(call =>
    call.sql.includes('INSERT INTO audit_logs')
  );

  assert.ok(audit);
  assert.equal(audit.params[0], 10);
  assert.equal(audit.params[1], '100');

  const saved = JSON.parse(audit.params[2]);

  assert.equal(saved.totalScore, 83);
  assert.deepEqual(saved.criteriaScores, [85, 80, 90, 75]);
});

test('Rejects Member evaluator', async () => {
  const mock = setup({ actorRole: 'Member' });

  const result = await createPerformanceEvaluation(
    mock.pool,
    10,
    input
  );

  assert.equal(result.outcome, 'forbidden');
  assert.ok(used(mock, 'ROLLBACK'));

  assert.equal(
    used(mock, 'INSERT INTO performance_evaluations'),
    false
  );
});

test('Rejects Manager evaluator', async () => {
  const mock = setup({ actorRole: 'Manager' });

  const result = await createPerformanceEvaluation(
    mock.pool,
    10,
    input
  );

  assert.equal(result.outcome, 'forbidden');
});

test('Rejects inactive Organizer', async () => {
  const mock = setup({ inactiveActor: true });

  const result = await createPerformanceEvaluation(
    mock.pool,
    10,
    input
  );

  assert.equal(result.outcome, 'forbidden');
});

test('Rejects missing target', async () => {
  const mock = setup({ missingTarget: true });

  const result = await createPerformanceEvaluation(
    mock.pool,
    10,
    input
  );

  assert.equal(result.outcome, 'target_not_found');
  assert.ok(used(mock, 'ROLLBACK'));
});

test('Rejects evaluating a Member', async () => {
  const mock = setup({ targetRole: 'Member' });

  const result = await createPerformanceEvaluation(
    mock.pool,
    10,
    input
  );

  assert.equal(result.outcome, 'target_ineligible');
});

test('Rejects inactive Manager', async () => {
  const mock = setup({ inactiveTarget: true });

  const result = await createPerformanceEvaluation(
    mock.pool,
    10,
    input
  );

  assert.equal(result.outcome, 'target_ineligible');
});

test('Rolls back when evaluation insert fails', async () => {
  const mock = setup({ insertFailure: true });

  await assert.rejects(
    createPerformanceEvaluation(mock.pool, 10, input),
    /Evaluation insert failed/
  );

  assert.ok(used(mock, 'ROLLBACK'));
  assert.equal(used(mock, 'COMMIT'), false);
  assert.equal(mock.released, true);
});

test('Rolls back when audit insertion fails', async () => {
  const mock = setup({ auditFailure: true });

  await assert.rejects(
    createPerformanceEvaluation(mock.pool, 10, input),
    /Audit insert failed/
  );

  assert.ok(used(mock, 'ROLLBACK'));
  assert.equal(used(mock, 'COMMIT'), false);
  assert.equal(mock.released, true);
});

test('Uses the correct evaluator ID', async () => {
  const mock = setup();

  await createPerformanceEvaluation(mock.pool, 10, input);

  const insert = mock.calls.find(call =>
    call.sql.includes('INSERT INTO performance_evaluations')
  );

  assert.equal(insert.params[0], 5);
  assert.equal(insert.params[1], 10);
});

test('Stores all four approved criterion scores', async () => {
  const mock = setup();

  await createPerformanceEvaluation(mock.pool, 10, input);

  const insert = mock.calls.find(call =>
    call.sql.includes('INSERT INTO performance_evaluations')
  );

  const scores = JSON.parse(insert.params[6]);

  assert.equal(scores.length, 4);
  assert.deepEqual(scores, [85, 80, 90, 75]);
  assert.equal(insert.params[7], 83);
});

test('Recalculates total instead of trusting supplied total', async () => {
  const mock = setup();

  await createPerformanceEvaluation(
    mock.pool,
    10,
    {
      ...input,
      criteriaTotalScore: 100
    }
  );

  const insert = mock.calls.find(call =>
    call.sql.includes('INSERT INTO performance_evaluations')
  );

  const audit = mock.calls.find(call =>
    call.sql.includes('INSERT INTO audit_logs')
  );

  assert.equal(insert.params[7], 83);
  assert.equal(JSON.parse(audit.params[2]).totalScore, 83);
});

test('Rejects old 15-score evaluations before connecting', async () => {
  let connected = false;

  const pool = {
    connect: async () => {
      connected = true;
      throw new Error('Should not connect');
    }
  };

  await assert.rejects(
    createPerformanceEvaluation(
      pool,
      10,
      {
        ...input,
        criteriaScores: Array(15).fill(5)
      }
    ),
    RangeError
  );

  assert.equal(connected, false);
});
