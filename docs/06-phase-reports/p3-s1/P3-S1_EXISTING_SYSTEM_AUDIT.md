# P3-S1 Existing System Audit

> **Phase:** Phase 3 — Multi-Market Wallet & Reward Ledger Foundation
> **Sub-Phase:** P3-S1 — Architecture, Contract Audit and Engineering Freeze
> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357
> **Classification:** Document Only — No Production Schema or Migration

---

## Audit Classification Key

| Classification | Meaning |
|---|---|
| **EXISTS_AND_REUSABLE** | Component exists without changes needed for Phase 3 |
| **EXISTS_NEEDS_EXTENSION** | Component exists but requires extension for Phase 3 needs |
| **CONFLICTS_WITH_APPROVED_CONTRACT** | Component behavior conflicts with approved Phase 3 contracts |
| **MISSING** | Component does not exist; must be built |
| **DECISION_REQUIRED** | Unresolved product/architecture decision needed |
| **DEFERRED** | Deliberately excluded from Phase 3 scope |

---

## Detailed Audit

### 1. MCP Ledger Accounts

**File:** `packages/database/schema/index.ts` (line ~1720)

```typescript
export const mcpLedgerAccounts = pgTable(
  'mcp_ledger_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id').notNull().references(() => merchants.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id').notNull().references(() => markets.id, { onDelete: 'restrict' }),
    currency: text('currency').notNull(),
    balance: numeric('balance', { precision: 38, scale: 10 }).notNull().default('0'),
    totalBalance: numeric('total_balance', { precision: 38, scale: 10 }).notNull().default('0'),
    // ... timestamps
  }
);
```

**Classification:** EXISTS_AND_REUSABLE (as pattern)
- MCP ledger account pattern (merchant + market + currency) provides a reusable model.
- Member wallet account table will follow similar structure but with member_id + market_id ownership.
- Balance computed via ledger entries pattern already established.

---

### 2. MCP Ledger Entries

**File:** `packages/database/schema/index.ts` (line ~1749)

```typescript
export const mcpLedgerEntries = pgTable(
  'mcp_ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => mcpLedgerAccounts.id),
    amount: numeric('amount', { precision: 38, scale: 10 }).notNull(),
    balanceBefore: numeric('balance_before', { precision: 38, scale: 10 }),
    balanceAfter: numeric('balance_after', { precision: 38, scale: 10 }),
    idempotencyKey: text('idempotency_key').notNull(),
    // ... unique constraints, reversal FK
  }
);
```

**Classification:** EXISTS_AND_REUSABLE (as pattern)
- Immutable ledger entries with balance snapshots.
- Unique idempotency constraint by (account_id, idempotency_key).
- Reversal support via self-referencing FK.
- Member wallet entries will follow same pattern.

---

### 3. Idempotency Patterns

**Files:**

- `packages/database/schema/index.ts`:
  - `auth_idempotency_keys` (line ~320)
  - `member_kyc_idempotency_keys` (line ~950)
  - `merchant_api_idempotency_keys` (line ~1319)
  - MCP ledger entries (built-in idempotency_key unique constraint)

**Classification:** EXISTS_AND_REUSABLE (as pattern)
- Domain-specific idempotency tables proven across auth, KYC, merchant API, and MCP ledger.
- Pattern: scope + key + request_hash + response_hash + result + expires_at.
- Phase 3 will follow same pattern for reward plans and daily accruals.

---

### 4. Audit Logs

**File:** `packages/database/schema/index.ts` (line ~579)

```typescript
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id'),
    actorType: text('actor_type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    action: text('action').notNull(),
    marketId: uuid('market_id').references(() => markets.id),
    occurredAt: utcTimestamp('occurred_at').notNull().defaultNow(),
    // ...
  }
);
```

**Classification:** EXISTS_AND_REUSABLE
- Comprehensive audit infrastructure already in place.
- Indexes: actor_time, entity_time, market_time.
- Phase 3 wallet/reward operations will use same audit infrastructure.

---

### 5. Market Timezone Field

**File:** `packages/database/schema/index.ts` (line ~453)

```typescript
export const markets = pgTable(
  'markets',
  {
    // ...
    timezone: text('timezone').notNull(),
    // ...
  }
);
```

**Classification:** EXISTS_AND_REUSABLE
- Market timezone stored as IANA text string.
- Phase 3 settlement timezone strategy directly uses this field.

---

### 6. UTC Timestamp Helper

**File:** `packages/database/schema/index.ts` (line ~23-24)

```typescript
const utcTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true, precision: 6 });
```

**Classification:** EXISTS_AND_REUSABLE
- All timestamps consistently stored as UTC with timezone.
- Phase 3 will follow same convention: store both UTC timestamps and market_local_date.

---

### 7. Decimal/Numeric Precision

**MCP existing precision:** `numeric('...', { precision: 38, scale: 10 })`

**Classification:** EXISTS_NEEDS_EXTENSION
- MCP ledger uses precision: 38, scale: 10 for merchant balance.
- Phase 3 must define precision for: iPoint amounts, percentages, caps.
- **DECISION_REQUIRED:** Whether to reuse MCP precision (38,10) or define new precision for rewards.

---

### 8. Auth Guard

**File:** `apps/api/src/auth/auth.guard.ts`

**Classification:** EXISTS_AND_REUSABLE
- Existing JWT-based auth guard protects all authenticated endpoints.
- Phase 3 wallet endpoints will reuse this guard with additional member ownership checks.

---

### 9. Rate-Limit Infrastructure

**File:** `apps/api/src/auth/rate-limit.port.ts` (port/interface only)

**Classification:** EXISTS_NEEDS_EXTENSION
- Only a port interface exists.
- **DECISION_REQUIRED:** Whether wallet/reward APIs need market-level or member-level rate limiting beyond existing auth rate limiting.

---

### 10. Redis Infrastructure

**Config:** `apps/api/src/config/config.service.ts` — `get redisUrl()` reads `REDIS_URL`

**Classification:** EXISTS_NEEDS_EXTENSION
- Redis URL is configured but no Redis integration module exists yet.
- Phase 3 needs Redis for: distributed locks, coordination, worker state.
- **DECISION_REQUIRED:** Whether to build Redis module in P3-S2 or use database-based coordination for MVP.

---

### 11. Worker Infrastructure

**Classification:** MISSING
- No worker framework (Bull, BullMQ, pg-boss, or custom) exists in any package.json.
- No scheduled job runner or cron infrastructure.
- Phase 3 settlement worker requires: scheduling, execution, retry, and coordination.
- **DECISION_REQUIRED:** Worker technology choice (BullMQ vs pg-boss vs custom database polling).

---

### 12. Distributed Lock Capability

**Classification:** MISSING
- No distributed lock mechanism exists.
- Required for: concurrent worker prevention, market-level settlement serialization.
- **DECISION_REQUIRED:** Lock strategy (Redis-based vs advisory locks vs database row locks).

---

### 13. Queue Capability

**Classification:** MISSING
- No queue infrastructure exists.
- Required for: settlement job queue, retry mechanics, scalability.
- **DECISION_REQUIRED:** Queue technology choice.

---

### 14. Transaction Boundaries

**Existing pattern:** NestJS + Drizzle transaction scope

**Classification:** EXISTS_NEEDS_EXTENSION
- Existing transaction usage in Phase 0/1/2 modules.
- Phase 3 needs: cross-table atomic operations (wallet entry + reward accrual), partial batch failure recovery.
- **DECISION_REQUIRED:** Define explicit transaction boundary rules for wallet operations.

---

### 15. Migration Runner

**File:** `packages/database/src/migration-runner.ts`

**Classification:** EXISTS_AND_REUSABLE
- Sequential SQL migration runner with checksum verification and drift detection.
- Phase 3 will reuse this runner for future schema migrations (P3-S2+).

---

### 16. Error-Code Conventions

**Classification:** EXISTS_AND_REUSABLE
- Existing error codes follow domain-specific patterns (auth, kyc, merchant).
- Phase 3 will introduce wallet/reward domain codes following same convention.

---

### 17. OpenAPI Conventions

**Script:** `pnpm openapi:validate`

**Classification:** EXISTS_NEEDS_EXTENSION
- OpenAPI validation exists.
- Phase 3 wallet/reward endpoints must follow same documentation conventions.

---

### 18. API-Client Conventions

**Directory:** `apps/member-web/src/api/`

**Classification:** EXISTS_AND_REUSABLE
- Existing API client uses typed endpoints with Zod validation.
- Phase 3 wallet endpoints will follow same conventions.

---

### 19. Member Current Market Behavior

**Classification:** EXISTS_AND_REUSABLE
- Current Market controls display/session only.
- Reward destination must follow consumption market, not current market.
- No change needed; existing behavior aligns with approved contract.

---

### 20. Service Worker NetworkOnly Rules

**Classification:** EXISTS_AND_REUSABLE
- PWA already configured with NetworkOnly for sensitive APIs.
- Phase 3 wallet/reward APIs must also be NetworkOnly.

---

### 21. Request ID Middleware

**File:** `apps/api/src/common/middleware/request-id.middleware.ts`

**Classification:** EXISTS_AND_REUSABLE
- Request ID middleware active.
- Phase 3 wallet operations will propagate request ID through audit logs.

---

### 22. Zod Validation Pipe

**File:** `apps/api/src/common/pipes/zod-validation.pipe.ts`

**Classification:** EXISTS_AND_REUSABLE
- Zod validation pipe available for all request validation.
- Phase 3 wallet/reward DTOs will follow same pattern.

---

## Summary Matrix

| Component | Classification | Notes |
|---|---|---|
| MCP Ledger Accounts | EXISTS_AND_REUSABLE | Pattern to follow for member wallet accounts |
| MCP Ledger Entries | EXISTS_AND_REUSABLE | Immutable entry pattern proven |
| Idempotency Patterns | EXISTS_AND_REUSABLE | Domain-specific tables, proven pattern |
| Audit Logs | EXISTS_AND_REUSABLE | Comprehensive audit infrastructure |
| Market Timezone | EXISTS_AND_REUSABLE | IANA text field ready for settlement use |
| UTC Timestamp Helper | EXISTS_AND_REUSABLE | UTC with timezone convention established |
| Decimal/Numeric Precision | EXISTS_NEEDS_EXTENSION | MCP precision (38,10) exists; reward precision DECISION_REQUIRED |
| Auth Guard | EXISTS_AND_REUSABLE | JWT guard reusable with member ownership checks |
| Rate-Limit Infrastructure | EXISTS_NEEDS_EXTENSION | Port interface only; DECISION_REQUIRED for market-level rate limiting |
| Redis Infrastructure | EXISTS_NEEDS_EXTENSION | Redis URL configured; no integration module built |
| Worker Infrastructure | **MISSING** | No worker/queue/scheduler exists |
| Distributed Lock Capability | **MISSING** | No locking mechanism exists |
| Queue Capability | **MISSING** | No queue framework exists |
| Transaction Boundaries | EXISTS_NEEDS_EXTENSION | Existing pattern needs extension for wallet atomicity |
| Migration Runner | EXISTS_AND_REUSABLE | Reusable for Phase 3 schema |
| Error-Code Conventions | EXISTS_AND_REUSABLE | Follow existing domain conventions |
| OpenAPI Conventions | EXISTS_NEEDS_EXTENSION | Wallet endpoints need documented conventions |
| API-Client Conventions | EXISTS_AND_REUSABLE | Type-safe endpoint pattern reusable |
| Current Market Behavior | EXISTS_AND_REUSABLE | Aligns with approved contract |
| Service Worker NetworkOnly | EXISTS_AND_REUSABLE | Sensitive APIs NetworkOnly established |
| Request ID Middleware | EXISTS_AND_REUSABLE | Available for audit correlation |
| Zod Validation Pipe | EXISTS_AND_REUSABLE | Available for all DTO validation |

## Key MISSING Items Requiring Decision

1. **Worker infrastructure** — technology choice (BullMQ, pg-boss, custom)
2. **Distributed locking** — strategy (Redis, PostgreSQL advisory locks)
3. **Queue capability** — technology choice
4. **Reward decimal precision** — MCP (38,10) or new standard
5. **Rate limiting** — market/member level needed?
6. **Redis integration** — build module or defer to P3-S2?
7. **Transaction boundary rules** — explicit specification needed
