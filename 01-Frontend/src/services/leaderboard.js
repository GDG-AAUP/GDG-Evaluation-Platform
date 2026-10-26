import { api } from './call.js';
import { backend } from './backend/index.js';
import * as E from './mock/engine.js';

/** params: { month, campus, teamId, global } */
export const getLeaderboard = (p) => api(
  (db, a) => E.leaderboard(db, a, p),
  () => backend.leaderboard(p),
);
