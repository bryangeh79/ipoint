# Phase 3 Error Codes Reference

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357
> **Authority:** P3-S1 Engineering Freeze — error codes are LOCKED for implementation; values CONFIGURABLE

---

## 1. Error Code Conventions

### Format

```
DOMAIN_AREA_SPECIFIC_ERROR
```

- **DOMAIN:** 3–12 uppercase characters identifying the module
- **_AREA_:** Optional sub-domain
- **_SPECIFIC_ERROR:** Descriptive error name in snake_case
- **Max length:** 64 characters including underscores

### HTTP Status Mapping

| HTTP Status | Usage | Example |
|---|---|---|
| 400 Bad Request | Validation errors, invalid state, insufficient balance | `WALLET_INVALID_AMOUNT` |
| 403 Forbidden | Ownership/market access denied | `WALLET_ACCESS_DENIED` |
| 404 Not Found | Resource does not exist | `WALLET_NOT_FOUND` |
| 409 Conflict | Idempotency key duplicate, duplicate creation, state conflict | `WALLET_DUPLICATE_ENTRY` |
| 422 Unprocessable Entity | Business rule violation not covered by 400 | `WALLET_INSUFFICIENT_BALANCE` |
| 500 Internal Server Error | Unexpected system failure | `SETTLEMENT_ACCRUAL_FAILED` |

### Implementation Pattern

```typescript
// Module-scoped union type
export type WalletErrorCode =
  | 'WALLET_NOT_FOUND'
  | 'WALLET_ACCESS_DENIED'
  | 'WALLET_DUPLICATE_ENTRY';

// Error subclass
export class WalletError extends Error {
  constructor(
    readonly code: WalletErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WalletError';
  }
}

// Factory functions (recommended convention)
export function walletNotFoundError(): WalletError {
  return new WalletError('WALLET_NOT_FOUND', 'Wallet account not found.');
}
```

### Response Format

```json
{
  "error": {
    "code": "WALLET_NOT_FOUND",
    "message": "Wallet account not found.",
    "details": { "wallet_id": "abc-123" },
    "request_id": "req-xyz",
    "timestamp": "2026-07-22T16:00:00.000Z"
  }
}
```

---

## 2. Wallet Domain (Agent 1)

**Error class:** `WalletError`
**Code prefix:** `WALLET_*`
**Module:** `apps/api/src/wallet/wallet.errors.ts`

| Error Code | HTTP Status | Message | When Raised |
|---|---|---|---|
| `WALLET_NOT_FOUND` | 404 | Wallet account not found. | GET/POST by non-existent wallet ID |
| `WALLET_ACCESS_DENIED` | 403 | Access to this wallet is denied. | Member A requests Member B's wallet |
| `WALLET_MARKET_ACCESS_DENIED` | 403 | Member does not have access to this market wallet. | Cross-market access without authorization |
| `WALLET_ALREADY_EXISTS` | 409 | A wallet account already exists for this member and market. | Duplicate `createWallet` call |
| `WALLET_INVALID_STATUS` | 400 | Wallet is not in a valid status for this operation. | Entry creation on FROZEN wallet |
| `WALLET_INVALID_AMOUNT` | 400 | Entry amount must be non-zero. | Zero-amount entry attempt |
| `WALLET_INSUFFICIENT_BALANCE` | 422 | Insufficient balance for this operation. | Debit exceeds available balance *(if enforced)* |
| `WALLET_DUPLICATE_ENTRY` | 409 | An entry with this idempotency key already exists. | Idempotency key reuse |
| `WALLET_ENTRY_NOT_FOUND` | 404 | Wallet entry not found. | Referenced entry does not exist |
| `WALLET_REVERSAL_INVALID` | 400 | The specified entry cannot be reversed. | Entry already reversed or non-reversible type |
| `WALLET_REVERSAL_ALREADY_EXISTS` | 409 | A reversal entry for this original entry already exists. | Duplicate reversal request |
| `WALLET_IDEMPOTENCY_CONFLICT` | 409 | The idempotency key was already used with a different payload. | Same key, different data |

### Factory Functions

```typescript
export function walletNotFoundError(walletId?: string): WalletError {
  return new WalletError('WALLET_NOT_FOUND', 'Wallet account not found.', { walletId });
}
export function walletAccessDeniedError(): WalletError {
  return new WalletError('WALLET_ACCESS_DENIED', 'Access to this wallet is denied.');
}
export function walletMarketAccessDeniedError(): WalletError {
  return new WalletError('WALLET_MARKET_ACCESS_DENIED', 'Member does not have access to this market wallet.');
}
export function walletAlreadyExistsError(memberId: string, marketId: string): WalletError {
  return new WalletError('WALLET_ALREADY_EXISTS', 'A wallet account already exists for this member and market.', { memberId, marketId });
}
export function walletInvalidStatusError(status: string, operation: string): WalletError {
  return new WalletError('WALLET_INVALID_STATUS', `Wallet is not in a valid status for ${operation}.`, { status, operation });
}
export function walletInvalidAmountError(amount: string): WalletError {
  return new WalletError('WALLET_INVALID_AMOUNT', 'Entry amount must be non-zero.', { amount });
}
export function walletInsufficientBalanceError(balance: string, requested: string): WalletError {
  return new WalletError('WALLET_INSUFFICIENT_BALANCE', 'Insufficient balance for this operation.', { balance, requested });
}
export function walletDuplicateEntryError(key: string): WalletError {
  return new WalletError('WALLET_DUPLICATE_ENTRY', 'An entry with this idempotency key already exists.', { idempotencyKey: key });
}
export function walletEntryNotFoundError(entryId?: string): WalletError {
  return new WalletError('WALLET_ENTRY_NOT_FOUND', 'Wallet entry not found.', { entryId });
}
export function walletReversalInvalidError(entryId: string): WalletError {
  return new WalletError('WALLET_REVERSAL_INVALID', 'The specified entry cannot be reversed.', { entryId });
}
export function walletReversalAlreadyExistsError(entryId: string): WalletError {
  return new WalletError('WALLET_REVERSAL_ALREADY_EXISTS', 'A reversal entry for this original entry already exists.', { entryId });
}
export function walletIdempotencyConflictError(key: string): WalletError {
  return new WalletError('WALLET_IDEMPOTENCY_CONFLICT', 'The idempotency key was already used with a different payload.', { idempotencyKey: key });
}
```

---

## 3. Reward Plan Domain (Agent 2)

**Error class:** `RewardPlanError`
**Code prefix:** `REWARD_PLAN_*`
**Module:** `apps/api/src/reward-plan/reward-plan.errors.ts`

| Error Code | HTTP Status | Message | When Raised |
|---|---|---|---|
| `REWARD_PLAN_NOT_FOUND` | 404 | Reward plan not found. | GET/action by non-existent plan ID |
| `REWARD_PLAN_ACCESS_DENIED` | 403 | Access to this reward plan is denied. | Member A requests Member B's plan |
| `REWARD_PLAN_INVALID_STATE` | 400 | Reward plan is not in a valid state for this operation. | Suspend on COMPLETED plan |
| `REWARD_PLAN_INVALID_TRANSITION` | 400 | The requested state transition is not allowed. | COMPLETED → ACTIVE |
| `REWARD_PLAN_DUPLICATE_SOURCE` | 409 | A reward plan for this source already exists. | Duplicate source key |
| `REWARD_PLAN_ALREADY_ACTIVE` | 409 | Reward plan is already active. | Double activation attempt |
| `REWARD_PLAN_CAP_REACHED` | 422 | Reward plan cap already reached. | Accrual attempt on capped plan |
| `REWARD_PLAN_MISSING_RULE_VERSION` | 422 | No effective rule version found for this plan. | Rule not configured for market+date |
| `REWARD_PLAN_IDEMPOTENCY_CONFLICT` | 409 | The idempotency key was already used with a different payload. | Same key, different data |

---

## 4. Reward Rule Version Domain (Agent 2)

**Error class:** `RewardRuleError`
**Code prefix:** `REWARD_RULE_*`
**Module:** `apps/api/src/reward-rule/reward-rule.errors.ts`

| Error Code | HTTP Status | Message | When Raised |
|---|---|---|---|
| `REWARD_RULE_NOT_FOUND` | 404 | Reward rule version not found. | GET by non-existent ID |
| `REWARD_RULE_ACCESS_DENIED` | 403 | Access to this rule version is denied. | Admin without market scope |
| `REWARD_RULE_INVALID_DATE` | 400 | effective_from must be before effective_until. | Date validation failure |
| `REWARD_RULE_OVERLAP` | 409 | A rule version with overlapping dates already exists for this market. | Date range conflict |
| `REWARD_RULE_INVALID_RATE` | 400 | Rate must be a positive number. | Negative/zero rate |
| `REWARD_RULE_EXPIRED` | 400 | Rule version has expired. | Using expired rule for new plans |
| `REWARD_RULE_VERSION_CONFLICT` | 409 | Rule version cannot be modified after it has been used in settlement. | Edit attempt on active rule |

---

## 5. Reward Source Domain (Agent 3)

**Error class:** `RewardSourceError`
**Code prefix:** `REWARD_SOURCE_*`
**Module:** `apps/api/src/reward-source/reward-source.errors.ts`

| Error Code | HTTP Status | Message | When Raised |
|---|---|---|---|
| `REWARD_SOURCE_NOT_FOUND` | 404 | Reward source not found. | Source lookup failure |
| `REWARD_SOURCE_DUPLICATE` | 409 | A source with this key already exists. | Unique constraint violation |
| `REWARD_SOURCE_INVALID_TYPE` | 400 | Source type is not recognized. | Unknown source_type value |
| `REWARD_SOURCE_SNAPSHOT_FAILED` | 500 | Failed to capture merchant snapshot. | Data retrieval error |
| `REWARD_SOURCE_IDEMPOTENCY_CONFLICT` | 409 | The idempotency key was already used with a different payload. | Same key, different data |

---

## 6. Settlement Domain (Agent 4)

**Error class:** `SettlementError`
**Code prefix:** `SETTLEMENT_*`
**Module:** `apps/api/src/settlement/settlement.errors.ts`

| Error Code | HTTP Status | Message | When Raised |
|---|---|---|---|
| `SETTLEMENT_MARKET_LOCKED` | 409 | Another settlement process is running for this market. | Distributed lock contention |
| `SETTLEMENT_IDEMPOTENCY_CONFLICT` | 409 | Accrual for this plan and date already exists. | Duplicate accrual (expected during recovery) |
| `SETTLEMENT_RULE_NOT_FOUND` | 422 | No effective rule version found for the settlement date. | Rule configuration gap |
| `SETTLEMENT_PLAN_NOT_ACTIVE` | 400 | Reward plan is not in ACTIVE status. | Plan status changed between query and process |
| `SETTLEMENT_PLAN_NOT_FOUND` | 404 | Reward plan not found during settlement. | Data integrity issue |
| `SETTLEMENT_WALLET_CREATION_FAILED` | 500 | Failed to create wallet account during settlement. | Unexpected DB error |
| `SETTLEMENT_ACCRUAL_FAILED` | 500 | Failed to post daily accrual. | Wallet entry or audit log failure |
| `SETTLEMENT_INVALID_TIMEZONE` | 500 | Market timezone is invalid. | IANA timezone validation failure |
| `SETTLEMENT_CALCULATION_ERROR` | 500 | Error during accrual amount calculation. | Decimal arithmetic error |

---

## 7. Admin Wallet Domain (Agent 5)

**Error class:** `AdminWalletError`
**Code prefix:** `ADMIN_WALLET_*`
**Module:** `apps/api/src/admin-wallet/admin-wallet.errors.ts`

| Error Code | HTTP Status | Message | When Raised |
|---|---|---|---|
| `ADMIN_WALLET_NOT_FOUND` | 404 | Wallet not found. | Admin lookup by non-existent ID |
| `ADMIN_WALLET_MARKET_ACCESS_DENIED` | 403 | Admin does not have access to this market. | Market scope check failure |
| `ADMIN_WALLET_ADJUSTMENT_FAILED` | 500 | Failed to create wallet adjustment. | DB error during adjustment |

---

## 8. Admin Reward Domain (Agent 5)

**Error class:** `AdminRewardError`
**Code prefix:** `ADMIN_REWARD_*`
**Module:** `apps/api/src/admin-reward/admin-reward.errors.ts`

| Error Code | HTTP Status | Message | When Raised |
|---|---|---|---|
| `ADMIN_REWARD_MARKET_ACCESS_DENIED` | 403 | Admin does not have access to this market. | Market scope check failure |
| `ADMIN_REWARD_SETTLEMENT_TRIGGER_FAILED` | 500 | Failed to trigger settlement. | Worker initialization failure |
| `ADMIN_REWARD_RULE_ACCESS_DENIED` | 403 | Admin does not have permission to manage reward rules. | Insufficient role permissions |

---

## 9. Error Code Allocation Map

| Prefix Range | Module | Owner Agent | Status |
|---|---|---|---|
| `WALLET_*` | Wallet | Agent 1 | Reserved |
| `WALLET_ENTRY_*` | Wallet Entry | Agent 1 | Reserved |
| `REWARD_PLAN_*` | Reward Plan | Agent 2 | Reserved |
| `REWARD_RULE_*` | Reward Rule | Agent 2 | Reserved |
| `REWARD_SOURCE_*` | Reward Source | Agent 3 | Reserved |
| `SETTLEMENT_*` | Settlement | Agent 4 | Reserved |
| `ADMIN_WALLET_*` | Admin Wallet | Agent 5 | Reserved |
| `ADMIN_REWARD_*` | Admin Reward | Agent 5 | Reserved |

### Reserved — Do Not Use (existing modules)

| Prefix | Module |
|---|---|
| `AUTH_*` | Authentication (Phase 0/2) |
| `KYC_*` | KYC (Phase 2) |
| `ADMIN_KYC_*` | Admin KYC (Phase 2) |
| `ADMIN_MEMBER_*` | Admin Member (Phase 2) |
| `MERCHANT_*` | Merchant (Phase 1) |
| `PROFILE_*` | Member Profile (Phase 2) |
| `MARKET_*` | Market (Phase 0/2) |
| `COUNTRY_CHANGE_*` | Country Change (Phase 2) |
| `DISCOVERY_*` | Merchant Discovery (Phase 2) |
| `HTTP_*` | HTTP status code fallback (global filter) |
| `INTERNAL_ERROR` | Unexpected server error (global filter) |

---

## 10. Error Handling Best Practices

### Controller-Level Mapping

```typescript
// wallet.controller.ts
@Get(':id')
async getWallet(@Param('id') id: string) {
  try {
    return await this.walletService.getWallet(id);
  } catch (error) {
    if (error instanceof WalletError) {
      switch (error.code) {
        case 'WALLET_NOT_FOUND':
          throw new NotFoundException({ code: error.code, message: error.message });
        case 'WALLET_ACCESS_DENIED':
          throw new ForbiddenException({ code: error.code, message: error.message });
        default:
          throw new BadRequestException({ code: error.code, message: error.message });
      }
    }
    throw error;
  }
}
```

### Global Exception Filter

Alternatively, a global filter can map `WalletError` → appropriate HTTP exception.

### Logging Requirements

All errors with HTTP status ≥ 500 must be logged with:
- Full error stack trace
- Request ID (from `request-id.middleware.ts`)
- Correlation ID
- Route and method
- Upstream service name (for internal errors)

---

## 11. Related Documents

| Document | Location |
|---|---|
| Error Registry (Agent 0) | [`../06-phase-reports/p3-agent0/PHASE_3_ERROR_REGISTRY.md`](../06-phase-reports/p3-agent0/PHASE_3_ERROR_REGISTRY.md) |
| API Contract Draft | [`../06-phase-reports/p3-s1/PHASE_3_API_CONTRACT_DRAFT.md`](../06-phase-reports/p3-s1/PHASE_3_API_CONTRACT_DRAFT.md) |
| Wallet Ledger Contract | [`../06-phase-reports/p3-s1/PHASE_3_WALLET_LEDGER_CONTRACT.md`](../06-phase-reports/p3-s1/PHASE_3_WALLET_LEDGER_CONTRACT.md) |
| Phase 3 Architecture | [`../03-architecture/PHASE_3_ARCHITECTURE.md`](../03-architecture/PHASE_3_ARCHITECTURE.md) |
