-- A member who transfers mid-month gets one snapshot row for each team or campus they earned
-- under, so uniqueness must include the team and campus. Team rows use team_id; Campus rows have
-- a NULL team_id and are distinguished by campus_id. Re-running is safe.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE monthly_rankings DROP CONSTRAINT IF EXISTS uq_user_month_scope;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_month_scope_context
  ON monthly_rankings (user_id, ranking_scope, campus_id, COALESCE(team_id, 0), year, month);

COMMIT;
