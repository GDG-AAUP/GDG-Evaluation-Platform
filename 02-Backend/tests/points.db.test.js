
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createPoint
} = require('../dist/phase2/points/create-point.js')

test('Point creation works atomically in PostgreSQL', {
  skip: !process.env.DB_NAME,
  timeout: 120000
}, async (t) => {
  const pool = require('../src/config/db')
  const client = await pool.connect()
  let transactionStarted = false

  const manager = {
    id: 5,
    role: 'manager',
    teamId: 2
  }

  const organizer = {
    id: 1,
    role: 'organizer',
    teamId: null
  }

  const input = {
    userId: 7,
    points: 20,
    activityName: 'Workshop',
    reason: 'Participation',
    activityDescription: null
  }

  // Give createPoint() a connection that uses SAVEPOINTS.
  // The outer transaction will roll back all test data.
  const testPool = {
    connect: async () => ({
      query: async (sql, params) => {
        const statement = sql.trim()

        if (statement === 'BEGIN') {
          return client.query('SAVEPOINT point_operation')
        }

        if (statement === 'COMMIT') {
          return client.query('RELEASE SAVEPOINT point_operation')
        }

        if (statement === 'ROLLBACK') {
          await client.query('ROLLBACK TO SAVEPOINT point_operation')
          return client.query('RELEASE SAVEPOINT point_operation')
        }

        return client.query(sql, params)
      },

      release: () => {}
    })
  }

  const countRows = async (table) => {
    const result = await client.query(
      `SELECT COUNT(*)::int AS count FROM ${table}`
    )
    return result.rows[0].count
  }

  try {
    await client.query('BEGIN')
    transactionStarted = true

    // Temporary tables shadow the real public tables.
    for (const table of [
      'campuses',
      'users',
      'teams',
      'point_entries',
      'audit_logs'
    ]) {
      await client.query(
        `CREATE TEMP TABLE ${table}
         (LIKE public.${table} INCLUDING ALL)`
      )
    }

    await client.query(
      'SET LOCAL search_path TO pg_temp, public'
    )

    // Test-only users and teams.
    await client.query(`
      INSERT INTO campuses (campus_id, campus_name)
      VALUES (1, 'Test Campus')
    `)

    await client.query(`
      INSERT INTO users (
        user_id, full_name, email, role,
        team_id, is_active, clerk_user_id
      )
      VALUES
        (1, 'Organizer', 'org@example.test',
         'Organizer', NULL, TRUE, 'test_org'),
        (5, 'Manager A', 'managera@example.test',
         'Manager', 2, TRUE, 'test_manager_a'),
        (7, 'Member A', 'membera@example.test',
         'Member', 2, TRUE, 'test_member_a'),
        (9, 'Manager B', 'managerb@example.test',
         'Manager', 3, TRUE, 'test_manager_b'),
        (12, 'Member B', 'memberb@example.test',
         'Member', 3, TRUE, 'test_member_b')
    `)

    await client.query(`
      INSERT INTO teams (
        team_id, campus_id, team_name,
        manager_user_id, is_operational
      )
      VALUES
        (2, 1, 'Team A', 5, TRUE),
        (3, 1, 'Team B', 9, TRUE)
    `)

    await t.test(
      'Manager creates point entry and audit record',
      async () => {
        const result = await createPoint(
          testPool,
          manager,
          input
        )

        assert.equal(result.outcome, 'created')
        assert.equal(typeof result.entry.id, 'string')

        const points = await client.query(
          `SELECT user_id, performed_by_user_id, points
           FROM point_entries
           WHERE entry_id = $1`,
          [result.entry.id]
        )

        assert.equal(points.rows.length, 1)
        assert.equal(points.rows[0].user_id, 7)
        assert.equal(points.rows[0].performed_by_user_id, 5)
        assert.equal(points.rows[0].points, 20)

        const audit = await client.query(
          `SELECT actor_user_id, action, entity_id, new_values
           FROM audit_logs
           WHERE entity_name = 'point_entries'
             AND entity_id = $1`,
          [result.entry.id]
        )

        assert.equal(audit.rows.length, 1)
        assert.equal(audit.rows[0].actor_user_id, 5)
        assert.equal(audit.rows[0].action, 'create_point_entry')
        assert.equal(audit.rows[0].new_values.userId, 7)

        assert.equal(await countRows('point_entries'), 1)
        assert.equal(await countRows('audit_logs'), 1)
      }
    )

    await t.test(
      'Manager cannot award points to another team',
      async () => {
        const result = await createPoint(
          testPool,
          manager,
          { ...input, userId: 12 }
        )

        assert.equal(result.outcome, 'forbidden')
        assert.equal(await countRows('point_entries'), 1)
        assert.equal(await countRows('audit_logs'), 1)
      }
    )

    await t.test(
      'Organizer can award points across teams',
      async () => {
        const result = await createPoint(
          testPool,
          organizer,
          { ...input, userId: 12, points: -10 }
        )

        assert.equal(result.outcome, 'created')
        assert.equal(result.entry.points, -10)

        assert.equal(await countRows('point_entries'), 2)
        assert.equal(await countRows('audit_logs'), 2)
      }
    )

    await t.test(
      'Audit failure rolls back point insertion',
      async () => {
        // Force a real PostgreSQL constraint violation
        // for this test's audit record only.
        await client.query(`
          ALTER TABLE pg_temp.audit_logs
          ADD CONSTRAINT reject_test_audit
          CHECK (reason <> 'Trigger audit failure')
        `)

        const beforePoints = await countRows('point_entries')
        const beforeAudits = await countRows('audit_logs')

        await assert.rejects(
          createPoint(
            testPool,
            manager,
            {
              ...input,
              reason: 'Trigger audit failure'
            }
          ),
          (error) => error.code === '23514'
        )

        assert.equal(
          await countRows('point_entries'),
          beforePoints
        )

        assert.equal(
          await countRows('audit_logs'),
          beforeAudits
        )
      }
    )

  } finally {
    // Discard ALL test data, including successful inserts.
    if (transactionStarted) {
      await client.query('ROLLBACK')
    }

    client.release()
    await pool.end()
  }
})
