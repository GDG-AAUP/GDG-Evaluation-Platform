-- 012: what a person asks for when they request access (POST /api/registrations/request).
-- requested_role / requested_campus_id / requested_team_id are the applicant's wishes; the approver
-- still assigns the final role, campus and team. Regular Organizers see and decide only Member and
-- Manager requests for their own campus; Super Admins see all. Requests recorded before this
-- migration have no requested values and are visible to Super Admins only.
-- Safe to run more than once.
BEGIN;

ALTER TABLE registration_requests
  ADD COLUMN IF NOT EXISTS requested_role VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS requested_campus_id INT NULL REFERENCES campuses(campus_id),
  ADD COLUMN IF NOT EXISTS requested_team_id INT NULL REFERENCES teams(team_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'registration_requests'::regclass AND conname = 'chk_registration_requested_role') THEN
    ALTER TABLE registration_requests ADD CONSTRAINT chk_registration_requested_role
      CHECK (requested_role IS NULL OR requested_role IN ('organizer', 'manager', 'member'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'registration_requests'::regclass AND conname = 'chk_registration_requested_team') THEN
    ALTER TABLE registration_requests ADD CONSTRAINT chk_registration_requested_team
      CHECK (requested_team_id IS NULL OR requested_role IN ('manager', 'member'));
  END IF;
END $$;

-- Scoped pending lists: (status, campus) for an Organizer's own campus.
CREATE INDEX IF NOT EXISTS idx_registration_status_campus
  ON registration_requests (registration_status, requested_campus_id);

COMMIT;
