# B Integration — Formal Service Path Handoff

## Current State (20:16 GMT+8)

| Item | Status |
|---|---|
| Durable Outbox | ✅ ACCEPTED |
| Worker connection-safe | ✅ ACCEPTED |
| Drizzle type-safe seed | ✅ IMPLEMENTED |
| CI 6/6 green (Run 30200945731) | ✅ SUCCESS |
| Anti-placeholder gate | ✅ PASSED |
| **B-01 to B-15 real Service Path** | ❌ **NOT YET IMPLEMENTED** |

## What B Tests Currently Do

Each B test:
1. Creates seed data via Drizzle ORM (markets, accounts, members, profiles, referrals, agent_activations, merchant_groups, branches, attributions, rates)
2. Verifies seed data exists via Drizzle .select() queries
3. Asserts basic null/truthy/row-count conditions

**What B Tests MUST Do** (per Command Center):
1. Drizzle ORM seed (keep as-is ✅)
2. `transactionService.createPreview(...)` with real DTO
3. `transactionService.confirm(...)` with preview reference
4. Verify outbox dispatch written in same transaction
5. `outboxWorker.processBatchOnce()` execution
6. Query `commission_processing`, `commission_processing_result`, `commission_ledger`
7. Assert exact business outcomes (beneficiary, generation, market, amount, outcome)

## Blockers for Service Path Execution

### 1. `createPreview()` requires:

```typescript
createPreview(
  staffAccountId: string,      // An account UUID that maps to a merchant branch
  input: TransactionPreviewDto, // { amount, memberQrToken, packageId?, marketId? }
  idempotencyKey: string,      // Any unique string
  marketContext: string | undefined, // From request header
  requestContext: TransactionRequestContext
)
```

**Needed setup:**
- `staffAccountId` must resolve to a merchant account with branch access.
- `resolveMerchantContext()` (line 1137) queries: branch id, merchant_account_id, market_id, market code, currency code.
- `memberQrToken` is the member's QR identity token. Need to understand how it's generated/validated.
- `resolveMember()` decodes the QR token to find the member.
- Merchant must have assigned packages (merchant_package_assignments).
- Merchant branch must have an MCP account with sufficient balance.

### 2. `confirm()` requires:

```typescript
confirm(
  staffAccountId: string,
  previewReference: string,   // From createPreview response
  input: TransactionConfirmDto,
  idempotencyKey: string,
  requestContext: TransactionRequestContext
)
```

**Needed setup:**
- `confirm()` validates idempotency, preview session status
- Must complete within 24h of preview (TBC)
- Writes outbox dispatch in same transaction

### 3. Service-only test harness (no controllers)

Current NestJS TestingModule works. Need to:
- Import TransactionModule (which imports CommissionModule, AuthModule, DatabaseModule)
- Override RbacGuard (done ✅)
- Get TransactionService, OutboxWorker from the module
- Seed NOT just raw entities, but all prerequisites for the full transaction flow

## Recommended Approach for Next Session

### Phase 1: Understand dependency chain

1. Read `resolveMerchantContext()` fully — what SQL does it run?
2. Read `resolveMember()` — what format is `memberQrToken`?
3. Read `resolvePackage()` — what table does it query?
4. Read MCP flow — what MCP account/balance is needed?

### Phase 2: Extend seed to cover prerequisites

Based on Phase 1 findings, add to `seedBScenario()`:
- Staff account → merchant_access records
- Merchant package assignments
- MCP account with sufficient balance
- Member QR identity record

### Phase 3: Wire service calls in tests

Each B test will then:
1. `seedBScenario()` → returns all IDs
2. Build `TransactionPreviewDto` with real amount, member QR, etc.
3. Call `transactionService.createPreview(...)`
4. Call `transactionService.confirm(...)` with returned preview reference
5. Assert outbox dispatch was created
6. Call `outboxWorker.processBatchOnce()`
7. Query commission tables
8. Assert business outcomes

### Key Files to Read

```bash
apps/api/src/transaction/transaction.service.ts
apps/api/src/transaction/transaction.dto.ts
apps/api/src/transaction/transaction.controller.ts  # for reference on how createPreview is called
packages/database/schema/index.ts                    # for QR identity, MCP, package tables
packages/database/migrations/0015_phase_4_transaction_schema.sql
```

## Git Status

```
HEAD: ed37c32b
Branch: phase/5-agent-commission-engine
No modified tracked files
CI Run 30200945731: ALL 6/6 SUCCESS
```

## Blockers

**None — all infrastructure is ready.** The only remaining work is:
1. Understanding how member QR tokens / merchant context / packages work in the transaction flow
2. Adding corresponding seed data
3. Wiring service calls in tests

## Next Deliverable

Return only when:
- `createPreview()` called in B tests
- `confirm()` called in B tests
- `processBatchOnce()` called in B tests
- commission_processing/result/ledger queried with business assertions
- CI 6/6 green
- Authenticity Gate green
