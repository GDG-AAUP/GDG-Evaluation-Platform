
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getCampusRanking
} = require('../dist/phase2/rankings/get-campus-ranking.js');

test('Monthly Campus leaderboard calculates correctly in PostgreSQL', {
  skip: !process.env.DB_NAME,
  timeout: 120000
}, async (t) => {
  const pool = require('../src/config/db');
  const client = await pool.connect();
  let transactionStarted = false;

  // Use the same connection so all queries see the temporary tables.
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

    // All fixtures are temporary and rolled back.
    for (const table of [
      'campuses',
      'users',
      'teams',
      'assignment_history',
      'point_entries'
    ]) {
      await client.query(
        `CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL)`
      );
    }

    await client.query('SET LOCAL search_path TO pg_temp, public');

    await client.query(`
      INSERT INTO campuses (campus_id, campus_name) VALUES
        (1, 'Campus One'),
        (2, 'Campus Two')
    `);

    await client.query(`
      INSERT INTO users (
        user_id, full_name, email, role,
        team_id, is_active, clerk_user_id
      ) VALUES
        (1, 'Organizer', 'campus-org@example.test', 'Organizer', NULL, TRUE, 'campus_org'),
        (5, 'Manager Alpha', 'campus-manager-a@example.test', 'Manager', 2, TRUE, 'campus_manager_a'),
        (6, 'Alice', 'campus-alice@example.test', 'Member', 3, TRUE, 'campus_alice'),
        (7, 'Bea', 'campus-bea@example.test', 'Member', 2, TRUE, 'campus_bea'),
        (8, 'Eli', 'campus-eli@example.test', 'Member', 3, TRUE, 'campus_eli'),
        (9, 'Manager Beta', 'campus-manager-b@example.test', 'Manager', 3, TRUE, 'campus_manager_b'),
        (10, 'Zero', 'campus-zero@example.test', 'Member', 2, TRUE, 'campus_zero'),
        (11, 'Noor', 'campus-noor@example.test', 'Member', 2, TRUE, 'campus_noor'),
        (12, 'Omar', 'campus-omar@example.test', 'Member', 4, TRUE, 'campus_omar'),
        (13, 'Sam', 'campus-sam@example.test', 'Member', 4, TRUE, 'campus_sam'),
        (14, 'New Joiner', 'campus-new@example.test', 'Member', 3, TRUE, 'campus_new'),
        (16, 'Tia', 'campus-tia@example.test', 'Member', 3, TRUE, 'campus_tia')
    `);

    await client.query(`
      INSERT INTO teams (
        team_id, campus_id, team_name, manager_user_id, is_operational
      ) VALUES
        (2, 1, 'Alpha', 5, TRUE),
        (3, 1, 'Beta', 9, TRUE),
        (4, 2, 'Gamma', NULL, FALSE)
    `);

    // Alice transfers within Campus One.
    // Sam transfers from Campus One to Campus Two.
    // Tia transfers from Campus Two to Campus One.
    // Bea has two consecutive assignments within the same team.
    await client.query(`
      INSERT INTO assignment_history (
        user_id, team_id, role_at_time, effective_from, effective_to
      ) VALUES
        (5, 2, 'Manager', '2026-10-01', NULL),
        (6, 2, 'Member', '2026-10-01', '2026-10-16'),
        (6, 3, 'Member', '2026-10-16', NULL),
        (7, 2, 'Member', '2026-10-01', '2026-10-16'),
        (7, 2, 'Member', '2026-10-16', NULL),
        (8, 3, 'Member', '2026-10-01', NULL),
        (9, 3, 'Manager', '2026-10-01', NULL),
        (10, 2, 'Member', '2026-10-01', NULL),
        (11, 2, 'Member', '2026-10-01', NULL),
        (12, 4, 'Member', '2026-10-01', NULL),
        (13, 2, 'Member', '2026-10-01', '2026-10-21'),
        (13, 4, 'Member', '2026-10-21', NULL),
        (14, 3, 'Member', '2026-11-01', NULL),
        (16, 4, 'Member', '2026-10-01', '2026-10-18'),
        (16, 3, 'Member', '2026-10-18', NULL)
    `);

    await addPoint(5, 20, '2026-10-14 12:00:00');
    await addPoint(6, 30, '2026-10-04 12:00:00');
    await addPoint(6, 40, '2026-10-20 12:00:00');
    await addPoint(7, 30, '2026-10-01 00:00:00');
    await addPoint(8, 20, '2026-10-28 12:00:00');
    await addPoint(11, -5, '2026-10-31 23:59:59');
    await addPoint(12, 70, '2026-10-15 12:00:00');
    await addPoint(13, 25, '2026-10-10 12:00:00');
    await addPoint(13, 75, '2026-10-25 12:00:00');
    await addPoint(16, 5, '2026-10-10 12:00:00');
    await addPoint(16, 15, '2026-10-20 12:00:00');

    // Original and reversal cancel within October.
    const originalId = await addPoint(
      7, 15, '2026-10-09 12:00:00'
    );

    await addPoint(
      7, -15, '2026-10-10 12:00:00', originalId
    );

    // November points must not affect October totals.
    await addPoint(7, 90, '2026-11-01 00:00:00');
    await addPoint(6, 10, '2026-11-07 12:00:00');

    await t.test(
      'combines teams and includes zero and negative totals',
      async () => {
        const rows = await getCampusRanking(
          testPool, 1, 2026, 10
        );

        const byId = new Map(
          rows.map(row => [row.userId, row])
        );

        assert.equal(rows.length, 9);

        assert.deepEqual(
          [...byId.keys()].sort((a, b) => a - b),
          [5, 6, 7, 8, 9, 10, 11, 13, 16]
        );

        assert.equal(byId.get(6).totalPoints, 70);
        assert.equal(byId.get(7).totalPoints, 30);
        assert.equal(byId.get(13).totalPoints, 25);
        assert.equal(byId.get(5).totalPoints, 20);
        assert.equal(byId.get(8).totalPoints, 20);
        assert.equal(byId.get(16).totalPoints, 15);
        assert.equal(byId.get(9).totalPoints, 0);
        assert.equal(byId.get(10).totalPoints, 0);
        assert.equal(byId.get(11).totalPoints, -5);
      }
    );

    await t.test(
      'uses dense ranks for ties across different teams',
      async () => {
        const rows = await getCampusRanking(
          testPool, 1, 2026, 10
        );

        const byId = new Map(
          rows.map(row => [row.userId, row])
        );

        assert.deepEqual(
          rows.map(row => row.rank),
          [1, 2, 3, 4, 4, 5, 6, 6, 7]
        );

        assert.equal(byId.get(5).rank, 4);
        assert.equal(byId.get(8).rank, 4);
        assert.equal(byId.get(9).rank, 6);
        assert.equal(byId.get(10).rank, 6);
        assert.equal(typeof rows[0].rank, 'number');
        assert.equal(typeof rows[0].totalPoints, 'number');
      }
    );

    await t.test(
      'same-campus transfer counts each point only once',
      async () => {
        const rows = await getCampusRanking(
          testPool, 1, 2026, 10
        );

        const aliceRows = rows.filter(
          row => row.userId === 6
        );

        assert.equal(aliceRows.length, 1);
        assert.equal(aliceRows[0].totalPoints, 70);
        assert.equal(aliceRows[0].rank, 1);
      }
    );

    await t.test(
      'cross-campus transfers split historical points correctly',
      async () => {
        const campusOne = await getCampusRanking(
          testPool, 1, 2026, 10
        );

        const campusTwo = await getCampusRanking(
          testPool, 2, 2026, 10
        );

        const first = new Map(
          campusOne.map(row => [row.userId, row])
        );

        const second = new Map(
          campusTwo.map(row => [row.userId, row])
        );

        assert.equal(first.get(13).totalPoints, 25);
        assert.equal(second.get(13).totalPoints, 75);
        assert.equal(first.get(16).totalPoints, 15);
        assert.equal(second.get(16).totalPoints, 5);
        assert.equal(second.get(12).totalPoints, 70);

        assert.deepEqual(
          campusTwo.map(row => row.rank),
          [1, 2, 3]
        );
      }
    );

    await t.test(
      'reversal offsets its original points',
      async () => {
        const rows = await getCampusRanking(
          testPool, 1, 2026, 10
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

        const original = await client.query(
          `SELECT points
           FROM point_entries
           WHERE entry_id = $1`,
          [originalId]
        );

        assert.equal(original.rows[0].points, 15);
      }
    );

    await t.test(
      'does not include members from an unrelated campus',
      async () => {
        const campusOne = await getCampusRanking(
          testPool, 1, 2026, 10
        );

        const campusTwo = await getCampusRanking(
          testPool, 2, 2026, 10
        );

        assert.equal(
          campusOne.some(row => row.userId === 12),
          false
        );

        assert.equal(
          campusTwo.some(row => row.userId === 7),
          false
        );

        assert.equal(
          campusOne.some(row => row.userId === 14),
          false
        );

        assert.equal(campusTwo.length, 3);
      }
    );

    await t.test(
      'November has separate totals and newly eligible members',
      async () => {
        const rows = await getCampusRanking(
          testPool, 1, 2026, 11
        );

        const byId = new Map(
          rows.map(row => [row.userId, row])
        );

        assert.equal(byId.get(7).totalPoints, 90);
        assert.equal(byId.get(7).rank, 1);
        assert.equal(byId.get(6).totalPoints, 10);
        assert.equal(byId.get(14).totalPoints, 0);
        assert.equal(
          byId.get(14).fullName,
          'New Joiner'
        );

        assert.equal(byId.has(13), false);
      }
    );

    await t.test(
      'months before assignments return an empty leaderboard',
      async () => {
        const one = await getCampusRanking(
          testPool, 1, 2026, 9
        );

        const two = await getCampusRanking(
          testPool, 2, 2026, 9
        );

        assert.deepEqual(one, []);
        assert.deepEqual(two, []);
      }
    );

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
