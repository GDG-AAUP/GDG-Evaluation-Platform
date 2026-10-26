import { tr } from '../i18n/index.js';
import { useState } from 'react';
import { USE_MOCK } from '../config.js';
import { useAuth } from '../context/AuthContext.jsx';
import { DirectionToggle } from '../context/DirectionContext.jsx';
import { homeFor } from '../lib/home.js';
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
    if (!isEmail(email)) next.email = tr('أدخل بريدًا إلكترونيًا صحيحًا');
    if (!pw) next.pw = tr('كلمة المرور مطلوبة');
    setErrs(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const u = await login(email.trim().toLowerCase(), pw);
      navigate(homeFor(u.role));
    } catch (err) {
      setErrs({ form: tr(err.message) });
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div style={{ position: 'fixed', insetBlockStart: 12, insetInlineEnd: 12 }}><DirectionToggle /></div>
      <div className="lc">
        <ColorBar />
        <div className="in">
          <div className="lg"><Logo size={56} /><h1>{tr('مجتمع GDG AAUP')}</h1><div className="sub">{tr('منصة تقييم وإدارة أعضاء GDG')}</div></div>
          <a href="#/">{tr('← العودة لصفحة المجتمع')}</a><h2 style={{ marginBottom: 4 }}>{tr('تسجيل الدخول')}</h2>
          <p style={{ margin: '0 0 14px', color: 'var(--tx2)' }}>{tr('ادخل ببيانات حسابك في المنصة.')}</p>
          <form onSubmit={submit} noValidate>
            <div className="f">
              <label htmlFor="lem">{tr('البريد الإلكتروني')}</label>
              <input id="lem" type="email" autoComplete="username" placeholder="name@gdg.ps" dir="ltr" style={{ textAlign: 'start' }} value={email} onChange={(e) => setEmail(e.target.value)} />
              {errs.email && <p className="err" role="alert">{errs.email}</p>}
            </div>
            <div className="f">
              <label htmlFor="lpw">{tr('كلمة المرور')}</label>
              <div style={{ position: 'relative' }}>
                <input id="lpw" type={show ? 'text' : 'password'} autoComplete="current-password" placeholder={tr('كلمة المرور')} value={pw} onChange={(e) => setPw(e.target.value)} />
                <button type="button" className="ib" aria-label={show ? tr('إخفاء كلمة المرور') : tr('إظهار كلمة المرور')} onClick={() => setShow((s) => !s)} style={{ position: 'absolute', insetInlineEnd: 2, top: 1 }}>
                  <Icon name={show ? 'eye-off' : 'eye'} />
                </button>
              </div>
              {errs.pw && <p className="err" role="alert">{errs.pw}</p>}
            </div>
            {errs.form && <p className="err" role="alert">{errs.form}</p>}
            <Button variant="primary" full type="submit" disabled={busy}>{busy ? <><Spinner /> {tr('جارٍ الدخول')}</> : tr('تسجيل الدخول')}</Button>
          </form>
          <p style={{ textAlign: 'center', margin: '12px 0 0' }}>
            <a href="#/login" onClick={(e) => { e.preventDefault(); setForgot(true); }}>{tr('نسيت كلمة المرور؟')}</a>
          </p>
          {USE_MOCK && (
            <div className="acct">
              <div style={{ marginBottom: 6 }}>{tr('حسابات تجريبية (كلمة المرور {pw})', { pw: '\u0001' }).split('\u0001')[0]}<code>123456</code>{tr('حسابات تجريبية (كلمة المرور {pw})', { pw: '\u0001' }).split('\u0001')[1]}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {DEMO.map(([l, em]) => <Button key={em} small onClick={() => { setEmail(em); setPw('123456'); setErrs({}); }}>{tr(l)}</Button>)}
              </div>
            </div>
          )}
        </div>
      </div>
      {forgot && (
        <MessageDialog title={tr('نسيت كلمة المرور؟')} onClose={() => setForgot(false)}>
          {tr('لا تُعاد كلمة المرور تلقائيًا. تواصل مع المنظّم ليعيّن لك كلمة مرور مؤقتة.')}
        </MessageDialog>
      )}
    </div>
  );
}
