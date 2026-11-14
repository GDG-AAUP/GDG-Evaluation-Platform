// Mock "server": simulates latency, auth, network failures and session expiry
// around the pure engine functions.

import { ApiError } from '../errors.js';
import { getAuthToken } from '../http.js';
import { notifyUnauthorized } from '../session.js';
import { getDb, saveDb } from './db.js';
import { userById } from './helpers.js';

/** Flags toggled from the demo panel. */
export const sim = { failNext: false, expired: false, latency: 220 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function actorFromToken() {
  const token = getAuthToken();
  if (!token || !token.startsWith('mock:')) return null;
  const u = userById(getDb(), token.slice(5));
  return u && u.status === 'active' ? u : null;
}

/**
 * Runs an engine function like a request would run on a server.
 *   fn(db, actor)  -> data (may throw ApiError)
 *   opts.public    -> no authentication required (login)
 */
export async function runMock(fn, opts = {}) {
  await sleep(sim.latency);
  if (sim.failNext) {
    sim.failNext = false;
    throw new ApiError(0, 'تعذّر الاتصال بالخادم. تحقق من الشبكة وأعد المحاولة.');
  }
  const db = getDb();
  let actor = null;
  if (!opts.public) {
    if (sim.expired) {
      notifyUnauthorized();
      throw new ApiError(401, 'انتهت صلاحية الجلسة. سجّل الدخول مرة أخرى.');
    }
    actor = actorFromToken();
    if (!actor) {
      notifyUnauthorized();
      throw new ApiError(401, 'انتهت صلاحية الجلسة. سجّل الدخول مرة أخرى.');
    }
  }
  const out = fn(db, actor); // ApiError propagates untouched
  saveDb();
  return clone(out);
}
