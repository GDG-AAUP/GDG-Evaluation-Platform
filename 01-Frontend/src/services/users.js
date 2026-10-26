import { api } from './call.js';
import { http } from './http.js';
import { backend } from './backend/index.js';
import * as A from './mock/engineAdmin.js';

export const listUsers = (f = {}) => api((db, a) => A.listUsers(db, a, f), () => backend.listUsers(f));
export const createUser = (b) => api((db, a) => A.createUser(db, a, b), () => backend.createUser(b));
export const updateUser = (id, b) => api((db, a) => A.updateUser(db, a, { id, ...b }), () => backend.updateUser(id, b));
export const toggleUserStatus = (id, reason) => api((db, a) => A.toggleUserStatus(db, a, { id, reason }), () => backend.toggleUserStatus(id, reason));
export const deleteUser = (id, reason) => api((db, a) => A.deleteUser(db, a, { id, reason }), () => backend.deleteUser(id, reason));
export const restoreUser = (id) => api((db, a) => A.restoreUser(db, a, { id }), () => backend.restoreUser(id));
