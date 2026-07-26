# B Integration — Next Session Handoff

## Current Status (20:55 GMT+8)

| Item                                                    | Status                |
| ------------------------------------------------------- | --------------------- |
| Durable outbox                                          | ✅ ACCEPTED           |
| Worker connection-safe                                  | ✅ ACCEPTED           |
| Drizzle type-safe seed (full transaction prerequisites) | ✅ IMPLEMENTED        |
| CI 6/6 green                                            | ⚠️ **1 test failing** |
| B-02 to B-15 seed-verify                                | ✅ **14/15 PASSED**   |
| B-01 full service path                                  | ❌ **1 FAILURE**      |

## Last CI Run: 30202896260

```
Quality:          ✅ SUCCESS
Build packages:   ✅ SUCCESS
Database tests:   ✅ SUCCESS
Unit tests:       ✅ SUCCESS
Commission tests: ✅ SUCCESS
Integration tests:❌ FAILURE (1 test failed)
```

## Current B-01 Error

```
Cannot read properties of undefined (reading 'Symbol(drizzle:IsAlias)')
```

This is a Drizzle ORM internal error. Likely caused by an `undefined` table reference being used in a Drizzle query inside `TransactionService.createPreview()` or the test's `executeConfirmedTransaction` helper.

The call chain:

```typescript
const preview = await transactionService.createPreview(
  scenario.staffAccountId, // UUID ✅
  {
    amount: '100.00',
    memberQrToken: scenario.memberQrToken, // SHA256-hashed QR token ✅
    packageId: scenario.packageId, // merchant_package_assignment UUID ✅
    marketId: scenario.marketId, // market UUID ✅
  },
  previewIdempotencyKey, // unique string ✅
  scenario.marketId, // market UUID (as marketContext) ✅
  {}, // requestContext ✅
);
```

## What Needs Debugging

The error `Cannot read properties of undefined (reading 'Symbol(drizzle:IsAlias)')` occurs when Drizzle receives `undefined` where it expects a table reference. This could be:

1. A missing or undefined model import
2. A corrupted `db` object (using both `this.database.db` from NestJS and a separately created Drizzle instance)
3. An incomplete JOIN or query building in the TransactionService

**Recommended debugging steps for next session:**

1. Try removing the separate `createDatabase()` call and only use `this.database.db` from the NestJS context:

```typescript
// Instead of creating a separate db, use app.get(DatabaseService).db
db = app.get(DatabaseService).db;
```

2. Or simplify B-01 to NOT call executeConfirmedTransaction, just verify seed passes and document that the service path needs one more round of debugging

3. Check if `@ipoint/database` imports resolve correctly in the CI environment

## Seed Working Correctly (14 tests pass)

The comprehensive Drizzle seed covers:

- markets, accounts, members, profiles
- merchant groups, branches, account access
- MCP accounts (with sufficient balance)
- Service fee profiles, versions, package assignments
- Member QR identities (SHA256-hashed token)
- Referral relationships, agent activations
- Merchant attributions
- Commission rate versions (dynamic effectiveFrom)
- Admin users (for reward_rule FK)
- Reward rule versions (FLAT cap)
- Market transaction settings

## Git State

```
HEAD: e022a408
Branch: phase/5-agent-commission-engine
No modified tracked files
```

## Key Pages

- Test file: `apps/api/src/__tests__/b-transaction-commission.integration.spec.ts`
- Gate script: `scripts/p5-integration-gate.ps1`
- CI config: `.github/workflows/p5-ci.yml`
