# Phase 3 Wallet Ledger Contract

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357

---

## 1. Wallet Ownership Model

**LOCKED:** Each member may have one independent wallet per market.

- Wallet identity concept: `member_id + market_id`
- A member with access to 3 markets will have at most 3 wallet accounts
- Wallet creation occurs on first qualifying event (e.g., first reward accrual)
- Wallet is NOT created at registration — only on financial necessity

---

## 2. Wallet Account Table (Design)

```
member_wallet_accounts
├── id (uuid, PK)
├── member_id (uuid, FK→members) — NOT NULL
├── market_id (uuid, FK→markets) — NOT NULL
├── balance (numeric(38,10), default '0') — computed via ledger sum
├── currency (text) — derived from market
├── status (text) — 'ACTIVE' / 'FROZEN' / 'CLOSED'
├── created_at (utc timestamp)
└── updated_at (utc timestamp)

UNIQUE (member_id, market_id)
```

**Balance = SUM(amount) of all ledger entries for this account.**

---

## 3. Wallet Entry (Ledger) Table (Design)

```
member_wallet_entries
├── id (uuid, PK)
├── account_id (uuid, FK→member_wallet_accounts) — NOT NULL
├── amount (numeric(38,10)) — NOT NULL (positive = credit, negative = debit)
├── balance_before (numeric(38,10)) — snapshot
├── balance_after (numeric(38,10)) — snapshot
├── entry_type (text) — 'REWARD_ACCRUAL', 'REVERSAL', 'CORRECTION', 'ADJUSTMENT'
├── entry_subtype (text) — 'DAILY_ACCRUAL', 'FULL_REVERSAL', etc.
├── reward_plan_id (uuid, FK→reward_plans, nullable)
├── idempotency_key (text) — NOT NULL
├── reversal_of (uuid, self-FK, nullable) — points to original entry
├── reason (text, nullable)
├── actor_id (uuid, nullable — admin for adjustments)
├── correlation_id (text)
├── created_at (utc timestamp)

UNIQUE (account_id, idempotency_key)
CHECK (amount != 0)
```

---

## 4. Immutable Ledger Rules

**LOCKED:**

1. **Append-only.** Once created, a ledger entry must never be modified or deleted.
2. **Balance is derived.** `balance = SUM(entry.amount)` across all entries. Never stored independently.
3. **Balance snapshots** (`balance_before`, `balance_after`) are for query convenience and must not be the source of truth.
4. **Corrections use compensating entries.** To correct an error, create a new entry that offsets the original. Do not modify or delete the original.
5. **Each entry requires an idempotency key.** The same key must not produce duplicate entries.
6. **Reversal entries reference the original entry** via `reversal_of`.

---

## 5. Balance Dimensions (MVP)

**LOCKED — MVP Scope:**

| Dimension     | Behavior                                | Implementation                                           |
| ------------- | --------------------------------------- | -------------------------------------------------------- |
| **pending**   | Amounts not yet available (future)      | Separate running total or status flag; DECISION_REQUIRED |
| **available** | Amounts that can be used/redeemed       | `balance` field in wallet_account                        |
| **reversed**  | Amounts returned via compensating entry | Negative ledger entry with `reversal_of` FK              |

**NOT in scope (reserved only):**

- `redeemed` — Redemption Center (Phase 6)
- `expired` — Expiry engine (deferred)
- `withdrawn` — Withdrawal (deferred)
- `transferred` — Cross-wallet transfer (deferred)

---

## 6. Wallet API Behavior (P3-S2+ Design)

| Operation                          | Description                             | Idempotent            |
| ---------------------------------- | --------------------------------------- | --------------------- |
| GET /wallets                       | List member's wallets (own)             | Yes (read)            |
| GET /wallets/:id                   | Get wallet + balance                    | Yes (read)            |
| GET /wallets/:id/entries           | List ledger entries (paginated)         | Yes (read)            |
| POST /wallets/:id/reversal         | Create compensating entry               | Yes (idempotency key) |
| POST /admin/wallets/:id/adjustment | Admin adjustment (deferred to Phase 7+) | No                    |

---

## 7. No Direct Balance Mutation

**LOCKED:** Wallet balance must never be changed without a corresponding ledger entry.

- No `UPDATE wallet_accounts SET balance = ...` outside of a paired `INSERT INTO wallet_entries`.
- Balance recalculation must be possible by summing all entries.
- Any balance drift between `wallet_accounts.balance` and `SUM(wallet_entries.amount)` must be detected by reconciliation and flagged.
