# P8-S5a Delivery Report — Advanced Reports Admin Web UI

## 1. Task and scope

- Task (TASK_BRIEF_P8S5.md): extend the **P7-S9 Basic Reports admin-web page** (`apps/admin-web/src/reports-page.tsx`) so it renders all **19 reports (R01–R19)**, including the 15 advanced reports (R05–R19) whose engine/API was delivered and approved in P8-S4 (D-062). The page must keep the same honesty contract as the API: explicit FRESH/STALE/UNAVAILABLE states, `asOf` disclosure, exact-decimal amount strings (never float-rounded), and never a fabricated zero.
- Scope (contract §5 part (a), M-1 precedent): the P8-S2/P8-S4 admin-web UI deferral is now closed for the reports surface. `apps/api/`, `packages/api-client/`, `docs/00-master/`, migrations and checksums are frozen — zero changes.
- Executor: OpenClaw-managed independent coding subagent (D-060 alternate executor authorization; Codex CLI unavailable). Host verifies and dispatches independent review (Reviewer B', D-060).
- Branch: `task/p8-s5-advanced-reports-web` (worktree `.local/wt-p8-s5`, base `f2939ee7`).
- Role boundary: implementation evidence only. This report does not approve or accept P8-S5a; acceptance belongs to Bryan / ChatGPT Command Center.

## 2. Commit plan (commit map)

SHAs are produced at commit time by the host runner. Proposed scoped commit chain:

| #   | Commit subject                                                   | Scope                                                                                               |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | `feat(p8-s5a): render R05–R19 advanced reports in admin-web`     | `apps/admin-web/src/reports-page.tsx`, `apps/admin-web/src/reports-model.ts` (`formatReportAmount`) |
| 2   | `test(p8-s5a): cover R05–R19 rendering, freshness and no-export` | `apps/admin-web/src/reports-page.test.tsx`, `apps/admin-web/src/reports-model.test.ts`              |
| 3   | `docs(p8-s5a): add P8-S5a delivery report`                       | this file                                                                                           |

## 3. Changed files

**Extended (admin-web only; no API / client / governance / migration changes):**

- `apps/admin-web/src/reports-page.tsx`
  - Page header copy: same honesty framing, extended to state that all 19 reports render — basic (R01–R04) and advanced (R05–R19) — and that no CSV or download export exists on this surface. The `Basic reports` heading text is intentionally unchanged (existing tests assert it).
  - `ReportValueTable` now reads `report.value as ReportValueShape` — a discriminated union mirroring the P8-S4 `ReportValue` union in `apps/api/src/admin-report-ops/admin-report-ops.types.ts` (authoritative shapes; every field optional on the read side because the wire value is `Record<string, unknown>`).
  - New kind branches (12 renderers): `OPERATIONS_OVERVIEW` (R05), `LEDGER_VOLUME` (R06), `RECONCILIATION_OVERVIEW` (R07), `MARKET_PROFILE` (R08), `TRANSACTION_VALUE` (R12), `MCP_OVERVIEW` (R13), `REWARD_ACCRUAL` (R14), `COMMISSION_OVERVIEW` (R15), `REDEMPTION_VOLUME` (R16), `FULFILMENT_OVERVIEW` (R17), `REFUND_OVERVIEW` (R18), `RISK_EXCEPTION_OVERVIEW` (R19). `STATUS_COUNTS` (R01, R09, R10, R11) keeps falling through to the existing `CountsTable` fallback (verified against R09/R10/R11 fixtures).
  - New local presentational helpers (same file, unexported): `VolumeGroupsTable` ({count, totalAmount}), `PointsGroupsTable` ({count, totalPoints}), `TransactionValueTable` (by-currency + market totals line), `MarketProfileTable` (identity + real entity counts), `ExceptionsTable` (total/resolved/unresolved), plus a shared `boundedWindowEmptyCopy` for the empty-state message.
  - Amount rendering rule (documented in file comments): every advanced amount arrives as an exact-decimal string (`'187.0000000000'`); it is displayed via `formatReportAmount` (trailing zeros trimmed only when lossless). **No `Number(`/`parseFloat(` anywhere on amounts** — the only `Number(` occurrences in the file are prose comments stating the rule.
  - Empty-state semantics: `No rows in the bounded window (N days).` (the R01–R04 pattern) is replicated for groups/currencies. A `0` in an authoritative row (e.g. MARKET_PROFILE counts) renders as `0` — absence of rows is an empty state, never a fabricated zero row.
  - Every card keeps `data-testid={`report-${report.id}`}` and the `ReportFreshnessLine` disclosure untouched.
- `apps/admin-web/src/reports-model.ts`
  - New pure helper `formatReportAmount(value): string` — lossless exact-decimal display: trims trailing zeros only (`'187.0000000000' → '187'`, `'1.2345678900' → '1.23456789'`), never rounds through float. Null-safe defensive fallback `'0'` for the optional read-side type (never invents a row).
- `apps/admin-web/src/reports-page.test.tsx` — new `advancedReportCatalogFixture()` (R01–R04 + R05–R19, values mirroring the P8-S4 `ReportValue` shapes with numeric(38,10) strings) and a new `describe('P8-S5a advanced reports (R05–R19)')` block (4 tests, see §5).
- `apps/admin-web/src/reports-model.test.ts` — new `describe('formatReportAmount ...')` block (3 tests).

**Unchanged / not touched:** `apps/api/**`, `packages/api-client/**`, `packages/database/**` (migrations + checksums stay 40/40), `docs/00-master/**`, `reports-states.tsx` (no missing state variant — reuse sufficed), the R01–R04 page/model tests.

## 4. Shape-verification notes (types.ts is the source of truth)

- The brief §3.1 table listed 11 new kinds + `STATUS_COUNTS` reuse. **`FULFILMENT_OVERVIEW` (R17) is present in `admin-report-ops.types.ts` but absent from the brief table.** Per brief §6 ("if a shape in types.ts differs from this table, types.ts wins"), the R17 renderer was implemented from types.ts (`exceptions {total, resolved, unresolved}` + `shippingPayments: StatusCounts`) so that all 15 report ids R05–R19 render and are tested. This is the only discrepancy found between the brief table and types.ts.
- All other kinds match types.ts field-for-field: `windowDays`, nested `StatusCounts {total, counts}`, `VolumeGroup {count, totalAmount}`, `TransactionValueGroup {count, totalPurchaseAmount, totalServiceFeeAmount}` + `totals`, `PointsGroup {count, totalPoints}`, MARKET_PROFILE `market`/`counts`. No shape drift beyond the R17 table omission.
- `AdminReportStateDto.value` is `Record<string, unknown>` — no api-client change needed (brief §2 confirmed).

## 5. Tests

### `apps/admin-web/src/reports-page.test.tsx` (new block: 4 tests; existing R01–R04 block untouched and still green)

1. **`renders all 15 advanced reports with names, definitions and key values`** — catalog with all 19 reports; asserts 19 FRESH badges; per report id R05–R19: card shows exact catalog name and a definition snippet; key values asserted per kind via scoped `within(card)` queries — status counts (`count-*`), exact-decimal amounts as exact strings (`amount-DEPOSIT` = `^187$`, `amount-TOP_UP` = `^1000$`, `amount-DAILY` = `^100$`, `amount-PAYOUT` = `^50$`, `purchase-MYR` = `^187$`, `service-fee-MYR` = `^10$`, `points-COMPLETED` = `^10$`), MARKET_PROFILE identity fields (`profile-code/status/currency/timezone`) and real counts incl. a real zero (`profile-mcp-accounts` = `0`), R17 exception summary (`exceptions-total/resolved/unresolved`), and the R12 market-totals line.
2. **`marks advanced reports STALE or UNAVAILABLE — never a fabricated zero`** — R16 forced STALE (stale line + snapshot value still rendered), R19 forced UNAVAILABLE with `SOURCE_QUERY_FAILED` (unavailable line + **no value section, no table**).
3. **`exposes no export/download/CSV affordance on the advanced surface`** — all 19 cards render; no button/link matching `/download|csv|export/i` anywhere (Command Center §7; mirrors the R01–R04 no-export assertion).
4. **`shows the bounded-window empty state for an advanced report with no rows`** — R13 with empty accounts + ledger groups renders `No rows in the bounded window (90 days).` and no fabricated `count-*` row.

### `apps/admin-web/src/reports-model.test.ts` (new block: 3 tests)

- `formatReportAmount` trims trailing zeros losslessly (`'187.0000000000' → '187'`, `'36.0000000000' → '36'`, `'1000.0000000000' → '1000'`, `'10.0000000000' → '10'`, `'0.0000000000' → '0'`, `'-12.0000000000' → '-12'`).
- Keeps meaningful fractional digits (`'1.2345678900' → '1.23456789'`, `'0.5000000000' → '0.5'`, `'123.4500000000' → '123.45'`).
- Leaves non-decimal strings untouched; null-safe (`'187'`, `187`, `undefined → '0'`, `null → '0'`).

### Full suite

- `pnpm --filter @ipoint/admin-web exec vitest run` — **336 passed (41 files)**, including all pre-existing R01–R04 page tests, the axe test and all other admin-web suites (baseline was 329; +7 new).
- `pnpm --filter @ipoint/admin-web build` — clean (`tsc -p tsconfig.build.json` + `vite build`; only the pre-existing >500 kB chunk warning).
- `pnpm lint` — 0 errors (2 pre-existing warnings in untouched `apps/api` files). Note: `apps/admin-web/src/**` is in the repo eslint `ignores` list (baseline decision, untouched).
- `pnpm exec prettier --check` on the 4 changed files — clean.
- `pnpm --filter @ipoint/api typecheck` — not run/changed: zero `apps/api` modifications (baseline known state unchanged).

### Static scan (self-verification)

- No `Number(`/`parseFloat(` on any amount path in `reports-page.tsx` / `reports-model.ts` (only prose comments documenting the rule).
- No export/download/CSV affordance added: no download button/link, no `createObjectURL`/`toBlob`/`window.open`, no new permission codes; the only "export" text is the honesty disclosure "no CSV or download export exists on this surface" (required by the brief).
- Changed files are UTF-8 without BOM; no em-dash mojibake (verified by byte inspection and by the tests rendering the catalog definitions verbatim).

## 6. Host-environment fixes (runner note)

The worktree at `.local/wt-p8-s5` arrived **without `node_modules`** despite the brief's expectation that dependencies were installed. Fixes applied on the host (no repo files affected):

- `pnpm install --offline --prefer-offline` — completed from the local pnpm store (v3, `C:\Users\MSI\AppData\Local\pnpm\store\v3`); no network download (vitest 4.0.14, vite 7.2.6, typescript 5.9.3, etc. resolved offline). The `@ipoint/orm-comparison` postinstall prisma:generate ran offline.
- The worktree `.npmrc` (copied from the main workspace) was **deleted before committing** per brief §3.4 — it is not in any commit.
- No other host repairs were needed; no files outside the changed set were modified.

## 7. Definition of done (verifier checklist)

1. ✅ `pnpm --filter @ipoint/admin-web exec vitest run` — all admin-web tests pass (336, incl. existing + new).
2. ✅ `pnpm --filter @ipoint/admin-web build` — clean.
3. ✅ `pnpm lint` 0 errors; `pnpm exec prettier --check` clean on the 4 changed files.
4. ✅ No API change — `apps/api` untouched (baseline typecheck state unchanged by definition).
5. ✅ Static scan: no export/download/CSV affordance added; no `Number(`/`parseFloat(` on amount strings.
6. ✅ Delivery report present (this file) with §-numbered evidence + commit map (§2).
7. ✅ Hygiene: UTF-8 no BOM, no mojibake, no `.npmrc` committed, no `git add .`, scoped commits only.

## 8. Open items / risks

- None blocking. Reviewer B' may re-check the R17 note in §4 and the `formatReportAmount` signature (`string | number | null | undefined` — widened from the brief's example `(value: string)` for null-safe read-side defense; behavior on real API strings is identical).
