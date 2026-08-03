# P7-S5B Internal Delivery Report — Admin Merchant Operations

| Status          | Value                              |
| --------------- | ---------------------------------- |
| Delivery        | `DELIVERY_COMPLETE`                |
| Internal gate   | `OPENCLAW_INTERNAL_GATE_PASSED`    |
| Phase authority | `CONTINUING_UNDER_D-047` via `D-048` |
| Executor class  | `OPENCLAW_MANAGED_CODING_SUBAGENT` |

## 1. Scope delivered

P7-S5B delivered the safe **selected-market Admin Merchant Operations**
surface on top of the accepted Phase 1 merchant owner commands, under
D-047/D-048:

- **Application queue + merchant list** (`/admin/:marketId/merchants`):
  two-tab view over the owner queue/list endpoints, deterministic offset
  paging, status filters, merchant search, explicit loading/empty/error
  states, links to branch detail.
- **Branch detail** (`/admin/:marketId/merchants/:branchId`): profile,
  application history, owner-masked KYC, read-only package history, MCP
  account/reconciliation/recent-ledger summary, approved status actions
  (application review, KYC review, suspend/reactivate/close), suspended and
  closed banners, conflict/stale handling, post-action refresh.
- **Phase 7 adapter module** `apps/api/src/admin-merchant-ops/**` with one
  composition read (`GET admin/markets/:marketId/merchants/:branchId/detail`)
  that delegates to owner services. See §4 for the exact decision.
- **Typed client**: append-only P7-S5B section in `packages/api-client`
  (DTOs + `AdminMerchantApiClient`), plus `adminMerchantApi` in admin-web.
- **Tests**: API unit (6), API real-DB integration (11), api-client (11 new),
  admin-web component/state (26 new), plus a ready-to-run mock-based
  Playwright spec (`merchant.e2e.spec.ts`).

No frozen Phase 1/2 owner code was modified; no migrations/schema changes;
no direct domain-table writes in production code; nothing pushed.

## 2. Branch and worktree map

| Worktree        | Branch                     | Starting SHA                               | Delivered commits |
| --------------- | -------------------------- | ------------------------------------------ | ----------------: |
| `wt-p7-s5b`     | `task/p7-s5b-merchant-ops` | `c6e530bfe3ce3548950dd1c1667163d582303585` |                 2 |

No push was performed; OpenClaw reviews and pushes.

## 3. Commit map

1. `5e82f5a3ec6380c718042236627289961817a58f` — `feat(admin): add selected-market merchant operations` (code + tests; 21 files, +5551/−1)
2. `<COMMIT_2_SHA>` — `docs(p7-s5b): record internal delivery report` (this report)

## 4. Reuse-vs-adapter decision (task 4.1) — with evidence

**Path taken: hybrid — no adapter for contract enforcement; a minimal Phase 7
adapter for the missing branch-detail read only.**

Evidence from the frozen Phase 1 surface
(`apps/api/src/merchant/merchant.controller.ts`, `package.controller.ts`,
`mcp.controller.ts`, read-only):

| Capability | Owner surface exists? | Decision |
| --- | --- | --- |
| Application queue | `GET admin/markets/:marketId/merchants/applications` (`merchant.view`, marketScoped) | Consume owner endpoint directly (client `merchantApplications`) |
| Merchant list | `GET admin/markets/:marketId/merchants` (`merchant.view`, marketScoped) | Consume owner endpoint directly (client `merchantList`) |
| Application review | `POST .../merchants/:branchId/application/review` (`merchant.approve`) | Consume owner command directly (client `reviewMerchantApplication`) |
| KYC review detail/action | `GET/POST .../merchants/:branchId/kyc/review` (`merchant.kyc.approve`, audits `MERCHANT_KYC_REVIEW_STARTED`) | Consume owner surface directly (client `merchantKycReviewDetail` / `reviewMerchantKyc`) |
| Suspend / Reactivate / Close | `POST .../suspend|reactivate|close` (`merchant.suspend` / `merchant.close`) | Consume owner commands directly (client `suspendMerchant` / `reactivateMerchant` / `closeMerchant`) |
| MCP account/ledger/reconcile | `GET admin/markets/:marketId/mcp/accounts/:accountId[/ledger|/reconcile]` (`merchant.mcp.view`) | Consume owner read surfaces directly (client `merchantMcpAccount` / `merchantMcpLedger` / `merchantMcpReconcile`) |
| **Branch detail (profile/application/KYC/package/MCP in one admin read)** | **Does NOT exist.** Owner profile/application/KYC/MCP reads are merchant-owned (`MerchantOwnershipGuard` requires an account actor) and package history has no admin read at all | **Adapter created** (`GET admin/markets/:marketId/merchants/:branchId/detail`) |

Why the contract needs no wrapper: the owner admin endpoints already enforce
the selected-market contract via the canonical `RbacGuard`
(`marketScoped: true`) — server-owned Current Admin Market resolution from
the session, market grant check, and `MARKET_CONTEXT_MISMATCH` (409) on any
URL/header mismatch (`apps/api/src/platform-access/rbac.guard.ts`). Wrapping
them would duplicate owner logic (prohibited).

Why the adapter is still required: an admin actor cannot use the
merchant-owned reads (`MerchantOwnershipGuard` returns false without
`accountId`), and the owner exposes no admin branch-detail or package-history
read. The new module therefore provides exactly one composition read that:

- delegates every domain value to owner services
  (`MerchantService.getProfile/getApplication/getKyc` — exported by
  `MerchantModule`; `McpService.summary/reconcile/adminLedger` — the frozen
  `McpService` class is re-registered as a provider in the adapter module
  because the frozen `MerchantModule` exports only `MerchantService`; no
  frozen file changed);
- adds a **read-only package-history projection** over immutable owner-owned
  rows (`merchant_package_assignments` + `service_fee_versions` +
  `service_fee_profiles` + `special_percentages`) — the owner has no admin
  read surface; this is a Phase 7 read projection, never a write;
- applies the **same** canonical guard (`merchant.view`, marketScoped) and,
  as defense-in-depth, reports out-of-market branches as 404
  (`MERCHANT_BRANCH_NOT_FOUND`) so the read never leaks cross-market
  existence;
- never unmasks KYC (owner masking passes through), never exposes a raw
  ledger export (bounded 10-row recent-ledger summary only), never writes.

Integration note: wiring the adapter module into
`apps/api/src/app.module.ts` is **outside this task's allowed paths** and is
recorded as an OpenClaw integration follow-up (§11); the module is delivered
and verified here through its own Nest testing module (real Postgres +
canonical guards), exactly as the P7-S4A dashboard module is exercised.

## 5. Endpoints consumed

Owner (Phase 1, unchanged):

- `GET admin/markets/:marketId/merchants/applications` (queue)
- `GET admin/markets/:marketId/merchants` (list)
- `POST admin/markets/:marketId/merchants/:branchId/application/review`
- `GET|POST admin/markets/:marketId/merchants/:branchId/kyc/review`
- `POST admin/markets/:marketId/merchants/:branchId/suspend|reactivate|close`
- `GET admin/markets/:marketId/mcp/accounts/:accountId`
- `GET admin/markets/:marketId/mcp/accounts/:accountId/reconcile`
- `GET admin/markets/:marketId/mcp/accounts/:accountId/ledger`

Phase 7 adapter (new):

- `GET admin/markets/:marketId/merchants/:branchId/detail`

## 6. UI delivered (P7-S4B patterns)

`apps/admin-web/src` additions (design tokens only, responsive desktop +
320px, keyboard + axe):

- `merchant-model.ts` — formatting-only presentation model (status labels,
  decision options, permission/state action gates, error mapping). No client
  arithmetic on balances/rates; unknown statuses pass through unchanged.
- `merchant-states.tsx` — loading skeleton, empty, error+retry, suspended
  banner ("suspension preserves MCP"), closed banner, conflict alert,
  success notice.
- `merchants-page.tsx` — applications/merchants tabs (`@ipoint/ui` Tabs),
  status filters, merchant search, "Load more" offset paging, distinct
  error copy for `PERMISSION_DENIED` / `MARKET_SELECTION_REQUIRED` /
  `MARKET_CONTEXT_MISMATCH`, links via the canonical manifest route.
- `merchant-detail-page.tsx` — status card, profile, application history
  (immutable reviews), masked KYC (rendered exactly as the owner masked it;
  raw values asserted absent in tests), read-only package history, MCP
  account + reconciliation + bounded recent ledger, approved action forms
  (application review, KYC review with rejected-fields input on
  resubmission, suspend/reactivate/close with required reason), idempotency
  keys per submit, conflict/stale copy, post-action refresh.
- `admin-app.tsx` — routes `merchants` and `merchant-detail` wired
  **append-only at the end of the route switch** (existing cases untouched).
- `admin-api.ts` — adds `adminMerchantApi` (additive export).
- `merchant.e2e.spec.ts` — mock-based Playwright spec (desktop + 320px,
  drawer/Escape/focus, no horizontal overflow, axe) reusing the P7-S4B
  sandbox-friendly config; ready to run on host/CI.

Required UI states covered by tests: loading, empty, page error, permission
denied, market mismatch, not found, suspended, closed, conflict (invalid
transition, idempotency duplicate), action success + refresh, no-action
state, masked KYC, MCP-missing ("unavailable, never zero"), 320px reflow and
axe zero serious/critical (jsdom).

## 7. Tests and verification (exact commands, all inside the worktree)

Environment: Linux sandbox; worktree `/workspace/.local/wt-p7-s5b`
(root `/workspace/node_modules` symlinks are broken, so everything ran inside
the worktree). Test DB: `ipoint_p7s5b_test` at `172.23.0.3:5432`
(drop/recreated before each full integration run).

| Command | Result |
| --- | --- |
| `pnpm --filter @ipoint/api typecheck` | PASS, exit 0 |
| `DATABASE_URL=... pnpm --filter @ipoint/api exec vitest run src/admin-merchant-ops/admin-merchant-ops.spec.ts` | **6/6 passed**, exit 0 |
| `DATABASE_URL=... pnpm --filter @ipoint/api exec vitest run src/admin-merchant-ops/admin-merchant-ops.integration.spec.ts` (clean DB) | **11/11 passed**, exit 0 |
| `pnpm --filter @ipoint/api-client typecheck` | PASS, exit 0 |
| `pnpm --filter @ipoint/api-client test` | **38/38 passed** (27 existing + 11 new), exit 0 |
| `pnpm --filter @ipoint/admin-web typecheck` | PASS, exit 0 |
| `pnpm --filter @ipoint/admin-web test` | **87/87 passed** (11 files; 60 existing + 26 new + 1 added merchant-model file set), exit 0 |
| `pnpm --filter @ipoint/admin-web build` | PASS; **1614 modules transformed** |
| `pnpm exec prettier --check` on all changed paths | clean |
| `pnpm exec eslint apps/api/src/admin-merchant-ops packages/api-client/src/index.ts packages/api-client/src/index.test.ts` | clean, exit 0 (admin-web `src/**` excluded by pre-existing repo policy, as in P7-S4B) |
| axe (component-level, jsdom) | zero serious/critical on merchants and detail pages |

### Playwright browser verification (exact limitation)

`pnpm --filter @ipoint/admin-web exec playwright test --config=playwright.admin.config.ts src/merchant.e2e.spec.ts`
cannot execute in this sandbox: the Vite webServer starts, Chromium
`chromium-1194` is registered under `/workspace/.cache/ms-playwright`, but
launch fails with **"Host system is missing dependencies to run browsers"**
(missing `libx11`/`libxext`/`libxcb` etc.; `playwright install-deps` cannot
run because apt package lists live on a read-only filesystem). This is the
same limitation P7-S4B recorded. The delivered spec is mock-based (no live
API/DB) and ready to run on the host/CI; until then the covered paths'
accessibility is verified by the jsdom axe checks in
`merchants-page.test.tsx` and `merchant-detail-page.test.tsx` (zero
serious/critical).

## 8. Dependencies

No dependency or lockfile changes. All new code uses existing workspace
packages (`@ipoint/api-client`, `@ipoint/ui`, `react-router-dom`).

## 9. Risks and limitations

- `apps/api/src/app.module.ts` wiring for `AdminMerchantOpsModule` is an
  OpenClaw integration step (outside allowed paths) — §11.
- Browser flows are delivered but not executed here (sandbox limitation);
  never claimed as passed.
- KYC review evidence on the branch detail is the owner-masked summary only;
  the full reviewer surface remains the owner `kyc/review` endpoints
  (`merchant.kyc.approve`, audit-of-view).
- Package assignment changes remain owner-command territory
  (`merchant.package.assign`; P7-S6 package-configuration surface); this
  sub-phase deliberately ships history read-only — no automatic migration,
  no reassignment UI.
- Ledger display is a bounded summary (≤10 recent rows from the owner
  `adminLedger`); no raw ledger export anywhere.

## 10. Git state

- Worktree: `/workspace/.local/wt-p7-s5b` (branch `task/p7-s5b-merchant-ops`).
- Starting SHA: `c6e530bfe3ce3548950dd1c1667163d582303585`.
- Commits: 2 (code, then report). No amend, no rebase, no force, **NO PUSH**.
- Left untracked on purpose: `jiti/` (tooling cache), matching the P7-S4A/B
  pattern. The 102 historical untracked artifacts in the main checkout were
  untouched; the main checkout has no tracked modifications.
- Exact-path staging only (`git add` per file/dir); no `git add .`/`-A`.

## 11. OpenClaw follow-ups (outside allowed paths, recorded, not executed)

1. `apps/api/src/app.module.ts`: add `AdminMerchantOpsModule` to `imports`
   (one line) so the adapter's detail endpoint is live in the running API.
2. Run `apps/admin-web/src/merchant.e2e.spec.ts` on the host/CI with
   Playwright browsers present.

## 12. Internal gate result

`OPENCLAW_INTERNAL_GATE_PASSED` — typechecks green (api/client/admin-web),
API adapter unit 6/6 and real-DB integration 11/11, api-client 38/38,
admin-web 87/87, build 1614 modules, prettier + eslint clean, axe zero
serious/critical on covered paths; market isolation, permission denial,
masking, queue/list/detail, status actions, package-history read and bounded
MCP reads all verified server-side; commits scoped exactly; nothing pushed.
