// Super Admin governance in the UI (pure functions, unit-tested). They only decide which controls and
// targets to show; the backend enforces every rule again (02-Backend/src/phase2/governance).

/** The three flags a Super Admin toggles (GET/PATCH /api/governance/settings). */
export const GOVERNANCE_FLAGS = Object.freeze([
  {
    key: 'allowOrganizerMemberEval',
    label: 'السماح للمنظمين بتقييم الأعضاء',
    hint: 'عند الإيقاف يقيّم المنظّمون المديرين فقط. عند التفعيل يقيّمون الأعضاء أيضًا داخل حرمهم.',
  },
  {
    key: 'allowJeninEvalRamallah',
    label: 'تفويض منظمي جنين لتقييم رام الله مؤقتاً',
    hint: 'تفويض طارئ: يسمح لمنظّمي حرم جنين بتقييم مديري (وأعضاء، إن كان مسموحًا) حرم رام الله.',
  },
  {
    key: 'allowRamallahEvalJenin',
    label: 'تفويض منظمي رام الله لتقييم جنين مؤقتاً',
    hint: 'تفويض طارئ: يسمح لمنظّمي حرم رام الله بتقييم مديري (وأعضاء، إن كان مسموحًا) حرم جنين.',
  },
]);

/** All flags off: the safe default when the settings could not be read. */
export const RESTRICTED_GOVERNANCE = Object.freeze({
  allowOrganizerMemberEval: false,
  allowJeninEvalRamallah: false,
  allowRamallahEvalJenin: false,
});

export const isSuperAdmin = (user) => !!user && user.isSuperAdmin === true;

/**
 * May `actor` edit, deactivate, delete or restore `target`?
 * Super Admin accounts: never through the UI. A Super Admin: every other account, both campuses.
 * A regular Organizer: only Members and Managers of its own campus (read-only for the rest).
 */
export function canManageAccount(actor, target) {
  if (!actor || !target || actor.role !== 'organizer') return false;
  if (target.isSuperAdmin) return false;
  if (isSuperAdmin(actor)) return true;
  if (target.role === 'organizer') return false;
  return !!actor.campus && target.campus === actor.campus;
}

/**
 * Archived (soft-deleted) accounts an Organizer sees: a Super Admin all; a regular Organizer those
 * of its own campus and those with no known campus.
 */
export function archivedVisible(actor, target) {
  if (!actor || !target || actor.role !== 'organizer') return false;
  if (isSuperAdmin(actor)) return true;
  return !target.campus || target.campus === actor.campus;
}

/**
 * May `actor` restore `target` (Restore & Assign)? Never a Super Admin account. A Super Admin:
 * any other account. A regular Organizer with a campus: former Members/Managers of its campus
 * (or with no known campus), restored into its campus as Member or Manager (server-enforced).
 */
export function canRestoreAccount(actor, target) {
  if (!actor || !target || actor.role !== 'organizer' || target.isSuperAdmin) return false;
  if (isSuperAdmin(actor)) return true;
  if (!actor.campus || target.role === 'organizer') return false;
  return !target.campus || target.campus === actor.campus;
}

/** Roles `actor` may give when restoring ([key, label] pairs): Organizer for Super Admins only. */
export const restorableRoles = (actor, options) =>
  (isSuperAdmin(actor) ? options : options.filter(([key]) => key !== 'organizer'));

export const RESTORE_MANAGER_CONFLICT = 'هذا الفريق لديه مدير معيّن حالياً؛ اختر فريقاً آخر أو أعده كعضو';

/**
 * Arabic problem with a Restore & Assign choice, or '' when it can be sent. `teams` are the
 * directory teams ({ id, campus, managerId }); the server checks the same rules in its transaction.
 */
export function restoreProblem({ role, campus, teamId }, teams = [], userId = null) {
  if (!['member', 'manager', 'organizer'].includes(role)) return 'اختر الدور.';
  if (!campus) return 'اختر الحرم.';
  if (role === 'organizer') return '';
  if (!teamId) return 'اختر الفريق: العضو والمدير ينتميان إلى فريق.';
  const team = teams.find((t) => String(t.id) === String(teamId));
  if (!team) return 'الفريق غير موجود.';
  if (team.campus !== campus) return 'الفريق المختار لا يتبع الحرم المختار.';
  if (role === 'manager' && team.managerId && String(team.managerId) !== String(userId)) return RESTORE_MANAGER_CONFLICT;
  return '';
}

/**
 * Campus options `actor` may assign ([key, label] pairs): all for a Super Admin, otherwise only its
 * own campus (cross-campus assignments are a Super Admin decision; the server enforces it).
 */
export const assignableCampuses = (actor, options) =>
  (isSuperAdmin(actor) ? options : options.filter(([key]) => key === (actor && actor.campus)));

/** Short Arabic summary of what a registration request asks for. */
export function requestedSummary(r, roleLabels = {}, campusLabels = {}) {
  if (!r || !r.requestedRole) return 'بدون تفاصيل (طلب قديم)';
  const parts = [roleLabels[r.requestedRole] || r.requestedRole];
  if (r.requestedCampus) parts.push(campusLabels[r.requestedCampus] || r.requestedCampus);
  if (r.requestedTeamName) parts.push(r.requestedTeamName);
  return parts.join(' · ');
}

/** May `actor` give `target` the Organizer role (role option in the edit and approval dialogs)? */
export const canAssignOrganizerRole = (actor) => isSuperAdmin(actor);

/**
 * May the Organizer `actor` ({role, isSuperAdmin, campus}) evaluate `target` ({role, campus, isSuperAdmin})?
 * Same rules as the backend: never an Organizer or a Super Admin; Members only while
 * allowOrganizerMemberEval is on; own campus unless that direction is delegated. Super Admins: anyone else.
 */
export function canEvaluateTarget(actor, target, settings = RESTRICTED_GOVERNANCE) {
  if (!actor || !target) return false;
  if (target.role === 'organizer' || target.isSuperAdmin) return false;
  if (target.role !== 'manager' && target.role !== 'member') return false;
  if (String(target.id) === String(actor.id)) return false;
  if (isSuperAdmin(actor)) return true;
  if (actor.role !== 'organizer') return false;
  if (target.role === 'member' && !settings.allowOrganizerMemberEval) return false;
  if (!actor.campus || !target.campus) return false;
  if (actor.campus === target.campus) return true;
  if (actor.campus === 'jenin' && target.campus === 'ramallah') return !!settings.allowJeninEvalRamallah;
  if (actor.campus === 'ramallah' && target.campus === 'jenin') return !!settings.allowRamallahEvalJenin;
  return false;
}

/** One line for the evaluation page explaining the current scope, in Arabic. */
export function evaluationScopeNote(actor, settings = RESTRICTED_GOVERNANCE) {
  if (isSuperAdmin(actor)) return 'أنت مشرف عام: يمكنك تقييم المديرين والأعضاء في الحرمين، ويُسجَّل كل تقييم في سجل التدقيق.';
  if (!actor || !actor.campus) return 'لم يُحدَّد حرمك بعد؛ اطلب من المشرف العام تحديده قبل التقييم.';
  const who = settings.allowOrganizerMemberEval ? 'المديرين والأعضاء' : 'المديرين فقط';
  const cross = (actor.campus === 'jenin' && settings.allowJeninEvalRamallah) || (actor.campus === 'ramallah' && settings.allowRamallahEvalJenin);
  return `تقيّم ${who} ${cross ? 'في الحرمين (تفويض مؤقت مفعّل)' : 'في حرمك فقط'}.`;
}
