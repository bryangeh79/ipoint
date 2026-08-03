# P7-S4C Dashboard Verification Report (Independent)

| Field                           | Value                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task ID                         | P7-S4C                                                                                                                                                                                                                                                                                                                      |
| Executor class                  | `OPENCLAW_MANAGED_CODING_SUBAGENT` (under D-048, continuing D-047 P7-S4)                                                                                                                                                                                                                                                    |
| Role                            | Independent verification of P7-S4 (Dashboard and bounded operational read models)                                                                                                                                                                                                                                           |
| Worktree                        | `/workspace/.local/wt-p7-s4c`                                                                                                                                                                                                                                                                                               |
| Branch                          | `task/p7-s4c-dashboard-acceptance`                                                                                                                                                                                                                                                                                          |
| Starting SHA                    | `63f9f4560ee0fc4caa42cdc94237c28d85377c7c` (P7-S4A merged at `7336dd46`, P7-S4B merged at `75f0a4b5`, provenance at `63f9f456`)                                                                                                                                                                                             |
| Commits                         | `6ada9c014d42618e9d7ef6f436d25e6abc8b82f0` — `test(p7-s4c): add dashboard verification coverage`; `79de0aa855aea1685df7f30fbfa00b7a61f11119` — `docs(p7-s4c): record dashboard verification report` (this report); SHA map filled by a follow-up docs commit after the report SHA was known (same pattern as P7-S4A/P7-S4B) |
| Deliverables under verification | P7-S4A (API read models, `a9188786`), P7-S4B (Admin Web UI, `de01500e`)                                                                                                                                                                                                                                                     |
| Date                            | 2026-08-03 (Asia/Kuala_Lumpur)                                                                                                                                                                                                                                                                                              |
| Pushed                          | **NO** (nothing pushed; OpenClaw reviews and pushes)                                                                                                                                                                                                                                                                        |

## 1. Scope and method

Per D-048 §11 P7-S4C, this subagent independently re-ran the P7-S4A/P7-S4B
verification, reconciled documented metric sources against real SQL and the
real PostgreSQL schema, checked query bounds, freshness, missing-source,
currency-separation, API/OpenAPI, UI, and browser-test evidence, scanned for
placeholders, and confirmed the P7-S4B follow-up item. No production code was
modified. One defect was fixed **only in a NEW test file inside the allowed
path** `apps/api/src/__tests__/**` (deterministic replacement coverage for a
wall-clock-dependent test); the broken test itself is outside the allowed
paths and is REPORTED, not fixed.

Environment (learned, per task brief): Linux sandbox; root
`/workspace/node_modules` symlinks broken, so all commands ran inside the
worktree (valid node_modules). PostgreSQL `172.23.0.3:5432`, user `ipoint`,
test DB `ipoint_dashboard_test` dropped and recreated before the integration
run (migrations apply in `beforeAll`).

## 2. Verification matrix (exact commands and results)

### 4.1 Fixture-backed aggregate tests on a CLEAN database — PASS (with 1 reported pre-existing test defect)

Clean database established first:

```
$ node -e "<DROP DATABASE IF EXISTS ipoint_dashboard_test; CREATE DATABASE ipoint_dashboard_test>"
recreated ipoint_dashboard_test (clean)     # 0 tables in fresh db
```

Then (all with `DATABASE_URL=postgresql://ipoint:ipoint-local-only@172.23.0.3:5432/ipoint_dashboard_test`):

| Command                                                                                                               | Result                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @ipoint/api exec vitest run src/admin-dashboard/admin-dashboard.integration.spec.ts`                   | **14 passed / 0 failed / 0 skipped**, exit 0                                                                               |
| `pnpm --filter @ipoint/api exec vitest run src/admin-dashboard/admin-dashboard.spec.ts`                               | **15 passed / 1 failed / 0 skipped** — see DEFECT D1 (pre-existing wall-clock-dependent test; NOT a production regression) |
| `pnpm --filter @ipoint/api exec vitest run src/__tests__/admin-dashboard.p7-s4c.spec.ts` (NEW deterministic coverage) | **3 passed / 0 failed**, exit 0                                                                                            |
| `pnpm --filter @ipoint/api typecheck`                                                                                 | exit 0                                                                                                                     |
| `pnpm --filter @ipoint/api build`                                                                                     | exit 0                                                                                                                     |
| `pnpm --filter @ipoint/api-client test`                                                                               | **29 passed / 0 failed**, exit 0                                                                                           |

The 16/16 unit expectation of the task brief cannot be reproduced on
2026-08-03T12:53Z because of D1 (test-only defect, exact evidence below). All
other counts match the delivery reports.

### 4.2 Source reconciliation M01–M14 — PASS (1 minor documentation-vs-implementation wording item, DEFECT D2)

Method: compared the documented `source` text in `admin-dashboard.catalog.ts`
against the actual SQL in `admin-dashboard.service.ts`, and validated every
table/column/status literal against the live schema of the clean test DB via
`information_schema` / `pg_enum` / `pg_constraint` (read-only probe,
`apps/api/src/__tests__/p7-s4c-reconcile-probe.cjs`, scratch, removed after
use).

Probe result: **table/column errors = 0, enum errors = 0** across all 15
referenced tables and 10 status-filter columns:

- Every table used by the SQL exists (`markets`, `members`,
  `member_market_preferences`, `merchant_branches`,
  `merchant_applications`, `merchant_kyc_submissions`,
  `member_kyc_cases`, `agent_activation`, `mcp_adjustment_requests`,
  `redemption_fulfilment_exceptions`, `redemption_orders`,
  `redemption_refund_requests`, `daily_job_runs`, `transactions`,
  `mcp_accounts`).
- Every referenced column exists (full list verified, e.g.
  `daily_job_runs.local_business_date` (date), `transactions.confirmed_at`
  (timestamptz), `transactions.purchase_amount` / `mcp_accounts.available_balance`
  (numeric), `member_market_preferences.is_enabled` /
  `redemption_fulfilment_exceptions.resolved` (boolean),
  `markets.archived_at` (timestamptz)).
- All status literals exist in the real enums:
  `member_status` (ACTIVE, SUSPENDED, CLOSED),
  `merchant_operational_status` (ACTIVE),
  `merchant_application_status` (SUBMITTED, UNDER_REVIEW),
  `merchant_kyc_status` (SUBMITTED, UNDER_REVIEW),
  `member_kyc_case_status` (SUBMITTED, UNDER_REVIEW),
  `agent_activation_status` (PENDING_PAYMENT, PAYMENT_CONFIRMED,
  COURSE_PENDING, COURSE_COMPLETED, PENDING_APPROVAL, NOT_APPLIED),
  `adjustment_state` (PENDING_APPROVAL),
  `redemption_refund_request_status` (PENDING_CHECKER),
  `daily_job_status` (PENDING, RUNNING, COMPLETED, FAILED),
  `transaction_status` (CONFIRMED).
- Market scoping: every query filters on `market_id` (or `markets.code` for
  M08 via `agent_activation.market`), and the market id itself comes from the
  server-selected Current Admin Market (`adminMarketContext` set by the
  RbacGuard; controller `currentMarket()` fails closed with
  `MARKET_SELECTION_REQUIRED` if absent).
- M01–M14 documented source vs SQL reconciliation: all match, including M10
  (`NO_DURABLE_SOURCE`, no query ever executed for it), M12 (real
  `daily_job_runs` only, never rule-version fabrication), M13 (market-local
  today start, exact decimal `sum(...)::text`), M14 (`sum(available_balance)`
  with `markets.currency_code`).

### 4.3 Query bounds — PASS (observations only)

Manual review of every metric query in `admin-dashboard.service.ts`:

- All metrics are server-side aggregates (COUNT / GROUP BY) over
  market-filtered sets; no client-derived or first-page-derived values
  anywhere. The only raw-row query is M12's latest run with `LIMIT 1`
  (`ORDER BY local_business_date DESC, created_at DESC LIMIT 1`).
- M12 status counts are bounded to a trailing window:
  `local_business_date >= $2::date` where `$2` is
  `marketLocalDayStart(now − 30 days, market timezone)` (`M12_STATUS_WINDOW_DAYS = 30`).
- M13 is bounded to the market-local today start:
  `confirmed_at >= marketLocalDayStart(now, timezone)`; per-currency rows
  only, exact decimal strings.
- No LIMIT-less aggregation over full tables that could produce unbounded
  volume: every aggregate's output is bounded by status/currency/enum
  cardinality or by the date window.
- Index observations (not defects): `transactions` has no
  `(market_id, confirmed_at)` index (M13 scan is market-filtered; fine at
  MVP scale, worth an index at production volume); `redemption_orders` has
  no `market_id` index (M11 joins are PK-driven with a market filter);
  `member_market_preferences` has no `(market_id, is_enabled)` index (M01–M03);
  M12's latest-run order-by is supported by
  `daily_job_runs_market_date_idx (market_id, local_business_date)`.
  `agent_activation` has `idx_activation_market`, `member_kyc_cases` has
  `member_kyc_cases_market_idx`, `merchant_branches` has
  `(id, market_id)` — all good.

### 4.4 Freshness tests — PASS (gap closed with a new deterministic test)

- `evaluateFreshness` bounds (types.ts): QUEUE 60s / KPI 5min — covered by
  unit tests (FRESH at exactly 60s/5m, STALE after) — passed.
- STALE state exposure: catalog items carry `state: 'STALE'` + `asOf`;
  `metric()` throws `DASHBOARD_DATA_STALE` — covered by the new deterministic
  spec (see below) and by the (flaky) original test.
- Cache TTL bounds: `DashboardMetricCache.get()` evicts entries older than
  the freshness-class TTL (unit-covered, passed).
- asOf provenance: computed path stamps `asOf = now.toISOString()` at source
  query time; cached path returns the stored `asOf` (source-query time),
  never the cache-read time. New deterministic test proves the cache-hit
  asOf equals the original source-query time after the clock advanced 60s.
- **Gap found and closed (tests only)**: the delivered unit test
  "serves a cached entry as STALE when its asOf violates the freshness
  class" is wall-clock-dependent (DEFECT D1). Added
  `apps/api/src/__tests__/admin-dashboard.p7-s4c.spec.ts` (3 tests, all
  passing at any wall clock):
  1. cached entry with stale asOf → catalog STALE + `DASHBOARD_DATA_STALE`
     from `metric()`;
  2. cache-hit asOf stays the source-query time (never cache-read time);
  3. wall-clock TTL eviction forces a re-query (FRESH with new asOf).

### 4.5 Missing-source tests — PASS (no gap)

- M10 → `UNAVAILABLE` / `NO_DURABLE_SOURCE` (SEC-01): integration test
  "exposes M10 as UNAVAILABLE (NO_DURABLE_SOURCE) and never fabricates a
  value" (value undefined) + HTTP `503 DASHBOARD_DATA_UNAVAILABLE` for
  `GET /api/v1/admin/dashboard/metrics/M10` + unit test proving M10 issues
  no source query (`queries === 1`).
- Failed/blocked sources → `UNAVAILABLE`, never zero: unit test "reports
  UNAVAILABLE (never zero) when the source query fails" (SOURCE_QUERY_FAILED
  for every non-M10 metric; value undefined).
- `SOURCE_PERMISSION_DENIED` gating for M09/M12/M14 without the source
  permissions: integration test "keeps financial source permissions:
  M09/M12/M14 unavailable without their source permission" +
  unit test asserting the same and that M01 (no gate) stays FRESH.

### 4.6 Currency-separation tests — PASS (no gap)

- Integration: M13 asserted with `toEqual` exact shape
  `{ kind: 'CURRENCY_TOTALS', totals: [{ currency: 'MYR', count: 3, totalAmount: '160.5000000000' }] }`
  (market A) and `[{ currency: 'SGD', count: 1, totalAmount: '20.0000000000' }]`
  (market B); M14 `{ kind: 'BALANCE', currency: 'MYR', totalAvailableBalance: '1250.5000000000' }`.
  The `toEqual` assertion makes any added cross-currency total fail the test.
- Structurally, cross-currency totals are impossible per market: the schema
  keys `market_transaction_settings` on `market_id` (one currency per market),
  so `transactions.currency` is single-valued per market (per P7-S4A §5.3).
- UI: `dashboard-cards.test.tsx` "renders per-currency totals exactly without
  a cross-currency total" and "renders the balance exactly with its currency
  code"; `dashboard-page.test.tsx` "renders per-currency rows exactly and
  masks sensitive drill-down". The Playwright spec additionally asserts
  `getByText(/180\.5/u)` count 0 (160.50 MYR + 20.00 SGD never summed).

### 4.7 API tests — PASS

All integration checks run against the real HTTP app + real PostgreSQL:

- Routes registered under `/api/v1`: `GET /api/v1/admin/dashboard/metrics`
  and `GET /api/v1/admin/dashboard/metrics/:metricId` exercised via
  supertest (200/401/403/409/422/503 all observed).
- OpenAPI parity: `REDEMPTION_VOUCHER_ENCRYPTION_KEY=<64-hex>
pnpm --filter @ipoint/api openapi:validate` →
  `✅ All runtime OpenAPI validations passed` (204 paths, 0 schema errors, 0
  duplicate operationIds). Independent probe (compiled, decorator-metadata
  preserved) dumped the two dashboard paths:
  `/api/v1/admin/dashboard/metrics` → responses `200`;
  `/api/v1/admin/dashboard/metrics/{metricId}` → responses `200, 422, 503`.
  Note: after printing the PASS summary the process does not exit because a
  background outbox worker keeps the event loop alive (pre-existing script
  quirk documented in P7-S4A §7; the validation output itself is
  unambiguous PASS).
- Error codes: `422 DASHBOARD_METRIC_UNDEFINED` (unknown/malformed metric,
  incl. `M99`); `503 DASHBOARD_DATA_UNAVAILABLE` (M10 at HTTP level);
  `503 DASHBOARD_DATA_STALE` — service-level rejection covered by the new
  deterministic spec; the controller maps both UNAVAILABLE and STALE through
  the same switch branch to `ServiceUnavailableException` (the UNAVAILABLE
  branch is HTTP-proven; STALE at HTTP level remains indirectly covered).
- RBAC + market: `401` unauthenticated; `403 PERMISSION_DENIED` for
  non-admin and for an admin without `dashboard.view`; `409
MARKET_SELECTION_REQUIRED` without a selected market; `409
MARKET_CONTEXT_MISMATCH` for a client-supplied `x-market-id` differing from
  the server-selected Current Admin Market; full canonical flow
  login → bootstrap → select market → catalog (200, 14 items).
- No write side effects: integration test asserts transactions /
  merchant_branches / daily_job_runs counts unchanged before/after the
  catalog call.

### 4.8 UI verification — PASS

| Command                                     | Result                                     |
| ------------------------------------------- | ------------------------------------------ |
| `pnpm --filter @ipoint/admin-web typecheck` | exit 0                                     |
| `pnpm --filter @ipoint/admin-web test`      | **60 passed / 0 failed** (8 files), exit 0 |
| `pnpm --filter @ipoint/admin-web build`     | PASS (vite build; `✓ built in 23.43s`)     |

Compliance evidence (code review + the 38 P7-S4B dashboard tests):

- No client-side financial arithmetic: counts formatted with
  `Intl.NumberFormat` only; amounts rendered as exact server strings with
  currency codes (`dashboard-cards.tsx`; model test "formats counts and
  timestamps without arithmetic").
- No cross-currency totals anywhere (tests above; spec asserts the
  non-sum).
- UNAVAILABLE never rendered as zero — explicit "Unavailable" panel +
  reason disclosure (`UnavailableState`); valid server zero (e.g. M07)
  renders as `0` and is distinct from unavailable (tested).
- STALE shows last value + last `asOf` + manual refresh (`StaleState`,
  tested); no drill-down link while stale.
- Drill-down preserves market, metric filter, time boundary, masking:
  `drillDownHref` built from the server-provided `marketId`,
  `metricFilter`, `timeBoundary`; `masking: true` adds a "Masked" badge for
  M09/M13/M14 (model + page tests).
- Market-switch refetch: dashboard renders only when URL market equals the
  server-bound market and refetches on change (tested via deep-link
  navigation).
- Read-only PWA policy: page test "keeps the dashboard read-only (no write
  controls on the page)"; no writes, no offline queue (P7-OD-22).
- Route permission canonical `dashboard.view` (P7-S4B fix verified):
  `route-manifest.ts:88-92` requires `dashboard.view`;
  `route-manifest.test.ts:55-72` asserts the manifest requires
  `dashboard.view`, `hasEffectivePermission(['dashboard.view'], 'dashboard.view')`,
  and that **no** manifest route requires the non-canonical `dashboard.read`
  (zero drift vs `packages/database/src/permission-catalog.ts`, which defines
  `dashboard.view` at line 162 and has no `dashboard.read`).
- Accessibility: axe (jsdom component-level) zero serious/critical on loaded
  dashboard paths (dashboard-page/admin-app tests).

### 4.9 Browser tests — BLOCKED in sandbox (exact error recorded; spec verified host/CI-ready)

Command:

```
pnpm exec playwright test --config=apps/admin-web/playwright.admin.config.ts
```

Result: **not executable in this sandbox**. Both specs (desktop and 320px
mobile) fail at browser launch with:

```
Error: browserType.launch:
╔══════════════════════════════════════════════════════╗
║ Host system is missing dependencies to run browsers. ║
║ Please install them with the following command:      ║
║     pnpm exec playwright install-deps                ║
║ Alternatively, use apt:                              ║
║     apt-get install libx11-6\ libxext6\ libxcb1      ║
╚══════════════════════════════════════════════════════╝
2 failed
  apps/admin-web/src/dashboard.e2e.spec.ts:5:1 › desktop dashboard renders truthful sections, drill-downs and axe-clean
  apps/admin-web/src/dashboard.e2e.spec.ts:39:1 › 320px mobile dashboard reflows, drawer works and stale retry is keyboard operable
```

These are launch failures, not spec failures — the Chromium system libraries
are absent from the read-only sandbox image (same limitation as P7-S4B §7;
apt is read-only). The spec is **mock-based** (`mockAdminApi(page)` route
interception; no live API/database required) and the config starts a local
Vite server at `127.0.0.1:4175` — it is ready to run on the host or in CI
where browser binaries and system libraries exist. Browser flows are
therefore NOT claimed as passed.

### 4.10 No-placeholder scan — PASS (clean; 2 known intentional references)

Scanned `apps/api/src/admin-dashboard/**` and the admin-web dashboard files
(`dashboard-model.ts`, `dashboard-states.tsx`, `dashboard-cards.tsx`,
`dashboard-page.tsx`, `route-manifest.ts`, tests):

- No `TODO` / `FIXME` / `XXX` / `HACK` / `placeholder` code markers in the
  delivered dashboard files. (The words "placeholder"/"fabricated" appear
  only in metric definition prose and comments disclosing that values are
  never fabricated — e.g. catalog M08 definition mentions the
  `NOT_APPLIED` placeholder row, M12 definition states "never fabricated
  from rule versions".)
- No `console.*` leftovers in delivered dashboard files.
- No first-page derivations or client-computed aggregates.
- `dashboard.read` remnants: only two, both outside the delivered scope and
  both intentional/test-related:
  - `apps/admin-web/src/route-manifest.test.ts:64,68` — the zero-drift
    assertion that no manifest route requires `dashboard.read` (correct);
  - `tests/e2e/admin-shell.spec.ts:10,61` — the P7-S4B follow-up item,
    **still present**, see 4.11.

### 4.11 Follow-up verification (tests/e2e/admin-shell.spec.ts) — CONFIRMED STILL PRESENT, NOT MODIFIED

The two `dashboard.read` mock entries noted by P7-S4B §11 are still present,
exact lines:

```
tests/e2e/admin-shell.spec.ts:10:  'dashboard.read',
   (inside mockAdminApi(page, ['dashboard.read', 'admin.profile.self', 'admin.session.read']);)
tests/e2e/admin-shell.spec.ts:61:  await mockAdminApi(page, ['dashboard.read', 'admin.session.read']);
```

This file is outside the allowed paths; it was NOT modified. OpenClaw must
dispatch the flip to `dashboard.view` before running the root e2e suite
(otherwise the dashboard deep link renders permission-denied).

## 3. Defects found

| ID  | Severity                                      | Location                                                                                                                 | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Action                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Medium (test-only, time-dependent flakiness)  | `apps/api/src/admin-dashboard/admin-dashboard.spec.ts:183-209` (test body lines 185-209; FIXED_NOW constant at line 183) | "serves a cached entry as STALE when its asOf violates the freshness class" sets `computedAt: FIXED_NOW.getTime()` with a hard-coded `2026-08-03T12:00:00.000Z`. `DashboardMetricCache.get()` (cache.ts:51) evicts by the real wall clock (`Date.now()`), so once the wall clock drifts > KPI TTL (5 min) past the constant the entry is evicted, the source-query path runs, and the assertion fails (`FRESH` instead of `STALE`). Reproduced today (wall clock 53.5 min past the constant): 15/16 with this single failure. It passed during P7-S4A only because the run happened near the constant. This is a pre-existing test defect in delivered P7-S4A code, NOT a production regression. | REPORTED, NOT FIXED (file outside allowed paths). Recommended fix for OpenClaw dispatch: derive `computedAt`/`asOf` from `Date.now()` at run time (e.g. `computedAt: Date.now() - 1_000`, `asOf: new Date(Date.now() - 400_000)`) or inject a wall-clock provider into `DashboardMetricCache`. Deterministic replacement coverage already added in `apps/api/src/__tests__/admin-dashboard.p7-s4c.spec.ts` (3/3 passing). |
| D2  | Low (documentation wording vs implementation) | `apps/api/src/admin-dashboard/admin-dashboard.catalog.ts:88` (M06) vs `admin-dashboard.service.ts:269-275`               | M06 definition says "whose **latest** merchant KYC submission status is SUBMITTED or UNDER_REVIEW", but the SQL counts distinct branches with **any** submission in those statuses (a branch with a newer APPROVED submission and an older SUBMITTED one is still counted). Fixture values are unaffected.                                                                                                                                                                                                                                                                                                                                                                                       | REPORTED, NOT FIXED (production code). Align the definition text (e.g. "with a merchant KYC submission in SUBMITTED/UNDER_REVIEW") or add a latest-submission predicate — a documentation-only change is sufficient for the current contract.                                                                                                                                                                             |
| D3  | Info (coverage gap, mitigated)                | HTTP-level `503 DASHBOARD_DATA_STALE`                                                                                    | Only the (flaky) unit test covered the STALE path; the HTTP 503 mapping is exercised for UNAVAILABLE (same switch branch in `admin-dashboard.controller.ts:147-148`). The new deterministic spec covers the service-level STALE rejection and asOf provenance.                                                                                                                                                                                                                                                                                                                                                                                                                                   | Mitigated by the new test; no further action required.                                                                                                                                                                                                                                                                                                                                                                    |

## 4. Environment limitations

- Root `/workspace/node_modules` symlinks are broken; every command ran
  inside the worktree (as instructed).
- Playwright browsers cannot launch: Chromium system libraries missing and
  apt is read-only (exact error in 4.9). Browser flows not executed here and
  not claimed as passed; the delivered spec/config are host/CI-ready.
- `openapi:validate` prints the success summary and then the process does not
  exit because a background outbox worker keeps the event loop alive
  (pre-existing script quirk; the validation output is unambiguous PASS).
- `REDEMPTION_VOUCHER_ENCRYPTION_KEY` must be exported as exactly 64 hex
  chars for `openapi:validate` (script provides no default; pre-existing
  gap, script outside allowed paths).
- The unit suite requires `DATABASE_URL` to be exported even for the mocked
  tests (`src/__tests__/env-setup.ts` throws otherwise).

## 5. No-placeholder scan result

CLEAN for the delivered P7-S4 dashboard files (see 4.10). Two `dashboard.read`
references remain in `tests/e2e/admin-shell.spec.ts` (4.11) and two
intentional zero-drift assertions in `route-manifest.test.ts`.

## 6. Follow-up items for OpenClaw

1. **D1 fix** — flip the flaky unit test in
   `apps/api/src/admin-dashboard/admin-dashboard.spec.ts:195-209` to use
   `Date.now()`-relative times (or inject a clock into `DashboardMetricCache`),
   then re-run the unit suite to restore 16/16.
2. **4.11** — flip the two `dashboard.read` mock entries to `dashboard.view`
   in `tests/e2e/admin-shell.spec.ts:10,61` before running the root e2e
   suite (out of allowed paths; not modified here).
3. **D2** — decide whether to align the M06 definition wording (documentation
   change) or the SQL; no value impact on current fixtures.
4. Root e2e (`playwright.admin.config.ts`) must run on the host/CI with
   browser binaries present; the sandbox-compatible config is
   `apps/admin-web/playwright.admin.config.ts`.

## 7. Internal gate result

`OPENCLAW_INTERNAL_GATE_PASSED_WITH_REPORTED_DEFECTS` — every verification
item 4.1–4.11 was executed with exact evidence; no production-code defect
was found that blocks acceptance (D2 is wording-only, D3 is mitigated);
browser execution is environment-blocked and honestly reported as not
executed; the single failing unit test is a pre-existing time-dependent
test defect (D1) that does not affect delivered behavior and has
deterministic replacement coverage committed in this task. Nothing was
pushed.
