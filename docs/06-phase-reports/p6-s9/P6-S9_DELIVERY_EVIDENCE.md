# P6-S9: Phase 6 Delivery Evidence

**Phase:** Phase 6 — Redemption Center  
**Sprint:** P6-S7 (Admin Operations), P6-S8 (Hardening), P6-S9 (Final Verification)  
**Status:** COMPLETED  
**Authorization:** D-043  
**Governance Parent:** Phase 6 P6-S0 Handoff (2026-07-27 19:22 GMT+8)

---

## 1. Scope Delivered

### P6-S7: Admin Operations

| Capability                      | Status       | API Endpoints                                                                                                                                   |
| ------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog CRUD                    | ✅ Delivered | `POST/GET/PUT /admin/redemption/catalog`, `POST /admin/redemption/catalog/:itemId/disable`                                                      |
| Rate Version Management         | ✅ Delivered | `POST/GET /admin/redemption/market/:marketId/rates`, `POST /admin/redemption/rates/:rateId/cancel`                                              |
| Inventory Management            | ✅ Delivered | Integrated in confirm flow (atomic debit + decrement)                                                                                           |
| Pickup Location CRUD            | ✅ Delivered | `POST/GET/PUT /admin/redemption/market/:marketId/pickup-locations`                                                                              |
| Order Management (list, detail) | ✅ Delivered | Via `redemption_orders` table queries                                                                                                           |
| Fulfilment Status Updates       | ✅ Delivered | `POST/PUT /admin/redemption/fulfilments`, `PUT /admin/redemption/fulfilments/status`                                                            |
| Refund Maker/Checker (OD-17)    | ✅ Delivered | `POST /admin/redemption/refunds` (Maker), `POST /admin/redemption/refunds/approve` (Checker), `POST /admin/redemption/refunds/reject` (Checker) |
| Backorder Management (OD-27)    | ✅ Delivered | `POST /admin/redemption/fulfilments/:orderId/backorder`, `POST /admin/redemption/fulfilments/:orderId/restock`                                  |
| Suspension Management (OD-28)   | ✅ Delivered | `POST /admin/redemption/fulfilments/:orderId/suspend`, `POST /admin/redemption/fulfilments/:orderId/resume`                                     |
| Waitlist (OD-27)                | ✅ Delivered | `POST/DELETE /admin/redemption/fulfilments/waitlist`                                                                                            |

### Permission Roles

| Permission                     | Used By                                  |
| ------------------------------ | ---------------------------------------- |
| `redemption.catalog.manage`    | Admin catalog CRUD                       |
| `redemption.rate.manage`       | Admin rate management                    |
| `redemption.inventory.manage`  | Admin inventory (via confirm flow)       |
| `redemption.pickup.manage`     | Admin pickup location management         |
| `redemption.orders.view`       | Admin order viewing                      |
| `redemption.fulfilment.update` | Admin fulfilment status updates          |
| `redemption.refund.maker`      | Maker creates refund requests            |
| `redemption.refund.checker`    | Checker approves/rejects refund requests |
| `redemption.voucher.reveal`    | Voucher code reveal (future)             |
| `redemption.audit.view`        | Audit log viewing                        |

### P6-S8: Hardening & Security

| Aspect                 | Status | Details                                                                                                                       |
| ---------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Formatting (Prettier)  | ✅     | Passes `format:check`                                                                                                         |
| Linting (ESLint)       | ✅     | Passes `lint`                                                                                                                 |
| TypeScript Compilation | ✅     | Passes `typecheck`                                                                                                            |
| Unit Tests             | ✅     | 11 fulfilment service tests, 8 refund service tests                                                                           |
| Integration Tests      | ✅     | 29 scenarios across catalog CRUD, rate management, pickup locations, quote generation, confirm flow, shipping payment         |
| Admin Hardening Tests  | ✅     | 42 scenarios covering admin CRUD, rates, inventory, refund MC, pickup, fulfilment, security, concurrency                      |
| Concurrency Tests      | ✅     | Wallet lock prevents negative balance, inventory version check prevents oversell, lock timeout handling, idempotency handling |
| Checkpoint E Tests     | ✅     | 42 fulfilment checkpoint scenarios, 24 refund checkpoint scenarios — redesigned correction flows with exact-opposite entries  |
| Regression & Perf      | ✅     | 17 scenarios confirming Phase 3/4/5 anti-regression (no side-effects), performance baselines                                  |
| Security & Privacy     | ✅     | 20 scenarios: authorization guards, market isolation, admin-only endpoints, member sees own orders only                       |
| Shipping & Market      | ✅     | 22 scenarios: shipping payment lifecycle, market isolation for rates/catalog, commission non-interference                     |
| Idempotency Tests      | ✅     | Same key + same payload = same result, mismatch rejected                                                                      |

### P6-S9: Test Matrix Coverage

| Test File                                       | Scenarios | Status |
| ----------------------------------------------- | --------- | ------ |
| `redemption-integration.spec.ts`                | 29        | ✅     |
| `redemption-admin.hardening.spec.ts`            | 42        | ✅     |
| `redemption-fulfilment.service.spec.ts`         | 11        | ✅     |
| `redemption-refund.service.spec.ts`             | 8         | ✅     |
| `redemption-concurrency.spec.ts`                | 8         | ✅     |
| `redemption-fulfilment.checkpointE.spec.ts`     | 42        | ✅     |
| `redemption-refund.checkpointE.spec.ts`         | 24        | ✅     |
| `redemption-regression-performance.spec.ts`     | 17        | ✅     |
| `redemption-security-privacy.spec.ts`           | 20        | ✅     |
| `redemption-shipping-market-commission.spec.ts` | 22        | ✅     |
| **Total**                                       | **223**   | ✅     |

---

## 2. Anti-regression Verification

### Phase 3 (Wallet + Reward)

- `member_wallet_accounts` table: **Unchanged** — `balance` remains a controlled projection
- `member_wallet_entries` table: **Extended only** — `REDEMPTION_DEBIT` and `REDEMPTION_REFUND` added as new entry types via `ALTER TYPE ... ADD VALUE IF NOT EXISTS`
- Phase 3 wallet module: **Unmodified** — Phase 6 does not modify any Phase 3 source files
- Phase 6's confirm flow acquires its own wallet advisory lock (`pg_advisory_xact_lock`) with a 3-second timeout within its own transaction, independent of Phase 3's existing locking
- No Phase 3 code modified by Phase 6

### Phase 4 (Transaction Engine)

- Transaction module: **Unchanged** — no transaction code touched
- Correction pattern: **Reused** — refund uses exact-opposite compensating entries

### Phase 5 (Commission Engine)

- Commission engine: **Unchanged** — no commission code touched
- OD-29 (No Redemption Commission): **Respected** — no commission triggers added

### Existing APIs

- Member APIs: **Unchanged**
- Merchant APIs: **Unchanged**
- Admin APIs: **Extended** with new `admin/redemption/*` endpoints

---

## 3. Database Migrations

| Migration                                          | Description                                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `0020_phase_6_redemption_center_canonical.sql`     | Core redemption schema: catalog, rates, orders, inventory, pickup, terms acceptance, shipping payment, vouchers |
| `0021_phase_6_redemption_contract_corrections.sql` | Contract corrections: updated column references, constraint fixes, index additions                              |

### Key Schema Decisions

| Decision                   | Implementation                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| Wallet entry types         | `REDEMPTION_DEBIT` and `REDEMPTION_REFUND` added via `ALTER TYPE ... ADD VALUE IF NOT EXISTS` |
| Rate non-overlap           | `EXCLUDE USING gist (market_id WITH =, tstzrange(...) WITH &&)`                               |
| Inventory CHECK constraint | `total_quantity IS NULL OR (reserved + fulfilled + backorder <= total_quantity)`              |
| Refund maker/checker       | CHECK constraint prevents maker = checker                                                     |
| Idempotency                | UNIQUE constraints on `idempotency_key`                                                       |

---

## 4. Error Code Registry

| Code                                       | HTTP | Description                      |
| ------------------------------------------ | ---- | -------------------------------- |
| `REDEMPTION_CATALOG_ITEM_NOT_FOUND`        | 404  | Catalog item not found           |
| `REDEMPTION_RATE_NOT_FOUND`                | 404  | Rate version not found           |
| `REDEMPTION_PICKUP_LOCATION_NOT_FOUND`     | 404  | Pickup location not found        |
| `REDEMPTION_QUOTE_NOT_FOUND`               | 404  | Quote not found                  |
| `REDEMPTION_SHIPPING_PAYMENT_NOT_FOUND`    | 404  | Shipping payment not found       |
| `REDEMPTION_CATALOG_SKU_DUPLICATE`         | 409  | SKU already exists in market     |
| `REDEMPTION_RATE_OVERLAP`                  | 409  | Rate range overlaps existing     |
| `REDEMPTION_CATALOG_ITEM_VERSION_CONFLICT` | 409  | Optimistic lock conflict         |
| `REDEMPTION_RATE_CANNOT_MODIFY_HISTORICAL` | 409  | Historical rate is immutable     |
| `REDEMPTION_IDEMPOTENCY_MISMATCH`          | 409  | Idempotency key collision        |
| `REDEMPTION_QUOTE_EXPIRED`                 | 409  | Quote has expired                |
| `REDEMPTION_QUOTE_STALE`                   | 409  | Item version changed since quote |
| `REDEMPTION_BALANCE_INSUFFICIENT`          | 409  | Wallet balance insufficient      |
| `REDEMPTION_INVENTORY_INSUFFICIENT`        | 409  | Not enough inventory             |
| `REDEMPTION_MEMBER_NOT_ACTIVE`             | 403  | Member not active                |
| `REDEMPTION_KYC_LEVEL_2_REQUIRED`          | 403  | KYC Level 2 not completed        |
| `REDEMPTION_TERMS_NOT_ACCEPTED`            | 409  | Terms not accepted               |
| `REDEMPTION_LOCK_TIMEOUT`                  | 409  | Advisory lock timeout            |
| `REDEMPTION_SHIPPING_PAYMENT_CONSUMED`     | 409  | Shipping payment already used    |
| `REDEMPTION_SHIPPING_PAYMENT_EXPIRED`      | 409  | Shipping payment expired         |

---

## 5. Files Modified/Created

### Database

- `packages/database/schema/redemption.ts` — Drizzle schema definitions for all redemption tables
- `packages/database/migrations/0020_phase_6_redemption_center_canonical.sql` — Core redemption schema migration
- `packages/database/migrations/0021_phase_6_redemption_contract_corrections.sql` — Contract correction migration

### Seeds

- `packages/database/seeds/foundation.ts` — Added redemption permissions

### API

- `apps/api/src/redemption/` — Full redemption module: controllers, services, DTOs, types, errors
- `apps/api/src/redemption/admin-redemption.controller.ts` — Admin catalog/rate/pickup controllers
- `apps/api/src/redemption/redemption-admin-fulfilment.controller.ts` — Admin fulfilment controller
- `apps/api/src/redemption/redemption-admin-refund.controller.ts` — Admin refund controller
- `apps/api/src/redemption/redemption.controller.ts` — Member-facing controllers
- `apps/api/src/redemption/redemption.service.ts` — Core service layer
- `apps/api/src/redemption/redemption-fulfilment.service.ts` — Fulfilment service
- `apps/api/src/redemption/redemption-refund.service.ts` — Refund service
- `apps/api/src/redemption/sandbox-payment.adapter.ts` — Shipping payment sandbox
- `apps/api/src/redemption/shipping-payment.port.ts` — Shipping payment port interface

### Tests

- `apps/api/src/redemption/redemption-integration.spec.ts` — 29 integration scenarios
- `apps/api/src/redemption/redemption-fulfilment.service.spec.ts` — 11 fulfilment tests
- `apps/api/src/redemption/redemption-refund.service.spec.ts` — 8 refund tests
- `apps/api/src/redemption/redemption-admin.hardening.spec.ts` — 42 admin hardening tests
- `apps/api/src/redemption/redemption-concurrency.spec.ts` — 8 concurrency tests
- `apps/api/src/redemption/redemption-fulfilment.checkpointE.spec.ts` — 42 checkpoint-E fulfilment tests
- `apps/api/src/redemption/redemption-refund.checkpointE.spec.ts` — 24 checkpoint-E refund tests
- `apps/api/src/redemption/redemption-regression-performance.spec.ts` — 17 regression + performance tests
- `apps/api/src/redemption/redemption-security-privacy.spec.ts` — 20 security + privacy tests
- `apps/api/src/redemption/redemption-shipping-market-commission.spec.ts` — 22 shipping + market + commission tests

---

## 6. Bryan Decision Compliance

| Decision | Decision                                 | Status                                                                        |
| -------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| OD-01    | PLATFORM_OWNED_CATALOG_ONLY              | ✅ Implemented — only PLATFORM_OWNED supported                                |
| OD-02    | MERCHANT_OWNED_ITEMS_NOT_INCLUDED_IN_MVP | ✅ Implemented — merchant items not included                                  |
| OD-03    | NO_CROSS_MARKET_REDEMPTION               | ✅ Member sees own market only                                                |
| OD-04    | CURRENT_MARKET_UNIFIED                   | ✅ Catalog = wallet = rate = pickup market                                    |
| OD-05    | DIRECT_ATOMIC_DEBIT                      | ✅ Confirmed — no RESERVED state                                              |
| OD-06    | NOT_APPLICABLE_FOR_MVP                   | ✅ No quote TTL — quote is valid until confirm or stale                       |
| OD-07    | MEMBER_PAYS_ONLINE_FIAT_SHIPPING         | ✅ Member pays physical shipping via online fiat; sandbox adapter implemented |
| OD-07A   | PAYMENT_BINDING_AND_COMPENSATION_RULES   | ✅ See OD-07A details below                                                   |
| OD-08    | STORE_PICKUP_SUPPORTED                   | ✅ Pickup locations CRUD, DELIVERY_ONLY/PICKUP_ONLY/DELIVERY_OR_PICKUP modes  |
| OD-09    | VOUCHER_EXPIRY_CONFIGURABLE_3M_DEFAULT   | ✅ Voucher expiry per item; default 3 calendar months                         |
| OD-10    | EXPIRED_VOUCHER_NO_REFUND                | ✅ No auto-refund on voucher expiry                                           |
| OD-11    | NO_MEMBER_CANCELLATION_AFTER_CONFIRM     | ✅ Members cannot cancel confirmed orders                                     |
| OD-12    | NO_PARTIAL_REFUND                        | ✅ Full refund only, no partial                                               |
| OD-13    | NO_POST_CONFIRM_AUTO_REFUND              | ✅ No auto-refund; admin review required                                      |
| OD-14    | NO_FORMAL_FULFILMENT_SLA                 | ✅ No formal SLA engine implemented                                           |
| OD-15    | KYC_LEVEL_2_REQUIRED_AT_CONFIRM          | ✅ KYC Level 2 checked at confirm                                             |
| OD-16    | NO_HIGH_VALUE_MANUAL_REVIEW              | ✅ No high-value manual review implemented                                    |
| OD-17    | REFUND_MAKER_CHECKER_REQUIRED            | ✅ Maker creates, Checker approves/rejects                                    |
| OD-18    | INVENTORY_ADJUSTMENT_NO_MAKER_CHECKER    | ✅ No Maker/Checker for inventory adjustment                                  |
| OD-19    | NO_DAILY_MONTHLY_LIMITS                  | ✅ No limit counters implemented                                              |
| OD-20    | TAX_INVOICE_DEFERRED                     | ✅ Tax/invoice handling excluded from Phase 6; deferred to future phase       |
| OD-21    | RATE_CONVERSION_PRICING                  | ✅ Point cost = fiat_value / rate                                             |
| OD-22    | RATE_LOCKED_AT_QUOTE_TIME                | ✅ Rate snapshot captured at quote time                                       |
| OD-23    | NO_PROMOTIONAL_RATE                      | ✅ Not implemented                                                            |
| OD-24    | SYSTEM_GENERATED_VOUCHER_CODE            | ✅ Platform generates voucher codes                                           |
| OD-25    | NOT_APPLICABLE_FOR_MVP                   | ✅ Merchant settlement not implemented                                        |
| OD-26    | RETRY_THEN_ADMIN_REVIEW                  | ✅ Admin review required after 3 retries                                      |
| OD-27    | BACKORDER_AND_WAITLIST_SUPPORTED         | ✅ Backorder + waitlist implemented                                           |
| OD-28    | SUSPEND_EXISTING_UNFULFILLED_ORDERS      | ✅ FULFILMENT_SUSPENDED state implemented                                     |
| OD-29    | NO_REDEMPTION_COMMISSION                 | ✅ Not implemented                                                            |
| OD-30    | TERMS_ACCEPTANCE_SUPPORT_TICKET          | ✅ Terms acceptance with support ticket                                       |

### OD-07A: Payment Binding & Compensation Rules

OD-07A is a sub-decision of OD-07 that specifies the shipping payment binding and failure compensation rules:

**Payment Binding:**

- Member pays physical shipping fee using **online fiat payment** (NOT iPoint points)
- Currency uses the Order Market currency
- iPoint may NOT be used for shipping payment
- Cash on Delivery is NOT supported
- Shipping fee must be shown and confirmed by member before Confirm
- Shipping Fee Snapshot written to Quote and Order
- Client must not submit or modify shipping fee amount

**Provider Decoupling:**

- Reuse existing Payment Gateway architecture where possible
- **No hard-coded payment provider binding** — Provider Adapter Interface with Test/Sandbox Adapter
- External Provider Secrets must NOT be in repository

**Payment Intent Integrity:**

- Before Delivery Order Confirm, Shipping Payment must reach verifiable success
- Payment Intent must bind: `memberId`, `quoteId`, `marketId`, `currency`, `amount`, `requestHash`
- Same Payment Intent must NOT be used by multiple Orders
- Pickup Order Shipping Fee = 0 (no payment needed)

**Failure Compensation:**

- If Shipping Payment succeeds but Redemption Confirm fails: **auto-void or auto-refund** the shipping payment
- **No iPoint Wallet impact** — the failed redemption does not debit points
- Enter **Payment Recovery Queue** on failure for manual reconciliation if auto-refund cannot complete
- Missing Provider Credentials must NOT block code and test completion
- Provider Production Configuration listed as Deployment Blocker

---

## 7. Prohibited Items Verification

| Item                                  | Status                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| Phase 3/4/5 frozen code modified      | ❌ Not modified                                                                        |
| Daily/monthly limits created (OD-19)  | ❌ Not created                                                                         |
| Promotional rates created (OD-23)     | ❌ Not created                                                                         |
| Merchant settlement created (OD-25)   | ❌ Not created                                                                         |
| Redemption commission created (OD-29) | ❌ Not created                                                                         |
| Dispute workflow created (OD-30)      | ❌ Not created — support ticket only                                                   |
| TypeScript strictness reduced         | ❌ Not reduced                                                                         |
| Float used for financial calculations | ❌ Not used — all NUMERIC(38,10)                                                       |
| Existing Phase 3/4/5 test files       | ⚠️ Phase 6 test files are additive; no Phase 3/4/5 test files were modified or deleted |

---

## 8. Open Items (Deferred)

| Item                        | Reference        | Reason                         |
| --------------------------- | ---------------- | ------------------------------ |
| Partial refund              | OD-12 (deferred) | Deferred — full refund only    |
| Merchant-owned items        | OD-02 (deferred) | Deferred — platform-owned only |
| Promotional rates           | OD-23 (deferred) | Deferred                       |
| Merchant settlement         | OD-25 (deferred) | Deferred                       |
| Redemption commission       | OD-29 (deferred) | Deferred                       |
| Dispute workflow            | OD-30 (deferred) | Support ticket only            |
| Tax/invoice handling        | OD-20 (deferred) | Deferred to future phase       |
| FINAL_TERMS_CONTENT_PENDING | OD-30            | Does not block engineering     |
| Daily/monthly limits        | OD-19 (rejected) | Bryan decided NO               |

---

_End of P6-S9 Delivery Evidence_  
_Status: COMPLETED — Ready for ChatGPT Command Center Review_
