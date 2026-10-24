// Shared constants (used by both the UI and the mock backend).

export const CAMPUS = { jenin: 'جنين', ramallah: 'رام الله' };
export const CAMPUS_KEYS = ['jenin', 'ramallah'];

export const ROLE_LABEL = { organizer: 'منظّم', manager: 'مدير فريق', member: 'عضو' };


export const MONTHS_AR = [
  'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
  'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول',
];

/** Default landing route per role. */
export const HOME_BY_ROLE = {
  member: '/leaderboard',
  manager: '/manager',
  organizer: '/organizer',
};

/**
 * Policy flags: the management decisions that are still open in the requirements
 * document. They are editable by the Organizer (Policies page) and change the UI
 * behaviour live, so no code change is needed when management decides.
 */
export const DEFAULT_POLICIES = {
  managerCanEditOrMoveMembers: false, // Manager may edit members of his team
  membersInMultipleTeams: false, // a member may belong to more than one team
  globalLeaderboardEnabled: true, // combined leaderboard of both campuses
  maxPointsPerOperation: 50, // absolute limit for one points operation
  multipleManagersPerTeam: true, // a team may have more than one manager
};

/** Arabic display names of the groups (internal ids/names stay English). */
export const TEAM_AR = { Technical: 'التقني', PR: 'العلاقات العامة', Marketing: 'التسويق', 'Social Media': 'التواصل الاجتماعي' };
export const teamLabel = (name) => TEAM_AR[name] || name;
