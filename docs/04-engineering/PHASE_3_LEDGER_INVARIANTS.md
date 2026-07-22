# Phase 3 Wallet Ledger Invariants

> **Date:** 2026-07-22
> **Base SHA:** 242837cc
> **Authority:** Wave 2 implementation — LOCKED invariants; do not modify without governance review

---

## 1. Core Invariant: Balance = Sum(Entries)

The single most important invariant of the wallet ledger:

```
For every member_wallet_accounts row:

  pendingBalance = SUM(member_wallet_entries.amount)
    WHERE entry_type = 'PENDING'
      AND wallet_account_id = account.id

  availableBalance = SUM(member_wallet_entries.amount)
    WHERE entry_type IN ('AVAILABLE', 'COMPENSATION', 'ADJUSTMENT')
      AND wallet_account_id = account.id

  reversedBalance = SUM(member_wallet_entries.amount)
    WHERE entry_type = 'REVERSED'
      AND wallet_account_id = account.id
```

### 1.1 Invariant Enforcement

| Layer | Enforcement | Mechanism |
|---|---|---|
| **Application** | Compute + verify | `WalletService.createEntry()` updates balance via SQL arithmetic in the same transaction |
| **Database** | Computed balances stored as denormalized columns | `pending_balance`, `available_balance`, `reversed_balance` on `member_wallet_accounts` |
| **Audit** | Balance snapshots in every entry | `balance_before` and `balance_after` on `member_wallet_entries` provide full traceability |
| **Reconciliation** | External validation | SELECT SUM(amount) vs account.balance should match; periodic reconciliation job recommended |

### 1.2 Optimistic Concurrency Control

```typescript
// wallet.service.ts — version-based optimistic locking
const updatedWallets = await tx
  .update(memberWalletAccounts)
  .set({
    pendingBalance: sql`CAST(pending_balance AS numeric(38,10)) + ${delta}`,
    version: sql`version + 1`,
    updatedAt: sql`NOW()`,
  })
  .where(
    and(
      eq(memberWalletAccounts.id, wallet.id),
      eq(memberWalletAccounts.version, wallet.version), // OCC check
    ),
  )
  .returning();

if (!updatedWallets[0]) {
  throw new Error('Concurrent wallet update detected. Please retry.');
}
```

If a concurrent update increments `version` before this transaction commits, the `WHERE version = old_version` clause matches zero rows, causing a retry. This prevents lost updates.

---

## 2. Immutability Rules

### 2.1 Once Created, Never Modified

Wallet ledger entries are **strictly append-only**:

| Operation | Allowed? | Rationale |
|---|---|---|
| INSERT | ✅ Yes | New ledger entries |
| SELECT | ✅ Yes | Read entries |
| UPDATE | ❌ No | Would break audit trail |
| DELETE | ❌ No | Would destroy balance history |

### 2.2 Database-Level Enforcement

```sql
-- member_wallet_entries has NO UPDATE or DELETE triggers
-- The Drizzle schema defines no update/delete policies on entries
-- Application code never calls .update() or .delete() on entries table

-- Enforcement via schema:
-- 1. No updated_at column on member_wallet_entries (only created_at)
-- 2. No archive/soft-delete mechanism
-- 3. UNIQUE constraints prevent logical duplicates
```

### 2.3 What "Immutable" Means for Operations

| Operation | Immutable? | How It's Done |
|---|---|---|
| Reversal | ✅ Immutable (new entry) | New entry with `entry_type = 'REVERSED'` referencing original via `reference_id` |
| Correction | ✅ Immutable (new entry) | New entry with `entry_type = 'ADJUSTMENT'` or `'COMPENSATION'` |
| Refund | ✅ Immutable (new entry) | Refund creates new credit entry; original debit stays |
| Mistake | ✅ Immutable (new entry) | Full reversal + new correct entry |

### 2.4 Entry Lifecycle

```
Entry Created
    │
    ├── Never updated
    ├── Never deleted
    │
    ├── Can be referenced by another entry (reversal_of)
    │
    └── Lives forever in the audit trail
```

### 2.5 Column Immutability Justification

| Column | Immutable? | Why |
|---|---|---|
| `id` | ✅ Yes | PK; never changes |
| `wallet_account_id` | ✅ Yes | FK; changing would re-parent history |
| `member_id` | ✅ Yes | Context; changing would break audit |
| `market_id` | ✅ Yes | Context; changing would break audit |
| `entry_sequence` | ✅ Yes | Monotonic sequence; changing would reorder history |
| `entry_type` | ✅ Yes | Type defines behavior; changing would rewrite history |
| `amount` | ✅ Yes | Core financial value |
| `balance_before` | ✅ Yes | Balance snapshot; changing would invalidate invariant |
| `balance_after` | ✅ Yes | Balance snapshot; changing would invalidate invariant |
| `idempotency_key` | ✅ Yes | Uniqueness guarantee |
| `reference_type` | ✅ Yes | Links to external entity |
| `reference_id` | ✅ Yes | Links to external entity |
| `description` | ✅ Yes | Human-readable context |
| `reason` | ✅ Yes | Why the entry exists |
| `actor_id` | ✅ Yes | Who caused the change |
| `market_timezone` | ✅ Yes | Timezone at recording time |
| `created_at` | ✅ Yes | Timestamp of creation |

---

## 3. Compensating Entry Patterns

Since entries are immutable, **all corrections must use compensating entries**.

### 3.1 Full Reversal

**Use case:** A reward was incorrectly posted and needs to be fully reversed.

```typescript
// For reversal, create an entry with REVERSED type
await walletService.createLedgerEntry({
  memberId: originalEntry.memberId,
  marketId: originalEntry.marketId,
  entryType: 'REVERSED',
  amount: originalEntry.amount,          // Same amount as original
  idempotencyKey: `REV:${originalEntry.id}`,
  referenceType: 'WALLET_ENTRY',
  referenceId: originalEntry.id,         // Reference the reversed entry
  reason: 'Admin reversal: incorrect reward amount',
  actorId: adminUserId,
});
```

**Result:**
```
Original entry:   PENDING    +100.00    balance_before=0    balance_after=100
Reversal entry:   REVERSED   +100.00    balance_before=100  balance_after=200
```

**Note:** REVERSED entries add to `reversedBalance`, not `pendingBalance`. The pending balance returns to zero via the balance formula.

### 3.2 Compensation Entry (Direct Adjustment)

**Use case:** An admin needs to add or subtract iPoints directly.

```typescript
// Direct credit
await walletService.createLedgerEntry({
  memberId,
  marketId,
  entryType: 'COMPENSATION',     // Adds to availableBalance
  amount: '50.00',
  idempotencyKey: `COMP:${correlationId}`,
  reason: 'Promotional credit: welcome bonus',
  actorId: adminUserId,
});
```

**Valid entry types for compensation:**
| Type | Balance Effect | Use Case |
|---|---|---|
| `COMPENSATION` | Increases `availableBalance` | Admin-granted credits, promotional rewards |
| `ADJUSTMENT` | Increases `availableBalance` | System corrections, data fix |

### 3.3 Admin Adjustment with Approval Workflow

**Use case:** Maker-checker workflow for sensitive adjustments.

```
Step 1: Admin creates DRAFT adjustment request
        → stored in admin_adjustment_requests table (future)

Step 2: Another admin APPROVES the request
        → entry is created in wallet ledger

Step 3: WalletService.createLedgerEntry with entry_type='ADJUSTMENT'
        → payment_reference links back to the approval
```

### 3.4 Partial Correction

**Use case:** A reward of 100 iPoints was posted but should have been 80 iPoints.

```typescript
// Option A: Full reversal + new entry (simpler audit)
await walletService.createLedgerEntry({
  entryType: 'REVERSED',
  amount: '100.00',               // Reverse entire original
  referenceId: originalEntryId,
  ...
});

// Then create correct entry
await walletService.createLedgerEntry({
  entryType: 'PENDING',           // New accrual
  amount: '80.00',
  ...
});

// Option B: Net adjustment (only the difference)
await walletService.createLedgerEntry({
  entryType: 'COMPENSATION',      // Negative compensation
  amount: '-20.00',               // NOTE: PENDING amount must be positive
  ...
});
```

**Recommendation:** Use Option A (full reversal + new entry) for audit clarity.

---

## 4. Audit Trail Requirements

### 4.1 What Must Be Audited

| Action | Audit Event | Entity Type |
|---|---|---|
| Wallet created | `WALLET_CREATED` | `MEMBER_WALLET_ACCOUNT` |
| Ledger entry created | `WALLET_ENTRY_CREATED` | `MEMBER_WALLET_ENTRY` |
| Reward accrual posted | `REWARD_ACCRUAL_POSTED` | `REWARD_DAILY_ACCRUAL` |
| Reward entitlement created | `REWARD_ENTITLEMENT_CREATED` | `REWARD_PLAN` |
| Reward entitlement reversed | `REWARD_ENTITLEMENT_REVERSED` | `REWARD_SOURCE` |
| Admin adjustment | `WALLET_ADJUSTMENT_CREATED` | `MEMBER_WALLET_ENTRY` |
| Job run completed | `DAILY_JOB_COMPLETED` | `DAILY_JOB_RUN` |

### 4.2 Audit Record Structure (from `audit_logs`)

```json
{
  "actor_type": "SYSTEM",
  "actor_id": null,
  "market_id": "uuid",
  "action": "REWARD_ACCRUAL_POSTED",
  "entity_type": "REWARD_DAILY_ACCRUAL",
  "entity_id": "accrual-uuid",
  "before": null,
  "after": {
    "reward_plan_id": "plan-uuid",
    "member_id": "member-uuid",
    "amount": "10.5000000000",
    "market_local_date": "2026-07-22",
    "ledger_entry_type": "PENDING"
  },
  "result": "SUCCESS",
  "request_id": "req-abc123"
}
```

### 4.3 Correlation IDs

Every reward accrual record includes an `audit_correlation_id`:

```typescript
// Generated per batch process
const correlationId = randomUUID();

// Used across all records in one batch:
// - reward_daily_accruals.audit_correlation_id
// - member_wallet_entries.idempotency_key (partial)
// - audit_logs.request_id
```

This enables full traceability:
```
Troubleshoot query:
  SELECT * FROM member_wallet_entries
  WHERE idempotency_key LIKE '%correlationId%';
  
  SELECT * FROM reward_daily_accruals
  WHERE audit_correlation_id = 'correlationId';
  
  SELECT * FROM audit_logs
  WHERE request_id = 'correlationId';
```

### 4.4 Retention & Archival

| Data | Retention | Archival Policy |
|---|---|---|
| `member_wallet_entries` | Permanent | Never delete; archive to cold storage after 7 years if needed |
| `reward_daily_accruals` | Permanent | Never delete; historical reward data |
| `audit_logs` | Configurable (default: 7 years) | Archive monthly; purge after retention period |
| `daily_job_runs` | 1 year | Purge after 1 year; maintain daily summaries |

### 4.5 Reconciliation Procedure

**Daily reconciliation** (automated, to be implemented as a monitoring job):

```sql
-- Check invariant: balance = SUM(entries)
SELECT
  a.id AS account_id,
  a.pending_balance AS stored_pending,
  COALESCE((
    SELECT SUM(e.amount::numeric)
    FROM member_wallet_entries e
    WHERE e.wallet_account_id = a.id
      AND e.entry_type = 'PENDING'
  ), 0) AS computed_pending
FROM member_wallet_accounts a
WHERE a.pending_balance != COALESCE((
  SELECT SUM(e.amount::numeric)
  FROM member_wallet_entries e
  WHERE e.wallet_account_id = a.id
    AND e.entry_type = 'PENDING'
), 0);
```

**Expected result for a healthy system:** 0 rows returned.

---

## 5. Entry Type Semantics

### 5.1 Valid Entry Types

| Type | Balance Component | Sign | Description |
|---|---|---|---|
| `PENDING` | pendingBalance | + | Reward accrual, awaiting availability |
| `AVAILABLE` | availableBalance | + | Reward moved from pending to available |
| `REVERSED` | reversedBalance | + | Reversal of a previous entry |
| `COMPENSATION` | availableBalance | + | Admin-granted compensation |
| `ADJUSTMENT` | availableBalance | + | System adjustment |

### 5.2 Balance Composition

```
                    ┌──────────────────────────────────┐
                    │      Member Wallet Account        │
                    │                                  │
                    │  pendingBalance  ← PENDING entries│
                    │       │                          │
                    │       │ (via AVAILABLE transfer)  │
                    │       ▼                          │
                    │  availableBalance ← AVAILABLE +   │
                    │                    COMPENSATION + │
                    │                    ADJUSTMENT     │
                    │       │                          │
                    │  reversedBalance ← REVERSED       │
                    │       │                          │
                    └───────┴──────────────────────────┘

Total effective balance = availableBalance - reversedBalance
```

### 5.3 Transition Rules

```
PENDING entry cannot directly become AVAILABLE
  → Instead: create new AVAILABLE entry, leaving PENDING intact

COMPENSATION and ADJUSTMENT go directly to availableBalance
  → These bypass the pending state entirely
```

---

## 6. Idempotency Guarantees

### 6.1 Database-Level Idempotency

```sql
-- Global uniqueness of idempotency keys across all entries
UNIQUE (idempotency_key) ON member_wallet_entries

-- Per-wallet sequence number uniqueness
UNIQUE (wallet_account_id, entry_sequence) ON member_wallet_entries
```

### 6.2 Idempotency Key Generation

```typescript
// Reward accrual
const key = `ACCRUAL:${rewardPlanId}:${marketLocalDate}:${ledgerEntryType}`;

// Reversal
const key = `REV:${originalEntry.id}`;

// Compensation
const key = `COMP:${correlationId}`;

// Adjustment
const key = `ADJ:${correlationId}`;

// Transaction reward
const key = `REWARD:TX:${transactionId}`;
```

### 6.3 Idempotency Behavior

| Scenario | Behavior | HTTP Equivalent |
|---|---|---|
| Same key, same payload | Return existing entry (200) | Idempotent-safe |
| Same key, different payload | Reject with error (409) | Idempotency conflict |

---

## 7. Mathematical Invariants

### 7.1 Always True

```
1. amount > 0                                           (CHECK constraint)
2. balance_before >= 0                                  (application invariant)
3. balance_after = balance_before + amount              (application invariant)
4. balance_after >= balance_before                      (since amount > 0)
5. pendingBalance = SUM(PENDING entries)                (invariant #1)
6. availableBalance = SUM(AVAILABLE + COMP + ADJ entries) (invariant #2)
7. reversedBalance = SUM(REVERSED entries)              (invariant #3)
8. entry_sequence is strictly increasing per wallet     (UNIQUE + monotonic)
```

### 7.2 Never True (Security Invariants)

```
1. amount is never negative                             (CHECK constraint)
2. wallet_id is never NULL                              (NOT NULL)
3. idempotency_key is never NULL                        (NOT NULL)
4. No entry references a non-existent wallet            (FK constraint)
5. No entry references a non-existent original entry    (application check)
6. No two entries share the same idempotency_key         (UNIQUE constraint)
```

---

## 8. Testing Invariants

| Test | What It Validates |
|---|---|
| `createEntry + getBalance` | Balance updates correctly |
| `createEntry with duplicate key` | Idempotency returns existing entry |
| `createEntry with different amount, same key` | Idempotency conflict error |
| `Reverse entry + verify balances` | Reversal creates compensating entry |
| `Concurrent createEntry on same wallet` | OCC version check rejects one |
| `Wallet entries after reversal` | Original entry unchanged |

---

## 9. Related Documents

| Document | Location |
|---|---|
| Wallet Ledger Contract | [`../06-phase-reports/p3-s1/PHASE_3_WALLET_LEDGER_CONTRACT.md`](../06-phase-reports/p3-s1/PHASE_3_WALLET_LEDGER_CONTRACT.md) |
| Reversal & Correction Spec | [`../06-phase-reports/p3-s1/PHASE_3_REVERSAL_AND_CORRECTION_SPEC.md`](../06-phase-reports/p3-s1/PHASE_3_REVERSAL_AND_CORRECTION_SPEC.md) |
| Decimal & Currency Spec | [`../06-phase-reports/p3-s1/PHASE_3_DECIMAL_AND_CURRENCY_SPEC.md`](../06-phase-reports/p3-s1/PHASE_3_DECIMAL_AND_CURRENCY_SPEC.md) |
| Phase 3 ERD | [`../03-architecture/PHASE_3_ERD.md`](../03-architecture/PHASE_3_ERD.md) |
| Daily Job Runbook | [`./PHASE_3_DAILY_JOB_RUNBOOK.md`](./PHASE_3_DAILY_JOB_RUNBOOK.md) |
| Wallet Service | `apps/api/src/wallet/wallet.service.ts` |
| Wallet Types | `apps/api/src/wallet/wallet.types.ts` |
