-- 0030: P3 D-050 Reward Rule Version Reason (frozen-owner remediation, CG-02)
--
-- Forward-only. D-052/D-050 scope item 13 (durable reason storage): the
-- secured Phase 3 reward-rule owner command persists the operator's
-- mandatory reason on the version row itself, so the reason survives with
-- the immutable version forever and is never derived from a separate
-- record.
--
-- Legacy rows created before this migration keep NULL (no backfill of
-- fabricated reasons). The CHECK allows NULL for legacy rows and enforces
-- the 1..500 character reason contract for every new row written by the
-- secured owner command (blank/overlength rejected before write).
--
-- Migration ownership: single owner (D-052). 0029 and earlier remain
-- byte-identical; checksums.json and expected-schema.ts are updated in the
-- same commit.

ALTER TABLE reward_rule_versions
  ADD COLUMN reason text;

ALTER TABLE reward_rule_versions
  ADD CONSTRAINT chk_reward_rule_versions_reason CHECK (
    reason IS NULL OR (char_length(btrim(reason)) BETWEEN 1 AND 500)
  );
