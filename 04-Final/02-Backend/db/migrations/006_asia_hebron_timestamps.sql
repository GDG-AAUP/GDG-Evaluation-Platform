-- Stores real instants as TIMESTAMPTZ so month boundaries can be computed in Asia/Hebron
-- regardless of the server or session timezone.
--
-- Run this from a normal psql session, NOT one with its timezone changed: existing values were
-- written in the server's default timezone, and the implicit cast below interprets them in the
-- session timezone. Re-running is safe; columns already TIMESTAMPTZ are unchanged.
--
-- performance_evaluations.activity_date stays TIMESTAMP on purpose: it holds a calendar date.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE campuses ALTER COLUMN created_at TYPE TIMESTAMPTZ;
ALTER TABLE users ALTER COLUMN created_at TYPE TIMESTAMPTZ;
ALTER TABLE teams ALTER COLUMN created_at TYPE TIMESTAMPTZ;

ALTER TABLE assignment_history
  ALTER COLUMN effective_from TYPE TIMESTAMPTZ,
  ALTER COLUMN effective_to TYPE TIMESTAMPTZ;

ALTER TABLE point_entries
  ALTER COLUMN created_at TYPE TIMESTAMPTZ,
  ALTER COLUMN effective_at TYPE TIMESTAMPTZ;

ALTER TABLE monthly_rankings
  ALTER COLUMN archived_at TYPE TIMESTAMPTZ,
  ALTER COLUMN last_revised_at TYPE TIMESTAMPTZ;

ALTER TABLE performance_evaluations ALTER COLUMN created_at TYPE TIMESTAMPTZ;
ALTER TABLE audit_logs ALTER COLUMN created_at TYPE TIMESTAMPTZ;

COMMIT;
