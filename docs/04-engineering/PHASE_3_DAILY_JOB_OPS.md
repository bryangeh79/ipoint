# Phase 3 Daily Reward Job — Operations Guide

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357
> **Authority:** P3-S1 design freeze; non-normative until P3-S4 implementation

---

## 1. Overview

The **Daily Reward Settlement Worker** is a background process that executes at each market's local midnight boundary to calculate and post iPoint reward accruals for qualifying transactions.

### Purpose

- Automate daily iPoint reward calculation for active reward plans
- Post wallet ledger entries with idempotent guarantees
- Handle market timezone isolation and daylight saving transitions
- Support manual trigger and monitoring
- Provide full audit trail for every accrual event

### Worker Identity

- **Module:** `SettlementModule`
- **Service:** `SettlementService`
- **Worker:** `SettlementWorker`
- **Executable:** Run within the NestJS API application process
- **Configuration:** Environment variables + DB configuration table

---

## 2. Worker Execution Model

### 2.1 Architecture

```
┌─────────────────────────────────────────────────┐
│                 SettlementWorker                   │
│                                                    │
│  Timer (configurable interval)                     │
│       │                                            │
│       ▼                                            │
│  for each ACTIVE market:                           │
│       │                                            │
│       ├── Acquire lock (market_id)                 │
│       │       │                                    │
│       │       ▼                                    │
│       ├── Query ACTIVE reward_plans for market     │
│       │       │                                    │
│       │       ▼                                    │
│       ├── for each plan:                           │
│       │       │                                    │
│       │       ├── Get market-local current date    │
│       │       ├── If date != last_accrual_date:    │
│       │       │     resolve effective rule         │
│       │       │     calculate accrual amount       │
│       │       │     create wallet entry            │
│       │       │     create accrual record          │
│       │       │     update total_earned            │
│       │       │     check cap → CAPPED transition  │
│       │       │     create audit event             │
│       │       └── If date == last_accrual_date:    │
│       │             skip (idempotent)              │
│       │                                            │
│       └── Release lock (market_id)                 │
│                                                    │
└─────────────────────────────────────────────────┘
```

### 2.2 Execution Frequency

| Environment | Default Interval | Configurable |
|---|---|---|
| Development | Every 10 minutes | Yes — via `SETTLEMENT_POLL_INTERVAL_MS` |
| Staging | Every 5 minutes | Yes |
| Production | Every 5 minutes | Yes — adjust based on market count |

### 2.3 Trigger Methods

1. **Automatic timer** — Periodic polling based on configured interval
2. **Manual trigger** — Admin API: `POST /api/v1/admin/settlement/trigger?market_id=<uuid>`
3. **Startup trigger** — Optional run on worker startup to catch up missed days

---

## 3. Configuration

### 3.1 Environment Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `SETTLEMENT_ENABLED` | boolean | `true` | Master switch for settlement worker |
| `SETTLEMENT_POLL_INTERVAL_MS` | integer | `300000` (5 min) | Interval between settlement cycles |
| `SETTLEMENT_LOCK_TTL_MS` | integer | `60000` (1 min) | Distributed lock TTL |
| `SETTLEMENT_MAX_PLANS_PER_RUN` | integer | `1000` | Max plans to process per cycle |
| `SETTLEMENT_RETRY_DELAY_MS` | integer | `10000` (10 sec) | Delay before retry on failure |
| `SETTLEMENT_CONCURRENT_MARKETS` | integer | `1` | Number of markets to process in parallel |

### 3.2 Market Configuration

Each market must have:

| Field | Source | Description |
|---|---|---|
| `timezone` | `markets.timezone` | IANA timezone for market-local date calculation |
| `settlement_enabled` | `markets.config` (jsonb) | Override to disable settlement per market |
| `reward_rate` | `reward_rule_versions` | Effective rule for date |

### 3.3 Runtime Configuration (DB)

| Key | Type | Description |
|---|---|---|
| `worker.enabled` | boolean | Global worker on/off |
| `worker.poll_interval_ms` | integer | Worker polling interval |
| `worker.max_plans_per_run` | integer | Batch size |
| `worker.catchup_enabled` | boolean | Allow catchup on missed days |
| `worker.catchup_max_days` | integer | Maximum days to catch up per run |

---

## 4. Monitoring & Observability

### 4.1 Health Check Endpoint

```
GET /api/v1/admin/settlement/status
```

Response:
```json
{
  "worker_enabled": true,
  "last_health_check": "2026-07-22T16:00:00.000Z",
  "markets": [
    {
      "market_id": "uuid",
      "market_code": "MY",
      "timezone": "Asia/Kuala_Lumpur",
      "current_local_date": "2026-07-22",
      "last_settled_date": "2026-07-21",
      "next_expected_date": "2026-07-22",
      "active_plans_count": 150,
      "pending_plans_count": 0,
      "last_execution_time": "2026-07-22T15:55:00.000Z",
      "last_lock_status": "acquired",
      "status": "READY"
    }
  ],
  "errors_last_hour": 0,
  "total_plans_last_hour": 200,
  "total_accruals_last_hour": 200,
  "uptime_seconds": 86400
}
```

### 4.2 Metrics to Monitor

| Metric | Source | Alert Threshold |
|---|---|---|
| Settlement duration per market | Worker log | > 30 seconds |
| Plans pending > 24h | DB query | > 0 |
| Worker lock contention | Redis/DB | > 5 per hour |
| Failed accruals | Accrual log | > 0 |
| Worker restart count | Process monitor | > 3 per day |
| Market timezone errors | Error log | > 0 |
| Accrual amount anomalies | Threshold check | > 3σ from mean |

### 4.3 Logging

**Structured JSON logging format:**

```json
{
  "timestamp": "2026-07-22T16:00:00.000Z",
  "level": "info",
  "worker": "settlement",
  "market_id": "uuid",
  "market_code": "MY",
  "event": "settlement_cycle_complete",
  "duration_ms": 1250,
  "plans_processed": 150,
  "accruals_posted": 145,
  "plans_capped": 5,
  "errors": 0
}
```

**Key log events:**

| Event | Level | Description |
|---|---|---|
| `settlement_start` | info | Worker begins cycle |
| `market_lock_acquired` | info | Lock obtained for market |
| `market_lock_failed` | warn | Lock contention, will retry |
| `plan_processing` | debug | Processing individual plan |
| `accrual_posted` | info | Accrual entry committed |
| `plan_capped` | info | Plan transitioned to CAPPED |
| `settlement_cycle_complete` | info | Market cycle finished |
| `settlement_error` | error | Non-recoverable error |
| `market_timezone_error` | error | Invalid IANA timezone |

---

## 5. Error Recovery

### 5.1 Idempotent Recovery

The settlement worker is designed for **crash-safe recovery**:

| Scenario | Recovery |
|---|---|
| Worker crashes before commit | Next execution retries — no partial state persisted |
| Worker crashes after commit but before response | UNIQUE constraint prevents duplicate on retry |
| Worker crashes mid-market | Next execution acquires lock and skips already-processed plans |
| Database connection lost during processing | Worker retries with exponential backoff (3 attempts) |

### 5.2 Manual Intervention

| Situation | Action |
|---|---|
| Worker stuck | Restart via `POST /api/v1/admin/settlement/restart` |
| Market lock not released | Clear via Redis `DEL settlement:lock:<market_id>` or DB advisory unlock |
| Specific plan skipped | Verify plan status, trigger individual settlement |
| Rule version missing | Create rule version for the date, re-run settlement |
| Wallet entry failed | Check wallet status (FROZEN?), re-run |

### 5.3 Catch-up Procedure

If the worker was offline for multiple days:

1. Verify `worker.catchup_enabled = true` in configuration
2. Worker will process all missed days sequentially
3. Each day's accrual is idempotent — no risk of duplicate
4. Monitor catch-up progress via `last_settled_date` in health check

**Maximum catch-up:** Configurable via `worker.catchup_max_days` (default: 30 days)

---

## 6. Lock Strategy

### 6.1 Distributed Lock (DECISION_REQUIRED)

**Option A: Redis SETNX (recommended)**

```typescript
const lockKey = `settlement:lock:${marketId}`;
const acquired = await redis.set(lockKey, workerId, 'NX', 'PX', lockTTL);
if (!acquired) {
  throw new SettlementError('SETTLEMENT_MARKET_LOCKED', ...);
}
// ... process ...
await redis.del(lockKey);
```

**Option B: PostgreSQL Advisory Lock**

```sql
SELECT pg_advisory_xact_lock(hashtext('settlement:' || market_id));
-- Auto-released at transaction end
```

**Option C: Database Row-Level Lock**

```sql
SELECT id FROM markets WHERE id = market_id FOR UPDATE NOWAIT;
```

### 6.2 Lock Parameters

| Parameter | Value | Rationale |
|---|---|---|
| Lock TTL | 60 seconds | Sufficient for >99% of market cycles |
| Retry delay | 10 seconds | Prevents busy-waiting |
| Max retries | 3 | Avoid infinite retry loops |
| Lock key prefix | `settlement:lock:` | Namespace isolation |

---

## 7. Accrual Calculation

### 7.1 Formula

```
raw_accrual = purchase_amount × effective_rule_rate
accrual = round(raw_accrual, 6 decimal places, HALF_UP)

IF total_earned + accrual > cap_amount:
    final_accrual = cap_amount - total_earned
    transition plan to CAPPED
ELSE:
    final_accrual = accrual
```

### 7.2 Numeric Precision

| Variable | Precision | Type |
|---|---|---|
| `purchase_amount` | numeric(38,10) | From `reward_sources.amount` |
| `effective_rule_rate` | numeric(12,8) | From `reward_rule_versions.rate` |
| `raw_accrual` | numeric(50,18) | Intermediate calculation (unbounded) |
| `accrual` | numeric(38,10) | After rounding to 6 decimal places |
| `final_accrual` | numeric(38,10) | After cap comparison |

### 7.3 Rounding

- **Internal calculation:** HALF_UP rounding to 6 decimal places (0.000001 iPoint)
- **Display:** 2 decimal places (0.01 iPoint)
- **Storage:** Full numeric(38,10)

### 7.4 Rule Resolution

```sql
-- Find effective rule for market + date
SELECT * FROM reward_rule_versions
WHERE (market_id = :marketId OR market_id IS NULL)
  AND effective_from <= :marketLocalDate
  AND (effective_until IS NULL OR effective_until >= :marketLocalDate)
ORDER BY
  market_id NULLS LAST,  -- prefer market-specific over global
  effective_from DESC    -- most recent effective rule
LIMIT 1;
```

---

## 8. Admin Operations

### 8.1 Commands

| Action | Endpoint | Description |
|---|---|---|
| Trigger settlement | `POST /admin/settlement/trigger?market_id=<id>` | Immediate settlement for market |
| Get status | `GET /admin/settlement/status` | Status for all markets |
| List pending | `GET /admin/settlement/pending?market_id=<id>` | Plans awaiting settlement |
| Restart worker | `POST /admin/settlement/restart` | Graceful worker restart |
| Clear market lock | `POST /admin/settlement/clear-lock?market_id=<id>` | Force-clear stuck lock |

### 8.2 Settlement History

```sql
-- Query settlement history for a market
SELECT
    market_local_date,
    COUNT(*) AS plans_settled,
    SUM(amount) AS total_accrued,
    MIN(executed_at_utc) AS first_execution,
    MAX(executed_at_utc) AS last_execution
FROM reward_daily_accruals
WHERE market_id = :marketId
GROUP BY market_local_date
ORDER BY market_local_date DESC
LIMIT 30;
```

---

## 9. Troubleshooting

| Symptom | Likely Cause | Resolution |
|---|---|---|
| Plans not accruing | Rule version missing for date | Create rule version |
| Plans not accruing | Plan status not ACTIVE | Check plan status, activate if SCHEDULED |
| Worker not starting | `SETTLEMENT_ENABLED=false` | Enable via config |
| Worker stuck on one market | Lock not released | Force-clear lock via admin API |
| Duplicate accrual records | Idempotency check bypassed | Check UNIQUE constraint |
| Balance mismatch | Race condition in wallet entry | Check wallet balance = SUM(entries) |
| Timezone errors | Invalid IANA timezone in market | Update market timezone |
| High memory usage | Too many active plans | Reduce `SETTLEMENT_MAX_PLANS_PER_RUN` |

---

## 10. SLA and Performance

| Metric | Target | Measurement |
|---|---|---|
| Settlement latency per market | < 30 seconds | Worker log duration_ms |
| Plans processed per second | > 100 | Worker throughput |
| Worker uptime | > 99.9% | Process monitor |
| Maximum catch-up | 30 days | Config parameter |
| Maximum concurrent markets | 5 | SETTLEMENT_CONCURRENT_MARKETS |

---

## 11. Related Documents

| Document | Location |
|---|---|
| Settlement & Timezone Spec | [`../06-phase-reports/p3-s1/PHASE_3_SETTLEMENT_AND_TIMEZONE_SPEC.md`](../06-phase-reports/p3-s1/PHASE_3_SETTLEMENT_AND_TIMEZONE_SPEC.md) |
| Idempotency Spec | [`../06-phase-reports/p3-s1/PHASE_3_IDEMPOTENCY_SPEC.md`](../06-phase-reports/p3-s1/PHASE_3_IDEMPOTENCY_SPEC.md) |
| Decimal & Currency Spec | [`../06-phase-reports/p3-s1/PHASE_3_DECIMAL_AND_CURRENCY_SPEC.md`](../06-phase-reports/p3-s1/PHASE_3_DECIMAL_AND_CURRENCY_SPEC.md) |
| Error Codes Reference | [`./PHASE_3_ERROR_CODES.md`](./PHASE_3_ERROR_CODES.md) |
| Phase 3 Architecture | [`../03-architecture/PHASE_3_ARCHITECTURE.md`](../03-architecture/PHASE_3_ARCHITECTURE.md) |
| Migration Runbook | [`./PHASE_3_MIGRATION_RUNBOOK.md`](./PHASE_3_MIGRATION_RUNBOOK.md) |
