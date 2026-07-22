# Phase 3 Settlement and Timezone Specification

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357

---

## 1. Core Rule

**LOCKED:** Business settlement follows the consumption market's IANA timezone.

Settlement is due at market-local 00:00.

---

## 2. Settlement Worker Contract

```
Worker Execution (UTC):
  1. Determine current UTC time
  2. For each market with ACTIVE reward plans:
     a. Calculate current market-local date using market.timezone
     b. If market-local date differs from last accrual date for any plan:
        → Trigger daily accrual for that market
     c. Persist:
        - market_id
        - market_timezone (IANA string, stored per accrual)
        - market_local_date (DATE, YYYY-MM-DD, stored per accrual)
        - executed_at_utc (TIMESTAMPTZ, stored per accrual)
```

---

## 3. Persisted Fields

Every reward_daily_accrual record must contain:

| Field             | Type              | Purpose                                |
| ----------------- | ----------------- | -------------------------------------- |
| market_id         | uuid              | Links to market definition             |
| market_timezone   | text (IANA)       | e.g. "Asia/Kuala_Lumpur"               |
| market_local_date | date (YYYY-MM-DD) | Business settlement date               |
| executed_at_utc   | timestamptz       | When execution actually occurred       |
| rule_version_id   | uuid              | The rule version used for this accrual |

---

## 4. Edge Cases

### UTC/Local Midnight Boundary

```
Market: Asia/Kuala_Lumpur (UTC+8)
UTC Time: 2026-08-01 15:59 UTC → KL Time: 2026-08-01 23:59
UTC Time: 2026-08-01 16:00 UTC → KL Time: 2026-08-02 00:00 (new market day)
```

Worker must calculate market-local time accurately at the boundary.

### Month-End

```
Market: UTC+8
Market Date: 2026-01-31
Next Day: 2026-02-01 (not 2026-01-32)
```

Standard date arithmetic handles this correctly.

### Year-End

```
Market: UTC+8
Market Date: 2026-12-31
Next Day: 2027-01-01
```

### Leap Day

```
Market: UTC+8
Market Date: 2028-02-28
Next Day: 2028-02-29 → Next Day: 2028-03-01
```

### DST Market (e.g., America/New_York)

```
Spring Forward: 2026-03-08 02:00 → 03:00 (UTC-5 → UTC-4)
Fall Back: 2026-11-01 02:00 → 01:00 (UTC-4 → UTC-5)

Market Date transition at 00:00 local time is well-defined.
The worker uses the market's IANA timezone for correct behavior.
```

### Non-DST Market (e.g., Asia/Kuala_Lumpur)

No DST transitions. Market date always advances at 00:00 local time.

### Worker Delayed After Midnight

```
Market: UTC+8
Market midnight: 2026-08-01 16:00 UTC
Worker runs: 2026-08-01 18:00 UTC (2 hours after midnight)
Result: Worker identifies 2026-08-01 as new unaccrued market date for this market.
```

### Repeated Execution (Same Date)

Worker runs at 18:00 UTC and again at 19:00 UTC (same market date).
→ Idempotency check prevents duplicate accrual for same (reward_plan_id, market_local_date, ledger_entry_type).

### Concurrent Execution

Two worker instances start simultaneously for the same market.
→ Distributed lock prevents concurrent settlement for the same market.
→ Idempotency check prevents duplicate entries even if lock fails.

### Partial Batch Failure

Worker processes 50 plans, fails on plan #35.
→ Only plan #35 needs retry. Plans 1-34 completed successfully.
→ Plans 36-50 should be retried independently.
→ Idempotency check ensures plans 1-34 are not double-posted.

### Retry Failed Items Only

After failure recovery:
→ Query reward_daily_accruals for the market and date.
→ Compare with ACTIVE reward_plans.
→ Execute only missing plans.

---

## 5. Timezone Validation Requirements

| Validation       | Rule                                                                           |
| ---------------- | ------------------------------------------------------------------------------ |
| IANA database    | All timezone strings must be valid IANA timezone identifiers                   |
| Market creation  | Market timezone must be validated at creation time                             |
| Worker startup   | Worker must validate all market timezones on startup                           |
| Graceful failure | Invalid timezone must not crash entire worker — skip that market and log error |

---

## 6. Host System Timezone

**LOCKED:** Do not rely on host operating-system timezone.

Worker infrastructure may execute in UTC, but must calculate and persist:

- market_id
- market_timezone
- market_local_date
- executed_at_utc

All timezone arithmetic must use a proper timezone library (e.g., `date-fns-tz` or `Luxon`). Do not use `Date` with host timezone offset.
