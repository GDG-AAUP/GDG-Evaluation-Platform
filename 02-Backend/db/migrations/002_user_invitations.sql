BEGIN;

ALTER TABLE users
  ADD COLUMN invitation_status VARCHAR(20)
    NOT NULL DEFAULT 'not_required',
  ADD COLUMN clerk_invitation_id VARCHAR(255) UNIQUE,
  ADD COLUMN invited_by_user_id INTEGER
    REFERENCES users(user_id),
  ADD COLUMN invited_at TIMESTAMP WITH TIME ZONE,
  ADD CONSTRAINT users_invitation_status_check
    CHECK (
      invitation_status IN (
        'not_required',
        'pending',
        'sending',
        'sent',
        'failed',
        'accepted'
      )
    );

COMMIT;