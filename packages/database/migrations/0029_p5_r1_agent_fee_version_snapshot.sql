-- 0029: P5-R1 Agent Activation Fee Versioning + Snapshot (GATE-P5-01)
--
-- Forward-only. Freeze-safe remediation of the Phase 5 owner (D-047 exact
-- scope: P5-R1-GATE-P5-01-AGENT-COMMISSION-OWNER).
--
-- Purpose:
--   1. Introduce a versioned, market/currency-scoped agent activation fee
--      configuration (Malaysia RM388.00 MYR per P7-S0 contract section 6.3).
--      The fee is configuration only: it is never posted to
--      commission_ledger and the frozen three-source ledger contract is
--      unchanged (D-042-A). It is modeled as commission_rate_version row with
--      commission_type = 'AGENT_ACTIVATION_FEE', generation = 0 (single-gen,
--      P5-S0 contract), rate_type = 'FIXED'.
--   2. Snapshot the fee version onto each activation record at APPLY time so
--      historical activations are never repriced when a later fee version is
--      scheduled.
--   3. Seed the canonical MY merchant-recruitment rate at generation 0.
--      Merchant recruitment is single-gen and resolves rates at generation 0
--      (P5-S0 contract); the legacy seed row at generation 1 is never read by
--      the merchant-recruitment service and is left untouched.
--
-- Other markets cannot activate until an explicit AGENT_ACTIVATION_FEE
-- version exists for them (activation service enforces this at APPLY time).

-- 1. Allow the versioned activation fee as a commission_rate_version row.
ALTER TABLE commission_rate_version
  DROP CONSTRAINT chk_commission_type;

ALTER TABLE commission_rate_version
  ADD CONSTRAINT chk_commission_type CHECK (
    commission_type IN (
      'AGENT_UPGRADE',
      'MEMBER_CONSUMPTION',
      'MERCHANT_RECRUITMENT',
      'AGENT_ACTIVATION_FEE'
    )
  );

-- 2. Seed the Malaysia activation fee RM388.00 MYR (future-effective).
INSERT INTO commission_rate_version (
  id, commission_type, generation, market, rate_value, rate_type,
  effective_from, created_by, created_at
)
SELECT
  gen_random_uuid(), 'AGENT_ACTIVATION_FEE', 0, 'MY', '388.0000000000', 'FIXED',
  '2026-07-25T00:00:00.000Z', '00000000-0000-0000-0000-000000000000', now()
WHERE NOT EXISTS (
  SELECT 1 FROM commission_rate_version
  WHERE commission_type = 'AGENT_ACTIVATION_FEE' AND generation = 0 AND market = 'MY'
);

-- 3. Seed the canonical MY merchant-recruitment rate at generation 0.
INSERT INTO commission_rate_version (
  id, commission_type, generation, market, rate_value, rate_type,
  effective_from, created_by, created_at
)
SELECT
  gen_random_uuid(), 'MERCHANT_RECRUITMENT', 0, 'MY', '0.0050000000', 'PERCENTAGE',
  '2026-07-25T00:00:00.000Z', '00000000-0000-0000-0000-000000000000', now()
WHERE NOT EXISTS (
  SELECT 1 FROM commission_rate_version
  WHERE commission_type = 'MERCHANT_RECRUITMENT' AND generation = 0 AND market = 'MY'
);

-- 4. Activation fee snapshot columns on agent_activation.
--    Set at APPLY time; historical activations keep their snapshot forever.
ALTER TABLE agent_activation
  ADD COLUMN fee_rate_version_id uuid REFERENCES commission_rate_version(id) ON DELETE RESTRICT,
  ADD COLUMN activation_fee numeric(38, 10),
  ADD COLUMN activation_fee_currency varchar(3) NOT NULL DEFAULT 'MYR';

ALTER TABLE agent_activation
  ADD CONSTRAINT chk_agent_fee_currency CHECK (activation_fee_currency = upper(activation_fee_currency)),
  ADD CONSTRAINT chk_agent_fee_pair CHECK (
    (fee_rate_version_id IS NULL AND activation_fee IS NULL)
    OR (fee_rate_version_id IS NOT NULL AND activation_fee IS NOT NULL)
  );
