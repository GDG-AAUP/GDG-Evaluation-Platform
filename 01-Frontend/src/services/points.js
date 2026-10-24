import { api } from './call.js';
import { http } from './http.js';
import * as E from './mock/engine.js';

export const getMyPoints = (month) => api((db, a) => E.myPoints(db, a, { month }), () => http.get('/points/mine', { month }));
export const getAssignableMembers = () => api((db, a) => E.assignableMembers(db, a), () => http.get('/members/assignable'));
export const addPoints = (body) => api((db, a) => E.addPoints(db, a, body), () => http.post('/points', body));
export const getLedger = (f) => api((db, a) => E.pointsLedger(db, a, f), () => http.get('/points', f));
export const reversePoints = (entryId, reason) => api(
  (db, a) => E.reversePoints(db, a, { entryId, reason }),
  () => http.post(`/points/${entryId}/reverse`, { reason }),
);
