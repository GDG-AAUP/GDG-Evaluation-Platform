# Account deletion and Restore & Reassign

Requires migrations 003 (soft deletion), 011 (organizer campus) and the rest of `db/README.md`. Migration 003 adds `users.deleted_at` and `deleted_by_user_id`, plus a database constraint that keeps deleted users inactive.

| Method | Endpoint | Who | Body |
| --- | --- | --- | --- |
| DELETE | `/api/users/:id` | Super Admin: any account except Super Admins. Organizer: Members/Managers of its own campus | `{ "reason": "…" }` |
| GET | `/api/users/deleted` | Any Organizer (read-only list) | — |
| POST or PATCH | `/api/users/:id/restore` | Super Admin: any account except Super Admins. Organizer: see below | `{ "role", "campusId", "teamId", "reason" }` |

IDs are positive PostgreSQL integers, and reasons are 1–1000 characters. Responses:

| Case | Response |
|---|---|
| Unauthenticated | 401 |
| Wrong role or out of scope | 403 |
| Invalid body | 400 |
| Missing account | 404 |
| Repeating a deletion | 200 with `changed: false`, and no new audit row |

## Deletion

The account is kept, with `deleted_at`, the acting Organizer and `is_active = false`:
- It disappears from the user and team lists. Sign-in is refused even with a valid Clerk session.
- Its Clerk identity, email, role, last team, points, rankings, evaluations and audit records are all kept. The email stays reserved for this account.
- The last active Organizer cannot be deleted, and nobody can delete their own account (`SELF_LOCKOUT`).
- An operational team's Manager must be replaced first. Deleting the Manager of a non-operational team frees the seat.
- Open assignment history is closed. No history rows are removed.

## Restore & Reassign

The account comes back **active**, with the role, campus and team the approver confirmed. Its old Manager or Organizer seat is **never** reclaimed automatically. All of this happens in one transaction, using the users → teams → assignment_history locks:

| Requested role | Rule |
|---|---|
| `manager` | `teamId` is required, must belong to `campusId`, and the team's manager seat must be free. Otherwise `409 RESTORE_TEAM_MANAGER_EXISTS` («هذا الفريق لديه مدير معيّن حالياً؛ اختر فريقاً آخر أو أعده كعضو»). An operational team also needs the person to have a linked Clerk identity (`409 INVALID_MANAGER`). |
| `member` | `teamId` is required and must belong to `campusId`, because the database requires every Member to have a team. Any stale manager pointer is cleared. |
| `organizer` | Super Admin only (`403 SUPER_ADMIN_REQUIRED`). There is no team, and `campusId` becomes the Organizer's own campus. |

**Who may restore:**
- **Super Admin:** any soft-deleted account except Super Admin accounts (`403 SUPER_ADMIN_PROTECTED`), into either campus and any role.
- **Regular Organizer:** must have a campus (`403 ORGANIZER_CAMPUS_REQUIRED`). Within that:
  - Only former Members/Managers whose previous campus is its own, or unknown.
  - Only into its own campus (`403 OUT_OF_CAMPUS_SCOPE`).
  - Only as Member or Manager.
  - Never a former Organizer account (`403 ORGANIZER_MANAGEMENT_RESTRICTED`).

`restore_user` audit rows hold both the previous assignment (role, team, deleted state) and the restored one. A new assignment-history interval starts, which keeps the gap while the account was deleted. An audit failure rolls the whole operation back.

## Frontend

The **المحذوفون / المؤرشفون** (Deleted / Archived) tab on the Members page shows Super Admins every archived account. A regular Organizer sees those of its campus and those with no known campus. The **استعادة وتعيين** (Restore & Assign) dialog asks for a role, campus, team and reason:
- **Locked choices:** a regular Organizer can only pick its own campus, and only Member or Manager.
- **Taken seats:** teams that already have a manager are labelled «لديه مدير» (has a manager).
- **Validation:** the same Arabic conflict message is shown before anything is sent.

## Verification

`npm test` (database tests) covers:
- deletion, repeat deletion and history retention
- the Super Admin and campus-Organizer restore rules
- the 409 for a taken manager seat
- restoring as a Member of the same team, and into a vacant team
- restoring an Organizer
- Super Admin protection and audit rollback
