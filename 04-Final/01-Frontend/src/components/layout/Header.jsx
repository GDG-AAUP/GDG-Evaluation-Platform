import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';
import { DirectionToggle } from '../../context/DirectionContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Link } from '../../router/router.jsx';
import { ROLE_LABEL } from '../../lib/constants.js';
import Icon from '../ui/Icon.jsx';
import { Avatar } from '../ui/Primitives.jsx';
import { CampusBadge, RoleBadge } from '../ui/Badges.jsx';
import Logo from './Logo.jsx';
import Popover from './Popover.jsx';
import QuickLinks, { linksFor } from './QuickLinks.jsx';
import { tr } from '../../i18n/index.js';
import { registrationsApi } from '../../services/index.js';

const NOTES = {
  member: ['افتح بطاقات التقييم لمراجعة تقييمك الشهري.', 'تابع نجوم الشهر من صفحة المجتمع.'],
  manager: ['يمكنك تقييم أعضاء فريقك في فرعك فقط.', 'الحد الأعلى للبطاقة 100 نقطة.'],
  organizer: ['اختر عضو الشهر من صفحة نجوم الشهر.', 'انشر أخبار المجتمع من صفحة الأخبار.'],
};

// Organizers only: number of self-registration requests waiting for a decision.
// Refreshed on load, every minute, and right after a decision on the requests screen.
function usePendingRegistrations(role) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (role !== 'organizer') return undefined;
    let alive = true;
    const load = () => registrationsApi.pendingCount().then((n) => { if (alive) setCount(n || 0); }).catch(() => {});
    load();
    // New requests come from other people: re-check every 20 s and whenever the tab regains focus;
    // a decision in this tab announces itself (CHANGED_EVENT) and updates the count at once.
    const timer = setInterval(load, 20000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener(registrationsApi.CHANGED_EVENT, load);
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener(registrationsApi.CHANGED_EVENT, load);
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [role]);
  return count;
}

export default function Header() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const toast = useToast();
  const pending = usePendingRegistrations(user.role);

  return (
    <header className="top">
      <Link to="/" className="brand" aria-label="GDG Evaluation">
        <Logo size={30} />
        <span>GDG AAUP<small>{tr('مجتمع يصنع الأثر')}</small></span>
      </Link>
      <CampusBadge campus={user.campus} />
      <span className="sp" />
      <button type="button" className="ib" onClick={toggle} aria-label={tr('تبديل الوضع الداكن')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>

      <DirectionToggle />

      {linksFor(user.role).length > 0 && (
        <Popover id="pl" trigger={(open, tg) => (
          <button type="button" className="ib" onClick={tg} aria-label={tr('روابط سريعة')} aria-expanded={open}><Icon name="link" /></button>
        )}>
          {(close) => (
            <>
              <div className="it" style={{ fontWeight: 500 }}>{tr('روابط سريعة')}</div>
              <div className="qlinks"><QuickLinks role={user.role} onPick={close} className="it ql" /></div>
            </>
          )}
        </Popover>
      )}

      <Popover id="pn" trigger={(open, tg) => (
        <button type="button" className="ib" onClick={tg} aria-label={pending ? tr('الإشعارات: {n} طلبات انضمام معلقة', { n: pending }) : tr('الإشعارات')} aria-expanded={open}><Icon name="bell" />{pending > 0 && <span className="dot" />}</button>
      )}>
        {(close) => (
          <>
            {pending > 0 && (
              <Link to="/organizer/registrations" className="it" style={{ fontWeight: 500 }} onClick={close}>
                {tr('طلبات الانضمام المعلقة: {n}', { n: pending })}
              </Link>
            )}
            <div className="it" style={{ fontWeight: 500 }}>{tr('إرشادات المجتمع')}</div>
            {NOTES[user.role].map((n) => <div key={n} className="it">{tr(n)}</div>)}
          </>
        )}
      </Popover>

      <Popover id="pu" trigger={(open, tg) => (
        <button type="button" className="ib" onClick={tg} aria-label={tr('قائمة المستخدم')} aria-expanded={open}><Avatar name={user.name} photo={user.photo} /></button>
      )}>
        <div className="it">
          <div style={{ fontWeight: 500 }}>{user.name}</div>
          <div className="sub">{user.email}</div>
          <div style={{ marginTop: 6, display: 'flex', gap: 6 }}><RoleBadge role={user.role} /><CampusBadge campus={user.campus} /></div>
          <span className="sr">{tr(ROLE_LABEL[user.role])}</span>
        </div>
        <button type="button" className="it" onClick={async () => { await logout(); toast.success(tr('تم تسجيل الخروج')); }}>
          <Icon name="logout" />{tr('تسجيل الخروج')}
        </button>
      </Popover>
    </header>
  );
}
