-- 0039: P8-S3 Risk / Fraud / Operational Controls
--
-- Forward-only domain addition. Migrations 0000-0038 remain byte-identical.
-- This domain is DETECTION + REVIEW + TRACEABILITY only: detectors are
-- read-only queries over frozen ledgers/balances/transactions/adjustments/
-- rates/audit/security tables and NEVER write to them. There are NO
-- enforcement side-effects (no freeze / block / debit / disable / penalty /
-- confiscation / automatic permanent ban), no invented business thresholds
-- (every threshold is operator-configurable definition config), and no
-- physical deletion (E-30 reject_delete on every domain table).

CREATE TYPE risk_indicator_category AS ENUM (
  'SUSPICIOUS_TRANSACTION',
  'DUPLICATE_REPLAY',
  'ABNORMAL_ADJUSTMENT',
  'RATE_CONFIG_ANOMALY',
  'CROSS_MARKET_VIOLATION',
  'ACCOUNT_ADMIN_ABUSE',
  'SECURITY_EVENT',
  'REVIEW_QUEUE'
);
CREATE TYPE risk_event_severity AS ENUM (
  'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
);
CREATE TYPE risk_run_status AS ENUM (
  'PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'
);
CREATE TYPE risk_event_status AS ENUM ('FLAGGED');
CREATE TYPE risk_review_status AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED');
CREATE TYPE risk_review_decision AS ENUM (
  'NO_ACTION', 'WATCH', 'ESCALATED'
);

-- Indicator definitions are versioned rows: a new version is a NEW row that
-- supersedes the current one (write-once history; config/name/severity of an
-- existing version never mutate). Only the current (non-superseded) enabled
-- version of a (market_id, code) pair is active for detection. Thresholds are
-- operator-configurable via `config`; the migration ships no business values.
CREATE TABLE risk_indicator_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(100) NOT NULL,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  category risk_indicator_category NOT NULL,
  name varchar(200) NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity risk_event_severity NOT NULL DEFAULT 'MEDIUM',
  version integer NOT NULL DEFAULT 1,
  superseded_by_id uuid REFERENCES risk_indicator_definitions(id) ON DELETE RESTRICT,
  superseded_at timestamptz(6),
  created_by_admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  archived_at timestamptz(6),
  CONSTRAINT risk_indicator_definitions_id_market_unique UNIQUE (id, market_id),
  CONSTRAINT risk_indicator_definitions_code_version_unique
    UNIQUE (market_id, code, version),
  CONSTRAINT risk_indicator_definitions_code_check
    CHECK (char_length(btrim(code)) BETWEEN 1 AND 100),
  CONSTRAINT risk_indicator_definitions_name_check
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT risk_indicator_definitions_description_check
    CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 2000),
  CONSTRAINT risk_indicator_definitions_config_check
    CHECK (jsonb_typeof(config) = 'object'),
  CONSTRAINT risk_indicator_definitions_version_check CHECK (version > 0),
  CONSTRAINT risk_indicator_definitions_supersede_consistency CHECK (
    (superseded_by_id IS NULL AND superseded_at IS NULL)
    OR (
      superseded_by_id IS NOT NULL
      AND superseded_at IS NOT NULL
      AND superseded_by_id <> id
    )
  ),
  CONSTRAINT risk_indicator_definitions_archive_check CHECK (
    archived_at IS NULL OR archived_at >= created_at
  )
);
CREATE INDEX risk_indicator_definitions_market_category_idx
  ON risk_indicator_definitions (market_id, category, enabled, version);
CREATE INDEX risk_indicator_definitions_code_idx
  ON risk_indicator_definitions (market_id, code, version);

-- Manual detection runs: one category per run, market-bounded window.
CREATE TABLE risk_detection_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id uuid NOT NULL DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  category risk_indicator_category NOT NULL,
  status risk_run_status NOT NULL DEFAULT 'PENDING',
  window_start_at timestamptz(6) NOT NULL,
  window_end_at timestamptz(6) NOT NULL,
  definitions_scanned integer,
  events_detected integer,
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
  CONSTRAINT risk_detection_runs_public_id_unique UNIQUE (public_id),
  CONSTRAINT risk_detection_runs_id_market_unique UNIQUE (id, market_id),
  CONSTRAINT risk_detection_runs_window_check CHECK (window_end_at > window_start_at),
  CONSTRAINT risk_detection_runs_version_check CHECK (version > 0),
  CONSTRAINT risk_detection_runs_totals_check CHECK (
    (status = 'COMPLETED'
      AND definitions_scanned IS NOT NULL
      AND events_detected IS NOT NULL)
    OR (status <> 'COMPLETED')
  ),
  CONSTRAINT risk_detection_runs_timestamps_check CHECK (
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
  CONSTRAINT risk_detection_runs_failure_reason_check CHECK (
    (status = 'FAILED'
      AND char_length(btrim(coalesce(failure_reason, ''))) BETWEEN 1 AND 2000)
    OR (status <> 'FAILED')
  ),
  CONSTRAINT risk_detection_runs_archive_check CHECK (
    archived_at IS NULL OR archived_at >= created_at
  )
);
CREATE INDEX risk_detection_runs_market_category_status_idx
  ON risk_detection_runs (market_id, category, status, created_at);
CREATE INDEX risk_detection_runs_market_window_idx
  ON risk_detection_runs (market_id, window_start_at, window_end_at);

-- Detected risk events: write-once immutable evidence snapshots. Events are
-- never updated and never deleted; review/decision state lives exclusively
-- in risk_review_queue so the detection record cannot be altered.
CREATE TABLE risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  market_id uuid NOT NULL,
  indicator_id uuid NOT NULL,
  indicator_code varchar(100) NOT NULL,
  indicator_version integer NOT NULL,
  category risk_indicator_category NOT NULL,
  severity risk_event_severity NOT NULL,
  entity_type varchar(40) NOT NULL,
  entity_id text NOT NULL,
  entity_market_id uuid REFERENCES markets(id) ON DELETE RESTRICT,
  payload jsonb NOT NULL,
  detection_metadata jsonb NOT NULL,
  status risk_event_status NOT NULL DEFAULT 'FLAGGED',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT risk_events_id_market_unique UNIQUE (id, market_id),
  CONSTRAINT risk_events_run_market_fk
    FOREIGN KEY (run_id, market_id)
    REFERENCES risk_detection_runs(id, market_id) ON DELETE RESTRICT,
  CONSTRAINT risk_events_indicator_market_fk
    FOREIGN KEY (indicator_id, market_id)
    REFERENCES risk_indicator_definitions(id, market_id) ON DELETE RESTRICT,
  CONSTRAINT risk_events_run_reference_unique
    UNIQUE (run_id, market_id, indicator_code, entity_type, entity_id),
  CONSTRAINT risk_events_entity_type_check
    CHECK (char_length(btrim(entity_type)) BETWEEN 1 AND 40),
  CONSTRAINT risk_events_entity_id_check
    CHECK (char_length(btrim(entity_id)) BETWEEN 1 AND 120),
  CONSTRAINT risk_events_code_check
    CHECK (char_length(btrim(indicator_code)) BETWEEN 1 AND 100),
  CONSTRAINT risk_events_indicator_version_check CHECK (indicator_version > 0),
  CONSTRAINT risk_events_payload_check
    CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT risk_events_metadata_check
    CHECK (jsonb_typeof(detection_metadata) = 'object'),
  CONSTRAINT risk_events_status_check CHECK (status = 'FLAGGED')
);
CREATE INDEX risk_events_market_status_idx
  ON risk_events (market_id, status, created_at);
CREATE INDEX risk_events_market_category_idx
  ON risk_events (market_id, category, created_at);
CREATE INDEX risk_events_run_idx
  ON risk_events (run_id, created_at);
CREATE INDEX risk_events_indicator_idx
  ON risk_events (indicator_id, created_at);

-- Review queue: one task per detected event. Strict lifecycle
-- OPEN -> IN_REVIEW -> RESOLVED with versioned optimistic locking and
-- append-only actor-stamped notes. Decisions are neutral operational review
-- outcomes only (NO_ACTION / WATCH / ESCALATED) -- never enforcement actions.
CREATE TABLE risk_review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  market_id uuid NOT NULL,
  status risk_review_status NOT NULL DEFAULT 'OPEN',
  assigned_admin_user_id uuid REFERENCES admin_users(id) ON DELETE RESTRICT,
  decision risk_review_decision,
  decision_reason text,
  notes text,
  resolved_by_admin_user_id uuid REFERENCES admin_users(id) ON DELETE RESTRICT,
  resolved_at timestamptz(6),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  archived_at timestamptz(6),
  CONSTRAINT risk_review_queue_id_market_unique UNIQUE (id, market_id),
  CONSTRAINT risk_review_queue_event_market_unique UNIQUE (event_id, market_id),
  CONSTRAINT risk_review_queue_event_market_fk
    FOREIGN KEY (event_id, market_id)
    REFERENCES risk_events(id, market_id) ON DELETE RESTRICT,
  CONSTRAINT risk_review_queue_version_check CHECK (version > 0),
  CONSTRAINT risk_review_queue_decision_consistency CHECK (
    (decision IS NULL AND decision_reason IS NULL)
    OR (
      decision IS NOT NULL
      AND char_length(btrim(decision_reason)) BETWEEN 1 AND 2000
    )
  ),
  CONSTRAINT risk_review_queue_notes_check CHECK (
    notes IS NULL OR char_length(notes) BETWEEN 1 AND 20000
  ),
  CONSTRAINT risk_review_queue_timestamps_check CHECK (
    (status = 'OPEN'
      AND assigned_admin_user_id IS NULL
      AND resolved_by_admin_user_id IS NULL AND resolved_at IS NULL)
    OR (status = 'IN_REVIEW'
      AND assigned_admin_user_id IS NOT NULL
      AND resolved_by_admin_user_id IS NULL AND resolved_at IS NULL)
    OR (status = 'RESOLVED'
      AND assigned_admin_user_id IS NOT NULL
      AND decision IS NOT NULL
      AND resolved_by_admin_user_id IS NOT NULL AND resolved_at IS NOT NULL)
  ),
  CONSTRAINT risk_review_queue_archive_check CHECK (
    archived_at IS NULL OR archived_at >= created_at
  )
);
CREATE INDEX risk_review_queue_market_status_idx
  ON risk_review_queue (market_id, status, created_at);
CREATE INDEX risk_review_queue_event_idx
  ON risk_review_queue (event_id, created_at);
CREATE INDEX risk_review_queue_assignee_status_idx
  ON risk_review_queue (assigned_admin_user_id, status, created_at);

CREATE TABLE risk_idempotency_keys (
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
  CONSTRAINT risk_idempotency_scope_unique
    UNIQUE (admin_user_id, market_id, operation, key),
  CONSTRAINT risk_idempotency_hash_check
    CHECK (char_length(request_hash) = 64),
  CONSTRAINT risk_idempotency_result_check CHECK (
    (response IS NULL AND status_code IS NULL)
    OR (response IS NOT NULL AND status_code BETWEEN 200 AND 599)
  )
);

-- E-30: risk records are archived, never physically deleted.
CREATE TRIGGER risk_indicator_definitions_reject_delete
  BEFORE DELETE ON risk_indicator_definitions FOR EACH ROW EXECUTE FUNCTION reject_delete();
CREATE TRIGGER risk_detection_runs_reject_delete
  BEFORE DELETE ON risk_detection_runs FOR EACH ROW EXECUTE FUNCTION reject_delete();
CREATE TRIGGER risk_events_reject_delete
  BEFORE DELETE ON risk_events FOR EACH ROW EXECUTE FUNCTION reject_delete();
CREATE TRIGGER risk_review_queue_reject_delete
  BEFORE DELETE ON risk_review_queue FOR EACH ROW EXECUTE FUNCTION reject_delete();
CREATE TRIGGER risk_idempotency_keys_reject_delete
  BEFORE DELETE ON risk_idempotency_keys FOR EACH ROW EXECUTE FUNCTION reject_delete();

-- Detected events are immutable evidence (write-once).
CREATE OR REPLACE FUNCTION reject_risk_event_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'risk_events are immutable detection evidence; run a new detection instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER risk_events_reject_update
  BEFORE UPDATE ON risk_events
  FOR EACH ROW EXECUTE FUNCTION reject_risk_event_update();

-- Canonical P8-S3 permissions. Mirrors P8-S2: view extends all six controlled
-- role templates; review/run/definition management is restricted to
-- SUPER_ADMIN / OPERATIONS_ADMIN and the Finance roles. No Super Admin
-- bypass and no unmanaged role expansion.
INSERT INTO permissions (code, description)
VALUES
  ('risk.view', 'View selected-market risk indicators, detection runs, events and review queues.'),
  ('risk.review.manage', 'Manage selected-market risk indicator definitions, detection runs and review queue lifecycle.')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'risk.view'
WHERE r.code IN (
  'SUPER_ADMIN', 'OPERATIONS_ADMIN', 'FINANCE_OPERATOR',
  'FINANCE_APPROVER', 'KYC_REVIEWER', 'SUPPORT_READONLY_AUDITOR'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'risk.review.manage'
WHERE r.code IN (
  'SUPER_ADMIN', 'OPERATIONS_ADMIN', 'FINANCE_OPERATOR', 'FINANCE_APPROVER'
)
ON CONFLICT DO NOTHING;
