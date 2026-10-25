
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getTeamRanking
} = require('../dist/phase2/rankings/get-team-ranking.js');

test('Monthly Team leaderboard calculates correctly in PostgreSQL', {
  skip: !process.env.DB_NAME,
  timeout: 120000
}, async (t) => {
  const pool = require('../src/config/db');
  const client = await pool.connect();
  let transactionStarted = false;

  // Run the real SQL through the connection that owns our temporary tables.
  const testPool = {
    query: (sql, params) => client.query(sql, params)
  };

  const addPoint = async (
    userId,
    points,
    effectiveAt,
    reversesEntryId = null
  ) => {
    const result = await client.query(
      `INSERT INTO point_entries (
         user_id, performed_by_user_id, points,
         activity_name, reason, effective_at, reverses_entry_id
       ) VALUES (
         $1, 1, $2, 'Workshop', 'Test fixture', $3::timestamp, $4
       )
       RETURNING entry_id::text AS id`,
      [userId, points, effectiveAt, reversesEntryId]
    );

    return result.rows[0].id;
  };

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // Temporary tables isolate all test data.
    for (const table of [
      'campuses',
      'users',
      'teams',
      'assignment_history',
      'point_entries'
    ]) {
      await client.query(
        `CREATE TEMP TABLE ${table}
         (LIKE public.${table} INCLUDING ALL)`
      );
    }

    await client.query(
      'SET LOCAL search_path TO pg_temp, public'
    );

    await client.query(`
      INSERT INTO campuses (campus_id, campus_name)
      VALUES (1, 'Ranking Test Campus')
    `);

    await client.query(`
      INSERT INTO users (
        user_id, full_name, email, role,
        team_id, is_active, clerk_user_id
      ) VALUES
        (
          1, 'Organizer', 'ranking-organizer@example.test',
          'Organizer', NULL, TRUE, 'ranking_org'
        ),
        (
          5, 'Manager A', 'ranking-manager-a@example.test',
          'Manager', 2, TRUE, 'ranking_manager_a'
        ),
        (
          6, 'Alice', 'ranking-alice@example.test',
          'Member', 3, TRUE, 'ranking_alice'
        ),
        (
          7, 'Bea', 'ranking-bea@example.test',
          'Member', 2, TRUE, 'ranking_bea'
        ),
        (
          8, 'Eli', 'ranking-eli@example.test',
          'Member', 2, TRUE, 'ranking_eli'
        ),
        (
          9, 'Manager B', 'ranking-manager-b@example.test',
          'Manager', 3, TRUE, 'ranking_manager_b'
        ),
        (
          10, 'Zero', 'ranking-zero@example.test',
          'Member', 2, TRUE, 'ranking_zero'
        ),
        (
          11, 'Noor', 'ranking-noor@example.test',
          'Member', 2, TRUE, 'ranking_noor'
        ),
        (
          12, 'New Joiner', 'ranking-new@example.test',
          'Member', 2, TRUE, 'ranking_new'
        )
    `);

    await client.query(`
      INSERT INTO teams (
        team_id, campus_id, team_name,
        manager_user_id, is_operational
      ) VALUES
        (2, 1, 'Alpha', 5, TRUE),
        (3, 1, 'Beta', 9, TRUE)
    `);

    // Alice transfers from Alpha to Beta on October 16.
    // Bea has two consecutive records for Alpha.
    await client.query(`
      INSERT INTO assignment_history (
        user_id, team_id, role_at_time,
        effective_from, effective_to
      ) VALUES
        (5, 2, 'Manager', '2026-10-01', NULL),
        (6, 2, 'Member', '2026-10-01', '2026-10-16'),
        (6, 3, 'Member', '2026-10-16', NULL),
        (7, 2, 'Member', '2026-10-01', '2026-10-16'),
        (7, 2, 'Member', '2026-10-16', NULL),
        (8, 2, 'Member', '2026-10-01', NULL),
        (9, 3, 'Manager', '2026-10-01', NULL),
        (10, 2, 'Member', '2026-10-01', NULL),
        (11, 2, 'Member', '2026-10-01', NULL),
        (12, 2, 'Member', '2026-11-01', NULL)
    `);

    await addPoint(5, 20, '2026-10-14 12:00:00');
    await addPoint(6, 30, '2026-10-04 12:00:00');
    await addPoint(6, 40, '2026-10-20 12:00:00');
    await addPoint(7, 30, '2026-10-01 00:00:00');
    await addPoint(8, 20, '2026-10-28 12:00:00');
    await addPoint(11, -5, '2026-10-31 23:59:59');

    // Equal and opposite entries cancel within October.
    const originalId = await addPoint(
      7,
      15,
      '2026-10-09 12:00:00'
    );

    await addPoint(
      7,
      -15,
      '2026-10-10 12:00:00',
      originalId
    );

    // November points must not affect October rankings.
    await addPoint(
      7,
      90,
      '2026-11-01 00:00:00'
    );

    await t.test(
      'Team Alpha has the expected October totals',
      async () => {
        const rows = await getTeamRanking(
          testPool, 2, 2026, 10
        );

        const byId = new Map(
          rows.map(row => [row.userId, row])
        );

        assert.equal(rows.length, 6);

        assert.deepEqual(
          [...byId.keys()].sort((a, b) => a - b),
          [5, 6, 7, 8, 10, 11]
        );

        assert.equal(byId.get(6).totalPoints, 30);
        assert.equal(byId.get(7).totalPoints, 30);
        assert.equal(byId.get(5).totalPoints, 20);
        assert.equal(byId.get(8).totalPoints, 20);
        assert.equal(byId.get(10).totalPoints, 0);
        assert.equal(byId.get(11).totalPoints, -5);
        assert.equal(byId.get(6).fullName, 'Alice');
      }
    );

    await t.test(
      'ties use dense ranks and managers are included',
      async () => {
        const rows = await getTeamRanking(
          testPool, 2, 2026, 10
        );

        const byId = new Map(
          rows.map(row => [row.userId, row])
        );

        assert.equal(byId.get(6).rank, 1);
        assert.equal(byId.get(7).rank, 1);
        assert.equal(byId.get(5).rank, 2);
        assert.equal(byId.get(8).rank, 2);
        assert.equal(byId.get(10).rank, 3);
        assert.equal(byId.get(11).rank, 4);

        assert.deepEqual(
          rows.map(row => row.rank),
          [1, 1, 2, 2, 3, 4]
        );

        assert.equal(typeof rows[0].rank, 'number');
        assert.equal(typeof rows[0].totalPoints, 'number');
      }
    );

    await t.test(
      'transferred points belong to the historical team',
      async () => {
        const beta = await getTeamRanking(
          testPool, 3, 2026, 10
        );

        const byId = new Map(
          beta.map(row => [row.userId, row])
        );

        assert.equal(beta.length, 2);
        assert.equal(byId.get(6).totalPoints, 40);
        assert.equal(byId.get(6).rank, 1);
        assert.equal(byId.get(9).totalPoints, 0);
        assert.equal(byId.get(9).rank, 2);
        assert.equal(byId.has(7), false);
      }
    );

    await t.test(
      'same-month reversal cancels the original amount',
      async () => {
        const rows = await getTeamRanking(
          testPool, 2, 2026, 10
        );

        const bea = rows.find(
          row => row.userId === 7
        );

        assert.equal(bea.totalPoints, 30);

        const reversal = await client.query(
          `SELECT points
           FROM point_entries
           WHERE reverses_entry_id = $1`,
          [originalId]
        );

        assert.equal(reversal.rows.length, 1);
        assert.equal(reversal.rows[0].points, -15);
      }
    );

    await t.test(
      'November has its own month and a newly eligible member',
      async () => {
        const rows = await getTeamRanking(
          testPool, 2, 2026, 11
        );

        const byId = new Map(
          rows.map(row => [row.userId, row])
        );

        assert.equal(byId.get(7).totalPoints, 90);
        assert.equal(byId.get(7).rank, 1);
        assert.equal(byId.get(12).totalPoints, 0);
        assert.equal(
          byId.get(12).fullName,
          'New Joiner'
        );
      }
    );

    await t.test(
      'months before the first assignment have no roster',
      async () => {
        const rows = await getTeamRanking(
          testPool, 2, 2026, 9
        );

        assert.deepEqual(rows, []);
      }
    );

  } finally {
    try {
      // Discard all temporary data.
      if (transactionStarted) {
        await client.query('ROLLBACK');
      }
    } finally {
      client.release();
      await pool.end();
    }
  }
});
