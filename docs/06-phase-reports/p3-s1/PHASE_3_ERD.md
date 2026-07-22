# Phase 3 ERD — Multi-Market Wallet & Reward Ledger Foundation

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357
> **Note:** Design-only document. No production schema or migration authorized.

---

## 1. Entity Relationship Diagram (Text)

```
┌─────────────────────────────┐    ┌─────────────────────────────┐
│       markets (existing)    │    │     members (existing)      │
├─────────────────────────────┤    ├─────────────────────────────┤
│ PK: id (uuid)               │    │ PK: id (uuid)               │
│ code (text, unique)         │    │ email (text, unique)        │
│ timezone (text, IANA)       │    │ ... (Phase 2 fields)        │
│ currency (text)             │    └─────────────┬───────────────┘
│ ...                         │                  │
└─────────────┬───────────────┘                  │
              │                                  │
              │ 1:N                              │ 1:N
              ▼                                  ▼
┌─────────────────────────────┐    ┌─────────────────────────────┐
│    member_wallet_accounts   │    │     merchants (existing)    │
├─────────────────────────────┤    ├─────────────────────────────┤
│ PK: id (uuid)               │    │ PK: id (uuid)               │
│ member_id (FK→members)      │    │ ...                         │
│ market_id (FK→markets)      │    └─────────────┬───────────────┘
│ balance (numeric(38,10))    │                  │
│ currency (text)             │                  │ 1:N
│ status (enumerated)         │                  │
│ created_at (utc timestamp)  │                  │
│ updated_at (utc timestamp)  │                  │
├─────────────────────────────┤                  │
│ UNIQUE: (member_id,         │                  │
│          market_id)         │                  │
└─────────────┬───────────────┘                  │
              │ 1:N                              │
              ▼                                  ▼
┌─────────────────────────────┐    ┌─────────────────────────────┐
│    member_wallet_entries    │    │     reward_sources          │
├─────────────────────────────┤    ├─────────────────────────────┤
│ PK: id (uuid)               │    │ PK: id (uuid)               │
│ account_id (FK→wallet)      │    │ source_type (text)          │
│ amount (numeric(38,10))     │    │ source_id (uuid)            │
│ balance_before (numeric)    │    │ member_id (FK→members)      │
│ balance_after (numeric)     │    │ market_id (FK→markets)      │
│ entry_type (text)           │    │ merchant_id (FK→merchants)  │
│ entry_subtype (text)        │    │ amount (numeric, purchase)  │
│ reward_plan_id (FK nullable)│    │ snapshot (jsonb, merchant   │
│ idempotency_key (text)      │    │          package snapshot)  │
│ reversal_of (FK nullable)   │    │ created_at (utc timestamp)  │
│ reason (text, nullable)     │    ├─────────────────────────────┤
│ actor_id (uuid, nullable)   │    │ UNIQUE: (source_type,       │
│ correlation_id (text)       │    │         source_id,          │
│ created_at (utc timestamp)  │    │         member_id,          │
├─────────────────────────────┤    │         market_id)          │
│ UNIQUE: (account_id,        │    └─────────────┬───────────────┘
│          idempotency_key)   │                  │
│ CHECK: amount > 0           │                  │ 1:1
│ (or amount < 0 for debits)  │                  │
└─────────────────────────────┘                  │
                                                 ▼
              ┌─────────────────────────────────────────────┐
              │          reward_plans                        │
              ├─────────────────────────────────────────────┤
              │ PK: id (uuid)                               │
              │ source_type (text)                           │
              │ source_id (uuid)                             │
              │ member_id (FK→members)                       │
              │ market_id (FK→markets)                       │
              │ merchant_id (FK→merchants)                   │
              │ status (SCHEDULED/ACTIVE/CAPPED/             │
              │         SUSPENDED/REVERSED/COMPLETED)        │
              │ total_earned (numeric(38,10))                │
              │ cap_amount (numeric, nullable)               │
              │ snapshot (jsonb, merchant package data)      │
              │ rule_version_id (FK→reward_rule_versions,    │
              │              nullable, set at first accrual) │
              │ activated_at (utc timestamp, nullable)       │
              │ completed_at (utc timestamp, nullable)       │
              │ created_at (utc timestamp)                   │
              ├─────────────────────────────────────────────┤
              │ UNIQUE: (source_type, source_id,             │
              │         member_id, market_id)                │
              └─────────────┬───────────────────────────────┘
                            │ 1:N
                            ▼
┌─────────────────────────────────────────────────────────┐
│        reward_daily_accruals                             │
├─────────────────────────────────────────────────────────┤
│ PK: id (uuid)                                           │
│ reward_plan_id (FK→reward_plans)                        │
│ member_id (FK→members)                                  │
│ market_id (FK→markets)                                  │
│ market_timezone (text, IANA)                            │
│ market_local_date (date, YYYY-MM-DD)                    │
│ executed_at_utc (utc timestamp)                         │
│ rule_version_id (FK→reward_rule_versions)               │
│ amount (numeric(38,10))                                 │
│ ledger_entry_type (text)                                │
│ wallet_entry_id (FK→member_wallet_entries, nullable)    │
│ idempotency_key (text)                                  │
│ correlation_id (text)                                   │
│ created_at (utc timestamp)                              │
├─────────────────────────────────────────────────────────┤
│ UNIQUE: (reward_plan_id, market_local_date,              │
│         ledger_entry_type)                              │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│        reward_rule_versions                             │
├─────────────────────────────────────────────────────────┤
│ PK: id (uuid)                                           │
│ name (text)                                             │
│ description (text, nullable)                            │
│ market_id (FK→markets, nullable — null = all markets)   │
│ rate (numeric, percentage — e.g. 0.01 = 1%)             │
│ effective_from (date, inclusive)                        │
│ effective_until (date, nullable, null = no expiry)      │
│ created_by (uuid, FK→admin_users)                       │
│ created_at (utc timestamp)                              │
├─────────────────────────────────────────────────────────┤
│ Note: Only future rules affect unaccrued dates.         │
│ Historical ledger entries are NOT recalculated.         │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Foreign Key Relationships

| Child Table            | Parent Table           | FK Column                         |
| ---------------------- | ---------------------- | --------------------------------- |
| member_wallet_accounts | members                | member_id                         |
| member_wallet_accounts | markets                | market_id                         |
| member_wallet_entries  | member_wallet_accounts | account_id                        |
| member_wallet_entries  | member_wallet_entries  | reversal_of (self-ref)            |
| member_wallet_entries  | reward_daily_accruals  | reward_plan_id (nullable)         |
| reward_sources         | members                | member_id                         |
| reward_sources         | markets                | market_id                         |
| reward_sources         | merchants              | merchant_id                       |
| reward_plans           | members                | member_id                         |
| reward_plans           | markets                | market_id                         |
| reward_plans           | merchants              | merchant_id                       |
| reward_plans           | reward_rule_versions   | rule_version_id (nullable)        |
| reward_plans           | reward_sources         | source_type + source_id (logical) |
| reward_daily_accruals  | reward_plans           | reward_plan_id                    |
| reward_daily_accruals  | reward_rule_versions   | rule_version_id                   |
| reward_daily_accruals  | member_wallet_entries  | wallet_entry_id (nullable)        |
| reward_rule_versions   | markets                | market_id (nullable)              |

---

## 3. Unique Constraints Summary

| Table                  | Unique Constraint                                      | Purpose                              |
| ---------------------- | ------------------------------------------------------ | ------------------------------------ |
| member_wallet_accounts | (member_id, market_id)                                 | One wallet per member per market     |
| member_wallet_entries  | (account_id, idempotency_key)                          | Prevent duplicate ledger entries     |
| reward_sources         | (source_type, source_id, member_id, market_id)         | One reward plan per qualifying event |
| reward_plans           | (source_type, source_id, member_id, market_id)         | Idempotent plan creation             |
| reward_daily_accruals  | (reward_plan_id, market_local_date, ledger_entry_type) | No duplicate daily settlement        |

---

## 4. Index Strategy

| Table                  | Index                               | Type                    |
| ---------------------- | ----------------------------------- | ----------------------- |
| member_wallet_accounts | (member_id)                         | B-tree                  |
| member_wallet_accounts | (market_id)                         | B-tree                  |
| member_wallet_entries  | (account_id, created_at)            | B-tree                  |
| member_wallet_entries  | (idempotency_key)                   | B-tree                  |
| reward_plans           | (member_id, market_id, status)      | B-tree                  |
| reward_plans           | (status)                            | Partial index on ACTIVE |
| reward_daily_accruals  | (reward_plan_id, market_local_date) | B-tree                  |
| reward_daily_accruals  | (idempotency_key)                   | B-tree                  |
| reward_rule_versions   | (market_id, effective_from)         | B-tree                  |
| reward_sources         | (member_id)                         | B-tree                  |
