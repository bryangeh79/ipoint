ALTER TABLE sessions
  ADD COLUMN access_expires_at timestamptz(6);

UPDATE sessions
SET access_expires_at = LEAST(expires_at, created_at + interval '15 minutes')
WHERE access_expires_at IS NULL;

ALTER TABLE sessions
  ALTER COLUMN access_expires_at SET NOT NULL;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_access_expiry_check
  CHECK (access_expires_at > created_at AND access_expires_at <= expires_at);
