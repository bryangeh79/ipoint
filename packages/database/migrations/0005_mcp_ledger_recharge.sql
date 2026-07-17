CREATE TYPE mcp_account_status AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');

ALTER TABLE mcp_accounts
  ALTER COLUMN available_balance TYPE numeric(38,10),
  ALTER COLUMN total_balance TYPE numeric(38,10),
  ADD COLUMN status mcp_account_status NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE mcp_ledger_entries
  ALTER COLUMN amount TYPE numeric(38,10),
  ALTER COLUMN balance_delta TYPE numeric(38,10),
  ALTER COLUMN available_delta TYPE numeric(38,10),
  ADD COLUMN reason text NOT NULL DEFAULT 'Legacy migration entry';
ALTER TABLE mcp_ledger_entries ALTER COLUMN reason DROP DEFAULT;
ALTER TABLE mcp_ledger_entries
  ADD CONSTRAINT mcp_ledger_reason_check CHECK (length(trim(reason)) > 0),
  ADD CONSTRAINT mcp_ledger_payload_hash_check CHECK (length(payload_hash) = 64);

ALTER TABLE mcp_recharge_requests
  ALTER COLUMN amount TYPE numeric(38,10),
  ADD COLUMN payload_hash text NOT NULL DEFAULT repeat('0', 64),
  ADD COLUMN review_payload_hash text;
ALTER TABLE mcp_recharge_requests ALTER COLUMN payload_hash DROP DEFAULT;
ALTER TABLE mcp_recharge_requests
  ADD CONSTRAINT mcp_recharge_payload_hash_check CHECK (length(payload_hash) = 64),
  ADD CONSTRAINT mcp_recharge_review_payload_hash_check
    CHECK (review_payload_hash IS NULL OR length(review_payload_hash) = 64);

ALTER TABLE mcp_refund_requests ALTER COLUMN amount TYPE numeric(38,10);
ALTER TABLE mcp_adjustment_requests ALTER COLUMN amount TYPE numeric(38,10);

CREATE FUNCTION protect_mcp_account_projection() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (
    NEW.available_balance IS DISTINCT FROM OLD.available_balance OR
    NEW.total_balance IS DISTINCT FROM OLD.total_balance
  ) AND current_setting('ipoint.mcp_posting', true) IS DISTINCT FROM 'enabled' THEN
    RAISE EXCEPTION 'MCP balances may only change through append_mcp_ledger_entry'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mcp_accounts_projection_guard
BEFORE UPDATE ON mcp_accounts
FOR EACH ROW EXECUTE FUNCTION protect_mcp_account_projection();

CREATE FUNCTION protect_mcp_ledger_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('ipoint.mcp_posting', true) IS DISTINCT FROM 'enabled' THEN
    RAISE EXCEPTION 'MCP ledger entries may only be created through append_mcp_ledger_entry'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mcp_ledger_insert_guard
BEFORE INSERT ON mcp_ledger_entries
FOR EACH ROW EXECUTE FUNCTION protect_mcp_ledger_insert();

CREATE FUNCTION append_mcp_ledger_entry(
  target_account_id uuid,
  target_entry_type mcp_entry_type,
  target_direction mcp_direction,
  target_amount numeric(38,10),
  target_balance_delta numeric(38,10),
  target_available_delta numeric(38,10),
  target_source_type text,
  target_source_id text,
  target_idempotency_key text,
  target_payload_hash text,
  target_actor_type text,
  target_actor_id text,
  target_reason text,
  target_effective_at timestamptz,
  target_reversal_of_id uuid DEFAULT NULL,
  target_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE (
  entry_id uuid,
  account_sequence bigint,
  projected_total_balance numeric(38,10),
  projected_available_balance numeric(38,10),
  replayed boolean
)
LANGUAGE plpgsql AS $$
DECLARE
  account_row mcp_accounts%ROWTYPE;
  existing_entry mcp_ledger_entries%ROWTYPE;
  next_sequence bigint;
  next_total numeric(38,10);
  next_available numeric(38,10);
  inserted_id uuid;
BEGIN
  IF target_amount <= 0 OR length(trim(target_idempotency_key)) = 0 OR
     length(target_payload_hash) <> 64 OR length(trim(target_reason)) = 0 THEN
    RAISE EXCEPTION 'Invalid MCP ledger posting input' USING ERRCODE = '22023';
  END IF;
  IF target_direction = 'CREDIT' AND
     (target_balance_delta < 0 OR target_available_delta < 0) THEN
    RAISE EXCEPTION 'Credit posting cannot use negative deltas' USING ERRCODE = '22023';
  END IF;
  IF target_direction = 'DEBIT' AND
     (target_balance_delta > 0 OR target_available_delta > 0) THEN
    RAISE EXCEPTION 'Debit posting cannot use positive deltas' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO account_row FROM mcp_accounts
  WHERE id = target_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MCP account not found' USING ERRCODE = 'P0002';
  END IF;
  IF account_row.status = 'CLOSED' THEN
    RAISE EXCEPTION 'MCP account is closed' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO existing_entry FROM mcp_ledger_entries
  WHERE mcp_account_id = target_account_id
    AND idempotency_key = target_idempotency_key;
  IF FOUND THEN
    IF existing_entry.payload_hash <> target_payload_hash THEN
      RAISE EXCEPTION 'MCP_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT existing_entry.id, existing_entry.sequence,
      account_row.total_balance, account_row.available_balance, true;
    RETURN;
  END IF;

  next_total := account_row.total_balance + target_balance_delta;
  next_available := account_row.available_balance + target_available_delta;
  IF next_total < 0 OR next_available < 0 OR next_available > next_total THEN
    RAISE EXCEPTION 'MCP_NEGATIVE_OR_INVALID_AVAILABLE_BALANCE'
      USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(max(sequence), 0) + 1 INTO next_sequence
  FROM mcp_ledger_entries WHERE mcp_account_id = target_account_id;

  PERFORM set_config('ipoint.mcp_posting', 'enabled', true);
  UPDATE mcp_accounts
  SET total_balance = next_total,
      available_balance = next_available,
      version = version + 1,
      updated_at = now()
  WHERE id = target_account_id;

  INSERT INTO mcp_ledger_entries (
    mcp_account_id, sequence, entry_type, direction, amount, balance_delta,
    available_delta, source_type, source_id, idempotency_key, payload_hash,
    actor_type, actor_id, reason, reversal_of_entry_id, metadata, effective_at
  ) VALUES (
    target_account_id, next_sequence, target_entry_type, target_direction,
    target_amount, target_balance_delta, target_available_delta,
    target_source_type, target_source_id, target_idempotency_key,
    target_payload_hash, target_actor_type, target_actor_id, target_reason,
    target_reversal_of_id, target_metadata, target_effective_at
  ) RETURNING id INTO inserted_id;
  PERFORM set_config('ipoint.mcp_posting', 'disabled', true);

  RETURN QUERY SELECT inserted_id, next_sequence, next_total, next_available, false;
END;
$$;
