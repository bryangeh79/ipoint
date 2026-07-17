ALTER TABLE mcp_refund_requests
  ADD COLUMN payload_hash text NOT NULL DEFAULT repeat('0', 64);
ALTER TABLE mcp_refund_requests ALTER COLUMN payload_hash DROP DEFAULT;
ALTER TABLE mcp_refund_requests ADD CONSTRAINT mcp_refund_payload_hash_check
  CHECK (length(payload_hash) = 64);

ALTER TABLE mcp_adjustment_requests
  ADD COLUMN payload_hash text NOT NULL DEFAULT repeat('0', 64);
ALTER TABLE mcp_adjustment_requests ALTER COLUMN payload_hash DROP DEFAULT;
ALTER TABLE mcp_adjustment_requests ADD CONSTRAINT mcp_adjustment_payload_hash_check
  CHECK (length(payload_hash) = 64);

CREATE FUNCTION protect_mcp_governance_request_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mcp_account_id IS DISTINCT FROM OLD.mcp_account_id OR
     NEW.market_id IS DISTINCT FROM OLD.market_id OR
     NEW.amount IS DISTINCT FROM OLD.amount OR
     NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
     NEW.payload_hash IS DISTINCT FROM OLD.payload_hash THEN
    RAISE EXCEPTION 'MCP governance request financial identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mcp_refund_request_identity_guard
BEFORE UPDATE ON mcp_refund_requests
FOR EACH ROW EXECUTE FUNCTION protect_mcp_governance_request_identity();

CREATE TRIGGER mcp_adjustment_request_identity_guard
BEFORE UPDATE ON mcp_adjustment_requests
FOR EACH ROW EXECUTE FUNCTION protect_mcp_governance_request_identity();

CREATE FUNCTION enforce_mcp_adjustment_maker_checker() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM mcp_adjustment_requests
    WHERE id = NEW.adjustment_request_id
      AND maker_admin_user_id = NEW.checker_admin_user_id
  ) THEN
    RAISE EXCEPTION 'MCP maker cannot check their own adjustment request'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mcp_adjustment_maker_checker_guard
BEFORE INSERT ON mcp_adjustment_decisions
FOR EACH ROW EXECUTE FUNCTION enforce_mcp_adjustment_maker_checker();
