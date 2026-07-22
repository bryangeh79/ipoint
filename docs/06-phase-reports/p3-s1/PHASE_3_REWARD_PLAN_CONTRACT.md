# Phase 3 Reward Plan Contract

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357

---

## 1. Reward Plan Definition

A Reward Plan is created when a qualifying source event occurs. It defines the lifecycle of iPoint accrual for that specific event.

**Idempotency concept:** `source_type + source_id + member_id + market_id`

A qualifying source event produces **at most one** Reward Plan for this compound key.

---

## 2. Reward Plan Table (Design)

```
reward_plans
├── id (uuid, PK)
├── source_type (text) — 'PURCHASE_TRANSACTION', etc.
├── source_id (uuid) — ID of the source event
├── member_id (uuid, FK→members)
├── market_id (uuid, FK→markets)
├── merchant_id (uuid, FK→merchants)
├── status (text) — state machine (see section 3)
├── total_earned (numeric(38,10), default '0')
├── cap_amount (numeric(38,10), nullable)
├── snapshot (jsonb) — merchant package snapshot at plan creation
│   ├── merchant_name
│   ├── package_percentage
│   ├── service_fee_percentage
│   ├── relevant_monetary_values
│   └── rule_version_effective (id)
├── rule_version_id (uuid, FK→reward_rule_versions, nullable)
├── activated_at (utc timestamp, nullable)
├── completed_at (utc timestamp, nullable)
├── reversed_at (utc timestamp, nullable)
├── created_at (utc timestamp)

UNIQUE (source_type, source_id, member_id, market_id)
```

---

## 3. State Machine

**Recommended states for analysis:**

```
                          ┌─────────┐
                          │SCHEDULED│
                          └────┬────┘
                               │ source validated / ready
                               ▼
                    ┌─────────┐
                    │ ACTIVE  │◄────────────────────────┐
                    └──┬──┬───┘                         │
                       │  │                             │
              cap hit  │  │  admin suspend              │
                       ▼  │                             │
              ┌───────┐   │  ┌──────────┐               │
              │CAPPED │   └──│SUSPENDED │───────────────┘
              └───┬───┘      └────┬─────┘    resume
                  │               │
                  ▼               │
           ┌──────────┐           │  reversal
           │COMPLETED │           │
           └──────────┘           │
                  ▲               │
                  │               │
                  └───────────────┘
                          │
                 compensation
                          ▼
                  ┌──────────┐
                  │ REVERSED │
                  └──────────┘
```

**Codex Audit Note:** All listed states are analyzed for necessity. If a state provides no useful transition or serves no business purpose, it may be removed. No state may be silently added.

### State Descriptions

| State | Meaning | Entry Condition | Exit Conditions |
|---|---|---|---|
| **SCHEDULED** | Source event captured, plan created | After reward_source creation | Source validated → ACTIVE |
| **ACTIVE** | Daily accrual is running | Source qualifies, rule version assigned | Cap hit → CAPPED; Admin suspend → SUSPENDED; Reversal → REVERSED; Accrual complete → COMPLETED |
| **CAPPED** | Maximum reward amount reached | Plan's total_earned >= cap_amount | Admin override → ACTIVE (deferred) |
| **SUSPENDED** | Daily accrual paused by admin | Admin action | Admin resume → ACTIVE; Reversal → REVERSED |
| **REVERSED** | All accruals returned | Compensation entry created | Terminal state |
| **COMPLETED** | Max accrual reached or plan expired | No more accrual possible | Terminal state |

**DECISION_REQUIRED:** Whether CAPPED should auto-transition to COMPLETED, or remain a separate state for admin review.

---

## 4. Merchant Package Snapshot

**LOCKED:** Historical transactions and reward plans must retain:

- Merchant service profile reference
- Package percentage snapshot
- Service fee percentage snapshot
- Relevant monetary snapshot

**Implementation:** Store as JSONB in the `reward_plans.snapshot` column at plan creation time.

Later merchant package changes must NOT rewrite historical data.

---

## 5. Reward Plan Lifecycle Events

| Event | Effect | Preconditions |
|---|---|---|
| Plan created | reward_plans row inserted, status=SCHEDULED | Source unique constraint passes |
| Plan activated | status=ACTIVE, activated_at set | Source validated, rule version assigned |
| Daily accrual | wallet entry created, total_earned incremented | Plan is ACTIVE, new market day |
| Cap reached | status=CAPPED | total_earned >= cap_amount |
| Plan suspended | status=SUSPENDED | Admin action |
| Plan resumed | status=ACTIVE | Admin action |
| Plan reversed | status=REVERSED, all entries compensated | Compensating entry created |
| Plan completed | status=COMPLETED | All accrual exhausted |
