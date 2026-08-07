# P6-R2 — Final Forward-Only Gate Record (Phase 6 Admin Route Security)

| Field           | Value                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Record**      | P6-R2 FINAL GATE — Phase 6 Admin Route Security (Command Center 2026-08-07 §5, SEC-02 follow-up)                                            |
| **Status**      | `P6_R2_ADMIN_ROUTE_SECURITY_COMPLETE` / `P6_R2_COMPLETE_OPENCLAW_INTERNAL` / `CONTINUING_UNDER_D-055`                                       |
| **Order**       | ChatGPT Command Center — D-055 continuous sequence: SEC-02 → Phase 6 Admin Route Security → P7-S8 (bounded hardening, no new authorization) |
| **Date**        | 2026-08-07                                                                                                                                  |
| **Declaration** | OpenClaw internal gate — NOT Command Center acceptance/closure/freeze                                                                       |

> Forward-only record. Do not delete or rewrite.

---

## 1. Delivery range

| Item            | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Branch**      | `fix/p6-r2-admin-route-security` (base `7f898b52` = phase HEAD incl. SEC-02 gate)                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Commits**     | `724de28e` (feat: canonical RBAC + market scoping on admin fulfilment/refund routes) · `3caebd2a` (feat: resource-market consistency on catalog/pickup-location routes) · `ac17c617` (fix: market-scope read projections + member payment IDOR closure — owner-level minimal fixes) · `e062a900` (test: HTTP evidence matrix, real PostgreSQL)                                                                                                                                                                 |
| **Integration** | Merge `8502065d` (--no-ff, ort, no conflicts) into `phase/7-admin-operations`                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Scope**       | 8 files, all `apps/api/src/redemption/`: admin-redemption / admin-fulfilment / admin-refund controllers (34 routes hardened), redemption.controller.ts + redemption.service.ts (member IDOR closure), redemption-refund.service.ts + redemption-fulfilment.service.ts (market-scoped read projections), new `redemption-admin-route-security.integration.spec.ts` (1066 lines). Zero migration (checksums 37/37 unchanged); no wallet/commission/market/reward/agent code; no B/C/D tests; TS strict unchanged |

## 2. Route security matrix — Command Center §5 ten requirements, all PASS

1. **Auth required**: `@UseGuards(AuthGuard, AdminGuard, RbacGuard)` on fulfilment/refund controllers; member session → 401/403.
2. **RBAC required**: every one of the 34 admin redemption routes declares a catalog permission (`redemption.fulfilment.manage` ×13, `redemption.refund.create` ×1, `redemption.refund.approve` ×2, `redemption.order.read` ×6, catalog/rate/pickup ×12) — verified against canonical `permission-catalog.ts`.
3. **Current Market required**: `marketScoped: true` on every route; no Current Admin Market → 409 `MARKET_SELECTION_REQUIRED`.
4. **Resource-market consistency**: guard-layer (URL/header/body market compare) + controller-layer (`assert*Market` direct SQL on target resource) → 409 `MARKET_CONTEXT_MISMATCH`; owner 404 precedence preserved.
5. **Step-up where sensitive**: `redemption.refund.approve` stepUpRequired; fresh single-use `x-step-up-token` consumed via `RbacService.consumeStepUpGrant` (session+admin+action-class+market+target bound, unexpired); missing → 403 `MFA_STEP_UP_REQUIRED`; token stored hashed only, never logged.
6. **Member access denied**: member token → 403 on all admin redemption routes (R6a–R6c).
7. **Support raw-ledger denied**: SUPPORT_READONLY_AUDITOR has only `redemption.order.read`; read projections bounded (digitalValueEncrypted/pickupCode null); approve → 403 (R7a–R7c).
8. **Direct/in-process bypass denied**: old unguarded handlers now carry full guard chain; single write path = guarded controller → Phase 6 owner; R9 static scan asserts guard+permission+marketScoped on all 34 handlers.
9. **No unsecured legacy routes**: all 34 admin redemption routes enumerated and secured; `admin-redemption-ops` (P7-S6C) already guarded, untouched.
10. **No duplicated Phase 7 owner logic**: transport guards only; every write delegates 1:1 to Phase 6 owners; no route deleted; PC1/PC2 positive controls prove end-to-end writes.

**Owner-level minimal fixes (`ac17c617`) — REVIEWER ENDORSED** (D-055 bounded hardening, market isolation + identity authorization only):

- `redemption-refund.service.ts`: `listPendingRefundRequests`/`listAllRefundRequests` gain optional marketId filter (additive; write paths untouched).
- `redemption-fulfilment.service.ts`: `listPending` gains optional marketId filter (additive).
- `redemption.service.ts`: `confirmShippingPayment` accepts server-derived memberId and rejects mismatch → 409 `REDEMPTION_SHIPPING_PAYMENT_MISMATCH` (member IDOR closed; member controller resolves identity from authenticated session, never client input).

## 3. Independent review — APPROVED

`OPENCLAW_MANAGED_CODING_SUBAGENT` (independent reviewer, D-048): verdict `.local/p6-route-sec-gate/review/REVIEWER_VERDICT.md` — **APPROVED, 0 Critical / 0 High / 0 Medium / 4 Low** (informational: L-01 IDOR 409-vs-404 convention; L-02 grant consumed on later route failure — fail-safe; L-03 optional create-path negative test; L-04 pre-existing host working-tree dirtiness outside branch). All ten §5 requirements PASS; RBAC codes verified against canonical catalog; step-up single-use + hashed-only; reviewer independently re-ran 68 tests (29 new + 28 integration + 11 refund owner) green.

## 4. Independent verification — TEST GATE PASSED

`OPENCLAW_MANAGED_CODING_SUBAGENT` (separate verifier, D-048) on fresh isolated DBs `ipoint_ver_p6r2_*` (22 DBs; Node v24.19.0 vs implementer v26.4.0; counts grep-verified): **25/25 gates PASS** — new suite 29/29, rate 59, refund owner 31, hardening 40, integration 28, atomicity 17, concurrency 8, security 20, commission 22, units 55, checkpointE 65, S6C 49, S7C spot 12; regression total **403 passed / 0 failed / 0 skipped** (matches implementer); checksum 37/37 (zero migration change); drift clean; api/admin-web/api-client typecheck+build green; OpenAPI 247 paths PASS; eslint 0; prettier clean. Behavior spot-checks (fresh DBs): Maker approve → 403 PERMISSION_DENIED; cross-market by-id → 409; member-B confirm member-A payment → 409 REDEMPTION_SHIPPING_PAYMENT_MISMATCH (IDOR closed); missing step-up → 403 MFA_STEP_UP_REQUIRED.

## 5. Post-integration verification

| Check                 | Result                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 7 merge         | `8502065d` (--no-ff, ort, no conflicts)                                                                                                           |
| Tracked modifications | 0                                                                                                                                                 |
| Migration checksums   | 37/37 (no migration change)                                                                                                                       |
| Frozen owner scope    | minimal fixes only (reviewer endorsed); no write-semantics change                                                                                 |
| `main`                | unchanged `69240bf84d7d8e0cf58c86ce25a88a5aa105db05`; no PR/merge/deploy                                                                          |
| Push / local = remote | PUSH PENDING — host channel restoration (same pattern as S6D/S6A/S7C gate records); batch push scheduled before the Phase 7 final delivery report |

## 6. Declarations

```
P6_R2_ADMIN_ROUTE_SECURITY_COMPLETE
P6_R2_COMPLETE_OPENCLAW_INTERNAL
```

OpenClaw internal gate — NOT Command Center acceptance. Next per Command Center order: **P7-S8** → P7-S9 → P7-S10 → Phase 7 Final Delivery Report.

_Forward-only record. Do not delete or rewrite._
