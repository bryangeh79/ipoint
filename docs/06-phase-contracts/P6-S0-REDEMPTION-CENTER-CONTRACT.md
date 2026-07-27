# P6-S0: Redemption Center — Contract Freeze & Architecture Draft

**Phase:** Phase 6 — Redemption Center  
**Sprint:** P6-S0 (Documentation, Architecture & Contract Planning)  
**Status:** P6-S0_IN_PROGRESS — DRAFT FOR BRYAN AND COMMAND CENTER REVIEW  
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
- A **quote → reserve → confirm/debit** workflow with rate locking at quote time.
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
- Point reservation pattern (evaluate Option A vs Option B)
- Wallet debit, release, and refund with exact-opposite compensation
- Order state machine (DRAFT → QUOTED → RESERVED → CONFIRMED → FULFILLED / CANCELLED / REFUNDED)
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

| # | Principle | Source Phase | Rule |
|---|---|---|---|
| 1 | One Account + Multi Market | Phase 2 (D-027) | A single member can access multiple markets independently |
| 2 | One Wallet Per Market | Phase 3 (D-029) | Each market has an independent iPoint wallet |
| 3 | Immutable Ledger | Phase 3 (D-029) | Wallet entries are append-only; corrections use compensating entries |
| 4 | Rate Snapshot at Source Time | Phase 4 (D-037) | Historical redemption orders must store rate snapshot at order time |
| 5 | Atomic Transaction Boundary | Phase 4 (D-037) | Confirm operations must be all-or-nothing |
| 6 | Decimal Arithmetic Only | Phase 3/5 (D-029/D-042) | All point arithmetic uses `NUMERIC(38,10)` with HALF_UP rounding |
| 7 | Idempotency for Critical Writes | Phase 4 (D-037) | Each mutation must be idempotent via unique business constraint |
| 8 | KYC Level 2 Required Before Redemption | Member PRD V1.1 | Level 2 KYC is a prerequisite for redemption |
| 9 | Merchant Snapshot Preservation | Phase 3/4 | Historical order snapshots must preserve the state at order time |

---

## 2. Terminology

| Term | Definition |
|---|---|
| **Redemption (兑换)** | The process of exchanging iPoint points for catalog items. |
| **Redemption Center (兑换中心)** | The per-market interface where members browse, quote, and submit redemption orders. |
| **Catalog (商品目录)** | A per-market listing of items available for redemption. |
| **Catalog Item (商品)** | A single redeemable entity with a point cost, inventory, and fulfilment type. |
| **Redemption Rate (兑换率)** | The conversion value of 1 iPoint in the market's fiat currency (e.g., 1 iPoint = RM 0.01). |
| **Point Cost (所需积分)** | The iPoint amount required to redeem one unit of a catalog item (either fixed or derived from rate). |
| **Quote (报价)** | A time-bounded reservation of point cost, rate version, and inventory for a specific redemption request. |
| **Reservation (预留)** | Temporary hold of iPoint points in the member's wallet, reducing available balance without final debit. |
| **Redemption Order (兑换订单)** | A confirmed request to redeem a catalog item, with an associated state machine. |
| **Fulfilment (履约)** | The process of delivering the redeemed item to the member (physical shipment, digital delivery, or service scheduling). |
| **Voucher (电子券)** | A digital redemption item typically delivered as a code, barcode, or claim link. |
| **Wallet Market (钱包市场)** | The market whose iPoint wallet is debited during redemption. |
| **Inventory (库存)** | The available quantity of a catalog item. May be unlimited for digital items. |
| **Refund (退点)** | The return of iPoint points to the member's wallet when an order is cancelled, fails, or is refunded. |

---

## 3. Actors and Permissions

### 3.1 Actors

| Actor | Description |
|---|---|
| **Member** | Any registered iPoint member with KYC Level 2 completed. Can browse, quote, and redeem from their eligible markets. |
| **Admin** | iPoint platform administrator. Can manage catalog, rates, inventory, orders, and perform manual adjustments. |
| **System** | Automated processes: order expiry, fulfilment callbacks, inventory release, refund execution. |

### 3.2 Permission Matrix

| Action | Member | Admin | System |
|---|---|---|---|
| Browse catalog (own current market) | ✅ | ✅ | ✅ |
| Browse catalog (cross-market) | ❌ (OD-03 PENDING) | ✅ | ✅ |
| Generate quote | ✅ | ✅ | ✅ |
| Confirm redemption order | ✅ | ✅ | ✅ |
| Cancel own order | ✅ (limited by state) | ✅ | ✅ |
| View own redemption history | ✅ | ✅ | ✅ |
| View others' redemption history | ❌ | ✅ | ✅ |
| Create catalog item | ❌ | ✅ | ❌ |
| Update catalog item | ❌ | ✅ | ❌ |
| Configure redemption rate | ❌ | ✅ | ❌ |
| Adjust inventory | ❌ | ✅ | ✅ |
| Fulfil order (physical) | ❌ | ✅ | ✅ (system callback) |
| Fulfil order (digital) | ❌ | ✅ | ✅ (auto) |
| Cancel any order | ❌ | ✅ | ✅ (on expiry) |
| Refund points | ❌ | ✅ (OD-17 PENDING) | ✅ (on cancellation) |
| Maker/Checker approval | ❌ | ✅ (OD-17 PENDING) | ❌ |

---

## 4. Document Authority

### 4.1 Authority Order for P6-S0

When documents conflict during Phase 6, use this hierarchy (lower number wins):

| Rank | Source | Notes |
|---|---|---|
| **1** | Bryan's latest explicit written decision | Highest authority |
| **2** | ChatGPT Command Center Phase 6 Phase Brief or acceptance decision | Current execution authority |
| **3** | **P6-S0-REDEMPTION-CENTER-CONTRACT.md** (this document) | Once frozen, becomes the Phase 6 single source of truth |
| **4** | Latest approved Admin PRD V1.0 | Redemption Center admin rules |
| **5** | Latest approved Member PRD V1.1 (International Architecture Update) | Market isolation and redemption rules |
| **6** | Latest approved Merchant PRD | Merchant-owned items may reference merchant rules |
| **7** | iPoint Product Design System | UI/UX token authority |
| **8** | Project Master Control + Operating Rules | Governance baseline |
| **9** | Phase 5 Agent & Commission Contract (frozen) | Commission semantics for merchant-owned items |
| **10** | Phase 4 Transaction/Correction Contract (frozen) | Correction compensation patterns |
| **11** | Phase 3 Wallet/Reward Contract (frozen) | Wallet ledger and immutable entry rules |
| **12** | MVP Roadmap V1.0 | Business background only |

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

| Interface | Provider | Phase 6 Usage |
|---|---|---|
| `GET /wallets/:id` | Phase 3 | Check point balance before quote/confirm |
| `POST /wallets/:id/entries` | Phase 3 | Debit points on order confirmation |
| Wallet ledger entry types | Phase 3 | Add `REDEMPTION_DEBIT`, `REDEMPTION_REFUND` entry types |
| `POST /wallets/:id/reversal` | Phase 3 | Refund points on cancellation |
| Member KYC status | Phase 2 | Check KYC Level 2 before allowing redemption |
| Member current market | Phase 2 | Determine catalog visibility |
| Member account country | Phase 2 | Determine wallet market (OD-04 PENDING) |
| Merchant data | Phase 1 | Merchant-owned items reference merchant information |
| Correction pattern | Phase 4 | Refund uses exact-opposite entry |

### 5.3 Phase 3 Wallet Ledger Extensions

Phase 6 requires two new `entry_type` values in the existing `member_wallet_entries` table:

| entry_type | Description |
|---|---|
| `REDEMPTION_DEBIT` | iPoint debited for a confirmed redemption order |
| `REDEMPTION_REFUND` | iPoint refunded after cancellation/failure |

These are backward-compatible additions to the Phase 3 wallet entry type enum. The existing Phase 3 entry types (`REWARD_ACCRUAL`, `REVERSAL`, `CORRECTION`, `ADJUSTMENT`) remain unchanged.

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

| Effect | Rule |
|---|---|
| Catalog Browsing | Current Market determines which catalog is displayed. Member sees only the catalog belonging to their current market. |
| Quote Generation | Quote is generated against the current market's catalog and rate. |
| Order Placement | Order is associated with the current market at time of confirmation. |

**OPEN:** Whether the Wallet Market (market whose wallet is debited) must equal the Current Market. See OD-04.

---

## 8. Wallet Market

### 8.1 Problem Statement

The Redemption Center must determine which market's iPoint wallet to debit when a member confirms a redemption order. This is NOT inherently resolved by the Current Market concept.

### 8.2 Candidate Models

| Model | Description | Impact |
|---|---|---|
| **A: Wallet Market = Current Market** | Debit the wallet of the market the member is currently browsing. | Simple. If member switches to SG market, SG wallet is debited. |
| **B: Wallet Market = Account Country** | Debit the wallet of the member's account country. | Points earned in MY (via MY transactions) are always spent from the MY wallet, regardless of current browsing market. |
| **C: Wallet Market = Redemption Market** | Member selects which wallet to debit at order time. | Most flexible but adds UI complexity and confusion. |

**See OD-04 for Bryan decision.**

### 8.3 Design Impact

The Wallet Market decision affects:

- Which wallet is queried for balance checks
- Which wallet is debited on confirmation
- Which wallet receives refund on cancellation
- Cross-market redemption eligibility (OD-03)

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

| Field | Type | Description |
|---|---|---|
| id | UUID | Unique item identifier |
| market_id | UUID | FK to markets — the market this item belongs to |
| sku | VARCHAR(64) | Optional SKU for inventory tracking |
| name | VARCHAR(256) | Item name (market-language specific) |
| description | TEXT | Item description |
| item_type | VARCHAR(32) | `PHYSICAL`, `DIGITAL_VOUCHER`, `SERVICE` |
| ownership | VARCHAR(32) | `PLATFORM_OWNED` or `MERCHANT_OWNED` |
| merchant_id | UUID | FK to merchants (nullable — only for merchant-owned) |
| point_cost | NUMERIC(38,10) | Fixed point cost per unit (if using Fixed Point Cost model) |
| fiat_reference_value | NUMERIC(38,10) | Optional fiat value for reference display |
| currency | VARCHAR(3) | Currency code for fiat reference value |
| inventory_mode | VARCHAR(32) | `UNLIMITED`, `TRACKED`, `ON_DEMAND` |
| total_inventory | NUMERIC(38,0) | Total units available (for TRACKED mode) |
| available_inventory | NUMERIC(38,0) | Current available units (computed from total - reserved - fulfilled) |
| image_url | TEXT | Item image |
| terms | TEXT | Redemption terms and conditions |
| is_active | BOOLEAN | Whether item is active in the catalog |
| is_featured | BOOLEAN | Whether item is featured/promoted |
| tags | TEXT[] | Search/filter tags |
| effective_from | TIMESTAMPTZ | When item becomes available |
| effective_until | TIMESTAMPTZ | When item expires (nullable) |
| created_by | UUID | Admin who created the item |
| version | INTEGER | Version number for optimistic locking |
| created_at | TIMESTAMPTZ | Row creation timestamp |
| updated_at | TIMESTAMPTZ | Row update timestamp |

### 9.3 Catalog Versioning

Each catalog item has a `version` counter. When an item's point cost or other key fields change, the version increments. This version is captured in the quote snapshot (see Section 14).

---

## 10. Catalog Item Types

### 10.1 Type Classification

| Type | Code | Inventory Needed | Fulfilment | Examples |
|---|---|---|---|---|
| Physical Goods | `PHYSICAL` | Yes (tracked) | Shipment via courier | Merchandise, gifts, branded items |
| Digital Voucher | `DIGITAL_VOUCHER` | No (unlimited) | Instant delivery (code/barcode) | E-vouchers, gift cards, discount codes |
| Service | `SERVICE` | Yes (slot-based) | Scheduling/appointment | Experiences, classes, consultations |

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

| Ownership | Owner | Catalog Management | Fulfilment Responsibility | Point Cost Setting |
|---|---|---|---|---|
| `PLATFORM_OWNED` | iPoint platform | Admin only | Platform or platform-nominated fulfillment partner | Admin |
| `MERCHANT_OWNED` | iPoint merchant partner | Admin (with merchant input) | Merchant | Admin (or merchant-negotiated) |

### 11.2 Merchant-Owned Items (if approved — see OD-02)

If merchant-owned items are approved, the following additional rules apply:

- Merchant must be ACTIVE and not SUSPENDED/CLOSED
- Merchant's MCP status does not affect redemption eligibility
- Merchant-owned items may appear in the member's catalog alongside platform-owned items
- Fulfilment is the merchant's responsibility
- Points are debited from member's wallet regardless of merchant status at confirm time (rate snapshot is captured)
- Merchant settlement for redeemed items is OPEN (OD-25)

---

## 12. Redemption Rate

### 12.1 Rate Definition

A redemption rate defines the conversion value of 1 iPoint in the market's fiat currency.

**Example:** Rate = 0.01 means 1 iPoint = RM 0.01.

### 12.2 Fixed Point Cost vs Rate Conversion

Two models for determining point cost are proposed:

| Model | Description | Example |
|---|---|---|
| **Fixed Point Cost (OD-21 Option A)** | Each catalog item has a fixed `point_cost` directly set in the item record. | Item costs 5000 points regardless of rate changes. |
| **Rate Conversion (OD-21 Option B)** | Point cost is derived from `fiat_reference_value / rate`. | Item valued at RM50, rate = 0.01 → 5000 points. Rate changes affect point cost. |

**See OD-21 for Bryan decision.**

### 12.3 Rate Table (Design)

```
redemption_rates
├── id (uuid, PK)
├── market_id (uuid, FK→markets)
├── rate (numeric(38,10)) — 1 iPoint = X fiat (e.g., 0.01 for 1 iPoint = RM 0.01)
├── fiat_currency (varchar(3)) — currency code (e.g., MYR)
├── effective_from (timestamptz) — when rate becomes effective
├── effective_until (timestamptz, nullable) — when rate expires
├── created_by (uuid, FK→admin_users)
├── created_at (timestamptz)
└── notes (text, nullable)
```

---

## 13. Rate Versioning

### 13.1 Rate Version Lifecycle

- Rates are versioned per market
- Historical rate versions are immutable after creation
- Rate changes are prospective only — historical orders retain their rate snapshot
- Multiple rate versions may exist, but only one is effective at any point in time per market
- Rate versions may be scheduled (future `effective_from`)

### 13.2 Rate Effective Time (OD-22)

**PENDING:** Whether the rate effective at:
- **A:** Quote generation time (rate locked at quote)
- **B:** Confirm time (rate at final confirmation)
- **C:** First quote time (rate locked on first quote, even if quote expires and regenerated)

**See OD-22 for Bryan decision.**

### 13.3 Rate Version Table (Design)

```
redemption_rate_versions
├── id (uuid, PK)
├── market_id (uuid, FK→markets)
├── rate (numeric(38,10))
├── fiat_currency (varchar(3))
├── effective_from (timestamptz)
├── effective_until (timestamptz, nullable)
├── status (varchar(16)) — 'DRAFT', 'ACTIVE', 'EXPIRED', 'SUPERSEDED'
├── created_by (uuid, FK→admin_users)
├── approved_by (uuid, FK→admin_users, nullable)
├── notes (text, nullable)
├── created_at (timestamptz)
└── updated_at (timestamptz)
```

**Idempotency:** `UNIQUE(market_id)` where `status = 'ACTIVE'` — only one active rate per market at any time.

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

| Rule | Description |
|---|---|
| **Quote does NOT debite** | No wallet mutation during quote |
| **Quote does NOT reserve** | No inventory reservation during quote (OD-06 PENDING) |
| **Quote may be re-validated** | At confirm time, the system must re-validate the quote (item available, rate still valid, balance sufficient) |
| **Expired quote** | Confirm with an expired quote must be rejected with `QUOTE_EXPIRED` error |
| **Stale quote** | Confirm must reject if item version has changed since quote was generated |
| **Quote is idempotent** | Same (member, item, quantity) within quote expiry returns same quote |

---

## 16. Point Reservation

### 16.1 Problem Statement

The system must decide whether to reserve iPoint points before final confirmation or to debit directly on confirmation.

### 16.2 Option A: Direct Confirm Debit

```
Quote ──> Confirm (atomic: check + debit + create order)
     No intermediate reservation state.
```

**Pros:** Simpler implementation, fewer states, no reservation expiry management.
**Cons:** Member may have sufficient balance at quote time but insufficient at confirm time.

### 16.3 Option B: Reserve → Confirm / Release

```
Quote ──> Reserve (hold points, reduce available balance)
     ├── Confirm (within reserve window) → points permanently debited
     └── Release (expiry or cancellation) → points returned to available
```

**Pros:** Guarantees point availability for the member during the reservation window.
**Cons:** More complex state machine, introduces reservation expiry, temporary reduction in available balance affects other concurrent redemption attempts.

### 16.4 Recommendation

**Recommended: Option B (Reserve → Confirm / Release)** for any scenario where the confirm process may involve delays (e.g., physical fulfilment requires address entry). For instant digital fulfilment, Option A may be sufficient.

**See OD-05 for Bryan decision.**

### 16.5 Reservation Data

```
redemption_reservations
├── id (uuid, PK)
├── member_id (uuid, FK→members)
├── market_id (uuid, FK→markets)
├── item_id (uuid, FK→catalog_items)
├── quantity (numeric(38,0))
├── reserved_points (numeric(38,10)) — points held
├── rate_version_id (uuid, FK→redemption_rate_versions)
├── status (varchar(16)) — 'ACTIVE', 'CONFIRMED', 'RELEASED', 'EXPIRED'
├── expires_at (timestamptz)
├── confirmed_at (timestamptz, nullable)
├── released_at (timestamptz, nullable)
├── created_at (timestamptz)

Idempotency: UNIQUE(member_id, item_id, status) where status = 'ACTIVE'
             (one active reservation per member per item)
```

---

## 17. Wallet Debit

### 17.1 Debit Rules

**LOCKED (inheriting Phase 3 immutable ledger):**

1. Wallet debit is a **negative ledger entry** in `member_wallet_entries`.
2. The entry uses `entry_type = 'REDEMPTION_DEBIT'` (new Phase 6 type).
3. The entry references the redemption order via `correlation_id`.
4. The entry has a unique `idempotency_key`.
5. Balance is derived: `balance = SUM(amount)`. Debit reduces the sum.
6. No positive balance check is performed by the wallet service — the redemption service checks sufficiency before calling the debit.

### 17.2 Debit Flow

```
1. Check: member KYC Level 2
2. Check: member status = ACTIVE (not SUSPENDED/CLOSED)
3. Check: item is active and available in catalog
4. Check: inventory sufficient (if TRACKED mode)
5. Check: wallet balance >= total point cost
6. Check: daily/monthly limits not exceeded
7. Check: quote is valid (not expired, item version matches)
8. Atomic transaction:
   a. Create redemption_reservation (reserve points)
   b. Create/update redemption_order (state = RESERVED or CONFIRMED)
   c. Create wallet entry (entry_type = 'REDEMPTION_DEBIT', amount = -total_points)
   d. Update wallet account balance
   e. Update inventory (decrement available)
   f. Create audit log entry
9. If any step fails → full rollback, no partial state
```

### 17.3 Balance Check

```
IF member_wallet_accounts.balance < total_point_cost
  → REJECT with REDEMPTION_INSUFFICIENT_BALANCE error
END IF
```

---

## 18. Wallet Release

### 18.1 Release Rules (if Option B is adopted)

When a reservation expires or is cancelled before confirmation:

1. No wallet entry is created (the reservation was only a conceptual hold)
2. The reservation's `reserved_points` are returned to available balance
3. Inventory reservation is released
4. Reservation status updated to `RELEASED` or `EXPIRED`

**If Option A is adopted (direct debit), there is no release step** — the cancellation would trigger a refund (Section 19).

---

## 19. Wallet Refund

### 19.1 Refund Principles

**LOCKED (inherited from Phase 3/4 correction patterns):**

1. **Original debit entry is immutable.** Never modify or delete the original `REDEMPTION_DEBIT` entry.
2. **Refund creates a compensating entry.** Create a new wallet entry with:
   - `entry_type = 'REDEMPTION_REFUND'`
   - `amount = -(original_debit_amount)` — exact opposite (positive)
   - `reversal_of = original_wallet_entry_id`\n   - `correlation_id = refund_order_id`
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

## 20. Order State Machine

### 20.1 Proposed State Machine

```
                  ┌──────────────────────┐
                  │        DRAFT         │
                  └──────────┬───────────┘
                             │ Generate Quote
                             ▼
                  ┌──────────────────────┐
                  │       QUOTED         │
                  └──────────┬───────────┘
                             │ Confirm (with reservation, if Option B)
                             ▼
                  ┌──────────────────────┐
                  │    PENDING_PAYMENT   │  (if reservation used)
                  └──────────┬───────────┘
                             │ Points debited / payment confirmed
                             ▼
                  ┌──────────────────────┐
                  │      CONFIRMED       │
                  └──┬───────┬───────┬───┘
                     │       │       │
           Begin     │       │       │  Auto (digital)
           Fulfilment│       │       │
                     ▼       │       ▼
           ┌─────────────┐   │   ┌──────────────┐
           │  PROCESSING │   │   │   FULFILLED  │
           └──────┬──────┘   │   └──────────────┘
                  │          │
                  ▼          │
           ┌─────────────┐   │
           │  FULFILLED  │   │
           └─────────────┘   │
                             │
                    ┌────────┴────────┐
                    ▼                 ▼
           ┌──────────────┐  ┌──────────────┐
           │ CANCELLED    │  │  FAILED      │
           └──────────────┘  └──────┬───────┘
                                    │ Auto refund
                                    ▼
                           ┌──────────────┐
                     ┌─────│ REFUND_PENDING│
                     │     └──────┬───────┘
                     │            │ Refund executed
                     │            ▼
                     │    ┌──────────────┐
                     │    │   REFUNDED   │
                     │    └──────────────┘
                     │
               ┌─────┴──────┐
               │ CANCELLED  │ (if cancelled before point debit)
               └────────────┘
```

### 20.2 State Definitions

| # | State | Code | Entry Condition | Entry Allowed Actor |
|---|---|---|---|---|
| 1 | **DRAFT** | `DRAFT` | Member begins redemption flow | Member, System |
| 2 | **QUOTED** | `QUOTED` | Quote generated successfully | System |
| 3 | **PENDING_PAYMENT** | `PENDING_PAYMENT` | Points reserved (if Option B) | System |
| 4 | **CONFIRMED** | `CONFIRMED` | Points debited successfully | System |
| 5 | **PROCESSING** | `PROCESSING` | Fulfilment process initiated | System, Admin |
| 6 | **FULFILLED** | `FULFILLED` | Item delivered/completed | System (callback), Admin |
| 7 | **CANCELLED** | `CANCELLED` | Order cancelled before fulfilment | Member (if eligible), Admin, System |
| 8 | **FAILED** | `FAILED` | Fulfilment failed (physical damaged, digital delivery error) | System |
| 9 | **REFUND_PENDING** | `REFUND_PENDING` | Refund initiated, awaiting execution | System |
| 10 | **REFUNDED** | `REFUNDED` | Points returned to wallet | System |

### 20.3 State Transition Matrix

| From | To | Allowed Actor | Wallet Effect | Inventory Effect | Audit Effect | Retry Rule | Terminal? | Cancellation Eligible? | Refund Eligible? |
|---|---|---|---|---|---|---|---|---|---|
| DRAFT | QUOTED | System | None | None | Quote generated | Idempotent | No | Yes (before quote) | No |
| QUOTED | PENDING_PAYMENT | System | Points reserved (conceptual) | Inventory reserved (if tracked) | Points reserved | Idempotent | No | Yes | No |
| QUOTED | CANCELLED | Member, Admin | None | None | Quote abandoned | None | Yes | N/A | N/A |
| PENDING_PAYMENT | CONFIRMED | System | Points debited (-amount) | Inventory decremented | Debit recorded | Idempotent | No | No (after debit) | Yes |
| PENDING_PAYMENT | CANCELLED | Member, Admin | Release reserved points | Release inventory | Reservation released | None | Yes | N/A | N/A |
| CONFIRMED | PROCESSING | System, Admin | None | None | Fulfilment started | Retry on failure | No | No | Yes |
| CONFIRMED | FULFILLED | System (digital auto) | None | None | Auto-fulfilled | Idempotent | Yes (digital) | No | Yes |
| PROCESSING | FULFILLED | System, Admin | None | None | Fulfilled | Idempotent | Yes | No | Yes |
| PROCESSING | FAILED | System | None | None | Fulfilment failed | Retry if configured | No | No | Yes (auto) |
| FAILED | REFUND_PENDING | System | None | None | Refund initiated | Idempotent | No | No | Yes |
| REFUND_PENDING | REFUNDED | System | Refund entry (+amount) | None (inventory already consumed or released) | Refund executed | Idempotent | Yes | No | N/A |
| CONFIRMED | CANCELLED | Admin | Refund entry | Inventory restored | Cancelled | None | Yes | N/A | N/A |
| PROCESSING | CANCELLED | Admin | Refund entry | Inventory restored | Cancelled | None | Yes | N/A | N/A |

### 20.4 State Rules

| Rule | Constraint |
|---|---|
| **CONFIRMED is one-way** | Once CONFIRMED, the order cannot return to QUOTED or DRAFT |
| **FULFILLED is terminal** | Digital fulfilment is typically terminal (no cancellation post-fulfilment) |
| **CANCELLED is terminal** | Once CANCELLED, the order cannot be re-activated |
| **FAILED requires manual review** | Failed fulfilment enters a manual review state before refund (or auto-refund if configured) |
| **REFUNDED is terminal** | Refunded orders cannot be re-fulfilled |
| **REFUNDED wallet effect** | Always a compensating entry — original debit is NOT modified |

### 20.5 Contested / OPEN States

| State | Issue | OD Reference |
|---|---|---|
| `DRAFT` | Whether a draft order should be persisted before quote | OD-05 |
| `PENDING_PAYMENT` | Only applicable if Option B (Reservation) is adopted | OD-05 |
| `PROCESSING` | Whether PROCESSING can be skipped for auto-fulfilment (digital) | Design: yes, can transition CONFIRMED→FULFILLED directly |
| `FAILED` | Whether FAILED auto-refunds or requires admin review | OD-26 |

---

## 21. Inventory

### 21.1 Inventory Model

Three inventory modes are supported:

| Mode | Description | Applicable Items |
|---|---|---|
| `UNLIMITED` | No inventory tracking; any quantity is available | Digital vouchers (typically) |
| `TRACKED` | Physical inventory is tracked; available = total - reserved - fulfilled | Physical goods |
| `ON_DEMAND` | No pre-existing inventory; item is produced on order | Service items, made-to-order items |

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

| Operation | Effect |
|---|---|
| Quote | No inventory reservation |
| Confirm (with reservation) | `reserved_quantity += quantity` |
| Confirm final | `reserved_quantity -= quantity; fulfilled_quantity += quantity` |
| Cancellation (before fulfilment) | `reserved_quantity -= quantity` |
| Cancellation (after fulfilment started) | `fulfilled_quantity -= quantity` (or kept, depending on item return rule) |
| Reservation expiry | `reserved_quantity -= quantity` |

---

## 22. Inventory Reservation

### 22.1 Oversell Prevention

| Mechanism | Description |
|---|---|
| **Optimistic lock** | `redemption_inventory.version` is checked during updates. If another transaction modified the inventory concurrently, the current transaction fails with `INVENTORY_VERSION_CONFLICT`. |
| **CHECK constraint** | `CHECK(reserved_quantity + fulfilled_quantity <= total_quantity)` for TRACKED items |
| **Confirm-time recheck** | Even if quote showed sufficient inventory, the confirm step rechecks available inventory |

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

| Option | Description |
|---|---|
| **A: Platform pays** | Shipping cost is borne by iPoint; member only pays points |
| **B: Member pays** | Member pays shipping fee separately (fiat or additional points) |
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

| Type | Example | Delivery Method |
|---|---|---|
| Voucher Code | Promo code, gift card | Display in order history, email |
| Barcode/QR | Event ticket | Display in member app, downloadable |
| Claim Link | Digital content download | Link in order history, email |
| Activation | Service activation (eSIM, subscription) | System-to-system integration |

### 24.3 Voucher Expiry (see OD-09, OD-10)

| Rule | Issue |
|---|---|
| Does the voucher itself have an expiry date? | OD-09: Digital Voucher Expiry |
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

| State | Member Cancellable? | Admin Cancellable? | System Cancellable? |
|---|---|---|---|
| DRAFT | ✅ | ✅ | ✅ (on session expiry) |
| QUOTED | ✅ | ✅ | ✅ (on quote expiry) |
| PENDING_PAYMENT | ✅ (if Option B) | ✅ | ✅ (on reserve expiry) |
| CONFIRMED | ❌ (OD-11 PENDING) | ✅ | ❌ |
| PROCESSING | ❌ | ✅ | ✅ (on failure) |
| FULFILLED | ❌ | ❌ (post-fulfilment) | ❌ |
| FAILED | ❌ | ✅ (triggers refund) | ✅ (auto-refund if configured) |

### 26.2 Cancellation Pre-conditions

| Before debit | After debit |
|---|---|
| No wallet action needed | Wallet refund required |
| Release inventory reservation | Restore inventory (if item not yet fulfilled) |
| No points returned | Full point refund via compensating entry |

### 26.3 Cancellation Wallet Effect

- If cancelled **before** points are debited (QUOTED, PENDING_PAYMENT): no wallet entry needed.
- If cancelled **after** points are debited (CONFIRMED, PROCESSING): refund via compensating entry.
- If cancelled **after** fulfilment: refund is not automatic (dispute/return process — deferred).

---

## 27. Refund

### 27.1 Refund Rules

| Rule | Value |
|---|---|
| **Full Refund** | Exact opposite of original debit amount. Fully supported. |
| **Partial Refund** | OD-12 PENDING. If approved, refund portion only. |
| **Original Debit Immutability** | Original `REDEMPTION_DEBIT` entry is NEVER modified. Refund creates separate `REDEMPTION_REFUND` entry. |
| **Refund Idempotency** | Each refund request has a unique idempotency key. Duplicate requests return the same result. |

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

| Requirement | Rule |
|---|---|
| **KYC Level 2** | Required before any redemption (quoting, confirming, or order placement) |
| **KYC check timing** | Verified at confirm time |
| **KYC downgrade** | If member's KYC is downgraded after order confirmation, existing confirmed/filled orders are NOT affected. New redemption attempts are blocked. |

### 28.2 Member Status Checks

| Member Status | Redemption Allowed? |
|---|---|
| ACTIVE | ✅ |
| SUSPENDED | ❌ (existing confirmed orders continue through fulfilment) |
| CLOSED | ❌ (pending refunds are processed; no new orders) |
| PENDING_KYC | ❌ |

### 28.3 Eligibility at Confirm Time

The following eligibility checks are performed atomically at confirm time:

| Check | Rejection Code |
|---|---|
| Member exists and is ACTIVE | `MEMBER_NOT_ACTIVE` |
| KYC Level 2 completed | `KYC_LEVEL_2_REQUIRED` |
| Member not SUSPENDED or CLOSED | `MEMBER_SUSPENDED` or `MEMBER_CLOSED` |
| Item is active in current market's catalog | `ITEM_NOT_ACTIVE` |
| Item effective_from <= now <= effective_until | `ITEM_NOT_AVAILABLE` |
| Inventory sufficient (for TRACKED items) | `INVENTORY_INSUFFICIENT` |
| Wallet balance >= total point cost | `BALANCE_INSUFFICIENT` |
| Daily/monthly limit not exceeded | `LIMIT_EXCEEDED` |
| Quote is valid (not expired, version matches) | `QUOTE_EXPIRED` or `QUOTE_STALE` |

---

## 29. Limits

### 29.1 Daily / Monthly Limits (see OD-19)

| Limit Type | Scope | Default (CONFIGURABLE) |
|---|---|---|
| Daily total points | Per member per market | Configurable per market |
| Monthly total points | Per member per market | Configurable per market |
| Daily order count | Per member per market | Configurable per market |
| Per-order max points | Per order | Configurable per market |
| Per-order max quantity | Per order | Configurable per item |

### 29.2 Limit Reset

- Daily limits reset at **market-local 00:00** (same as Phase 3 reward settlement)
- Monthly limits reset at **market-local 1st of month 00:00**
- Limits are checked at **confirm time**

### 29.3 Limit Tables (Design)

```
redemption_member_limits
├── id (uuid, PK)
├── member_id (uuid, FK→members)
├── market_id (uuid, FK→markets)
├── date (date) — local date
├── period_type (varchar(8)) — 'DAILY', 'MONTHLY'
├── total_points_used (numeric(38,10))
├── order_count (numeric(38,0))
├── updated_at (timestamptz)

UNIQUE(member_id, market_id, date, period_type)
```

**Idempotency:** Limit updates are done within the same transaction as order confirmation. `INSERT ... ON CONFLICT UPDATE` to increment counts.

---

## 30. Admin Operations

### 30.1 Catalog Management

| Operation | Description | Maker/Checker Needed? |
|---|---|---|
| Create catalog item | Add new item to market catalog | No (OD-18 PENDING) |
| Update item details | Change name, description, image | No |
| Update item point cost | Change point cost (new version) | No |
| Enable/disable item | Toggle `is_active` | No |
| Delete item (soft) | Set effective_until to past | No |

### 30.2 Rate Management

| Operation | Description | Maker/Checker Needed? |
|---|---|---|
| Create new rate version | Add new rate with effective_from | No |
| Supersede rate | End current rate and activate new rate | No |
| Cancel pending rate | Remove a rate that hasn't taken effect | No |

### 30.3 Inventory Management

| Operation | Description | Maker/Checker Needed? |
|---|---|---|
| Adjust inventory | Increase/decrease total_quantity | OD-18 PENDING |
| Force release reservation | Release a stuck reservation | No |
| Override available | Directly set available count | OD-18 PENDING |

### 30.4 Order Administration

| Operation | Description |
|---|---|
| View all orders | Admin sees all orders across all members (with privacy projection — Section 38) |
| Cancel order | Admin can cancel any order in eligible states |
| Trigger refund | Admin can initiate refund for confirmed orders |
| Update fulfilment status | Admin can manually update fulfilment tracking |
| Force fulfil | Admin can mark a digital item as fulfilled |

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

| Operation | Maker/Checker Needed? | OD Reference |
|---|---|---|
| Refund (admin-initiated) | OD-17 PENDING | OD-17 |
| Inventory adjustment | OD-18 PENDING | OD-18 |
| Catalog item creation/update | Not recommended (low risk) | — |
| Rate change | Not recommended (prospective only) | — |
| Manual order modification | Not recommended | — |

---

## 32. Idempotency

### 32.1 Idempotency Patterns

Inheriting the domain-specific idempotency pattern from Phase 3/4.

| Operation | Idempotency Key | Guarantee |
|---|---|---|
| Quote generation | `quote:{member_id}:{item_id}:{quantity}` | Same quote returned for same params |
| Point reservation | `reserve:{member_id}:{item_id}:{quote_id}` | One active reservation per member-item |
| Order confirmation | `confirm:{quote_id}` | One confirmed order per quote |
| Refund | `refund:{order_id}:{admin_id}` | One refund per order (full) |
| Cancellation | `cancel:{order_id}` | One cancellation per order |
| Inventory adjustment | `inventory:{item_id}:{timestamp}` | One inventory change per operation |

### 32.2 Implementation Approach

- Domain-specific UNIQUE constraints on business tables (following Phase 3 pattern — Phase 3 chose Option A: business-table-level UNIQUE constraints only)
- No separate centralized idempotency table required for Phase 6
- UNIQUE constraints:

| Table | Constraints |
|---|---|
| `redemption_reservations` | `UNIQUE(member_id, item_id)` where status = 'ACTIVE' |
| `redemption_orders` | `UNIQUE(quote_id)` — one order per successful quote |
| `member_wallet_entries` | `UNIQUE(account_id, idempotency_key)` — existing Phase 3 constraint |

---

## 33. Concurrency

### 33.1 Race Conditions

| Race | Scenario | Prevention |
|---|---|---|
| **Wallet Balance Race** | Two concurrent confirm attempts from the same wallet | Lock wallet account before balance check |
| **Inventory Oversell** | Two concurrent confirm attempts for the same item | Lock inventory record before decrement |
| **Duplicate Confirm** | Same quote confirmed twice | UNIQUE constraint on `redemption_orders(quote_id)` |
| **Duplicate Cancellation** | Same order cancelled twice | Idempotency on `cancel:{order_id}` |
| **Duplicate Refund** | Same order refunded twice | UNIQUE constraint on wallet `reversal_of` + `entry_type` = 'REDEMPTION_REFUND' |
| **Reservation Expiry Race** | Reservation expires while confirm is in progress | Use `expires_at` + advisory lock; confirm checks expiry within the transaction |
| **Admin Manual Action Race** | Admin modifies inventory while confirm is in progress | Optimistic locking on `redemption_inventory.version` |

### 33.2 Concurrent Confirm Mitigation

For the critical race between concurrent redemption confirmations (wallet + inventory):

```
BEGIN TRANSACTION
  1. Acquire advisory lock on wallet_account.id
  2. Acquire advisory lock on inventory.id
  3. Read wallet balance (within lock)
  4. Check sufficient balance
  5. Read inventory available (within lock)
  6. Check sufficient inventory
  7. Insert wallet entry
  8. Update inventory (version check)
  9. Insert/update redemption order
  10. Update limits
COMMIT
(On any failure → ROLLBACK)
```

---

## 34. Lock Ordering

### 34.1 Proposed Lock Order

```
1. Redemption Order Advisory Lock (operation-specific)
2. Catalog Item Row Lock (version check)
3. Inventory Record Lock (row-level or advisory)
4. Wallet Account Advisory Lock
5. Wallet Ledger (no explicit lock — INSERT with UNIQUE constraint)
6. Member Limits Row Lock
7. Audit Insert (no lock required)
```

### 34.2 Phase 3 Compatibility Check

Phase 3 existing lock ordering (from P3-S1):

```
Phase 3 Lock Order (as documented):
1. Reward Plan
2. Wallet Account
3. Wallet Ledger
4. Reward Daily Accrual
```

**Conflict Analysis:**
- Phase 6 acquires `Wallet Account` after `Inventory`, Phase 3 acquires `Wallet Account` earlier in sequence.
- Both operations use advisory locks on `wallet_account.id`.
- **No deadlock risk identified** because Phase 6 operations (redemption confirm) and Phase 3 operations (reward accrual) are mutually exclusive in their resource acquisition paths:
  - Phase 6: order → catalog → inventory → **wallet** → ledger
  - Phase 3: reward plan → **wallet** → ledger → accrual
- The wallet lock is the common resource. Both acquire it as an exclusive lock. Since Phase 3 acquires it earlier (step 2) and Phase 6 acquires it later (step 4), and neither holds a diametrically opposite lock, deadlock is not expected.
- **Recommendation:** Keep wallet lock acquisition as `NOWAIT` or with short `lock_timeout` (e.g., 3 seconds, matching Phase 4's `lock_timeout` setting).

### 34.3 Phase 4 / Phase 5 Compatibility

Phase 4 lock ordering (transaction confirm):
1. Transaction ID lock
2. MCP Account
3. MCP Ledger
4. Commission processing (deferred to Phase 5)

Phase 5 lock ordering (commission calculation):
1. Commission Rate Version
2. Commission Ledger
3. Agent Activation Status

**No conflict with Phase 6:** Phase 6 locks wallet account (iPoint), while Phase 4/5 lock MCP/commission resources. These are different resource domains.

### 34.4 Lock Timeout Recommendation

| Lock Type | Timeout | Action on Timeout |
|---|---|---|
| Advisory lock (wallet) | 3 seconds | `LOCK_ACQUISITION_TIMEOUT` error |
| Advisory lock (inventory) | 3 seconds | `LOCK_ACQUISITION_TIMEOUT` error |
| Row-level lock (catalog item) | 3 seconds | `LOCK_ACQUISITION_TIMEOUT` error |
| Row-level lock (limits) | 3 seconds | `LOCK_ACQUISITION_TIMEOUT` error |

---

## 35. Atomic Transaction Boundary

### 35.1 Confirm Boundary

The following operations MUST occur within a single database transaction:

```
BEGIN TRANSACTION
├── (A) Check member eligibility (status, KYC, not suspended)
├── (B) Check item availability (active, effective range, not disabled)
├── (C) Check inventory sufficiency (TRACKED mode)
├── (D) Check wallet balance sufficiency
├── (E) Check daily/monthly limit not exceeded
├── (F) Validate quote (not expired, item version matches)
├── (G) Create wallet entry (entry_type = 'REDEMPTION_DEBIT')
├── (H) Update wallet account balance
├── (I) Decrement inventory (reserved or fulfilled)
├── (J) Insert/update redemption_order (state = CONFIRMED)
├── (K) Update daily/monthly limit counters
├── (L) Insert audit log entry
COMMIT
```

**Failure handling:** If any step (G-L) fails after (A-F) has passed, the entire transaction rolls back. No partial state is left. No phantom balance reduction.

### 35.2 Refund Boundary

```
BEGIN TRANSACTION
├── (A) Validate refund request (order exists, not already refunded)
├── (B) Create wallet entry (entry_type = 'REDEMPTION_REFUND', reversal_of)
├── (C) Update wallet account balance
├── (D) Update order status (REFUNDED)
├── (E) Restore inventory (if applicable)
├── (F) Insert audit log entry
COMMIT
```

### 35.3 Cancellation Boundary

```
BEGIN TRANSACTION
├── (A) Validate cancellation request
├── (B) IF points already debited:
│   ├── Create refund wallet entry
│   └── Update wallet account balance
├── (C) IF points reserved (not yet debited):
│   └── Release reservation (no wallet entry needed)
├── (D) Restore inventory (if previously reserved/decremented)
├── (E) Update order status (CANCELLED)
├── (F) Insert audit log entry
COMMIT
```

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
| Voucher codes (own) | Full code displayed | Full code visible |
| Voucher codes (other) | Not visible | Full code visible |
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
```

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
  status          VARCHAR(16) NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'ACTIVE', 'EXPIRED', 'SUPERSEDED')),
  created_by      UUID NOT NULL REFERENCES admin_users(id),
  approved_by     UUID REFERENCES admin_users(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### `redemption_reservations`

```sql
CREATE TABLE redemption_reservations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID NOT NULL REFERENCES members(id),
  market_id       UUID NOT NULL REFERENCES markets(id),
  item_id         UUID NOT NULL REFERENCES redemption_catalog_items(id),
  quantity        NUMERIC(38,0) NOT NULL,
  reserved_points NUMERIC(38,10) NOT NULL,
  rate_version_id UUID NOT NULL REFERENCES redemption_rate_versions(id),
  status          VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'CONFIRMED', 'RELEASED', 'EXPIRED')),
  expires_at      TIMESTAMPTZ NOT NULL,
  confirmed_at    TIMESTAMPTZ,
  released_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

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
                    CHECK (status IN ('DRAFT', 'QUOTED', 'PENDING_PAYMENT', 'CONFIRMED',
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

#### `redemption_member_limits`

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

| Table | Constraint | Purpose |
|---|---|---|
| `redemption_catalog_items` | `(market_id, sku)` — unique where non-null | SKU uniqueness per market |
| `redemption_inventory` | `(item_id)` — unique | One inventory record per item |
| `redemption_rate_versions` | `(market_id)` where status = 'ACTIVE' | Only one active rate per market |
| `redemption_reservations` | `(member_id, item_id)` where status = 'ACTIVE' | One active reservation per member-item |
| `redemption_orders` | `(order_number)` | Unique order number |
| `redemption_orders` | `(quote_id)` — unique where non-null | One order per confirmed quote |
| `redemption_member_limits` | `(member_id, market_id, local_date, period_type)` | One limit record per period |

### 41.2 Index Strategy

| Table | Index | Type | Purpose |
|---|---|---|---|
| `redemption_catalog_items` | `(market_id, is_active)` | B-tree | Catalog browsing by market |
| `redemption_catalog_items` | `(merchant_id)` | B-tree | Merchant-owned items lookup |
| `redemption_catalog_items` | `(tags)` | GIN | Tag-based search |
| `redemption_orders` | `(member_id, created_at)` | B-tree | Member order history |
| `redemption_orders` | `(status)` | Partial (where not terminal) | Active orders by status |
| `redemption_orders` | `(item_id, created_at)` | B-tree | Item popularity analysis |
| `redemption_reservations` | `(expires_at)` | B-tree | Expired reservation cleanup |
| `redemption_fulfilments` | `(status)` | B-tree | Pending fulfilment queue |
| `redemption_member_limits` | `(member_id, market_id, period_type)` | B-tree | Limit check queries |
| `redemption_rate_versions` | `(market_id, effective_from)` | B-tree | Rate version lookup |

---

## 42. Proposed APIs

### 42.1 Member APIs

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/redemption/catalog` | Browse active catalog for current market (filterable by type, tags) |
| `GET` | `/api/v1/redemption/catalog/:itemId` | Get item details |
| `GET` | `/api/v1/redemption/catalog/:itemId/quote?quantity=N` | Generate quote for item |
| `POST` | `/api/v1/redemption/orders` | Create redemption order (confirm after quote) |
| `GET` | `/api/v1/redemption/orders` | List member's redemption orders (paginated) |
| `GET` | `/api/v1/redemption/orders/:orderId` | Get order details |
| `POST` | `/api/v1/redemption/orders/:orderId/cancel` | Cancel an order (if eligible) |
| `GET` | `/api/v1/redemption/orders/:orderId/fulfilment` | Get fulfilment status |

### 42.2 Admin APIs

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/admin/redemption/catalog` | List all catalog items (admin view) |
| `POST` | `/api/v1/admin/redemption/catalog` | Create catalog item |
| `PUT` | `/api/v1/admin/redemption/catalog/:itemId` | Update catalog item |
| `DELETE` | `/api/v1/admin/redemption/catalog/:itemId` | Soft-delete catalog item |
| `GET` | `/api/v1/admin/redemption/catalog/:itemId/inventory` | Get inventory details |
| `PUT` | `/api/v1/admin/redemption/catalog/:itemId/inventory` | Adjust inventory |
| `GET` | `/api/v1/admin/redemption/rates` | List rate versions |
| `POST` | `/api/v1/admin/redemption/rates` | Create new rate version |
| `GET` | `/api/v1/admin/redemption/orders` | List all orders (admin view, filtered) |
| `GET` | `/api/v1/admin/redemption/orders/:orderId` | Get order detail |
| `POST` | `/api/v1/admin/redemption/orders/:orderId/cancel` | Admin cancel order |
| `POST` | `/api/v1/admin/redemption/orders/:orderId/refund` | Admin trigger refund |
| `PUT` | `/api/v1/admin/redemption/orders/:orderId/fulfilment` | Update fulfilment status |
| `GET` | `/api/v1/admin/redemption/members/:memberId/limits` | View member's limits |
| `PUT` | `/api/v1/admin/redemption/members/:memberId/limits` | Override member limits |

---

## 43. Error Codes

| HTTP Status | Code | Description |
|---|---|---|
| 400 | `REDEMPTION_INVALID_QUANTITY` | Quantity must be > 0 |
| 400 | `REDEMPTION_INVALID_ITEM_TYPE` | Item type not supported for this operation |
| 400 | `REDEMPTION_QUOTE_EXPIRED` | Quote has expired; regenerate |
| 400 | `REDEMPTION_QUOTE_STALE` | Item version changed since quote; regenerate |
| 400 | `REDEMPTION_ORDER_NOT_CANCELLABLE` | Order is not in a cancellable state |
| 400 | `REDEMPTION_ORDER_NOT_REFUNDABLE` | Order is not eligible for refund |
| 400 | `REDEMPTION_ALREADY_CANCELLED` | Order is already cancelled |
| 400 | `REDEMPTION_ALREADY_REFUNDED` | Order is already refunded |
| 401 | `REDEMPTION_AUTH_REQUIRED` | Authentication required |
| 403 | `REDEMPTION_MARKET_ACCESS_DENIED` | Member does not have access to this market's catalog |
| 403 | `KYC_LEVEL_2_REQUIRED` | Member must complete KYC Level 2 before redemption |
| 403 | `MEMBER_NOT_ACTIVE` | Member account is not ACTIVE |
| 403 | `MEMBER_SUSPENDED` | Member account is SUSPENDED |
| 403 | `MEMBER_CLOSED` | Member account is CLOSED |
| 404 | `REDEMPTION_ITEM_NOT_FOUND` | Catalog item not found |
| 404 | `REDEMPTION_ORDER_NOT_FOUND` | Redemption order not found |
| 404 | `REDEMPTION_RATE_NOT_FOUND` | Active redemption rate not found for market |
| 409 | `REDEMPTION_INVENTORY_INSUFFICIENT` | Not enough inventory available |
| 409 | `REDEMPTION_BALANCE_INSUFFICIENT` | Insufficient iPoint balance |
| 409 | `REDEMPTION_LIMIT_EXCEEDED` | Daily or monthly redemption limit exceeded |
| 409 | `REDEMPTION_INVENTORY_VERSION_CONFLICT` | Inventory was modified by another operation; retry |
| 409 | `REDEMPTION_RESERVATION_CONFLICT` | Only one active reservation per item allowed |
| 409 | `REDEMPTION_DUPLICATE_ORDER` | Order for this quote already exists |
| 409 | `LOCK_ACQUISITION_TIMEOUT` | Could not acquire lock within timeout |
| 422 | `REDEMPTION_ITEM_NOT_ACTIVE` | Item is not currently active in catalog |
| 422 | `REDEMPTION_ITEM_NOT_AVAILABLE` | Item is outside its effective date range |
| 422 | `REDEMPTION_ITEM_DISABLED` | Item has been disabled by admin |
| 500 | `REDEMPTION_INTERNAL_ERROR` | Unexpected internal error |
| 503 | `REDEMPTION_SERVICE_UNAVAILABLE` | Redemption service temporarily unavailable |

---

## 44. Acceptance Test Matrix

### 44.1 Catalog Visibility

| # | Test | Expected |
|---|---|---|
| T-01 | Member in Market MY sees MY catalog only | Items from other markets NOT visible |
| T-02 | Disabled catalog item not visible to members | Item hidden from catalog |
| T-03 | Expired item (effective_until passed) not visible | Item hidden from catalog |
| T-04 | Featured items appear with featured indicator | UI shows featured items |

### 44.2 Market Isolation

| # | Test | Expected |
|---|---|---|
| T-05 | Member cannot browse SG catalog from MY market | Access denied |
| T-06 | Admin can browse all market catalogs | Admin sees all markets' items |
| T-07 | Each market has independent rate configuration | SG rate change does not affect MY rate |

### 44.3 Rate Snapshot

| # | Test | Expected |
|---|---|---|
| T-08 | Rate snapshot is stored in order record | `order.snapshot.rate_value` matches rate at confirm time |
| T-09 | Rate change after confirm does NOT affect historical order | Historical order retains original rate |
| T-10 | Rate change before confirm affects new confirm only | New confirms use new rate; old quotes using old rate show QUOTE_STALE |

### 44.4 Quote Expiry

| # | Test | Expected |
|---|---|---|
| T-11 | Confirm with valid quote succeeds | Order created successfully |
| T-12 | Confirm with expired quote rejected | `QUOTE_EXPIRED` error |
| T-13 | Confirm with stale quote (item version changed) rejected | `QUOTE_STALE` error |

### 44.5 Successful Redemption

| # | Test | Expected |
|---|---|---|
| T-14 | Member with sufficient balance confirms redemption | Order CONFIRMED, wallet debited, inventory decremented |
| T-15 | Order creates correct wallet entry | `entry_type = 'REDEMPTION_DEBIT'`, amount = -total_points |

### 44.6 Insufficient Balance

| # | Test | Expected |
|---|---|---|
| T-16 | Member with insufficient balance cannot confirm | `BALANCE_INSUFFICIENT` error |
| T-17 | No partial state left on rejection | No wallet entry, no inventory change, no order |

### 44.7 Concurrent Redemption

| # | Test | Expected |
|---|---|---|
| T-18 | Two concurrent confirm attempts for same wallet/balance | Only one succeeds; second fails |
| T-19 | Two concurrent confirm attempts for same inventory item | Only one decrements inventory; second fails |

### 44.8 Inventory Oversell Prevention

| # | Test | Expected |
|---|---|---|
| T-20 | Confirm when inventory = 1 with 2 concurrent requests | One succeeds, one fails with `INVENTORY_INSUFFICIENT` |
| T-21 | Confirm after inventory reaches 0 | `INVENTORY_INSUFFICIENT` error |

### 44.9 Idempotent Confirm Replay

| # | Test | Expected |
|---|---|---|
| T-22 | Same confirm request sent twice | Same order returned; no duplicate wallet entry |
| T-23 | Same confirm with idempotency key returns original result | Consistent response |

### 44.10 Idempotency Mismatch

| # | Test | Expected |
|---|---|---|
| T-24 | Same idempotency key, different payload | Rejected (or returns original result — CONFIGURABLE) |

### 44.11 Cancellation

| # | Test | Expected |
|---|---|---|
| T-25 | Cancel QUOTED order before debit | Order CANCELLED, no wallet effect |
| T-26 | Cancel CONFIRMED order | Order CANCELLED, wallet refunded, inventory restored |
| T-27 | Cancel already-cancelled order | `ALREADY_CANCELLED` error |

### 44.12 Reservation Release

| # | Test | Expected |
|---|---|---|
| T-28 | Expired reservation releases points (conceptual for Option B) | Reservation status = EXPIRED |
| T-29 | Cancellation before debit releases reservation | Inventory restored |

### 44.13 Full Refund

| # | Test | Expected |
|---|---|---|
| T-30 | Refund CONFIRMED order | Wallet receives `REDEMPTION_REFUND` entry with exact opposite amount |
| T-31 | Duplicate refund request | Returns existing refund; no duplicate entry |

### 44.14 Exact-opposite Refund

| # | Test | Expected |
|---|---|---|
| T-32 | Refund amount = -(original debit amount) | Amounts match exactly |
| T-33 | `reversal_of` links to original wallet entry | FK points to original entry |

### 44.15 Original Debit Immutability

| # | Test | Expected |
|---|---|---|
| T-34 | After refund, original REDEMPTION_DEBIT entry unchanged | Entry is intact; refund is separate record |
| T-35 | Cannot modify or delete original debit entry | DB constraint prevents mutation |

### 44.16 Digital Fulfilment

| # | Test | Expected |
|---|---|---|
| T-36 | Digital item confirmed → auto-fulfilled | Order transitions CONFIRMED→FULFILLED |
| T-37 | Voucher code generated and stored | Fulfilment record contains digital_value |

### 44.17 Physical Fulfilment

| # | Test | Expected |
|---|---|---|
| T-38 | Physical item confirmed → PROCESSING | Fulfilment record created with PENDING status |
| T-39 | Admin marks as fulfilled → FULFILLED | Status updated, timestamp recorded |

### 44.18 Failed Fulfilment

| # | Test | Expected |
|---|---|---|
| T-40 | Fulfilment failure triggers refund | Order → FAILED → REFUND_PENDING → REFUNDED |
| T-41 | Points returned to wallet | Wallet refund entry created |

### 44.19 KYC Rejection

| # | Test | Expected |
|---|---|---|
| T-42 | Member without KYC Level 2 tries to quote | `KYC_LEVEL_2_REQUIRED` |
| T-43 | Member without KYC Level 2 tries to confirm | `KYC_LEVEL_2_REQUIRED` |

### 44.20 Suspended Member

| # | Test | Expected |
|---|---|---|
| T-44 | Suspended member tries to quote/confirm | `MEMBER_SUSPENDED` |
| T-45 | Existing confirmed order continues for suspended member | Fulfilment proceeds normally |

### 44.21 Cross-market Rejection

| # | Test | Expected |
|---|---|---|
| T-46 | Member in MY tries to browse SG catalog | Access denied |
| T-47 | Cross-market redemption (if not approved) | `MARKET_ACCESS_DENIED` |

### 44.22 Admin Rate Change

| # | Test | Expected |
|---|---|---|
| T-48 | Admin creates new rate version | Rate becomes effective at effective_from |
| T-49 | New confirm uses new rate | Point cost recalculated |
| T-50 | Historical order retains old rate snapshot | Snapshot unchanged |

### 44.23 Historical Order Stability

| # | Test | Expected |
|---|---|---|
| T-51 | Item point cost changed → existing orders unaffected | Snapshot retains original point cost |
| T-52 | Item deleted → existing orders still visible | Order retains snapshot data |

### 44.24 Concurrent Refund

| # | Test | Expected |
|---|---|---|
| T-53 | Two concurrent refund requests | One succeeds; second detects already refunded |

### 44.25 Atomic Rollback

| # | Test | Expected |
|---|---|---|
| T-54 | Confirm fails after wallet entry but before inventory update | Full rollback; wallet restored |
| T-55 | Confirm fails at any step | No partial state visible |

### 44.26 Audit Completeness

| # | Test | Expected |
|---|---|---|
| T-56 | Every order mutation has corresponding audit entry | Audit log complete |
| T-57 | Audit links to redemption order and wallet entry | Correlation chain intact |

### 44.27 Privacy Projection

| # | Test | Expected |
|---|---|---|
| T-58 | Member sees own full order details | Full view |
| T-59 | Member cannot see another member's orders | 403 or 404 |
| T-60 | Admin sees masked personal data for other members | Name/phone partially masked |

### 44.28 Fraud Limit

| # | Test | Expected |
|---|---|---|
| T-61 | Member exceeds daily limit | `LIMIT_EXCEEDED` |
| T-62 | Member exceeds monthly limit | `LIMIT_EXCEEDED` |
| T-63 | Rate-limited quote requests | Throttled |

### 44.29 Maker/Checker

| # | Test | Expected |
|---|---|---|
| T-64 | (If approved) Refund without Checker approval | Rejected |
| T-65 | (If approved) Inventory adjustment without Checker approval | Rejected |

---

## 45. Deferred Scope

The following items are explicitly deferred from Phase 6 MVP and must NOT be implemented without a new authorization:

| # | Item | Reason |
|---|---|---|
| D-01 | Cash withdrawal | Not a redemption feature; requires financial license |
| D-02 | Bank withdrawal | Not a redemption feature |
| D-03 | Agent Commission Payout | Per Phase 5 deferred scope |
| D-04 | Wallet cash-out | Not a redemption feature |
| D-05 | Five-level team reward | Per MVP Roadmap deferred scope |
| D-06 | Merchant settlement for redeemed items | OD-25 PENDING |
| D-07 | Redemption commission for agent referrals | OD-29 PENDING |
| D-08 | Cart/multi-item checkout | Single-item redemption per order (MVP scope) |
| D-09 | Bulk redemption API | Not needed for MVP |
| D-10 | Wishlist / favorites | Not needed for MVP |
| D-11 | Rating and reviews | Not needed for MVP |
| D-12 | Recommendation engine | Not needed for MVP |
| D-13 | Cross-market wallet transfer | Per Project Master Control deferred scope |
| D-14 | Expired points handling | Per Phase 3 deferred scope |
| D-15 | Tax/invoice handling | OD-20 PENDING; not a Phase 6 MVP concern |
| D-16 | Dispute process | OD-30 PENDING; requires admin workflow beyond Phase 6 scope |
| D-17 | Backorder / waitlist | OD-27 PENDING |

---

## 46. Bryan Open Decisions (OD-01 through OD-30)

All decisions below have **Bryan Decision: PENDING**. No decision in this section is APPROVED.

---

### OD-01: Catalog Ownership

| Field | Value |
|---|---|
| **Question** | Who owns the items in the Redemption Catalog? |
| **Option A** | **Platform-only**: All catalog items are owned and fulfilled by the iPoint platform. Merchants do not list items. |
| **Option B** | **Platform + Merchant**: Platform-owned and merchant-owned items coexist in the same catalog. |
| **Option C** | **Merchant-only**: Only merchants list items for redemption. Platform provides infrastructure only. |
| **Recommendation** | Option A for MVP (simplest). Option B for post-MVP growth. |
| **Business Impact** | A: Platform controls quality and fulfilment. B: Broader catalog, faster growth. C: High merchant engagement but complex quality control. |
| **Technical Impact** | A: Simple (no merchant integration). B: Requires merchant_id FK, merchant eligibility checks. C: Requires full merchant onboarding for catalog. |
| **Financial Risk** | A: Platform bears cost of goods and fulfilment. B: Shared cost model. |
| **Operational Risk** | A: Platform needs fulfilment infrastructure. B: Merchant fulfilment quality varies. |
| **Bryan Decision** | **PENDING** |

---

### OD-02: Merchant-owned Items

| Field | Value |
|---|---|
| **Question** | If merchant-owned items are approved (OD-01 Option B), what are the rules? |
| **Option A** | Merchant-owned items require admin approval before listing. |
| **Option B** | Merchant-owned items are auto-approved (within guidelines). |
| **Option C** | Merchant-owned items not permitted in MVP. |
| **Recommendation** | Option C for MVP. Defer merchant-owned items to post-MVP. |
| **Business Impact** | A/B: More catalog variety. C: Simpler. |
| **Technical Impact** | A/B: Requires merchant approval workflow. |
| **Bryan Decision** | **PENDING** |

---

### OD-03: Cross-market Redemption

| Field | Value |
|---|---|
| **Question** | Can a member redeem items from a market different from their current/wallet market? |
| **Option A** | **No cross-market redemption**: Member can only redeem from their current market's catalog. |
| **Option B** | **Yes, limited**: Member can redeem from another market but must have a wallet in that market with sufficient balance. |
| **Option C** | **Yes, full**: Member can redeem from any market; points converted at applicable rate. |
| **Recommendation** | Option A for MVP. Keeps market isolation clean. |
| **Business Impact** | A: Simple, aligns with "One Market = One Wallet = One Catalog" principle. B: More flexibility. C: Complex FX/cross-rate issues. |
| **Technical Impact** | A: Simple catalog isolation. B: Multi-market balance checks. C: FX conversion. |
| **Bryan Decision** | **PENDING** |

---

### OD-04: Debit Wallet Market

| Field | Value |
|---|---|
| **Question** | Which market's wallet is debited during redemption? |
| **Option A** | **Current Market**: The member's current browsing market determines which wallet is debited. |
| **Option B** | **Account Country**: The member's account country market determines which wallet is debited. |
| **Option C** | **Member Choice**: Member selects the wallet market at order time. |
| **Recommendation** | Option A (Current Market). Simplest, most intuitive for users. Aligns with the principle that "what you see is what you pay with." |
| **Business Impact** | A: Aligns catalog browsing with wallet debit. B: Points earned in home country stay in home country. C: Flexible but confusing. |
| **Technical Impact** | A: Current Market is already tracked. B: Need to look up account country wallet. C: UI complexity. |
| **Financial Risk** | A: Member could switch to a market with favorable rate, redeem from that market's wallet. B: Points stay in earning market. |
| **Operational Risk** | A: Low. B: Low. C: Higher support costs. |
| **Bryan Decision** | **PENDING** |

---

### OD-05: Point Reservation

| Field | Value |
|---|---|
| **Question** | Should points be reserved (temporarily held) before final confirmation, or debited directly on confirmation? |
| **Option A** | **Direct Confirm Debit**: No reservation. Check balance and debit atomically. |
| **Option B** | **Reserve → Confirm / Release**: Points are reserved on quote/initiation, then either confirmed (debited) or released. |
| **Recommendation** | Option A (Direct Confirm) for digital items. Option B (Reservation) for physical items where address entry causes delay. Or hybrid: Option A for MVP. |
| **Business Impact** | A: Simpler UX, less state. B: Guarantees point availability during address/checkout flow. |
| **Technical Impact** | A: Simpler implementation. B: Reservation expiry management, more states. |
| **Financial Risk** | A: None. B: Temporary hold reduces spending capacity. |
| **Operational Risk** | A: Low. B: Reservation expiry cleanup. |
| **Bryan Decision** | **PENDING** |

---

### OD-06: Reservation Expiry

| Field | Value |
|---|---|
| **Question** | If reservation is adopted (OD-05 Option B), what is the TTL for a point reservation? |
| **Option A** | 15 minutes |
| **Option B** | 30 minutes |
| **Option C** | Configurable per market |
| **Recommendation** | Option C (Configurable), default 15 minutes. |
| **Business Impact** | Short TTL = less blocked points. Long TTL = better user experience. |
| **Technical Impact** | Requires background job for expiry cleanup. |
| **Bryan Decision** | **PENDING** |

---

### OD-07: Physical Shipping Fee

| Field | Value |
|---|---|
| **Question** | Who pays for shipping of physical redemption items? |
| **Option A** | **Platform pays**: Shipping cost is borne by iPoint. Member only pays points. |
| **Option B** | **Member pays**: Member pays shipping fee separately (fiat or additional points). |
| **Option C** | **Free above threshold**: Free shipping above a minimum point threshold; otherwise member pays. |
| **Recommendation** | Option A for MVP (simplest, best member experience). Option C for cost optimization. |
| **Business Impact** | A: Platform bears cost. B: May reduce redemption. C: Encourages higher-value redemptions. |
| **Technical Impact** | A: No additional integration. B: Payment collection required. C: Threshold logic. |
| **Financial Risk** | A: Shipping costs. B: May discourage redemptions. |
| **Bryan Decision** | **PENDING** |

---

### OD-08: Store Pickup

| Field | Value |
|---|---|
| **Question** | Should physical items support in-store pickup as an alternative to shipping? |
| **Option A** | **No store pickup**: All physical items shipped. |
| **Option B** | **Yes, merchant-specific**: Pickup at merchant locations for merchant-owned items. |
| **Option C** | **Yes, platform-specific**: Pickup at designated platform pickup points. |
| **Recommendation** | Option A for MVP. |
| **Business Impact** | A: Simple. B/C: More flexibility but operational complexity. |
| **Technical Impact** | A: No additional flow. B/C: Pickup location management. |
| **Bryan Decision** | **PENDING** |

---

### OD-09: Digital Voucher Expiry

| Field | Value |
|---|---|
| **Question** | Do digital vouchers (redeemed items) have an expiry date? |
| **Option A** | **No expiry**: Voucher is valid indefinitely. |
| **Option B** | **Fixed expiry**: All vouchers expire N days/months after redemption. |
| **Option C** | **Item-specific expiry**: Each item defines its own voucher validity period. |
| **Recommendation** | Option C (Item-specific), default 12 months. |
| **Business Impact** | A: No expiry pressure. B: Standard policy. C: Flexible per item. |
| **Technical Impact** | C: Add expiry field to item and fulfilment records. |
| **Bryan Decision** | **PENDING** |

---

### OD-10: Expired Voucher Refund

| Field | Value |
|---|---|
| **Question** | If a voucher expires (OD-09), are the points refunded to the member? |
| **Option A** | **No refund**: Points are forfeited on voucher expiry. |
| **Option B** | **Full refund**: Points returned when voucher expires. |
| **Option C** | **Partial refund**: Points returned minus a fee on expiry. |
| **Recommendation** | Option A (No refund). Standard industry practice for loyalty points. |
| **Business Impact** | A: Points liability reduces. B: Member-friendly but increases liability. |
| **Financial Risk** | A: Lower platform liability. B: Higher points liability. |
| **Bryan Decision** | **PENDING** |

---

### OD-11: Cancellable States

| Field | Value |
|---|---|
| **Question** | Which states allow member-initiated cancellation? |
| **Option A** | **Pre-debit only**: QUOTED, PENDING_PAYMENT (before points debited). |
| **Option B** | **Pre-fulfilment**: QUOTED, PENDING_PAYMENT, CONFIRMED, PROCESSING (as long as not yet fulfilled). |
| **Option C** | **Any time**: All states except FULFILLED (after fulfilment, return-to-sender process instead). |
| **Recommendation** | Option A for MVP. Member cancels only before points are debited. Admin can cancel any time. |
| **Business Impact** | A: Simple. B: More member-friendly. C: Full flexibility. |
| **Technical Impact** | A: Refund only for admin cancellations. B: Refund for member cancellations too. |
| **Financial Risk** | A: Lower. B: Higher if members abuse cancellation after getting digital voucher. |
| **Bryan Decision** | **PENDING** |

---

### OD-12: Partial Refund

| Field | Value |
|---|---|
| **Question** | Should partial refunds be supported (refund a portion of the points for partially fulfilled orders)? |
| **Option A** | **No partial refund**: Only full refund of the entire order. |
| **Option B** | **Yes, admin-only**: Admin can specify partial refund amount. |
| **Option C** | **Yes, auto-proportional**: Refund proportional to unfulfilled quantity. |
| **Recommendation** | Option A for MVP. Partial refund adds significant complexity. |
| **Business Impact** | A: Simple, all-or-nothing. B: Flexibility for edge cases. C: Fair for partial fulfilment. |
| **Technical Impact** | A: Single refund entry. B: Refund amount input + validation. C: Proportional calculation. |
| **Financial Risk** | A: May over-refund in partial-failure scenarios. |
| **Bryan Decision** | **PENDING** |

---

### OD-13: Out-of-stock Auto Refund

| Field | Value |
|---|---|
| **Question** | If an item is confirmed but subsequently found to be out of stock, what happens? |
| **Option A** | **Auto-refund**: System automatically cancels and refunds. |
| **Option B** | **Admin review**: Admin reviews and decides whether to refund or offer alternatives. |
| **Option C** | **Backorder**: Allow backorder/waitlist (see OD-27). |
| **Recommendation** | Option A (Auto-refund) for MVP. If inventory tracking is reliable, this scenario should be rare. |
| **Business Impact** | A: Best member experience. B: Admin workload. C: Member-friendly but complex. |
| **Technical Impact** | A: Automated refund flow. |
| **Bryan Decision** | **PENDING** |

---

### OD-14: Fulfilment SLA

| Field | Value |
|---|---|
| **Question** | What is the service-level agreement for fulfillment of redemption orders? |
| **Option A** | **No formal SLA**: Fulfilment time is communicated but not enforced by system. |
| **Option B** | **Configurable SLA**: Admin configures target fulfilment time per market/item type. |
| **Option C** | **Enforced SLA with auto-escalation**: System alerts if SLA breached. |
| **Recommendation** | Option A for MVP. Option B for Phase 7+ (Admin Operations). |
| **Business Impact** | A: Simple. B: Accountability. C: Escalation and support workflows. |
| **Technical Impact** | A: No SLA logic. B: SLA config. C: SLA monitoring + escalation. |
| **Bryan Decision** | **PENDING** |

---

### OD-15: KYC Level 2

| Field | Value |
|---|---|
| **Question** | Is KYC Level 2 a hard prerequisite for all redemption operations? |
| **Option A** | **Yes, unconditional**: KYC Level 2 required for all redemption operations including browsing. |
| **Option B** | **Yes, for confirm only**: Browsing allowed without KYC Level 2; only confirm requires it. |
| **Option C** | **No KYC Level 2 required**: Any member can redeem (not recommended). |
| **Recommendation** | Option B (KYC Level 2 required at confirm only). Aligns with Member PRD and Design System. |
| **Business Impact** | A: May discourage browsing. B: Encourages browsing, captures intent. |
| **Technical Impact** | A: Catalog check. B: Confirm-level check. |
| **Compliance** | KYC Level 2 per Design System: "KYC required before redemption or agent upgrade." |
| **Bryan Decision** | **PENDING** |

---

### OD-16: High-value Review

| Field | Value |
|---|---|
| **Question** | Should high-value redemption orders require manual admin review before processing? |
| **Option A** | **No review**: All orders process automatically. |
| **Option B** | **Threshold-based review**: Orders above a configurable point threshold require admin approval. |
| **Option C** | **Risk-based review**: Suspect or unusual orders flagged for review. |
| **Recommendation** | Option A for MVP. Add Option B in Phase 7 (Admin Operations). |
| **Business Impact** | A: Immediate fulfilment. B: Fraud prevention for high-value items. |
| **Technical Impact** | A: Simple flow. B: Approval state + notification. |
| **Financial Risk** | A: Risk of large fraudulent redemptions. B: Mitigated. |
| **Bryan Decision** | **PENDING** |

---

### OD-17: Refund Maker / Checker

| Field | Value |
|---|---|
| **Question** | Should admin-initiated refunds require Maker/Checker dual approval? |
| **Option A** | **No Maker/Checker**: Any authorized admin can initiate refund. |
| **Option B** | **Yes, Maker/Checker**: Refund requires one admin to initiate and another to approve. |
| **Recommendation** | Option B (Maker/Checker). Refund is equivalent to a manual iPoint credit, which falls under the Admin PRD's Maker/Checker rule for manual iPoint adjustments. |
| **Business Impact** | A: Faster refunds. B: Stronger internal controls. |
| **Technical Impact** | A: Simple. B: Refund approval workflow. |
| **Financial Risk** | A: Higher risk of unauthorized refunds. B: Lower. |
| **Operational Risk** | A: Requires trust in individual admins. B: Dual control. |
| **Bryan Decision** | **PENDING** |

---

### OD-18: Inventory Maker / Checker

| Field | Value |
|---|---|
| **Question** | Should inventory adjustments require Maker/Checker dual approval? |
| **Option A** | **No Maker/Checker**: Any authorized admin can adjust inventory. |
| **Option B** | **Yes, Maker/Checker**: Inventory adjustments require approval workflow. |
| **Recommendation** | Option A for MVP. Inventory adjustments are lower risk than financial adjustments. |
| **Business Impact** | A: Faster inventory management. B: Stronger control. |
| **Financial Risk** | A: Inventory manipulation could enable fraud. B: Mitigated. |
| **Bryan Decision** | **PENDING** |

---

### OD-19: Daily / Monthly Limits

| Field | Value |
|---|---|
| **Question** | Should per-member daily and monthly redemption limits be enforced? |
| **Option A** | **No limits**: Members can redeem any amount at any time (subject to wallet balance). |
| **Option B** | **Soft limits**: Limits warn but don't block. |
| **Option C** | **Hard limits**: Limits strictly enforced. Configurable per market. |
| **Recommendation** | Option C (Hard limits, configurable per market). Industry standard for loyalty programs. Default: 50,000 points/day, 500,000 points/month. |
| **Business Impact** | A: Maximum member flexibility. C: Fraud prevention, liability control. |
| **Technical Impact** | C: Limit tracking tables + check logic. |
| **Financial Risk** | A: Platform exposed to rapid point burn. C: Controlled exposure. |
| **Bryan Decision** | **PENDING** |

---

### OD-20: Tax / Invoice Responsibility

| Field | Value |
|---|---|
| **Question** | Who is responsible for tax reporting and invoice issuance for redeemed items? |
| **Option A** | **Platform handles everything**: iPoint issues invoices and handles tax. |
| **Option B** | **Merchant handles for merchant-owned items**: Merchant issues invoices for their items. |
| **Option C** | **No invoicing in MVP**: Defer to Phase 9 (Reporting, Risk & Audit). |
| **Recommendation** | Option C (Defer). Tax/invoice handling is not a Phase 6 MVP concern. |
| **Business Impact** | A/B: Compliance requirement. C: Must revisit before production. |
| **Technical Impact** | A: Invoice generation. B: Merchant invoice requirements. |
| **Compliance** | Local tax laws may require specific handling. Must consult legal before production. |
| **Bryan Decision** | **PENDING** |

---

### OD-21: Fixed Point Cost vs Rate Conversion

| Field | Value |
|---|---|
| **Question** | Should catalog items use fixed point costs (manually set) or derive point costs from a rate conversion of fiat value? |
| **Option A** | **Fixed Point Cost**: Admin sets the point cost directly on each item. Rate is for display/context only. |
| **Option B** | **Rate Conversion**: Point cost = `fiat_reference_value / rate`. Changes to rate automatically affect point costs. |
| **Option C** | **Hybrid**: Default is rate conversion, but individual items can have fixed overrides. |
| **Recommendation** | Option A (Fixed Point Cost). Simpler, more predictable for members and admin. Rate is for display and reference. |
| **Business Impact** | A: Predictable pricing. B: Automatic adjustment when rate changes. C: Flexible. |
| **Technical Impact** | A: Simple point_cost field. B: Point cost recalculated on every quote. C: Override logic. |
| **Operational Risk** | A: Admin must manually update point costs if rates change significantly. |
| **Bryan Decision** | **PENDING** |

---

### OD-22: Rate Effective Time

| Field | Value |
|---|---|
| **Question** | When is the redemption rate locked? |
| **Option A** | **At quote time**: The rate effective at quote generation is locked for the quote's duration. |
| **Option B** | **At confirm time**: The rate effective at the moment of confirmation is used. |
| **Option C** | **Configurable**: Per-market or per-item configuration. |
| **Recommendation** | Option A (At quote time). Provides predictability for the member during the checkout flow. |
| **Business Impact** | A: Member knows exact cost before committing. B: Rate change could surprise member. |
| **Technical Impact** | A: Rate version is captured in quote. B: Re-checked at confirm. |
| **Financial Risk** | A: Small window of rate-lock exposure. B: No exposure. |
| **Bryan Decision** | **PENDING** |

---

### OD-23: Promotional Rate

| Field | Value |
|---|---|
| **Question** | Should the system support promotional/discount rates for specific items or periods? |
| **Option A** | **No promotional rate**: One rate for all items, no discounts. |
| **Option B** | **Item-level discount**: Admin can set a promotional point cost per item, with date range. |
| **Option C** | **Global promotion**: Time-limited global point cost multiplier (e.g., 20% off all items). |
| **Recommendation** | Option B for Phase 7+. Defer to Admin Operations. Option A for MVP. |
| **Business Impact** | B/C: Marketing opportunities. |
| **Technical Impact** | B: Promotional pricing fields. C: Multiplier logic. |
| **Bryan Decision** | **PENDING** |

---

### OD-24: Voucher Code Custody

| Field | Value |
|---|---|
| **Question** | How are digital voucher codes stored and delivered? |
| **Option A** | **Platform-generated**: Codes are pre-loaded into the system by admin. System assigns on order. |
| **Option B** | **External API**: System calls an external API to generate or retrieve codes on demand. |
| **Option C** | **Manual delivery**: Admin manually delivers voucher code to member after order confirmation. |
| **Recommendation** | Option A (Platform-generated) for MVP. Admin pre-loads code batches. |
| **Business Impact** | A: Full control. B: Integration dependency. C: Labor-intensive. |
| **Technical Impact** | A: Code batch table. B: API integration. C: No code generation system. |
| **Security** | Codes must be stored securely (hashed or encrypted at rest). |
| **Bryan Decision** | **PENDING** |

---

### OD-25: Merchant Settlement

| Field | Value |
|---|---|
| **Question** | Should iPoint settle with merchants for merchant-owned items redeemed by members? |
| **Option A** | **No settlement**: Members redeem points, merchants are not compensated by platform. The merchant benefit is promotional/advertising. |
| **Option B** | **Fiat settlement**: Platform pays merchant a fiat amount for each redeemed item (purchase of merchant's goods at wholesale/reduced rate). |
| **Option C** | **Point settlement**: Platform transfers iPoint equivalent to merchant (unusual model). |
| **Recommendation** | Option A for MVP. If merchant-owned items are not in MVP (OD-02), this is moot. |
| **Business Impact** | A: No cost to platform. B: Merchant acquisition incentive. |
| **Financial Risk** | A: None. B: Platform bears cost of redeemed items. |
| **Bryan Decision** | **PENDING** |

---

### OD-26: Failed Fulfilment

| Field | Value |
|---|---|
| **Question** | What happens when a fulfilment attempt fails? (physical damaged in shipping, digital delivery error, etc.) |
| **Option A** | **Auto-refund**: System automatically refunds points on fulfilment failure. |
| **Option B** | **Admin review required**: Admin must review and decide on refund. |
| **Option C** | **Retry**: System re-attempts fulfilment if retryable error. |
| **Recommendation** | Option B (Admin review) for physical items. Option A (Auto-refund) for digital delivery failure. |
| **Business Impact** | A: Fast member resolution. B: Better control. C: Reduced manual work. |
| **Technical Impact** | A: Auto-refund flow. B: Admin review queue. C: Retry logic. |
| **Bryan Decision** | **PENDING** |

---

### OD-27: Backorder / Waitlist

| Field | Value |
|---|---|
| **Question** | Should out-of-stock items support backorder (order now, deliver when back in stock) or waitlist (notify when available)? |
| **Option A** | **No backorder**: Items shown as out-of-stock. Member cannot order. |
| **Option B** | **Waitlist only**: Member can join a notification list for restock. |
| **Option C** | **Full backorder**: Member can order out-of-stock items and receive when available. |
| **Recommendation** | Option A for MVP. |
| **Business Impact** | B/C: Member retention. A: Simple inventory management. |
| **Technical Impact** | A: Inventory check + hide. B: Notification list. C: Order queuing + delayed fulfilment. |
| **Bryan Decision** | **PENDING** |

---

### OD-28: Suspended Member Orders

| Field | Value |
|---|---|
| **Question** | How are existing confirmed orders handled when a member is suspended? |
| **Option A** | **Continue fulfilment**: Already confirmed orders proceed through fulfilment normally. No new redemptions. |
| **Option B** | **Cancel and refund**: All pending orders are cancelled and refunded. |
| **Option C** | **Admin choice**: Admin decides per order. |
| **Recommendation** | Option A (Continue fulfilment). Points already debited; fulfilment should complete. |
| **Business Impact** | A: Fair to member. B: Conservative. C: Flexible. |
| **Financial Risk** | A: Low — points already debited. |
| **Bryan Decision** | **PENDING** |

---

### OD-29: Redemption Commission

| Field | Value |
|---|---|
| **Question** | Should agents earn commissions on redemptions made by their referrals? |
| **Option A** | **No commission**: Redemption is not a commissionable event. |
| **Option B** | **Fixed commission**: Agents earn a fixed amount per redemption. |
| **Option C** | **Percentage commission**: Agents earn a percentage of points redeemed or fiat value. |
| **Recommendation** | Option A (No commission). Redemption commission is not part of the approved commission mechanism (Phase 5 scope). Defer to a future phase. |
| **Business Impact** | A: No additional cost. B/C: Additional agent incentive. |
| **Technical Impact** | A: No integration needed. B/C: Commission calculation + Phase 5 integration. |
| **Financial Risk** | A: None. B/C: Ongoing commission liability. |
| **Bryan Decision** | **PENDING** |

---

### OD-30: Dispute Process

| Field | Value |
|---|---|
| **Question** | What dispute process should be available for redemption orders? |
| **Option A** | **No formal process**: Support ticket only (existing Phase 0 customer support). |
| **Option B** | **Admin dispute handling**: Admin can create dispute records linked to redemption orders. |
| **Option C** | **Full dispute workflow**: Status tracking, evidence submission, admin review, resolution. |
| **Recommendation** | Option A for MVP. Support ticket is sufficient for initial launch. |
| **Business Impact** | A: Simple. B: Traceable disputes. C: Comprehensive. |
| **Technical Impact** | A: Link support ticket to order. B: Dispute table + status. C: Full workflow. |
| **Bryan Decision** | **PENDING** |

---

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

### P6-S3: Quote & Point Reservation

- Quote generation with rate locking
- Point reservation (if Option B approved)
- Reservation expiration job
- Quote validation at confirm

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

*End of P6-S0 Redemption Center Contract Draft*
*Status: DRAFT — Awaiting Bryan decisions on OD-01 through OD-30 before freezing*
*All OD decisions marked PENDING — no production action authorized*
