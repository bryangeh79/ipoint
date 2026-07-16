ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_amount_positive_check CHECK (amount > 0),
  ADD CONSTRAINT ledger_entries_reversal_not_self_check
    CHECK (reversal_of_entry_id IS NULL OR reversal_of_entry_id <> id);

ALTER TABLE adjustment_requests
  ADD CONSTRAINT adjustment_requests_amount_positive_check CHECK (amount > 0),
  ADD CONSTRAINT adjustment_requests_maker_checker_check
    CHECK (checker_id IS NULL OR maker_id <> checker_id);

ALTER TABLE versioned_rules
  ADD CONSTRAINT versioned_rules_version_positive_check CHECK (version > 0),
  ADD CONSTRAINT versioned_rules_effective_range_check
    CHECK (effective_to IS NULL OR effective_to > effective_from);

CREATE OR REPLACE FUNCTION reject_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only; insert a compensating entry'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER ledger_entries_append_only
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
