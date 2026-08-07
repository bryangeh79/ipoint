# SEC-02 Implementer Report — Phase 6 Refund Ledger Remediation (GATE-SEC-02)

- **Branch:** `fix/p6-r1-sec02-refund-ledger` (base `phase/7-admin-operations` @ `e55af0f2`)
- **Executor class:** OPENCLAW_MANAGED_CODING_SUBAGENT (D-048), bounded owner hardening (D-047 + D-055)
- **Migration owner:** SEC-02 (highest actual migration on base = `0035_p7_s7a_mcp_adjustment_conformance.sql`, checksums 36/36 — verified; reserved **0036**)
- **Status:** implementation complete; self-tests green (unit + real PostgreSQL integration + Phase 6 redemption regression, R=0)

---

## 1. Command Center §4 requirement matrix (现状 / 缺口 / 修复 / 证据)

| # | Command Center requirement (2026-08-07 SEC-02 §4) | 现状 (as found) | 缺口 | 修复方式 | 测试证据 |
|---|---|---|---|---|---|
| 1 | **Full Refund only** | `createRefundRequest` accepted any `totalPointCost` | ❌ no amount-vs-order validation | Owner now compares refund amount with `order.total_points` via exact-decimal normalization (never float); partial amount → 400 `REDEMPTION_PARTIAL_REFUND_NOT_ALLOWED`; claimed member/market must equal the order's | owner.unit "rejects a partial refund", "accepts equivalent trailing-zero precision", "rejects a member/market mismatch"; integration "rejects a partial refund amount" |
| 2 | **Maker/Checker, Maker ≠ Checker, no threshold exception** | runtime maker≠checker check present (approve + reject) | ✅ present; DB CHECK existed | preserved; DB `chk_refund_maker_checker_different` unchanged; owner adds server-side identity guard (`assertAdminActor`: ADMIN + actorId required, MEMBER/SYSTEM never accepted) | unit "identity guard" ×3; integration "rejects Maker = Checker with no threshold exemption" (request stays PENDING_CHECKER) |
| 3 | **REFUND_PENDING → REFUNDED legal state machine (preserve Phase 6)** | order machine existed; **blocked by `chk_order_refund_state`** (0020 encoded REFUND_PENDING requiring `wallet_entry_id IS NULL`, impossible for any real order which is debited at CONFIRMED) | ❌ frozen transition was unexecutable | 0036 corrects the encoding forward-only: REFUND_PENDING now **requires** the debit reference; REFUNDED unchanged; frozen P6-S0 §20.3 machine preserved (no other transition changed) | integration "executes the full refund atomically" (asserts REFUND_PENDING after create, REFUNDED after approve); P6-S6 atomicity 17/17 regression |
| 4 | **Atomic redemption + ledger + wallet (single transaction)** | `executeAtomicRefund` had a TODO — **no wallet ledger entry, no balance credit** | ❌ CRITICAL | Approve runs ONE transaction: request EXECUTING → `member_wallet_entries` compensating `REDEMPTION_REFUND` entry (exact before/after, `redemption-refund:<requestId>` unique ledger key, referenceType REDEMPTION_ORDER + order id, actor) → version-guarded `available_balance` credit → inventory restore → order REFUNDED → request COMPLETED (wallet_entry_id = debit, refund_wallet_entry_id = credit, executed_at) → immutable audit | integration "executes the full refund atomically" (balance credited exactly; single compensating entry; both wallet refs; executed_at) |
| 5 | **Double execution prevention** | request row `FOR UPDATE` + status machine existed | ✅ present | preserved + hardened: only PENDING_CHECKER may transition; COMPLETED/REJECTED/FAILED are permanent (never re-execute); execution failure marks the request durably FAILED so a retry can never re-execute | integration "executes a concurrent approve exactly once" (1/2 fulfilled), "rejects a sequential double approve", "leaves no partial state … retry does NOT re-execute"; unit terminal-state tests |
| 6 | **Idempotency (operation-level; same key+payload replay; different payload 409)** | no idempotency support at all | ❌ | 0036 adds `idempotency_scope`/`idempotency_key`/`payload_hash` + unique (scope,key); create requires a key, computes canonical sha256 payload hash, **claim lookup short-circuits before order-state validation**; same key+payload replays the stored request (P6-S0 §27.1 "duplicate requests return the same result"), different payload → 409 `REDEMPTION_REFUND_IDEMPOTENCY_CONFLICT`; DB unique index = single winner under concurrency | unit replay/conflict; integration "replays the same CREATE key + payload; conflicts on different payload" (single row in DB) |
| 7 | **Immutable audit (actor/action/before/after/reason/result atomic)** | audit rows existed but `before` was always null; no requestId/ip | ❌ partial | audit() now records before+after+reason+result+requestId+ipAddress in the same transaction for REFUND_REQUESTED / REFUND_EXECUTED / REFUND_REJECTED / REFUND_EXECUTION_FAILED; controller passes `x-request-id` + client ip | unit "records the REFUND_EXECUTED audit with before/after/reason/result"; integration audits query (actions, actor_type, before, after, result) |
| 8 | **Historical order snapshot unchanged** | refund only flipped status | ✅ present | preserved — refund touches only `status`; item/rate snapshots, posted/unrounded/total points, quantity untouched | integration "never rewrites the historical order snapshot" (all snapshot/amount columns equal before/after) |
| 9 | **Refund produces no Agent Commission (OD-29)** | no commission path existed | ✅ present | preserved — refund writes only `member_wallet_entries` + order/request state; no `transaction_commission_dispatch`, no `commission_ledger`, no extra wallet entry types | integration "refund produces no commission" (0 dispatch rows, 0 ledger rows, only DEBIT/REFUND wallet entries) |
| 10 | **No automatic refund outside frozen rules** | create restricted to FULFILMENT_EXCEPTION/SUSPENDED | ✅ present | preserved + order already REFUNDED → 409 | integration "rejects refund create for a CONFIRMED order"; unit "rejects when the order is already refunded" |
| 11 | **Direct/in-process owner bypass closed** | single service already; but create accepted forged member/market claims and any actor | ❌ partial | all refund writes converge on `RedemptionRefundService` (the only write path: controller + all in-process callers); owner boundary enforces ADMIN identity + order-truth member/market + idempotency; no unsecured legacy method remains (verified: sole callers are the refund controller and tests) | grep evidence in §7; unit identity guard; typecheck (no other callers) |
| 12 | **Existing Phase 6 state machine preserved (P6-S3/P6-S6/P6-S7)** | — | — | order machine untouched except the §3 encoding fix; request machine unchanged (PENDING_CHECKER/EXECUTING/COMPLETED/FAILED/REJECTED); wallet debit/confirm path untouched | full redemption regression matrix green (see §4), incl. P6-S6 atomicity 17/17, hardening 40/40, integration 28/28 |

## 2. Migration 0036 (SEC-02 owns the migration)

`packages/database/migrations/0036_p6_sec02_refund_ledger_owner.sql` — forward-only; 0035 and earlier byte-identical (checksums 36/36 verified before, 37/37 after).

1. `redemption_refund_requests` += `idempotency_scope varchar(200)`, `idempotency_key varchar(200)`, `payload_hash varchar(64)`, `prior_order_status varchar(32)`, `executed_at`, `failed_at`, `failure_reason`; unique `ux_refund_idempotency (scope,key)`; partial unique `ux_refund_order_active (order_id) WHERE status IN ('PENDING_CHECKER','EXECUTING')` (one active request per order, create-race hard guarantee); `chk_refund_prior_status` (frozen status list); `chk_refund_reason_present` (1..500 chars).
2. `chk_refund_decided_fields` replaced with the full invariant: PENDING_CHECKER / EXECUTING / COMPLETED (both wallet refs + executed_at) / FAILED (checker + decided_at + failed_at, no wallet refs) / REJECTED.
3. **Frozen-machine encoding fix:** `chk_order_refund_state` re-encoded — REFUND_PENDING now REQUIRES `wallet_entry_id IS NOT NULL` (was: IS NULL, which made the accepted REFUND_PENDING → REFUNDED path unexecutable for real orders). Contract authority: P6-S0 §20.3 (points debited at CONFIRMED; REFUND_PENDING has wallet effect None and refunds the original debit). No historical migration rewritten.

`checksums.json` 36→37; `expected-schema.ts` redemption_refund_requests column list synced; Drizzle `schema/redemption.ts` synced (incl. the previously missing `refund_wallet_entry_id` from migration 0021 and the corrected constraint).

## 3. Changed / added files

| File | Change |
|---|---|
| `packages/database/migrations/0036_p6_sec02_refund_ledger_owner.sql` | new (migration 0036) |
| `packages/database/migrations/checksums.json` | +0036 (37/37) |
| `packages/database/schema/redemption.ts` | refund request table: idempotency/prior-status/outcome columns, `refundWalletEntryId`, updated constraints + indexes; `chk_order_refund_state` corrected |
| `packages/database/src/expected-schema.ts` | refund request column list synced |
| `apps/api/src/redemption/redemption-refund.service.ts` | hardened owner (full-refund, identity guard, claim-first idempotency, atomic ledger+wallet execution, durable FAILED, exact reject restore, before/after audit) |
| `apps/api/src/redemption/redemption.errors.ts` | +7 SEC-02 error codes |
| `apps/api/src/redemption/redemption.types.ts` | `CreateRefundRequestParams.idempotencyKey` |
| `apps/api/src/redemption/redemption-admin-refund.controller.ts` | transports `idempotencyKey` + `x-request-id`/ip into the owner audit trail |
| `apps/api/src/redemption/redemption-refund.owner.spec.ts` | new unit suite (20) |
| `apps/api/src/redemption/redemption-refund.owner.integration.spec.ts` | new real-PostgreSQL suite (11) |
| `apps/api/src/redemption/redemption-refund.service.spec.ts`, `redemption-refund.checkpointE.spec.ts` | mock scaffolding aligned to the owner (no assertion weakened; order fixture gains totalPoints, approve mocks add wallet row + ledger returning, create mocks add claim lookup + idempotency key) |

## 4. Test counts

**New suites (SEC-02):**
- `redemption-refund.owner.spec.ts` — **20 passed / 0 failed / 0 skipped**
- `redemption-refund.owner.integration.spec.ts` (fresh DB `ipoint_gate_sec02_refund`, migrate-on-boot) — **11 passed / 0 failed / 0 skipped**

**Phase 6 redemption regression (fresh DBs):**
| Suite | Result |
|---|---|
| `redemption-p6-atomicity.spec.ts` (P6-S6 financial atomicity, incl. concurrent approve once + no partial ledger) | 17 passed |
| `redemption-admin.hardening.spec.ts` (T-96..T-100 refund schema constraints) | 40 passed |
| `redemption-integration.spec.ts` | 28 passed |
| `redemption-rate.owner.integration.spec.ts` (D-053) | 59 passed |
| `redemption-concurrency.spec.ts` | 8 passed |
| `redemption-security-privacy.spec.ts` | 20 passed |
| `redemption-shipping-market-commission.spec.ts` | 22 passed |
| `redemption-fulfilment.service.spec.ts` + `redemption-fulfilment.checkpointE.spec.ts` | passed |
| `redemption-refund.service.spec.ts` + `redemption-refund.checkpointE.spec.ts` + owner unit | 52 passed |
| **Total regression** | **R=0 (all green)** |

**Static gates:** `db:checksum` 37/37 ✅ · `@ipoint/database` typecheck ✅ · `@ipoint/api` typecheck ✅ · `@ipoint/api` build ✅ · eslint on all changed files 0 problems ✅ · prettier — all clean ✅ · OpenAPI runtime validation — see §8.

## 5. Impact on the existing Phase 6 state machine — 保留 / 无破坏

- Order machine: the ONLY change is the §2.3 encoding fix of `chk_order_refund_state` which **unlocks** the already-frozen `REFUND_PENDING → REFUNDED` path (previously a real order could never enter REFUND_PENDING because its debit entry existed). All other transitions untouched.
- Request machine: `PENDING_CHECKER → EXECUTING → COMPLETED | FAILED`, `PENDING_CHECKER → REJECTED` unchanged; terminal states are permanent (double-execution prevention).
- Confirm/debit path (P6-S3), fulfilment path (P6-S5/S7), shipping payment flow (P6-S6) untouched.
- Regression evidence: P6-S6 atomicity 17/17 (tests 13–16 exercise the refund flow against the frozen wallet semantics), hardening T-96–T-100 constraint existence tests green, redemption integration 28/28.

## 6. Known limitations

1. **RBAC permission codes:** SEC-02 is scoped to the refund ledger owner; route-level RBAC permission catalog for the refund endpoints (e.g., `redemption.refund.*`) belongs to the next authorized item (Phase 6 Admin Route Security). The owner enforces ADMIN identity + Maker/Checker inequality; the transport keeps the frozen AuthGuard+AdminGuard.
2. **`member_wallet_entries` has no `reversal_of`/`correlation_id` columns** (frozen Phase 3/4 ledger schema); the compensating entry links via `reference_type='REDEMPTION_ORDER'` + `reference_id=orderId` + description carrying the original debit entry id, consistent with the frozen confirm-debit linkage.
3. **Pre-existing upstream DB-suite debt (NOT introduced by SEC-02, byte-identical class on the baseline):** `packages/database` tracked tests still fail exactly as on `phase/7-admin-operations` — p7-s2c catalog count 66-vs-67, six-role matrix, decorator/manifest drift, `phase3-schema` stale `^0019_` expectation, `schema.unit` stale hard-coded migration list (ends ~0019). The workspace additionally contains an **untracked** stray file `packages/database/tests/p6-s1-schema.test.ts` (not in the repo on either branch) whose 0020-era expectations fail regardless of SEC-02; left untouched. The authoritative `db:checksum` gate is green 37/37.
4. **Shipping payment recovery methods** (`createShippingRecovery`/`processShippingRecovery`) are part of the frozen P6-S6 shipping flow, not the refund ledger; left unchanged (out of SEC-02 scope).
5. No push / no main / no rebase / no amend performed; branch is local-only.

## 7. Commits (branch `fix/p6-r1-sec02-refund-ledger`, conventional, not pushed)

| SHA | Commit |
|---|---|
| `4dfa006f` | feat(database): SEC-02 refund ledger owner schema (0036) |
| `7178cddc` | feat(redemption): SEC-02 secured refund owner (GATE-SEC-02) |
| `3761252a` | test(redemption): align existing refund unit mocks with SEC-02 owner |
| `c2d677bc` | test(redemption): SEC-02 owner unit + real-PostgreSQL integration suites |
| `37644369` | style(redemption): lint/prettier cleanup on SEC-02 owner files |

## 8. Gate evidence location

- `/workspace/.local/sec02-gate/` (gitignored): `run-sec02-regression.sh`, per-suite logs, this report.
- DB names used: `ipoint_gate_sec02_refund`, `ipoint_sec02_rate`, `ipoint_sec02_p6reg`, `ipoint_sec02_unit`.
- OpenAPI: runtime validation launched with the standard PASS_DETECTED pattern; refund routes unchanged (same path set), controller DTOs are plain interfaces (no Swagger schema change).
