-- 011: Super Admin governance.
-- * governance_settings: one row (id = 1) of flags only a Super Admin may change. Super Admins are
--   identified by Clerk user ID through SUPER_ADMIN_CLERK_IDS in the backend environment, not here.
-- * users.organizer_campus_id: the campus an Organizer works in. Organizers belong to no team, so
--   their campus is stored explicitly; evaluations are limited to it unless a delegation flag is on.
--   Existing Organizers start with no campus: a Super Admin assigns one before they can evaluate.
-- Safe to run more than once.
BEGIN;

CREATE TABLE IF NOT EXISTS governance_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  allow_organizer_member_eval BOOLEAN NOT NULL DEFAULT FALSE,
  allow_jenin_eval_ramallah BOOLEAN NOT NULL DEFAULT FALSE,
  allow_ramallah_eval_jenin BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by VARCHAR(255),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO governance_settings (id, allow_organizer_member_eval, allow_jenin_eval_ramallah, allow_ramallah_eval_jenin)
VALUES (1, FALSE, FALSE, FALSE)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS organizer_campus_id INT NULL REFERENCES campuses(campus_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'users'::regclass AND conname = 'chk_user_organizer_campus') THEN
    ALTER TABLE users ADD CONSTRAINT chk_user_organizer_campus
      CHECK (organizer_campus_id IS NULL OR role = 'Organizer');
  END IF;
END $$;

COMMIT;
