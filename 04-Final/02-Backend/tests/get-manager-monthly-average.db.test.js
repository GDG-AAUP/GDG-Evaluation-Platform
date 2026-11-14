
const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/config/db');

const {
  getManagerMonthlyAverage
} = require('../dist/phase2/evaluations/get-manager-monthly-average.js');

test('Manager monthly averages: real PostgreSQL', {
  skip: !process.env.DB_NAME,
  timeout: 120000
}, async (t) => {
  const client = await pool.connect();

  const scopedPool = {
    query: (...args) => client.query(...args)
  };

  async function reset() {
    await client.query(
      'TRUNCATE performance_evaluations RESTART IDENTITY'
    );
  }

  async function add(targetId, date, score) {
    await client.query(
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
         $1, 10, 2, 1, 'Monthly review',
         $2::timestamp, $3::jsonb, $4
       )`,
      [
        targetId,
        date,
        JSON.stringify([score, score, score, score]),
        score
      ]
    );
  }

  function average(
    managerId = 5,
    year = 2026,
    month = 10
  ) {
    return getManagerMonthlyAverage(
      scopedPool,
      managerId,
      year,
      month
    );
  }

  try {
    const publicBefore = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM public.performance_evaluations
    `);

    await client.query(`
      CREATE TEMP TABLE users
      (LIKE public.users INCLUDING ALL)
    `);

    await client.query(`
      CREATE TEMP TABLE performance_evaluations
      (LIKE public.performance_evaluations INCLUDING ALL)
    `);

    await client.query('SET search_path TO pg_temp, public');

    await client.query(`
      INSERT INTO users (
        user_id,
        clerk_user_id,
        full_name,
        email,
        role,
        team_id,
        is_active
      )
      VALUES
        (5, 'test_average_mgr_5', 'Manager One',
         'average-mgr5@example.test', 'Manager', 2, TRUE),

        (6, 'test_average_mgr_6', 'Manager Two',
         'average-mgr6@example.test', 'Manager', 2, TRUE),

        (7, 'test_average_mgr_7', 'Inactive Manager',
         'average-mgr7@example.test', 'Manager', 2, FALSE),

        (10, 'test_average_org_10', 'Organizer',
         'average-org10@example.test', 'Organizer', NULL, TRUE),

        (11, 'test_average_member_11', 'Member',
         'average-member11@example.test', 'Member', 2, TRUE)
    `);

    await t.test(
      'calculates the average of two October evaluations',
      async () => {
        await reset();

        await add(5, '2026-10-05', 83);
        await add(5, '2026-10-20', 69);

        const result = await average();

        assert.deepEqual(result, {
          outcome: 'found',
          managerUserId: 5,
          year: 2026,
          month: 10,
          evaluationCount: 2,
          averageScore: 76
        });
      }
    );

    await t.test(
      'rounds fractional averages to two decimal places',
      async () => {
        await reset();

        await add(5, '2026-10-01', 83);
        await add(5, '2026-10-10', 69);
        await add(5, '2026-10-20', 75);

        const result = await average();

        assert.equal(result.evaluationCount, 3);
        assert.equal(result.averageScore, 75.67);
      }
    );

    await t.test(
      'includes zero and maximum scores in the average',
      async () => {
        await reset();

        await add(5, '2026-10-01', 0);
        await add(5, '2026-10-15', 100);

        const result = await average();

        assert.equal(result.evaluationCount, 2);
        assert.equal(result.averageScore, 50);
      }
    );

    await t.test(
      'includes October boundaries but excludes adjacent months',
      async () => {
        await reset();

        await add(5, '2026-09-30 23:59:59', 100);
        await add(5, '2026-10-01 00:00:00', 70);
        await add(5, '2026-10-31 23:59:59', 90);
        await add(5, '2026-11-01 00:00:00', 0);

        const result = await average();

        assert.equal(result.evaluationCount, 2);
        assert.equal(result.averageScore, 80);
      }
    );

    await t.test(
      'excludes evaluations from other years',
      async () => {
        await reset();

        await add(5, '2025-10-15', 10);
        await add(5, '2026-10-15', 55);
        await add(5, '2027-10-15', 100);

        const result = await average();

        assert.equal(result.evaluationCount, 1);
        assert.equal(result.averageScore, 55);
      }
    );

    await t.test(
      'keeps different Managers evaluations separate',
      async () => {
        await reset();

        await add(5, '2026-10-10', 80);
        await add(6, '2026-10-10', 20);

        const first = await average(5);
        const second = await average(6);

        assert.equal(first.evaluationCount, 1);
        assert.equal(first.averageScore, 80);

        assert.equal(second.evaluationCount, 1);
        assert.equal(second.averageScore, 20);
      }
    );

    await t.test(
      'returns null when a Manager has no evaluations',
      async () => {
        await reset();

        const result = await average();

        assert.deepEqual(result, {
          outcome: 'found',
          managerUserId: 5,
          year: 2026,
          month: 10,
          evaluationCount: 0,
          averageScore: null
        });
      }
    );

    await t.test(
      'returns not_found for a nonexistent user',
      async () => {
        await reset();

        const result = await average(999);

        assert.deepEqual(result, {
          outcome: 'not_found'
        });
      }
    );

    await t.test(
      'rejects Members as Manager evaluation targets',
      async () => {
        await reset();

        const result = await average(11);

        assert.deepEqual(result, {
          outcome: 'not_manager'
        });
      }
    );

    await t.test(
      'rejects Organizers as Manager evaluation targets',
      async () => {
        await reset();

        const result = await average(10);

        assert.deepEqual(result, {
          outcome: 'not_manager'
        });
      }
    );

    await t.test(
      'retains historical averages for inactive Managers',
      async () => {
        await reset();

        await add(7, '2026-10-05', 60);
        await add(7, '2026-10-20', 80);

        const result = await average(7);

        assert.equal(result.outcome, 'found');
        assert.equal(result.evaluationCount, 2);
        assert.equal(result.averageScore, 70);
      }
    );

    await t.test(
      'handles the December-to-January year boundary',
      async () => {
        await reset();

        await add(5, '2026-12-31 23:59:59', 99);
        await add(5, '2027-01-01 00:00:00', 1);

        const december = await average(5, 2026, 12);
        const january = await average(5, 2027, 1);

        assert.equal(december.evaluationCount, 1);
        assert.equal(december.averageScore, 99);

        assert.equal(january.evaluationCount, 1);
        assert.equal(january.averageScore, 1);
      }
    );

    await t.test(
      'reading an average does not modify evaluation records',
      async () => {
        await reset();

        await add(5, '2026-10-05', 83);
        await add(5, '2026-10-20', 69);

        const before = await client.query(`
          SELECT evaluation_id, criteria_total_score
          FROM performance_evaluations
          ORDER BY evaluation_id
        `);

        await average();

        const after = await client.query(`
          SELECT evaluation_id, criteria_total_score
          FROM performance_evaluations
          ORDER BY evaluation_id
        `);

        assert.deepEqual(after.rows, before.rows);
      }
    );

    await t.test(
      'does not modify the public database',
      async () => {
        const publicAfter = await client.query(`
          SELECT COUNT(*)::int AS count
          FROM public.performance_evaluations
        `);

        assert.equal(
          publicAfter.rows[0].count,
          publicBefore.rows[0].count
        );
      }
    );

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
