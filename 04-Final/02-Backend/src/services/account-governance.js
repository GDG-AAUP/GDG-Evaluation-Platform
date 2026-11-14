// Account management hierarchy (Super Admin governance). Checked INSIDE each account transaction,
// after the target row is read under lock, so a concurrent role or team change cannot slip past it.
const { isSuperAdminClerkId } = require('../../dist/phase2/governance/governance.js')

// The access the route grants. isSuperAdmin comes only from loadProjectUser (verified Clerk ID);
// organizerCampusId is the acting Organizer's own campus (users.organizer_campus_id).
const accessOf = (projectUser) => ({
  isSuperAdmin: projectUser?.isSuperAdmin === true,
  organizerCampusId: projectUser?.organizerCampusId ?? null,
})

// Campus of a team; undefined when the team does not exist (the caller reports team_not_found).
const teamCampus = async (client, teamId) => {
  if (teamId === null || teamId === undefined) return null
  const { rows } = await client.query('SELECT campus_id FROM teams WHERE team_id = $1', [teamId])
  return rows.length ? rows[0].campus_id : undefined
}

/**
 * Refusal outcome for changing `target` (a users row: role 'Organizer'|'Manager'|'Member',
 * clerk_user_id, team_id) so that its role becomes `nextRole` and its team `nextTeamId`, or null.
 * - Super Admin accounts are never modified, deactivated, deleted or restored through the API.
 * - A Super Admin manages every other account, on both campuses.
 * - A regular Organizer manages only Members and Managers of its own campus, and keeps them there:
 *   never an Organizer (or a promotion to Organizer), never anyone on the other campus.
 */
const accountGuard = async (client, access, target, { nextRole = target.role, nextTeamId = target.team_id } = {}) => {
  if (isSuperAdminClerkId(target.clerk_user_id)) return 'super_admin_protected'
  if (access && access.isSuperAdmin === true) return null
  if (target.role === 'Organizer' || nextRole === 'Organizer') return 'organizer_protected'
  const own = access ? access.organizerCampusId ?? null : null
  if (own === null) return 'campus_required'
  if ((await teamCampus(client, target.team_id)) !== own) return 'out_of_campus'
  if (nextTeamId !== target.team_id) {
    const destination = await teamCampus(client, nextTeamId)
    if (destination !== undefined && destination !== own) return 'out_of_campus'
  }
  return null
}

const ACCOUNT_GOVERNANCE_FAILURES = {
  super_admin_protected: [403, 'SUPER_ADMIN_PROTECTED', 'Super Admin accounts cannot be modified, deactivated or deleted through the API'],
  organizer_protected: [403, 'ORGANIZER_MANAGEMENT_RESTRICTED', 'Only a Super Admin can create, edit, deactivate, delete or change the role of an Organizer account'],
  campus_required: [403, 'ORGANIZER_CAMPUS_REQUIRED', 'Your organizer account has no campus yet; a Super Admin must assign one'],
  out_of_campus: [403, 'OUT_OF_CAMPUS_SCOPE', 'Organizers manage only Members and Managers of their own campus'],
}

module.exports = { accessOf, accountGuard, teamCampus, ACCOUNT_GOVERNANCE_FAILURES, isSuperAdminClerkId }
