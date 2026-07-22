-- Phase 3: Reward & Wallet Schema
-- Forward-only migration. No destructive changes.

-- ─── Enums ──────────────────────────────────────────────────────────────

CREATE TYPE reward_plan_status AS ENUM (
  'SCHEDULED', 'ACTIVE', 'CAPPED', 'SUSPENDED', 'REVERSED', 'COMPLETED'
);

CREATE TYPE reward_cap_type AS ENUM ('NONE', 'FLAT', 'RATIO');

CREATE TYPE member_wallet_entry_type AS ENUM (
  'PENDING', 'AVAILABLE', 'REVERSED', 'COMPENSATION', 'ADJUSTMENT'
);

CREATE TYPE daily_job_status AS ENUM (
  'PENDING', 'RUNNING', 'COMPLETED', 'FAILED'
);

-- ─── Reward Rule Versions ───────────────────────────────────────────────

CREATE TABLE reward_rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  effective_from timestamptz(6) NOT NULL,
  effective_to timestamptz(6),
  reward_rate numeric(38, 10) NOT NULL,
  cap_type reward_cap_type NOT NULL DEFAULT 'NONE',
  cap_value numeric(38, 10) NOT NULL DEFAULT 0,
  minimum_reward numeric(38, 10) NOT NULL DEFAULT 0,
  market_id uuid REFERENCES markets(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  archived_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT reward_rule_versions_rate_check CHECK (reward_rate >= 0),
  CONSTRAINT reward_rule_versions_cap_value_check CHECK (
    (cap_type = 'NONE' AND cap_value = 0)
    OR (cap_type <> 'NONE' AND cap_value > 0)
  ),
  CONSTRAINT reward_rule_versions_minimum_reward_check CHECK (minimum_reward >= 0),
  CONSTRAINT reward_rule_versions_period_check CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

CREATE INDEX reward_rule_versions_market_effective_idx
  ON reward_rule_versions (market_id, effective_from);

-- ─── Reward Plans ───────────────────────────────────────────────────────

CREATE TABLE reward_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  merchant_id uuid NOT NULL REFERENCES merchant_branches(id) ON DELETE RESTRICT,
  status reward_plan_status NOT NULL DEFAULT 'SCHEDULED',
  total_earned numeric(38, 10) NOT NULL DEFAULT 0,
  cap_amount numeric(38, 10),
  snapshot jsonb,
  rule_version_id uuid REFERENCES reward_rule_versions(id) ON DELETE RESTRICT,
  activated_at timestamptz(6),
  completed_at timestamptz(6),
  reversed_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT reward_plans_source_unique UNIQUE (source_type, source_id, member_id, market_id),
  CONSTRAINT reward_plans_total_earned_check CHECK (total_earned >= 0)
);

CREATE INDEX reward_plans_member_market_status_idx
  ON reward_plans (member_id, market_id, status);

CREATE INDEX reward_plans_status_idx
  ON reward_plans (status);

-- ─── Reward Sources ─────────────────────────────────────────────────────

CREATE TABLE reward_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  merchant_id uuid NOT NULL REFERENCES merchant_branches(id) ON DELETE RESTRICT,
  transaction_amount numeric(38, 10) NOT NULL,
  currency text NOT NULL,
  merchant_package_snapshot jsonb,
  service_fee_snapshot jsonb,
  reward_rule_version_id uuid REFERENCES reward_rule_versions(id) ON DELETE RESTRICT,
  consumed boolean NOT NULL DEFAULT false,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT reward_sources_type_id_unique UNIQUE (source_type, source_id),
  CONSTRAINT reward_sources_source_unique UNIQUE (source_type, source_id, member_id, market_id),
  CONSTRAINT reward_sources_transaction_amount_check CHECK (transaction_amount > 0)
);

CREATE INDEX reward_sources_member_idx
  ON reward_sources (member_id);

-- ─── Member Wallet Accounts ─────────────────────────────────────────────

CREATE TABLE member_wallet_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  pending_balance numeric(38, 10) NOT NULL DEFAULT 0,
  available_balance numeric(38, 10) NOT NULL DEFAULT 0,
  reversed_balance numeric(38, 10) NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  archived_at timestamptz(6),
  CONSTRAINT member_wallet_accounts_member_market_unique UNIQUE (member_id, market_id),
  CONSTRAINT member_wallet_accounts_pending_balance_check CHECK (pending_balance >= 0),
  CONSTRAINT member_wallet_accounts_available_balance_check CHECK (available_balance >= 0),
  CONSTRAINT member_wallet_accounts_reversed_balance_check CHECK (reversed_balance >= 0),
  CONSTRAINT member_wallet_accounts_version_check CHECK (version > 0)
);

-- ─── Member Wallet Entries ──────────────────────────────────────────────

CREATE TABLE member_wallet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_account_id uuid NOT NULL REFERENCES member_wallet_accounts(id) ON DELETE RESTRICT,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  entry_sequence bigint NOT NULL,
  entry_type member_wallet_entry_type NOT NULL,
  amount numeric(38, 10) NOT NULL,
  balance_before numeric(38, 10) NOT NULL,
  balance_after numeric(38, 10) NOT NULL,
  idempotency_key text NOT NULL,
  reference_type text,
  reference_id text,
  description text,
  reason text,
  actor_id text,
  market_timezone text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT member_wallet_entries_wallet_sequence_unique
    UNIQUE (wallet_account_id, entry_sequence),
  CONSTRAINT member_wallet_entries_idempotency_key_unique
    UNIQUE (idempotency_key),
  CONSTRAINT member_wallet_entries_amount_check CHECK (amount > 0)
);

CREATE INDEX member_wallet_entries_member_market_idx
  ON member_wallet_entries (member_id, market_id);

CREATE INDEX member_wallet_entries_reference_idx
  ON member_wallet_entries (reference_type, reference_id);

-- ─── Daily Job Runs ─────────────────────────────────────────────────────

CREATE TABLE daily_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  local_business_date date NOT NULL,
  status daily_job_status NOT NULL DEFAULT 'PENDING',
  started_at timestamptz(6),
  completed_at timestamptz(6),
  total_entitlements integer NOT NULL DEFAULT 0,
  processed_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  error_detail text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT daily_job_runs_type_market_date_unique
    UNIQUE (job_type, market_id, local_business_date),
  CONSTRAINT daily_job_runs_job_type_check CHECK (char_length(job_type) > 0),
  CONSTRAINT daily_job_runs_total_entitlements_check CHECK (total_entitlements >= 0),
  CONSTRAINT daily_job_runs_processed_count_check CHECK (processed_count >= 0),
  CONSTRAINT daily_job_runs_failed_count_check CHECK (failed_count >= 0)
);

CREATE INDEX daily_job_runs_status_idx
  ON daily_job_runs (status);

CREATE INDEX daily_job_runs_market_date_idx
  ON daily_job_runs (market_id, local_business_date);

-- ─── Reward Daily Accruals ──────────────────────────────────────────────

CREATE TABLE reward_daily_accruals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_plan_id uuid NOT NULL REFERENCES reward_plans(id) ON DELETE RESTRICT,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  reward_rule_version_id uuid REFERENCES reward_rule_versions(id) ON DELETE RESTRICT,
  market_timezone text NOT NULL,
  market_local_date date NOT NULL,
  executed_at_utc timestamptz(6) NOT NULL,
  amount numeric(38, 10) NOT NULL,
  ledger_entry_type member_wallet_entry_type NOT NULL,
  idempotency_key text NOT NULL,
  audit_correlation_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT reward_daily_accruals_idempotency_unique
    UNIQUE (reward_plan_id, market_local_date, ledger_entry_type),
  CONSTRAINT reward_daily_accruals_idempotency_key_unique
    UNIQUE (idempotency_key),
  CONSTRAINT reward_daily_accruals_amount_check CHECK (amount > 0),
  CONSTRAINT reward_daily_accruals_idempotency_check CHECK (char_length(idempotency_key) > 0)
);

CREATE INDEX reward_daily_accruals_member_market_idx
  ON reward_daily_accruals (member_id, market_id);

CREATE INDEX reward_daily_accruals_plan_date_idx
  ON reward_daily_accruals (reward_plan_id, market_local_date);
