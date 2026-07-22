# Phase 3 Shared Types Registry

> **File:** PHASE_3_SHARED_TYPES_REGISTRY.md
> **Author:** Agent 0 — Contract & Integration Lead
> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357

---

## 1. Purpose

This registry defines all shared types needed across Phase 3 agents. Shared types live in `packages/types/src/index.ts`. Agent-specific types stay in the agent's own `*.types.ts` file.

**Rule:** A type is "shared" if it is consumed by more than one agent. Types used by only one agent are "private" and must not be added to the shared types package.

---

## 2. Current State of `packages/types/src/index.ts`

```typescript
export type MarketCode = string;
export interface HealthStatus {
  status: 'ok' | 'degraded';
  service: string;
  timestamp: string;
  version: string;
}
```

Phase 3 must add the following shared types.

---

## 3. Wallet Types

### `WalletId`

```typescript
/** Branded type for wallet account IDs */
export type WalletId = string & { readonly __brand: 'WalletId' };
```

**Owner:** Agent 1
**Consumed by:** Agent 1 (primary), Agent 4 (wallet entry creation), Agent 5 (admin views)

### `WalletEntryId`

```typescript
/** Branded type for wallet entry IDs */
export type WalletEntryId = string & { readonly __brand: 'WalletEntryId' };
```

**Owner:** Agent 1
**Consumed by:** Agent 1, Agent 4, Agent 5

### `WalletStatus`

```typescript
/** Wallet account lifecycle status */
export type WalletStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED';
```

**Owner:** Agent 1
**Consumed by:** Agent 1 (service), Agent 5 (admin views)

### `EntryType`

```typescript
/** Wallet entry type — immutable category of entry */
export type EntryType =
  | 'REWARD_ACCRUAL'
  | 'REVERSAL'
  | 'CORRECTION'
  | 'ADJUSTMENT';
```

**Owner:** Agent 1
**Consumed by:** Agent 1 (wallet), Agent 4 (settlement creates REWARD_ACCRUAL)

### `EntrySubtype`

```typescript
/** Wallet entry subtype — more specific classification within an EntryType */
export type EntrySubtype =
  | 'DAILY_ACCRUAL'
  | 'FULL_REVERSAL'
  | 'PARTIAL_CORRECTION'
  | 'ADMIN_ADJUSTMENT';
```

**Owner:** Agent 1
**Consumed by:** Agent 1, Agent 4 (creates DAILY_ACCRUAL)

---

## 4. Reward Types

### `RewardPlanId`

```typescript
/** Branded type for reward plan IDs */
export type RewardPlanId = string & { readonly __brand: 'RewardPlanId' };
```

**Owner:** Agent 2
**Consumed by:** Agent 2, Agent 4 (daily accrual), Agent 5 (admin views)

### `RewardPlanStatus`

```typescript
/** Reward plan lifecycle status */
export type RewardPlanStatus =
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'CAPPED'
  | 'SUSPENDED'
  | 'REVERSED'
  | 'COMPLETED';
```

**Owner:** Agent 2
**Consumed by:** Agent 2, Agent 4 (worker checks ACTIVE status)

### `RewardRuleVersionId`

```typescript
/** Branded type for reward rule version IDs */
export type RewardRuleVersionId = string & {
  readonly __brand: 'RewardRuleVersionId';
};
```

**Owner:** Agent 2
**Consumed by:** Agent 2, Agent 4 (records rule used per accrual)

### `RewardSourceId`

```typescript
/** Branded type for reward source IDs */
export type RewardSourceId = string & { readonly __brand: 'RewardSourceId' };
```

**Owner:** Agent 3
**Consumed by:** Agent 3, Agent 2 (plan creation)

### `RuleRateType`

```typescript
/** Defines how the rule rate is interpreted */
export type RuleRateType = 'PERCENTAGE' | 'FIXED' | 'TIERED';
```

**Owner:** Agent 2
**Consumed by:** Agent 2, Agent 4 (accrual calculation routing)

### `RewardPlanSourceKey`

```typescript
/** Compound key for idempotent reward plan creation */
export interface RewardPlanSourceKey {
  sourceType: string;
  sourceId: string;
  memberId: string;
  marketId: string;
}
```

**Owner:** Agent 2 (consumes), Agent 3 (produces)
**Consumed by:** Agent 2, Agent 3

---

## 5. Ledger Entry Types

### `LedgerEntrySnapshot`

```typescript
/** Balance snapshot around a ledger entry */
export interface LedgerEntrySnapshot {
  readonly balanceBefore: string; // decimal as string
  readonly balanceAfter: string; // decimal as string
}
```

**Owner:** Agent 1
**Consumed by:** Agent 1, Agent 4 (records when creating entry)

### `CreateLedgerEntryParams`

```typescript
/** Parameters for creating a wallet ledger entry */
export interface CreateLedgerEntryParams {
  readonly accountId: string;
  readonly amount: string; // decimal as string, positive = CREDIT, negative = DEBIT
  readonly entryType: EntryType;
  readonly entrySubtype: EntrySubtype;
  readonly rewardPlanId?: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly reason?: string;
  readonly actorId?: string; // admin user for admin actions
  readonly reversalOf?: string; // original entry ID
}
```

**Owner:** Agent 1
**Consumed by:** Agent 1, Agent 4 (worker calls this)

---

## 6. Market & Timezone Types

### `MarketLocalDate`

```typescript
/** A date in a specific market's local timezone */
export interface MarketLocalDate {
  readonly marketId: string;
  readonly marketTimezone: string; // IANA timezone string
  readonly localDate: string; // YYYY-MM-DD in market timezone
  readonly executedAtUtc: string; // ISO 8601 timestamp
}
```

**Owner:** Agent 4
**Consumed by:** Agent 4, Agent 2 (for rule version resolution), Agent 6 (timezone tests)

### `MarketCode`

```typescript
// Already exists in types package — no change needed
export type MarketCode = string;
```

**No changes needed** — reuse existing type.

### `IanaTimezone`

```typescript
/** IANA timezone identifier — validated at runtime */
export type IanaTimezone = string;
```

**Owner:** Agent 4
**Consumed by:** Agent 4, Agent 2 (market rule resolution)

---

## 7. Idempotency Types

### `IdempotencyKey`

```typescript
/** Idempotency key — unique per operation scope */
export type IdempotencyKey = string & { readonly __brand: 'IdempotencyKey' };
```

**Owner:** Agent 0 (shared infrastructure)
**Consumed by:** All agents

### `IdempotencyKeyFormat`

```typescript
/** Standard idempotency key format patterns */
export const IDEMPOTENCY_KEY_PREFIXES = {
  REWARD_PLAN: 'reward_plan',
  DAILY_ACCRUAL: 'daily_accrual',
  WALLET_ENTRY: 'wallet_entry',
  REVERSAL: 'reversal',
} as const;
```

**Owner:** Agent 0
**Consumed by:** All agents (convention reference)

### `IdempotencyResult`

```typescript
/** Result of an idempotent operation */
export interface IdempotencyResult<T> {
  readonly created: boolean; // true = first execution, false = duplicate
  readonly existingId: string; // ID of the existing resource on duplicate
  readonly data: T; // The resource (new or existing)
}
```

**Owner:** Agent 0
**Consumed by:** All agents

---

## 8. Audit Types

### `AuditEventType`

```typescript
/** Phase 3 audit event categories */
export type AuditEventType =
  | 'WALLET_CREATED'
  | 'WALLET_ENTRY_CREATED'
  | 'WALLET_STATUS_CHANGED'
  | 'REWARD_PLAN_CREATED'
  | 'REWARD_PLAN_STATUS_CHANGED'
  | 'REWARD_RULE_CREATED'
  | 'REWARD_RULE_UPDATED'
  | 'DAILY_ACCRUAL_POSTED'
  | 'SETTLEMENT_COMPLETED'
  | 'REVERSAL_POSTED';
```

**Owner:** Agent 5
**Consumed by:** Agent 5, Agent 1, Agent 2, Agent 4 (all generate audit events)

### `AuditEventParams`

```typescript
/** Parameters for creating an audit event */
export interface AuditEventParams {
  readonly eventType: AuditEventType;
  readonly actorId: string;
  readonly actorType: 'ACCOUNT' | 'ADMIN_USER' | 'SYSTEM';
  readonly resourceType: string; // e.g., 'wallet_account', 'reward_plan'
  readonly resourceId: string;
  readonly details?: Record<string, unknown>;
  readonly correlationId: string;
  readonly requestId: string;
}
```

**Owner:** Agent 5
**Consumed by:** Agent 1, Agent 2, Agent 4 (call to create audit events), Agent 5

---

## 9. Pipeline/Coin Lock Types

### `CorrelationId`

```typescript
/** Correlation ID for tracing operations across modules */
export type CorrelationId = string & { readonly __brand: 'CorrelationId' };
```

**Owner:** Agent 0
**Consumed by:** All agents

### `RequestId`

```typescript
/** Request ID for HTTP request tracing */
export type RequestId = string;
// Note: RequestId is already managed by request-id.middleware.ts
// This type is for service-layer references
```

**Owner:** Agent 0
**Consumed by:** All agents

---

## 10. Type Ownership Matrix (Summary)

| Type                      | Owner   | Defined In       | Consumed By |
| ------------------------- | ------- | ---------------- | ----------- |
| `WalletId`                | Agent 1 | `packages/types` | 1, 4, 5     |
| `WalletEntryId`           | Agent 1 | `packages/types` | 1, 4, 5     |
| `WalletStatus`            | Agent 1 | `packages/types` | 1, 5        |
| `EntryType`               | Agent 1 | `packages/types` | 1, 4        |
| `EntrySubtype`            | Agent 1 | `packages/types` | 1, 4        |
| `RewardPlanId`            | Agent 2 | `packages/types` | 2, 4, 5     |
| `RewardPlanStatus`        | Agent 2 | `packages/types` | 2, 4        |
| `RewardRuleVersionId`     | Agent 2 | `packages/types` | 2, 4        |
| `RewardSourceId`          | Agent 3 | `packages/types` | 3, 2        |
| `RuleRateType`            | Agent 2 | `packages/types` | 2, 4        |
| `RewardPlanSourceKey`     | Agent 2 | `packages/types` | 2, 3        |
| `LedgerEntrySnapshot`     | Agent 1 | `packages/types` | 1, 4        |
| `CreateLedgerEntryParams` | Agent 1 | `packages/types` | 1, 4        |
| `MarketLocalDate`         | Agent 4 | `packages/types` | 4, 2        |
| `IanaTimezone`            | Agent 4 | `packages/types` | 4, 2        |
| `IdempotencyKey`          | Agent 0 | `packages/types` | All         |
| `IdempotencyResult<T>`    | Agent 0 | `packages/types` | All         |
| `AuditEventType`          | Agent 5 | `packages/types` | 5, 1, 2, 4  |
| `AuditEventParams`        | Agent 5 | `packages/types` | 5, 1, 2, 4  |
| `CorrelationId`           | Agent 0 | `packages/types` | All         |

---

## 11. Type Implementation Order

Agent 0 (this agent) proposes adding all shared types to `packages/types/src/index.ts` in a **single pull request before any implementation begins**. This avoids type conflicts during parallel execution.

1. Agent 0 creates branch `types/phase3-shared-types`
2. Agent 0 adds all types listed in sections 3–9
3. Branch is reviewed by all 7 agents
4. Branch is merged. SHA recorded.
5. All agents rebase their implementation branches on this SHA.

---

## 12. Unresolved Type Decisions

| Decision                                                                          | Status            | Notes                                               |
| --------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------- |
| Should branded types use `__brand` or `__type` pattern?                           | DECISION_REQUIRED | Codebase uses `__brand` in some places; standardize |
| Should `CreateLedgerEntryParams` use `string` for amounts or a `Decimal` wrapper? | DECISION_REQUIRED | String is recommended; depends on Decimal strategy  |
| Should `MarketLocalDate.localDate` be `string` (YYYY-MM-DD) or `Date`?            | DECISION_REQUIRED | String avoids timezone ambiguity                    |
| Should `AuditEventType` be a union string or an enum?                             | DECISION_REQUIRED | Union type is more flexible for extensibility       |
