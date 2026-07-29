-- 0021: Phase 6 Redemption Contract Corrections
--
-- Aligns the Phase 6 schema with the frozen P6-S0 contract:
--   1. Correct shipping payment schema (order_id nullable, member_id/quote_id NOT NULL)
--   2. Correct refund persistence (EXECUTING/FAILED states, dual wallet refs)
--   3. Add terms acceptance evidence columns to redemption_orders
--
-- Forward-only. Does not rewrite 0020.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. Fix Shipping Payment Schema
-- ══════════════════════════════════════════════════════════════════════════

-- Payment can exist BEFORE order confirmation (order_id nullable at creation)
-- Add binding columns (member_id, quote_id, request_hash)
ALTER TABLE redemption_shipping_payments
  ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES members(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES redemption_quotes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS request_hash varchar(64) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz(6),
  DROP CONSTRAINT IF EXISTS uq_shipping_order;

-- Make order_id nullable (payment exists before order)
ALTER TABLE redemption_shipping_payments
  ALTER COLUMN order_id DROP NOT NULL;

-- Add UNIQUE on idempotency_key
DELETE FROM redemption_shipping_payments
  WHERE idempotency_key IS NULL OR idempotency_key = '';
ALTER TABLE redemption_shipping_payments
  ALTER COLUMN idempotency_key SET NOT NULL,
  ADD CONSTRAINT uq_shipping_idempotency UNIQUE (idempotency_key);

-- Add binding constraint
ALTER TABLE redemption_shipping_payments
  ADD CONSTRAINT chk_shipping_payment_bind CHECK (
    member_id IS NOT NULL AND
    quote_id IS NOT NULL AND
    market_id IS NOT NULL AND
    amount > 0 AND
    char_length(currency) = 3 AND
    char_length(request_hash) = 64
  );

-- One order per payment after consumption
CREATE UNIQUE INDEX IF NOT EXISTS ux_shipping_consumed_order
  ON redemption_shipping_payments (order_id)
  WHERE order_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. Fix Refund State Machine (EXECUTING / FAILED)
-- ══════════════════════════════════════════════════════════════════════════

-- Drop old constraint and re-add with new states
ALTER TABLE redemption_refund_requests
  DROP CONSTRAINT IF EXISTS chk_refund_decided_fields;

ALTER TABLE redemption_refund_requests
  ADD CONSTRAINT chk_refund_decided_fields CHECK (
    (status = 'PENDING_CHECKER' AND checker_id IS NULL AND decided_at IS NULL AND wallet_entry_id IS NULL)
    OR (status = 'EXECUTING' AND checker_id IS NOT NULL AND decided_at IS NOT NULL)
    OR (status = 'COMPLETED' AND checker_id IS NOT NULL AND decided_at IS NOT NULL AND wallet_entry_id IS NOT NULL)
    OR (status = 'FAILED')
    OR (status = 'REJECTED' AND checker_id IS NOT NULL AND decided_at IS NOT NULL AND wallet_entry_id IS NULL)
  );

-- Add refund_wallet_entry_id for exact-opposite refund entry
ALTER TABLE redemption_refund_requests
  ADD COLUMN IF NOT EXISTS refund_wallet_entry_id uuid
    REFERENCES member_wallet_entries(id) ON DELETE RESTRICT;

-- One successful refund per debit
CREATE UNIQUE INDEX IF NOT EXISTS ux_refund_wallet_entry
  ON redemption_refund_requests (wallet_entry_id)
  WHERE status IN ('COMPLETED');

-- ══════════════════════════════════════════════════════════════════════════
-- 3. Terms Acceptance Evidence on Orders
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE redemption_orders
  ADD COLUMN IF NOT EXISTS terms_version varchar(64),
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz(6);
