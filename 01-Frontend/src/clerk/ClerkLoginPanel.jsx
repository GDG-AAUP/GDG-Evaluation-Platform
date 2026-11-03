import { SignIn, useAuth } from '@clerk/clerk-react';
import { tr } from '../i18n/index.js';
import { Button } from '../components/ui/Primitives.jsx';

// Replaces the e-mail/password form of the login page when the real backend is used:
// accounts and passwords live in Clerk, not in our API.
export default function ClerkLoginPanel() {
  const { isSignedIn, signOut } = useAuth();

  // Signed in at Clerk, but the API did not accept the account (not invited / inactive / server down).
  if (isSignedIn) {
    return (
      <div>
        <p className="err" role="alert">
          {tr('تم تسجيل دخولك، لكن تعذّر تحميل حسابك. قد يكون حسابك غير فعّال أو غير مرتبط بدعوة مقبولة، أو أن الخادم غير متاح.')}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={() => window.location.reload()}>{tr('إعادة المحاولة')}</Button>
          <Button onClick={() => signOut()}>{tr('تسجيل الخروج')}</Button>
        </div>
      </div>
    );
  }

  // "virtual" routing keeps Clerk's steps in memory, so it does not fight our hash router.
  return (
    <SignIn
      routing="virtual"
      fallbackRedirectUrl={`${window.location.origin}${window.location.pathname}#/login`}
    />
  );
}
