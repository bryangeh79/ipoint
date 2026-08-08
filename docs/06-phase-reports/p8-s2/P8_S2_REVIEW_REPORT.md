# P8-S2 Review Report — Advanced Financial Reconciliation (Independent Review B')

**Reviewer:** OpenClaw independent subagent (B' role, D-060 authorization)
**Review date:** 2026-08-08
**Reviewed object:** `task/p8-s2-reconciliation` (worktree `.local/wt-p8-s2-b`, detached at b0e1b70e — commits 79b30227, d412301b, b0e1b70e)
**Method:** Static read-only code review. No production code modified. No git metadata writes attempted.
**Contract:** `TASK_BRIEF_P8S2.md` + `P8_S2_DELIVERY_REPORT.md` + `docs/00-master/BASELINE_ACKNOWLEDGMENT_V1.1.md` (LOCKED L-01..L-27, E-01..E-30), `P8_S0_CONTRACT_FREEZE.md` §2, D-058/D-059/D-060.

---

## Verdict: **CHANGES REQUIRED**

One **High** finding: the documented retry capability for FAILED (and re-execution of CANCELLED) reconciliation runs is broken and produces an unhandled HTTP 500. All other checklist items verified clean. The defect is small, well-understood, and does not affect data integrity, the no-write guarantees, or security — but it contradicts an explicit claim in the delivery report (§10) and the service contract comment, and the host-verified test suite does not cover this path.

---

## 1. Checklist verification (per review mandate)

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| 1 | **Migration 0038** | ✅ | `packages/database/migrations/0038_reconciliation.sql` |
| 1a | Read-only domain (DETECTION+REVIEW+TRACEABILITY) | ✅ | 0038 header comment; all 4 tables are domain-owned; no trigger/function touches frozen tables |
| 1b | Exactly 4 tables (runs/run_items/exceptions/idempotency_keys) | ✅ | 0038: `reconciliation_runs`, `reconciliation_run_items`, `reconciliation_exceptions`, `reconciliation_idempotency_keys`; no other DDL objects |
| 1c | E-30 reject_delete triggers | ✅ | 4× `BEFORE DELETE ... EXECUTE FUNCTION reject_delete()` (0038, tail); `reject_delete()` pre-exists in 0002 (line 441); plus write-once `reject_reconciliation_run_item_update()` for run_items |
| 1d | Market isolation | ✅ | `market_id` FK everywhere + composite UNIQUE `(id, market_id)` on runs/items/exceptions; composite FK `(run_id, market_id)` → runs; idempotency unique `(admin_user_id, market_id, operation, key)` |
| 1e | numeric(38,10) | ✅ | All expected/actual/difference/total columns `numeric(38,10)` (0038); schema index mirrors (`packages/database/schema/index.ts:4513+`) |
| 1f | Status enums correct | ✅ | 6 kinds, 5 run statuses, 4 exception statuses, 6 classifications, 4 item statuses — migration ≡ schema index ≡ `p8-s2-schema.test.ts` freeze tests |
| 1g | No destructive auto-correction capability | ✅ | No DML on frozen tables anywhere in the module; no correction endpoints; exceptions never auto-resolved |
| 1h | checksums.json 39/39 consistent | ✅ | 39 entries for 39 migration files (0000–0038); sha256 of 0038 file = `5ba8cc0454acd26dca9212536aea1951b6795eaf2885b12b74c92dc0004c3579` matches checksums.json byte-exact |
| 2 | **Engine, 6 kinds** | ✅ | `apps/api/src/admin-reconciliation-ops/admin-reconciliation-ops.service.ts` |
| 2a | MCP (ledger net vs balance) | ✅ | `detectMcp` (service:681) — lifetime ledger net vs `total_balance`/`available_balance` per account |
| 2b | IPOINT (wallet entry invariant) | ✅ | `detectIpoint` (service:744) — `balance_after - balance_before` vs signed amount by entry type |
| 2c | TRANSACTION_LEDGER (txn vs debit+reward) | ✅ | `detectTransactionLedger` (service:800) — CONFIRMED txn vs MCP debit total + reward source amount/member |
| 2d | COMMISSION (processing vs posting) | ✅ | `detectCommission` (service:884) — COMPLETED/CREATED processing vs exactly one ledger posting in run market |
| 2e | REFUND (approved refund vs compensating credit) | ✅ | `detectRefund` (service:940) — MCP approved refunds vs CREDIT ledger entry; redemption refunds COMPLETED vs wallet entry, REJECTED/FAILED with an entry → UNEXPECTED |
| 2f | REDEMPTION (order vs wallet debit + voucher) | ✅ | `detectRedemption` (service:1059) — active order statuses vs wallet debit + voucher codes for DIGITAL_VOUCHER |
| 2g | All read-only (no writes to frozen tables) | ✅ | Statically verified: every INSERT/UPDATE in the service targets only the 4 `reconciliation_*` tables; frozen tables (`mcp_ledger_entries`, `member_wallet_entries`, `transactions`, `transaction_mcp_debits`, `reward_sources`, `commission_processing`/`commission_ledger`, `mcp_refund_requests`, `redemption_orders`, `redemption_voucher_codes`, …) appear only in SELECT/JOIN |
| 2h | Exact-decimal (BigInt scaled, no floats) | ✅ | `toScaledBigInt`/`formatScaledBigInt`/`eqScaled`/`sub` (service:1347-1395); unit tests assert no float rounding (`0.3000000000 - 0.1000000000 = 0.2000000000`) |
| 3 | **Run lifecycle** | ⚠️ | see finding **H-1** |
| 3a | PENDING→RUNNING→COMPLETED/FAILED (+CANCELLED) | ✅ | `executeRun`/`cancelRun`/`markFailed`; CHECK-enforced timestamp shapes per status |
| 3b | Idempotent replay (COMPLETED returns original) | ✅ | `executeRun` early-return `runDto(toSnake(run))`; integration test "replays a completed run idempotently without duplicate evidence" (same key + fresh key, item count stays 1) |
| 3c | RUNNING conflict 409 | ✅ | `inProgress()` → `RECONCILIATION_RUN_IN_PROGRESS` → 409; integration test asserts 409 |
| 3d | Market isolation | ✅ | Guard `marketScoped` + service `assertMarket` + composite `(id, market_id)` keys; integration test "isolates runs and exceptions by market" (403 foreign detail, 409 context mismatch) |
| 4 | **Exception queue** | ✅ | |
| 4a | Strict OPEN→ACKNOWLEDGED→RESOLVED→CLOSED chain | ✅ | `transitionException` enforces `from` status (resolve requires ACKNOWLEDGED); integration test asserts OPEN→resolve = 409; CLOSED rejects notes = 409 |
| 4b | notes | ✅ | `appendExceptionNotes` append-only with timestamped actor stamps, 10k cap, versioned |
| 4c | Audit via AuditService | ✅ | `writeAudit` → `AuditService.appendWithinTransaction` (audit_logs + entity_timelines); integration test asserts `reconciliation.exception.*` actions present |
| 4d | classificationFor mapping | ✅ | MISSING→MISSING_EXPECTED, UNEXPECTED→UNEXPECTED_EXTRA, else AMOUNT_MISMATCH |
| 5 | **RBAC / security** | ✅ | |
| 5a | Permission codes vs catalog | ✅ | `reconciliation.view` (ALL 6 controlled roles), `reconciliation.run`/`reconciliation.exception.manage` (SUPER_ADMIN, OPERATIONS_ADMIN, FINANCE_OPERATOR, FINANCE_APPROVER) — migration role inserts ≡ `permission-catalog.ts:570-585` |
| 5b | marketScoped | ✅ | All 11 routes `@RequirePermission(..., { marketScoped: true })` |
| 5c | 409/403 semantics | ✅ | Guard: 409 `MARKET_CONTEXT_MISMATCH` (path vs current market), 409 `MARKET_SELECTION_REQUIRED`, 403 `MARKET_ACCESS_DENIED`; service: 403 foreign-market record, 404 not found; 409 invalid transition / stale version / idempotency conflict / in-progress; 400 validation; 401 unauth |
| 5d | Idempotency key enforced | ✅ | Controller `key()` + service `withIdempotency` (both 400 on missing/oversized); scope (admin, market, operation, key); sha256 request hash w/ 64-char CHECK; replay returns stored response; reused key w/ different payload → 409 |
| 6 | **Integration-gate fixes** | ✅ | |
| 6a | `FILTER` syntax in detectCommission | ✅ | `count(cl.id) FILTER (WHERE cl.market = $1)::int` and `sum(cl.amount) FILTER (WHERE cl.market = $1)` — valid PostgreSQL; `HAVING market_posting_count > 0 OR count(cl.id) = 0` correctly excludes foreign-market-only postings |
| 6b | `text()` helper | ✅ | Flat, type-safe (string/number/bigint/Date only, else fallback), no recursion (service:1620) |
| 6c | `Database` type import | ✅ | `import { type Database } from '@ipoint/database'` — exported via `packages/database/src/client.ts:5` (`type Database = ReturnType<typeof createDatabase>['db']`), re-exported from index |
| 6d | Test fixture fixes | ✅ | `beforeAll` MCP account starts at 0/0 so owner-projected balance after the single +100 RECHARGE equals the ledger net (double-count avoidance documented in fixture comment); `createTransactionFixture` fills all NOT NULL fields (marketTransactionSettings, rewardRuleVersions, serviceFeeVersions lookup, merchantPackageAssignments w/ `isDefault` only when none exists); replay test's direct RUNNING UPDATE explicitly clears completed/failed/cancelled timestamps to satisfy the CHECK (integration spec, "replays a completed run…"); lifecycle test walks acknowledge→notes→resolve→close with correct `expectedVersion` increments; status→classification assertions use `classificationFor`-consistent values |
| 7 | **Out-of-bounds check** | ✅ | No edits to frozen Phase 1-7 owner modules (only reads); migrations 0000–0037 untouched (0038 is a new file; checksums.json carries all 39 hashes); no new secrets, placeholders, or TODOs in the module/migration/test files; admin-web/api-client "reconciliation" references are pre-existing Phase-7 MCP merchant reconciliation DTOs, not P8-S2 |

---

## 2. Findings

### H-1 — HIGH: Re-execution of FAILED / CANCELLED runs violates the timestamps CHECK and returns an unhandled 500

- **Location:** `admin-reconciliation-ops.service.ts:176-186` (transition to RUNNING), vs `0038_reconciliation.sql` `reconciliation_runs_timestamps_check`; `markFailed` (service:1242); `cancelRun` (service:305).
- **Description:** `executeRun` accepts PENDING/FAILED/CANCELLED runs for fresh execution (service comment: "PENDING/FAILED/CANCELLED runs execute a fresh detection snapshot"). The transition UPDATE sets only `status='RUNNING', started_at, version, updated_at` and never clears `failed_at`/`cancelled_at` (nor `completed_at`). The CHECK requires for RUNNING: `started_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL AND cancelled_at IS NULL`. A FAILED run always has `failed_at` set (markFailed), and a CANCELLED run always has `cancelled_at` set (cancelRun), so the UPDATE raises a Postgres CHECK violation (23514) inside the transaction → rollback → non-`ReconciliationError` → rethrown as HTTP 500 (controller `handle` default branch). `markFailed` then no-ops (`WHERE status='PENDING'`), so the run stays FAILED/CANCELLED with a stale `failure_reason`.
- **Impact:** A run that fails mid-execution (e.g., transient DB error during detection) can never be retried through the API — every retry returns 500. This contradicts the delivery report §10 ("a FAILED mid-run execution leaves a run retryable") and the brief's retry-safety requirement (§3, §6). No data corruption; no duplicate evidence (rollback is safe); operator workaround is creating a new run.
- **Why tests passed:** the 24/24 suite covers COMPLETED replay, RUNNING conflict, and cancellation — it never re-executes a FAILED or CANCELLED run, so the constraint breach is unreachable in the tested paths (the replay test even documents the constraint by explicitly clearing all three timestamps in its manual RUNNING UPDATE).
- **Suggested fix (one of):** (a) in the RUNNING transition also set `failedAt: null, cancelledAt: null, completedAt: null` (and rely on `version`/row lock for safety), or (b) restrict re-execution to PENDING/FAILED with a full timestamp reset, or (c) drop CANCELLED/FAILED from the re-executable set and return a clear 409 instead. Add an integration test: force a FAILED run (e.g., inject a failing detect path), then re-execute and assert COMPLETED with no duplicate evidence.

### M-1 — MEDIUM: Scope deviation — admin-web UI and api-client additions from brief §4.4/§4.5 not delivered

- **Location:** `P8_S2_DELIVERY_REPORT.md` §1 ("Out of scope (stage 1): … admin web UI …") vs `TASK_BRIEF_P8S2.md` §4.4 (admin-web reconciliation pages, route-manifest entries, full UI states) and §4.5 (typed api-client additions), and §6 ("admin-web tests pass").
- **Description:** The brief lists admin-web UI and api-client additions as in-scope acceptance items; stage 1 delivers engine + API + tests only. This is declared, not hidden, but it is still a deviation from the written contract that needs an explicit Bryan/ChatGPT Command Center acceptance decision (the P8-S1 module pattern the brief references did ship its admin web surface).
- **Impact:** Acceptance-criteria item "admin-web tests pass" is not applicable yet; operators have no UI for runs/exceptions in stage 1. No security impact.

### L-1 — LOW: detectMcp window semantics differ from the other five kinds

- **Location:** `detectMcp` (service:681-704).
- The window only decides *account inclusion* (`EXISTS entries in window OR account created in window`); the ledger-vs-balance comparison is **lifetime** (`coalesce(sum(e.balance_delta),0)` over all entries). Documented in the comment ("ledger net (lifetime) vs maintained balance columns"), and defensible for MCP drift detection, but an account with pre-window activity and no in-window activity is skipped entirely, and a run's window does not bound the compared period. Informational; consider documenting in the run summary.

### L-2 — LOW: markFailed does not update failure_reason for re-executed FAILED runs

- **Location:** `markFailed` (service:1242) `WHERE … status = 'PENDING'`.
- A second failure during a re-execution leaves the run FAILED with the previous `failure_reason` (stale) since the rollback keeps the pre-existing status. Cosmetic; fixed together with H-1.

### L-3 — LOW (informational): TRANSACTION_LEDGER assumes one reward source per transaction

- **Location:** `detectTransactionLedger` (service:800-828), `GROUP BY t.id, rl.id, rs.id`.
- A transaction with multiple reward links produces one item per link, each compared to the full purchase amount; a legitimately split reward would flag MISMATCHED. Consistent with the documented reward model (single source), acceptable for detection-stage tooling; note in documentation.

### L-4 — LOW (informational): REFUND compensating-entry type allowlist

- **Location:** `detectRefund` (service:955-966).
- Compensation requires `direction='CREDIT'` AND `entry_type IN ('REFUND','MANUAL_CREDIT','REVERSAL')`. A legitimate compensating entry of another credit type flags MISMATCHED. Detection-only, so no correction risk; worth a documentation note for operators.

---

## 3. Compliance matrix (TASK_BRIEF §6)

| Acceptance criterion | Status | Evidence |
| --- | --- | --- |
| Migration 0038 forward + rollback documented; checksums 39/39; drift clean | ✅ | Rollback note in delivery report §12; 39/39 hashes (0038 sha256 re-verified byte-exact in review); drift/checksum verified by host gate |
| All 6 kinds produce correct match/mismatch on seeded fixtures (real PG) | ✅ | 13 HTTP integration tests, one per kind mismatch + clean MCP; host ran green (24/24) |
| Runs never write ledgers/transactions; balances byte-identical after runs (asserted) | ✅ | Static verification (all DML confined to `reconciliation_*`) + integration test "never writes to frozen financial tables and never auto-corrects" (17-table snapshot, byte-identical) |
| Idempotent re-run returns original result; no duplicate items/exceptions | ✅ (tested path) / ❌ (retry of FAILED runs) | Replay test passes; **H-1** breaks the FAILED/CANCELLED retry path |
| Exception queue full lifecycle with immutable audit; notes persisted | ✅ | Lifecycle test: strict chain, stale-version 409, notes, audit actions, CLOSED rejects notes |
| RBAC: 401 unauth; 403 wrong permission; market-scoped only; canonical 409 mismatch | ✅ | Guard test: 401, 403 viewer, 409 `MARKET_CONTEXT_MISMATCH`; service 403 foreign-market; catalog ≡ migration |
| OpenAPI validated; typecheck/build/lint/format; unit+integration on real PG; admin-web tests; no secrets | ✅ / N/A | OpenAPI/typecheck/build/eslint/prettier/drift/checksum verified by host gate; unit 7 + integration 17 = 24/24 green; admin-web tests N/A (stage-1 UI deferred, see M-1); no secrets found in static scan |

## 4. Residual risks / notes

- **Concurrency:** run row `FOR UPDATE` + `version` guard + idempotency-key unique insert make duplicate evidence practically impossible; a concurrent same-key request blocks on the unique index and replays the committed response (verified by code path analysis).
- **Growth:** `reconciliation_run_items` grows per run; write-once + paginated reads bound the operational surface; no scheduler in stage 1.
- **Host-gate evidence relied upon:** checksum 39/39, drift clean, typecheck/build, eslint/prettier, OpenAPI, and 24/24 fresh-PG tests were executed by the host gate; this review re-verified statically the checksum of 0038 and the constraint/trigger definitions but did not re-run the suite (reviewer is read-only).
- **No git diff possible in sandbox** (`git` unavailable); out-of-bounds claims are based on file inventory, static scans, and the host gate's drift/checksum verification.

---

## 5. Verdict

**CHANGES REQUIRED** — contingent on resolving **H-1** (FAILED/CANCELLED run re-execution → CHECK violation → 500) with a regression test. M-1 (admin-web/api-client scope deviation) requires an explicit acceptance decision from Bryan / ChatGPT Command Center. L-1..L-4 are documentation-level and do not block.

Everything else — migration 0038 integrity (E-30, market scope, numeric(38,10), checksums 39/39), the read-only no-write guarantees of all six detection kinds, exact-decimal arithmetic, exception lifecycle + audit, RBAC/catalog alignment, idempotency, and the integration-gate fixes — is verified clean.

Reviewer: OpenClaw subagent B' (D-060). This review does not itself constitute acceptance; acceptance belongs to Bryan / ChatGPT Command Center.
