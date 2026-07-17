-- 0009_add_sessions_family_id_index
-- 
-- Purpose: Add index on sessions.family_id for refresh token reuse revocation.
-- The rotateSession method revokes ALL sessions in a family when refresh
-- token reuse is detected. Without this index, the query:
--   UPDATE sessions SET ... WHERE family_id = $1
-- performs a sequential scan on the sessions table.
--
-- Note: CONCURRENTLY is intentionally omitted because the migration runner
-- wraps each migration in a transaction, and CREATE INDEX CONCURRENTLY
-- is not allowed inside a transaction block.

CREATE INDEX IF NOT EXISTS sessions_family_id_idx
  ON sessions (family_id);
