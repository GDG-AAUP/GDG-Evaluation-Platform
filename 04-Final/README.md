# 04-Final ΓÇö Release summary

Status of the GDG Evaluation Platform for staging and production. Start with the root [`README.md`](../README.md), which covers the architecture, the four-tier permission matrix and the key workflows.

## What ships

| Area | Final behaviour |
|---|---|
| **Onboarding** | Self-registration only. A person signs up with Clerk and sends the join-request form (name, campus, requested role, team). Every Organizer and Super Admin is notified: header badge, dashboard card, and `pendingRegistrationsCount`. Any Organizer approves (┬½┘à┘ê╪º┘ü┘é╪⌐ ┘ê╪¬╪╣┘è┘è┘å┬╗, Approve & Assign) or rejects (┬½╪▒┘ü╪╢┬╗). The applicant gets an HTML + text email either way. `POST /api/users` answers `405`. |
| **Hierarchy** | Super Admin: every account and team except Super Admin accounts. Organizer: Members, Managers and teams of its own campus; read-only elsewhere. Only Super Admins handle Organizer accounts and the Organizer role. |
| **Restore & Reassign** | Archived accounts come back active with an explicit role, campus and team. A taken manager seat is a `409`. A campus Organizer restores within its campus, as Member or Manager. |
| **Leaderboard** | Every role: both campuses together (with campus badges), one campus, or one team. DENSE_RANK (1, 1, 2), month points only. |
| **Governance** | Three Super Admin switches, all off by default and audited: Organizers may evaluate Members; Jenin ΓåÆ Ramallah delegation; Ramallah ΓåÆ Jenin delegation. Organizers and Super Admins are never evaluated. |
| **Points** | ΓêÆ100ΓÇª+100, nonzero. Idempotency key plus a 10-second duplicate guard. A reversal at most once per entry, dated in the original month. Closed months are corrected through audited compensating entries that re-rank the snapshot. |
| **Manager evaluations** | Four criteria, each 0ΓÇô100, weighted total. Several per month, with an arithmetic monthly mean. |
| **Assistant** | Read-only, called with the user's own token, reachable only through the backend. Quick answers work without Gemini. |

## Verification at release

| Suite | Result |
|---|---|
| Backend (`02-Backend`, `npm test` with PostgreSQL) | 615 / 615 |
| Frontend (`01-Frontend`, `npm test`) | 84 / 84 |
| Chatbot (`03-AI/Anas_Musleh`, `pytest`) | 69 / 69 |
| Frontend production build (`npm run build`) | Passes; CSS bundle hash unchanged (`acb92eef`) |

End-to-end tests run on real PostgreSQL in throwaway schemas, with Clerk and SMTP faked:
- `user-hierarchy.db.test.js`
- `registrations.db.test.js`
- `governance-super-admin.db.test.js`
- `organizer-management.db.test.js`

They cover:
- the request ΓåÆ badge count ΓåÆ approve (account, email with role/campus/team/link, audit) ΓåÆ count decreases flow
- reject (email with reason, audit)
- campus-scoped restore, and the 409 on a taken manager seat
- team-endpoint campus scope
- the both-campus leaderboard with dense ties
- governance toggles

## Security review (release audit)

| Finding | Severity | Resolution |
|---|---|---|
| Team endpoints (create, rename, change manager, (de)activate) had no campus scope, so an Organizer could change the other campus's teams and move managers across campuses. | High | Fixed: a regular Organizer is limited to its own campus (`OUT_OF_CAMPUS_SCOPE`); Super Admins keep both campuses. Tested. |
| Clerk tokens issued to any origin of the same Clerk instance were accepted. | Medium | Fixed: in production, `authorizedParties` is set to `CORS_ORIGINS`. |
| `CLERK_SETUP.md` told operators to make Clerk sign-up invitation-only, which would block every new member. | Medium (operational) | Fixed in the docs: public sign-up with required email verification. |
| `DATABASE_URL` from hosting providers was ignored. | Low | Supported now (used when `DB_HOST` is unset); TLS via `PGSSLMODE` or `?sslmode=`. |
| Assistant | ΓÇö | Verified read-only. GET calls only, with the user's own token; the internal key is compared in constant time; no secrets are logged. |

## Before going live

1. Apply migrations up to **012** on the production database (back up first). See [`02-Backend/db/README.md`](../02-Backend/db/README.md).
2. Set every variable in the deployment checklist ([`DEPLOYMENT_GUIDE.md`](../DEPLOYMENT_GUIDE.md) ΓåÆ *Release checklist*):
   - **Clerk:** live keys from the same instance on the frontend and backend.
   - **`SUPER_ADMIN_CLERK_IDS`:** the live Clerk user IDs.
   - **Email:** `SMTP_*`, `FROM_EMAIL` and `APP_LOGIN_URL`.
   - **`CORS_ORIGINS`:** the Vercel domain.
3. Give every regular Organizer a campus (Super Admin ΓåÆ **╪º┘ä╪ú╪╣╪╢╪º╪í ΓåÆ ╪º┘ä┘à┘å╪╕┘æ┘à┘ê┘å**, Members ΓåÆ Organizers). Without one it can read, and approve or reject join requests, but not manage, restore or evaluate.
4. Run [`QA_TESTING_CHECKLIST.md`](../QA_TESTING_CHECKLIST.md) on staging, including a real inbox for the approval and rejection emails.

## Known considerations

- **Notifications poll** every 20 s and on tab focus. There is no push channel, so a new request can take up to 20 s to appear for an Organizer who keeps the tab open in the foreground.
- **The Organizer role** can be given only by a Super Admin, including when approving a join request. Regular Organizers can approve any request as Member or Manager.
- **A Member always has exactly one team.** The database enforces it, so restoring or approving a Member requires a team.
