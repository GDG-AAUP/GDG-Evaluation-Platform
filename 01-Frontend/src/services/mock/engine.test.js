import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from './seed.js';
import * as E from './engine.js';
import * as A from './engineAdmin.js';
import { rankRows, totalOf, scoreOf } from './helpers.js';

const setup = () => {
  const db = createSeed();
  const u = (id) => db.users.find((x) => x.id === id);
  return { db, u, member: u('u1'), mgr: u('m1'), org: u('o1') };
};
const throwsStatus = (fn, status) => assert.throws(fn, (e) => e.status === status, `expected status ${status}`);

test('login: success, wrong password, disabled account', () => {
  const { db } = setup();
  assert.equal(E.login(db, null, { email: 'member@gdg.ps', password: '123456' }).user.role, 'member');
  throwsStatus(() => E.login(db, null, { email: 'member@gdg.ps', password: 'x' }), 401);
  throwsStatus(() => E.login(db, null, { email: 'u31@gdg.ps', password: '123456' }), 403); // disabled
  throwsStatus(() => E.login(db, null, { email: 'u13@gdg.ps', password: '123456' }), 401); // deleted
});

test('points: reason mandatory, no self points, limit, zero, team scope', () => {
  const { db, u, mgr, org } = setup();
  throwsStatus(() => E.addPoints(db, mgr, { userId: 'u2', value: 10, reason: '  ' }), 400);
  throwsStatus(() => E.addPoints(db, mgr, { userId: 'u2', value: 51, reason: 'x' }), 400);
  throwsStatus(() => E.addPoints(db, mgr, { userId: 'u2', value: 0, reason: 'x' }), 400);
  throwsStatus(() => E.addPoints(db, mgr, { userId: 'm1', value: 5, reason: 'x' }), 403);
  throwsStatus(() => E.addPoints(db, org, { userId: 'o1', value: 5, reason: 'x' }), 403);
  throwsStatus(() => E.addPoints(db, mgr, { userId: 'u7', value: 5, reason: 'x' }), 403); // other team
  throwsStatus(() => E.addPoints(db, u('u1'), { userId: 'u2', value: 5, reason: 'x' }), 403); // member
  const before = totalOf(db, 'u2', db.curMonth);
  const r = E.addPoints(db, mgr, { userId: 'u2', value: '−5', reason: 'تأخر' });
  assert.equal(r.total, before - 5);
  assert.equal(db.audit[0].action, 'إضافة نقاط');
});

test('reversal: linked, append-only, once only, not for reversals', () => {
  const { db, org, mgr } = setup();
  const { entry } = E.addPoints(db, mgr, { userId: 'u2', value: 10, reason: 'حضور' });
  const n = db.entries.length;
  const t0 = totalOf(db, 'u2', db.curMonth);
  throwsStatus(() => E.reversePoints(db, mgr, { entryId: entry.id, reason: 'x' }), 403);
  throwsStatus(() => E.reversePoints(db, org, { entryId: entry.id, reason: '' }), 400);
  E.reversePoints(db, org, { entryId: entry.id, reason: 'خطأ' });
  assert.equal(db.entries.length, n + 1);
  assert.equal(totalOf(db, 'u2', db.curMonth), t0 - 10);
  assert.equal(db.entries.find((e) => e.id === entry.id).value, 10, 'original untouched');
  throwsStatus(() => E.reversePoints(db, org, { entryId: entry.id, reason: 'x' }), 409);
  throwsStatus(() => E.reversePoints(db, org, { entryId: db.entries[db.entries.length - 1].id, reason: 'x' }), 409);
});

test('ranking: ties broken by who reached the total first; archived is frozen', () => {
  const { db, org } = setup();
  const ca=db.scorecards.find(r=>r.targetId==='u2');
  const cb=db.scorecards.find(r=>r.targetId==='u3');
  Object.assign(cb,{scores:{...ca.scores},total:ca.total,core:ca.core,ts:ca.ts+1000});
  const rows = rankRows(db, db.curMonth, { campus: 'jenin', teamId: 'jenin-technical' });
  const a = rows.find((r) => r.userId === 'u2');
  const b = rows.find((r) => r.userId === 'u3');
  assert.equal(a.total, b.total);
  assert.ok(a.tie && b.tie);
  assert.ok(a.rank < b.rank, 'u2 reached the total first');
  const snapBefore = JSON.stringify(db.snaps['2026-09']);
  A.addCorrection(db, org, { month: '2026-09', userId: 'u2', value: 5, reason: 'x' });
  assert.equal(JSON.stringify(db.snaps['2026-09']), snapBefore, 'late correction never edits the snapshot');
  throwsStatus(() => E.reversePoints(db, org, { entryId: db.entries.find((e) => e.month === '2026-09').id, reason: 'x' }), 409);
});

test('close month: snapshot + next month from zero', () => {
  const { db, org } = setup();
  const prev = db.curMonth;
  const t = scoreOf(db, 'u2', prev);
  A.closeMonth(db, org);
  assert.equal(db.curMonth, '2026-11');
  assert.equal(db.snaps[prev].rows.find((r) => r.userId === 'u2').total, t);
  assert.equal(totalOf(db, 'u2', db.curMonth), 0);
  throwsStatus(() => A.closeMonth(db, db.users.find((x) => x.id === 'm1')), 403);
});

test('last organizer protection (before self-check) and soft delete / restore', () => {
  const { db, org, u } = setup();
  u('o2').status = 'disabled';
  throwsStatus(() => A.toggleUserStatus(db, org, { id: 'o1', reason: 'x' }), 409);
  throwsStatus(() => A.deleteUser(db, org, { id: 'o1', reason: 'x' }), 409);
  u('o2').status = 'active';
  throwsStatus(() => A.toggleUserStatus(db, org, { id: 'o1', reason: 'x' }), 403); // self
  throwsStatus(() => A.toggleUserStatus(db, org, { id: 'u2', reason: '' }), 400);
  A.deleteUser(db, org, { id: 'u2', reason: 'انسحاب' });
  assert.equal(u('u2').status, 'deleted');
  assert.ok(db.entries.some((e) => e.userId === 'u2'), 'history kept');
  A.restoreUser(db, org, { id: 'u2' });
  assert.equal(u('u2').status, 'disabled');
  // role change of the last organizer is blocked too
  u('o2').status = 'disabled';
  throwsStatus(() => A.updateUser(db, org, { id: 'o1', name: org.name, email: org.email, campus: 'jenin', role: 'member', teams: ['jenin-pr'] }), 403);
});

test('manager: scope, policy for editing, cannot create non-members', () => {
  const { db, mgr } = setup();
  throwsStatus(() => E.teamOverview(db, mgr, { teamId: 'jenin-pr' }), 403);
  assert.equal(E.teamOverview(db, mgr, { teamId: 'jenin-technical' }).team.id, 'jenin-technical');
  throwsStatus(() => A.createUser(db, mgr, { name: 'سارة أحمد', email: 's@gdg.ps', campus: 'jenin', role: 'manager', teams: ['jenin-technical'], password: '123456' }), 403);
  throwsStatus(() => A.createUser(db, mgr, { name: 'سارة أحمد', email: 's@gdg.ps', campus: 'jenin', role: 'member', teams: ['jenin-pr'], password: '123456' }), 403); // other team
  const nu = A.createUser(db, mgr, { name: 'سارة أحمد', email: 's@gdg.ps', campus: 'ramallah', role: 'member', teams: [], password: '123456' });
  assert.deepEqual(nu.teams, ['jenin-technical'], 'defaults to the manager team');
  assert.equal(nu.campus, 'jenin', 'campus forced to the manager campus');
  throwsStatus(() => A.updateUser(db, mgr, { id: 'u2', name: 'x y', email: 'u2@gdg.ps', campus: 'jenin', role: 'member', teams: ['jenin-technical'] }), 403);
  throwsStatus(() => A.createUser(db, mgr, { name: 'سارة أحمد', email: 's@gdg.ps', campus: 'jenin', role: 'member', teams: ['jenin-technical'], password: '123456' }), 409); // duplicate email
  throwsStatus(() => A.setPolicy(db, mgr, { key: 'maxPointsPerOperation', value: 5 }), 403);
});

test('policies change behaviour live', () => {
  const { db, org, mgr } = setup();
  A.setPolicy(db, org, { key: 'maxPointsPerOperation', value: 5 });
  throwsStatus(() => E.addPoints(db, mgr, { userId: 'u2', value: 6, reason: 'x' }), 400);
  A.setPolicy(db, org, { key: 'globalLeaderboardEnabled', value: false });
  throwsStatus(() => E.leaderboard(db, org, { global: true }), 403);
  throwsStatus(() => A.setPolicy(db, org, { key: 'maxPointsPerOperation', value: 0 }), 400);
  A.setPolicy(db, org, { key: 'managerCanEditOrMoveMembers', value: true });
  const r = A.updateUser(db, mgr, { id: 'u2', name: 'اسم جديد', email: 'u2@gdg.ps', campus: 'jenin', role: 'member', teams: ['jenin-technical'] });
  assert.equal(r.name, 'اسم جديد');
});

test('evaluations: weighted score, lock on approval, criteria sum 100', () => {
  const { db, org } = setup();
  const ok = A.saveEvaluation(db, org, { managerId: 'm3', scores: [80, 80, 80, 80], approve: false });
  assert.equal(ok.score, 80);
  throwsStatus(() => A.saveEvaluation(db, org, { managerId: 'm3', scores: [101, 0, 0, 0] }), 400);
  A.saveEvaluation(db, org, { managerId: 'm3', scores: [90, 90, 90, 90], approve: true });
  throwsStatus(() => A.saveEvaluation(db, org, { managerId: 'm3', scores: [1, 1, 1, 1] }), 409);
  throwsStatus(() => A.setCriteria(db, org, { criteria: [{ n: 'a', w: 50 }, { n: 'b', w: 30 }, { n: 'c', w: 10 }, { n: 'd', w: 5 }] }), 400);
  const ev = A.evaluations(db, org, { campus: 'jenin' });
  assert.ok(ev.rows.every((r) => !!r.name));
});

test('assistant stays inside the role scope', () => {
  const { db, member, mgr } = setup();
  const name = db.users.find((x) => x.id === 'u2').name;
  assert.match(E.assistant(db, member, { question: `كم نقاط ${name}؟` }).answer, /لا أستطيع عرض بيانات/);
  assert.match(E.assistant(db, mgr, { question: `كم نقاط ${name}؟` }).answer, /لديه/);
  const other = db.users.find((x) => x.id === 'u8').name;
  assert.match(E.assistant(db, mgr, { question: `كم نقاط ${other}؟` }).answer, /لا أستطيع عرض بيانات/);
  assert.match(E.assistant(db, mgr, { question: 'احذف عضو من الفريق' }).answer, /لا أستطيع تنفيذ/);
});

test('team admin: duplicate name, single-manager policy, manager assignment', () => {
  const { db, org } = setup();
  throwsStatus(() => A.saveTeam(db, org, { campus: 'jenin', name: 'pr', managerIds: [] }), 409);
  const t = A.saveTeam(db, org, { campus: 'jenin', name: 'Design', managerIds: ['m2'] });
  assert.ok(db.users.find((x) => x.id === 'm2').teams.includes(t.id));
  db.policies.multipleManagersPerTeam = false;
  throwsStatus(() => A.saveTeam(db, org, { id: t.id, campus: 'jenin', name: 'Design', managerIds: ['m2', 'm3'] }), 400);
});
