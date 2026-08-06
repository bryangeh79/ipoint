-- 0035: P7-S7A Manual MCP Adjustment D-046 conformance (P7-OD-03/10/11/18)
--
-- Forward-only. Single migration owner (P7-S7A, task/p7-s7a-mcp-conformance).
-- 0034 and earlier remain byte-identical; checksums.json and expected-schema.ts
-- are updated in the same commit.
--
-- Scope (D-046 P7-OD-03/10/11/18, P7-S1 §16): align the accepted Phase 1 MCP
-- adjustment owner with the frozen Manual-MCP Maker/Checker contract:
--   * lifecycle conforms to DRAFT -> SUBMITTED -> APPROVED | REJECTED ->
--     EXECUTING -> EXECUTED | FAILED (new enum values; legacy PENDING_APPROVAL
--     / CANCELLED rows are untouched),
--   * distinct server-derived Maker/Checker identities (runtime inequality in
--     the owner + DB CHECK on the request row as the hard guarantee),
--   * Malaysia soft/hard caps are VERSIONED PER-MARKET CONFIGURATION rows
--     (10,000 / 100,000 MCP baseline seeded by the foundation seed; no
--     hard-coded values in service logic, no cross-market fallback),
--   * reason-code catalog is versioned and market-scoped (high-risk codes
--     require an opaque attachment reference at the owner boundary),
--   * opaque protected attachment reference only (length-bounded, never raw
--     file contents),
--   * operation-scoped payload-hash idempotency (partial unique index on
--     (idempotency_scope, idempotency_key); legacy rows keep the original
--     (mcp_account_id, idempotency_key) constraint),
--   * immutable rejected/executed history (evidence identity trigger; prior
--     replacement linkage through prior_request_id),
--   * exact decimal amounts (numeric(38,10), amount > 0).
--
-- The MCP ledger append (append_mcp_ledger_entry) is already direction-aware
-- (CREDIT/DEBIT) and is reused as-is by the conformed owner; no new ledger
-- command is required.

-- 1. Lifecycle enum values (D-046 model). PG 12+ allows ADD VALUE inside the
--    migration transaction as long as the new value is not used in the same
--    transaction; this migration only defines them.
ALTER TYPE adjustment_state ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE adjustment_state ADD VALUE IF NOT EXISTS 'EXECUTING';
ALTER TYPE adjustment_state ADD VALUE IF NOT EXISTS 'FAILED';

-- 2. Versioned per-market caps + evidence capability (P7-OD-10/11).
--    market_code mirrors the ipoint_adjustment_market_rules convention
--    (no FK: the market row may be provisioned after the rule). Malaysia MVP
--    baseline 10,000 / 100,000 MCP is seeded by the foundation seed.
CREATE TABLE mcp_adjustment_market_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_code varchar(8) NOT NULL,
  soft_cap numeric(38, 10) NOT NULL,
  hard_cap numeric(38, 10) NOT NULL,
  secure_evidence_available boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT mcp_adjustment_market_rules_market_unique UNIQUE (market_code),
  CONSTRAINT mcp_adjustment_market_rules_soft_cap_check CHECK (soft_cap > 0),
  CONSTRAINT mcp_adjustment_market_rules_hard_cap_check CHECK (
    hard_cap >= soft_cap
  ),
  CONSTRAINT mcp_adjustment_market_rules_version_check CHECK (version > 0)
);

-- 3. Versioned, market-scoped reason-code catalog (P7-OD-11). High-risk codes
--    force an attachment reference at the owner boundary.
CREATE TABLE mcp_adjustment_reason_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_code varchar(8) NOT NULL,
  code varchar(100) NOT NULL,
  label varchar(200) NOT NULL,
  is_high_risk boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT mcp_adjustment_reason_codes_market_code_unique UNIQUE (
    market_code,
    code
  ),
  CONSTRAINT mcp_adjustment_reason_codes_code_check CHECK (
    char_length(btrim(code)) BETWEEN 1 AND 100
  ),
  CONSTRAINT mcp_adjustment_reason_codes_label_check CHECK (
    char_length(btrim(label)) BETWEEN 1 AND 200
  ),
  CONSTRAINT mcp_adjustment_reason_codes_version_check CHECK (version > 0)
);

-- 4. Extend mcp_adjustment_requests with the D-046 conformance columns.
--    New columns are NULLABLE so legacy rows keep their original freeform
--    representation (never backfilled with invented values); the conformed
--    owner requires them for every NEW request at the application boundary.
ALTER TABLE mcp_adjustment_requests
  ADD COLUMN reason_code varchar(100),
  ADD COLUMN case_reference varchar(200),
  ADD COLUMN attachment_reference varchar(500),
  ADD COLUMN checker_admin_user_id uuid REFERENCES admin_users (id) ON DELETE RESTRICT,
  ADD COLUMN submitted_at timestamptz(6),
  ADD COLUMN executed_at timestamptz(6),
  ADD COLUMN failed_at timestamptz(6),
  ADD COLUMN idempotency_scope varchar(200),
  ADD COLUMN prior_request_id uuid REFERENCES mcp_adjustment_requests (id) ON DELETE RESTRICT;

ALTER TABLE mcp_adjustment_requests
  ADD CONSTRAINT mcp_adjustment_reason_code_check CHECK (
    reason_code IS NULL OR char_length(btrim(reason_code)) BETWEEN 1 AND 100
  ),
  ADD CONSTRAINT mcp_adjustment_case_reference_check CHECK (
    case_reference IS NULL
    OR char_length(btrim(case_reference)) BETWEEN 1 AND 200
  ),
  ADD CONSTRAINT mcp_adjustment_attachment_reference_check CHECK (
    attachment_reference IS NULL
    OR (char_length(btrim(attachment_reference)) BETWEEN 1 AND 500)
  ),
  -- Distinct server-derived Maker/Checker identities at ANY amount, incl.
  -- Super Admin (P7-OD-10 runtime inequality + hard database guarantee).
  ADD CONSTRAINT mcp_adjustment_checker_inequality CHECK (
    checker_admin_user_id IS NULL
    OR checker_admin_user_id <> maker_admin_user_id
  );

-- Operation-scoped idempotency for new rows (D-046 payload-hash
-- idempotency). The legacy (mcp_account_id, idempotency_key) unique is
-- DROPPED so idempotency is scoped exactly like the accepted SEC-01 wallet
-- owner (scope includes account + actor): the same key on the same account
-- from a DIFFERENT actor is a legitimate new scope, never a false conflict.
-- Legacy rows keep their historical keys; the partial unique index only
-- covers rows that carry an idempotency scope (all new rows).
ALTER TABLE mcp_adjustment_requests
  DROP CONSTRAINT mcp_adjustment_account_idempotency_unique;

CREATE UNIQUE INDEX mcp_adjustment_idempotency_scope_key_unique
  ON mcp_adjustment_requests (idempotency_scope, idempotency_key)
  WHERE idempotency_scope IS NOT NULL;

-- Queue / history read projection index (Finance queue, P7-S1 §16).
CREATE INDEX mcp_adjustment_requests_status_market_idx
  ON mcp_adjustment_requests (status, market_id);

-- 5. Immutable evidence identity: once written, the reason code, case
--    reference, attachment reference, prior linkage, entry type and maker
--    can never change. Rejected/executed history therefore stays zero-
--    modification (P7-OD-18). checker_admin_user_id is intentionally NOT
--    protected: it transitions NULL -> checker once at decide time.
CREATE FUNCTION protect_mcp_adjustment_evidence_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reason_code IS DISTINCT FROM OLD.reason_code OR
     NEW.case_reference IS DISTINCT FROM OLD.case_reference OR
     NEW.attachment_reference IS DISTINCT FROM OLD.attachment_reference OR
     NEW.prior_request_id IS DISTINCT FROM OLD.prior_request_id OR
     NEW.entry_type IS DISTINCT FROM OLD.entry_type OR
     NEW.maker_admin_user_id IS DISTINCT FROM OLD.maker_admin_user_id THEN
    RAISE EXCEPTION 'MCP adjustment evidence identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mcp_adjustment_evidence_identity_guard
BEFORE UPDATE ON mcp_adjustment_requests
FOR EACH ROW EXECUTE FUNCTION protect_mcp_adjustment_evidence_identity();
