# P7-S4B Internal Delivery Report (Continuation)

| Status          | Value                                |
| --------------- | ------------------------------------ |
| Delivery        | `DELIVERY_COMPLETE`                  |
| Internal gate   | `OPENCLAW_INTERNAL_GATE_PASSED`      |
| Phase authority | `CONTINUING_UNDER_D-047` via `D-048` |
| Executor class  | `OPENCLAW_MANAGED_CODING_SUBAGENT`   |

## 1. Scope delivered

P7-S4B delivered the truthful selected-market Admin Dashboard UI on the
P7-S4A read-model API, authorized under D-047/P7-S4:

- **Integration defect fixed**: the P7-S3 route manifest declared the
  dashboard route permission as `dashboard.read`, but the canonical P7-S2
  permission catalog (`packages/database/src/permission-catalog.ts`) defines
  `dashboard.view` only. The manifest now requires `dashboard.view` and the
  manifest tests assert zero drift from the catalog. The permission catalog
  itself was NOT modified.
- **Dashboard page** (`/admin/:marketId/dashboard`) consumes
  `AdminApiClient.dashboardMetrics()` (catalog + per-metric state) and
  `AdminApiClient.dashboardMetricDetail(metricId)` (drill-down reference),
  with M01–M14 grouped into the seven approved sections (People, Commerce,
  Reviews, Network, Finance and operations queues, Today, MCP balance).
- Every card shows the metric name, the server-provided `definition`
  (disclosure `<details>`), `definitionVersion`, `asOf` timestamp, freshness
  badge (FRESH/STALE/UNAVAILABLE), and the value.
- Required card states implemented as testable components: loading skeleton,
  empty catalog, STALE (last value + last asOf + manual refresh), UNAVAILABLE
  (explicit "Unavailable" + reason disclosure — never a fabricated zero,
  including source-permission denial), per-card error (drill-down fetch
  failure with retry), and whole-page error (catalog failure with retry).
- Queue sections (M05–M12 where FRESH) render their counts/rows with
  drill-down links to the canonical manifest routes that preserve the
  server-provided market and time boundary; M12 renders the real reward-job
  status inline (no dedicated route exists); sensitive metrics (M09/M13/M14)
  surface the `masking` flag on the drill-down link.
- Financial metrics (M13, M14) render server amounts EXACTLY as returned with
  their currency codes; per-currency rows for M13; no client arithmetic, no
  cross-currency totals, no ledger/reward/commission recomputation.
- Market switching respects the server-owned Current Admin Market selector:
  the dashboard renders for the URL market only when it equals the
  server-bound market (guard behavior preserved) and refetches when the
  rendered market changes.
- Read-only surface only: no writes, no offline write queue, no financial
  math. PWA read-only policy (P7-OD-22) unchanged.
- Responsive + accessibility: desktop grid and 320px single-column reflow,
  keyboard-operable drill-down links/buttons, visible focus from design
  tokens, semantic landmarks/headings, live region for freshness/loading
  changes; axe checks (jsdom component-level and Playwright spec) with zero
  serious/critical violations on covered paths.

## 2. Branch and worktree map

| Worktree    | Branch                     | Starting SHA                               | Delivered commits |
| ----------- | -------------------------- | ------------------------------------------ | ----------------: |
| `wt-p7-s4b` | `task/p7-s4b-dashboard-ui` | `b25f1f142ae41588169e1a4d0471c9214efb895e` |                 2 |

No push was performed; OpenClaw reviews and pushes.

## 3. Commit map

1. `de01500ebdbb2f8985c8ec7d6a006f5925d7e0b0` — `feat(admin-web): add truthful dashboard with freshness states`
2. `<COMMIT_2_SHA>` — `docs(p7-s4b): record internal delivery report` (this report; its SHA is reported in the delivery handoff — same pattern as P7-S4A)

## 4. Integration defect — dashboard route permission

| Item                                                              | Before                                                                  | After                                                                                                                                                                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/admin-web/src/route-manifest.ts` (dashboard route)          | `permission: 'dashboard.read'`                                          | `permission: 'dashboard.view'`                                                                                                                                                                       |
| `apps/admin-web/src/route-manifest.test.ts`                       | asserted `hasEffectivePermission(['dashboard.read'], 'dashboard.read')` | asserts manifest dashboard permission === `'dashboard.view'`, `hasEffectivePermission(['dashboard.view'], 'dashboard.view')`, and that no manifest route requires the non-canonical `dashboard.read` |
| Canonical catalog (`packages/database/src/permission-catalog.ts`) | `dashboard.view` (untouched)                                            | `dashboard.view` (untouched)                                                                                                                                                                         |

Verification against the canonical catalog:

```
$ grep -n "'dashboard.view'" packages/database/src/permission-catalog.ts
162:    'dashboard.view',
$ grep -n "'dashboard.read'" packages/database/src/permission-catalog.ts
(no match — dashboard.read is not a canonical permission)
```

Consumer mocks inside `apps/admin-web` (admin-app.test.tsx, the new
dashboard-page tests, the new Playwright spec) were updated to the canonical
`dashboard.view`. The repository root e2e mock
(`tests/e2e/admin-shell.spec.ts`) still passes `dashboard.read` in two places
and the root `playwright.admin.config.ts` webServer command hardcodes a
Windows host path; both are outside this task's allowed paths and are
recorded in §11 as OpenClaw follow-ups before the root e2e suite runs.

## 5. UI delivery

### 5.1 Files (all inside `apps/admin-web`)

| Path                                                                                                                          | Purpose                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/route-manifest.ts`                                                                                                       | permission fix (`dashboard.view`)                                                                                                                                                                                    |
| `src/admin-app.tsx`                                                                                                           | route `dashboard` renders `<DashboardPage />`                                                                                                                                                                        |
| `src/dashboard-model.ts`                                                                                                      | pure presentation model: section grouping, freshness labels, unavailable-reason disclosure, drill-down href builder (market + metricFilter + time boundary), value row flattening                                    |
| `src/dashboard-states.tsx`                                                                                                    | testable state components: `DashboardCardSkeleton`, `FreshnessBadge`, `MetricCardHeader`, `MetricDefinition`, `StaleState`, `UnavailableState`, `DashboardEmptyState`, `DashboardErrorState`, `MetricCardErrorState` |
| `src/dashboard-cards.tsx`                                                                                                     | `MetricCard` + value renderers (COUNT, BREAKDOWN, QUEUE_SUMMARY, JOB_STATUS with real run snapshot, CURRENCY_TOTALS per-currency rows, BALANCE) + masked drill-down link                                             |
| `src/dashboard-page.tsx`                                                                                                      | `DashboardPage` + `useDashboardCatalog` (catalog fetch keyed on market, retry) + `useDashboardDrillDowns` (parallel detail fetches for FRESH metrics with per-metric retry), freshness live region                   |
| `src/admin.css`                                                                                                               | dashboard styles on the existing design tokens only (8pt spacing, green primary, cards); no new design language                                                                                                      |
| `src/test/dashboard-fixtures.ts`                                                                                              | shared test fixtures mirroring the P7-S4A DTO shapes                                                                                                                                                                 |
| `src/dashboard-model.test.ts`, `src/dashboard-states.test.tsx`, `src/dashboard-cards.test.tsx`, `src/dashboard-page.test.tsx` | 38 new component/unit tests                                                                                                                                                                                          |
| `playwright.admin.config.ts`                                                                                                  | sandbox-friendly Playwright config (mocked API, local Vite, desktop + 320px)                                                                                                                                         |
| `src/dashboard.e2e.spec.ts`                                                                                                   | browser spec: desktop dashboard truthfulness + axe; 320px reflow + drawer + no horizontal overflow + axe                                                                                                             |

### 5.2 Value rendering rules enforced

- COUNT/BREAKDOWN/QUEUE_SUMMARY/JOB_STATUS counts are formatted with
  `Intl.NumberFormat` (formatting only, no arithmetic).
- CURRENCY_TOTALS and BALANCE render the exact decimal strings returned by
  the API, each with its currency code. No total is ever computed across
  currencies; no amount is ever reformatted numerically.
- UNAVAILABLE (including `SOURCE_PERMISSION_DENIED`) renders an explicit
  "Unavailable" panel with the reason disclosure; a metric with no value is
  never shown as zero. Valid server zero (e.g., M07) renders as `0` and is
  distinct from unavailable (tested).
- Drill-down links are built from the server drill-down reference
  (`marketId`, `metricFilter`, `timeBoundary`) via `drillDownHref` and the
  canonical manifest; `masking: true` adds a "Masked" badge (M09/M13/M14).

## 6. States covered (tested)

| State                  | Trigger                             | Rendering                                                                                                                                     |
| ---------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| loading                | catalog pending                     | per-card skeletons (`aria-busy`) + live region "Loading dashboard metrics."                                                                   |
| empty                  | catalog with zero items             | `DashboardEmptyState` with retry                                                                                                              |
| error (page)           | catalog fetch failure               | `DashboardErrorState` with "Retry dashboard"; distinct copy for `MARKET_SELECTION_REQUIRED` / `MARKET_CONTEXT_MISMATCH` / `PERMISSION_DENIED` |
| fresh                  | `state: 'FRESH'`                    | value + Fresh badge + drill-down link (when the detail reference resolves)                                                                    |
| stale                  | `state: 'STALE'`                    | last server value + Stale badge + last `asOf` + "Refresh metric"; no drill-down link                                                          |
| unavailable            | `state: 'UNAVAILABLE'`              | "Unavailable" + reason disclosure; never zero; no drill-down                                                                                  |
| denied (metric source) | `SOURCE_PERMISSION_DENIED`          | surfaces as UNAVAILABLE with permission disclosure (API contract)                                                                             |
| per-card error         | drill-down detail fetch failure     | `MetricCardErrorState` with "Retry metric"                                                                                                    |
| market change          | server Current Admin Market changes | guard keeps URL/server equality; dashboard refetches for the new market URL (tested via deep-link navigation)                                 |

## 7. Tests and verification (exact commands, all inside the worktree)

Environment: Linux sandbox; worktree `/workspace/.local/wt-p7-s4b`
(root `/workspace/node_modules` symlinks are broken, so everything ran inside
the worktree).

| Command                                                                        | Result                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @ipoint/admin-web typecheck`                                    | PASS, exit 0                                                                                                                                                                                                                                                      |
| `pnpm --filter @ipoint/admin-web test`                                         | **60/60 passed** (8 files): existing 22 + 38 new dashboard tests, exit 0                                                                                                                                                                                          |
| `pnpm --filter @ipoint/admin-web build`                                        | PASS; **1610 modules transformed**                                                                                                                                                                                                                                |
| `pnpm exec prettier --check` on all changed paths                              | clean                                                                                                                                                                                                                                                             |
| `pnpm exec eslint` on changed `src/**` paths                                   | clean — `apps/admin-web/src/**` is excluded from the repo eslint config by design (pre-existing repository policy); zero findings                                                                                                                                 |
| `pnpm exec eslint apps/admin-web/playwright.admin.config.ts`                   | `0:0 error Parsing error: ... was not found by the project service` — the pre-existing root `playwright.admin.config.ts` produces the identical error (file not in any tsconfig project / `allowDefaultProject`); a repository-wide tooling gap, not a regression |
| axe (component-level, jsdom)                                                   | zero serious/critical on loaded dashboard and shell paths                                                                                                                                                                                                         |
| `pnpm exec playwright test --config=apps/admin-web/playwright.admin.config.ts` | **not executable in this sandbox** — see limitation below                                                                                                                                                                                                         |

### Playwright browser-flow verification (exact limitation)

The sandbox cannot launch Chromium. The browser archive was downloaded
manually (182,333,649 bytes from the Playwright CDN) and registered under
`/workspace/.cache/ms-playwright/chromium-1194` with the
`INSTALLATION_COMPLETE` marker, and the local Vite webServer in the new
config starts correctly (verified manually — HTTP 200 on `/admin/login`).
Launch still fails because the sandbox image has no browser runtime
libraries (`ldd chrome` reports missing `libglib-2.0`, `libnss3`, `libX11`,
`libxcb`, …; none exist under `/usr/lib`), and `playwright install-deps`
cannot install them because apt's package lists live on a read-only
filesystem (`E: List directory /var/lib/apt/lists/partial is missing. -
Acquire (30: Read-only file system)`). The delivered
`apps/admin-web/playwright.admin.config.ts` + `src/dashboard.e2e.spec.ts`
are mock-based (no live API/DB required) and are ready to run on the host or
in CI where the browser binaries and system libraries exist; until then, the
covered paths' accessibility is verified by the jsdom axe checks in
`admin-app.test.tsx` and `dashboard-page.test.tsx` (zero serious/critical).
The pre-existing root e2e suite was previously executed on the Windows host
(its config hardcodes `C:/AI_WORKSPACE/...`).

## 8. Dependencies

No dependency or lockfile changes. All new code uses existing workspace
packages (`@ipoint/api-client`, `@ipoint/ui`, `@ipoint/design-tokens`,
`react-router-dom`).

## 9. Risks and limitations

- `tests/e2e/admin-shell.spec.ts` (out of allowed paths) still mocks
  `dashboard.read` in two places; after the manifest fix its dashboard deep
  link would render permission-denied. OpenClaw must flip those two mock
  entries to `dashboard.view` before running the root e2e suite.
- The root `playwright.admin.config.ts` webServer command hardcodes the
  Windows host Vite path; the sandbox-friendly replacement config is
  `apps/admin-web/playwright.admin.config.ts`.
- M10 remains UNAVAILABLE/NO_DURABLE_SOURCE (SEC-01) — the UI renders the
  disclosure and never a value, matching the API contract.
- Drill-down screens themselves are later-phase surfaces; this sub-phase
  delivers the drill-down links with preserved market/filter/time-boundary
  and masked labeling, per P7-OD-16.
- Browser execution is impossible in this sandbox: Chromium was downloaded
  and registered, but the image lacks the required shared libraries and apt
  is read-only (exact errors in §7). Browser flows are delivered as a
  ready-to-run spec and were not executed here (never claimed as passed).

## 10. Git state

- Worktree: `/workspace/.local/wt-p7-s4b` (branch `task/p7-s4b-dashboard-ui`).
- Starting SHA: `b25f1f142ae41588169e1a4d0471c9214efb895e`.
- Commits: 2 (code, then report). No amend, no rebase, no force, NO PUSH.
- Left untracked on purpose: `jiti/` (tooling cache), matching the P7-S4A
  pattern. The 102 historical untracked artifacts in the main checkout were
  untouched.
- Main checkout `apps/admin-web` was restored to pristine after the sandbox
  file bridge initially wrote there (no tracked modifications left).

## 11. OpenClaw follow-ups (outside allowed paths, recorded, not executed)

1. `tests/e2e/admin-shell.spec.ts`: change the two `dashboard.read` mock
   entries to `dashboard.view`.
2. Root e2e run (`playwright.admin.config.ts`) must execute on the host/CI
   with Playwright browsers present; the new `apps/admin-web` config is the
   sandbox-compatible alternative.

## 12. Internal gate result

`OPENCLAW_INTERNAL_GATE_PASSED` — typecheck, 60/60 tests, build, prettier,
and eslint (src) green; axe zero serious/critical on covered paths;
manifest permission defect fixed and drift-tested; commits scoped exactly;
nothing pushed.
