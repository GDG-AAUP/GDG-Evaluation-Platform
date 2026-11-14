import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setLangValue, tr } from '../i18n/index.js';

// Language + direction: Arabic (RTL, default) or English (LTR). Remembered on this device.
// The whole tree is re-mounted on a switch so every tr() call re-renders in the new language.
const Ctx = createContext(null);
const KEY = 'gdg-lang';

function read() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'en' || v === 'ar') return v;
  } catch { /* storage unavailable */ }
  return 'ar';
}

export function DirectionProvider({ children }) {
  const [lang, setLang] = useState(read);
  setLangValue(lang); // must happen before children render

  useEffect(() => {
    const dir = lang === 'en' ? 'ltr' : 'rtl';
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', lang);
    try { localStorage.setItem(KEY, lang); } catch { /* ignore */ }
  }, [lang]);

  const toggle = useCallback(() => setLang((l) => (l === 'ar' ? 'en' : 'ar')), []);
  const value = useMemo(() => ({ lang, dir: lang === 'en' ? 'ltr' : 'rtl', toggle }), [lang, toggle]);
  return <Ctx.Provider value={value}><Fragment_ key={lang}>{children}</Fragment_></Ctx.Provider>;
}

function Fragment_({ children }) { return children; }

export const useDirection = () => useContext(Ctx);
export const useLang = useDirection;

/** Language switch: shows the language it switches TO ("EN" while Arabic, "عربي" while English). */
export function DirectionToggle({ className = 'ib dir-toggle' }) {
  const { lang, toggle } = useDirection();
  const label = lang === 'ar' ? 'EN' : 'عربي';
  const hint = lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية';
  return (
    <button type="button" className={className} onClick={toggle} aria-label={hint} title={hint}>
      <span>{label}</span>
    </button>
  );
}
