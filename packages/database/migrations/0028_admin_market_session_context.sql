-- 0028: Phase 7 server-owned Current Admin Market context.
-- Forward-only. Selection is bound to one canonical session; a client hint is
-- never a grant and cannot populate these fields directly.

ALTER TABLE sessions
  ADD COLUMN current_admin_market_id uuid REFERENCES markets(id) ON DELETE RESTRICT,
  ADD COLUMN current_admin_market_selected_at timestamptz(6),
  ADD COLUMN market_context_version integer NOT NULL DEFAULT 1;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_admin_market_context_check CHECK (
    (current_admin_market_id IS NULL AND current_admin_market_selected_at IS NULL)
    OR
    (current_admin_market_id IS NOT NULL AND current_admin_market_selected_at IS NOT NULL)
  ),
  ADD CONSTRAINT sessions_market_context_version_check CHECK (
    market_context_version > 0
  );

CREATE INDEX sessions_current_admin_market_idx
  ON sessions (current_admin_market_id, market_context_version);
