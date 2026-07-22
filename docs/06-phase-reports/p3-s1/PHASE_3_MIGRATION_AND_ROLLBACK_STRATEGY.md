# Phase 3 Migration and Rollback Strategy

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357
> **Note:** Design-only document. No migration file may be created during P3-S1.

---

## 1. Principles

1. **Forward-only.** All migrations are forward-going. No destructive operations.
2. **Compatible.** All new tables and columns must be backward-compatible with existing code.
3. **Safe.** No table or column removal. No historical data rewrite.
4. **Verifiable.** Checksums and drift detection (existing infrastructure) validate migration integrity.
5. **Reversible.** Each forward migration has a compensating migration for rollback.

---

## 2. Proposed Migration Sequence (P3-S2+)

| Step | Migration                       | Type      | Description                       |
| ---- | ------------------------------- | --------- | --------------------------------- |
| 0014 | Create `member_wallet_accounts` | ADD TABLE | New wallet table                  |
| 0015 | Create `member_wallet_entries`  | ADD TABLE | Ledger entries with FK to wallets |
| 0016 | Create `wallet_indexes`         | ADD INDEX | Query performance indexes         |
| 0017 | Create `reward_rule_versions`   | ADD TABLE | Rule version table                |
| 0018 | Create `reward_sources`         | ADD TABLE | Source event records              |
| 0019 | Create `reward_plans`           | ADD TABLE | Reward plan lifecycle             |
| 0020 | Create `reward_plan_indexes`    | ADD INDEX | Performance indexes               |
| 0021 | Create `reward_daily_accruals`  | ADD TABLE | Daily settlement records          |
| 0022 | Create `accrual_indexes`        | ADD INDEX | Accrual query indexes             |

---

## 3. Nullable/Backfill Ordering

New tables (no backfill needed — all new data). However:

| Migration              | Nullable Consideration                                          |
| ---------------------- | --------------------------------------------------------------- |
| member_wallet_accounts | All columns NOT NULL except optionals                           |
| member_wallet_entries  | `reward_plan_id` nullable (independent wallet admin operations) |
|                        | `reversal_of` nullable (only reversal entries have this)        |
| reward_plans           | `cap_amount` nullable (uncapped plans)                          |
|                        | `completed_at` nullable (only completed plans)                  |
| reward_rule_versions   | `market_id` nullable (global rules)                             |
|                        | `effective_until` nullable (no expiry)                          |

---

## 4. Unique Constraint Rollout

| Table                  | Constraint                                             | Type   | Notes                                    |
| ---------------------- | ------------------------------------------------------ | ------ | ---------------------------------------- |
| member_wallet_accounts | (member_id, market_id)                                 | UNIQUE | Simple unique index                      |
| member_wallet_entries  | (account_id, idempotency_key)                          | UNIQUE | Performance + idempotency                |
| reward_sources         | (source_type, source_id, member_id, market_id)         | UNIQUE | Dedup source events                      |
| reward_plans           | (source_type, source_id, member_id, market_id)         | UNIQUE | One plan per event per member per market |
| reward_daily_accruals  | (reward_plan_id, market_local_date, ledger_entry_type) | UNIQUE | No duplicate settlement                  |

---

## 5. Index Creation Strategy

Create indexes **after** table creation (separate migration step) to:

- Keep table creation fast
- Allow indexes to be created concurrently (PostgreSQL `CREATE INDEX CONCURRENTLY`)
- Minimize production impact

---

## 6. Deployment Ordering

```
Step 1: Deploy code that can run with old schema (no new tables expected)
Step 2: Run migration 0014-0016 (wallet tables + indexes)
Step 3: Deploy code that expects wallet tables (readers deployed before writers)
Step 4: Run migration 0017-0018 (rule + source tables)
Step 5: Run migration 0019-0020 (reward plan tables + indexes)
Step 6: Deploy code for reward plan management
Step 7: Run migration 0021-0022 (daily accrual tables + indexes)
Step 8: Deploy settlement worker in disabled state
Step 9: Enable settlement worker per-market (gradual rollout)
```

---

## 7. Worker-Disabled Deployment State

New settlement worker must be deployable in a **disabled** state:

- No automatic scheduling
- Manual trigger only (for testing)
- Feature flag: `SETTLEMENT_WORKER_ENABLED` (default false)
- Per-market enablement for gradual rollout

---

## 8. Feature Enable Sequence

```
Step 1: Enable for 1 market, 1 test member
Step 2: Validate accrual, balance, audit trail
Step 3: Enable for all members in test market
Step 4: Enable for 1 additional market
Step 5: Gradually enable for all markets
```

---

## 9. Failed Migration Recovery

Strategy mirrors existing `migration-runner.ts` checksum/rollback pattern:

1. Migration fails during execution
2. Transaction rolls back (each migration is atomic)
3. Deployer checks migration status
4. Fix migration file
5. Re-run migration
6. Verify checksum and drift

---

## 10. Backup and Restore Prerequisites

Before any Phase 3 migration in production:

- Full database backup
- Verify backup integrity (restore to staging)
- Document restore procedure
- Practice restore in staging environment
- Prepare rollback runbook

---

## 11. Reconciliation Gate

Before enabling settlement for a market, a reconciliation must pass:

1. Sum all `member_wallet_entries.amount` grouped by `account_id`
2. Compare against `member_wallet_accounts.balance`
3. Flag any accounts where balance ≠ SUM(entries)
4. Do not enable settlement until all accounts reconcile

---

## 12. Rollback Plan

### Rollback via Feature Disable

If Phase 3 wallet/reward features cause issues:

1. Disable SETTLEMENT_WORKER_ENABLED feature flag
2. No new accruals created
3. Existing wallet balances remain accessible (read-only)
4. Existing wallet entries remain visible
5. System returns to Phase 2 stable state

### Rollback via Compensating Migration

If full schema rollback is required:

```
Compensating migration for 0014:
  → DROP TABLE member_wallet_entries CASCADE
  → DROP TABLE member_wallet_accounts CASCADE

Compensating migration for 0017-0022:
  → DROP TABLE reward_daily_accruals CASCADE
  → DROP TABLE reward_plans CASCADE
  → DROP TABLE reward_sources CASCADE
  → DROP TABLE reward_rule_versions CASCADE
```

**Warning:** `DROP TABLE CASCADE` is destructive. Only use if no critical data exists in these tables.

### Reconciliation Before Rollback

Before destructive rollback:

1. Export all wallet/ledger data for record-keeping
2. Verify no active accrual state that would be lost
3. Create audit trail documenting the rollback reason and authorization

---

## 13. Summary

| Aspect              | Strategy                                              |
| ------------------- | ----------------------------------------------------- |
| Migration style     | Forward-only SQL via existing runner                  |
| Table creation      | ADD TABLE only (no schema changes to existing tables) |
| Rollback (soft)     | Feature flag disable                                  |
| Rollback (hard)     | Compensating DROP TABLE migration                     |
| Data preservation   | Export before destructive operations                  |
| Gradual rollout     | Per-market enablement                                 |
| Reconciliation gate | Balance = SUM(entries) before enablement              |
| Backup              | Full DB backup before any migration                   |
