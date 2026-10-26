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

const notSupported = (what) => new ApiError(
  501,
  `${what} غير متاح بعد في الباك.`,
  { code: 'NOT_SUPPORTED_BY_BACKEND' },
);

// Reasons the UI does not collect today but the backend requires (audit log).
export const DEFAULT_REASONS = {
  update: 'تعديل بيانات من لوحة المنظّم',
  restore: 'استرجاع حساب من لوحة المنظّم',
  delete: 'حذف حساب من لوحة المنظّم',
};

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

    async meta() {
      const dir = await directory();
      const cur = monthOf(now().toISOString());
      return {
        curMonth: cur,
        months: [{ id: cur, status: 'open' }],
        teams: dir.teams.map((t) => ({ id: t.id, campus: t.campus, name: t.name, status: t.status })),
        criteria: [],
      };
    },

    /** The backend stores no policy flags yet: defaults, read-only. */
    async policies() { return { ...DEFAULT_POLICIES }; },
    async setPolicy() { throw notSupported('تعديل السياسات'); },

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

    /** Creates the account and sends a Clerk invitation (no password: Clerk handles sign-in). */
    async createUser(b) {
      if (b.role !== 'member' && b.role !== 'manager') {
        throw new ApiError(400, 'يمكن إضافة عضو أو مدير فقط. حساب المنظّم يُنشأ من قاعدة البيانات.');
      }
      if (!b.teams || !b.teams.length) throw new ApiError(400, 'اختر الفريق.');
      const [created, dir] = await Promise.all([
        http.post('/users', {
          name: trimmed(b.name),
          email: trimmed(b.email),
          role: b.role,
          teamId: userId(b.teams[0]),
        }),
        directory(),
      ]);
      return { ...mapUser({ isActive: true, ...created }, dir.teamsById), invitation: created.deliveryStatus || null };
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
          .filter((u) => u.role === 'manager' && String(u.teamId) === t.id)
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
     * Create only. A new team starts non-operational and has no manager: add a manager by
     * creating a Manager user in it, then activate the team. Editing a team (rename /
     * managers) has no backend endpoint yet.
     */
    async saveTeam(b) {
      if (b.id) throw notSupported('تعديل اسم الفريق أو مديريه');
      const name = trimmed(b.name);
      if (name.length < 2) throw new ApiError(400, 'أدخل اسم الفريق.');
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
    async addPoints({ userId: uid, value, reason }) {
      const text = trimmed(reason);
      const entry = await http.post('/points', {
        userId: userId(uid),
        points: Number(value),
        activityName: text.slice(0, 100),
        reason: text,
      });
      return { total: null, entry: mapPointEntry(entry) };
    },

    async reversePoints(id, reason) {
      await http.post(`/points/${entryId(id)}/reverse`, { reason: trimmed(reason) });
      return { ok: true };
    },

    /** Members the actor may give points to: organizer -> all active members, manager -> own team. */
    async assignableMembers() {
      const me = await http.get('/auth/me');
      const dir = await directory();
      let rows;
      if (me.role === 'organizer') {
        rows = (await activeUsersList()).filter((u) => u.role === 'member' && u.isActive);
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

    /** Own points from GET /points/me (last 50 entries). Rank / scorecard are not available. */
    async myPoints(month) {
      const m = month || monthOf(now().toISOString());
      const all = (await http.get('/points/me')).map(mapPointEntry).filter((e) => e.month === m);
      const sum = (xs) => xs.reduce((s, e) => s + e.value, 0);
      return {
        month: m,
        total: sum(all),
        scorecard: null,
        legacyTotal: sum(all),
        positive: sum(all.filter((e) => e.value > 0)),
        negative: sum(all.filter((e) => e.value < 0)),
        rank: null,
        entries: all,
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
     * Public ranking by total points. scope 'team' needs teamId, 'campus' needs campusId;
     * month is 'YYYY-MM'; archived reads the published snapshot of a closed month.
     */
    async rankings({ scope, teamId, campusId, month, archived = false }) {
      if (scope !== 'team' && scope !== 'campus') throw new ApiError(400, 'اختر نطاق الترتيب: فريق أو حرم.');
      const ym = splitMonth(month);
      if (!ym) throw new ApiError(400, 'الشهر غير صالح.');
      const params = { scope, year: ym.year, month: ym.month };
      if (scope === 'team') params.teamId = userId(teamId);
      else params.campusId = userId(campusId);
      const rows = await http.get(archived ? '/rankings/archived' : '/rankings', params, { auth: false });
      return mapRankingRows(rows || []);
    },

    /**
     * Leaderboard page (public rankings, by total points). Same shape as the mock leaderboard.
     * The backend ranks one team or one campus at a time: `global` merges the campuses and
     * re-ranks (equal points share a rank). Months before the current one are read from the
     * published (archived) snapshot. Team / photo details are not in the ranking payload.
     */
    async leaderboard({ month, campus, teamId, global } = {}) {
      const cur = monthOf(now().toISOString());
      const m = month || cur;
      const archived = m < cur;
      const [opts, me] = await Promise.all([self.rankingOptions(), http.get('/auth/me').catch(() => null)]);

      let queries;
      if (teamId && !global) {
        const team = opts.teams.find((t) => t.id === String(teamId));
        const camp = team && opts.campuses.find((c) => c.id === team.campusId);
        queries = [{ scope: 'team', teamId, campus: camp ? camp.key : '', teamName: team ? team.name : '' }];
      } else {
        const list = campus && !global ? opts.campuses.filter((c) => c.key === campus) : opts.campuses;
        queries = list.map((c) => ({ scope: 'campus', campusId: c.id, campus: c.key }));
      }
      const lists = await Promise.all(queries.map(async (q) => {
        const rows = await self.rankings({ scope: q.scope, teamId: q.teamId, campusId: q.campusId, month: m, archived });
        return rows.map((r) => ({ ...r, campus: q.campus, teamName: q.teamName || '' }));
      }));

      let rows = lists.flat();
      if (lists.length > 1) {
        rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ar') || a.userId.localeCompare(b.userId));
        rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].total === r.total ? rows[i - 1].rank : i + 1; });
        rows.forEach((r) => { r.tie = rows.some((o) => o !== r && o.total === r.total); });
      }
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
     * Welcome page "stars" block, built from the public rankings: the leader (most points)
     * of each team of the branch. There is no awards / news service in the backend yet, so
     * `winner` is null and `news` is empty.
     */
    async hall({ campus = 'jenin', month } = {}) {
      const cur = monthOf(now().toISOString());
      const m = month || cur;
      const archived = m < cur;
      const opts = await self.rankingOptions();
      const camp = opts.campuses.find((c) => c.key === campus) || opts.campuses[0];
      if (!camp) throw new ApiError(400, 'الفرع غير صحيح.');
      const teams = opts.teams.filter((t) => t.campusId === camp.id).slice(0, 4);
      const [campusRows, ...teamRows] = await Promise.all([
        self.rankings({ scope: 'campus', campusId: camp.id, month: m, archived }),
        ...teams.map((t) => self.rankings({ scope: 'team', teamId: t.id, month: m, archived })),
      ]);
      return {
        campus: camp.key,
        month: m,
        months: [{ id: cur, status: 'open' }],
        groups: teams.map((t, i) => {
          const lead = teamRows[i].find((r) => r.total > 0);
          return {
            teamId: t.id,
            name: teamLabel(t.name),
            leader: lead ? { id: lead.userId, name: lead.name, photo: null, total: lead.total } : null,
          };
        }),
        winner: null,
        winnerActivities: [],
        stale: false,
        ratedCount: campusRows.filter((r) => r.total > 0).length,
        memberCount: campusRows.length,
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
  };
  return self;
}
