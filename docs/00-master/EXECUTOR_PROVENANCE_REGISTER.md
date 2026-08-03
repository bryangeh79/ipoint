# iPoint Executor Provenance Register

> Established: 2026-08-03 under D-048 (Phase 7 Alternate Coding Subagent Execution Authorization)
> Owner: OpenClaw (project general manager)
> Purpose: Record the executor class and provenance of every Phase 7 engineering task executed under D-047 continuous execution.
> Rules:
> - Append-only. One entry per dispatched engineering task.
> - Executor class must be exactly `CODEX_CLI` or `OPENCLAW_MANAGED_CODING_SUBAGENT`.
> - Never record credentials, private tokens, secrets, or hidden chain-of-thought.
> - The complete register is included in the final Phase 7 delivery report.

---

## Register fields (per task)

| Field | Required content |
|---|---|
| **Task ID** | Sub-phase task identifier (e.g., P7-S4A) |
| **Sub-phase** | Authorized sub-phase |
| **Executor class** | `CODEX_CLI` or `OPENCLAW_MANAGED_CODING_SUBAGENT` |
| **Model/provider identity** | Where available (no credentials) |
| **Session start time** | UTC / MYT timestamp |
| **Worktree** | Repository-relative worktree path |
| **Task branch** | Branch name |
| **Starting SHA** | Full SHA the task branch was created from |
| **Allowed paths** | Exact allowed file paths/globs |
| **Commit SHA** | Full SHA of the scoped task commit(s) |
| **Tests executed** | Exact commands + suites |
| **Test results** | Passed / Failed / Skipped / Exit code |
| **Independent reviewer** | Reviewer identity/class + evidence |
| **Integration commit** | Full SHA of the phase-branch integration |
| **Known limitations** | Documented limitations or risks |

---

## Task entries

<!-- New entries appended below in chronological order -->

## P7-S4A — Dashboard Server Read Models

| Field | Value |
|---|---|
| **Task ID** | P7-S4A |
| **Sub-phase** | P7-S4 (Dashboard and bounded operational read models) |
| **Executor class** | `OPENCLAW_MANAGED_CODING_SUBAGENT` (initial dispatch + written-handoff continuation + integration attempt; all under D-048) |
| **Model/provider identity** | OpenClaw managed subagents (deepseek/deepseek-v4-flash runtime pool) |
| **Session start time** | 2026-08-03 MYT (initial ~09:40; continuation ~10:45; integration attempt ~11:10) |
| **Worktree** | `.local/wt-p7-s4a` |
| **Task branch** | `task/p7-s4a-dashboard-read-models` |
| **Starting SHA** | `301f6a7a6d077dbbd51892d8a35c5ff0b82a3a93` |
| **Allowed paths** | `apps/api/src/admin-dashboard/**`, `apps/api/src/app.module.ts`, `packages/api-client/src/**` (dashboard DTOs only), `docs/06-phase-reports/p7-s4/**` |
| **Commit SHA** | `a91887862a4da75c94d534790607bafa4c607489` (feat), `404ca4d7375f73b8e32ff4ac3c47f298869ac690` (docs report), `1af724a0015b8c1e19ac7b5495a2d0445c09bdbe` (docs commit SHAs) |
| **Tests executed** | `vitest run src/admin-dashboard/admin-dashboard.spec.ts`; `vitest run src/admin-dashboard/admin-dashboard.integration.spec.ts` (fresh PostgreSQL test DB `ipoint_dashboard_test`, migrations applied); `pnpm --filter @ipoint/api typecheck`; `pnpm --filter @ipoint/api build`; `pnpm --filter @ipoint/api openapi:validate`; `pnpm --filter @ipoint/api-client typecheck`; `pnpm --filter @ipoint/api-client test`; prettier/eslint on changed paths |
| **Test results** | Unit 16/16 (exit 0); integration 14/14 (exit 0); typecheck exit 0; build exit 0; openapi:validate 204 paths, 0 errors (process does not self-exit - pre-existing script quirk); api-client 29/29 (exit 0); format/lint clean. All re-verified by OpenClaw on a clean database. |
| **Independent reviewer** | OpenClaw integration review: full diff review (types/catalog/service/controller/errors/cache/specs/api-client), re-ran unit + integration suites on a clean PostgreSQL database, verified merged-tree equality with task branch, verified main/phase-branch protection and the 102-untracked baseline |
| **Integration commit** | `7336dd46cf707620188b288c5cfedb02d33aefb3` (merge(p7-s4a) on `phase/7-admin-operations`, --no-ff, no conflicts) |
| **Known limitations** | (1) PUSH BLOCKED in this runtime: sandbox has no GitHub credentials; elevated/gateway exec disabled by policy; origin push of task branch and phase branch pending host-side execution (see D-048 environment note below). (2) First dispatch ended before committing; completed via written handoff per D-048 §5. (3) Integration attempt subagent stopped at push step (401 anonymous write access) without changes. (4) `jiti/` cache left untracked in worktree. (5) openapi:validate requires `REDEMPTION_VOUCHER_ENCRYPTION_KEY` env (pre-existing script gap). (6) Test database `ipoint_dashboard_test` created on the `ipoint-postgres-1` container (172.23.0.3:5432). |

## P7-S4B — Dashboard Admin Web

| Field | Value |
|---|---|
| **Task ID** | P7-S4B |
| **Sub-phase** | P7-S4 (Dashboard and bounded operational read models) |
| **Executor class** | `OPENCLAW_MANAGED_CODING_SUBAGENT` |
| **Model/provider identity** | OpenClaw managed subagent (deepseek/deepseek-v4-flash runtime pool) |
| **Session start time** | 2026-08-03 MYT (afternoon) |
| **Worktree** | `.local/wt-p7-s4b` |
| **Task branch** | `task/p7-s4b-dashboard-ui` |
| **Starting SHA** | `b25f1f142ae41588169e1a4d0471c9214efb895e` |
| **Allowed paths** | `apps/admin-web/src/**`, `apps/admin-web/playwright.admin.config.ts`, `docs/06-phase-reports/p7-s4/**` |
| **Commit SHA** | `de01500ebdbb2f8985c8ec7d6a006f5925d7e0b0` (feat), `f500d99fb10cce82b97de00b2a30d6f2e0109769` (docs report) |
| **Tests executed** | `pnpm --filter @ipoint/admin-web typecheck`; `pnpm --filter @ipoint/admin-web test`; `pnpm --filter @ipoint/admin-web build`; prettier/eslint on changed paths; axe component checks; playwright admin config (browser launch blocked - environment) |
| **Test results** | typecheck exit 0; tests 60/60 (8 files) exit 0; build exit 0 (1610 modules); format/lint clean; axe zero serious/critical; Playwright browser launch blocked by missing runtime libs (recorded, not a regression) |
| **Independent reviewer** | OpenClaw integration review: full diff review (route-manifest permission fix to canonical `dashboard.view`, dashboard-model/states/cards/page, admin-app wiring, api-client DTO usage, fixtures), scope check (17 files, no migrations, no frozen-owner code), manifest zero-drift test verified |
| **Integration commit** | 75f0a4b5394ff3131042b31fdb948aed0053bd4d (merge on `phase/7-admin-operations` executed after review) |
| **Known limitations** | (1) Push blocked in this runtime (same as P7-S4A; origin push pending host-side execution). (2) Playwright browser launch requires host/CI (sandbox lacks browser runtime shared libraries and apt is read-only). (3) Follow-up recorded: `tests/e2e/admin-shell.spec.ts` still mocks `dashboard.read` (2 places) - must be flipped to `dashboard.view` before the root e2e suite runs; assigned to P7-S4C verification scope. |

---

## P7-S4B — Dashboard Admin Web

| Field | Value |
|---|---|
| **Task ID** | P7-S4B |
| **Sub-phase** | P7-S4 (Dashboard and bounded operational read models) |
| **Executor class** | `OPENCLAW_MANAGED_CODING_SUBAGENT` (initial dispatch + continuation under D-048 §5) |
| **Model/provider identity** | OpenClaw managed subagents (deepseek/deepseek-v4-flash runtime pool) |
| **Session start time** | 2026-08-03 MYT (~12:20 initial; continuation after) |
| **Worktree** | `.local/wt-p7-s4b` |
| **Task branch** | `task/p7-s4b-dashboard-ui` |
| **Starting SHA** | `b25f1f142ae41588169e1a4d0471c9214efb895e` |
| **Allowed paths** | `apps/admin-web/src/**` (dashboard page/components/states/route-manifest fix/tests), `apps/admin-web/playwright.admin.config.ts`, `docs/06-phase-reports/p7-s4/**` |
| **Commit SHA** | `de01500ebdbb2f8985c8ec7d6a006f5925d7e0b0` (feat), `f500d99f…` (docs report) |
| **Tests executed** | `pnpm --filter @ipoint/admin-web typecheck`; `pnpm --filter @ipoint/admin-web test`; `pnpm --filter @ipoint/admin-web build`; prettier/eslint on changed paths; axe (jsdom) |
| **Test results** | typecheck exit 0; **60/60** tests (8 files); build PASS (1610 modules); format/lint clean; axe zero serious/critical on covered paths; Playwright browser flows NOT executable in sandbox (missing Chromium system libs; apt read-only) - honestly recorded, not claimed as passed |
| **Independent reviewer** | OpenClaw integration review: manifest permission fix verified against canonical catalog (dashboard.read -> dashboard.view + zero-drift test), admin-web typecheck + 60/60 re-run by OpenClaw, merge-tree equivalence verified |
| **Integration commit** | `75f0a4b5…` (merge(p7-s4b) on `phase/7-admin-operations`, --no-ff) |
| **Known limitations** | Manifest permission defect fixed in this sub-phase (P7-S3 had dashboard.read; canonical is dashboard.view). `tests/e2e/admin-shell.spec.ts` still had two dashboard.read mocks (fixed later by P7-S4-FIX). Browser flows blocked in sandbox (host/CI-ready spec delivered). |

---

## P7-S4C — Dashboard Verification (independent)

| Field | Value |
|---|---|
| **Task ID** | P7-S4C |
| **Sub-phase** | P7-S4 (Dashboard verification) |
| **Executor class** | `OPENCLAW_MANAGED_CODING_SUBAGENT` (independent verification, D-048 §11) |
| **Model/provider identity** | OpenClaw managed subagent (deepseek/deepseek-v4-flash runtime pool) |
| **Session start time** | 2026-08-03 MYT (~12:50) |
| **Worktree** | `.local/wt-p7-s4c` |
| **Task branch** | `task/p7-s4c-dashboard-acceptance` |
| **Starting SHA** | `63f9f4560ee0fc4caa42cdc94237c28d85377c7c` |
| **Allowed paths** | `docs/06-phase-reports/p7-s4/**`; new test files only in `apps/api/src/__tests__/**` and `apps/admin-web/src/**` |
| **Commit SHA** | `6ada9c014d42618e9d7ef6f436d25e6abc8b82f0` (test), `79de0aa855aea1685df7f30fbfa00b7a61f11119` (report), `1648d620…` (SHA map) |
| **Tests executed** | Full verification matrix 4.1-4.11: integration suite on clean DB; source reconciliation probe (information_schema/pg_enum/pg_constraint); query-bound review; freshness/missing-source/currency-separation/API/OpenAPI/UI checks; no-placeholder scan; browser attempt |
| **Test results** | Integration 14/14; unit 15/16 (D1 pre-existing wall-clock-dependent test defect found); new deterministic spec 3/3; typecheck/build/api-client 29/29; OpenAPI 204 paths 0 errors; admin-web 60/60; browser BLOCKED in sandbox (launch failure, honest); no-placeholder scan CLEAN; defects D1/D2/D3 reported |
| **Independent reviewer** | OpenClaw: report reviewed line-by-line; p7-s4c spec 3/3 re-run by OpenClaw; merged-tree equivalence verified |
| **Integration commit** | `3d97432e…` (merge(p7-s4c) on `phase/7-admin-operations`, --no-ff) |
| **Known limitations** | Browser flows not executable in sandbox (Chromium libs missing, apt read-only). D1 (test flakiness), D2 (M06 wording), 4.11 (e2e mocks) fixed by P7-S4-FIX. D3 (HTTP-level STALE coverage) mitigated by new deterministic spec. |

---

## P7-S4-FIX — Dashboard defect fixes (D1, D2, 4.11 mocks)

| Field | Value |
|---|---|
| **Task ID** | P7-S4-FIX |
| **Sub-phase** | P7-S4 (defect repair from independent verification) |
| **Executor class** | `OPENCLAW_MANAGED_CODING_SUBAGENT` (D-048 §5 written handoff; fixes verified by OpenClaw) |
| **Model/provider identity** | OpenClaw managed subagent (deepseek/deepseek-v4-flash runtime pool) |
| **Session start time** | 2026-08-03 MYT (~13:15) |
| **Worktree** | `.local/wt-p7-s4fix` |
| **Task branch** | `task/p7-s4-fixes` |
| **Starting SHA** | `63f9f4560ee0fc4caa42cdc94237c28d85377c7c` |
| **Allowed paths** | `apps/api/src/admin-dashboard/admin-dashboard.spec.ts`, `apps/api/src/admin-dashboard/admin-dashboard.catalog.ts`, `tests/e2e/admin-shell.spec.ts` |
| **Commit SHA** | `08dbffb486dd035f2e16a0938f1b9f40c3dacac0` (fix(p7-s4)) |
| **Tests executed** | unit spec x2; p7-s4c spec; api typecheck; prettier/eslint on changed files; tsc --noEmit on e2e project |
| **Test results** | unit **16/16 x2** (determinism proven); p7-s4c **3/3**; typecheck exit 0; format/lint clean; e2e parse OK |
| **Independent reviewer** | OpenClaw: diff reviewed (D1 wall-clock-relative computedAt fix correct; D2 text-only; mocks flipped to dashboard.view); unit 16/16 re-run by OpenClaw on the fix tree |
| **Integration commit** | `19b555e65d470c83ac5b8d7e468f0b122671e2f4` (merge(p7-s4-fix) on `phase/7-admin-operations`, --no-ff) |
| **Known limitations** | None material. All three defects closed; merged P7-S4 tree verified equivalent to the union of individually verified branches. |

---

*End of register - new entries appended above this line.*
