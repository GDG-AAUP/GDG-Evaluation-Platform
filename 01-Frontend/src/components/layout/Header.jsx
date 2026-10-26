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

const NOTES = {
  member: ['افتح بطاقات التقييم لمراجعة تقييمك الشهري.', 'تابع نجوم الشهر من صفحة المجتمع.'],
  manager: ['يمكنك تقييم أعضاء فريقك في فرعك فقط.', 'الحد الأعلى للبطاقة 100 نقطة.'],
  organizer: ['اختر عضو الشهر من صفحة نجوم الشهر.', 'انشر أخبار المجتمع من صفحة الأخبار.'],
};

export default function Header() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const toast = useToast();

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
        <button type="button" className="ib" onClick={tg} aria-label={tr('الإشعارات')} aria-expanded={open}><Icon name="bell" /></button>
      )}>
        <div className="it" style={{ fontWeight: 500 }}>{tr('إرشادات المجتمع')}</div>
        {NOTES[user.role].map((n) => <div key={n} className="it">{tr(n)}</div>)}
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
