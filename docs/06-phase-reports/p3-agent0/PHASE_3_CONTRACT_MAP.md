# Phase 3 Contract Map

> **File:** PHASE_3_CONTRACT_MAP.md
> **Author:** Agent 0 — Contract & Integration Lead
> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357
> **Status:** P3-S1 Engineering Freeze (design only, no production code)

---

## 1. Contract Overview

Phase 3 consists of **7 agents**, each owning a set of contracts (documents and modules). Below is the full dependency graph, file ownership, API surface, DB tables, and test requirements for each contract.

```
  ┌──────────────────┐
  │ Agent 6: Q&R     │─── Quality gates, testing framework
  └──────────────────┘
          │
  ┌───────┴──────────────────────────────────────────────────────┐
  │                                                              │
  ▼                                                              ▼
┌──────────────────────┐                           ┌──────────────────────┐
│ Agent 5: Admin Cfg   │─── Admin config & audit ──│ Agent 7: Docs       │
│ & Audit              │                           │                      │
└──────────┬───────────┘                           └──────────────────────┘
           │
           │ (admin endpoints, audit events)
           ▼
┌──────────────────────┐       ┌──────────────────────┐
│ Agent 1: Wallet &    │◄──────│ Agent 3: Transaction │
│ Immutable Ledger     │       │ Reward Snapshot      │
└──────────┬───────────┘       └──────────┬───────────┘
           │                              │
           │ (wallet entries)             │ (reward_sources)
           ▼                              ▼
┌──────────────────────┐       ┌──────────────────────┐
│ Agent 2: Reward Plan │◄──────│ Agent 3 (data)       │
│ & Rule Versioning    │       │                      │
└──────────┬───────────┘       └──────────────────────┘
           │
           │ (daily accrual via plans)
           ▼
┌──────────────────────┐
│ Agent 4: Daily       │
│ Reward Job           │
└──────────────────────┘
```

---

## 2. Agent 1 — Wallet & Immutable Ledger

### Source Contract Documents

| Document | Original File | Notes |
|---|---|---|
| Wallet State Model | [`PHASE_3_WALLET_LEDGER_CONTRACT.md`](../p3-s1/PHASE_3_WALLET_LEDGER_CONTRACT.md) | Ownership model, immutable rules |
| Decimal & Currency Spec | [`PHASE_3_DECIMAL_AND_CURRENCY_SPEC.md`](../p3-s1/PHASE_3_DECIMAL_AND_CURRENCY_SPEC.md) | Precision, rounding |
| Idempotency Spec | [`PHASE_3_IDEMPOTENCY_SPEC.md`](../p3-s1/PHASE_3_IDEMPOTENCY_SPEC.md) | Wallet entry idempotency |
| Reversal & Correction Spec | [`PHASE_3_REVERSAL_AND_CORRECTION_SPEC.md`](../p3-s1/PHASE_3_REVERSAL_AND_CORRECTION_SPEC.md) | Correction entries, reversals |

### Files Owned

| File | Purpose |
|---|---|
| `packages/database/schema/index.ts` | Adds `member_wallet_accounts`, `member_wallet_entries` tables + enums |
| `apps/api/src/wallet/wallet.module.ts` | NestJS module |
| `apps/api/src/wallet/wallet.controller.ts` | Wallet API controller |
| `apps/api/src/wallet/wallet.service.ts` | Wallet business logic |
| `apps/api/src/wallet/wallet.errors.ts` | Wallet error codes & factory functions |
| `apps/api/src/wallet/wallet.types.ts` | Wallet-specific types |
| `apps/api/src/wallet/__tests__/` | Unit tests |
| `packages/types/src/index.ts` | Adds shared wallet types |

### APIs Created

| Endpoint | Method | Description | Idempotent |
|---|---|---|---|
| `/wallets` | GET | List member's own wallets | Yes |
| `/wallets/:id` | GET | Get wallet + balance | Yes |
| `/wallets/:id/entries` | GET | List ledger entries (paginated) | Yes |
| `/wallets/:id/entries` | POST | Create ledger entry (internal/worker only) | Yes (idempotency_key) |
| `/wallets/:id/reversal` | POST | Create compensating entry | Yes |
| `/admin/wallets/:id/adjustment` | POST | Admin adjustment (deferred to Phase 7+) | No |

### DB Tables Required

| Table | Key Columns | Relationships |
|---|---|---|
| `member_wallet_accounts` | id, member_id (FK→members), market_id (FK→markets), balance, currency, status | UNIQUE(member_id, market_id) |
| `member_wallet_entries` | id, account_id (FK), amount, balance_before, balance_after, entry_type, entry_subtype, reward_plan_id (FK nullable), idempotency_key, reversal_of (self-FK), reason, actor_id, correlation_id | UNIQUE(account_id, idempotency_key) |

### Dependencies On

| Contract | Dependency |
|---|---|
| Agent 2 (Reward Plan) | Entries reference reward_plan_id |
| Agent 4 (Daily Reward Job) | Worker creates wallet entries |
| Agent 7 (Docs) | API documentation |

### Dependencies From

| Contract | Dependency |
|---|---|
| Agent 4 (Daily Reward Job) | Needs wallet entries to post reward accruals |

### Tests Required (P0)

| Test | Type |
|---|---|
| Create wallet account | Unit |
| Get wallet by id (owner access) | Unit |
| List wallets (member sees only own) | Unit |
| Wallet creation idempotency | Unit |
| Add credit entry → balance increases | Unit |
| Add debit entry → balance decreases | Unit |
| Balance = SUM(entries) at all times | Unit |
| Entry idempotency key duplicate → error | Unit |
| Reversal entry reduces balance | Unit |
| Wallet API: unauthorized → 403 | Unit |
| Wallet API: not found → 404 | Unit |

---

## 3. Agent 2 — Reward Plan & Rule Versioning

### Source Contract Documents

| Document | Original File | Notes |
|---|---|---|
| Reward Plan State Machine | [`PHASE_3_REWARD_PLAN_CONTRACT.md`](../p3-s1/PHASE_3_REWARD_PLAN_CONTRACT.md) | Plan lifecycle, states |
| Rule Version Contract | [`PHASE_3_REWARD_RULE_VERSION_CONTRACT.md`](../p3-s1/PHASE_3_REWARD_RULE_VERSION_CONTRACT.md) | Versioned rules, effective dates |
| Reward Source Contract | [`PHASE_3_REWARD_SOURCE_CONTRACT.md`](../p3-s1/PHASE_3_REWARD_SOURCE_CONTRACT.md) | Source event structure |

### Files Owned

| File | Purpose |
|---|---|
| `packages/database/schema/index.ts` | Adds `reward_plans`, `reward_rule_versions`, `reward_sources` tables |
| `apps/api/src/reward-plan/reward-plan.module.ts` | NestJS module |
| `apps/api/src/reward-plan/reward-plan.controller.ts` | Reward plan API |
| `apps/api/src/reward-plan/reward-plan.service.ts` | Plan business logic |
| `apps/api/src/reward-plan/reward-plan.errors.ts` | Reward plan error codes |
| `apps/api/src/reward-plan/reward-plan.types.ts` | Reward types |
| `apps/api/src/reward-plan/__tests__/` | Unit tests |
| `apps/api/src/reward-rule/reward-rule.module.ts` | Rule NestJS module |
| `apps/api/src/reward-rule/reward-rule.controller.ts` | Rule admin API |
| `apps/api/src/reward-rule/reward-rule.service.ts` | Rule business logic |
| `apps/api/src/reward-rule/reward-rule.errors.ts` | Rule error codes |
| `apps/api/src/reward-rule/reward-rule.types.ts` | Rule types |
| `apps/api/src/reward-rule/__tests__/` | Unit tests |
| `apps/api/src/reward-source/reward-source.module.ts` | Source module |
| `apps/api/src/reward-source/reward-source.errors.ts` | Source error codes |
| `apps/api/src/reward-source/reward-source.types.ts` | Source types |
| `apps/api/src/reward-source/__tests__/` | Unit tests |

### APIs Created

| Endpoint | Method | Description | Idempotent |
|---|---|---|---|
| `/reward-plans` | GET | List reward plans (member filtered) | Yes |
| `/reward-plans/:id` | GET | Get plan details + status | Yes |
| `/reward-plans` | POST | Create reward plan from source (internal) | Yes (source unique) |
| `/reward-plans/:id/suspend` | POST | Admin suspend plan | No |
| `/reward-plans/:id/resume` | POST | Admin resume plan | No |
| `/reward-plans/:id/reverse` | POST | Admin reverse plan | Yes (reversal idempotent) |
| `/admin/reward-rules` | GET | List rule versions | Yes |
| `/admin/reward-rules` | POST | Create rule version | No |
| `/admin/reward-rules/:id` | PATCH | Update rule version (before effective) | No |

### DB Tables Required

| Table | Key Columns | Relationships |
|---|---|---|
| `reward_sources` | id, source_type, source_id, member_id (FK), market_id (FK), merchant_id (FK), transaction_amount, snapshot (jsonb) | UNIQUE(source_type, source_id, member_id, market_id) |
| `reward_plans` | id, source_type, source_id, member_id (FK), market_id (FK), merchant_id (FK), status, total_earned, cap_amount, snapshot (jsonb), rule_version_id (FK nullable) | UNIQUE(source_type, source_id, member_id, market_id) |
| `reward_rule_versions` | id, name, description, market_id (FK nullable), rate, rate_type, effective_from, effective_until, config (jsonb), created_by (FK) | — |

### Dependencies On

| Contract | Dependency |
|---|---|
| Agent 1 (Wallet) | reward_daily_accruals links to wallet entries |
| Agent 3 (Transaction Reward Snapshot) | reward_sources → reward_plans |

### Dependencies From

| Contract | Dependency |
|---|---|
| Agent 4 (Daily Reward Job) | Queries ACTIVE reward_plans for accrual |

### Tests Required (P0)

| Test | Type |
|---|---|
| Create reward plan (valid source) | Unit |
| Create reward plan (duplicate → handled) | Unit |
| Plan status transitions (all states) | Unit |
| Invalid state transition → error | Unit |
| Create rule version with effective dates | Unit |
| Rule version selection by market + date | Unit |
| Historical rule preservation | Unit |

---

## 4. Agent 3 — Transaction Reward Snapshot

### Source Contract Documents

| Document | Original File | Notes |
|---|---|---|
| Reward Source Contract | [`PHASE_3_REWARD_SOURCE_CONTRACT.md`](../p3-s1/PHASE_3_REWARD_SOURCE_CONTRACT.md) | Source structure and lifecycle |
| ERD | [`PHASE_3_ERD.md`](../p3-s1/PHASE_3_ERD.md) | Entity relationships |

### Files Owned

| File | Purpose |
|---|---|
| `packages/database/schema/index.ts` | Adds `reward_sources` table (shared with Agent 2) |
| `apps/api/src/reward-source/reward-source.service.ts` | Source ingestion logic (shared) |
| `apps/api/src/reward-source/reward-source.transformer.ts` | Source-to-plan transformer |
| `apps/api/src/reward-source/reward-source.snapshot.ts` | Merchant/package snapshot capture |
| `apps/api/src/reward-source/__tests__/` | Snapshot unit tests |

**Note:** `reward_sources` table is **co-owned** by Agent 2 and Agent 3. Agent 3 owns the snapshot capture logic and source-to-plan transformation. Agent 2 owns the plan lifecycle that consumes the source.

### APIs Created

_No external APIs._ Agent 3 provides internal service methods used by the plan creation flow.

### DB Tables Required

_Shares_ `reward_sources` with Agent 2 (see Agent 2 table above).

### Dependencies On

| Contract | Dependency |
|---|---|
| Agent 2 (Reward Plan) | Sources feed into plan creation |
| Existing markets/merchants | For snapshot data retrieval |

### Dependencies From

| Contract | Dependency |
|---|---|
| Agent 2 (Reward Plan) | Plan creation depends on source snapshot |
| Agent 4 (Daily Reward Job) | Plan → daily accrual reads source snapshot fields |

### Tests Required (P0)

| Test | Type |
|---|---|
| Merchant snapshot at source creation | Unit |
| Package change after creation → no effect on snapshot | Unit |
| Source uniqueness constraint | Unit |
| Transformer: valid source → valid plan | Unit |

---

## 5. Agent 4 — Daily Reward Job

### Source Contract Documents

| Document | Original File | Notes |
|---|---|---|
| Settlement & Timezone Spec | [`PHASE_3_SETTLEMENT_AND_TIMEZONE_SPEC.md`](../p3-s1/PHASE_3_SETTLEMENT_AND_TIMEZONE_SPEC.md) | Worker execution, timezone handling |
| Idempotency Spec | [`PHASE_3_IDEMPOTENCY_SPEC.md`](../p3-s1/PHASE_3_IDEMPOTENCY_SPEC.md) | Daily accrual idempotency |
| Decimal Spec | [`PHASE_3_DECIMAL_AND_CURRENCY_SPEC.md`](../p3-s1/PHASE_3_DECIMAL_AND_CURRENCY_SPEC.md) | Accrual calculation precision |

### Files Owned

| File | Purpose |
|---|---|
| `packages/database/schema/index.ts` | Adds `reward_daily_accruals` table |
| `apps/api/src/settlement/settlement.module.ts` | NestJS worker module |
| `apps/api/src/settlement/settlement.worker.ts` | Main worker orchestration |
| `apps/api/src/settlement/settlement.service.ts` | Accrual calculation, persistence |
| `apps/api/src/settlement/settlement.timezone.ts` | Timezone utilities (market-local date) |
| `apps/api/src/settlement/settlement.errors.ts` | Settlement error codes |
| `apps/api/src/settlement/settlement.types.ts` | Settlement types |
| `apps/api/src/settlement/__tests__/` | Unit tests |

### APIs Created

| Endpoint | Method | Description | Idempotent |
|---|---|---|---|
| `/admin/settlement/trigger` | POST | Manual trigger for market settlement | No (admin) |
| `/admin/settlement/status` | GET | Settlement status for a market | Yes |

### DB Tables Required

| Table | Key Columns | Relationships |
|---|---|---|
| `reward_daily_accruals` | id, reward_plan_id (FK), member_id (FK), market_id (FK), market_timezone, market_local_date, executed_at_utc, rule_version_id (FK), amount, ledger_entry_type, wallet_entry_id (FK nullable), idempotency_key, correlation_id | UNIQUE(reward_plan_id, market_local_date, ledger_entry_type) |

### Dependencies On

| Contract | Dependency |
|---|---|
| Agent 1 (Wallet) | Creates wallet entries for each accrual |
| Agent 2 (Reward Plan) | Queries ACTIVE plans, updates total_earned |
| Agent 2 (Rule Version) | Resolves effective rule by date |
| Agent 3 (Snapshot) | Reads source snapshot (merchant data) |

### Dependencies From

| Contract | Dependency |
|---|---|
| Agent 5 (Admin Config) | Worker schedule configuration |
| Agent 6 (Q&R) | Timezone tests, concurrent execution tests |

### Tests Required (P0)

| Test | Type |
|---|---|
| Basic accrual calculation | Unit |
| Market timezone → local date mapping | Unit |
| Same-day duplicate → idempotent skip | Unit |
| Worker crash before tx commit → retry | Unit |
| Worker crash after tx commit → idempotent | Unit |
| Partial batch failure recovery | Unit |
| Concurrent market settlement | Integration |
| Timezone boundary (midnight, DST, leap day) | Unit |

---

## 6. Agent 5 — Admin Configuration & Audit

### Source Contract Documents

| Document | Original File | Notes |
|---|---|---|
| RBAC & Market Access Matrix | [`PHASE_3_RBAC_MARKET_ACCESS_MATRIX.md`](../p3-s1/PHASE_3_RBAC_MARKET_ACCESS_MATRIX.md) | Admin permissions, market scoping |
| Security & Privacy | [`PHASE_3_SECURITY_AND_PRIVACY.md`](../p3-s1/PHASE_3_SECURITY_AND_PRIVACY.md) | AuthZ rules, data protection |

### Files Owned

| File | Purpose |
|---|---|
| `apps/api/src/admin-wallet/admin-wallet.module.ts` | Admin wallet module |
| `apps/api/src/admin-wallet/admin-wallet.controller.ts` | Admin wallet endpoints |
| `apps/api/src/admin-wallet/admin-wallet.service.ts` | Admin wallet logic |
| `apps/api/src/admin-wallet/admin-wallet.errors.ts` | Admin wallet error codes |
| `apps/api/src/admin-wallet/__tests__/` | Unit tests |
| `apps/api/src/admin-reward/admin-reward.module.ts` | Admin reward module (rule CRUD) |
| `apps/api/src/admin-reward/admin-reward.controller.ts` | Admin reward endpoints |
| `apps/api/src/admin-reward/admin-reward.service.ts` | Admin reward logic |
| `apps/api/src/admin-reward/admin-reward.errors.ts` | Admin reward error codes |
| `apps/api/src/audit-wallet/audit-wallet.module.ts` | Wallet audit log module |
| `apps/api/src/audit-wallet/audit-wallet.service.ts` | Audit event generation |

### APIs Created

| Endpoint | Method | Description | Idempotent |
|---|---|---|---|
| `/admin/wallets` | GET | List wallets (admin, market-scoped) | Yes |
| `/admin/wallets/:id` | GET | Get wallet details | Yes |
| `/admin/wallets/:id/entries` | GET | List wallet entries (admin view) | Yes |
| `/admin/reward-rules` | POST | Create rule version (admin) | No |
| `/admin/reward-rules/:id` | PATCH | Update rule version (admin) | No |
| `/admin/audit/wallet` | GET | Wallet audit events (admin) | Yes |
| `/admin/audit/rewards` | GET | Reward audit events (admin) | Yes |

### DB Tables Required

No new tables. Agent 5 consumes existing Phase 3 tables and the existing `audit_logs` table.

### Dependencies On

| Contract | Dependency |
|---|---|
| Agent 1 (Wallet) | Reads wallet data for admin views |
| Agent 2 (Reward Plan/Rule) | Admin CRUD on rule versions |
| Agent 4 (Daily Reward Job) | Admin settlement trigger |
| Existing `audit_logs` table | Stores audit events |
| Existing `market_access` table | Admin market-scoping |

### Dependencies From

| Contract | Dependency |
|---|---|
| Agent 7 (Docs) | Admin API documentation |

### Tests Required (P0)

| Test | Type |
|---|---|
| Admin list wallets (market-scoped) | Unit |
| Admin wallet access (no scope → 403) | Unit |
| Admin create rule version | Unit |
| Admin update rule version | Unit |
| Audit event created for every mutation | Integration |
| Request ID propagated in audit logs | Unit |

---

## 7. Agent 6 — Quality & Reliability

### Source Contract Documents

| Document | Original File | Notes |
|---|---|---|
| Test & E2E Matrix | [`PHASE_3_TEST_AND_E2E_MATRIX.md`](../p3-s1/PHASE_3_TEST_AND_E2E_MATRIX.md) | Full test specifications |
| Migration Strategy | [`PHASE_3_MIGRATION_AND_ROLLBACK_STRATEGY.md`](../p3-s1/PHASE_3_MIGRATION_AND_ROLLBACK_STRATEGY.md) | DB migration approach |

### Files Owned

| File | Purpose |
|---|---|
| `apps/api/test/wallet/` | E2E tests for wallet flows |
| `apps/api/test/reward-plan/` | E2E tests for reward plan flows |
| `apps/api/test/settlement/` | E2E tests for daily settlement |
| `apps/api/test/timezone/` | Timezone-specific E2E tests |
| `apps/api/test/integration/phase3/` | Cross-module integration tests |
| `apps/api/test/security/phase3/` | Phase 3 security tests |
| `apps/api/test/performance/phase3/` | Phase 3 performance/load tests |

### APIs Created

None — Agent 6 is testing infrastructure only.

### DB Tables Required

None — Agent 6 uses Phase 3 test DB setup.

### Dependencies On

| Contract | Dependency |
|---|---|
| Agent 1, 2, 3, 4, 5 | All modules must be implemented for testing |
| Agent 0 (Integration Plan) | Integration test order, branch strategy |

### Dependencies From

| Contract | Dependency |
|---|---|
| Agent 7 (Docs) | Test results, coverage reports |

### Tests Required

See `PHASE_3_TEST_AND_E2E_MATRIX.md` for full matrix. Agent 6 owns E2E, integration, security, and performance tests.

---

## 8. Agent 7 — Documentation

### Source Contract Documents

Agent 7 produces no contract documents — it documents the output of Agents 1–6.

### Files Owned

| File | Purpose |
|---|---|
| `docs/06-phase-reports/p3-s1/P3-S1_DELIVERY_REPORT.md` | Final delivery report |
| `docs/api/wallet.md` | Wallet API documentation |
| `docs/api/reward-plan.md` | Reward plan API documentation |
| `docs/api/settlement.md` | Settlement API documentation |
| `docs/operations/settlement-worker.md` | Worker operations guide |
| `apps/admin-web/src/docs/` | Admin-facing help/docs |

### APIs Created

None — documentation only.

### Dependencies On

| Contract | Dependency |
|---|---|
| All agents | Document output of all implementations |

### Dependencies From

None.

---

## 9. Cross-Agent Dependency Summary

```
Agent 3 (Source/Snapshot)
  │
  ▼
Agent 2 (Reward Plan & Rule Versioning)
  │
  ▼
Agent 1 (Wallet & Immutable Ledger)
  ▲
  │
Agent 4 (Daily Reward Job)
  │
  ├── Agent 2 (plan status, rule resolution)
  ├── Agent 1 (wallet entries)
  └── Agent 3 (source snapshot data)
  │
  ▼
Agent 5 (Admin Config & Audit)
  │
  ├── Agent 1 (admin wallet views)
  ├── Agent 2 (admin rule CRUD)
  └── Agent 4 (admin settlement trigger)
  │
  ▼
Agent 6 (Q&R) ← depends on all agents for E2E tests
  │
  ▼
Agent 7 (Docs) ← documents all agents
```

### Dependency Rules

1. **No circular dependencies.** The dependency graph is strictly acyclic (DAG).
2. **Layer constraints:** Agent 2 depends on Agent 3; Agent 1 depends on Agent 2; Agent 4 depends on Agent 1+2+3.
3. **Settlement worker** (Agent 4) is the **integration nexus** — it touches all domain tables.
4. **Admin** (Agent 5) is a **read-heavy consumer** — it queries but rarely owns data.
5. **Q&R** (Agent 6) is the **last to execute** — it must have all other agents' work available.
6. **Docs** (Agent 7) is always **last**.
