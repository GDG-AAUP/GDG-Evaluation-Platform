// Permission Matrix (role -> permissions).
// Used by the UI (hide/disable actions) AND by the mock backend (enforcement).
// The real backend must enforce the same matrix server-side (RBAC).

export const PERMISSIONS = {
  organizer: [
    'leaderboard.view',
    'points.add', 'points.reverse',
    'users.manage', 'teams.manage',
    'evaluations.manage',
    'archive.manage',
    'audit.view', 'syslog.view',
    'policies.edit',
    'assistant.use',
  ],
  manager: [
    'leaderboard.view',
    'team.view',
    'points.add.team',
    'users.add.team',
    'assistant.use',
  ],
  member: [
    'leaderboard.view',
    'points.view.self',
    'assistant.use',
  ],
};

export function can(user, permission) {
  return !!user && (PERMISSIONS[user.role] || []).includes(permission);
}

/** Can this user open the page of the given team? */
export function canSeeTeam(user, teamId) {
  if (!user) return false;
  if (user.role === 'organizer') return true;
  return user.role === 'manager' && (user.teams || []).includes(teamId);
}
