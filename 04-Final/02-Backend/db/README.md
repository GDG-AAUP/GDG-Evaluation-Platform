# PostgreSQL schema

The clean-install schema is `GDG_evaluation_database.final.postgresql.sql`, converted from the final Shorouq package. Month boundaries are always Asia/Hebron.

## New, empty database

Run from `02-Backend`:

```bash
psql "<connection string or -d gdg_evaluation>" -v ON_ERROR_STOP=1 -f db/setup-new-database.sql
```

`setup-new-database.sql` runs these files in order and stops at the first error:

| # | File | What it adds |
|--:|------|--------------|
| 001 | `GDG_evaluation_database.final.postgresql.sql` | Base schema; campuses Jenin and Ramallah |
| 002 | `migrations/002_user_invitations.sql` | Invitation columns on `users` |
| 003 | `migrations/003_user_soft_delete.sql` | Soft deletion (`deleted_at`, deleted users always inactive) |
| 004 | `migrations/004_final_backend_schema.sql` | Final constraints, BIGINT IDs, `performance_evaluations` |
| 005 | `migrations/005_manager_evaluation_four_criteria.sql` | Manager evaluations with four criteria (required by the API) |
| 006 | `migrations/006_asia_hebron_timestamps.sql` | Timezone-aware instants, Asia/Hebron months |
| 007 | `migrations/007_snapshot_rows_per_team_and_campus.sql` | Monthly ranking snapshots per team and per campus |
| 008 | `migrations/008_enable_remaining_modules.sql` | Ratings, activities, awards, policies, system log |
| 009 | `migrations/009_registration_approval_flow.sql` | `registration_requests` (self-registration with approval) |
| 010 | `migrations/010_points_spec_alignment.sql` | Points −100…100 and nonzero; idempotency keys |
| 011 | `migrations/011_governance_and_super_admin.sql` | `governance_settings` (three flags, all off); `users.organizer_campus_id` |
| 012 | `migrations/012_registration_request_details.sql` | Requested role, campus and team on registration requests |

## Existing database

Apply only the migrations that have not run yet, in numeric order, each with `-v ON_ERROR_STOP=1`. **Back up first:**

```bash
pg_dump "<connection>" -Fc -f ../db-backups/gdg_evaluation-before-0XX-YYYYMMDD-HHMMSS.dump
```

Notes:
- Never run the base schema over existing tables.
- The base schema and migration 002 are not repeatable. Migrations 003, 004 and 009–012 can safely run again.
- If a migration fails, it rolls back. Inspect the conflict instead of deleting data.

## Notes

- `clerk_user_id` may be null only while an invitation is pending, sending, sent or failed. Every other account has a Clerk identity.
- Database roles are `Organizer` / `Manager` / `Member`; the API exposes them in lowercase. A Member or Manager always has exactly one team, and an Organizer never has one.
- An Organizer's own campus (`organizer_campus_id`, migration 011) sets which accounts and teams it manages, and where it evaluates.
- Super Admins are not stored in the database. They are the active Organizers whose Clerk IDs are listed in the backend's `SUPER_ADMIN_CLERK_IDS`.
- Old monthly `manager_evaluations` rows are preserved in `gdg_legacy.manager_evaluations`. They were not converted into new per-activity criteria.

See [final database integration](../docs/final-database.md) for the original baseline and its approved differences.
