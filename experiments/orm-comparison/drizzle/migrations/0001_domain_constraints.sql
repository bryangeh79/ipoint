ALTER TABLE adjustment_requests
  ADD CONSTRAINT adjustment_requests_executed_entry_id_fkey
    FOREIGN KEY (executed_entry_id) REFERENCES ledger_entries(id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

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
