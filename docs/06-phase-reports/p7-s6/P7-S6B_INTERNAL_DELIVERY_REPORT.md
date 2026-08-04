# P7-S6B Internal Delivery Report — Admin Reward Configuration

| Field           | Value                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------- |
| Status          | `P7-S6B_DELIVERY_COMPLETE` / pending OpenClaw integration review                                |
| Phase authority | `CONTINUING_UNDER_D-048` (§5 written handoff; reward configuration)                             |
| Executor class  | `OPENCLAW_MANAGED_CODING_SUBAGENT` (D-048; Codex CLI unavailable)                               |
| Worktree        | `C:\AI_WORKSPACE\iPoint App\.local\wt-p7-s6b-reward`                                            |
| Branch          | `task/p7-s6b-reward-config` (base `dfbf1c41`)                                                   |
| Scope           | P7-S6B: Admin Reward Configuration (frozen contract §7.1, decisions P7-OD-04 / P7-OD-05, D-046) |
| Pushed          | NO (OpenClaw integrates and pushes)                                                             |
| Date            | 2026-08-04                                                                                      |

## 1. Scope delivered

Phase 7 **read projection + orchestrated create** over the FROZEN Phase 3 reward owner. No frozen Phase 1/3/5/6 owner file was modified; the single `reward_rule_versions` insert is delegated to the frozen owner command `AdminRewardService.createRuleVersion` **unchanged** (verified: `git diff` over `apps/api/src/admin-reward/**`, `packages/database/**`, `apps/api/src/reward/**` and all other frozen owner dirs is EMPTY — only `app.module.ts` registration + the new `admin-reward-ops/**` change).

### 1.1 Phase 7 adapter — `apps/api/src/admin-reward-ops/` (new)

| Route                                                   | Permission (canonical catalog)                          | Read / Write | Notes                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/admin/reward-ops/markets/:marketId/rules`  | `reward.rule.read` (all admin roles, marketScoped)      | Read         | Selected-market reward schedule: every rule version with exact `%/day` decimal strings, §7.1 package references (A `0.0125`, B `0.025`, C/D/E/F `0.05`), projected effective windows `[effective_from, window_end)` in market-local time AND resolved UTC.                                                                                                                                                                        |
| `POST /api/v1/admin/reward-ops/markets/:marketId/rules` | `reward.rule.schedule` (SUPER_ADMIN only, marketScoped) | Write        | §7.1 validation (0%–0.05%/day, ≤6 decimals, package A–F maxima), strictly-future market-local 00:00 activation, no-overlap chain serialized with a session-level PostgreSQL advisory lock, exact idempotency (`Idempotency-Key` + canonical payload hash in the shared `merchant_api_idempotency_keys` mechanism table), mandatory reason + privileged audit. The insert delegates to the frozen Phase 3 owner command unchanged. |

The adapter never writes domain tables directly: its only writes are the idempotency mechanism rows and the canonical audit records; `reward_rule_versions` is written exclusively by the frozen owner command.

### 1.2 Admin Web — `/admin/:marketId/config/reward-rates`

- The `reward-rates` manifest entry already existed with the canonical `reward.rule.read` permission but carried a **stale placeholder capability gate** (`gate('reward.rule.schedule', 'CG-02')`) from the pre-S6B era; the shell's `ProtectedAdminRoute` renders a hard blocked state for any gated route, which would have made the new page unreachable. Since S6B implements the schedule capability (page + SUPER_ADMIN-only server-side gate), the stale gate was removed from the entry. The zero-drift assertions in `route-manifest.test.ts` (33 unique routes, canonical permissions, hard-gate discoverability for still-gated routes) stay green.
- New `reward-config-model.ts` (window-status labels, §7.1 rate grammar `^\d+(\.\d{1,6})?$`, governance ceiling 0.05%/day and per-package maxima via exact-decimal comparison, future market-local date validity, market-local-midnight → UTC resolution display helper, error copy, permission gates — UI affordance only), `reward-config-states.tsx` (loading/empty/error/permission-denied/offline/blocked), `reward-config-page.tsx`:
  - Schedule table with exact rate strings, window-status badges, market-local window AND resolved UTC columns; package maxima reference table.
  - Schedule action (SUPER_ADMIN only, `reward.rule.schedule` + online-desktop write environment): package select (A–F with live max hint), rate input (client validation mirrors the server grammar/range/maxima), future-date-only picker that shows the market-local wall time AND the resolved UTC preview, mandatory reason, auto-generated Idempotency-Key. Explicit blocked state for non-SUPER_ADMIN actors.
- All design-system states covered (loading/empty/error/success/denied/blocked/offline/retry); axe clean (jsdom).

### 1.3 Typed api-client (append-only)

`AdminRewardOpsApiClient` (`listRules` + `createRule`) with typed DTOs mirroring the adapter contract, `Idempotency-Key` header support, rates as exact decimal strings (never parsed). Append-only section after the S6A package-ops block; append-only tests in `index.test.ts` (+4).

## 2. STEP 1 review findings (verification of the inherited work)

1. **Frozen-owner drift: NONE.** `git diff` over `apps/api/src/admin-reward/**`, `apps/api/src/reward/**`, `packages/database/**`, and the other frozen Phase 1/3/5/6 owner dirs is empty; only `apps/api/src/app.module.ts` (module registration) + the new `admin-reward-ops/**` change.
2. **Delegation boundary verified.** The adapter's only table writes are `merchant_api_idempotency_keys` (mechanism) and the audit records; the single `reward_rule_versions` insert goes through `AdminRewardService.createRuleVersion` with the owner's own atomic audit — unchanged.
3. **Permission catalog: already complete, no changes needed.** `reward.rule.read` (SUPER_ADMIN, OPERATIONS_ADMIN, FINANCE_OPERATOR, FINANCE_APPROVER, SUPPORT_READONLY_AUDITOR — marketScoped) and `reward.rule.schedule` (SUPER_ADMIN only — marketScoped) already exist in the canonical `packages/database/src/permission-catalog.ts` (committed `e82c7b1f`, part of base `dfbf1c41`), matching the controller exactly. The manifest zero-drift tests stay green.
4. **Settlement-resolution verification (the projection must match frozen reality).** The frozen Phase 3 resolution is `RewardService.findEffectiveRuleVersion`: non-archived rows, `effective_from <= date`, window `[effective_from, effective_to)` when `effective_to` is set (else open), market-or-global (`market_id IS NULL` applies to every market), **latest `effective_from` wins** (`ORDER BY effective_from DESC LIMIT 1`). The daily accrual settlement binds plans at creation (`ruleVersionId` null → snapshot rate) and does not re-resolve versions at accrual time. The inherited projection was pure chain semantics (`[effective_from, next effective_from)`), which is exactly equivalent for adapter-created versions (always `effective_to = null`, strictly increasing `effective_from` per market) but mis-projected legacy owner rows with an explicit `effective_to`. **Adjusted** (adapter files only; the frozen settlement was NOT touched): the projected window end is now the earlier of the next version's start and the explicit `effective_to`, and a new `EXPIRED` status was added for closed windows that are already in the past — matching the frozen resolution. Two integration tests added proving: legacy closed windows resolve to `SUPERSEDED`/`EXPIRED` with the exact `effective_until` boundary, and archived versions show `ARCHIVED` and are excluded from the chain. Documented limitation: global fallback rows (`market_id IS NULL`) are intentionally not shown — the surface is per-selected-market and the adapter only creates market-scoped versions.
5. **DTO/errors/types review.** Rate grammar (`^\d+(\.\d{1,6})?$`), six-decimal precision, `YYYY-MM-DD` effective date, mandatory reason (1–500) all correct. Known minor: a syntactically-valid but non-calendar date (e.g. `2026-13-45`) passes the DTO regex and is rejected by the service as `REWARD_ACTIVATION_NOT_FUTURE` (rejected either way; slightly generic code — documented, not changed).

### 2.1 Owner-gap record

**None.** The frozen Phase 3 owner command already accepts the exact fields the §7.1 surface needs (`name`, `description?`, `effectiveFrom`, `rewardRate`, `capType`/`capValue`/`minimumReward`, `marketId`) and already records its own atomic audit (`reward.rule_version.create`). The adapter adds the reason-carrying privileged audit as a separate Phase 7 record (same pattern the package-ops adapter uses; §14 atomic-commit boundary respected — the Phase 7 audit is not inside the owner's transaction, matching the accepted S6A approach). No frozen-owner remediation is required for this surface.

## 3. Evidence (all executed in this worktree)

### 3.1 P7-S6B suites

| Suite                                                                                          | DB                                                                                                                                       | Result                           |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `admin-reward-ops.spec.ts` (unit)                                                              | —                                                                                                                                        | **16/16** ✅                     |
| `admin-reward-ops.integration.spec.ts` (HTTP, real PostgreSQL)                                 | `ipoint_gate_p6b` (fresh: `DROP DATABASE IF EXISTS ... WITH (FORCE)` + `CREATE DATABASE`; `migrate()` + `seedFoundation()` in beforeAll) | **20/20** ✅                     |
| **P7-S6B API total**                                                                           |                                                                                                                                          | **36/36** ✅                     |
| `@ipoint/api-client` `index.test.ts`                                                           | —                                                                                                                                        | **59/59** ✅ (+4)                |
| `@ipoint/admin-web` new suites (`reward-config-model.test.ts` + `reward-config-page.test.tsx`) | —                                                                                                                                        | **20/20** ✅ (11 model + 9 page) |
| `@ipoint/admin-web` full suite (regression)                                                    | —                                                                                                                                        | **185/185** ✅ (23 files)        |

Coverage includes: 401/403/409 RBAC + selected-market enforcement (`MARKET_CONTEXT_MISMATCH`, `MARKET_SELECTION_REQUIRED`, `MARKET_ACCESS_DENIED`); exact decimal strings end-to-end; package references A–F with maxima; market-local + resolved UTC on read AND create; §7.1 boundaries (0, 0.05, 0.000001 accepted; 0.050001 → `REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT`; 7 decimals → 400; A `0.0126`/B `0.0251` → `REWARD_RATE_EXCEEDS_PACKAGE_MAX`); same-day/backdated → `REWARD_ACTIVATION_NOT_FUTURE`; overlap chain 409 + later chain steps 201; **concurrent overlapping creates resolve to exactly one 201 + one 409** (advisory lock); idempotency replay (same key + same payload → original result) and payload-mismatch 409; privileged audit with reason + actor + requestId correlation plus the owner's own audit row; no edit/delete routes (404); historical immutability; market isolation; legacy closed-window (`effective_to`) projection fidelity; archived-row chain exclusion.

### 3.2 Gates

| Gate                                                            | Result                                                                                                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @ipoint/api typecheck`                           | ✅ exit 0                                                                                                                                                                                         |
| `pnpm --filter @ipoint/api build`                               | ✅ exit 0                                                                                                                                                                                         |
| `pnpm --filter @ipoint/api openapi:validate`                    | ✅ **227 paths, 0 missing schemas, 0 duplicate operationIds** (`✅ All runtime OpenAPI validations passed.`); does not self-exit after PASS (pre-existing outbox-worker quirk, same as S4/S5/S6A) |
| `pnpm --filter @ipoint/database db:checksum`                    | ✅ **Verified 30 immutable migration checksum(s)** (30/30)                                                                                                                                        |
| `pnpm --filter @ipoint/api-client typecheck` / `test` / `build` | ✅ exit 0 / **59/59** / exit 0                                                                                                                                                                    |
| `pnpm --filter @ipoint/admin-web typecheck`                     | ✅ exit 0                                                                                                                                                                                         |
| `pnpm --filter @ipoint/admin-web test`                          | ✅ **185/185** (165 prior + 20 new: 11 model, 9 page; manifest zero-drift assertions green)                                                                                                       |
| `pnpm --filter @ipoint/admin-web build`                         | ✅ exit 0 (vite build)                                                                                                                                                                            |
| prettier (all changed paths)                                    | ✅ clean                                                                                                                                                                                          |
| eslint (changed paths, scoped)                                  | ✅ exit 0 (0 errors; warnings are existing scope-ignore notices)                                                                                                                                  |

### 3.3 Pre-existing findings (NOT caused by P7-S6B — same classes as S6A)

1. Phase 1 `merchant.integration.spec.ts` (owner suite, 7 fails) and Phase 2 `admin-kyc.http.integration.spec.ts` (owner suite, 12 fails) are stale vs the accepted P7-S2 RbacGuard contract — unrelated to this work (A/B-proven in S6A).
2. `openapi:validate` does not self-exit after PASS (pre-existing outbox-worker handle).
3. Browser E2E remains host/CI-only (sandbox cannot launch Chromium); the new UI flows are covered by mock-based component specs (9 page tests) — NOT claimed as browser-passed.

## 4. Changed files

```
apps/api/src/admin-reward-ops/admin-reward-ops.controller.ts        (new)
apps/api/src/admin-reward-ops/admin-reward-ops.dto.ts               (new)
apps/api/src/admin-reward-ops/admin-reward-ops.errors.ts            (new)
apps/api/src/admin-reward-ops/admin-reward-ops.module.ts            (new)
apps/api/src/admin-reward-ops/admin-reward-ops.service.ts           (new)
apps/api/src/admin-reward-ops/admin-reward-ops.types.ts             (new)
apps/api/src/admin-reward-ops/admin-reward-ops.spec.ts              (new, 16 tests)
apps/api/src/admin-reward-ops/admin-reward-ops.integration.spec.ts  (new, 20 tests)
apps/api/src/app.module.ts                                          (register AdminRewardOpsModule)
apps/admin-web/src/reward-config-model.ts                           (new)
apps/admin-web/src/reward-config-model.test.ts                      (new, 11 tests)
apps/admin-web/src/reward-config-states.tsx                         (new)
apps/admin-web/src/reward-config-page.tsx                           (new)
apps/admin-web/src/reward-config-page.test.tsx                      (new, 9 tests)
apps/admin-web/src/test/reward-config-fixtures.ts                   (new)
apps/admin-web/src/test/reward-config-mock.ts                       (new)
apps/admin-web/src/route-manifest.ts                                (removed stale CG-02 placeholder gate from the existing reward-rates entry)
apps/admin-web/src/admin-api.ts                                     (adminRewardOpsApi client)
apps/admin-web/src/admin-app.tsx                                    (reward-rates route case)
apps/admin-web/src/admin.css                                        (additive styles only)
packages/api-client/src/index.ts                                    (append-only reward section)
packages/api-client/src/index.test.ts                               (append-only tests, +4)
docs/06-phase-reports/p7-s6/P7-S6B_INTERNAL_DELIVERY_REPORT.md      (this report)
```

No frozen Phase 1/3/5/6 owner file, no migration, no seed, and no permission-catalog change was made (the catalog already contained both `reward.rule.*` permissions).

## 5. Assumptions and risks

- **Assumption:** the market-local day is the IANA-timezone day of the selected market (server-owned Current Admin Market); the client preview uses the same Intl-based resolution as the server but the server result is authoritative.
- **Assumption:** a syntactically valid but non-calendar date is safely rejected (as `REWARD_ACTIVATION_NOT_FUTURE`); no calendar-validity refinement in the DTO was judged worth a transport change.
- **Risk:** global fallback rule versions (`market_id IS NULL`) are not shown on the selected-market surface (intentional per-market scope); if a global fallback is ever relied on operationally, the read projection should surface it explicitly (adapter-only change, no frozen impact).
- **Risk:** legacy owner-created rows with an explicit `effective_to` are now projected with the frozen window semantics; rows with a future `effective_to` and no later version remain `ACTIVE` with a closed window end (matches settlement).
- **Risk:** `openapi:validate` needs `REDEMPTION_VOUCHER_ENCRYPTION_KEY` and does not self-exit after PASS (pre-existing).
- Sandbox limitation: git commits were authored via the bundled dugite git binary (no system git in the sandbox); OpenClaw should verify the worktree/ref state on the host before review.

## 6. Confirmation

- No frozen Phase 1/3/5/6 owner file modified (delegation evidence: frozen-path diff EMPTY); no migration written; permission catalog untouched (already correct).
- The adapter never writes domain tables directly; the single `reward_rule_versions` insert delegates to the frozen Phase 3 owner command unchanged.
- No direct table writes from the UI; no client-side rate arithmetic; no historical recalculation; append-only versions (no edit/delete routes).
- Not pushed, not merged; OpenClaw integration review pending.

`P7-S6B_DELIVERY_COMPLETE` / pending OpenClaw integration review / NOT Command Center acceptance.
