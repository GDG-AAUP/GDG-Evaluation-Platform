import { api } from './call.js';
import { http } from './http.js';
import * as A from './mock/engineAdmin.js';
import { backend } from './backend/index.js';

export const getEvaluations = (campus) => api((db, a) => A.evaluations(db, a, { campus }), () => http.get('/evaluations', { campus }));
export const getEvaluation = (managerId) => api((db, a) => A.evaluationDetail(db, a, { managerId }), () => http.get(`/evaluations/${managerId}`));
export const saveEvaluation = (managerId, scores, approve) => api(
  (db, a) => A.saveEvaluation(db, a, { managerId, scores, approve }),
  () => http.put(`/evaluations/${managerId}`, { scores, approve }),
);
export const setCriteria = (criteria) => api((db, a) => A.setCriteria(db, a, { criteria }), () => http.put('/evaluations/criteria', { criteria }));

// Real backend only (4 fixed criteria, many evaluations per month, monthly average). The mock keeps its own page.
const realOnly = () => { throw new Error('manager evaluations (real backend only)'); };
export const getManagerEvaluations = (month) => api(realOnly, () => backend.managerEvaluations(month));
export const createManagerEvaluation = (body) => api(realOnly, () => backend.createManagerEvaluation(body));
