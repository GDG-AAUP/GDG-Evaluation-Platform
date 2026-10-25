
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('final PostgreSQL schema supports fresh installation and repeatable migrations', {
  skip: !process.env.DB_NAME,
  timeout: 120000
}, async () => {
  const pool = require('../src/config/db');
  const client = await pool.connect();

  const read = file =>
    fs.readFileSync(
      path.join(__dirname, '..', file),
      'utf8'
    )
      .replace(/^BEGIN;\s*/, '')
      .replace(/COMMIT;\s*$/, '');

  try {
    await client.query('BEGIN');

    // All schema changes are inside a transaction
    // that will be rolled back after testing.
    const namespace = `compat_${process.pid}_${Date.now()}`;

    await client.query(`CREATE SCHEMA ${namespace}`);
    await client.query(`SET LOCAL search_path TO ${namespace}`);

    await client.query(
      read('db/GDG_evaluation_database.final.postgresql.sql')
    );

    await client.query(
      read('db/migrations/002_user_invitations.sql')
    );

    await client.query(
      read('db/migrations/003_user_soft_delete.sql')
    );

    await client.query(`
      INSERT INTO users (
        user_id,
        full_name,
        email,
        role,
        team_id,
        invitation_status
      )
      VALUES (
        101,
        'Pending organizer',
        'pending@example.test',
        'Organizer',
        NULL,
        'pending'
      )
    `);

    const migration004 = read(
      'db/migrations/004_final_backend_schema.sql'
    ).replaceAll(
      'gdg_legacy',
      `${namespace}_legacy`
    );

    await client.query(migration004);
    await client.query(migration004);

    // Apply the approved four-criterion migration.
    const migration005 = read(
      'db/migrations/005_manager_evaluation_four_criteria.sql'
    );

    await client.query(migration005);
    await client.query(migration005);

    const tablesResult = await client.query(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname = $1`,
      [namespace]
    );

    const tables = tablesResult.rows.map(
      row => row.tablename
    );

    assert.equal(tables.length, 8);
    assert.ok(tables.includes('performance_evaluations'));
    assert.ok(!tables.includes('manager_evaluations'));

    const constraintResult = await client.query(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'performance_evaluations'::regclass
        AND conname = 'chk_perf_criteria_count'
    `);

    assert.equal(constraintResult.rows.length, 1);

    assert.match(
      constraintResult.rows[0].definition,
      /jsonb_array_length\(criteria_scores\)\s*=\s*4\b/
    );

    const pendingResult = await client.query(`
      SELECT clerk_user_id, invitation_status
      FROM users
      WHERE user_id = 101
    `);

    assert.equal(pendingResult.rows[0].clerk_user_id, null);
    assert.equal(
      pendingResult.rows[0].invitation_status,
      'pending'
    );

    const emailResult = await client.query(
      `SELECT character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = $1
         AND table_name = 'users'
         AND column_name = 'email'`,
      [namespace]
    );

    assert.equal(
      emailResult.rows[0].character_maximum_length,
      255
    );

    const schemaResult = await client.query(
      'SELECT current_schema() AS name'
    );

    assert.equal(schemaResult.rows[0].name, namespace);

  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
      await pool.end();
    }
  }
});
