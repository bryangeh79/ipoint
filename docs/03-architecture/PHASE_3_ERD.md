# Phase 3 ERD — Wallet & Reward Ledger Database Schema

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357
> **Authority:** Derived from P3-S1 design freeze; non-normative until P3-S2+ implementation
> **Document Type:** Reference schema (supersedes `docs/06-phase-reports/p3-s1/PHASE_3_ERD.md`)

---

## 1. Entity Relationship Diagram

```
┌─────────────────────────────────┐
│       markets (existing)        │
├─────────────────────────────────┤
│ PK: id (uuid)                   │  ◄───────────────┐
│ code (text, unique)             │                   │
│ timezone (text, IANA)           │                   │
│ currency (text)                 │                   │
│ status (ACTIVE, INACTIVE)       │                   │
│ created_at (utc timestamp)      │                   │
└─────────────────────────────────┘                   │
                                                       │
┌─────────────────────────────────┐                   │
│      members (existing)         │                   │
├─────────────────────────────────┤                   │
│ PK: id (uuid)                   │  ◄───────────┐    │
│ email (text, unique)            │              │    │
│ account_country (FK→markets)    │              │    │
│ referral_code (text, unique)    │              │    │
│ ... (Phase 2 profile fields)    │              │    │
│ created_at (utc timestamp)      │              │    │
└─────────────────────────────────┘              │    │
                                                  │    │
┌─────────────────────────────────┐              │    │
│     merchants (existing)        │              │    │
├─────────────────────────────────┤              │    │
│ PK: id (uuid)                   │  ◄───────────┘    │
│ organization_name (text)        │                   │
│ ... (Phase 1 merchant fields)   │                   │
│ status (ENUM)                   │                   │
│ created_at (utc timestamp)      │                   │
└─────────────────────────────────┘                   │
                                                       │
┌─────────────────────────────────────────────────────┴┐
│                reward_rule_versions                    │
├──────────────────────────────────────────────────────┤
│ PK: id (uuid)            DEFAULT gen_random_uuid()    │
│ name (text) NOT NULL                                  │
│ description (text)                                    │
│ market_id (uuid)          │ FK→markets(id)            │
│                          (nullable: null = all markets)│
│ rate (numeric(12, 8)) NOT NULL                        │
│ rate_type (reward_rule_rate_type) NOT NULL             │
│ effective_from (date) NOT NULL                        │
│ effective_until (date)    (nullable: null = no expiry) │
│ config (jsonb)             (nullable)                  │
│ created_by (uuid) NOT NULL FK→admin_users(id)         │
│ created_at (timestamptz)  DEFAULT now()               │
├──────────────────────────────────────────────────────┤
│ INDEXES: (market_id, effective_from)                  │
│ CHECK: effective_from < effective_until               │
└──────────────────────────────────────────────────────┘
         │ 1:N (logical — by effective date)
         ▼
┌──────────────────────────────────────────────────────┐
│                   reward_sources                       │
├──────────────────────────────────────────────────────┤
│ PK: id (uuid)            DEFAULT gen_random_uuid()    │
│ source_type (reward_source_type) NOT NULL              │
│ source_id (uuid) NOT NULL                              │
│ member_id (uuid) NOT NULL    FK→members(id)           │
│ market_id (uuid) NOT NULL    FK→markets(id)           │
│ merchant_id (uuid) NOT NULL  FK→merchants(id)         │
│ amount (numeric(38, 10)) NOT NULL  │ purchase amount  │
│ snapshot (jsonb) NOT NULL       │ merchant/package data│
│ created_at (timestamptz)  DEFAULT now()               │
├──────────────────────────────────────────────────────┤
│ UNIQUE: (source_type, source_id, member_id, market_id)│
│ INDEXES: (member_id), (market_id)                     │
└────────────────────┬─────────────────────────────────┘
                     │ 1:1
                     ▼
┌──────────────────────────────────────────────────────┐
│                   reward_plans                         │
├──────────────────────────────────────────────────────┤
│ PK: id (uuid)            DEFAULT gen_random_uuid()    │
│ source_type (text) NOT NULL                            │
│ source_id (uuid) NOT NULL                              │
│ member_id (uuid) NOT NULL    FK→members(id)           │
│ market_id (uuid) NOT NULL    FK→markets(id)           │
│ merchant_id (uuid) NOT NULL  FK→merchants(id)         │
│ status (reward_plan_status) NOT NULL DEFAULT 'SCHEDULED'│
│ total_earned (numeric(38, 10)) NOT NULL DEFAULT 0      │
│ cap_amount (numeric(38, 10))  (nullable)               │
│ snapshot (jsonb) NOT NULL                              │
│ rule_version_id (uuid)       FK→reward_rule_versions   │
│                        (nullable, set at first accrual) │
│ activated_at (timestamptz)   (nullable)                │
│ completed_at (timestamptz)   (nullable)                │
│ created_at (timestamptz)  DEFAULT now()                │
├──────────────────────────────────────────────────────┤
│ UNIQUE: (source_type, source_id, member_id, market_id)│
│ INDEXES: (member_id, market_id, status), (status)     │
│         (partial index on ACTIVE)                     │
└────────────────────┬─────────────────────────────────┘
                     │ 1:N
                     ▼
┌──────────────────────────────────────────────────────┐
│             reward_daily_accruals                      │
├──────────────────────────────────────────────────────┤
│ PK: id (uuid)            DEFAULT gen_random_uuid()    │
│ reward_plan_id (uuid) NOT NULL  FK→reward_plans(id)  │
│ member_id (uuid) NOT NULL       FK→members(id)       │
│ market_id (uuid) NOT NULL       FK→markets(id)       │
│ market_timezone (text) NOT NULL  │ IANA timezone      │
│ market_local_date (date) NOT NULL                     │
│ executed_at_utc (timestamptz) NOT NULL                │
│ rule_version_id (uuid) NOT NULL  FK→reward_rule_vers. │
│ amount (numeric(38, 10)) NOT NULL                     │
│ ledger_entry_type (text) NOT NULL                     │
│ wallet_entry_id (uuid)    FK→member_wallet_entries    │
│                        (nullable, set after entry)    │
│ idempotency_key (text) NOT NULL                       │
│ correlation_id (text) NOT NULL                        │
│ created_at (timestamptz)  DEFAULT now()               │
├──────────────────────────────────────────────────────┤
│ UNIQUE: (reward_plan_id, market_local_date,           │
│          ledger_entry_type)                           │
│ INDEXES: (reward_plan_id, market_local_date),          │
│          (idempotency_key)                            │
└────────────────────┬─────────────────────────────────┘
                     │
                     │ wallet_entry_id (nullable FK)
                     ▼
┌──────────────────────────────────────────────────────┐
│             member_wallet_accounts                     │
├──────────────────────────────────────────────────────┤
│ PK: id (uuid)            DEFAULT gen_random_uuid()    │
│ member_id (uuid) NOT NULL    FK→members(id)           │
│ market_id (uuid) NOT NULL    FK→markets(id)           │
│ balance (numeric(38, 10)) NOT NULL DEFAULT 0          │
│ currency (text) NOT NULL     │ derived from market     │
│ status (wallet_account_status) NOT NULL DEFAULT 'ACTIVE'│
│ created_at (timestamptz)  DEFAULT now()               │
│ updated_at (timestamptz)  DEFAULT now()               │
├──────────────────────────────────────────────────────┤
│ UNIQUE: (member_id, market_id)                        │
│ INDEXES: (member_id), (market_id)                     │
└────────────────────┬─────────────────────────────────┘
                     │ 1:N
                     ▼
┌──────────────────────────────────────────────────────┐
│             member_wallet_entries                      │
├──────────────────────────────────────────────────────┤
│ PK: id (uuid)            DEFAULT gen_random_uuid()    │
│ account_id (uuid) NOT NULL  FK→member_wallet_accounts │
│ amount (numeric(38, 10)) NOT NULL                     │
│  (positive = credit, negative = debit)                │
│ balance_before (numeric(38, 10)) NOT NULL              │
│ balance_after (numeric(38, 10)) NOT NULL               │
│ entry_type (wallet_entry_type) NOT NULL                │
│ entry_subtype (wallet_entry_subtype) NOT NULL          │
│ reward_plan_id (uuid)   FK→reward_plans(id)(nullable) │
│ idempotency_key (text) NOT NULL                       │
│ reversal_of (uuid)      FK→member_wallet_entries(id)  │
│                        (nullable: null = original)    │
│ reason (text)            (nullable)                    │
│ actor_id (uuid)          (nullable)                    │
│  (who created the entry — member, admin, or system)   │
│ correlation_id (text) NOT NULL                        │
│ created_at (timestamptz)  DEFAULT now()               │
├──────────────────────────────────────────────────────┤
│ UNIQUE: (account_id, idempotency_key)                 │
│ CHECK: amount != 0                                    │
│ CHECK: (reversal_of IS NULL) OR                       │
│        (entry_type = 'REVERSAL' OR 'CORRECTION')      │
│ INDEXES: (account_id, created_at), (idempotency_key)  │
└──────────────────────────────────────────────────────┘
```

---

## 2. Enumerations

### reward_source_type

```sql
CREATE TYPE reward_source_type AS ENUM (
    'PURCHASE_TRANSACTION',   -- created by qualifying purchase
    'MANUAL_ADMIN'            -- created by admin (future)
);
```

### reward_rule_rate_type

```sql
CREATE TYPE reward_rule_rate_type AS ENUM (
    'PERCENTAGE',   -- rate as percentage of purchase amount
    'FIXED',        -- fixed amount per qualifying event
    'TIERED'        -- tiered rate (future)
);
```

### reward_plan_status

```sql
CREATE TYPE reward_plan_status AS ENUM (
    'SCHEDULED',   -- created but not yet accruing
    'ACTIVE',      -- accruing daily rewards
    'CAPPED',      -- cap reached, no future accruals
    'SUSPENDED',   -- admin-suspended, no accruals
    'REVERSED',    -- plan cancelled with compensating entry
    'COMPLETED'    -- plan naturally ended
);
```

### wallet_account_status

```sql
CREATE TYPE wallet_account_status AS ENUM (
    'ACTIVE',   -- normal operation
    'FROZEN',   -- no entries allowed (admin action)
    'CLOSED'    -- permanently closed
);
```

### wallet_entry_type

```sql
CREATE TYPE wallet_entry_type AS ENUM (
    'REWARD_ACCRUAL',  -- daily reward credit
    'REVERSAL',        -- full reversal of an entry
    'CORRECTION',       -- partial correction
    'ADJUSTMENT'        -- admin adjustment (future)
);
```

### wallet_entry_subtype

```sql
CREATE TYPE wallet_entry_subtype AS ENUM (
    'DAILY_ACCRUAL',    -- standard daily reward
    'FULL_REVERSAL',    -- full reversal of prior entry
    'PARTIAL_CORRECTION', -- partial correction
    'ADMIN_ADJUSTMENT'   -- manual admin entry (future)
);
```

---

## 3. Foreign Key Integrity

| Child Table | FK Column | Parent Table | Delete Rule | Purpose |
|---|---|---|---|---|
| reward_rule_versions | market_id | markets | CASCADE | Rule per market |
| reward_sources | member_id | members | RESTRICT | Reward belongs to member |
| reward_sources | market_id | markets | RESTRICT | Reward in market context |
| reward_sources | merchant_id | merchants | RESTRICT | Reward from merchant |
| reward_plans | member_id | members | RESTRICT | Plan owned by member |
| reward_plans | market_id | markets | RESTRICT | Plan in market |
| reward_plans | merchant_id | merchants | RESTRICT | Plan for merchant |
| reward_plans | rule_version_id | reward_rule_versions | SET NULL | Historical preservation |
| reward_daily_accruals | reward_plan_id | reward_plans | CASCADE | Accrual belongs to plan |
| reward_daily_accruals | member_id | members | RESTRICT | Denormalized for query perf |
| reward_daily_accruals | market_id | markets | RESTRICT | Denormalized for query perf |
| reward_daily_accruals | rule_version_id | reward_rule_versions | RESTRICT | Rule applied |
| reward_daily_accruals | wallet_entry_id | member_wallet_entries | SET NULL | Entry may be reversed |
| member_wallet_accounts | member_id | members | RESTRICT | Wallet belongs to member |
| member_wallet_accounts | market_id | markets | RESTRICT | Wallet in market |
| member_wallet_entries | account_id | member_wallet_accounts | CASCADE | Entry in account |
| member_wallet_entries | reward_plan_id | reward_plans | SET NULL | Historical preservation |
| member_wallet_entries | reversal_of | member_wallet_entries | SET NULL | Self-referencing FK |

---

## 4. Business Rule Constraints

| Constraint | Enforcement | When Violated |
|---|---|---|
| One wallet per (member, market) | UNIQUE(member_id, market_id) | WALLET_ALREADY_EXISTS |
| Entry amount never zero | CHECK(amount != 0) | WALLET_INVALID_AMOUNT |
| One idempotency key per account | UNIQUE(account_id, idempotency_key) | WALLET_DUPLICATE_ENTRY |
| Reversal entries must reference original | CHECK with entry_type validation | WALLET_REVERSAL_INVALID |
| One source per (type, id, member, market) | UNIQUE(source_type, source_id, member_id, market_id) | REWARD_SOURCE_DUPLICATE |
| One plan per source key | UNIQUE(source_type, source_id, member_id, market_id) | REWARD_PLAN_DUPLICATE_SOURCE |
| No duplicate daily accrual | UNIQUE(reward_plan_id, market_local_date, ledger_entry_type) | SETTLEMENT_IDEMPOTENCY_CONFLICT |
| Rule dates consistent | CHECK(effective_from < effective_until) | REWARD_RULE_INVALID_DATE |
| No negative amounts | Application check + numeric(38,10) min | WALLET_INVALID_AMOUNT |

---

## 5. Index Strategy

| Table | Index | Type | Purpose |
|---|---|---|---|
| reward_rule_versions | (market_id, effective_from) | B-tree | Rule resolution by market+date |
| reward_sources | (member_id) | B-tree | Member source lookup |
| reward_sources | (market_id) | B-tree | Market-wide source queries |
| reward_plans | (member_id, market_id, status) | B-tree | Member plan listing with filter |
| reward_plans | (status) WHERE status = 'ACTIVE' | Partial B-tree | Worker query active plans |
| reward_daily_accruals | (reward_plan_id, market_local_date) | B-tree | Settlement history lookup |
| reward_daily_accruals | (idempotency_key) | B-tree UNIQUE | Primary idempotency enforcement |
| member_wallet_accounts | (member_id) | B-tree | Member wallet list |
| member_wallet_accounts | (market_id) | B-tree | Market-wide wallet queries |
| member_wallet_entries | (account_id, created_at DESC) | B-tree | Paginated entry listing |
| member_wallet_entries | (idempotency_key) | B-tree UNIQUE | Entry idempotency enforcement |

---

## 6. Migration Order

Executed sequentially by Agent 0 during P3-S5 integration:

```
Step 1: CREATE TYPE reward_source_type
Step 2: CREATE TYPE reward_rule_rate_type
Step 3: CREATE TYPE reward_plan_status
Step 4: CREATE TABLE reward_rule_versions
Step 5: CREATE TABLE reward_sources
Step 6: CREATE TABLE reward_plans
Step 7: CREATE TYPE wallet_account_status
Step 8: CREATE TYPE wallet_entry_type
Step 9: CREATE TYPE wallet_entry_subtype
Step 10: CREATE TABLE member_wallet_accounts
Step 11: CREATE TABLE member_wallet_entries
Step 12: CREATE TABLE reward_daily_accruals
```

Rollback is the reverse of this order.

---

## 7. Related Documents

| Document | Location |
|---|---|
| Phase 3 Architecture | [`PHASE_3_ARCHITECTURE.md`](./PHASE_3_ARCHITECTURE.md) |
| Wallet Ledger Contract | [`../06-phase-reports/p3-s1/PHASE_3_WALLET_LEDGER_CONTRACT.md`](../06-phase-reports/p3-s1/PHASE_3_WALLET_LEDGER_CONTRACT.md) |
| Settlement & Timezone Spec | [`../06-phase-reports/p3-s1/PHASE_3_SETTLEMENT_AND_TIMEZONE_SPEC.md`](../06-phase-reports/p3-s1/PHASE_3_SETTLEMENT_AND_TIMEZONE_SPEC.md) |
| Migration Runbook | [`../04-engineering/PHASE_3_MIGRATION_RUNBOOK.md`](../04-engineering/PHASE_3_MIGRATION_RUNBOOK.md) |
| Error Codes Reference | [`../04-engineering/PHASE_3_ERROR_CODES.md`](../04-engineering/PHASE_3_ERROR_CODES.md) |
