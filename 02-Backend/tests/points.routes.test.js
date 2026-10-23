
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const {
  createPointsRouter
} = require('../dist/phase2/points/points.routes.js')

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

const member = {
  id: 3,
  role: 'member',
  teamId: 2
}

const validBody = {
  userId: 7,
  points: 20,
  activityName: 'Workshop',
  reason: 'Participation'
}

const validRecipient = {
  userId: 7,
  role: 'member',
  teamId: 2,
  isActive: true,
  deletedAt: null,
  managerId: 5
}

// Starts a temporary Express application for each test.
async function sendRequest(
  t,
  pool,
  user,
  { method = 'GET', path = '/api/points/me', body } = {}
) {
  const app = express()

  app.use(express.json())

  app.use((req, res, next) => {
    if (user) {
      req.projectUser = user
    }
    next()
  })

  app.use('/api/points', createPointsRouter(pool))

  // Simulate the application's error handler.
  app.use((error, req, res, next) => {
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error'
      }
    })
  })

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => {
      resolve(listener)
    })
  })

  t.after(() =>
    new Promise((resolve) => server.close(resolve))
  )

  const options = { method }

  if (body !== undefined) {
    options.headers = {
      'Content-Type': 'application/json'
    }
    options.body = JSON.stringify(body)
  }

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}${path}`,
    options
  )

  return {
    response,
    data: await response.json()
  }
}

// Simulates a PostgreSQL connection and records all SQL statements.
function createMockPool({
  actor = manager,
  recipient = validRecipient,
  dbRole = actor.role,
  failAudit = false
} = {}) {
  const queries = []
  let connections = 0
  let releases = 0

  const entry = {
    id: '42',
    userId: 7,
    performedByUserId: actor.id,
    points: 20,
    activityName: 'Workshop',
    reason: 'Participation',
    activityDescription: null,
    effectiveAt: '2026-10-22T12:00:00.000Z'
  }

  const pool = {
    connect: async () => {
      connections++

      return {
        query: async (sql, params = []) => {
          const statement = sql.trim()

          queries.push({
            sql: statement,
            params
          })

          // Current authenticated actor from PostgreSQL.
          if (/FROM\s+users\s+WHERE/i.test(statement)) {
            return {
              rows: [{
                role: dbRole,
                isActive: true,
                deletedAt: null
              }]
            }
          }

          // Recipient and their assigned team manager.
          if (/FROM\s+users\s+u\b/i.test(statement)) {
            return {
              rows: recipient ? [recipient] : []
            }
          }

          // New point entry.
          if (/INSERT\s+INTO\s+point_entries/i.test(statement)) {
            return { rows: [entry] }
          }

          // Audit record.
          if (/INSERT\s+INTO\s+audit_logs/i.test(statement)) {
            if (failAudit) {
              throw new Error('Simulated audit failure')
            }

            return { rows: [] }
          }

          return { rows: [] }
        },

        release: () => {
          releases++
        }
      }
    }
  }

  return {
    pool,
    queries,
    entry,
    connectionCount: () => connections,
    releaseCount: () => releases
  }
}

// ---------------------------------------------
// GET /api/points/me
// ---------------------------------------------

test('GET /api/points/me uses the authenticated user ID', async (t) => {
  let queriedUserId = null

  const pool = {
    query: async (sql, params) => {
      queriedUserId = params[0]

      return {
        rows: [{
          id: '1',
          points: 20,
          activityName: 'Workshop',
          reason: 'Participation'
        }]
      }
    }
  }

  const { response, data } = await sendRequest(
    t,
    pool,
    { id: 7, role: 'member', teamId: 2 },
    {
      path: '/api/points/me?userId=99'
    }
  )

  assert.equal(response.status, 200)
  assert.equal(queriedUserId, 7)
  assert.equal(data.data[0].points, 20)
})

test('GET /api/points/me rejects unauthenticated users', async (t) => {
  let databaseCalled = false

  const pool = {
    query: async () => {
      databaseCalled = true
      return { rows: [] }
    }
  }

  const { response, data } = await sendRequest(
    t,
    pool,
    null
  )

  assert.equal(response.status, 401)
  assert.equal(data.error.code, 'UNAUTHENTICATED')
  assert.equal(databaseCalled, false)
})

// ---------------------------------------------
// POST /api/points - Authentication
// ---------------------------------------------

test('POST /api/points rejects unauthenticated users', async (t) => {
  const mock = createMockPool()

  const { response, data } = await sendRequest(
    t,
    mock.pool,
    null,
    {
      method: 'POST',
      path: '/api/points',
      body: validBody
    }
  )

  assert.equal(response.status, 401)
  assert.equal(data.error.code, 'UNAUTHENTICATED')
  assert.equal(mock.connectionCount(), 0)
})

test('POST /api/points rejects members', async (t) => {
  const mock = createMockPool()

  const { response, data } = await sendRequest(
    t,
    mock.pool,
    member,
    {
      method: 'POST',
      path: '/api/points',
      body: validBody
    }
  )

  assert.equal(response.status, 403)
  assert.equal(data.error.code, 'FORBIDDEN')
  assert.equal(mock.connectionCount(), 0)
})

// ---------------------------------------------
// POST /api/points - Validation
// ---------------------------------------------

test('POST /api/points rejects invalid points', async (t) => {
  const mock = createMockPool()

  const { response, data } = await sendRequest(
    t,
    mock.pool,
    manager,
    {
      method: 'POST',
      path: '/api/points',
      body: {
        ...validBody,
        points: 150
      }
    }
  )

  assert.equal(response.status, 400)
  assert.equal(data.error.code, 'INVALID_POINT_DATA')
  assert.equal(mock.connectionCount(), 0)
})

test('POST /api/points rejects unknown fields', async (t) => {
  const mock = createMockPool()

  const { response, data } = await sendRequest(
    t,
    mock.pool,
    manager,
    {
      method: 'POST',
      path: '/api/points',
      body: {
        ...validBody,
        performedByUserId: 99
      }
    }
  )

  assert.equal(response.status, 400)
  assert.equal(data.error.code, 'INVALID_POINT_DATA')
  assert.equal(mock.connectionCount(), 0)
})

// ---------------------------------------------
// POST /api/points - Successful creation
// ---------------------------------------------

test('POST /api/points allows a manager to award points', async (t) => {
  const mock = createMockPool()

  const { response, data } = await sendRequest(
    t,
    mock.pool,
    manager,
    {
      method: 'POST',
      path: '/api/points',
      body: validBody
    }
  )

  assert.equal(response.status, 201)
  assert.equal(data.data.id, '42')
  assert.equal(data.data.points, 20)
  assert.equal(data.data.performedByUserId, 5)

  const pointInsert = mock.queries.find(
    q => /INSERT\s+INTO\s+point_entries/i.test(q.sql)
  )

  const auditInsert = mock.queries.find(
    q => /INSERT\s+INTO\s+audit_logs/i.test(q.sql)
  )

  assert.ok(pointInsert)
  assert.ok(auditInsert)

  assert.deepEqual(pointInsert.params, [
    7,
    5,
    20,
    'Workshop',
    'Participation',
    null
  ])

  assert.deepEqual(auditInsert.params, [
    5,
    '42',
    JSON.stringify(mock.entry),
    'Participation'
  ])

  const statements = mock.queries.map(q => q.sql)

  assert.equal(statements[0], 'BEGIN')
  assert.equal(statements.at(-1), 'COMMIT')
  assert.equal(statements.includes('ROLLBACK'), false)

  assert.ok(
    statements.findIndex(s => /INSERT INTO point_entries/i.test(s)) <
    statements.findIndex(s => /INSERT INTO audit_logs/i.test(s))
  )

  assert.equal(mock.releaseCount(), 1)
})

test('POST /api/points allows organizers across teams', async (t) => {
  const mock = createMockPool({
    actor: organizer,
    recipient: {
      ...validRecipient,
      teamId: 3,
      managerId: 9
    }
  })

  const { response, data } = await sendRequest(
    t,
    mock.pool,
    organizer,
    {
      method: 'POST',
      path: '/api/points',
      body: validBody
    }
  )

  assert.equal(response.status, 201)
  assert.equal(data.data.performedByUserId, 1)

  assert.ok(
    mock.queries.some(q => q.sql === 'COMMIT')
  )

  assert.equal(mock.releaseCount(), 1)
})

// ---------------------------------------------
// POST /api/points - Recipient authorization
// ---------------------------------------------

test('POST /api/points rejects another team member', async (t) => {
  const mock = createMockPool({
    recipient: {
      ...validRecipient,
      teamId: 3,
      managerId: 9
    }
  })

  const { response, data } = await sendRequest(
    t,
    mock.pool,
    manager,
    {
      method: 'POST',
      path: '/api/points',
      body: validBody
    }
  )

  assert.equal(response.status, 403)
  assert.equal(data.error.code, 'FORBIDDEN')

  assert.equal(
    mock.queries.some(q => /\bINSERT\b/i.test(q.sql)),
    false
  )

  assert.ok(mock.queries.some(q => q.sql === 'ROLLBACK'))
  assert.equal(mock.releaseCount(), 1)
})

test('POST /api/points returns 404 for missing recipient', async (t) => {
  const mock = createMockPool({
    recipient: null
  })

  const { response, data } = await sendRequest(
    t,
    mock.pool,
    manager,
    {
      method: 'POST',
      path: '/api/points',
      body: validBody
    }
  )

  assert.equal(response.status, 404)
  assert.equal(data.error.code, 'RECIPIENT_NOT_FOUND')

  assert.equal(
    mock.queries.some(q => /\bINSERT\b/i.test(q.sql)),
    false
  )

  assert.ok(mock.queries.some(q => q.sql === 'ROLLBACK'))
  assert.equal(mock.releaseCount(), 1)
})

test('POST /api/points rejects a stale manager role', async (t) => {
  const mock = createMockPool({
    dbRole: 'member'
  })

  const { response, data } = await sendRequest(
    t,
    mock.pool,
    manager,
    {
      method: 'POST',
      path: '/api/points',
      body: validBody
    }
  )

  assert.equal(response.status, 403)
  assert.equal(data.error.code, 'FORBIDDEN')

  assert.equal(
    mock.queries.some(q => /\bINSERT\b/i.test(q.sql)),
    false
  )

  assert.ok(mock.queries.some(q => q.sql === 'ROLLBACK'))
  assert.equal(mock.releaseCount(), 1)
})

// ---------------------------------------------
// POST /api/points - Transaction failure
// ---------------------------------------------

test('POST /api/points rolls back when audit logging fails', async (t) => {
  const mock = createMockPool({
    failAudit: true
  })

  const { response, data } = await sendRequest(
    t,
    mock.pool,
    manager,
    {
      method: 'POST',
      path: '/api/points',
      body: validBody
    }
  )

  assert.equal(response.status, 500)
  assert.equal(data.error.code, 'INTERNAL_ERROR')

  const statements = mock.queries.map(q => q.sql)

  assert.ok(
    statements.some(s => /INSERT INTO point_entries/i.test(s))
  )

  assert.ok(
    statements.some(s => /INSERT INTO audit_logs/i.test(s))
  )

  assert.ok(statements.includes('ROLLBACK'))
  assert.equal(statements.includes('COMMIT'), false)

  assert.equal(mock.releaseCount(), 1)
})
