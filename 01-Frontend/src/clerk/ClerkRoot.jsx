import { Fragment, useRef } from 'react';
import { ClerkProvider, useAuth } from '@clerk/clerk-react';
import { setAuthProvider } from '../services/http.js';
import { Skeleton } from '../components/ui/States.jsx';

// Real-backend mode only (VITE_USE_MOCK=false). Loaded lazily from main.jsx, so the mock build
// never runs any Clerk code.
//
// What this does:
//   1. Waits until Clerk finished loading (otherwise the first /auth/me call has no token).
//   2. Registers the Clerk session as the HTTP auth provider: services/httpCore.js asks it for a
//      fresh Bearer token on EVERY request (tokens are short-lived and never stored).
//   3. Re-mounts the whole app whenever the user signs in or out, so every context reloads
//      with the right account.
function Bridge({ children }) {
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth();
  const fns = useRef({});
  fns.current = { getToken, signOut };

  // Registered during render on purpose: it must exist before the children's effects run.
  if (isLoaded && isSignedIn) {
    setAuthProvider({ getToken: () => fns.current.getToken(), signOut: () => fns.current.signOut() });
  } else if (isLoaded) {
    setAuthProvider(null);
  }

  if (!isLoaded) return <div style={{ padding: 24 }}><Skeleton /></div>;
  return <Fragment key={isSignedIn ? 'in' : 'out'}>{children}</Fragment>;
}

export default function ClerkRoot({ publishableKey, children }) {
  return (
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
      <Bridge>{children}</Bridge>
    </ClerkProvider>
  );
}
