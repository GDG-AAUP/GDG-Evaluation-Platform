import { api } from './call.js';
import { http } from './http.js';
import * as A from './mock/engineAdmin.js';

export const getAuditLog = (f = {}) => api((db, a) => A.auditLog(db, a, f), () => http.get('/audit', f));
export const getSystemLog = (level) => api((db, a) => A.systemLog(db, a, { level }), () => http.get('/syslog', { level: level === 'all' ? undefined : level }));
