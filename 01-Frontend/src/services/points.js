import { api } from './call.js';
import { http } from './http.js';
import { backend } from './backend/index.js';
import * as E from './mock/engine.js';

export const getMyPoints = (month) => api((db, a) => E.myPoints(db, a, { month }), () => backend.myPoints(month));
export const getAssignableMembers = () => api((db, a) => E.assignableMembers(db, a), () => backend.assignableMembers());
export const addPoints = (body) => api((db, a) => E.addPoints(db, a, body), () => backend.addPoints(body));
export const getLedger = (f) => api((db, a) => E.pointsLedger(db, a, f), () => http.get('/points', f));
export const reversePoints = (entryId, reason) => api(
  (db, a) => E.reversePoints(db, a, { entryId, reason }),
  () => backend.reversePoints(entryId, reason),
);
