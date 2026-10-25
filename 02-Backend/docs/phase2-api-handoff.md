# GDG Evaluation Platform — Phase 2 Backend API Handoff

**Audience:** Backend reviewer (Omar) and frontend integrator (Hazar)  
**Branch:** `nada/phase2`  
**Implementation commit:** `a0c4608` (local; not yet pushed when prepared)  
**Verification:** 486/486 tests passed; staged whitespace checks passed; common-secret-pattern scan passed on 51 files.  
**Date prepared:** 2026-10-25

This document describes the **implemented HTTP routes** based on the reviewed Express routers and services. It does not claim that frontend integration or live Clerk-provider acceptance testing is complete.

## 1. API overview

Routes use the `/api` prefix and return JSON. Successful responses ordinarily use `{ "data": ... }`; validation/authorization failures use `{ "error": { "code": "...", "message": "..." } }`.

- **Public:** `/api/rankings`, `/api/rankings/options`, `/api/rankings/archived` — these are mounted **before** Clerk middleware.
- **Authenticated project account:** `/api/points/me` — requires a valid authenticated and active linked project account.
- **Organizer or authorized Manager:** point creation and reversal. Additional recipient/team authorization is enforced in the backend; possessing the role alone does not guarantee success.
- **Organizer only:** audit-log retrieval, creation of Manager Evaluations, and Manager monthly-average retrieval.
- The authenticated actor identity is obtained server-side. Do **not** send a user-supplied evaluator ID, actor ID or role to claim privileges.

For authenticated requests, supply the Clerk session credential required by the deployment (often a bearer session token in `Authorization`). An unlinked, inactive or deleted project account may be rejected even when a Clerk session exists.

### Endpoint matrix

| Method | Path | Intended access | Success |
|---|---|---|---|
| GET | `/api/rankings/options` | Public | 200 |
| GET | `/api/rankings` | Public | 200 |
| GET | `/api/rankings/archived` | Public | 200 |
| GET | `/api/points/me` | Active linked user | 200 |
| POST | `/api/points` | Organizer / authorized Manager | 201 |
| POST | `/api/points/:entryId/reverse` | Organizer / authorized Manager | 201 |
| GET | `/api/audit` | Organizer | 200 |
| POST | `/api/evaluations/managers` | Organizer | 201 |
| GET | `/api/evaluations/managers/:managerId/average` | Organizer | 200 |

Other application endpoints (`/api/health`, `/api/ready`, `/api/auth/*`, `/api/campuses`, `/api/teams`, `/api/users`, etc.) are maintained outside the Phase 2 contracts summarized here.

## 2. Public rankings

### `GET /api/rankings/options`

No required parameters. Returns campuses and teams for filter selectors:

```json
{
  "data": {
    "campuses": [{ "id": 1, "name": "Example Campus" }],
    "teams": [{ "id": 2, "campusId": 1, "name": "Example Team" }]
  }
}
```

The names and IDs above are illustrative; clients should use values returned by this endpoint, not hardcoded IDs.

### `GET /api/rankings` and `GET /api/rankings/archived`

Both endpoints require the same query parameters:

| Parameter | Required / validation |
|---|---|
| `scope` | Exactly `team` or `campus` (lowercase). |
| `year` | Four-digit string representing a year from 2000 to 9999. |
| `month` | Numeric string representing 1–12. |
| `teamId` | Positive decimal integer, up to 2,147,483,647, **required only** when `scope=team`. |
| `campusId` | Positive decimal integer, up to 2,147,483,647, **required only** when `scope=campus`. |

Do not supply the other ID or any unexpected query keys.

```http
GET /api/rankings?scope=team&teamId=2&year=2026&month=10
GET /api/rankings?scope=campus&campusId=1&year=2026&month=10
GET /api/rankings/archived?scope=team&teamId=2&year=2026&month=9
```

Both return an array of ranking rows:

```json
{
  "data": [
    { "rank": 1, "userId": 5, "fullName": "Example Member", "totalPoints": 75 },
    { "rank": 2, "userId": 8, "fullName": "Another Member", "totalPoints": 45 }
  ]
}
```

- Current rankings sum point entries for the specified month, respecting assignment history to the selected team/campus. Members can appear with zero points.
- `rank` uses **dense ranking**: equal point totals receive the same rank.
- Archived rankings read published rows in `monthly_rankings` with `archived_at IS NOT NULL`. An empty `data` array does not distinguish “no published snapshot” from “published snapshot containing no rows.”
- Validation failure: `400 INVALID_RANKING_QUERY`.

**Important:** The backend includes snapshot preview, conflict detection and publishing **services**, but the reviewed router exposes no HTTP endpoint to preview or publish snapshots. The frontend must not assume such routes exist.

## 3. Points

### `GET /api/points/me`

Returns up to **50** latest entries for the authenticated project user, newest first:

```json
{
  "data": [
    {
      "id": "419",
      "points": 20,
      "activityName": "GDG Workshop",
      "reason": "Active participation",
      "effectiveAt": "2026-10-20T10:00:00.000Z"
    }
  ]
}
```

`id` is serialized as a string to preserve the PostgreSQL `bigint` identifier. Timestamps above are illustrative. This endpoint is for **personal** history only; it does not accept a client-selected user ID or provide pagination.

### `POST /api/points`

Requires an Organizer or authorized Manager; Managers are subject to team/recipient restrictions enforced by the service.

```json
{
  "userId": 5,
  "points": 20,
  "activityName": "GDG Workshop",
  "reason": "Active participation",
  "activityDescription": "Contributed to the workshop"
}
```

| Input | Validation |
|---|---|
| `userId` | Positive integer, up to 2,147,483,647. |
| `points` | Integer from -100 through 100, **excluding zero**. |
| `activityName` | Required, nonblank after trimming, at most 100 characters. |
| `reason` | Required, nonblank after trimming. |
| `activityDescription` | Optional string or `null`; blank text normalizes to `null`. |

Unexpected fields are rejected. The backend obtains `performedByUserId` from the authenticated user. Success: **201** with `data` containing `id`, `userId`, `performedByUserId`, `points`, `activityName`, `reason`, `activityDescription`, and `effectiveAt`. A corresponding audit entry is recorded transactionally.

Possible route errors: `400 INVALID_POINT_DATA`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 RECIPIENT_NOT_FOUND`. Project account middleware may additionally return `PROJECT_ACCESS_DENIED`.

### `POST /api/points/:entryId/reverse`

Example:

```http
POST /api/points/419/reverse
Content-Type: application/json
```

```json
{ "reason": "Awarded to the wrong member" }
```

- `entryId` must be a positive decimal integer within signed PostgreSQL `bigint` range.
- Body contains **only** `reason`, with 1–500 characters after trimming.
- Success: **201**, with a **new** entry in `data`, including `reversesEntryId` referring to the original entry.
- The original entry is **not deleted**: its points are offset by a new entry with the opposite sign, and an audit record is written.
- An entry cannot be reversed twice, and a reversal entry cannot itself be reversed.

Possible errors: `400 INVALID_ENTRY_ID`, `400 INVALID_REVERSAL_DATA`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 ENTRY_NOT_FOUND`, `404 RECIPIENT_NOT_FOUND`, `409 ALREADY_REVERSED`, `409 CANNOT_REVERSE_REVERSAL`. **Confirmed locally:** Both conflict responses return HTTP 409.

## 4. Manager Evaluations

Both endpoints require an **active Organizer**. Creating an evaluation additionally verifies the Organizer role in the database and checks that the target is an active Manager with a valid team and campus.

### `POST /api/evaluations/managers`

```json
{
  "evaluatedUserId": 5,
  "activityName": "October Performance Review",
  "activityDate": "2026-10-20",
  "criteriaScores": [85, 80, 90, 75],
  "comments": "Consistent team coordination"
}
```

| Score array index | Criterion | Weight |
|---:|---|---:|
| 0 | Commitment and Discipline | 30% |
| 1 | Team Follow-up | 30% |
| 2 | Communication and Collaboration | 20% |
| 3 | Team Results | 20% |

- Exactly **four** integer scores, each **0–100**, in the order above.
- `evaluatedUserId`: positive integer up to 2,147,483,647.
- `activityName`: required, 1–150 characters after trimming.
- `activityDate`: valid calendar date in `YYYY-MM-DD` format.
- `comments`: optional text or `null`; blank text becomes `null`.
- Unexpected fields are rejected. **Do not send `criteriaTotalScore` or `evaluatedByUserId`**; both values are derived by the backend.
- Weighted score is rounded to the nearest integer: `[85,80,90,75]` becomes `83`.

Success: **201**:

```json
{
  "data": {
    "id": "77",
    "evaluatedUserId": 5,
    "evaluatedByUserId": 10,
    "teamId": 2,
    "campusId": 1,
    "totalScore": 83
  }
}
```

The response above uses illustrative IDs. Creation and its audit-log insert execute in a single transaction.

Possible errors: `400 INVALID_EVALUATION_DATA`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 MANAGER_NOT_FOUND`, `422 MANAGER_INELIGIBLE`.

### `GET /api/evaluations/managers/:managerId/average`

```http
GET /api/evaluations/managers/5/average?year=2026&month=10
```

- `managerId`: positive integer up to 2,147,483,647.
- `year`: 2000–9999.
- `month`: 1–12.
- Aggregates that Manager's completed evaluations for the specified month. The per-evaluation weighted total is rounded before monthly averaging.

The success payload has this shape:

```json
{
  "data": {
    "managerUserId": 5,
    "year": 2026,
    "month": 10,
    "evaluationCount": 2,
    "averageScore": 76
  }
}
```

`averageScore` is `null` when there are no evaluations. **Confirmed locally:** `averageScore` is a JSON number or `null`. The service converts PostgreSQL numeric values using `Number(...)`. The displayed `76` is illustrative.

Possible errors: `400 INVALID_EVALUATION_PERIOD`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 MANAGER_NOT_FOUND`, `422 NOT_A_MANAGER`.

## 5. Organizer audit logs

### `GET /api/audit`

Optional query parameters:

| Parameter | Accepted values | Default |
|---|---|---|
| `actorId` | Positive integer up to 2,147,483,647 | None |
| `action` | String up to 100 characters; trimmed | None |
| `entityType` | String up to 100 characters; trimmed | None |
| `from` | Valid `YYYY-MM-DD` date | None |
| `to` | Valid `YYYY-MM-DD` date | None |
| `page` | Integer 1–10,000 | 1 |
| `pageSize` | Integer 1–100 | 25 |

`from` and `to` form an inclusive calendar-date range; `from` cannot be after `to`.

```http
GET /api/audit?page=1&pageSize=25
GET /api/audit?action=PERFORMANCE_EVALUATION_CREATED
GET /api/audit?from=2026-10-01&to=2026-10-31
```

Success:

```json
{
  "data": {
    "items": [
      {
        "id": "901",
        "actorId": 10,
        "actorName": "Example Organizer",
        "action": "PERFORMANCE_EVALUATION_CREATED",
        "entityType": "performance_evaluations",
        "entityId": "77",
        "oldValues": null,
        "newValues": { "totalScore": 83 },
        "reason": "October Performance Review",
        "batchId": null,
        "createdAt": "2026-10-20T10:00:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 25
  }
}
```

The sample's `newValues` is abbreviated; actual audit records can contain more properties. Results are ordered newest first. Implemented action values include `create_point_entry`, `reverse_point_entry`, and `PERFORMANCE_EVALUATION_CREATED` (casing is meaningful for action filters).

Possible errors: `400 INVALID_AUDIT_QUERY`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`. A linked, active Organizer project account is required.

## 6. Internal services and deployment notes

**Not public HTTP endpoints:** `preview-monthly-snapshot`, `publish-monthly-snapshot`, and `find-snapshot-conflicts` are backend services. Do not call guessed `/api/rankings/preview` or `/api/rankings/publish` URLs. If an administrative UI needs publishing, a reviewed and authorized route must be designed separately.

**Database:** Ensure the target PostgreSQL environment has the migration `db/migrations/005_manager_evaluation_four_criteria.sql` applied in the project's established migration order. Its successful application on a local environment does not imply it ran on another environment. Review migration idempotency before rerunning it.

**Build and tests:** From `02-Backend`, use the existing `npm run typecheck`, `npm run build`, and the configured Node test suite. On the author's WSL environment, the verified database-backed run was:

```bash
DB_HOST="$(ip -4 route show default | awk '{print $3; exit}')" \
node --env-file=.env --test --test-concurrency=1 tests/*.test.js
```

The WSL `DB_HOST` command is environment-specific; use the appropriate database host elsewhere. The documented baseline is **486 passed, 0 failed, 0 skipped**.

### Handoff / acceptance checklist

- [ ] Push `nada/phase2` and open a reviewable pull request; local commit `a0c4608` alone is not shared to the remote.
- [ ] Review schema migration and transaction/role behavior in the deployment database.
- [ ] Confirm real Clerk authentication and active-project-user linking with deployment credentials (tests mock Clerk identity).
- [ ] Frontend: source campus/team IDs from `/api/rankings/options`; use lowercase scope; attach auth only to protected endpoints; never supply evaluator/actor identity.
- [ ] Frontend: handle unauthorized, validation, not-found, conflict and ineligible-user responses explicitly.
- [ ] Keep the untracked temporary `scripts/register-manager-evaluations-route.cjs` out of production commits unless deliberately reviewed.

**Scope note:** Phase 2 Tasks Management is not part of the approved MVP and is deliberately not documented here.
