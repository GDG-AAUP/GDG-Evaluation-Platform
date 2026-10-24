import { api } from './call.js';
import { http } from './http.js';
import * as A from './mock/engineAdmin.js';

export const listTeams = () => api((db, a) => A.listTeams(db, a), () => http.get('/teams'));
export const listCampusManagers = (campus) => api((db, a) => A.listCampusManagers(db, a, { campus }), () => http.get('/managers', { campus }));
export const saveTeam = (b) => api(
  (db, a) => A.saveTeam(db, a, b),
  () => (b.id ? http.put(`/teams/${b.id}`, b) : http.post('/teams', b)),
);
export const toggleTeam = (id, reason) => api((db, a) => A.toggleTeam(db, a, { id, reason }), () => http.post(`/teams/${id}/toggle`, { reason }));
