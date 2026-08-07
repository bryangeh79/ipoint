# P5-R1 — Phase 5 Agent/Commission Owner Remediation (Fix Record)

> **Task ID:** P5-R1-GATE-P5-01-AGENT-COMMISSION-OWNER
> **Executor class:** OPENCLAW_MANAGED_CODING_SUBAGENT (D-048 alternate executor; D-047 exact scope)
> **Branch:** `fix/p5-r1-agent-commission-owner` (isolated worktree `.local/wt-p5-r1`)
> **Starting SHA:** `06f00964a8f640da397064377a4731d3b01cb80e`
> **Status:** Implemented, tested, committed locally. **NOT pushed.** Independent review pending.

---

## 1. Purpose

Prepare the frozen Phase 5 owner package so P7-S6 (commission/agent-fee
configuration) and P7-S8 (agent operations) can safely consume it, per the
P7-S1 implementation breakdown §5 placement (a) and the P7-S0 frozen
Admin Operations Contract §6.3 (GATE-P5-01). The frozen B/C/D integration
specs are untouched and stay green (B 15/15, C 10/10, D 10/10).

## 2. Canonical wiring decision (4.1)

- **One wired service:** `apps/api/src/domain/agent-activation/service.ts`
  (Nest-injected, Drizzle) is the canonical agent-activation service. The
  repository-based `apps/api/src/domain/agent-activation/agent-activation.service.ts`
  is a **non-wired duplicate** (no Nest provider, no routes; referenced only
  by its own unit spec and the barrel). It is NOT deleted: deleting it would
  orphan its unit spec, and test deletion is prohibited. It is documented as
  dead code; the canonical path is unambiguous for P7 consumers.
- **Doubled mounts retired:** all Phase 5 controllers previously mounted at
  `/api/v1/api/v1/...` because `app.setup.ts` sets the global prefix `api/v1`
  and the controllers repeated it. All controller paths were corrected to the
  single canonical prefix (mirroring the accepted Phase 1/2 admin pattern):

  | Controller                         | Old mount                                     | New mount                              |
  | ---------------------------------- | --------------------------------------------- | -------------------------------------- |
  | AdminAgentActivationController     | `/api/v1/api/v1/admin/agent-activations`      | `/api/v1/admin/agent-activations`      |
  | AdminCommissionController          | `/api/v1/api/v1/admin/commission`             | `/api/v1/admin/commission`             |
  | AdminAdjustmentController          | `/api/v1/api/v1/admin/commission-adjustments` | `/api/v1/admin/commission-adjustments` |
  | AdminRateController                | `/api/v1/api/v1/admin/commission-rates`       | `/api/v1/admin/commission-rates`       |
  | AgentActivationController (member) | `/api/v1/api/v1/agent`                        | `/api/v1/agent`                        |
  | AgentCommissionController          | `/api/v1/api/v1/commission`                   | `/api/v1/commission`                   |
  | ReferralController                 | `/api/v1/api/v1/referral`                     | `/api/v1/referral`                     |

- **Dead prototype removed:** `apps/api/src/controllers/commission.controller.ts`
  (unguarded `calculate` dispatcher + fake `ledger` placeholder duplicating
  `AgentCommissionController` and the reprocess surface) was deleted and
  unregistered from `CommissionModule`.

## 3. Permission / market / actor enforcement (4.2)

- All admin routes keep `@UseGuards(AuthGuard, RbacGuard)` +
  `@RequirePermission(...)` with canonical catalog permissions whose
  definitions are `marketScoped: true` (`agent.activation.manage`,
  `commission.read`, `commission.rate.read/manage`). The RbacGuard resolves
  the server-owned Current Admin Market and verifies the active grant on
  every request (deny-by-default).
- **Resource-market equality:** every admin agent-activation transition
  re-validates that the activation's market equals the server-selected market
  code (new `AGENT_ACTIVATION_MARKET_MISMATCH`); the controller derives the
  code exclusively from `request.adminMarketContext.marketId` (never client
  input).
- **Selected-market reads:** `CommissionQueryService.adminSearch` and
  `getAuditLog` now require the server-derived selected market; a client
  `market` filter that disagrees is rejected (`COMMISSION_MARKET_CONTEXT_MISMATCH`).
- **Rate editor market consistency:** `AdminRateController` rejects any
  `market` (query or body) that differs from the selected market
  (`MARKET_CONTEXT_MISMATCH`).
- **Reprocess gate fixed:** the reprocess command (a write) previously used
  `commission.read` (a read permission). It now requires
  `commission.rate.manage` (Super Admin only, market-scoped) and verifies the
  source event (activation/transaction) belongs to the selected market.
- **Actor attribution:** admin transitions now pass the executing admin ID
  into the service and record it (`changed_by`, `changed_by_type='ADMIN'`,
  and `revoked_by` on deactivation). Previously reject/suspend/reactivate/
  deactivate logged `changed_by = NULL` and reactivate logged `SYSTEM`.
- **Ownership (member side):** `confirmPayment`, `enrollCourse`,
  `completeCourse`, `submitApproval`, and `getStatusById` now require the
  authenticated member to own the activation (new
  `AGENT_ACTIVATION_OWNERSHIP_MISMATCH`). Previously any member could mutate
  or read any activation by ID.
- The adjustment maker/checker routes (`AdminAdjustmentController`) remain
  wired at canonical paths; their permission codes
  (`commission.adjustment.maker/checker`) are not in the canonical catalog,
  so RbacGuard denies them by default (safe, no surface enabled). Catalog
  changes are outside the P5-R1 allowed paths and are left for the P7-S6
  consumption step.

## 4. Fee versioning / snapshot (4.3)

- New additive forward migration
  `packages/database/migrations/0029_p5_r1_agent_fee_version_snapshot.sql`:
  1. relaxes `chk_commission_type` to admit `AGENT_ACTIVATION_FEE`
     (configuration only; never posted to `commission_ledger` — the frozen
     three-source ledger contract D-042-A is unchanged);
  2. seeds the **MY RM388.00 MYR** fee version
     (`AGENT_ACTIVATION_FEE`, generation 0, `FIXED`,
     `388.0000000000`, effective 2026-07-25, system seed actor);
  3. seeds the canonical **MY merchant-recruitment generation-0** rate
     (0.005, the generation the service resolves; see §5);
  4. adds `agent_activation.fee_rate_version_id` (FK RESTRICT),
     `activation_fee numeric(38,10)`, `activation_fee_currency varchar(3)`
     with `chk_agent_fee_pair` and `chk_agent_fee_currency`.
- `AgentActivationService.apply` resolves the effective fee version at APPLY
  time and snapshots it. The fee currency comes from the **market registry**
  (`markets.currency_code`), never a hard-coded map. A market can activate
  only when BOTH the registry entry and an effective fee version exist;
  otherwise `AGENT_ACTIVATION_FEE_NOT_CONFIGURED` (other markets stay
  blocked).
- Historical activations are never repriced: the snapshot columns are set at
  APPLY and never re-resolved; `approveAndActivate` does not touch them.
  Verified by test (schedule a future RM500 version → original snapshot
  unchanged).
- `RateManagementService` now supports creating/scheduling
  `AGENT_ACTIVATION_FEE` versions (FIXED, generation 0) for the P7-S6 fee
  editor, with the existing overlap/immutability/prospective guarantees.
- `AgentUpgradeCommissionService` uses the activation's snapshot currency
  (`activation.currency`) instead of a hard-coded `{MY:'MYR'}` fallback map.

## 5. Source / generation / range reconciliation (4.4)

Verified against the frozen P5-S0 contract and D-042-A:

- **Source:** member-consumption and merchant-recruitment commissions are
  derived from the recognized (company-received) service fee snapshot in
  `transaction_service_fees` at CONFIRMED time — correct; no change.
- **Generation mapping:** the P5-S0 contract fixes generation `1`/`2` for
  G1/G2 and `0` for single-generation types. Two discrepancies were fixed:
  1. `RateManagementService.COMMISSION_GENERATIONS` allowed only generation 0
     for `MEMBER_CONSUMPTION` while the seed and the member-consumption
     service use generations 1/2 — the editor could never configure the
     frozen 1%/0.5% rates. Now `MEMBER_CONSUMPTION: [1, 2]`,
     `MERCHANT_RECRUITMENT: [0]`, `AGENT_UPGRADE: [1, 2]`,
     `AGENT_ACTIVATION_FEE: [0]`.
  2. The legacy seed file inserts `MERCHANT_RECRUITMENT` at generation 1,
     which the merchant-recruitment service (generation 0) never reads, so a
     freshly seeded DB had no working merchant-recruitment rate. Migration
     0029 seeds the canonical generation-0 MY rate. The seed file is outside
     the P5-R1 allowed paths and is not modified; its generation-1 row is an
     inert artifact (never matched, and the rate service now rejects
     creating generation-1 merchant-recruitment rows).
- **Range/window:** rate lookups use
  `effective_from <= t AND (effective_until IS NULL OR effective_until > t)`
  ordered by `effective_from LIMIT 1` with DB-level EXCLUDE overlap
  protection — correct; unchanged.

## 6. Atomic / durable posting failure surfacing (4.5)

- Removed the swallowed `.catch(() => {})` around the agent-upgrade
  commission posting in `AdminAgentActivationController.approve`. The
  activation transition commits atomically (ACTIVE + audit); the posting is
  idempotent via `canonical_processing_key` and atomic per source event
  (a mid-post failure rolls the whole posting back — B-14 machinery). If the
  posting fails, the endpoint now returns an explicit
  `503 COMMISSION_POSTING_FAILED` with the activation id and retry
  guidance — never a false success, never a partial posting. (503 aligns with
  the P7-S1 error register `COMMISSION_POSTING_FAILED` row: downstream
  posting prerequisite unavailable; `ServiceUnavailableException`.)
- Retry path: the canonical reprocess command (now Super-Admin-gated and
  market-checked, §3) replays the same source reference idempotently.
- Verified by test: ACTIVE commit + surfaced failure + no partial ledger rows
  - successful idempotent retry after rate configuration.

## 7. Boundary (4.7)

No new agent-activation write surface was added. The owner's existing
accepted admin commands (`approve`, `reject`, `suspend`, `reactivate`,
`deactivate`) remain the canonical commands, now with market/actor/atomicity
enforcement. Agent lifecycle writes remain unavailable to P7 until this
remediation is accepted (the P7-S8 adapter layer is not part of this work).

## 8. Clean database & regression evidence

- **Test DB:** `ipoint_p5r1_test` on the local PostgreSQL
  (`172.23.0.3:5432`, user `ipoint`). Reset command:
  `DROP DATABASE IF EXISTS ipoint_p5r1_test; CREATE DATABASE ipoint_p5r1_test;`
  then `pnpm --filter @ipoint/database db:migrate` and `db:seed`
  (migrations 0000–0029 applied; checksums regenerated to 30 entries; drift
  check clean).
- **Frozen Phase 5 regression (unchanged specs):** B **15/15**, C **10/10**,
  D **10/10** — 35/35 on the clean DB (and in a combined run with the new
  owner suite: 48/48).
- **New owner suite:** `apps/api/src/__tests__/p5-r1-owner-remediation.integration.spec.ts`
  — **13/13** (route surface 4.1, fee versioning 4.3, ownership/market/actor
  4.2, generation mapping 4.4, posting failure surface + durable retry 4.5).
- **Commission/agent/referral unit suites:** 188/188
  (`commission.service.spec`, `compensation.service.spec`,
  `concurrency.spec`, `agent-activation.service.spec`,
  `referral.service.spec`, `commission.module.spec`).
- **Phase 3 Wallet/reward regression:** 79 passed / 4 skipped
  (`wallet.service.spec`, `wallet.http.integration.spec`,
  `reward.service.spec`, `admin-reward.service.spec`,
  `transaction-reward` suites).
- **Database tests:** 60/62; the 2 failures
  (`schema.unit.test.ts` "keeps migrations explicit SQL and in the checksum
  set"; `phase3-schema.test.ts` "should allow Phase 5 migrations to be
  appended") are **pre-existing** at the starting SHA — both freeze the
  migration list at 0019 while Phase 6/7 added 0020–0028 (git history:
  list last touched at `b8532d8b`, migration 0020 added by Phase 6 at
  `fd19cd95`). They fail identically on a base-SHA worktree and are outside
  the P5-R1 allowed paths; they are reported, not hidden.
- **Full API suite note:** running all 85 API suites in parallel against one
  shared DB yields 40 failures; 39 are reproducible on a base-SHA worktree
  (auth/merchant/admin-member/admin-kyc HTTP + integration suites —
  environment/isolation issues, unrelated to P5-R1) and 1 was a random
  market-code collision in the new suite (now collision-safe and green).
  CI runs each suite family on its own job/DB.
- **Quality:** `typecheck` (api + database) ✅, `build` (api) ✅, ESLint on
  all changed files ✅, Prettier ✅, migration checksums ✅, schema drift ✅.

## 9. Migration justification

`0029_p5_r1_agent_fee_version_snapshot.sql` is genuinely required: the
frozen Phase 5 baseline has no versioned activation-fee configuration and no
fee snapshot columns, and the P7-S0 contract §6.3 mandates RM388.00 MYR
future-effective/versioned fees with per-activation snapshots. It is
additive and forward-only; no existing migration was rewritten
(checksums for 0000–0028 unchanged).

## 10. Known risks / notes

- The legacy seed file still writes a dead `MERCHANT_RECRUITMENT` generation-1
  row on reseed (inert; documented). A future owner may update
  `packages/database/seeds/agent-commission.ts` to generation 0.
- `AdminAdjustmentController` maker/checker routes remain deny-by-default
  (permission codes not in the canonical catalog). P7-S6/P7-S7 should decide
  whether to add canonical codes (requires a separate permission-catalog
  change outside this remediation's allowed paths).
- The non-wired duplicate agent-activation service remains as dead code with
  its spec; recommended for removal under a future owner cleanup (would
  require deleting its spec, hence outside this task's "no test deletion"
  rule).
- Cross-suite parallel runs on a single shared DB can collide on random
  fixture market codes; the new suite retries on overlap conflicts and stops
  the shared outbox worker (mirroring B/C/D isolation).

## 11. Git evidence

- Commits (local only, NO push): see `git log --oneline fix/p5-r1-agent-commission-owner`.
- Changed files (exact-path staged, grouped by concern).
- B/C/D specs: **not modified** (`git diff 06f00964..HEAD -- apps/api/src/__tests__/b-transaction-commission.integration.spec.ts apps/api/src/__tests__/c-merchant-attribution.integration.spec.ts apps/api/src/__tests__/d-correction-compensation.integration.spec.ts` is empty).
