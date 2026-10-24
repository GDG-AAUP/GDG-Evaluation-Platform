import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { devApi } from '../../services/index.js';
import { notifyUnauthorized } from '../../services/session.js';
import { HOME_BY_ROLE } from '../../lib/constants.js';
import { navigate } from '../../router/router.jsx';
import Icon from '../ui/Icon.jsx';
import { Button } from '../ui/Primitives.jsx';

/** Demo mode panel (mock backend only): role preview + failure simulation. */
export default function DemoPanel() {
  const { demoSwitch, logout } = useAuth();
  const toast = useToast();
  const to = async (role) => { await demoSwitch(role); navigate(HOME_BY_ROLE[role]); };
  return (
    <details className="demo">
      <summary><Icon name="eye" /> وضع العرض</summary>
      <div>
        <span className="sub">معاينة الأدوار</span>
        <Button small onClick={() => to('member')}>Member</Button>
        <Button small onClick={() => to('manager')}>Manager</Button>
        <Button small onClick={() => to('organizer')}>Organizer</Button>
        <span className="sub">محاكاة</span>
        <Button small onClick={() => { devApi.failNextRequest(); toast.success('سيفشل الطلب القادم مرة واحدة.'); }}>خطأ تحميل (مرة واحدة)</Button>
        <Button small onClick={() => { devApi.expireSession(); notifyUnauthorized(); }}>انتهاء الجلسة</Button>
        <Button small onClick={async () => { devApi.resetData(); await logout(); navigate('/login'); toast.success('أُعيدت البيانات التجريبية'); }}>إعادة ضبط البيانات</Button>
      </div>
    </details>
  );
}
