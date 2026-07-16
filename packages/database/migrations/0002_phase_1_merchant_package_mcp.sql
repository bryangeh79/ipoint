CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE merchant_application_status AS ENUM (
  'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'RESUBMISSION_REQUIRED', 'APPROVED', 'REJECTED'
);
CREATE TYPE merchant_kyc_status AS ENUM (
  'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'RESUBMISSION_REQUIRED', 'APPROVED', 'REJECTED'
);
CREATE TYPE merchant_operational_status AS ENUM (
  'PENDING_APPLICATION', 'PENDING_KYC', 'PENDING_MCP', 'ACTIVE', 'SUSPENDED',
  'CLOSURE_PENDING', 'CLOSED'
);
CREATE TYPE mcp_entry_type AS ENUM (
  'RECHARGE', 'TRANSACTION_DEDUCTION', 'ADVERTISING_DEDUCTION', 'MANUAL_CREDIT',
  'MANUAL_DEBIT', 'REFUND', 'FREEZE', 'UNFREEZE', 'REVERSAL'
);
CREATE TYPE mcp_direction AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE adjustment_state AS ENUM (
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXECUTED', 'CANCELLED'
);
CREATE TYPE recharge_state AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE refund_state AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
CREATE TYPE service_fee_status AS ENUM ('ACTIVE', 'PAUSED', 'PENDING_CHANGE');
CREATE TYPE auth_account_access_type AS ENUM ('PRIMARY_OWNER');

CREATE TABLE merchant_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  name text NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE merchant_account_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  merchant_group_id uuid NOT NULL REFERENCES merchant_groups(id) ON DELETE RESTRICT,
  access_type auth_account_access_type NOT NULL DEFAULT 'PRIMARY_OWNER',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT merchant_account_access_account_group_unique
    UNIQUE (account_id, merchant_group_id)
);

CREATE TABLE merchant_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_group_id uuid NOT NULL REFERENCES merchant_groups(id) ON DELETE RESTRICT,
  merchant_id text NOT NULL,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  name text NOT NULL,
  status merchant_operational_status NOT NULL DEFAULT 'PENDING_APPLICATION',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT merchant_branches_merchant_id_unique UNIQUE (merchant_id),
  CONSTRAINT merchant_branches_version_check CHECK (version > 0)
);
CREATE INDEX merchant_branches_group_idx ON merchant_branches (merchant_group_id);
CREATE INDEX merchant_branches_merchant_id_idx ON merchant_branches (merchant_id);

CREATE TABLE merchant_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_branch_id uuid NOT NULL REFERENCES merchant_branches(id) ON DELETE RESTRICT,
  logo_url text,
  banner_url text,
  about_us text,
  business_hours jsonb,
  phone text,
  whatsapp text,
  website text,
  social_links jsonb,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT merchant_profiles_branch_unique UNIQUE (merchant_branch_id)
);

CREATE TABLE merchant_profile_gallery_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_profile_id uuid NOT NULL REFERENCES merchant_profiles(id) ON DELETE RESTRICT,
  media_url text NOT NULL,
  position integer NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT merchant_profile_gallery_position_unique UNIQUE (merchant_profile_id, position),
  CONSTRAINT merchant_profile_gallery_position_check CHECK (position BETWEEN 1 AND 10)
);

CREATE TABLE merchant_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_branch_id uuid NOT NULL REFERENCES merchant_branches(id) ON DELETE RESTRICT,
  status merchant_application_status NOT NULL DEFAULT 'DRAFT',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT merchant_applications_branch_unique UNIQUE (merchant_branch_id),
  CONSTRAINT merchant_applications_version_check CHECK (version > 0)
);

CREATE TABLE merchant_application_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_application_id uuid NOT NULL REFERENCES merchant_applications(id) ON DELETE RESTRICT,
  submission_version integer NOT NULL,
  submitted_data jsonb NOT NULL,
  submitted_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT merchant_application_submission_version_unique
    UNIQUE (merchant_application_id, submission_version),
  CONSTRAINT merchant_application_submission_version_check CHECK (submission_version > 0)
);

CREATE TABLE merchant_application_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_application_id uuid NOT NULL REFERENCES merchant_applications(id) ON DELETE RESTRICT,
  reviewer_admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  decision merchant_application_status NOT NULL,
  reason text NOT NULL,
  decided_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT merchant_application_reviews_decision_check
    CHECK (decision IN ('APPROVED', 'REJECTED', 'RESUBMISSION_REQUIRED'))
);

CREATE TABLE merchant_kyc_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_branch_id uuid NOT NULL REFERENCES merchant_branches(id) ON DELETE RESTRICT,
  status merchant_kyc_status NOT NULL DEFAULT 'DRAFT',
  submission_version integer NOT NULL,
  submitted_data jsonb NOT NULL,
  submitted_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT merchant_kyc_submission_branch_version_unique
    UNIQUE (merchant_branch_id, submission_version),
  CONSTRAINT merchant_kyc_submission_version_check CHECK (submission_version > 0)
);

CREATE TABLE merchant_kyc_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_kyc_submission_id uuid NOT NULL REFERENCES merchant_kyc_submissions(id) ON DELETE RESTRICT,
  reviewer_admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  decision merchant_kyc_status NOT NULL,
  reason text NOT NULL,
  decided_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT merchant_kyc_reviews_decision_check
    CHECK (decision IN ('APPROVED', 'REJECTED', 'RESUBMISSION_REQUIRED'))
);

CREATE TABLE merchant_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_branch_id uuid NOT NULL REFERENCES merchant_branches(id) ON DELETE RESTRICT,
  document_type text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size_bytes bigint NOT NULL,
  sha256_hash text NOT NULL,
  object_key text NOT NULL,
  uploaded_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT merchant_documents_file_size_check CHECK (file_size_bytes > 0)
);
CREATE INDEX merchant_documents_branch_idx ON merchant_documents (merchant_branch_id);

CREATE TABLE merchant_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_branch_id uuid NOT NULL REFERENCES merchant_branches(id) ON DELETE RESTRICT,
  referrer_account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  referred_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT merchant_referrals_branch_unique UNIQUE (merchant_branch_id)
);

CREATE TABLE merchant_terms_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  merchant_branch_id uuid NOT NULL REFERENCES merchant_branches(id) ON DELETE RESTRICT,
  terms_version text NOT NULL,
  accepted_at timestamptz(6) NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  locale text,
  CONSTRAINT merchant_terms_acceptance_unique
    UNIQUE (account_id, merchant_branch_id, terms_version)
);

CREATE TABLE merchant_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_branch_id uuid NOT NULL REFERENCES merchant_branches(id) ON DELETE RESTRICT,
  previous_status merchant_operational_status,
  new_status merchant_operational_status NOT NULL,
  changed_by_actor_type text NOT NULL,
  changed_by_actor_id text NOT NULL,
  reason text,
  changed_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX merchant_status_history_branch_idx ON merchant_status_history (merchant_branch_id);

CREATE TABLE merchant_id_counters (
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  channel text NOT NULL,
  last_number bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (market_id, channel),
  CONSTRAINT merchant_id_counters_channel_check CHECK (channel ~ '^[a-z0-9]+$'),
  CONSTRAINT merchant_id_counters_number_check CHECK (last_number >= 0)
);

CREATE FUNCTION generate_merchant_id(target_market_id uuid, target_channel text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  market_code text;
  normalized_channel text := lower(trim(target_channel));
  allocated_number bigint;
BEGIN
  IF normalized_channel !~ '^[a-z0-9]+$' THEN
    RAISE EXCEPTION 'Invalid merchant channel: %', target_channel
      USING ERRCODE = '22023';
  END IF;

  SELECT lower(code) INTO STRICT market_code FROM markets WHERE id = target_market_id;

  INSERT INTO merchant_id_counters (market_id, channel, last_number)
  VALUES (target_market_id, normalized_channel, 1)
  ON CONFLICT (market_id, channel)
  DO UPDATE SET last_number = merchant_id_counters.last_number + 1
  RETURNING last_number INTO allocated_number;

  RETURN market_code || '_' || normalized_channel || '_' || lpad(allocated_number::text, 6, '0');
END;
$$;

CREATE TABLE service_fee_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT service_fee_profiles_code_unique UNIQUE (code)
);

CREATE TABLE service_fee_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_fee_profile_id uuid NOT NULL REFERENCES service_fee_profiles(id) ON DELETE RESTRICT,
  rate numeric(12,6) NOT NULL,
  effective_from timestamptz(6) NOT NULL,
  effective_to timestamptz(6),
  status service_fee_status NOT NULL DEFAULT 'ACTIVE',
  market_id uuid REFERENCES markets(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT service_fee_versions_rate_check CHECK (rate > 0 AND rate <= 100),
  CONSTRAINT service_fee_versions_period_check
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT service_fee_versions_no_overlap
    EXCLUDE USING gist (
      service_fee_profile_id WITH =,
      (COALESCE(market_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
      tstzrange(effective_from, effective_to, '[)') WITH &&
    )
);

CREATE TABLE special_percentages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate numeric(12,6) NOT NULL,
  created_by_admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  description text,
  market_id uuid REFERENCES markets(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT special_percentages_rate_check CHECK (rate > 0 AND rate <= 100)
);

CREATE TABLE merchant_package_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_branch_id uuid NOT NULL REFERENCES merchant_branches(id) ON DELETE RESTRICT,
  service_fee_version_id uuid REFERENCES service_fee_versions(id) ON DELETE RESTRICT,
  special_percentage_id uuid REFERENCES special_percentages(id) ON DELETE RESTRICT,
  status service_fee_status NOT NULL DEFAULT 'ACTIVE',
  is_default boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT merchant_package_assignments_source_check
    CHECK (num_nonnulls(service_fee_version_id, special_percentage_id) = 1),
  CONSTRAINT merchant_package_assignments_version_check CHECK (version > 0)
);
CREATE INDEX merchant_package_assignments_branch_status_idx
  ON merchant_package_assignments (merchant_branch_id, status);
CREATE UNIQUE INDEX merchant_package_assignments_active_default_unique
  ON merchant_package_assignments (merchant_branch_id)
  WHERE is_default = true AND status = 'ACTIVE';

CREATE FUNCTION enforce_active_default_assignment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_branch_id uuid;
  active_default_count integer;
BEGIN
  target_branch_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.merchant_branch_id ELSE NEW.merchant_branch_id END;
  SELECT count(*) INTO active_default_count
  FROM merchant_package_assignments
  WHERE merchant_branch_id = target_branch_id AND status = 'ACTIVE' AND is_default = true;
  IF active_default_count <> 1 THEN
    RAISE EXCEPTION 'Merchant branch % must have exactly one active default package assignment', target_branch_id
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.merchant_branch_id <> NEW.merchant_branch_id THEN
    SELECT count(*) INTO active_default_count
    FROM merchant_package_assignments
    WHERE merchant_branch_id = OLD.merchant_branch_id AND status = 'ACTIVE' AND is_default = true;
    IF active_default_count <> 1 THEN
      RAISE EXCEPTION 'Merchant branch % must have exactly one active default package assignment', OLD.merchant_branch_id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER merchant_package_assignments_active_default
AFTER INSERT OR UPDATE OR DELETE ON merchant_package_assignments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_active_default_assignment();

CREATE TABLE mcp_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_branch_id uuid NOT NULL REFERENCES merchant_branches(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  available_balance numeric(24,8) NOT NULL DEFAULT 0,
  total_balance numeric(24,8) NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT mcp_accounts_branch_unique UNIQUE (merchant_branch_id),
  CONSTRAINT mcp_accounts_available_balance_check CHECK (available_balance >= 0),
  CONSTRAINT mcp_accounts_total_balance_check CHECK (total_balance >= 0),
  CONSTRAINT mcp_accounts_version_check CHECK (version > 0)
);

CREATE TABLE mcp_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mcp_account_id uuid NOT NULL REFERENCES mcp_accounts(id) ON DELETE RESTRICT,
  sequence bigint NOT NULL,
  entry_type mcp_entry_type NOT NULL,
  direction mcp_direction NOT NULL,
  amount numeric(24,8) NOT NULL,
  balance_delta numeric(24,8) NOT NULL,
  available_delta numeric(24,8) NOT NULL,
  source_type text NOT NULL,
  source_id text,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  actor_type text NOT NULL,
  actor_id text,
  approval_request_id uuid,
  reversal_of_entry_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_at timestamptz(6) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT mcp_ledger_account_sequence_unique UNIQUE (mcp_account_id, sequence),
  CONSTRAINT mcp_ledger_account_idempotency_unique UNIQUE (mcp_account_id, idempotency_key),
  CONSTRAINT mcp_ledger_amount_check CHECK (amount > 0),
  CONSTRAINT mcp_ledger_reversal_fk
    FOREIGN KEY (reversal_of_entry_id) REFERENCES mcp_ledger_entries(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX mcp_ledger_reversal_unique
  ON mcp_ledger_entries (reversal_of_entry_id) WHERE reversal_of_entry_id IS NOT NULL;

CREATE TABLE mcp_recharge_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mcp_account_id uuid NOT NULL REFERENCES mcp_accounts(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  requested_by_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount numeric(24,8) NOT NULL,
  channel text NOT NULL,
  status recharge_state NOT NULL DEFAULT 'PENDING',
  idempotency_key text NOT NULL,
  provider_event_id text,
  reviewed_by_admin_user_id uuid REFERENCES admin_users(id) ON DELETE RESTRICT,
  review_reason text,
  ledger_entry_id uuid REFERENCES mcp_ledger_entries(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT mcp_recharge_account_idempotency_unique UNIQUE (mcp_account_id, idempotency_key),
  CONSTRAINT mcp_recharge_amount_check CHECK (amount > 0)
);
CREATE UNIQUE INDEX mcp_recharge_provider_event_unique
  ON mcp_recharge_requests (provider_event_id) WHERE provider_event_id IS NOT NULL;

CREATE TABLE mcp_refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mcp_account_id uuid NOT NULL REFERENCES mcp_accounts(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  requested_by_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount numeric(24,8) NOT NULL,
  status refund_state NOT NULL DEFAULT 'PENDING',
  reason text NOT NULL,
  idempotency_key text NOT NULL,
  reviewed_by_admin_user_id uuid REFERENCES admin_users(id) ON DELETE RESTRICT,
  review_reason text,
  ledger_entry_id uuid REFERENCES mcp_ledger_entries(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT mcp_refund_account_idempotency_unique UNIQUE (mcp_account_id, idempotency_key),
  CONSTRAINT mcp_refund_amount_check CHECK (amount > 0)
);

CREATE TABLE mcp_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mcp_account_id uuid NOT NULL REFERENCES mcp_accounts(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  maker_admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  entry_type mcp_entry_type NOT NULL,
  amount numeric(24,8) NOT NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status adjustment_state NOT NULL DEFAULT 'DRAFT',
  idempotency_key text NOT NULL,
  ledger_entry_id uuid REFERENCES mcp_ledger_entries(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT mcp_adjustment_account_idempotency_unique UNIQUE (mcp_account_id, idempotency_key),
  CONSTRAINT mcp_adjustment_amount_check CHECK (amount > 0),
  CONSTRAINT mcp_adjustment_entry_type_check
    CHECK (entry_type IN ('MANUAL_CREDIT', 'MANUAL_DEBIT')),
  CONSTRAINT mcp_adjustment_version_check CHECK (version > 0)
);

CREATE TABLE mcp_adjustment_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_request_id uuid NOT NULL REFERENCES mcp_adjustment_requests(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  checker_admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  decision text NOT NULL,
  reason text NOT NULL,
  decided_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT mcp_adjustment_decision_request_unique UNIQUE (adjustment_request_id),
  CONSTRAINT mcp_adjustment_decision_value_check CHECK (decision IN ('APPROVED', 'REJECTED'))
);

CREATE FUNCTION reject_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'UPDATE is not allowed on append-only table %', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION reject_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'DELETE is not allowed on append-only table %', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION reject_account_email_update() RETURNS trigger AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Account email is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounts_email_immutable
  BEFORE UPDATE OF email ON accounts
  FOR EACH ROW EXECUTE FUNCTION reject_account_email_update();

DO $$
DECLARE
  append_only_table text;
BEGIN
  FOREACH append_only_table IN ARRAY ARRAY[
    'merchant_application_submissions',
    'merchant_application_reviews',
    'merchant_kyc_submissions',
    'merchant_kyc_reviews',
    'merchant_documents',
    'merchant_referrals',
    'merchant_terms_acceptances',
    'merchant_status_history',
    'mcp_ledger_entries',
    'mcp_adjustment_decisions'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_reject_update BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION reject_update()',
      append_only_table,
      append_only_table
    );
    EXECUTE format(
      'CREATE TRIGGER %I_reject_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_delete()',
      append_only_table,
      append_only_table
    );
  END LOOP;
END;
$$;
