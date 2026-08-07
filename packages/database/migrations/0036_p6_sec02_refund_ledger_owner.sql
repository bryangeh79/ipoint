-- 0036: P6 SEC-02 Refund Ledger Owner hardening (frozen-owner remediation)
--
-- Forward-only. Single migration owner (SEC-02, fix/p6-r1-sec02-refund-ledger).
-- 0035 and earlier remain byte-identical; checksums.json and expected-schema.ts
-- are updated in the same commit.
--
-- Scope (GATE-SEC-02 / Command Center 2026-08-07 SEC-02 instruction §4): harden
-- the Phase 6 refund lifecycle into one secure owner with:
--   * Full-refund-only enforcement (OD-12 PENDING => full amount only),
--   * Maker/Checker with Maker <> Checker (no threshold exemption),
--   * payload-hash idempotency for the CREATE operation (same key + same
--     payload replays the stored request; different payload conflicts),
--   * one active refund request per order (create-race hard guarantee),
--   * durable terminal outcomes (EXECUTING / COMPLETED / FAILED) with
--     executed_at / failed_at / failure_reason,
--   * prior_order_status captured at create so a REJECT restores the exact
--     pre-refund order status (FULFILMENT_EXCEPTION or FULFILMENT_SUSPENDED),
--   * REFUND_PENDING -> REFUNDED remains the only wallet-ledger success path
--     (the existing Phase 6 state machine is preserved, not replaced).
--
-- The wallet compensating entry (REDEMPTION_REFUND) uses the existing
-- member_wallet_entries ledger (entry type already exists); no ledger change.

-- ── 1. Idempotency + durable outcome + restore metadata ──────────────────

ALTER TABLE redemption_refund_requests
  ADD COLUMN IF NOT EXISTS idempotency_scope varchar(200),
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(200),
  ADD COLUMN IF NOT EXISTS payload_hash varchar(64),
  ADD COLUMN IF NOT EXISTS prior_order_status varchar(32),
  ADD COLUMN IF NOT EXISTS executed_at timestamptz(6),
  ADD COLUMN IF NOT EXISTS failed_at timestamptz(6),
  ADD COLUMN IF NOT EXISTS failure_reason text;

-- Payload-hash idempotency (operation-level): unique (scope, key). Legacy
-- rows keep NULL/NULL (Postgres treats NULLs as distinct, so no conflict).
CREATE UNIQUE INDEX IF NOT EXISTS ux_refund_idempotency
  ON redemption_refund_requests (idempotency_scope, idempotency_key);

-- One ACTIVE refund request per order: a second concurrent create for the
-- same order is rejected at the database (no double refund path).
CREATE UNIQUE INDEX IF NOT EXISTS ux_refund_order_active
  ON redemption_refund_requests (order_id)
  WHERE status IN ('PENDING_CHECKER', 'EXECUTING');

-- prior_order_status must be a real redemption order status (frozen P6-S0
-- §20.2 state machine) when captured.
ALTER TABLE redemption_refund_requests
  DROP CONSTRAINT IF EXISTS chk_refund_prior_status;
ALTER TABLE redemption_refund_requests
  ADD CONSTRAINT chk_refund_prior_status CHECK (
    prior_order_status IS NULL
    OR prior_order_status IN (
      'CONFIRMED', 'PROCESSING', 'READY_FOR_PICKUP', 'BACKORDERED',
      'FULFILMENT_SUSPENDED', 'FULFILMENT_EXCEPTION',
      'REFUND_PENDING', 'REFUNDED', 'FULFILLED'
    )
  );

-- Reason is the durable business justification; never blank, bounded.
ALTER TABLE redemption_refund_requests
  DROP CONSTRAINT IF EXISTS chk_refund_reason_present;
ALTER TABLE redemption_refund_requests
  ADD CONSTRAINT chk_refund_reason_present CHECK (
    char_length(btrim(reason)) BETWEEN 1 AND 500
  );

-- ── 2. Full state-machine invariant (incl. durable outcomes) ────────────

ALTER TABLE redemption_refund_requests
  DROP CONSTRAINT IF EXISTS chk_refund_decided_fields;
ALTER TABLE redemption_refund_requests
  ADD CONSTRAINT chk_refund_decided_fields CHECK (
    (status = 'PENDING_CHECKER'
      AND checker_id IS NULL AND decided_at IS NULL
      AND wallet_entry_id IS NULL AND refund_wallet_entry_id IS NULL
      AND executed_at IS NULL AND failed_at IS NULL)
    OR (status = 'EXECUTING'
      AND checker_id IS NOT NULL AND decided_at IS NOT NULL
      AND wallet_entry_id IS NULL AND refund_wallet_entry_id IS NULL
      AND executed_at IS NULL AND failed_at IS NULL)
    OR (status = 'COMPLETED'
      AND checker_id IS NOT NULL AND decided_at IS NOT NULL
      AND wallet_entry_id IS NOT NULL AND refund_wallet_entry_id IS NOT NULL
      AND executed_at IS NOT NULL AND failed_at IS NULL)
    OR (status = 'FAILED'
      AND checker_id IS NOT NULL AND decided_at IS NOT NULL
      AND failed_at IS NOT NULL
      AND wallet_entry_id IS NULL AND refund_wallet_entry_id IS NULL
      AND executed_at IS NULL)
    OR (status = 'REJECTED'
      AND checker_id IS NOT NULL AND decided_at IS NOT NULL
      AND wallet_entry_id IS NULL AND refund_wallet_entry_id IS NULL
      AND executed_at IS NULL AND failed_at IS NULL)
  );

-- ── 3. Correct the order refund-state invariant (frozen machine fix) ──────
--
-- The 0020 constraint required REFUND_PENDING to have wallet_entry_id IS
-- NULL, but a refundable order always carries its original debit entry
-- (points are debited at CONFIRMED, P6-S0 §20.3). As written, the frozen
-- REFUND_PENDING -> REFUNDED transition was unexecutable for any real
-- order. 0036 corrects the encoding of the frozen P6-S0 state machine:
-- REFUND_PENDING now REQUIRES the original debit reference and REFUNDED
-- keeps its existing debit requirement. Forward-only: the old constraint
-- is dropped and re-added with the corrected invariant; no historical
-- migration is rewritten.
ALTER TABLE redemption_orders
  DROP CONSTRAINT IF EXISTS chk_order_refund_state;
ALTER TABLE redemption_orders
  ADD CONSTRAINT chk_order_refund_state CHECK (
    (status = 'REFUND_PENDING' AND wallet_entry_id IS NOT NULL)
    OR (status = 'REFUNDED' AND wallet_entry_id IS NOT NULL)
    OR (status NOT IN ('REFUND_PENDING', 'REFUNDED'))
  );
