// Contract tests: the real-backend layer (httpCore + backend/client) against an in-memory fake
// that follows 02-Backend/docs/api.md (envelope { data }, errors { error: { code, message } },
// numeric ids, campus names, strict body validation like the real validators).
// Run: node --test src/services/backend/backend.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttp, waitForToken } from '../httpCore.js';
import { createBackend } from './client.js';
import { translateServerError } from './errorsAr.js';
import { monthOf, weightedManagerScore } from './adapters.js';

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
    governance: { allowOrganizerMemberEval: false, allowJeninEvalRamallah: false, allowRamallahEvalJenin: false, updatedBy: null, updatedAt: null },
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
    calls.push({ method, path: u.pathname, search: u.search, body, auth: init.headers && init.headers.Authorization, headers: init.headers || {} });
    const p = u.pathname;
    if (p === '/api/auth/complete-registration' && method === 'POST') {
      // Like the real route: the body must stay EMPTY (no ids, email or role).
      if (body && Object.keys(body).length) return fail(400, 'INVALID_REGISTRATION_DATA');
      if (current.role === 'blocked') return fail(403, 'PROJECT_ACCESS_DENIED');
      return ok({ id: current.id, name: current.name, role: current.role, teamId: current.teamId, isActive: true });
    }
    if (p === '/api/auth/me') {
      return ok({
        id: current.id, name: current.name, role: current.role, isActive: true, teamId: current.teamId,
        isSuperAdmin: current.isSuperAdmin === true, campusId: current.campusId ?? null,
        governance: current.role === 'organizer' ? state.governance : null,
      });
    }
    if (p === '/api/governance/settings') {
      if (current.role !== 'organizer') return fail(403, 'FORBIDDEN');
      if (method === 'PATCH') {
        if (current.isSuperAdmin !== true) return fail(403, 'SUPER_ADMIN_REQUIRED');
        const keys = ['allowOrganizerMemberEval', 'allowJeninEvalRamallah', 'allowRamallahEvalJenin'];
        if (Object.keys(body).some((k) => !keys.includes(k) && k !== 'reason')) return fail(400, 'INVALID_GOVERNANCE_DATA');
        Object.assign(state.governance, Object.fromEntries(keys.filter((k) => k in body).map((k) => [k, body[k]])),
          { updatedBy: 'clerk_super', updatedAt: '2026-11-12T10:00:00Z' });
      }
      return ok({ ...state.governance, canEdit: current.isSuperAdmin === true });
    }
    if (p === '/api/campuses') return ok(state.campuses);
    if (p === '/api/points/team-history') {
      if (current.role === 'member') return fail(403, 'FORBIDDEN');
      return ok({
        scope: current.role === 'manager' ? 'team' : 'awarded',
        team: current.role === 'manager' ? { id: 10, name: 'Technical' } : null,
        year: 2026, month: 10,
        totals: { entries: 2, points: 15, awardedByMe: 10, awardedByMeEntries: 1 },
        members: [{ userId: '200', name: 'ليان', total: 15, entries: 2 }],
        entries: [
          { id: '9', userId: '200', userName: 'ليان', points: 10, activityName: 'ورشة', reason: 'حضور', effectiveAt: '2026-10-05T09:00:00Z', actorName: 'بشار', awardedByMe: true, reversesEntryId: null, reversed: false },
          { id: '8', userId: '200', userName: 'ليان', points: 5, activityName: 'مسابقة', reason: 'فوز', effectiveAt: '2026-10-04T09:00:00Z', actorName: 'هبة', awardedByMe: false, reversesEntryId: null, reversed: true },
        ],
        truncated: false,
      });
    }
    if (p === '/api/registrations' && method === 'GET') {
      return ok([
        { id: 7, name: 'سارة', email: 's@gdg.ps', status: 'pending', requestedAt: '2026-11-01T08:00:00Z',
          requestedRole: 'manager', requestedCampusId: 1, requestedCampusName: 'Jenin', requestedTeamId: 10, requestedTeamName: 'Technical' },
        { id: 8, name: 'قديم', email: 'old@gdg.ps', status: 'pending', requestedAt: '2026-10-01T08:00:00Z',
          requestedRole: null, requestedCampusId: null, requestedCampusName: null, requestedTeamId: null, requestedTeamName: null },
      ]);
    }
    if (p === '/api/registrations/request' && method === 'POST') {
      const allowed = ['fullName', 'campusId', 'role', 'teamId'];
      if (Object.keys(body).some((k) => !allowed.includes(k))) return fail(400, 'INVALID_REGISTRATION_REQUEST');
      if (body.role === 'organizer' && body.teamId != null) return fail(400, 'INVALID_REGISTRATION_REQUEST');
      const c = state.campuses.find((x) => x.id === body.campusId);
      const team = state.teams.find((x) => x.id === body.teamId);
      return ok({ id: 9, name: body.fullName || 'Clerk name', email: 'new@gdg.ps', status: 'pending', requestedAt: '2026-11-12T08:00:00Z',
        requestedRole: body.role, requestedCampusId: body.campusId, requestedCampusName: c ? c.name : null,
        requestedTeamId: body.teamId ?? null, requestedTeamName: team ? team.name : null }, 201);
    }
    if (p === '/api/registrations/count') return ok({ pending: 1 });
    if (/^\/api\/registrations\/\d+\/approve$/.test(p)) return ok({ user: { id: 400, role: body.role }, emailStatus: 'sent' });
    if (/^\/api\/registrations\/\d+\/reject$/.test(p)) return ok({ status: 'rejected', emailStatus: 'sent' });
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
      if (!t) return fail(404, 'TEAM_NOT_FOUND');
      if (method === 'PATCH') {
        // Like the real route: name / managerId (null removes) + a required reason; one manager per team.
        if (Object.keys(body).some((k) => !['name', 'managerId', 'reason'].includes(k)) || !body.reason) return fail(400, 'INVALID_TEAM_DATA');
        if (body.managerId != null && t.managerId != null && body.managerId !== t.managerId) return fail(409, 'TEAM_MANAGER_EXISTS');
        if (body.name !== undefined) t.name = body.name;
        if (body.managerId !== undefined) t.managerId = body.managerId;
        return ok(t);
      }
      return ok(t);
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
      return fail(405, 'MANUAL_CREATION_DISABLED');
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
      const allowed = ['role', 'campusId', 'teamId', 'reason'];
      if (!body || Object.keys(body).some((k) => !allowed.includes(k)) || !body.reason || !body.campusId) return fail(400, 'INVALID_RESTORE_DATA');
      // Team 10 already has a Manager (100): a former manager cannot take that seat back.
      if (body.role === 'manager' && body.teamId === 10) return fail(409, 'RESTORE_TEAM_MANAGER_EXISTS');
      return ok({ id: +m[1], name: 'محذوف', email: 'd@gdg.ps', role: body.role, teamId: body.teamId ?? null, campusId: body.role === 'organizer' ? body.campusId : null, isActive: true, deletedAt: null });
    }
    if (p === '/api/points/me') {
      const q = Object.fromEntries(u.searchParams);
      const id = `${q.year}-${String(q.month).padStart(2, '0')}`;
      return ok(state.points.filter((e) => e.effectiveAt.startsWith(id)));
    }
    if (p === '/api/points/me/summary') {
      return ok(u.searchParams.get('month') === '10'
        ? { total: 610, positive: 620, negative: -10, entryCount: 61, allTimeTotal: 605, rank: 2 }
        : { total: -5, positive: 0, negative: -5, entryCount: 1, allTimeTotal: 605, rank: 4 });
    }
    if (p === '/api/policies' && method === 'GET') return ok({ maxPointsPerOperation: 50, globalLeaderboardEnabled: true });
    if (p.startsWith('/api/policies/') && method === 'PUT') return ok({ maxPointsPerOperation: body.value, globalLeaderboardEnabled: true });
    if (p === '/api/awards') {
      return ok({ campus: 'jenin', month: '2026-10', months: [], groups: [{ teamId: '10', name: 'Technical', leader: { id: '200', name: 'ليان', photo: null, total: 75 } }], winner: null, winnerActivities: [], stale: false, ratedCount: 1, memberCount: 1, demo: false, news: [] });
    }
    if (p === '/api/rankings/months') return ok(['2026-08', '2026-09']);
    if (p === '/api/rankings/public-summary') {
      return ok({
        campus: { id: 1, name: 'Jenin' },
        month: '2026-10',
        top: [{ rank: 1, name: 'ليان', totalPoints: 75 }],
        teamLeaders: [{ teamId: 10, teamName: 'Technical', leader: { name: 'ليان', totalPoints: 75 } }],
        participants: { rated: 3, total: 3 },
      });
    }
    if (p === '/api/points' && method === 'POST') {
      const allowed = ['userId', 'points', 'activityName', 'reason', 'activityDescription'];
      if (Object.keys(body).some((k) => !allowed.includes(k))) return fail(400, 'INVALID_POINT_DATA');
      if (!Number.isInteger(body.points) || body.points === 0 || Math.abs(body.points) > 100) return fail(400, 'INVALID_POINT_DATA');
      return ok({ id: '9', userId: body.userId, points: body.points, activityName: body.activityName, reason: body.reason, effectiveAt: '2026-10-21T10:00:00Z' }, 201);
    }
    if ((m = p.match(/^\/api\/points\/(\d+)\/reverse$/))) {
      if (Object.keys(body).some((k) => k !== 'reason') || !String(body.reason || '').trim()) return fail(400, 'INVALID_REVERSAL_DATA');
      if (current.role === 'member') return fail(403, 'FORBIDDEN');
      if (m[1] === '8') return fail(409, 'ALREADY_REVERSED');
      if (m[1] === '10') return fail(409, 'CANNOT_REVERSE_REVERSAL');
      if (m[1] === '77') return fail(403, 'FORBIDDEN');
      return ok({ id: '10', userId: 200, performedByUserId: current.id, points: -10, activityName: 'ورشة', reason: body.reason, reversesEntryId: m[1], effectiveAt: '2026-10-05T09:00:00Z' }, 201);
    }
    // ---- Phase 2 (Phase-2 API handoff): public rankings, audit, manager evaluations
    if (p === '/api/rankings/options') {
      return ok({ campuses: [{ id: 1, name: 'Jenin' }, { id: 2, name: 'Ramallah' }], teams: [{ id: 10, campusId: 1, name: 'Technical' }] });
    }
    if (p === '/api/rankings' || p === '/api/rankings/archived') {
      const q = Object.fromEntries(u.searchParams);
      const allowed = ['scope', 'year', 'month', 'teamId', 'campusId'];
      const bad = Object.keys(q).some((k) => !allowed.includes(k))
        || !['team', 'campus', 'all'].includes(q.scope)
        || !/^\d{4}$/.test(q.year || '') || !(+q.month >= 1 && +q.month <= 12)
        || (q.scope === 'team' && (!q.teamId || q.campusId))
        || (q.scope === 'campus' && (!q.campusId || q.teamId))
        || (q.scope === 'all' && (q.campusId || q.teamId));
      if (bad) return fail(400, 'INVALID_RANKING_QUERY');
      if (q.scope === 'all') {
        return ok([
          { rank: 1, userId: 200, fullName: 'ليان', totalPoints: 75, campusId: 1, campusName: 'Jenin' },
          { rank: 1, userId: 300, fullName: 'رامي', totalPoints: 75, campusId: 2, campusName: 'Ramallah' },
          { rank: 2, userId: 201, fullName: 'عمر', totalPoints: 45, campusId: 1, campusName: 'Jenin' },
        ]);
      }
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

test('registrations: list, count, approve with campus/team ids, reject with optional reason', async () => {
  const s = fakeServer();
  const [first] = await s.backend.registrations();
  assert.deepEqual([first.id, first.name, first.email, first.requestedAt], ['7', 'سارة', 's@gdg.ps', '2026-11-01T08:00:00Z']);
  assert.equal(await s.backend.pendingRegistrationCount(), 1);

  await s.backend.approveRegistration('7', { role: 'member', campus: 'ramallah', teamId: '11' });
  assert.deepEqual(s.calls.at(-1).body, { role: 'member', campusId: 2, teamId: 11 });
  assert.equal(s.calls.at(-1).path, '/api/registrations/7/approve');
  await s.backend.approveRegistration('7', { role: 'organizer', campus: 'jenin', teamId: '10' });
  assert.deepEqual(s.calls.at(-1).body, { role: 'organizer', campusId: 1 }, 'an organizer never carries a team; its campus is its evaluation scope');
  await s.backend.approveRegistration('7', { role: 'organizer' });
  assert.deepEqual(s.calls.at(-1).body, { role: 'organizer' }, 'the campus stays optional');
  await assert.rejects(() => s.backend.approveRegistration('7', { role: 'manager', campus: 'jenin', teamId: '' }), (e) => e.status === 400);

  await s.backend.rejectRegistration('7', '  ');
  assert.deepEqual(s.calls.at(-1).body, {});
  await s.backend.rejectRegistration('7', ' ليس عضوًا ');
  assert.deepEqual(s.calls.at(-1).body, { reason: 'ليس عضوًا' });
});

test('users: update sends only changes + reason', async () => {
  const s = fakeServer();
  await s.backend.updateUser('200', { name: 'ليان أبو سعدة', email: 'u@gdg.ps', role: 'member', teams: ['10'] });
  const patch = s.calls.find((c) => c.method === 'PATCH');
  assert.deepEqual(Object.keys(patch.body).sort(), ['name', 'reason']);

  s.calls.length = 0;
  const same = await s.backend.updateUser('200', { name: 'ليان', email: 'U@gdg.ps', role: 'member', teams: ['10'] });
  assert.equal(s.calls.some((c) => c.method === 'PATCH'), false, 'no change -> no request');
  assert.equal(same.id, '200');
});

test('users: demoting an organizer sends the new role, the team and a reason', async () => {
  const s = fakeServer();
  await s.backend.updateUser('1', { name: 'هبة', email: 'org@gdg.ps', role: 'member', teams: ['10'] });
  const patch = s.calls.find((c) => c.method === 'PATCH' && c.path === '/api/users/1');
  assert.deepEqual(patch.body, { role: 'member', teamId: 10, reason: 'تعديل بيانات من لوحة المنظّم' });
  const { message } = translateServerError(409, { error: { code: 'SELF_LOCKOUT', message: 'x' } });
  assert.match(message, /بنفسك/);
  assert.match(translateServerError(409, { error: { code: 'LAST_ACTIVE_ORGANIZER' } }).message, /آخر منظّم/);
});

test('users: status toggle, delete with reason, restore comes back active with its new assignment', async () => {
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

  const r = await s.backend.restoreUser('300', { role: 'member', campus: 'jenin', teamId: '10', reason: 'عودة' });
  assert.equal(r.status, 'active');
  assert.deepEqual([r.role, r.teams], ['member', ['10']]);
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

  await assert.rejects(() => s.backend.toggleTeam('11'), (e) => e.status === 409 && /مديرًا فعّالًا/.test(e.message));
  const off = await s.backend.toggleTeam('10');
  assert.equal(off.status, 'disabled');
  assert.deepEqual((await s.backend.listCampusManagers('jenin')).map((m) => m.id), ['100']);
});

test('teams: edit sends only the changes + reason; one manager per team; Arabic conflict message', async () => {
  const s = fakeServer();
  const same = await s.backend.saveTeam({ id: '10', name: 'Technical', campus: 'jenin', managerIds: ['100'] });
  assert.equal(same.name, 'Technical');
  assert.equal(s.calls.some((c) => c.method === 'PATCH'), false, 'no change -> no request');

  const set = await s.backend.saveTeam({ id: '11', name: 'PR Team', campus: 'ramallah', managerIds: ['100'] });
  const sent = s.calls.find((c) => c.method === 'PATCH' && c.path === '/api/teams/11');
  assert.deepEqual(sent.body, { name: 'PR Team', managerId: 100, reason: 'تعديل فريق من لوحة المنظّم' });
  assert.equal(set.managerId, '100');

  await assert.rejects(
    () => s.backend.saveTeam({ id: '10', name: 'Technical', campus: 'jenin', managerIds: ['201'] }),
    (e) => e.status === 409 && e.details.code === 'TEAM_MANAGER_EXISTS' && /مدير واحد فقط/.test(e.message),
  );
  await assert.rejects(() => s.backend.saveTeam({ id: '11', name: 'PR', managerIds: ['1', '100'] }), (e) => e.status === 400);

  await s.backend.saveTeam({ id: '11', name: 'PR Team', campus: 'ramallah', managerIds: [] });
  assert.deepEqual(s.calls.filter((c) => c.method === 'PATCH').at(-1).body, { managerId: null, reason: 'تعديل فريق من لوحة المنظّم' });
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
  assert.equal(mine.total, 610, 'the total comes from the SQL summary, not the listed rows');
  assert.equal(mine.entries.length, 1);
  assert.equal(mine.rank, 2);
  assert.equal((await s.backend.myPoints('2026-09')).negative, -5);
});

test('meta lists closed months before the open month; months follow Asia/Hebron', async () => {
  const s = fakeServer();
  const meta = await s.backend.meta();
  assert.deepEqual(meta.months.map((m) => [m.id, m.status]), [['2026-08', 'archived'], ['2026-09', 'archived'], ['2026-10', 'open']]);
  assert.equal(monthOf('2026-09-30T21:30:00Z'), '2026-10', '00:30 on 1 October in Hebron');
});

test('points: assignable members — organizer sees active members and managers, manager only own team', async () => {
  const org = fakeServer();
  assert.deepEqual((await org.backend.assignableMembers()).map((m) => m.id), ['100', '200']);
  const mgr = fakeServer({ me: { id: 100, name: 'بشار', role: 'manager', teamId: 10 } });
  assert.deepEqual((await mgr.backend.assignableMembers()).map((m) => m.id), ['200']);
  assert.ok(mgr.calls.some((c) => c.path === '/api/teams/10/members'));
  const mem = fakeServer({ me: { id: 200, name: 'ليان', role: 'member', teamId: 10 } });
  assert.deepEqual(await mem.backend.assignableMembers(), []);
});

test('policies are read from and saved to the backend', async () => {
  const s = fakeServer();
  assert.equal((await s.backend.policies()).maxPointsPerOperation, 50);
  assert.equal((await s.backend.setPolicy('maxPointsPerOperation', 40)).maxPointsPerOperation, 40);
  assert.deepEqual(s.calls.at(-1).body, { value: 40 });
  assert.equal(s.calls.at(-1).path, '/api/policies/maxPointsPerOperation');
});

/* ------------------------------------------------- Phase 2: rankings / audit / evaluations */

test('rankings: public (no token), strict query, dense rank ties, archived path', async () => {
  const s = fakeServer();
  const opts = await s.backend.rankingOptions();
  assert.deepEqual(opts.campuses, [{ id: '1', key: 'jenin', name: 'Jenin' }, { id: '2', key: 'ramallah', name: 'Ramallah' }]);
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

test('leaderboard: both campuses together for every role, with each person\'s campus', async () => {
  const s = fakeServer({ me: { id: 200, name: 'ليان', role: 'member', teamId: 10 } });
  const both = await s.backend.leaderboard({ month: '2026-10', campus: 'all' });
  assert.equal(s.calls.at(-1).search, '?scope=all&year=2026&month=10', 'one combined request, no IDs');
  assert.deepEqual(both.rows.map((r) => [r.rank, r.name, r.campus, r.tie]),
    [[1, 'ليان', 'jenin', true], [1, 'رامي', 'ramallah', true], [2, 'عمر', 'jenin', false]], 'dense: 1, 1, 2');
  assert.equal(both.rows[0].isMe, true);
  const old = await s.backend.leaderboard({ month: '2026-09', campus: 'all' });
  assert.equal(old.archived, true);
  assert.equal(s.calls.at(-1).path, '/api/rankings/archived');
  await assert.rejects(() => s.backend.rankings({ scope: 'world', month: '2026-10' }), (e) => e.status === 400);
});

test('leaderboard: one campus per board when a campus is chosen, backend DENSE_RANK passed through', async () => {
  const s = fakeServer({ me: { id: 200, name: 'ليان', role: 'member', teamId: 10 } });
  await s.backend.leaderboard({ month: '2026-10', campus: 'ramallah' });
  const boards = s.calls.filter((c) => c.path === '/api/rankings');
  assert.equal(boards.length, 1, 'exactly one ranking request per board');
  assert.equal(boards[0].search, '?scope=campus&year=2026&month=10&campusId=2');
  const dflt = await s.backend.leaderboard({ month: '2026-10', global: true });
  assert.equal(s.calls.filter((c) => c.path === '/api/rankings').length, 2, 'a "global" flag is ignored');
  assert.equal(s.calls.at(-1).search, '?scope=campus&year=2026&month=10&campusId=1');
  assert.deepEqual(dflt.rows.map((r) => r.rank), [1, 2, 2], 'dense ranks (1, 2, 2), never 1, 2, 2 -> 4');
});

test('leaderboard (page shape): public rankings by points, current vs archived month, isMe', async () => {
  const s = fakeServer({ me: { id: 200, name: 'ليان', role: 'member', teamId: 10 } });
  const cur = await s.backend.leaderboard({ month: '2026-10', campus: 'jenin' });
  assert.equal(cur.archived, false);
  assert.equal(cur.month, '2026-10');
  assert.ok(s.calls.some((c) => c.path === '/api/rankings'));
  assert.deepEqual(cur.rows.map((r) => [r.rank, r.userId, r.total, r.tie, r.isMe]), [[1, '200', 75, false, true], [2, '201', 45, true, false], [2, '202', 45, true, false]]);
  assert.equal(cur.rows[0].campus, 'jenin');
  assert.equal(cur.rows[0].kind, 'points');

  const old = await s.backend.leaderboard({ month: '2026-09', campus: 'jenin' });
  assert.equal(old.archived, true);
  assert.ok(s.calls.some((c) => c.path === '/api/rankings/archived'));

  await s.backend.leaderboard({ month: '2026-10', teamId: '10' });
  assert.equal(s.calls.at(-1).search, '?scope=team&year=2026&month=10&teamId=10');
  await s.backend.leaderboard({ campus: 'jenin' });
  assert.equal(s.calls.at(-1).search, '?scope=campus&year=2026&month=10&campusId=1');
});

test('hall: signed-in users get selectable leader IDs from /awards', async () => {
  const s = fakeServer();
  const h = await s.backend.hall({ campus: 'jenin', signedIn: true });
  assert.equal(h.groups[0].leader.id, '200');
  assert.match(s.calls.at(-1).auth, /^Bearer .+/);
});

test('full rankings send the signed-in token', async () => {
  const s = fakeServer();
  await s.backend.rankings({ scope: 'campus', campusId: '1', month: '2026-10' });
  assert.match(s.calls.at(-1).auth, /^Bearer .+/);
});

test('hall (welcome page): team leaders from the public summary, no winner / news without those services', async () => {
  const s = fakeServer();
  const h = await s.backend.hall({ campus: 'jenin' });
  assert.equal(h.campus, 'jenin');
  assert.equal(h.groups.length, 1);
  assert.equal(h.groups[0].teamId, '10');
  assert.deepEqual(h.groups[0].leader, { id: null, name: 'ليان', photo: null, total: 75 });
  assert.equal(h.winner, null);
  assert.deepEqual(h.news, []);
  assert.equal(h.ratedCount, 3);
  assert.equal(h.memberCount, 3);
  assert.ok(s.calls.filter((c) => c.path.startsWith('/api/rankings')).every((c) => c.auth === undefined), 'public calls carry no token');
});

test('auth: completeRegistration posts an EMPTY body with the Bearer token and maps the linked account', async () => {
  const s = fakeServer({ me: { id: 200, name: 'ليان', role: 'member', teamId: 10 } });
  const u = await s.backend.completeRegistration();
  assert.deepEqual(u, { id: '200', name: 'ليان', role: 'member', teamId: 10, isActive: true });
  const call = s.calls.find((c) => c.path === '/api/auth/complete-registration');
  assert.equal(call.method, 'POST');
  assert.deepEqual(call.body, {});
  assert.match(call.auth, /^Bearer .+/);
});

test('auth: completeRegistration surfaces a not-invited account as an Arabic error', async () => {
  const s = fakeServer({ me: { id: 9, name: 'x', role: 'blocked', teamId: null } });
  await assert.rejects(() => s.backend.completeRegistration(), (e) => e.status === 403 && e.message === 'حسابك غير فعّال أو غير مرتبط بدعوة مقبولة.');
});

test('evaluations: weighted score follows the backend rounding ([85,80,90,75] -> 83)', () => {
  assert.equal(weightedManagerScore([85, 80, 90, 75]), 83);
  assert.equal(weightedManagerScore([100, 100, 100, 100]), 100);
  assert.equal(weightedManagerScore([0, 0, 0, 0]), 0);
});

test('evaluations: managerEvaluations lists active managers with their monthly average; one failure does not break the list', async () => {
  const s = fakeServer();
  const res = await s.backend.managerEvaluations('2026-10');
  assert.equal(res.month, '2026-10');
  assert.equal(res.criteria.length, 4);
  assert.deepEqual(res.rows.map((r) => r.id), ['100']);
  assert.equal(res.rows[0].name, 'بشار');
  assert.equal(typeof res.rows[0].count, 'number');
  const avg = s.calls.find((c) => c.path === '/api/evaluations/managers/100/average');
  assert.ok(avg && /year=2026/.test(avg.search) && /month=10/.test(avg.search));
});

test('governance: me() exposes isSuperAdmin, the organizer campus and the flags', async () => {
  const sa = fakeServer({ me: { id: 9, name: 'سارة', role: 'organizer', teamId: null, isSuperAdmin: true, campusId: null } });
  const me = await sa.backend.me();
  assert.equal(me.isSuperAdmin, true);
  assert.deepEqual(me.governance, { allowOrganizerMemberEval: false, allowJeninEvalRamallah: false, allowRamallahEvalJenin: false, canEdit: false, updatedAt: null });
  const org = fakeServer({ me: { id: 1, name: 'هبة', role: 'organizer', teamId: null, campusId: 2 } });
  const hiba = await org.backend.me();
  assert.equal(hiba.isSuperAdmin, false);
  assert.equal(hiba.campus, 'ramallah', "an organizer's own campus");
  const manager = await fakeServer({ me: { id: 100, name: 'بشار', role: 'manager', teamId: 10 } }).backend.me();
  assert.equal(manager.isSuperAdmin, false);
  assert.equal(manager.governance, null);
});

test('governance: a Super Admin toggles a flag; a regular organizer gets a clear Arabic refusal', async () => {
  const sa = fakeServer({ me: { id: 9, name: 'سارة', role: 'organizer', teamId: null, isSuperAdmin: true } });
  const g = await sa.backend.setGovernance({ allowOrganizerMemberEval: true, ignored: 'x' }, '  طوارئ ');
  const call = sa.calls.at(-1);
  assert.equal(call.method, 'PATCH');
  assert.equal(call.path, '/api/governance/settings');
  assert.deepEqual(call.body, { allowOrganizerMemberEval: true, reason: 'طوارئ' }, 'only known boolean flags are sent');
  assert.equal(g.allowOrganizerMemberEval, true);
  assert.equal(g.canEdit, true);
  assert.equal((await sa.backend.governance()).allowOrganizerMemberEval, true);
  await assert.rejects(() => sa.backend.setGovernance({}), (e) => e.status === 400);

  const org = fakeServer({ me: { id: 1, name: 'هبة', role: 'organizer', teamId: null } });
  assert.equal((await org.backend.governance()).canEdit, false);
  await assert.rejects(() => org.backend.setGovernance({ allowJeninEvalRamallah: true }),
    (e) => e.status === 403 && e.message === 'هذا الإجراء متاح للمشرف العام فقط.');
});

test('governance: users carry the Super Admin flag and organizer campus; an organizer campus edit sends campusId', async () => {
  const s = fakeServer({ me: { id: 9, name: 'سارة', role: 'organizer', teamId: null, isSuperAdmin: true } });
  s.state.users.push(
    { id: 9, name: 'سارة', email: 'sa@gdg.ps', role: 'organizer', teamId: null, isActive: true, deletedAt: null, isSuperAdmin: true, campusId: null },
    { id: 2, name: 'رامي', email: 'r@gdg.ps', role: 'organizer', teamId: null, isActive: true, deletedAt: null, isSuperAdmin: false, campusId: 2 },
  );
  const organizers = await s.backend.listUsers({ role: 'organizer' });
  assert.deepEqual(organizers.map((u) => [u.id, u.campus, u.isSuperAdmin]), [['1', '', false], ['9', '', true], ['2', 'ramallah', false]]);
  await s.backend.updateUser('2', { name: 'رامي', email: 'r@gdg.ps', role: 'organizer', campus: 'jenin', teams: [] });
  assert.deepEqual(s.calls.at(-1).body.campusId, 1);
  await s.backend.updateUser('2', { name: 'رامي', email: 'r@gdg.ps', role: 'organizer', campus: 'ramallah', teams: [] });
  assert.equal(s.calls.filter((c) => c.method === 'PATCH').length, 1, 'unchanged campus: no request');
});

test('governance: evaluation targets follow the flags, the campus and the Super Admin override', async () => {
  const s = fakeServer({ me: { id: 1, name: 'هبة', role: 'organizer', teamId: null, campusId: 1 } });
  s.state.users.push(
    { id: 101, name: 'مدير رام الله', email: 'mr@gdg.ps', role: 'manager', teamId: 11, isActive: true, deletedAt: null },
    { id: 2, name: 'رامي', email: 'r@gdg.ps', role: 'organizer', teamId: null, isActive: true, deletedAt: null, campusId: 1 },
  );
  const hiba = { id: '1', role: 'organizer', campus: 'jenin', isSuperAdmin: false };
  const ids = async (actor) => (await s.backend.managerEvaluations('2026-10', actor)).rows.map((r) => r.id).sort();
  assert.deepEqual(await ids(hiba), ['100'], 'default: own-campus managers only, never organizers');
  s.state.governance.allowOrganizerMemberEval = true;
  assert.deepEqual(await ids(hiba), ['100', '200'], 'active members of the campus too');
  s.state.governance.allowJeninEvalRamallah = true;
  assert.deepEqual(await ids(hiba), ['100', '101', '200'], 'Jenin -> Ramallah delegated');
  s.state.governance.allowOrganizerMemberEval = false;
  s.state.governance.allowJeninEvalRamallah = false;
  assert.deepEqual(await ids({ id: '9', role: 'organizer', campus: '', isSuperAdmin: true }), ['100', '101', '200'], 'Super Admin: both campuses');
  assert.deepEqual(await ids({ id: '3', role: 'organizer', campus: '', isSuperAdmin: false }), [], 'no campus yet: nobody');
});

test('registration: the sign-up form reads public options and sends name, role, campus id and team', async () => {
  const s = fakeServer();
  const opts = await s.backend.registrationOptions();
  assert.equal(s.calls.at(-1).path, '/api/rankings/options');
  assert.equal(s.calls.at(-1).auth, undefined, 'public: the person has no account yet');
  assert.deepEqual(opts.campuses.map((c) => c.key), ['jenin', 'ramallah']);
  assert.deepEqual(opts.teams, [{ id: '10', name: 'Technical', campus: 'jenin' }]);

  const r = await s.backend.submitRegistrationRequest({ fullName: '  ليلى سالم ', role: 'member', campus: 'jenin', teamId: '10' });
  const sent = s.calls.at(-1);
  assert.equal(sent.method, 'POST');
  assert.equal(sent.path, '/api/registrations/request');
  assert.deepEqual(sent.body, { role: 'member', campusId: 1, fullName: 'ليلى سالم', teamId: 10 }, 'never an email: it comes from Clerk');
  assert.deepEqual([r.status, r.requestedRole, r.requestedCampus, r.requestedTeamName], ['pending', 'member', 'jenin', 'Technical']);

  await s.backend.submitRegistrationRequest({ fullName: 'منظّم', role: 'organizer', campus: 'ramallah', teamId: '10' });
  assert.deepEqual(s.calls.at(-1).body, { role: 'organizer', campusId: 2, fullName: 'منظّم' }, 'an organizer request carries no team');
  const before = s.calls.length;
  await assert.rejects(() => s.backend.submitRegistrationRequest({ role: 'member', campus: '' }), (e) => e.status === 400 && /الحرم/.test(e.message));
  await assert.rejects(() => s.backend.submitRegistrationRequest({ role: 'admin', campus: 'jenin' }), (e) => e.status === 400);
  assert.equal(s.calls.filter((c) => c.path === '/api/registrations/request').length, 2);
  assert.ok(s.calls.length - before <= 1, 'invalid forms never reach the server');
});

test('registration: pending requests show what was asked; me() carries the scoped pending count', async () => {
  const s = fakeServer();
  const list = await s.backend.registrations();
  assert.deepEqual(list.map((r) => [r.id, r.requestedRole, r.requestedCampus, r.requestedTeamId, r.requestedTeamName]),
    [['7', 'manager', 'jenin', '10', 'Technical'], ['8', null, '', '', '']]);
  assert.equal((await s.backend.me()).pendingRegistrationsCount, null, 'the fake /auth/me sends none');
});

test('users: no manual creation; Restore & Assign sends the confirmed role, campus id and team', async () => {
  const s = fakeServer({ me: { id: 9, name: 'سارة', role: 'organizer', teamId: null, isSuperAdmin: true } });
  assert.equal(s.backend.createUser, undefined, 'accounts come only from approved registration requests');
  const sent = await s.http.post('/users', { name: 'x', email: 'x@gdg.ps', role: 'member', teamId: 10 }).catch((e) => e);
  assert.equal(sent.status, 405);
  assert.match(sent.message, /إنشاء الحسابات يدويًا غير متاح/);

  const r = await s.backend.restoreUser('300', { role: 'member', campus: 'jenin', teamId: '10', reason: '  عاد بعد إجازة ' });
  assert.deepEqual(s.calls.at(-1).body, { role: 'member', campusId: 1, reason: 'عاد بعد إجازة', teamId: 10 });
  assert.equal(r.status, 'active', 'restored accounts come back active');
  await s.backend.restoreUser('300', { role: 'organizer', campus: 'ramallah', teamId: '10', reason: 'عودة' });
  assert.deepEqual(s.calls.at(-1).body, { role: 'organizer', campusId: 2, reason: 'عودة' }, 'an organizer gets no team');
  const before = s.calls.filter((c) => c.path.endsWith('/restore')).length;
  await assert.rejects(() => s.backend.restoreUser('300', { role: 'member', campus: 'jenin', reason: 'x' }), (e) => e.status === 400 && /اختر الفريق/.test(e.message));
  await assert.rejects(() => s.backend.restoreUser('300', { role: 'member', campus: '', teamId: '10' }), (e) => e.status === 400 && /الحرم/.test(e.message));
  await assert.rejects(() => s.backend.restoreUser('300', {}), (e) => e.status === 400 && /الدور/.test(e.message));
  assert.equal(s.calls.filter((c) => c.path.endsWith('/restore')).length, before, 'invalid choices never reach the server');

  await assert.rejects(() => s.backend.restoreUser('301', { role: 'manager', campus: 'jenin', teamId: '10', reason: 'x' }),
    (e) => e.status === 409 && e.message === 'هذا الفريق لديه مدير معيّن حالياً؛ اختر فريقاً آخر أو أعده كعضو');
});

test('registration and hierarchy refusals are explained in Arabic', () => {
  for (const [code, pattern] of [
    ['REGISTRATION_REQUIRED', /طلب انضمام/],
    ['REGISTRATION_OUT_OF_SCOPE', /خارج صلاحياتك/],
    ['CROSS_CAMPUS_APPROVAL_RESTRICTED', /حرم آخر/],
    ['OUT_OF_CAMPUS_SCOPE', /في حرمه فقط/],
    ['EMAIL_NOT_VERIFIED', /أكّد بريدك/],
    ['EMAIL_ALREADY_REQUESTED', /طلب انضمام معلّق/],
  ]) {
    assert.match(translateServerError(403, { error: { code, message: 'x' } }).message, pattern, code);
  }
});

test('governance: refusals from the server are explained in Arabic', () => {
  for (const [code, pattern] of [
    ['ORGANIZER_MANAGEMENT_RESTRICTED', /للمشرف العام فقط/],
    ['SUPER_ADMIN_PROTECTED', /محمي/],
    ['EVALUATION_TARGET_ORGANIZER', /لا يمكن تقييم المنظّمين/],
    ['ORGANIZER_MEMBER_EVAL_DISABLED', /المديرين فقط/],
    ['CROSS_CAMPUS_EVAL_DISABLED', /بين الحرمين/],
    ['ORGANIZER_CAMPUS_REQUIRED', /لم يُحدَّد حرم/],
  ]) {
    assert.match(translateServerError(403, { error: { code, message: 'x' } }).message, pattern, code);
  }
});

test('points: a manager reads the team points log (entries, totals, who added each one)', async () => {
  const s = fakeServer({ me: { id: 100, name: 'بشار', role: 'manager', teamId: 10 } });
  const h = await s.backend.teamPointsHistory();
  assert.equal(s.calls.at(-1).path, '/api/points/team-history');
  assert.equal(s.calls.at(-1).search, '?limit=200', 'no month = the current month on the server');
  assert.equal(h.scope, 'team');
  assert.deepEqual(h.team, { id: '10', name: 'Technical' });
  assert.equal(h.month, '2026-10');
  assert.deepEqual(h.totals, { entries: 2, points: 15, awardedByMe: 10, awardedByMeEntries: 1 });
  assert.deepEqual(h.members, [{ userId: '200', name: 'ليان', total: 15, entries: 2 }]);
  assert.deepEqual(h.entries.map((e) => [e.id, e.value, e.activity, e.reason, e.awardedByMe, e.reversed]),
    [['9', 10, 'ورشة', 'حضور', true, false], ['8', 5, 'مسابقة', 'فوز', false, true]]);
  await s.backend.teamPointsHistory('2026-09');
  assert.equal(s.calls.at(-1).search, '?year=2026&month=9&limit=200');
  await assert.rejects(() => s.backend.teamPointsHistory('bad'), (e) => e.status === 400);
  const member = fakeServer({ me: { id: 200, name: 'ليان', role: 'member', teamId: 10 } });
  await assert.rejects(() => member.backend.teamPointsHistory(), (e) => e.status === 403);
});

test('points: reversePoint posts { reason } to /points/:id/reverse and maps the reversal entry', async () => {
  const s = fakeServer({ me: { id: 100, name: 'بشار', role: 'manager', teamId: 10 } });
  const res = await s.backend.reversePoint('9', '  أُضيفت بالخطأ ');
  const call = s.calls.at(-1);
  assert.equal(call.method, 'POST');
  assert.equal(call.path, '/api/points/9/reverse');
  assert.deepEqual(call.body, { reason: 'أُضيفت بالخطأ' }, 'only the trimmed reason is sent');
  assert.equal(res.ok, true);
  assert.equal(res.entry.id, '10');
  assert.equal(res.entry.reverses, '9');
  assert.equal(res.entry.value, -10);

  const before = s.calls.length;
  await assert.rejects(() => s.backend.reversePoint('9', '   '), (e) => e.status === 400 && /سبب العكس إلزامي/.test(e.message));
  await assert.rejects(() => s.backend.reversePoint('9', 'x'.repeat(501)), (e) => e.status === 400 && /طويل جدًا/.test(e.message));
  await assert.rejects(() => s.backend.reversePoint('9x', 'سبب'), (e) => e.status === 400);
  assert.equal(s.calls.length, before, 'invalid input never reaches the server');
});

test('points: reversal refusals come back as clear Arabic messages', async () => {
  const s = fakeServer({ me: { id: 100, name: 'بشار', role: 'manager', teamId: 10 } });
  await assert.rejects(() => s.backend.reversePoint('8', 'سبب'), (e) => e.status === 409 && e.message === 'هذه العملية معكوسة مسبقًا.');
  await assert.rejects(() => s.backend.reversePoint('10', 'سبب'), (e) => e.status === 409 && e.message === 'لا يمكن عكس عملية عكسية.');
  await assert.rejects(() => s.backend.reversePoint('77', 'سبب'), (e) => e.status === 403 && e.message === 'ليس لديك صلاحية لهذه العملية.');
  const member = fakeServer({ me: { id: 200, name: 'ليان', role: 'member', teamId: 10 } });
  await assert.rejects(() => member.backend.reversePoint('9', 'سبب'), (e) => e.status === 403);
});

test('assistant: an unavailable assistant explains why, in Arabic', () => {
  const quota = translateServerError(503, { error: { code: 'ASSISTANT_UNAVAILABLE', reason: 'AI_QUOTA_EXCEEDED', message: 'x' } });
  assert.match(quota.message, /حد الاستخدام اليومي/);
  assert.match(quota.message, /نقاط فريقك/, 'tells the user what still works');
  assert.equal(quota.details.reason, 'AI_QUOTA_EXCEEDED');
  const busy = translateServerError(503, { error: { code: 'ASSISTANT_UNAVAILABLE', reason: 'AI_UNAVAILABLE' } });
  assert.match(busy.message, /مشغولة/);
  const unknown = translateServerError(503, { error: { code: 'ASSISTANT_UNAVAILABLE', reason: 'SOMETHING_NEW' } });
  assert.match(unknown.message, /المساعد غير متاح مؤقتًا/);
  assert.match(translateServerError(504, { error: { code: 'ASSISTANT_TIMEOUT' } }).message, /وقتًا طويلًا/);
});

test('points: every submission carries an Idempotency-Key (a retry reuses the given key)', async () => {
  const s = fakeServer();
  await s.backend.addPoints({ userId: '200', value: 5, reason: 'ورشة' });
  await s.backend.addPoints({ userId: '200', value: 5, reason: 'ورشة' });
  const keys = s.calls.filter((c) => c.method === 'POST' && c.path === '/api/points').map((c) => c.headers['Idempotency-Key']);
  assert.equal(keys.length, 2);
  assert.ok(keys.every((k) => /^[A-Za-z0-9._:-]{1,100}$/.test(k)));
  assert.notEqual(keys[0], keys[1], 'two deliberate submissions get two keys');
  await s.backend.addPoints({ userId: '200', value: 5, reason: 'ورشة', idempotencyKey: 'retry-1' });
  assert.equal(s.calls.at(-1).headers['Idempotency-Key'], 'retry-1');
});

test('Arabic messages for duplicate points and closed-month corrections', () => {
  for (const code of ['DUPLICATE_POINT_SUBMISSION', 'IDEMPOTENCY_KEY_REUSED', 'CORRECTION_REASON_REQUIRED', 'MONTH_NOT_CLOSED', 'NO_TEAM_IN_MONTH']) {
    const { message } = translateServerError(409, { error: { code, message: 'English' } });
    assert.match(message, /[؀-ۿ]/, code);
  }
});

test('points: addPoints uses the typed activity name, and falls back to the reason', async () => {
  const s = fakeServer();
  await s.backend.addPoints({ userId: '200', value: 15, reason: 'حضور وتفاعل', activity: 'ورشة React' });
  const a = s.calls.filter((c) => c.path === '/api/points' && c.method === 'POST').pop();
  assert.deepEqual(a.body, { userId: 200, points: 15, activityName: 'ورشة React', reason: 'حضور وتفاعل' });
  await s.backend.addPoints({ userId: '200', value: -5, reason: 'تأخر' });
  const b = s.calls.filter((c) => c.path === '/api/points' && c.method === 'POST').pop();
  assert.equal(b.body.activityName, 'تأخر');
});

test('waitForToken waits for a late Clerk token and gives up cleanly', async () => {
  let calls = 0;
  assert.equal(await waitForToken(async () => (++calls < 3 ? null : 'tok'), { delayMs: 1 }), 'tok');
  assert.equal(calls, 3);
  assert.equal(await waitForToken(async () => null, { attempts: 2, delayMs: 1 }), null);
});

test('a missing project account does not open the session-expired dialog', async () => {
  for (const [code, expected] of [['USER_NOT_FOUND_IN_DB', 0], ['UNAUTHENTICATED', 1]]) {
    let opened = 0;
    const http = createHttp({
      baseUrl: 'http://api.test/api',
      getToken: async () => 'tok',
      onUnauthorized: () => { opened += 1; },
      fetchImpl: async () => new Response(JSON.stringify({ error: { code, message: 'x' } }), { status: 401 }),
    });
    await assert.rejects(() => http.get('/auth/me'), (e) => e.status === 401);
    assert.equal(opened, expected, code);
  }
});
