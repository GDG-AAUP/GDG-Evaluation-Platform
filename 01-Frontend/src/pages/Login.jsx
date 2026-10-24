import { useState } from 'react';
import { USE_MOCK } from '../config.js';
import { useAuth } from '../context/AuthContext.jsx';
import { HOME_BY_ROLE } from '../lib/constants.js';
import { isEmail } from '../lib/format.js';
import { navigate } from '../router/router.jsx';
import Logo, { ColorBar } from '../components/layout/Logo.jsx';
import Icon from '../components/ui/Icon.jsx';
import { Button, Spinner } from '../components/ui/Primitives.jsx';
import { MessageDialog } from '../components/ui/Dialog.jsx';

const DEMO = [['عضو', 'member@gdg.ps'], ['مدير', 'manager@gdg.ps'], ['منظّم', 'organizer@gdg.ps']];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const next = {};
    if (!isEmail(email)) next.email = 'أدخل بريدًا إلكترونيًا صحيحًا';
    if (!pw) next.pw = 'كلمة المرور مطلوبة';
    setErrs(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const u = await login(email.trim().toLowerCase(), pw);
      navigate(HOME_BY_ROLE[u.role]);
    } catch (err) {
      setErrs({ form: err.message });
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="lc">
        <ColorBar />
        <div className="in">
          <div className="lg"><Logo size={56} /><h1>مجتمع GDG AAUP</h1><div className="sub">منصة تقييم وإدارة أعضاء GDG</div></div>
          <a href="#/">← العودة لصفحة المجتمع</a><h2 style={{ marginBottom: 4 }}>تسجيل الدخول</h2>
          <p style={{ margin: '0 0 14px', color: 'var(--tx2)' }}>ادخل ببيانات حسابك في المنصة.</p>
          <form onSubmit={submit} noValidate>
            <div className="f">
              <label htmlFor="lem">البريد الإلكتروني</label>
              <input id="lem" type="email" autoComplete="username" placeholder="name@gdg.ps" dir="ltr" style={{ textAlign: 'start' }} value={email} onChange={(e) => setEmail(e.target.value)} />
              {errs.email && <p className="err" role="alert">{errs.email}</p>}
            </div>
            <div className="f">
              <label htmlFor="lpw">كلمة المرور</label>
              <div style={{ position: 'relative' }}>
                <input id="lpw" type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="كلمة المرور" value={pw} onChange={(e) => setPw(e.target.value)} />
                <button type="button" className="ib" aria-label={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} onClick={() => setShow((s) => !s)} style={{ position: 'absolute', insetInlineEnd: 2, top: 1 }}>
                  <Icon name={show ? 'eye-off' : 'eye'} />
                </button>
              </div>
              {errs.pw && <p className="err" role="alert">{errs.pw}</p>}
            </div>
            {errs.form && <p className="err" role="alert">{errs.form}</p>}
            <Button variant="primary" full type="submit" disabled={busy}>{busy ? <><Spinner /> جارٍ الدخول</> : 'تسجيل الدخول'}</Button>
          </form>
          <p style={{ textAlign: 'center', margin: '12px 0 0' }}>
            <a href="#/login" onClick={(e) => { e.preventDefault(); setForgot(true); }}>نسيت كلمة المرور؟</a>
          </p>
          {USE_MOCK && (
            <div className="acct">
              <div style={{ marginBottom: 6 }}>حسابات تجريبية (كلمة المرور <code>123456</code>)</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {DEMO.map(([l, em]) => <Button key={em} small onClick={() => { setEmail(em); setPw('123456'); setErrs({}); }}>{l}</Button>)}
              </div>
            </div>
          )}
        </div>
      </div>
      {forgot && (
        <MessageDialog title="نسيت كلمة المرور؟" onClose={() => setForgot(false)}>
          لا تُعاد كلمة المرور تلقائيًا. تواصل مع المنظّم ليعيّن لك كلمة مرور مؤقتة.
        </MessageDialog>
      )}
    </div>
  );
}
