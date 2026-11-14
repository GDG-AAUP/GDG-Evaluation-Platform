// Super Admin governance in the UI: which account controls and evaluation targets are offered.
// Run: node --test src/lib/governance.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  archivedVisible, assignableCampuses, canAssignOrganizerRole, canEvaluateTarget, canManageAccount, canRestoreAccount,
  evaluationScopeNote, GOVERNANCE_FLAGS, isSuperAdmin, requestedSummary, RESTORE_MANAGER_CONFLICT,
  restorableRoles, restoreProblem, RESTRICTED_GOVERNANCE,
} from './governance.js';

const SUPER = { id: '9', role: 'organizer', isSuperAdmin: true, campus: '' };
const HIBA = { id: '1', role: 'organizer', isSuperAdmin: false, campus: 'jenin' };
const RAMI = { id: '2', role: 'organizer', isSuperAdmin: false, campus: 'ramallah' };
const MGR_J = { id: '4', role: 'manager', campus: 'jenin' };
const MEM_J = { id: '5', role: 'member', campus: 'jenin' };
const MGR_R = { id: '6', role: 'manager', campus: 'ramallah' };
const MEM_R = { id: '7', role: 'member', campus: 'ramallah' };
const flags = (over = {}) => ({ ...RESTRICTED_GOVERNANCE, ...over });

test('the three governance toggles carry the Arabic labels', () => {
  assert.deepEqual(GOVERNANCE_FLAGS.map((f) => f.key), ['allowOrganizerMemberEval', 'allowJeninEvalRamallah', 'allowRamallahEvalJenin']);
  assert.deepEqual(GOVERNANCE_FLAGS.map((f) => f.label), [
    'السماح للمنظمين بتقييم الأعضاء',
    'تفويض منظمي جنين لتقييم رام الله مؤقتاً',
    'تفويض منظمي رام الله لتقييم جنين مؤقتاً',
  ]);
  assert.equal(isSuperAdmin(SUPER), true);
  assert.equal(isSuperAdmin(HIBA), false);
  assert.equal(isSuperAdmin({ ...HIBA, isSuperAdmin: 'true' }), false, 'only a real boolean counts');
  assert.equal(isSuperAdmin(null), false);
});

test('account controls: Organizer accounts for Super Admins only; Super Admin accounts never', () => {
  assert.equal(canManageAccount(HIBA, MEM_J), true);
  assert.equal(canManageAccount(HIBA, MGR_J), true);
  assert.equal(canManageAccount(HIBA, MGR_R), false, 'the other campus is read-only');
  assert.equal(canManageAccount(RAMI, MEM_R), true);
  assert.equal(canManageAccount({ ...HIBA, campus: '' }, MEM_J), false, 'no campus yet: nothing to manage');
  assert.equal(canManageAccount(SUPER, MEM_R), true, 'Super Admin: both campuses');
  assert.equal(canManageAccount(SUPER, MGR_J), true);
  assert.equal(canManageAccount(HIBA, RAMI), false, 'a regular organizer cannot edit another organizer');
  assert.equal(canManageAccount(HIBA, HIBA), false, '... nor its own organizer account');
  assert.equal(canManageAccount(SUPER, RAMI), true);
  assert.equal(canManageAccount(SUPER, { ...SUPER, id: '10' }), false, 'Super Admin accounts are protected');
  assert.equal(canManageAccount(SUPER, SUPER), false);
  assert.equal(canManageAccount(MGR_J, MEM_J), false, 'this page is for organizers');
  assert.equal(canAssignOrganizerRole(SUPER), true);
  assert.equal(canAssignOrganizerRole(HIBA), false);
});

test('restore & assign: Super Admin anywhere; campus Organizer for its campus as Member/Manager', () => {
  const archivedJ = { ...MEM_J, status: 'deleted' };
  const archivedR = { ...MGR_R, status: 'deleted' };
  const unknown = { id: '8', role: 'member', campus: '', status: 'deleted' };
  const formerOrganizer = { id: '2', role: 'organizer', campus: 'jenin', status: 'deleted' };
  assert.equal(canRestoreAccount(SUPER, archivedR), true);
  assert.equal(canRestoreAccount(SUPER, formerOrganizer), true);
  assert.equal(canRestoreAccount(SUPER, { ...SUPER, id: '10' }), false, 'never a Super Admin account');
  assert.equal(canRestoreAccount(HIBA, archivedJ), true);
  assert.equal(canRestoreAccount(HIBA, unknown), true, 'no known campus: the Organizer may place them');
  assert.equal(canRestoreAccount(HIBA, archivedR), false, 'other campus');
  assert.equal(canRestoreAccount(HIBA, formerOrganizer), false, 'former Organizers: Super Admin only');
  assert.equal(canRestoreAccount({ ...HIBA, campus: '' }, archivedJ), false, 'no campus yet');
  assert.equal(canRestoreAccount(MGR_J, archivedJ), false);
  assert.deepEqual([archivedVisible(HIBA, archivedJ), archivedVisible(HIBA, unknown), archivedVisible(HIBA, archivedR)], [true, true, false]);
  assert.equal(archivedVisible(SUPER, archivedR), true);
  const roles = [['member', 'عضو'], ['manager', 'مدير فريق'], ['organizer', 'منظّم']];
  assert.deepEqual(restorableRoles(HIBA, roles).map(([k]) => k), ['member', 'manager']);
  assert.deepEqual(restorableRoles(SUPER, roles).map(([k]) => k), ['member', 'manager', 'organizer']);
  const teams = [
    { id: '10', campus: 'jenin', managerId: '100' },
    { id: '11', campus: 'jenin', managerId: null },
    { id: '20', campus: 'ramallah', managerId: null },
  ];
  assert.equal(restoreProblem({ role: 'manager', campus: 'jenin', teamId: '10' }, teams, '4'), RESTORE_MANAGER_CONFLICT);
  assert.equal(RESTORE_MANAGER_CONFLICT, 'هذا الفريق لديه مدير معيّن حالياً؛ اختر فريقاً آخر أو أعده كعضو');
  assert.equal(restoreProblem({ role: 'manager', campus: 'jenin', teamId: '10' }, teams, '100'), '', 'its own seat');
  assert.equal(restoreProblem({ role: 'member', campus: 'jenin', teamId: '10' }, teams, '4'), '', 'as a Member of the same team');
  assert.equal(restoreProblem({ role: 'manager', campus: 'jenin', teamId: '11' }, teams, '4'), '', 'a vacant team');
  assert.match(restoreProblem({ role: 'member', campus: 'jenin', teamId: '' }, teams), /اختر الفريق/);
  assert.match(restoreProblem({ role: 'member', campus: 'ramallah', teamId: '10' }, teams), /لا يتبع الحرم/);
  assert.equal(restoreProblem({ role: 'organizer', campus: 'ramallah', teamId: '' }, teams), '');
  assert.match(restoreProblem({ role: 'organizer', campus: '' }, teams), /الحرم/);
  assert.match(restoreProblem({ role: '' }, teams), /الدور/);
});

test('campus choices follow the hierarchy', () => {
  const all = [['jenin', 'جنين'], ['ramallah', 'رام الله']];
  assert.deepEqual(assignableCampuses(SUPER, all), all);
  assert.deepEqual(assignableCampuses(HIBA, all), [['jenin', 'جنين']]);
  assert.deepEqual(assignableCampuses(RAMI, all), [['ramallah', 'رام الله']]);
});

test('registration requests are summarized in Arabic', () => {
  const roles = { member: 'عضو', manager: 'مدير فريق', organizer: 'منظّم' };
  const campuses = { jenin: 'جنين', ramallah: 'رام الله' };
  assert.equal(requestedSummary({ requestedRole: 'member', requestedCampus: 'jenin', requestedTeamName: 'Tech' }, roles, campuses), 'عضو · جنين · Tech');
  assert.equal(requestedSummary({ requestedRole: 'organizer', requestedCampus: 'ramallah' }, roles, campuses), 'منظّم · رام الله');
  assert.equal(requestedSummary({ requestedRole: null }, roles, campuses), 'بدون تفاصيل (طلب قديم)');
});

test('evaluation targets: defaults = own-campus Managers; never Organizers or Super Admins', () => {
  const g = flags();
  assert.equal(canEvaluateTarget(HIBA, MGR_J, g), true);
  assert.equal(canEvaluateTarget(HIBA, MEM_J, g), false, 'members need allowOrganizerMemberEval');
  assert.equal(canEvaluateTarget(HIBA, MGR_R, g), false, 'other campus needs delegation');
  assert.equal(canEvaluateTarget(HIBA, RAMI, g), false);
  assert.equal(canEvaluateTarget(HIBA, SUPER, g), false);
  assert.equal(canEvaluateTarget(SUPER, HIBA, g), false, 'not even a Super Admin evaluates organizers');
  assert.equal(canEvaluateTarget({ ...HIBA, campus: '' }, MGR_J, g), false, 'organizer without a campus');
  assert.equal(canEvaluateTarget(HIBA, undefined, g), false);
});

test('evaluation targets: member flag, one-way delegation, Super Admin override', () => {
  assert.equal(canEvaluateTarget(HIBA, MEM_J, flags({ allowOrganizerMemberEval: true })), true);
  assert.equal(canEvaluateTarget(HIBA, MEM_R, flags({ allowOrganizerMemberEval: true })), false);
  const jToR = flags({ allowJeninEvalRamallah: true });
  assert.equal(canEvaluateTarget(HIBA, MGR_R, jToR), true);
  assert.equal(canEvaluateTarget(HIBA, MEM_R, jToR), false, 'members still need their own flag');
  assert.equal(canEvaluateTarget(RAMI, MGR_J, jToR), false, 'the other direction stays closed');
  assert.equal(canEvaluateTarget(RAMI, MGR_J, flags({ allowRamallahEvalJenin: true })), true);
  for (const target of [MGR_J, MEM_J, MGR_R, MEM_R]) assert.equal(canEvaluateTarget(SUPER, target, flags()), true);
});

test('the evaluation page explains the current scope in Arabic', () => {
  assert.match(evaluationScopeNote(SUPER, flags()), /مشرف عام/);
  assert.match(evaluationScopeNote(HIBA, flags()), /المديرين فقط في حرمك فقط/);
  assert.match(evaluationScopeNote(HIBA, flags({ allowOrganizerMemberEval: true, allowJeninEvalRamallah: true })), /المديرين والأعضاء في الحرمين/);
  assert.match(evaluationScopeNote({ ...HIBA, campus: '' }, flags()), /لم يُحدَّد حرمك/);
});
