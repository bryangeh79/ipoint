# Phase 3 Test and E2E Matrix

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357
> **Note:** Design-only. P3-S1 has no permission to falsely claim runtime tests for unimplemented Phase 3 code.

---

## 1. Test Scope

P3-S1 produces this test matrix as a **planning document**. No runtime tests are executed for Phase 3 code in P3-S1.

Existing regression tests continue unchanged (271 member-web + 20 api-client + database tests).

---

## 2. Wallet Unit Tests

| Test Case                                          | Category    | Priority |
| -------------------------------------------------- | ----------- | -------- |
| Create wallet account for new member+market        | CREATE      | P0       |
| Get wallet by id (owner access)                    | READ        | P0       |
| Get wallet by id (non-owner → 403)                 | READ        | P0       |
| List wallets (member sees only own)                | READ        | P0       |
| List wallets (admin with market scope)             | READ        | P0       |
| List wallet entries (paginated)                    | READ        | P0       |
| Wallet creation idempotency (duplicate → existing) | IDEMPOTENCY | P0       |
| Wallet not found → 404                             | ERROR       | P0       |
| Wallet status transitions (ACTIVE→FROZEN→CLOSED)   | STATE       | P1       |
| Wallet for new member (no existing data → empty)   | EDGE        | P1       |

---

## 3. Wallet Ledger Tests

| Test Case                                     | Category    | Priority |
| --------------------------------------------- | ----------- | -------- |
| Add credit entry → balance increases          | LEDGER      | P0       |
| Add debit entry → balance decreases           | LEDGER      | P0       |
| Balance = SUM(entries) at all times           | LEDGER      | P0       |
| Entry with idempotency key duplicate → error  | IDEMPOTENCY | P0       |
| Reversal entry reduces balance to original    | REVERSAL    | P0       |
| Partial correction entry                      | REVERSAL    | P0       |
| Reversal idempotency (reversal key duplicate) | IDEMPOTENCY | P0       |
| Wallet with 0 entries → balance = 0           | EDGE        | P1       |
| Large number of entries (1000+)               | PERFORMANCE | P2       |

---

## 4. Reward Plan Tests

| Test Case                                                       | Category    | Priority |
| --------------------------------------------------------------- | ----------- | -------- |
| Create reward plan (valid source)                               | CREATE      | P0       |
| Create reward plan (duplicate source → 409)                     | IDEMPOTENCY | P0       |
| Reward plan status: SCHEDULED → ACTIVE                          | STATE       | P0       |
| Reward plan status: ACTIVE → CAPPED (cap reached)               | STATE       | P0       |
| Reward plan status: ACTIVE → SUSPENDED (admin)                  | STATE       | P0       |
| Reward plan status: SUSPENDED → ACTIVE (admin resume)           | STATE       | P0       |
| Reward plan status: ACTIVE → REVERSED                           | STATE       | P0       |
| Reward plan status: ACTIVE → COMPLETED                          | STATE       | P0       |
| Invalid state transition (COMPLETED → ACTIVE)                   | STATE       | P0       |
| Merchant snapshot at plan creation                              | SNAPSHOT    | P1       |
| Merchant package change after plan → no effect on existing plan | SNAPSHOT    | P1       |

---

## 5. Daily Settlement Tests

| Test Case                                                           | Category    | Priority |
| ------------------------------------------------------------------- | ----------- | -------- |
| One member, one market — basic accrual                              | SETTLEMENT  | P0       |
| One member, multiple markets — separate accruals                    | SETTLEMENT  | P0       |
| Cross-market reward destination (consumption market wallet)         | SETTLEMENT  | P0       |
| Same-day duplicate execution → idempotent skip                      | IDEMPOTENCY | P0       |
| Duplicate Reward Plan source → 409/200 existing                     | IDEMPOTENCY | P0       |
| Concurrent settlement workers (same market)                         | CONCURRENCY | P0       |
| Worker crash before transaction commit                              | RECOVERY    | P0       |
| Worker crash after transaction commit                               | RECOVERY    | P0       |
| Partial batch failure — only failed items retried                   | RECOVERY    | P0       |
| Retry only failed item (already-processed plans skipped)            | RECOVERY    | P0       |
| Rule change before next accrual date                                | RULE        | P0       |
| Historical rule preservation (old entries have old rule_version_id) | RULE        | P0       |
| Merchant package change after plan creation                         | SNAPSHOT    | P1       |
| Cap boundary (accrual exactly reaches cap)                          | CAP         | P1       |
| Cap boundary (accrual exceeds cap → capped to cap)                  | CAP         | P1       |
| Decimal rounding boundary                                           | DECIMAL     | P1       |
| Rounding during accrual calculation                                 | DECIMAL     | P1       |

---

## 6. Timezone and Date Tests

| Test Case                                       | Category | Priority |
| ----------------------------------------------- | -------- | -------- |
| UTC/local-date boundary (market midnight)       | TIMEZONE | P0       |
| Month-end (market time)                         | TIMEZONE | P0       |
| Year-end (market time)                          | TIMEZONE | P0       |
| Leap day (Feb 29)                               | TIMEZONE | P0       |
| DST market — spring forward                     | TIMEZONE | P0       |
| DST market — fall back                          | TIMEZONE | P0       |
| Non-DST market                                  | TIMEZONE | P0       |
| Worker delayed after midnight (same market day) | TIMEZONE | P1       |
| Worker delayed past midnight (new market day)   | TIMEZONE | P1       |
| Market in UTC+14 (earliest timezone)            | TIMEZONE | P2       |
| Market in UTC-12 (latest timezone)              | TIMEZONE | P2       |

---

## 7. Security Tests

| Test Case                                                  | Category | Priority |
| ---------------------------------------------------------- | -------- | -------- |
| Unauthorized wallet access (Member A → Member B's wallet)  | SECURITY | P0       |
| Cross-market wallet access (same member, different market) | SECURITY | P0       |
| Admin without market_access → 403                          | SECURITY | P0       |
| Wallet API called without auth → 401                       | SECURITY | P0       |
| No wallet data in Service Worker cache                     | SECURITY | P0       |
| No PII/financial data in application logs                  | SECURITY | P1       |
| Balance/ledger reconciliation (balance = SUM entries)      | SECURITY | P1       |
| Reversal without admin role → 403                          | SECURITY | P0       |
| NetworkOnly enforcement for wallet APIs                    | SECURITY | P0       |

---

## 8. Integration Tests

| Test Case                                            | Category    | Priority |
| ---------------------------------------------------- | ----------- | -------- |
| Reward plan creates wallet if not exists             | INTEGRATION | P0       |
| Daily accrual creates wallet entry + updates balance | INTEGRATION | P0       |
| Daily accrual records in reward_daily_accruals       | INTEGRATION | P0       |
| Market timezone used for accrual date calculation    | INTEGRATION | P0       |
| Rule version fetched by effective date               | INTEGRATION | P0       |
| Audit log created for every mutation                 | INTEGRATION | P0       |
| Request ID propagated through wallet operations      | INTEGRATION | P1       |
| Reversal stops future accrual                        | INTEGRATION | P0       |

---

## 9. Test Environment Requirements

| Requirement               | Notes                                            |
| ------------------------- | ------------------------------------------------ |
| PostgreSQL                | Required for all database tests                  |
| Redis                     | Required for worker coordination tests (future)  |
| Multiple timezone markets | At least 2 markets with different IANA timezones |
| DST market                | For timezone transition tests                    |
| Non-DST market            | For comparison                                   |

---

## 10. Test Priority Classification

| Priority | Meaning                                           | Requirement              |
| -------- | ------------------------------------------------- | ------------------------ |
| P0       | Critical — must pass before production enablement | 100% passing             |
| P1       | Important — should pass before full rollout       | Documented if skipped    |
| P2       | Nice to have — future enhancement                 | Tracked for later phases |
