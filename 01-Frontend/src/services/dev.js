// Demo-only helpers (role switch, failure simulation, data reset).
// They exist only with the mock backend; the demo panel is hidden otherwise.
import { setAuthToken } from './http.js';
import { sim } from './mock/runtime.js';
import { resetDb } from './mock/db.js';

export const DEMO_USER_ID = { member: 'u1', manager: 'm1', organizer: 'o1' };

export function demoLogin(role) {
  resetSimulation();
  setAuthToken(`mock:${DEMO_USER_ID[role]}`);
}
export const failNextRequest = () => { sim.failNext = true; };
export const expireSession = () => { sim.expired = true; };
export function resetSimulation() { sim.expired = false; sim.failNext = false; }
export function resetData() { resetDb(); resetSimulation(); }
export const setLatency = (ms) => { sim.latency = ms; };
