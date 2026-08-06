-- 0033: P1 D-051 Special Percentage Mandatory Reason (frozen-owner remediation)
--
-- Forward-only. Single migration owner (D-051). 0032 and earlier remain
-- byte-identical; checksums.json and expected-schema.ts are updated in the
-- same commit.
--
-- Scope (D-051 command §3 "durable reason storage"): the secured Phase 1
-- special-percentage owner command persists the operator's mandatory
-- reason on the row itself, so the reason survives with the immutable
-- special percentage forever (special_percentages is append-only per the
-- frozen `protect_service_fee_reference_data` trigger, migration 0004)
-- and is never derived from a separate record.
--
-- Legacy rows created before this migration keep NULL (no backfill of
-- fabricated reasons — D-051 §3). The CHECK allows NULL for legacy rows
-- and enforces the 1..500 character reason contract for every new row
-- written by the secured owner command (blank/overlength rejected before
-- write by the owner DTO and the owner service; the CHECK is the final
-- hard database guarantee).

ALTER TABLE special_percentages
  ADD COLUMN reason text;

ALTER TABLE special_percentages
  ADD CONSTRAINT chk_special_percentages_reason CHECK (
    reason IS NULL OR (char_length(btrim(reason)) BETWEEN 1 AND 500)
  );
