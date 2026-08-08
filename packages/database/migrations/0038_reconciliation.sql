-- 0038: P8-S2 Advanced Financial Reconciliation
--
-- Forward-only domain addition. Migrations 0000-0037 remain byte-identical.
-- This domain is DETECTION + REVIEW + TRACEABILITY only. The engine reads
-- frozen ledgers/balances/orders (MCP, iPoint wallet, transactions, reward,
-- commission, refund, redemption) and writes only its own reconciliation
-- tables plus audit rows. There is NO destructive automatic correction and
-- no physical deletion of reconciliation history (E-30): all reconciliation
-- tables reject DELETE, and per-item evidence rows are write-once.

CREATE TYPE reconciliation_kind AS ENUM (
  'MCP', 'IPOINT', 'TRANSACTION_LEDGER', 'COMMISSION', 'REFUND', 'REDEMPTION'
);
CREATE TYPE reconciliation_run_status AS ENUM (
  'PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'
);
CREATE TYPE reconciliation_exception_status AS ENUM (
  'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CLOSED'
);
CREATE TYPE reconciliation_exception_classification AS ENUM (
  'AMOUNT_MISMATCH',
  'MISSING_EXPECTED',
  'UNEXPECTED_EXTRA',
  'REFERENCE_MISMATCH',
  'STATUS_MISMATCH',
  'LEDGER_INVARIANT_VIOLATION'
);
CREATE TYPE reconciliation_item_status AS ENUM (
  'MATCHED', 'MISMATCHED', 'MISSING', 'UNEXPECTED'
);

CREATE TABLE reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id uuid NOT NULL DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  kind reconciliation_kind NOT NULL,
  status reconciliation_run_status NOT NULL DEFAULT 'PENDING',
  window_start_at timestamptz(6) NOT NULL,
  window_end_at timestamptz(6) NOT NULL,
  expected_total numeric(38,10),
  actual_total numeric(38,10),
  difference_total numeric(38,10),
  matched_count integer,
  mismatched_count integer,
  exception_count integer,
  summary jsonb,
  failure_reason text,
  started_at timestamptz(6),
  completed_at timestamptz(6),
  failed_at timestamptz(6),
  cancelled_at timestamptz(6),
  run_by_admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  archived_at timestamptz(6),
  CONSTRAINT reconciliation_runs_public_id_unique UNIQUE (public_id),
  CONSTRAINT reconciliation_runs_id_market_unique UNIQUE (id, market_id),
  CONSTRAINT reconciliation_runs_window_check CHECK (window_end_at > window_start_at),
  CONSTRAINT reconciliation_runs_version_check CHECK (version > 0),
  CONSTRAINT reconciliation_runs_totals_check CHECK (
    (status = 'COMPLETED'
      AND expected_total IS NOT NULL
      AND actual_total IS NOT NULL
      AND difference_total IS NOT NULL
      AND matched_count IS NOT NULL
      AND mismatched_count IS NOT NULL
      AND exception_count IS NOT NULL)
    OR (status <> 'COMPLETED')
  ),
  CONSTRAINT reconciliation_runs_timestamps_check CHECK (
    (status = 'PENDING'
      AND started_at IS NULL AND completed_at IS NULL
      AND failed_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'RUNNING'
      AND started_at IS NOT NULL AND completed_at IS NULL
      AND failed_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'COMPLETED'
      AND started_at IS NOT NULL AND completed_at IS NOT NULL
      AND failed_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'FAILED'
      AND started_at IS NOT NULL AND failed_at IS NOT NULL
      AND completed_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'CANCELLED'
      AND cancelled_at IS NOT NULL AND completed_at IS NULL
      AND failed_at IS NULL)
  ),
  CONSTRAINT reconciliation_runs_failure_reason_check CHECK (
    (status = 'FAILED'
      AND char_length(btrim(coalesce(failure_reason, ''))) BETWEEN 1 AND 2000)
    OR (status <> 'FAILED')
  ),
  CONSTRAINT reconciliation_runs_archive_check CHECK (
    archived_at IS NULL OR archived_at >= created_at
  )
);
CREATE INDEX reconciliation_runs_market_kind_status_idx
  ON reconciliation_runs (market_id, kind, status, created_at);
CREATE INDEX reconciliation_runs_market_window_idx
  ON reconciliation_runs (market_id, window_start_at, window_end_at);

CREATE TABLE reconciliation_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  market_id uuid NOT NULL,
  reference_type varchar(40) NOT NULL,
  reference_id text NOT NULL,
  status reconciliation_item_status NOT NULL,
  expected_amount numeric(38,10) NOT NULL,
  actual_amount numeric(38,10) NOT NULL,
  difference_amount numeric(38,10) NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_run_items_id_market_unique UNIQUE (id, market_id),
  CONSTRAINT reconciliation_run_items_run_market_fk
    FOREIGN KEY (run_id, market_id)
    REFERENCES reconciliation_runs(id, market_id) ON DELETE RESTRICT,
  CONSTRAINT reconciliation_run_items_reference_unique
    UNIQUE (run_id, market_id, reference_type, reference_id),
  CONSTRAINT reconciliation_run_items_ref_type_check
    CHECK (char_length(btrim(reference_type)) BETWEEN 1 AND 40),
  CONSTRAINT reconciliation_run_items_ref_id_check
    CHECK (char_length(btrim(reference_id)) BETWEEN 1 AND 120),
  CONSTRAINT reconciliation_run_items_evidence_check
    CHECK (jsonb_typeof(evidence) = 'object')
);
CREATE INDEX reconciliation_run_items_run_status_idx
  ON reconciliation_run_items (run_id, status, created_at);

CREATE TABLE reconciliation_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  market_id uuid NOT NULL,
  kind reconciliation_kind NOT NULL,
  reference_type varchar(40) NOT NULL,
  reference_id text NOT NULL,
  expected_amount numeric(38,10) NOT NULL,
  actual_amount numeric(38,10) NOT NULL,
  difference_amount numeric(38,10) NOT NULL,
  classification reconciliation_exception_classification NOT NULL,
  status reconciliation_exception_status NOT NULL DEFAULT 'OPEN',
  investigation_notes text,
  acknowledged_by_admin_user_id uuid REFERENCES admin_users(id) ON DELETE RESTRICT,
  acknowledged_at timestamptz(6),
  resolved_by_admin_user_id uuid REFERENCES admin_users(id) ON DELETE RESTRICT,
  resolved_at timestamptz(6),
  closed_by_admin_user_id uuid REFERENCES admin_users(id) ON DELETE RESTRICT,
  closed_at timestamptz(6),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  archived_at timestamptz(6),
  CONSTRAINT reconciliation_exceptions_id_market_unique UNIQUE (id, market_id),
  CONSTRAINT reconciliation_exceptions_run_market_fk
    FOREIGN KEY (run_id, market_id)
    REFERENCES reconciliation_runs(id, market_id) ON DELETE RESTRICT,
  CONSTRAINT reconciliation_exceptions_run_reference_unique
    UNIQUE (run_id, market_id, reference_type, reference_id),
  CONSTRAINT reconciliation_exceptions_ref_type_check
    CHECK (char_length(btrim(reference_type)) BETWEEN 1 AND 40),
  CONSTRAINT reconciliation_exceptions_ref_id_check
    CHECK (char_length(btrim(reference_id)) BETWEEN 1 AND 120),
  CONSTRAINT reconciliation_exceptions_version_check CHECK (version > 0),
  CONSTRAINT reconciliation_exceptions_notes_check CHECK (
    investigation_notes IS NULL
    OR char_length(investigation_notes) BETWEEN 1 AND 10000
  ),
  CONSTRAINT reconciliation_exceptions_timestamps_check CHECK (
    (status = 'OPEN'
      AND acknowledged_by_admin_user_id IS NULL AND acknowledged_at IS NULL
      AND resolved_by_admin_user_id IS NULL AND resolved_at IS NULL
      AND closed_by_admin_user_id IS NULL AND closed_at IS NULL)
    OR (status = 'ACKNOWLEDGED'
      AND acknowledged_by_admin_user_id IS NOT NULL AND acknowledged_at IS NOT NULL
      AND resolved_by_admin_user_id IS NULL AND resolved_at IS NULL
      AND closed_by_admin_user_id IS NULL AND closed_at IS NULL)
    OR (status = 'RESOLVED'
      AND acknowledged_by_admin_user_id IS NOT NULL AND acknowledged_at IS NOT NULL
      AND resolved_by_admin_user_id IS NOT NULL AND resolved_at IS NOT NULL
      AND closed_by_admin_user_id IS NULL AND closed_at IS NULL)
    OR (status = 'CLOSED'
      AND acknowledged_by_admin_user_id IS NOT NULL AND acknowledged_at IS NOT NULL
      AND resolved_by_admin_user_id IS NOT NULL AND resolved_at IS NOT NULL
      AND closed_by_admin_user_id IS NOT NULL AND closed_at IS NOT NULL)
  ),
  CONSTRAINT reconciliation_exceptions_archive_check CHECK (
    archived_at IS NULL OR archived_at >= created_at
  )
);
CREATE INDEX reconciliation_exceptions_market_status_idx
  ON reconciliation_exceptions (market_id, status, created_at);
CREATE INDEX reconciliation_exceptions_run_idx
  ON reconciliation_exceptions (run_id, created_at);

CREATE TABLE reconciliation_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  operation varchar(80) NOT NULL,
  key varchar(200) NOT NULL,
  request_hash varchar(64) NOT NULL,
  response jsonb,
  status_code integer,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_idempotency_scope_unique
    UNIQUE (admin_user_id, market_id, operation, key),
  CONSTRAINT reconciliation_idempotency_hash_check
    CHECK (char_length(request_hash) = 64),
  CONSTRAINT reconciliation_idempotency_result_check CHECK (
    (response IS NULL AND status_code IS NULL)
    OR (response IS NOT NULL AND status_code BETWEEN 200 AND 599)
  )
);

-- E-30: reconciliation history is archived, never physically deleted.
CREATE TRIGGER reconciliation_runs_reject_delete
  BEFORE DELETE ON reconciliation_runs FOR EACH ROW EXECUTE FUNCTION reject_delete();
CREATE TRIGGER reconciliation_run_items_reject_delete
  BEFORE DELETE ON reconciliation_run_items FOR EACH ROW EXECUTE FUNCTION reject_delete();
CREATE TRIGGER reconciliation_exceptions_reject_delete
  BEFORE DELETE ON reconciliation_exceptions FOR EACH ROW EXECUTE FUNCTION reject_delete();
CREATE TRIGGER reconciliation_idempotency_keys_reject_delete
  BEFORE DELETE ON reconciliation_idempotency_keys FOR EACH ROW EXECUTE FUNCTION reject_delete();

-- Per-item evidence snapshots are write-once immutable evidence.
CREATE OR REPLACE FUNCTION reject_reconciliation_run_item_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'reconciliation_run_items are immutable evidence; insert a new run instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reconciliation_run_items_reject_update
  BEFORE UPDATE ON reconciliation_run_items
  FOR EACH ROW EXECUTE FUNCTION reject_reconciliation_run_item_update();

-- Canonical P8-S2 permissions. Existing controlled role templates are extended
-- explicitly; there is no Super Admin bypass and no unmanaged role expansion.
-- view extends all six controlled role templates; run and exception management
-- are restricted to SUPER_ADMIN / OPERATIONS_ADMIN and the Finance roles.
INSERT INTO permissions (code, description)
VALUES
  ('reconciliation.view', 'View selected-market reconciliation runs and exception queues.'),
  ('reconciliation.run', 'Create, execute and cancel selected-market reconciliation runs.'),
  ('reconciliation.exception.manage', 'Manage selected-market reconciliation exception lifecycle and notes.')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'reconciliation.view'
WHERE r.code IN (
  'SUPER_ADMIN', 'OPERATIONS_ADMIN', 'FINANCE_OPERATOR',
  'FINANCE_APPROVER', 'KYC_REVIEWER', 'SUPPORT_READONLY_AUDITOR'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('reconciliation.run', 'reconciliation.exception.manage')
WHERE r.code IN (
  'SUPER_ADMIN', 'OPERATIONS_ADMIN', 'FINANCE_OPERATOR', 'FINANCE_APPROVER'
)
ON CONFLICT DO NOTHING;
