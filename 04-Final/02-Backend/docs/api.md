# GDG Backend API

Base URL: `http://localhost:3001`. Business data is stored in PostgreSQL. Send JSON bodies with `Content-Type: application/json`.

## Authentication

Send `Authorization: Bearer <Clerk session token>`. Accounts are not created by hand. A person signs up at Clerk; until they submit a request their calls answer `403 REGISTRATION_REQUIRED`. They then submit `POST /api/registrations/request` (`403 REGISTRATION_PENDING` until it is decided, `403 REGISTRATION_REJECTED` after a rejection), and any Organizer approves it. In production (`NODE_ENV=production`) tokens are only accepted from the origins in `CORS_ORIGINS` (Clerk `authorizedParties`). Clerk verifies identity; PostgreSQL supplies current project role, active state and deletion state. Client-supplied roles do not establish identity. Inactive/deleted accounts are blocked. API roles are lowercase; database roles are Organizer, Manager and Member.

## Endpoints

| Method | Path | Access | Body or purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | Public | Server health |
| GET | `/api/ready` | Public | Database readiness |
| GET | `/api/auth/me` | Active linked user | Current account and role |
| POST | `/api/auth/complete-registration` | Clerk session | Empty body `{}`; accepted invitation linking |
| GET | `/api/admin/check` | Organizer | Role check |
| GET | `/api/campuses` | Active linked user | Campus list |
| GET | `/api/campuses/:id` | Active linked user | Campus details |
| GET | `/api/teams` | Active linked user | Optional `campusId` query |
| GET | `/api/teams/:id` | Active linked user | Team details |
| GET | `/api/teams/:id/members` | Organizer or assigned Manager | Active members |
| POST | `/api/teams` | Super Admin (either campus) or Organizer (own campus) | `name`, `campusId`, optional `description` |
| PATCH | `/api/teams/:id` | Super Admin, or Organizer for a team of its campus | `name` and/or `managerId` (null removes), `reason`; one manager per team (409 `TEAM_MANAGER_EXISTS`), one team per manager; a regular Organizer cannot bring in a manager from the other campus (403 `OUT_OF_CAMPUS_SCOPE`); history + audit in one transaction |
| PATCH | `/api/teams/:id/status` | Super Admin, or Organizer for a team of its campus | `isOperational` boolean |
| PATCH | `/api/teams/:id/manager` | Super Admin, or Organizer for a team of its campus | `managerId`, `expectedManagerId`, `reason` |
| GET | `/api/users` | Organizer | Every non-deleted user of both campuses, with `campusId` (Organizers) and `isSuperAdmin` |
| GET | `/api/registrations` | Organizer | Every request (both campuses, every role); `status` query `pending` (default), `approved` or `rejected` |
| GET | `/api/registrations/count` | Organizer | `{ pending }` for the header badge (all pending requests) |
| POST | `/api/registrations/:id/approve` | Organizer | `role` (organizer/manager/member), `campusId`, `teamId` (manager/member). Any Organizer, either campus; the Organizer role only by a Super Admin (403 `ORGANIZER_MANAGEMENT_RESTRICTED`). Validates the team's campus and a free manager seat in the transaction, creates the active account, writes history + audit, then emails the person (HTML + text) |
| POST | `/api/registrations/:id/reject` | Organizer | Optional `reason` (up to 1000 characters); audits and emails the person (HTML + text, reason included) |
| PATCH | `/api/users/:id` | Super Admin, or Organizer for Members/Managers of its campus | Changed `name`, `email`, `role`, `teamId`, `campusId` (Organizers), `isActive`; required `reason` |
| PATCH | `/api/users/:id/status` | Same scope as above | `isActive` boolean |
| POST | `/api/users/:id/invitations/review` | Organizer | `{}`; no email sent |
| POST | `/api/users/:id/invitations/resend` | Organizer | `{}`; explicit replacement invitation |
| DELETE | `/api/users/:id` | Same scope as above | `reason` |
| GET | `/api/users/deleted` | Organizer | Deleted users |
| POST/PATCH | `/api/users/:id/restore` | Super Admin (any account), or Organizer with a campus (former Members/Managers of its campus or with no campus, into its campus, as Member/Manager) | Restore & Reassign: `{role, campusId, teamId (member/manager), reason}`; the account returns **active** with that assignment; a Manager needs a free seat (`409 RESTORE_TEAM_MANAGER_EXISTS`); previous and restored assignments are audited. See [deletion and restoration](user-deletion.md) |
| GET | `/api/rankings/options` | Public | Campuses and teams for filters |
| GET | `/api/rankings/public-summary` | Public | `campusId`; current-month Top 3 and team leaders, without user IDs |
| GET | `/api/rankings`, `/api/rankings/archived` | Active linked user (every role) | `year`, `month` and either `scope=team&teamId`, `scope=campus&campusId`, `scope=all` (both campuses), or the shortcut `campus=all\|jenin\|ramallah`. Members and Managers, month-only totals, `DENSE_RANK` (1, 1, 2). The combined board adds `campusId`/`campusName` to each row (the campus of the person's latest assignment that month; for a closed month, the campus snapshots are added up per person) |
| GET | `/api/rankings/months` | Active linked user | Closed months, oldest first |
| GET | `/api/points/me` | Active linked user | Optional `year`, `month`, `limit` (default 50, max 500) |
| GET | `/api/points/me/summary` | Active linked user | Optional `year`, `month`; totals from SQL `SUM` |
| GET | `/api/points/team-history` | Manager (team they manage) or Organizer (entries they recorded) | Optional `year`+`month` (default current), `limit` (max 500, default 200); entries with recipient, points, activity, reason, time, recorder, `awardedByMe`; month totals per person and for the team |
| POST | `/api/points` | Organizer (any Member or Manager) or Manager (own team members) | `{userId, points (-100..100, ≠0), activityName, reason, activityDescription?}`; optional `Idempotency-Key` header (a retry returns the first entry, 200); an identical entry within 10 s is refused (409 `DUPLICATE_POINT_SUBMISSION`) |
| POST | `/api/points/:entryId/reverse` | Organizer (any entry) or Manager (entries of their own team) | `{reason}`; at most once, `-points`, dated at the original instant (same month); audit `old_values` = original, `new_values` = reversal; a closed month is re-ranked |
| GET | `/api/teams/:id/overview` | Organizer or assigned Manager | Manager dashboard |
| GET | `/api/overview`, `/api/dashboard/ratings` | Organizer | Organizer overview |
| GET | `/api/ratings/ledger` | Organizer | Optional `month`, `campus`, `teamId`, `kind`; newest 1000 point entries |
| GET | `/api/activities` | Active linked user, scoped by role | Optional `month`; ledger-based activity overview |
| POST | `/api/activities` | Organizer or team Manager | `{userId,label,points,description,month}`; 0 to 99 points, running month only |
| GET | `/api/ratings/targets`, `/api/ratings/:userId` | Evaluators; self or evaluator | 15-item scorecards |
| POST | `/api/ratings` | Organizer or team Manager | `{userId,month,scores,reason,expectedRev}`; each save is a new revision |
| GET | `/api/awards` | Active linked user | Optional `campus`, `month`; team leaders and member of the month |
| POST | `/api/awards` | Organizer | `{campus,month,userId}`; must be a current team leader |
| GET | `/api/policies` | Active linked user | Current policy values |
| PUT | `/api/policies`, `/api/policies/:key` | Organizer | `{key,value}` or `{value}`; audited |
| GET | `/api/syslog` | Organizer | Optional `level`, `page`, `pageSize` |
| GET | `/api/archive`, `/api/archive/:month` | Organizer or Manager | Month list, closed-month corrections and correctable people (Manager: own team); snapshot, optional `campus` or `teamId` |
| POST | `/api/archive/close` | Organizer | Optional `{year, month}`; publishes a dense-ranked snapshot of an ended month |
| POST | `/api/archive/corrections` | Organizer (any team) or Manager (own current team, never self) | `{month: 'YYYY-MM' (past), userId, value (-100..100, ≠0), reason}`; immutable compensating entry inside that month; a closed month's Team and Campus rankings are recomputed in the same transaction (`last_revised_at`, one `MONTHLY_RANKING_REVISED` audit row with before/after per changed row) |
| POST | `/api/assistant` | Active linked user | `{question}`; proxied to the private chatbot service |
| GET | `/api/assistant/data/*` | Active linked user, per-route rules | Read-only chatbot data |
| POST | `/api/registrations/request` | Signed-in Clerk user without an account | `{fullName?, role: member\|manager\|organizer, campusId, teamId?}`; email from Clerk (verified). 201 new / 200 updated pending request; `ALREADY_REGISTERED`, `REGISTRATION_REJECTED`, `EMAIL_NOT_VERIFIED`, `EMAIL_ALREADY_REQUESTED` |
| GET | `/api/registrations/pending` | Organizer | Every pending request (both campuses, every requested role, legacy requests without details too) plus `count`; `/api/auth/me` returns the same `pendingRegistrationsCount` to every Organizer |
| POST | `/api/users` | — | Disabled: `405 MANUAL_CREATION_DISABLED`. Every account comes from a registration request approved with «موافقة وتعيين» |
| GET | `/api/governance/settings` | Organizer (Super Admins included) | `{allowOrganizerMemberEval, allowJeninEvalRamallah, allowRamallahEvalJenin, updatedBy, updatedAt, canEdit}` |
| PATCH | `/api/governance/settings` | Super Admin only (`403 SUPER_ADMIN_REQUIRED`) | Any of the three booleans plus an optional `reason`; audited as `GOVERNANCE_SETTINGS_UPDATED` with before/after values, actor and time |

Month boundaries are always Asia/Hebron.

Success returns `{ "data": ... }`; creation returns 201. Errors return `{ "error": { "code": "...", "message": "..." } }`. Numeric IDs must fit the positive PostgreSQL integer range.

## Business rules

New teams are nonoperational. Team activation requires an active Manager assigned to that team. Manager replacement requires an active linked Member from the same team, and changes the previous manager to an active Member. `expectedManagerId` protects against stale replacement requests.

Moving, demoting, disabling or deleting an operational team's manager requires a replacement first. The last active Organizer is protected. Organizers have no team; Members and Managers require one. History and audit writes commit with assignment changes.

For a linked account's changed project email, the user must verify the new email on the same Clerk identity first. Soft deletion retains history and Clerk identity; Restore & Reassign brings the account back active with an explicit assignment. See [editing](user-editing.md) and [deletion](user-deletion.md).

## Super Admin governance (migration 011)

Super Admins are active Organizers whose Clerk user ID is listed in `SUPER_ADMIN_CLERK_IDS` (comma-separated). `GET /api/auth/me` returns `isSuperAdmin`, the Organizer's own `campusId` and, for Organizers, the `governance` flags. All rules are enforced on the server:

- **Organizer accounts:** only a Super Admin edits, changes the role or campus of, deactivates, deletes or restores an Organizer, promotes anyone to Organizer, restores anyone as Organizer, or approves a registration as Organizer (`403 ORGANIZER_MANAGEMENT_RESTRICTED` / `SUPER_ADMIN_REQUIRED`). Super Admin accounts are never changed through the API, not even by themselves (`403 SUPER_ADMIN_PROTECTED`). `SELF_LOCKOUT` and the last-active-Organizer rule still apply.
- **Organizer campus:** `PATCH /api/users/:id` accepts `campusId` (or `null`) for Organizers only; `GET /api/users` returns `campusId` and `isSuperAdmin`. An Organizer without a campus cannot evaluate anyone (`403 ORGANIZER_CAMPUS_REQUIRED`).
- **Evaluations** (`POST /api/evaluations/managers`, `POST /api/ratings`, `POST /api/activities`, and the `GET /api/ratings/targets` list):
  - Organizers and Super Admins are never evaluated (`403 EVALUATION_TARGET_ORGANIZER`).
  - Organizers evaluate Managers; Members only while `allowOrganizerMemberEval` is on (`403 ORGANIZER_MEMBER_EVAL_DISABLED`).
  - Organizers evaluate inside their own campus; Jenin → Ramallah only with `allowJeninEvalRamallah`, Ramallah → Jenin only with `allowRamallahEvalJenin` (`403 CROSS_CAMPUS_EVAL_DISABLED`).
  - Super Admins evaluate Managers and Members on both campuses; their audit rows carry `actorIsSuperAdmin: true`.
  - Managers rating their own team's Members are unchanged. Point awards (`POST /api/points`) are not evaluations and are unchanged.

### Registration and account hierarchy (migration 012)

An unknown signed-in Clerk user gets `403 REGISTRATION_REQUIRED` and submits `POST /api/registrations/request`; nothing is recorded automatically.
- **Who sees requests:** every Organizer, Super Admins included, sees every pending request: both campuses, every requested role, and legacy requests without details.
- **Approval** (`POST /api/registrations/:id/approve`):
  - Any Organizer can approve, into either campus, as Member or Manager. Only a Super Admin gives the Organizer role.
  - It creates the active account, closes the request and audits it.
  - It emails the person: role, campus, team and the `APP_LOGIN_URL` sign-in link, as HTML + text.
- **Rejection** emails the reason the same way.
- **Email delivery:** the result is stored as `notification_status` (`sent`, `failed`, or `skipped` when SMTP is not configured). It never undoes the decision.

**Account and team changes** (`PATCH /api/users/:id`, `/status`, `DELETE`, `/restore`, and the team endpoints):
- A Super Admin manages every account except Super Admin accounts, and every team.
- A regular Organizer manages only Members and Managers, and teams, of its own campus, and cannot move anyone to the other campus (`403 OUT_OF_CAMPUS_SCOPE`). Without a campus it gets `403 ORGANIZER_CAMPUS_REQUIRED`.
- Every Organizer can read all users.

## Frontend integration

This repository serves no frontend pages. New people use the Clerk sign-up on the frontend login page and the registration request form. `CLERK_INVITATION_REDIRECT_URL` matters only for accounts created through the former invitation path, which the frontend completes with `POST /api/auth/complete-registration` (recipient's Bearer token, `{}`). Its origin is also the default for the sign-in link in approval emails when `APP_LOGIN_URL` is not set. See [invitations](account-invitations.md).

## Status codes

400 invalid input; 401 missing authentication; 403 access denied; 404 entity/route missing; 409 business conflict; 429 invitation cooldown; 500 unexpected failure; 503 database/provider unavailable or invitation configuration required.
