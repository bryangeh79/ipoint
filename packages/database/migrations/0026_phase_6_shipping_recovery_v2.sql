-- 0026: Phase 6 Shipping Recovery V2
-- Anchored to shipping_payment_id, not order_id
-- Allows recovery before order exists

CREATE TABLE IF NOT EXISTS redemption_shipping_payment_recovery_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipping_payment_id uuid NOT NULL UNIQUE REFERENCES redemption_shipping_payments(id) ON DELETE RESTRICT,
  provider_intent_id varchar(128) NOT NULL,
  order_id uuid,
  attempted_order_id varchar(128),
  member_id uuid NOT NULL REFERENCES members(id),
  quote_id uuid NOT NULL REFERENCES redemption_quotes(id),
  market_id uuid NOT NULL REFERENCES markets(id),
  amount numeric(38,10) NOT NULL,
  currency varchar(3) NOT NULL,
  recovery_status varchar(32) NOT NULL DEFAULT 'PENDING',
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  last_error text,
  voided_at timestamptz(6),
  refunded_at timestamptz(6),
  failed_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT NOW(),
  updated_at timestamptz(6) NOT NULL DEFAULT NOW()
);
