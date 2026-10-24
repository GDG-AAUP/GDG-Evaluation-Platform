// Error factories + "view" mappers: they turn raw DB records into the JSON shapes
// documented in docs/API_CONTRACT.md. The real backend returns the same shapes.

import { ApiError } from '../errors.js';
import { reverseOf, teamName, teamsLabel, userById } from './helpers.js';

export const E400 = (m, d) => new ApiError(400, m, d);
export const E403 = (m) => new ApiError(403, m || 'ليس لديك صلاحية لهذه العملية.');
export const E404 = (m) => new ApiError(404, m || 'العنصر غير موجود.');
export const E409 = (m, d) => new ApiError(409, m, d);

export function requireRole(actor, ...roles) {
  if (!roles.includes(actor.role)) throw E403();
}

export const pubUser = (db, u) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, campus: u.campus,
  photo: u.photo || null, teams: [...u.teams], teamsLabel: teamsLabel(db, u), status: u.status, created: u.created,
});

export function entryView(db, e) {
  const u = userById(db, e.userId);
  const a = userById(db, e.actor);
  const orig = e.reverses ? db.entries.find((x) => x.id === e.reverses) : null;
  const rv = reverseOf(db, e.id);
  return {
    id: e.id,
    userId: e.userId,
    userName: u ? u.name : '',
    campus: u ? u.campus : '',
    teamsLabel: u ? teamsLabel(db, u) : '',
    month: e.month,
    ts: e.ts,
    value: e.value,
    reason: e.reason,
    actorId: e.actor,
    actorName: a ? a.name : '',
    actorRole: a ? a.role : '',
    reverses: e.reverses || null,
    reversesReason: orig ? orig.reason : null,
    reversed: !!rv,
    archived: !!db.snaps[e.month],
    canReverse: !e.reverses && !rv && !db.snaps[e.month],
  };
}

export function rowView(db, r, actor) {
  const u = userById(db, r.userId) || {};
  return {
    kind: r.kind || 'scorecard', photo: u.photo || null, core: r.core,
    rank: r.rank,
    userId: r.userId,
    name: u.name || '',
    campus: r.campus,
    teamId: r.teamId,
    teamName: teamName(db, r.teamId),
    teamsLabel: u.teams ? teamsLabel(db, u) : '',
    total: r.total,
    tie: r.tie,
    isMe: !!actor && actor.id === r.userId,
  };
}
