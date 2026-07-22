# Phase 3 Integration Plan

> **File:** PHASE_3_INTEGRATION_PLAN.md
> **Author:** Agent 0 — Contract & Integration Lead
> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357

---

## 1. Scope

This document defines:
- Order of integration for all 7 agents' work
- Branch strategy and conflict resolution
- Integration testing plan
- Merge coordination
- Rollback strategy

---

## 2. Integration Order

Phase 3 integration proceeds in **5 integration waves**:

```
Wave 1: Foundation
  Agent 3 (Source/Snapshot) ──► Agent 2 (Reward Plan & Rule Version)

Wave 2: Ledger
  Agent 1 (Wallet & Immutable Ledger)

Wave 3: Automation
  Agent 4 (Daily Reward Job)

Wave 4: Operations
  Agent 5 (Admin Config & Audit)

Wave 5: Quality & Delivery
  Agent 6 (Q&R) ──► Agent 7 (Docs)
```

### Wave 1 — Foundation (Agents 3 → 2)

| Step | Action | Dependencies Met | Verification |
|---|---|---|---|
| 1.1 | Agent 3 creates `reward_sources` table + source ingestion logic | Existing markets, members, merchants | `packages/database/schema/index.ts` has reward_sources |
| 1.2 | Agent 3 adds snapshot capture logic | Merchant package data available | reward_source created with valid snapshot |
| 1.3 | Agent 2 creates `reward_plans` table + plan lifecycle | reward_sources exist | Plan created from source, state transitions work |
| 1.4 | Agent 2 creates `reward_rule_versions` table + versioning | Market exists | Rule versions created, resolved by market+date |
| 1.5 | **Integration Gate 1:** Source → Plan → State Machine verified | All Wave 1 | Unit tests pass, source creates ACTIVE plan |

### Wave 2 — Ledger (Agent 1)

| Step | Action | Dependencies Met | Verification |
|---|---|---|---|
| 2.1 | Agent 1 creates `member_wallet_accounts` table | Members, markets exist | Wallet created per member+market |
| 2.2 | Agent 1 creates `member_wallet_entries` table + immutable rules | Wallet accounts exist | Entries created, balance = SUM(entries) |
| 2.3 | Agent 1 implements wallet API endpoints | Wallet tables ready | CRUD endpoints functional |
| 2.4 | Agent 1 implements idempotency for wallet entries | — | Duplicate key → handled |
| 2.5 | Agent 1 implements reversal/correction | Wallet entries exist | Compensating entries work |
| 2.6 | **Integration Gate 2:** Wallet + entries + balance verified | All Wave 1 + 2 | Wallet read/write/reversal cycle passes |

### Wave 3 — Automation (Agent 4)

| Step | Action | Dependencies Met | Verification |
|---|---|---|---|
| 3.1 | Agent 4 creates `reward_daily_accruals` table | reward_plans exist | Accrual records created |
| 3.2 | Agent 4 implements timezone utilities | Markets with IANA timezone | Market-local date correctly calculated |
| 3.3 | Agent 4 implements accrual calculation | Rule versions exist | Amount = purchase × rate |
| 3.4 | Agent 4 implements worker orchestration | All above | Worker runs, entries created |
| 3.5 | Agent 4 implements idempotent retry | reward_daily_accruals UNIQUE | Duplicate run = skip |
| 3.6 | Agent 4 implements distributed lock (DECISION_REQUIRED) | Redis or PostgreSQL | Lock acquired/released |
| 3.7 | **Integration Gate 3:** Full settlement cycle | All Wave 1+2+3 | Source → Plan → Wallet entry → Accrual record |

### Wave 4 — Operations (Agent 5)

| Step | Action | Dependencies Met | Verification |
|---|---|---|---|
| 4.1 | Agent 5 implements admin wallet endpoints | Agent 1 complete | Admin can view/list wallets |
| 4.2 | Agent 5 implements admin reward endpoints | Agent 2 complete | Admin CRUD rule versions |
| 4.3 | Agent 5 implements audit event generation | Existing audit_logs table | Events created for mutations |
| 4.4 | Agent 5 implements market-scoped access | Existing market_access | Admin sees only authorized markets |
| 4.5 | **Integration Gate 4:** Admin flow verified | All previous | Admin can view, trigger, audit |

### Wave 5 — Quality & Delivery (Agents 6 → 7)

| Step | Action | Dependencies Met | Verification |
|---|---|---|---|
| 5.1 | Agent 6 runs all unit tests | All agents complete | P0 tests 100% pass |
| 5.2 | Agent 6 runs E2E tests | All APIs deployed | Full user flows pass |
| 5.3 | Agent 6 runs timezone tests | Multiple timezone markets | Edge cases pass |
| 5.4 | Agent 6 runs security tests | All modules | AuthZ/isolation verified |
| 5.5 | Agent 6 runs integration tests | Cross-module flows | End-to-end cycle passes |
| 5.6 | Agent 7 produces documentation | All modules | Docs complete |
| 5.7 | **Final Integration Gate:** Full acceptance | All waves | All checklists passed |

---

## 3. Branch Strategy

### Branch Layout

```
main
└── phase3/
    ├── types/phase3-shared-types          ← Agent 0: shared types (merged first)
    ├── agent3/reward-source               ← Agent 3
    ├── agent2/reward-plan-rule            ← Agent 2 (depends on agent3)
    ├── agent1/wallet-ledger               ← Agent 1 (depends on agent2)
    ├── agent4/daily-reward                ← Agent 4 (depends on agent1, agent2)
    ├── agent5/admin-audit                 ← Agent 5 (depends on wave 1-3)
    ├── agent6/quality-reliability          ← Agent 6 (depends on all)
    └── agent7/documentation               ← Agent 7 (depends on all)
```

### Merge Strategy

```
Phase 3 Integration Branch: phase3/integration
                                    ▲
                                    │
                    ┌───────────────┴────────────────┐
                    │        Sequential Merge          │
                    │     (strict merge order)          │
                    └──────────────────────────────────┘
                                    │
        ┌──────────────┬──────────────┬──────────────┐
        ▼               ▼              ▼               ▼
   types/phase3     agent3/...     agent2/...        agent1/...
   -shared-types         │              │               │
        │                └──────┬───────┘               │
        │                       ▼                       │
        │               wave1-foundation                │
        │                       │                       │
        └───────────────┬───────┴───────┬───────────────┘
                        ▼               ▼
                   wave2-ledger     agent4/...
                        │               │
                        └───────┬───────┘
                                ▼
                         wave3-automation
                                │
                          agent5/...
                                │
                                ▼
                         wave4-operations
                                │
                          agent6/...
                          agent7/...
                                │
                                ▼
                        phase3/integration
                                │
                                ▼
                        phase3/final-review
                                │
                                ▼
                              main (via PR)
```

### Merge Rules

1. **No direct merges to `main` from agent branches.** All merges go through `phase3/integration`.
2. **Sequential order enforced.** Wave 2 branches cannot merge before Wave 1 passes integration gate.
3. **Dependent agent branches rebase** on `phase3/integration` after each wave merge.
4. **Merge commits only.** No squash merges on integration branch (preserves agent history).
5. **Squash to 1 commit** when merging `phase3/integration` → `main`.

---

## 4. Conflict Resolution Strategy

### Types of Conflicts

| Conflict Type | Likelihood | Resolution |
|---|---|---|
| **Schema conflicts** (two agents editing same table) | Low (ownership matrix defines clear boundaries) | Agent 0 adjudicates; Command Center decides if needed |
| **Shared type conflicts** | Low (types merged before implementation) | Agent 0 author of shared types branch; all agents review |
| **Module import conflicts** (app.module.ts) | Medium | Agent 0 maintains a module registration plan; all agents register in order |
| **Test configuration conflicts** | Low | Agent 6 owns test config; other agents add tests only to their own directories |
| **Package dependency conflicts** | Low | Phase 3 adds minimal new deps; npm/yarn resolves most conflicts |
| **Env/configuration conflicts** | Low | Each agent adds only their own config keys; Agent 0 validates no overlap |

### Conflict Resolution Protocol

1. **Low severity** (trivial merge conflict): Resolved by the merging agent, notify Agent 0.
2. **Medium severity** (schema field overlap, module registration): Agent 0 resolves and updates ownership matrix.
3. **High severity** (business logic conflict, shared invariant disagreement): Escalated to ChatGPT Command Center via Agent 0.

### Module Registration Order (app.module.ts)

To avoid conflicts when adding modules to `app.module.ts`:

```
// Phase 3 module registration order (sequential, append-only)
import { RewardSourceModule } from './reward-source/reward-source.module';  // Agent 3
import { RewardRuleModule } from './reward-rule/reward-rule.module';         // Agent 2
import { RewardPlanModule } from './reward-plan/reward-plan.module';         // Agent 2
import { WalletModule } from './wallet/wallet.module';                       // Agent 1
import { SettlementModule } from './settlement/settlement.module';            // Agent 4
import { AdminWalletModule } from './admin-wallet/admin-wallet.module';       // Agent 5
import { AdminRewardModule } from './admin-reward/admin-reward.module';       // Agent 5
import { AuditWalletModule } from './audit-wallet/audit-wallet.module';       // Agent 5
```

Each agent adds **only its own modules** to `app.module.ts`. All additions are append-only (no existing module removals or reordering).

---

## 5. Integration Testing Plan

### Integration Gate 1: Foundation (Source → Plan)

```
Test: Create reward_source → Verify reward_plan created with correct status and snapshot
Steps:
  1. Create a reward_source record with source_type=PURCHASE_TRANSACTION
  2. Verify reward_plans row created with status=SCHEDULED
  3. Verify snapshot contains correct merchant data
  4. Verify source duplicate → second attempt returns existing plan (idempotent)
```

### Integration Gate 2: Ledger (Wallet + Entries)

```
Test: Create wallet → Add entries → Verify balance
Steps:
  1. Create member+market → wallet auto-created
  2. Add reward accrual entry (credit)
  3. Verify wallet_accounts.balance = SUM(entries.amount)
  4. Add reversal entry → verify balance returns to original
  5. Verify idempotency: duplicate entry key → handled
```

### Integration Gate 3: Full Settlement Cycle

```
Test: Source → Plan → Wallet entry → Daily accrual
Steps:
  1. Create reward_source (simulated purchase transaction)
  2. Verify reward_plan created (SCHEDULED then ACTIVE)
  3. Execute settlement for market
  4. Verify:
     a. wallet entry created with correct amount
     b. wallet balance updated
     c. reward_daily_accruals record created
     d. reward_plans.total_earned incremented
     e. audit_log event created
  5. Re-execute settlement → verify idempotent (no duplicate entries)
  6. Suspend plan → execute settlement → verify no new entries
  7. Resume plan → execute settlement → verify new entries created
```

### Integration Gate 4: Admin Operations

```
Test: Admin wallet view + rule CRUD + settlement trigger
Steps:
  1. Admin without market scope → 403 on wallet access
  2. Admin with market scope → view all wallets in that market
  3. Admin create reward rule version
  4. Admin trigger settlement for market
  5. Verify audit events created for all mutations
```

### Integration Gate 5: Full Acceptance

```
Test: Complete end-to-end flow
Steps:
  1. Seed: member, market (with IANA timezone), merchant, admin
  2. Create reward rule version for market
  3. Create reward_source → reward_plan created
  4. Settlement triggers → accrual posted
  5. Member views wallet balance (member-web)
  6. Member views ledger entries (member-web)
  7. Admin views wallet, audites entries
  8. Admin suspends plan → no future accruals
  9. Admin resumes plan → accruals resume
  10. Reversal posted → balance restored
```

---

## 6. Key Integration Risk and Mitigation

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Agent 4 creates wallet entry via wrong API | Medium | High | Define CreateLedgerEntryParams as invariant; Agent 4 calls only Agent 1's public service method |
| Agent 2 and Agent 3 conflict on reward_sources ownership | Medium | Medium | Co-ownership documented; Agent 3 owns schema, Agent 2 owns lifecycle |
| Timezone calculation differs between Agent 2 (rule resolution) and Agent 4 (settlement) | Low | High | Share timezone utility via `packages/validation` or `packages/types` |
| Idempotency key format mismatch between agents | Low | High | Define key format in shared types; Agent 0 validates all keys match format |
| Decimal precision mismatch (one agent uses (38,10), another uses (20,4)) | Low | High | DECISION_REQUIRED resolved before integration starts |
| Race condition: settlement creates wallet entry while admin views balance | Low | Medium | PostgreSQL transaction isolation handles this; read-committed default is sufficient |
| Migration conflicts when merging schema changes | Medium | Medium | Agent 0 collects all schema additions into single migration for P3-S5 |
| Missing worker infrastructure (BullMQ/pg-boss) | Medium | High | Design lock; if infrastructure missing, use database-polling fallback |

---

## 7. Integration Schedule (Proposed)

| Wave | Duration | Dependencies | Integration Gate |
|---|---|---|---|
| 0 — Shared Types | 1 day | None | Types branch merged |
| 1 — Foundation | 3 days | Agent 0 types | Source → Plan passes |
| 2 — Ledger | 3 days | Wave 1 | Wallet + entries pass |
| 3 — Automation | 4 days | Wave 1+2 | Full settlement cycle passes |
| 4 — Operations | 2 days | Wave 1+2+3 | Admin flows pass |
| 5 — Quality | 3 days | All waves | Full acceptance passes |
| **Total** | **16 days** | — | All integration gates green |

### Parallelization

Within a wave, agents **may work in parallel** on branches based on the same base. However, **merges are sequential** — no wave merges before the previous wave's gate passes.

**Example:** During Wave 1, Agent 2 and Agent 3 both branch from `types/phase3-shared-types`. Agent 3 merges first (source tables), then Agent 2 rebases and merges (plan tables).

---

## 8. Rollback Strategy

### Pre-Merge Rollback (Per-Branch)

If an agent branch fails integration gate:
1. Branch is NOT merged to `phase3/integration`
2. Agent fixes issues on their branch
3. Branch is re-reviewed and re-integrated

### Post-Merge Rollback (Schema Rollback)

Rollback of `phase3/integration` uses the migration script defined in `PHASE_3_MIGRATION_AND_ROLLBACK_STRATEGY.md`:

```sql
-- Reverse order of migrations
DROP TABLE IF EXISTS reward_daily_accruals CASCADE;
DROP TABLE IF EXISTS member_wallet_entries CASCADE;
DROP TABLE IF EXISTS member_wallet_accounts CASCADE;
DROP TABLE IF EXISTS reward_plans CASCADE;
DROP TABLE IF EXISTS reward_sources CASCADE;
DROP TABLE IF EXISTS reward_rule_versions CASCADE;
-- Drop Phase 3 enums
DROP TYPE IF EXISTS reward_plan_status;
DROP TYPE IF EXISTS reward_rule_rate_type;
DROP TYPE IF EXISTS reward_source_type;
DROP TYPE IF EXISTS wallet_account_status;
DROP TYPE IF EXISTS wallet_entry_type;
DROP TYPE IF EXISTS wallet_entry_subtype;
```

### Git Rollback

If `phase3/integration` is merged to `main` and needs to be reverted:
1. Use `git revert <merge-commit-sha>` on `main`
2. This creates a revert commit; `main` is clean
3. Fix issues on `phase3/fix-branch`
4. Re-merge via normal PR process

---

## 9. Communication Protocol

| Event | Notification | Channel |
|---|---|---|
| Agent completes implementation | Ping Agent 0 | Phase 3 channel |
| Agent is blocked on integration gate | Ping Agent 0 | Phase 3 channel |
| Integration gate passes | Update DOCUMENT_LOG, notify Command Center | Phase 3 channel |
| Integration gate fails | Ping affected agent + Agent 0 | Phase 3 channel |
| Schema conflict detected | Ping Agent 0 | Phase 3 channel |
| DECISION_REQUIRED changes status | Update OPEN_QUESTIONS | DECISION_LOG |
| Integration branch created | Announce SHA | Phase 3 channel |
| Final merge to main | PR review with ChatGPT Command Center | PR review |
