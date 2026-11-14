
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getRankingOptions
} = require('../dist/phase2/rankings/get-ranking-options.js');

test('Ranking options use real PostgreSQL data', {
  skip: !process.env.DB_NAME,
  timeout: 120000
}, async (t) => {
  const pool = require('../src/config/db');
  const client = await pool.connect();
  let transactionStarted = false;

  const testPool = {
    query: (sql, params) => client.query(sql, params)
  };

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    await client.query(
      'CREATE TEMP TABLE campuses (LIKE public.campuses INCLUDING ALL)'
    );

    await client.query(
      'CREATE TEMP TABLE teams (LIKE public.teams INCLUDING ALL)'
    );

    await client.query('SET LOCAL search_path TO pg_temp, public');

    await client.query(`
      INSERT INTO campuses (campus_id, campus_name)
      VALUES (2, 'Ramallah'), (1, 'Jenin')
    `);

    await client.query(`
      INSERT INTO teams (team_id, campus_id, team_name)
      VALUES
        (4, 2, 'Media'),
        (2, 1, 'Technical'),
        (5, 2, 'Technical'),
        (3, 1, 'Design')
    `);

    await t.test('returns campuses sorted by ID', async () => {
      const result = await getRankingOptions(testPool);

      assert.deepEqual(result.campuses, [
        { id: 1, name: 'Jenin' },
        { id: 2, name: 'Ramallah' }
      ]);
    });

    await t.test('returns public team fields in campus and name order', async () => {
      const result = await getRankingOptions(testPool);

      assert.deepEqual(result.teams, [
        { id: 3, campusId: 1, name: 'Design' },
        { id: 2, campusId: 1, name: 'Technical' },
        { id: 4, campusId: 2, name: 'Media' },
        { id: 5, campusId: 2, name: 'Technical' }
      ]);
    });

    await t.test('supports teams with the same name on different campuses', async () => {
      const result = await getRankingOptions(testPool);

      const technical = result.teams.filter(
        row => row.name === 'Technical'
      );

      assert.deepEqual(
        technical.map(row => row.campusId),
        [1, 2]
      );
    });

    await t.test('new teams appear in the next response', async () => {
      await client.query(`
        INSERT INTO teams (team_id, campus_id, team_name)
        VALUES (6, 1, 'Community')
      `);

      const result = await getRankingOptions(testPool);

      assert.equal(result.teams.length, 5);

      assert.deepEqual(result.teams[0], {
        id: 6,
        campusId: 1,
        name: 'Community'
      });
    });

    await t.test('returns an empty team list when no teams exist', async () => {
      await client.query('DELETE FROM teams');

      const result = await getRankingOptions(testPool);

      assert.deepEqual(result.teams, []);
      assert.equal(result.campuses.length, 2);
    });

    await t.test('returns empty lists when both tables are empty', async () => {
      await client.query('DELETE FROM campuses');

      const result = await getRankingOptions(testPool);

      assert.deepEqual(result, {
        campuses: [],
        teams: []
      });
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
