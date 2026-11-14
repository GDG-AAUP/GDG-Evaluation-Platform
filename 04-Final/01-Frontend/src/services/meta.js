import { api } from './call.js';
import { http } from './http.js';
import { backend } from './backend/index.js';
import * as E from './mock/engine.js';
import * as A from './mock/engineAdmin.js';

export const getMeta = () => api((db) => E.meta(db), () => backend.meta());
export const getPolicies = () => api((db) => E.getPolicies(db), () => backend.policies());
export const setPolicy = (key, value) => api(
  (db, a) => A.setPolicy(db, a, { key, value }),
  () => backend.setPolicy(key, value),
);
