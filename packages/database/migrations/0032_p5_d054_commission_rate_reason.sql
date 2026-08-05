-- 0032: P5 D-054 Commission Rate Owner (secured command, CG-04 gate)
--
-- Forward-only. Single migration owner (D-054). 0031 and earlier remain
-- byte-identical; checksums.json and expected-schema.ts are updated in the
-- same commit.
--
-- Three changes, all scoped to the Phase 5 commission rate owner:
--
-- 1. REPLACE the frozen gist exclusion (uq_rate_period).
--    DOCUMENTED DEVIATION (see delivery report §5.1): the frozen
--    EXCLUDE USING gist over tstzrange(effective_from,
--    COALESCE(effective_until, 'infinity'), '[)') rejects ANY second
--    version for the same (commission_type, generation, market) once the
--    first version is open-ended (effective_until IS NULL) — every
--    open-ended pair overlaps. All Phase 5 seed rows (P5-R1 migration
--    0029: AGENT_ACTIVATION_FEE MY, MERCHANT_RECRUITMENT MY) and the
--    canonical baseline rates are open-ended, so a prospective successor
--    rate ("changing an active rate must create a legal future
--    successor", P5-S0 §10.2/§10.3; D-054 §9 "legal non-overlapping
--    successors with half-open [effectiveFrom, effectiveUntil)
--    semantics") is structurally impossible while the constraint exists,
--    because the immutable append-only rows cannot be retro-fitted with
--    an end boundary (UPDATE is forbidden by §9 and by the new
--    reject_update trigger added below).
--    The D-050/D-053-accepted owner model (strictly increasing
--    effective_from per commission type + generation + market, derived
--    half-open windows [start, next_start), resolver = latest start <=
--    now) is therefore adopted; the overlap/chain rule is enforced inside
--    the owner's transaction-scoped advisory lock, and immutability is
--    preserved by the reject_update/reject_delete triggers added below.
--    No historical row is changed.
--
-- 2. commission_rate_version.reason — durable mandatory operator reason
--    on every version row written by the secured owner command (legacy
--    rows keep NULL; the CHECK allows NULL for legacy rows and enforces
--    1..500 characters for every new row).
--
-- 3. Append-only hard guarantee for commission_rate_version: the frozen
--    Phase 5 DDL (migration 0018) only installed reject_update/reject_delete
--    triggers on referral_relationship, agent_activation_status_log and
--    commission_ledger — the rate-version table itself had none. The new
--    triggers close that gap so "no UPDATE/DELETE of rate versions"
--    (P5-S0 §10.2 immutability) is a database-enforced invariant, not
--    merely a service convention.

-- ─── 1. Replace the degenerate gist exclusion ───────────────────────────

ALTER TABLE commission_rate_version
  DROP CONSTRAINT IF EXISTS uq_rate_period;

-- ─── 2. Durable reason on the version row (D-054 §11) ───────────────────

ALTER TABLE commission_rate_version
  ADD COLUMN reason text;

ALTER TABLE commission_rate_version
  ADD CONSTRAINT chk_commission_rate_reason CHECK (
    reason IS NULL OR (char_length(btrim(reason)) BETWEEN 1 AND 500)
  );

-- ─── 3. Append-only triggers (P5-S0 §10.2 immutability, D-054 §9) ────────

CREATE TRIGGER commission_rate_version_reject_update
  BEFORE UPDATE ON commission_rate_version
  FOR EACH ROW EXECUTE FUNCTION reject_update();
CREATE TRIGGER commission_rate_version_reject_delete
  BEFORE DELETE ON commission_rate_version
  FOR EACH ROW EXECUTE FUNCTION reject_delete();
