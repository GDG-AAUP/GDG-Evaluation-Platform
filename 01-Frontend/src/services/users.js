import { api } from './call.js';
import { http } from './http.js';
import * as A from './mock/engineAdmin.js';

export const listUsers = (f = {}) => api((db, a) => A.listUsers(db, a, f), () => http.get('/users', { ...f, deleted: f.deleted ? 'true' : undefined }));
export const createUser = (b) => api((db, a) => A.createUser(db, a, b), () => http.post('/users', b));
export const updateUser = (id, b) => api((db, a) => A.updateUser(db, a, { id, ...b }), () => http.put(`/users/${id}`, b));
export const toggleUserStatus = (id, reason) => api((db, a) => A.toggleUserStatus(db, a, { id, reason }), () => http.post(`/users/${id}/toggle-status`, { reason }));
export const deleteUser = (id, reason) => api((db, a) => A.deleteUser(db, a, { id, reason }), () => http.del(`/users/${id}`, { reason }));
export const restoreUser = (id) => api((db, a) => A.restoreUser(db, a, { id }), () => http.post(`/users/${id}/restore`));
