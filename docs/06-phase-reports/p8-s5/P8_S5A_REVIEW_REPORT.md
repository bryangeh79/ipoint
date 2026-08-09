# P8-S5a Review Report — Advanced Reports Admin Web UI (Reviewer B')

> Reviewer: **Reviewer B'** (independent, D-060 authorized) · Reviewed branch `task/p8-s5-advanced-reports-web` @ `84555d86` (worktree `.local/wt-p8-s5`, base `f2939ee7`) · Review date: 2026-08-09 · Communication language: Chinese (report content in English per project convention)

---

## Verdict: **APPROVED**

No Critical, High or Medium findings. Four Low-level observations (non-blocking, documented below). All six checklist areas (A–F) verified against the actual code, the authoritative API types, and independently re-run tooling — not against the implementer's self-assessment.

## Independent verification performed

The reviewer read every file in the change set and the authoritative API sources, and re-ran the tooling:

- `pnpm --filter @ipoint/admin-web exec vitest run` (full suite): **336 passed (41 files)** — matches the delivery report exactly (baseline 329 + 7 new).
- Targeted suites: `reports-page.test.tsx` 8/8 passed (4 R01–R04 + 4 P8-S5a), `reports-model.test.ts` 6/6 passed.
- `pnpm --filter @ipoint/admin-web build` (`tsc -p tsconfig.build.json && vite build`): exit code 0, `dist/` produced.
- `pnpm exec prettier --check` on the 4 changed source files + delivery report: clean.
- `git diff f2939ee7..HEAD --stat`: exactly 6 files (4 admin-web sources/tests + 2 p8-s5 docs). `git diff f2939ee7..HEAD` for `apps/api`, `packages/api-client`, `packages/database`, `docs/00-master`: **empty**. `git status --short`: clean; no untracked files; `git ls-files` contains no `.npmrc`/secret files.
- Byte-level scan of the 5 changed text files: **no BOM**; em-dashes are proper U+2014 (E2 80 94); **zero mojibake sequences** (P8-S3 L-1..L-3 lesson respected).
- Commit map verified against delivery report §2: `e20c75e2` feat (reports-page.tsx, reports-model.ts) · `7ac9bce4` test (reports-page.test.tsx, reports-model.test.ts) · `983fffe4` docs (delivery report) · `84555d86` docs (task brief). Scoped commits only; no `git add .`.

---

## Findings

### Critical

None.

### High

None.

### Medium

None.

### Low

**L-1 — Page header title still reads "Basic reports" while the page renders 19 reports**
- Location: `apps/admin-web/src/reports-page.tsx:61` (PageHeader `title`).
- Issue: The page now renders all 19 reports (R01–R19) but the visible heading remains "Basic reports". The `description` below it is fully honest ("All 19 reports render here — basic (R01–R04) and advanced (R05–R19)… no CSV or download export exists on this surface"), so this is a naming staleness issue, not a honesty issue.
- Reason: Title is intentionally preserved because the pre-existing P7-S9 tests assert the heading `Basic reports` (regression contract, brief §3.1 allows keeping honesty framing). The brief's "extend header copy" requirement is satisfied by the description.
- Suggestion: In a future phase, rename the heading to something like "Operational reports" with a coordinated test update, or accept as-is. Non-blocking.

**L-2 — `formatReportAmount` null/undefined → `'0'` fallback is a defensive-only fabricated zero**
- Location: `apps/admin-web/src/reports-model.ts:29-36`.
- Issue: A `null`/`undefined` amount inside an existing row would display as `0`.
- Reason: The authoritative P8-S4 types (`VolumeGroup.totalAmount`, `TransactionValueGroup.total*`, `PointsGroup.totalPoints` are `string`, non-nullable) guarantee this never occurs from a compliant API; rows are never invented (absence of rows = empty state, and the empty state renders before any row). The fallback exists only for the read-side optional cast surface and is documented in the file comment and delivery report §8.
- Suggestion: If stricter honesty is ever desired, render `'—'`/empty for nullish amounts; behavior on real API strings is unaffected. Non-blocking.

**L-3 — Point-in-time accounts tables reuse the "bounded window" empty-state copy without a day count**
- Location: `apps/admin-web/src/reports-page.tsx:300-306` (MCP_OVERVIEW accounts `CountsTable` — no `windowDays` prop) and the STATUS_COUNTS fallback for point-in-time reports.
- Issue: An empty accounts status distribution renders "No rows in the bounded window." (no `(N days)` suffix) — the "bounded window" phrasing is semantically odd for a point-in-time distribution (accounts are not window-bounded).
- Reason: This is the generic `CountsTable` copy established in P7-S9 and already used for windowDays-0 reports (R03/R09/R10/R11), so it is consistent with the existing pattern and the brief's "replicate the R01–R04 pattern" instruction.
- Suggestion: Optional future copy refinement (e.g. "No rows." for point-in-time tables). Non-blocking.

**L-4 — Minor test-coverage boundary gaps (non-blocking)**
- Location: `apps/admin-web/src/reports-model.test.ts` (formatReportAmount block) and `reports-page.test.tsx:703-718` (no-export test).
- Issue: (a) `formatReportAmount` unit tests do not explicitly cover `'-0.0000000000' → '0'` or a large integer with trailing zeros (e.g. `'123450000.0000000000'`), though the implementation handles both (`trimmed === '-0' → '0'`; lossless regex trim) — behavior verified by reading the code; (b) the no-export assertion queries only `role=button`/`role=link` with a `/download|csv|export/i` name.
- Reason: The no-export pattern mirrors the established P7-S9 assertion verbatim (brief §3.3 requires mirroring), and the gap is closed by the static scan: zero occurrences of `createObjectURL`/`toBlob`/`window.open` in the change set. Both are adequate as-is.
- Suggestion: Optionally add the two `formatReportAmount` boundary cases. Non-blocking.

---

## Checklist A–F

### A. No export surface ✅
- `grep` over the 4 changed source files: no `createObjectURL`, `toBlob`, `window.open`, no download button/link; the only `export`-adjacent text is the honesty disclosure ("no CSV or download export exists on this surface") and module-level `export function` declarations (pre-existing pattern).
- `reports-page.tsx` exports only `ReportsPage`; all new presentational helpers (`VolumeGroupsTable`, `PointsGroupsTable`, `TransactionValueTable`, `MarketProfileTable`, `ExceptionsTable`, `boundedWindowEmptyCopy`) are unexported local functions.
- Tests assert absence of any button/link matching `/download|csv|export/i` on the full 19-report catalog (P8-S5a test #3) and on the R01–R04 catalog (regression test).
- No new permission codes: all fixture entries use `permission: 'report.read'`; `report.read` semantics unchanged (verified against `admin-report-ops.types.ts` `ReportDefinition.permission: 'report.read'`).
- `git diff f2939ee7..HEAD`: **zero changes** to `apps/api/**`, `packages/api-client/**`, `packages/database/**`, `docs/00-master/**`; the change set is exactly 4 admin-web files + 2 p8-s5 docs. `reports-states.tsx` diff: 0 lines (untouched).

### B. Rendering correctness ✅
- All 12 new kind branches in `ReportValueTable` (`OPERATIONS_OVERVIEW`, `RECONCILIATION_OVERVIEW`, `MARKET_PROFILE`, `LEDGER_VOLUME`, `TRANSACTION_VALUE`, `MCP_OVERVIEW`, `COMMISSION_OVERVIEW`, `REWARD_ACCRUAL`, `REDEMPTION_VOLUME`, `FULFILMENT_OVERVIEW`, `REFUND_OVERVIEW`, `RISK_EXCEPTION_OVERVIEW`) compared field-for-field against the authoritative `ReportValue` union in `apps/api/src/admin-report-ops/admin-report-ops.types.ts`: **all match** (read-side optionality is the only delta, which is correct for a `Record<string, unknown>` wire value).
- **R17 claim verified true**: `FULFILMENT_OVERVIEW` (`exceptions {total, resolved, unresolved}` + `shippingPayments: StatusCounts`) exists in `admin-report-ops.types.ts` and is absent from the brief §3.1 table (12 rows listed, no FULFILMENT_OVERVIEW). Per brief §6 ("types.ts wins"), implementing R17 from types.ts is correct and is the only table/types discrepancy — delivery report §4 accurately documents it.
- `STATUS_COUNTS` reuse (R09/R10/R11): the existing `CountsTable` fallback renders counts + `count-total`; verified via fixtures with `kind: 'STATUS_COUNTS'`, `total`, `counts` and asserted in the R09/R10/R11 test entries (`count-ACTIVE`, `count-total`).
- Catalog copy correspondence: all 15 report names and definition snippets asserted in tests match `admin-report-ops.catalog.ts` verbatim (R05–R19 name/definition cross-checked line by line); fixture `freshnessClass` (KPI/QUEUE) matches catalog for all 15.
- `data-testid` stability: `report-${report.id}` per card preserved; new scoped testids (`count-*`, `amount-*`, `points-*`, `purchase-*`, `service-fee-*`, `profile-*`, `exceptions-*`, `transaction-totals`) follow the established naming pattern and are asserted via `within(card)` scoped queries.

### C. Amount honesty ✅
- `formatReportAmount` (`reports-model.ts`) is pure string manipulation: trims trailing zeros via regex only when lossless (`'187.0000000000' → '187'`, `'1.2345678900' → '1.23456789'`, `'0.0000000000' → '0'`, `'-12.0000000000' → '-12'`); never passes through `Number()`/`parseFloat`.
- Static scan: the only `Number(`/`parseFloat` occurrences in `reports-page.tsx`/`reports-model.ts` are prose comments documenting the rule; no amount path converts to float.
- No fabricated zeros: `0` renders only from authoritative rows (e.g. R08 fixture `mcpAccounts: 0` asserted to render `'0'`; R16 stale snapshot renders its real value `points-COMPLETED = 10`); absence of rows renders the bounded-window empty state (R13 test) — never a zero row.
- STALE/UNAVAILABLE/`asOf`/freshness disclosure: `ReportFreshnessLine` and `ReportFreshnessBadge` in `reports-states.tsx` are untouched (0-line diff); R16 forced STALE and R19 forced UNAVAILABLE (`SOURCE_QUERY_FAILED`) both asserted — stale line + snapshot value, unavailable line + reason + **no value section/table**.
- The R17/R18/R12/R06 amounts are asserted as exact anchored strings (`/^187$/u`, `/^1000$/u`, `/^100$/u`, `/^50$/u`, `/^10$/u`) — proving lossless display, not float-rounded values.

### D. Honest / empty-state semantics ✅
- Empty-state copy `No rows in the bounded window (N days).` is the exact R01–R04 pattern (pre-existing `CountsTable`; verified unchanged in base `f2939ee7`), replicated for groups/currencies via the shared `boundedWindowEmptyCopy` helper (R13 test asserts `No rows in the bounded window (90 days).` and absence of a fabricated `count-*` row).
- UNAVAILABLE shows the reason and never a zero (R19 test: `report-unavailable-line` contains "never fabricated", no table rendered).
- Page header is honest: explicitly states all 19 reports render, each shows definition/source/as-of/freshness, unavailable marked (never a fabricated zero), stale flagged, and "no CSV or download export exists on this surface" (L-1 naming note notwithstanding).

### E. Test coverage ✅
- `reports-page.test.tsx` P8-S5a block covers **all 15 advanced ids (R05–R19)** in a single catalog-driven test, each asserting: exact catalog name, definition snippet, and per-kind key values via `within(card)` testing-library queries (real rendering, not implementation details): status counts incl. `count-total`, exact-decimal amounts (`amount-*`, `purchase-*`, `service-fee-*`, `points-*`), MARKET_PROFILE identity + real counts incl. a real zero, R17 exception summary, R12 market totals line.
- STALE (R16) + UNAVAILABLE (R19) markers; no-export assertion (buttons + links); bounded-window empty state (R13).
- Existing R01–R04 block untouched (diff shows additions only; the `describe('P7-S9 basic reports page')` block, incl. axe test, still green).
- `reports-model.test.ts` `formatReportAmount` unit tests cover: lossless trailing-zero trim (incl. all-zero `'0.0000000000' → '0'` and negative `'-12.0000000000' → '-12'`), meaningful fractional digits preserved, non-decimal strings untouched, null/undefined defensive fallback (see L-4 for the only minor boundary gaps).
- Full suite independently re-run: **336 passed (41 files)** — matches the delivery report; +7 new tests = baseline 329.

### F. Code quality / hygiene ✅
- Renderer maintainability: heavy reuse of `CountsTable` (9 usages) and design-system `Table`/`Card`; 5 small unexported presentational helpers for genuinely distinct shapes; one shared empty-state helper; discriminated-union read-side cast mirrors types.ts with a clear comment block.
- `reports-states.tsx` untouched — no missing state variant, reuse sufficed (brief §6 honored).
- No BOM; no mojibake (byte-verified, U+2014 proper); no secrets/placeholder keys (grep + `git ls-files`); `.npmrc` absent from all commits; worktree clean; commit map matches delivery report §2; prettier clean on all changed files; build clean (exit 0).
- `reports-model.ts` `formatReportAmount` signature widened to `string | number | null | undefined` from the brief's `(value: string)` — disclosed in delivery report §8; behavior on real API strings identical (verified).

---

## Declaration of independence

This review was performed by Reviewer B' reading the actual implementation in the worktree `.local/wt-p8-s5` at commit `84555d86` — the page renderer, model helpers, both test files, `reports-states.tsx`, the authoritative `admin-report-ops.types.ts` and `admin-report-ops.catalog.ts` — and independently re-running the test suite (336 passed), the production build (exit 0), prettier checks, git diff/status/ls-files verification and byte-level encoding scans. No conclusion in this report relies on the implementer's self-assessment; delivery-report claims were each re-verified against the code or re-executed tooling. Acceptance remains with Bryan / ChatGPT Command Center per the P8-S5a role boundary.

---

## Summary

- **Verdict: APPROVED**
- Findings: 0 Critical · 0 High · 0 Medium · 4 Low (L-1 stale page title, L-2 defensive `'0'` fallback semantics, L-3 point-in-time empty-state copy, L-4 minor test boundary gaps — all non-blocking, documented above).
- Checklist: A ✅ · B ✅ · C ✅ · D ✅ · E ✅ · F ✅
