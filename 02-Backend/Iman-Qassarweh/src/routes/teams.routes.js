// Reads teams and authorized member lists, and allows organizers to create inactive teams.
const express = require('express')
const parsePositiveId = require('../utils/parse-positive-id')
const requireTeamAccess = require('../middleware/require-team-access')
const teamsRepository = require('../repositories/teams.repository')
const usersRepository = require('../repositories/users.repository')
const requireRole = require('../middleware/require-role')
const validateCreateTeam = require('../validators/create-team.validator')
const validateReplaceManager = require('../validators/replace-manager.validator')
const { replaceTeamManager } = require('../repositories/team-manager.repository')

const router = express.Router()

router.get('/', async (req, res) => {
  let campusId

  if (req.query.campusId !== undefined) {
    campusId = parsePositiveId(req.query.campusId)

    if (campusId === null) {
      return res.status(400).json({
        error: {
          code: 'INVALID_CAMPUS_ID',
          message: 'Campus ID must be a positive integer',
        },
      })
    }
  }

  const teams = await teamsRepository.listTeams({ campusId })

  return res.status(200).json({
    data: teams,
  })
})

router.get('/:id', async (req, res) => {
  const id = parsePositiveId(req.params.id)

  if (id === null) {
    return res.status(400).json({
      error: {
        code: 'INVALID_TEAM_ID',
        message: 'Team ID must be a positive integer',
      },
    })
  }

  const team = await teamsRepository.findTeamById(id)

  if (team === null) {
    return res.status(404).json({
      error: {
        code: 'TEAM_NOT_FOUND',
        message: 'Team not found',
      },
    })
  }

  return res.status(200).json({
    data: team,
  })
})


router.get('/:id/members', requireTeamAccess, async (req, res) => {
  const members = await usersRepository.listTeamMembers(
    req.projectTeam.id,
  )

  return res.status(200).json({
    data: members,
  })
})

// Creates an inactive team after validating organizer access and request data.
router.post('/', requireRole('organizer'), async (req, res) => {
  const validation = validateCreateTeam(req.body)

  if (validation.error) {
    return res.status(400).json({
      error: {
        code: 'INVALID_TEAM_DATA',
        message: validation.error,
      },
    })
  }

  const result = await teamsRepository.createTeam(validation.value, req.projectUser.id)

  if (result.outcome === 'actor_forbidden') {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'An active organizer account is required' },
    })
  }

  if (result.outcome === 'campus_not_found') {
    return res.status(404).json({
      error: {
        code: 'CAMPUS_NOT_FOUND',
        message: 'Campus not found',
      },
    })
  }

  if (result.outcome === 'team_exists') {
    return res.status(409).json({
      error: {
        code: 'TEAM_ALREADY_EXISTS',
        message: 'A team with this name already exists in this campus',
      },
    })
  }

  if (result.outcome !== 'created') {
    throw new Error('Unexpected team creation outcome')
  }

  return res.status(201).json({ data: result.team })
})

// Replaces the manager and keeps the former manager as an active member of the same team.
router.patch('/:id/manager', requireRole('organizer'), async (req, res) => {
  const teamId = parsePositiveId(req.params.id)
  if (teamId === null) {
    return res.status(400).json({
      error: { code: 'INVALID_TEAM_ID', message: 'Team ID must be a positive integer' },
    })
  }
  const validation = validateReplaceManager(req.body)
  if (validation.error) {
    return res.status(400).json({
      error: { code: 'INVALID_MANAGER_DATA', message: validation.error },
    })
  }
  const result = await replaceTeamManager(teamId, validation.value, req.projectUser.id)
  const failures = {
    actor_forbidden: [403, 'FORBIDDEN', 'An active organizer account is required'],
    team_not_found: [404, 'TEAM_NOT_FOUND', 'Team not found'],
    manager_changed: [409, 'MANAGER_CHANGED', 'The current manager changed; reload the team before retrying'],
    invalid_current_manager: [409, 'INVALID_CURRENT_MANAGER', 'Current manager assignment is inconsistent'],
    invalid_replacement: [409, 'INVALID_REPLACEMENT', 'Choose an active linked member of the same team who does not manage another team'],
    history_conflict: [409, 'ASSIGNMENT_HISTORY_CONFLICT', 'Current assignment history must match both accounts before replacement'],
  }
  if (result.outcome !== 'replaced') {
    const failure = failures[result.outcome]
    if (!failure) throw new Error('Unexpected manager replacement outcome')
    return res.status(failure[0]).json({ error: { code: failure[1], message: failure[2] } })
  }
  return res.status(200).json({ data: result.data })
})

// Updates team operational status without changing account status or assignments.
router.patch('/:id/status', requireRole('organizer'), async (req, res) => {
  const teamId = parsePositiveId(req.params.id)
  if (teamId === null) {
    return res.status(400).json({
      error: { code: 'INVALID_TEAM_ID', message: 'Team ID must be a positive integer' },
    })
  }
  const body = req.body
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 || typeof body.isOperational !== 'boolean') {
    return res.status(400).json({
      error: { code: 'INVALID_TEAM_STATUS', message: 'Provide only isOperational as a boolean' },
    })
  }
  const result = await teamsRepository.setTeamOperationalStatus(
    teamId, body.isOperational, req.projectUser.id,
  )
  if (result.outcome === 'actor_forbidden') {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'An active organizer account is required' },
    })
  }
  if (result.outcome === 'not_found') {
    return res.status(404).json({ error: { code: 'TEAM_NOT_FOUND', message: 'Team not found' } })
  }
  if (result.outcome === 'manager_required') {
    return res.status(409).json({
      error: { code: 'ACTIVE_TEAM_MANAGER_REQUIRED', message: 'Activation requires an active manager belonging to this team' },
    })
  }
  if (result.outcome !== 'updated') throw new Error('Unexpected team status outcome')
  return res.status(200).json({ data: result.team })
})

module.exports = router
