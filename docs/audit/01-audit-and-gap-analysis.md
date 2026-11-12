# GDG AAUP Platform: Audit and Gap Analysis (Phases 1 and 2)

Date: 2026-11-09. Baseline: the first git commit, an unmodified import of the handover zip.

## 1. Bottom line

The account, team, points and audit foundations are carefully built, and authorization on those endpoints is sound. The platform is **not close to the Definition of Done**. Three things stand out:

1. **Task management does not exist** in the database, API or frontend. The repo's own docs say it was removed on purpose, which contradicts the handover.
2. **In real-backend mode, 11 frontend paths show "coming soon"**, because their endpoints were never built. Only the mock mode looks complete, and the mock is the default build.
3. **The chatbot is a terminal program.** It has no HTTP service, the frontend's `POST /assistant` has no backend, and 8 of its 13 backend calls return `NOT_IMPLEMENTED`.

## 2. What this audit did and did not cover

| Covered | Not covered yet |
| --- | --- |
| Read: backend wiring, middleware, schema, all migrations, points, rankings, evaluation code, frontend real-backend client, service switch, route table, AI client and config | Read only in part: account repositories, page components, `tools.py`, `llm.py`, test bodies |
| Pattern searches: hardcoded secrets, XSS sinks, triggers, rate limiting, deploy config | **No build, test, migration or app run.** As agreed, Phase 1 ran no project code, so every test and build result is still unknown |
| | No `npm audit`, no visual baseline screenshots |

Findings come from reading code. Each one should be reproduced by a test when it is fixed.

## 3. Actual stack (differs from the brief's expectations)

| Layer | Expected in brief | Actual |
| --- | --- | --- |
| Backend | ASP.NET Core | Node 24, Express 5, mixed JS and TypeScript (`02-Backend`) |
| Database | SQL Server | PostgreSQL, hand-run SQL files, no migration runner or tracking table |
| Auth | Not specified | Clerk session tokens; roles and active state come from the database |
| Frontend | React | React 19, Vite 6, no UI library, Arabic RTL with English i18n (`01-Frontend`) |
| AI | Gemini or Groq | Python and Gemini 2.5 Flash, terminal only (`03-AI/Anas_Musleh`) |
| Deploy, CI, lint | Not specified | None: no Docker, CI or ESLint config |

The brief says to preserve the actual stack, so this plan does.

## 4. What is solid

- Identity comes from the verified Clerk session, and the role comes from the database on every request (`load-project-user.js`).
- Invitation linking checks a verified email and an accepted invitation (`link-clerk-account.service.js`).
- Points are append-only in application code. Reversals are linked, unique, and protected by row locks and a database constraint. Managers are limited to members of the team they manage, and self-awards are blocked (`check-recipient.ts`).
- Every point and evaluation write commits its audit row in the same transaction.
- Soft delete, assignment history, last-Organizer protection and manager-replacement rules exist.
- SQL is parameterized in all files read. No hardcoded secrets or `dangerouslySetInnerHTML` were found.
- 42 backend test files exist, plus frontend and AI tests (not run).

## 5. Findings

### Critical

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| C1 | Task management is entirely absent | No table, route or page; `phase2-api-handoff.md:321` and `ORIGINAL_README.md:64` record it as removed | Brief 3.2 and the chatbot's task questions cannot be met. Needs decision D1 |
| C2 | Chatbot is not integrated | `03-AI/.../chat.py` is a CLI; no route for `POST /assistant`; `backend_client.py:75-82` | Section 4 of the brief is unmet |
| C3 | Most operational screens are disabled against the real backend | `availability.js:7-19`: ratings, activities, assistant, manager dashboard, organizer overview, awards, news, points, archive, system log, policies | Core features do not work end to end |
| C4 | Builds default to mock data | `config.js:4`: anything except exactly `false` means mock | A production build with a missing variable ships fake data and the demo role switcher, with no real security behind it |

### High

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| H1 | Rankings are unauthenticated, for any team, campus or month | `app.js:33` is mounted before Clerk | Member names and scores are public. Needs decision D2 |
| H2 | Rankings include soft-deleted and inactive users, and Managers | `get-team-ranking.ts:28-38,78`, `get-campus-ranking.ts:28-39,80` filter on neither state nor role | Deleted people's names are publicly exposed; Managers are mixed into member rankings |
| H3 | Month close cannot be triggered | `publishMonthlySnapshot` has no route | Past months read from empty snapshots, so the leaderboard shows nothing for them |
| H4 | Ranking views are missing | No Top 3/5, all-time ranking or manager ranking endpoint; only one manager's average | Brief 3.4 is unmet |
| H5 | Fresh install breaks evaluations | Both READMEs omit migration 005; base schema requires 15 criteria, the code sends 4 | Every manager evaluation insert fails on a database set up by the docs |
| H6 | Month boundaries are inconsistent | `TIMESTAMP WITHOUT TIME ZONE` and no session timezone (`db.js`); frontend uses UTC (`adapters.js:14-18`); no timezone documented | Points near midnight on a month boundary can land in the wrong month. Needs decision D4 |
| H7 | No rate limiting, security headers or restricted CORS | `app.js:29`; no helmet or limiter anywhere | Public ranking queries and token-gated Clerk lookups can be abused |
| H8 | Personal points are computed from the last 50 entries | `points.routes.ts:48`; `client.js:251-253` filters in the browser; no balance endpoint | Totals are silently wrong past 50 entries; rank is always empty |
| H9 | Ledger and audit log are immutable only by convention | No triggers or `REVOKE` in `db/` | Anyone with the application's database role can rewrite history |

### Medium

| ID | Finding | Evidence |
| --- | --- | --- |
| M1 | Point entries store no team or campus context or transaction type (brief 3.3); audit rows have no campus/team context (3.7) | Base schema |
| M2 | A reversal is dated today, so reversing last month's points reduces this month's score. The frontend contract expects archived months to be blocked | `reverse-point.ts:103-113`, `API_CONTRACT.md:54` |
| M3 | `npm run dev` crashes on a fresh checkout: `app.js` requires `dist/`, and only `start` and `test` build it | `package.json:8,13-15`, `app.js:17-25` |
| M4 | Every point write takes table locks on `users` and `teams` with no timeout. Safe, but it blocks unrelated account writes | `create-point.ts:21-27` |
| M5 | No migration runner or applied-migrations record; 002 is not re-runnable | `db/README.md` |
| M6 | No listing of evaluations; history exists only as an average; the screen makes one request per manager | `client.js:446-449` |
| M7 | Team rename, manager replacement UI, reversal UI and the organizer points ledger are not connected | `BACKEND_INTEGRATION.md:50-52` |
| M8 | No technical log store; the error handler logs only the error name, which makes production faults hard to diagnose | `error-handler.js:28` |
| M9 | Database pool has no SSL option or limits; no graceful shutdown | `db.js`, `server.js` |
| M10 | Tie-breaking differs between backend (name, id), contract (scorecard, then date) and is documented nowhere as policy | `API_CONTRACT.md:40` |

### Low

| ID | Finding | Evidence |
| --- | --- | --- |
| L1 | A Microsoft To Do sharing link with an invitation token ships in the frontend bundle | `links.config.js:3` |
| L2 | Frontend `.gitignore` covers `.env.local` but not `.env` | `01-Frontend/.gitignore` |
| L3 | `03-AI/README.md` and `04-Final/README.md` are empty; the root README is two lines | Repo |
| L4 | The API docs do not list points, rankings, audit or evaluation routes | `02-Backend/docs/api.md` |

## 6. Requirement map

Status key: Done (implemented, untested here), Partial, Missing.

| Brief | Requirement | Status | Gap | Affected area | Depends on | Risk | Tests required |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | Server-side roles | Partial | Sound where endpoints exist; H1 is open; new endpoints need the same rules | Middleware | D2 | High | Cross-campus and ID-tampering per role |
| 3.1 | Users and teams | Done | Team rename and manager replacement UI missing (M7) | `routes/`, `client.js` | None | Low | Transfers, duplicates |
| 3.2 | Tasks | Missing | All of it (C1) | New table, routes, UI | D1 | Critical | Lifecycle, overdue, scope |
| 3.3 | Points ledger | Partial | H8, M1, M2, H9; no organizer ledger | `points/`, schema | D4 | High | Balances, reversal, concurrency |
| 3.4 | Rankings | Partial | H2, H4, M10 | `rankings/` | D2, D4 | High | Boundaries, ties, Top 3/5 |
| 3.5 | Manager evaluations | Partial | Create and average work; no history listing (M6), H5 | `evaluations/` | None | Medium | Permissions, migration path |
| 3.6 | Monthly archives | Partial | H3; screen disabled | `rankings/publish-*`, Archive page | D4 | High | Month transition, totals unchanged |
| 3.7 | Audit log | Partial | Works and restricted; H9, M1; system log missing | Schema, `audit/` | None | Medium | Immutability, role access |
| 4 | Chatbot | Partial | C2; needs service, 8 endpoints, task tools | `03-AI`, backend | D1, D3 | Critical | Real data, scope, provider failure |
| 6 | Engineering standards | Partial | H7, M8, M9, no lint | App-wide | None | High | Headers, limits, error shape |
| 7 | Frontend freeze | At risk | D1 and D5 are the only conflicts; removing `COMING_SOON_REAL` entries turns on existing pages | `availability.js` | D1, D5 | Critical | Before/after screenshots |
| 9 | Production readiness | Missing | C4, M3, M5; no deploy guide | Config, docs | Hosting details | High | Production-like start |

## 7. Decisions needed from the project owner

| ID | Decision | Recommendation |
| --- | --- | --- |
| D1 | Tasks: the brief requires them, the repo says they were removed, and the frontend has no screen. A screen cannot be added under the freeze without an exception | Grant one narrow exception: one new Tasks page built only from existing components and styles, plus one navigation entry. No existing screen changes |
| D2 | Should rankings stay public? The Welcome page relies on them | Keep only a public summary of team leaders and current-month Top 3 without user IDs. Require sign-in for full, team and historical rankings |
| D3 | Where does the chatbot run? | Keep the Python code, add a small HTTP wrapper, and have the Node backend proxy `POST /api/assistant`. The frontend contract stays the same. Needs a Gemini key |
| D4 | Official timezone for months | `Asia/Hebron`, stored as `timestamptz`, with a tested migration |
| D5 | Member ratings (15 items), awards, news and activities exist as screens with no backend, and are not in the brief | Keep them disabled for this delivery, and treat them as a later phase. Otherwise the scope grows considerably |

## 8. Proposed order of work

1. **Baseline:** install, build, run all test suites, capture frontend screenshots at fixed viewports. Report real results.
2. **Database (Phase 3):** migration runner, fix the documented install path (H5), timezone (H6), ledger and audit protection (H9), context columns (M1), tasks if approved.
3. **Critical and High backend (Phase 4):** C4 safeguard, H1, H2, H3, H4, H7, H8, then M2, M3.
4. **Missing endpoints:** organizer overview, manager dashboard, points ledger, archive, policies, system log, tasks.
5. **Chatbot:** service wrapper, proxy, the 8 missing data calls, task tools.
6. **Frontend integration (Phase 5):** enable each page only once its endpoint passes tests, and compare screenshots each time.
7. **Phases 6 to 10:** role-by-role end-to-end tests, security review, production preparation, final verification and the remaining reports.

Needed from you along the way: a local or test PostgreSQL, a Clerk test application, a Gemini key, and hosting details for the deployment guide.
