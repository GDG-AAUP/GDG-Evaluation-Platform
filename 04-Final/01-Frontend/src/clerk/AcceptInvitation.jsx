import { useEffect, useRef, useState } from 'react';
import { SignIn, SignUp, useAuth } from '@clerk/clerk-react';
import { tr } from '../i18n/index.js';
import { authApi } from '../services/index.js';
import { homeFor } from '../lib/home.js';
import { parseInvitation, INVITE_ROUTE } from '../lib/invitation.js';
import Logo, { ColorBar } from '../components/layout/Logo.jsx';
import { Button, Spinner } from '../components/ui/Primitives.jsx';

// Page opened from the invitation e-mail (CLERK_INVITATION_REDIRECT_URL -> /accept-invitation).
//   1. Not signed in  -> Clerk's sign-up (or sign-in, for an existing Clerk user) with the ticket from the URL.
//   2. Signed in      -> POST /api/auth/complete-registration with an EMPTY body, then go to the app.
function Shell({ children }) {
  return (
    <div className="login">
      <div className="lc">
        <ColorBar />
        <div className="in">
          <div className="lg"><Logo size={56} /><h1>{tr('مجتمع GDG AAUP')}</h1><div className="sub">{tr('قبول الدعوة')}</div></div>
          {children}
        </div>
      </div>
    </div>
  );
}

export default function AcceptInvitation() {
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const { ticket, status } = parseInvitation(window.location.search);
  const [error, setError] = useState('');
  const started = useRef(false);
  const back = `${window.location.origin}${window.location.pathname}#${INVITE_ROUTE}`;

  useEffect(() => {
    if (!isLoaded || !isSignedIn || started.current) return;
    started.current = true;
    authApi.completeRegistration()
      .then((u) => {
        // Full navigation without the ?__clerk_ticket query, straight to the role's landing page.
        window.location.replace(`${window.location.pathname}#${homeFor(u.role)}`);
      })
      .catch((e) => setError(e.message || tr('تعذّر إكمال التسجيل.')));
  }, [isLoaded, isSignedIn]);

  if (!isLoaded) return <Shell><Spinner /></Shell>;

  if (isSignedIn) {
    return (
      <Shell>
        {error ? (
          <>
            <p className="err" role="alert">{error}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button onClick={() => signOut()}>{tr('تسجيل الخروج')}</Button>
              <a href="#/login">{tr('العودة لتسجيل الدخول')}</a>
            </div>
          </>
        ) : (
          <p style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Spinner /> {tr('جارٍ ربط حسابك…')}</p>
        )}
      </Shell>
    );
  }

  if (!ticket || status === 'complete') {
    return (
      <Shell>
        <p>{status === 'complete' ? tr('تم قبول هذه الدعوة من قبل. سجّل الدخول للمتابعة.') : tr('رابط الدعوة غير صالح أو منتهي. اطلب من المنظّم دعوة جديدة.')}</p>
        <a href="#/login">{tr('الذهاب لتسجيل الدخول')}</a>
      </Shell>
    );
  }

  return (
    <Shell>
      {status === 'sign_in'
        ? <SignIn routing="virtual" forceRedirectUrl={back} />
        : <SignUp routing="virtual" forceRedirectUrl={back} />}
    </Shell>
  );
}
