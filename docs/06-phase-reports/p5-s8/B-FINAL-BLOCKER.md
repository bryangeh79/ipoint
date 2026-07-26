# FINAL VALID BLOCKER REPORT

## Confirmed Fixes Applied

| Fix                                                   | Status   |
| ----------------------------------------------------- | -------- |
| Processing query order (moved after processBatchOnce) | ✅ FIXED |
| outboxWorker.stop() to prevent background race        | ✅ FIXED |
| Merchant parent attribution fallback removed          | ✅ FIXED |
| Forensic diagnostics added to executeAndProcess       | ✅ FIXED |
| 2-char market code for rate compatibility             | ✅ FIXED |
| Service fee query fix (transactions.market_id)        | ✅ FIXED |

## Current CI: 5/6 Jobs Pass (Run 30205523431)

Only Integration tests fail: 7/15 tests (B-01..B-03, B-05..B-07, B-15)

## Remaining Issue

The `commissionProcessing` query returns 0 rows after `processBatchOnce()` even though dispatch status is COMPLETED and `lastError` is null. This is an invariant violation: COMPLETED dispatch must have corresponding processing entries.

## Required Local Debug

The forensic data (`r.forensics`) was added to the `executeAndProcess` return but never printed to logs. To resolve:

1. Add `console.log(JSON.stringify(r.forensics, null, 2))` in B-01 after `executeAndProcess`
2. Run `cd apps/api && pnpm vitest run src/__tests__/b-transaction-commission.integration.spec.ts --reporter verbose`
3. Examine the output for:
   - `connInfo` — database/schema/user
   - `rawProc` — ALL processing entries (source_type, source_reference, status)
   - `rawDispatch` — ALL dispatch entries for this transaction
   - Compare `tx.id` with `dispatch.transaction_id` and `processing.source_reference`

The mismatch should reveal whether the issue is:
A) Processing uses different sourceReference format
B) Worker processes different transaction's dispatch
C) Processing entries are created in a different schema/transaction

## Files to Check

- `apps/api/src/__tests__/b-transaction-commission.integration.spec.ts` — `executeAndProcess` function
- `apps/api/src/domain/commission/member-consumption.service.ts` — `processMemberConsumption` (sourceReference assignment)
- `apps/api/src/transaction/transaction-commission-outbox.worker.ts` — `processEvent` method

## Current HEAD

`ab7644d8`
