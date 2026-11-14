// Mock database singleton, persisted to localStorage so the demo survives reloads.
// Everything is wrapped in try/catch: storage can be unavailable (private mode).
//
// Schema versions:
//   v1 = original release (free points ledger only)
//   v2 = adds scorecards (15 categories / max 100), monthly awards, news, photos.
// Old v1 data is MIGRATED in place (see migrateDb) — never silently reset.
// Changes are broadcast to every open tab via the `storage` event.

import { createSeed, defaultNews } from './seed.js';
import { logAudit, logSys } from './helpers.js';

const KEY = 'gdg-mock-db-v2'; // storage key kept from v1 so existing data is found and migrated
export const SCHEMA_VERSION = 2;
let db = null;
let lastJson = null;
const listeners = new Set();

/** Upgrades an older database object in place. Pure (no browser APIs) -> unit-tested. */
export function migrateDb(d) {
  if (!d || typeof d !== 'object') return d;
  if (d.v === 1) {
    d.scorecards = Array.isArray(d.scorecards) ? d.scorecards : [];
    d.awards = d.awards && typeof d.awards === 'object' ? d.awards : {};
    d.news = Array.isArray(d.news) ? d.news : defaultNews();
    Object.values(d.snaps || {}).forEach((s) => { s.kind = s.kind || 'legacy'; });
    (d.users || []).forEach((u) => { if (u.photo === undefined) u.photo = null; });
    d.demo = d.demo !== undefined ? d.demo : true; // v1 data came from the original demo seed
    d.v = 2;
    d.migratedFrom = 1;
    logAudit(d, 'system', 'ترحيل البيانات', 'نظام', 'قاعدة البيانات v1 → v2', 'نقاط حرّة (Legacy)', 'بطاقات تقييم 15 بندًا',
      'حُفظ سجل النقاط القديم والأرشيف كما هو مع وسم Legacy');
    logSys(d, 'info', 'تم ترحيل بيانات المنصة إلى الإصدار 2 دون حذف أي سجل', 'migration');
  }
  return d;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.tasks) return null;
    if (parsed.v !== 1 && parsed.v !== SCHEMA_VERSION) return null;
    return migrateDb(parsed);
  } catch { return null; }
}

const emit = () => listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });

/** Subscribe to data changes (this tab or another tab). Returns an unsubscribe fn. */
export function subscribeDb(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    db = null; lastJson = null; // re-read on next access
    emit();
  });
}

export function getDb() {
  try { const raw=localStorage.getItem(KEY); if(db && raw && raw!==lastJson){ db=migrateDb(JSON.parse(raw));lastJson=raw; } } catch {}
  if (!db) {
    db = load() || createSeed();
    saveDb(true);
  }
  return db;
}

/** Persists; notifies subscribers only when the content actually changed. */
export function saveDb(silent) {
  let s;
  try { s = JSON.stringify(db); } catch { return; }
  if (s === lastJson) return;
  const first = lastJson === null;
  try { if(typeof localStorage!=='undefined') localStorage.setItem(KEY, s); } catch {
    if(lastJson) db=JSON.parse(lastJson);
    throw new Error('تعذّر حفظ البيانات في المتصفح. تحقق من مساحة التخزين وإعدادات الخصوصية ثم أعد المحاولة.');
  }
  lastJson = s;
  if (!silent && !first) emit();
}

/** Restores the original demo data. */
export function resetDb() {
  db = createSeed();
  lastJson = '';
  saveDb();
  return db;
}
