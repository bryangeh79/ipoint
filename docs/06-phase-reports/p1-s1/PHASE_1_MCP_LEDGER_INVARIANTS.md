---
title: Phase 1 MCP Ledger Invariants
phase: P1-S1
status: planning-only
implementation_authorized: false
date: 2026-07-16
---

# Phase 1 MCP Ledger Invariants

## 1. Authoritative invariants

1. The ledger is append-only and immutable; database triggers reject update/delete.
2. Amounts and derived deltas use PostgreSQL `numeric`; application code uses decimal-safe strings/types, never floating point.
3. Every write has a non-empty, account-scoped idempotency key and payload fingerprint. Same key/same payload returns the same result; same key/different payload is rejected.
4. Reversal appends a compensating entry linked by `reversal_of_entry_id`; original rows remain unchanged.
5. Available balance cannot become negative. The application service enforces this while holding an MCP account lock; the database stores enough constraints and sequence ordering to prevent invalid concurrent posting.
6. Current balance = the sum of all effective, un-reversed signed ledger postings. A cached snapshot, if later approved, is derived and updated atomically with the ledger, never the source of truth.
7. Reversal pairs are applied exactly once in projection/reconciliation; implementations must not both exclude the original and double-count the compensating row.
8. Each account has a monotonic sequence; `(mcp_account_id, sequence)` is unique.
9. Market, merchant branch and currency/value-unit context must agree across account, source request and ledger entry.
10. Suspension changes merchant capability only; it preserves MCP total and ledger history.

## 2. Entry type and direction

| Entry type           | Direction          |   Total balance delta | Available balance effect        | Required source                                |
| -------------------- | ------------------ | --------------------: | ------------------------------- | ---------------------------------------------- |
| Recharge             | CREDIT             |             `+amount` | Increase                        | Completed recharge request / verified callback |
| TransactionDeduction | DEBIT              |             `-amount` | Decrease                        | Future authorized transaction snapshot         |
| AdvertisingDeduction | DEBIT              |             `-amount` | Decrease                        | Future authorized advertising charge           |
| ManualCredit         | CREDIT             |             `+amount` | Increase                        | Executed approved adjustment                   |
| ManualDebit          | DEBIT              |             `-amount` | Decrease                        | Executed approved adjustment                   |
| Refund               | DEBIT              |             `-amount` | Decrease/reserve refunded MCP   | Approved refund foundation request             |
| Freeze               | DEBIT              |                   `0` | Move amount available -> frozen | Authorized freeze action                       |
| Unfreeze             | CREDIT             |                   `0` | Move amount frozen -> available | Authorized unfreeze action                     |
| Reversal             | Opposite of target | Opposite target delta | Opposite target effect          | Original entry + governed reason               |

Freeze/Unfreeze direction describes available-position movement; `balance_delta` remains zero so total MCP is preserved. `amount` is positive for every row; direction and explicit delta determine sign.

## 3. Atomic posting algorithm

1. Normalize idempotency key and hash the canonical payload.
2. Begin transaction; lock MCP account and source workflow row.
3. Return existing logical result or reject payload mismatch.
4. Validate account/merchant/market status and workflow authorization.
5. Calculate exact signed delta and projected total/available/frozen values.
6. Reject unauthorized negative available/total position.
7. Allocate next account sequence and insert one immutable ledger row.
8. Mark source request executed/completed; append audit and timeline.
9. Commit; publish notification/outbox intent only after durable commit.

## 4. Maker/checker

- Manual Credit and Manual Debit always require `PendingApproval -> Approved -> Executed`.
- Maker and checker are distinct active Admin users with the required permission and target market access.
- Separation is checked when deciding and again when executing.
- No amount threshold, role shortcut or Super Admin exception exists under D-002 (C-03).
- Rejection requires a reason; approval/execution cannot be deleted or edited.

## 5. Recharge and refund

- Manual recharge: Merchant submits; one authorized Admin reviews; approved request credits MCP exactly once. It is general review, not maker/checker.
- Gateway recharge: callback contract requires signature/timestamp/provider-event validation and idempotency. Production gateway integration is deferred; no fake success path is permitted.
- Refund: Phase 1 foundation accepts and reviews a request; approval appends one idempotent `Refund` debit and records a non-cash refund obligation. It performs no bank, payment-gateway or payout movement.

## 6. Reconciliation tests

- Sum/project every account by sequence and compare any snapshot.
- Verify total = available + frozen under the selected projection.
- Detect missing/duplicate sequences, duplicate idempotency keys, orphan source references, wrong market, invalid reversal chains and maker=checker.
- Reconciliation reports discrepancies; it never silently mutates ledger history.
