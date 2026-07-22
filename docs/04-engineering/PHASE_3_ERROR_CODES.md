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
- **\_SPECIFIC_ERROR:** Descriptive error name in snake_case
- **Max length:** 64 characters including underscores

### HTTP Status Mapping

| HTTP Status               | Usage                                                         | Example                       |
| ------------------------- | ------------------------------------------------------------- | ----------------------------- |
| 400 Bad Request           | Validation errors, invalid state, insufficient balance        | `WALLET_INVALID_AMOUNT`       |
| 403 Forbidden             | Ownership/market access denied                                | `WALLET_ACCESS_DENIED`        |
| 404 Not Found             | Resource does not exist                                       | `WALLET_NOT_FOUND`            |
| 409 Conflict              | Idempotency key duplicate, duplicate creation, state conflict | `WALLET_DUPLICATE_ENTRY`      |
| 422 Unprocessable Entity  | Business rule violation not covered by 400                    | `WALLET_INSUFFICIENT_BALANCE` |
| 500 Internal Server Error | Unexpected system failure                                     | `SETTLEMENT_ACCRUAL_FAILED`   |

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

| Error Code                       | HTTP Status | Message                                                        | When Raised                                     |
| -------------------------------- | ----------- | -------------------------------------------------------------- | ----------------------------------------------- |
| `WALLET_NOT_FOUND`               | 404         | Wallet account not found.                                      | GET/POST by non-existent wallet ID              |
| `WALLET_ACCESS_DENIED`           | 403         | Access to this wallet is denied.                               | Member A requests Member B's wallet             |
| `WALLET_MARKET_ACCESS_DENIED`    | 403         | Member does not have access to this market wallet.             | Cross-market access without authorization       |
| `WALLET_ALREADY_EXISTS`          | 409         | A wallet account already exists for this member and market.    | Duplicate `createWallet` call                   |
| `WALLET_INVALID_STATUS`          | 400         | Wallet is not in a valid status for this operation.            | Entry creation on FROZEN wallet                 |
| `WALLET_INVALID_AMOUNT`          | 400         | Entry amount must be non-zero.                                 | Zero-amount entry attempt                       |
| `WALLET_INSUFFICIENT_BALANCE`    | 422         | Insufficient balance for this operation.                       | Debit exceeds available balance _(if enforced)_ |
| `WALLET_DUPLICATE_ENTRY`         | 409         | An entry with this idempotency key already exists.             | Idempotency key reuse                           |
| `WALLET_ENTRY_NOT_FOUND`         | 404         | Wallet entry not found.                                        | Referenced entry does not exist                 |
| `WALLET_REVERSAL_INVALID`        | 400         | The specified entry cannot be reversed.                        | Entry already reversed or non-reversible type   |
| `WALLET_REVERSAL_ALREADY_EXISTS` | 409         | A reversal entry for this original entry already exists.       | Duplicate reversal request                      |
| `WALLET_IDEMPOTENCY_CONFLICT`    | 409         | The idempotency key was already used with a different payload. | Same key, different data                        |

### Factory Functions

```typescript
export function walletNotFoundError(walletId?: string): WalletError {
  return new WalletError('WALLET_NOT_FOUND', 'Wallet account not found.', {
    walletId,
  });
}
export function walletAccessDeniedError(): WalletError {
  return new WalletError(
    'WALLET_ACCESS_DENIED',
    'Access to this wallet is denied.',
  );
}
export function walletMarketAccessDeniedError(): WalletError {
  return new WalletError(
    'WALLET_MARKET_ACCESS_DENIED',
    'Member does not have access to this market wallet.',
  );
}
export function walletAlreadyExistsError(
  memberId: string,
  marketId: string,
): WalletError {
  return new WalletError(
    'WALLET_ALREADY_EXISTS',
    'A wallet account already exists for this member and market.',
    { memberId, marketId },
  );
}
export function walletInvalidStatusError(
  status: string,
  operation: string,
): WalletError {
  return new WalletError(
    'WALLET_INVALID_STATUS',
    `Wallet is not in a valid status for ${operation}.`,
    { status, operation },
  );
}
export function walletInvalidAmountError(amount: string): WalletError {
  return new WalletError(
    'WALLET_INVALID_AMOUNT',
    'Entry amount must be non-zero.',
    { amount },
  );
}
export function walletInsufficientBalanceError(
  balance: string,
  requested: string,
): WalletError {
  return new WalletError(
    'WALLET_INSUFFICIENT_BALANCE',
    'Insufficient balance for this operation.',
    { balance, requested },
  );
}
export function walletDuplicateEntryError(key: string): WalletError {
  return new WalletError(
    'WALLET_DUPLICATE_ENTRY',
    'An entry with this idempotency key already exists.',
    { idempotencyKey: key },
  );
}
export function walletEntryNotFoundError(entryId?: string): WalletError {
  return new WalletError('WALLET_ENTRY_NOT_FOUND', 'Wallet entry not found.', {
    entryId,
  });
}
export function walletReversalInvalidError(entryId: string): WalletError {
  return new WalletError(
    'WALLET_REVERSAL_INVALID',
    'The specified entry cannot be reversed.',
    { entryId },
  );
}
export function walletReversalAlreadyExistsError(entryId: string): WalletError {
  return new WalletError(
    'WALLET_REVERSAL_ALREADY_EXISTS',
    'A reversal entry for this original entry already exists.',
    { entryId },
  );
}
export function walletIdempotencyConflictError(key: string): WalletError {
  return new WalletError(
    'WALLET_IDEMPOTENCY_CONFLICT',
    'The idempotency key was already used with a different payload.',
    { idempotencyKey: key },
  );
}
```

---

## 3. Reward Plan Domain (Agent 2)

**Error class:** `RewardPlanError`
**Code prefix:** `REWARD_PLAN_*`
**Module:** `apps/api/src/reward-plan/reward-plan.errors.ts`

| Error Code                         | HTTP Status | Message                                                        | When Raised                         |
| ---------------------------------- | ----------- | -------------------------------------------------------------- | ----------------------------------- |
| `REWARD_PLAN_NOT_FOUND`            | 404         | Reward plan not found.                                         | GET/action by non-existent plan ID  |
| `REWARD_PLAN_ACCESS_DENIED`        | 403         | Access to this reward plan is denied.                          | Member A requests Member B's plan   |
| `REWARD_PLAN_INVALID_STATE`        | 400         | Reward plan is not in a valid state for this operation.        | Suspend on COMPLETED plan           |
| `REWARD_PLAN_INVALID_TRANSITION`   | 400         | The requested state transition is not allowed.                 | COMPLETED → ACTIVE                  |
| `REWARD_PLAN_DUPLICATE_SOURCE`     | 409         | A reward plan for this source already exists.                  | Duplicate source key                |
| `REWARD_PLAN_ALREADY_ACTIVE`       | 409         | Reward plan is already active.                                 | Double activation attempt           |
| `REWARD_PLAN_CAP_REACHED`          | 422         | Reward plan cap already reached.                               | Accrual attempt on capped plan      |
| `REWARD_PLAN_MISSING_RULE_VERSION` | 422         | No effective rule version found for this plan.                 | Rule not configured for market+date |
| `REWARD_PLAN_IDEMPOTENCY_CONFLICT` | 409         | The idempotency key was already used with a different payload. | Same key, different data            |

---

## 4. Reward Rule Version Domain (Agent 2)

**Error class:** `RewardRuleError`
**Code prefix:** `REWARD_RULE_*`
**Module:** `apps/api/src/reward-rule/reward-rule.errors.ts`

| Error Code                     | HTTP Status | Message                                                               | When Raised                      |
| ------------------------------ | ----------- | --------------------------------------------------------------------- | -------------------------------- |
| `REWARD_RULE_NOT_FOUND`        | 404         | Reward rule version not found.                                        | GET by non-existent ID           |
| `REWARD_RULE_ACCESS_DENIED`    | 403         | Access to this rule version is denied.                                | Admin without market scope       |
| `REWARD_RULE_INVALID_DATE`     | 400         | effective_from must be before effective_until.                        | Date validation failure          |
| `REWARD_RULE_OVERLAP`          | 409         | A rule version with overlapping dates already exists for this market. | Date range conflict              |
| `REWARD_RULE_INVALID_RATE`     | 400         | Rate must be a positive number.                                       | Negative/zero rate               |
| `REWARD_RULE_EXPIRED`          | 400         | Rule version has expired.                                             | Using expired rule for new plans |
| `REWARD_RULE_VERSION_CONFLICT` | 409         | Rule version cannot be modified after it has been used in settlement. | Edit attempt on active rule      |

---

## 5. Reward Source Domain (Agent 3)

**Error class:** `RewardSourceError`
**Code prefix:** `REWARD_SOURCE_*`
**Module:** `apps/api/src/reward-source/reward-source.errors.ts`

| Error Code                           | HTTP Status | Message                                                        | When Raised                 |
| ------------------------------------ | ----------- | -------------------------------------------------------------- | --------------------------- |
| `REWARD_SOURCE_NOT_FOUND`            | 404         | Reward source not found.                                       | Source lookup failure       |
| `REWARD_SOURCE_DUPLICATE`            | 409         | A source with this key already exists.                         | Unique constraint violation |
| `REWARD_SOURCE_INVALID_TYPE`         | 400         | Source type is not recognized.                                 | Unknown source_type value   |
| `REWARD_SOURCE_SNAPSHOT_FAILED`      | 500         | Failed to capture merchant snapshot.                           | Data retrieval error        |
| `REWARD_SOURCE_IDEMPOTENCY_CONFLICT` | 409         | The idempotency key was already used with a different payload. | Same key, different data    |

---

## 6. Settlement Domain (Agent 4)

**Error class:** `SettlementError`
**Code prefix:** `SETTLEMENT_*`
**Module:** `apps/api/src/settlement/settlement.errors.ts`

| Error Code                          | HTTP Status | Message                                                  | When Raised                                   |
| ----------------------------------- | ----------- | -------------------------------------------------------- | --------------------------------------------- |
| `SETTLEMENT_MARKET_LOCKED`          | 409         | Another settlement process is running for this market.   | Distributed lock contention                   |
| `SETTLEMENT_IDEMPOTENCY_CONFLICT`   | 409         | Accrual for this plan and date already exists.           | Duplicate accrual (expected during recovery)  |
| `SETTLEMENT_RULE_NOT_FOUND`         | 422         | No effective rule version found for the settlement date. | Rule configuration gap                        |
| `SETTLEMENT_PLAN_NOT_ACTIVE`        | 400         | Reward plan is not in ACTIVE status.                     | Plan status changed between query and process |
| `SETTLEMENT_PLAN_NOT_FOUND`         | 404         | Reward plan not found during settlement.                 | Data integrity issue                          |
| `SETTLEMENT_WALLET_CREATION_FAILED` | 500         | Failed to create wallet account during settlement.       | Unexpected DB error                           |
| `SETTLEMENT_ACCRUAL_FAILED`         | 500         | Failed to post daily accrual.                            | Wallet entry or audit log failure             |
| `SETTLEMENT_INVALID_TIMEZONE`       | 500         | Market timezone is invalid.                              | IANA timezone validation failure              |
| `SETTLEMENT_CALCULATION_ERROR`      | 500         | Error during accrual amount calculation.                 | Decimal arithmetic error                      |

---

## 7. Admin Wallet Domain (Agent 5)

**Error class:** `AdminWalletError`
**Code prefix:** `ADMIN_WALLET_*`
**Module:** `apps/api/src/admin-wallet/admin-wallet.errors.ts`

| Error Code                          | HTTP Status | Message                                    | When Raised                     |
| ----------------------------------- | ----------- | ------------------------------------------ | ------------------------------- |
| `ADMIN_WALLET_NOT_FOUND`            | 404         | Wallet not found.                          | Admin lookup by non-existent ID |
| `ADMIN_WALLET_MARKET_ACCESS_DENIED` | 403         | Admin does not have access to this market. | Market scope check failure      |
| `ADMIN_WALLET_ADJUSTMENT_FAILED`    | 500         | Failed to create wallet adjustment.        | DB error during adjustment      |

---

## 8. Admin Reward Domain (Agent 5)

**Error class:** `AdminRewardError`
**Code prefix:** `ADMIN_REWARD_*`
**Module:** `apps/api/src/admin-reward/admin-reward.errors.ts`

| Error Code                               | HTTP Status | Message                                                | When Raised                   |
| ---------------------------------------- | ----------- | ------------------------------------------------------ | ----------------------------- |
| `ADMIN_REWARD_MARKET_ACCESS_DENIED`      | 403         | Admin does not have access to this market.             | Market scope check failure    |
| `ADMIN_REWARD_SETTLEMENT_TRIGGER_FAILED` | 500         | Failed to trigger settlement.                          | Worker initialization failure |
| `ADMIN_REWARD_RULE_ACCESS_DENIED`        | 403         | Admin does not have permission to manage reward rules. | Insufficient role permissions |

---

## 9. Error Code Allocation Map

| Prefix Range      | Module        | Owner Agent | Status   |
| ----------------- | ------------- | ----------- | -------- |
| `WALLET_*`        | Wallet        | Agent 1     | Reserved |
| `WALLET_ENTRY_*`  | Wallet Entry  | Agent 1     | Reserved |
| `REWARD_PLAN_*`   | Reward Plan   | Agent 2     | Reserved |
| `REWARD_RULE_*`   | Reward Rule   | Agent 2     | Reserved |
| `REWARD_SOURCE_*` | Reward Source | Agent 3     | Reserved |
| `SETTLEMENT_*`    | Settlement    | Agent 4     | Reserved |
| `ADMIN_WALLET_*`  | Admin Wallet  | Agent 5     | Reserved |
| `ADMIN_REWARD_*`  | Admin Reward  | Agent 5     | Reserved |

### Reserved — Do Not Use (existing modules)

| Prefix             | Module                                    |
| ------------------ | ----------------------------------------- |
| `AUTH_*`           | Authentication (Phase 0/2)                |
| `KYC_*`            | KYC (Phase 2)                             |
| `ADMIN_KYC_*`      | Admin KYC (Phase 2)                       |
| `ADMIN_MEMBER_*`   | Admin Member (Phase 2)                    |
| `MERCHANT_*`       | Merchant (Phase 1)                        |
| `PROFILE_*`        | Member Profile (Phase 2)                  |
| `MARKET_*`         | Market (Phase 0/2)                        |
| `COUNTRY_CHANGE_*` | Country Change (Phase 2)                  |
| `DISCOVERY_*`      | Merchant Discovery (Phase 2)              |
| `HTTP_*`           | HTTP status code fallback (global filter) |
| `INTERNAL_ERROR`   | Unexpected server error (global filter)   |

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

| Document                  | Location                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Error Registry (Agent 0)  | [`../06-phase-reports/p3-agent0/PHASE_3_ERROR_REGISTRY.md`](../06-phase-reports/p3-agent0/PHASE_3_ERROR_REGISTRY.md)         |
| API Contract Draft        | [`../06-phase-reports/p3-s1/PHASE_3_API_CONTRACT_DRAFT.md`](../06-phase-reports/p3-s1/PHASE_3_API_CONTRACT_DRAFT.md)         |
| Wallet Ledger Contract    | [`../06-phase-reports/p3-s1/PHASE_3_WALLET_LEDGER_CONTRACT.md`](../06-phase-reports/p3-s1/PHASE_3_WALLET_LEDGER_CONTRACT.md) |
| Phase 3 Architecture      | [`../03-architecture/PHASE_3_ARCHITECTURE.md`](../03-architecture/PHASE_3_ARCHITECTURE.md)                                   |
| Ledger Invariant Document | [`./PHASE_3_LEDGER_INVARIANTS.md`](./PHASE_3_LEDGER_INVARIANTS.md)                                                           |
| Daily Job Runbook         | [`./PHASE_3_DAILY_JOB_RUNBOOK.md`](./PHASE_3_DAILY_JOB_RUNBOOK.md)                                                           |

---

## 12. Wave 2 — Daily Job Domain (Agent 4)

**Error class:** `DailyJobError`
**Code prefix:** `DAILY_JOB_*`
**Module:** `apps/api/src/daily-job/job.types.ts`

| Error Code                         | HTTP Status | Message                                                      | When Raised                                             |
| ---------------------------------- | ----------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| `DAILY_JOB_NOT_FOUND`              | 404         | Daily job run not found.                                     | GET/PATCH by non-existent job ID                        |
| `DAILY_JOB_ALREADY_COMPLETED`      | 409         | Job run has already been completed for this market and date. | Attempt to re-process a completed job without force     |
| `DAILY_JOB_MARKET_LOCKED`          | 409         | Another job is running for this market.                      | Concurrent execution attempt (advisory lock contention) |
| `DAILY_JOB_TIMEZONE_INVALID`       | 500         | Market timezone configuration is invalid.                    | IANA timezone validation failure at job start           |
| `DAILY_JOB_ACCRUAL_FAILED`         | 500         | Failed to post daily accrual for reward plan.                | Wallet entry or DB error during accrual                 |
| `DAILY_JOB_PLAN_SKIPPED`           | 400         | Reward plan skipped during accrual processing.               | Plan status not ACTIVE, or rule version missing         |
| `DAILY_JOB_RULE_NOT_FOUND`         | 422         | No effective rule version for market and date.               | Rule version gap for market on business date            |
| `DAILY_JOB_WALLET_CREATION_FAILED` | 500         | Failed to create wallet during accrual processing.           | DB error during lazy wallet creation                    |
| `DAILY_JOB_BALANCE_CORRUPTION`     | 500         | Wallet balance inconsistency detected during accrual.        | Optimistic lock conflict or balance mismatch            |
| `DAILY_JOB_POLL_DISABLED`          | 503         | Daily job polling is disabled via configuration.             | `JOB_ENABLED=false` or runtime config disabled          |

### Factory Functions

```typescript
export function dailyJobNotFoundError(jobRunId?: string): DailyJobError {
  return new DailyJobError('DAILY_JOB_NOT_FOUND', 'Daily job run not found.', {
    jobRunId,
  });
}
export function dailyJobAlreadyCompletedError(
  marketId: string,
  date: string,
): DailyJobError {
  return new DailyJobError(
    'DAILY_JOB_ALREADY_COMPLETED',
    'Job has already been completed for this market and date.',
    { marketId, date },
  );
}
export function dailyJobMarketLockedError(marketId: string): DailyJobError {
  return new DailyJobError(
    'DAILY_JOB_MARKET_LOCKED',
    'Another job is running for this market.',
    { marketId },
  );
}
export function dailyJobAccrualFailedError(
  planId: string,
  error?: string,
): DailyJobError {
  return new DailyJobError(
    'DAILY_JOB_ACCRUAL_FAILED',
    'Failed to post daily accrual for reward plan.',
    { planId, error },
  );
}
export function dailyJobRuleNotFoundError(
  marketId: string,
  date: string,
): DailyJobError {
  return new DailyJobError(
    'DAILY_JOB_RULE_NOT_FOUND',
    'No effective rule version for market and date.',
    { marketId, date },
  );
}
export function dailyJobBalanceCorruptionError(
  walletId: string,
  expected: string,
  actual: string,
): DailyJobError {
  return new DailyJobError(
    'DAILY_JOB_BALANCE_CORRUPTION',
    'Wallet balance inconsistency detected.',
    { walletId, expected, actual },
  );
}
export function dailyJobPollDisabledError(): DailyJobError {
  return new DailyJobError(
    'DAILY_JOB_POLL_DISABLED',
    'Daily job polling is disabled via configuration.',
  );
}
```

---

## 13. Wave 2 — Admin Adjustment Domain (Agent 5)

**Error class:** `AdminRewardError`
**Code prefix:** `ADMIN_ADJUSTMENT_*`
**Module:** `apps/api/src/admin-reward/admin-reward.types.ts`

| Error Code                              | HTTP Status | Message                                                        | When Raised                                             |
| --------------------------------------- | ----------- | -------------------------------------------------------------- | ------------------------------------------------------- |
| `ADMIN_ADJUSTMENT_NOT_FOUND`            | 404         | Admin adjustment request not found.                            | Lookup by non-existent adjustment ID                    |
| `ADMIN_ADJUSTMENT_INVALID_AMOUNT`       | 400         | Adjustment amount must be a positive number.                   | Zero or negative amount provided                        |
| `ADMIN_ADJUSTMENT_INVALID_STATE`        | 400         | Adjustment request is not in a valid state for this operation. | Approve already approved, or cancel executed adjustment |
| `ADMIN_ADJUSTMENT_WALLET_FROZEN`        | 422         | Cannot adjust a frozen wallet.                                 | Wallet status is FROZEN at time of adjustment           |
| `ADMIN_ADJUSTMENT_MARKET_ACCESS_DENIED` | 403         | Admin does not have access to this market for adjustments.     | Market scope check failure                              |
| `ADMIN_ADJUSTMENT_SELF_APPROVAL_DENIED` | 403         | Maker cannot approve their own adjustment request.             | Maker-checker violation                                 |
| `ADMIN_ADJUSTMENT_DUPLICATE_KEY`        | 409         | An adjustment with this idempotency key already exists.        | Idempotency key reuse                                   |
| `ADMIN_ADJUSTMENT_EXECUTION_FAILED`     | 500         | Failed to execute wallet adjustment.                           | DB or wallet service error during execution             |
| `ADMIN_ADJUSTMENT_REASON_REQUIRED`      | 400         | A reason must be provided for admin adjustments.               | Empty or missing reason field                           |

### Factory Functions

```typescript
export function adminAdjustmentNotFoundError(
  adjustmentId?: string,
): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_ADJUSTMENT_NOT_FOUND',
    'Admin adjustment request not found.',
    { adjustmentId },
  );
}
export function adminAdjustmentInvalidAmountError(
  amount: string,
): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_ADJUSTMENT_INVALID_AMOUNT',
    'Adjustment amount must be a positive number.',
    { amount },
  );
}
export function adminAdjustmentInvalidStateError(
  state: string,
  operation: string,
): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_ADJUSTMENT_INVALID_STATE',
    'Adjustment request is not in a valid state for this operation.',
    { state, operation },
  );
}
export function adminAdjustmentWalletFrozenError(
  walletId: string,
): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_ADJUSTMENT_WALLET_FROZEN',
    'Cannot adjust a frozen wallet.',
    { walletId },
  );
}
export function adminAdjustmentSelfApprovalDeniedError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_ADJUSTMENT_SELF_APPROVAL_DENIED',
    'Maker cannot approve their own adjustment request.',
  );
}
export function adminAdjustmentExecutionFailedError(
  adjustmentId: string,
  error?: string,
): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_ADJUSTMENT_EXECUTION_FAILED',
    'Failed to execute wallet adjustment.',
    { adjustmentId, error },
  );
}
export function adminAdjustmentReasonRequiredError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_ADJUSTMENT_REASON_REQUIRED',
    'A reason must be provided for admin adjustments.',
  );
}
```

---

## 14. Wave 2 — Admin Reward Domain (Agent 5)

**Error class:** `AdminRewardError`
**Code prefix:** `ADMIN_REWARD_*`
**Module:** `apps/api/src/admin-reward/admin-reward.types.ts`

| Error Code                               | HTTP Status | Message                                      | When Raised                                   |
| ---------------------------------------- | ----------- | -------------------------------------------- | --------------------------------------------- |
| `ADMIN_REWARD_RULE_VERSION_NOT_FOUND`    | 404         | Rule version not found.                      | Admin lookup by non-existent rule version ID  |
| `ADMIN_REWARD_RULE_VERSION_ARCHIVED`     | 400         | Cannot modify an archived rule version.      | Edit/delete on archived rule                  |
| `ADMIN_REWARD_JOB_NOT_FOUND`             | 404         | Job run not found.                           | Admin lookup by non-existent job run ID       |
| `ADMIN_REWARD_MARKET_ACCESS_DENIED`      | 403         | Admin does not have access to this market.   | Market scope check failure                    |
| `ADMIN_REWARD_WALLET_NOT_FOUND`          | 404         | Wallet not found for member and market.      | Admin wallet lookup fails                     |
| `ADMIN_REWARD_ADJUSTMENT_INVALID_AMOUNT` | 400         | Adjustment amount must be a positive number. | Invalid amount for wallet adjustment          |
| `ADMIN_REWARD_ADJUSTMENT_NOT_FOUND`      | 404         | Adjustment request not found.                | Lookup by non-existent adjustment ID          |
| `ADMIN_REWARD_IDEMPOTENCY_CONFLICT`      | 409         | Idempotency key conflict.                    | Duplicate idempotency key for admin operation |
| `ADMIN_REWARD_JOB_RETRY_FAILED`          | 500         | Failed to retry job run.                     | Job status update error                       |
| `ADMIN_REWARD_JOB_FORCE_COMPLETE_FAILED` | 500         | Failed to force-complete job run.            | Job status update error                       |
| `ADMIN_REWARD_SETTLEMENT_TRIGGER_FAILED` | 500         | Failed to trigger settlement.                | Worker initialization failure                 |

### Factory Functions

```typescript
export function adminRewardRuleVersionNotFoundError(
  versionId?: string,
): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_RULE_VERSION_NOT_FOUND',
    'Rule version not found.',
    { versionId },
  );
}
export function adminRewardJobNotFoundError(
  jobRunId?: string,
): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_JOB_NOT_FOUND',
    'Job run not found.',
    { jobRunId },
  );
}
export function adminRewardMarketAccessDeniedError(
  marketId?: string,
): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_MARKET_ACCESS_DENIED',
    'Admin does not have access to this market.',
    { marketId },
  );
}
export function adminRewardJobRetryFailedError(
  jobRunId: string,
  error?: string,
): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_JOB_RETRY_FAILED',
    'Failed to retry job run.',
    { jobRunId, error },
  );
}
export function adminRewardSettlementTriggerFailedError(
  error?: string,
): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_SETTLEMENT_TRIGGER_FAILED',
    'Failed to trigger settlement.',
    { error },
  );
}
```

---

## 15. Wave 2 — pg-boss Integration (Future)

**Error class:** `PgBossError` (future)
**Code prefix:** `PGBOSS_*`
**Module:** `apps/api/src/daily-job/` (future)

These error codes are **reserved** for future pg-boss integration. Do not implement until pg-boss is adopted.

| Error Code                        | HTTP Status | Message                                      | When Raised                         |
| --------------------------------- | ----------- | -------------------------------------------- | ----------------------------------- |
| `PGBOSS_CONNECTION_FAILED`        | 500         | Failed to connect to pg-boss.                | Database connection pool exhausted  |
| `PGBOSS_SCHEDULE_CREATION_FAILED` | 500         | Failed to create pg-boss schedule.           | Cron expression parsing error       |
| `PGBOSS_JOB_ENQUEUE_FAILED`       | 500         | Failed to enqueue job in pg-boss.            | Queue insertion error               |
| `PGBOSS_JOB_ALREADY_SCHEDULED`    | 409         | A job with this schedule key already exists. | Duplicate schedule registration     |
| `PGBOSS_WORKER_NOT_STARTED`       | 503         | pg-boss worker has not started.              | Startup initialization failure      |
| `PGBOSS_JOB_TIMEOUT`              | 500         | Job exceeded maximum execution time.         | Job expired (pg-boss expireInHours) |

---

## 16. Error Code Allocation Map (Updated for Wave 2)

| Prefix Range         | Module                    | Owner Agent | Status        |
| -------------------- | ------------------------- | ----------- | ------------- |
| `WALLET_*`           | Wallet                    | Agent 1     | Allocated     |
| `WALLET_ENTRY_*`     | Wallet Entry              | Agent 1     | Allocated     |
| `REWARD_PLAN_*`      | Reward Plan               | Agent 2     | Allocated     |
| `REWARD_RULE_*`      | Reward Rule               | Agent 2     | Allocated     |
| `REWARD_SOURCE_*`    | Reward Source             | Agent 3     | Allocated     |
| `SETTLEMENT_*`       | Settlement (Wave 1)       | Agent 0     | Reserved      |
| `ADMIN_WALLET_*`     | Admin Wallet (Wave 1)     | Agent 0     | Reserved      |
| `ADMIN_REWARD_*`     | Admin Reward (Wave 1)     | Agent 0     | Reserved      |
| `DAILY_JOB_*`        | Daily Job (Wave 2)        | Agent 4     | **Allocated** |
| `ADMIN_ADJUSTMENT_*` | Admin Adjustment (Wave 2) | Agent 5     | **Allocated** |
| `PGBOSS_*`           | pg-boss (Future)          | Agent 4     | Reserved      |

### Error Code Counts

| Domain             | Wave 1 | Wave 2 | Total  |
| ------------------ | ------ | ------ | ------ |
| Wallet             | 12     | 0      | 12     |
| Reward Plan        | 9      | 0      | 9      |
| Reward Rule        | 7      | 0      | 7      |
| Reward Source      | 5      | 0      | 5      |
| Settlement         | 9      | 0      | 9      |
| Admin Wallet       | 3      | 0      | 3      |
| Admin Reward       | 3      | 11     | 14     |
| Daily Job          | 0      | 10     | 10     |
| Admin Adjustment   | 0      | 9      | 9      |
| pg-boss (reserved) | 0      | 6      | 6      |
| **Total**          | **48** | **36** | **84** |

### HTTP Status Distribution (Wave 2)

| HTTP Status               | Count | Codes                                                                                                                                                                                                                                                                  |
| ------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400 Bad Request           | 6     | DAILY_JOB_PLAN_SKIPPED, ADMIN_ADJUSTMENT_INVALID_AMOUNT, ADMIN_ADJUSTMENT_INVALID_STATE, ADMIN_ADJUSTMENT_REASON_REQUIRED, ADMIN_REWARD_RULE_VERSION_ARCHIVED, ADMIN_ADJUSTMENT_WALLET_FROZEN                                                                          |
| 403 Forbidden             | 3     | ADMIN_ADJUSTMENT_MARKET_ACCESS_DENIED, ADMIN_ADJUSTMENT_SELF_APPROVAL_DENIED, ADMIN_REWARD_MARKET_ACCESS_DENIED                                                                                                                                                        |
| 404 Not Found             | 6     | DAILY_JOB_NOT_FOUND, ADMIN_ADJUSTMENT_NOT_FOUND, ADMIN_REWARD_RULE_VERSION_NOT_FOUND, ADMIN_REWARD_JOB_NOT_FOUND, ADMIN_REWARD_WALLET_NOT_FOUND, ADMIN_REWARD_ADJUSTMENT_NOT_FOUND                                                                                     |
| 409 Conflict              | 4     | DAILY_JOB_ALREADY_COMPLETED, DAILY_JOB_MARKET_LOCKED, ADMIN_ADJUSTMENT_DUPLICATE_KEY, ADMIN_REWARD_IDEMPOTENCY_CONFLICT                                                                                                                                                |
| 422 Unprocessable Entity  | 2     | DAILY_JOB_RULE_NOT_FOUND, ADMIN_ADJUSTMENT_WALLET_FROZEN                                                                                                                                                                                                               |
| 500 Internal Server Error | 8     | DAILY_JOB_TIMEZONE_INVALID, DAILY_JOB_ACCRUAL_FAILED, DAILY_JOB_WALLET_CREATION_FAILED, DAILY_JOB_BALANCE_CORRUPTION, ADMIN_ADJUSTMENT_EXECUTION_FAILED, ADMIN_REWARD_JOB_RETRY_FAILED, ADMIN_REWARD_JOB_FORCE_COMPLETE_FAILED, ADMIN_REWARD_SETTLEMENT_TRIGGER_FAILED |
| 503 Service Unavailable   | 2     | DAILY_JOB_POLL_DISABLED, PGBOSS_WORKER_NOT_STARTED                                                                                                                                                                                                                     |

---

## 17. Related Documents (Updated for Wave 2)

| Document                  | Location                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Error Registry (Agent 0)  | [`../06-phase-reports/p3-agent0/PHASE_3_ERROR_REGISTRY.md`](../06-phase-reports/p3-agent0/PHASE_3_ERROR_REGISTRY.md)         |
| API Contract Draft        | [`../06-phase-reports/p3-s1/PHASE_3_API_CONTRACT_DRAFT.md`](../06-phase-reports/p3-s1/PHASE_3_API_CONTRACT_DRAFT.md)         |
| Wallet Ledger Contract    | [`../06-phase-reports/p3-s1/PHASE_3_WALLET_LEDGER_CONTRACT.md`](../06-phase-reports/p3-s1/PHASE_3_WALLET_LEDGER_CONTRACT.md) |
| Phase 3 Architecture      | [`../03-architecture/PHASE_3_ARCHITECTURE.md`](../03-architecture/PHASE_3_ARCHITECTURE.md)                                   |
| Daily Job Runbook         | [`./PHASE_3_DAILY_JOB_RUNBOOK.md`](./PHASE_3_DAILY_JOB_RUNBOOK.md)                                                           |
| Ledger Invariant Document | [`./PHASE_3_LEDGER_INVARIANTS.md`](./PHASE_3_LEDGER_INVARIANTS.md)                                                           |
| Admin Reward Types        | `apps/api/src/admin-reward/admin-reward.types.ts`                                                                            |
| Daily Job Types           | `apps/api/src/daily-job/job.types.ts`                                                                                        |
| Wave 2 Delivery Evidence  | [`../06-phase-reports/p3-agent7/P3_S2_DELIVERY_EVIDENCE.md`](../06-phase-reports/p3-agent7/P3_S2_DELIVERY_EVIDENCE.md)       |
