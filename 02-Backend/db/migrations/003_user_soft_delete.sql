BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by_user_id INTEGER REFERENCES users(user_id);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'users'::regclass AND conname = 'users_deleted_inactive'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_deleted_inactive
      CHECK (deleted_at IS NULL OR is_active = FALSE);
  END IF;
END
$$;
COMMIT;
