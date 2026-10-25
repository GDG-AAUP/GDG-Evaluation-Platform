
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getArchivedRanking
} = require('../dist/phase2/rankings/get-archived-ranking.js');

test('Archived rankings read real PostgreSQL snapshots', {
  skip: !process.env.DB_NAME,
  timeout: 120000
}, async (t) => {
  const pool = require('../src/config/db');
  const client = await pool.connect();
  let transactionStarted = false;

  const testPool = {
    query: (sql, params) => client.query(sql, params)
  };

  const query = (scope, teamId, campusId, year = 2026, month = 10) => ({
    scope,
    teamId,
    campusId,
    year,
    month
  });

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    for (const table of [
      'campuses',
      'users',
      'teams',
      'monthly_rankings'
    ]) {
      await client.query(
        `CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL)`
      );
    }

    await client.query('SET LOCAL search_path TO pg_temp, public');

    await client.query(`
      INSERT INTO campuses (campus_id, campus_name)
      VALUES (1, 'Jenin'), (2, 'Ramallah')
    `);


await client.query(`
  INSERT INTO users (
    user_id, clerk_user_id, full_name, email, role, team_id
  ) VALUES
    (101, 'test_clerk_101', 'Alice', 'archive101@example.test', 'Member', 10),
    (102, 'test_clerk_102', 'Bea', 'archive102@example.test', 'Member', 10),
    (103, 'test_clerk_103', 'Omar', 'archive103@example.test', 'Member', 10),
    (104, 'test_clerk_104', 'Zara', 'archive104@example.test', 'Member', 20),
    (105, 'test_clerk_105', 'Nora', 'archive105@example.test', 'Member', 30),
    (106, 'test_clerk_106', 'Max', 'archive106@example.test', 'Member', 10),
    (107, 'test_clerk_107', 'Older', 'archive107@example.test', 'Member', 10)
`);


    await client.query(`
      INSERT INTO teams (team_id, campus_id, team_name)
      VALUES
        (10, 1, 'Technical'),
        (20, 1, 'Design'),
        (30, 2, 'Technical')
    `);

    await client.query(`
      INSERT INTO monthly_rankings (
        user_id, ranking_scope, team_id, campus_id,
        month, year, total_points, rank_position, archived_at
      ) VALUES
        (101, 'Team', 10, 1, 10, 2026, 80, 1, '2026-11-01'),
        (102, 'Team', 10, 1, 10, 2026, 80, 1, '2026-11-01'),
        (103, 'Team', 10, 1, 10, 2026, 20, 2, '2026-11-01'),
        (104, 'Team', 20, 1, 10, 2026, 90, 1, '2026-11-01'),
        (105, 'Team', 30, 2, 10, 2026, 55, 1, '2026-11-01'),

        (101, 'Campus', NULL, 1, 10, 2026, 80, 2, '2026-11-01'),
        (102, 'Campus', NULL, 1, 10, 2026, 80, 2, '2026-11-01'),
        (103, 'Campus', NULL, 1, 10, 2026, 20, 3, '2026-11-01'),
        (104, 'Campus', NULL, 1, 10, 2026, 90, 1, '2026-11-01'),
        (105, 'Campus', NULL, 2, 10, 2026, 55, 1, '2026-11-01'),

        (106, 'Team', 10, 1, 10, 2026, 100, 1, NULL),
        (107, 'Team', 10, 1, 9, 2026, 90, 1, '2026-10-01'),
        (107, 'Team', 10, 1, 10, 2025, 95, 1, '2025-11-01')
    `);

    await t.test('returns archived Team rankings', async () => {
      const rows = await getArchivedRanking(
        testPool,
        query('Team', 10, null)
      );

      assert.deepEqual(rows, [
        { rank: 1, userId: 101, fullName: 'Alice', totalPoints: 80 },
        { rank: 1, userId: 102, fullName: 'Bea', totalPoints: 80 },
        { rank: 2, userId: 103, fullName: 'Omar', totalPoints: 20 }
      ]);
    });

    await t.test('preserves dense ranks and tied positions', async () => {
      const rows = await getArchivedRanking(
        testPool,
        query('Team', 10, null)
      );

      assert.deepEqual(rows.map(row => row.rank), [1, 1, 2]);
    });

    await t.test('filters other Teams', async () => {
      const rows = await getArchivedRanking(
        testPool,
        query('Team', 20, null)
      );

      assert.deepEqual(rows.map(row => row.userId), [104]);
    });

    await t.test('returns Campus rankings independently', async () => {
      const rows = await getArchivedRanking(
        testPool,
        query('Campus', null, 1)
      );

      assert.deepEqual(rows.map(row => row.userId), [
        104, 101, 102, 103
      ]);

      assert.deepEqual(rows.map(row => row.rank), [1, 2, 2, 3]);
    });

    await t.test('keeps Ramallah separate from Jenin', async () => {
      const rows = await getArchivedRanking(
        testPool,
        query('Campus', null, 2)
      );

      assert.equal(rows.length, 1);
      assert.equal(rows[0].userId, 105);
    });

    await t.test('excludes rows that are not archived', async () => {
      const rows = await getArchivedRanking(
        testPool,
        query('Team', 10, null)
      );

      assert.equal(rows.some(row => row.userId === 106), false);
    });

    await t.test('filters by month and year', async () => {
      const september = await getArchivedRanking(
        testPool,
        query('Team', 10, null, 2026, 9)
      );

      const lastYear = await getArchivedRanking(
        testPool,
        query('Team', 10, null, 2025, 10)
      );

      assert.deepEqual(september.map(row => row.userId), [107]);
      assert.deepEqual(lastYear.map(row => row.userId), [107]);
      assert.equal(september[0].totalPoints, 90);
      assert.equal(lastYear[0].totalPoints, 95);
    });

    await t.test('returns empty array when no snapshot matches', async () => {
      const rows = await getArchivedRanking(
        testPool,
        query('Team', 999, null)
      );

      assert.deepEqual(rows, []);
    });
  } finally {
    try {
      if (transactionStarted) {
        await client.query('ROLLBACK');
      }
    } finally {
      client.release();
      await pool.end();
    }
  }
});
