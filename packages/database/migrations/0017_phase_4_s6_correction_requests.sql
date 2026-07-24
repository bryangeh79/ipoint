-- Phase 4 P4-S6: reversal/refund requests and exactly-once compensating executions.
-- Forward-only. Financial snapshots and original ledger rows remain immutable.

DROP TRIGGER transactions_immutable ON transactions;
ALTER TABLE transactions DROP CONSTRAINT transactions_status_check;
ALTER TABLE transaction_preview_sessions
  DROP CONSTRAINT transaction_preview_sessions_expiry_check;
ALTER TABLE transaction_preview_sessions
  DROP CONSTRAINT transaction_preview_sessions_state_check;
ALTER TABLE transactions ALTER COLUMN status DROP DEFAULT;
ALTER TABLE transaction_preview_sessions ALTER COLUMN status DROP DEFAULT;

CREATE TYPE transaction_status_p4_s6 AS ENUM (
  'DRAFT',
  'PREVIEWED',
  'CONFIRMED',
  'REVERSAL_REQUESTED',
  'REFUND_REQUESTED',
  'REVERSED',
  'REFUNDED',
  'REJECTED',
  'FAILED',
  'EXPIRED'
);

ALTER TABLE transactions
  ALTER COLUMN status TYPE transaction_status_p4_s6
  USING status::text::transaction_status_p4_s6;
ALTER TABLE transaction_preview_sessions
  ALTER COLUMN status TYPE transaction_status_p4_s6
  USING status::text::transaction_status_p4_s6;
DROP TYPE transaction_status;
ALTER TYPE transaction_status_p4_s6 RENAME TO transaction_status;
ALTER TABLE transactions ALTER COLUMN status SET DEFAULT 'CONFIRMED';
ALTER TABLE transaction_preview_sessions ALTER COLUMN status SET DEFAULT 'DRAFT';

ALTER TABLE transaction_preview_sessions
  ADD CONSTRAINT transaction_preview_sessions_expiry_check CHECK (
    expires_at = created_at + interval '60 minutes'
    OR (status = 'CONFIRMED' AND expires_at IS NULL)
  );
ALTER TABLE transaction_preview_sessions
  ADD CONSTRAINT transaction_preview_sessions_state_check CHECK (
    (status = 'DRAFT' AND previewed_at IS NULL AND confirmed_at IS NULL)
    OR (status = 'PREVIEWED' AND previewed_at IS NOT NULL AND confirmed_at IS NULL)
    OR (status = 'CONFIRMED' AND previewed_at IS NOT NULL AND confirmed_at IS NOT NULL)
    OR (status IN ('FAILED', 'EXPIRED') AND confirmed_at IS NULL)
  );

ALTER TABLE transactions
  ADD CONSTRAINT transactions_status_check CHECK (
    status IN (
      'CONFIRMED',
      'REVERSAL_REQUESTED',
      'REFUND_REQUESTED',
      'REVERSED',
      'REFUNDED',
      'REJECTED'
    )
  );

ALTER TABLE merchant_account_access ALTER COLUMN access_type DROP DEFAULT;
CREATE TYPE auth_account_access_type_p4_s6 AS ENUM (
  'PRIMARY_OWNER',
  'OWNER',
  'ADMIN',
  'CASHIER'
);
ALTER TABLE merchant_account_access
  ALTER COLUMN access_type TYPE auth_account_access_type_p4_s6
  USING access_type::text::auth_account_access_type_p4_s6;
DROP TYPE auth_account_access_type;
ALTER TYPE auth_account_access_type_p4_s6 RENAME TO auth_account_access_type;
ALTER TABLE merchant_account_access
  ALTER COLUMN access_type SET DEFAULT 'PRIMARY_OWNER';

CREATE TYPE correction_request_type AS ENUM ('REVERSAL', 'REFUND');
CREATE TYPE correction_request_status AS ENUM (
  'REQUESTED',
  'EXECUTED',
  'REJECTED'
);

CREATE TABLE correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  merchant_branch_id uuid NOT NULL REFERENCES merchant_branches(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  request_type correction_request_type NOT NULL,
  status correction_request_status NOT NULL DEFAULT 'REQUESTED',
  reason_code text NOT NULL,
  reason_note text,
  requested_by_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  key_hash text NOT NULL,
  payload_hash text NOT NULL,
  response jsonb NOT NULL,
  executed_at timestamptz(6),
  rejected_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT correction_requests_transaction_type_unique
    UNIQUE (transaction_id, request_type),
  CONSTRAINT correction_requests_branch_type_key_unique
    UNIQUE (merchant_branch_id, request_type, key_hash),
  CONSTRAINT correction_requests_reason_code_check CHECK (
    btrim(reason_code) <> '' AND char_length(reason_code) <= 64
  ),
  CONSTRAINT correction_requests_reason_note_check CHECK (
    reason_note IS NULL OR char_length(reason_note) <= 500
  ),
  CONSTRAINT correction_requests_hash_check CHECK (
    char_length(key_hash) = 64 AND char_length(payload_hash) = 64
  ),
  CONSTRAINT correction_requests_result_check CHECK (
    (status = 'REQUESTED' AND executed_at IS NULL AND rejected_at IS NULL)
    OR (status = 'EXECUTED' AND executed_at IS NOT NULL AND rejected_at IS NULL)
    OR (status = 'REJECTED' AND executed_at IS NULL AND rejected_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX correction_requests_active_transaction_unique
  ON correction_requests (transaction_id)
  WHERE status = 'REQUESTED';
CREATE INDEX correction_requests_branch_created_idx
  ON correction_requests (merchant_branch_id, created_at);

CREATE TABLE correction_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_request_id uuid NOT NULL UNIQUE
    REFERENCES correction_requests(id) ON DELETE RESTRICT,
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  execution_key_hash text NOT NULL,
  payload_hash text NOT NULL,
  mcp_ledger_entry_id uuid NOT NULL UNIQUE
    REFERENCES mcp_ledger_entries(id) ON DELETE RESTRICT,
  wallet_ledger_entry_id uuid REFERENCES member_wallet_entries(id) ON DELETE RESTRICT,
  reward_source_id uuid NOT NULL REFERENCES reward_sources(id) ON DELETE RESTRICT,
  reward_plan_id uuid NOT NULL REFERENCES reward_plans(id) ON DELETE RESTRICT,
  response jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT correction_executions_hash_check CHECK (
    char_length(execution_key_hash) = 64 AND char_length(payload_hash) = 64
  )
);

CREATE UNIQUE INDEX correction_executions_wallet_ledger_unique
  ON correction_executions (wallet_ledger_entry_id)
  WHERE wallet_ledger_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_transaction_correction_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_jsonb(NEW) - 'status' IS DISTINCT FROM to_jsonb(OLD) - 'status' THEN
    RAISE EXCEPTION 'Confirmed transaction financial snapshot is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD.status = 'CONFIRMED' AND NEW.status IN ('REVERSAL_REQUESTED', 'REFUND_REQUESTED'))
    OR (OLD.status = 'REVERSAL_REQUESTED' AND NEW.status IN ('REVERSED', 'REJECTED'))
    OR (OLD.status = 'REFUND_REQUESTED' AND NEW.status IN ('REFUNDED', 'REJECTED'))
  ) THEN
    RAISE EXCEPTION 'Invalid transaction correction state transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_correction_update_guard
BEFORE UPDATE ON transactions
FOR EACH ROW EXECUTE FUNCTION enforce_transaction_correction_update();

CREATE TRIGGER transactions_immutable_delete
BEFORE DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION reject_financial_record_mutation();

CREATE OR REPLACE FUNCTION enforce_correction_request_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_jsonb(NEW) - ARRAY['status', 'executed_at', 'rejected_at', 'updated_at']
     IS DISTINCT FROM
     to_jsonb(OLD) - ARRAY['status', 'executed_at', 'rejected_at', 'updated_at'] THEN
    RAISE EXCEPTION 'Correction request identity and payload are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status <> 'REQUESTED'
     OR NEW.status NOT IN ('EXECUTED', 'REJECTED') THEN
    RAISE EXCEPTION 'Invalid correction request state transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER correction_requests_update_guard
BEFORE UPDATE ON correction_requests
FOR EACH ROW EXECUTE FUNCTION enforce_correction_request_update();
CREATE TRIGGER correction_requests_delete_guard
BEFORE DELETE ON correction_requests
FOR EACH ROW EXECUTE FUNCTION reject_financial_record_mutation();
CREATE TRIGGER correction_executions_immutable
BEFORE UPDATE OR DELETE ON correction_executions
FOR EACH ROW EXECUTE FUNCTION reject_financial_record_mutation();
