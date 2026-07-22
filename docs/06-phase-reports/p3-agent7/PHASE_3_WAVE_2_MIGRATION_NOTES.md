# Phase 3 Wave 2 Migration Notes

> **Date:** 2026-07-22
> **Base SHA:** 242837cc
> **Authority:** Wave 2 migration order; execute during P3-S5 integration or production deployment

---

## 1. Migration Overview

Wave 2 adds 2 new database tables and 1 new enumeration type on top of the Wave 1 foundation. All migrations remain **additive** — no existing tables or columns are modified.

### Inventory

| #   | Type  | Object                  | Owner Agent | Wave   | Rollback   |
| --- | ----- | ----------------------- | ----------- | ------ | ---------- |
| 1   | Enum  | `daily_job_status`      | Agent 4     | Wave 2 | DROP TYPE  |
| 2   | Table | `daily_job_runs`        | Agent 4     | Wave 2 | DROP TABLE |
| 3   | Table | `reward_daily_accruals` | Agent 4     | Wave 2 | DROP TABLE |

### Complete Phase 3 Migration Order (All Waves)

```
Wave 1 (Agents 1-3)
─────────────────────────────────────────────
Step  1  →  CREATE TYPE reward_source_type       (P3-S1 spec)
Step  2  →  CREATE TYPE reward_rule_rate_type     (P3-S1 spec)
Step  3  →  CREATE TYPE reward_plan_status        (P3-S1 spec)
Step  4  →  CREATE TABLE reward_rule_versions     (Agent 2)
Step  5  →  CREATE TABLE reward_sources            (Agent 3)
Step  6  →  CREATE TABLE reward_plans              (Agent 2)
Step  7  →  CREATE TYPE wallet_account_status     (P3-S1 spec)
Step  8  →  CREATE TYPE wallet_entry_type          (P3-S1 spec)
Step  9  →  CREATE TYPE wallet_entry_subtype       (P3-S1 spec)
Step 10  →  CREATE TABLE member_wallet_accounts    (Agent 1)
Step 11  →  CREATE TABLE member_wallet_entries     (Agent 1)

Wave 2 (Agents 4-5)
─────────────────────────────────────────────
Step 12  →  CREATE TYPE daily_job_status           (Agent 4)  ← NEW
Step 13  →  CREATE TABLE daily_job_runs            (Agent 4)  ← NEW
Step 14  →  CREATE TABLE reward_daily_accruals     (Agent 4)  ← NEW
```

---

## 2. Wave 2 Schema Changes from Wave 1

### 2.1 New Enum: `daily_job_status`

```sql
CREATE TYPE daily_job_status AS ENUM (
    'PENDING',
    'RUNNING',
    'COMPLETED',
    'FAILED'
);
```

**Used by:** `daily_job_runs.status`

**Design notes:**

- `PENDING` — Job run created, awaiting processing
- `RUNNING` — Worker has acquired lock and is processing
- `COMPLETED` — All eligible plans processed
- `FAILED` — Unrecoverable error during processing

### 2.2 New Table: `daily_job_runs`

```sql
CREATE TABLE IF NOT EXISTS daily_job_runs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    job_type text NOT NULL,
    market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
    local_business_date date NOT NULL,
    status daily_job_status NOT NULL DEFAULT 'PENDING',
    started_at timestamptz,
    completed_at timestamptz,
    total_entitlements integer NOT NULL DEFAULT 0,
    processed_count integer NOT NULL DEFAULT 0,
    failed_count integer NOT NULL DEFAULT 0,
    error_detail text,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,

    CONSTRAINT daily_job_runs_type_market_date_unique
        UNIQUE (job_type, market_id, local_business_date)
);

CREATE INDEX idx_daily_job_runs_status
    ON daily_job_runs (status);
CREATE INDEX idx_daily_job_runs_market_date
    ON daily_job_runs (market_id, local_business_date);

COMMENT ON TABLE daily_job_runs IS 'Tracks daily job execution per market per business date. UNIQUE constraint provides idempotency.';
COMMENT ON COLUMN daily_job_runs.job_type IS 'Job identifier, e.g. DAILY_REWARD_ACCRUAL';
COMMENT ON COLUMN daily_job_runs.total_entitlements IS 'Count of eligible reward plans for this run';
COMMENT ON COLUMN daily_job_runs.processed_count IS 'Count of successfully processed plans';
COMMENT ON COLUMN daily_job_runs.failed_count IS 'Count of plans that failed processing';
```

### 2.3 New Table: `reward_daily_accruals`

```sql
CREATE TABLE IF NOT EXISTS reward_daily_accruals (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    reward_plan_id uuid NOT NULL REFERENCES reward_plans(id) ON DELETE RESTRICT,
    member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
    reward_rule_version_id uuid REFERENCES reward_rule_versions(id) ON DELETE RESTRICT,
    market_timezone text NOT NULL,
    market_local_date date NOT NULL,
    executed_at_utc timestamptz NOT NULL,
    amount numeric(38,10) NOT NULL,
    ledger_entry_type text NOT NULL,
    idempotency_key text NOT NULL,
    audit_correlation_id uuid,
    created_at timestamptz DEFAULT now() NOT NULL,

    CONSTRAINT reward_daily_accruals_idempotency_unique
        UNIQUE (reward_plan_id, market_local_date, ledger_entry_type)
);

CREATE UNIQUE INDEX idx_reward_daily_accruals_idempotency
    ON reward_daily_accruals (idempotency_key);
CREATE INDEX idx_reward_daily_accruals_member_market
    ON reward_daily_accruals (member_id, market_id);
CREATE INDEX idx_reward_daily_accruals_plan_date
    ON reward_daily_accruals (reward_plan_id, market_local_date);

COMMENT ON TABLE reward_daily_accruals IS 'Daily iPoint reward accrual records. Each row represents one day of accrual for one plan. UNIQUE constraint provides idempotent worker retry.';
```

### 2.4 Difference from Wave 1 ERD

The Wave 1 ERD defined `reward_daily_accruals` as having:

- `timezone` (text) → Changed to `market_timezone` (to match actual schema)
- `executed_at_utc` (timestamptz) — unchanged
- `audit_correlation_id` (uuid) — added in Wave 2 for audit traceability

### 2.5 Existing Schemas Modified

| Table                    | Change                                                                              | Rationale                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `member_wallet_accounts` | Added `pending_balance`, `available_balance`, `reversed_balance`, `version` columns | Enhanced from Wave 1 single-balance model to 3-component balance model for PENDING/AVAILABLE/REVERSED state tracking |

### 2.6 Column Type Alignment

All Phase 3 numeric columns use `numeric(38,10)` to match the existing MCP ledger convention:

| Table                    | Numeric Columns                                            | Precision |
| ------------------------ | ---------------------------------------------------------- | --------- |
| `member_wallet_accounts` | `pending_balance`, `available_balance`, `reversed_balance` | (38,10)   |
| `member_wallet_entries`  | `amount`, `balance_before`, `balance_after`                | (38,10)   |
| `reward_rule_versions`   | `reward_rate`, `cap_value`, `minimum_reward`               | (38,10)   |
| `reward_plans`           | `total_earned`, `cap_amount`                               | (38,10)   |
| `reward_sources`         | `transaction_amount`                                       | (38,10)   |
| `reward_daily_accruals`  | `amount`                                                   | (38,10)   |

---

## 3. Schema Migration SQL (Wave 2)

```sql
-- ============================================================
-- Wave 2 Migration
-- ============================================================

-- Step 12: Create daily_job_status enum
CREATE TYPE daily_job_status AS ENUM (
    'PENDING',
    'RUNNING',
    'COMPLETED',
    'FAILED'
);

-- Step 13: Create daily_job_runs table
CREATE TABLE IF NOT EXISTS daily_job_runs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    job_type text NOT NULL,
    market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
    local_business_date date NOT NULL,
    status daily_job_status NOT NULL DEFAULT 'PENDING',
    started_at timestamptz,
    completed_at timestamptz,
    total_entitlements integer NOT NULL DEFAULT 0,
    processed_count integer NOT NULL DEFAULT 0,
    failed_count integer NOT NULL DEFAULT 0,
    error_detail text,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,

    CONSTRAINT daily_job_runs_type_market_date_unique
        UNIQUE (job_type, market_id, local_business_date),
    CONSTRAINT daily_job_runs_job_type_check
        CHECK (char_length(job_type) > 0),
    CONSTRAINT daily_job_runs_total_entitlements_check
        CHECK (total_entitlements >= 0),
    CONSTRAINT daily_job_runs_processed_count_check
        CHECK (processed_count >= 0),
    CONSTRAINT daily_job_runs_failed_count_check
        CHECK (failed_count >= 0)
);

CREATE INDEX idx_daily_job_runs_status ON daily_job_runs (status);
CREATE INDEX idx_daily_job_runs_market_date ON daily_job_runs (market_id, local_business_date);

-- Step 14: Create reward_daily_accruals table
CREATE TABLE IF NOT EXISTS reward_daily_accruals (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    reward_plan_id uuid NOT NULL REFERENCES reward_plans(id) ON DELETE RESTRICT,
    member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
    reward_rule_version_id uuid REFERENCES reward_rule_versions(id) ON DELETE RESTRICT,
    market_timezone text NOT NULL,
    market_local_date date NOT NULL,
    executed_at_utc timestamptz NOT NULL,
    amount numeric(38,10) NOT NULL,
    ledger_entry_type text NOT NULL,
    idempotency_key text NOT NULL,
    audit_correlation_id uuid,
    created_at timestamptz DEFAULT now() NOT NULL,

    CONSTRAINT reward_daily_accruals_idempotency_unique
        UNIQUE (reward_plan_id, market_local_date, ledger_entry_type),
    CONSTRAINT reward_daily_accruals_amount_check
        CHECK (amount > 0),
    CONSTRAINT reward_daily_accruals_idempotency_check
        CHECK (char_length(idempotency_key) > 0)
);

CREATE UNIQUE INDEX idx_reward_daily_accruals_idempotency
    ON reward_daily_accruals (idempotency_key);
CREATE INDEX idx_reward_daily_accruals_member_market
    ON reward_daily_accruals (member_id, market_id);
CREATE INDEX idx_reward_daily_accruals_plan_date
    ON reward_daily_accruals (reward_plan_id, market_local_date);
```

---

## 4. pg-boss Initialization

### 4.1 Current State

pg-boss is **NOT yet installed** in the project's dependency tree. The daily job uses **database polling with advisory locks** as its execution mechanism.

### 4.2 Future Initialization Steps

When pg-boss is adopted, the following steps are required:

**Step 1: Install dependency**

```bash
pnpm add pg-boss
pnpm add -D @types/pg-boss
```

**Step 2: Create pg-boss schema**

```bash
npx pg-boss migrate
# or run manually:
psql -h <host> -U <user> -d <database> -c "CREATE SCHEMA IF NOT EXISTS pgboss;"
```

**Step 3: Register NestJS module**

```typescript
// apps/api/src/daily-job/pgboss.module.ts
import { Module, Global } from '@nestjs/common';
import PgBoss from 'pg-boss';

@Global()
@Module({
  providers: [
    {
      provide: 'PGBOSS',
      useFactory: async () => {
        const boss = new PgBoss(process.env['DATABASE_URL']!);
        await boss.start();
        return boss;
      },
    },
  ],
  exports: ['PGBOSS'],
})
export class PgBossModule {}
```

**Step 4: Register worker**

```typescript
// apps/api/src/daily-job/daily-job.worker.ts
@Injectable()
export class DailyJobWorker implements OnModuleInit {
  constructor(
    @Inject('PGBOSS') private readonly boss: PgBoss,
    @Inject(DailyJobOrchestrator)
    private readonly orchestrator: DailyJobOrchestrator,
  ) {}

  async onModuleInit() {
    await this.boss.work('daily-reward-accrual', async (job) => {
      const { marketId, localBusinessDate } = job.data;
      await this.orchestrator.processMarket(marketId, localBusinessDate);
    });
  }
}
```

### 4.3 Integration with Existing `daily_job_runs` Table

When pg-boss is enabled, the `daily_job_runs` table serves as the **monitoring layer**, while pg-boss handles **execution**:

```
pg-boss schedule
    │
    ▼
pg-boss worker picks up job
    │
    ├── CREATE daily_job_runs row (PENDING)
    ├── Process accruals
    ├── UPDATE daily_job_runs status (COMPLETED / FAILED)
    └── pg-boss job completes
```

---

## 5. Backward Compatibility

### 5.1 Existing Tables Not Modified

| Table                                 | Impact | Notes                                            |
| ------------------------------------- | ------ | ------------------------------------------------ |
| `accounts`                            | None   | Unchanged                                        |
| `members`                             | None   | Unchanged; wallet/reward tables reference via FK |
| `markets`                             | None   | Unchanged; daily_job_runs references via FK      |
| `merchant_branches`                   | None   | Unchanged; reward_plans already references       |
| `mcp_accounts` / `mcp_ledger_entries` | None   | Phase 1/2 tables; no changes                     |
| All other Phase 0-2 tables            | None   | No schema modifications                          |

### 5.2 Existing Application Code Not Modified

| Module           | Impact | Notes              |
| ---------------- | ------ | ------------------ |
| Auth module      | None   | No change required |
| Member module    | None   | No change required |
| KYC module       | None   | No change required |
| Discovery module | None   | No change required |
| Merchant module  | None   | No change required |
| MCP module       | None   | No change required |

### 5.3 Potential Breaking Changes (None)

All Phase 3 tables are **new** — no existing production code reads or writes them before Phase 3 deployment. Therefore:

```
Breaking changes introduced by Wave 2: NONE
```

### 5.4 Application Deploy Order

Since all changes are additive, the application can be deployed **before** the migration:

1. Deploy new application code (handles missing tables gracefully)
2. Run migration SQL (adds new tables)
3. Restart application (connects to new tables)
4. Start daily job worker

---

## 6. Rollback Procedure (Wave 2)

### 6.1 Rollback SQL

Execute in reverse order:

```sql
-- Step 14
DROP TABLE IF EXISTS reward_daily_accruals CASCADE;

-- Step 13
DROP TABLE IF EXISTS daily_job_runs CASCADE;

-- Step 12
DROP TYPE IF EXISTS daily_job_status;
```

### 6.2 Rollback Verification

```sql
-- Verify tables dropped
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('daily_job_runs', 'reward_daily_accruals');
-- Should return 0 rows

-- Verify type dropped
SELECT typname FROM pg_type WHERE typname = 'daily_job_status';
-- Should return 0 rows
```

### 6.3 Data Preservation on Rollback

If rollback is needed after data has been written:

```bash
# Dump data first
pg_dump -t daily_job_runs -t reward_daily_accruals -d <database> > phase3_wave2_rollback_data.sql

# Execute rollback SQL

# To restore later:
psql -d <database> -f phase3_wave2_rollback_data.sql
```

---

## 7. Drizzle Migration

### 7.1 Generating Wave 2 Migrations

```bash
# From packages/database directory
pnpm db:generate

# This will create a new migration file in packages/database/migrations/generated/
# Example: 0014_phase_3_wave1_wallet_reward.sql
#         0015_phase_3_wave2_daily_job.sql
```

### 7.2 Applying Migrations

```bash
pnpm db:migrate
```

### 7.3 Verification

```bash
pnpm db:push:check
```

---

## 8. Deployment Checklist

### 8.1 Pre-Deployment

- [ ] All Wave 2 schema SQL reviewed
- [ ] Rollback script prepared
- [ ] Database backup completed
- [ ] Application code updated to handle `daily_job_runs` and `reward_daily_accruals`
- [ ] Wallet service updated with 3-component balance model (pending/available/reversed)
- [ ] Monitoring queries prepared for new tables
- [ ] Maintenance window confirmed

### 8.2 Deployment Steps

1. Deploy application code (no schema changes yet)
2. Verify health endpoint returns OK
3. Execute Wave 2 migration SQL
4. Run verification queries
5. Restart application services
6. Start daily job worker
7. Verify first accrual cycle completes

### 8.3 Post-Deployment

- [ ] Verify `daily_job_runs` shows COMPLETED for first cycle
- [ ] Verify `reward_daily_accruals` has entries
- [ ] Verify wallet balances reflect accruals
- [ ] Check monitoring dashboard
- [ ] Record deployment SHA in deployment log

---

## 9. Related Documents

| Document                           | Location                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Phase 3 Migration Runbook (Wave 1) | [`./PHASE_3_MIGRATION_RUNBOOK.md`](./PHASE_3_MIGRATION_RUNBOOK.md)                                                     |
| Phase 3 ERD                        | [`../03-architecture/PHASE_3_ERD.md`](../03-architecture/PHASE_3_ERD.md)                                               |
| Daily Job Runbook                  | [`./PHASE_3_DAILY_JOB_RUNBOOK.md`](./PHASE_3_DAILY_JOB_RUNBOOK.md)                                                     |
| Ledger Invariant Document          | [`./PHASE_3_LEDGER_INVARIANTS.md`](./PHASE_3_LEDGER_INVARIANTS.md)                                                     |
| Wave 2 Delivery Evidence           | [`../06-phase-reports/p3-agent7/P3_S2_DELIVERY_EVIDENCE.md`](../06-phase-reports/p3-agent7/P3_S2_DELIVERY_EVIDENCE.md) |
| Database Schema                    | `packages/database/schema/index.ts`                                                                                    |
| Migration Config                   | `packages/database/drizzle.config.ts`                                                                                  |
