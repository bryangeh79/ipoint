# Phase 3 Idempotency Specification

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357

---

## 1. Idempotency Patterns

Phase 3 follows the same domain-specific idempotency pattern established in Phase 0-2 (auth, KYC, merchant API, MCP ledger).

---

## 2. Reward Plan Creation Idempotency

**Idempotency concept:** `source_type + source_id + member_id + market_id`

**Guarantee:** For a given compound key, at most one Reward Plan is created.

**Implementation:** UNIQUE constraint on `reward_plans(source_type, source_id, member_id, market_id)`.

**Error handling:** Attempt to create duplicate returns existing plan (HTTP 200 with existing resource) or error code signaling duplicate (CONFIGURABLE).

---

## 3. Daily Accrual Idempotency

**Idempotency concept:** `reward_plan_id + market_local_date + ledger_entry_type`

**Guarantee:** For a given compound key, at most one accrual entry is posted.

**Implementation:** UNIQUE constraint on `reward_daily_accruals(reward_plan_id, market_local_date, ledger_entry_type)`.

**Behavior on duplicate:** INSERT returns duplicate key error. Worker catches this and skips the plan (already completed), continuing to the next.

---

## 4. Wallet Entry Idempotency

**Idempotency concept:** `account_id + idempotency_key`

**Guarantee:** For a given account and key, at most one ledger entry is created.

**Implementation:** UNIQUE constraint on `member_wallet_entries(account_id, idempotency_key)`.

---

## 5. Retry and Recovery

### Successful Item Retry

If a worker retries an already-successful plan:
→ INSERT into `reward_daily_accruals` fails on UNIQUE constraint
→ Worker detects "already exists" and skips
→ No duplicate wallet entry

### Failed Item Retry

If a worker retries a previously-failed plan (no accrual record):
→ INSERT succeeds (unique constraint passes)
→ Wallet entry created
→ Accrual recorded

### Partial Batch Recovery

```
Batch: plans 1-50
Failure point: plan #35

Recovery:
  1. Query reward_daily_accruals for market + date
  2. Find which plans already have accruals (1-34)
  3. Find which ACTIVE plans lack accruals (35-50 in original, but 36-50 also missing)
  4. Execute only missing plans
  5. Each missing plan creates its own accrual idempotently
```

---

## 6. Idempotency Key Generation

| Operation | Key Format | Example |
|---|---|---|
| Reward Plan creation | `reward_plan:{source_type}:{source_id}:{member_id}:{market_id}` | `reward_plan:PURCHASE:abc-123:usr-456:mar-789` |
| Daily accrual | `daily_accrual:{reward_plan_id}:{market_local_date}:{entry_type}` | `daily_accrual:plan-001:2026-08-01:REWARD_ACCRUAL` |
| Wallet entry | `wallet_entry:{account_id}:{original_operation_key}` | `wallet_entry:acct-001:daily_accrual:plan-001:2026-08-01` |
| Reversal | `reversal:{original_entry_id}` | `reversal:entry-uuid-xyz` |

---

## 7. Idempotency Table (Design)

Phase 3 may reuse the domain-specific idempotency table pattern. Alternatively, existing UNIQUE constraints on business tables (`reward_plans`, `reward_daily_accruals`, `member_wallet_entries`) may be sufficient without a separate idempotency key table.

**DECISION_REQUIRED:** Whether to:
a) Use business-table-level UNIQUE constraints only (simpler)
b) Create dedicated idempotency tables per domain (following existing pattern)
c) Create a single consolidated idempotency table for Phase 3

---

## 8. Error Response for Non-Idempotent Requests

For idempotent operations, duplicate requests should return:

```json
{
  "status": 409,
  "code": "WALLET_DUPLICATE_ENTRY",
  "message": "An entry with this idempotency key already exists",
  "existing_entry_id": "uuid-of-existing-entry"
}
```

**DECISION_REQUIRED:** Whether to return 200 (with existing resource) vs 409 (conflict) for idempotent retries.
