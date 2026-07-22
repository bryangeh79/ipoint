# Phase 3 Daily Job Runbook — Wave 2

> **Date:** 2026-07-22
> **Base SHA:** 242837cc
> **Authority:** Wave 2 implementation reference; must be kept current with code changes
> **Module:** `apps/api/src/daily-job/`, `packages/database/schema/index.ts` (table `daily_job_runs`)

---

## 1. Job Architecture

The Daily Reward Accrual Job is the core background process that executes business-as-of-date reward settlement for each market at its local business day boundary.

### 1.1 Architecture Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                        Scheduler                                │
│  (ConfigService: JOB_POLL_INTERVAL_MS / cron expression)       │
└──────────┬─────────────────────────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────────────────────┐
│                   DailyJobOrchestrator                          │
│  1. Query daily_job_runs for PENDING jobs                      │
│  2. Acquire per-market advisory lock                            │
│  3. Execute run → update status (RUNNING / COMPLETED / FAILED) │
└──────────┬─────────────────────────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────────────────────┐
│                   DailyRewardAccrualWorker                      │
│  1. Fetch eligible ACTIVE reward_plans for market              │
│  2. Resolve effective reward_rule_version for business date    │
│  3. Calculate accrual amount (HALF_UP rounding)                │
│  4. POST PENDING wallet entry via WalletService                │
│  5. INSERT reward_daily_accruals record                        │
│  6. Update reward_plans.totalEarned + cap check                │
│  7. Create audit trail events                                  │
└──────────┬─────────────────────────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────────────────────┐
│                   Idempotency Layer                              │
│  UNIQUE (reward_plan_id, market_local_date, ledger_entry_type) │
│  UNIQUE (idempotency_key)                                      │
│  Advisory lock (namespace 42_000_001, market_id_hash)          │
└────────────────────────────────────────────────────────────────┘
```

### 1.2 Module Structure

| Module                            | Files                 | Responsibility                                      |
| --------------------------------- | --------------------- | --------------------------------------------------- |
| `DailyJobOrchestrator`            | `daily-job/`          | Manages job lifecycle, scheduling, lock acquisition |
| `DailyRewardAccrualWorker`        | `daily-job/`          | Core accrual calculation and ledger posting         |
| `RewardService`                   | `reward/`             | Plan queries, rule version resolution               |
| `WalletService`                   | `wallet/`             | Ledger entry creation, balance management           |
| `TransactionRewardLinkageService` | `transaction-reward/` | Entitlement creation and reversal                   |

### 1.3 Key Types (from `daily-job/job.types.ts`)

```typescript
export type DailyJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export const JOB_TYPE_DAILY_REWARD_ACCRUAL = 'DAILY_REWARD_ACCRUAL';

export interface EligibleRewardPlan {
  id: string;
  memberId: string;
  marketId: string;
  ruleVersionId: string | null;
  totalEarned: string;
  capAmount: string | null;
  snapshot: Record<string, unknown> | null;
}

export interface ProcessDailyAccrualsParams {
  marketId: string;
  localBusinessDate: string;
  marketTimezone: string;
}

/** Advisory lock namespace for daily reward jobs */
export const ADVISORY_LOCK_NAMESPACE = 42_000_001;
```

---

## 2. pg-boss Configuration

### 2.1 Current State

As of Wave 2, **pg-boss is NOT installed**. The daily job uses **PostgreSQL advisory locks** and **database polling** as its execution mechanism:

| Feature             | Implementation                                  |
| ------------------- | ----------------------------------------------- |
| Job queue           | Database polling (daily_job_runs table)         |
| Scheduling          | ConfigService-based interval timer              |
| Concurrency control | PostgreSQL advisory lock (namespace 42_000_001) |
| Retry               | Exponential backoff via status transitions      |
| Monitoring          | Daily job run table + structured logs           |

### 2.2 pg-boss Integration Path (Future)

When pg-boss is adopted, the following configuration will apply:

```typescript
// apps/api/src/daily-job/pgboss.config.ts (FUTURE)
import PgBoss from 'pg-boss';

export const pgBossConfig = {
  host: process.env['PGHOST'] ?? 'localhost',
  port: Number(process.env['PGPORT'] ?? 5432),
  database: process.env['PGDATABASE'] ?? 'ipoint',
  user: process.env['PGUSER'] ?? 'ipoint',
  password: process.env['PGPASSWORD'],
  schema: 'pgboss',
  maxJobsPerCompletion: 10,
  pollIntervalSeconds: 5,
  retryLimit: 3,
  retryDelayMinutes: 1,
  expireInHours: 1,
};

export function createDbUrlFromEnv(): string {
  return process.env['DATABASE_URL'] ?? 'postgresql://localhost/ipoint';
}
```

### 2.3 pg-boss Status Table (Future)

When enabled, pg-boss uses its own schema:

```sql
CREATE SCHEMA IF NOT EXISTS pgboss;
-- pg-boss creates its job tables under this schema automatically
-- Tables: pgboss.job, pgboss.archive, pgboss.schedule
```

### 2.4 Worker Registration Pattern (Future)

```typescript
// apps/api/src/daily-job/daily-job.worker.ts (FUTURE)
import { Injectable, OnModuleInit } from '@nestjs/common';
import PgBoss from 'pg-boss';

@Injectable()
export class DailyJobWorker implements OnModuleInit {
  private boss: PgBoss;

  async onModuleInit() {
    this.boss = new PgBoss(createDbUrlFromEnv());
    await this.boss.start();
    await this.boss.work('daily-reward-accrual', this.processJob.bind(this));
  }

  async processJob(job: PgBoss.Job) {
    const { marketId, localBusinessDate } = job.data;
    await this.orchestrator.processMarket(marketId, localBusinessDate);
  }
}
```

---

## 3. Scheduling

### 3.1 Current Polling Mechanism

The orchestrator runs on a configurable interval:

| Environment | Default Interval | Configuration Key      |
| ----------- | ---------------- | ---------------------- |
| Development | 60 seconds       | `JOB_POLL_INTERVAL_MS` |
| Staging     | 30 seconds       | `JOB_POLL_INTERVAL_MS` |
| Production  | 30 seconds       | `JOB_POLL_INTERVAL_MS` |

### 3.2 Job Cycle Flow

```
[Poll Loop]
    │
    ▼
Is job_runs table empty for today? ──Yes──► Create RUNNING job
    │                                          │
    No                                         ▼
    │                                    Query ACTIVE reward plans
    ▼                                    with market.timezone
Check for PENDING jobs                         │
    │                                          ▼
    │                                    Calculate local business date
    ▼                                          │
Idempotency: skip if                          ▼
already COMPLETED                       Process accruals in batch
    │
    ▼
Update job status to COMPLETED / FAILED
```

### 3.3 Cron Scheduling (Alternative)

For environments requiring precise midnight execution:

```typescript
// cron expression: daily at market midnight
// Since market timezones differ, use a utility:
//   cronJob('0 */5 * * * *')  → every 5 minutes for polling
//   cronJob('0 0 * * *')       → every midnight UTC (not recommended for multi-market)
```

Recommendation: **Keep polling** with 30-second interval. This is simpler and handles all timezones without cron complexity.

---

## 4. Timezone Handling

### 4.1 IANA Timezone Resolution

Each market has an IANA timezone stored in `markets.timezone`:

| Market    | Code | Timezone            |
| --------- | ---- | ------------------- |
| Malaysia  | MY   | `Asia/Kuala_Lumpur` |
| Vietnam   | VN   | `Asia/Ho_Chi_Minh`  |
| Singapore | SG   | `Asia/Singapore`    |
| Thailand  | TH   | `Asia/Bangkok`      |

### 4.2 Local Business Date Calculation

```typescript
// Core utility for determining "what date is it right now in market X?"
import { DateTime } from 'luxon';

export function getMarketLocalDate(marketTimezone: string): string {
  return DateTime.now().setZone(marketTimezone).toISODate(); // e.g. "2026-07-22"
}

// For job processing: determine what date is the "current business date"
// for a given market at the current UTC time
export function getCurrentBusinessDate(marketTimezone: string): string {
  const now = DateTime.now().setZone(marketTimezone);
  return now.toISODate();
}
```

### 4.3 Daylight Saving Time

All markets in scope (MY, VN, SG, TH) **do NOT observe DST**. However, the implementation must handle DST for future market expansion:

| Concern                        | Mitigation                                                 |
| ------------------------------ | ---------------------------------------------------------- |
| Clock spring-forward (23h day) | Worker runs within 30s window; no accrual missed           |
| Clock fall-back (25h day)      | Idempotency prevents duplicate (UNIQUE constraint)         |
| Midnight ambiguity             | `toISODate()` on DateTime handles boundary correctly       |
| Timezone change mid-month      | Market timezone update does not affect historical accruals |

### 4.4 Key Principles

1. **Store in UTC** — All `timestamptz` columns store UTC
2. **Compute locally** — Business date is always computed from IANA timezone
3. **Never convert UTC date** — Don't truncate UTC time to date (this is wrong for timezones east of UTC)
4. **Log timezone context** — Every accrual row stores `market_timezone` for audit

---

## 5. Lock Strategy

### 5.1 PostgreSQL Advisory Lock

The daily job uses PostgreSQL advisory locks to prevent concurrent execution for the same market:

```typescript
import { sql } from 'drizzle-orm';
import { ADVISORY_LOCK_NAMESPACE } from './job.types.js';

export async function acquireMarketLock(
  tx: DatabaseTransaction,
  marketId: string,
): Promise<boolean> {
  // Generate a stable 32-bit key from the market UUID
  const lockKey = hashMarketId(marketId);

  // pg_try_advisory_xact_lock returns true if lock acquired
  const result = await tx.execute<{ locked: boolean }>(sql`
    SELECT pg_try_advisory_xact_lock(
      ${ADVISORY_LOCK_NAMESPACE}, ${lockKey}
    ) AS locked
  `);

  return result.rows[0]?.locked ?? false;
}

function hashMarketId(marketId: string): number {
  // Simple stable hash: use the first 8 hex chars of UUID as int32
  const hex = marketId.replace(/-/g, '').substring(0, 8);
  return Number.parseInt(hex, 16);
}
```

### 5.2 Lock Parameters

| Parameter   | Value                         | Rationale                               |
| ----------- | ----------------------------- | --------------------------------------- |
| Namespace   | `42_000_001`                  | Isolated from other system locks        |
| Lock Scope  | Transaction-level             | Auto-released on COMMIT/ROLLBACK        |
| Wait Policy | `try` (non-blocking)          | Busy polling; never block other workers |
| Fallback    | Skip job if lock not acquired | Next poll will retry                    |

### 5.3 Lock Flow

```
1. BEGIN transaction
2. SELECT ... WHERE status = 'ACTIVE' FOR UPDATE (row-level on plans)
3. pg_try_advisory_xact_lock(42_000_001, market_hash)
   │
   ├── true  → Continue processing
   └── false → ROLLBACK, skip this market, log warning
4. Process all eligible plans
5. UPDATE daily_job_runs status = 'COMPLETED'
6. COMMIT (auto-releases advisory lock)
```

### 5.4 Lock Release Guarantees

| Scenario                | Lock Release                                    |
| ----------------------- | ----------------------------------------------- |
| Normal completion       | COMMIT → auto-release                           |
| Error during processing | ROLLBACK → auto-release                         |
| Worker crash            | PostgreSQL terminates connection → auto-release |
| Timeout                 | Transaction-level lock — no TTL needed          |

---

## 6. Failure Recovery Guide

### 6.1 Job Status Transitions

```
PENDING ───► RUNNING ───► COMPLETED
                │
                └──► FAILED ───► (manual retry → PENDING)
```

### 6.2 Idempotent Recovery

| Scenario                                                    | Recovery Mechanism                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| Worker crashes mid-processing                               | UNIQUE constraint prevents partial duplicates                   |
| Worker crashes after wallet entry but before accrual record | UNIQUE idempotency_key on wallet entry ensures idempotent retry |
| Worker crashes after accrual record insert                  | UNIQUE (plan_id, date, type) prevents duplicate                 |
| Advisory lock contention                                    | Next poll retries within 30 seconds                             |
| Rule version missing                                        | Plan is skipped; job completes with `failedCount > 0`           |
| Wallet creation fails                                       | Transaction rollback; accrual not recorded                      |

### 6.3 Error Handling Priorities

| Priority | Error Type                 | Action                                       |
| -------- | -------------------------- | -------------------------------------------- |
| 1        | Advisory lock not acquired | Skip market, log warning, retry on next poll |
| 2        | Rule version not found     | Log error, increment failedCount, skip plan  |
| 3        | Wallet entry duplicate     | Log info, skip (expected during recovery)    |
| 4        | Wallet balance mismatch    | Log critical, fail the plan                  |
| 5        | Database connection lost   | Retry entire batch with backoff              |

### 6.4 Manual Intervention Procedures

#### Force-restart a failed job

```typescript
// Via admin API: PATCH /admin/reward/jobs/:id/retry
// Sets status back to PENDING
async function retryJob(jobRunId: string): Promise<void> {
  await db
    .update(dailyJobRuns)
    .set({
      status: 'PENDING',
      errorDetail: null,
      startedAt: null,
      completedAt: null,
    })
    .where(eq(dailyJobRuns.id, jobRunId));
}
```

#### Skip a failed job and advance to next day

```typescript
// Only use when manual accrual has been processed
async function forceCompleteJob(jobRunId: string): Promise<void> {
  await db
    .update(dailyJobRuns)
    .set({ status: 'COMPLETED', errorDetail: 'Manually completed' })
    .where(eq(dailyJobRuns.id, jobRunId));
}
```

#### Create a job run for a missed date

```typescript
async function createCatchupJob(
  marketId: string,
  localBusinessDate: string,
): Promise<void> {
  await db
    .insert(dailyJobRuns)
    .values({
      jobType: JOB_TYPE_DAILY_REWARD_ACCRUAL,
      marketId,
      localBusinessDate,
      status: 'PENDING',
    })
    .onConflictDoNothing({
      target: [
        dailyJobRuns.jobType,
        dailyJobRuns.marketId,
        dailyJobRuns.localBusinessDate,
      ],
    });
}
```

### 6.5 Exponential Backoff

```
Attempt 1: immediate retry
Attempt 2: wait 10 seconds
Attempt 3: wait 30 seconds
Attempt 4: wait 60 seconds
Attempt 5+: wait 120 seconds, mark FAILED
```

### 6.6 Alert Thresholds

| Alert                                    | Condition                                    | Severity    |
| ---------------------------------------- | -------------------------------------------- | ----------- |
| Job CONTINUOUSLY FAILED for same job run | status = FAILED > 1 hour                     | 🔴 Critical |
| Job PENDING for > 24h                    | No RUNNING or COMPLETED job for market today | 🟠 High     |
| Job FAILED count > 10                    | processedCount > 0, failedCount > 10         | 🟠 High     |
| Advisory lock contention > 5/hour        | Lock not acquired repeatedly                 | 🟡 Medium   |
| Wallet entry creation failure            | WalletService.createEntry throws             | 🔴 Critical |

---

## 7. Monitoring

### 7.1 Job Run Table

The `daily_job_runs` table serves as the primary monitoring surface:

```sql
-- View latest job status per market
SELECT
    market_id,
    local_business_date,
    status,
    total_entitlements,
    processed_count,
    failed_count,
    started_at,
    completed_at,
    error_detail
FROM daily_job_runs
WHERE job_type = 'DAILY_REWARD_ACCRUAL'
  AND local_business_date = current_date - interval '1 day'
ORDER BY market_id;

-- Find markets behind schedule
SELECT
    market_id,
    MAX(local_business_date) AS last_completed_date,
    current_date - MAX(local_business_date) AS days_behind
FROM daily_job_runs
WHERE job_type = 'DAILY_REWARD_ACCRUAL'
  AND status = 'COMPLETED'
GROUP BY market_id
HAVING current_date - MAX(local_business_date) > 1;
```

### 7.2 Daily Job Run Schema

| Column                | Type             | Description                            |
| --------------------- | ---------------- | -------------------------------------- |
| `id`                  | uuid             | PK                                     |
| `job_type`            | text             | `DAILY_REWARD_ACCRUAL`                 |
| `market_id`           | uuid             | FK to markets                          |
| `local_business_date` | date             | Business date being processed          |
| `status`              | daily_job_status | PENDING / RUNNING / COMPLETED / FAILED |
| `started_at`          | timestamptz      | When processing began                  |
| `completed_at`        | timestamptz      | When processing ended                  |
| `total_entitlements`  | integer          | Count of eligible reward plans         |
| `processed_count`     | integer          | Successfully processed count           |
| `failed_count`        | integer          | Failed count                           |
| `error_detail`        | text             | Error message (if FAILED)              |

### 7.3 Monitoring Queries

```sql
-- All-time summary
SELECT
    status,
    COUNT(*) AS run_count,
    AVG(processed_count) AS avg_processed,
    SUM(failed_count) AS total_failed
FROM daily_job_runs
WHERE job_type = 'DAILY_REWARD_ACCRUAL'
GROUP BY status;

-- Markets with no job today
SELECT m.code, m.timezone
FROM markets m
WHERE m.status = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM daily_job_runs r
    WHERE r.market_id = m.id
      AND r.job_type = 'DAILY_REWARD_ACCRUAL'
      AND r.local_business_date = current_date
  );
```

### 7.4 Reward Daily Accruals Monitoring

```sql
-- Accruals posted today
SELECT
    r.market_id,
    m.code AS market_code,
    COUNT(*) AS accruals_count,
    SUM(r.amount::numeric) AS total_amount
FROM reward_daily_accruals r
JOIN markets m ON m.id = r.market_id
WHERE r.executed_at_utc >= date_trunc('day', now())
GROUP BY r.market_id, m.code;

-- Plans that failed to accrue
SELECT
    rp.id AS plan_id,
    rp.member_id,
    rp.market_id,
    rp.status,
    rp.total_earned
FROM reward_plans rp
WHERE rp.status = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM reward_daily_accruals rda
    WHERE rda.reward_plan_id = rp.id
      AND rda.market_local_date = current_date
  );
```

### 7.5 Structured Logging

```typescript
// Standard log event format
interface DailyJobLogEvent {
  timestamp: string; // ISO 8601 UTC
  level: 'info' | 'warn' | 'error';
  jobType: string;
  marketId: string;
  marketCode: string;
  localBusinessDate: string;
  event: string; // see events table below
  durationMs?: number;
  count?: number;
  error?: string;
}
```

| Event                             | Level | Description                              |
| --------------------------------- | ----- | ---------------------------------------- |
| `daily_job_poll_start`            | info  | Orchestrator begins polling cycle        |
| `daily_job_processing`            | info  | Job run created, processing market       |
| `daily_job_lock_acquired`         | info  | Advisory lock obtained                   |
| `daily_job_lock_contention`       | warn  | Advisory lock not available, skipping    |
| `daily_job_plan_processing`       | debug | Processing individual reward plan        |
| `daily_job_accrual_created`       | info  | Accrual record inserted                  |
| `daily_job_plan_capped`           | info  | Plan cap reached, transitioned to CAPPED |
| `daily_job_completed`             | info  | Market job finished successfully         |
| `daily_job_completed_with_errors` | warn  | Job completed but had failures           |
| `daily_job_failed`                | error | Job failed completely                    |
| `daily_job_error`                 | error | Non-recoverable error during processing  |

### 7.6 Log Aggregation Recommendations

| Tool                    | Purpose                                          |
| ----------------------- | ------------------------------------------------ |
| Structured JSON logging | All job logs emitted as JSON for log aggregators |
| ELK / Loki / CloudWatch | Ship logs for search and alerting                |
| Grafana dashboard       | Job run counts, failure rate, latency per market |
| PagerDuty / OpsGenie    | Critical alerts for job failures                 |

### 7.7 Health Check

```typescript
// GET /admin/reward/jobs/status
interface HealthCheckResponse {
  workerEnabled: boolean;
  lastPollTime: string;
  markets: Array<{
    marketId: string;
    marketCode: string;
    lastJobStatus: string;
    lastJobDate: string;
    lastJobCompletedAt: string | null;
    pendingEntitlements: number;
  }>;
  uptimeSeconds: number;
}
```

---

## 8. Configuration Reference

### 8.1 Environment Variables

| Variable                     | Type    | Default       | Description                        |
| ---------------------------- | ------- | ------------- | ---------------------------------- |
| `JOB_ENABLED`                | boolean | `true`        | Master switch for daily job        |
| `JOB_POLL_INTERVAL_MS`       | integer | `30000` (30s) | Poll interval between cycles       |
| `JOB_BATCH_SIZE`             | integer | `100`         | Max plans per batch                |
| `JOB_MAX_RETRIES`            | integer | `5`           | Max retry attempts per job         |
| `JOB_RETRY_BASE_DELAY_MS`    | integer | `10000` (10s) | Base delay for exponential backoff |
| `JOB_MARKET_LOCK_TIMEOUT_MS` | integer | `5000` (5s)   | Advisory lock acquisition timeout  |

### 8.2 Runtime Configuration (DB)

Stored in a `config` table or market-level `config` JSONB column:

| Key                            | Type    | Description                    |
| ------------------------------ | ------- | ------------------------------ |
| `job.runtime.enabled`          | boolean | Per-market job enable/disable  |
| `job.runtime.batch_size`       | integer | Override batch size per market |
| `job.runtime.catchup_max_days` | integer | Max catchup days (default: 7)  |

---

## 9. Related Documents

| Document                  | Location                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Phase 3 Architecture      | [`../03-architecture/PHASE_3_ARCHITECTURE.md`](../03-architecture/PHASE_3_ARCHITECTURE.md)                             |
| Error Code Reference      | [`./PHASE_3_ERROR_CODES.md`](./PHASE_3_ERROR_CODES.md)                                                                 |
| Ledger Invariant Document | [`./PHASE_3_LEDGER_INVARIANTS.md`](./PHASE_3_LEDGER_INVARIANTS.md)                                                     |
| Migration Runbook         | [`./PHASE_3_MIGRATION_RUNBOOK.md`](./PHASE_3_MIGRATION_RUNBOOK.md)                                                     |
| Agent 7 Delivery Evidence | [`../06-phase-reports/p3-agent7/P3_S2_DELIVERY_EVIDENCE.md`](../06-phase-reports/p3-agent7/P3_S2_DELIVERY_EVIDENCE.md) |
| Wallet Service            | `apps/api/src/wallet/wallet.service.ts`                                                                                |
| Reward Service            | `apps/api/src/reward/reward.service.ts`                                                                                |
| Job Type Definitions      | `apps/api/src/daily-job/job.types.ts`                                                                                  |
