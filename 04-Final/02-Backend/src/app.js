
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
const { logSystemEvent } = require('./services/system-log.service')
const registrationsRepository = require('./repositories/registrations.repository')
const usersRoutes = require('./routes/users.routes')
const registrationsRoutes = require('./routes/registrations.routes')

// Phase 2
const { createPointsRouter } = require('../dist/phase2/points/points.routes.js')
const {
  createRankingsRouter
} = require('../dist/phase2/rankings/rankings.routes.js')

const { createAuditRouter } =
  require('../dist/phase2/audit/audit.routes.js')

const { createManagerEvaluationsRouter } = require('../dist/phase2/evaluations/manager-evaluations.routes.js')
const { createPublicRankingsRouter } = require('../dist/phase2/rankings/public-rankings.routes.js')
const { createArchiveRouter } = require('../dist/phase2/archive/archive.routes.js')
const { createDashboardHandlers } = require('../dist/phase2/dashboards/dashboards.handlers.js')
const { createAssistantDataRouter } = require('../dist/phase2/assistant/assistant-data.routes.js')
const { createAssistantRouter } = require('../dist/phase2/assistant/assistant.routes.js')
const { createRatingsRouter } = require('../dist/phase2/ratings/ratings.routes.js')
const { createActivitiesRouter } = require('../dist/phase2/activities/activities.routes.js')
const { createAwardsRouter } = require('../dist/phase2/awards/awards.routes.js')
const { createPoliciesRouter, createPointLimit } = require('../dist/phase2/policies/policies.routes.js')
const { createSyslogRouter } = require('../dist/phase2/system/syslog.routes.js')
const requireTeamAccess = require('./middleware/require-team-access')
const { createGovernanceRouter, readGovernance } = require('../dist/phase2/governance/governance.js')

const app = express()

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  // Idempotency-Key: sent by the frontend on POST /api/points (duplicate-submission protection).
  // Without it here the browser's preflight fails and the request never reaches the API.
  allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'Idempotency-Key'],
  exposedHeaders: ['Authorization', 'Retry-After', 'Idempotent-Replayed'],
}))
app.use(express.json())

// Only filter options and the current-month summary are public.
app.use('/api/rankings', createPublicRankingsRouter(pool))

// Verifies Clerk session tokens for subsequent routes.
// Development machines often drift from Clerk's clock; production keeps Clerk's strict default.
const clockSkewInMs = Number(process.env.CLERK_CLOCK_SKEW_MS) ||
  (process.env.NODE_ENV === 'production' ? 5000 : 60000)
// In production a session token is accepted only when it was issued to one of the allowed
// frontend origins (its `azp` claim), so a token from another site on the same Clerk instance fails.
app.use(clerkMiddleware({
  clockSkewInMs,
  ...(process.env.NODE_ENV === 'production' ? { authorizedParties: allowedOrigins } : {}),
}))

// Full, team and historical rankings require a signed-in project account.
app.use('/api/rankings', loadProjectUser, createRankingsRouter(pool))

const dashboards = createDashboardHandlers(pool)
app.get('/api/overview', loadProjectUser, requireRole('organizer'), dashboards.organizerOverview)
app.get('/api/dashboard/ratings', loadProjectUser, requireRole('organizer'), dashboards.organizerDashboard)
app.get('/api/ratings/ledger', loadProjectUser, requireRole('organizer'), dashboards.pointsLedger)
app.use('/api/ratings', loadProjectUser, createRatingsRouter(pool))
app.use('/api/activities', loadProjectUser, createActivitiesRouter(pool))
app.use('/api/awards', loadProjectUser, createAwardsRouter(pool))
app.use('/api/policies', loadProjectUser, createPoliciesRouter(pool))
app.use('/api/syslog', loadProjectUser, requireRole('organizer'), createSyslogRouter(pool))
app.get('/api/teams/:id/overview', loadProjectUser, requireTeamAccess, dashboards.teamOverview)

app.use('/api/archive', loadProjectUser, requireRole('organizer', 'manager'), createArchiveRouter(pool))

// The data router is mounted first so POST /api/assistant stays the only other route under this path.
app.use('/api/assistant/data', loadProjectUser, createAssistantDataRouter(pool))
app.use('/api/assistant', loadProjectUser, createAssistantRouter())

app.use(
  '/api/audit',
  loadProjectUser,
  requireRole('organizer'),
  createAuditRouter(pool)
)

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
// isSuperAdmin and the governance flags let the frontend adapt its controls; every rule is enforced here.
app.get('/api/auth/me', loadProjectUser, async (req, res) => {
  const user = req.projectUser
  return res.status(200).json({
    data: {
      ...user,
      campusId: user.organizerCampusId ?? null,
      governance: user.role === 'organizer' ? await readGovernance(pool) : null,
      // Pending join requests: every Organizer sees and decides all of them (both campuses).
      pendingRegistrationsCount: user.role === 'organizer' ? await registrationsRepository.countPending() : null,
    },
  })
})

// Completes invitation linking using the verified session,
// never client-supplied IDs or roles.
app.post('/api/auth/complete-registration', async (req, res) => {
  const { userId } = getAuth(req)

  if (!userId) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication is required'
      },
    })
  }

  if (
    req.body !== undefined &&
    (
      !req.body ||
      typeof req.body !== 'object' ||
      Array.isArray(req.body) ||
      Object.keys(req.body).length
    )
  ) {
    return res.status(400).json({
      error: {
        code: 'INVALID_REGISTRATION_DATA',
        message: 'No user ID, email or role should be supplied'
      }
    })
  }

  const existing = await usersRepository.findUserByClerkId(userId)
  const user = existing || await linkClerkAccount(userId)

  if (
    !user ||
    user.isActive !== true ||
    user.deletedAt ||
    !['organizer', 'manager', 'member'].includes(user.role)
  ) {
    return res.status(403).json({
      error: {
        code: 'PROJECT_ACCESS_DENIED',
        message: 'An active account and a matching accepted invitation are required'
      }
    })
  }

  return res.status(200).json({
    data: {
      id: user.id,
      name: user.name,
      role: user.role,
      teamId: user.teamId,
      isActive: user.isActive,
    }
  })
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
// Self-registration review: organizers approve or reject people who signed up at Clerk.
// A signed-in Clerk user without an account asks to join (no project account needed yet).
app.use('/api/registrations/request', registrationsRoutes.requestRouter)
app.use('/api/registrations', loadProjectUser, requireRole('organizer'), registrationsRoutes)

// Phase 2: Protected point operations.
app.use('/api/points', loadProjectUser, createPointLimit(pool), createPointsRouter(pool))

app.use('/api/evaluations', loadProjectUser, createManagerEvaluationsRouter(pool))

// Super Admin governance flags: every Organizer reads them, only a Super Admin changes them.
app.use('/api/governance', loadProjectUser, requireRole('organizer'),
  createGovernanceRouter(pool, (message) => logSystemEvent('info', message, 'governance')))

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
