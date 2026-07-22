# Phase 3 Security and Privacy Boundary

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357

---

## 1. Threat Model

### 1.1 Duplicate Settlement

**Threat:** Worker executes the same market-day settlement twice, creating duplicate iPoint accruals.

**Mitigation:**

- UNIQUE constraint on `reward_daily_accruals(reward_plan_id, market_local_date, ledger_entry_type)`
- Distributed lock preventing concurrent settlement for same market
- Idempotency check before every wallet entry creation

### 1.2 Replay Attack

**Threat:** An attacker replays a reward plan creation request, creating multiple Reward Plans for the same source event.

**Mitigation:**

- UNIQUE constraint on `reward_plans(source_type, source_id, member_id, market_id)`
- Existing auth guard prevents unauthorized API access
- NetworkOnly rule for wallet APIs prevents offline replay via Service Worker

### 1.3 Cross-Member Wallet Access

**Threat:** Member A accesses or modifies Member B's wallet.

**Mitigation:**

- Every wallet API must verify `member_id` matches authenticated token's member_id
- Wallet queries scoped by `WHERE member_id = :current_member_id`
- Admin access requires explicit market_access authorization
- No endpoint allows specifying `member_id` as a parameter for non-admin users

### 1.4 Cross-Market Leakage

**Threat:** A member accesses wallet data from a market they don't have access to.

**Mitigation:**

- Wallet queries must verify market_id is in member's accessible markets
- Member's market access determined by `member_market_preferences` table
- Reward plans scoped by consumption market
- Wallet balance display by market only

### 1.5 Stale Rule Use

**Threat:** Settlement worker uses an expired rule version to calculate accruals.

**Mitigation:**

- Worker must query effective rule for each market's current date
- Rule version `effective_from` and `effective_until` boundaries must be validated
- If no effective rule exists for a market+date, worker must skip with error/alarm
- Worker startup validates all market timezone and rule configurations

### 1.6 Partial Batch Failure

**Threat:** Worker processes 50 plans, fails on #35, and on restart processes all 50 again (duplicating #1-34).

**Mitigation:**

- Idempotent accruals (UNIQUE constraint prevents duplicates)
- Retry logic detects already-processed plans by checking `reward_daily_accruals`
- Only missing plans are executed on retry

### 1.7 Concurrent Workers

**Threat:** Two worker instances process the same market simultaneously.

**Mitigation:**

- Distributed lock per market (DECISION_REQUIRED — Redis or database advisory lock)
- Idempotency as second line of defense
- Lock TTL with automatic release

### 1.8 Ledger Tampering

**Threat:** Direct database modification of wallet entries to change balances.

**Mitigation:**

- Append-only ledger entries (no UPDATE/DELETE by application code)
- Database permissions: application user has INSERT-only on wallet_entries
- Balance drift detection via reconciliation
- Audit logs record all wallet operations

### 1.9 Unauthorized Correction

**Threat:** Non-admin user creates a compensating/red entry.

**Mitigation:**

- Reversal/correction endpoints are admin-only
- Admin guard (existing) with explicit market_access check
- All modifications require actor_id
- Audit trail for every correction

### 1.10 Timezone Boundary Error

**Threat:** Worker incorrectly calculates market date near midnight, causing missed or duplicate accruals.

**Mitigation:**

- Use IANA timezone library (date-fns-tz or Luxon) — not manual offset calculation
- Persist both market_local_date and executed_at_utc for audit
- Validate timezone on market creation and worker startup
- Edge-case test matrix covers midnight, DST, month-end, year-end, leap day

### 1.11 Idempotency Key Collision

**Threat:** Two different operations produce the same idempotency key.

**Mitigation:**

- Structured key format with operation prefix + domain identifiers
- Keys are generated deterministically from operation parameters
- UNIQUE constraint on key field provides final safeguard

### 1.12 Audit Log Omission

**Threat:** Wallet operation occurs without audit record.

**Mitigation:**

- Every mutation creates an audit log entry in the same transaction
- Missing audit entries are detectable via reconciliation
- Use existing `audit_logs` infrastructure

### 1.13 Sensitive Value Logging

**Threat:** Wallet balances, rewards, or PII appear in application logs.

**Mitigation:**

- No financial values in log messages
- Request ID for correlation instead of sensitive data
- Log sanitization middleware
- Existing Phase 2 logging conventions apply

### 1.14 Service Worker Caching

**Threat:** Wallet data cached in Service Worker, exposing financial info.

**Mitigation:**

- Wallet APIs must be NetworkOnly (no cache)
- Sensitive wallet data must not be available offline
- Existing NetworkOnly configuration extended to wallet endpoints

### 1.15 Balance/Ledger Divergence

**Threat:** `wallet_accounts.balance` differs from `SUM(wallet_entries.amount)`.

**Mitigation:**

- Balance is derived; periodic reconciliation
- Alert on divergence
- Debug endpoint (admin-only) for balance/ledger comparison

---

## 2. Security Controls Summary

| Control                | Status                                | Owner                 |
| ---------------------- | ------------------------------------- | --------------------- |
| Auth Guard (JWT)       | ✅ Reuse from Phase 2                 | Auth module           |
| Member Ownership Check | 📝 Design                             | Wallet module         |
| Market Isolation       | 📝 Design                             | Wallet module         |
| NetworkOnly            | ✅ Extend to wallet APIs              | Service Worker config |
| Request ID Middleware  | ✅ Reuse                              | Common module         |
| Audit Logging          | ✅ Reuse with wallet-specific actions | Audit module          |
| Idempotency            | ✅ Pattern established                | Phase 3               |
| Rate Limiting          | ❓ DECISION_REQUIRED                  | Config                |
| Distributed Locking    | ❓ DECISION_REQUIRED                  | Phase 3               |
| Admin Authorization    | ✅ Reuse from Phase 2                 | Auth module           |

## 3. Privacy Considerations

| Asset                        | Privacy Requirement                                 |
| ---------------------------- | --------------------------------------------------- |
| Wallet balance               | Visible only to owning member and authorized admins |
| Reward accrual history       | Visible only to owning member                       |
| Transaction amounts (source) | Masked in member-facing views (DECISION_REQUIRED)   |
| Personal location            | No persistence (existing Phase 2 rule)              |
| PII in logs                  | Prohibited (existing Phase 2 rule)                  |
