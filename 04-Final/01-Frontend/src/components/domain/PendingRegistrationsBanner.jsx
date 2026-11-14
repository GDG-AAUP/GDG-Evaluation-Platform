import { useEffect, useState } from 'react';
import { tr } from '../../i18n/index.js';
import { registrationsApi } from '../../services/index.js';
import { navigate } from '../../router/router.jsx';
import Icon from '../ui/Icon.jsx';
import { Button } from '../ui/Primitives.jsx';

/**
 * Dashboard notification: pending registration requests this approver may decide (the server
 * scopes the count: Super Admin all; Organizer its campus's Member/Manager requests). Hidden at 0.
 */
export default function PendingRegistrationsBanner() {
  const [count, setCount] = useState(0);

  useEffect(() => {
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
  }, []);

  if (!count) return null;
  return (
    <div className="banner b" role="status" style={{ marginBottom: 14 }}>
      <Icon name="user-plus" />
      <span style={{ flex: 1 }}>
        {count === 1
          ? tr('يوجد طلب انضمام واحد بانتظار المراجعة والتعيين.')
          : tr('توجد {n} طلبات انضمام بانتظار المراجعة والتعيين.', { n: count })}
      </span>
      <Button small variant="primary" onClick={() => navigate('/organizer/registrations')}>{tr('مراجعة الطلبات')}</Button>
    </div>
  );
}
