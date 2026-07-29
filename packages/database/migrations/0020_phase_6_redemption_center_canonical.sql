-- Phase 6: Redemption Center Canonical Schema
-- Forward-only migration. Single authoritative Phase 6 migration.
--
-- Creates all canonical tables matching packages/database/schema/redemption.ts.
-- Uses existing reject_update() / reject_delete() from 0002 where needed.
-- No DROP TABLE — 0020 has never been committed or applied.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─── Wallet Entry Type Extension ──────────────────────────────────────────

ALTER TYPE member_wallet_entry_type ADD VALUE IF NOT EXISTS 'REDEMPTION_DEBIT';
ALTER TYPE member_wallet_entry_type ADD VALUE IF NOT EXISTS 'REDEMPTION_REFUND';

-- ─── Enums ───────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE redemption_catalog_status AS ENUM (
    'DRAFT', 'ACTIVE', 'DISABLED', 'ARCHIVED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE redemption_item_type AS ENUM (
    'PHYSICAL', 'DIGITAL_VOUCHER', 'SERVICE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE redemption_ownership AS ENUM ('PLATFORM_OWNED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE redemption_fulfilment_mode AS ENUM (
    'DELIVERY', 'PICKUP', 'DELIVERY_OR_PICKUP', 'DIGITAL', 'SERVICE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE redemption_inventory_mode AS ENUM (
    'UNLIMITED', 'TRACKED', 'ON_DEMAND'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE redemption_order_status AS ENUM (
    'PENDING', 'CONFIRMED', 'PROCESSING', 'READY_FOR_PICKUP',
    'BACKORDERED', 'FULFILMENT_SUSPENDED', 'FULFILMENT_EXCEPTION',
    'REFUND_PENDING', 'REFUNDED', 'FULFILLED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE redemption_quote_status AS ENUM (
    'VALID', 'EXPIRED', 'CONSUMED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE redemption_waitlist_status AS ENUM (
    'ACTIVE', 'NOTIFIED', 'EXPIRED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE redemption_fulfilment_type AS ENUM (
    'PHYSICAL', 'DIGITAL', 'SERVICE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE redemption_fulfilment_status AS ENUM (
    'PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE redemption_refund_request_status AS ENUM (
    'PENDING_CHECKER', 'APPROVED', 'REJECTED',
    'EXECUTING', 'COMPLETED', 'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE redemption_shipping_payment_status AS ENUM (
    'PENDING', 'PAID', 'FAILED', 'REFUNDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE redemption_rate_type AS ENUM (
    'POINTS_PER_CURRENCY', 'CURRENCY_PER_POINT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Redemption Rate Versions ────────────────────────────────────────────
-- Immutable after creation. Rate changes create new versions.
-- Gist exclusion prevents overlapping effective ranges.

CREATE TABLE redemption_rate_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  rate_type redemption_rate_type NOT NULL,
  rate_value numeric(38, 10) NOT NULL,
  effective_from timestamptz(6) NOT NULL,
  effective_until timestamptz(6),
  created_by uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT chk_redemption_rate_value CHECK (rate_value > 0),
  CONSTRAINT chk_redemption_rate_period CHECK (
    effective_until IS NULL OR effective_until > effective_from
  ),
  CONSTRAINT uq_redemption_rate_period EXCLUDE USING gist (
    market_id WITH =, rate_type WITH =,
    tstzrange(effective_from, COALESCE(effective_until, 'infinity'::timestamptz), '[)') WITH &&
  )
);

CREATE INDEX idx_redemption_rate_active
  ON redemption_rate_versions (market_id, rate_type, effective_from);

CREATE TRIGGER redemption_rate_versions_reject_update
  BEFORE UPDATE ON redemption_rate_versions
  FOR EACH ROW EXECUTE FUNCTION reject_update();
CREATE TRIGGER redemption_rate_versions_reject_delete
  BEFORE DELETE ON redemption_rate_versions
  FOR EACH ROW EXECUTE FUNCTION reject_delete();

-- ─── Redemption Catalog Items ─────────────────────────────────────────────
-- Primary pricing: fiat_reference_value / redemption_rate = point cost (OD-21).
-- Lifecycle: status enum, NOT is_active boolean.

CREATE TABLE redemption_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  sku varchar(64),
  name varchar(256) NOT NULL,
  description text,
  item_type redemption_item_type NOT NULL,
  ownership redemption_ownership NOT NULL DEFAULT 'PLATFORM_OWNED',
  status redemption_catalog_status NOT NULL DEFAULT 'DRAFT',
  fiat_reference_value numeric(38, 10) NOT NULL,
  fiat_currency varchar(3) NOT NULL,
  fulfilment_mode redemption_fulfilment_mode NOT NULL DEFAULT 'DELIVERY',
  inventory_mode redemption_inventory_mode NOT NULL DEFAULT 'TRACKED',
  image_url text,
  terms text,
  is_featured boolean NOT NULL DEFAULT false,
  tags text[],
  sort_order integer NOT NULL DEFAULT 0,
  effective_from timestamptz(6) NOT NULL DEFAULT now(),
  effective_until timestamptz(6),
  created_by uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT chk_catalog_fiat_currency CHECK (char_length(fiat_currency) = 3),
  CONSTRAINT chk_catalog_fiat_value CHECK (fiat_reference_value > 0),
  CONSTRAINT chk_catalog_version CHECK (version > 0),
  CONSTRAINT chk_catalog_period CHECK (
    effective_until IS NULL OR effective_until > effective_from
  )
);

CREATE UNIQUE INDEX uq_catalog_sku_market
  ON redemption_catalog_items (market_id, sku)
  WHERE sku IS NOT NULL;

CREATE INDEX idx_catalog_market_status
  ON redemption_catalog_items (market_id, status);

-- ─── Redemption Inventory ─────────────────────────────────────────────────
-- Standalone inventory. stock_limit / total_inventory NOT on catalog_items.
-- Version-based optimistic locking prevents oversell.

CREATE TABLE redemption_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES redemption_catalog_items(id) ON DELETE RESTRICT,
  total_quantity numeric(38, 0),
  reserved_quantity numeric(38, 0) NOT NULL DEFAULT '0',
  fulfilled_quantity numeric(38, 0) NOT NULL DEFAULT '0',
  backorder_quantity numeric(38, 0) NOT NULL DEFAULT '0',
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_redemption_inventory_item UNIQUE (item_id),
  CONSTRAINT chk_inventory_overflow CHECK (
    total_quantity IS NULL
    OR (reserved_quantity + fulfilled_quantity + backorder_quantity <= total_quantity)
  ),
  CONSTRAINT chk_inventory_non_negative CHECK (
    reserved_quantity >= 0 AND fulfilled_quantity >= 0 AND backorder_quantity >= 0
  ),
  CONSTRAINT chk_inventory_version CHECK (version > 0)
);

-- ─── Redemption Quotes ────────────────────────────────────────────────────
-- Rate snapshot captured at quote time (OD-22). No wallet effect.
-- Immutable after consumption.

CREATE TABLE redemption_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  catalog_item_id uuid NOT NULL REFERENCES redemption_catalog_items(id) ON DELETE RESTRICT,
  status redemption_quote_status NOT NULL DEFAULT 'VALID',
  rate_version_id uuid NOT NULL REFERENCES redemption_rate_versions(id) ON DELETE RESTRICT,
  rate_snapshot jsonb NOT NULL,
  unrounded_point_cost numeric(38, 10) NOT NULL,
  posted_point_cost numeric(38, 10) NOT NULL,
  payload_hash varchar(64) NOT NULL,
  expires_at timestamptz(6) NOT NULL,
  consumed_at timestamptz(6),
  idempotency_key varchar(255) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT chk_quote_point_cost CHECK (
    unrounded_point_cost > 0 AND posted_point_cost > 0
  ),
  CONSTRAINT chk_quote_expiry CHECK (expires_at > created_at),
  CONSTRAINT chk_quote_payload_hash CHECK (char_length(payload_hash) = 64),
  CONSTRAINT uq_quote_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX idx_quote_member_valid
  ON redemption_quotes (member_id, status);

CREATE TRIGGER redemption_quotes_reject_update
  BEFORE UPDATE ON redemption_quotes
  FOR EACH ROW EXECUTE FUNCTION reject_update();
CREATE TRIGGER redemption_quotes_reject_delete
  BEFORE DELETE ON redemption_quotes
  FOR EACH ROW EXECUTE FUNCTION reject_delete();

-- ─── Redemption Orders ───────────────────────────────────────────────────
-- Full state machine with immutability checks.
-- wallet_entry_id links to the REDEMPTION_DEBIT or REDEMPTION_REFUND entry.

CREATE TABLE redemption_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_reference varchar(64) NOT NULL,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES redemption_catalog_items(id) ON DELETE RESTRICT,
  wallet_account_id uuid NOT NULL REFERENCES member_wallet_accounts(id) ON DELETE RESTRICT,
  wallet_entry_id uuid REFERENCES member_wallet_entries(id) ON DELETE RESTRICT,
  quote_id uuid REFERENCES redemption_quotes(id) ON DELETE RESTRICT,
  rate_version_id uuid NOT NULL REFERENCES redemption_rate_versions(id) ON DELETE RESTRICT,
  rate_value numeric(38, 10) NOT NULL,
  status redemption_order_status NOT NULL DEFAULT 'CONFIRMED',
  unrounded_point_cost numeric(38, 10) NOT NULL,
  posted_point_cost numeric(38, 10) NOT NULL,
  total_points numeric(38, 10) NOT NULL,
  quantity numeric(38, 0) NOT NULL,
  backorder_quantity numeric(38, 0) NOT NULL DEFAULT '0',
  rounding_mode varchar(16) NOT NULL DEFAULT 'HALF_UP',
  calculation_scale integer NOT NULL DEFAULT 10,
  posting_scale integer NOT NULL DEFAULT 10,
  item_snapshot jsonb NOT NULL,
  rate_snapshot jsonb NOT NULL,
  idempotency_key varchar(255),
  notes text,
  confirmed_at timestamptz(6),
  processing_started_at timestamptz(6),
  ready_for_pickup_at timestamptz(6),
  backordered_at timestamptz(6),
  fulfilled_at timestamptz(6),
  cancelled_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_order_reference UNIQUE (order_reference),
  CONSTRAINT chk_order_total_points CHECK (total_points > 0),
  CONSTRAINT chk_order_quantity CHECK (quantity > 0),
  CONSTRAINT chk_order_backorder CHECK (
    backorder_quantity >= 0 AND backorder_quantity <= quantity
  ),
  CONSTRAINT chk_order_calc_scale CHECK (calculation_scale > 0),
  CONSTRAINT chk_order_posting_scale CHECK (posting_scale > 0),
  CONSTRAINT chk_order_rounding_mode CHECK (
    rounding_mode IN ('HALF_UP', 'HALF_DOWN', 'HALF_EVEN', 'FLOOR', 'CEILING')
  ),
  CONSTRAINT chk_order_suspension_notes CHECK (
    status <> 'FULFILMENT_SUSPENDED' OR notes IS NOT NULL
  ),
  CONSTRAINT chk_order_refund_state CHECK (
    (status = 'REFUND_PENDING' AND wallet_entry_id IS NULL)
    OR (status = 'REFUNDED' AND wallet_entry_id IS NOT NULL)
    OR (status NOT IN ('REFUND_PENDING', 'REFUNDED'))
  )
);

CREATE UNIQUE INDEX uq_order_idempotency
  ON redemption_orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX uq_order_quote
  ON redemption_orders (quote_id)
  WHERE quote_id IS NOT NULL;

CREATE INDEX idx_order_member
  ON redemption_orders (member_id);

CREATE INDEX idx_order_status
  ON redemption_orders (status);

-- ─── Redemption Fulfilments ───────────────────────────────────────────────
-- Tracks fulfilment from PROCESSING → FULFILLED / FAILED.
-- Supports retry (max 3 attempts), digital delivery, and physical shipping.

CREATE TABLE redemption_fulfilments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES redemption_orders(id) ON DELETE RESTRICT,
  fulfilment_type redemption_fulfilment_type NOT NULL,
  status redemption_fulfilment_status NOT NULL DEFAULT 'PENDING',
  shipping_address jsonb,
  tracking_number varchar(128),
  courier varchar(64),
  estimated_delivery_date date,
  digital_value text,
  service_scheduled_at timestamptz(6),
  service_notes text,
  fulfilled_at timestamptz(6),
  failed_at timestamptz(6),
  failure_reason text,
  retry_count integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_fulfilment_order UNIQUE (order_id),
  CONSTRAINT chk_fulfilment_retry CHECK (retry_count >= 0)
);

CREATE INDEX idx_fulfilment_status
  ON redemption_fulfilments (status);

-- ─── Fulfilment Exceptions (OD-26) ───────────────────────────────────────
-- Tracks fulfilment failures for admin review.

CREATE TYPE redemption_exception_severity AS ENUM (
  'RETRYABLE', 'NON_RETRYABLE'
);

CREATE TABLE redemption_fulfilment_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfilment_id uuid NOT NULL REFERENCES redemption_fulfilments(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  severity redemption_exception_severity NOT NULL,
  retry_attempt integer NOT NULL DEFAULT 0,
  error_code text NOT NULL,
  error_message text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  resolved_by uuid REFERENCES admin_users(id) ON DELETE RESTRICT,
  resolved_at timestamptz(6),
  resolution_notes text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT chk_exception_retry_attempt CHECK (retry_attempt >= 0)
);

CREATE INDEX idx_exception_fulfilment
  ON redemption_fulfilment_exceptions (fulfilment_id);
CREATE INDEX idx_exception_unresolved
  ON redemption_fulfilment_exceptions (resolved, created_at);

-- ─── Fulfilment Audit ───────────────────────────────────────────────────

CREATE TABLE redemption_fulfilment_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  fulfilment_id uuid REFERENCES redemption_fulfilments(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_type text NOT NULL,
  actor_id uuid,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_order
  ON redemption_fulfilment_audit (order_id, occurred_at);
CREATE INDEX idx_audit_fulfilment
  ON redemption_fulfilment_audit (fulfilment_id, occurred_at);

-- ─── Shipping Payment Recovery (OD-07) ──────────────────────────────────

CREATE TYPE redemption_shipping_payment_recovery_status AS ENUM (
  'PENDING', 'VOIDING', 'VOIDED', 'REFUNDING', 'REFUNDED', 'FAILED'
);

CREATE TABLE redemption_shipping_payment_recovery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES redemption_orders(id) ON DELETE RESTRICT,
  payment_intent_id text NOT NULL,
  payment_method text,
  amount numeric(38, 10) NOT NULL,
  currency varchar(3) NOT NULL,
  recovery_status redemption_shipping_payment_recovery_status NOT NULL DEFAULT 'PENDING',
  failure_reason text,
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  voided_at timestamptz(6),
  refunded_at timestamptz(6),
  failed_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT chk_recovery_amount CHECK (amount > 0),
  CONSTRAINT chk_recovery_retry CHECK (retry_count >= 0)
);

CREATE INDEX idx_recovery_status
  ON redemption_shipping_payment_recovery (recovery_status);

-- ─── Redemption Refund Requests ───────────────────────────────────────────
-- Maker/Checker pattern (OD-17). CHECK constraint prevents maker=checker.

CREATE TABLE redemption_refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES redemption_orders(id) ON DELETE RESTRICT,
  maker_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  checker_id uuid REFERENCES admin_users(id) ON DELETE RESTRICT,
  status redemption_refund_request_status NOT NULL DEFAULT 'PENDING_CHECKER',
  refund_amount numeric(38, 10) NOT NULL,
  reason text NOT NULL,
  maker_notes text,
  checker_notes text,
  wallet_entry_id uuid REFERENCES member_wallet_entries(id) ON DELETE RESTRICT,
  decided_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT chk_refund_amount CHECK (refund_amount > 0),
  CONSTRAINT chk_refund_maker_checker_different CHECK (
    checker_id IS NULL OR maker_id <> checker_id
  ),
  CONSTRAINT chk_refund_decided_fields CHECK (
    (status = 'PENDING_CHECKER' AND checker_id IS NULL AND decided_at IS NULL AND wallet_entry_id IS NULL)
    OR (status = 'APPROVED' AND checker_id IS NOT NULL AND decided_at IS NOT NULL AND wallet_entry_id IS NOT NULL)
    OR (status = 'REJECTED' AND checker_id IS NOT NULL AND decided_at IS NOT NULL AND wallet_entry_id IS NULL)
  )
);

CREATE INDEX idx_refund_order
  ON redemption_refund_requests (order_id);
CREATE INDEX idx_refund_status
  ON redemption_refund_requests (status);

-- ─── Redemption Audit Log ─────────────────────────────────────────────────

CREATE TABLE redemption_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type varchar(32) NOT NULL,
  actor_id uuid,
  market_id uuid REFERENCES markets(id) ON DELETE RESTRICT,
  action varchar(64) NOT NULL,
  entity_type varchar(64) NOT NULL,
  entity_id varchar(64) NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  result varchar(16) NOT NULL,
  request_id varchar(128),
  ip_address varchar(45),
  occurred_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_entity
  ON redemption_audit_log (entity_type, entity_id, occurred_at);
CREATE INDEX idx_audit_actor
  ON redemption_audit_log (actor_type, actor_id, occurred_at);

-- ─── Redemption Pickup Locations ──────────────────────────────────────────

CREATE TABLE redemption_pickup_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  name varchar(256) NOT NULL,
  address jsonb NOT NULL,
  contact_name varchar(128),
  contact_phone varchar(32),
  operating_hours jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT chk_pickup_name CHECK (char_length(btrim(name)) > 0)
);

CREATE INDEX idx_pickup_market_active
  ON redemption_pickup_locations (market_id, is_active);

-- ─── Redemption Waitlist Entries (OD-27) ─────────────────────────────────

CREATE TABLE redemption_waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  catalog_item_id uuid NOT NULL REFERENCES redemption_catalog_items(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  status redemption_waitlist_status NOT NULL DEFAULT 'ACTIVE',
  requested_quantity numeric(38, 0) NOT NULL DEFAULT '1',
  notified_at timestamptz(6),
  expired_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_waitlist_member_item UNIQUE (member_id, catalog_item_id),
  CONSTRAINT chk_waitlist_quantity CHECK (requested_quantity > 0)
);

CREATE INDEX idx_waitlist_item_active
  ON redemption_waitlist_entries (catalog_item_id, status)
  WHERE status = 'ACTIVE';

-- ─── Redemption Voucher Codes ─────────────────────────────────────────────
-- code_hash = SHA-256 of plaintext code.
-- code_encrypted = AES encrypted at rest. Never logged in plaintext.

CREATE TABLE redemption_voucher_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES redemption_orders(id) ON DELETE RESTRICT,
  catalog_item_id uuid NOT NULL REFERENCES redemption_catalog_items(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  code_hash varchar(64) NOT NULL,
  code_encrypted text NOT NULL,
  expiry_date date,
  used_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_voucher_code_hash UNIQUE (code_hash),
  CONSTRAINT chk_voucher_code_hash CHECK (char_length(code_hash) = 64)
);

CREATE INDEX idx_voucher_order
  ON redemption_voucher_codes (order_id);

CREATE TRIGGER redemption_voucher_codes_reject_update
  BEFORE UPDATE ON redemption_voucher_codes
  FOR EACH ROW EXECUTE FUNCTION reject_update();
CREATE TRIGGER redemption_voucher_codes_reject_delete
  BEFORE DELETE ON redemption_voucher_codes
  FOR EACH ROW EXECUTE FUNCTION reject_delete();

-- ─── Redemption Shipping Payments ─────────────────────────────────────────
-- Fiat payment for delivery shipping fee. Member pays (OD-07).

CREATE TABLE redemption_shipping_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES redemption_orders(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  amount numeric(38, 10) NOT NULL,
  currency varchar(3) NOT NULL,
  status redemption_shipping_payment_status NOT NULL DEFAULT 'PENDING',
  payment_provider varchar(64),
  payment_intent_id varchar(128),
  payment_method varchar(64),
  paid_at timestamptz(6),
  failed_at timestamptz(6),
  refunded_at timestamptz(6),
  idempotency_key varchar(255),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_shipping_order UNIQUE (order_id),
  CONSTRAINT chk_shipping_amount CHECK (amount > 0),
  CONSTRAINT chk_shipping_currency CHECK (char_length(currency) = 3)
);

CREATE INDEX idx_shipping_order
  ON redemption_shipping_payments (order_id);

-- ─── Redemption Terms Acceptances (OD-30) ────────────────────────────────

CREATE TABLE redemption_terms_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  terms_version varchar(64) NOT NULL,
  accepted_at timestamptz(6) NOT NULL DEFAULT now(),
  ip_address varchar(45),
  user_agent text,
  CONSTRAINT uq_redemption_terms UNIQUE (member_id, market_id, terms_version)
);

CREATE INDEX idx_redemption_terms_member
  ON redemption_terms_acceptances (member_id);
