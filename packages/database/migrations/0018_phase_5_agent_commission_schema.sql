-- Phase 5 P5-S1: Agent & Commission Engine domain schema and frozen invariants.
-- Forward-only migration. Financial and audit records are append-only.

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'members'
      AND column_name = 'referral_code'
  ) THEN
    ALTER TABLE members ADD COLUMN referral_code text;
    UPDATE members SET referral_code = public_member_id WHERE referral_code IS NULL;
    ALTER TABLE members ALTER COLUMN referral_code SET NOT NULL;
    ALTER TABLE members ADD CONSTRAINT members_referral_code_unique UNIQUE (referral_code);
  END IF;
END
$$;

CREATE TYPE agent_activation_status AS ENUM (
  'NOT_APPLIED', 'PENDING_PAYMENT', 'PAYMENT_CONFIRMED', 'COURSE_PENDING',
  'COURSE_COMPLETED', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED',
  'DEACTIVATED', 'REJECTED'
);

CREATE TABLE agent_activation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  status agent_activation_status NOT NULL DEFAULT 'NOT_APPLIED',
  payment_reference varchar(255),
  payment_confirmed_at timestamptz(6),
  course_completed_at timestamptz(6),
  course_enrolled_at timestamptz(6),
  course_reference varchar(255),
  course_confirmed_by uuid,
  approved_at timestamptz(6),
  activated_at timestamptz(6),
  activated_by uuid,
  market varchar(2) NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'MYR',
  rejection_reason text,
  reactivation_count integer NOT NULL DEFAULT 0,
  revoked_at timestamptz(6),
  revoked_by uuid,
  revocation_reason text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_agent_member_market UNIQUE (member_id, market),
  CONSTRAINT chk_agent_market CHECK (market = upper(market)),
  CONSTRAINT chk_agent_currency CHECK (currency = upper(currency)),
  CONSTRAINT chk_agent_reactivation_count CHECK (reactivation_count >= 0)
);
CREATE INDEX idx_activation_member_status ON agent_activation (member_id, status);
CREATE INDEX idx_activation_status ON agent_activation (status);
CREATE INDEX idx_activation_market ON agent_activation (market);

CREATE TABLE agent_activation_status_log (
  log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_id uuid NOT NULL REFERENCES agent_activation(id) ON DELETE RESTRICT,
  from_status agent_activation_status,
  to_status agent_activation_status NOT NULL,
  changed_by uuid,
  changed_by_type varchar(20) NOT NULL,
  reason text,
  changed_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT chk_activation_log_changed_by_type
    CHECK (changed_by_type IN ('SYSTEM', 'ADMIN', 'AGENT'))
);
CREATE INDEX idx_activation_log_activation ON agent_activation_status_log (activation_id);

CREATE TABLE referral_relationship (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  referrer_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_referral_referee UNIQUE (referee_id),
  CONSTRAINT chk_no_self_referral CHECK (referee_id <> referrer_id)
);
CREATE INDEX idx_referral_referrer ON referral_relationship (referrer_id);

CREATE TABLE commission_processing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_processing_key varchar(255) NOT NULL,
  source_type varchar(30) NOT NULL,
  source_reference varchar(255) NOT NULL,
  request_hash varchar(64) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'IN_FLIGHT',
  completion_outcome varchar(30),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  completed_at timestamptz(6),
  CONSTRAINT uq_processing_key UNIQUE (canonical_processing_key),
  CONSTRAINT chk_processing_status CHECK (status IN ('IN_FLIGHT', 'COMPLETED', 'FAILED')),
  CONSTRAINT chk_processing_outcome CHECK (
    completion_outcome IS NULL OR completion_outcome IN (
      'CREATED', 'SKIPPED_INELIGIBLE', 'SKIPPED_NO_BENEFICIARY',
      'SKIPPED_ZERO_AMOUNT', 'FAILED'
    )
  ),
  CONSTRAINT chk_processing_request_hash CHECK (char_length(request_hash) = 64)
);
CREATE INDEX idx_processing_key ON commission_processing (canonical_processing_key);
CREATE INDEX idx_processing_source ON commission_processing (source_type, source_reference);

CREATE TABLE commission_rate_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_type varchar(30) NOT NULL,
  generation integer NOT NULL,
  market varchar(2) NOT NULL,
  rate_value numeric(38, 10) NOT NULL,
  rate_type varchar(10) NOT NULL DEFAULT 'PERCENTAGE',
  effective_from timestamptz(6) NOT NULL,
  effective_until timestamptz(6),
  created_by uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT chk_commission_type CHECK (
    commission_type IN ('AGENT_UPGRADE', 'MEMBER_CONSUMPTION', 'MERCHANT_RECRUITMENT')
  ),
  CONSTRAINT chk_rate_type CHECK (rate_type IN ('PERCENTAGE', 'FIXED')),
  CONSTRAINT chk_generation CHECK (generation IN (0, 1, 2)),
  CONSTRAINT chk_rate_value CHECK (rate_value >= 0),
  CONSTRAINT chk_rate_market CHECK (market = upper(market)),
  CONSTRAINT chk_rate_effective_range
    CHECK (effective_until IS NULL OR effective_until > effective_from),
  CONSTRAINT uq_rate_period EXCLUDE USING gist (
    commission_type WITH =, generation WITH =, market WITH =,
    tstzrange(effective_from, COALESCE(effective_until, 'infinity'::timestamptz), '[)') WITH &&
  )
);
CREATE INDEX idx_rate_effective ON commission_rate_version (
  commission_type, generation, market, effective_from
);

CREATE TABLE commission_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference varchar(30) NOT NULL,
  beneficiary_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  source_type varchar(30) NOT NULL,
  source_reference varchar(255) NOT NULL,
  market varchar(2) NOT NULL,
  currency varchar(3) NOT NULL,
  amount numeric(38, 10) NOT NULL,
  rate_version_id uuid REFERENCES commission_rate_version(id) ON DELETE RESTRICT,
  rate_snapshot jsonb,
  calculation_basis numeric(38, 10),
  generation integer NOT NULL DEFAULT 0,
  entry_type varchar(40) NOT NULL,
  posting_status varchar(20) NOT NULL DEFAULT 'EARNED',
  canonical_entry_key varchar(255) NOT NULL,
  processing_id uuid REFERENCES commission_processing(id) ON DELETE RESTRICT,
  effective_time timestamptz(6) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  reversal_linkage uuid REFERENCES commission_ledger(id) ON DELETE RESTRICT,
  audit_linkage varchar(255),
  notes text,
  CONSTRAINT chk_entry_type CHECK (entry_type IN (
    'AGENT_UPGRADE_G1_EARN', 'AGENT_UPGRADE_G2_EARN',
    'MEMBER_CONSUMPTION_G1_EARN', 'MEMBER_CONSUMPTION_G2_EARN',
    'MERCHANT_RECRUITMENT_EARN', 'REVERSAL_COMPENSATION',
    'REFUND_COMPENSATION', 'ADMIN_ADJUSTMENT'
  )),
  CONSTRAINT chk_posting_status CHECK (posting_status = 'EARNED'),
  CONSTRAINT chk_ledger_generation CHECK (generation IN (0, 1, 2)),
  CONSTRAINT uq_ledger_entry_key UNIQUE (canonical_entry_key),
  CONSTRAINT uq_ledger_public_ref UNIQUE (public_reference)
);
CREATE INDEX idx_ledger_beneficiary ON commission_ledger (beneficiary_id);
CREATE INDEX idx_ledger_beneficiary_entry_type ON commission_ledger (beneficiary_id, entry_type);
CREATE INDEX idx_ledger_beneficiary_posting ON commission_ledger (beneficiary_id, posting_status);
CREATE INDEX idx_ledger_source ON commission_ledger (source_type, source_reference);
CREATE INDEX idx_ledger_effective_time ON commission_ledger (effective_time);
CREATE INDEX idx_ledger_reversal ON commission_ledger (reversal_linkage);
CREATE INDEX idx_ledger_market ON commission_ledger (market);
CREATE INDEX idx_ledger_entry_key ON commission_ledger (canonical_entry_key);

CREATE TABLE commission_status_event (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES commission_ledger(id) ON DELETE RESTRICT,
  from_status varchar(20),
  to_status varchar(20) NOT NULL,
  changed_by uuid,
  changed_by_type varchar(20) NOT NULL,
  reason text,
  changed_at timestamptz(6) NOT NULL DEFAULT now(),
  event_sequence bigint NOT NULL,
  CONSTRAINT uq_status_event_sequence UNIQUE (entry_id, event_sequence),
  CONSTRAINT chk_status_to CHECK (to_status = 'EARNED'),
  CONSTRAINT chk_status_from CHECK (from_status IS NULL OR from_status = 'EARNED'),
  CONSTRAINT chk_changed_by_type CHECK (changed_by_type IN ('SYSTEM', 'ADMIN', 'AGENT')),
  CONSTRAINT chk_status_event_sequence CHECK (event_sequence > 0)
);
CREATE INDEX idx_status_event_entry_seq ON commission_status_event (entry_id, event_sequence DESC);

CREATE TABLE idempotency_key (
  key varchar(255) PRIMARY KEY,
  processing_id uuid NOT NULL REFERENCES commission_processing(id) ON DELETE RESTRICT,
  request_hash varchar(64) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'IN_FLIGHT',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  completed_at timestamptz(6),
  CONSTRAINT chk_idempotency_status CHECK (status IN ('IN_FLIGHT', 'COMPLETED', 'FAILED')),
  CONSTRAINT chk_idempotency_request_hash CHECK (char_length(request_hash) = 64)
);

CREATE TABLE merchant_attribution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES merchant_branches(id) ON DELETE RESTRICT,
  recruiter_member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  attributed_entity_type varchar(20) NOT NULL DEFAULT 'MERCHANT',
  attribution_source varchar(30) NOT NULL DEFAULT 'REGISTRATION',
  attribution_scope varchar(30) NOT NULL DEFAULT 'PERMANENT',
  effective_from timestamptz(6) NOT NULL DEFAULT now(),
  effective_until timestamptz(6),
  supersedes_attribution_id uuid REFERENCES merchant_attribution(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL,
  correction_linkage uuid,
  audit_reference varchar(255),
  CONSTRAINT chk_attribution_entity_type CHECK (attributed_entity_type IN ('MERCHANT', 'BRANCH')),
  CONSTRAINT chk_attribution_source CHECK (attribution_source IN ('REGISTRATION', 'ADMIN_ASSIGNMENT')),
  CONSTRAINT chk_attribution_scope CHECK (attribution_scope = 'PERMANENT'),
  CONSTRAINT chk_attribution_entity_target CHECK (
    (attributed_entity_type = 'MERCHANT' AND branch_id IS NULL)
    OR (attributed_entity_type = 'BRANCH' AND branch_id IS NOT NULL)
  ),
  CONSTRAINT chk_permanent_attribution CHECK (
    attribution_scope = 'PERMANENT' AND effective_until IS NULL
  ),
  CONSTRAINT chk_attribution_deferred_fields CHECK (
    supersedes_attribution_id IS NULL AND correction_linkage IS NULL
  )
);
CREATE UNIQUE INDEX uq_merchant_attribution_merchant
  ON merchant_attribution (merchant_account_id)
  WHERE attributed_entity_type = 'MERCHANT' AND branch_id IS NULL;
CREATE UNIQUE INDEX uq_merchant_attribution_branch
  ON merchant_attribution (branch_id)
  WHERE attributed_entity_type = 'BRANCH' AND branch_id IS NOT NULL;
CREATE INDEX idx_attribution_merchant_account ON merchant_attribution (merchant_account_id);

CREATE TABLE commission_processing_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processing_id uuid NOT NULL REFERENCES commission_processing(id) ON DELETE RESTRICT,
  beneficiary_id uuid REFERENCES members(id) ON DELETE RESTRICT,
  generation integer NOT NULL DEFAULT 0,
  entry_type varchar(40),
  unrounded_amount numeric(38, 10),
  posted_amount numeric(38, 10),
  residual_amount numeric(38, 10),
  rounding_mode varchar(10) NOT NULL DEFAULT 'HALF_UP',
  calculation_scale integer NOT NULL DEFAULT 10,
  posting_scale integer NOT NULL DEFAULT 2,
  outcome varchar(30) NOT NULL,
  reason text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT chk_processing_result_outcome CHECK (
    outcome IN ('CREATED', 'SKIPPED_INELIGIBLE', 'SKIPPED_NO_BENEFICIARY', 'SKIPPED_ZERO_AMOUNT')
  ),
  CONSTRAINT chk_skip_no_beneficiary CHECK (
    (outcome = 'SKIPPED_NO_BENEFICIARY' AND beneficiary_id IS NULL)
    OR (outcome <> 'SKIPPED_NO_BENEFICIARY' AND beneficiary_id IS NOT NULL)
  ),
  CONSTRAINT chk_result_generation CHECK (generation IN (0, 1, 2)),
  CONSTRAINT chk_rounding_mode CHECK (rounding_mode = 'HALF_UP'),
  CONSTRAINT chk_calculation_scale CHECK (calculation_scale = 10),
  CONSTRAINT chk_posting_scale CHECK (posting_scale BETWEEN 0 AND 10)
);

CREATE TABLE commission_adjustment_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference varchar(30) NOT NULL,
  beneficiary_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  amount numeric(38, 10) NOT NULL,
  market varchar(2) NOT NULL,
  currency varchar(3) NOT NULL,
  reason text NOT NULL,
  audit_reference varchar(255),
  status varchar(20) NOT NULL DEFAULT 'PENDING_CHECKER',
  maker_id uuid NOT NULL,
  checker_id uuid,
  maker_notes text,
  checker_notes text,
  ledger_entry_id uuid REFERENCES commission_ledger(id) ON DELETE RESTRICT,
  decided_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_adjustment_public_ref UNIQUE (public_reference),
  CONSTRAINT uq_adjustment_ledger_entry UNIQUE (ledger_entry_id),
  CONSTRAINT chk_adjustment_status CHECK (status IN ('PENDING_CHECKER', 'APPROVED', 'REJECTED')),
  CONSTRAINT chk_adjustment_nonzero CHECK (amount <> 0),
  CONSTRAINT chk_maker_checker_different CHECK (checker_id IS NULL OR maker_id <> checker_id),
  CONSTRAINT chk_decided_fields CHECK (
    (status = 'PENDING_CHECKER' AND checker_id IS NULL AND decided_at IS NULL AND ledger_entry_id IS NULL)
    OR (status = 'APPROVED' AND checker_id IS NOT NULL AND decided_at IS NOT NULL AND ledger_entry_id IS NOT NULL)
    OR (status = 'REJECTED' AND checker_id IS NOT NULL AND decided_at IS NOT NULL AND ledger_entry_id IS NULL)
  )
);
CREATE INDEX idx_adjustment_beneficiary ON commission_adjustment_request (beneficiary_id);
CREATE INDEX idx_adjustment_status ON commission_adjustment_request (status);
CREATE INDEX idx_adjustment_maker ON commission_adjustment_request (maker_id);
CREATE INDEX idx_adjustment_checker ON commission_adjustment_request (checker_id);
CREATE INDEX idx_adjustment_created ON commission_adjustment_request (created_at DESC);

-- D-15 and immutable-ledger invariants.
CREATE TRIGGER referral_relationship_reject_update BEFORE UPDATE ON referral_relationship
  FOR EACH ROW EXECUTE FUNCTION reject_update();
CREATE TRIGGER referral_relationship_reject_delete BEFORE DELETE ON referral_relationship
  FOR EACH ROW EXECUTE FUNCTION reject_delete();
CREATE TRIGGER agent_activation_status_log_reject_update BEFORE UPDATE ON agent_activation_status_log
  FOR EACH ROW EXECUTE FUNCTION reject_update();
CREATE TRIGGER agent_activation_status_log_reject_delete BEFORE DELETE ON agent_activation_status_log
  FOR EACH ROW EXECUTE FUNCTION reject_delete();
CREATE TRIGGER commission_ledger_reject_update BEFORE UPDATE ON commission_ledger
  FOR EACH ROW EXECUTE FUNCTION reject_update();
CREATE TRIGGER commission_ledger_reject_delete BEFORE DELETE ON commission_ledger
  FOR EACH ROW EXECUTE FUNCTION reject_delete();
CREATE TRIGGER commission_status_event_reject_update BEFORE UPDATE ON commission_status_event
  FOR EACH ROW EXECUTE FUNCTION reject_update();
CREATE TRIGGER commission_status_event_reject_delete BEFORE DELETE ON commission_status_event
  FOR EACH ROW EXECUTE FUNCTION reject_delete();
CREATE TRIGGER commission_processing_result_reject_update BEFORE UPDATE ON commission_processing_result
  FOR EACH ROW EXECUTE FUNCTION reject_update();
CREATE TRIGGER commission_processing_result_reject_delete BEFORE DELETE ON commission_processing_result
  FOR EACH ROW EXECUTE FUNCTION reject_delete();

-- Frozen MY defaults. Rates remain versioned and market-scoped.
INSERT INTO commission_rate_version (
  commission_type, generation, market, rate_value, rate_type, effective_from, created_by
) VALUES
  ('AGENT_UPGRADE', 1, 'MY', 88.00, 'FIXED', '2026-07-25T00:00:00Z', '00000000-0000-0000-0000-000000000000'),
  ('AGENT_UPGRADE', 2, 'MY', 38.00, 'FIXED', '2026-07-25T00:00:00Z', '00000000-0000-0000-0000-000000000000'),
  ('MEMBER_CONSUMPTION', 1, 'MY', 0.01, 'PERCENTAGE', '2026-07-25T00:00:00Z', '00000000-0000-0000-0000-000000000000'),
  ('MEMBER_CONSUMPTION', 2, 'MY', 0.005, 'PERCENTAGE', '2026-07-25T00:00:00Z', '00000000-0000-0000-0000-000000000000'),
  ('MERCHANT_RECRUITMENT', 1, 'MY', 0.005, 'PERCENTAGE', '2026-07-25T00:00:00Z', '00000000-0000-0000-0000-000000000000');
