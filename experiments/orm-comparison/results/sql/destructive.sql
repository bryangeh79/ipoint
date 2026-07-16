DROP INDEX IF EXISTS audit_events_correlation_id_idx;
ALTER TABLE audit_events DROP COLUMN correlation_id;
