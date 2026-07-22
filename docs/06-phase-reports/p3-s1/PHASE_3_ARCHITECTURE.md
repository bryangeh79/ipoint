# Phase 3 Architecture — Multi-Market Wallet & Reward Ledger Foundation

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357

---

## 1. Layered Architecture

```
┌──────────────────────────────────────────────────────┐
│                    API Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Wallet Ctrl   │  │ Reward Ctrl  │  │  Admin Ctrl │ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘ │
│         │                 │                 │        │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌─────▼──────┐ │
│  │ Wallet Svc   │  │ Reward Svc   │  │ Admin Svc  │ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘ │
└─────────┼─────────────────┼─────────────────┼────────┘
          │                 │                 │
┌─────────▼─────────────────▼─────────────────▼────────┐
│                   Domain Layer                        │
│  ┌────────────┐ ┌────────────┐ ┌──────────────────┐  │
│  │ Wallet     │ │ Reward     │ │ Rule Version     │  │
│  │ Domain     │ │ Plan       │ │ Domain           │  │
│  └──────┬─────┘ └─────┬──────┘ └───────┬──────────┘  │
│         │             │                │              │
│  ┌──────▼─────────────▼────────────────▼──────────┐  │
│  │         Ledger Entry Domain                    │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
          │
┌─────────▼────────────────────────────────────────────┐
│              Database Layer (Drizzle + PostgreSQL)    │
│  ┌────────────┐ ┌────────────┐ ┌──────────────────┐  │
│  │ wallet_    │ │ reward_    │ │ reward_rule_     │  │
│  │ accounts   │ │ plans      │ │ versions         │  │
│  ├────────────┤ ├────────────┤ ├──────────────────┤  │
│  │ wallet_    │ │ reward_    │ │ reward_sources   │  │
│  │ entries    │ │ daily_     │ │                  │  │
│  │ (ledger)   │ │ accruals   │ │                  │  │
│  └────────────┘ └────────────┘ └──────────────────┘  │
│                                                        │
│  ┌────────────────────────────────────────────────┐   │
│  │ Existing Tables (Phase 0-2): markets,          │   │
│  │ merchants, mcp_ledger_*, members, audit_logs,  │   │
│  │ member_market_preferences                      │   │
│  └────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

---

## 2. Module Dependency Map

```
reward-source ──┐
                ├──> reward-plan ──> reward-daily-accrual ──> wallet-entry
reward-rule ────┘
                                    │
                                    └──> wallet-account (balance)
                                    └──> audit-log
```

- **reward-source**: Captures qualifying purchase events. Creates Reward Plan.
- **reward-rule-version**: Provides accrual percentage/rate for a given market+date.
- **reward-plan**: Orchestrates daily accrual, enforces caps, manages lifecycle.
- **reward-daily-accrual**: Idempotent per-market, per-day execution.
- **wallet-account**: Stores balance per member+market.
- **wallet-entry**: Immutable ledger entry recording every balance change.
- **audit-log**: Correlated event record for all Phase 3 operations.

---

## 3. Settlement Worker Architecture

```
┌──────────────────────────────────────────────────────┐
│               Settlement Worker Service               │
│                                                        │
│  1. Query all ACTIVE Reward Plans                     │
│  2. For each plan, determine if market-local-date     │
│     has changed since last accrual                    │
│  3. If new day:                                       │
│     a. Calculate accrual amount                       │
│     b. Create wallet ledger entry                     │
│     c. Create reward_daily_accrual record             │
│     d. Update wallet account balance                  │
│     e. Audit log                                      │
│  4. Idempotency guard prevents duplicate posting      │
└──────────────────────────────────────────────────────┘
```

**Worker Execution Model (CONFIGURABLE):**
- Periodic polling (every N minutes)
- Triggers: market midnight detection
- Retry: independent per plan/market
- Lock: per market to prevent concurrent settlement

---

## 4. Market Isolation Architecture

```
Request ──> Auth Guard ──> Ownership Check ──> Market Check
                │               │                    │
                ▼               ▼                    ▼
          Token has:      member_id matches    market_id belongs to
          member_id       resource owner       member's wallet scope
```

- Each wallet account belongs to exactly one member_id + market_id
- Member A cannot access Member B's wallet — even within same market
- Cross-market wallet access: only own wallets across own markets
- Admin access: requires explicit market authorization via market_access table

---

## 5. Security Boundaries

| Layer | Protection |
|---|---|
| API Transport | HTTPS only (existing) |
| Authentication | JWT + Auth Guard (reuse) |
| Authorization | Member ownership + market isolation |
| Network | NetworkOnly for wallet APIs |
| Client | Memory-only token, no cache |
| Storage | Immutable ledger entries |
| Calculation | Server-side decimal math only |
| Audit | Request ID + audit log for every mutation |

---

## 6. Key Architectural Decisions (DECISION_REQUIRED)

| Decision | Options | Recommendation |
|---|---|---|
| Worker framework | BullMQ / pg-boss / database polling | DECISION_REQUIRED |
| Distributed lock | Redis / PostgreSQL advisory / database row lock | DECISION_REQUIRED |
| Queue infrastructure | BullMQ / pg-boss / none (database polling) | DECISION_REQUIRED |
| Redis integration module | Build P3-S2 / defer | DECISION_REQUIRED |
| iPoint amount decimal precision | (38,10) match MCP / (20,4) / custom | DECISION_REQUIRED |
| Cap model | Flat / ratio / tiered / configurable | DECISION_REQUIRED |
| Rounding mode | HALF_UP / HALF_DOWN / CEILING / FLOOR | DECISION_REQUIRED |
