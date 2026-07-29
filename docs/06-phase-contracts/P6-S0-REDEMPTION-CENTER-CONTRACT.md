# P6-S0: Redemption Center — Contract Freeze & Architecture Draft

**Phase:** Phase 6 — Redemption Center  
**Sprint:** P6-S0 (Documentation, Architecture & Contract Planning)  
**Status:** P6-S0_ACCEPTED — P6-S0 FROZEN (Bryan Decisions OD-01 through OD-30 all APPROVED)  
**Authorization Reference:** Phase 6 P6-S0 Handoff (2026-07-27 19:22 GMT+8)  
**Governance Parent:** `5cd38437da20c1183234a093b8d1f257adfc3c32` (Phase 5 Closure Commit)  
**Phase Branch:** `phase/6-redemption-center`

---

## Table of Contents

1. [Purpose and Scope](#1-purpose-and-scope)
2. [Terminology](#2-terminology)
3. [Actors and Permissions](#3-actors-and-permissions)
4. [Document Authority](#4-document-authority)
5. [Cross-phase Dependencies](#5-cross-phase-dependencies)
6. [One Account + Multi Market](#6-one-account--multi-market)
7. [Current Market](#7-current-market)
8. [Wallet Market](#8-wallet-market)
9. [Redemption Catalog](#9-redemption-catalog)
10. [Catalog Item Types](#10-catalog-item-types)
11. [Platform-owned vs Merchant-owned](#11-platform-owned-vs-merchant-owned)
12. [Redemption Rate](#12-redemption-rate)
13. [Rate Versioning](#13-rate-versioning)
14. [Rate Snapshot](#14-rate-snapshot)
15. [Quote](#15-quote)
16. [Point Reservation](#16-point-reservation)
17. [Wallet Debit](#17-wallet-debit)
18. [Wallet Release](#18-wallet-release)
19. [Wallet Refund](#19-wallet-refund)
20. [Order State Machine](#20-order-state-machine)
21. [Inventory](#21-inventory)
22. [Inventory Reservation](#22-inventory-reservation)
23. [Physical Fulfilment](#23-physical-fulfilment)
24. [Digital Fulfilment](#24-digital-fulfilment)
25. [Service Fulfilment](#25-service-fulfilment)
26. [Cancellation](#26-cancellation)
27. [Refund](#27-refund)
28. [KYC and Eligibility](#28-kyc-and-eligibility)
29. [Limits](#29-limits)
30. [Admin Operations](#30-admin-operations)
31. [Maker / Checker Boundary](#31-maker--checker-boundary)
32. [Idempotency](#32-idempotency)
33. [Concurrency](#33-concurrency)
34. [Lock Ordering](#34-lock-ordering)
35. [Atomic Transaction Boundary](#35-atomic-transaction-boundary)
36. [Immutable Ledger](#36-immutable-ledger)
37. [Audit](#37-audit)
38. [Privacy](#38-privacy)
39. [Fraud Controls](#39-fraud-controls)
40. [Proposed Database Schema](#40-proposed-database-schema)
41. [Constraints and Indexes](#41-constraints-and-indexes)
42. [Proposed APIs](#42-proposed-apis)
43. [Error Codes](#43-error-codes)
44. [Acceptance Test Matrix](#44-acceptance-test-matrix)
45. [Deferred Scope](#45-deferred-scope)
46. [Bryan Open Decisions (OD-01 through OD-30)](#46-bryan-open-decisions-od-01-through-od-30)
47. [Proposed P6-S1 onward Breakdown](#47-proposed-p6-s1-onward-breakdown)

---

## 1. Purpose and Scope

### 1.1 Purpose

The Redemption Center is the system responsible for enabling iPoint members to exchange their accumulated iPoint points for catalog items (physical goods, digital vouchers, and services). It encompasses:

- A **per-market catalog** of redeemable items with configurable point costs.
- A **Quote → Atomic Confirm/Debit** workflow with rate locking at quote time.
- **Direct Atomic Debit** is the adopted flow (Bryan Decision OD-05). No reservation, no hold, no RESERVED state.
- **Inventory management** for physical and service items.
- **Fulfilment tracking** across physical, digital, and service modalities.
- **Point refund** on cancellation or failure, via exact-opposite ledger entries.
- **Order lifecycle management** with an auditable state machine.
- **Admin operations** for catalog, rate, inventory, and order administration.

### 1.2 Scope

**IN SCOPE (P6-S0 Contractual):**

- Redemption catalog architecture and ownership model
- Catalog item types and classification (platform-owned vs merchant-owned)
- Redemption rate configuration and versioning
- Rate snapshot and locking at quote time
- Quote generation, point cost calculation, and expiry
- Point reservation pattern — DIRECT_ATOMIC_DEBIT adopted (OD-05)
- Wallet debit, release, and refund with exact-opposite compensation
- Order state machine with two candidate variants (Section 20): one for Direct Debit FLOW A and one for Reservation FLOW B.
- Inventory model, reservation, oversell prevention, and release
- Fulfilment tracking for physical, digital, and service items
- Cancellation and refund rules
- KYC eligibility and member status checks
- Daily/monthly limits
- Admin operations: catalog CRUD, rate management, inventory adjustment, order administration
- Maker/Checker boundary definition
- Idempotency, concurrency, and lock ordering
- Atomic transaction boundaries and rollback
- Immutable wallet ledger compliance
- Audit completeness and privacy projection
- Proposed database schema, APIs, error codes, and acceptance test matrix
- Open decisions (OD-01 through OD-30) — all PENDING

**OUT OF SCOPE (P6-S0 Contractual):**

- Production code implementation (P6-S1 and later)
- Database migration (P6-S1)
- Controller/Service/Repository code (P6-S1)
- UI implementation (P6-S1+)
- API implementation (P6-S1+)
- Test implementation (P6-S1+)
- Cash withdrawal (DEFERRED — see Section 45)
- Bank withdrawal (DEFERRED)
- Agent Commission Payout (DEFERRED — see Phase 5 deferred scope)
- Wallet cash-out (DEFERRED)
- Five-level team reward (DEFERRED)
- Merchant settlement for redemption (DEFERRED — OD-25 PENDING)
- Redemption commission for agent referrals (DEFERRED — OD-29 PENDING)

### 1.3 Key Inherited Principles

The following principles are inherited from earlier phases and are **LOCKED**:

| #   | Principle                              | Source Phase            | Rule                                                                 |
| --- | -------------------------------------- | ----------------------- | -------------------------------------------------------------------- |
| 1   | One Account + Multi Market             | Phase 2 (D-027)         | A single member can access multiple markets independently            |
| 2   | One Wallet Per Market                  | Phase 3 (D-029)         | Each market has an independent iPoint wallet                         |
| 3   | Immutable Ledger                       | Phase 3 (D-029)         | Wallet entries are append-only; corrections use compensating entries |
| 4   | Rate Snapshot at Source Time           | Phase 4 (D-037)         | Historical redemption orders must store rate snapshot at order time  |
| 5   | Atomic Transaction Boundary            | Phase 4 (D-037)         | Confirm operations must be all-or-nothing                            |
| 6   | Decimal Arithmetic Only                | Phase 3/5 (D-029/D-042) | All point arithmetic uses `NUMERIC(38,10)` with HALF_UP rounding     |
| 7   | Idempotency for Critical Writes        | Phase 4 (D-037)         | Each mutation must be idempotent via unique business constraint      |
| 8   | KYC Level 2 Required Before Redemption | Member PRD V1.1         | Level 2 KYC is a prerequisite for redemption                         |
| 9   | Merchant Snapshot Preservation         | Phase 3/4               | Historical order snapshots must preserve the state at order time     |

---

## 2. Terminology

| Term                             | Definition                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Redemption (兑换)**            | The process of exchanging iPoint points for catalog items.                                                              |
| **Redemption Center (兑换中心)** | The per-market interface where members browse, quote, and submit redemption orders.                                     |
| **Catalog (商品目录)**           | A per-market listing of items available for redemption.                                                                 |
| **Catalog Item (商品)**          | A single redeemable entity with a point cost, inventory, and fulfilment type.                                           |
| **Redemption Rate (兑换率)**     | The conversion value of 1 iPoint in the market's fiat currency (e.g., 1 iPoint = RM 0.01).                              |
| **Point Cost (所需积分)**        | The iPoint amount required to redeem one unit of a catalog item (either fixed or derived from rate).                    |
| **Reservation (预留)**           | NOT USED in MVP. Bryan Decision OD-05 adopts Direct Atomic Debit.                                                       |
| **Reservation (预留)**           | NOT USED in MVP. Bryan Decision OD-05 adopts Direct Atomic Debit.                                                       |
| **Redemption Order (兑换订单)**  | A confirmed request to redeem a catalog item, with an associated state machine.                                         |
| **Fulfilment (履约)**            | The process of delivering the redeemed item to the member (physical shipment, digital delivery, or service scheduling). |
| **Voucher (电子券)**             | A digital redemption item typically delivered as a code, barcode, or claim link.                                        |
| **Wallet Market (钱包市场)**     | The market whose iPoint wallet is debited during redemption.                                                            |
| **Inventory (库存)**             | The available quantity of a catalog item. May be unlimited for digital items.                                           |
| **Refund (退点)**                | The return of iPoint points to the member's wallet when an order is cancelled, fails, or is refunded.                   |

---

## 3. Actors and Permissions

### 3.1 Actors

| Actor      | Description                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| **Member** | Any registered iPoint member with KYC Level 2 completed. Can browse, quote, and redeem from their eligible markets. |
| **Admin**  | iPoint platform administrator. Can manage catalog, rates, inventory, orders, and perform manual adjustments.        |
| **System** | Automated processes: order expiry, fulfilment callbacks, inventory release, refund execution.                       |

### 3.2 Permission Matrix

| Action                              | Member                | Admin              | System               |
| ----------------------------------- | --------------------- | ------------------ | -------------------- |
| Browse catalog (own current market) | ✅                    | ✅                 | ✅                   |
| Browse catalog (cross-market)       | ❌ (OD-03 PENDING)    | ✅                 | ✅                   |
| Generate quote                      | ✅                    | ✅                 | ✅                   |
| Confirm redemption order            | ✅                    | ✅                 | ✅                   |
| Cancel own order                    | ✅ (limited by state) | ✅                 | ✅                   |
| View own redemption history         | ✅                    | ✅                 | ✅                   |
| View others' redemption history     | ❌                    | ✅                 | ✅                   |
| Create catalog item                 | ❌                    | ✅                 | ❌                   |
| Update catalog item                 | ❌                    | ✅                 | ❌                   |
| Configure redemption rate           | ❌                    | ✅                 | ❌                   |
| Adjust inventory                    | ❌                    | ✅                 | ✅                   |
| Fulfil order (physical)             | ❌                    | ✅                 | ✅ (system callback) |
| Fulfil order (digital)              | ❌                    | ✅                 | ✅ (auto)            |
| Cancel any order                    | ❌                    | ✅                 | ✅ (on expiry)       |
| Refund points                       | ❌                    | ✅ (OD-17 PENDING) | ✅ (on cancellation) |
| Maker/Checker approval              | ❌                    | ✅ (OD-17 PENDING) | ❌                   |

---

## 4. Document Authority

### 4.1 Authority Order for P6-S0

When documents conflict during Phase 6, use this hierarchy (lower number wins):

| Rank   | Source                                                              | Notes                                                   |
| ------ | ------------------------------------------------------------------- | ------------------------------------------------------- |
| **1**  | Bryan's latest explicit written decision                            | Highest authority                                       |
| **2**  | ChatGPT Command Center Phase 6 Phase Brief or acceptance decision   | Current execution authority                             |
| **3**  | **P6-S0-REDEMPTION-CENTER-CONTRACT.md** (this document)             | Once frozen, becomes the Phase 6 single source of truth |
| **4**  | Latest approved Admin PRD V1.0                                      | Redemption Center admin rules                           |
| **5**  | Latest approved Member PRD V1.1 (International Architecture Update) | Market isolation and redemption rules                   |
| **6**  | Latest approved Merchant PRD                                        | Merchant-owned items may reference merchant rules       |
| **7**  | iPoint Product Design System                                        | UI/UX token authority                                   |
| **8**  | Project Master Control + Operating Rules                            | Governance baseline                                     |
| **9**  | Phase 5 Agent & Commission Contract (frozen)                        | Commission semantics for merchant-owned items           |
| **10** | Phase 4 Transaction/Correction Contract (frozen)                    | Correction compensation patterns                        |
| **11** | Phase 3 Wallet/Reward Contract (frozen)                             | Wallet ledger and immutable entry rules                 |
| **12** | MVP Roadmap V1.0                                                    | Business background only                                |

### 4.2 Inherited Frozen Rules

The following rules from earlier phases are **fully inherited and may not be contradicted**:

- Phase 3: Wallet Ledger immutability (`member_wallet_entries` is append-only)
- Phase 3: One wallet per (member, market) — `UNIQUE(member_id, market_id)`
- Phase 3: Balance = SUM(ledger entries) — never stored independently
- Phase 3: Corrections use compensating entries with `reversal_of` FK
- Phase 3: Decimal arithmetic only — `NUMERIC(38,10)` with HALF_UP rounding
- Phase 3: UTC storage + IANA timezone per market
- Phase 4: Preview does not reserve funds (parallel: Quote does not confirm debit)
- Phase 4: Atomic transaction boundary — Confirm is all-or-nothing
- Phase 4: Idempotency via unique business constraints
- Phase 4: Snapshot at source event time
- Phase 5: Exact-opposite compensation (compensation_amount = original × -1)

---

## 5. Cross-phase Dependencies

### 5.1 Dependency Graph

```
Phase 2 (Member Core) ─────┐
                            ├──> Phase 6 (Redemption Center)
Phase 3 (Wallet + Reward) ──┘
       │                         Phase 6 reads wallet balance
       │                         Phase 6 debits wallet
       │                         Phase 6 refunds wallet
       ▼
Phase 4 (Transaction Engine) ── Phase 6 borrows correction pattern
       │
       ▼
Phase 5 (Commission Engine) ─── Phase 6 may need merchant-owned item commission (OD-29)
```

### 5.2 Required Interfaces

| Interface                    | Provider | Phase 6 Usage                                           |
| ---------------------------- | -------- | ------------------------------------------------------- |
| `GET /wallets/:id`           | Phase 3  | Check point balance before quote/confirm                |
| `POST /wallets/:id/entries`  | Phase 3  | Debit points on order confirmation                      |
| Wallet ledger entry types    | Phase 3  | Add `REDEMPTION_DEBIT`, `REDEMPTION_REFUND` entry types |
| `POST /wallets/:id/reversal` | Phase 3  | Refund points on cancellation                           |
| Member KYC status            | Phase 2  | Check KYC Level 2 before allowing redemption            |
| Member current market        | Phase 2  | Determine catalog visibility                            |
| Member account country       | Phase 2  | Determine wallet market (OD-04 PENDING)                 |
| Merchant data                | Phase 1  | Merchant-owned items reference merchant information     |
| Correction pattern           | Phase 4  | Refund uses exact-opposite entry                        |

### 5.3 Phase 3 Wallet Ledger Extensions

Phase 6 requires two new `entry_type` values in the existing `member_wallet_entries` table:

| entry_type          | Description                                     |
| ------------------- | ----------------------------------------------- |
| `REDEMPTION_DEBIT`  | iPoint debited for a confirmed redemption order |
| `REDEMPTION_REFUND` | iPoint refunded after cancellation/failure      |

Phase 6 will require an explicit forward-only migration to extend the wallet entry-type constraint/enum while preserving all Phase 3 entry meanings and existing rows. The existing Phase 3 entry types (`REWARD_ACCRUAL`, `REVERSAL`, `CORRECTION`, `ADJUSTMENT`) remain unchanged.

---

## 6. One Account + Multi Market

**LOCKED (inherited from Phase 2):** The One Account + Multi Market principle is fully inherited.

- A single member account can access multiple markets.
- Each market has independent catalog, rates, wallet, and redemption history.
- Member identity is global; market-specific data (catalog, wallet, orders) is isolated.

**Redemption-specific implications:**

1. **Market-specific catalogs:** Each market maintains its own catalog of redeemable items. A catalog item may be shared across markets (with potentially different point costs), but each market's catalog is independently managed.
2. **Market-specific rates:** Redemption rate (1 iPoint = X fiat) is configured per market.
3. **Market-specific wallet:** Points are debited from the wallet belonging to the **wallet market** (OD-04 PENDING).
4. **Market-specific order history:** Redemption orders are associated with the market where they were placed.

---

## 7. Current Market

**LOCKED (inherited from Phase 2):** Current Market is the member's active browsing market, switchable at any time.

**Redemption-specific effects:**

| Effect           | Rule                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| Catalog Browsing | Current Market determines which catalog is displayed. Member sees only the catalog belonging to their current market. |
| Quote Generation | Quote is generated against the current market's catalog and rate.                                                     |
| Order Placement  | Order is associated with the current market at time of confirmation.                                                  |

**OPEN:** Whether the Wallet Market (market whose wallet is debited) must equal the Current Market. See OD-04.

---

## 8. Wallet Market

### 8.1 Bryan Decision — Unified Market

**BRYAN DECISION (OD-04):** CURRENT_MARKET = CATALOG_MARKET = ORDER_MARKET = WALLET_MARKET = RATE_MARKET = PICKUP_MARKET.

Account Country does NOT determine the debit wallet. The Current Market unified concept applies:

| Scope              | Market         |
| ------------------ | -------------- |
| Catalog browsing   | Current Market |
| Quote generation   | Current Market |
| Wallet debited     | Current Market |
| Rate applied       | Current Market |
| Pickup location    | Current Market |
| Refund destination | Current Market |
| Order association  | Current Market |

### 8.2 Design Impact

The unified market decision affects:

- Wallet balance queries: always current market wallet
- Debit on confirmation: always current market wallet
- Refund destination: always current market wallet
- Cross-market redemption: PROHIBITED (OD-03)

---

## 9. Redemption Catalog

### 9.1 Catalog Structure

Each market has one active catalog. The catalog is administered by platform admins and contains all items available for redemption in that market.

```
Market (MY)
  └── Catalog (active)
       ├── Item A (platform-owned, physical, RM50 value, 5000 points)
       ├── Item B (platform-owned, digital voucher, RM10 value, 1000 points)
       ├── Item C (merchant-owned, service, RM200 value, 20000 points)
       └── Item D (platform-owned, digital, unlimited inventory)
```

### 9.2 Catalog Item Fields (Design)

| Field                | Type           | Description                                                          |
| -------------------- | -------------- | -------------------------------------------------------------------- |
| id                   | UUID           | Unique item identifier                                               |
| market_id            | UUID           | FK to markets — the market this item belongs to                      |
| sku                  | VARCHAR(64)    | Optional SKU for inventory tracking                                  |
| name                 | VARCHAR(256)   | Item name (market-language specific)                                 |
| description          | TEXT           | Item description                                                     |
| item_type            | VARCHAR(32)    | `PHYSICAL`, `DIGITAL_VOUCHER`, `SERVICE`                             |
| ownership            | VARCHAR(32)    | `PLATFORM_OWNED` or `MERCHANT_OWNED`                                 |
| merchant_id          | UUID           | FK to merchants (nullable — only for merchant-owned)                 |
| point_cost           | NUMERIC(38,10) | Fixed point cost per unit (if using Fixed Point Cost model)          |
| fiat_reference_value | NUMERIC(38,10) | Optional fiat value for reference display                            |
| currency             | VARCHAR(3)     | Currency code for fiat reference value                               |
| inventory_mode       | VARCHAR(32)    | `UNLIMITED`, `TRACKED`, `ON_DEMAND`                                  |
| total_inventory      | NUMERIC(38,0)  | Total units available (for TRACKED mode)                             |
| available_inventory  | NUMERIC(38,0)  | Current available units (computed from total - reserved - fulfilled) |
| image_url            | TEXT           | Item image                                                           |
| terms                | TEXT           | Redemption terms and conditions                                      |
| is_active            | BOOLEAN        | Whether item is active in the catalog                                |
| is_featured          | BOOLEAN        | Whether item is featured/promoted                                    |
| tags                 | TEXT[]         | Search/filter tags                                                   |
| effective_from       | TIMESTAMPTZ    | When item becomes available                                          |
| effective_until      | TIMESTAMPTZ    | When item expires (nullable)                                         |
| created_by           | UUID           | Admin who created the item                                           |
| version              | INTEGER        | Version number for optimistic locking                                |
| created_at           | TIMESTAMPTZ    | Row creation timestamp                                               |
| updated_at           | TIMESTAMPTZ    | Row update timestamp                                                 |

### 9.3 Catalog Versioning

Each catalog item has a `version` counter. When an item's point cost or other key fields change, the version increments. This version is captured in the quote snapshot (see Section 14).

---

## 10. Catalog Item Types

### 10.1 Type Classification

| Type            | Code              | Inventory Needed | Fulfilment                      | Examples                               |
| --------------- | ----------------- | ---------------- | ------------------------------- | -------------------------------------- |
| Physical Goods  | `PHYSICAL`        | Yes (tracked)    | Shipment via courier            | Merchandise, gifts, branded items      |
| Digital Voucher | `DIGITAL_VOUCHER` | No (unlimited)   | Instant delivery (code/barcode) | E-vouchers, gift cards, discount codes |
| Service         | `SERVICE`         | Yes (slot-based) | Scheduling/appointment          | Experiences, classes, consultations    |

### 10.2 Type-specific Rules

**Physical Goods:**

- Inventory must be tracked and reserved at quote/confirm time
- Fulfilment requires shipping address collection
- Estimated delivery time must be communicated to the member
- Shipping cost responsibility is OPEN (OD-07)

**Digital Vouchers:**

- Typically unlimited inventory (configurable per item)
- Instant fulfilment or near-instant
- Voucher code custody mode is OPEN (OD-24)
- Voucher expiry handling is OPEN (OD-09, OD-10)

**Service Items:**

- Inventory is slot-based or capacity-based
- Fulfilment requires scheduling coordination
- May involve merchant interaction for service delivery

---

## 11. Platform-owned vs Merchant-owned

### 11.1 Ownership Model

**BRYAN DECISION (OD-01, OD-02): PLATFORM_OWNED_CATALOG_ONLY**

MVP only supports platform-owned items. Merchant-owned items are NOT included in MVP.

| Ownership        | Owner           | Catalog Management | Fulfilment Responsibility                          |
| ---------------- | --------------- | ------------------ | -------------------------------------------------- |
| `PLATFORM_OWNED` | iPoint platform | Admin only         | Platform or platform-nominated fulfillment partner |

### 11.2 Merchant-Owned Items

NOT INCLUDED IN MVP (OD-02). No merchant catalog, merchant fulfilment, or merchant redemption items shall be implemented.

---

## 12. Redemption Rate

### 12.1 Rate Definition

A redemption rate defines the conversion value of 1 iPoint in the market's fiat currency.

**Example:** Rate = 0.01 means 1 iPoint = RM 0.01.

### 12.2 Fixed Point Cost vs Rate Conversion

Two models for determining point cost are proposed:

| Model                                 | Description                                                                 | Example                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Fixed Point Cost (OD-21 Option A)** | Each catalog item has a fixed `point_cost` directly set in the item record. | Item costs 5000 points regardless of rate changes.                              |
| **Rate Conversion (OD-21 Option B)**  | Point cost is derived from `fiat_reference_value / rate`.                   | Item valued at RM50, rate = 0.01 → 5000 points. Rate changes affect point cost. |

**BRYAN DECISION (OD-21): RATE_CONVERSION_PRICING**

Formula: `required_iPoint = fiat_reference_value / redemption_rate`. 1 iPoint = X Market Fiat Currency.

Must use NUMERIC/Decimal arithmetic with HALF_UP rounding. Quote stores both unrounded and posted values. Client-side pricing is prohibited. Fixed point cost as primary pricing source is prohibited.

---

## 13. Rate Versioning

### 13.1 Rate Version Lifecycle

- The single `redemption_rate_versions` table stores all historical and current rate configurations.
- Historical rate versions are immutable after creation — no existing row may be modified.
- Rate changes are prospective only — historical orders retain their rate snapshot.
- Multiple rate versions may exist, but their effective date ranges must NOT overlap for the same market.
- Rate versions may be scheduled (future `effective_from`).
- Admin does NOT modify an existing rate row; admin creates a NEW rate version with a new `effective_from`.

### 13.2 Non-overlapping Effective Range Constraint

```
-- Every pair of rows for the same market_id must satisfy:
--   (range1.effective_from, range1.effective_until) IS DISJOINT FROM
--   (range2.effective_from, range2.effective_until)
--
-- Implementation: exclusion constraint using PostgreSQL tstzrange
--   EXCLUDE USING gist (market_id WITH =, effective_range WITH &&)
--   where effective_range = tstzrange(effective_from, effective_until, '[)')
```

This constraint guarantees that at any point in time, exactly one rate version is effective per market.

### 13.3 Rate Effective Time

**BRYAN DECISION (OD-22): RATE_LOCKED_AT_QUOTE_TIME**

- Quote uses rate version effective at generation time.
- Rate change during quote validity does NOT affect the quote.
- Confirm uses Quote Snapshot.
- New quotes use new rate.
- Rate changes must NOT make valid quotes automatically stale.
- Item Version, Market, Eligibility, or Payload changes MAY make quote stale.

### 13.4 Rate Version Table (Design)

```
redemption_rate_versions
├── id (uuid, PK)
├── market_id (uuid, FK→markets) — NOT NULL
├── rate (numeric(38,10)) — 1 iPoint = X fiat
├── fiat_currency (varchar(3)) — NOT NULL
├── effective_from (timestamptz) — NOT NULL, inclusive
├── effective_until (timestamptz) — nullable, exclusive upper bound
├── created_by (uuid, FK→admin_users)
├── created_at (timestamptz)
├── notes (text, nullable)
```

**Effective range constraint:** `EXCLUDE USING gist (market_id WITH =, tstzrange(effective_from, effective_until, '[)') WITH &&)` — guarantees non-overlapping effective ranges per market.

**Rows are immutable after creation:** No UPDATE on rate, effective_from, or effective_until after a version is committed. Admin creates a new version to change the rate.

---

## 14. Rate Snapshot

### 14.1 Snapshot Principles

Every confirmed redemption order MUST capture an immutable snapshot of the rate and item state at order time.

**Locked at confirm time:**

- Redemption rate version and rate value
- Catalog item version and point cost
- Item name and description (at confirm time)
- Item type and ownership
- Quantity
- Total point cost
- Member KYC status at confirm time
- Inventory availability at confirm time (audit only)

### 14.2 Snapshot Storage

The snapshot is stored as JSONB on the redemption order record:

```
redemption_order.snapshot = {
  rate_version_id: "uuid",
  rate_value: "0.0100000000",
  item_version: 3,
  item_name: "Premium T-Shirt",
  item_type: "PHYSICAL",
  ownership: "PLATFORM_OWNED",
  point_cost_per_unit: "5000.0000000000",
  quantity: 2,
  total_point_cost: "10000.0000000000",
  fiat_reference_value: "50.00",
  currency: "MYR",
  kyc_level_at_confirm: "LEVEL_2",
  eligibility_snapshot: { ... }
}
```

---

## 15. Quote

### 15.1 Quote Purpose

A quote provides the member with a time-bounded estimate of point cost and item availability. It does NOT debite points or reserve inventory.

### 15.2 Quote Lifecycle

```
Member selects item + quantity
       │
       ▼
System generates QUOTE
  ├── Locks rate version (see OD-22)
  ├── Checks inventory availability (informational only — no reservation)
  ├── Returns:
  │   ├── itemId, itemVersion
  │   ├── market
  │   ├── rateVersion
  │   ├── pointCost per unit
  │   ├── totalPointCost (quantity × pointCost)
  │   ├── availableInventory (informational)
  │   ├── expiresAt (OD-06 PENDING)
  │   └── memberBalance (current wallet balance)
  │
  ▼
Member decides within quote expiry
  ├── CONFIRM → proceed to Point Reservation (Section 16)
  └── EXPIRES → quote is invalid, member must regenerate
```

### 15.3 Quote Response Fields (API Design)

```
GET /redemption/items/:itemId/quote?quantity=1

Response:
{
  "quoteId": "uuid",
  "itemId": "uuid",
  "itemVersion": 3,
  "market": "MY",
  "rateVersionId": "uuid",
  "rateValue": "0.0100000000",
  "pointCostPerUnit": "5000.0000000000",
  "quantity": 1,
  "totalPointCost": "5000.0000000000",
  "availableInventory": 50,
  "isInventorySufficient": true,
  "memberBalance": "15000.0000000000",
  "isBalanceSufficient": true,
  "expiresAt": "2026-07-27T19:32:00Z",
  "createdAt": "2026-07-27T19:22:00Z"
}
```

### 15.4 Quote Rules

| Rule                          | Description                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Quote does NOT debite**     | Quote is an immutable commercial snapshot only. No wallet mutation, no inventory reservation, no order creation. |
| **Quote does NOT reserve**    | No inventory reservation during quote (OD-06 PENDING)                                                            |
| **Quote may be re-validated** | At confirm time, the system must re-validate the quote (item available, rate still valid, balance sufficient)    |
| **Expired quote**             | Confirm with an expired quote must be rejected with `REDEMPTION_QUOTE_EXPIRED` error                             |
| **Stale quote**               | Confirm must reject with `REDEMPTION_QUOTE_STALE` if item version has changed since quote was generated          |
| **Quote is idempotent**       | Same (member, item, quantity) within quote expiry returns same quote                                             |

---

## 16. Confirm Flow — Direct Atomic Debit

**BRYAN DECISION (OD-05): DIRECT_ATOMIC_DEBIT**

MVP uses direct atomic debit. No point reservation, no wallet hold, no inventory reservation, no RESERVED state, no reservation expiry, no release flow.

### 16.1 Confirm Flow Diagram

```
Quote
  │
  ▼
Atomic Confirm (single database transaction)
  ├── Acquire canonical idempotency lock
  ├── Load and validate Quote (not expired, payload hash matches)
  ├── Validate same payload hash — prevent client tampering
  ├── Validate item version matches quote
  ├── Validate market equality (catalog = quote = wallet market)
  ├── Validate member ACTIVE
  ├── Validate KYC Level 2
  ├── Validate terms acceptance
  ├── [If DELIVERY] Validate shipping payment completed
  ├── Acquire wallet advisory lock (3-second lock_timeout)
  ├── Recheck wallet balance >= total point cost (under wallet lock)
  ├── Acquire inventory row lock
  ├── Recheck inventory sufficient or backorder allowed
  ├── CREATE wallet entry (entry_type='REDEMPTION_DEBIT', amount=-total_points)
  ├── UPDATE wallet_account projection (balance = balance - total_points)
  ├── UPDATE inventory (decrement or backorder increment)
  ├── INSERT redemption_order (state=CONFIRMED)
  ├── INSERT fulfilment record
  ├── Mark quote consumed
  ├── Mark shipping payment consumed
  ├── INSERT audit log
  └── COMMIT. On any failure: ROLLBACK. No partial state.
```

### 16.2 Wallet Debit — Economic Model

**LOCKED (inherited from Phase 3 immutable ledger):**

1. **Wallet Ledger** is the immutable economic fact. Every point movement produces a ledger entry.
2. **`member_wallet_accounts.balance`** is a controlled projection — updated atomically with the ledger entry in the same database transaction.
3. **Projection is reconstructible** from ledger entries: `balance = SUM(ledger_entry.amount)`.
4. The ledger entry and the projection update MUST be in the same database transaction.

### 16.3 Debit Entry

| Field             | Value for REDEMPTION_DEBIT             |
| ----------------- | -------------------------------------- |
| `entry_type`      | `'REDEMPTION_DEBIT'`                   |
| `amount`          | `-total_point_cost`                    |
| `balance_before`  | Current wallet projection before debit |
| `balance_after`   | New projection after debit             |
| `idempotency_key` | `redemption:confirm:{order_id}`        |
| `reversal_of`     | `NULL`                                 |
| `correlation_id`  | Redemption Order ID                    |

### 16.4 Balance Enforcement — Inside Wallet Lock

Final wallet debit boundary MUST re-check and enforce non-negative available balance while holding the wallet lock, inside the same database transaction.

The pre-confirm balance check is a UX optimization only — NOT the sole fund protection.

### 16.5 Atomic Confirm Transaction Boundary

```
BEGIN TRANSACTION
  SET lock_timeout = '3s';
  ├── (1) Acquire canonical operation advisory lock (idempotency guard)
  ├── (2) Acquire wallet advisory lock (pg_advisory_xact_lock)
  ├── (3) Acquire inventory row lock (SELECT ... FOR NO KEY UPDATE)
  ├── (4) Check member eligibility (status, KYC, not suspended)
  ├── (5) Check item availability (active, effective range)
  ├── (6) Validate quote (not expired, same payload)
  ├── (7) Enforce wallet balance >= total point cost (within wallet lock)
  ├── (8) Check inventory sufficiency or backorder allowance
  ├── (9) [DELIVERY] Validate shipping payment consumed once
  ├── (10) INSERT wallet entry (entry_type='REDEMPTION_DEBIT')
  ├── (11) UPDATE member_wallet_accounts SET balance = balance - total_points
  ├── (12) UPDATE redemption_inventory (decrement version check)
  ├── (13) INSERT redemption_order (state=CONFIRMED)
  ├── (14) INSERT/UPDATE fulfilment record
  ├── (15) Mark quote consumed
  ├── (16) Mark shipping payment consumed
  ├── (17) INSERT audit log entry
COMMIT
```

**Failure handling:** Rollback on any step failure. No partial state.

## 17. Wallet Debit — Economic Model

### 17.1 Core Principles

**LOCKED (inherited from Phase 3 immutable ledger):**

1. **Wallet Ledger** is the immutable economic fact. Every point movement must produce a ledger entry.
2. **`member_wallet_accounts.balance`** is a **controlled projection** — updated atomically with the ledger entry in the same database transaction.
3. **Projection is reconstructible** from ledger entries: `balance = SUM(ledger_entry.amount)`.
4. The ledger entry and the projection update MUST be in the same database transaction. No orphan projection.

### 17.2 Debit Entry

| Field             | Value for REDEMPTION_DEBIT             |
| ----------------- | -------------------------------------- |
| `entry_type`      | `'REDEMPTION_DEBIT'`                   |
| `amount`          | `-total_point_cost`                    |
| `balance_before`  | Current wallet projection before debit |
| `balance_after`   | New projection after debit             |
| `idempotency_key` | `redemption:confirm:{order_id}`        |
| `reversal_of`     | `NULL`                                 |
| `correlation_id`  | Redemption Order ID                    |

### 17.3 Balance Enforcement — Inside Wallet Lock

**Final wallet debit boundary MUST re-check and enforce non-negative available balance while holding the wallet lock, inside the same database transaction.**

The Redemption Service's pre-confirm balance check (Section 35 step D) is a UX optimization only — it is NOT the sole fund protection.

```
-- Inside the atomic confirm transaction, under wallet advisory lock:

LOCK TABLE member_wallet_accounts IN ROW EXCLUSIVE MODE;

SELECT balance FROM member_wallet_accounts
WHERE id = :wallet_account_id
FOR NO KEY UPDATE;  -- blocks concurrent debit on same account

IF balance < total_point_cost THEN
  RAISE EXCEPTION 'REDEMPTION_BALANCE_INSUFFICIENT';
END IF;

-- Only then create the debit entry and update projection
```

### 17.4 FLOW A — Direct Debit Sequence

```
BEGIN TRANSACTION
  Wallet advisory lock (3-second lock_timeout)
  Re-check balance >= total_point_cost
  INSERT member_wallet_entries (entry_type='REDEMPTION_DEBIT', ...)
  UPDATE member_wallet_accounts SET balance = balance - total_point_cost
  Inventory decrement (version check)
  Insert redemption_order (CONFIRMED)
  Update limit counters
  Insert audit log
COMMIT
```

### 17.5 FLOW B — Reservation Debit Sequence

```
BEGIN TRANSACTION
  Wallet advisory lock (3-second lock_timeout)
  Re-check available-to-spend >= total_point_cost
  -- Reservation was already created; now convert to permanent debit
  INSERT member_wallet_entries (entry_type='REDEMPTION_DEBIT', ...)
  UPDATE member_wallet_accounts SET balance = balance - total_point_cost
  UPDATE redemption_reservations SET status = 'CONFIRMED'
  Inventory decrement (version check)
  Update redemption_order: RESERVED → CONFIRMED
  Update limit counters
  Insert audit log
COMMIT
```

---

## 18. Wallet Release (FLOW B only)

### 18.1 Release Rules (FLOW B — if adopted)

When a reservation expires or is cancelled before confirmation:

1. No wallet ledger economic entry is created — the reservation was tracked in `redemption_reservations` only.
2. The `available-to-spend` projection increases because `SUM(reserved_points)` no longer includes this reservation.
3. Inventory reservation is released.
4. Reservation status updated to `RELEASED` or `EXPIRED`.
5. Wallet lock is acquired during release to prevent race conditions.

Confirm trigger is Direct Atomic Debit. No release step. Post-debit issues enter FULFILMENT_EXCEPTION.

---

## 19. Wallet Refund

### 19.1 Refund Principles

**LOCKED (inherited from Phase 3/4 correction patterns):**

1. **Original debit entry is immutable.** Never modify or delete the original `REDEMPTION_DEBIT` entry.
2. **Refund creates a compensating entry.** Create a new wallet entry with:
   - `entry_type = 'REDEMPTION_REFUND'`
   - `amount = -(original_debit_amount)` — exact opposite (positive)
   - `reversal_of = original_wallet_entry_id`\n - `correlation_id = refund_order_id`
   - Unique `idempotency_key`
3. **Refund is all-or-nothing.** If partial refund is not approved (OD-12), a cancellation refunds the full order amount.

### 19.2 Refund Entry Example

```
Original debit:  amount = -5000.0000000000 (REDEMPTION_DEBIT)
Refund entry:    amount = +5000.0000000000 (REDEMPTION_REFUND)
                 reversal_of = <original_entry_id>
Net effect: 0.00 iPoint
```

### 19.3 Partial Refund Consideration

If OD-12 (Partial Refund) is approved, the refund amount is a portion of the original debit. The entry still uses exact-opposite semantics for the refunded portion only.

---

## 20. Order State Machine — Final

**BRYAN DECISIONS (OD-05, OD-08, OD-11, OD-13, OD-26, OD-27, OD-28):**

Quote is NOT an Order. Waitlist is NOT an Order. The Order state machine starts at CONFIRMED.

### 20.1 Final State Machine

```
                  ┌──────────────────────┐
                  │      CONFIRMED       │
                  └──┬───────┬───────┬───┘
                     │       │       │
            Begin    │       │       │  Backorder
            Fulfil   │       │       │  (item configured)
                     ▼       │       ▼
           ┌─────────────┐   │   ┌──────────────┐
           │  PROCESSING │   │   │  BACKORDERED │
           └──────┬──────┘   │   └──────┬───────┘
                  │          │          │ Restock
                  ▼          │          ▼
           ┌─────────────┐   │   ┌──────────────┐
           │READY_FOR_   │   │   │  PROCESSING  │
           │ PICKUP      │   │   └──────┬───────┘
           │ (pickup     │   │          │
           │  only)      │   │          ▼
           └──────┬──────┘   │   ┌──────────────┐
                  │          │   │READY_FOR_    │
                  ▼          │   │ PICKUP       │
           ┌─────────────┐   │   └──────┬───────┘
           │  FULFILLED  │   │          │
           └─────────────┘   │          ▼
                             │   ┌──────────────┐
                             │   │  FULFILLED   │
                             │   └──────────────┘
                             │
                    ┌────────┴────────┐
                    ▼                 ▼
         ┌──────────────────┐  ┌──────────────────┐
         │  FULFILMENT_     │  │  FULFILMENT_     │
         │  SUSPENDED       │  │  EXCEPTION       │
         │  (member         │  │  (fulfilment     │
         │   suspended)     │  │  failure, max    │
         └──────────────────┘  │  retries, or     │
                    │           │  non-retryable)  │
                    │           └────────┬─────────┘
                    │                    │ Admin Review
                    │                    ▼
                    │           ┌──────────────────┐
                    │           │  REFUND_PENDING  │
                    │           │  (Maker/Checker  │
                    │           │   initiated)     │
                    │           └────────┬─────────┘
                    │                    │ Refund executed
                    │                    ▼
                    │           ┌──────────────────┐
                    └──────────►│    REFUNDED      │
                                └──────────────────┘
```

### 20.2 State Definitions

| State                | Code                   | Entry Conditions                                 | Actor           | Terminal | Cancellation by Member |
| -------------------- | ---------------------- | ------------------------------------------------ | --------------- | -------- | ---------------------- |
| CONFIRMED            | `CONFIRMED`            | iPoint debited, order created                    | System          | No       | ❌ Prohibited (OD-11)  |
| PROCESSING           | `PROCESSING`           | Fulfilment initiated                             | System, Admin   | No       | ❌                     |
| READY_FOR_PICKUP     | `READY_FOR_PICKUP`     | Item ready at pickup location                    | Admin, System   | No       | ❌                     |
| BACKORDERED          | `BACKORDERED`          | Out of stock, backorder allowed and accepted     | System          | No       | ❌                     |
| FULFILMENT_SUSPENDED | `FULFILMENT_SUSPENDED` | Member suspended (OD-28), existing orders paused | System          | No       | ❌                     |
| FULFILMENT_EXCEPTION | `FULFILMENT_EXCEPTION` | Fulfilment failed (max retries or non-retryable) | System          | No       | ❌                     |
| REFUND_PENDING       | `REFUND_PENDING`       | Admin Maker/Checker refund initiated             | Admin (Checker) | No       | ❌                     |
| REFUNDED             | `REFUNDED`             | Wallet refund compensating entry created         | System          | ✅       | N/A                    |
| FULFILLED            | `FULFILLED`            | Item delivered/picked up/voucher claimed         | System, Admin   | ✅       | N/A                    |

### 20.3 State Transition Rules

| From                 | To                   | Wallet Effect                      | Inventory Effect            | Notes                                |
| -------------------- | -------------------- | ---------------------------------- | --------------------------- | ------------------------------------ |
| CONFIRMED            | PROCESSING           | None                               | None                        | Fulfilment starts                    |
| CONFIRMED            | BACKORDERED          | None (already debited)             | Backorder count incremented | Item configured for backorder        |
| CONFIRMED            | FULFILMENT_SUSPENDED | None                               | None                        | Member suspended                     |
| CONFIRMED            | FULFILLED            | None                               | Inventory decremented       | Digital auto-fulfilment              |
| PROCESSING           | READY_FOR_PICKUP     | None                               | None                        | Pickup ready                         |
| PROCESSING           | FULFILLED            | None                               | None                        | Physical shipped/picked up           |
| PROCESSING           | FULFILMENT_EXCEPTION | None                               | None                        | Retry max reached or non-retryable   |
| PROCESSING           | FULFILMENT_SUSPENDED | None                               | None                        | Member suspended during processing   |
| BACKORDERED          | PROCESSING           | None                               | Inventory decremented       | Restock received                     |
| BACKORDERED          | FULFILMENT_SUSPENDED | None                               | None                        | Member suspended during backorder    |
| READY_FOR_PICKUP     | FULFILLED            | None                               | None                        | Picked up                            |
| FULFILMENT_SUSPENDED | PROCESSING           | None                               | None                        | Member restored — resume             |
| FULFILMENT_SUSPENDED | READY_FOR_PICKUP     | None                               | None                        | Resume pickup state                  |
| FULFILMENT_EXCEPTION | REFUND_PENDING       | None                               | None                        | Admin initiates refund               |
| FULFILMENT_SUSPENDED | REFUND_PENDING       | None                               | None                        | Admin initiates refund for suspended |
| REFUND_PENDING       | REFUNDED             | +refund_amount (REDEMPTION_REFUND) | Restored (if applicable)    | Exact opposite of original debit     |
| FULFILMENT_EXCEPTION | REFUNDED             | +refund_amount                     | Restored                    | After Maker/Checker approval         |

### 20.4 Key Rules

| Rule                          | Detail                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| **No member cancellation**    | After Confirm + Debit, member may NEVER cancel. Returns `REDEMPTION_ORDER_NOT_CANCELLABLE`.     |
| **Quote not an Order**        | Abandoning a quote is not cancellation. No wallet effect.                                       |
| **Auto-refund prohibited**    | No automatic iPoint refund on any failure. Admin Maker/Checker required.                        |
| **Original debit immutable**  | Refund creates compensating `REDEMPTION_REFUND`. Original `REDEMPTION_DEBIT` is never modified. |
| **FULFILMENT_EXCEPTION**      | After 3 retries or non-retryable failure. Admin review required. No auto-refund.                |
| **REFUND_PENDING**            | NOT terminal. Wallet ledger must succeed before REFUNDED.                                       |
| **REFUNDED**                  | Terminal. Exact opposite of original debit. Full refund only.                                   |
| **FULFILLED**                 | Terminal. No rollback.                                                                          |
| **FULFILMENT_SUSPENDED**      | Resume to previous state when member restored.                                                  |
| **Backorder debit immediate** | Points debited on confirm. No cancellation.                                                     |

## 21. Inventory

### 21.1 Inventory Model

Three inventory modes are supported:

| Mode        | Description                                                             | Applicable Items                   |
| ----------- | ----------------------------------------------------------------------- | ---------------------------------- |
| `UNLIMITED` | No inventory tracking; any quantity is available                        | Digital vouchers (typically)       |
| `TRACKED`   | Physical inventory is tracked; available = total - reserved - fulfilled | Physical goods                     |
| `ON_DEMAND` | No pre-existing inventory; item is produced on order                    | Service items, made-to-order items |

### 21.2 Inventory Table (Design)

```
redemption_inventory
├── id (uuid, PK)
├── item_id (uuid, FK→catalog_items)
├── total_quantity (numeric(38,0), nullable — NULL = unlimited)
├── reserved_quantity (numeric(38,0), default 0)
├── fulfilled_quantity (numeric(38,0), default 0)
├── version (integer) — optimistic lock counter
├── updated_at (timestamptz)

Computed: available_quantity = total_quantity - reserved_quantity - fulfilled_quantity
```

### 21.3 Inventory Reservation

If Option B (reservation) is adopted:

| Operation                               | Effect                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------- |
| Quote                                   | No inventory reservation                                                  |
| Confirm (with reservation)              | `reserved_quantity += quantity`                                           |
| Confirm final                           | `reserved_quantity -= quantity; fulfilled_quantity += quantity`           |
| Cancellation (before fulfilment)        | `reserved_quantity -= quantity`                                           |
| Cancellation (after fulfilment started) | `fulfilled_quantity -= quantity` (or kept, depending on item return rule) |
| Reservation expiry                      | `reserved_quantity -= quantity`                                           |

---

## 22. Inventory Reservation

### 22.1 Oversell Prevention

| Mechanism                | Description                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Optimistic lock**      | `redemption_inventory.version` is checked during updates. If another transaction modified the inventory concurrently, the current transaction fails with `REDEMPTION_INVENTORY_VERSION_CONFLICT`. |
| **CHECK constraint**     | `CHECK(reserved_quantity + fulfilled_quantity <= total_quantity)` for TRACKED items                                                                                                               |
| **Confirm-time recheck** | Even if quote showed sufficient inventory, the confirm step rechecks available inventory                                                                                                          |

### 22.2 Reservation Expiry (see OD-06)

If reservations are used:

- Reservation TTL is configurable per market (default: 15 minutes)
- Expired reservations are released by a scheduled job or on-demand check
- Release flow: `reserved_quantity -= quantity; status = 'EXPIRED'`

---

## 23. Physical Fulfilment

### 23.1 Flow

```
CONFIRMED
    │ Admin (or system) initiates fulfilment
    ▼
PROCESSING
    │ Item shipped / delivered
    ▼
FULFILLED (requires delivery confirmation)
```

### 23.2 Physical Fulfilment Data

```
redemption_fulfilments
├── id (uuid, PK)
├── order_id (uuid, FK→redemption_orders)
├── fulfilment_type (varchar(16)) — 'PHYSICAL', 'DIGITAL', 'SERVICE'
├── status (varchar(16)) — 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'
├── shipping_address (jsonb, nullable)
│   ├── name, phone, line1, line2, city, state, postcode, country
├── tracking_number (varchar(128), nullable)
├── courier (varchar(64), nullable)
├── estimated_delivery_date (date, nullable)
├── digital_value (text, nullable) — voucher code/barcode for digital
├── service_scheduled_at (timestamptz, nullable)
├── service_notes (text, nullable)
├── fulfilled_at (timestamptz, nullable)
├── failed_at (timestamptz, nullable)
├── failure_reason (text, nullable)
├── created_at (timestamptz)
└── updated_at (timestamptz)
```

### 23.3 Shipping Fee (see OD-07)

| Option                         | Description                                                          |
| ------------------------------ | -------------------------------------------------------------------- |
| **A: Platform pays**           | Shipping cost is borne by iPoint; member only pays points            |
| **B: Member pays**             | Member pays shipping fee separately (fiat or additional points)      |
| **C: Free shipping threshold** | Free shipping above a certain point threshold; otherwise member pays |

---

## 24. Digital Fulfilment

### 24.1 Flow

```
CONFIRMED
    │ Auto-generate voucher/code
    ▼
FULFILLED (instant)
```

### 24.2 Digital Fulfilment Types

| Type         | Example                                 | Delivery Method                     |
| ------------ | --------------------------------------- | ----------------------------------- |
| Voucher Code | Promo code, gift card                   | Display in order history, email     |
| Barcode/QR   | Event ticket                            | Display in member app, downloadable |
| Claim Link   | Digital content download                | Link in order history, email        |
| Activation   | Service activation (eSIM, subscription) | System-to-system integration        |

### 24.3 Voucher Expiry (see OD-09, OD-10)

| Rule                                                            | Issue                         |
| --------------------------------------------------------------- | ----------------------------- |
| Does the voucher itself have an expiry date?                    | OD-09: Digital Voucher Expiry |
| If voucher expires without being used, is a point refund given? | OD-10: Expired Voucher Refund |

---

## 25. Service Fulfilment

### 25.1 Flow

```
CONFIRMED
    │ Admin/merchant schedules service appointment
    ▼
PROCESSING (scheduled)
    │ Service delivered
    ▼
FULFILLED (requires completion confirmation)
```

### 25.2 Service Fulfilment Data

- Service scheduling date/time
- Service location (may differ from shipping address)
- Service provider (if merchant-owned, the merchant or their representative)
- Completion confirmation mechanism (admin confirmation, member confirmation, auto)

---

## 26. Cancellation

### 26.1 Cancellable States (see OD-11)

| State             | Member Cancellable? | Admin Cancellable?   | System Cancellable?            |
| ----------------- | ------------------- | -------------------- | ------------------------------ |
| DRAFT             | ✅                  | ✅                   | ✅ (on session expiry)         |
| QUOTED            | ✅                  | ✅                   | ✅ (on quote expiry)           |
| RESERVED (FLOW B) | ✅ (before debit)   | ✅                   | ✅ (on reservation expiry)     |
| CONFIRMED         | ❌ (OD-11 PENDING)  | ✅                   | ❌                             |
| PROCESSING        | ❌                  | ✅                   | ✅ (on failure)                |
| FULFILLED         | ❌                  | ❌ (post-fulfilment) | ❌                             |
| FAILED            | ❌                  | ✅ (triggers refund) | ✅ (auto-refund if configured) |

### 26.2 Cancellation Pre-conditions

| Before debit                  | After debit                                   |
| ----------------------------- | --------------------------------------------- |
| No wallet action needed       | Wallet refund required                        |
| Release inventory reservation | Restore inventory (if item not yet fulfilled) |
| No points returned            | Full point refund via compensating entry      |

### 26.3 Cancellation Wallet Effect

- Abandoning a quote (before confirm) has no wallet effect. Quote is not an Order. After Confirm + Debit: no cancellation.
- If cancelled **after** points are debited (CONFIRMED, PROCESSING): refund via compensating entry.
- If cancelled **after** fulfilment: refund is not automatic (dispute/return process — deferred).

---

## 27. Refund

### 27.1 Refund Rules

| Rule                            | Value                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Full Refund**                 | Exact opposite of original debit amount. Fully supported.                                               |
| **Partial Refund**              | OD-12 PENDING. If approved, refund portion only.                                                        |
| **Original Debit Immutability** | Original `REDEMPTION_DEBIT` entry is NEVER modified. Refund creates separate `REDEMPTION_REFUND` entry. |
| **Refund Idempotency**          | Each refund request has a unique idempotency key. Duplicate requests return the same result.            |

### 27.2 Refund Flow

```
1. Identify original order and original wallet debit entry
2. Calculate refund amount (full or partial — based on OD-12)
3. Atomic transaction:
   a. Create wallet entry: entry_type = 'REDEMPTION_REFUND'
      amount = +refund_amount
      reversal_of = original_entry_id
      idempotency_key = unique_key
   b. Update order status to REFUNDED (via REFUND_PENDING if intermediate state)
   c. Create audit log entry
4. If step 3 fails → no partial state
```

### 27.3 Out-of-stock Auto Refund (see OD-13)

If an order is confirmed but subsequently discovered to be out of stock:

- Automatic cancellation + full refund
- Notified to member with reason

---

## 28. KYC and Eligibility

### 28.1 KYC Requirements

**LOCKED (inherited from Member PRD V1.0 and Design System):**

| Requirement       | Rule                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **KYC Level 2**   | Required before redemption. Enforcement point defined in OD-15.                                                                                 |
| **KYC downgrade** | If member's KYC is downgraded after order confirmation, existing confirmed/filled orders are NOT affected. New redemption attempts are blocked. |

### 28.2 Member Status Checks

| Member Status | Redemption Allowed?                                        |
| ------------- | ---------------------------------------------------------- |
| ACTIVE        | ✅                                                         |
| SUSPENDED     | ❌ (existing confirmed orders continue through fulfilment) |
| CLOSED        | ❌ (pending refunds are processed; no new orders)          |
| PENDING_KYC   | ❌                                                         |

### 28.3 Eligibility at Confirm Time

The following eligibility checks are performed atomically at confirm time:

| Check                                         | Rejection Code                                              |
| --------------------------------------------- | ----------------------------------------------------------- |
| Member exists and is ACTIVE                   | `REDEMPTION_MEMBER_NOT_ACTIVE`                              |
| KYC Level 2 completed (if OD-15 Option B)     | `REDEMPTION_KYC_LEVEL_2_REQUIRED`                           |
| Member not SUSPENDED or CLOSED                | `REDEMPTION_MEMBER_SUSPENDED` or `REDEMPTION_MEMBER_CLOSED` |
| Item is active in current market's catalog    | `REDEMPTION_ITEM_NOT_ACTIVE`                                |
| Item effective_from <= now <= effective_until | `REDEMPTION_ITEM_NOT_AVAILABLE`                             |
| Inventory sufficient (for TRACKED items)      | `REDEMPTION_INVENTORY_INSUFFICIENT`                         |
| Wallet balance >= total point cost            | `REDEMPTION_BALANCE_INSUFFICIENT`                           |
| Daily/monthly limit not exceeded              | `REDEMPTION_LIMIT_EXCEEDED`                                 |
| Quote is valid (not expired, version matches) | `REDEMPTION_QUOTE_EXPIRED` or `REDEMPTION_QUOTE_STALE`      |

---

## 29. Limits

### 29.1 Limits

**BRYAN DECISION (OD-19): NO_DAILY_OR_MONTHLY_REDEMPTION_LIMIT**

No daily limit, monthly limit, or limit counter. API rate limiting, quantity constraints, inventory constraints, and fraud monitoring are retained.

### 29.2 Limit Reset

Not applicable. No daily/monthly limit counters.

### 29.3 Limits

Not applicable — limits not implemented in MVP (OD-19).---

## 30. Admin Operations

### 30.1 Catalog Management

| Operation              | Description                     | Maker/Checker Needed? |
| ---------------------- | ------------------------------- | --------------------- |
| Create catalog item    | Add new item to market catalog  | No (OD-18 PENDING)    |
| Update item details    | Change name, description, image | No                    |
| Update item point cost | Change point cost (new version) | No                    |
| Enable/disable item    | Toggle `is_active`              | No                    |
| Delete item (soft)     | Set effective_until to past     | No                    |

### 30.2 Rate Management

| Operation               | Description                            | Maker/Checker Needed? |
| ----------------------- | -------------------------------------- | --------------------- |
| Create new rate version | Add new rate with effective_from       | No                    |
| Supersede rate          | End current rate and activate new rate | No                    |
| Cancel pending rate     | Remove a rate that hasn't taken effect | No                    |

### 30.3 Inventory Management

| Operation                 | Description                      | Maker/Checker Needed? |
| ------------------------- | -------------------------------- | --------------------- |
| Adjust inventory          | Increase/decrease total_quantity | OD-18 PENDING         |
| Force release reservation | Release a stuck reservation      | No                    |
| Override available        | Directly set available count     | OD-18 PENDING         |

### 30.4 Order Administration

| Operation                | Description                                                                     |
| ------------------------ | ------------------------------------------------------------------------------- |
| View all orders          | Admin sees all orders across all members (with privacy projection — Section 38) |
| Cancel order             | Admin can cancel any order in eligible states                                   |
| Trigger refund           | Admin can initiate refund for confirmed orders                                  |
| Update fulfilment status | Admin can manually update fulfilment tracking                                   |
| Force fulfil             | Admin can mark a digital item as fulfilled                                      |

### 30.5 Rate Effective Time Administration

Rate changes follow the same pattern as Phase 3 reward rule versions:

1. Admin creates a new rate version with `effective_from` set to a future time
2. The rate becomes effective automatically at `effective_from`
3. Historical rate versions remain for audit
4. Only one ACTIVE rate per market at any time

---

## 31. Maker / Checker Boundary

### 31.1 Current Rule (inherited from D-005 / Admin PRD)

**LOCKED (Admin PRD D-05):** Maker/Checker is mandatory only for:

1. **Manual MCP adjustments** (Phase 1)
2. **Manual iPoint wallet adjustments** (Phase 7)

### 31.2 Phase 6 Consideration

| Operation                    | Maker/Checker Needed?              | OD Reference |
| ---------------------------- | ---------------------------------- | ------------ |
| Refund (admin-initiated)     | OD-17 PENDING                      | OD-17        |
| Inventory adjustment         | OD-18 PENDING                      | OD-18        |
| Catalog item creation/update | Not recommended (low risk)         | —            |
| Rate change                  | Not recommended (prospective only) | —            |
| Manual order modification    | Not recommended                    | —            |

---

## 32. Idempotency

### 32.1 Idempotency Patterns

Inheriting the domain-specific idempotency pattern from Phase 3/4.

| Operation                  | Idempotency Key                            | Guarantee                              |
| -------------------------- | ------------------------------------------ | -------------------------------------- |
| Quote generation           | `quote:{member_id}:{item_id}:{quantity}`   | Same quote returned for same params    |
| Point reservation (FLOW B) | `reserve:{member_id}:{item_id}:{quote_id}` | One active reservation per member-item |
| Order confirmation         | `confirm:{quote_id}`                       | One confirmed order per quote          |
| Refund                     | `refund:{order_id}:{admin_id}`             | One refund per order (full)            |
| Cancellation               | `cancel:{order_id}`                        | One cancellation per order             |
| Inventory adjustment       | `inventory:{item_id}:{timestamp}`          | One inventory change per operation     |

### 32.2 Idempotency Mismatch Rule

**FROZEN rule:**

| Scenario                                 | Outcome                                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Same idempotency key + same payload      | Return exact original result (idempotent replay)                                                                            |
| Same idempotency key + different payload | **REJECT** with `REDEMPTION_IDEMPOTENCY_MISMATCH` (HTTP 409). No wallet mutation. No inventory mutation. No order mutation. |

This is a hard rule — no CONFIGURABLE escape. Idempotency is a security and correctness invariant.

### 32.3 Implementation Approach

- Domain-specific UNIQUE constraints on business tables (following Phase 3 pattern — Phase 3 chose Option A: business-table-level UNIQUE constraints only)
- No separate centralized idempotency table required for Phase 6
- UNIQUE constraints:

| Table                     | Constraints                                                         |
| ------------------------- | ------------------------------------------------------------------- |
| `redemption_reservations` | `UNIQUE(member_id, item_id)` where status = 'ACTIVE'                |
| `redemption_orders`       | `UNIQUE(quote_id)` — one order per successful quote                 |
| `member_wallet_entries`   | `UNIQUE(account_id, idempotency_key)` — existing Phase 3 constraint |

---

## 33. Concurrency

### 33.1 Race Conditions

| Race                         | Scenario                                              | Prevention                                                                     |
| ---------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Wallet Balance Race**      | Two concurrent confirm attempts from the same wallet  | Lock wallet account before balance check                                       |
| **Inventory Oversell**       | Two concurrent confirm attempts for the same item     | Lock inventory record before decrement                                         |
| **Duplicate Confirm**        | Same quote confirmed twice                            | UNIQUE constraint on `redemption_orders(quote_id)`                             |
| **Duplicate Cancellation**   | Same order cancelled twice                            | Idempotency on `cancel:{order_id}`                                             |
| **Duplicate Refund**         | Same order refunded twice                             | UNIQUE constraint on wallet `reversal_of` + `entry_type` = 'REDEMPTION_REFUND' |
| **Reservation Expiry Race**  | Reservation expires while confirm is in progress      | Use `expires_at` + advisory lock; confirm checks expiry within the transaction |
| **Admin Manual Action Race** | Admin modifies inventory while confirm is in progress | Optimistic locking on `redemption_inventory.version`                           |

### 33.2 Concurrent Confirm Mitigation

For the critical race between concurrent redemption confirmations (wallet + inventory), the following locking discipline applies:

```
BEGIN TRANSACTION
  -- 3-second lock_timeout (NOT NOWAIT)
  SET lock_timeout = '3s';

  -- Acquire locks in canonical order (Section 34)
  1. Acquire canonical operation advisory lock (idempotency guard)
  2. Acquire wallet advisory lock
  3. Acquire inventory row lock
  4. Read wallet balance (within lock)
  5. Enforce non-negative balance
  6. Read inventory available (within lock)
  7. Enforce sufficient inventory
  8. Insert wallet entry
  9. Update wallet account projection
  10. Update inventory (version check)
  11. Insert/update redemption order
  12. Update limits
  13. Insert audit log
COMMIT
(On any failure → ROLLBACK)
```

**Lock timeout behavior:** If any lock cannot be acquired within 3 seconds, the entire transaction rolls back and returns `REDEMPTION_LOCK_TIMEOUT`. The caller should retry with exponential backoff.

---

## 34. Lock Ordering

**PROPOSED — REQUIRES P6-S1 IMPLEMENTATION VALIDATION.** The following lock order is a candidate that must be validated against the actual Phase 3 wallet lock ordering in a read-only audit during P6-S1.

### 34.1 Proposed Canonical Lock Order

```
1. Canonical Operation / Idempotency Advisory Lock
   (pre-validates idempotency before any resource lock)
2. Redemption Order or Quote Row Lock
   (if order exists; protects state transition)
3. Wallet Account Advisory Lock
   (guards balance check and debit — same resource as Phase 3 wallet operations)
4. Inventory Record Row Lock
   (guards oversell prevention; version check)
5. Member Limit Record Row Lock
   (guards daily/monthly limit increment)
6. Wallet Ledger Insert
   (INSERT with UNIQUE constraint — no explicit lock needed)
7. Order / Inventory Projection Update
8. Audit Insert
   (no lock required)
```

### 34.2 Lock Timeout

- **3-second `lock_timeout`** (NOT `NOWAIT`).
- If any lock cannot be acquired within 3 seconds, the entire transaction rolls back with `REDEMPTION_LOCK_TIMEOUT`.
- The caller must retry with exponential backoff (not spin-retry).
- 3-second timeout matches Phase 4's existing `lock_timeout` setting for consistency.

### 34.3 Phase 3 Compatibility — READ-ONLY AUDIT REQUIRED

Phase 3 existing lock ordering (from P3-S1) for wallet operations:

```
Phase 3 Lock Order:
1. Reward Plan
2. Wallet Account (advisory lock)
3. Wallet Ledger
4. Reward Daily Accrual
```

**Both Phase 3 and Phase 6 acquire the wallet advisory lock on `wallet_account.id`.** This is the shared resource. A read-only code audit is required during P6-S1 to:

1. Verify the exact Phase 3 wallet lock acquisition point (function name, lock type, duration).
2. Confirm that Phase 6 and Phase 3 never hold conflicting locks when acquiring the wallet lock.
3. Confirm that `lock_timeout = '3s'` applies to both paths.
4. Confirm that concurrent Phase 3 reward accrual and Phase 6 redemption confirmation do not deadlock.

**This lock order is PROPOSED, not frozen.** It must be validated against actual Phase 3 wallet code during P6-S1 implementation.

### 34.4 Phase 4 / Phase 5 Compatibility

Phase 4 lock ordering (transaction confirm):

1. Transaction ID lock
2. MCP Account
3. MCP Ledger
4. Commission processing

Phase 5 lock ordering (commission calculation):

1. Commission Rate Version
2. Commission Ledger
3. Agent Activation Status

Phase 6 locks **iPoint wallet account** (`member_wallet_accounts`). Phase 4/5 lock **MCP account** (`mcp_ledger_*`) and **commission resources**. These are different database resource domains — no deadlock risk between Phase 6 and Phase 4/5.

---

## 35. Atomic Transaction Boundary — Two Candidates

### 35.1 FLOW A — Direct Debit Confirm Boundary

```
BEGIN TRANSACTION
  SET lock_timeout = '3s';
  ├── (A) Acquire canonical operation advisory lock (idempotency guard)
  ├── (B) Acquire wallet advisory lock (pg_advisory_xact_lock)
  ├── (C) Acquire inventory row lock (SELECT ... FOR NO KEY UPDATE)
  ├── (1) Check member eligibility (status, KYC, not suspended)
  ├── (2) Check item availability (active, effective range)
  ├── (3) Check inventory sufficiency (within inventory lock)
  ├── (4) Enforce wallet balance >= total point cost (within wallet lock)
  ├── (5) Check daily/monthly limit not exceeded
  ├── (6) Validate quote (not expired, item version matches)
  ├── (7) INSERT wallet entry (entry_type='REDEMPTION_DEBIT', amount=-total_points)
  ├── (8) UPDATE member_wallet_accounts SET balance = balance - total_points
  ├── (9) UPDATE redemption_inventory (decrement version check)
  ├── (10) INSERT/UPDATE redemption_order (state=CONFIRMED)
  ├── (11) UPDATE limit counters
  ├── (12) INSERT audit log entry
COMMIT
```

**Failure handling:** If any step (7-12) fails after eligibility checks pass, the entire transaction ROLLBACKs. No partial state. No phantom balance reduction. No phantom inventory consumption.

### 35.2 FLOW B — Reservation Confirm Boundary

```
-- RESERVATION step
BEGIN TRANSACTION
  SET lock_timeout = '3s';
  ├── Acquire wallet advisory lock
  ├── Enforce available-to-spend >= total_point_cost
  ├── INSERT redemption_reservations (status='ACTIVE')
  ├── INSERT redemption_order (state='RESERVED')
  └── COMMIT

-- CONFIRM step
BEGIN TRANSACTION
  SET lock_timeout = '3s';
  ├── Acquire canonical operation advisory lock
  ├── Acquire wallet advisory lock
  ├── Acquire inventory row lock
  ├── Validate reservation still ACTIVE
  ├── Enforce wallet balance >= total_point_cost
  ├── Check inventory sufficiency
  ├── INSERT wallet entry (entry_type='REDEMPTION_DEBIT')
  ├── UPDATE member_wallet_accounts balance
  ├── UPDATE redemption_inventory (decrement)
  ├── UPDATE redemption_order: RESERVED → CONFIRMED
  ├── UPDATE redemption_reservations: ACTIVE → CONFIRMED
  ├── UPDATE limit counters
  ├── INSERT audit log entry
  └── COMMIT
```

### 35.3 Refund Boundary

```
BEGIN TRANSACTION
  SET lock_timeout = '3s';
  ├── (A) Validate refund request (order exists, not already refunded)
  ├── (B) Acquire wallet advisory lock
  ├── (C) INSERT wallet entry (entry_type='REDEMPTION_REFUND', amount=+refund_amount, reversal_of=original_entry_id)
  ├── (D) UPDATE member_wallet_accounts balance
  ├── (E) UPDATE order status: REFUND_PENDING → REFUNDED
  ├── (F) IF refund fails → order stays REFUND_PENDING (admin review)
  ├── (G) INSERT audit log entry
COMMIT
```

├── (E) Restore inventory (if applicable)
├── (F) Insert audit log entry
COMMIT

```

### 35.3 Cancellation Boundary

```

BEGIN TRANSACTION
├── (A) Validate cancellation request
├── (B) IF points already debited:
│ ├── Create refund wallet entry
│ └── Update wallet account balance
├── (C) IF points reserved (not yet debited):
│ └── Release reservation (no wallet entry needed)
├── (D) Restore inventory (if previously reserved/decremented)
├── (E) Update order status (CANCELLED)
├── (F) Insert audit log entry
COMMIT

````

---

## 36. Immutable Ledger

### 36.1 Inherited Immutability

**LOCKED (Phase 3):** All wallet entries in `member_wallet_entries` are **append-only and immutable**.

For Phase 6 Redemption Center:

| Wallet Entry Type | Operation | Mutates Existing Entry? | Creates New Entry? |
|---|---|---|---|
| `REDEMPTION_DEBIT` | Confirm redemption | No | Yes |
| `REDEMPTION_REFUND` | Refund points | No | Yes (with `reversal_of`) |

### 36.2 Entry Integrity

Each wallet entry created by the Redemption Center must include:

| Field | Value for REDEMPTION_DEBIT | Value for REDEMPTION_REFUND |
|---|---|---|
| `entry_type` | `'REDEMPTION_DEBIT'` | `'REDEMPTION_REFUND'` |
| `amount` | `-total_point_cost` | `+total_point_cost` (full) or `+refund_amount` (partial) |
| `balance_before` | Current balance before debit | Current balance before refund |
| `balance_after` | New balance after debit | New balance after refund |
| `idempotency_key` | `redemption:confirm:{order_id}` | `redemption:refund:{order_id}` |
| `reversal_of` | `NULL` | Original `REDEMPTION_DEBIT` entry ID |
| `correlation_id` | Redemption Order ID | Refund Order ID |
| `reason` | `NULL` or note | Refund reason code |

---

## 37. Audit

### 37.1 Audit Requirements

Every mutation in the Redemption Center must be auditable:

| Event | Audit Fields |
|---|---|
| Quote generated | member_id, item_id, quantity, rate_version, point_cost, quote_id, timestamp |
| Order confirmed | order_id, member_id, item_id, quantity, total_points, rate_snapshot, wallet_entry_id |
| Order cancelled | order_id, reason, admin_id (if applicable), wallet_refund_entry_id (if applicable) |
| Order refunded | order_id, refund_amount, wallet_refund_entry_id, original_debit_entry_id |
| Fulfilment updated | order_id, fulfilment_id, new_status, admin_id, tracking info |
| Catalog item created/modified | admin_id, item_id, changed_fields, old_values, new_values |
| Rate version created | admin_id, market_id, rate_value, effective_from, effective_until |

### 37.2 Audit Log Integration

Reuse the existing `audit_logs` table from Phase 0/2 with:
- `entity_type` = `'REDEMPTION_ORDER'`, `'CATALOG_ITEM'`, `'REDEMPTION_RATE'`, etc.
- `entity_id` = the specific record UUID
- `action` = `'QUOTE_GENERATED'`, `'ORDER_CONFIRMED'`, `'ORDER_CANCELLED'`, `'ORDER_REFUNDED'`, `'FULFILMENT_UPDATED'`, `'ITEM_CREATED'`, `'ITEM_UPDATED'`, `'RATE_CREATED'`
- `actor_id` = member_id, admin_id, or system
- `metadata` = JSONB with relevant context (order details, snapshot reference, reason)
- `correlation_id` = request trace ID

---

## 38. Privacy

### 38.1 Privacy Projections

Following Phase 2/3 privacy patterns:

| Data | Member View | Admin View |
|---|---|---|
| Own orders | Full details | Full details |
| Other members' orders | Not visible | Visible, but with masking |
| Member personal details (own) | Full | Masked (name, phone partially shown) |
| Voucher codes (own) | Full code displayed — only for own fulfilled orders | Masked by default; full reveal requires dedicated permission + audit event |
| Voucher codes (other) | Not visible | Masked by default |
| Shipping address (own) | Full | Full (operational need) |
| Shipping address (other) | Not visible | Full (operational need) |

### 38.2 Data Retention

- Redemption orders are never physically deleted
- Cancelled/refunded orders are retained for audit and reconciliation
- Voucher codes may have an expiry date (OD-09) but the order record remains

---

## 39. Fraud Controls

### 39.1 Fraud Detection Rules

| Rule | Description |
|---|---|
| **Rate limit quoting** | Max N quote requests per minute per member (CONFIGURABLE) |
| **Rate limit confirming** | Max N confirm requests per minute per member (CONFIGURABLE) |
| **High-value review** | Orders above threshold require admin review (OD-16 PENDING) |
| **Suspicious pattern detection** | Rapid successive cancellations + re-orders by same member flagged for review |
| **Inventory manipulation** | Repeated changes to inventory by same admin flagged |
| **Rate manipulation** | Rate changes immediately before large redemption orders flagged |

### 39.2 Rate Change Safeguard

If a rate changes immediately before a large redemption (e.g., rate increased by 10% then a 100,000-point redemption):
- The admin should not be able to front-run their own rate change
- Recommendation: Rate changes with a holding period (e.g., 24 hours before effective) for significant rate adjustments

---

## 40. Proposed Database Schema

### 40.1 New Tables

#### `redemption_catalog_items`

```sql
CREATE TABLE redemption_catalog_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id       UUID NOT NULL REFERENCES markets(id),
  sku             VARCHAR(64),
  name            VARCHAR(256) NOT NULL,
  description     TEXT,
  item_type       VARCHAR(32) NOT NULL CHECK (item_type IN ('PHYSICAL', 'DIGITAL_VOUCHER', 'SERVICE')),
  ownership       VARCHAR(32) NOT NULL CHECK (ownership IN ('PLATFORM_OWNED', 'MERCHANT_OWNED')),
  merchant_id     UUID REFERENCES merchants(id),
  point_cost      NUMERIC(38,10) NOT NULL,
  fiat_reference_value NUMERIC(38,10),
  currency        VARCHAR(3),
  inventory_mode  VARCHAR(32) NOT NULL CHECK (inventory_mode IN ('UNLIMITED', 'TRACKED', 'ON_DEMAND')),
  image_url       TEXT,
  terms           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  is_featured     BOOLEAN NOT NULL DEFAULT false,
  tags            TEXT[],
  effective_from  TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  created_by      UUID NOT NULL REFERENCES admin_users(id),
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
````

#### `redemption_inventory`

```sql
CREATE TABLE redemption_inventory (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id            UUID NOT NULL UNIQUE REFERENCES redemption_catalog_items(id),
  total_quantity     NUMERIC(38,0),
  reserved_quantity  NUMERIC(38,0) NOT NULL DEFAULT 0,
  fulfilled_quantity NUMERIC(38,0) NOT NULL DEFAULT 0,
  version            INTEGER NOT NULL DEFAULT 1,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_unlimited_null_total CHECK (
    (total_quantity IS NULL AND reserved_quantity = 0 AND fulfilled_quantity = 0)
    OR
    (total_quantity IS NOT NULL)
  )
);
```

#### `redemption_rate_versions`

```sql
CREATE TABLE redemption_rate_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id       UUID NOT NULL REFERENCES markets(id),
  rate            NUMERIC(38,10) NOT NULL,
  fiat_currency   VARCHAR(3) NOT NULL,
  effective_from  TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  -- No status column. Effective range constraint (EXCLUDE USING gist)
  -- guarantees non-overlapping (market_id, effective_range).
  created_by      UUID NOT NULL REFERENCES admin_users(id),
  approved_by     UUID REFERENCES admin_users(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### `redemption_reservations`

NOT APPLICABLE. Point reservation is not used in MVP (OD-05). This table is not implemented.

#### `redemption_orders`

```sql
CREATE TABLE redemption_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number    VARCHAR(64) NOT NULL,
  member_id       UUID NOT NULL REFERENCES members(id),
  market_id       UUID NOT NULL REFERENCES markets(id),
  item_id         UUID NOT NULL REFERENCES redemption_catalog_items(id),
  quantity        NUMERIC(38,0) NOT NULL,
  total_point_cost NUMERIC(38,10) NOT NULL,
  rate_version_id UUID NOT NULL REFERENCES redemption_rate_versions(id),
  snapshot        JSONB NOT NULL,
  status          VARCHAR(32) NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'QUOTED', 'RESERVED', 'CONFIRMED',
                                      'PROCESSING', 'FULFILLED', 'CANCELLED',
                                      'FAILED', 'REFUND_PENDING', 'REFUNDED')),
  quote_id        UUID,
  reservation_id  UUID REFERENCES redemption_reservations(id),
  wallet_entry_id UUID REFERENCES member_wallet_entries(id),
  refund_wallet_entry_id UUID REFERENCES member_wallet_entries(id),
  cancelled_at    TIMESTAMPTZ,
  cancelled_by    UUID REFERENCES members(id),
  cancel_reason   TEXT,
  refunded_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### `redemption_fulfilments`

```sql
CREATE TABLE redemption_fulfilments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              UUID NOT NULL UNIQUE REFERENCES redemption_orders(id),
  fulfilment_type       VARCHAR(16) NOT NULL
                          CHECK (fulfilment_type IN ('PHYSICAL', 'DIGITAL', 'SERVICE')),
  status                VARCHAR(16) NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
  shipping_address      JSONB,
  tracking_number       VARCHAR(128),
  courier               VARCHAR(64),
  estimated_delivery_date DATE,
  digital_value         TEXT,
  service_scheduled_at  TIMESTAMPTZ,
  service_notes         TEXT,
  fulfilled_at          TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  failure_reason        TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### `redemption_fulfilment_exceptions`

```sql
CREATE TABLE redemption_member_limits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id        UUID NOT NULL REFERENCES members(id),
  market_id        UUID NOT NULL REFERENCES markets(id),
  local_date       DATE NOT NULL,
  period_type      VARCHAR(8) NOT NULL CHECK (period_type IN ('DAILY', 'MONTHLY')),
  total_points_used NUMERIC(38,10) NOT NULL DEFAULT 0,
  order_count      NUMERIC(38,0) NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 40.2 Wallet Entry Type Extension

To the existing `member_wallet_entries` table, add two new `entry_type` values:

```sql
-- No schema change needed if CHECK constraint uses IN list that can be extended
-- ALTER TABLE member_wallet_entries DROP CONSTRAINT ...
-- ALTER TABLE member_wallet_entries ADD CONSTRAINT ... CHECK (entry_type IN (
--   'REWARD_ACCRUAL', 'REVERSAL', 'CORRECTION', 'ADJUSTMENT',
--   'REDEMPTION_DEBIT', 'REDEMPTION_REFUND'
-- ))
```

---

## 41. Constraints and Indexes

### 41.1 Unique Constraints

| Table                      | Constraint                                        | Purpose                         |
| -------------------------- | ------------------------------------------------- | ------------------------------- |
| `redemption_catalog_items` | `(market_id, sku)` — unique where non-null        | SKU uniqueness per market       |
| `redemption_inventory`     | `(item_id)` — unique                              | One inventory record per item   |
| `redemption_rate_versions` | `(market_id)` where status = 'ACTIVE'             | Only one active rate per market |
| `redemption_reservations`  | NOT APPLICABLE for MVP                            | Reservation not used            |
| `redemption_orders`        | `(order_number)`                                  | Unique order number             |
| `redemption_orders`        | `(quote_id)` — unique where non-null              | One order per confirmed quote   |
| `redemption_member_limits` | `(member_id, market_id, local_date, period_type)` | One limit record per period     |

### 41.2 Index Strategy

| Table                      | Index                                 | Type                         | Purpose                     |
| -------------------------- | ------------------------------------- | ---------------------------- | --------------------------- |
| `redemption_catalog_items` | `(market_id, is_active)`              | B-tree                       | Catalog browsing by market  |
| `redemption_catalog_items` | `(merchant_id)`                       | B-tree                       | Merchant-owned items lookup |
| `redemption_catalog_items` | `(tags)`                              | GIN                          | Tag-based search            |
| `redemption_orders`        | `(member_id, created_at)`             | B-tree                       | Member order history        |
| `redemption_orders`        | `(status)`                            | Partial (where not terminal) | Active orders by status     |
| `redemption_orders`        | `(item_id, created_at)`               | B-tree                       | Item popularity analysis    |
| `redemption_reservations`  | NOT APPLICABLE for MVP                | Reservation not used         |
| `redemption_fulfilments`   | `(status)`                            | B-tree                       | Pending fulfilment queue    |
| `redemption_member_limits` | `(member_id, market_id, period_type)` | B-tree                       | Limit check queries         |
| `redemption_rate_versions` | `(market_id, effective_from)`         | B-tree                       | Rate version lookup         |

---

## 42. Proposed APIs

### 42.1 Member APIs

| Method | Endpoint                                              | Description                                                         |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------------- |
| `GET`  | `/api/v1/redemption/catalog`                          | Browse active catalog for current market (filterable by type, tags) |
| `GET`  | `/api/v1/redemption/catalog/:itemId`                  | Get item details                                                    |
| `GET`  | `/api/v1/redemption/catalog/:itemId/quote?quantity=N` | Generate quote for item                                             |
| `POST` | `/api/v1/redemption/orders`                           | Create redemption order (confirm after quote)                       |
| `GET`  | `/api/v1/redemption/orders`                           | List member's redemption orders (paginated)                         |
| `GET`  | `/api/v1/redemption/orders/:orderId`                  | Get order details                                                   |
| `POST` | `/api/v1/redemption/orders/:orderId/cancel`           | Cancel an order (if eligible)                                       |
| `GET`  | `/api/v1/redemption/orders/:orderId/fulfilment`       | Get fulfilment status                                               |

### 42.2 Admin APIs

| Method   | Endpoint                                              | Description                            |
| -------- | ----------------------------------------------------- | -------------------------------------- |
| `GET`    | `/api/v1/admin/redemption/catalog`                    | List all catalog items (admin view)    |
| `POST`   | `/api/v1/admin/redemption/catalog`                    | Create catalog item                    |
| `PUT`    | `/api/v1/admin/redemption/catalog/:itemId`            | Update catalog item                    |
| `DELETE` | `/api/v1/admin/redemption/catalog/:itemId`            | Soft-delete catalog item               |
| `GET`    | `/api/v1/admin/redemption/catalog/:itemId/inventory`  | Get inventory details                  |
| `PUT`    | `/api/v1/admin/redemption/catalog/:itemId/inventory`  | Adjust inventory                       |
| `GET`    | `/api/v1/admin/redemption/rates`                      | List rate versions                     |
| `POST`   | `/api/v1/admin/redemption/rates`                      | Create new rate version                |
| `GET`    | `/api/v1/admin/redemption/orders`                     | List all orders (admin view, filtered) |
| `GET`    | `/api/v1/admin/redemption/orders/:orderId`            | Get order detail                       |
| `POST`   | `/api/v1/admin/redemption/orders/:orderId/cancel`     | Admin cancel order                     |
| `POST`   | `/api/v1/admin/redemption/orders/:orderId/refund`     | Admin trigger refund                   |
| `PUT`    | `/api/v1/admin/redemption/orders/:orderId/fulfilment` | Update fulfilment status               |
| `GET`    | `/api/v1/admin/redemption/members/:memberId/limits`   | View member's limits                   |
| `PUT`    | `/api/v1/admin/redemption/members/:memberId/limits`   | Override member limits                 |

---

## 43. Error Codes

| HTTP Status | Code                                    | Description                                            |
| ----------- | --------------------------------------- | ------------------------------------------------------ |
| 400         | `REDEMPTION_INVALID_QUANTITY`           | Quantity must be > 0                                   |
| 400         | `REDEMPTION_INVALID_ITEM_TYPE`          | Item type not supported for this operation             |
| 400         | `REDEMPTION_QUOTE_EXPIRED`              | Quote has expired; regenerate                          |
| 400         | `REDEMPTION_QUOTE_STALE`                | Item version changed since quote; regenerate           |
| 400         | `REDEMPTION_ORDER_NOT_CANCELLABLE`      | Order is not in a cancellable state                    |
| 400         | `REDEMPTION_ORDER_NOT_REFUNDABLE`       | Order is not eligible for refund                       |
| 400         | `REDEMPTION_ALREADY_CANCELLED`          | Order is already cancelled                             |
| 400         | `REDEMPTION_ALREADY_REFUNDED`           | Order is already refunded                              |
| 401         | `REDEMPTION_AUTH_REQUIRED`              | Authentication required                                |
| 403         | `REDEMPTION_MARKET_ACCESS_DENIED`       | Member does not have access to this market's catalog   |
| 403         | `REDEMPTION_KYC_LEVEL_2_REQUIRED`       | Member must complete KYC Level 2 before redemption     |
| 403         | `REDEMPTION_MEMBER_NOT_ACTIVE`          | Member account is not ACTIVE                           |
| 403         | `REDEMPTION_MEMBER_SUSPENDED`           | Member account is SUSPENDED                            |
| 403         | `REDEMPTION_MEMBER_CLOSED`              | Member account is CLOSED                               |
| 404         | `REDEMPTION_ITEM_NOT_FOUND`             | Catalog item not found                                 |
| 404         | `REDEMPTION_ORDER_NOT_FOUND`            | Redemption order not found                             |
| 404         | `REDEMPTION_RATE_NOT_FOUND`             | Active redemption rate not found for market            |
| 409         | `REDEMPTION_INVENTORY_INSUFFICIENT`     | Not enough inventory available                         |
| 409         | `REDEMPTION_BALANCE_INSUFFICIENT`       | Insufficient iPoint balance                            |
| 409         | `REDEMPTION_LIMIT_EXCEEDED`             | Daily or monthly redemption limit exceeded             |
| 409         | `REDEMPTION_INVENTORY_VERSION_CONFLICT` | Inventory was modified by another operation; retry     |
| 409         | `REDEMPTION_RESERVATION_CONFLICT`       | Only one active reservation per item allowed           |
| 409         | `REDEMPTION_DUPLICATE_ORDER`            | Order for this quote already exists                    |
| 409         | `REDEMPTION_LOCK_TIMEOUT`               | Could not acquire lock within 3-second timeout         |
| 409         | `REDEMPTION_IDEMPOTENCY_MISMATCH`       | Same idempotency key with different payload — rejected |
| 422         | `REDEMPTION_ITEM_NOT_ACTIVE`            | Item is not currently active in catalog                |
| 422         | `REDEMPTION_ITEM_NOT_AVAILABLE`         | Item is outside its effective date range               |
| 422         | `REDEMPTION_ITEM_DISABLED`              | Item has been disabled by admin                        |
| 500         | `REDEMPTION_INTERNAL_ERROR`             | Unexpected internal error                              |
| 503         | `REDEMPTION_SERVICE_UNAVAILABLE`        | Redemption service temporarily unavailable             |

---

## 44. Acceptance Test Matrix

### 44.1 Catalog Visibility

| #    | Test                                              | Expected                             |
| ---- | ------------------------------------------------- | ------------------------------------ |
| T-01 | Member in Market MY sees MY catalog only          | Items from other markets NOT visible |
| T-02 | Disabled catalog item not visible to members      | Item hidden from catalog             |
| T-03 | Expired item (effective_until passed) not visible | Item hidden from catalog             |
| T-04 | Featured items appear with featured indicator     | UI shows featured items              |

### 44.2 Market Isolation

| #    | Test                                           | Expected                               |
| ---- | ---------------------------------------------- | -------------------------------------- |
| T-05 | Member cannot browse SG catalog from MY market | Access denied                          |
| T-06 | Admin can browse all market catalogs           | Admin sees all markets' items          |
| T-07 | Each market has independent rate configuration | SG rate change does not affect MY rate |

### 44.3 Rate Snapshot

| #    | Test                                                       | Expected                                                                         |
| ---- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| T-08 | Rate snapshot is stored in order record                    | `order.snapshot.rate_value` matches rate at confirm time                         |
| T-09 | Rate change after confirm does NOT affect historical order | Historical order retains original rate                                           |
| T-10 | Rate change before confirm affects new confirm only        | New confirms use new rate; old quotes using old rate show REDEMPTION_QUOTE_STALE |

### 44.4 Quote Expiry

| #    | Test                                                     | Expected                         |
| ---- | -------------------------------------------------------- | -------------------------------- |
| T-11 | Confirm with valid quote succeeds                        | Order created successfully       |
| T-12 | Confirm with expired quote rejected                      | `REDEMPTION_QUOTE_EXPIRED` error |
| T-13 | Confirm with stale quote (item version changed) rejected | `REDEMPTION_QUOTE_STALE` error   |

### 44.5 Successful Redemption

| #    | Test                                               | Expected                                                  |
| ---- | -------------------------------------------------- | --------------------------------------------------------- |
| T-14 | Member with sufficient balance confirms redemption | Order CONFIRMED, wallet debited, inventory decremented    |
| T-15 | Order creates correct wallet entry                 | `entry_type = 'REDEMPTION_DEBIT'`, amount = -total_points |

### 44.6 Insufficient Balance

| #    | Test                                            | Expected                                       |
| ---- | ----------------------------------------------- | ---------------------------------------------- |
| T-16 | Member with insufficient balance cannot confirm | `REDEMPTION_BALANCE_INSUFFICIENT` error        |
| T-17 | No partial state left on rejection              | No wallet entry, no inventory change, no order |

### 44.7 Concurrent Redemption

| #    | Test                                                    | Expected                                    |
| ---- | ------------------------------------------------------- | ------------------------------------------- |
| T-18 | Two concurrent confirm attempts for same wallet/balance | Only one succeeds; second fails             |
| T-19 | Two concurrent confirm attempts for same inventory item | Only one decrements inventory; second fails |

### 44.8 Inventory Oversell Prevention

| #    | Test                                                  | Expected                                                         |
| ---- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| T-20 | Confirm when inventory = 1 with 2 concurrent requests | One succeeds, one fails with `REDEMPTION_INVENTORY_INSUFFICIENT` |
| T-21 | Confirm after inventory reaches 0                     | `REDEMPTION_INVENTORY_INSUFFICIENT` error                        |

### 44.9 Idempotent Confirm Replay

| #    | Test                                                      | Expected                                       |
| ---- | --------------------------------------------------------- | ---------------------------------------------- |
| T-22 | Same confirm request sent twice                           | Same order returned; no duplicate wallet entry |
| T-23 | Same confirm with idempotency key returns original result | Consistent response                            |

### 44.10 Idempotency Mismatch (FROZEN)

| #    | Test                                    | Expected                                                                                                    |
| ---- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| T-24 | Same idempotency key, different payload | `REDEMPTION_IDEMPOTENCY_MISMATCH` (HTTP 409). No wallet mutation. No inventory mutation. No order mutation. |

### 44.11 Cancellation

| #    | Test                             | Expected                                             |
| ---- | -------------------------------- | ---------------------------------------------------- |
| T-25 | Cancel QUOTED order before debit | Order CANCELLED, no wallet effect                    |
| T-26 | Cancel CONFIRMED order           | Order CANCELLED, wallet refunded, inventory restored |
| T-27 | Cancel already-cancelled order   | `REDEMPTION_ALREADY_CANCELLED` error                 |

### 44.12 Reservation Release

| #    | Test                                                          | Expected                     |
| ---- | ------------------------------------------------------------- | ---------------------------- |
| T-28 | Expired reservation releases points (conceptual for Option B) | Reservation status = EXPIRED |
| T-29 | Cancellation before debit releases reservation                | Inventory restored           |

### 44.13 Full Refund

| #    | Test                     | Expected                                                             |
| ---- | ------------------------ | -------------------------------------------------------------------- |
| T-30 | Refund CONFIRMED order   | Wallet receives `REDEMPTION_REFUND` entry with exact opposite amount |
| T-31 | Duplicate refund request | Returns existing refund; no duplicate entry                          |

### 44.14 Exact-opposite Refund

| #    | Test                                         | Expected                    |
| ---- | -------------------------------------------- | --------------------------- |
| T-32 | Refund amount = -(original debit amount)     | Amounts match exactly       |
| T-33 | `reversal_of` links to original wallet entry | FK points to original entry |

### 44.15 Original Debit Immutability

| #    | Test                                                    | Expected                                   |
| ---- | ------------------------------------------------------- | ------------------------------------------ |
| T-34 | After refund, original REDEMPTION_DEBIT entry unchanged | Entry is intact; refund is separate record |
| T-35 | Cannot modify or delete original debit entry            | DB constraint prevents mutation            |

### 44.16 Digital Fulfilment

| #    | Test                                    | Expected                                 |
| ---- | --------------------------------------- | ---------------------------------------- |
| T-36 | Digital item confirmed → auto-fulfilled | Order transitions CONFIRMED→FULFILLED    |
| T-37 | Voucher code generated and stored       | Fulfilment record contains digital_value |

### 44.17 Physical Fulfilment

| #    | Test                                 | Expected                                      |
| ---- | ------------------------------------ | --------------------------------------------- |
| T-38 | Physical item confirmed → PROCESSING | Fulfilment record created with PENDING status |
| T-39 | Admin marks as fulfilled → FULFILLED | Status updated, timestamp recorded            |

### 44.18 Failed Fulfilment

| #    | Test                               | Expected                                   |
| ---- | ---------------------------------- | ------------------------------------------ |
| T-40 | Fulfilment failure triggers refund | Order → FAILED → REFUND_PENDING → REFUNDED |
| T-41 | Points returned to wallet          | Wallet refund entry created                |

### 44.19 KYC Rejection

| #    | Test                                                           | Expected                          |
| ---- | -------------------------------------------------------------- | --------------------------------- |
| T-42 | Member without KYC Level 2 tries to browse (if OD-15 Option A) | `REDEMPTION_KYC_LEVEL_2_REQUIRED` |
| T-43 | Member without KYC Level 2 tries to confirm                    | `REDEMPTION_KYC_LEVEL_2_REQUIRED` |

### 44.20 Suspended Member

| #    | Test                                                    | Expected                      |
| ---- | ------------------------------------------------------- | ----------------------------- |
| T-44 | Suspended member tries to quote/confirm                 | `REDEMPTION_MEMBER_SUSPENDED` |
| T-45 | Existing confirmed order continues for suspended member | Fulfilment proceeds normally  |

### 44.21 Cross-market Rejection

| #    | Test                                      | Expected                          |
| ---- | ----------------------------------------- | --------------------------------- |
| T-46 | Member in MY tries to browse SG catalog   | Access denied                     |
| T-47 | Cross-market redemption (if not approved) | `REDEMPTION_MARKET_ACCESS_DENIED` |

### 44.22 Admin Rate Change

| #    | Test                                       | Expected                                 |
| ---- | ------------------------------------------ | ---------------------------------------- |
| T-48 | Admin creates new rate version             | Rate becomes effective at effective_from |
| T-49 | New confirm uses new rate                  | Point cost recalculated                  |
| T-50 | Historical order retains old rate snapshot | Snapshot unchanged                       |

### 44.23 Historical Order Stability

| #    | Test                                                 | Expected                             |
| ---- | ---------------------------------------------------- | ------------------------------------ |
| T-51 | Item point cost changed → existing orders unaffected | Snapshot retains original point cost |
| T-52 | Item deleted → existing orders still visible         | Order retains snapshot data          |

### 44.24 Concurrent Refund

| #    | Test                           | Expected                                      |
| ---- | ------------------------------ | --------------------------------------------- |
| T-53 | Two concurrent refund requests | One succeeds; second detects already refunded |

### 44.25 Atomic Rollback

| #    | Test                                                         | Expected                       |
| ---- | ------------------------------------------------------------ | ------------------------------ |
| T-54 | Confirm fails after wallet entry but before inventory update | Full rollback; wallet restored |
| T-55 | Confirm fails at any step                                    | No partial state visible       |

### 44.26 Audit Completeness

| #    | Test                                               | Expected                 |
| ---- | -------------------------------------------------- | ------------------------ |
| T-56 | Every order mutation has corresponding audit entry | Audit log complete       |
| T-57 | Audit links to redemption order and wallet entry   | Correlation chain intact |

### 44.27 Privacy Projection

| #    | Test                                              | Expected                    |
| ---- | ------------------------------------------------- | --------------------------- |
| T-58 | Member sees own full order details                | Full view                   |
| T-59 | Member cannot see another member's orders         | 403 or 404                  |
| T-60 | Admin sees masked personal data for other members | Name/phone partially masked |

### 44.28 Wallet Projection / Ledger Atomic Consistency

| #    | Test                                                          | Expected                                       |
| ---- | ------------------------------------------------------------- | ---------------------------------------------- |
| T-61 | Wallet ledger entry and projection update in same transaction | All-or-nothing: both succeed or both roll back |
| T-62 | Balance derived from SUM(ledger) matches projection           | `SUM(amount) = wallet_account.balance`         |

### 44.29 Negative Balance Prevention

| #    | Test                                                         | Expected                                                                |
| ---- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| T-63 | Confirm with insufficient balance (wallet lock held)         | `REDEMPTION_BALANCE_INSUFFICIENT`. No wallet mutation.                  |
| T-64 | Concurrent confirm attempts draining the same wallet to zero | Only one succeeds. Second fails with `REDEMPTION_BALANCE_INSUFFICIENT`. |

### 44.30 Refund Failure State

| #    | Test                               | Expected                                                                                   |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| T-65 | Refund wallet entry creation fails | Order stays in `REFUND_PENDING`. NOT silently moved to `CANCELLED`. Admin review required. |
| T-66 | Retry refund after failure         | Idempotent; second attempt succeeds if original refund was incomplete.                     |

### 44.31 Voucher Encryption / Masking / Audit

| #    | Test                                              | Expected                                                     |
| ---- | ------------------------------------------------- | ------------------------------------------------------------ |
| T-67 | Voucher code at rest is encrypted                 | Code is encrypted with managed key. Not in plaintext.        |
| T-68 | Admin list view shows masked code by default      | Code partially masked (e.g., `XXXX-XXXX-ABCD`).              |
| T-69 | Full reveal creates audit event                   | `action='VOUCHER_REVEAL'`, `actor_id=admin_id` in audit log. |
| T-70 | Member sees own fulfilled order code only         | Other member's codes are never visible.                      |
| T-71 | Voucher code not in application logs or telemetry | Log redaction verified.                                      |

### 44.32 Lock Timeout / Retry

| #    | Test                                     | Expected                                                      |
| ---- | ---------------------------------------- | ------------------------------------------------------------- |
| T-72 | Lock cannot be acquired within 3 seconds | `REDEMPTION_LOCK_TIMEOUT`. Full transaction rollback.         |
| T-73 | Retry after lock timeout                 | Exponential backoff retry succeeds if lock becomes available. |

### 44.33 Rate Effective Range Overlap Rejection

| #    | Test                                                                              | Expected                               |
| ---- | --------------------------------------------------------------------------------- | -------------------------------------- |
| T-74 | Admin creates overlapping rate version (same market, overlapping effective range) | EXCLUDE constraint rejects the INSERT. |
| T-75 | Non-overlapping rate version for different market is accepted                     | INSERT succeeds.                       |

### 44.34 Fraud Limit

| #    | Test                         | Expected                    |
| ---- | ---------------------------- | --------------------------- |
| T-76 | Member exceeds daily limit   | `REDEMPTION_LIMIT_EXCEEDED` |
| T-77 | Member exceeds monthly limit | `REDEMPTION_LIMIT_EXCEEDED` |
| T-78 | Rate-limited quote requests  | Throttled                   |

### 44.35 Maker/Checker

| #    | Test                                                        | Expected |
| ---- | ----------------------------------------------------------- | -------- |
| T-79 | (If approved) Refund without Checker approval               | Rejected |
| T-80 | (If approved) Inventory adjustment without Checker approval | Rejected |

---

## 45. Deferred Scope

The following items are explicitly deferred from Phase 6 MVP and must NOT be implemented without a new authorization:

| #    | Item                                      | Reason                                                                 |
| ---- | ----------------------------------------- | ---------------------------------------------------------------------- |
| D-01 | Cash withdrawal                           | Not a redemption feature; requires financial license                   |
| D-02 | Bank withdrawal                           | Not a redemption feature                                               |
| D-03 | Agent Commission Payout                   | Per Phase 5 deferred scope                                             |
| D-04 | Wallet cash-out                           | Not a redemption feature                                               |
| D-05 | Five-level team reward                    | Per MVP Roadmap deferred scope                                         |
| D-06 | Merchant settlement for redeemed items    | OD-25 — N/A for MVP                                                    |
| D-07 | Redemption commission for agent referrals | OD-29 — not included                                                   |
| D-08 | Cart/multi-item checkout                  | Single-item redemption per order                                       |
| D-09 | Bulk redemption API                       | Not needed for MVP                                                     |
| D-10 | Wishlist / favorites                      | Not needed for MVP                                                     |
| D-11 | Rating and reviews                        | Not needed for MVP                                                     |
| D-12 | Recommendation engine                     | Not needed for MVP                                                     |
| D-13 | Cross-market wallet transfer              | Per Project Master Control deferred scope                              |
| D-14 | Expired points handling                   | Per Phase 3 deferred scope                                             |
| D-15 | Tax/invoice handling                      | OD-20 — Deployment Blocker                                             |
| D-16 | Dispute process                           | OD-30 — Support Ticket model; Final Terms PENDING (Deployment Blocker) |
| D-17 | Backorder / waitlist                      | OD-27 — implemented in MVP                                             |

---

## 46. Bryan Open Decisions (OD-01 through OD-30)

All decisions below have **Bryan Decision: APPROVED** (per Phase 6 Full Execution Authorization). No pending decisions remain.

---

### OD-01: Catalog Ownership

**BRYAN DECISION — PLATFORM_OWNED_CATALOG_ONLY**

MVP only permits platform-owned catalog items. Merchant-owned items are not permitted in MVP.

| Field              | Value                         |
| ------------------ | ----------------------------- |
| **Decision**       | `PLATFORM_OWNED_CATALOG_ONLY` |
| **Bryan Decision** | **APPROVED**                  |

### OD-02: Merchant-owned Items

**BRYAN DECISION — MERCHANT_OWNED_ITEMS_NOT_INCLUDED_IN_MVP**

Merchant Catalog, Merchant Fulfilment and Merchant Redemption Items must NOT be implemented.

| Field              | Value                                      |
| ------------------ | ------------------------------------------ |
| **Decision**       | `MERCHANT_OWNED_ITEMS_NOT_INCLUDED_IN_MVP` |
| **Bryan Decision** | **APPROVED**                               |

### OD-03: Cross-market Redemption

**BRYAN DECISION — NO_CROSS_MARKET_REDEMPTION**

Cross-market redemption, point exchange, and wallet merging are prohibited.

| Field              | Value                        |
| ------------------ | ---------------------------- |
| **Decision**       | `NO_CROSS_MARKET_REDEMPTION` |
| **Bryan Decision** | **APPROVED**                 |

### OD-04: Debit Wallet Market

**BRYAN DECISION — CURRENT_MARKET = CATALOG_MARKET = ORDER_MARKET = WALLET_MARKET = RATE_MARKET = PICKUP_MARKET**

Current Market determines all: catalog, order, wallet debited, rate, and pickup market. Account Country does NOT determine the debit wallet.

| Field              | Value                    |
| ------------------ | ------------------------ |
| **Decision**       | `CURRENT_MARKET_UNIFIED` |
| **Bryan Decision** | **APPROVED**             |

### OD-05: Point Reservation

**BRYAN DECISION — DIRECT_ATOMIC_DEBIT**

MVP uses direct atomic debit. No reservation, no wallet hold, no inventory reservation, no RESERVED state, no reservation expiry, no release flow.

| Field              | Value                 |
| ------------------ | --------------------- |
| **Decision**       | `DIRECT_ATOMIC_DEBIT` |
| **Bryan Decision** | **APPROVED**          |

### OD-06: Reservation Expiry

**BRYAN DECISION — NOT_APPLICABLE_FOR_MVP**

Reservation is not used in MVP. This decision is not applicable.

| Field              | Value                    |
| ------------------ | ------------------------ |
| **Decision**       | `NOT_APPLICABLE_FOR_MVP` |
| **Bryan Decision** | **APPROVED**             |

### OD-07: Physical Shipping Fee

**BRYAN DECISION — MEMBER_PAYS_PHYSICAL_SHIPPING_FEE with ONLINE_FIAT_SHIPPING_PAYMENT**

- Member pays physical shipping fee using online fiat payment.
- Currency uses Order Market currency.
- Store pickup has no shipping fee.
- iPoint may NOT be used for shipping payment.
- Cash on Delivery is NOT supported.
- Shipping fee must be shown and confirmed by member before Confirm.
- Shipping Fee Snapshot written to Quote and Order.
- Client must not submit or modify shipping fee amount.

**Payment implementation:**

- Reuse existing Payment Gateway architecture where possible.
- No hard-coded payment provider binding.
- Provider Adapter Interface with Test/Sandbox Adapter.
- External Provider Secrets must NOT be in repository.
- Before Delivery Order Confirm, Shipping Payment must reach verifiable success.
- Payment Intent must bind: memberId, quoteId, marketId, currency, amount, requestHash.
- Same Payment Intent must NOT be used by multiple Orders.
- Pickup Order Shipping Fee = 0.
- If Shipping Payment succeeds but Redemption Confirm fails: auto-void or auto-refund, no iPoint Wallet impact, enter Payment Recovery Queue on failure.
- Missing Provider Credentials must NOT block code and test completion.
- Provider Production Configuration listed as Deployment Blocker.

| Field              | Value                              |
| ------------------ | ---------------------------------- |
| **Decision**       | `MEMBER_PAYS_ONLINE_FIAT_SHIPPING` |
| **Bryan Decision** | **APPROVED**                       |

### OD-08: Store Pickup

**BRYAN DECISION — STORE_PICKUP_SUPPORTED_IN_MVP**

Supported fulfilment modes: `DELIVERY_ONLY`, `PICKUP_ONLY`, `DELIVERY_OR_PICKUP`. Pickup Locations must be configured by platform. This does NOT open Merchant-owned Catalog.

| Field              | Value                    |
| ------------------ | ------------------------ |
| **Decision**       | `STORE_PICKUP_SUPPORTED` |
| **Bryan Decision** | **APPROVED**             |

### OD-09: Digital Voucher Expiry

**BRYAN DECISION — DIGITAL_VOUCHER_EXPIRY_CONFIGURABLE, DEFAULT_3_CALENDAR_MONTHS**

- Each item can configure expiry.
- Default: 3 calendar months from voucher issuance.
- Uses Market IANA Timezone for calculation.
- UTC storage.
- Expiry Snapshot is immutable.

| Field              | Value                                    |
| ------------------ | ---------------------------------------- |
| **Decision**       | `VOUCHER_EXPIRY_CONFIGURABLE_3M_DEFAULT` |
| **Bryan Decision** | **APPROVED**                             |

### OD-10: Expired Voucher Refund

**BRYAN DECISION — EXPIRED_VOUCHER_NO_REFUND**

Expired vouchers: no iPoint return, no re-issuance, no extension, no refund ledger, status = EXPIRED.

| Field              | Value                       |
| ------------------ | --------------------------- |
| **Decision**       | `EXPIRED_VOUCHER_NO_REFUND` |
| **Bryan Decision** | **APPROVED**                |

### OD-11: Cancellable States

**BRYAN DECISION — NO_MEMBER_CANCELLATION_AFTER_CONFIRM**

- Quote can be abandoned (Quote is not an Order).
- After Confirm + Debit: Member may NEVER cancel. Not before shipment, not before pickup, not before voucher use.
- Returns `REDEMPTION_ORDER_NOT_CANCELLABLE`.

| Field              | Value                                  |
| ------------------ | -------------------------------------- |
| **Decision**       | `NO_MEMBER_CANCELLATION_AFTER_CONFIRM` |
| **Bryan Decision** | **APPROVED**                           |

### OD-12: Partial Refund

**BRYAN DECISION — NO_PARTIAL_REFUND**

Only Full Refund is permitted. Each Debit may have at most one Refund.

| Field              | Value               |
| ------------------ | ------------------- |
| **Decision**       | `NO_PARTIAL_REFUND` |
| **Bryan Decision** | **APPROVED**        |

### OD-13: Out-of-stock Auto Refund

**BRYAN DECISION — NO_AUTOMATIC_REFUND_FOR_POST_CONFIRM_STOCKOUT**

Post-confirm stockout: no auto-refund. Enter `BACKORDERED` or `FULFILMENT_EXCEPTION`. Admin Review. Can wait for restock or propose alternative fulfilment. Refund requires Maker/Checker.

| Field              | Value                         |
| ------------------ | ----------------------------- |
| **Decision**       | `NO_POST_CONFIRM_AUTO_REFUND` |
| **Bryan Decision** | **APPROVED**                  |

### OD-14: Fulfilment SLA

**BRYAN DECISION — NO_FORMAL_FULFILMENT_SLA_IN_MVP**

Estimated Time may be displayed but SLA Engine is NOT built.

| Field              | Value                      |
| ------------------ | -------------------------- |
| **Decision**       | `NO_FORMAL_FULFILMENT_SLA` |
| **Bryan Decision** | **APPROVED**               |

### OD-15: KYC Enforcement Point

**BRYAN DECISION — KYC_LEVEL_2_REQUIRED_AT_CONFIRM**

Without KYC Level 2: Browse, Item Detail, and Quote are allowed. Confirm, Wallet Debit, and Confirmed Order Creation are prohibited.

| Field              | Value                             |
| ------------------ | --------------------------------- |
| **Decision**       | `KYC_LEVEL_2_REQUIRED_AT_CONFIRM` |
| **Bryan Decision** | **APPROVED**                      |

### OD-16: High-value Review

**BRYAN DECISION — NO_HIGH_VALUE_MANUAL_REVIEW_IN_MVP**

No manual review threshold is established in MVP.

| Field              | Value                         |
| ------------------ | ----------------------------- |
| **Decision**       | `NO_HIGH_VALUE_MANUAL_REVIEW` |
| **Bryan Decision** | **APPROVED**                  |

### OD-17: Refund Maker / Checker

**BRYAN DECISION — ADMIN_REFUND_REQUIRES_MAKER_CHECKER**

- Maker creates Refund Request.
- Checker must be a different Admin (maker_id != checker_id).
- Checker approves, then System executes.
- Full Refund Only.
- `REFUNDED` only enters after Ledger and Projection succeed.

| Field              | Value                           |
| ------------------ | ------------------------------- |
| **Decision**       | `REFUND_MAKER_CHECKER_REQUIRED` |
| **Bryan Decision** | **APPROVED**                    |

### OD-18: Inventory Maker / Checker

**BRYAN DECISION — INVENTORY_ADJUSTMENT_NO_MAKER_CHECKER**

Maker/Checker not required for inventory adjustment. Must still have: permission, reason, before/after/adjustment values, version check, and audit.

| Field              | Value                                   |
| ------------------ | --------------------------------------- |
| **Decision**       | `INVENTORY_ADJUSTMENT_NO_MAKER_CHECKER` |
| **Bryan Decision** | **APPROVED**                            |

### OD-19: Daily / Monthly Limits

**BRYAN DECISION — NO_DAILY_OR_MONTHLY_REDEMPTION_LIMIT**

No Daily Limit, Monthly Limit, Limit Counter, or Limit Override. No `REDEMPTION_LIMIT_EXCEEDED`. API Rate Limit, Quantity Constraint, Inventory Constraint, and Fraud Monitoring are retained.

| Field              | Value                     |
| ------------------ | ------------------------- |
| **Decision**       | `NO_DAILY_MONTHLY_LIMITS` |
| **Bryan Decision** | **APPROVED**              |

### OD-20: Tax / Invoice Responsibility

**BRYAN DECISION — TAX_AND_INVOICE_NOT_INCLUDED_IN_PHASE_6_MVP**

`LEGAL_AND_TAX_REVIEW_REQUIRED_BEFORE_PRODUCTION` — recorded as Deployment Blocker. Does NOT block engineering completion, but blocks Production Deployment.

| Field              | Value                  |
| ------------------ | ---------------------- |
| **Decision**       | `TAX_INVOICE_DEFERRED` |
| **Bryan Decision** | **APPROVED**           |

### OD-21: Fixed Point Cost vs Rate Conversion

**BRYAN DECISION — RATE_CONVERSION_PRICING**

Formula: `required_iPoint = fiat_reference_value / redemption_rate`. 1 iPoint = X Market Fiat Currency.

Must use: NUMERIC/Decimal, HALF_UP, explicit Calculation Scale, Posting Scale inherits Wallet Contract. Quote stores unrounded and final posted values. Client-side pricing is prohibited. Fixed Point Cost as primary pricing source is prohibited.

| Field              | Value                     |
| ------------------ | ------------------------- |
| **Decision**       | `RATE_CONVERSION_PRICING` |
| **Bryan Decision** | **APPROVED**              |

### OD-22: Rate Effective Time

**BRYAN DECISION — RATE_LOCKED_AT_QUOTE_TIME**

- Quote uses rate version effective at generation time.
- Rate change during quote validity does NOT affect the quote.
- Confirm uses Quote Snapshot.
- New quotes use new rate.
- Rate changes must NOT make valid quotes automatically stale.
- Item Version, Market, Eligibility, or Payload changes MAY make quote stale.

| Field              | Value                       |
| ------------------ | --------------------------- |
| **Decision**       | `RATE_LOCKED_AT_QUOTE_TIME` |
| **Bryan Decision** | **APPROVED**                |

### OD-23: Promotional Rate

**BRYAN DECISION — NO_PROMOTIONAL_RATE_IN_MVP**

| Field              | Value                 |
| ------------------ | --------------------- |
| **Decision**       | `NO_PROMOTIONAL_RATE` |
| **Bryan Decision** | **APPROVED**          |

### OD-24: Voucher Code Custody

**BRYAN DECISION — SYSTEM_GENERATED_VOUCHER_CODE**

Voucher Codes must be:

- Cryptographically Secure Random Generator
- Unique
- Encrypted at Rest
- Hash used for duplicate detection
- NOT output to Log
- NOT output to Telemetry
- Admin List default Masked
- Full Reveal requires permission and creates Audit
- Member views only own fulfilled Order codes
- No duplicate assignment under concurrency

| Field              | Value                           |
| ------------------ | ------------------------------- |
| **Decision**       | `SYSTEM_GENERATED_VOUCHER_CODE` |
| **Bryan Decision** | **APPROVED**                    |

### OD-25: Merchant Settlement

**BRYAN DECISION — MERCHANT_SETTLEMENT_NOT_APPLICABLE_FOR_MVP**

| Field              | Value                    |
| ------------------ | ------------------------ |
| **Decision**       | `NOT_APPLICABLE_FOR_MVP` |
| **Bryan Decision** | **APPROVED**             |

### OD-26: Failed Fulfilment

**BRYAN DECISION — RETRY_THEN_ADMIN_REVIEW**

**Retryable Failure:**

- Auto retry, max 3 times, exponential backoff.
- Each retry must record Audit.
- Retry must be Idempotent.

After 3rd failure still failing: FULFILMENT_EXCEPTION, ADMIN_REVIEW_REQUIRED.

**Non-retryable Failure:**
Directly FULFILMENT_EXCEPTION, ADMIN_REVIEW_REQUIRED.

Prohibited: auto iPoint refund, auto order cancellation, auto original debit modification.

Admin refund decision: Full Refund Only, Maker/Checker, creates REDEMPTION_REFUND, exact opposite, original debit unchanged.

| Field              | Value                     |
| ------------------ | ------------------------- |
| **Decision**       | `RETRY_THEN_ADMIN_REVIEW` |
| **Bryan Decision** | **APPROVED**              |

### OD-27: Backorder / Waitlist

**BRYAN DECISION — BACKORDER_AND_WAITLIST_SUPPORTED**

**WAITLIST:**

- No Order created.
- No point debit.
- No rate lock.
- No inventory reservation.
- Restock notification requires re-quote.
- Waitlist Subscription can be cancelled.

**BACKORDER:**

- Only when item allows.
- Immediate iPoint debit on Confirm.
- Status BACKORDERED.
- Member must explicitly accept before Confirm: currently out of stock, estimated restock, no cancellation after confirm, no auto-refund.
- Configurable: allow_backorder, max_backorder_quantity, estimated_restock_at.

| Field              | Value                              |
| ------------------ | ---------------------------------- |
| **Decision**       | `BACKORDER_AND_WAITLIST_SUPPORTED` |
| **Bryan Decision** | **APPROVED**                       |

### OD-28: Suspended Member Orders

**BRYAN DECISION — SUSPEND_EXISTING_UNFULFILLED_ORDERS**

Member suspended:

- New Confirm prohibited.
- Unfulfilled orders FULFILMENT_SUSPENDED.
- Pause shipping, pickup code, unissued vouchers, service fulfilment.
- No auto-refund, no auto-cancel.

Restored to ACTIVE:

- Resume to previous continuable state.
- Full Audit.

Completed/claimed/irreversible vouchers are NOT rolled back.

| Field              | Value                                 |
| ------------------ | ------------------------------------- |
| **Decision**       | `SUSPEND_EXISTING_UNFULFILLED_ORDERS` |
| **Bryan Decision** | **APPROVED**                          |

### OD-29: Redemption Commission

**BRYAN DECISION — NO_REDEMPTION_COMMISSION**

Prohibited: Commission Processing, Commission Ledger, Commission Worker, new Phase 5 Commission Source, any Upline Commission trigger.

| Field              | Value                      |
| ------------------ | -------------------------- |
| **Decision**       | `NO_REDEMPTION_COMMISSION` |
| **Bryan Decision** | **APPROVED**               |

### OD-30: Dispute Process

**BRYAN DECISION — TERMS_AND_CONDITIONS_ACCEPTANCE_MODEL**

MVP does NOT build a full Dispute Workflow.

Before Confirm must accept Redemption Terms and Conditions: save terms_version, accepted_at, member_id, request metadata, Order Terms Snapshot.

Member issues use Support Ticket linked to redemption_order_id.

Final legal terms text is pending: FINAL_TERMS_CONTENT_PENDING — does NOT block Phase 6 engineering completion, but blocks Production Deployment.

| Field              | Value                             |
| ------------------ | --------------------------------- |
| **Decision**       | `TERMS_ACCEPTANCE_SUPPORT_TICKET` |
| **Bryan Decision** | **APPROVED**                      |

## 47. Proposed P6-S1 onward Breakdown

The following breakdown is proposed for ChatGPT Command Center approval after P6-S0 is accepted:

### P6-S1: Schema, Migration & Domain Model

- Create all Redemption Center database tables
- Forward migration for new tables
- Add `REDEMPTION_DEBIT` and `REDEMPTION_REFUND` to wallet entry type enum
- Domain model types and DTOs

### P6-S2: Catalog Management

- Admin CRUD APIs for catalog items
- Catalog browsing API (member-facing, per current market)
- Item details API
- Rate version management (admin)

### P6-S3: Quote, Rate Lock & Shipping Payment

- Quote generation with rate locking
- Rate conversion pricing (OD-21)
- Shipping payment integration (OD-07)
- Fiat payment adapter + sandbox
- Quote validation at confirm
- Shipping payment recovery

### P6-S4: Order Confirmation & Wallet Debit

- Atomic order confirmation with wallet debit
- Balance check and eligibility validation
- Inventory decrement
- Limit check and update

### P6-S5: Fulfilment & State Machine

- Fulfilment record creation
- State machine transitions (CONFIRMED → PROCESSING → FULFILLED / FAILED / CANCELLED)
- Digital auto-fulfilment
- Fulfilment status tracking

### P6-S6: Cancellation & Refund

- Member cancellation (pre-debit)
- Admin cancellation (post-debit with refund)
- Full refund via exact-opposite wallet entry
- Inventory restoration on cancellation

### P6-S7: Admin Operations

- Admin order management (list, detail, cancel, refund)
- Inventory adjustment
- Order administration dashboard (basic)
- Maker/Checker for refund (if approved)

### P6-S8: Hardening

- Concurrency testing and lock ordering validation
- Idempotency testing
- Audit completeness verification
- Privacy projection verification
- Security review (input validation, authorization)
- Error handling and retry

### P6-S9: Final Verification & Acceptance

- Acceptance test matrix execution (T-01 through T-65)
- Full regression against Phase 3/4/5 frozen contracts
- Delivery report

---

_End of P6-S0 Redemption Center Contract Draft_
_Status: DRAFT — Awaiting Bryan decisions on OD-01 through OD-30 before freezing_
_All OD decisions marked PENDING — no production action authorized_
