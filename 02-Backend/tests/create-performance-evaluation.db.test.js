
const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/config/db');

const {
  createPerformanceEvaluation
} = require('../dist/phase2/evaluations/create-performance-evaluation.js');

const scores83 = [85, 80, 90, 75];
const scores69 = [70, 65, 80, 60];

function evaluation(overrides = {}) {
  return {
    evaluatedUserId: 11,
    activityName: 'Technical Workshop',
    activityDate: '2026-10-20',
    criteriaScores: [...scores83],
    criteriaTotalScore: 100,
    comments: 'Excellent work',
    ...overrides
  };
}

test('Four-criterion performance evaluations work with PostgreSQL', {
  timeout: 120000
}, async (t) => {
  const client = await pool.connect();

  const testPool = {
    connect: async () => ({
      query: (sql, params) => client.query(sql, params),
      release: () => {}
    })
  };

  async function count(table) {
    assert.ok([
      'performance_evaluations',
      'audit_logs'
    ].includes(table));

    const result = await client.query(
      `SELECT COUNT(*)::int AS count FROM ${table}`
    );

    return result.rows[0].count;
  }

  try {
    for (const table of [
      'campuses',
      'teams',
      'users',
      'performance_evaluations',
      'audit_logs'
    ]) {
      await client.query(
        `CREATE TEMP TABLE ${table}
         (LIKE public.${table} INCLUDING ALL)`
      );
    }

    await client.query('SET search_path TO pg_temp, public');

    await client.query(`
      INSERT INTO campuses (campus_id, campus_name)
      VALUES (1, 'Jenin')
    `);

    await client.query(`
      INSERT INTO teams (team_id, campus_id, team_name)
      VALUES (2, 1, 'Technical')
    `);

    await client.query(`
      INSERT INTO users (
        user_id, clerk_user_id, full_name,
        email, role, team_id, is_active
      ) VALUES
        (10, 'eval_test_10', 'Organizer',
         'eval10@example.test', 'Organizer', NULL, TRUE),

        (11, 'eval_test_11', 'Manager',
         'eval11@example.test', 'Manager', 2, TRUE),

        (12, 'eval_test_12', 'Member',
         'eval12@example.test', 'Member', 2, TRUE),

        (13, 'eval_test_13', 'Inactive Manager',
         'eval13@example.test', 'Manager', 2, FALSE),

        (14, 'eval_test_14', 'Inactive Organizer',
         'eval14@example.test', 'Organizer', NULL, FALSE)
    `);

    await t.test('Organizer creates evaluation', async () => {
      const result = await createPerformanceEvaluation(
        testPool,
        10,
        evaluation()
      );

      assert.equal(result.outcome, 'created');
      assert.equal(result.evaluation.totalScore, 83);
      assert.equal(await count('performance_evaluations'), 1);
    });

    await t.test('Saves correct Team, Campus and four scores', async () => {
      const result = await client.query(`
        SELECT
          evaluated_user_id,
          evaluated_by_user_id,
          team_id,
          campus_id,
          criteria_scores,
          criteria_total_score
        FROM performance_evaluations
      `);

      const row = result.rows[0];

      assert.equal(row.evaluated_user_id, 11);
      assert.equal(row.evaluated_by_user_id, 10);
      assert.equal(row.team_id, 2);
      assert.equal(row.campus_id, 1);
      assert.equal(row.criteria_total_score, 83);
      assert.deepEqual(row.criteria_scores, scores83);
    });

    await t.test('Creates corresponding audit record', async () => {
      const result = await client.query(`
        SELECT
          actor_user_id,
          action,
          entity_name,
          new_values
        FROM audit_logs
        WHERE action = 'PERFORMANCE_EVALUATION_CREATED'
      `);

      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].actor_user_id, 10);
      assert.equal(
        result.rows[0].entity_name,
        'performance_evaluations'
      );
      assert.equal(result.rows[0].new_values.totalScore, 83);
    });

    await t.test(
      'Supports multiple evaluations and monthly average',
      async () => {
        const result = await createPerformanceEvaluation(
          testPool,
          10,
          evaluation({
            activityName: 'Second Workshop',
            activityDate: '2026-10-21',
            criteriaScores: scores69,
            criteriaTotalScore: 100
          })
        );

        assert.equal(result.outcome, 'created');
        assert.equal(result.evaluation.totalScore, 69);

        const averages = await client.query(`
          SELECT
            COUNT(*)::int AS evaluation_count,
            AVG(criteria_total_score)::numeric AS average_score
          FROM performance_evaluations
          WHERE evaluated_user_id = 11
            AND activity_date >= '2026-10-01'
            AND activity_date < '2026-11-01'
        `);

        assert.equal(averages.rows[0].evaluation_count, 2);
        assert.equal(Number(averages.rows[0].average_score), 76);
      }
    );

    await t.test('Rejects Member as evaluator', async () => {
      const before = await count('performance_evaluations');

      const result = await createPerformanceEvaluation(
        testPool,
        12,
        evaluation()
      );

      assert.equal(result.outcome, 'forbidden');
      assert.equal(await count('performance_evaluations'), before);
    });

    await t.test('Rejects Manager as evaluator', async () => {
      const before = await count('performance_evaluations');

      const result = await createPerformanceEvaluation(
        testPool,
        11,
        evaluation()
      );

      assert.equal(result.outcome, 'forbidden');
      assert.equal(await count('performance_evaluations'), before);
    });

    await t.test('Rejects inactive Organizer', async () => {
      const result = await createPerformanceEvaluation(
        testPool,
        14,
        evaluation()
      );

      assert.equal(result.outcome, 'forbidden');
    });

    await t.test('Rejects evaluating a Member', async () => {
      const result = await createPerformanceEvaluation(
        testPool,
        10,
        evaluation({ evaluatedUserId: 12 })
      );

      assert.equal(result.outcome, 'target_ineligible');
    });

    await t.test('Rejects inactive Manager', async () => {
      const result = await createPerformanceEvaluation(
        testPool,
        10,
        evaluation({ evaluatedUserId: 13 })
      );

      assert.equal(result.outcome, 'target_ineligible');
    });

    await t.test('Rejects nonexistent target', async () => {
      const result = await createPerformanceEvaluation(
        testPool,
        10,
        evaluation({ evaluatedUserId: 999 })
      );

      assert.equal(result.outcome, 'target_not_found');
    });

    await t.test(
      'Database rejects the old 15-score format',
      async () => {
        const before = await count('performance_evaluations');

        await assert.rejects(
          client.query(
            `INSERT INTO performance_evaluations (
               evaluated_user_id,
               evaluated_by_user_id,
               team_id,
               campus_id,
               activity_name,
               activity_date,
               criteria_scores,
               criteria_total_score
             )
             VALUES (
               11, 10, 2, 1,
               'Old format evaluation',
               '2026-10-23',
               $1::jsonb,
               50
             )`,
            [JSON.stringify(Array(15).fill(5))]
          ),
          { code: '23514' }
        );

        assert.equal(
          await count('performance_evaluations'),
          before
        );
      }
    );

    await t.test(
      'Rolls back evaluation on SQL constraint failure',
      async () => {
        const before = await count('performance_evaluations');

        await client.query(`
          ALTER TABLE performance_evaluations
          ADD CONSTRAINT reject_test_score_83
          CHECK (criteria_total_score <> 83)
          NOT VALID
        `);

        try {
          await assert.rejects(
            createPerformanceEvaluation(
              testPool,
              10,
              evaluation({
                activityName: 'Constraint Failure Test',
                activityDate: '2026-10-24'
              })
            ),
            { code: '23514' }
          );

          assert.equal(
            await count('performance_evaluations'),
            before
          );
        } finally {
          await client.query(`
            ALTER TABLE performance_evaluations
            DROP CONSTRAINT reject_test_score_83
          `);
        }
      }
    );

    await t.test(
      'Rolls back evaluation if audit insertion fails',
      async () => {
        const beforeEvaluations = await count(
          'performance_evaluations'
        );

        const beforeAudits = await count('audit_logs');

        await client.query(`
          ALTER TABLE audit_logs
          ADD CONSTRAINT reject_new_evaluation_audit
          CHECK (action <> 'PERFORMANCE_EVALUATION_CREATED')
          NOT VALID
        `);

        try {
          await assert.rejects(
            createPerformanceEvaluation(
              testPool,
              10,
              evaluation({
                activityName: 'Rollback Test',
                activityDate: '2026-10-25'
              })
            ),
            { code: '23514' }
          );

          assert.equal(
            await count('performance_evaluations'),
            beforeEvaluations
          );

          assert.equal(
            await count('audit_logs'),
            beforeAudits
          );
        } finally {
          await client.query(`
            ALTER TABLE audit_logs
            DROP CONSTRAINT reject_new_evaluation_audit
          `);
        }
      }
    );

  } finally {
    try {
      await client.query('ROLLBACK');
    } catch {}

    try {
      await client.query('RESET search_path');
      await client.query('DISCARD TEMP');
    } finally {
      client.release();
      await pool.end();
    }
  }
});
