// Contract tests: the real-backend layer (httpCore + backend/client) against an in-memory fake
// that follows 02-Backend/docs/api.md (envelope { data }, errors { error: { code, message } },
// numeric ids, campus names, strict body validation like the real validators).
// Run: node --test src/services/backend/backend.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttp } from '../httpCore.js';
import { createBackend } from './client.js';
import { translateServerError } from './errorsAr.js';

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const ok = (data, status = 200) => json(status, { data });
const fail = (status, code, message = 'x') => json(status, { error: { code, message } });

/** Fake of the real backend. `calls` records every request for assertions. */
function fakeServer({ me, token = 'tok-1' } = {}) {
  const calls = [];
  const state = {
    campuses: [{ id: 1, name: 'Jenin' }, { id: 2, name: 'Ramallah' }],
    teams: [
      { id: 10, campusId: 1, name: 'Technical', managerId: 100, isOperational: true, description: null },
      { id: 11, campusId: 2, name: 'PR', managerId: null, isOperational: false, description: null },
    ],
    users: [
      { id: 1, name: 'هبة', email: 'org@gdg.ps', role: 'organizer', teamId: null, isActive: true, deletedAt: null },
      { id: 100, name: 'بشار', email: 'm@gdg.ps', role: 'manager', teamId: 10, isActive: true, deletedAt: null },
      { id: 200, name: 'ليان', email: 'u@gdg.ps', role: 'member', teamId: 10, isActive: true, deletedAt: null },
      { id: 201, name: 'عمر', email: 'o@gdg.ps', role: 'member', teamId: 10, isActive: false, deletedAt: null },
    ],
    deleted: [{ id: 300, name: 'محذوف', email: 'd@gdg.ps', role: 'member', teamId: 10, isActive: false, deletedAt: '2026-10-01T00:00:00Z' }],
    points: [
      { id: '5', points: 10, activityName: 'ورشة', reason: 'حضور', effectiveAt: '2026-10-05T09:00:00Z' },
      { id: '4', points: -5, activityName: 'تأخر', reason: 'تأخر', effectiveAt: '2026-09-28T09:00:00Z' },
    ],
  };
  const current = me || state.users[0];

  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: u.pathname, search: u.search, body, auth: init.headers && init.headers.Authorization });
    const p = u.pathname;
    if (p === '/api/auth/me') return ok({ id: current.id, name: current.name, role: current.role, isActive: true, teamId: current.teamId });
    if (p === '/api/campuses') return ok(state.campuses);
    if (p === '/api/teams' && method === 'GET') return ok(state.teams);
    if (p === '/api/teams' && method === 'POST') {
      const allowed = ['name', 'campusId', 'description'];
      if (Object.keys(body).some((k) => !allowed.includes(k))) return fail(400, 'INVALID_TEAM_DATA');
      const t = { id: 12, campusId: body.campusId, name: body.name, managerId: null, isOperational: false, description: null };
      state.teams.push(t);
      return ok(t, 201);
    }
    let m;
    if ((m = p.match(/^\/api\/teams\/(\d+)$/))) {
      const t = state.teams.find((x) => x.id === +m[1]);
      return t ? ok(t) : fail(404, 'TEAM_NOT_FOUND');
    }
    if ((m = p.match(/^\/api\/teams\/(\d+)\/status$/))) {
      const t = state.teams.find((x) => x.id === +m[1]);
      if (typeof body.isOperational !== 'boolean') return fail(400, 'INVALID_TEAM_STATUS');
      if (body.isOperational && !t.managerId) return fail(409, 'ACTIVE_TEAM_MANAGER_REQUIRED');
      t.isOperational = body.isOperational;
      return ok(t);
    }
    if ((m = p.match(/^\/api\/teams\/(\d+)\/members$/))) {
      return ok(state.users.filter((x) => x.role === 'member' && x.isActive && x.teamId === +m[1]).map((x) => ({ id: x.id, name: x.name, teamId: x.teamId })));
    }
    if (p === '/api/users' && method === 'GET') return ok(state.users);
    if (p === '/api/users/deleted') return ok(state.deleted);
    if (p === '/api/users' && method === 'POST') {
      const allowed = ['name', 'email', 'role', 'teamId'];
      if (Object.keys(body).some((k) => !allowed.includes(k)) || typeof body.teamId !== 'number') return fail(400, 'INVALID_USER_DATA');
      return ok({ id: 400, name: body.name, email: body.email, role: body.role, teamId: body.teamId, isActive: true, deliveryStatus: 'sent' }, 201);
    }
    if ((m = p.match(/^\/api\/users\/(\d+)$/)) && method === 'PATCH') {
      if (!body.reason) return fail(400, 'INVALID_USER_DATA');
      return ok({ id: +m[1], ...body });
    }
    if ((m = p.match(/^\/api\/users\/(\d+)$/)) && method === 'DELETE') {
      if (!body || !body.reason) return fail(400, 'INVALID_DELETION_DATA');
      return ok({ id: +m[1], name: 'ليان', email: 'u@gdg.ps', role: 'member', teamId: 10, isActive: false, deletedAt: '2026-10-20T00:00:00Z' });
    }
    if ((m = p.match(/^\/api\/users\/(\d+)\/status$/))) {
      if (typeof body.isActive !== 'boolean') return fail(400, 'INVALID_STATUS_DATA');
      return ok({ id: +m[1], isActive: body.isActive });
    }
    if ((m = p.match(/^\/api\/users\/(\d+)\/restore$/))) {
      return ok({ id: +m[1], name: 'محذوف', email: 'd@gdg.ps', role: 'member', teamId: 10, isActive: false, deletedAt: null });
    }
    if (p === '/api/points/me') return ok(state.points);
    if (p === '/api/points' && method === 'POST') {
      const allowed = ['userId', 'points', 'activityName', 'reason', 'activityDescription'];
      if (Object.keys(body).some((k) => !allowed.includes(k))) return fail(400, 'INVALID_POINT_DATA');
      if (!Number.isInteger(body.points) || body.points === 0 || Math.abs(body.points) > 100) return fail(400, 'INVALID_POINT_DATA');
      return ok({ id: '9', userId: body.userId, points: body.points, activityName: body.activityName, reason: body.reason, effectiveAt: '2026-10-21T10:00:00Z' }, 201);
    }
    if ((m = p.match(/^\/api\/points\/(\d+)\/reverse$/))) {
      if (!body.reason) return fail(400, 'INVALID_REVERSAL_DATA');
      return ok({ id: '10', reversesEntryId: m[1] }, 201);
    }
    // ---- Phase 2 (Phase-2 API handoff): public rankings, audit, manager evaluations
    if (p === '/api/rankings/options') {
      return ok({ campuses: [{ id: 1, name: 'Jenin' }], teams: [{ id: 10, campusId: 1, name: 'Technical' }] });
    }
    if (p === '/api/rankings' || p === '/api/rankings/archived') {
      const q = Object.fromEntries(u.searchParams);
      const allowed = ['scope', 'year', 'month', 'teamId', 'campusId'];
      const bad = Object.keys(q).some((k) => !allowed.includes(k))
        || !['team', 'campus'].includes(q.scope)
        || !/^\d{4}$/.test(q.year || '') || !(+q.month >= 1 && +q.month <= 12)
        || (q.scope === 'team' && (!q.teamId || q.campusId))
        || (q.scope === 'campus' && (!q.campusId || q.teamId));
      if (bad) return fail(400, 'INVALID_RANKING_QUERY');
      return ok([
        { rank: 1, userId: 200, fullName: 'ليان', totalPoints: 75 },
        { rank: 2, userId: 201, fullName: 'عمر', totalPoints: 45 },
        { rank: 2, userId: 202, fullName: 'سارة', totalPoints: 45 },
      ]);
    }
    if (p === '/api/audit') {
      const q = Object.fromEntries(u.searchParams);
      if (q.actorId && !/^\d+$/.test(q.actorId)) return fail(400, 'INVALID_AUDIT_QUERY');
      return ok({
        items: [
          { id: '901', actorId: 1, actorName: 'هبة', action: 'create_point_entry', entityType: 'point_entries', entityId: '5', oldValues: null, newValues: { points: 10 }, reason: 'حضور', batchId: null, createdAt: '2026-10-20T10:00:00.000Z' },
          { id: '902', actorId: 1, actorName: 'هبة', action: 'PERFORMANCE_EVALUATION_CREATED', entityType: 'performance_evaluations', entityId: '77', oldValues: null, newValues: { totalScore: 83 }, reason: 'تقييم', batchId: null, createdAt: '2026-10-21T10:00:00.000Z' },
        ],
        total: 2, page: +q.page, pageSize: +q.pageSize,
      });
    }
    if (p === '/api/evaluations/managers' && method === 'POST') {
      const allowed = ['evaluatedUserId', 'activityName', 'activityDate', 'criteriaScores', 'comments'];
      if (Object.keys(body).some((k) => !allowed.includes(k))) return fail(400, 'INVALID_EVALUATION_DATA');
      if (body.evaluatedUserId !== 100) return fail(404, 'MANAGER_NOT_FOUND');
      const [a, b, c, d] = body.criteriaScores;
      return ok({ id: '77', evaluatedUserId: 100, evaluatedByUserId: 1, teamId: 10, campusId: 1, totalScore: Math.round(a * 0.3 + b * 0.3 + c * 0.2 + d * 0.2) }, 201);
    }
    if ((m = p.match(/^\/api\/evaluations\/managers\/(\d+)\/average$/))) {
      if (!u.searchParams.get('year') || !u.searchParams.get('month')) return fail(400, 'INVALID_EVALUATION_PERIOD');
      return ok({ managerUserId: +m[1], year: 2026, month: 10, evaluationCount: 2, averageScore: 76 });
    }
    return fail(404, 'ROUTE_NOT_FOUND');
  };

  let unauthorized = 0;
  const http = createHttp({
    baseUrl: '/api',
    origin: 'http://x.test',
    getToken: async () => token,
    onUnauthorized: () => { unauthorized += 1; },
    fetchImpl,
  });
  return { http, backend: createBackend(http, { now: () => new Date('2026-10-21T12:00:00Z') }), calls, state, unauthorized: () => unauthorized };
}

/* ------------------------------------------------------------------ http */

test('http: unwraps { data }, sends a fresh Bearer token, translates errors to Arabic', async () => {
  const s = fakeServer();
  const camp = await s.http.get('/campuses');
  assert.equal(camp[0].name, 'Jenin');
  assert.equal(s.calls[0].auth, 'Bearer tok-1');

  await assert.rejects(() => s.http.get('/teams/999'), (e) => e.status === 404 && /الفريق غير موجود/.test(e.message) && e.details.code === 'TEAM_NOT_FOUND');
  await assert.rejects(() => s.http.get('/nope'), (e) => e.status === 404 && /غير متوفرة/.test(e.message));
});

test('http: 401 notifies the session layer; network failure is status 0; old {message} shape still works', async () => {
  const calls = { n: 0 };
  const h401 = createHttp({ baseUrl: '/api', origin: 'http://x.test', onUnauthorized: () => { calls.n += 1; }, fetchImpl: async () => fail(401, 'UNAUTHENTICATED') });
  await assert.rejects(() => h401.get('/auth/me'), (e) => e.status === 401);
  assert.equal(calls.n, 1);

  const hNet = createHttp({ baseUrl: '/api', origin: 'http://x.test', fetchImpl: async () => { throw new Error('down'); } });
  await assert.rejects(() => hNet.get('/x'), (e) => e.status === 0);

  assert.deepEqual(translateServerError(400, { message: 'سبب', details: { a: 1 } }), { message: 'سبب', details: { a: 1 } });
  assert.match(translateServerError(500, null).message, /غير متوقع/);
});

/* ----------------------------------------------------------------- users */

test('users: backend rows map to the UI shape (string ids, campus keys, status)', async () => {
  const s = fakeServer();
  const me = await s.backend.me();
  assert.equal(me.role, 'organizer');
  assert.equal(me.id, '1');
  assert.deepEqual(me.teams, []);

  const list = await s.backend.listUsers();
  const liyan = list.find((u) => u.id === '200');
  assert.equal(liyan.campus, 'jenin');
  assert.deepEqual(liyan.teams, ['10']);
  assert.equal(liyan.status, 'active');
  assert.equal(list.find((u) => u.id === '201').status, 'disabled');

  const del = await s.backend.listUsers({ deleted: true });
  assert.equal(del[0].status, 'deleted');
  assert.equal((await s.backend.listUsers({ role: 'manager' })).length, 1);
});

test('users: create sends only the fields the backend accepts; update sends only changes + reason', async () => {
  const s = fakeServer();
  const created = await s.backend.createUser({ name: ' سارة ', email: 's@gdg.ps', role: 'member', teams: ['10'], password: 'ignored' });
  assert.deepEqual(s.calls.find((c) => c.method === 'POST' && c.path === '/api/users').body, { name: 'سارة', email: 's@gdg.ps', role: 'member', teamId: 10 });
  assert.equal(created.id, '400');
  assert.equal(created.invitation, 'sent');

  await assert.rejects(() => s.backend.createUser({ name: 'x', email: 'x@y.z', role: 'organizer', teams: [] }), (e) => e.status === 400);

  s.calls.length = 0;
  await s.backend.updateUser('200', { name: 'ليان أبو سعدة', email: 'u@gdg.ps', role: 'member', teams: ['10'] });
  const patch = s.calls.find((c) => c.method === 'PATCH');
  assert.deepEqual(Object.keys(patch.body).sort(), ['name', 'reason']);

  s.calls.length = 0;
  const same = await s.backend.updateUser('200', { name: 'ليان', email: 'U@gdg.ps', role: 'member', teams: ['10'] });
  assert.equal(s.calls.some((c) => c.method === 'PATCH'), false, 'no change -> no request');
  assert.equal(same.id, '200');
});

test('users: status toggle, delete with reason, restore comes back disabled', async () => {
  const s = fakeServer();
  const off = await s.backend.toggleUserStatus('200');
  assert.deepEqual(s.calls.at(-1).body, { isActive: false });
  assert.equal(off.status, 'disabled');
  const on = await s.backend.toggleUserStatus('201');
  assert.deepEqual(s.calls.at(-1).body, { isActive: true });
  assert.equal(on.status, 'active');

  const d = await s.backend.deleteUser('200', 'انسحاب');
  assert.deepEqual(s.calls.find((c) => c.method === 'DELETE').body, { reason: 'انسحاب' });
  assert.equal(d.status, 'deleted');

  const r = await s.backend.restoreUser('300');
  assert.equal(r.status, 'disabled');
  await assert.rejects(() => s.backend.toggleUserStatus('abc'), (e) => e.status === 400);
});

/* ----------------------------------------------------------------- teams */

test('teams: list with managers/member counts, create, toggle (activation needs a manager)', async () => {
  const s = fakeServer();
  const teams = await s.backend.listTeams();
  const tech = teams.find((t) => t.id === '10');
  assert.equal(tech.campus, 'jenin');
  assert.equal(tech.status, 'active');
  assert.deepEqual(tech.managers, [{ id: '100', name: 'بشار' }]);
  assert.equal(tech.activeMembers, 1);

  const made = await s.backend.saveTeam({ name: 'Design', campus: 'ramallah' });
  assert.deepEqual(s.calls.find((c) => c.method === 'POST' && c.path === '/api/teams').body, { name: 'Design', campusId: 2 });
  assert.equal(made.status, 'disabled');

  await assert.rejects(() => s.backend.saveTeam({ id: '10', name: 'x', campus: 'jenin' }), (e) => e.status === 501);
  await assert.rejects(() => s.backend.toggleTeam('11'), (e) => e.status === 409 && /مديرًا فعّالًا/.test(e.message));
  const off = await s.backend.toggleTeam('10');
  assert.equal(off.status, 'disabled');
  assert.deepEqual((await s.backend.listCampusManagers('jenin')).map((m) => m.id), ['100']);
});

/* ---------------------------------------------------------------- points */

test('points: add sends exactly the allowed fields; reverse; my points per month', async () => {
  const s = fakeServer();
  const r = await s.backend.addPoints({ userId: '200', value: 15, reason: 'إنجاز عمل', month: '2026-10', extra: true });
  assert.deepEqual(s.calls.find((c) => c.path === '/api/points').body, { userId: 200, points: 15, activityName: 'إنجاز عمل', reason: 'إنجاز عمل' });
  assert.equal(r.entry.value, 15);
  await assert.rejects(() => s.backend.addPoints({ userId: '200', value: 0, reason: 'x' }), (e) => e.status === 400 && /بيانات النقاط/.test(e.message));
  await s.backend.reversePoints('5', 'تصحيح');
  assert.deepEqual(s.calls.at(-1).body, { reason: 'تصحيح' });
  await assert.rejects(() => s.backend.reversePoints('5x', 'a'), (e) => e.status === 400);

  const mine = await s.backend.myPoints('2026-10');
  assert.equal(mine.total, 10);
  assert.equal(mine.entries.length, 1);
  assert.equal(mine.rank, null);
  assert.equal((await s.backend.myPoints('2026-09')).negative, -5);
});

test('points: assignable members — organizer sees all active members, manager only own team', async () => {
  const org = fakeServer();
  assert.deepEqual((await org.backend.assignableMembers()).map((m) => m.id), ['200']);
  const mgr = fakeServer({ me: { id: 100, name: 'بشار', role: 'manager', teamId: 10 } });
  assert.deepEqual((await mgr.backend.assignableMembers()).map((m) => m.id), ['200']);
  assert.ok(mgr.calls.some((c) => c.path === '/api/teams/10/members'));
  const mem = fakeServer({ me: { id: 200, name: 'ليان', role: 'member', teamId: 10 } });
  assert.deepEqual(await mem.backend.assignableMembers(), []);
});

test('not supported yet: policies are read-only defaults, edit is refused with a clear 501', async () => {
  const s = fakeServer();
  assert.equal((await s.backend.policies()).maxPointsPerOperation, 50);
  await assert.rejects(() => s.backend.setPolicy('x', 1), (e) => e.status === 501 && e.details.code === 'NOT_SUPPORTED_BY_BACKEND');
});

/* ------------------------------------------------- Phase 2: rankings / audit / evaluations */

test('rankings: public (no token), strict query, dense rank ties, archived path', async () => {
  const s = fakeServer();
  const opts = await s.backend.rankingOptions();
  assert.deepEqual(opts.campuses, [{ id: '1', key: 'jenin', name: 'Jenin' }]);
  assert.equal(s.calls.at(-1).auth, undefined, 'public route is called without a token');

  const rows = await s.backend.rankings({ scope: 'team', teamId: '10', month: '2026-10' });
  assert.equal(s.calls.at(-1).search, '?scope=team&year=2026&month=10&teamId=10');
  assert.deepEqual(rows.map((r) => [r.rank, r.userId, r.total, r.tie]), [[1, '200', 75, false], [2, '201', 45, true], [2, '202', 45, true]]);
  assert.equal(rows[0].name, 'ليان');

  await s.backend.rankings({ scope: 'campus', campusId: 1, month: '2026-09', archived: true });
  assert.equal(s.calls.at(-1).path, '/api/rankings/archived');
  assert.equal(s.calls.at(-1).search, '?scope=campus&year=2026&month=9&campusId=1');

  await assert.rejects(() => s.backend.rankings({ scope: 'global', month: '2026-10' }), (e) => e.status === 400);
  await assert.rejects(() => s.backend.rankings({ scope: 'team', teamId: '10', month: '2026-13' }), (e) => e.status === 400);
  await assert.rejects(() => s.backend.rankings({ scope: 'team', teamId: 'x', month: '2026-10' }), (e) => e.status === 400);
});

test('audit: maps codes to Arabic labels, derives filter lists, sends backend codes back', async () => {
  const s = fakeServer();
  const res = await s.backend.auditLog({ action: 'إضافة نقاط', actorId: '1', from: '2026-10-01' });
  const call = s.calls.at(-1);
  assert.equal(call.search, '?actorId=1&action=create_point_entry&from=2026-10-01&page=1&pageSize=100');
  assert.equal(res.items[0].action, 'إضافة نقاط');
  assert.equal(res.items[0].after, '10');
  assert.equal(res.items[0].before, '—');
  assert.equal(res.items[1].action, 'إنشاء تقييم أداء');
  assert.equal(res.items[1].entityType, 'تقييم أداء');
  assert.equal(res.items[1].entity, '#77');
  assert.equal(res.items[1].after, '83');
  assert.ok(res.items[0].ts > 0);
  assert.deepEqual(res.filters.actions, ['إضافة نقاط', 'إنشاء تقييم أداء']);
  assert.deepEqual(res.filters.actors, [{ id: '1', name: 'هبة' }]);
  assert.equal(res.total, 2);
  await s.backend.auditLog({ actorId: 'abc' });
  assert.ok(!s.calls.at(-1).search.includes('actorId'), 'a non numeric actor id is not sent');
});

test('manager evaluation: four 0-100 scores, never sends evaluator or total; average; Arabic errors', async () => {
  const s = fakeServer();
  const r = await s.backend.createManagerEvaluation({ managerId: '100', activityName: ' تقييم تشرين ', activityDate: '2026-10-20', scores: [85, 80, 90, 75], comments: '  ' });
  assert.deepEqual(s.calls.at(-1).body, { evaluatedUserId: 100, activityName: 'تقييم تشرين', activityDate: '2026-10-20', criteriaScores: [85, 80, 90, 75], comments: null });
  assert.equal(r.total, 83);
  const bad = (over) => s.backend.createManagerEvaluation({ managerId: '100', activityName: 'x', activityDate: '2026-10-20', scores: [1, 2, 3, 4], ...over });
  await assert.rejects(() => bad({ scores: [1, 2, 3] }), (e) => e.status === 400);
  await assert.rejects(() => bad({ scores: [1, 2, 3, 101] }), (e) => e.status === 400);
  await assert.rejects(() => bad({ scores: [1, 2, 3, 4.5] }), (e) => e.status === 400);
  await assert.rejects(() => bad({ activityDate: '20-10-2026' }), (e) => e.status === 400);
  await assert.rejects(() => bad({ managerId: '999' }), (e) => e.status === 404 && /المدير غير موجود/.test(e.message));

  const avg = await s.backend.managerAverage('100', '2026-10');
  assert.equal(s.calls.at(-1).search, '?year=2026&month=10');
  assert.deepEqual(avg, { managerId: '100', month: '2026-10', count: 2, average: 76 });
  await assert.rejects(() => s.backend.managerAverage('100', 'oct'), (e) => e.status === 400);
});

test('Phase 2 error codes have Arabic messages', () => {
  for (const code of ['INVALID_RANKING_QUERY', 'INVALID_AUDIT_QUERY', 'INVALID_EVALUATION_DATA', 'INVALID_EVALUATION_PERIOD', 'MANAGER_NOT_FOUND', 'MANAGER_INELIGIBLE', 'NOT_A_MANAGER', 'ALREADY_REVERSED', 'CANNOT_REVERSE_REVERSAL']) {
    const { message } = translateServerError(409, { error: { code, message: 'English' } });
    assert.match(message, /[\u0600-\u06FF]/, code);
    assert.notEqual(message, 'تعارض مع إحدى قواعد العمل.', `${code} must not fall back to the generic 409 text`);
  }
});

test('leaderboard (page shape): public rankings by points, current vs archived month, isMe, merged campuses', async () => {
  const s = fakeServer({ me: { id: 200, name: 'ليان', role: 'member', teamId: 10 } });
  const cur = await s.backend.leaderboard({ month: '2026-10', global: true });
  assert.equal(cur.archived, false);
  assert.equal(cur.month, '2026-10');
  assert.ok(s.calls.some((c) => c.path === '/api/rankings'));
  assert.deepEqual(cur.rows.map((r) => [r.rank, r.userId, r.total, r.tie, r.isMe]), [[1, '200', 75, false, true], [2, '201', 45, true, false], [2, '202', 45, true, false]]);
  assert.equal(cur.rows[0].campus, 'jenin');
  assert.equal(cur.rows[0].kind, 'points');

  const old = await s.backend.leaderboard({ month: '2026-09', global: true });
  assert.equal(old.archived, true);
  assert.ok(s.calls.some((c) => c.path === '/api/rankings/archived'));

  await s.backend.leaderboard({ month: '2026-10', teamId: '10' });
  assert.equal(s.calls.at(-1).search, '?scope=team&year=2026&month=10&teamId=10');
  await s.backend.leaderboard({ campus: 'jenin' });
  assert.equal(s.calls.at(-1).search, '?scope=campus&year=2026&month=10&campusId=1');
});

test('hall (welcome page): team leaders from public rankings, no winner / news without those services', async () => {
  const s = fakeServer();
  const h = await s.backend.hall({ campus: 'jenin' });
  assert.equal(h.campus, 'jenin');
  assert.equal(h.groups.length, 1);
  assert.equal(h.groups[0].teamId, '10');
  assert.deepEqual(h.groups[0].leader, { id: '200', name: 'ليان', photo: null, total: 75 });
  assert.equal(h.winner, null);
  assert.deepEqual(h.news, []);
  assert.equal(h.ratedCount, 3);
  assert.equal(h.memberCount, 3);
  assert.ok(s.calls.filter((c) => c.path.startsWith('/api/rankings')).every((c) => c.auth === undefined), 'public calls carry no token');
});
