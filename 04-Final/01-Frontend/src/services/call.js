import { USE_MOCK } from '../config.js';
import { runMock } from './mock/runtime.js';

/**
 * Every service function goes through this single switch:
 *   api((db, actor) => engine.fn(db, actor, args),   // mock implementation
 *       () => http.get('/real/endpoint'))           // real REST implementation
 * Components never know which one is active.
 */
export function api(mockFn, httpFn, opts) {
  return USE_MOCK ? runMock(mockFn, opts) : httpFn();
}
