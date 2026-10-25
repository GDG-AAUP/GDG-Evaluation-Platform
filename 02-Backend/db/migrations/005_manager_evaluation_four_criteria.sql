
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

LOCK TABLE performance_evaluations IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  incompatible_count BIGINT;
BEGIN
  SELECT COUNT(*)
  INTO incompatible_count
  FROM performance_evaluations
  WHERE CASE
    WHEN jsonb_typeof(criteria_scores) = 'array'
      THEN jsonb_array_length(criteria_scores) <> 4
    ELSE TRUE
  END;

  IF incompatible_count > 0 THEN
    RAISE EXCEPTION
      'MIGRATION_BLOCKED: % existing evaluation(s) do not contain exactly 4 criteria. Review existing data before migrating.',
      incompatible_count;
  END IF;
END
$$;

ALTER TABLE performance_evaluations
DROP CONSTRAINT IF EXISTS chk_perf_criteria_count;

ALTER TABLE performance_evaluations
ADD CONSTRAINT chk_perf_criteria_count
CHECK (
  jsonb_typeof(criteria_scores) = 'array'
  AND jsonb_array_length(criteria_scores) = 4
);

COMMIT;
