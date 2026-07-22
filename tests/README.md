# Phase 3 Test Infrastructure

> **Author:** Agent 6 — Test, Reliability & Security
> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357

---

## Overview

This directory contains the shared test infrastructure, contract validation,
security baseline, and performance benchmarks for Phase 3 (Multi-Market Wallet
and Reward Ledger Foundation).

**Phase:** P3-S1 (Architecture, Contract Audit and Engineering Freeze)
**No production code was modified in Phase 1/2 modules.**

---

## File Inventory

### 1. Shared Test Helpers

| File | Description |
|---|---|
| `apps/api/src/__tests__/phase3-test-helpers.ts` | Wallet/reward fixtures, market/member fixtures, decimal matchers, idempotency key generators, ledger verification helpers, type guards |

**Exported symbols (27):**
- **Decimal helpers:** `toDecimal`, `addDecimal`, `subtractDecimal`, `isPositive`, `toBeDecimalCloseTo`
- **Idempotency generators:** `makeIdempotencyKey`, `makeRewardPlanKey`, `makeAccrualKey`
- **Wallet fixtures:** `createWalletFixture`, `createWalletWithEntries`
- **Market fixtures:** `createMarketFixture`, `createMarketPair`, `createDstMarketFixture`
- **Member fixtures:** `createMemberFixture`
- **Reward fixtures:** `createRewardPlanFixture`, `createRewardRuleVersionFixture`
- **Ledger verification:** `verifyBalanceInvariant`, `verifyMarketIsolation`
- **Timezone helpers:** `getLocalDate`, `generateConsecutiveLocalDates`
- **Type guards:** `isValidWalletStatus`, `isValidRewardPlanStatus`, `isValidLedgerEntryType`
- **Status constants:** `VALID_WALLET_STATUSES`, `VALID_REWARD_PLAN_STATUSES`, `VALID_LEDGER_ENTRY_TYPES`

### 2. Database Integration Tests

| File | Description | Tests |
|---|---|---|
| `packages/database/tests/phase3-schema.test.ts` | Schema validation for Phase 3 tables, migration checksum verification, drift detection readiness | 32 tests |

**Test coverage:**
- Schema column validation for all 6 planned Phase 3 tables (`member_wallet_accounts`, `member_wallet_entries`, `reward_plans`, `reward_rule_versions`, `reward_sources`, `reward_daily_accruals`)
- Migration pipeline readiness (checksum verification, sequential ordering)
- No premature Phase 3 migrations in P3-S1
- Existing Phase 1/2 tables unchanged
- Drift detection readiness markers
- Contract invariants (UNIQUE constraints, immutability, FK references)

**Run:** `pnpm --filter @ipoint/database test`

### 3. Contract Tests

| File | Description | Tests |
|---|---|---|
| `tests/contract/wallet-contract.test.ts` | API endpoint contract validation, error code coverage, ledger invariants, market isolation | 61 tests |

**Test coverage:**
- **API endpoints:** 13 documented wallet/reward endpoints validated for path, method, and auth requirements
- **Reward plan state machine:** 6 states, valid/invalid transitions
- **Error codes:** 12 wallet error codes, 10 reward/settlement error codes with HTTP status mapping
- **Ledger invariant:** Balance = SUM(entries) for empty, single, multi-entry, debit, precision-boundary, and 100-entry wallets
- **Market isolation:** Cross-contamination detection, per-market wallet verification
- **Idempotency:** Deterministic and unique keys for entries, reward plans, accruals
- **Decimal precision:** Arithmetic operations at numeric(38,10) precision
- **Type/status contracts:** Wallet status, entry types, reward plan lifecycle

**Run:** `pnpm vitest run tests/contract/wallet-contract.test.ts`

### 4. Security Baseline Tests

| File | Description | Tests |
|---|---|---|
| `tests/security/wallet-security.test.ts` | Auth guard presence, NetworkOnly, client-side storage prohibition, PII logging checks | 41 tests |

**Test coverage:**
- **Auth guard:** All 13 wallet/reward endpoints require authentication (401) or forbiddance (403)
- **Admin authorization:** Reversal, suspend, resume endpoints are admin-only
- **Cross-member access:** Wallet queries scoped by `member_id`, no member_id in request body
- **Cross-market leakage:** Market isolation in queries, per-market balance display
- **NetworkOnly:** No wallet data cached or available offline
- **No client-side storage:** No localStorage, sessionStorage, or IndexedDB for wallet data
- **No PII/amounts in logs:** No financial values, emails, or PII in log messages
- **Append-only ledger:** No UPDATE/DELETE on wallet entries, reconciliation query present
- **Threat model mitigations:** Replay attack, duplicate settlement, audit logging, rule validation

**Run:** `pnpm vitest run tests/security/wallet-security.test.ts`

### 5. Performance Baseline

| File | Description | Tests |
|---|---|---|
| `apps/api/src/__tests__/wallet.performance.spec.ts` | Latency benchmarks for wallet listing, detail, entries, and admin queries | 6 tests |

**Test coverage:**
- `GET /api/v1/wallets` — member wallet list (target P50 < 50ms)
- `GET /api/v1/wallets/:id` — wallet detail (target P50 < 50ms)
- `GET /api/v1/wallets/:id/entries` — paginated entries (target P50 < 50ms)
- `GET /api/v1/admin/wallets` — admin list with filters (target P50 < 100ms)
- Small response test (3 wallets, target P50 < 60ms)
- Summary table output with P50, P95, P99, average, throughput, and error rate

**Run:** `pnpm vitest run apps/api/src/__tests__/wallet.performance.spec.ts`

### 6. Verification Script

| File | Description |
|---|---|
| `scripts/verify-test-infrastructure.mjs` | Standalone Node.js script validating all test files structurally and contractually (105 checks) |

**Run:** `node scripts/verify-test-infrastructure.mjs`

---

## Test Strategy

### Design Principles

1. **Contract-aware, not implementation-dependent**
   Tests validate against the design documents (PHASE_3_WALLET_LEDGER_CONTRACT.md,
   PHASE_3_API_CONTRACT_DRAFT.md, PHASE_3_ERROR_REGISTRY.md, etc.), not against
   code that doesn't exist yet.

2. **Self-contained**
   No live database, no running services, no network access required. All helpers
   produce pure fixture data.

3. **Composable**
   Shared helpers in `phase3-test-helpers.ts` are used by contract, security, and
   performance tests. Future agents import from the same source.

4. **No .only tests**
   All tests are verified to contain no `.only` modifiers.

5. **No Phase 2 modifications**
   No existing Phase 1/2 files were modified. Only new files were created.

### Test Priorities (from PHASE_3_TEST_AND_E2E_MATRIX.md)

| Priority | Coverage |
|---|---|
| P0 (Critical) | Wallet CRUD, ledger invariant, idempotency, auth guard, balance = SUM(entries), market isolation |
| P1 (Important) | Wallet state transitions, reversal/correction, reward plan states, merchant snapshots, timezone boundaries |
| P2 (Nice to have) | Large entry count performance, edge-case timezones |

### When Tests Will Pass

These tests validate the **contract** and **design**. They will pass when:
- The real implementation matches the documented contracts
- Database schema has the correct columns and constraints
- API endpoints return the correct HTTP status codes
- Error codes match the error registry
- Ledger invariants are enforced at the database level

Until Phase 3 code is implemented (P3-S2+), the contract tests will validate
against design expectations, and the schema tests will check that the expected
schema has the right columns defined.

---

## Usage

```bash
# Run all tests
pnpm test

# Run specific test suites
pnpm vitest run tests/contract/wallet-contract.test.ts
pnpm vitest run tests/security/wallet-security.test.ts
pnpm vitest run apps/api/src/__tests__/wallet.performance.spec.ts
pnpm --filter @ipoint/database test

# Verify test infrastructure
node scripts/verify-test-infrastructure.mjs
```
