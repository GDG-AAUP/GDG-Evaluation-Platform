# GDG Backend API

Base URL: `http://localhost:3001`. Business data is stored in PostgreSQL. Send JSON bodies with `Content-Type: application/json`.

## Authentication

Send `Authorization: Bearer <Clerk session token>`. Accounts are not created by hand: a person signs up at Clerk, their first API call records a pending request (`403 REGISTRATION_PENDING`, or `403 REGISTRATION_REJECTED` after a rejection), and an organizer approves it. Clerk verifies identity; PostgreSQL supplies current project role, active state and deletion state. Client-supplied roles do not establish identity. Inactive/deleted accounts are blocked. API roles are lowercase; database roles are Organizer, Manager and Member.

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
| POST | `/api/teams` | Organizer | `name`, `campusId`, optional `description` |
| PATCH | `/api/teams/:id` | Organizer | `name` and/or `managerId` (null removes), `reason`; one manager per team (409 `TEAM_MANAGER_EXISTS`), one team per manager; history + audit in one transaction |
| PATCH | `/api/teams/:id/status` | Organizer | `isOperational` boolean |
| PATCH | `/api/teams/:id/manager` | Organizer | `managerId`, `expectedManagerId`, `reason` |
| GET | `/api/users` | Organizer | Users excluding deleted accounts |
| GET | `/api/registrations` | Organizer | Self-registration requests; `status` query `pending` (default), `approved` or `rejected` |
| GET | `/api/registrations/count` | Organizer | `{ pending }` for the header badge |
| POST | `/api/registrations/:id/approve` | Organizer | `role` (organizer/manager/member); `campusId` and `teamId` required for manager and member, no team for organizer. Creates the active account and emails the person |
| POST | `/api/registrations/:id/reject` | Organizer | Optional `reason` (up to 1000 characters); emails the person |
| PATCH | `/api/users/:id` | Organizer | Changed `name`, `email`, `role`, `teamId`, `isActive`; required `reason` |
| PATCH | `/api/users/:id/status` | Organizer | `isActive` boolean |
| POST | `/api/users/:id/invitations/review` | Organizer | `{}`; no email sent |
| POST | `/api/users/:id/invitations/resend` | Organizer | `{}`; explicit replacement invitation |
| DELETE | `/api/users/:id` | Organizer | `reason` |
| GET | `/api/users/deleted` | Organizer | Deleted users |
| POST | `/api/users/:id/restore` | Organizer | `reason`; restores inactive account |
| GET | `/api/rankings/options` | Public | Campuses and teams for filters |
| GET | `/api/rankings/public-summary` | Public | `campusId`; current-month Top 3 and team leaders, without user IDs |
| GET | `/api/rankings`, `/api/rankings/archived` | Active linked user | `scope`, `teamId` or `campusId`, `year`, `month`; Members and Managers, month-only totals, `DENSE_RANK`; one team or one campus per request (no combined board) |
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

Month boundaries are always Asia/Hebron.

Success returns `{ "data": ... }`; creation returns 201. Errors return `{ "error": { "code": "...", "message": "..." } }`. Numeric IDs must fit the positive PostgreSQL integer range.

## Business rules

New teams are nonoperational. Team activation requires an active Manager assigned to that team. Manager replacement requires an active linked Member from the same team, and changes the previous manager to an active Member. `expectedManagerId` protects against stale replacement requests.

Moving, demoting, disabling or deleting an operational team's manager requires a replacement first. The last active Organizer is protected. Organizers have no team; Members and Managers require one. History and audit writes commit with assignment changes.

For a linked account's changed project email, the user must verify the new email on the same Clerk identity first. Soft deletion retains history and Clerk identity; restoration leaves the account inactive. See [editing](user-editing.md) and [deletion](user-deletion.md).

## Frontend integration

This repository serves no frontend pages. Configure `CLERK_INVITATION_REDIRECT_URL` with the frontend acceptance page before dispatching invitations; HTTPS is required outside local development. The frontend handles Clerk invitation tickets using its sign-up/sign-in component, then calls `POST /api/auth/complete-registration` with the recipient's Bearer token and `{}`. Do not use the Organizer's session to link another recipient.

A 201 response confirms local account creation, not inbox delivery. Inspect `data.deliveryStatus`, review uncertain attempts and never repeat account creation as an email retry. Existing invitation links retain their original destination. See [invitations](account-invitations.md).

## Status codes

400 invalid input; 401 missing authentication; 403 access denied; 404 entity/route missing; 409 business conflict; 429 invitation cooldown; 500 unexpected failure; 503 database/provider unavailable or invitation configuration required.
