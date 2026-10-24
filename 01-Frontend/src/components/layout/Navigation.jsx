import { useState } from 'react';
import { NAV, bottomTabs } from '../../lib/nav.js';
import { Link } from '../../router/router.jsx';
import Icon from '../ui/Icon.jsx';
import { Dialog } from '../ui/Dialog.jsx';
import QuickLinks, { linksFor } from './QuickLinks.jsx';

export function Sidebar({ role, path }) {
  return (
    <nav className="side" aria-label="التنقل الرئيسي">
      {NAV[role].map((n) => (
        <Link key={n.to} to={n.to} className={path === n.to ? 'on' : ''} aria-current={path === n.to ? 'page' : undefined}>
          <Icon name={n.icon} /><span>{n.label}</span>
        </Link>
      ))}
      {linksFor(role).length > 0 && (
        <>
          <div className="side-h">روابط سريعة</div>
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
      <nav className="tabs" aria-label="التنقل السفلي">
        {tabs.map((n) => (
          <Link key={n.to} to={n.to} className={path === n.to ? 'on' : ''}><Icon name={n.icon} /><span>{n.label}</span></Link>
        ))}
        {hasMore && <button type="button" onClick={() => setMore(true)}><Icon name="menu" /><span>المزيد</span></button>}
      </nav>
      {more && (
        <Dialog title="كل الصفحات" onClose={() => setMore(false)}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {NAV[role].map((n) => (
              <Link key={n.to} to={n.to} onClick={() => setMore(false)} style={{ display: 'flex', gap: 10, padding: '10px 6px', borderBottom: '1px solid var(--bd)', color: 'var(--tx)' }}>
                <Icon name={n.icon} />{n.label}
              </Link>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
