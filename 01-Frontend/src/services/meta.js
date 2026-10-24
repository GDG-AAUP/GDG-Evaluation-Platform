import { api } from './call.js';
import { http } from './http.js';
import * as E from './mock/engine.js';
import * as A from './mock/engineAdmin.js';

export const getMeta = () => api((db) => E.meta(db), () => http.get('/meta'));
export const getPolicies = () => api((db) => E.getPolicies(db), () => http.get('/policies'));
export const setPolicy = (key, value) => api(
  (db, a) => A.setPolicy(db, a, { key, value }),
  () => http.put(`/policies/${key}`, { value }),
);
