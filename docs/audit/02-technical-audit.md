# Technical Audit: `mvp-backend-integration` (2026-11-11)

Method: code reading across the frontend, backend, chatbot and migrations, plus these executed checks: a fresh PostgreSQL build from migrations 001–008, the backend suite (540 tests), the frontend suite (51), the chatbot suite (52), live Gemini calls with the configured key, and a production frontend build compared with the original CSS. Not covered: a signed-in browser session, load testing, and any deployed environment.

## Chatbot 503 `ClientError`: fixed

**Root cause.** The code defaulted to `gemini-2.5-flash`, and Google now returns `404 NOT_FOUND: This model models/gemini-2.5-flash is no longer available to new users` for this key. The key itself is valid. Every chat failed and the service reported a generic 503.

| File | Change |
| --- | --- |
| `03-AI/Anas_Musleh/app/config.py` | Default model `gemini-3.8-flash`, Google's current recommendation. The key, model and internal key are trimmed of whitespace, BOM and quotes. |
| `03-AI/Anas_Musleh/app/server.py` | At startup, one real Gemini call checks the key and model and logs a clear result, also shown by `GET /health`. Failures log the exception type, message and full traceback. Responses carry a precise code: `AI_KEY_MISSING`, `AI_KEY_INVALID`, `AI_MODEL_UNAVAILABLE`, `AI_QUOTA_EXCEEDED`, `AI_REQUEST_REJECTED` or `AI_UNAVAILABLE`. |
| `03-AI/Anas_Musleh/app/llm.py` | Busy (503), rate-limited (429), retired (404) or slow models fall through to `GEMINI_FALLBACK_MODELS`. Each call has a 25-second limit, and a question stays on the model that answered. An invalid key is not retried. |
| `03-AI/Anas_Musleh/.env.example` | Documents the model, fallback, timeout and retry settings. |

Live verification on 2026-11-11, using your key on the clearly marked mock data:
- The startup check passed on `gemini-3.8-flash`.
- "How many points did I get in October 2026?" called `get_my_points(2026, 10)` and answered with 25 points, which is correct.
- "Delete Lina's points" was refused as read-only, with no tool call.
- During that run, 3.8 returned `504 DEADLINE_EXCEEDED` once and the fallback answered.
- Earlier the same day, 3.8 and 3.7 returned `503 high demand`, while 3.6, 3.5 and both lighter models answered.
| `02-Backend/src/phase2/assistant/assistant.routes.ts` | Passes only known codes as `error.reason`, maps a wrong internal key to `CHATBOT_KEY_MISMATCH`, and logs the reason without secrets. |

`gemini-1.5-flash` was not used: it is older than the retired 2.5 model.

## 1. Critical technical flaws (blockers)

| ID | Flaw | Evidence | Effect |
| --- | --- | --- | --- |
| B1 | Team editing has no backend | `client.js:192` throws 501 for any edit; no rename or campus-change route exists | Renaming a team, or changing its campus or managers from Campuses, always fails with "not available yet" |
| B2 | Creating a team silently drops the chosen managers | `Campuses.jsx:28` sends `managerIds`; `saveTeam` posts only name and campus | The team is created without managers and with no warning |
| B3 | Manager replacement is unreachable | `PATCH /api/teams/:id/manager` exists and is tested, but nothing in the frontend calls it | Replacing a team's manager is impossible from the UI |
| B4 | Point reversal has no UI | `POST /api/points/:id/reverse` works end to end, but no page calls `reversePoints` | Mistakes cannot be corrected from the app |
| B5 | Production builds default to mock mode | `config.js:4`: any value other than `false` enables mock data and the demo role switcher | A misconfigured deploy serves fake data with no real security |

## 2. Authorization and data-integrity risks

| ID | Risk | Status |
| --- | --- | --- |
| A1 | Global leaderboard merges Jenin and Ramallah | Campus rankings are separate on the server, but the frontend merges both campuses when the `globalLeaderboardEnabled` policy is on, which is the default. Turning the policy off enforces separation. |
| A2 | Reversal is dated today | Reversing a past month's entry lowers the current month's ranking. Archived snapshots are unaffected. |
| A3 | Ledger and audit rows are immutable only by convention | No triggers or `REVOKE`; anyone with the application's database role can update or delete them. |
| A4 | Any manager of a member's current team can reverse any of that member's entries | Includes entries an Organizer created, and entries earned on a previous team. |
| A5 | Verified-email fallback relinks any role | By your request; it also lets an invited user sign in without accepting the invitation. |
| A6 | Soft-deleted users keep their email | The unique `users.email` blocks re-inviting that address; the intended path is restore. |
| A7 | Chatbot uses the user's Clerk token for its whole run | Clerk session tokens are short-lived, so a slow answer (Gemini retries can add up to about 35 seconds) can fail with 401 partway. |

Verified sound, by code and tests:
- A Manager can only award points to active members of the team they manage (`check-recipient.ts`).
- Members are refused by every write endpoint and by every chatbot data route reserved for managers or organizers.
- Ranking SQL is per team or per campus; month boundaries use Asia/Hebron, tested with a UTC database session.
- The chatbot is read-only: every tool is a GET through the backend with the user's token, and its service accepts only the internal key.

## 3. Non-breaking inconsistencies

- **Missing indexes:** `users(team_id)`, `teams(campus_id)`, `point_entries(performed_by_user_id)`, and `audit_logs(action, entity_name)`. The last is scanned whenever the app checks which months are closed.
- **Late corrections:** `POST /api/archive/corrections` returns an honest 501. News is the only "Coming Soon" screen left.
- **System log retention:** `system_logs` has no retention or cleanup.
- **Rate limiting:** only the assistant is limited (20 questions per minute per user); there is no general API rate limiting or security headers.
- **Unlimited row counts:** the points ledger screen caps at 1,000 rows, while the activities screen loads every entry of a month.
- **Leftover mock frontend calls:** `/evaluations`, `/evaluations/:id` and `/evaluations/criteria`, plus `/points`, `/auth/login` and `/auth/logout`, are mock-mode only and unreachable with the real backend.
- **Shipped secret:** `links.config.js` ships a Microsoft To Do invitation token in the public bundle.
- **Removed noise:** the Clerk telemetry notice and the `[auth]` diagnostic logs appear only outside production.

Fixed in this pass:
- **PostgreSQL connection errors:** an idle connection that failed after a PostgreSQL restart could crash the backend. The pool now handles the error and replaces the connection (`config/db.js`).
- **Ignore rules:** `01-Frontend/.env`, `01-Frontend/.env.production` and root-level `.env`, `.venv/` and `node_modules/` were not ignored. A root `.gitignore` now covers every directory, and only `.env.example` files stay tracked.

## 4. Recommended action plan

1. **Team editing (B1–B3):** add `PATCH /api/teams/:id` taking `{name}` and, if wanted, `{campusId}`, validated for unique names per campus and audited. In the frontend data layer, make `saveTeam` call it, and map the manager choice to the existing `PATCH /api/teams/:id/manager`. When a team is created with managers, assign them, or refuse clearly instead of dropping them.
2. **Reversal (B4, A2, A4):** wire `reversePoints` to the existing button slot if a frozen screen has one, or approve a minimal addition. Date reversals to the original entry's month, or refuse reversals in closed months. Decide whether Managers may reverse Organizer entries.
3. **Production safety (B5):** fail the production build unless `VITE_USE_MOCK` is explicitly set.
4. **Migration 009:** add the four indexes above, plus triggers that reject `UPDATE` and `DELETE` on `point_entries` and `audit_logs` (A3).
5. **Hardening:**
   - Add `helmet` and a general rate limiter.
   - Add a `system_logs` retention job.
   - Move the To Do link to configuration.
   - Rotate the Clerk secret, database password and chatbot key that appeared in terminal output.
6. **Before handover:** a signed-in browser pass over every screen as each role, then a staging deployment with production settings.
