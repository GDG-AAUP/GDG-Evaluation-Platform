# Account deletion and restoration

Apply the database setup and migrations in the order described in `db/README.md` before using these endpoints. Migration 003 adds `users.deleted_at`, `deleted_by_user_id` and a database constraint requiring deleted users to be inactive. It is repeatable and does not delete existing users.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| DELETE | `/api/users/:id` | Delete project access while retaining the account |
| GET | `/api/users/deleted` | List deleted accounts for the Organizer |
| POST | `/api/users/:id/restore` | Restore the account in an inactive state |

Both mutations require an active linked Organizer and a body containing only a reason:

```json
{ "reason": "Organizer-approved account deletion or restoration" }
```

IDs must be positive PostgreSQL integers; reason length is 1–1000 characters. Unauthenticated requests return 401, non-Organizer requests 403, invalid bodies 400 and missing accounts 404. Repeating deletion returns 200 with `changed: false` and adds no audit entry. Restoring an account that is not deleted returns 409 `USER_NOT_DELETED`.

## Deletion behavior

The account is retained with `deleted_at`, the acting Organizer ID and `is_active = false`. It disappears from the ordinary user list and team member list. Authentication and invitation linking deny project access even if the user already has a valid Clerk session. Profile editing, activation and invitation operations refuse deleted accounts until restoration. Clerk identity, email, role, original team, point records, rankings, evaluations and existing audit records are retained. The email stays reserved for this account; soft deletion does not make it available for creating another account.

The operation does not delete or ban the Clerk account, terminate unrelated Clerk usage, or revoke already-sent invitation links. A retained invitation may still complete Clerk registration, but project authorization remains denied until restoration and explicit activation. No Clerk API calls are needed for deletion or restoration.

The last active Organizer cannot be deleted. An operational team's manager must first be replaced using the manager replacement operation. Deleting a nonoperational team's manager releases the manager pointer. Any current assignment history is closed using PostgreSQL timestamp precision, with no history records removed.

## Restoration behavior

Restoration retains the same user ID and Clerk identity, clears deletion metadata, and leaves `is_active = false`. The Organizer must then explicitly activate the user through the status endpoint or edit form. Non-Organizer restoration opens a new history interval, preserving the gap while the account was deleted. Restoring a Manager reclaims the original team's manager pointer only if the team is nonoperational and the position is vacant. A conflict returns 409 `MANAGER_RESTORE_CONFLICT` without replacing another manager. Resolve that assignment first; no other account is silently demoted.

User state, manager pointers, history boundaries and audit records commit together under the existing per-account advisory lock and users → teams → assignment_history table locks. Audit failure rolls back the full database operation. Deleted accounts cannot be activated by bypassing the API because of the database constraint.

## Verification

The frontend loads deleted accounts from `/api/users/deleted` and ordinary accounts from `/api/users`, and supplies a reason for deletion/restoration. This repository does not serve a frontend.

`npm run test:db` checks identity/history retention, account visibility, repeated deletion, inactive restoration, activation protection, authorization, manager/Organizer guards, restoration conflicts and audit rollback. Tests use temporary PostgreSQL tables and a fake Clerk provider without deleting live accounts.
