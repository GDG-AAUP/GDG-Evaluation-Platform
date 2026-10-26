import { useState } from 'react';
import { NAV, bottomTabs } from '../../lib/nav.js';
import { Link } from '../../router/router.jsx';
import Icon from '../ui/Icon.jsx';
import { Dialog } from '../ui/Dialog.jsx';
import QuickLinks, { linksFor } from './QuickLinks.jsx';
import { tr } from '../../i18n/index.js';
import { USE_MOCK } from '../../config.js';
import { isComingSoon } from '../../lib/availability.js';

export function Sidebar({ role, path }) {
  return (
    <nav className="side" aria-label={tr('التنقل الرئيسي')}>
      {NAV[role].map((n) => (
        <Link key={n.to} to={n.to} className={(path === n.to ? 'on' : '') + (isComingSoon(n.to, USE_MOCK) ? ' soon' : '')} aria-current={path === n.to ? 'page' : undefined}>
          <Icon name={n.icon} /><span>{tr(n.label)}</span>
          {isComingSoon(n.to, USE_MOCK) && <small className="soon-tag">{tr('قريبًا')}</small>}
        </Link>
      ))}
      {linksFor(role).length > 0 && (
        <>
          <div className="side-h">{tr('روابط سريعة')}</div>
          <QuickLinks role={role} />
        </>
      )}
    </nav>
  );
}

export function BottomTabs({ role, path }) {
  const [more, setMore] = useState(false);
  const { tabs, more: hasMore } = bottomTabs(role);
  return (
    <>
      <nav className="tabs" aria-label={tr('التنقل السفلي')}>
        {tabs.map((n) => (
          <Link key={n.to} to={n.to} className={(path === n.to ? 'on' : '') + (isComingSoon(n.to, USE_MOCK) ? ' soon' : '')}><Icon name={n.icon} /><span>{tr(n.label)}</span></Link>
        ))}
        {hasMore && <button type="button" onClick={() => setMore(true)}><Icon name="menu" /><span>{tr('المزيد')}</span></button>}
      </nav>
      {more && (
        <Dialog title={tr('كل الصفحات')} onClose={() => setMore(false)}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {NAV[role].map((n) => (
              <Link key={n.to} to={n.to} onClick={() => setMore(false)} style={{ display: 'flex', gap: 10, padding: '10px 6px', borderBottom: '1px solid var(--bd)', color: 'var(--tx)' }}>
                <Icon name={n.icon} />{tr(n.label)}
              </Link>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
