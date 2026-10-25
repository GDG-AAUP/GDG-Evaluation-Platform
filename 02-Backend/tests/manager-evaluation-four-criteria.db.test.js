
const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/config/db');
const {
  createPerformanceEvaluation
} = require('../dist/phase2/evaluations/create-performance-evaluation.js');

const example = {
  evaluatedUserId: 5,
  activityName: 'Workshop',
  activityDate: '2026-10-20',
  criteriaScores: [85, 80, 90, 75],
  criteriaTotalScore: 83,
  comments: 'Approved criteria'
};

test('Four-criterion Manager Evaluations: real PostgreSQL', {
  skip: !process.env.DB_NAME,
  timeout: 120000
}, async (t) => {
  const client = await pool.connect();

  const publicBefore = Number((await client.query(
    'SELECT COUNT(*) AS count FROM public.performance_evaluations'
  )).rows[0].count);

  const testPool = {
    connect: async () => ({
      query: (...args) => client.query(...args),
      release: () => {}
    })
  };

  async function clearEvaluations() {
    await client.query(
      'TRUNCATE performance_evaluations, audit_logs RESTART IDENTITY'
    );
  }

  async function create(input = example, actorId = 10) {
    return createPerformanceEvaluation(testPool, actorId, input);
  }

  async function count(table) {
    const result = await client.query(
      `SELECT COUNT(*)::int AS count FROM ${table}`
    );
    return result.rows[0].count;
  }

  try {
    for (const table of [
      'campuses', 'teams', 'users',
      'performance_evaluations', 'audit_logs'
    ]) {
      await client.query(
        `CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL)`
      );
    }

    await client.query('SET search_path TO pg_temp, public');

    await client.query(`
      INSERT INTO campuses (campus_id, campus_name)
      VALUES (1, 'Jenin')
    `);

    await client.query(`
      INSERT INTO teams (team_id, campus_id, team_name, is_operational)
      VALUES (2, 1, 'Technical', FALSE)
    `);

    await client.query(`
      INSERT INTO users (
        user_id, clerk_user_id, full_name, email,
        role, team_id, is_active
      ) VALUES
        (10, 'test_org_10', 'Active Organizer',
         'org10@example.test', 'Organizer', NULL, TRUE),
        (5, 'test_mgr_5', 'Active Manager',
         'mgr5@example.test', 'Manager', 2, TRUE),
        (11, 'test_member_11', 'Active Member',
         'member11@example.test', 'Member', 2, TRUE),
        (12, 'test_mgr_12', 'Inactive Manager',
         'mgr12@example.test', 'Manager', 2, FALSE),
        (13, 'test_org_13', 'Inactive Organizer',
         'org13@example.test', 'Organizer', NULL, FALSE)
    `);

    await t.test('live database has the approved 4-score constraint', async () => {
      const result = await client.query(`
        SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'public.performance_evaluations'::regclass
          AND conname = 'chk_perf_criteria_count'
      `);

      assert.equal(result.rows.length, 1);

      assert.match(
        result.rows[0].definition,
        /jsonb_array_length\(criteria_scores\)\s*=\s*4/
      );
    });

    await t.test('creates a Manager evaluation and audit entry', async () => {
      await clearEvaluations();

      const result = await create();

      assert.equal(result.outcome, 'created');
      assert.equal(result.evaluation.totalScore, 83);

      const saved = await client.query(`
        SELECT evaluated_user_id, evaluated_by_user_id,
               team_id, campus_id, criteria_scores,
               criteria_total_score
        FROM performance_evaluations
      `);

      assert.equal(saved.rows.length, 1);
      assert.deepEqual(saved.rows[0].criteria_scores, [85, 80, 90, 75]);
      assert.equal(saved.rows[0].criteria_total_score, 83);
      assert.equal(saved.rows[0].evaluated_user_id, 5);
      assert.equal(saved.rows[0].evaluated_by_user_id, 10);
      assert.equal(saved.rows[0].team_id, 2);
      assert.equal(saved.rows[0].campus_id, 1);

      const audit = await client.query(`
        SELECT action, new_values FROM audit_logs
      `);

      assert.equal(audit.rows.length, 1);
      assert.equal(
        audit.rows[0].action,
        'PERFORMANCE_EVALUATION_CREATED'
      );
      assert.equal(audit.rows[0].new_values.totalScore, 83);
    });

    await t.test('ignores client-supplied total and uses weighted total', async () => {
      await clearEvaluations();

      const result = await create({
        ...example,
        criteriaTotalScore: 100
      });

      assert.equal(result.outcome, 'created');

      const rows = await client.query(`
        SELECT criteria_total_score FROM performance_evaluations
      `);

      assert.equal(rows.rows[0].criteria_total_score, 83);
    });

    await t.test('allows multiple monthly evaluations', async () => {
      await clearEvaluations();

      await create();

      await create({
        ...example,
        activityName: 'Second Workshop',
        criteriaScores: [70, 65, 80, 60]
      });

      assert.equal(await count('performance_evaluations'), 2);
      assert.equal(await count('audit_logs'), 2);

      const average = await client.query(`
        SELECT AVG(criteria_total_score)::numeric AS average
        FROM performance_evaluations
      `);

      assert.equal(Number(average.rows[0].average), 76);
    });

    await t.test('rejects a Member evaluator', async () => {
      await clearEvaluations();

      const result = await create(example, 11);

      assert.equal(result.outcome, 'forbidden');
      assert.equal(await count('performance_evaluations'), 0);
    });

    await t.test('rejects a Manager evaluator', async () => {
      await clearEvaluations();

      const result = await create(example, 5);

      assert.equal(result.outcome, 'forbidden');
      assert.equal(await count('performance_evaluations'), 0);
    });

    await t.test('rejects an inactive Organizer', async () => {
      await clearEvaluations();

      const result = await create(example, 13);

      assert.equal(result.outcome, 'forbidden');
    });

    await t.test('returns not found for a missing Manager', async () => {
      await clearEvaluations();

      const result = await create({
        ...example,
        evaluatedUserId: 999
      });

      assert.equal(result.outcome, 'target_not_found');
    });

    await t.test('rejects a Member as the target', async () => {
      await clearEvaluations();

      const result = await create({
        ...example,
        evaluatedUserId: 11
      });

      assert.equal(result.outcome, 'target_ineligible');
    });

    await t.test('rejects an inactive Manager target', async () => {
      await clearEvaluations();

      const result = await create({
        ...example,
        evaluatedUserId: 12
      });

      assert.equal(result.outcome, 'target_ineligible');
    });

    await t.test('rejects the former 15-score payload', async () => {
      await clearEvaluations();

      await assert.rejects(
        create({
          ...example,
          criteriaScores: Array(15).fill(5)
        }),
        RangeError
      );

      assert.equal(await count('performance_evaluations'), 0);
    });

    await t.test('PostgreSQL itself rejects 15-score inserts', async () => {
      await clearEvaluations();

      await assert.rejects(
        client.query(`
          INSERT INTO performance_evaluations (
            evaluated_user_id, evaluated_by_user_id,
            team_id, campus_id, activity_name, activity_date,
            criteria_scores, criteria_total_score
          ) VALUES (
            5, 10, 2, 1, 'Old Format',
            '2026-10-20', $1::jsonb, 75
          )
        `, [JSON.stringify(Array(15).fill(5))]),
        { code: '23514' }
      );
    });

    await t.test('rolls back evaluation if audit insertion fails', async () => {
      await clearEvaluations();

      await client.query(`
        ALTER TABLE audit_logs
        ADD CONSTRAINT reject_evaluation_audit
        CHECK (action <> 'PERFORMANCE_EVALUATION_CREATED')
      `);

      try {
        await assert.rejects(create(), { code: '23514' });

        assert.equal(await count('performance_evaluations'), 0);
        assert.equal(await count('audit_logs'), 0);
      } finally {
        await client.query(`
          ALTER TABLE audit_logs
          DROP CONSTRAINT reject_evaluation_audit
        `);
      }
    });

    await t.test('public evaluation records remain untouched', async () => {
      const result = await client.query(`
        SELECT COUNT(*) AS count
        FROM public.performance_evaluations
      `);

      assert.equal(Number(result.rows[0].count), publicBefore);
    });

  } finally {
    try {
      await client.query('ROLLBACK');
    } catch {}

    try {
      await client.query('RESET search_path');
    } catch {}

    try {
      await client.query('DISCARD TEMP');
    } catch {}

    client.release();
    await pool.end();
  }
});
