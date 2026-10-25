
const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/config/db');

const {
  publishMonthlySnapshot
} = require('../dist/phase2/rankings/publish-monthly-snapshot.js');

const {
  getArchivedRanking
} = require('../dist/phase2/rankings/get-archived-ranking.js');

function candidate(year, month, scope, rank = 1) {
  return {
    userId: 11,
    rankingScope: scope,
    teamId: scope === 'Team' ? 2 : null,
    campusId: 1,
    year,
    month,
    totalPoints: 80,
    rankPosition: rank
  };
}

function preview(rows, conflicts = []) {
  return async (db, year, month) => ({
    year,
    month,
    candidates: rows,
    conflicts,
    hasConflicts: conflicts.length > 0,
    emptyMonth: rows.length === 0
  });
}

test('Monthly publishing uses real PostgreSQL transactions', {
  timeout: 120000
}, async (t) => {
  const client = await pool.connect();

  const testPool = {
    connect: async () => ({
      query: (sql, params) => client.query(sql, params),
      release: () => {}
    })
  };

  try {
    for (const table of [
      'campuses',
      'teams',
      'users',
      'monthly_rankings',
      'audit_logs'
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
      INSERT INTO teams (team_id, campus_id, team_name)
      VALUES (2, 1, 'Technical')
    `);

    await client.query(`
      INSERT INTO users (
        user_id, clerk_user_id, full_name,
        email, role, team_id
      ) VALUES
        (10, 'test_pub_organizer', 'Organizer',
         'puborg@example.test', 'Organizer', NULL),
        (11, 'test_pub_member', 'Alice',
         'pubmember@example.test', 'Member', 2)
    `);

    await t.test('publishes Team and Campus snapshots', async () => {
      const rows = [
        candidate(2026, 9, 'Team'),
        candidate(2026, 9, 'Campus')
      ];

      const result = await publishMonthlySnapshot(
        testPool,
        2026,
        9,
        10,
        preview(rows)
      );

      assert.equal(result.published, true);
      assert.equal(result.rowCount, 2);

      const saved = await client.query(`
        SELECT ranking_scope, archived_at
        FROM monthly_rankings
        WHERE year = 2026 AND month = 9
      `);

      assert.equal(saved.rows.length, 2);

      for (const row of saved.rows) {
        assert.notEqual(row.archived_at, null);
      }

      const archived = await getArchivedRanking(
        { query: (sql, params) => client.query(sql, params) },
        {
          scope: 'Team',
          teamId: 2,
          campusId: null,
          year: 2026,
          month: 9
        }
      );

      assert.equal(archived.length, 1);
      assert.equal(archived[0].fullName, 'Alice');
      assert.equal(archived[0].totalPoints, 80);
    });

    await t.test('stores the publication audit record', async () => {
      const result = await client.query(`
        SELECT actor_user_id, entity_id, new_values
        FROM audit_logs
        WHERE action = 'MONTHLY_RANKINGS_PUBLISHED'
          AND entity_id = '2026-09'
      `);

      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].actor_user_id, 10);
      assert.equal(result.rows[0].new_values.rowCount, 2);
    });

    await t.test('prevents duplicate publication', async () => {
      await assert.rejects(
        publishMonthlySnapshot(
          testPool,
          2026,
          9,
          10,
          preview([])
        ),
        /MONTH_ALREADY_PUBLISHED/
      );

      const result = await client.query(`
        SELECT COUNT(*)::int AS count
        FROM monthly_rankings
        WHERE year = 2026 AND month = 9
      `);

      assert.equal(result.rows[0].count, 2);
    });

    await t.test('publishes an empty month with an audit marker', async () => {
      const result = await publishMonthlySnapshot(
        testPool,
        2026,
        8,
        10,
        preview([])
      );

      assert.equal(result.emptyMonth, true);
      assert.equal(result.rowCount, 0);

      const audit = await client.query(`
        SELECT new_values
        FROM audit_logs
        WHERE entity_id = '2026-08'
          AND action = 'MONTHLY_RANKINGS_PUBLISHED'
      `);

      assert.equal(audit.rows.length, 1);
      assert.equal(audit.rows[0].new_values.emptyMonth, true);

      await assert.rejects(
        publishMonthlySnapshot(
          testPool, 2026, 8, 10, preview([])
        ),
        /MONTH_ALREADY_PUBLISHED/
      );
    });

    await t.test('rejects non-organizer publication', async () => {
      await assert.rejects(
        publishMonthlySnapshot(
          testPool,
          2026,
          7,
          11,
          preview([candidate(2026, 7, 'Team')])
        ),
        /FORBIDDEN_SNAPSHOT_PUBLICATION/
      );

      const result = await client.query(`
        SELECT COUNT(*)::int AS count
        FROM monthly_rankings
        WHERE year = 2026 AND month = 7
      `);

      assert.equal(result.rows[0].count, 0);
    });

    await t.test('rolls back all rows on SQL constraint failure', async () => {
      const rows = [
        candidate(2026, 6, 'Team', 1),
        candidate(2026, 6, 'Campus', 0)
      ];

      await assert.rejects(
        publishMonthlySnapshot(
          testPool,
          2026,
          6,
          10,
          preview(rows)
        ),
        { code: '23514' }
      );

      const saved = await client.query(`
        SELECT COUNT(*)::int AS count
        FROM monthly_rankings
        WHERE year = 2026 AND month = 6
      `);

      const audit = await client.query(`
        SELECT COUNT(*)::int AS count
        FROM audit_logs
        WHERE entity_id = '2026-06'
          AND action = 'MONTHLY_RANKINGS_PUBLISHED'
      `);

      assert.equal(saved.rows[0].count, 0);
      assert.equal(audit.rows[0].count, 0);
    });

    await t.test('rejects conflicting ranking candidates', async () => {
      const rows = [candidate(2026, 5, 'Team')];

      await assert.rejects(
        publishMonthlySnapshot(
          testPool,
          2026,
          5,
          10,
          preview(rows, [{ userId: 11 }])
        ),
        /SNAPSHOT_CONFLICTS/
      );
    });

    await t.test('rejects existing snapshot rows without an audit marker', async () => {
      await client.query(`
        INSERT INTO monthly_rankings (
          user_id, ranking_scope, team_id, campus_id,
          year, month, total_points, rank_position, archived_at
        ) VALUES (11, 'Team', 2, 1, 2026, 4, 30, 1, CURRENT_TIMESTAMP)
      `);

      await assert.rejects(
        publishMonthlySnapshot(
          testPool,
          2026,
          4,
          10,
          preview([])
        ),
        /EXISTING_SNAPSHOT_ROWS/
      );
    });

  } finally {
    try {
      await client.query('RESET search_path');
      await client.query('DISCARD TEMP');
    } finally {
      client.release();
      await pool.end();
    }
  }
});
