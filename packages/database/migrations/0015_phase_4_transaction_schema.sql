-- Phase 4 Batch A (P4-S1): Transaction schema and domain model.
-- Forward-only migration. Reuses the existing MCP and reward ledgers.

CREATE TYPE transaction_status AS ENUM (
  'DRAFT',
  'PREVIEWED',
  'CONFIRMED',
  'FAILED',
  'EXPIRED'
);

CREATE TYPE transaction_idempotency_operation AS ENUM ('PREVIEW', 'CONFIRM');

CREATE TYPE transaction_idempotency_status AS ENUM (
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED'
);

CREATE TYPE transaction_audit_event_type AS ENUM (
  'PREVIEW_CREATED',
  'CONFIRMED',
  'FAILED',
  'EXPIRED'
);

CREATE SEQUENCE transaction_number_sequence AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE TABLE market_transaction_settings (
  market_id uuid PRIMARY KEY REFERENCES markets(id) ON DELETE RESTRICT,
  currency_code text NOT NULL,
  currency_scale integer NOT NULL,
  minimum_transaction_amount numeric(38, 10) NOT NULL,
  maximum_transaction_amount numeric(38, 10) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT market_transaction_settings_market_currency_unique
    UNIQUE (market_id, currency_code),
  CONSTRAINT market_transaction_settings_currency_check CHECK (
    currency_code = upper(currency_code) AND char_length(currency_code) = 3
  ),
  CONSTRAINT market_transaction_settings_currency_scale_check CHECK (
    currency_scale BETWEEN 0 AND 10
  ),
  CONSTRAINT market_transaction_settings_amount_range_check CHECK (
    minimum_transaction_amount > 0
    AND maximum_transaction_amount >= minimum_transaction_amount
  )
);

CREATE TABLE transaction_preview_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status transaction_status NOT NULL DEFAULT 'DRAFT',
  merchant_branch_id uuid NOT NULL,
  merchant_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  created_by_staff_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  protected_member_reference text NOT NULL,
  market_id uuid NOT NULL,
  currency text NOT NULL,
  purchase_amount numeric(38, 10) NOT NULL,
  transaction_note text,
  merchant_package_assignment_id uuid NOT NULL
    REFERENCES merchant_package_assignments(id) ON DELETE RESTRICT,
  merchant_package_version integer NOT NULL,
  merchant_package_snapshot jsonb NOT NULL,
  service_fee_rate numeric(38, 10) NOT NULL,
  service_fee_amount numeric(38, 10) NOT NULL,
  estimated_mcp_debit numeric(38, 10) NOT NULL,
  reward_rule_version_id uuid NOT NULL
    REFERENCES reward_rule_versions(id) ON DELETE RESTRICT,
  reward_rate numeric(38, 10) NOT NULL,
  reward_principal numeric(38, 10) NOT NULL,
  reward_cap numeric(38, 10) NOT NULL,
  daily_reward_amount numeric(38, 10) NOT NULL,
  reward_start_business_date date NOT NULL,
  market_timezone text NOT NULL,
  rounding_mode text NOT NULL DEFAULT 'HALF_UP',
  previewed_at timestamptz(6),
  confirmed_at timestamptz(6),
  expires_at timestamptz(6) DEFAULT (now() + interval '60 minutes'),
  failure_code text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT transaction_preview_sessions_branch_market_fk
    FOREIGN KEY (merchant_branch_id, market_id)
    REFERENCES merchant_branches(id, market_id) ON DELETE RESTRICT,
  CONSTRAINT transaction_preview_sessions_market_currency_fk
    FOREIGN KEY (market_id, currency)
    REFERENCES market_transaction_settings(market_id, currency_code) ON DELETE RESTRICT,
  CONSTRAINT transaction_preview_sessions_amount_check CHECK (purchase_amount > 0),
  CONSTRAINT transaction_preview_sessions_note_check CHECK (
    transaction_note IS NULL OR char_length(transaction_note) <= 200
  ),
  CONSTRAINT transaction_preview_sessions_member_reference_check CHECK (
    btrim(protected_member_reference) <> ''
  ),
  CONSTRAINT transaction_preview_sessions_package_version_check CHECK (
    merchant_package_version > 0
  ),
  CONSTRAINT transaction_preview_sessions_package_snapshot_check CHECK (
    jsonb_typeof(merchant_package_snapshot) = 'object'
  ),
  CONSTRAINT transaction_preview_sessions_service_fee_check CHECK (
    service_fee_rate > 0
    AND service_fee_rate <= 100
    AND service_fee_amount >= 0
  ),
  CONSTRAINT transaction_preview_sessions_mcp_check CHECK (estimated_mcp_debit >= 0),
  CONSTRAINT transaction_preview_sessions_reward_check CHECK (
    reward_rate >= 0
    AND reward_principal = purchase_amount
    AND reward_cap >= 0
    AND daily_reward_amount >= 0
    AND daily_reward_amount <= reward_cap
  ),
  CONSTRAINT transaction_preview_sessions_rounding_check CHECK (
    rounding_mode = 'HALF_UP'
  ),
  CONSTRAINT transaction_preview_sessions_expiry_check CHECK (
    expires_at = created_at + interval '60 minutes'
    OR (status = 'CONFIRMED' AND expires_at IS NULL)
  ),
  CONSTRAINT transaction_preview_sessions_state_check CHECK (
    (status = 'DRAFT' AND previewed_at IS NULL AND confirmed_at IS NULL)
    OR (status = 'PREVIEWED' AND previewed_at IS NOT NULL AND confirmed_at IS NULL)
    OR (status = 'CONFIRMED' AND previewed_at IS NOT NULL AND confirmed_at IS NOT NULL)
    OR (status IN ('FAILED', 'EXPIRED') AND confirmed_at IS NULL)
  )
);

CREATE INDEX transaction_preview_sessions_merchant_status_idx
  ON transaction_preview_sessions (merchant_branch_id, status, expires_at);

CREATE INDEX transaction_preview_sessions_member_idx
  ON transaction_preview_sessions (member_id, created_at);

CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preview_session_id uuid NOT NULL UNIQUE
    REFERENCES transaction_preview_sessions(id) ON DELETE RESTRICT,
  transaction_number bigint NOT NULL DEFAULT nextval('transaction_number_sequence'),
  merchant_receipt_number text,
  status transaction_status NOT NULL DEFAULT 'CONFIRMED',
  merchant_branch_id uuid NOT NULL,
  merchant_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  confirmed_by_staff_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  protected_member_reference text NOT NULL,
  market_id uuid NOT NULL,
  currency text NOT NULL,
  purchase_amount numeric(38, 10) NOT NULL,
  transaction_note text,
  merchant_package_assignment_id uuid NOT NULL
    REFERENCES merchant_package_assignments(id) ON DELETE RESTRICT,
  merchant_package_version integer NOT NULL,
  merchant_package_snapshot jsonb NOT NULL,
  reward_rule_version_id uuid NOT NULL
    REFERENCES reward_rule_versions(id) ON DELETE RESTRICT,
  reward_rate numeric(38, 10) NOT NULL,
  reward_principal numeric(38, 10) NOT NULL,
  reward_cap numeric(38, 10) NOT NULL,
  daily_reward_amount numeric(38, 10) NOT NULL,
  reward_start_business_date date NOT NULL,
  market_timezone text NOT NULL,
  rounding_mode text NOT NULL DEFAULT 'HALF_UP',
  confirmed_at timestamptz(6) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT transactions_number_unique UNIQUE (transaction_number),
  CONSTRAINT transactions_id_market_unique UNIQUE (id, market_id),
  CONSTRAINT transactions_branch_market_fk
    FOREIGN KEY (merchant_branch_id, market_id)
    REFERENCES merchant_branches(id, market_id) ON DELETE RESTRICT,
  CONSTRAINT transactions_market_currency_fk
    FOREIGN KEY (market_id, currency)
    REFERENCES market_transaction_settings(market_id, currency_code) ON DELETE RESTRICT,
  CONSTRAINT transactions_status_check CHECK (status = 'CONFIRMED'),
  CONSTRAINT transactions_number_check CHECK (transaction_number > 0),
  CONSTRAINT transactions_receipt_check CHECK (
    merchant_receipt_number IS NULL OR btrim(merchant_receipt_number) <> ''
  ),
  CONSTRAINT transactions_amount_check CHECK (purchase_amount > 0),
  CONSTRAINT transactions_note_check CHECK (
    transaction_note IS NULL OR char_length(transaction_note) <= 200
  ),
  CONSTRAINT transactions_member_reference_check CHECK (
    btrim(protected_member_reference) <> ''
  ),
  CONSTRAINT transactions_package_version_check CHECK (merchant_package_version > 0),
  CONSTRAINT transactions_package_snapshot_check CHECK (
    jsonb_typeof(merchant_package_snapshot) = 'object'
  ),
  CONSTRAINT transactions_reward_check CHECK (
    reward_rate >= 0
    AND reward_principal = purchase_amount
    AND reward_cap >= 0
    AND daily_reward_amount >= 0
    AND daily_reward_amount <= reward_cap
  ),
  CONSTRAINT transactions_rounding_check CHECK (rounding_mode = 'HALF_UP')
);

CREATE UNIQUE INDEX transactions_merchant_receipt_unique
  ON transactions (merchant_branch_id, merchant_receipt_number)
  WHERE merchant_receipt_number IS NOT NULL;

CREATE INDEX transactions_merchant_time_idx
  ON transactions (merchant_branch_id, confirmed_at DESC);

CREATE INDEX transactions_member_time_idx
  ON transactions (member_id, confirmed_at DESC);

CREATE TABLE transaction_service_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL,
  currency text NOT NULL,
  rate numeric(38, 10) NOT NULL,
  principal numeric(38, 10) NOT NULL,
  amount numeric(38, 10) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT transaction_service_fees_transaction_market_fk
    FOREIGN KEY (transaction_id, market_id)
    REFERENCES transactions(id, market_id) ON DELETE RESTRICT,
  CONSTRAINT transaction_service_fees_market_currency_fk
    FOREIGN KEY (market_id, currency)
    REFERENCES market_transaction_settings(market_id, currency_code) ON DELETE RESTRICT,
  CONSTRAINT transaction_service_fees_value_check CHECK (
    rate > 0 AND rate <= 100 AND principal > 0 AND amount >= 0
  )
);

ALTER TABLE mcp_accounts
  ADD CONSTRAINT mcp_accounts_id_market_unique UNIQUE (id, market_id);

ALTER TABLE mcp_accounts
  ADD CONSTRAINT mcp_accounts_branch_market_fk
  FOREIGN KEY (merchant_branch_id, market_id)
  REFERENCES merchant_branches(id, market_id) ON DELETE RESTRICT;

ALTER TABLE mcp_ledger_entries
  ADD CONSTRAINT mcp_ledger_entries_id_account_unique UNIQUE (id, mcp_account_id);

CREATE TABLE transaction_mcp_debits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL UNIQUE,
  market_id uuid NOT NULL,
  mcp_account_id uuid NOT NULL,
  mcp_ledger_entry_id uuid NOT NULL UNIQUE,
  amount numeric(38, 10) NOT NULL,
  balance_after numeric(38, 10) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT transaction_mcp_debits_transaction_market_fk
    FOREIGN KEY (transaction_id, market_id)
    REFERENCES transactions(id, market_id) ON DELETE RESTRICT,
  CONSTRAINT transaction_mcp_debits_account_market_fk
    FOREIGN KEY (mcp_account_id, market_id)
    REFERENCES mcp_accounts(id, market_id) ON DELETE RESTRICT,
  CONSTRAINT transaction_mcp_debits_ledger_account_fk
    FOREIGN KEY (mcp_ledger_entry_id, mcp_account_id)
    REFERENCES mcp_ledger_entries(id, mcp_account_id) ON DELETE RESTRICT,
  CONSTRAINT transaction_mcp_debits_value_check CHECK (
    amount > 0 AND balance_after >= 0
  )
);

CREATE TABLE transaction_reward_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
  reward_source_id uuid NOT NULL UNIQUE REFERENCES reward_sources(id) ON DELETE RESTRICT,
  reward_plan_id uuid NOT NULL UNIQUE REFERENCES reward_plans(id) ON DELETE RESTRICT,
  reward_rule_version_id uuid NOT NULL
    REFERENCES reward_rule_versions(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE transaction_idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_branch_id uuid NOT NULL REFERENCES merchant_branches(id) ON DELETE RESTRICT,
  operation transaction_idempotency_operation NOT NULL,
  key_hash text NOT NULL,
  request_hash text NOT NULL,
  status transaction_idempotency_status NOT NULL DEFAULT 'IN_PROGRESS',
  preview_session_id uuid REFERENCES transaction_preview_sessions(id) ON DELETE RESTRICT,
  transaction_id uuid REFERENCES transactions(id) ON DELETE RESTRICT,
  response jsonb,
  status_code integer,
  request_id text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT transaction_idempotency_records_key_unique
    UNIQUE (merchant_branch_id, operation, key_hash),
  CONSTRAINT transaction_idempotency_records_hash_check CHECK (
    char_length(key_hash) = 64 AND char_length(request_hash) = 64
  ),
  CONSTRAINT transaction_idempotency_records_target_check CHECK (
    (operation = 'PREVIEW' AND transaction_id IS NULL)
    OR (operation = 'CONFIRM' AND preview_session_id IS NOT NULL)
  ),
  CONSTRAINT transaction_idempotency_records_response_check CHECK (
    (status = 'IN_PROGRESS' AND response IS NULL AND status_code IS NULL)
    OR (
      status IN ('COMPLETED', 'FAILED')
      AND response IS NOT NULL
      AND status_code BETWEEN 200 AND 599
    )
  )
);

CREATE INDEX transaction_idempotency_records_preview_idx
  ON transaction_idempotency_records (preview_session_id);

CREATE TABLE transaction_audit_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type transaction_audit_event_type NOT NULL,
  audit_log_id uuid NOT NULL UNIQUE REFERENCES audit_logs(id) ON DELETE RESTRICT,
  preview_session_id uuid NOT NULL
    REFERENCES transaction_preview_sessions(id) ON DELETE RESTRICT,
  transaction_id uuid REFERENCES transactions(id) ON DELETE RESTRICT,
  idempotency_record_id uuid NOT NULL
    REFERENCES transaction_idempotency_records(id) ON DELETE RESTRICT,
  preview_creator_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  confirmer_account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  merchant_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  staff_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  protected_member_reference text NOT NULL,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  currency text NOT NULL,
  purchase_amount numeric(38, 10) NOT NULL,
  merchant_package_assignment_id uuid NOT NULL
    REFERENCES merchant_package_assignments(id) ON DELETE RESTRICT,
  merchant_package_version integer NOT NULL,
  service_fee_rate numeric(38, 10) NOT NULL,
  reward_rule_version_id uuid NOT NULL
    REFERENCES reward_rule_versions(id) ON DELETE RESTRICT,
  request_id text,
  client_channel text NOT NULL,
  previewed_at timestamptz(6) NOT NULL,
  confirmed_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT transaction_audit_references_event_check CHECK (
    (event_type = 'CONFIRMED' AND transaction_id IS NOT NULL AND confirmer_account_id IS NOT NULL
      AND confirmed_at IS NOT NULL)
    OR (event_type <> 'CONFIRMED' AND transaction_id IS NULL AND confirmer_account_id IS NULL
      AND confirmed_at IS NULL)
  ),
  CONSTRAINT transaction_audit_references_value_check CHECK (
    purchase_amount > 0
    AND merchant_package_version > 0
    AND service_fee_rate > 0
    AND service_fee_rate <= 100
    AND btrim(protected_member_reference) <> ''
    AND btrim(client_channel) <> ''
  )
);

CREATE INDEX transaction_audit_references_preview_idx
  ON transaction_audit_references (preview_session_id, created_at);

CREATE OR REPLACE FUNCTION enforce_transaction_amount_configuration()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  settings market_transaction_settings%ROWTYPE;
BEGIN
  SELECT *
    INTO settings
    FROM market_transaction_settings
   WHERE market_id = NEW.market_id
     AND currency_code = NEW.currency;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction market/currency configuration is missing'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.purchase_amount < settings.minimum_transaction_amount
     OR NEW.purchase_amount > settings.maximum_transaction_amount THEN
    RAISE EXCEPTION 'Transaction amount is outside the configured market range'
      USING ERRCODE = '23514';
  END IF;

  IF round(NEW.purchase_amount, settings.currency_scale) <> NEW.purchase_amount THEN
    RAISE EXCEPTION 'Transaction amount exceeds the configured currency scale'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER transaction_preview_sessions_amount_configuration
BEFORE INSERT OR UPDATE OF market_id, currency, purchase_amount
ON transaction_preview_sessions
FOR EACH ROW EXECUTE FUNCTION enforce_transaction_amount_configuration();

CREATE TRIGGER transactions_amount_configuration
BEFORE INSERT OR UPDATE OF market_id, currency, purchase_amount
ON transactions
FOR EACH ROW EXECUTE FUNCTION enforce_transaction_amount_configuration();

CREATE OR REPLACE FUNCTION enforce_transaction_preview_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.merchant_branch_id,
    NEW.merchant_account_id,
    NEW.created_by_staff_account_id,
    NEW.member_id,
    NEW.protected_member_reference,
    NEW.market_id,
    NEW.currency,
    NEW.purchase_amount,
    NEW.transaction_note,
    NEW.merchant_package_assignment_id,
    NEW.merchant_package_version,
    NEW.merchant_package_snapshot,
    NEW.service_fee_rate,
    NEW.service_fee_amount,
    NEW.estimated_mcp_debit,
    NEW.reward_rule_version_id,
    NEW.reward_rate,
    NEW.reward_principal,
    NEW.reward_cap,
    NEW.daily_reward_amount,
    NEW.reward_start_business_date,
    NEW.market_timezone,
    NEW.rounding_mode,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.merchant_branch_id,
    OLD.merchant_account_id,
    OLD.created_by_staff_account_id,
    OLD.member_id,
    OLD.protected_member_reference,
    OLD.market_id,
    OLD.currency,
    OLD.purchase_amount,
    OLD.transaction_note,
    OLD.merchant_package_assignment_id,
    OLD.merchant_package_version,
    OLD.merchant_package_snapshot,
    OLD.service_fee_rate,
    OLD.service_fee_amount,
    OLD.estimated_mcp_debit,
    OLD.reward_rule_version_id,
    OLD.reward_rate,
    OLD.reward_principal,
    OLD.reward_cap,
    OLD.daily_reward_amount,
    OLD.reward_start_business_date,
    OLD.market_timezone,
    OLD.rounding_mode,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Transaction preview financial snapshot is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status IN ('CONFIRMED', 'FAILED', 'EXPIRED') THEN
    RAISE EXCEPTION 'Terminal transaction preview cannot be changed'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT', 'PREVIEWED', 'FAILED', 'EXPIRED'))
    OR (OLD.status = 'PREVIEWED' AND NEW.status IN ('PREVIEWED', 'CONFIRMED', 'FAILED', 'EXPIRED'))
  ) THEN
    RAISE EXCEPTION 'Invalid transaction preview state transition'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER transaction_preview_sessions_update_guard
BEFORE UPDATE ON transaction_preview_sessions
FOR EACH ROW EXECUTE FUNCTION enforce_transaction_preview_update();

CREATE OR REPLACE FUNCTION reject_financial_record_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Confirmed transaction financial records are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER transactions_immutable
BEFORE UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION reject_financial_record_mutation();

CREATE TRIGGER transaction_service_fees_immutable
BEFORE UPDATE OR DELETE ON transaction_service_fees
FOR EACH ROW EXECUTE FUNCTION reject_financial_record_mutation();

CREATE TRIGGER transaction_mcp_debits_immutable
BEFORE UPDATE OR DELETE ON transaction_mcp_debits
FOR EACH ROW EXECUTE FUNCTION reject_financial_record_mutation();

CREATE TRIGGER transaction_reward_links_immutable
BEFORE UPDATE OR DELETE ON transaction_reward_links
FOR EACH ROW EXECUTE FUNCTION reject_financial_record_mutation();

CREATE TRIGGER transaction_audit_references_immutable
BEFORE UPDATE OR DELETE ON transaction_audit_references
FOR EACH ROW EXECUTE FUNCTION reject_financial_record_mutation();
