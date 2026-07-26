-- Phase 5 P5-S8: Durable Transaction Commission Dispatch Outbox
-- Forward-only migration.
-- Written in the same database transaction as CONFIRMED transaction commit.
-- Worker claims via pg_try_advisory_lock for crash-safe, at-least-once processing.

CREATE TABLE IF NOT EXISTS transaction_commission_dispatch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  event_type varchar(40) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  available_at timestamptz(6) NOT NULL DEFAULT now(),
  locked_at timestamptz(6),
  locked_by varchar(64),
  last_error text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  completed_at timestamptz(6),

  CONSTRAINT uq_dispatch_event UNIQUE (transaction_id, event_type),
  CONSTRAINT chk_dispatch_status CHECK (
    status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')
  ),
  CONSTRAINT chk_dispatch_attempts CHECK (
    attempts >= 0 AND attempts <= max_attempts
  ),
  CONSTRAINT chk_dispatch_available_at CHECK (
    available_at >= created_at
  )
);

CREATE INDEX idx_dispatch_pending
  ON transaction_commission_dispatch (available_at, status)
  WHERE status = 'PENDING';

CREATE INDEX idx_dispatch_stale
  ON transaction_commission_dispatch (locked_at, status)
  WHERE status = 'PROCESSING';
