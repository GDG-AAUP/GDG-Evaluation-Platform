// Pure mapping helpers: shapes returned by the real backend (02-Backend) -> shapes the UI expects.
// No browser or Vite globals here, so everything is unit-tested in Node.
//
// Conventions of the UI (see services/mock/views.js):
//   ids are strings, campuses are keys ('jenin' | 'ramallah'), user.status is
//   'active' | 'disabled' | 'deleted', a user's teams is an array of team ids.
// Conventions of the backend: numeric ids, campus names ('Jenin'), isActive / deletedAt / teamId.

import { teamLabel } from '../../lib/constants.js';

/** 'Jenin' -> 'jenin', 'Ramallah' -> 'ramallah'. */
export const campusKey = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, '-');

export const monthOf = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export function mapTeam(t, campusNameById) {
  return {
    id: String(t.id),
    campus: campusKey(campusNameById.get(t.campusId)),
    name: t.name,
    status: t.isOperational ? 'active' : 'disabled',
    description: t.description ?? null,
    managerId: t.managerId == null ? null : String(t.managerId),
  };
}

/**
 * @param u backend user ({id, name, email?, role, teamId, isActive, deletedAt?})
 * @param teamsById Map<string, mappedTeam>
 * @param forceStatus optional: 'deleted' for rows of GET /users/deleted
 */
export function mapUser(u, teamsById, forceStatus) {
  const team = u.teamId == null ? null : teamsById.get(String(u.teamId)) || null;
  let status = 'disabled';
  if (forceStatus) status = forceStatus;
  else if (u.deletedAt) status = 'deleted';
  else if (u.isActive) status = 'active';
  return {
    id: String(u.id),
    name: u.name,
    email: u.email || '',
    role: u.role,
    campus: team ? team.campus : '',
    photo: null,
    teams: u.teamId == null ? [] : [String(u.teamId)],
    teamsLabel: team ? teamLabel(team.name) : '',
    status,
    created: null,
  };
}

/** Point entry from POST /points or GET /points/me. */
export function mapPointEntry(e) {
  return {
    id: String(e.id),
    userId: e.userId == null ? null : String(e.userId),
    month: monthOf(e.effectiveAt),
    ts: Date.parse(e.effectiveAt) || 0,
    value: e.points,
    reason: e.reason,
    activityName: e.activityName,
    reverses: e.reversesEntryId == null ? null : String(e.reversesEntryId),
    reversed: false,
    canReverse: false,
  };
}

/* ------------------------------------------------------------------ audit log */

// Backend action / entity codes -> the Arabic labels the Audit page shows (and filters by).
export const AUDIT_ACTION_AR = {
  create_point_entry: 'إضافة نقاط',
  reverse_point_entry: 'عكس عملية نقاط',
  PERFORMANCE_EVALUATION_CREATED: 'إنشاء تقييم أداء',
};
export const AUDIT_ENTITY_AR = {
  performance_evaluations: 'تقييم أداء',
};
const invert = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
export const AUDIT_ACTION_CODE = invert(AUDIT_ACTION_AR);
export const AUDIT_ENTITY_CODE = invert(AUDIT_ENTITY_AR);

/** A short, readable value for the before / after columns. */
export function briefValue(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v !== 'object') return String(v);
  if (v.points !== undefined) return String(v.points);
  if (v.totalScore !== undefined) return String(v.totalScore);
  const text = JSON.stringify(v);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/** GET /audit item -> row of the Audit page. */
export function mapAuditEntry(it) {
  return {
    id: String(it.id),
    ts: Date.parse(it.createdAt) || 0,
    actor: it.actorId == null ? '' : String(it.actorId),
    actorName: it.actorName || '',
    action: AUDIT_ACTION_AR[it.action] || it.action,
    entityType: AUDIT_ENTITY_AR[it.entityType] || it.entityType,
    entity: it.entityId == null ? '—' : `#${it.entityId}`,
    before: briefValue(it.oldValues),
    after: briefValue(it.newValues),
    reason: it.reason || '',
  };
}

/* -------------------------------------------------------------------- rankings */

/** GET /rankings rows -> UI rows. Equal totals share a rank (dense ranking): `tie` marks them. */
export function mapRankingRows(rows) {
  const count = new Map();
  rows.forEach((r) => count.set(r.rank, (count.get(r.rank) || 0) + 1));
  return rows.map((r) => ({
    rank: r.rank,
    userId: String(r.userId),
    name: r.fullName,
    total: r.totalPoints,
    tie: count.get(r.rank) > 1,
  }));
}

/** 'YYYY-MM' -> { year, month } numbers (null when malformed). */
export function splitMonth(id) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(id || ''));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return year >= 2000 && month >= 1 && month <= 12 ? { year, month } : null;
}

/* -------------------------------------------------------- manager evaluations */

// Fixed by the backend (Phase 2): four criteria, scored 0-100 each, in this order.
export const MANAGER_CRITERIA = Object.freeze([
  { id: 'commitment', label: 'الالتزام والانضباط', weight: 30 },
  { id: 'followUp', label: 'متابعة الفريق', weight: 30 },
  { id: 'communication', label: 'التواصل والتعاون', weight: 20 },
  { id: 'teamResults', label: 'نتائج الفريق', weight: 20 },
].map((c) => Object.freeze(c)));
