import { http } from '../http.js';
import { createBackend } from './client.js';

/** Singleton bound to the app's HTTP client (used only when VITE_USE_MOCK=false). */
export const backend = createBackend(http);
