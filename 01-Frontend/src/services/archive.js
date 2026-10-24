import { api } from './call.js';
import { http } from './http.js';
import * as A from './mock/engineAdmin.js';

export const getArchive = () => api((db, a) => A.archiveOverview(db, a), () => http.get('/archive'));
export const closeMonth = () => api((db, a) => A.closeMonth(db, a), () => http.post('/archive/close'));
export const getSnapshot = (month, f = {}) => api((db, a) => A.snapshot(db, a, { month, ...f }), () => http.get(`/archive/${month}`, f));
export const addCorrection = (b) => api((db, a) => A.addCorrection(db, a, b), () => http.post('/archive/corrections', b));
