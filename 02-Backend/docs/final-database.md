# Final database integration

The baseline is `GDG_Shorouq_Final_8_Tables_Backend_Ready.zip`, specifically its `01_FINAL_SCHEMA_MYSQL8.sql`. The SQL was converted to PostgreSQL; the application continues to use PostgreSQL and `pg`.

The current eight public tables are `campuses`, `users`, `teams`, `assignment_history`, `point_entries`, `monthly_rankings`, `performance_evaluations` and `audit_logs`.

## Approved invitation compatibility

The project retains its existing invitation flow: an Organizer creates a pending local account, Clerk sends an invitation, and the Clerk identity is linked after acceptance and verified email checks. Therefore `clerk_user_id` remains nullable while `invitation_status` is pending, sending, sent or failed. A database constraint requires an identity for other states. This is the explicitly approved difference from the supplied baseline's unconditional NOT NULL requirement. Existing invitation and soft-deletion columns are retained without additional public tables.

## Existing database migration

Migration `004_final_backend_schema.sql` widens emails to 255 characters, promotes historical record IDs to BIGINT, adds final constraints/indexes, and creates `performance_evaluations`. It removes unused legacy password/external-auth columns only after checking that they contain no values. Accounts and their invitation metadata are unchanged.

The former `manager_evaluations` table is moved to `gdg_legacy.manager_evaluations`. Its monthly scores cannot be converted honestly into 15 criterion scores for individual activities. The archived table and its records are preserved; no evaluations are fabricated. The active public schema still contains eight tables.

Backups are stored locally in `.local-backups/`, which is ignored by Git. Do not publish those database dumps. The migration runs in one transaction and refuses conflicting data rather than deleting it.

## Evaluation module boundary

The new table supports Member and Manager evaluation occurrences, a 15-value JSON array, totals bounded by 0–100, and repeated occurrences in a month. SQL enforces array length and overall bounds. Per-criterion integer/range checks, deriving the total server-side, monthly averages and evaluation permissions belong to the evaluation module; this account-management backend does not add evaluation routes. The supplied no-transfer policy differs from the existing Organizer editing feature. This schema migration preserves that feature; changing that business policy requires an explicit team decision.

## Verification

Fresh installation and upgrade from the former schema were verified in isolated PostgreSQL schemas before the live migration. The current schema test uses the final schema and verifies invitation compatibility and repeatable migrations. Workflow tests use TEMP tables and a fake Clerk provider; no real messages are sent. The live migration compared account fingerprints before and after, confirming unchanged account data.

A pre-existing development-data inconsistency remains: one operational team references an inactive Manager. The migration does not reactivate accounts or change team operational flags automatically. Existing activation and manager-change protections continue to apply.
