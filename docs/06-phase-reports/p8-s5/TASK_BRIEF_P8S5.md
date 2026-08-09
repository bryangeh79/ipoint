# TASK_BRIEF_P8S5a — Advanced Reports Admin Web UI

> Phase 8 · Sub-phase **P8-S5a** · Branch `task/p8-s5-advanced-reports-web` @ `f2939ee7`
> Contract: `P8_S0_CONTRACT_FREEZE.md` §4 (G-04 advanced reports) + §5 (G-05 UI gap closure, part (a))
> Scope decision: M-1 precedent — the P8-S2/P8-S4 admin-web UI deferral is now implemented for the reports surface.
> Executor: independent coding subagent (D-060 alternate executor authorization) · Verifier: OpenClaw host integration gate · Reviewer: independent Reviewer B' (D-060)

---

## 1. Mission

Extend the P7-S9 **Basic Reports admin-web page** (`apps/admin-web/src/reports-page.tsx`) so it renders all **19 reports (R01–R19)**, including the 15 advanced reports (R05–R19) whose engine/API was delivered and approved in P8-S4 (D-062). The page must present every report's value with the same honesty contract as the API: explicit FRESH/STALE/UNAVAILABLE states, `asOf` disclosure, exact-decimal amount strings (never float-rounded), and **never a fabricated zero**.

## 2. Frozen / Do Not Touch

- ❌ `apps/api/` — P8-S4 API is final (D-062). Zero API changes.
- ❌ `packages/api-client/` — `AdminReportStateDto.value` is already `Record<string, unknown>`; the 11 new kinds need **no client change**. Do NOT add export/download methods.
- ❌ `docs/00-master/`, migrations, checksums (40/40 frozen), frozen owners.
- ❌ No CSV/download/export surface anywhere in the UI (Command Center §7 prohibition; P7-S9 pattern).
- ❌ No new permission codes — `report.read` only (P8-S4 decision).

## 3. Required work

### 3.1 `apps/admin-web/src/reports-page.tsx`
- Page header copy: keep honesty framing; extend to mention advanced reports (R05–R19) alongside basic reports (R01–R04). Do NOT claim export capability.
- Extend `ReportValueTable` with renderers for the 11 P8-S4 value kinds. The authoritative shapes are the P8-S4 `ReportValue` union in `apps/api/src/admin-report-ops/admin-report-ops.types.ts` (read it in the worktree — it is the source of truth):

| Kind | Shape highlights (see types.ts for exact fields) |
|---|---|
| `OPERATIONS_OVERVIEW` | `windowDays`, `kyc: StatusCounts`, `merchantApplications: StatusCounts` |
| `RECONCILIATION_OVERVIEW` | `runs: StatusCounts`, `runItems: StatusCounts` |
| `MARKET_PROFILE` | `market {code,status,currencyCode,timezone}`, `counts {members, merchantBranches, mcpAccounts, activeAgents, activeCatalogItems}` |
| `LEDGER_VOLUME` | `windowDays`, `groups: Record<string, VolumeGroup>` (`{count,totalAmount}`) |
| `TRANSACTION_VALUE` | `windowDays`, `byCurrency: Record<string, TransactionValueGroup>` (`{count,totalPurchaseAmount,totalServiceFeeAmount}`), `totals` |
| `MCP_OVERVIEW` | `accounts: StatusCounts`, `ledger {windowDays, groups}` |
| `COMMISSION_OVERVIEW` | `windowDays`, `ledger {groups}`, `adjustments: StatusCounts` |
| `REWARD_ACCRUAL` | `windowDays`, `accruals {groups}`, `plans: StatusCounts` |
| `REDEMPTION_VOLUME` | `windowDays`, `orders: Record<string, PointsGroup>` (`{count,totalPoints}`), `items: StatusCounts` |
| `REFUND_OVERVIEW` | as defined in types.ts (counts + amounts per status) |
| `RISK_EXCEPTION_OVERVIEW` | as defined in types.ts (exception categories/counts) |
| `STATUS_COUNTS` (R09/R10/R11 reuse) | already renderable via existing `CountsTable` — ensure it works for these reports |

- **Amount rendering rule**: all amounts arrive as exact-decimal strings (`'187.0000000000'`). Display them **as-is** (trim trailing zeros only for display is acceptable if done losslessly, e.g. `187`), NEVER `Number(...)`/`parseFloat` for display. Document the rule in a comment.
- Reuse existing `CountsTable` and design-system components (`Table`, `Card`); add small local presentational helpers (e.g. `VolumeGroupsTable`, `ByCurrencyTable`, `MarketProfileTable`) in the same file or `reports-states.tsx` if state/empty/error variants are needed.
- Empty-state semantics: `No rows in the bounded window (N days).` pattern already used for R01–R04; replicate for groups/currencies. A `0` count in an authoritative row IS a real zero and must render as `0` (the API only returns rows that exist; absence ≠ zero).
- Keep every card's `data-testid={`report-${report.id}`}` and freshness disclosure untouched.

### 3.2 `apps/admin-web/src/reports-model.ts`
- Add pure helpers if needed (lossless amount display, e.g. `formatReportAmount(value: string): string`). Unit-test them.

### 3.3 Tests (REQUIRED — gate is red without them)
- `apps/admin-web/src/reports-page.test.tsx`: add one render assertion per new kind (R05, R06, R07, R08, R09, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19 — cover all 15 report ids through catalog rendering), asserting: report name/definition shown, key values visible (counts, amounts as exact strings, market profile fields), STALE/UNAVAILABLE markers still render per report, and **no export button/link anywhere** (query for download/export affordances and assert absence).
- `apps/admin-web/src/reports-model.test.ts`: unit tests for new helpers.
- Existing R01–R04 tests must keep passing unchanged (regression).
- Follow existing test style (testing-library, `data-testid`, mock `adminReportOpsApi.listReports`/`getReport` via the established pattern in `reports-page.test.tsx`).

### 3.4 Hygiene
- UTF-8 no BOM; correct Unicode (no em-dash mojibake — P8-S3 L-1..L-3 lesson); no `git add .`; commit scoped.
- Do NOT commit `.npmrc` (copy of the main workspace one exists in the worktree — delete it before committing).
- No secrets, no placeholder keys.

## 4. Definition of done (verifier will check)

1. `pnpm --filter @ipoint/admin-web exec vitest run` — all admin-web tests pass (existing + new).
2. `pnpm --filter @ipoint/admin-web build` — clean.
3. `pnpm lint` clean; `pnpm exec prettier --check` clean on changed files.
4. `pnpm --filter @ipoint/api typecheck` unchanged vs baseline (no API change; baseline pre-existing failures only).
5. Static scan: no `export`/download/CSV affordance added; no `Number(`/`parseFloat(` on amount strings.
6. Delivery report `docs/06-phase-reports/p8-s5/P8_S5A_DELIVERY_REPORT.md` with §-numbered evidence + commit map.

## 5. Deliverables

- `apps/admin-web/src/reports-page.tsx` (extended renderers)
- `apps/admin-web/src/reports-model.ts` (+ helpers)
- `apps/admin-web/src/reports-page.test.tsx` / `reports-model.test.ts` (extended)
- `docs/06-phase-reports/p8-s5/P8_S5A_DELIVERY_REPORT.md`
- Commits: scoped `feat(p8-s5): ...` / `test(p8-s5): ...` / `docs(p8-s5): ...`

## 6. Notes

- The API returns `value` with a `kind` discriminant; the existing page reads `report.value as {kind?...}` — keep that pattern, extended with the new shapes.
- `reports-states.tsx` changes are allowed only if a state variant is genuinely missing; prefer reuse.
- If a shape in types.ts differs from this table, **types.ts wins** — and note the discrepancy in the delivery report.
