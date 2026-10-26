import { MONTHS_AR } from './constants.js';
import { getLang } from '../i18n/index.js';

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-10" -> "تشرين الأول 2026" */
export function monthLabel(id) {
  const [y, m] = String(id).split('-');
  const names = getLang() === 'en' ? MONTHS_EN : MONTHS_AR;
  return `${names[Number(m) - 1] || m} ${y}`;
}

/** "2026-12" -> "2027-01" */
export function nextMonth(id) {
  let [y, m] = String(id).split('-').map(Number);
  m += 1;
  if (m > 12) { m = 1; y += 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

const locale = () => (getLang() === 'en' ? 'en-GB-u-nu-latn' : 'ar-u-nu-latn'); // Western digits

export function fmtDateTime(ts) {
  return new Date(ts).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Two-letter avatar initials from a full name. */
export function initials(name) {
  return String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
}

/** Parses "+10", "-5", "−5" (unicode minus) into an integer, or NaN. */
export function parsePoints(v) {
  const c = String(v ?? '').replace(/[−–]/g, '-').replace(/\s/g, '');
  return /^[+-]?\d+$/.test(c) ? parseInt(c, 10) : NaN;
}

export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
