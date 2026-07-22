# Phase 3 Reward Source Contract

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357

---

## 1. Reward Source Definition

A Reward Source represents the triggering event that creates a Reward Plan. For Phase 3, this is a minimal contract — only enough to enable Reward Plan creation and daily accrual.

**LOCKED:** Full Transaction Engine (Phase 4) will produce complete purchase transaction events. Phase 3 establishes only a minimal Reward Source Contract.

---

## 2. Reward Source Table (Design)

```
reward_sources
├── id (uuid, PK)
├── source_type (text) — identifies the external event type
│     Examples: 'PURCHASE_TRANSACTION', 'MANUAL_ADMIN'
├── source_id (uuid) — ID of the source event in its own table
├── member_id (uuid, FK→members) — reward recipient
├── market_id (uuid, FK→markets) — consumption market
├── merchant_id (uuid, FK→merchants) — merchant where purchase occurred
├── transaction_amount (numeric(38,10)) — qualifying amount
├── currency (text) — transaction currency
├── snapshot (jsonb) — merchant/package details at source time
│     ├── merchant_id
│     ├── package_id
│     ├── package_percentage
│     ├── service_fee_percentage
│     └── transaction_currency
├── created_at (utc timestamp)

UNIQUE (source_type, source_id, member_id, market_id)
```

---

## 3. Snapshot Requirement

**LOCKED:** Merchant package and service-fee history must be preserved through transaction-time snapshots.

The `snapshot` field stores a frozen copy of relevant merchant and package data at the moment the source event occurs. This ensures historical reward calculations remain valid even if merchant configurations change later.

---

## 4. Source Event Lifecycle

```
Purchase Event (External) ──> Phase 4 Transaction Engine ──> reward_source record
                                                                      │
                                                                      ▼
                                                              reward_plan created
                                                                      │
                                                                      ▼
                                                              Daily Accrual (P3-S4)
```

For Phase 3, the reward source record may be created manually via admin tools (deferred) or via future purchase transaction events (Phase 4).

---

## 5. Phase 3 Constraints

| Constraint               | Detail                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| Source types in Phase 3  | Only minimal source contract defined. Production source events require Phase 4 Transaction Engine. |
| No transaction ingestion | Phase 3 does not build the pipeline that produces purchase events.                                 |
| P3-S1 action             | Define the source contract structure and its relationship to Reward Plans.                         |
| Source validation        | DECISION_REQUIRED — What are the validation rules for a qualifying source event?                   |
