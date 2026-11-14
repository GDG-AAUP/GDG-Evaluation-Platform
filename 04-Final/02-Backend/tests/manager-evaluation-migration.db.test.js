
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pool = require('../src/config/db');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    '../db/migrations/005_manager_evaluation_four_criteria.sql'
  ),
  'utf8'
);

async function insertEvaluation(client, scores, name) {
  return client.query(
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
       11, 10, 2, 1, $1,
       '2026-10-20', $2::jsonb, 75
     )`,
    [name, JSON.stringify(scores)]
  );
}

async function getConstraint(client, table) {
  const result = await client.query(
    `SELECT pg_get_constraintdef(oid) AS definition
     FROM pg_constraint
     WHERE conrelid = $1::regclass
       AND conname = 'chk_perf_criteria_count'`,
    [table]
  );

  assert.equal(result.rows.length, 1);

  return result.rows[0].definition;
}

test('Four-criterion migration is safe', {
  timeout: 120000
}, async (t) => {
  const client = await pool.connect();

  try {
    // Record the real database state before testing.
    const publicBefore = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM public.performance_evaluations
    `);

    const publicConstraintBefore = await getConstraint(
      client,
      'public.performance_evaluations'
    );

    // Work only with a PostgreSQL temporary table.
    await client.query(`
      CREATE TEMP TABLE performance_evaluations
      (LIKE public.performance_evaluations INCLUDING ALL)
    `);

    await client.query('SET search_path TO pg_temp, public');

    // Re-create the old 15-criterion schema in the
    // temporary table. Never change the public table.
    await client.query(`
      ALTER TABLE pg_temp.performance_evaluations
      DROP CONSTRAINT chk_perf_criteria_count
    `);

    await client.query(`
      ALTER TABLE pg_temp.performance_evaluations
      ADD CONSTRAINT chk_perf_criteria_count
      CHECK (
        jsonb_typeof(criteria_scores) = 'array'
        AND jsonb_array_length(criteria_scores) = 15
      )
    `);

    await t.test(
      'starts with the simulated old 15-score constraint',
      async () => {
        const definition = await getConstraint(
          client,
          'performance_evaluations'
        );

        assert.match(definition, /15/);

        await insertEvaluation(
          client,
          Array(15).fill(5),
          'Legacy Evaluation'
        );

        const count = await client.query(`
          SELECT COUNT(*)::int AS count
          FROM performance_evaluations
        `);

        assert.equal(count.rows[0].count, 1);
      }
    );

    await t.test(
      'blocks migration when legacy records exist',
      async () => {
        try {
          await assert.rejects(
            client.query(migration),
            /MIGRATION_BLOCKED/
          );
        } finally {
          await client.query('ROLLBACK');
        }
      }
    );

    await t.test(
      'failed migration preserves existing data',
      async () => {
        const result = await client.query(`
          SELECT criteria_scores
          FROM performance_evaluations
        `);

        assert.equal(result.rows.length, 1);
        assert.equal(result.rows[0].criteria_scores.length, 15);

        const definition = await getConstraint(
          client,
          'performance_evaluations'
        );

        assert.match(definition, /15/);
      }
    );

    await t.test(
      'migrates safely once legacy rows are absent',
      async () => {
        await client.query(`
          DELETE FROM performance_evaluations
        `);

        await client.query(migration);

        const definition = await getConstraint(
          client,
          'performance_evaluations'
        );

        assert.match(definition, /4/);
      }
    );

    await t.test(
      'accepts four scores after migration',
      async () => {
        await insertEvaluation(
          client,
          [85, 80, 90, 75],
          'Approved Evaluation'
        );

        const result = await client.query(`
          SELECT criteria_scores
          FROM performance_evaluations
        `);

        assert.equal(result.rows.length, 1);

        assert.deepEqual(
          result.rows[0].criteria_scores,
          [85, 80, 90, 75]
        );
      }
    );

    await t.test(
      'rejects the old 15-score format',
      async () => {
        await assert.rejects(
          insertEvaluation(
            client,
            Array(15).fill(5),
            'Invalid Old Evaluation'
          ),
          { code: '23514' }
        );
      }
    );

    await t.test(
      'migration can run again safely',
      async () => {
        await client.query(migration);

        const count = await client.query(`
          SELECT COUNT(*)::int AS count
          FROM performance_evaluations
        `);

        assert.equal(count.rows[0].count, 1);

        const definition = await getConstraint(
          client,
          'performance_evaluations'
        );

        assert.match(definition, /4/);
      }
    );

    await t.test(
      'real public database remains unchanged',
      async () => {
        const publicAfter = await client.query(`
          SELECT COUNT(*)::int AS count
          FROM public.performance_evaluations
        `);

        const publicConstraintAfter = await getConstraint(
          client,
          'public.performance_evaluations'
        );

        assert.equal(
          publicAfter.rows[0].count,
          publicBefore.rows[0].count
        );

        assert.equal(
          publicConstraintAfter,
          publicConstraintBefore
        );

        assert.match(publicConstraintAfter, /4/);
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
