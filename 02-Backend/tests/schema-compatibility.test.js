// Validates the final schema, invitation compatibility and repeatable migrations.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('final PostgreSQL schema supports fresh installation and repeatable migrations', {
  skip: !process.env.DB_NAME, timeout: 120000,
}, async () => {
  const pool = require('../src/config/db')
  const client = await pool.connect()
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    .replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '')
  try {
    await client.query('BEGIN')
    const namespace = `compat_${process.pid}_${Date.now()}`
    await client.query(`CREATE SCHEMA ${namespace}`)
    await client.query(`SET LOCAL search_path TO ${namespace}`)
    await client.query(read('db/GDG_evaluation_database.final.postgresql.sql'))
    await client.query(read('db/migrations/002_user_invitations.sql'))
    await client.query(read('db/migrations/003_user_soft_delete.sql'))
    await client.query(`INSERT INTO users(user_id,full_name,email,role,team_id,invitation_status)
      VALUES(101,'Pending organizer','pending@example.test','Organizer',NULL,'pending')`)
    const migration = read('db/migrations/004_final_backend_schema.sql').replaceAll('gdg_legacy', `${namespace}_legacy`)
    await client.query(migration)
    await client.query(migration)
    const tables = (await client.query('SELECT tablename FROM pg_tables WHERE schemaname=$1', [namespace])).rows.map(row => row.tablename)
    assert.equal(tables.length, 8)
    assert.ok(tables.includes('performance_evaluations')); assert.ok(!tables.includes('manager_evaluations'))
    const pending = (await client.query('SELECT clerk_user_id,invitation_status FROM users WHERE user_id=101')).rows[0]
    assert.equal(pending.clerk_user_id, null); assert.equal(pending.invitation_status, 'pending')
    const emailLength = (await client.query("SELECT character_maximum_length FROM information_schema.columns WHERE table_schema=$1 AND table_name='users' AND column_name='email'", [namespace])).rows[0].character_maximum_length
    assert.equal(emailLength, 255)
  } finally {
    await client.query('ROLLBACK')
    client.release()
    await pool.end()
  }
})
