import { api } from './call.js';
import { http } from './http.js';
import * as E from './mock/engine.js';

/** params: { month, campus, teamId, global } */
export const getLeaderboard = (p) => api(
  (db, a) => E.leaderboard(db, a, p),
  () => http.get('/leaderboard', { month: p.month, campus: p.campus, teamId: p.teamId, global: p.global ? 'true' : undefined }),
);
