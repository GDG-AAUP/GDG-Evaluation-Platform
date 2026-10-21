# PostgreSQL schema

The clean-install schema is `GDG_evaluation_database.final.postgresql.sql`, converted from the final Shorouq package.

For a new empty database, execute:

1. `GDG_evaluation_database.final.postgresql.sql`.
2. `migrations/002_user_invitations.sql`.
3. `migrations/003_user_soft_delete.sql`.
4. `migrations/004_final_backend_schema.sql`.

For an existing initialized database, apply only unapplied migrations. Migration 004 upgrades the historical schema, archives the old evaluation table, and retains existing account data. Do not run a clean-install schema over existing tables. The base schema and migration 002 are not repeatable; migrations 003 and 004 are repeatable. On an error, roll back and inspect the conflict instead of deleting data.

The approved invitation flow allows clerk_user_id to be null for pending/sending/sent/failed onboarding states. Other states require a Clerk identity. Invitation and deletion fields remain part of users; the active public schema has eight tables.

The final schema stores email addresses up to 255 characters. Historical IDs use BIGINT. Database roles remain Organizer/Manager/Member, exposed as lowercase API roles. Clerk handles passwords; the old unused password/external-auth fields are removed after verification that they are empty.

The new performance_evaluations table stores one row per activity evaluation with 15 JSON criterion scores. Old monthly manager_evaluations records are preserved in gdg_legacy.manager_evaluations; they are not fabricated into new per-activity criteria. Detailed evaluation validation and APIs belong to the evaluation module.

See [final database integration](../docs/final-database.md) for migration checks and policy differences.
