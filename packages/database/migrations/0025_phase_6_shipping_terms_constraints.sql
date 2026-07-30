-- 0025: Phase 6 shipping and terms constraint remediation
--
-- Forward-only follow-up to 0024. Enforce the required shipping binding
-- nullability while allowing quote_id to remain nullable, and permit distinct
-- order-specific acceptance evidence for the same member and terms version.

ALTER TABLE redemption_shipping_payments
  ALTER COLUMN member_id SET NOT NULL,
  ALTER COLUMN request_hash SET NOT NULL,
  ALTER COLUMN request_hash DROP DEFAULT,
  DROP CONSTRAINT IF EXISTS chk_shipping_payment_bind;

ALTER TABLE redemption_shipping_payments
  ADD CONSTRAINT chk_shipping_request_hash
    CHECK (char_length(request_hash) = 64);

ALTER TABLE redemption_terms_acceptances
  DROP CONSTRAINT uq_redemption_terms;

CREATE UNIQUE INDEX uq_redemption_terms
  ON redemption_terms_acceptances (member_id, market_id, terms_version)
  WHERE order_id IS NULL;

CREATE UNIQUE INDEX uq_redemption_terms_order
  ON redemption_terms_acceptances (order_id)
  WHERE order_id IS NOT NULL;
