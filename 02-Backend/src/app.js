
// Configures API routes, Clerk authentication and shared error handling.
const express = require('express')
const cors = require('cors')
const teamsRoutes = require('./routes/teams.routes')
const campusesRoutes = require('./routes/campuses.routes')
const errorHandler = require('./middleware/error-handler')
const pool = require('./config/db')
const { clerkMiddleware, getAuth } = require('@clerk/express')
const { linkClerkAccount } = require('./services/link-clerk-account.service')
const usersRepository = require('./repositories/users.repository')
const loadProjectUser = require('./middleware/load-project-user')
const requireRole = require('./middleware/require-role')
const usersRoutes = require('./routes/users.routes')



// ------- phase 2 
const { createPointsRouter } = require('../dist/phase2/points/points.routes.js')


// ----------
const app = express()

app.use(cors())
app.use(express.json())

// Verifies Clerk session tokens before requests reach the routes.
app.use(clerkMiddleware())

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'GDG Backend is running',
  })
})


// Requires an active linked project account before accessing campus or team routes.
app.use('/api/campuses', loadProjectUser, campusesRoutes)
app.use('/api/teams', loadProjectUser, teamsRoutes)

// Checks database connectivity without requiring any project tables.
app.get('/api/ready', async (req, res) => {
  try {
    await pool.query({
      text: 'SELECT 1',
      query_timeout: 3000,
    })

    return res.status(200).json({
      status: 'ok',
      database: 'connected',
    })
  } catch {
    return res.status(503).json({
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database is not ready',
      },
    })
  }
})

// Returns only the linked, active project account after Clerk verification.
app.get('/api/auth/me', loadProjectUser, (req, res) => {
  return res.status(200).json({
    data: req.projectUser,
  })
})

// Completes invitation linking using the verified session, never client-supplied IDs or roles.
app.post('/api/auth/complete-registration', async (req, res) => {
  const { userId } = getAuth(req)
  if (!userId) return res.status(401).json({
    error: { code: 'UNAUTHENTICATED', message: 'Authentication is required' },
  })
  if (req.body !== undefined && (!req.body || typeof req.body !== 'object' ||
      Array.isArray(req.body) || Object.keys(req.body).length)) {
    return res.status(400).json({ error: { code: 'INVALID_REGISTRATION_DATA', message: 'No user ID, email or role should be supplied' } })
  }
  const existing = await usersRepository.findUserByClerkId(userId)
  const user = existing || await linkClerkAccount(userId)
  if (!user || user.isActive !== true || user.deletedAt || !['organizer', 'manager', 'member'].includes(user.role)) {
    return res.status(403).json({ error: { code: 'PROJECT_ACCESS_DENIED', message: 'An active account and a matching accepted invitation are required' } })
  }
  return res.status(200).json({ data: {
    id: user.id, name: user.name, role: user.role, teamId: user.teamId, isActive: user.isActive,
  } })
})

// Checks that the current project account has the organizer role.
app.get(
  '/api/admin/check',
  loadProjectUser,
  requireRole('organizer'),
  (req, res) => {
    res.status(200).json({
      data: {
        message: 'Organizer access granted',
      },
    })
  },
)

app.use('/api/users', usersRoutes)


// phase 2 ---------------------------------------
app.use('/api/points', loadProjectUser, createPointsRouter(pool))

// phase 2 ---------------------------------------

// Returns a JSON error when no route matches the request.
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: 'Route not found',
    },
  })
})

app.use(errorHandler)

module.exports = app
