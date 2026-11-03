# Clerk sign-in and invitations (real backend)

Only used when `VITE_USE_MOCK=false`. With the mock backend nothing here runs.

## 1. One-time setup

```bash
cd 01-Frontend
npm install @clerk/clerk-react@5      # adds the dependency to package.json + package-lock.json (commit both)
```

Create `01-Frontend/.env.local` (ignored by git):

```
VITE_USE_MOCK=false
VITE_API_URL=http://localhost:3001/api
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxx
```

- The **publishable** key (`pk_test_...`) is public and safe in the browser.
- Never put the **secret** key (`sk_...`) in the frontend. It belongs only in `02-Backend/.env`.
- Restart `npm run dev` after changing `.env.local`. If the key is missing, the app shows a "Missing setup" screen instead of crashing.

The backend must be running on port 3001 with its own `.env` (`CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_INVITATION_REDIRECT_URL`) and migrations 002–005 applied.

## 2. Invitation link (important)

`02-Backend` **rejects** a `CLERK_INVITATION_REDIRECT_URL` that contains a `#fragment` or a query string
(see `02-Backend/docs/account-invitations.md`). Our router is hash-based, so use the plain path:

```
CLERK_INVITATION_REDIRECT_URL=http://localhost:5173/accept-invitation
```

Clerk appends `?__clerk_ticket=...&__clerk_status=...`. On start-up `src/main.jsx` converts
`/accept-invitation?...` into `/?...#/accept-invitation` (`src/lib/invitation.js`), so the page works without changing the router.

Production: the host must serve `index.html` for `/accept-invitation` (SPA fallback / rewrite rule) and use HTTPS.

## 3. How it works

| Piece | File |
|---|---|
| Provider, waits for Clerk, registers the token provider, re-mounts the app on sign-in/out | `src/clerk/ClerkRoot.jsx` |
| Sign-in on `/#/login` (Clerk component, virtual routing so it does not fight the hash router) | `src/clerk/ClerkLoginPanel.jsx` |
| Invitation page `/#/accept-invitation`: Clerk sign-up/sign-in with the ticket, then `POST /api/auth/complete-registration` with `{}` | `src/clerk/AcceptInvitation.jsx` |
| Fresh `Authorization: Bearer <Clerk session token>` on every API call | `src/services/http.js` + `httpCore.js` |
| Current user = `GET /api/auth/me` (role, team) | `src/services/auth.js` |

Flow: organizer creates a user (`POST /api/users`) → Clerk e-mails the invitation → recipient opens `/accept-invitation` → signs up → the page calls `complete-registration` → lands on the role's home page.

## 4. Things to check with the real Clerk instance

This code was verified against a stand-in for `@clerk/clerk-react` (same props/hooks we use), not against Clerk itself. On first real run, check:

1. `/#/login` shows Clerk's sign-in and signing in lands on the home page.
2. An invitation link opens the sign-up form with the invited e-mail already filled in (Clerk reads `__clerk_ticket` from the URL).
3. After sign-up the app calls `complete-registration` and opens the home page.
4. In the Clerk dashboard, make sign-up invitation-only (no public sign-ups).
5. Clerk's own form text is English by default; Arabic needs the separate `@clerk/localizations` package.
