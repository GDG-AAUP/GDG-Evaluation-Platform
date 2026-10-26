import shell from './en/shell.js';
import pub from './en/public.js';
import organizerA from './en/organizer_a.js';
import organizerB from './en/organizer_b.js';
import memberManager from './en/member_manager.js';
import messages from './en/messages.js';
import indirect from './en/indirect.js';
import overview from './en/overview.js';
import dialogs from './en/dialogs.js';

// Key = exact Arabic source text, value = English. Arabic is the source language.
const EN = { ...shell, ...pub, ...organizerA, ...organizerB, ...memberManager, ...messages, ...indirect, ...overview, ...dialogs };

let lang = 'ar';
export const getLang = () => lang;
export const setLangValue = (l) => { lang = l === 'en' ? 'en' : 'ar'; };

const esc = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
// Keys that contain {placeholders} also match strings that were already interpolated
// (e.g. messages thrown by the mock engine), so one entry covers every value.
const PATTERNS = Object.keys(EN)
  .filter((k) => /\{\w+\}/.test(k))
  .map((k) => {
    const names = [];
    const src = k.split(/(\{\w+\})/).map((part) => {
      const m = part.match(/^\{(\w+)\}$/);
      if (m) { names.push(m[1]); return '([\\s\\S]+?)'; }
      return esc(part);
    }).join('');
    return { re: new RegExp(`^${src}$`), names, en: EN[k] };
  });

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s);

/** Translate an Arabic source string. Safe to call with any text; unknown text is returned unchanged. */
export function tr(ar, vars) {
  if (typeof ar !== 'string' || !ar) return ar;
  if (lang !== 'en') return fill(ar, vars);
  if (Object.prototype.hasOwnProperty.call(EN, ar)) return fill(EN[ar], vars);
  for (const p of PATTERNS) {
    const m = ar.match(p.re);
    if (m) return fill(p.en, Object.fromEntries(p.names.map((n, i) => [n, m[i + 1]])));
  }
  return fill(ar, vars);
}

export const dictionary = EN;
