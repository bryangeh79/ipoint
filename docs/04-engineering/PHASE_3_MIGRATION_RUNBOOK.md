# Phase 3 Migration Runbook

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357
> **Authority:** P3-S1 design freeze; execute only during P3-S5 integration or production deployment

---

## 1. Overview

Phase 3 introduces 6 new database tables and 5 new enumeration types to support the wallet and reward ledger subsystem. All migrations are additive — no existing tables or columns are modified.

### Migration Inventory

| # | Type | Object | Owner Agent | Rollback |
|---|---|---|---|---|
| 1 | Enum | `reward_source_type` | Agent 3 | DROP TYPE |
| 2 | Enum | `reward_rule_rate_type` | Agent 2 | DROP TYPE |
| 3 | Enum | `reward_plan_status` | Agent 2 | DROP TYPE |
| 4 | Table | `reward_rule_versions` | Agent 2 | DROP TABLE |
| 5 | Table | `reward_sources` | Agent 3 | DROP TABLE |
| 6 | Table | `reward_plans` | Agent 2 | DROP TABLE |
| 7 | Enum | `wallet_account_status` | Agent 1 | DROP TYPE |
| 8 | Enum | `wallet_entry_type` | Agent 1 | DROP TYPE |
| 9 | Enum | `wallet_entry_subtype` | Agent 1 | DROP TYPE |
| 10 | Table | `member_wallet_accounts` | Agent 1 | DROP TABLE |
| 11 | Table | `member_wallet_entries` | Agent 1 | DROP TABLE |
| 12 | Table | `reward_daily_accruals` | Agent 4 | DROP TABLE |

---

## 2. Pre-Migration Checklist

### 2.1 Environment Validation

- [ ] Confirm target environment (dev / staging / production)
- [ ] Verify database connection string environment variable is set
- [ ] Verify database user has schema modification privileges (CREATE TYPE, CREATE TABLE, CREATE INDEX)
- [ ] Verify no pending Phase 3 migrations are already applied
- [ ] Run `git log --oneline -3` to confirm commit history
- [ ] Record pre-migration database version: `SELECT version();`

### 2.2 Backup

```sql
-- Run before any migration
SELECT pg_database_size(current_database()) / 1024 / 1024 AS db_size_mb;

-- Create schema-level backup recommendation for production:
-- pg_dump -h <host> -U <user> -d <database> --schema-only -f phase3_pre_migration_schema.sql
```

### 2.3 Maintenance Window

| Environment | Window | Downtime Expected |
|---|---|---|
| Development | Any time | None |
| Staging | Outside business hours | < 5 minutes |
| Production | Scheduled maintenance window | < 2 minutes (DDL only) |

---

## 3. Migration SQL

### Step 1: Create Enums (Types)

```sql
-- Step 1: reward_source_type
CREATE TYPE reward_source_type AS ENUM (
    'PURCHASE_TRANSACTION',
    'MANUAL_ADMIN'
);

-- Step 2: reward_rule_rate_type
CREATE TYPE reward_rule_rate_type AS ENUM (
    'PERCENTAGE',
    'FIXED',
    'TIERED'
);

-- Step 3: reward_plan_status
CREATE TYPE reward_plan_status AS ENUM (
    'SCHEDULED',
    'ACTIVE',
    'CAPPED',
    'SUSPENDED',
    'REVERSED',
    'COMPLETED'
);

-- Step 7: wallet_account_status
CREATE TYPE wallet_account_status AS ENUM (
    'ACTIVE',
    'FROZEN',
    'CLOSED'
);

-- Step 8: wallet_entry_type
CREATE TYPE wallet_entry_type AS ENUM (
    'REWARD_ACCRUAL',
    'REVERSAL',
    'CORRECTION',
    'ADJUSTMENT'
);

-- Step 9: wallet_entry_subtype
CREATE TYPE wallet_entry_subtype AS ENUM (
    'DAILY_ACCRUAL',
    'FULL_REVERSAL',
    'PARTIAL_CORRECTION',
    'ADMIN_ADJUSTMENT'
);
```

### Step 4: Create Tables

```sql
-- Step 4: reward_rule_versions
CREATE TABLE IF NOT EXISTS reward_rule_versions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    description text,
    market_id uuid REFERENCES markets(id) ON DELETE CASCADE,
    rate numeric(12,8) NOT NULL,
    rate_type reward_rule_rate_type NOT NULL,
    effective_from date NOT NULL,
    effective_until date,
    config jsonb,
    created_by uuid NOT NULL,       -- FK to admin_users (future table)
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT reward_rule_versions_dates_check
        CHECK (effective_from < COALESCE(effective_until, effective_from + '1 day'::INTERVAL))
);

CREATE INDEX idx_reward_rule_versions_market_date
    ON reward_rule_versions (market_id, effective_from);

COMMENT ON TABLE reward_rule_versions IS 'Versioned reward rate configurations per market. Historical rules are preserved for accurate historical accrual calculation.';


-- Step 5: reward_sources
CREATE TABLE IF NOT EXISTS reward_sources (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    source_type reward_source_type NOT NULL,
    source_id uuid NOT NULL,
    member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    amount numeric(38,10) NOT NULL,
    snapshot jsonb NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT reward_sources_unique_key
        UNIQUE (source_type, source_id, member_id, market_id)
);

CREATE INDEX idx_reward_sources_member ON reward_sources (member_id);
CREATE INDEX idx_reward_sources_market ON reward_sources (market_id);

COMMENT ON TABLE reward_sources IS 'Qualifying events that trigger reward plan creation. Immutable after creation.';


-- Step 6: reward_plans
CREATE TABLE IF NOT EXISTS reward_plans (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    source_type text NOT NULL,
    source_id uuid NOT NULL,
    member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    status reward_plan_status NOT NULL DEFAULT 'SCHEDULED',
    total_earned numeric(38,10) NOT NULL DEFAULT 0,
    cap_amount numeric(38,10),
    snapshot jsonb NOT NULL,
    rule_version_id uuid REFERENCES reward_rule_versions(id) ON DELETE SET NULL,
    activated_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT reward_plans_unique_key
        UNIQUE (source_type, source_id, member_id, market_id)
);

CREATE INDEX idx_reward_plans_member_market_status
    ON reward_plans (member_id, market_id, status);
CREATE INDEX idx_reward_plans_active
    ON reward_plans (status)
    WHERE status = 'ACTIVE';

COMMENT ON TABLE reward_plans IS 'Reward plans tracking iPoint accrual from a qualifying source. One plan per source per member per market.';


-- Step 10: member_wallet_accounts
CREATE TABLE IF NOT EXISTS member_wallet_accounts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
    balance numeric(38,10) NOT NULL DEFAULT 0,
    currency text NOT NULL,
    status wallet_account_status NOT NULL DEFAULT 'ACTIVE',
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT member_wallet_accounts_unique
        UNIQUE (member_id, market_id)
);

CREATE INDEX idx_member_wallet_accounts_member ON member_wallet_accounts (member_id);
CREATE INDEX idx_member_wallet_accounts_market ON member_wallet_accounts (market_id);

COMMENT ON TABLE member_wallet_accounts IS 'Per-member, per-market iPoint wallet accounts. Balance is maintained via immutable ledger entries.';


-- Step 11: member_wallet_entries
CREATE TABLE IF NOT EXISTS member_wallet_entries (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES member_wallet_accounts(id) ON DELETE CASCADE,
    amount numeric(38,10) NOT NULL,
    balance_before numeric(38,10) NOT NULL,
    balance_after numeric(38,10) NOT NULL,
    entry_type wallet_entry_type NOT NULL,
    entry_subtype wallet_entry_subtype NOT NULL,
    reward_plan_id uuid REFERENCES reward_plans(id) ON DELETE SET NULL,
    idempotency_key text NOT NULL,
    reversal_of uuid REFERENCES member_wallet_entries(id) ON DELETE SET NULL,
    reason text,
    actor_id uuid,
    correlation_id text NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT member_wallet_entries_idempotency_unique
        UNIQUE (account_id, idempotency_key),
    CONSTRAINT member_wallet_entries_amount_check
        CHECK (amount != 0),
    CONSTRAINT member_wallet_entries_reversal_check
        CHECK (
            (reversal_of IS NULL) OR
            (entry_type IN ('REVERSAL', 'CORRECTION'))
        )
);

CREATE INDEX idx_member_wallet_entries_account_date
    ON member_wallet_entries (account_id, created_at DESC);
CREATE UNIQUE INDEX idx_member_wallet_entries_idempotency
    ON member_wallet_entries (idempotency_key);

COMMENT ON TABLE member_wallet_entries IS 'Immutable wallet ledger entries. Balance changes are auditable, idempotent, and non-destructive. Corrections use compensating entries.';


-- Step 12: reward_daily_accruals
CREATE TABLE IF NOT EXISTS reward_daily_accruals (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    reward_plan_id uuid NOT NULL REFERENCES reward_plans(id) ON DELETE CASCADE,
    member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
    market_timezone text NOT NULL,
    market_local_date date NOT NULL,
    executed_at_utc timestamptz NOT NULL,
    rule_version_id uuid NOT NULL REFERENCES reward_rule_versions(id) ON DELETE RESTRICT,
    amount numeric(38,10) NOT NULL,
    ledger_entry_type text NOT NULL,
    wallet_entry_id uuid REFERENCES member_wallet_entries(id) ON DELETE SET NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT reward_daily_accruals_unique
        UNIQUE (reward_plan_id, market_local_date, ledger_entry_type)
);

CREATE INDEX idx_reward_daily_accruals_plan_date
    ON reward_daily_accruals (reward_plan_id, market_local_date);
CREATE UNIQUE INDEX idx_reward_daily_accruals_idempotency
    ON reward_daily_accruals (idempotency_key);

COMMENT ON TABLE reward_daily_accruals IS 'Daily reward accrual records. One record per (plan, market_local_date, entry_type). UNIQUE constraint provides idempotency for worker retries.';
```

---

## 4. Migration Execution

### 4.1 Sequential Execution Order

Execute in **exact order**:

```
Step  1  →  CREATE TYPE reward_source_type
Step  2  →  CREATE TYPE reward_rule_rate_type
Step  3  →  CREATE TYPE reward_plan_status
Step  4  →  CREATE TABLE reward_rule_versions
Step  5  →  CREATE TABLE reward_sources
Step  6  →  CREATE TABLE reward_plans
Step  7  →  CREATE TYPE wallet_account_status
Step  8  →  CREATE TYPE wallet_entry_type
Step  9  →  CREATE TYPE wallet_entry_subtype
Step 10  →  CREATE TABLE member_wallet_accounts
Step 11  →  CREATE TABLE member_wallet_entries
Step 12  →  CREATE TABLE reward_daily_accruals
```

### 4.2 Drizzle Migration (if using Drizzle Kit)

```bash
# Generate migration
pnpm db:generate:phase3

# Apply migration
pnpm db:migrate

# Verify
pnpm db:push:check
```

### 4.3 Manual SQL Execution

```bash
# Apply all migrations from single SQL file
psql -h <host> -U <user> -d <database> -f phase3_migration.sql

# Or step-by-step for production safety
psql -h <host> -U <user> -d <database> -c "CREATE TYPE reward_source_type AS ENUM (...);"
```

### 4.4 Verification Queries

Run after each step group to verify:

```sql
-- Verify types exist
SELECT typname FROM pg_type WHERE typname IN (
    'reward_source_type',
    'reward_rule_rate_type',
    'reward_plan_status',
    'wallet_account_status',
    'wallet_entry_type',
    'wallet_entry_subtype'
);

-- Verify tables exist and have correct columns
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name IN (
    'reward_rule_versions',
    'reward_sources',
    'reward_plans',
    'member_wallet_accounts',
    'member_wallet_entries',
    'reward_daily_accruals'
)
ORDER BY table_name, ordinal_position;

-- Verify indexes exist
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN (
    'reward_rule_versions',
    'reward_sources',
    'reward_plans',
    'member_wallet_accounts',
    'member_wallet_entries',
    'reward_daily_accruals'
);
```

---

## 5. Rollback Procedure

### 5.1 Rollback SQL

Execute in **reverse order of creation**:

```sql
-- Step 12
DROP TABLE IF EXISTS reward_daily_accruals CASCADE;

-- Step 11
DROP TABLE IF EXISTS member_wallet_entries CASCADE;

-- Step 10
DROP TABLE IF EXISTS member_wallet_accounts CASCADE;

-- Step 9
DROP TYPE IF EXISTS wallet_entry_subtype;

-- Step 8
DROP TYPE IF EXISTS wallet_entry_type;

-- Step 7
DROP TYPE IF EXISTS wallet_account_status;

-- Step 6
DROP TABLE IF EXISTS reward_plans CASCADE;

-- Step 5
DROP TABLE IF EXISTS reward_sources CASCADE;

-- Step 4
DROP TABLE IF EXISTS reward_rule_versions CASCADE;

-- Step 3
DROP TYPE IF EXISTS reward_plan_status;

-- Step 2
DROP TYPE IF EXISTS reward_rule_rate_type;

-- Step 1
DROP TYPE IF EXISTS reward_source_type;
```

### 5.2 Rollback Verification

```sql
-- Verify tables dropped
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'reward_daily_accruals',
    'member_wallet_entries',
    'member_wallet_accounts',
    'reward_plans',
    'reward_sources',
    'reward_rule_versions'
  );
-- Should return 0 rows

-- Verify types dropped
SELECT typname FROM pg_type WHERE typname IN (
    'reward_source_type',
    'reward_rule_rate_type',
    'reward_plan_status',
    'wallet_account_status',
    'wallet_entry_type',
    'wallet_entry_subtype'
);
-- Should return 0 rows
```

### 5.3 Data Preservation (if rollback after migration)

If rollback is necessary after data has been written:

1. Dump data first: `pg_dump -t reward_* -t member_wallet_* -d <database> > phase3_rollback_data.sql`
2. Execute rollback SQL
3. Data can be restored if migration is re-applied

---

## 6. Production Migration Checklist

### Before Deployment

- [ ] Migrations reviewed and approved by Agent 0 (Integration Lead)
- [ ] Rollback script prepared and tested
- [ ] Database backup completed
- [ ] Maintenance window confirmed
- [ ] Application code updated to handle new schema
- [ ] Worker processes stopped (if applicable)
- [ ] Monitoring alerts configured for new tables

### During Deployment

- [ ] Execute migration SQL in exact order
- [ ] Run verification queries
- [ ] If verification fails → pause → rollback
- [ ] Restart application services
- [ ] Restart worker processes

### After Deployment

- [ ] Verify application health endpoint returns OK
- [ ] Run smoke test: create wallet → query → verify
- [ ] Verify worker log shows successful initialization
- [ ] Check monitoring for new table growth
- [ ] Record migration SHA in deployment log

---

## 7. Edge Cases

### 7.1 Concurrent Migration Risk

Phase 3 tables are **new** — no existing data dependencies. Concurrent migration is safe if executed in the defined order. However, avoid running Phase 3 migration simultaneously with other phase migrations.

### 7.2 Enum Type Extension

If new enum values are needed later (e.g., a new `reward_plan_status` value):

```sql
-- PostgreSQL 12+
ALTER TYPE reward_plan_status ADD VALUE 'NEW_STATUS' AFTER 'SUSPENDED';
```

This is an O(1) operation and does not require table rewrite.

### 7.3 Index Creation in Production

For very large tables in production, consider `CREATE INDEX CONCURRENTLY`:

```sql
CREATE INDEX CONCURRENTLY idx_member_wallet_entries_account_date
    ON member_wallet_entries (account_id, created_at DESC);
```

Note: CONCURRENTLY requires more time and cannot run inside a transaction.

---

## 8. Related Documents

| Document | Location |
|---|---|
| Migration & Rollback Strategy (P3-S1) | [`../06-phase-reports/p3-s1/PHASE_3_MIGRATION_AND_ROLLBACK_STRATEGY.md`](../06-phase-reports/p3-s1/PHASE_3_MIGRATION_AND_ROLLBACK_STRATEGY.md) |
| Phase 3 ERD | [`../03-architecture/PHASE_3_ERD.md`](../03-architecture/PHASE_3_ERD.md) |
| Phase 3 Architecture | [`../03-architecture/PHASE_3_ARCHITECTURE.md`](../03-architecture/PHASE_3_ARCHITECTURE.md) |
| Deployment & Operations Guide | [`./06_iPoint_Deployment_Security_and_Operations_V1.0.md`](./06_iPoint_Deployment_Security_and_Operations_V1.0.md) |
