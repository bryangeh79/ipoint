# P7-S6A Internal Delivery Report — Merchant Package Configuration

| Field           | Value                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| Status          | `P7-S6A_DELIVERY_COMPLETE` / pending OpenClaw integration review                                                |
| Phase authority | `CONTINUING_UNDER_D-047_AND_D-048`                                                                              |
| Executor class  | `OPENCLAW_MANAGED_CODING_SUBAGENT` (D-048; Codex CLI unavailable)                                               |
| Worktree        | `C:\AI_WORKSPACE\iPoint App\.local\wt-p7-s6a-package`                                                           |
| Branch          | `task/p7-s6a-package-config` (base `9b82a3f4`)                                                                  |
| Scope           | P7-S6A: Admin Merchant Package Configuration (frozen contract §7.3, ChatGPT Command Center order 2026-08-04 §6) |
| Pushed          | NO (OpenClaw integrates and pushes)                                                                             |
| Date            | 2026-08-04                                                                                                      |

## 1. Scope delivered

Phase 7 **read projections + UI orchestration** over the FROZEN Phase 1 package owner. No frozen Phase 1/3/5/6 owner file was modified; all writes stay on the Phase 1 owner commands (they already exist and are permission-gated).

### 1.1 Phase 7 adapter — `apps/api/src/admin-package-ops/` (new)

| Route                                                                 | Permission (canonical catalog)                                         | Read / Write      | Notes                                                                                                                                                                                                                           |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/admin/package-ops/markets/:marketId/packages`            | `merchant.package.view` (all roles, marketScoped)                      | Read              | Standard A–F profiles + forward-only versions; includes the seeded market-agnostic baseline versions (`market_id IS NULL`) and market-scoped versions. Exact decimal strings (`numeric(12,6)`) — never floats.                  |
| `GET /api/v1/admin/package-ops/markets/:marketId/special-percentages` | `merchant.special_package.manage` (SUPER_ADMIN only, step-up required) | Read (privileged) | Every view writes an audit-of-view record (`ADMIN_SPECIAL_PERCENTAGE_LIST_VIEWED`) via the canonical AuditService.                                                                                                              |
| Writes                                                                | —                                                                      | —                 | **None duplicated.** Version create/update/activate/cancel, assign, set-default, pause/resume stay on the frozen Phase 1 owner routes (`admin/markets/.../packages/...`, `admin/markets/.../merchants/:branchId/packages/...`). |

### 1.2 Admin Web — `/admin/:marketId/config/packages`

- Route-manifest `packages` entry permission fixed `merchant.package.read` → `merchant.package.view` (canonical; zero-drift assertion added to the manifest test — same defect class as the S4C `dashboard.read` fix).
- New `package-config-model.ts` (labels, A–F ordering, D-010 rate validation `>0% and <=100%`, window validation, permission gates — UI affordance only), `package-config-states.tsx` (loading/empty/error/permission-denied/offline/blocked), `package-config-page.tsx`:
  - Standard packages: catalog with exact rate strings + lifecycle badges; create-draft-version form + activate actions (owner commands, Idempotency-Key) gated on `merchant.package.manage` + online-desktop.
  - Special percentages: SUPER_ADMIN-only step-up-gated privileged list + **explicit blocked state** for creation (owner gap below).
  - Per-merchant reassignment: merchant search → assignments (reuses S5B branch-detail read) → explicit assign + set-default actions (owner commands, audited); pinning notice ("new versions never move existing assignments; no batch migration").
- All design-system states covered (loading/empty/error/success/disabled/denied/offline/retry); axe clean (jsdom).

### 1.3 Typed api-client (append-only)

`AdminPackageOpsApiClient` (catalog + special-percentages reads; owner-command pass-throughs: `createPackageVersion`, `activatePackageVersion`, `assignMerchantPackage`, `setDefaultMerchantPackage`). DTOs mirror the adapter/owner contracts; rates stay strings.

## 2. Owner-gap finding (frozen contract §7.3 — SPECIAL PERCENTAGE CREATION)

Reported per the dispatch rule ("if the owner lacks a needed command, STOP and report the exact gap"):

- The Phase 1 owner command `POST admin/markets/:marketId/special-percentages` exists and is already gated server-side by `merchant.special_package.manage` (seeded to SUPER_ADMIN only, step-up required).
- **Gap:** the owner DTO accepts only `rate` + `description`; there is **no mandatory `reason`** field, no `reason` column on `special_percentages`, and the owner audit record `SPECIAL_PERCENTAGE_CREATED` carries **no reason**. The frozen contract §7.3 requires "reason and immutable audit are mandatory" (§15 requires every privileged write to record reason).
- Phase 7 cannot add the reason atomically with the owner's domain effect (§14 atomic commit) without modifying frozen Phase 1 code, which is outside the authorized remediation scope (D-047's list does not include Phase 1 package).
- **Consequence:** special-percentage CREATE/ACTIVATE is NOT exposed on the Phase 7 surface (integration test proves the route is absent → 404) and the UI shows an explicit blocked state (`SPECIAL_PERCENTAGE_CREATE_BLOCKED`, `P1-OWNER-GAP-MANDATORY-REASON`). The SUPER_ADMIN read remains available (audited).
- **Recommended owner remediation (for OpenClaw/Command Center dispatch):** extend the frozen Phase 1 `createSpecialPercentageSchema` with mandatory `reason`, add a `reason` column to `special_percentages` (migration, centrally owned), and record it in the owner audit (`audit_logs.reason`). This is a Phase 1 owner change requiring separate authorization.

Everything else required by §7.3 is satisfied by existing owner commands: standard package versions (exact decimals, overlap rejection 23P01, idempotency, audit), pinning (version creation never touches `merchant_package_assignments`), and explicit audited per-merchant reassignment (assign + set-default, both audited, no batch migration).

## 3. Evidence (all executed in this worktree)

### 3.1 P7-S6A suites

| Suite                                                           | DB                                                                                                                                                   | Result       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `admin-package-ops.spec.ts` (unit)                              | —                                                                                                                                                    | **4/4** ✅   |
| `admin-package-ops.integration.spec.ts` (HTTP, real PostgreSQL) | `ipoint_gate_p6a` (fresh: `DROP DATABASE IF EXISTS ipoint_gate_p6a WITH (FORCE)` + `CREATE DATABASE`; `migrate()` + `seedFoundation()` in beforeAll) | **32/32** ✅ |
| **P7-S6A total**                                                |                                                                                                                                                      | **36/36** ✅ |

Coverage includes: 401/403/409 RBAC + selected-market enforcement; catalog exact decimals; market isolation; SUPER_ADMIN-only special-percentage read with step-up + audit-of-view; non-Super-Admin denial; version create with exact decimal normalization (`2.5` → `2.500000`); D-010 range rejection (`0`, `>100`, negatives) and `100.000000` acceptance; activation; overlap 409 (`PACKAGE_EFFECTIVE_WINDOW_OVERLAP`); idempotency replay + payload-mismatch conflict; **assignment pinning** (assignments byte-identical after new version create+activate); **no historical recalculation** (old version rate unchanged); **explicit audited reassignment** (assign + set-default audit rows, old assignment preserved, no auto-migration of other merchants); owner-gap evidence (owner accepts reason-less creation; Phase 7 surface 404s).

### 3.2 Gates

| Gate                                                            | Result                                                                                                                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @ipoint/api typecheck`                           | ✅ exit 0                                                                                                                                                                     |
| `pnpm --filter @ipoint/api build`                               | ✅ exit 0                                                                                                                                                                     |
| `pnpm --filter @ipoint/api openapi:validate`                    | ✅ **226 paths, 0 errors, 0 duplicate operationIds**; both `admin/package-ops` paths present; does not self-exit after PASS (pre-existing outbox-worker quirk, same as S4/S5) |
| `pnpm --filter @ipoint/admin-web typecheck`                     | ✅ exit 0                                                                                                                                                                     |
| `pnpm --filter @ipoint/admin-web test`                          | ✅ **165/165** (147 prior + 18 new: 8 page, 10 model, 1 manifest zero-drift)                                                                                                  |
| `pnpm --filter @ipoint/admin-web build`                         | ✅ exit 0 (1628 modules)                                                                                                                                                      |
| `pnpm --filter @ipoint/api-client typecheck` / `test` / `build` | ✅ exit 0 / **55/55** (+6) / exit 0                                                                                                                                           |
| prettier (all changed paths)                                    | ✅ clean                                                                                                                                                                      |
| eslint (changed paths, scoped)                                  | ✅ exit 0 (0 errors; warnings are existing scope-ignore notices)                                                                                                              |

### 3.3 Regression (integrated tree = this worktree + my wiring)

| Suite                              | DB                                       | Result                                                                                                                                                                                               |
| ---------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard integration (P7-S4A)     | `ipoint_p6a_dash` (fresh)                | **14/14** ✅                                                                                                                                                                                         |
| KYC ops integration (P7-S5C)       | `ipoint_p6a_kyc` (fresh)                 | **36/36** ✅                                                                                                                                                                                         |
| Redemption integration (P6)        | `ipoint_p6a_redem` (fresh, pre-migrated) | ✅                                                                                                                                                                                                   |
| Redemption admin hardening (P6-S8) | `ipoint_p6a_redem` (pre-migrated)        | **40/40** ✅                                                                                                                                                                                         |
| Config unit                        | —                                        | **5/5** ✅                                                                                                                                                                                           |
| API unit suite (bulk)              | shared                                   | 1343 passed / 27 skipped; failures isolated to (a) shared-DB contamination artifacts (dashboard/kyc when run on one DB — clean on own DBs, documented class) and (b) stale frozen-owner suites below |

### 3.4 Pre-existing findings (NOT caused by P7-S6A — proven by A/B runs with the new module removed from `app.module.ts`)

1. **Phase 1 `merchant.integration.spec.ts`** (owner suite, 7 fails): written pre-P7-S2; its admin fixtures never select a Current Admin Market, so the P7-S2 RbacGuard (`marketScoped`) denies → 403. Fails identically with and without the S6A module. Owner-suite staleness vs the accepted P7-S2 RBAC contract.
2. **Phase 2 `admin-kyc.http.integration.spec.ts`** (owner suite, 12 fails): expects `AUTH_PERMISSION_DENIED`, the P7-S2 guard returns `PERMISSION_DENIED`. Fails identically with and without the S6A module.
3. Running multiple DB-backed suites on one shared database produces fixture-count contamination (documented in P7-S4/S5 as `TEST_ENVIRONMENT_CONTAMINATION`); each suite passes on its own fresh DB.

Browser E2E remains host/CI-only (sandbox cannot launch Chromium); the new UI flows are covered by mock-based component specs (8 page tests) — NOT claimed as browser-passed.

## 4. Changed files

```
apps/api/src/admin-package-ops/admin-package-ops.controller.ts        (new)
apps/api/src/admin-package-ops/admin-package-ops.module.ts            (new, owner-gap record)
apps/api/src/admin-package-ops/admin-package-ops.service.ts           (new)
apps/api/src/admin-package-ops/admin-package-ops.types.ts             (new)
apps/api/src/admin-package-ops/admin-package-ops.spec.ts              (new, 4 tests)
apps/api/src/admin-package-ops/admin-package-ops.integration.spec.ts  (new, 32 tests)
apps/api/src/app.module.ts                                            (register AdminPackageOpsModule)
apps/admin-web/src/package-config-model.ts                            (new)
apps/admin-web/src/package-config-model.test.ts                       (new, 10 tests)
apps/admin-web/src/package-config-states.tsx                          (new)
apps/admin-web/src/package-config-page.tsx                            (new)
apps/admin-web/src/package-config-page.test.tsx                       (new, 8 tests)
apps/admin-web/src/route-manifest.ts                                  (permission zero-drift fix)
apps/admin-web/src/route-manifest.test.ts                             (zero-drift assertion)
apps/admin-web/src/admin-api.ts                                       (adminPackageOpsApi client)
apps/admin-web/src/admin-app.tsx                                      (packages route case)
apps/admin-web/src/admin.css                                          (additive styles)
apps/admin-web/src/test/package-config-fixtures.ts                    (new)
apps/admin-web/src/test/package-config-mock.ts                        (new)
packages/api-client/src/index.ts                                      (append-only section)
packages/api-client/src/index.test.ts                                 (append-only tests, +6)
docs/06-phase-reports/p7-s6/P7-S6A_INTERNAL_DELIVERY_REPORT.md        (this report)
```

## 5. Supplementary calibration (Command Center 续令 2026-08-04)

Added and executed to satisfy the supplementary requirements; all pass on the same fresh-DB methodology:

| Requirement                                                                                           | Evidence (integration, fresh DB `ipoint_gate_p6a`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Special percentage `>0%` and `<=100%` (D-010) **and max six decimals**                             | Six decimals accepted (`12.345678` special / `2.123456` version, stored `numeric(12,6)` exactly); seven decimals rejected (`12.3456789`, `2.1234567`); `0`/`0.000000` rejected; `100.000000` accepted; `100.000001` rejected — for both standard versions and special percentages (owner DTO + DB check). Admin-Web model `packageRateValid` unit cases added (6/7-decimal boundaries).                                                                                                                                                                                                                     |
| 2. Idempotency key + payload hash on every configuration write; same key + different payload rejected | Create-version (original suite), **activate** (replay returns original result; same key on a different version is an independent owner scope), **assign** (same key + same payload replays same assignment id; same key + different `service_fee_version_id` → `409 IDEMPOTENCY_KEY_CONFLICT` via the owner payload hash), **set-default** (replay idempotent).                                                                                                                                                                                                                                             |
| 3. Package versions append-only; published versions cannot be modified/deleted                        | Edit ACTIVE version → `409 PACKAGE_VERSION_IMMUTABLE`; DELETE route absent → 404; DRAFT (unpublished) can still be cancelled → 200; actively assigned version cannot be cancelled → `409 PACKAGE_VERSION_IN_ACTIVE_USE`.                                                                                                                                                                                                                                                                                                                                                                                    |
| 4. No Phase 7 duplication of frozen Phase 1 owner logic                                               | Adapter exposes **no write routes** (POST to adapter catalog/assignment paths → 404, proven); adapter is read-only projection + delegation/orchestration only (verified in review).                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 5. Self-test coverage additions                                                                       | **Concurrent version creation**: two parallel creates with disjoint windows both 201; overlapping race resolves to exactly one 201 + one `409 PACKAGE_EFFECTIVE_WINDOW_OVERLAP` (exclusion constraint). **Market-wide pin**: creating + activating a new version leaves the total assignment row count unchanged. **Migration checksum validation: 30/30, MISMATCHES=0** (`verifyMigrationChecksums`, run directly). Special-percentage authorization (SUPER_ADMIN-only + step-up; non-Super-Admin 403) already covered. Historical immutability already covered (old version rates/assignments unchanged). |

Updated totals: P7-S6A **36/36** (4 unit + 32 integration); Admin Web **165/165**; API client **55/55**; migration checksums **30/30**. Browser flows remain mock-level component specs (sandbox cannot launch Chromium) — host/CI-only, not claimed as passed.

## 6. Assumptions and risks

- **Assumption:** the seeded market-agnostic A–F profiles/versions (Phase 1 authority, `seedFoundation`) are the "existing A–F standard packages"; the catalog shows them plus market-scoped versions, and the UI treats only the owner at assign-time as assignability authority.
- **Assumption:** reassignment = explicit `assign` (+ optional `set-default`) owner actions per merchant; there is no single owner "reassign" command and none was invented.
- **Risk:** special-percentage creation stays unavailable until the Phase 1 owner command gains mandatory reason + audit (owner gap above) — a deliberate blocked capability, not a UI workaround.
- **Risk:** the two stale frozen-owner suites (§3.4) will fail any full-repo test sweep until separately authorized owner-suite remediation; they are unrelated to P7-S6A (A/B proven).
- **Risk:** `openapi:validate` requires `REDEMPTION_VOUCHER_ENCRYPTION_KEY` and does not self-exit after PASS (pre-existing).
- Sandbox limitation: git commits were authored via Node git plumbing (no git binary in the sandbox); OpenClaw should verify the worktree index/ref state on the host before review.

## 7. Confirmation

- No frozen Phase 1/3/5/6 owner file modified; no migration written (none needed — schema already supports packages/versions/special percentages).
- No direct table writes from the UI; no client-side rate arithmetic; no historical recalculation; no batch migration; no other P7-S6 domain (reward/redemption/commission) touched.
- Not pushed, not merged; OpenClaw integration review pending.

`P7-S6A_DELIVERY_COMPLETE` / pending OpenClaw integration review / NOT Command Center acceptance.
