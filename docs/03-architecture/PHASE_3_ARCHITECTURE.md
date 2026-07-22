# Phase 3 Architecture — Multi-Market Wallet & Reward Ledger Foundation

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357
> **Authority:** Derived from P3-S1 design freeze; non-normative until P3-S2+ implementation
> **Document Type:** Reference architecture (supersedes `docs/06-phase-reports/p3-s1/PHASE_3_ARCHITECTURE.md`)

---

## 1. System Context

Phase 3 adds the **iPoint Wallet & Reward Ledger** subsystem to the iPoint modular monolith. This subsystem is responsible for:

- Maintaining per-member, per-market iPoint wallet accounts
- Recording every balance change as an immutable ledger entry
- Tracking qualifying purchase transactions as reward sources
- Creating reward plans from reward sources with versioned rule application
- Executing daily reward accrual at each market's local 00:00 boundary
- Supporting administrative compensation entries and reversals
- Preserving full audit correlation across all operations

### Boundary

```
                    ┌──────────────────────────────────┐
                    │       iPoint Platform            │
                    │  (Existing Phase 0-2 modules)    │
                    │                                  │
                    │  ┌────────────────────────────┐  │
                    │  │  Phase 3 Subsystem          │  │
                    │  │                            │  │
                    │  │  ┌──────────┐ ┌─────────┐ │  │
                    │  │  │ Wallet & │ │ Reward   │ │  │
                    │  │  │ Ledger   │ │ Plan &   │ │  │
                    │  │  │          │ │ Rule     │ │  │
                    │  │  └────┬─────┘ └────┬────┘ │  │
                    │  │       │             │      │  │
                    │  │  ┌────▼─────────────▼────┐ │  │
                    │  │  │  Daily Settlement     │ │  │
                    │  │  │  (Worker)             │ │  │
                    │  │  └───────────────────────┘ │  │
                    │  │                            │  │
                    │  │  ┌──────────┐ ┌──────────┐ │  │
                    │  │  │  Admin   │ │  Audit   │ │  │
                    │  │  │  Config  │ │  Events  │ │  │
                    │  │  └──────────┘ └──────────┘ │  │
                    │  └────────────────────────────┘  │
                    │                                  │
                    │  Markets │ Members │ Merchants   │
                    │  (Shared domain entities)        │
                    └──────────────────────────────────┘
```

---

## 2. Module Architecture

### 2.1 Wallet & Immutable Ledger (Agent 1)

**Module:** `WalletModule`
**Files:** `apps/api/src/wallet/`

**Responsibility:**

- Create wallet accounts per (member_id, market_id)
- Maintain wallet lifecycle (ACTIVE, FROZEN, CLOSED)
- Accept ledger entries with mandatory idempotency
- Enforce balance invariant: `account.balance = SUM(entries.amount)`
- Support compensating entries (reversals and partial corrections)
- Provide member-facing wallet views

**Key Design Decisions:**

- Lazy wallet creation: created on first qualifying event, not at registration
- `numeric(38,10)` precision matching existing MCP ledger
- String serialization for all monetary values in API responses
- Immutable entries enforced by UNIQUE constraint on (account_id, idempotency_key)
- Reversals reference the original entry via `reversal_of` self-FK

**Service Layer:**

```
WalletService
├── createWallet(memberId, marketId) → WalletAccount
├── getWallet(id) → WalletAccount
├── listWallets(memberId) → WalletAccount[]
├── listEntries(accountId, filters) → PaginatedEntries
├── createEntry(params) → WalletEntry      // Internal/worker only
├── reverseEntry(accountId, originalEntryId, params) → WalletEntry
└── getBalance(accountId) → string
```

### 2.2 Reward Plan & Rule Versioning (Agent 2)

**Modules:** `RewardPlanModule`, `RewardRuleModule`, `RewardSourceModule`
**Files:** `apps/api/src/reward-plan/`, `apps/api/src/reward-rule/`

**Sub-module — Reward Source:**

- Captures qualifying purchase transactions
- Creates merchant + package snapshots at event time
- UNIQUE constraint on (source_type, source_id, member_id, market_id)

**Sub-module — Reward Plan:**

- Created automatically from each reward source
- Lifecycle: SCHEDULED → ACTIVE → [CAPPED | SUSPENDED | REVERSED | COMPLETED]
- Tracks `total_earned` against configurable `cap_amount`
- Stores merchant snapshot for historical reference
- Rule version assigned at first accrual event

**Sub-module — Reward Rule Version:**

- Versioned reward rates per market
- Effective date range (effective_from, effective_until)
- Historical preservation — existing ledger entries never recalculated
- Rate types: PERCENTAGE, FIXED, TIERED

**State Machine (Reward Plan):**

```
                  ┌──────────┐
                  │SCHEDULED │
                  └────┬─────┘
                       │ auto-activate on first accrual
                       ▼
                  ┌──────────┐
         ┌───────│  ACTIVE  │◄──────────┐
         │       └─────┬────┘           │
         │             │                │
         ▼             ▼                │
   ┌──────────┐ ┌──────────┐           │
   │ CAPPED   │ │SUSPENDED │───────────┘
   └────┬─────┘ └────┬─────┘  resume
        │             │
        ▼             ▼
   ┌──────────┐ ┌──────────┐
   │COMPLETED │ │ REVERSED │
   └──────────┘ └──────────┘
```

### 2.3 Daily Reward Settlement (Agent 4)

**Module:** `SettlementModule`
**Files:** `apps/api/src/settlement/`

**Responsibility:**

- Query all ACTIVE reward plans
- For each plan, determine if market-local date has advanced since last accrual
- Calculate accrual amount: `purchase_amount × effective_rule_rate`
- Create wallet ledger entry for each accrual
- Create `reward_daily_accruals` record per (plan_id, market_local_date, entry_type)
- Update `reward_plans.total_earned`
- Check cap: if `total_earned + accrual > cap_amount`, cap at `cap_amount - total_earned` and transition plan to CAPPED
- Generate audit events

**Worker Execution Model (CONFIGURABLE):**

- Periodic polling engine (BullMQ / pg-boss / database polling)
- Configurable polling interval (default every 5 minutes)
- Per-market execution lock to prevent concurrent settlement
- Idempotency via UNIQUE (reward_plan_id, market_local_date, ledger_entry_type)

### 2.4 Admin Configuration & Audit (Agent 5)

**Modules:** `AdminWalletModule`, `AdminRewardModule`, `AuditWalletModule`
**Files:** `apps/api/src/admin-wallet/`, `apps/api/src/admin-reward/`, `apps/api/src/audit-wallet/`

**Responsibility:**

- Admin wallet views (market-scoped)
- Admin reward plan lifecycle management (suspend, resume, reverse)
- Admin rule version CRUD
- Wallet/reward audit event generation
- Settlement trigger endpoint

### 2.5 Module Dependency DAG

```
Agent 3 (Reward Source/Snapshot)
  │  reward_sources table, snapshot capture
  ▼
Agent 2 (Reward Plan & Rule Version)
  │  plan lifecycle, rule resolution, state machine
  ▼
Agent 1 (Wallet & Immutable Ledger)
  │  wallet accounts, ledger entries, balance calculation
  ▲
  │
Agent 4 (Daily Reward Job)
  │  reads plans, creates wallet entries, posts accruals
  │
  ├── depends on Agent 2 for plan status + rule resolution
  ├── depends on Agent 1 for wallet entry creation
  └── depends on Agent 3 for source snapshot data
  │
  ▼
Agent 5 (Admin Config & Audit)
  │  admin views, audit event generation, settlement trigger
  │
  ▼
Agent 6 (Q&R) → Agent 7 (Docs)
```

---

## 3. Data Architecture

### 3.1 Schema Overview

```
┌──────────────────────┐      ┌──────────────────────┐
│   reward_rule_       │      │    reward_sources    │
│   versions           │      │                      │
├──────────────────────┤      ├──────────────────────┤
│ PK: id (uuid)        │      │ PK: id (uuid)        │
│ name, description    │      │ source_type, source_id│
│ market_id (FK)       │      │ member_id (FK)       │
│ rate (numeric(12,8)) │      │ market_id (FK)       │
│ effective_from/until │      │ merchant_id (FK)     │
│ created_by (FK)      │      │ amount (numeric)     │
└──────────┬───────────┘      │ snapshot (jsonb)     │
           │                  └──────────┬───────────┘
           │ 1:N                         │ 1:1
           │                  ┌──────────▼───────────┐
           │                  │    reward_plans       │
           │                  ├──────────────────────┤
           │                  │ PK: id (uuid)        │
           │                  │ status (enumerated)  │
           │                  │ total_earned (numeric)│
           │                  │ cap_amount (numeric) │
           │                  │ rule_version_id (FK) │
           │                  │ snapshot (jsonb)     │
           │                  └──────────┬───────────┘
           │                             │ 1:N
           │                  ┌──────────▼───────────┐
           │                  │ reward_daily_accruals │
           │                  ├──────────────────────┤
           │                  │ market_local_date     │
           │                  │ amount (numeric)      │
           │                  │ wallet_entry_id (FK)  │
           │                  │ idempotency_key       │
           │                  └──────────┬───────────┘
           │                             │
           │                  ┌──────────▼───────────┐
           │                  │ member_wallet_accounts│
           │                  ├──────────────────────┤
           │                  │ member_id (FK)       │
           │                  │ market_id (FK)       │
           │                  │ balance (numeric)    │
           │                  │ status (enumerated)  │
           │                  └──────────┬───────────┘
           │                             │ 1:N
           │                  ┌──────────▼───────────┐
           │                  │ member_wallet_entries │
           │                  ├──────────────────────┤
           │                  │ amount (numeric)     │
           │                  │ balance_before/after  │
           │                  │ entry_type/subtype    │
           │                  │ idempotency_key       │
           │                  │ reversal_of (self-FK) │
           │                  │ correlation_id        │
           └──────────────────┘                       │
                              └───────────────────────┘
```

### 3.2 Table Migrations Order

1. `reward_source_type` enum (Agent 3)
2. `reward_rule_rate_type` enum (Agent 2)
3. `reward_plan_status` enum (Agent 2)
4. `reward_rule_versions` (Agent 2)
5. `reward_sources` (Agent 3)
6. `reward_plans` (Agent 2)
7. `wallet_account_status` enum (Agent 1)
8. `wallet_entry_type` / `wallet_entry_subtype` enums (Agent 1)
9. `member_wallet_accounts` (Agent 1)
10. `member_wallet_entries` (Agent 1)
11. `reward_daily_accruals` (Agent 4)

---

## 4. Timezone Architecture

### 4.1 Market-Midnight Settlement

```
Market MY (Asia/Kuala_Lumpur, UTC+8)
  Local 00:00 at UTC 16:00 (prev day)
  Settlement runs after 16:00 UTC

Market SG (Asia/Singapore, UTC+8)
  Local 00:00 at UTC 16:00 (prev day)
  Same as MY

Market JP (Asia/Tokyo, UTC+9)
  Local 00:00 at UTC 15:00 (prev day)
  One hour before MY/SG
```

### 4.2 Timezone Handling

- All timestamps stored in UTC
- Market-local date calculated at settlement time using market's IANA timezone
- Each `reward_daily_accruals` record stores the IANA timezone and local date
- Rule version resolution uses market timezone context
- DST transitions: market-local date progression is monotonic; no "missing" or "duplicate" dates for standard timezones

### 4.3 Edge Cases

| Case                                 | Handling                                                                |
| ------------------------------------ | ----------------------------------------------------------------------- |
| Market timezone changes              | New accruals use new timezone; existing accruals unchanged              |
| Worker starts before market midnight | Idempotency prevents duplicate; next poll detects date change           |
| Worker misses a day                  | Catch-up on next execution; UNIQUE prevents duplicate but allows gap    |
| Daylight saving "spring forward"     | Market-local date advances by 1 day normally                            |
| Daylight saving "fall back"          | Same date occurs twice; UNIQUE (plan_id, date, type) prevents duplicate |

---

## 5. Security Architecture

### 5.1 Authentication & Authorization

| Layer                | Mechanism              | Phase 3 Application                    |
| -------------------- | ---------------------- | -------------------------------------- |
| Transport            | HTTPS                  | All wallet/reward APIs                 |
| Authentication       | JWT + Auth Guard       | Member token for member endpoints      |
| Member authorization | Ownership guard        | `wallet.member_id === token.member_id` |
| Admin authorization  | Market access scope    | Admin must have explicit market_access |
| Worker authorization | Internal service token | System-to-system authentication        |

### 5.2 Market Isolation

```
Request ──> Auth Guard ──> Ownership Check ──> Market Check
                │               │                    │
                ▼               ▼                    ▼
          Token has:      member_id matches    market_id belongs to
          member_id       resource owner       member's wallet scope
```

### 5.3 Audit Events

| Event Type                 | Trigger                           | Actor               |
| -------------------------- | --------------------------------- | ------------------- |
| WALLET_CREATED             | New wallet account                | SYSTEM / WORKER     |
| WALLET_ENTRY_CREATED       | Ledger entry posted               | SYSTEM / WORKER     |
| WALLET_STATUS_CHANGED      | Freeze/close wallet               | ADMIN_USER          |
| REWARD_PLAN_CREATED        | New plan from source              | SYSTEM              |
| REWARD_PLAN_STATUS_CHANGED | Suspend/resume/reverse/completion | SYSTEM / ADMIN_USER |
| REWARD_RULE_CREATED        | New rule version                  | ADMIN_USER          |
| REWARD_RULE_UPDATED        | Rule version edited               | ADMIN_USER          |
| DAILY_ACCRUAL_POSTED       | Settlement creates accrual        | SYSTEM (WORKER)     |
| SETTLEMENT_COMPLETED       | Market settlement cycle done      | SYSTEM (WORKER)     |
| REVERSAL_POSTED            | Compensating entry created        | ADMIN_USER / SYSTEM |

---

## 6. Idempotency Architecture

### 6.1 Idempotency Key Format

```
<operation_prefix>:<unique_payload_hash>
```

| Operation            | Prefix          | Key Composition                                                 |
| -------------------- | --------------- | --------------------------------------------------------------- |
| Wallet entry         | `wallet_entry`  | `wallet_entry:<UUID>`                                           |
| Daily accrual        | `daily_accrual` | `daily_accrual:<plan_id>:<date>:<entry_type>`                   |
| Reward plan creation | `reward_plan`   | `reward_plan:<source_type>:<source_id>:<member_id>:<market_id>` |
| Reversal             | `reversal`      | `reversal:<original_entry_id>`                                  |

### 6.2 Enforcement

- **Database-level:** UNIQUE constraints on idempotency_key columns
- **Application-level:** Try-insert with conflict handling (ON CONFLICT DO NOTHING / RETURN existing)
- **Duplicate response:** HTTP 200 with existing resource body (not 409) — idempotent operation returns same result

---

## 7. Decimal & Currency Architecture

| Field                    | Type             | Precision               |
| ------------------------ | ---------------- | ----------------------- |
| Wallet balance           | `numeric(38,10)` | 38 total, 10 fractional |
| Wallet entry amount      | `numeric(38,10)` | 38 total, 10 fractional |
| Reward plan total_earned | `numeric(38,10)` | 38 total, 10 fractional |
| Reward plan cap_amount   | `numeric(38,10)` | 38 total, 10 fractional |
| Reward source amount     | `numeric(38,10)` | 38 total, 10 fractional |
| Daily accrual amount     | `numeric(38,10)` | 38 total, 10 fractional |
| Rule version rate        | `numeric(12,8)`  | 12 total, 8 fractional  |

**Rounding:** HALF_UP for all accrual operations
**API serialization:** String for all monetary values
**Display precision:** 2 decimal places (0.01 iPoint) for members; full precision for admin/audit

---

## 8. Settlement Worker State Machine

```
         ┌──────────────┐
         │   IDLE       │
         └──────┬───────┘
                │ Timer tick / manual trigger
                ▼
         ┌──────────────┐
         │  LOCKING     │── Acquire per-market lock
         └──────┬───────┘
                │ Lock acquired
                ▼
         ┌──────────────┐
         │  SCANNING    │── Query ACTIVE plans with date change
         └──────┬───────┘
                │
                ▼
         ┌──────────────┐      For each plan:
         │  ACCRUING    │── res = resolveRule(market, date)
         └──────┬───────┘     calc = purchaseAmount × rate
                │             cap = min(calc, cap)
                ▼
         ┌──────────────┐
         │  POSTING     │── create wallet entry
         └──────┬───────┘     create accrual record
                │             update total_earned
                ▼
         ┌──────────────┐
         │  CAP_CHECK   │── IF total_earned >= cap → CAPPED
         └──────┬───────┘
                │
                ▼
         ┌──────────────┐
         │  AUDITING    │── create AuditEvent
         └──────┬───────┘
                │
                ▼
         ┌──────────────┐
         │  UNLOCKING   │── Release per-market lock
         └──────┬───────┘
                │
                ▼
         ┌──────────────┐
         │   IDLE       │
         └──────────────┘

Error recovery:
  LOCKING failed → retry after backoff
  ACCRUING failed → log error, continue next plan
  POSTING failed → idempotent retry
  AUDITING failed → log error (non-fatal for settlement)
```

---

## 9. API Surface Summary

### Member Endpoints

| Method | Path                          | Auth         | Description              |
| ------ | ----------------------------- | ------------ | ------------------------ |
| GET    | `/api/v1/wallets`             | Member token | List own wallets         |
| GET    | `/api/v1/wallets/:id`         | Member token | Wallet detail + balance  |
| GET    | `/api/v1/wallets/:id/entries` | Member token | Paginated ledger entries |
| GET    | `/api/v1/reward-plans`        | Member token | List own reward plans    |
| GET    | `/api/v1/reward-plans/:id`    | Member token | Plan detail              |

### Admin Endpoints

| Method | Path                                     | Auth                 | Description               |
| ------ | ---------------------------------------- | -------------------- | ------------------------- |
| GET    | `/api/v1/admin/wallets`                  | Admin + market scope | List all wallets          |
| GET    | `/api/v1/admin/wallets/:id`              | Admin + market scope | Wallet detail             |
| GET    | `/api/v1/admin/wallets/:id/entries`      | Admin + market scope | Paginated entries         |
| POST   | `/api/v1/admin/wallets/:id/reversal`     | Admin                | Create compensating entry |
| GET    | `/api/v1/admin/reward-plans`             | Admin + market scope | List reward plans         |
| GET    | `/api/v1/admin/reward-plans/:id`         | Admin + market scope | Plan detail               |
| POST   | `/api/v1/admin/reward-plans/:id/suspend` | Admin                | Suspend plan              |
| POST   | `/api/v1/admin/reward-plans/:id/resume`  | Admin                | Resume plan               |
| POST   | `/api/v1/admin/reward-plans/:id/reverse` | Admin                | Reverse plan              |
| POST   | `/api/v1/admin/reward-rule-versions`     | Super Admin          | Create rule version       |
| GET    | `/api/v1/admin/reward-rule-versions`     | Admin + market scope | List rules                |
| PATCH  | `/api/v1/admin/reward-rule-versions/:id` | Super Admin          | Update rule               |
| POST   | `/api/v1/admin/settlement/trigger`       | Admin                | Manual market settlement  |
| GET    | `/api/v1/admin/settlement/status`        | Admin                | Settlement status         |

### Internal Endpoints

| Method | Path                                   | Auth          | Description         |
| ------ | -------------------------------------- | ------------- | ------------------- |
| POST   | `/api/v1/internal/wallets/:id/entries` | Service token | Create ledger entry |

---

## 10. Related Documents

| Document                   | Location                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 3 ERD                | [`PHASE_3_ERD.md`](./PHASE_3_ERD.md)                                                                                                     |
| Wallet Ledger Contract     | [`../06-phase-reports/p3-s1/PHASE_3_WALLET_LEDGER_CONTRACT.md`](../06-phase-reports/p3-s1/PHASE_3_WALLET_LEDGER_CONTRACT.md)             |
| Reward Plan Contract       | [`../06-phase-reports/p3-s1/PHASE_3_REWARD_PLAN_CONTRACT.md`](../06-phase-reports/p3-s1/PHASE_3_REWARD_PLAN_CONTRACT.md)                 |
| Settlement & Timezone Spec | [`../06-phase-reports/p3-s1/PHASE_3_SETTLEMENT_AND_TIMEZONE_SPEC.md`](../06-phase-reports/p3-s1/PHASE_3_SETTLEMENT_AND_TIMEZONE_SPEC.md) |
| Idempotency Spec           | [`../06-phase-reports/p3-s1/PHASE_3_IDEMPOTENCY_SPEC.md`](../06-phase-reports/p3-s1/PHASE_3_IDEMPOTENCY_SPEC.md)                         |
| Error Codes Reference      | [`../04-engineering/PHASE_3_ERROR_CODES.md`](../04-engineering/PHASE_3_ERROR_CODES.md)                                                   |
| Migration Runbook          | [`../04-engineering/PHASE_3_MIGRATION_RUNBOOK.md`](../04-engineering/PHASE_3_MIGRATION_RUNBOOK.md)                                       |
| Daily Job Ops Guide        | [`../04-engineering/PHASE_3_DAILY_JOB_OPS.md`](../04-engineering/PHASE_3_DAILY_JOB_OPS.md)                                               |
| Open Questions             | [`../06-phase-reports/p3-s1/PHASE_3_OPEN_QUESTIONS.md`](../06-phase-reports/p3-s1/PHASE_3_OPEN_QUESTIONS.md)                             |
