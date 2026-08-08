# P8-S2 Review 2 Report — Advanced Financial Reconciliation (Independent Review B', Repair Round)

**Reviewer:** OpenClaw independent subagent (B' role, D-060 authorization — repair re-review)
**Review date:** 2026-08-09
**Reviewed object:** `.local/wt-p8-s2-b2` (detached at `5e30e7ab`, containing fix commit `5e30e7ab` on top of the Review-1 object `b0e1b70e`)
**Method:** Static read-only code review + file-level diff between Review-1 worktree (`wt-p8-s2-b`) and Review-2 worktree (`wt-p8-s2-b2`). No production code modified. No git metadata writes attempted (git unavailable in sandbox; diff performed via file comparison).
**Contract:** `TASK_BRIEF_P8S2.md` + `P8_S2_DELIVERY_REPORT.md` + `docs/00-master/BASELINE_ACKNOWLEDGMENT_V1.1.md` + `P8_S0_CONTRACT_FREEZE.md` §2, D-058/D-059/D-060. Supersedes `P8_S2_REVIEW_REPORT.md` (Review 1, CHANGES REQUIRED).
**Host-verified baseline (relied upon, not re-run):** P8-S2 full suite 25/25 green (incl. new FAILED/CANCELLED re-execution test), eslint 0, prettier clean, typecheck ✅.

---

## Verdict: **APPROVED**

The sole High finding (H-1) is fully repaired and covered by a new regression test; M-1 is confirmed as a scope-organization decision by the acting Command Center (not a business rule) and is recorded below; L-1..L-4 remain informational. No new Critical/High/Medium findings. All Review-1 verified-clean areas remain unchanged.

---

## 1. Review-2 checklist

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| 1 | **H-1 fix — RUNNING transition clears terminal timestamps** | ✅ | `admin-reconciliation-ops.service.ts:175-187`: the transition UPDATE now sets `completedAt: null, failedAt: null, cancelledAt: null` alongside `status='RUNNING'`, `startedAt`, `version`, `updatedAt`. This exactly satisfies `reconciliation_runs_timestamps_check` RUNNING branch (`started_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL AND cancelled_at IS NULL` — `0038_reconciliation.sql:75-77`). |
| 2 | **H-1 fix — FAILED/CANCELLED re-execution path correct** | ✅ | `executeRun` flow for a FAILED/CANCELLED run: `lockRun` (FOR UPDATE) → status is neither COMPLETED (replay early-return) nor RUNNING (409) → transition to RUNNING with all three terminal timestamps cleared → `detect()` → items/exceptions inserted with `onConflictDoNothing()` → finalize to COMPLETED (guarded by `status='RUNNING' AND version=runningVersion`). No CHECK violation → no 500 → no duplicate evidence (see §3). |
| 3 | **H-1 fix — no 500, no duplicate evidence** | ✅ | (a) The CHECK violation class of failure is eliminated at the UPDATE level (23514 no longer reachable on the RUNNING transition). (b) Duplicate-evidence protection is structural: `reconciliation_run_items_reference_unique UNIQUE (run_id, market_id, reference_type, reference_id)` (`0038:118-119`) and `reconciliation_exceptions_run_reference_unique` (`0038:157-158`) + `onConflictDoNothing()` in both inserts; run row locked FOR UPDATE throughout; version-guarded finalize. |
| 4 | **New test — "re-executes FAILED and CANCELLED runs with a fresh snapshot"** | ✅ | `admin-reconciliation-ops.integration.spec.ts:865-917`. FAILED leg: executes run → direct UPDATE forces `FAILED` (satisfying the FAILED CHECK branch: `started_at`/`failed_at` NOT NULL, `completed_at`/`cancelled_at` NULL, `failure_reason='forced failure for retry test'` — 28 chars, within the 1-2000 CHECK at `0038:88-91`) → re-execute → **expect 200** → asserts `status === 'COMPLETED'`. CANCELLED leg: creates run → real API `cancel` (PENDING→CANCELLED via `cancelRun`) → re-execute → **expect 200** → asserts `status === 'COMPLETED'`. Both legs therefore assert the exact H-1 outcome (fresh-snapshot completion instead of 500). |
| 5 | **New test — fixture UPDATE satisfies FAILED CHECK** | ✅ | The forced-FAILED UPDATE sets exactly the CHECK-required shape (started_at + failed_at set, completed_at/cancelled_at NULL, failure_reason 1-2000) — confirmed by reading `spec.ts:886-892` against `0038:82-91`. |
| 6 | **M-1 scope decision recorded (confirmation)** | ✅ | Confirmed: OpenClaw, acting as Command Center under D-059 (revocable, engineering acceptance only), ruled that the **admin-web UI + api-client typed additions (brief §4.4/§4.5) are consolidated into P8-S5** for unified delivery, rather than shipped piecemeal in P8-S2 stage 1. This is a **scope-organization decision, not a commercial/business rule** — it does not alter LOCKED business rules, does not touch the CONFIGURABLE class, and remains within OpenClaw's engineering-acceptance authority under D-059. Recorded here as the formal Review-2 confirmation. Delivery report §1 and §11 already declared admin web UI "out of scope (stage 1)" / outstanding work; the decision aligns the acceptance criteria accordingly. |
| 7 | **L-1..L-4 remain informational** | ✅ | Fix commit touches neither `detectMcp` (L-1 window semantics), `markFailed` (L-2 stale failure_reason on a second in-flight failure), `detectTransactionLedger` (L-3 one-reward-source assumption), nor `detectRefund` (L-4 compensating-entry allowlist). All four remain documentation-level observations with no production impact; none block. |
| 8 | **Out-of-bounds check** | ✅ | Full recursive diff between `wt-p8-s2-b` and `wt-p8-s2-b2` (apps + packages + docs + root): **only two files differ** — `apps/api/src/admin-reconciliation-ops/admin-reconciliation-ops.service.ts` (+6 lines: comment + 3 null clears) and `apps/api/src/admin-reconciliation-ops/admin-reconciliation-ops.integration.spec.ts` (+53 lines: the single new test at 865-917). `packages/` (migrations 0000-0037, 0038, checksums.json, schema) zero diff; no test deletions; no frozen-owner module edits; no new files. |
| 9 | **No regressions in adjacent behavior** | ✅ | Existing tests untouched and still green per host gate (25/25): COMPLETED idempotent replay (item count stays 1), RUNNING-conflict 409 (its direct UPDATE already satisfies the RUNNING CHECK by clearing all three timestamps — spec ~830-835, unchanged), market isolation, exception lifecycle, no-write snapshot. |

---

## 2. Fix diff (exact)

**`admin-reconciliation-ops.service.ts`** — only addition around the RUNNING transition:

```diff
@@ executeRun RUNNING transition @@
+        // Re-execution from FAILED/CANCELLED must clear the terminal
+        // timestamps: reconciliation_runs_timestamps_check requires all of
+        // completed_at/failed_at/cancelled_at to be NULL in RUNNING state.
         await tx.update(reconciliationRuns).set({
             status: 'RUNNING',
             startedAt,
+            completedAt: null,
+            failedAt: null,
+            cancelledAt: null,
             version: runningVersion,
             updatedAt: startedAt,
         })
```

**`admin-reconciliation-ops.integration.spec.ts`** — single new test `it('re-executes FAILED and CANCELLED runs with a fresh snapshot', ...)` at line 865. No other changes.

---

## 3. H-1 repair verification (detailed)

1. **CHECK compliance:** RUNNING branch requires `started_at NOT NULL` and all three terminal timestamps NULL. The fix sets exactly that. Verified against `0038_reconciliation.sql:75-77`. The previous failure mode (23514 raised inside the transaction → generic rethrow → HTTP 500) is structurally unreachable on this path now.
2. **FAILED re-execution:** pre-fix, `failed_at` persisted → CHECK violation → 500, and `markFailed`'s `WHERE status='PENDING'` no-op left the run FAILED with stale reason (Review-1 H-1 + L-2). Post-fix, transition clears `failed_at`, detection runs fresh, finalize sets COMPLETED with `completed_at`. The catch-path `markFailed` still targets PENDING only — correct for the original PENDING→failure case; a second failure mid-re-execution rolls the transaction back to the pre-existing FAILED/CANCELLED state (L-2, informational, unchanged scope).
3. **CANCELLED re-execution:** `cancelRun` sets `cancelled_at`; the fix clears it on re-execution. Test proves the real API cancel → execute → COMPLETED round-trip (spec:897-917).
4. **Fresh snapshot semantics preserved:** re-execution re-runs `detect()` over the run's original window — a fresh snapshot, as documented in the service contract comment and the delivery report §10 ("a FAILED mid-run execution leaves a run retryable"). No double evidence: reference-unique constraints + `onConflictDoNothing` + row lock + version guard.
5. **Regression test quality:** the test constructs the FAILED state through a direct UPDATE that itself obeys both relevant CHECKs (timestamps + failure_reason), so it exercises the real constraint surface without bypassing it; both legs assert the repaired behavior (200 + COMPLETED) end-to-end through the HTTP API with fresh idempotency keys.

---

## 4. Graded findings (Review-2)

| ID | Severity | Status | Finding |
| --- | --- | --- | --- |
| H-1 | High | **RESOLVED** | FAILED/CANCELLED re-execution → CHECK violation → 500. Fixed (terminal timestamps cleared on RUNNING transition) + regression test added. |
| M-1 | Medium | **RESOLVED (scope decision)** | admin-web/api-client deferred to P8-S5 unified delivery — confirmed as acting-Command-Center scope decision under D-059 (see checklist item 6); not a business rule; recorded for the acceptance record. |
| L-1 | Low (info) | Unchanged | detectMcp lifetime-vs-window semantics; documentation note only. |
| L-2 | Low (info) | Unchanged | markFailed only fires from PENDING; a second mid-execution failure leaves the prior FAILED reason. Cosmetic; documented. |
| L-3 | Low (info) | Unchanged | TRANSACTION_LEDGER single-reward-source assumption; documented. |
| L-4 | Low (info) | Unchanged | REFUND compensating-entry type allowlist; documented. |

New findings this round: **none** (0 Critical / 0 High / 0 Medium / 0 Low).

---

## 5. Compliance matrix update (supersedes Review-1 §3)

| Acceptance criterion | Review-1 | Review-2 | Evidence |
| --- | --- | --- | --- |
| Migration 0038 forward/rollback documented; checksums 39/39; drift clean | ✅ | ✅ (unchanged) | packages/ zero diff; host gate |
| All 6 kinds correct on seeded fixtures (real PG) | ✅ | ✅ (unchanged) | 25/25 suite green incl. 6-kind mismatch tests |
| Runs never write ledgers/transactions; balances byte-identical | ✅ | ✅ (unchanged) | no-write snapshot test; static DML audit |
| **Idempotent re-run returns original; no duplicate evidence; FAILED/CANCELLED retry works** | ⚠️ (tested path ✅ / retry ❌ H-1) | **✅** | **H-1 fixed; new test "re-executes FAILED and CANCELLED runs with a fresh snapshot" asserts 200 + COMPLETED for both legs; reference-unique + onConflictDoNothing + row lock** |
| Exception queue lifecycle + audit + notes | ✅ | ✅ (unchanged) | lifecycle test |
| RBAC: 401/403/market-scoped/409 canonical | ✅ | ✅ (unchanged) | guard + isolation tests |
| OpenAPI/typecheck/build/lint/format/unit/integration; admin-web | ✅ / N/A | ✅ (host: 25/25, eslint 0, prettier clean, typecheck ✅) / N/A→P8-S5 (M-1) | host gate; scope decision recorded |

---

## 6. Residual risks / notes

- **Test gap note (non-blocking):** the new test asserts COMPLETED status but does not re-assert item/exclusion counts on the re-executed FAILED run (the existing replay test already asserts no-duplicate counts for COMPLETED replay; duplicate-evidence protection for re-execution is enforced structurally — reference-unique constraints + `onConflictDoNothing`). If a future change weakens those constraints, re-execution duplicate-evidence would surface only via the structural audit. Recommend (not required) an item-count assertion on the FAILED re-execution leg in a future hardening pass.
- **Concurrency:** unchanged and sound (FOR UPDATE + version guard + idempotency unique insert).
- **Host evidence relied upon:** 25/25 fresh-PG, eslint 0, prettier clean, typecheck ✅ executed by host gate; this review re-verified statically the fix diff, the CHECK definitions in 0038, the new test's constraint-shaped fixture UPDATE, and the full-worktree out-of-bounds diff (git CLI unavailable in sandbox; diff via recursive file comparison of the two worktrees).
- **Acceptance authority:** this APPROVED verdict is the B' repair-round review; final acceptance belongs to Bryan / ChatGPT Command Center (D-058/D-059).

---

## 7. Verdict

**APPROVED** — H-1 fully repaired with matching regression test (FAILED and CANCELLED legs both assert fresh-snapshot COMPLETED via the HTTP API, no 500); M-1 confirmed as a recorded acting-Command-Center scope decision (admin-web + api-client → P8-S5 unified delivery); L-1..L-4 informational; out-of-bounds clean (fix touches exactly two files: service +6 lines, integration spec +53 lines; packages/migrations/checksums untouched; no test deletions). 0 Critical / 0 High / 0 Medium / 0 Low new findings.

Reviewer: OpenClaw subagent B' (D-060), repair-round re-review. This review does not itself constitute final acceptance; acceptance belongs to Bryan / ChatGPT Command Center.
