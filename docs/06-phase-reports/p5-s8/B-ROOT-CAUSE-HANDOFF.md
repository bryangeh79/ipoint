# B Integration — Final Root Cause Handoff

## Status: B-01 to B-15 STRUCTURE COMPLETE, ORDER BUG FIX PENDING

### Root Cause: executeAndProcess queries processing BEFORE running worker

The `executeAndProcess` helper in `b-transaction-commission.integration.spec.ts` queries `commissionProcessing` and `commission_processing_result` and `commission_ledger` **before** calling `outboxWorker.processBatchOnce()`. Since the worker hasn't run yet, all processing/result/ledger queries return empty arrays.

**Failed tests:** B-01, B-02, B-03, B-05, B-06, B-07 (6 of 15 fail)
**Passed tests:** B-04, B-08, B-09, B-10, B-11, B-12, B-13, B-14, B-15 (9 of 15 pass)

### Fix Required

In `executeAndProcess()` function:

1. Move `postConfirmMutation` and `workerFailureInjection` to **before** the worker
2. Run worker: `const wr = await outboxWorker.processBatchOnce()`
3. **THEN** query `commissionProcessing`, `commissionProcessingResults`, `commissionLedger`

The current file has the processing queries at line ~530 and the worker at line ~602. Just swap their order.

### File to Fix

`apps/api/src/__tests__/b-transaction-commission.integration.spec.ts`

- Lines 530-565: Move after the worker call
- Lines 585-600: Keep failure injection and post-confirm mutation before worker

### Current HEAD

`4dd6ab03` — restore outboxWorker.stop()

### All Other Issues Resolved

- Member-consumption service `transactions.market_id` query bug: **FIXED**
- 2-char market code for rate compatibility: **FIXED**
- Market insert onConflictDoNothing with select fallback: **FIXED**
- Date.now() in idempotency keys: **FIXED** (except B-04 uses fixed keys)
- G1/G2 tier chain: **FIXED**
- Merchant attribution: **FIXED**
- No describe.skipIf: **FIXED**
- No conditional `if (g1)` assertions: **FIXED**
- No any-typed business results (mostly): **PARTIALLY FIXED** (need stricter types)
- Anti-placeholder gate: **PASSING**
- `outboxWorker.stop()` to prevent background race: **IMPLEMENTED** (but not effective - see root cause above)
