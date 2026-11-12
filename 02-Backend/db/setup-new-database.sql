-- Full setup of a NEW, EMPTY database, in the required order. Run from 02-Backend:
--   psql -d gdg_evaluation -v ON_ERROR_STOP=1 -f db/setup-new-database.sql
-- For an existing database, run only its unapplied files from db/migrations instead.
\ir GDG_evaluation_database.final.postgresql.sql
\ir migrations/002_user_invitations.sql
\ir migrations/003_user_soft_delete.sql
\ir migrations/004_final_backend_schema.sql
\ir migrations/005_manager_evaluation_four_criteria.sql
\ir migrations/006_asia_hebron_timestamps.sql
\ir migrations/007_snapshot_rows_per_team_and_campus.sql
\ir migrations/008_enable_remaining_modules.sql
\ir migrations/009_registration_approval_flow.sql
\ir migrations/010_points_spec_alignment.sql
