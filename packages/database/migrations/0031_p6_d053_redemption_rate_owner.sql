-- 0031: P6 D-053 Redemption Rate Owner (secured command, CG-03 gate)
--
-- Forward-only. Single migration owner (D-053). 0030 and earlier remain
-- byte-identical; checksums.json and expected-schema.ts are updated in the
-- same commit.
--
-- Four changes, all scoped to the Phase 6 redemption rate owner:
--
-- 1. REPLACE the frozen gist exclusion (uq_redemption_rate_period).
--    DOCUMENTED DEVIATION (see delivery report §5.1): the frozen
--    EXCLUDE USING gist over tstzrange(effective_from,
--    COALESCE(effective_until, 'infinity'), '[)') rejects ANY second
--    version for the same (market, rate_type) once the first version is
--    open-ended (effective_until IS NULL) — every open-ended pair
--    overlaps. That makes the D-053 contract's successor requirement
--    ("changing an active rate must create a legal future successor",
--    §9) and "legal future successor versions allowed (a successor may
--    start exactly when its predecessor ends)" (§8) structurally
--    unsatisfiable, because the immutable append-only rows cannot be
--    retro-fitted with an end boundary (UPDATE is forbidden by the
--    reject_update trigger and by §8 "no UPDATE of historical rows").
--    The D-050-accepted reward-rule owner model (strictly increasing
--    effective_from per market scope, derived half-open windows
--    [start, next_start), resolver = latest start <= now) is therefore
--    adopted; the overlap/chain rule is enforced inside the owner's
--    transaction-scoped advisory lock, and immutability is preserved by
--    the frozen reject_update/reject_delete triggers (kept below).
--    Migration 0031 removes the gist exclusion so the approved successor
--    contract is implementable; no historical row is changed.
--
-- 2. redemption_rate_versions.reason — durable mandatory operator reason
--    on every version row written by the secured owner command (legacy
--    rows keep NULL; the CHECK allows NULL for legacy rows and enforces
--    1..500 characters for every new row).
--
-- 3. redemption_rate_market_rules — versioned per-market rate
--    configuration (CONFIGURABLE, market data, never hard-coded in
--    logic): the approved bounds/initial/currency/display-unit per
--    market code + rate type. Malaysia (code 'MY') is seeded from
--    packages/database/seeds/foundation.ts (idempotent upsert); every
--    other market must carry its own explicit rule — there is NO
--    cross-market fallback and an unconfigured market is explicitly
--    blocked by the owner (422 REDEMPTION_RATE_MARKET_BLOCKED /
--    configured:false on the read side).
--
-- 4. redemption_rate_cancellations — append-only immutable cancellation
--    events (§9). A cancellation NEVER updates or deletes a rate-version
--    row; it only records that a scheduled, not-yet-effective version is
--    void. The resolver ignores cancelled versions. UNIQUE
--    (rate_version_id) is the hard guarantee that a version is cancelled
--    at most once. reject_update/reject_delete triggers make the table
--    append-only.

-- ─── 1. Replace the degenerate gist exclusion ───────────────────────────

ALTER TABLE redemption_rate_versions
  DROP CONSTRAINT IF EXISTS uq_redemption_rate_period;

-- ─── 2. Durable reason on the version row (D-053 §11) ───────────────────

ALTER TABLE redemption_rate_versions
  ADD COLUMN reason text;

ALTER TABLE redemption_rate_versions
  ADD CONSTRAINT chk_redemption_rate_reason CHECK (
    reason IS NULL OR (char_length(btrim(reason)) BETWEEN 1 AND 500)
  );

-- ─── 3. Versioned per-market rate rules (D-053 §6) ───────────────────────

CREATE TABLE redemption_rate_market_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_code varchar(8) NOT NULL,
  rate_type redemption_rate_type NOT NULL DEFAULT 'POINTS_PER_CURRENCY',
  initial_rate numeric(38, 10) NOT NULL,
  minimum_rate numeric(38, 10) NOT NULL,
  maximum_rate numeric(38, 10) NOT NULL,
  currency varchar(3) NOT NULL,
  display_unit varchar(64) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_redemption_rate_market_rules UNIQUE (market_code, rate_type),
  CONSTRAINT chk_redemption_rate_market_rules_currency
    CHECK (char_length(currency) = 3),
  CONSTRAINT chk_redemption_rate_market_rules_bounds CHECK (
    minimum_rate > 0 AND maximum_rate > 0
    AND initial_rate >= minimum_rate AND initial_rate <= maximum_rate
  ),
  CONSTRAINT chk_redemption_rate_market_rules_display
    CHECK (char_length(btrim(display_unit)) > 0),
  CONSTRAINT chk_redemption_rate_market_rules_version CHECK (version > 0)
);

CREATE INDEX idx_redemption_rate_market_rules_active
  ON redemption_rate_market_rules (market_code)
  WHERE is_active = true;

-- ─── 4. Append-only cancellation events (D-053 §9) ───────────────────────

CREATE TABLE redemption_rate_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_version_id uuid NOT NULL
    REFERENCES redemption_rate_versions(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  cancelled_by uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  request_id varchar(128),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_redemption_rate_cancellations_version
    UNIQUE (rate_version_id),
  CONSTRAINT chk_redemption_rate_cancellations_reason CHECK (
    char_length(btrim(reason)) BETWEEN 1 AND 500
  )
);

CREATE INDEX idx_redemption_rate_cancellations_market
  ON redemption_rate_cancellations (market_id, created_at);

CREATE TRIGGER redemption_rate_cancellations_reject_update
  BEFORE UPDATE ON redemption_rate_cancellations
  FOR EACH ROW EXECUTE FUNCTION reject_update();
CREATE TRIGGER redemption_rate_cancellations_reject_delete
  BEFORE DELETE ON redemption_rate_cancellations
  FOR EACH ROW EXECUTE FUNCTION reject_delete();
