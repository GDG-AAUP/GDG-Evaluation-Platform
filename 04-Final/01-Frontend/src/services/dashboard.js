import { api } from './call.js';
import { http } from './http.js';
import * as E from './mock/engine.js';

export const getTeamOverview = (teamId) => api((db, a) => E.teamOverview(db, a, { teamId }), () => http.get(`/teams/${teamId}/overview`));
export const getOrgOverview = () => api((db, a) => E.orgOverview(db, a), () => http.get('/overview'));
