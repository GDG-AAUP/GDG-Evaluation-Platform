import { useRef, useState } from 'react';
import { SignIn, useAuth, useUser } from '@clerk/clerk-react';
import { tr } from '../i18n/index.js';
import { Button } from '../components/ui/Primitives.jsx';
import { Field, Select } from '../components/ui/Form.jsx';
import { Async } from '../components/ui/States.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { CAMPUS, ROLE_LABEL } from '../lib/constants.js';
import { registrationsApi } from '../services/index.js';
import { useAuth as useProjectAuth } from '../context/AuthContext.jsx';

const PENDING_TEXT = 'تم إرسال طلب انضمامك إلى المنظمين، بانتظار الموافقة وتعيين الفريق/الحرم.';

/**
 * Signed in at Clerk without a project account: ask to join (name, campus, requested role and an
 * optional team). The email is taken from Clerk on the server. An organizer approves the request.
 */
function RegistrationRequestForm({ onSubmitted }) {
  const { user } = useUser();
  const state = useAsync(() => registrationsApi.options(), []);
  const [f, setF] = useState(() => ({ fullName: user ? user.fullName || '' : '', campus: 'jenin', role: 'member', teamId: '' }));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // Blocks a second click at once (state updates only on the next render).
  const sending = useRef(false);
  const set = (k) => (v) => { setF((s) => ({ ...s, [k]: v, ...(k === 'campus' || k === 'role' ? { teamId: '' } : {}) })); setErr(''); };

  const submit = async () => {
    if (sending.current) return;
    if (!f.fullName.trim()) { setErr(tr('الاسم الكامل مطلوب.')); return; }
    sending.current = true;
    setBusy(true);
    setErr('');
    try {
      await registrationsApi.submitRequest(f);
      onSubmitted();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
      sending.current = false;
    }
  };

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>{tr('طلب الانضمام إلى المنصة')}</h3>
      <p className="sub">{tr('أكمل البيانات التالية ليراجع المنظّمون طلبك ويعيّنوا دورك وفريقك. سيصلك بريد عند الموافقة.')}</p>
      <Async state={state}>
        {(opts) => {
          const teams = opts.teams.filter((t) => t.campus === f.campus);
          return (
            <>
              <Field label={tr('الاسم الكامل')}>
                {(id) => <input id={id} type="text" maxLength={100} value={f.fullName} placeholder={tr('مثال: سارة أحمد')} onChange={(e) => set('fullName')(e.target.value)} />}
              </Field>
              <div className="row2">
                <Field label={tr('الحرم')}>
                  {(id) => <Select id={id} value={f.campus} onChange={set('campus')} options={Object.entries(CAMPUS).map(([v, l]) => [v, tr(l)])} />}
                </Field>
                <Field label={tr('الدور المطلوب')}>
                  {(id) => <Select id={id} value={f.role} onChange={set('role')} options={Object.entries(ROLE_LABEL).map(([v, l]) => [v, tr(l)])} />}
                </Field>
              </div>
              {f.role !== 'organizer' && (
                <Field label={tr('الفريق المفضّل (اختياري)')}>
                  {(id) => <Select id={id} value={f.teamId} onChange={set('teamId')} options={[['', tr('بدون تفضيل')], ...teams.map((t) => [t.id, t.name])]} />}
                </Field>
              )}
              {f.role === 'organizer' && <p className="hint">{tr('طلبات دور المنظّم يراجعها المشرف العام.')}</p>}
              {err && <p className="err" role="alert">{err}</p>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button variant="primary" onClick={submit} disabled={busy}>{busy ? tr('جارٍ الإرسال…') : tr('إرسال الطلب')}</Button>
              </div>
            </>
          );
        }}
      </Async>
    </div>
  );
}

// Replaces the e-mail/password form of the login page when the real backend is used:
// accounts and passwords live in Clerk, not in our API.
export default function ClerkLoginPanel() {
  const { isSignedIn, signOut } = useAuth();
  const { accessCode } = useProjectAuth();
  const [submitted, setSubmitted] = useState(false);

  // Signed in at Clerk, but the API did not accept the account (no request yet / pending / refused).
  if (isSignedIn) {
    const pending = submitted || accessCode === 'REGISTRATION_PENDING';
    return (
      <div>
        {pending ? (
          <p role="status">{tr(PENDING_TEXT)}</p>
        ) : accessCode === 'REGISTRATION_REQUIRED' ? (
          <RegistrationRequestForm onSubmitted={() => setSubmitted(true)} />
        ) : accessCode === 'REGISTRATION_REJECTED' ? (
          <p className="err" role="alert">{tr('نعتذر، تم رفض طلب انضمامك إلى منصة GDG Evaluation Platform.')}</p>
        ) : (
          <p className="err" role="alert">
            {tr('تم تسجيل دخولك، لكن تعذّر تحميل حسابك. قد يكون حسابك غير فعّال أو غير مرتبط بدعوة مقبولة، أو أن الخادم غير متاح.')}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {pending && <Button variant="primary" onClick={() => window.location.reload()}>{tr('تحديث الحالة')}</Button>}
          {!pending && accessCode !== 'REGISTRATION_REQUIRED' && <Button variant="primary" onClick={() => window.location.reload()}>{tr('إعادة المحاولة')}</Button>}
          <Button onClick={() => signOut()}>{tr('تسجيل الخروج')}</Button>
        </div>
      </div>
    );
  }

  // "virtual" routing keeps Clerk's steps in memory, so it does not fight our hash router.
  return (
    <SignIn
      withSignUp
      routing="virtual"
      fallbackRedirectUrl={`${window.location.origin}${window.location.pathname}#/login`}
    />
  );
}
