import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { USE_MOCK, CLERK_PUBLISHABLE_KEY } from './config.js';
import { invitationRedirect } from './lib/invitation.js';
import { tr } from './i18n/index.js';
import './styles/tokens.css';
import './styles/app.css';

// Clerk is only used with the real backend (VITE_USE_MOCK=false). Lazy, so the mock build never runs it.
const ClerkRoot = lazy(() => import('./clerk/ClerkRoot.jsx'));

function MissingKey() {
  return (
    <div style={{ padding: 24, maxWidth: 560, margin: '40px auto', lineHeight: 1.8 }}>
      <h2>{tr('إعداد ناقص')}</h2>
      <p>{tr('الوضع الحقيقي (VITE_USE_MOCK=false) يحتاج مفتاح Clerk العام. أضف السطر التالي إلى الملف .env.local ثم أعد تشغيل التطبيق:')}</p>
      <pre dir="ltr" style={{ background: 'rgba(127,127,127,.15)', padding: 12, borderRadius: 8 }}>VITE_CLERK_PUBLISHABLE_KEY=pk_test_...</pre>
    </div>
  );
}

function mount() {
  let tree;
  if (USE_MOCK) tree = <App />;
  else if (!CLERK_PUBLISHABLE_KEY) tree = <MissingKey />;
  else tree = <Suspense fallback={null}><ClerkRoot publishableKey={CLERK_PUBLISHABLE_KEY}><App /></ClerkRoot></Suspense>;
  createRoot(document.getElementById('root')).render(<StrictMode>{tree}</StrictMode>);
}

// The backend only accepts a plain-path invitation URL (no "#"): /accept-invitation?__clerk_ticket=...
// The app uses a hash router, so convert it once before rendering (see lib/invitation.js).
const target = invitationRedirect(window.location);
if (target) window.location.replace(target);
else mount();

import "./styles/refresh.css";
