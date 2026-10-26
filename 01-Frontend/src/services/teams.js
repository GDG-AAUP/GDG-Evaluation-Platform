import { api } from './call.js';
import { http } from './http.js';
import { backend } from './backend/index.js';
import * as A from './mock/engineAdmin.js';

export const listTeams = () => api((db, a) => A.listTeams(db, a), () => backend.listTeams());
export const listCampusManagers = (campus) => api((db, a) => A.listCampusManagers(db, a, { campus }), () => backend.listCampusManagers(campus));
export const saveTeam = (b) => api(
  (db, a) => A.saveTeam(db, a, b),
  () => backend.saveTeam(b),
);
export const toggleTeam = (id, reason) => api((db, a) => A.toggleTeam(db, a, { id, reason }), () => backend.toggleTeam(id, reason));
