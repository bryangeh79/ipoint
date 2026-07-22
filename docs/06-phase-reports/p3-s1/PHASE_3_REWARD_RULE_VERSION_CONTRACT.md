# Phase 3 Reward Rule Version Contract

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357

---

## 1. Rule Version Definition

A Reward Rule Version defines the accrual rate/percentage for iPoint rewards. Rules are versioned to support historical accuracy and future changes.

---

## 2. Reward Rule Version Table (Design)

```
reward_rule_versions
├── id (uuid, PK)
├── name (text) — human-readable identifier
├── description (text, nullable)
├── market_id (uuid, FK→markets, nullable) — null = applies to all markets
├── rate (numeric, precision DECIMAL_REQUIRED) — accrual rate/percentage
│     Example: 0.01 = 1% of qualifying amount per day
├── rate_type (text) — 'PERCENTAGE', 'FIXED', 'TIERED'
├── effective_from (date, NOT NULL) — inclusive
├── effective_until (date, nullable) — null = no expiry
├── config (jsonb, nullable) — additional rule configuration
├── created_by (uuid, FK→admin_users)
├── created_at (utc timestamp)
```

---

## 3. Accrual Time Rule

**LOCKED:** Daily accrual uses the rule version effective at the accrual execution date for the relevant market.

```
Given:
  - Market: Malaysia (timezone: Asia/Kuala_Lumpur)
  - Accrual date (market local): 2026-08-01
  - Two rule versions:
    V1: effective_from=2026-01-01, effective_until=2026-06-30
    V2: effective_from=2026-07-01, effective_until=null

Result for 2026-08-01 accrual:
  Uses V2 (effective at 2026-08-01)
```

---

## 4. Historical Preservation

**LOCKED:** Every generated accrual ledger entry must store the exact `rule_version_id` used.

```sql
-- Design pseudocode
INSERT INTO reward_daily_accruals (
  reward_plan_id,
  market_local_date,
  rule_version_id,  -- captured at execution time
  amount,
  ...
)
```

Changing a rule affects only future unaccrued market dates.

Previously posted ledger entries must NOT be recalculated or rewritten.

---

## 5. Rule Change Scenarios

| Scenario                                         | Behavior                                                                             | Correct                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------- |
| New rule created today, effective from yesterday | Future accruals use new rule if market_local_date >= effective_from                  | ✅                              |
| Rule rate increased mid-month                    | Daily accruals after effective_from use new rate; prior days in same month unchanged | ✅                              |
| Rule rate decreased                              | Same as increase — only future unaccrued dates use new rate                          | ✅                              |
| Rule expired (effective_until passed)            | Next accrual fails safe — must be resolved by admin                                  | ✅ (graceful handling required) |
| Rule deleted (soft)                              | Accruals after deletion date stop; historical entries preserved                      | ✅                              |

---

## 6. Rule Assignment to Reward Plan

A Reward Plan may not have an initial `rule_version_id` at creation time.

The rule version is resolved at first accrual execution:

1. At the start of a new market day, the settlement worker finds the current effective rule for the plan's market
2. The rule version is assigned to `reward_plans.rule_version_id`
3. If the rule changes later, the plan's `rule_version_id` is NOT updated — only future accrual records and plan-level recalculation may reference the new rule version

**DECISION_REQUIRED:** Should a Reward Plan lock its rule version at activation, or allow dynamic rule assignment per accrual? The current contract allows per-accrual dynamic assignment, but this needs explicit approval.
