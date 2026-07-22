# Phase 3 File Ownership Matrix

> **File:** PHASE_3_FILE_OWNERSHIP_MATRIX.md
> **Author:** Agent 0 — Contract & Integration Lead
> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357

---

## 1. Scope

This matrix defines exact file-level ownership for every file created or modified in Phase 3. Ownership is assigned to **one agent** per file, with **co-ownership** explicitly noted.

**Rules:**

- Each file has exactly one **primary owner** responsible for creation and maintenance
- Co-owned files require coordination between agents
- Test files belong to the owning agent of the source file
- E2E/integration files belong to Agent 6 (Q&R)

---

## 2. Database Schema — `packages/database/schema/index.ts`

| Table/Enum                   | Primary Owner | Co-Owner(s)        | Notes                                                                      |
| ---------------------------- | ------------- | ------------------ | -------------------------------------------------------------------------- |
| `member_wallet_accounts`     | Agent 1       | —                  | Full ownership                                                             |
| `member_wallet_entries`      | Agent 1       | —                  | Full ownership                                                             |
| `wallet_entry_type` enum     | Agent 1       | —                  | Values: REWARD_ACCRUAL, REVERSAL, CORRECTION, ADJUSTMENT                   |
| `wallet_entry_subtype` enum  | Agent 1       | —                  | Values: DAILY_ACCRUAL, FULL_REVERSAL, PARTIAL_CORRECTION, ADMIN_ADJUSTMENT |
| `wallet_account_status` enum | Agent 1       | —                  | Values: ACTIVE, FROZEN, CLOSED                                             |
| `reward_sources`             | **Agent 3**   | Agent 2 (reads)    | Agent 3 defines columns; Agent 2 consumes                                  |
| `reward_plans`               | **Agent 2**   | Agent 1, 4 (reads) | Agent 2 defines columns                                                    |
| `reward_plan_status` enum    | Agent 2       | —                  | Values: SCHEDULED, ACTIVE, CAPPED, SUSPENDED, REVERSED, COMPLETED          |
| `reward_rule_versions`       | **Agent 2**   | —                  | Full ownership                                                             |
| `reward_rule_rate_type` enum | Agent 2       | —                  | Values: PERCENTAGE, FIXED, TIERED                                          |
| `reward_daily_accruals`      | **Agent 4**   | Agent 2 (plan FK)  | Agent 4 defines columns                                                    |
| `reward_source_type` enum    | Agent 3       | Agent 2 (shared)   | Values: PURCHASE_TRANSACTION, MANUAL_ADMIN                                 |

### Insert Order (Migration Dependencies)

```
1. reward_source_type enum         (Agent 3)
2. reward_rule_rate_type enum      (Agent 2)
3. reward_plan_status enum         (Agent 2)
4. reward_rule_versions            (Agent 2) — no FK to Phase 3 tables
5. reward_sources                  (Agent 3) — FKs to existing members, markets, merchants
6. reward_plans                    (Agent 2) — FKs to reward_sources, reward_rule_versions
7. wallet_account_status enum      (Agent 1)
8. wallet_entry_type enum          (Agent 1)
9. wallet_entry_subtype enum       (Agent 1)
10. member_wallet_accounts         (Agent 1) — FKs to members, markets
11. member_wallet_entries          (Agent 1) — FKs to member_wallet_accounts, reward_plans
12. reward_daily_accruals          (Agent 4) — FKs to reward_plans, reward_rule_versions, member_wallet_entries
```

---

## 3. API Layer — `apps/api/src/`

### Agent 1: Wallet & Immutable Ledger

| File                                                      | Ownership | Notes           |
| --------------------------------------------------------- | --------- | --------------- |
| `apps/api/src/wallet/wallet.module.ts`                    | Agent 1   | NestJS module   |
| `apps/api/src/wallet/wallet.controller.ts`                | Agent 1   | REST controller |
| `apps/api/src/wallet/wallet.service.ts`                   | Agent 1   | Business logic  |
| `apps/api/src/wallet/wallet.errors.ts`                    | Agent 1   | Error codes     |
| `apps/api/src/wallet/wallet.types.ts`                     | Agent 1   | Wallet types    |
| `apps/api/src/wallet/wallet.dto.ts`                       | Agent 1   | Validation DTOs |
| `apps/api/src/wallet/wallet.guard.ts`                     | Agent 1   | Ownership guard |
| `apps/api/src/wallet/__tests__/wallet.service.spec.ts`    | Agent 1   | Unit tests      |
| `apps/api/src/wallet/__tests__/wallet.controller.spec.ts` | Agent 1   | Unit tests      |

### Agent 2: Reward Plan & Rule Versioning

| File                                                             | Ownership | Notes           |
| ---------------------------------------------------------------- | --------- | --------------- |
| `apps/api/src/reward-plan/reward-plan.module.ts`                 | Agent 2   | NestJS module   |
| `apps/api/src/reward-plan/reward-plan.controller.ts`             | Agent 2   | REST controller |
| `apps/api/src/reward-plan/reward-plan.service.ts`                | Agent 2   | Business logic  |
| `apps/api/src/reward-plan/reward-plan.errors.ts`                 | Agent 2   | Error codes     |
| `apps/api/src/reward-plan/reward-plan.types.ts`                  | Agent 2   | Plan types      |
| `apps/api/src/reward-plan/reward-plan.dto.ts`                    | Agent 2   | Validation DTOs |
| `apps/api/src/reward-plan/reward-plan.state-machine.ts`          | Agent 2   | State machine   |
| `apps/api/src/reward-plan/__tests__/reward-plan.service.spec.ts` | Agent 2   | Unit tests      |
| `apps/api/src/reward-rule/reward-rule.module.ts`                 | Agent 2   | NestJS module   |
| `apps/api/src/reward-rule/reward-rule.controller.ts`             | Agent 2   | REST controller |
| `apps/api/src/reward-rule/reward-rule.service.ts`                | Agent 2   | Business logic  |
| `apps/api/src/reward-rule/reward-rule.errors.ts`                 | Agent 2   | Error codes     |
| `apps/api/src/reward-rule/reward-rule.types.ts`                  | Agent 2   | Rule types      |
| `apps/api/src/reward-rule/reward-rule.dto.ts`                    | Agent 2   | Validation DTOs |
| `apps/api/src/reward-rule/__tests__/reward-rule.service.spec.ts` | Agent 2   | Unit tests      |

### Agent 3: Transaction Reward Snapshot

| File                                                                     | Ownership | Notes                     |
| ------------------------------------------------------------------------ | --------- | ------------------------- |
| `apps/api/src/reward-source/reward-source.module.ts`                     | Agent 3   | NestJS module             |
| `apps/api/src/reward-source/reward-source.service.ts`                    | Agent 3   | Source ingestion          |
| `apps/api/src/reward-source/reward-source.transformer.ts`                | Agent 3   | Source → plan             |
| `apps/api/src/reward-source/reward-source.snapshot.ts`                   | Agent 3   | Merchant/package snapshot |
| `apps/api/src/reward-source/reward-source.errors.ts`                     | Agent 3   | Error codes               |
| `apps/api/src/reward-source/reward-source.types.ts`                      | Agent 3   | Types                     |
| `apps/api/src/reward-source/__tests__/reward-source.service.spec.ts`     | Agent 3   | Unit tests                |
| `apps/api/src/reward-source/__tests__/reward-source.transformer.spec.ts` | Agent 3   | Unit tests                |
| `apps/api/src/reward-source/__tests__/reward-source.snapshot.spec.ts`    | Agent 3   | Unit tests                |

### Agent 4: Daily Reward Job

| File                                                            | Ownership | Notes                                |
| --------------------------------------------------------------- | --------- | ------------------------------------ |
| `apps/api/src/settlement/settlement.module.ts`                  | Agent 4   | NestJS module                        |
| `apps/api/src/settlement/settlement.worker.ts`                  | Agent 4   | Worker orchestration                 |
| `apps/api/src/settlement/settlement.service.ts`                 | Agent 4   | Accrual logic, persistence           |
| `apps/api/src/settlement/settlement.timezone.ts`                | Agent 4   | Timezone utilities                   |
| `apps/api/src/settlement/settlement.errors.ts`                  | Agent 4   | Error codes                          |
| `apps/api/src/settlement/settlement.types.ts`                   | Agent 4   | Types                                |
| `apps/api/src/settlement/settlement.config.ts`                  | Agent 4   | Worker config                        |
| `apps/api/src/settlement/settlement.lock.ts`                    | Agent 4   | Distributed lock (DECISION_REQUIRED) |
| `apps/api/src/settlement/__tests__/settlement.service.spec.ts`  | Agent 4   | Unit tests                           |
| `apps/api/src/settlement/__tests__/settlement.timezone.spec.ts` | Agent 4   | Unit tests                           |
| `apps/api/src/settlement/__tests__/settlement.worker.spec.ts`   | Agent 4   | Unit tests                           |

### Agent 5: Admin Configuration & Audit

| File                                                               | Ownership | Notes                  |
| ------------------------------------------------------------------ | --------- | ---------------------- |
| `apps/api/src/admin-wallet/admin-wallet.module.ts`                 | Agent 5   | NestJS module          |
| `apps/api/src/admin-wallet/admin-wallet.controller.ts`             | Agent 5   | Admin endpoints        |
| `apps/api/src/admin-wallet/admin-wallet.service.ts`                | Agent 5   | Admin wallet logic     |
| `apps/api/src/admin-wallet/admin-wallet.errors.ts`                 | Agent 5   | Error codes            |
| `apps/api/src/admin-wallet/admin-wallet.types.ts`                  | Agent 5   | Types                  |
| `apps/api/src/admin-wallet/__tests__/admin-wallet.service.spec.ts` | Agent 5   | Unit tests             |
| `apps/api/src/admin-reward/admin-reward.module.ts`                 | Agent 5   | NestJS module          |
| `apps/api/src/admin-reward/admin-reward.controller.ts`             | Agent 5   | Admin reward endpoints |
| `apps/api/src/admin-reward/admin-reward.service.ts`                | Agent 5   | Admin reward logic     |
| `apps/api/src/admin-reward/admin-reward.errors.ts`                 | Agent 5   | Error codes            |
| `apps/api/src/admin-reward/__tests__/admin-reward.service.spec.ts` | Agent 5   | Unit tests             |
| `apps/api/src/audit-wallet/audit-wallet.module.ts`                 | Agent 5   | Audit module           |
| `apps/api/src/audit-wallet/audit-wallet.service.ts`                | Agent 5   | Audit generation       |

---

## 4. Types Package — `packages/types/src/index.ts`

| Type                  | Primary Owner | Consumed By   | Notes                           |
| --------------------- | ------------- | ------------- | ------------------------------- |
| `WalletId`            | Agent 1       | All agents    | Branded type                    |
| `WalletEntryId`       | Agent 1       | Agent 4, 5    | Branded type                    |
| `RewardPlanId`        | Agent 2       | Agent 1, 4, 5 | Branded type                    |
| `RewardRuleVersionId` | Agent 2       | Agent 4       | Branded type                    |
| `RewardSourceId`      | Agent 3       | Agent 2       | Branded type                    |
| `SettlementId`        | Agent 4       | Agent 5       | Branded type                    |
| `MarketLocalDate`     | Agent 4       | Agent 2       | Date type with timezone context |
| `EntryType`           | Agent 1       | Agent 4       | Union of wallet entry types     |
| `IdempotencyKey`      | Agent 0       | All agents    | Shared branded string type      |

### Shared Type Ownership Rules

- **Branded types** are created by their primary owner and exported from `packages/types/`
- All agents import from `packages/types/` — never define shared types locally
- Agent-specific types (e.g., DTO shapes) stay in the agent's `*.types.ts` files

---

## 5. Validation Package — `packages/validation/src/index.ts`

| Schema                      | Primary Owner | Consumed By                 |
| --------------------------- | ------------- | --------------------------- |
| `walletIdSchema`            | Agent 1       | `apps/api/src/wallet/`      |
| `entryTypeSchema`           | Agent 1       | `apps/api/src/wallet/`      |
| `rewardPlanIdSchema`        | Agent 2       | `apps/api/src/reward-plan/` |
| `rewardRuleVersionIdSchema` | Agent 2       | `apps/api/src/reward-rule/` |
| `settlementTriggerSchema`   | Agent 4       | `apps/api/src/settlement/`  |
| `marketLocalDateSchema`     | Agent 4       | `apps/api/src/settlement/`  |
| `idempotencyKeySchema`      | Agent 0       | All agents (shared)         |
| `decimalStringSchema`       | Agent 0       | All agents (shared)         |

**Note:** Existing schemas (`marketCodeSchema`, `timezoneSchema`) already live in `packages/validation/`. Phase 3 additions extend this package.

---

## 6. Member Web — `apps/member-web/src/`

_Phase 3 scope: minimal member-facing display only. Full member web integration deferred._

| File                                                | Ownership | Notes                  |
| --------------------------------------------------- | --------- | ---------------------- |
| `apps/member-web/src/pages/WalletPage.tsx`          | Agent 1   | Wallet balance display |
| `apps/member-web/src/pages/WalletEntriesPage.tsx`   | Agent 1   | Ledger entry list      |
| `apps/member-web/src/pages/RewardPlanPage.tsx`      | Agent 2   | Reward plan status     |
| `apps/member-web/src/components/WalletBalance.tsx`  | Agent 1   | Balance card component |
| `apps/member-web/src/components/WalletEntryRow.tsx` | Agent 1   | Entry row component    |
| `apps/member-web/src/hooks/useWallet.ts`            | Agent 1   | Wallet data hook       |
| `apps/member-web/src/hooks/useRewardPlan.ts`        | Agent 2   | Plan data hook         |

---

## 7. E2E and Integration Tests — `apps/api/test/`

| File/Directory                                               | Ownership | Notes            |
| ------------------------------------------------------------ | --------- | ---------------- |
| `apps/api/test/wallet/create-wallet.e2e-spec.ts`             | Agent 6   | E2E test         |
| `apps/api/test/wallet/wallet-entries.e2e-spec.ts`            | Agent 6   | E2E test         |
| `apps/api/test/reward-plan/plan-lifecycle.e2e-spec.ts`       | Agent 6   | E2E test         |
| `apps/api/test/reward-rule/rule-versioning.e2e-spec.ts`      | Agent 6   | E2E test         |
| `apps/api/test/settlement/basic-accrual.e2e-spec.ts`         | Agent 6   | E2E test         |
| `apps/api/test/settlement/timezone.e2e-spec.ts`              | Agent 6   | E2E test         |
| `apps/api/test/settlement/retry-recovery.e2e-spec.ts`        | Agent 6   | E2E test         |
| `apps/api/test/settlement/concurrent.e2e-spec.ts`            | Agent 6   | E2E test         |
| `apps/api/test/integration/phase3/full-cycle.e2e-spec.ts`    | Agent 6   | Full integration |
| `apps/api/test/security/phase3/wallet-isolation.e2e-spec.ts` | Agent 6   | Security         |

---

## 8. Doc Files — `docs/`

| File                                                        | Ownership | Notes                  |
| ----------------------------------------------------------- | --------- | ---------------------- |
| `docs/06-phase-reports/p3-s1/P3-S1_DELIVERY_REPORT.md`      | Agent 7   | Delivery report        |
| `docs/06-phase-reports/p3-s1/P3-S1_HOST_BRIDGE_DELIVERY.md` | Agent 7   | Bridge delivery        |
| `docs/06-phase-reports/p3-agent0/*`                         | Agent 0   | Contract & Integration |

---

## 9. Ownership Conflict Resolution

| Conflict Type                            | Resolution                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| Two agents modify same file              | Merge via PR with both agents as reviewers                                   |
| Two agents modify same table in schema   | Agent 0 coordinates the schema additions; each agent adds only their columns |
| Two agents modify same error code module | Not allowed — each module has one owner                                      |
| Test file ownership dispute              | Agent 6 (Q&R) is final arbiter for test structure                            |
| Shared type definition dispute           | Agent 0 (Integration) is final arbiter for shared types                      |
| API contract dispute                     | Agent 0 (Integration) mediates; ChatGPT Command Center decides               |

### Schema Modification Protocol

1. Agent adds their tables/enums to `packages/database/schema/index.ts`
2. Agent runs no migration — all schema work is staged
3. Before P3-S5 (integration), Agent 0 collects all schema additions into a single migration
4. Each agent's schema addition must be marked with comment: `// P3-Agent-N`
