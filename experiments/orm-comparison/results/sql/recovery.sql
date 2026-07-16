-- Forward recovery recreates the removed nullable column and index.
-- Values present before the destructive migration cannot be reconstructed.
ALTER TABLE audit_events
  ADD COLUMN correlation_id varchar(96);

CREATE INDEX audit_events_correlation_id_idx
  ON audit_events (correlation_id)
  WHERE correlation_id IS NOT NULL;
