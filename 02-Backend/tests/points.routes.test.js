const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const {
  createPointsRouter
} = require('../dist/phase2/points/points.routes.js')

const manager = { id: 5, role: 'manager', teamId: 2 }
const organizer = { id: 1, role: 'organizer', teamId: null }
const member = { id: 3, role: 'member', teamId: 2 }

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

const originalEntry = {
  id: '42',
  userId: 7,
  points: 20,
  activityName: 'Workshop',
  activityDescription: null,
  reversesEntryId: null
}

const reversalPath = '/api/points/42/reverse'
const reversalBody = { reason: 'Awarded by mistake' }

// Each test runs against its own temporary HTTP server.
async function sendRequest(t, pool, user, {
  method = 'GET',
  path = '/api/points/me',
  body
} = {}) {
  const app = express()
  app.use(express.json())

  app.use((req, res, next) => {
    if (user) req.projectUser = user
    next()
  })

  app.use('/api/points', createPointsRouter(pool))

  app.use((error, req, res, next) => {
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error'
      }
    })
  })

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })

  t.after(() => new Promise((resolve) => server.close(resolve)))

  const options = { method }
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' }
    options.body = JSON.stringify(body)
  }

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}${path}`,
    options
  )

  return { response, data: await response.json() }
}

// Fake PostgreSQL client with support for both point creation and reversal.
function createMockPool({
  actor = manager,
  recipient = validRecipient,
  dbRole = actor.role,
  dbActor = { role: dbRole, isActive: true, deletedAt: null },
  original = originalEntry,
  existingReversal = null,
  failAudit = false
} = {}) {
  const queries = []
  let connections = 0
  let releases = 0

  const createdEntry = {
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
          queries.push({ sql: statement, params })

          // Recipient lookup must precede the general actor lookup.
          if (/FROM\s+users\s+u\b/i.test(statement)) {
            return { rows: recipient ? [recipient] : [] }
          }

          if (/FROM\s+users\b/i.test(statement)) {
            return { rows: dbActor ? [dbActor] : [] }
          }

          if (/FROM\s+point_entries\b/i.test(statement)) {
            if (/WHERE\s+reverses_entry_id\s*=\s*\$1/i.test(statement)) {
              return { rows: existingReversal ? [existingReversal] : [] }
            }
            return { rows: original ? [original] : [] }
          }

          if (/INSERT\s+INTO\s+point_entries\b/i.test(statement)) {
            if (params.length === 7) {
              const reversal = {
                id: '43',
                userId: params[0],
                performedByUserId: params[1],
                points: params[2],
                activityName: params[3],
                reason: params[4],
                activityDescription: params[5],
                reversesEntryId: String(params[6]),
                effectiveAt: '2026-10-23T14:00:00.000Z'
              }
              return { rows: [reversal] }
            }
            return { rows: [createdEntry] }
          }

          if (/INSERT\s+INTO\s+audit_logs\b/i.test(statement)) {
            if (failAudit) throw new Error('Simulated audit failure')
            return { rows: [] }
          }

          return { rows: [] }
        },
        release: () => { releases++ }
      }
    }
  }

  return {
    pool,
    queries,
    createdEntry,
    connectionCount: () => connections,
    releaseCount: () => releases
  }
}

async function sendPost(t, mock, actor, path, body) {
  return sendRequest(t, mock.pool, actor, {
    method: 'POST', path, body
  })
}

// ---------------------------------------------
// Existing 12 tests: GET history and POST creation
// ---------------------------------------------

test('GET /api/points/me uses the authenticated user ID', async (t) => {
  let queriedUserId = null
  const pool = {
    query: async (sql, params) => {
      queriedUserId = params[0]
      return {
        rows: [{ id: '1', points: 20, activityName: 'Workshop', reason: 'Participation' }]
      }
    }
  }
  const { response, data } = await sendRequest(
    t, pool, { id: 7, role: 'member', teamId: 2 },
    { path: '/api/points/me?userId=99' }
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
  const { response, data } = await sendRequest(t, pool, null)
  assert.equal(response.status, 401)
  assert.equal(data.error.code, 'UNAUTHENTICATED')
  assert.equal(databaseCalled, false)
})

test('POST /api/points rejects unauthenticated users', async (t) => {
  const mock = createMockPool()
  const { response, data } = await sendPost(t, mock, null, '/api/points', validBody)
  assert.equal(response.status, 401)
  assert.equal(data.error.code, 'UNAUTHENTICATED')
  assert.equal(mock.connectionCount(), 0)
})

test('POST /api/points rejects members', async (t) => {
  const mock = createMockPool()
  const { response, data } = await sendPost(t, mock, member, '/api/points', validBody)
  assert.equal(response.status, 403)
  assert.equal(data.error.code, 'FORBIDDEN')
  assert.equal(mock.connectionCount(), 0)
})

test('POST /api/points rejects invalid points', async (t) => {
  const mock = createMockPool()
  const { response, data } = await sendPost(
    t, mock, manager, '/api/points', { ...validBody, points: 150 }
  )
  assert.equal(response.status, 400)
  assert.equal(data.error.code, 'INVALID_POINT_DATA')
  assert.equal(mock.connectionCount(), 0)
})

test('POST /api/points rejects unknown fields', async (t) => {
  const mock = createMockPool()
  const { response, data } = await sendPost(
    t, mock, manager, '/api/points', { ...validBody, performedByUserId: 99 }
  )
  assert.equal(response.status, 400)
  assert.equal(data.error.code, 'INVALID_POINT_DATA')
  assert.equal(mock.connectionCount(), 0)
})

test('POST /api/points allows a manager to award points', async (t) => {
  const mock = createMockPool()
  const { response, data } = await sendPost(t, mock, manager, '/api/points', validBody)
  assert.equal(response.status, 201)
  assert.equal(data.data.id, '42')
  assert.equal(data.data.points, 20)
  assert.equal(data.data.performedByUserId, 5)

  const pointInsert = mock.queries.find(q => /INSERT\s+INTO\s+point_entries/i.test(q.sql))
  const auditInsert = mock.queries.find(q => /INSERT\s+INTO\s+audit_logs/i.test(q.sql))
  assert.ok(pointInsert)
  assert.ok(auditInsert)
  assert.deepEqual(pointInsert.params, [7, 5, 20, 'Workshop', 'Participation', null])
  assert.deepEqual(auditInsert.params, [5, '42', JSON.stringify(mock.createdEntry), 'Participation'])

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
    recipient: { ...validRecipient, teamId: 3, managerId: 9 }
  })
  const { response, data } = await sendPost(t, mock, organizer, '/api/points', validBody)
  assert.equal(response.status, 201)
  assert.equal(data.data.performedByUserId, 1)
  assert.ok(mock.queries.some(q => q.sql === 'COMMIT'))
  assert.equal(mock.releaseCount(), 1)
})

test('POST /api/points rejects another team member', async (t) => {
  const mock = createMockPool({
    recipient: { ...validRecipient, teamId: 3, managerId: 9 }
  })
  const { response, data } = await sendPost(t, mock, manager, '/api/points', validBody)
  assert.equal(response.status, 403)
  assert.equal(data.error.code, 'FORBIDDEN')
  assert.equal(mock.queries.some(q => /\bINSERT\b/i.test(q.sql)), false)
  assert.ok(mock.queries.some(q => q.sql === 'ROLLBACK'))
  assert.equal(mock.releaseCount(), 1)
})

test('POST /api/points returns 404 for missing recipient', async (t) => {
  const mock = createMockPool({ recipient: null })
  const { response, data } = await sendPost(t, mock, manager, '/api/points', validBody)
  assert.equal(response.status, 404)
  assert.equal(data.error.code, 'RECIPIENT_NOT_FOUND')
  assert.equal(mock.queries.some(q => /\bINSERT\b/i.test(q.sql)), false)
  assert.ok(mock.queries.some(q => q.sql === 'ROLLBACK'))
  assert.equal(mock.releaseCount(), 1)
})

test('POST /api/points rejects a stale manager role', async (t) => {
  const mock = createMockPool({ dbRole: 'member' })
  const { response, data } = await sendPost(t, mock, manager, '/api/points', validBody)
  assert.equal(response.status, 403)
  assert.equal(data.error.code, 'FORBIDDEN')
  assert.equal(mock.queries.some(q => /\bINSERT\b/i.test(q.sql)), false)
  assert.ok(mock.queries.some(q => q.sql === 'ROLLBACK'))
  assert.equal(mock.releaseCount(), 1)
})

test('POST /api/points rolls back when audit logging fails', async (t) => {
  const mock = createMockPool({ failAudit: true })
  const { response, data } = await sendPost(t, mock, manager, '/api/points', validBody)
  assert.equal(response.status, 500)
  assert.equal(data.error.code, 'INTERNAL_ERROR')
  const statements = mock.queries.map(q => q.sql)
  assert.ok(statements.some(s => /INSERT INTO point_entries/i.test(s)))
  assert.ok(statements.some(s => /INSERT INTO audit_logs/i.test(s)))
  assert.ok(statements.includes('ROLLBACK'))
  assert.equal(statements.includes('COMMIT'), false)
  assert.equal(mock.releaseCount(), 1)
})

// ---------------------------------------------
// New tests: POST /api/points/:entryId/reverse
// ---------------------------------------------

test('Reversal rejects unauthenticated requests', async (t) => {
  const mock = createMockPool()
  const { response, data } = await sendPost(t, mock, null, reversalPath, reversalBody)
  assert.equal(response.status, 401)
  assert.equal(data.error.code, 'UNAUTHENTICATED')
  assert.equal(mock.connectionCount(), 0)
})

test('Reversal rejects members', async (t) => {
  const mock = createMockPool()
  const { response, data } = await sendPost(t, mock, member, reversalPath, reversalBody)
  assert.equal(response.status, 403)
  assert.equal(data.error.code, 'FORBIDDEN')
  assert.equal(mock.connectionCount(), 0)
})

test('Reversal rejects invalid entry IDs before connecting', async (t) => {
  for (const id of ['0', '9223372036854775808', 'abc']) {
    const mock = createMockPool()
    const { response, data } = await sendPost(
      t, mock, manager, `/api/points/${id}/reverse`, reversalBody
    )
    assert.equal(response.status, 400, `entry ID ${id}`)
    assert.equal(data.error.code, 'INVALID_ENTRY_ID')
    assert.equal(mock.connectionCount(), 0)
  }
})

test('Reversal rejects a blank reason', async (t) => {
  const mock = createMockPool()
  const { response, data } = await sendPost(
    t, mock, manager, reversalPath, { reason: '   ' }
  )
  assert.equal(response.status, 400)
  assert.equal(data.error.code, 'INVALID_REVERSAL_DATA')
  assert.equal(mock.connectionCount(), 0)
})

test('Reversal rejects unexpected request fields', async (t) => {
  const mock = createMockPool()
  const { response, data } = await sendPost(
    t, mock, manager, reversalPath,
    { reason: 'Correction', points: 100 }
  )
  assert.equal(response.status, 400)
  assert.equal(data.error.code, 'INVALID_REVERSAL_DATA')
  assert.equal(mock.connectionCount(), 0)
})

test('Reversal lets a manager reverse points with an audit record', async (t) => {
  const mock = createMockPool()
  const { response, data } = await sendPost(
    t, mock, manager, reversalPath, reversalBody
  )
  assert.equal(response.status, 201)
  assert.equal(data.data.id, '43')
  assert.equal(data.data.userId, 7)
  assert.equal(data.data.performedByUserId, 5)
  assert.equal(data.data.points, -20)
  assert.equal(data.data.reversesEntryId, '42')

  const lookup = mock.queries.find(
    q => /FROM\s+point_entries\b/i.test(q.sql) && /FOR\s+UPDATE/i.test(q.sql)
  )
  assert.ok(lookup)
  assert.deepEqual(lookup.params, ['42'])

  const pointInsert = mock.queries.find(q => /INSERT\s+INTO\s+point_entries/i.test(q.sql))
  const auditInsert = mock.queries.find(q => /INSERT\s+INTO\s+audit_logs/i.test(q.sql))
  assert.ok(pointInsert)
  assert.ok(auditInsert)
  assert.deepEqual(pointInsert.params, [
    7, 5, -20, 'Workshop', 'Awarded by mistake', null, '42'
  ])
  assert.equal(auditInsert.params[0], 5)
  assert.equal(auditInsert.params[1], '43')
  assert.equal(JSON.parse(auditInsert.params[2]).reversesEntryId, '42')
  assert.equal(auditInsert.params[3], 'Awarded by mistake')

  const statements = mock.queries.map(q => q.sql)
  const insertPosition = statements.findIndex(s => /INSERT\s+INTO\s+point_entries/i.test(s))
  const auditPosition = statements.findIndex(s => /INSERT\s+INTO\s+audit_logs/i.test(s))
  assert.ok(auditPosition > insertPosition)
  assert.equal(statements.at(-1), 'COMMIT')
  assert.equal(statements.includes('ROLLBACK'), false)
  assert.equal(mock.releaseCount(), 1)
})

test('Reversal converts a negative point entry into positive points', async (t) => {
  const mock = createMockPool({ original: { ...originalEntry, points: -10 } })
  const { response, data } = await sendPost(t, mock, manager, reversalPath, reversalBody)
  assert.equal(response.status, 201)
  assert.equal(data.data.points, 10)
  assert.equal(data.data.reversesEntryId, '42')
  assert.ok(mock.queries.some(q => q.sql === 'COMMIT'))
})

test('Reversal allows organizers to reverse across teams', async (t) => {
  const mock = createMockPool({
    actor: organizer,
    recipient: { ...validRecipient, teamId: 3, managerId: 9 }
  })
  const { response, data } = await sendPost(t, mock, organizer, reversalPath, reversalBody)
  assert.equal(response.status, 201)
  assert.equal(data.data.performedByUserId, 1)
  assert.equal(data.data.points, -20)
  assert.equal(mock.releaseCount(), 1)
})

test('Reversal returns 403 when the actor role changed in PostgreSQL', async (t) => {
  const mock = createMockPool({ dbRole: 'member' })
  const { response, data } = await sendPost(t, mock, manager, reversalPath, reversalBody)
  assert.equal(response.status, 403)
  assert.equal(data.error.code, 'FORBIDDEN')
  assert.equal(mock.queries.some(q => /\bINSERT\b/i.test(q.sql)), false)
  assert.ok(mock.queries.some(q => q.sql === 'ROLLBACK'))
  assert.equal(mock.releaseCount(), 1)
})

test('Reversal returns 403 for a member on another team', async (t) => {
  const mock = createMockPool({
    recipient: { ...validRecipient, teamId: 3, managerId: 9 }
  })
  const { response, data } = await sendPost(t, mock, manager, reversalPath, reversalBody)
  assert.equal(response.status, 403)
  assert.equal(data.error.code, 'FORBIDDEN')
  assert.equal(mock.queries.some(q => /\bINSERT\b/i.test(q.sql)), false)
  assert.ok(mock.queries.some(q => q.sql === 'ROLLBACK'))
  assert.equal(mock.releaseCount(), 1)
})

test('Reversal returns 404 if the original entry is missing', async (t) => {
  const mock = createMockPool({ original: null })
  const { response, data } = await sendPost(t, mock, manager, reversalPath, reversalBody)
  assert.equal(response.status, 404)
  assert.equal(data.error.code, 'ENTRY_NOT_FOUND')
  assert.equal(mock.queries.some(q => /\bINSERT\b/i.test(q.sql)), false)
  assert.ok(mock.queries.some(q => q.sql === 'ROLLBACK'))
  assert.equal(mock.releaseCount(), 1)
})

test('Reversal returns 404 if the recipient is missing', async (t) => {
  const mock = createMockPool({ recipient: null })
  const { response, data } = await sendPost(t, mock, manager, reversalPath, reversalBody)
  assert.equal(response.status, 404)
  assert.equal(data.error.code, 'RECIPIENT_NOT_FOUND')
  assert.equal(mock.queries.some(q => /\bINSERT\b/i.test(q.sql)), false)
  assert.ok(mock.queries.some(q => q.sql === 'ROLLBACK'))
  assert.equal(mock.releaseCount(), 1)
})

test('Reversal returns 409 when targeting a reversal entry', async (t) => {
  const mock = createMockPool({
    original: { ...originalEntry, reversesEntryId: '30' }
  })
  const { response, data } = await sendPost(t, mock, manager, reversalPath, reversalBody)
  assert.equal(response.status, 409)
  assert.equal(data.error.code, 'CANNOT_REVERSE_REVERSAL')
  assert.equal(mock.queries.some(q => /\bINSERT\b/i.test(q.sql)), false)
  assert.ok(mock.queries.some(q => q.sql === 'ROLLBACK'))
  assert.equal(mock.releaseCount(), 1)
})

test('Reversal returns 409 if the entry was already reversed', async (t) => {
  const mock = createMockPool({ existingReversal: { id: '43' } })
  const { response, data } = await sendPost(t, mock, manager, reversalPath, reversalBody)
  assert.equal(response.status, 409)
  assert.equal(data.error.code, 'ALREADY_REVERSED')
  assert.equal(mock.queries.some(q => /\bINSERT\b/i.test(q.sql)), false)
  assert.ok(mock.queries.some(q => q.sql === 'ROLLBACK'))
  assert.equal(mock.releaseCount(), 1)
})

test('Reversal returns 500 and rolls back if audit insertion fails', async (t) => {
  const mock = createMockPool({ failAudit: true })
  const { response, data } = await sendPost(t, mock, manager, reversalPath, reversalBody)
  assert.equal(response.status, 500)
  assert.equal(data.error.code, 'INTERNAL_ERROR')
  const statements = mock.queries.map(q => q.sql)
  assert.ok(statements.some(s => /INSERT\s+INTO\s+point_entries/i.test(s)))
  assert.ok(statements.some(s => /INSERT\s+INTO\s+audit_logs/i.test(s)))
  assert.ok(statements.includes('ROLLBACK'))
  assert.equal(statements.includes('COMMIT'), false)
  assert.equal(mock.releaseCount(), 1)
})
