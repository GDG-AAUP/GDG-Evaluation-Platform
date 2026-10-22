
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { createPointsRouter } = require('../dist/phase2/points/points.routes.js')

test('GET /api/points/me uses the authenticated user ID', async (t) => {
  let queriedUserId = null

  const fakePool = {
    query: async (sql, params) => {
      queriedUserId = params[0]

      return {
        rows: [
          {
            id: '1',
            points: 20,
            activityName: 'Workshop',
            reason: 'Good participation'
          }
        ]
      }
    }
  }

  const app = express()

  // Simulate an authenticated user for this test only.
  app.use((req, res, next) => {
    req.projectUser = { id: 7 }
    next()
  })

  app.use('/api/points', createPointsRouter(fakePool))

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => {
      resolve(listener)
    })
  })

  t.after(() => new Promise((resolve) => server.close(resolve)))

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/points/me?userId=99`
  )

  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(queriedUserId, 7)
  assert.equal(body.data[0].points, 20)
})




test('GET /api/points/me rejects unauthenticated users', async (t) => {
  let databaseCalled = false

  const fakePool = {
    query: async () => {
      databaseCalled = true
      return { rows: [] }
    }
  }

  const app = express()

  app.use('/api/points', createPointsRouter(fakePool))

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => {
      resolve(listener)
    })
  })

  t.after(() => new Promise((resolve) => server.close(resolve)))

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/points/me`
  )

  const body = await response.json()

  assert.equal(response.status, 401)
  assert.equal(body.error.code, 'UNAUTHENTICATED')
  assert.equal(databaseCalled, false)
})
