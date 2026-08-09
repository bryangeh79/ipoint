# P8-S4 Review Report — Advanced Reports (G-04)

> **Reviewer:** Independent Reviewer B' (D-060 authorization) · **Session:** `P8-S4 Reviewer B'` (subagent `61a55e22`, requester `agent:main:dashboard:9c20dadf`)
> **Reviewed object:** worktree `.local/wt-p8-s4`, branch `task/p8-s4-advanced-reports` @ `bc56361a` (3 P8-S4 commits on `061b2409`: `486d0069` feat, `82294c37` test, `bc56361a` docs — working tree clean)
> **Date:** 2026-08-09
> **Review method:** independent line-by-line review of the actual code in the worktree against the P7-S9 baseline (`apps/api/src/admin-report-ops/` in the main workspace), the contract (`P8_S0_CONTRACT_FREEZE.md` §4), the task brief (`TASK_BRIEF_P8S4.md`), and the delivery report (`P8_S4_DELIVERY_REPORT.md`). This review does **not** rely on the implementer's self-checklist; host-gate execution claims (fresh-PG runs, typecheck, build, lint, drift, checksums) are recorded as host evidence only and are identified as such where referenced.

---

## Verdict: **APPROVED**

No Critical, High, or Medium findings. Three Low findings and two informational notes are recorded below; none block acceptance. All eight review areas (A–H) pass with evidence.

---

## Findings

### Critical
None.

### High
None.

### Medium
None.

### Low

**L-1 — Finance/commission/refund monetary aggregates gated by `report.read` (all controlled roles).**
- **File:** `apps/api/src/admin-report-ops/admin-report-ops.catalog.ts` — R06 (line 96), R12 (line 180), R15 (line 222), R18 (line 264); decision rationale in `P8_S4_DELIVERY_REPORT.md` §5.
- **Issue:** R06 (wallet entry volume), R12 (confirmed transaction value), R15 (commission ledger amounts) and R18 (refund counts) expose monetary **sums** (exact-decimal strings) to every controlled role that holds `report.read`, not just finance-role holders. P7-S9's R01–R04 were count-only aggregates (R02 counts adjustments but no amounts); the P8-S4 finance views add amount totals.
- **Rationale considered:** the reuse decision is defensible and explicitly sanctioned by the task brief §2 ("mirror P7-S9 zero-new-permission precedent where defensible") and contract §4 ("catalog permissions for the new report surface (or reuse of existing `report.read` with recorded rationale)"). Payloads are masked aggregate-only projections (no entity identifiers, no protected references, no voucher/token values — `containsRawIdentifier` asserted), so the per-domain sensitive raw-read permissions (`merchant.mcp.view`, `wallet.ipoint.read`, `commission.read`, `redemption.order.read`, `risk.view`) are not bypassed: those gate raw administrative detail views, not aggregates. The bounded addendum path (new finance-scoped codes + migration 0040 + parity updates) is documented in delivery report §5.
- **Suggestion:** record this surface for Command Center visibility at final acceptance; if finance aggregates must be finance-role-restricted, apply the documented bounded addendum. Not a blocker under the current contract reading.

**L-2 — Failed-source HTTP-level behavior is not exercised on a real database; `NO_DURABLE_SOURCE` branch untested.**
- **File:** `apps/api/src/admin-report-ops/admin-report-ops-advanced.integration.spec.ts` (no fault-injection scenario); `admin-report-ops.spec.ts` (no `NO_DURABLE_SOURCE` case).
- **Issue:** the failed-source → UNAVAILABLE (`SOURCE_QUERY_FAILED`) and STALE (peek-after-failure) state machine is covered only in the unit suite via a mocked pool (`dbMock({ fail: true })`, `failNext`), not over real PG. The `NO_DURABLE_SOURCE` → UNAVAILABLE branch is untested in both suites (all 19 catalog entries are `REAL`). This mirrors the P7-S9 baseline gap (same absence in the baseline spec) — not introduced by P8-S4.
- **Suggestion (optional):** a future test could seed a catalog entry with `availability: 'NO_DURABLE_SOURCE'` (unit) and/or inject a failing query hook (integration) to pin the `unavailableReason` contract. Does not affect the delivery verdict: the brief §4 requirement ("unconfigured/failed source → UNAVAILABLE, never 0-as-real") is covered at unit level and the code path is verified identical to P7-S9.

**L-3 — Integration test suite relies on host-claimed green runs for the snapshot/velocity assertions.**
- **File:** `admin-report-ops-advanced.integration.spec.ts` (zero-DML snapshot test, RBAC, SLA `<` assertions).
- **Issue:** correctness of the "45 tables byte-identical" and per-category value assertions ultimately depends on execution against a fresh `ipoint_p8s4_*` database; the fail-closed guard (`P8S4_DESTRUCTIVE_TEST` + name pattern) is correctly implemented and the assertions are deterministic (fixed fixture amounts, dedicated actors/markets), but execution evidence is host-claimed. Independent re-execution is the C-verifier's step.
- **Suggestion:** none required for this review; record host gate output as C-verification input.

### Informational notes

- **N-1 — R12 LEFT JOIN semantics are safe because of a canonical 1:1 constraint.** The `count(*)`/`sum(purchase_amount)` over `transactions t LEFT JOIN transaction_service_fees f` cannot double-count: `packages/database/schema/index.ts` defines `unique('transaction_service_fees_transaction_unique')` on `transactionId`. Verified in the canonical schema; the definition text documents the join and the CONFIRMED-only filter.
- **N-2 — §15 host fixes are test/type-only and do not change production behavior.** (1) `ReportId` union widened R01–R04 → R01–R19 in `types.ts` (type-level fix for the catalog additions; runtime catalog was already 19 items); (2) `kind: string` narrowing in 23 `as {` assertions + one `as unknown as` (spec-only); (3) `ReportSnapshotCache(16)` → `ReportSnapshotCache(64)` at 4 spec sites — production default remains 128 (`admin-report-ops.cache.ts` byte-identical to baseline; `Math.max(1, maxEntries ?? 128)`). The 16→64 change is required for test determinism: the catalog() iteration sets 19 cache entries, so a 16-entry LRU evicts the manually-seeded R01 entry before the STALE-serving assertion; 64 keeps it. Verified by re-running the logic by inspection.

---

## Checklist A–H

### A. Read-only & zero side effects — ✅

- **All 15 advanced queries are SELECT-only.** Reviewed every query in `admin-report-ops.service.ts` R05–R19 (lines 417–836): all are `SELECT ... FROM ... WHERE market_id/market = $n [AND window] GROUP BY ...` with `count(*)`, `sum(...)::text`, `FILTER`; zero `INSERT/UPDATE/DELETE/TRUNCATE/DROP/CREATE/ALTER`. Regex scan of the service found 0 DML matches; only 2 `pool().query` call sites (`marketRow`, `queryRows` helper).
- **No write path in the module.** Only in-memory `ReportSnapshotCache.set` (not a DB write) and `Logger.warn`. Controller/cache/errors are **byte-identical** to the P7-S9 baseline (verified with `fc`); the module gains no write surface.
- **45-table byte-identical assertion exists.** `admin-report-ops-advanced.integration.spec.ts` (zero-DML test) snapshots exactly **45** frozen tables (counted: 45 unique names, no duplicates — financial + ledger + reward + commission + redemption + reconciliation + risk) via `sha256(JSON.stringify(rows ORDER BY id))` before vs after running the full catalog + all 19 detail reads, asserting byte-identical hashes per table.
- **No export surface.** Controller has exactly two GET endpoints (unchanged from P7-S9). Unit test asserts GET-only via `Reflect.getMetadata('method')`; integration asserts POST → 404 on catalog, detail, and `/R05/export` paths. No CSV/download method, route or UI anywhere in the module (grep-verified; the only "export" occurrences are TS `export` keywords, doc comments, and the POST→404 assertion itself).

### B. The 15 report definitions (R05–R19) — ✅

- **Correctness per category (definition ↔ SQL ↔ canonical schema):** each of R05–R19 was cross-checked: catalog `definition`/`source` text matches the actual SQL in `queryValue`; every referenced table and column exists in the canonical schema (`packages/database/schema/index.ts` + `redemption.ts`), including `member_kyc_cases`, `merchant_applications`, `member_wallet_entries`, `reconciliation_runs`/`_run_items`, `risk_events`, `risk_review_queue`, `reconciliation_exceptions`, `mcp_refund_requests`, `redemption_refund_requests`, `redemption_fulfilment_exceptions`, `redemption_shipping_payments`, `commission_ledger`, `commission_adjustment_request`, `reward_daily_accruals`, `reward_plans`, `mcp_accounts`, `mcp_ledger_entries`, `agent_activation`, `redemption_orders`, `redemption_catalog_items`, `transaction_service_fees`, `markets` (id/code/status/currency_code/timezone).
- **Market scoping:** every query filters by the server-owned market id (UUID) or market code (R11/R15 use `market.code` — correct, those tables are code-keyed). No client-controlled value enters a filter except through parameterized `$n` binds.
- **Bounded windows:** KPI reports R05/R06/R12/R13/R14/R15/R16/R18 use `make_interval(days => $2)` with `windowDays` 30–90 (≤ 90d cap asserted in unit tests); QUEUE reports R07/R08/R09/R10/R11/R17/R19 are point-in-time (`windowDays: 0`, no `make_interval` — asserted per report in unit tests).
- **Exact decimals as strings:** all monetary/points sums are `coalesce(sum(x), 0)::text` transported as strings (`totalAmount`, `totalPurchaseAmount`, `totalServiceFeeAmount`, `totalPoints`); no float arithmetic anywhere (E-04). R12 join is 1:1-safe (N-1).
- **No fabricated zero:** `resolveState` (identical to P7-S9) returns `UNAVAILABLE` with `unavailableReason` for `NO_DURABLE_SOURCE`/`SOURCE_QUERY_FAILED` (no snapshot), `STALE` with the previous snapshot after a failed re-query, and real FRESH aggregates otherwise. Real-empty aggregates (e.g., empty-market R06 `groups: {}`) are truthful `count(*)` results, asserted as such in integration.
- **Existing canonical sources only; no invented business rules:** all sources are frozen tables; aggregations are plain GROUP BY status/type/severity/currency; no invented thresholds, rates, or rules. R19 reads only `risk_*` + `reconciliation_*` tables (contract requirement), verified.

### C. P7-S9 owner pattern preservation — ✅

- **Adapter/read-only shape untouched:** `admin-report-ops.controller.ts`, `admin-report-ops.cache.ts`, `admin-report-ops.errors.ts` byte-identical to baseline. `service.ts` extended additively (new private query methods + switch cases R05–R19); `resolveState`, `catalog`, `report` bodies unchanged. `module.ts` doc-only change (verified by diff). `app.module.ts` untouched (module already registered).
- **Response envelope unchanged:** `asOf` (source-query time), `freshness` (FRESH/STALE/UNAVAILABLE), `stale`, `unavailable` (+`unavailableReason`), `queryDurationMs` (absent on cache hits), `items` — byte-identical code paths; integration asserts all fields on all 19 catalog items and the cache-hit `asOf`/`queryDurationMs` semantics.
- **Masking rule correct and asserted:** `containsRawIdentifier` (new in P8-S4, strengthens the P7-S9 masking policy) deep-searches strings/arrays/objects for UUIDs and the frozen-owner prefixes (`acct_`, `M-`, `R-`, `RCPT_`, `ORD_`, `CASE_`, `ref_`, `ik-`); unit tests cover detection (7 raw shapes) and safe aggregates (statuses, currencies, decimals); integration asserts all 19 payloads are identifier-free; unit asserts every catalog value stays identifier-free.

### D. Permissions — ✅

- **Reuse of `report.read` is reasonable and documented.** Rationale in delivery report §5 (masked aggregate-only projections; no raw identifiers → per-domain sensitive read permissions not bypassed; P7-S9 zero-new-permission precedent; brief §2 explicitly endorses mirroring it). The exposure of monetary sums to all `report.read` roles is recorded as L-1 for Command Center visibility; the bounded addendum path is documented. Zero new permission codes → zero migration (verified: `packages/database/**` unchanged — 0 differing files across migrations/src/seeds/schema; the only tests-directory difference is the untracked pre-existing `p6-s1-schema.test.ts` present in main but absent from the worktree, which is one of the 119 untracked files and not a P8-S4 change).
- **RBAC annotations correct:** both endpoints carry `@RequirePermission('report.read', { marketScoped: true })`, GET-only; unit tests assert the metadata; integration proves 401 (unauthenticated), 403 (member session), 403 (admin without `report.read`), and the canonical 409 `MARKET_CONTEXT_MISMATCH`.

### E. Cache semantics — ✅

- **`resolveState` cached/peek/STALE/UNAVAILABLE branches identical to P7-S9** (verified line-by-line against the baseline service: same `cache.get` TTL check, same `evaluateReportFreshness`, same `peek`-on-failure STALE path, same UNAVAILABLE fallback, same `computedAt`/`asOf` handling). `cache.ts` byte-identical.
- **§15 #3 fix (16→64 test parameter) is reasonable:** production default 128 unchanged; the catalog() path now stores 19 entries, so the P7-S9-era 16-entry test LRU would evict the manually-seeded R01 entry before the STALE-serving assertion (verified by tracing the set/evict sequence); 64 is a test-parameter parity update only (N-2).

### F. §15 host fixes — ✅ (no production behavior change)

1. **ReportId union R01–R19** (`types.ts`) — type-level widening required for the 15 catalog additions (TS2322); runtime behavior unchanged. Verified.
2. **Spec narrowing** (`kind: string` in 23 `as {` assertions, `as unknown as` at 1 site, deduped fixture insert) — spec-only type repairs; verified in `admin-report-ops.spec.ts` and the advanced spec.
3. **Cache capacity 16→64 at 4 sites** — test-only; production default 128 unchanged (see E). All three fixes are class-consistent with the delivery report's §15 table and introduce no production change (N-2).

### G. Test coverage — ✅ (matches TASK_BRIEF §4)

- **Counts verified in source:** unit `it()` = **34**, advanced integration `it()` = **32**, P7-S9 integration `it()` = **14** (delivery report claims 34/32/14 — matches).
- **Brief §4 requirements mapped:**
  - one real scenario per advanced category → 15/15 (R05–R19 integration tests with exact fixture values, e.g., R06 `36.0000000000`/`10.0000000000`, R12 `187.0000000000`/`10.0000000000`);
  - RBAC 401/403/409 → covered (catalog + detail);
  - market isolation → market B aggregates contain only B rows (R09/R11), market A free of foreign rows, URL-vs-current-market 409;
  - masking → all 19 payloads identifier-free;
  - no-export → POST → 404 on 3 paths;
  - no-fabricated-zero → empty-market real-empty aggregates, unknown id 422 `REPORT_UNDEFINED`, unit-level failed-source UNAVAILABLE/STALE (L-2 notes the HTTP-level gap);
  - zero-DML → 45-table sha256 snapshot before/after all 19 reports;
  - freshness/SLA → first live reads carry `queryDurationMs` under QUEUE ≤ 60s / KPI ≤ 5m; cached read keeps `asOf`, no `queryDurationMs`;
  - P8-S3 fixture lessons applied: MCP ledger via `append_mcp_ledger_entry` only, `BigInt` entry sequences, per-row unique idempotency keys, exclusion-safe service-fee periods, MCP recharge covers fixture deduction amounts, enum casts `as never`, fail-closed DB guard (`P8S4_DESTRUCTIVE_TEST` + `^ipoint_p8s4_` pattern + protected-name rejection + opt-in unit tests).
- Host gate: unit 34/34, advanced 32/32 (fresh `ipoint_p8s4_test` + `P8S4_DESTRUCTIVE_TEST`), P7-S9 integration 14/14 — recorded as host evidence (L-3).

### H. Git/boundaries/encoding — ✅

- **Changed-file scope matches the delivery report exactly:** `git diff --stat 061b2409..bc56361a` = 9 files: types/catalog/service/module/unit spec/P7-S9 integration spec (parity only — verified the only content change is the catalog-length block 4→19)/new advanced spec/delivery report/task brief. Controller, cache, errors byte-identical; `packages/database/**`, `apps/admin-web`, `apps/api/src/app.module.ts`, `packages/api-client` untouched. Working tree clean; branch `task/p8-s4-advanced-reports`; 3 commits matching the proposed commit plan.
- **No secrets/placeholders/test deletions:** no TODO/FIXME/XXX/placeholder markers; only test-fixture credentials mirroring P7-S9 (`P8-S4-Advanced-Reports-Password-123!`, pepper/encryption-key stubs). No test files removed.
- **Encoding:** all 12 reviewed files verified UTF-8 **without BOM** and free of em-dash mojibake (byte-level check: no `EF BB BF` header; no `Ã`/`â€`/replacement chars; proper `—`/`·`/`§` Unicode present in module/catalog comments — P8-S3 L-1/L-2/L-3 lessons respected).
- **Frozen owner untouched:** P7-S9 owner patterns preserved (C); frozen financial tables are read-only projections only; zero migration (checksums 40/40 claim corroborated by 0 differing files under `packages/database/migrations` and `src` vs baseline).

---

## Conclusion

The delivery satisfies the P8-S0 contract §4 and TASK_BRIEF P8-S4 scope: 15 advanced report views over the frozen P7-S9 owner, read-only, market-scoped, bounded, exact-decimal, masked, honest freshness (no fabricated zeros), zero migration, no export surface, RBAC preserved, and test coverage matching the brief. The three Low findings and two informational notes are non-blocking; the permission-reuse decision (L-1) is documented and should be surfaced to Bryan / ChatGPT Command Center at final acceptance.

**Verdict: APPROVED.**
