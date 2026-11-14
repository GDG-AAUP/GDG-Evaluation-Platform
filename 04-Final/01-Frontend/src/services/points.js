import { api } from './call.js';
import { http } from './http.js';
import { backend } from './backend/index.js';
import * as E from './mock/engine.js';

export const getMyPoints = (month) => api((db, a) => E.myPoints(db, a, { month }), () => backend.myPoints(month));
export const getAssignableMembers = () => api((db, a) => E.assignableMembers(db, a), () => backend.assignableMembers());
export const addPoints = (body) => api((db, a) => E.addPoints(db, a, body), () => backend.addPoints(body));
// Give Points log (real backend only; the demo has its own dashboards for this).
const EMPTY_HISTORY = { scope: 'awarded', team: null, month: '', totals: { entries: 0, points: 0, awardedByMe: 0, awardedByMeEntries: 0 }, members: [], entries: [], truncated: false };
export const getTeamHistory = (month) => api(() => EMPTY_HISTORY, () => backend.teamPointsHistory(month));
export const getLedger = (f) => api((db, a) => E.pointsLedger(db, a, f), () => http.get('/points', f));
export const reversePoint = (pointId, reason) => api(
  (db, a) => E.reversePoints(db, a, { entryId: pointId, reason }),
  () => backend.reversePoint(pointId, reason),
);
export const reversePoints = reversePoint;
