# CI Failure Matrix — Phase 3 P3-S1

> **Date:** 2026-07-22
> **Status:** RECORDED — Known CI failures and sandbox limitations  
> **Related Run:** n/a (sandbox-only analysis; no CI trigger available)
> **Key Reference:** TRACK_B_VALIDATION_REPORT.md for root cause environment analysis

---

## 1. Environment Constraints

The primary blocker for all CI steps in the sandbox is **insufficient memory (ENOMEM)** and **broken symlinks** from host-path dependency. As documented in [TRACK_B_VALIDATION_REPORT.md](./TRACK_B_VALIDATION_REPORT.md):

- pnpm install requires memory beyond sandbox limits → SIGKILL/ENOMEM
- `node_modules` symlinks previously pointed to `/mnt/host/c/AI_WORKSPACE/...` (non-existent in sandbox)
- `pnpm install --frozen-lockfile` removed existing package content before failing

**Fix applied:** Symlinks were repaired in sandbox (577 symlinks re-created from `.pnpm` virtual store; 29 host-path symlinks removed and replaced). However, the sandbox still cannot run `pnpm install` or `pnpm build` due to ENOMEM.

---

## 2. Agent B — Build Failures

### 2.1 Build Pipeline (pnpm build)

| Step           | Expected             | Actual in Sandbox                            | Resolved?                      |
| -------------- | -------------------- | -------------------------------------------- | ------------------------------ |
| `pnpm install` | Install all deps     | ENOMEM — not enough memory                   | ❌ Cannot test in sandbox      |
| `pnpm build`   | Compile all packages | Cannot execute (install prerequisite failed) | ❌ Requires host/GitHub runner |

### 2.2 Static Analysis Issues Identified

The following potential TypeScript issues were identified by code inspection and must be verified on a proper CI runner:

| #   | File                                        | Issue                                                                                                                                                                         | Severity                 |
| --- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | `apps/api/src/wallet/wallet.service.ts:340` | Dynamic `await import('./wallet.errors.js')` used instead of static import for `walletEntryNotFoundError`. This breaks tree-shaking and may cause circular dependency issues. | MEDIUM                   |
| 2   | `apps/api/src/wallet/wallet.service.ts`     | Import of `memberWalletAccounts`, `memberWalletEntries` from `@ipoint/database` must be exported from the database package's `schema/index.ts`. **Confirmed exported.**       | ✅ OK                    |
| 3   | `apps/api/src/wallet/wallet.module.ts`      | Imports `DatabaseModule` from `../database/database.module.js` and `AuthModule` from `../auth/auth.module.js` — modules must exist and export required providers.             | NEEDS BUILD VERIFICATION |
| 4   | `packages/database/src/expected-schema.ts`  | Missing Phase 3 tables: `member_wallet_accounts`, `member_wallet_entries`, `daily_job_runs`, `reward_daily_accruals`. **FIX APPLIED** — see Agent D.                          | ✅ FIXED                 |
| 5   | `packages/database/src/drift-check.ts`      | Drift check compares `expected-schema` against live DB schema. Now aligned after fix.                                                                                         | NEEDS DB VERIFICATION    |

### 2.3 Recommended Build Fixes

1. **Run on GitHub Actions or Windows host** where adequate memory is available
2. **No code changes should be needed** — the wallet module follows the same patterns as other Phase 1/2 modules
3. **Verify build on host** using `scripts/host-pipeline.ps1` (Windows) or GitHub CI

---

## 3. Agent C — Wallet Test Failures

### 3.1 Test Pipeline (pnpm test -- apps/api/src/wallet)

| Step                      | Expected       | Actual in Sandbox                        | Resolved?                 |
| ------------------------- | -------------- | ---------------------------------------- | ------------------------- |
| `vitest run` wallet tests | All tests pass | Cannot execute (no build, no DB, ENOMEM) | ❌ Cannot test in sandbox |

### 3.2 Test Analysis

The wallet test files were reviewed for correctness:

| Test File         | File                              | Tests                | Status                     |
| ----------------- | --------------------------------- | -------------------- | -------------------------- |
| Unit tests        | `wallet.service.spec.ts`          | 14 test cases        | ✅ Code structure verified |
| Integration tests | `wallet.http.integration.spec.ts` | 4 test (all skipped) | ✅ Requires DB — skipped   |

### 3.3 Unit Test Issues Identified

| #   | Test                                                     | Issue                                                                                                                                                                                                                                       | Severity |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | `createLedgerEntry creates a pending entry successfully` | Complex Drizzle query builder mocking with `runTransaction`. The mock setup polls `db.select` for multiple different return values using `callCount` tracking. Mock complexity may hide real bugs.                                          | MEDIUM   |
| 2   | `getWallets`                                             | Uses `.then()` on mock chain objects instead of returning proper Drizzle Query Promise. The test for `getWallets` creates a `mockChain` with `.then()` which mimics the Drizzle query builder's thenable behavior. May cause timing issues. | LOW      |
| 3   | `getEntries`                                             | Uses `callCount` to route different mock return values. Fragile; adding a new query to the method would break the count ordering.                                                                                                           | LOW      |
| 4   | `getEntry`                                               | The service code uses `await import('./wallet.errors.js')` for dynamic import of `walletEntryNotFoundError`. This is an odd pattern — all other errors use static imports at top of file.                                                   | MEDIUM   |
| 5   | `balance computation`                                    | Validates that `pendingBalance` is a string, not numeric. This aligns with the API response types.                                                                                                                                          | ✅ OK    |

### 3.4 Recommended Test Fixes

1. **Replace dynamic import** in `wallet.service.ts:340` with static import:
   ```typescript
   // In wallet.service.ts, add at the top with other imports:
   import { walletEntryNotFoundError } from './wallet.errors.js';
   // Then replace:
   const { walletEntryNotFoundError } = await import('./wallet.errors.js');
   // with:
   throw walletEntryNotFoundError();
   ```
2. **Run tests on host** — unit tests do not require a database (properly mocked)
3. **Integration tests** will always be skipped without TEST_DATABASE_URL — this is by design

---

## 4. Agent D — Database Drift / Migration Failures

### 4.1 Schema Drift Pipeline

| Step               | Expected                   | Actual in Sandbox                        | Resolved?                 |
| ------------------ | -------------------------- | ---------------------------------------- | ------------------------- |
| `pnpm db:checksum` | Verify immutable checksums | Cannot execute (no pnpm build, no DB)    | ❌ Cannot test in sandbox |
| `pnpm db:migrate`  | Apply pending migrations   | Cannot execute (no PostgreSQL available) | ❌ Requires PostgreSQL    |
| `pnpm db:drift`    | Detect schema drift        | Cannot execute                           | ❌ Requires PostgreSQL    |

### 4.2 Schema Drift: expected-schema.ts vs schema/index.ts

| Phase 3 Table            | expected-schema.ts (before) | expected-schema.ts (after) | schema/index.ts |
| ------------------------ | --------------------------- | -------------------------- | --------------- |
| `member_wallet_accounts` | ❌ MISSING                  | ✅ ADDED                   | ✅ Present      |
| `member_wallet_entries`  | ❌ MISSING                  | ✅ ADDED                   | ✅ Present      |
| `daily_job_runs`         | ❌ MISSING                  | ✅ ADDED                   | ✅ Present      |
| `reward_daily_accruals`  | ❌ MISSING                  | ✅ ADDED                   | ✅ Present      |
| `reward_rule_versions`   | ✅ Present                  | ✅ Unchanged               | ✅ Present      |
| `reward_plans`           | ✅ Present                  | ✅ Unchanged               | ✅ Present      |
| `reward_sources`         | ✅ Present                  | ✅ Unchanged               | ✅ Present      |

### 4.3 Migration File Status

| Check                      | Status                             | Notes                                  |
| -------------------------- | ---------------------------------- | -------------------------------------- |
| Migration directory exists | ✅ `packages/database/migrations/` | Checkable                              |
| Phase 3 migration files    | ⚠️ UNKNOWN                         | Run `ls migrations/` on host to verify |
| `db:checksum` passes       | ⚠️ NEEDS VERIFICATION              | Requires running on host/CI            |
| `db:drift` passes          | ⚠️ NEEDS VERIFICATION              | Requires running on host/CI            |
| `db:migrate` succeeds      | ⚠️ NEEDS VERIFICATION              | Requires PostgreSQL on host/CI         |

### 4.4 Migration Strategy

Per `PHASE_3_MIGRATION_AND_ROLLBACK_STRATEGY.md`:

- Phase 3 migrations should be **forward-only additive** (no destructive DDL)
- Each migration must have a **reversible down migration**
- **Checksums must be immutable** — once applied, a migration file cannot change

### 4.5 Recommended Migration Script

If Phase 3 migration files need to be created (verify on host):

```sql
-- Create member_wallet_accounts
CREATE TABLE IF NOT EXISTS member_wallet_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id),
  market_id UUID NOT NULL REFERENCES markets(id),
  pending_balance NUMERIC(38,10) NOT NULL DEFAULT '0',
  available_balance NUMERIC(38,10) NOT NULL DEFAULT '0',
  reversed_balance NUMERIC(38,10) NOT NULL DEFAULT '0',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT member_wallet_accounts_member_market_unique UNIQUE (member_id, market_id),
  CONSTRAINT member_wallet_accounts_pending_balance_check CHECK (pending_balance >= 0),
  CONSTRAINT member_wallet_accounts_available_balance_check CHECK (available_balance >= 0),
  CONSTRAINT member_wallet_accounts_reversed_balance_check CHECK (reversed_balance >= 0),
  CONSTRAINT member_wallet_accounts_version_check CHECK (version > 0)
);

-- Create member_wallet_entries
CREATE TABLE IF NOT EXISTS member_wallet_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_account_id UUID NOT NULL REFERENCES member_wallet_accounts(id),
  member_id UUID NOT NULL REFERENCES members(id),
  market_id UUID NOT NULL REFERENCES markets(id),
  entry_sequence BIGINT NOT NULL,
  entry_type TEXT NOT NULL,
  amount NUMERIC(38,10) NOT NULL,
  balance_before NUMERIC(38,10) NOT NULL,
  balance_after NUMERIC(38,10) NOT NULL,
  idempotency_key TEXT NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  description TEXT,
  reason TEXT,
  actor_id TEXT,
  market_timezone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT member_wallet_entries_wallet_sequence_unique UNIQUE (wallet_account_id, entry_sequence),
  CONSTRAINT member_wallet_entries_idempotency_key_unique UNIQUE (idempotency_key),
  CONSTRAINT member_wallet_entries_amount_check CHECK (amount > 0)
);

-- Create daily_job_runs
CREATE TABLE IF NOT EXISTS daily_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  market_id UUID NOT NULL REFERENCES markets(id),
  local_business_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  total_entitlements INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_job_runs_type_market_date_unique UNIQUE (job_type, market_id, local_business_date),
  CONSTRAINT daily_job_runs_total_entitlements_check CHECK (total_entitlements >= 0),
  CONSTRAINT daily_job_runs_processed_count_check CHECK (processed_count >= 0),
  CONSTRAINT daily_job_runs_failed_count_check CHECK (failed_count >= 0)
);

-- Create reward_daily_accruals
CREATE TABLE IF NOT EXISTS reward_daily_accruals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_plan_id UUID NOT NULL REFERENCES reward_plans(id),
  member_id UUID NOT NULL REFERENCES members(id),
  market_id UUID NOT NULL REFERENCES markets(id),
  reward_rule_version_id UUID REFERENCES reward_rule_versions(id),
  market_timezone TEXT NOT NULL,
  market_local_date DATE NOT NULL,
  executed_at_utc TIMESTAMPTZ NOT NULL,
  amount NUMERIC(38,10) NOT NULL,
  ledger_entry_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  audit_correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reward_daily_accruals_idempotency_unique UNIQUE (reward_plan_id, market_local_date, ledger_entry_type),
  CONSTRAINT reward_daily_accruals_idempotency_key_unique UNIQUE (idempotency_key),
  CONSTRAINT reward_daily_accruals_amount_check CHECK (amount > 0),
  CONSTRAINT reward_daily_accruals_idempotency_check CHECK (char_length(idempotency_key) > 0)
);
```

---

## 5. Agent E — CI Evidence (This Document)

### 5.1 Failure Summary

| CI Pipeline        | Status            | Blocker        | Fix Path       |
| ------------------ | ----------------- | -------------- | -------------- |
| Format check       | ⚠️ UNVERIFIED     | ENOMEM sandbox | Run on host/CI |
| Lint               | ⚠️ UNVERIFIED     | ENOMEM sandbox | Run on host/CI |
| TypeCheck          | ⚠️ UNVERIFIED     | ENOMEM sandbox | Run on host/CI |
| Build all packages | ❌ NOT EXECUTABLE | ENOMEM sandbox | Run on host/CI |
| Unit tests         | ❌ NOT EXECUTABLE | ENOMEM sandbox | Run on host/CI |
| Wallet tests       | ❌ NOT EXECUTABLE | ENOMEM sandbox | Run on host/CI |
| DB checksum        | ❌ NOT EXECUTABLE | No PostgreSQL  | Run on host/CI |
| DB migrate         | ❌ NOT EXECUTABLE | No PostgreSQL  | Run on host/CI |
| DB drift           | ❌ NOT EXECUTABLE | No PostgreSQL  | Run on host/CI |
| DB seed            | ❌ NOT EXECUTABLE | No PostgreSQL  | Run on host/CI |

### 5.2 Issues Requiring Human Attention

1. **Dynamic import in wallet.service.ts** — `const { walletEntryNotFoundError } = await import('./wallet.errors.js')` should be a static import. This is inconsistent with all other error imports in the file.

2. **expected-schema.ts drift** — Four Phase 3 tables were missing from the expected schema snapshot. **FIX APPLIED** by this agent.

3. **Drizzle mock complexity** — Unit tests use complex mock chains that may break when query methods are added/removed. Consider using a Drizzle mock library.

4. **Sandbox CI dependency** — Full CI pipeline cannot run in sandbox. Must be executed on:
   - Windows host (PowerShell pipeline)
   - GitHub Actions (Linux with PostgreSQL service)

### 5.3 Follow-up Actions

| #   | Action                                                                | Owner            | Priority |
| --- | --------------------------------------------------------------------- | ---------------- | -------- |
| 1   | Run `pnpm build` on Windows host                                      | Codex CLI (host) | HIGH     |
| 2   | Run `pnpm test -- apps/api/src/wallet --reporter verbose` on host     | Codex CLI (host) | HIGH     |
| 3   | Verify `expected-schema.ts` changes work with `pnpm db:drift` on host | Codex CLI (host) | MEDIUM   |
| 4   | Create/verify Phase 3 migration files                                 | Codex CLI (host) | MEDIUM   |
| 5   | Fix dynamic import in `wallet.service.ts` (line ~340)                 | Codex CLI        | LOW      |
| 6   | Run `pnpm db:checksum` to verify migration file integrity             | Codex CLI (host) | MEDIUM   |

---

## 6. Appendix: Code Quality Observations

### 6.1 Wallet Service

```typescript
// wallet.service.ts — Code quality observations

// ✅ Good: Clear separation of concerns
// ✅ Good: Immutable ledger entries (no update/delete)
// ✅ Good: Optimistic locking via version field
// ✅ Good: Idempotency key enforcement
// ✅ Good: Transaction-based balance updates
// ✅ Good: Decimal precision via numeric(38,10)

// ⚠️ Dynamic import pattern (line ~340):
//   This should use a static import instead:
//   import { walletEntryNotFoundError } from './wallet.errors.js';
//   Then simply: throw walletEntryNotFoundError();

// ⚠️ Optimistic lock retry:
//   The service throws an error on version mismatch but does not retry.
//   Caller must handle retry. This is acceptable but worth noting.
```

### 6.2 Wallet DTO Validation

```typescript
// wallet.dto.ts — Good validation patterns

// ✅ Zod schema with strict() prevents extra fields
// ✅ UUID validation for memberId and marketId
// ✅ Amount regex: /^\d+(\.\d{1,10})?$/ (positive, up to 10 decimals)
// ✅ Entry type limited to enum: PENDING, AVAILABLE, REVERSED, COMPENSATION, ADJUSTMENT
// ✅ Pagination validated with min/max limits
```

### 6.3 Database Schema

```typescript
// schema/index.ts — Phase 3 additions

// ✅ member_wallet_accounts — with composite unique (member_id, market_id)
// ✅ member_wallet_entries — with sequence uniqueness per wallet, global idempotency key
// ✅ daily_job_runs — with type+market+date unique constraint
// ✅ reward_daily_accruals — with idempotency by plan+date+type
// ✅ All tables use UUID primary keys with gen_random_uuid()
// ✅ All monetary values use numeric(38,10)
// ✅ Proper foreign key constraints with ON DELETE RESTRICT
```

---

_Document created: 2026-07-22 18:00 MYT | Status: AWAITING HOST CI VERIFICATION_
