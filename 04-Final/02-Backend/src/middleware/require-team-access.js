// Allows organizers or the team's assigned manager to access team members.
const teamsRepository = require('../repositories/teams.repository')
const parsePositiveId = require('../utils/parse-positive-id')

const requireTeamAccess = async (req, res, next) => {
  if (!req.projectUser) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication is required',
      },
    })
  }

  const { id: userId, role } = req.projectUser

  if (!['organizer', 'manager'].includes(role)) {
    return res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      },
    })
  }

  const teamId = parsePositiveId(req.params.id)

  if (teamId === null) {
    return res.status(400).json({
      error: {
        code: 'INVALID_TEAM_ID',
        message: 'Team ID must be a positive integer',
      },
    })
  }

  const team = await teamsRepository.findTeamById(teamId)

  if (role === 'manager' && (!team || team.managerId !== userId)) {
    return res.status(403).json({
      error: {
        code: 'TEAM_ACCESS_DENIED',
        message: 'Access to this team is not allowed',
      },
    })
  }

  if (!team) {
    return res.status(404).json({
      error: {
        code: 'TEAM_NOT_FOUND',
        message: 'Team not found',
      },
    })
  }

  req.projectTeam = team
  return next()
}

module.exports = requireTeamAccess