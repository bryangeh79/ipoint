# Phase 3 Error Registry

> **File:** PHASE_3_ERROR_REGISTRY.md
> **Author:** Agent 0 — Contract & Integration Lead
> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357

---

## 1. Existing Error Code Convention (Audit)

Based on analysis of the current codebase (`apps/api/src/`), the following patterns are established:

### Pattern A — Module-scoped union type + Error subclass

Used by: **auth**, **country-change**, **admin-kyc**

```typescript
// auth.errors.ts
export type AuthErrorCode =
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_ACCOUNT_INACTIVE'
  | ...

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
    options: { retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
```

### Pattern B — Const object + factory functions + NestJS exceptions

Used by: **merchant**

```typescript
// merchant.errors.ts
export const merchantErrorCodes = {
  branchNotFound: 'MERCHANT_BRANCH_NOT_FOUND',
  ownershipDenied: 'MERCHANT_OWNERSHIP_DENIED',
  ...
} as const;

export function merchantBadRequest(code: string, message: string): never {
  throw new BadRequestException({ code, message });
}
```

### Pattern C — Factory functions + Error subclass

Used by: **kyc**, **admin-member**, **discovery**, **profile**

```typescript
// kyc.errors.ts
export function kycNotFoundError(): KycError {
  return new KycError('KYC_NOT_FOUND', 'KYC case not found.');
}
```

### Recommended Pattern for Phase 3

**Phase 3 should use Pattern A** (module-scoped union type + Error subclass) for most cases, with **Pattern C** factory functions for consistency with the dominant codebase style.

**Rationale:**

- Pattern A provides type-safe error codes with autocomplete
- Pattern C (`export function errorName(): MyError`) is the most common in the codebase
- NestJS HTTP exceptions (`BadRequestException`, etc.) should be thrown at the controller layer, not deep in services

---

## 2. Error Code Format

### Format Specification

```
DOMAIN_AREA_SPECIFIC_ERROR
```

- **DOMAIN**: 3–12 uppercase alphanumeric characters identifying the module
- **_AREA_**: Optional sub-domain (2–8 chars) if the module has sub-sections
- **\_SPECIFIC_ERROR**: Descriptive error name (snake_case)

**Examples:**

- `WALLET_NOT_FOUND`
- `WALLET_INSUFFICIENT_BALANCE`
- `REWARD_PLAN_INVALID_STATE`
- `REWARD_RULE_VERSION_CONFLICT`
- `SETTLEMENT_MARKET_LOCKED`
- `SETTLEMENT_IDEMPOTENCY_CONFLICT`

### Length Limit

Maximum 64 characters including underscores.

### Error Patterns to Follow

| Pattern       | Example                       | Implementation                                    |
| ------------- | ----------------------------- | ------------------------------------------------- |
| Not Found     | `WALLET_NOT_FOUND`            | WalletError('WALLET_NOT_FOUND', ...)              |
| Invalid State | `REWARD_PLAN_INVALID_STATE`   | RewardPlanError('REWARD_PLAN_INVALID_STATE', ...) |
| Conflict      | `WALLET_DUPLICATE_ENTRY`      | WalletError('WALLET_DUPLICATE_ENTRY', ...)        |
| Forbidden     | `WALLET_ACCESS_DENIED`        | WalletError('WALLET_ACCESS_DENIED', ...)          |
| Idempotency   | `WALLET_IDEMPOTENCY_CONFLICT` | WalletError('WALLET_IDEMPOTENCY_CONFLICT', ...)   |
| Validation    | `WALLET_INVALID_AMOUNT`       | WalletError('WALLET_INVALID_AMOUNT', ...)         |

---

## 3. Error Module Ownership

| Module Name   | Error Class         | Error Code Prefix | Owner Agent | File                                                 |
| ------------- | ------------------- | ----------------- | ----------- | ---------------------------------------------------- |
| Wallet        | `WalletError`       | `WALLET_*`        | Agent 1     | `apps/api/src/wallet/wallet.errors.ts`               |
| Wallet Entry  | `WalletEntryError`  | `WALLET_ENTRY_*`  | Agent 1     | `apps/api/src/wallet/wallet.errors.ts`               |
| Reward Plan   | `RewardPlanError`   | `REWARD_PLAN_*`   | Agent 2     | `apps/api/src/reward-plan/reward-plan.errors.ts`     |
| Reward Rule   | `RewardRuleError`   | `REWARD_RULE_*`   | Agent 2     | `apps/api/src/reward-rule/reward-rule.errors.ts`     |
| Reward Source | `RewardSourceError` | `REWARD_SOURCE_*` | Agent 3     | `apps/api/src/reward-source/reward-source.errors.ts` |
| Settlement    | `SettlementError`   | `SETTLEMENT_*`    | Agent 4     | `apps/api/src/settlement/settlement.errors.ts`       |
| Admin Wallet  | `AdminWalletError`  | `ADMIN_WALLET_*`  | Agent 5     | `apps/api/src/admin-wallet/admin-wallet.errors.ts`   |
| Admin Reward  | `AdminRewardError`  | `ADMIN_REWARD_*`  | Agent 5     | `apps/api/src/admin-reward/admin-reward.errors.ts`   |

---

## 4. Known Errors — Wallet Domain (Agent 1)

| Error Code                       | HTTP Status | Message                                                        | When Raised                                        |
| -------------------------------- | ----------- | -------------------------------------------------------------- | -------------------------------------------------- |
| `WALLET_NOT_FOUND`               | 404         | Wallet account not found.                                      | GET by non-existent ID                             |
| `WALLET_ACCESS_DENIED`           | 403         | Access to this wallet is denied.                               | Member A tries Member B's wallet                   |
| `WALLET_MARKET_ACCESS_DENIED`    | 403         | Member does not have access to this market wallet.             | Member requests cross-market wallet without access |
| `WALLET_ALREADY_EXISTS`          | 409         | A wallet account already exists for this member and market.    | Duplicate creation attempt                         |
| `WALLET_INVALID_STATUS`          | 400         | Wallet is not in a valid status for this operation.            | Attempting entry on FROZEN wallet                  |
| `WALLET_INVALID_AMOUNT`          | 400         | Entry amount must be non-zero.                                 | Amount is 0                                        |
| `WALLET_INSUFFICIENT_BALANCE`    | 400         | Insufficient balance for this operation.                       | Debit exceeds available balance (if enforced)      |
| `WALLET_DUPLICATE_ENTRY`         | 409         | An entry with this idempotency key already exists.             | Idempotency key reuse                              |
| `WALLET_ENTRY_NOT_FOUND`         | 404         | Wallet entry not found.                                        | Referenced entry does not exist                    |
| `WALLET_REVERSAL_INVALID`        | 400         | The specified entry cannot be reversed.                        | Entry already reversed or type cannot be reversed  |
| `WALLET_REVERSAL_ALREADY_EXISTS` | 409         | A reversal entry for this original entry already exists.       | Duplicate reversal request                         |
| `WALLET_IDEMPOTENCY_CONFLICT`    | 409         | The idempotency key was already used with a different payload. | Same key, different data                           |

---

## 5. Known Errors — Reward Plan Domain (Agent 2)

| Error Code                         | HTTP Status | Message                                                        | When Raised                                         |
| ---------------------------------- | ----------- | -------------------------------------------------------------- | --------------------------------------------------- |
| `REWARD_PLAN_NOT_FOUND`            | 404         | Reward plan not found.                                         | GET by non-existent ID                              |
| `REWARD_PLAN_ACCESS_DENIED`        | 403         | Access to this reward plan is denied.                          | Member A tries Member B's plan                      |
| `REWARD_PLAN_INVALID_STATE`        | 400         | Reward plan is not in a valid state for this operation.        | e.g., suspend on already COMPLETED plan             |
| `REWARD_PLAN_INVALID_TRANSITION`   | 400         | The requested state transition is not allowed.                 | e.g., COMPLETED → ACTIVE                            |
| `REWARD_PLAN_DUPLICATE_SOURCE`     | 409         | A reward plan for this source already exists.                  | Duplicate source_type+source_id+member_id+market_id |
| `REWARD_PLAN_ALREADY_ACTIVE`       | 409         | Reward plan is already active.                                 | Double activation                                   |
| `REWARD_PLAN_CAP_REACHED`          | 400         | Reward plan cap already reached.                               | Cap exceeded (informational, not error)             |
| `REWARD_PLAN_MISSING_RULE_VERSION` | 400         | No effective rule version found for this plan.                 | Rule not configured for market+date                 |
| `REWARD_PLAN_IDEMPOTENCY_CONFLICT` | 409         | The idempotency key was already used with a different payload. | Same key, different data                            |

---

## 6. Known Errors — Reward Rule Version Domain (Agent 2)

| Error Code                     | HTTP Status | Message                                                               | When Raised                    |
| ------------------------------ | ----------- | --------------------------------------------------------------------- | ------------------------------ |
| `REWARD_RULE_NOT_FOUND`        | 404         | Reward rule version not found.                                        | GET by non-existent ID         |
| `REWARD_RULE_ACCESS_DENIED`    | 403         | Access to this rule version is denied.                                | Admin without market scope     |
| `REWARD_RULE_INVALID_DATE`     | 400         | effective_from must be before effective_until.                        | Date validation                |
| `REWARD_RULE_OVERLAP`          | 409         | A rule version with overlapping dates already exists for this market. | Date range conflict            |
| `REWARD_RULE_INVALID_RATE`     | 400         | Rate must be a positive number.                                       | Rate validation                |
| `REWARD_RULE_EXPIRED`          | 400         | Rule version has expired.                                             | Attempting to use expired rule |
| `REWARD_RULE_VERSION_CONFLICT` | 409         | Rule version cannot be modified after it has been used.               | Attempt to edit active rule    |

---

## 7. Known Errors — Reward Source Domain (Agent 3)

| Error Code                           | HTTP Status | Message                                                        | When Raised                 |
| ------------------------------------ | ----------- | -------------------------------------------------------------- | --------------------------- |
| `REWARD_SOURCE_NOT_FOUND`            | 404         | Reward source not found.                                       | Source lookup failure       |
| `REWARD_SOURCE_DUPLICATE`            | 409         | A source with this key already exists.                         | Unique constraint violation |
| `REWARD_SOURCE_INVALID_TYPE`         | 400         | Source type is not recognized.                                 | Unknown source type         |
| `REWARD_SOURCE_SNAPSHOT_FAILED`      | 500         | Failed to capture merchant snapshot.                           | Data retrieval error        |
| `REWARD_SOURCE_IDEMPOTENCY_CONFLICT` | 409         | The idempotency key was already used with a different payload. | Same key, different data    |

---

## 8. Known Errors — Settlement Domain (Agent 4)

| Error Code                          | HTTP Status | Message                                                  | When Raised                                  |
| ----------------------------------- | ----------- | -------------------------------------------------------- | -------------------------------------------- |
| `SETTLEMENT_MARKET_LOCKED`          | 409         | Another settlement process is running for this market.   | Distributed lock failure                     |
| `SETTLEMENT_IDEMPOTENCY_CONFLICT`   | 409         | Accrual for this plan and date already exists.           | Duplicate accrual (expected during recovery) |
| `SETTLEMENT_RULE_NOT_FOUND`         | 400         | No effective rule version found for the settlement date. | Rule configuration gap                       |
| `SETTLEMENT_PLAN_NOT_ACTIVE`        | 400         | Reward plan is not in ACTIVE status.                     | Plan suspended/capped before accrual         |
| `SETTLEMENT_PLAN_NOT_FOUND`         | 404         | Reward plan not found during settlement.                 | Data integrity issue                         |
| `SETTLEMENT_WALLET_CREATION_FAILED` | 500         | Failed to create wallet account during settlement.       | Unexpected DB error                          |
| `SETTLEMENT_ACCRUAL_FAILED`         | 500         | Failed to post daily accrual.                            | Wallet entry or audit log failure            |
| `SETTLEMENT_INVALID_TIMEZONE`       | 500         | Market timezone is invalid.                              | IANA timezone validation failure             |
| `SETTLEMENT_CALCULATION_ERROR`      | 500         | Error during accrual amount calculation.                 | Decimal arithmetic error                     |

---

## 9. Known Errors — Admin Wallet Domain (Agent 5)

| Error Code                          | HTTP Status | Message                                    | When Raised        |
| ----------------------------------- | ----------- | ------------------------------------------ | ------------------ |
| `ADMIN_WALLET_NOT_FOUND`            | 404         | Wallet not found.                          | Admin lookup       |
| `ADMIN_WALLET_MARKET_ACCESS_DENIED` | 403         | Admin does not have access to this market. | Market scope check |
| `ADMIN_WALLET_ADJUSTMENT_FAILED`    | 500         | Failed to create wallet adjustment.        | DB error           |

---

## 10. Known Errors — Admin Reward Domain (Agent 5)

| Error Code                               | HTTP Status | Message                                                | When Raised                   |
| ---------------------------------------- | ----------- | ------------------------------------------------------ | ----------------------------- |
| `ADMIN_REWARD_MARKET_ACCESS_DENIED`      | 403         | Admin does not have access to this market.             | Market scope check            |
| `ADMIN_REWARD_SETTLEMENT_TRIGGER_FAILED` | 500         | Failed to trigger settlement.                          | Worker initialization failure |
| `ADMIN_REWARD_RULE_ACCESS_DENIED`        | 403         | Admin does not have permission to manage reward rules. | Permission check              |

---

## 11. Error Code Allocation (Acknowledged Ranges)

| Prefix Range      | Allocated To | Status   |
| ----------------- | ------------ | -------- |
| `WALLET_*`        | Agent 1      | Reserved |
| `WALLET_ENTRY_*`  | Agent 1      | Reserved |
| `REWARD_PLAN_*`   | Agent 2      | Reserved |
| `REWARD_RULE_*`   | Agent 2      | Reserved |
| `REWARD_SOURCE_*` | Agent 3      | Reserved |
| `SETTLEMENT_*`    | Agent 4      | Reserved |
| `ADMIN_WALLET_*`  | Agent 5      | Reserved |
| `ADMIN_REWARD_*`  | Agent 5      | Reserved |

### Reserved (do not use)

- `AUTH_*` — auth module (existing)
- `KYC_*` — KYC module (existing)
- `ADMIN_KYC_*` — admin KYC (existing)
- `ADMIN_MEMBER_*` — admin member (existing)
- `MERCHANT_*` — merchant module (existing)
- `PROFILE_*` — profile module (existing)
- `MARKET_*` — market module (existing)
- `COUNTRY_CHANGE_*` — country change (existing)
- `DISCOVERY_*` — discovery module (existing)
- `HTTP_*` — HTTP status code fallback (global filter)
- `INTERNAL_ERROR` — unexpected server error (global filter)

---

## 12. Implementation Standard for Agent Error Files

Every Phase 3 error file must follow this template:

```typescript
// domain.errors.ts
export type DomainErrorCode = 'DOMAIN_ERROR_ONE' | 'DOMAIN_ERROR_TWO';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

// Factory functions (following existing codebase convention)
export function domainErrorOneError(): DomainError {
  return new DomainError('DOMAIN_ERROR_ONE', 'Human-readable description.');
}

export function domainErrorTwoError(detail: string): DomainError {
  return new DomainError('DOMAIN_ERROR_TWO', 'Description.', { detail });
}
```

### NestJS Exception Mapping

At controller level, wrap `DomainError` in appropriate NestJS HTTP exception:

```typescript
// wallet.controller.ts
try {
  return await this.walletService.getWallet(id);
} catch (error) {
  if (error instanceof WalletError) {
    switch (error.code) {
      case 'WALLET_NOT_FOUND':
        throw new NotFoundException({
          code: error.code,
          message: error.message,
        });
      case 'WALLET_ACCESS_DENIED':
        throw new ForbiddenException({
          code: error.code,
          message: error.message,
        });
      default:
        throw new BadRequestException({
          code: error.code,
          message: error.message,
        });
    }
  }
  throw error;
}
```

Alternatively, use a custom filter or decorator to centralize this mapping.
