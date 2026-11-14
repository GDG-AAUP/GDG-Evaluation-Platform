import { api } from './call.js';
import { http } from './http.js';
import * as E from './mock/engine.js';

export const askAssistant = (question) => api((db, a) => E.assistant(db, a, { question }), () => http.post('/assistant', { question }));
