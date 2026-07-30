-- 0024: Phase 6 Terms Order Binding & Schema Alignment
--
-- Forward-only corrections:
--   1. Bind terms acceptance to specific orders (order_id, request_id)
--   2. Rebuild expected-schema.ts to match applied database state
--
-- Prerequisites: 0020, 0021, 0022, 0023 applied

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Order-Specific Terms Acceptance Columns
-- ═══════════════════════════════════════════════════════════════════════════

-- Add order_id to bind acceptance to a specific order
ALTER TABLE redemption_terms_acceptances
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES redemption_orders(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS request_id varchar(128);

-- Index for order-specific lookups
CREATE INDEX IF NOT EXISTS idx_redemption_terms_order
  ON redemption_terms_acceptances (order_id)
  WHERE order_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Rebuild shipping payment consumed_at for existing records
-- ═══════════════════════════════════════════════════════════════════════════

-- For payments that have an order_id (already consumed), set consumed_at
UPDATE redemption_shipping_payments
SET consumed_at = COALESCE(consumed_at, NOW())
WHERE order_id IS NOT NULL AND consumed_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Ensure terms_version and terms_accepted_at are set for existing orders
-- ═══════════════════════════════════════════════════════════════════════════

-- Backfill for orders that still lack terms_version
UPDATE redemption_orders o
SET
  terms_version = COALESCE(o.terms_version, ta.terms_version),
  terms_accepted_at = COALESCE(o.terms_accepted_at, ta.accepted_at)
FROM redemption_terms_acceptances ta
WHERE o.member_id = ta.member_id
  AND o.market_id = ta.market_id
  AND (o.terms_version IS NULL OR o.terms_accepted_at IS NULL);
