-- Aligns points and rankings with the approved specification. Re-running is safe.
--  * Idempotency keys for POST /api/points (a retried request returns the first entry, never a second one).
--  * The default per-operation cap follows the approved range (100) unless an organizer changed it.
--  * The combined cross-campus leaderboard is not part of the specification: switched off.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS point_idempotency_keys (
  actor_user_id INT NOT NULL REFERENCES users(user_id),
  idempotency_key VARCHAR(100) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  entry_id BIGINT NOT NULL REFERENCES point_entries(entry_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (actor_user_id, idempotency_key),
  CONSTRAINT chk_idempotency_key CHECK (CHAR_LENGTH(idempotency_key) BETWEEN 1 AND 100)
);

-- Supports the short-window duplicate guard (same actor, recipient and values within seconds).
CREATE INDEX IF NOT EXISTS idx_points_actor_created ON point_entries (performed_by_user_id, created_at);

UPDATE system_policies SET policy_value = '100', updated_at = CURRENT_TIMESTAMP
WHERE policy_key = 'maxPointsPerOperation' AND policy_value = '50'::jsonb AND updated_by_user_id IS NULL;

UPDATE system_policies SET policy_value = 'false', updated_at = CURRENT_TIMESTAMP
WHERE policy_key = 'globalLeaderboardEnabled' AND policy_value <> 'false'::jsonb;

COMMIT;
