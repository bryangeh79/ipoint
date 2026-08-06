-- 0034: P7 SEC-01 Manual iPoint Adjustment Maker/Checker (frozen-owner remediation)
--
-- Forward-only. Single migration owner (SEC-01, fix/p3-p7-sec01-ipoint-maker-checker).
-- 0033 and earlier remain byte-identical; checksums.json and expected-schema.ts
-- are updated in the same commit.
--
-- Scope (P7-OD-03/10/11/18/20, GATE-SEC-01): durable Maker/Checker lifecycle for
-- manual iPoint wallet adjustments with the exact approved state machine:
--   DRAFT -> SUBMITTED -> APPROVED | REJECTED -> EXECUTING -> EXECUTED | FAILED
-- Execution is delegated to the frozen Phase 3 wallet ledger owner (dedicated
-- wallet-domain append command); no immediate-execution path is created here.
--
-- Decision contract encoded as hard database guarantees:
--   * distinct server-derived Maker/Checker identities (checker <> maker CHECK),
--   * Malaysia soft/hard caps are VERSIONED PER-MARKET CONFIGURATION rows
--     (no hard-coded values in service logic, no cross-market fallback),
--   * reason-code catalog is versioned and market-scoped (high-risk codes
--     require an attachment reference at the owner boundary),
--   * opaque protected attachment reference only (length-bounded, never raw
--     file contents),
--   * payload-hash idempotency (unique (idempotency_scope, idempotency_key)),
--   * immutable rejected/executed history (decisions table, no status
--     overwrite; replacement linkage through prior_request_id),
--   * exact decimal amounts (numeric(38,10), amount > 0).

CREATE TYPE ipoint_adjustment_state AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'EXECUTED',
  'FAILED'
);

CREATE TYPE ipoint_adjustment_direction AS ENUM ('CREDIT', 'DEBIT');

-- Versioned per-market caps + evidence capability (P7-OD-10/11).
-- market_code mirrors the D-053 redemption_rate_market_rules convention
-- (no FK: the market row may be provisioned after the rule). Malaysia MVP
-- baseline 10,000 / 100,000 iPoint is seeded by the foundation seed.
CREATE TABLE ipoint_adjustment_market_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_code varchar(8) NOT NULL,
  soft_cap numeric(38, 10) NOT NULL,
  hard_cap numeric(38, 10) NOT NULL,
  secure_evidence_available boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT ipoint_adjustment_market_rules_market_unique UNIQUE (market_code),
  CONSTRAINT ipoint_adjustment_market_rules_soft_cap_check CHECK (soft_cap > 0),
  CONSTRAINT ipoint_adjustment_market_rules_hard_cap_check CHECK (
    hard_cap >= soft_cap
  ),
  CONSTRAINT ipoint_adjustment_market_rules_version_check CHECK (version > 0)
);

-- Versioned, market-scoped reason-code catalog (P7-OD-11). High-risk codes
-- force an attachment reference at the owner boundary.
CREATE TABLE ipoint_adjustment_reason_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_code varchar(8) NOT NULL,
  code varchar(100) NOT NULL,
  label varchar(200) NOT NULL,
  is_high_risk boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT ipoint_adjustment_reason_codes_market_code_unique UNIQUE (
    market_code,
    code
  ),
  CONSTRAINT ipoint_adjustment_reason_codes_code_check CHECK (
    char_length(btrim(code)) BETWEEN 1 AND 100
  ),
  CONSTRAINT ipoint_adjustment_reason_codes_label_check CHECK (
    char_length(btrim(label)) BETWEEN 1 AND 200
  ),
  CONSTRAINT ipoint_adjustment_reason_codes_version_check CHECK (version > 0)
);

CREATE TABLE ipoint_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_account_id uuid NOT NULL REFERENCES member_wallet_accounts (id) ON DELETE RESTRICT,
  member_id uuid NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets (id) ON DELETE RESTRICT,
  direction ipoint_adjustment_direction NOT NULL,
  amount numeric(38, 10) NOT NULL,
  state ipoint_adjustment_state NOT NULL DEFAULT 'DRAFT',
  reason_code varchar(100) NOT NULL,
  explanation text NOT NULL,
  case_reference varchar(200) NOT NULL,
  attachment_reference varchar(500),
  maker_admin_user_id uuid NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
  checker_admin_user_id uuid REFERENCES admin_users (id) ON DELETE RESTRICT,
  submitted_at timestamptz(6),
  executed_at timestamptz(6),
  failed_at timestamptz(6),
  idempotency_scope varchar(200) NOT NULL,
  idempotency_key varchar(200) NOT NULL,
  payload_hash varchar(64) NOT NULL,
  request_hash varchar(64) NOT NULL,
  prior_request_id uuid REFERENCES ipoint_adjustment_requests (id) ON DELETE RESTRICT,
  ledger_entry_id uuid REFERENCES member_wallet_entries (id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT ipoint_adjustment_requests_idempotency_unique UNIQUE (
    idempotency_scope,
    idempotency_key
  ),
  CONSTRAINT ipoint_adjustment_requests_amount_check CHECK (amount > 0),
  CONSTRAINT ipoint_adjustment_requests_version_check CHECK (version > 0),
  CONSTRAINT ipoint_adjustment_requests_reason_code_check CHECK (
    char_length(btrim(reason_code)) BETWEEN 1 AND 100
  ),
  CONSTRAINT ipoint_adjustment_requests_explanation_check CHECK (
    char_length(btrim(explanation)) BETWEEN 1 AND 2000
  ),
  CONSTRAINT ipoint_adjustment_requests_case_reference_check CHECK (
    char_length(btrim(case_reference)) BETWEEN 1 AND 200
  ),
  CONSTRAINT ipoint_adjustment_requests_attachment_reference_check CHECK (
    attachment_reference IS NULL
    OR (char_length(btrim(attachment_reference)) BETWEEN 1 AND 500)
  ),
  -- Distinct server-derived Maker/Checker identities: a request can never
  -- carry the same admin as maker and checker, at ANY amount, including
  -- Super Admin (P7-OD-10 runtime inequality + hard database guarantee).
  CONSTRAINT ipoint_adjustment_requests_checker_inequality CHECK (
    checker_admin_user_id IS NULL
    OR checker_admin_user_id <> maker_admin_user_id
  ),
  CONSTRAINT ipoint_adjustment_requests_payload_hash_check CHECK (
    char_length(payload_hash) = 64
  ),
  CONSTRAINT ipoint_adjustment_requests_request_hash_check CHECK (
    char_length(request_hash) = 64
  )
);

CREATE INDEX ipoint_adjustment_requests_state_market_idx
  ON ipoint_adjustment_requests (state, market_id);
CREATE INDEX ipoint_adjustment_requests_wallet_idx
  ON ipoint_adjustment_requests (wallet_account_id);

-- Immutable decision history (P7-OD-11/18): one decision per request,
-- never overwritten; rejection history remains permanently auditable.
CREATE TABLE ipoint_adjustment_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_request_id uuid NOT NULL REFERENCES ipoint_adjustment_requests (id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets (id) ON DELETE RESTRICT,
  checker_admin_user_id uuid NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
  decision varchar(20) NOT NULL,
  reason text NOT NULL,
  decided_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT ipoint_adjustment_decisions_request_unique UNIQUE (
    adjustment_request_id
  ),
  CONSTRAINT ipoint_adjustment_decisions_value_check CHECK (
    decision IN ('APPROVED', 'REJECTED')
  ),
  CONSTRAINT ipoint_adjustment_decisions_reason_check CHECK (
    char_length(btrim(reason)) BETWEEN 1 AND 2000
  )
);
