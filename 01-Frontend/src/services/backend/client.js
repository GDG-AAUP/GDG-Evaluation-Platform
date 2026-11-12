// Real-backend operations used by services/* when VITE_USE_MOCK=false.
// Each function returns exactly the shape the corresponding mock function returns,
// so pages do not change. The HTTP client is injected (see httpCore.js) for testing.
//
// Anything the backend cannot do yet throws ApiError(501, <Arabic sentence>, {code:'NOT_SUPPORTED_BY_BACKEND'}).
// See docs/BACKEND_INTEGRATION.md for the full mapping table.

import { DEFAULT_POLICIES, teamLabel } from '../../lib/constants.js';
import { ApiError } from '../errors.js';
import {
  AUDIT_ACTION_CODE, AUDIT_ENTITY_CODE, MANAGER_CRITERIA, campusKey, mapAuditEntry, mapPointEntry,
  mapRankingRows, mapTeam, mapUser, monthOf, splitMonth,
} from './adapters.js';

// Reasons the UI does not collect today but the backend requires (audit log).
export const DEFAULT_REASONS = {
  update: 'تعديل بيانات من لوحة المنظّم',
  restore: 'استرجاع حساب من لوحة المنظّم',
  delete: 'حذف حساب من لوحة المنظّم',
  team: 'تعديل فريق من لوحة المنظّم',
};

const newIdempotencyKey = () => (globalThis.crypto && globalThis.crypto.randomUUID
  ? globalThis.crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export function createBackend(http, { now = () => new Date() } = {}) {
  const userId = (id) => {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, 'معرّف غير صالح.');
    return n;
  };
  const entryId = (id) => {
    if (!/^\d+$/.test(String(id))) throw new ApiError(400, 'معرّف العملية غير صالح.');
    return String(id);
  };
  const trimmed = (v) => String(v ?? '').trim();

  /** Campuses + teams, shared by almost every mapping. */
  async function directory() {
    const [campuses, rawTeams] = await Promise.all([http.get('/campuses'), http.get('/teams')]);
    const campusName = new Map(campuses.map((c) => [c.id, c.name]));
    const teams = rawTeams.map((t) => mapTeam(t, campusName));
    return { campuses, campusName, teams, teamsById: new Map(teams.map((t) => [t.id, t])) };
  }

  async function activeUsersList() { return http.get('/users'); }

  async function findUser(id) {
    const list = await activeUsersList();
    const cur = list.find((u) => String(u.id) === String(id));
    if (!cur) throw new ApiError(404, 'المستخدم غير موجود.');
    return cur;
  }

  const self = {
    /* ------------------------------------------------------------- auth / meta */
    async me() {
      const [u, dir] = await Promise.all([http.get('/auth/me'), directory()]);
      return mapUser(u, dir.teamsById);
    },

    /**
     * Called once after Clerk accepted an invitation (sign-up/sign-in with the ticket).
     * Sends an EMPTY body: the backend links the Clerk identity to the invited account itself
     * (never send ids, email or role). Returns the linked account ({id,name,role,teamId,isActive}).
     */
    async completeRegistration() {
      const u = await http.post('/auth/complete-registration', {});
      return { id: String(u.id), name: u.name, role: u.role, teamId: u.teamId ?? null, isActive: u.isActive !== false };
    },

    async meta() {
      const [dir, closed] = await Promise.all([directory(), http.get('/rankings/months')]);
      const cur = monthOf(now().toISOString());
      return {
        curMonth: cur,
        months: [...closed.map((id) => ({ id, status: 'archived' })), { id: cur, status: 'open' }],
        teams: dir.teams.map((t) => ({ id: t.id, campus: t.campus, name: t.name, status: t.status })),
        criteria: [],
      };
    },

    async policies() { return { ...DEFAULT_POLICIES, ...(await http.get('/policies')) }; },
    async setPolicy(key, value) { return { ...DEFAULT_POLICIES, ...(await http.put(`/policies/${encodeURIComponent(key)}`, { value })) }; },

    /* ------------------------------------------------------------------- users */
    async listUsers(f = {}) {
      const [list, dir] = await Promise.all([
        http.get(f.deleted ? '/users/deleted' : '/users'),
        directory(),
      ]);
      let us = list.map((u) => mapUser(u, dir.teamsById, f.deleted ? 'deleted' : undefined));
      if (f.role) us = us.filter((u) => u.role === f.role);
      if (f.campus) us = us.filter((u) => u.campus === f.campus);
      if (f.teamId) us = us.filter((u) => u.teams.includes(String(f.teamId)));
      if (f.status && !f.deleted) us = us.filter((u) => u.status === f.status);
      return us;
    },

    /* ----------------------------------------------------------- registrations */
    /** Pending self-registration requests, oldest first (organizer only). */
    async registrations() {
      const list = await http.get('/registrations');
      return list.map((r) => ({ id: String(r.id), name: r.name, email: r.email, requestedAt: r.requestedAt }));
    },
    async pendingRegistrationCount() {
      return (await http.get('/registrations/count')).pending;
    },
    /** role: organizer | manager | member; campus: campus key ('jenin'); teamId: required unless organizer. */
    async approveRegistration(id, { role, campus, teamId }) {
      const body = { role };
      if (role !== 'organizer') {
        if (!campus) throw new ApiError(400, 'اختر الحرم.');
        if (!teamId) throw new ApiError(400, 'اختر الفريق.');
        const { campuses } = await directory();
        const c = campuses.find((x) => campusKey(x.name) === campus);
        if (!c) throw new ApiError(400, 'اختر الحرم.');
        body.campusId = c.id;
        body.teamId = userId(teamId);
      }
      return http.post(`/registrations/${userId(id)}/approve`, body);
    },
    async rejectRegistration(id, reason) {
      const r = trimmed(reason || '');
      return http.post(`/registrations/${userId(id)}/reject`, r ? { reason: r } : {});
    },

    /** Sends only the fields that actually changed (the backend rejects an empty change). */
    async updateUser(id, b) {
      userId(id);
      const [cur, dir] = await Promise.all([findUser(id), directory()]);
      const body = {};
      if (b.name !== undefined && trimmed(b.name) !== cur.name) body.name = trimmed(b.name);
      if (b.email !== undefined && trimmed(b.email).toLowerCase() !== String(cur.email || '').toLowerCase()) {
        body.email = trimmed(b.email);
      }
      if (b.role !== undefined && b.role !== cur.role) body.role = b.role;
      const wantRole = body.role || cur.role;
      let wantTeam;
      if (wantRole === 'organizer') wantTeam = null;
      else if (b.teams && b.teams.length) wantTeam = userId(b.teams[0]);
      else wantTeam = cur.teamId;
      if (wantTeam !== cur.teamId) body.teamId = wantTeam;
      if (!Object.keys(body).length) return mapUser(cur, dir.teamsById);
      body.reason = trimmed(b.reason) || DEFAULT_REASONS.update;
      const res = await http.patch(`/users/${userId(id)}`, body);
      return mapUser({ ...cur, ...res }, dir.teamsById);
    },

    /** The backend takes no reason for activate/deactivate (PATCH /users/:id/status). */
    async toggleUserStatus(id) {
      userId(id);
      const [cur, dir] = await Promise.all([findUser(id), directory()]);
      const res = await http.patch(`/users/${userId(id)}/status`, { isActive: !cur.isActive });
      return mapUser({ ...cur, isActive: !cur.isActive, ...res }, dir.teamsById);
    },

    async deleteUser(id, reason) {
      const [res, dir] = await Promise.all([
        http.del(`/users/${userId(id)}`, { reason: trimmed(reason) || DEFAULT_REASONS.delete }),
        directory(),
      ]);
      return mapUser(res, dir.teamsById, 'deleted');
    },

    /** Restored accounts come back INACTIVE (the backend rule): the status shown is 'disabled'. */
    async restoreUser(id) {
      const [res, dir] = await Promise.all([
        http.post(`/users/${userId(id)}/restore`, { reason: DEFAULT_REASONS.restore }),
        directory(),
      ]);
      return mapUser(res, dir.teamsById, 'disabled');
    },

    /* ------------------------------------------------------------------- teams */
    async listTeams() {
      const [users, dir] = await Promise.all([activeUsersList(), directory()]);
      return dir.teams.map((t) => ({
        ...t,
        managers: users
          .filter((u) => u.role === 'manager' && String(u.id) === t.managerId)
          .map((m) => ({ id: String(m.id), name: m.name })),
        activeMembers: users.filter((u) => u.role === 'member' && u.isActive && String(u.teamId) === t.id).length,
      }));
    },

    async listCampusManagers(campus) {
      const [users, dir] = await Promise.all([activeUsersList(), directory()]);
      return users
        .filter((u) => u.role === 'manager' && (dir.teamsById.get(String(u.teamId)) || {}).campus === campus)
        .map((m) => ({ id: String(m.id), name: m.name, teams: [String(m.teamId)] }));
    },

    /**
     * Create (new teams start non-operational, without a manager) or edit: rename and/or set the
     * single manager (PATCH /teams/:id). Only the changed fields are sent; managerId null removes it.
     */
    async saveTeam(b) {
      const name = trimmed(b.name);
      if (name.length < 2) throw new ApiError(400, 'أدخل اسم الفريق.');
      if (b.id) {
        const ids = Array.isArray(b.managerIds) ? b.managerIds : [];
        if (ids.length > 1) throw new ApiError(400, 'يسمح بمدير واحد فقط لكل فريق.');
        const [cur, dir] = await Promise.all([http.get(`/teams/${userId(b.id)}`), directory()]);
        const body = {};
        if (name !== cur.name) body.name = name;
        const want = ids.length ? userId(ids[0]) : null;
        if (want !== (cur.managerId ?? null)) body.managerId = want;
        if (!Object.keys(body).length) return mapTeam(cur, dir.campusName);
        body.reason = DEFAULT_REASONS.team;
        const res = await http.patch(`/teams/${userId(b.id)}`, body);
        return mapTeam(res, dir.campusName);
      }
      const dir = await directory();
      const campus = dir.campuses.find((c) => campusKey(c.name) === b.campus);
      if (!campus) throw new ApiError(400, 'اختر الحرم.');
      const created = await http.post('/teams', { name, campusId: campus.id });
      return mapTeam(created, dir.campusName);
    },

    /** Flips operational status. The backend refuses activation without an active manager. */
    async toggleTeam(id) {
      const dir = await directory();
      const cur = await http.get(`/teams/${userId(id)}`);
      const res = await http.patch(`/teams/${userId(id)}/status`, { isOperational: !cur.isOperational });
      return mapTeam({ ...cur, isOperational: !cur.isOperational, ...res }, dir.campusName);
    },

    /* ------------------------------------------------------------------ points */
    /**
     * UI "reason" doubles as the backend's required `activityName` (trimmed to 100).
     * The backend range is -100..100 (the UI policy limit is applied before this call).
     */
    async addPoints({ userId: uid, value, reason, activity, idempotencyKey }) {
      const text = trimmed(reason);
      // One key per submission: a retried request returns the first entry instead of a second one.
      const key = idempotencyKey || newIdempotencyKey();
      const entry = await http.post('/points', {
        userId: userId(uid),
        points: Number(value),
        activityName: (trimmed(activity) || text).slice(0, 100),
        reason: text,
      }, { headers: { 'Idempotency-Key': key } });
      return { total: null, entry: mapPointEntry(entry) };
    },

    /**
     * POST /api/points/:id/reverse { reason }. Returns the new reversal entry (-points, dated at the
     * original's instant). The server refuses a second reversal (ALREADY_REVERSED), a reversal of a
     * reversal (CANNOT_REVERSE_REVERSAL) and entries outside the actor's scope (FORBIDDEN).
     */
    async reversePoint(id, reason) {
      const text = trimmed(reason);
      if (!text) throw new ApiError(400, 'سبب العكس إلزامي.');
      if (text.length > 500) throw new ApiError(400, 'سبب العكس طويل جدًا (الحد 500 حرف).');
      const entry = await http.post(`/points/${entryId(id)}/reverse`, { reason: text });
      return { ok: true, entry: mapPointEntry(entry) };
    },

    /** Older name kept for existing callers. */
    async reversePoints(id, reason) {
      const text = trimmed(reason);
      if (!text) throw new ApiError(400, 'سبب العكس إلزامي.');
      await http.post(`/points/${entryId(id)}/reverse`, { reason: text });
      return { ok: true };
    },

    /**
     * Give Points log for a month (default: current). Manager: entries of the team they manage;
     * organizer: entries they recorded. Totals per person and for the team come from SQL.
     */
    async teamPointsHistory(month) {
      const period = month ? splitMonth(month) : null;
      if (month && !period) throw new ApiError(400, 'الشهر غير صالح.');
      const d = await http.get('/points/team-history', period ? { ...period, limit: 200 } : { limit: 200 });
      return {
        scope: d.scope,
        team: d.team ? { id: String(d.team.id), name: d.team.name } : null,
        month: `${d.year}-${String(d.month).padStart(2, '0')}`,
        totals: d.totals,
        members: d.members.map((m) => ({ userId: String(m.userId), name: m.name, total: m.total, entries: m.entries })),
        entries: d.entries.map((e) => ({
          id: String(e.id), userId: String(e.userId), userName: e.userName, value: e.points,
          activity: e.activityName, reason: e.reason, ts: Date.parse(e.effectiveAt) || 0,
          actorName: e.actorName, awardedByMe: !!e.awardedByMe, isReversal: e.reversesEntryId != null, reversed: !!e.reversed,
        })),
        truncated: !!d.truncated,
      };
    },

    /** Members the actor may give points to: organizer -> all active members, manager -> own team. */
    async assignableMembers() {
      const me = await http.get('/auth/me');
      const dir = await directory();
      let rows;
      if (me.role === 'organizer') {
        // Members and Managers both receive points (they share the monthly rankings).
        rows = (await activeUsersList()).filter((u) => (u.role === 'member' || u.role === 'manager') && u.isActive);
      } else if (me.role === 'manager' && me.teamId != null) {
        rows = await http.get(`/teams/${me.teamId}/members`);
      } else {
        rows = [];
      }
      return rows.map((u) => {
        const m = mapUser({ isActive: true, ...u }, dir.teamsById);
        return { id: m.id, name: m.name, campus: m.campus, teams: m.teams, teamsLabel: m.teamsLabel, total: 0 };
      });
    },

    /** Totals and rank come from SQL over the whole ledger; `entries` is only the displayed history. */
    async myPoints(month) {
      const m = month || monthOf(now().toISOString());
      const period = splitMonth(m);
      if (!period) throw new ApiError(400, 'الشهر غير صالح.');
      const [summary, rows] = await Promise.all([
        http.get('/points/me/summary', period),
        http.get('/points/me', { ...period, limit: 500 }),
      ]);
      return {
        month: m,
        total: summary.total,
        scorecard: null,
        legacyTotal: summary.total,
        positive: summary.positive,
        negative: summary.negative,
        rank: summary.rank,
        entries: rows.map(mapPointEntry),
      };
    },

    /* --------------------------------------------------------------- audit log */
    /**
     * GET /audit (organizer). The page has no pager, so the first 100 entries (the backend maximum)
     * are requested, newest first. Filter option lists are derived from the loaded entries.
     * Action / entity filters arrive as the Arabic labels shown in the UI and are sent as backend codes.
     */
    async auditLog(f = {}) {
      const actorId = /^\d+$/.test(String(f.actorId || '')) ? Number(f.actorId) : undefined;
      const res = await http.get('/audit', {
        actorId,
        action: f.action ? (AUDIT_ACTION_CODE[f.action] || f.action) : undefined,
        entityType: f.entityType ? (AUDIT_ENTITY_CODE[f.entityType] || f.entityType) : undefined,
        from: f.from,
        to: f.to,
        page: 1,
        pageSize: 100,
      });
      const items = (res.items || []).map(mapAuditEntry);
      const uniq = (xs) => Array.from(new Set(xs));
      return {
        items,
        total: res.total ?? items.length,
        filters: {
          actors: uniq(items.map((i) => i.actor)).filter(Boolean)
            .map((id) => ({ id, name: (items.find((i) => i.actor === id) || {}).actorName || id })),
          actions: uniq(items.map((i) => i.action)),
          entityTypes: uniq(items.map((i) => i.entityType)),
        },
      };
    },

    /* ---------------------------------------------------------------- rankings */
    /** Public. Campuses and teams for the filter selectors (ids come from the backend). */
    async rankingOptions() {
      const d = await http.get('/rankings/options', undefined, { auth: false });
      return {
        campuses: (d.campuses || []).map((c) => ({ id: String(c.id), key: campusKey(c.name), name: c.name })),
        teams: (d.teams || []).map((t) => ({ id: String(t.id), campusId: String(t.campusId), name: t.name })),
      };
    },

    /**
     * Signed-in ranking by total points. scope 'team' needs teamId, 'campus' needs campusId;
     * month is 'YYYY-MM'; archived reads the published snapshot of a closed month.
     */
    async rankings({ scope, teamId, campusId, month, archived = false }) {
      if (scope !== 'team' && scope !== 'campus') throw new ApiError(400, 'اختر نطاق الترتيب: فريق أو حرم.');
      const ym = splitMonth(month);
      if (!ym) throw new ApiError(400, 'الشهر غير صالح.');
      const params = { scope, year: ym.year, month: ym.month };
      if (scope === 'team') params.teamId = userId(teamId);
      else params.campusId = userId(campusId);
      const rows = await http.get(archived ? '/rankings/archived' : '/rankings', params);
      return mapRankingRows(rows || []);
    },

    /**
     * Leaderboard page: ONE monthly board, a team or a campus (Jenin and Ramallah are never
     * combined). Ranks are the backend's DENSE_RANK (1, 1, 2). Months before the current one are
     * read from the published (archived) snapshot. Team / photo details are not in the payload.
     */
    async leaderboard({ month, campus, teamId } = {}) {
      const cur = monthOf(now().toISOString());
      const m = month || cur;
      const archived = m < cur;
      const [opts, me] = await Promise.all([self.rankingOptions(), http.get('/auth/me').catch(() => null)]);

      let q;
      if (teamId) {
        const team = opts.teams.find((t) => t.id === String(teamId));
        const camp = team && opts.campuses.find((c) => c.id === team.campusId);
        q = { scope: 'team', teamId, campus: camp ? camp.key : '', teamName: team ? team.name : '' };
      } else {
        // A requested campus is never swapped for another one; no campus means the first.
        const c = campus ? opts.campuses.find((x) => x.key === campus) : opts.campuses[0];
        if (!c) return { month: m, archived, rows: [] };
        q = { scope: 'campus', campusId: c.id, campus: c.key, teamName: '' };
      }
      const ranked = await self.rankings({ scope: q.scope, teamId: q.teamId, campusId: q.campusId, month: m, archived });
      let rows = ranked.map((r) => ({ ...r, campus: q.campus, teamName: q.teamName }));
      rows = rows.map((r) => ({
        kind: 'points',
        photo: null,
        rank: r.rank,
        userId: r.userId,
        name: r.name,
        campus: r.campus,
        teamId: teamId ? String(teamId) : '',
        teamName: r.teamName,
        teamsLabel: r.teamName,
        total: r.total,
        tie: r.tie,
        isMe: !!me && String(me.id) === r.userId,
      }));
      return { month: m, archived, rows };
    },

    /**
     * Welcome page "stars" block from the public summary: the current-month leader of each team.
     * The summary is deliberately current-month only and carries no user IDs. Signed-in users get
     * the full view from /awards (any closed month, with the IDs the Awards page selects by).
     */
    async hall({ campus = 'jenin', month, signedIn = false } = {}) {
      if (signedIn) {
        const hall = await http.get('/awards', { campus, month });
        return { ...hall, groups: hall.groups.map((g) => ({ ...g, name: teamLabel(g.name) })) };
      }
      const opts = await self.rankingOptions();
      const camp = opts.campuses.find((c) => c.key === campus) || opts.campuses[0];
      if (!camp) throw new ApiError(400, 'الفرع غير صحيح.');
      const summary = await http.get('/rankings/public-summary', { campusId: camp.id }, { auth: false });
      return {
        campus: camp.key,
        month: summary.month,
        months: [{ id: summary.month, status: 'open' }],
        groups: summary.teamLeaders.slice(0, 4).map((t) => ({
          teamId: String(t.teamId),
          name: teamLabel(t.teamName),
          leader: t.leader ? { id: null, name: t.leader.name, photo: null, total: t.leader.totalPoints } : null,
        })),
        winner: summary.winner
          ? { userId: null, name: summary.winner.name, photo: null, total: summary.winner.total, teamName: summary.winner.teamName, campus: camp.key, month: summary.month }
          : null,
        winnerActivities: [],
        stale: false,
        ratedCount: summary.participants.rated,
        memberCount: summary.participants.total,
        demo: false,
        news: [],
      };
    },

    /* ------------------------------------------------------ manager evaluations */
    /**
     * Organizer only. `scores` = four integers 0-100 in MANAGER_CRITERIA order.
     * The backend derives the evaluator and the weighted total: neither is sent.
     */
    async createManagerEvaluation({ managerId, activityName, activityDate, scores, comments }) {
      const list = Array.isArray(scores) ? scores : [];
      if (list.length !== MANAGER_CRITERIA.length || list.some((v) => !Number.isInteger(v) || v < 0 || v > 100)) {
        throw new ApiError(400, 'أدخل 4 درجات صحيحة، كل واحدة من 0 إلى 100.');
      }
      const name = trimmed(activityName);
      if (!name || name.length > 150) throw new ApiError(400, 'اسم التقييم مطلوب (حتى 150 حرفًا).');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(activityDate || ''))) throw new ApiError(400, 'تاريخ التقييم غير صالح.');
      const res = await http.post('/evaluations/managers', {
        evaluatedUserId: userId(managerId),
        activityName: name,
        activityDate,
        criteriaScores: list,
        comments: trimmed(comments) || null,
      });
      return { id: String(res.id), managerId: String(res.evaluatedUserId), total: res.totalScore };
    },

    /** Monthly average of one manager's evaluations (average is null when there are none). */
    async managerAverage(managerId, month) {
      const ym = splitMonth(month);
      if (!ym) throw new ApiError(400, 'الشهر غير صالح.');
      const res = await http.get(`/evaluations/managers/${userId(managerId)}/average`, ym);
      return { managerId: String(res.managerUserId), month, count: res.evaluationCount, average: res.averageScore };
    },

    /**
     * Active managers with this month's evaluation count and average. The backend has no "list evaluations"
     * endpoint, so this is one /average call per manager; a failing manager shows its error instead of breaking the page.
     */
    async managerEvaluations(month) {
      const cur = month || monthOf(now().toISOString());
      const managers = await self.listUsers({ role: 'manager', status: 'active' });
      const rows = await Promise.all(managers.map(async (m) => {
        const base = { id: m.id, name: m.name, campus: m.campus, teamsLabel: m.teamsLabel };
        try {
          const a = await self.managerAverage(m.id, cur);
          return { ...base, count: a.count, average: a.average, error: '' };
        } catch (e) {
          return { ...base, count: 0, average: null, error: e.message };
        }
      }));
      rows.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      return { month: cur, criteria: MANAGER_CRITERIA, rows };
    },
  };
  return self;
}
