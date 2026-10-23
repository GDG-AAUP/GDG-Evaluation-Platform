const test = require('node:test')
const assert = require('node:assert/strict')

const {
  reversePoint
} = require('../dist/phase2/points/reverse-point.js')

test('PostgreSQL point reversals are atomic and cannot repeat', {
  skip: !process.env.DB_NAME,
  timeout: 120000
}, async (t) => {
  const pool = require('../src/config/db')
  const client = await pool.connect()
  let transactionStarted = false

  const manager = { id: 5, role: 'manager', teamId: 2 }
  const organizer = { id: 1, role: 'organizer', teamId: null }

  // Reuse the same PostgreSQL connection in an outer test transaction.
  // Service BEGIN/COMMIT/ROLLBACK become savepoint operations instead.
  const testPool = {
    connect: async () => ({
      query: async (sql, params) => {
        const statement = sql.trim()
        if (statement === 'BEGIN') {
          return client.query('SAVEPOINT reversal_operation')
        }
        if (statement === 'COMMIT') {
          return client.query('RELEASE SAVEPOINT reversal_operation')
        }
        if (statement === 'ROLLBACK') {
          await client.query('ROLLBACK TO SAVEPOINT reversal_operation')
          return client.query('RELEASE SAVEPOINT reversal_operation')
        }
        return client.query(sql, params)
      },
      release: () => {}
    })
  }

  const count = async (table) => {
    const result = await client.query(
      `SELECT COUNT(*)::int AS n FROM pg_temp.${table}`
    )
    return result.rows[0].n
  }

  const insertOriginal = async (userId, performedBy, points) => {
    const result = await client.query(
      `INSERT INTO point_entries (
         user_id, performed_by_user_id, points,
         activity_name, reason, activity_description
       ) VALUES ($1, $2, $3, 'Workshop', 'Initial award', NULL)
       RETURNING entry_id::text AS id`,
      [userId, performedBy, points]
    )
    return result.rows[0].id
  }

  try {
    await client.query('BEGIN')
    transactionStarted = true

    for (const table of [
      'campuses', 'users', 'teams', 'point_entries', 'audit_logs'
    ]) {
      await client.query(
        `CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL)`
      )
    }
    await client.query('SET LOCAL search_path TO pg_temp, public')

    await client.query(`
      INSERT INTO campuses (campus_id, campus_name)
      VALUES (1, 'Test Campus')
    `)
    await client.query(`
      INSERT INTO users (
        user_id, full_name, email, role, team_id, is_active, clerk_user_id
      ) VALUES
        (1, 'Organizer', 'org@example.test', 'Organizer', NULL, TRUE, 'test_org'),
        (5, 'Manager A', 'managera@example.test', 'Manager', 2, TRUE, 'test_manager_a'),
        (7, 'Member A', 'membera@example.test', 'Member', 2, TRUE, 'test_member_a'),
        (9, 'Manager B', 'managerb@example.test', 'Manager', 3, TRUE, 'test_manager_b'),
        (12, 'Member B', 'memberb@example.test', 'Member', 3, TRUE, 'test_member_b')
    `)
    await client.query(`
      INSERT INTO teams (
        team_id, campus_id, team_name, manager_user_id, is_operational
      ) VALUES
        (2, 1, 'Team A', 5, TRUE),
        (3, 1, 'Team B', 9, TRUE)
    `)

    const firstId = await insertOriginal(7, 5, 20)
    let firstReversalId

    await t.test('manager creates an opposite entry and linked audit', async () => {
      const result = await reversePoint(
        testPool, manager, firstId, 'Mistaken award'
      )
      assert.equal(result.outcome, 'reversed')
      firstReversalId = result.entry.id
      assert.equal(result.entry.points, -20)
      assert.equal(result.entry.reversesEntryId, firstId)

      const original = await client.query(
        'SELECT points, reverses_entry_id FROM point_entries WHERE entry_id = $1',
        [firstId]
      )
      assert.equal(original.rows[0].points, 20)
      assert.equal(original.rows[0].reverses_entry_id, null)

      const reversal = await client.query(
        `SELECT points, reverses_entry_id::text AS original_id
         FROM point_entries WHERE entry_id = $1`,
        [firstReversalId]
      )
      assert.equal(reversal.rows[0].points, -20)
      assert.equal(reversal.rows[0].original_id, firstId)

      const audit = await client.query(
        `SELECT action, actor_user_id, entity_id, new_values
         FROM audit_logs
         WHERE entity_name = 'point_entries' AND entity_id = $1`,
        [firstReversalId]
      )
      assert.equal(audit.rows.length, 1)
      assert.equal(audit.rows[0].action, 'reverse_point_entry')
      assert.equal(audit.rows[0].actor_user_id, 5)
      assert.equal(audit.rows[0].new_values.reversesEntryId, firstId)
    })

    await t.test('a second reversal is rejected with no extra writes', async () => {
      const beforePoints = await count('point_entries')
      const beforeAudits = await count('audit_logs')
      const result = await reversePoint(
        testPool, manager, firstId, 'Attempted duplicate'
      )
      assert.equal(result.outcome, 'already_reversed')
      assert.equal(await count('point_entries'), beforePoints)
      assert.equal(await count('audit_logs'), beforeAudits)
    })

    await t.test('a reversal entry cannot itself be reversed', async () => {
      const result = await reversePoint(
        testPool, manager, firstReversalId, 'Undo reversal'
      )
      assert.equal(result.outcome, 'cannot_reverse_reversal')
    })

    const otherTeamId = await insertOriginal(12, 9, -10)

    await t.test('manager cannot reverse another team member', async () => {
      const before = await count('point_entries')
      const result = await reversePoint(
        testPool, manager, otherTeamId, 'Unauthorized correction'
      )
      assert.equal(result.outcome, 'forbidden')
      assert.equal(await count('point_entries'), before)
    })

    await t.test('organizer can reverse across teams and negate negatives', async () => {
      const result = await reversePoint(
        testPool, organizer, otherTeamId, 'Organizer correction'
      )
      assert.equal(result.outcome, 'reversed')
      assert.equal(result.entry.points, 10)
      assert.equal(result.entry.reversesEntryId, otherTeamId)
      assert.equal(result.entry.performedByUserId, 1)
    })

    await t.test('audit constraint failure rolls back reversal insertion', async () => {
      const auditFailureId = await insertOriginal(7, 5, 15)
      await client.query(`
        ALTER TABLE pg_temp.audit_logs
        ADD CONSTRAINT reject_reversal_test_audit
        CHECK (reason <> 'Reject audit')
      `)

      const beforePoints = await count('point_entries')
      const beforeAudits = await count('audit_logs')

      await assert.rejects(
        reversePoint(testPool, manager, auditFailureId, 'Reject audit'),
        (error) => error.code === '23514'
      )

      assert.equal(await count('point_entries'), beforePoints)
      assert.equal(await count('audit_logs'), beforeAudits)
      const dangling = await client.query(
        'SELECT 1 FROM point_entries WHERE reverses_entry_id = $1',
        [auditFailureId]
      )
      assert.equal(dangling.rows.length, 0)
    })
  } finally {
    try {
      if (transactionStarted) await client.query('ROLLBACK')
    } finally {
      client.release()
      await pool.end()
    }
  }
})
