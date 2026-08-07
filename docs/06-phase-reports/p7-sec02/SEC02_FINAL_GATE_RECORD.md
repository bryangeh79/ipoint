# SEC-02 — Final Forward-Only Gate Record (Phase 6 Refund Ledger Owner Remediation)

| Field           | Value                                                                                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Record**      | SEC-02 FINAL GATE — secured Phase 6 refund ledger owner (GATE-SEC-02)                                                                                                                                |
| **Status**      | `SEC02_OWNER_REMEDIATION_INTEGRATED` / `SEC-02_COMPLETE_OPENCLAW_INTERNAL` / `CONTINUING_UNDER_D-055`                                                                                                |
| **Order**       | ChatGPT Command Center — D-047 (fix/p6-r1-sec02-refund-ledger exact frozen-owner scope) + D-055 continuous sequence (S7C → SEC-02 → Phase 6 Admin Route Security → …) + SEC-02 order (2026-08-07 §4) |
| **Date**        | 2026-08-07                                                                                                                                                                                           |
| **Declaration** | OpenClaw internal gate — NOT Command Center acceptance/closure/freeze                                                                                                                                |

> Forward-only record. Do not delete or rewrite.

---

## 1. Remediation range

| Item            | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Branch**      | `fix/p6-r1-sec02-refund-ledger` (base `e55af0f2` = phase HEAD incl. S7C gate record)                                                                                                                                                                                                                                                                                                                                                                                      |
| **Commits**     | `4dfa006f` (feat(database): migration 0036 refund ledger owner schema) · `7178cddc` (feat(redemption): SEC-02 secured refund owner) · `3761252a` (test: align existing refund unit mocks) · `c2d677bc` (test: owner unit + real-PG integration suites) · `37644369` (style: lint/prettier cleanup) · `3c1698a4` (docs: delivery report)                                                                                                                                   |
| **Integration** | Merge `acd83556` (--no-ff, ort, no conflicts) into `phase/7-admin-operations`                                                                                                                                                                                                                                                                                                                                                                                             |
| **Migration**   | `0036_p6_sec02_refund_ledger_owner.sql` (forward-only; SEC-02 sole owner; highest actual on base = 0035, checksums 36/36 verified before → 37/37 after; 0000-0035 byte-identical; expected-schema + Drizzle schema synced)                                                                                                                                                                                                                                                |
| **Scope**       | `apps/api/src/redemption/redemption-refund.service.ts` (hardened owner) + `redemption.errors.ts` (+7 codes) + `redemption.types.ts` + `redemption-admin-refund.controller.ts` (idempotencyKey + requestId/ip transport) + 2 new suites (owner unit 20, owner integration 11) + mock alignment (2 specs) + `packages/database` (0036 + checksums + schema/redemption.ts + expected-schema) + `docs/06-phase-reports/p7-sec02/` — 13 files, 2575 insertions / 192 deletions |

## 2. Command Center §4 requirement matrix — all satisfied (12/12)

1. **Full Refund only** — owner compares refund amount with `order.total_points` (exact-decimal, never float); partial → 400 `REDEMPTION_PARTIAL_REFUND_NOT_ALLOWED`; claimed member/market must equal order's.
2. **Maker/Checker, Maker ≠ Checker, no threshold exemption** — preserved + server-side identity guard (`assertAdminActor`: ADMIN only, MEMBER/SYSTEM never accepted); DB `chk_refund_maker_checker_different` unchanged.
3. **REFUND_PENDING → REFUNDED legal** — 0036 corrects frozen-machine encoding `chk_order_refund_state` (was `wallet_entry_id IS NULL` — unexecutable for real debited orders; now requires the debit reference); P6-S0 §20.3 machine otherwise preserved.
4. **Atomic redemption + ledger + wallet** — approve runs ONE transaction: EXECUTING → `member_wallet_entries` compensating `REDEMPTION_REFUND` (exact before/after, unique key `redemption-refund:<requestId>`, referenceType REDEMPTION_ORDER) → version-guarded balance credit → inventory restore → order REFUNDED → request COMPLETED (both wallet refs + executed_at) → immutable audit.
5. **Double execution prevention** — `FOR UPDATE` + terminal states permanent (COMPLETED/REJECTED/FAILED never re-execute); execution failure → durable FAILED.
6. **Idempotency** — 0036 adds `idempotency_scope/key/payload_hash` + unique (scope,key); claim lookup short-circuits before order-state validation; same key+payload replays stored request, different payload → 409 `REDEMPTION_REFUND_IDEMPOTENCY_CONFLICT`; DB unique index = single winner under concurrency.
7. **Immutable audit** — before+after+reason+result+requestId+ipAddress in same transaction (REFUND_REQUESTED / REFUND_EXECUTED / REFUND_REJECTED / REFUND_EXECUTION_FAILED).
8. **Historical order snapshot unchanged** — refund touches only `status`; item/rate snapshots, points, quantity untouched (tested byte-equal before/after).
9. **Refund produces no Agent Commission (OD-29)** — refund writes only wallet entries + order/request state; 0 commission dispatch rows, 0 commission ledger rows (tested).
10. **No automatic refund outside frozen rules** — create restricted to FULFILMENT_EXCEPTION/SUSPENDED; already-REFUNDED → 409.
11. **Direct/in-process owner bypass closed** — all refund writes converge on `RedemptionRefundService` (sole write path; controller + in-process callers); no unsecured legacy method remains (grep-verified).
12. **Existing Phase 6 state machine preserved** — order machine untouched except §3 encoding fix; request machine unchanged; full redemption regression green (P6-S6 atomicity 17/17, hardening 40/40, integration 28/28, rate-owner 59/59, concurrency 8/8, security 20/20, commission 22/22, fulfilment, refund 52).

## 3. Independent review — APPROVED

`OPENCLAW_MANAGED_CODING_SUBAGENT` (independent reviewer, D-048): verdict `.local/sec02-gate/review/REVIEWER_VERDICT.md` — **APPROVED, 0 Critical / 0 High**; 3 Medium + 2 Low non-blocking (M-1 durable-FAILED recovery path as follow-up; M-2 reject-path audit requestId/ip; M-3 `chk_order_refund_state` fix landed in the test commit — commit hygiene only; reviewer independently re-ran all suites on fresh DBs, inspected migration constraints in real DB, endorsed the encoding fix as forward-only with correct branch flip). Review-2 fixes (6 items incl. requestId/ip in reject audit) integrated.

## 4. Independent verification — TEST GATE PASSED

`OPENCLAW_MANAGED_CODING_SUBAGENT` (separate verifier, D-048) on 38 fresh isolated DBs (`ipoint_ver_sec02*` / `ipoint_ver_sec02b*`; Node v24.19.0 vs implementer v26.4.0; counts grep-verified): **31/31 gates PASS, 0 fail** — checksum 37/37; SEC-02 owner unit 20/20; owner integration 11/11; P6-S6 atomicity 17/17; hardening 40/40; redemption integration 28/28; rate-owner 59/59; concurrency 8/8; security 20/20; commission 22/22; refund 52/52; S7C finance acceptance 31/31 (regression intact); SEC-01 40/40; S7A 43/43; api/db typecheck+build; api-client 80/80; admin-web 275/275; OpenAPI PASS_DETECTED; eslint+prettier 0 problems; drift clean. Behavior spot-checks on fresh DBs: concurrent approve exactly-once; same-key/different-payload 409; injected ledger failure → atomic rollback + durable FAILED + retry no re-execute. Verdict `.local/sec02-gate/ver-evidence/VERIFIER_VERDICT.md`.

## 5. Post-integration verification

| Check                 | Result                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 7 merge         | `acd83556` (--no-ff, ort, no conflicts)                                                                                                                   |
| Tracked modifications | 0                                                                                                                                                         |
| Migration checksums   | 37/37 (0000-0035 byte-identical)                                                                                                                          |
| Frozen owners         | Phase 6 refund path only; other Phase 6 + Phase 1/3/5 code untouched                                                                                      |
| `main`                | unchanged `69240bf84d7d8e0cf58c86ce25a88a5aa105db05`; no PR/merge/deploy                                                                                  |
| Push / local = remote | PUSH PENDING — host channel restoration (same note as S7C; batch push scheduled on first available host channel before the Phase 7 final delivery report) |

## 6. Declarations

```
SEC02_OWNER_REMEDIATION_INTEGRATED
SEC-02_COMPLETE_OPENCLAW_INTERNAL
```

OpenClaw internal gate — NOT Command Center acceptance. Next per Command Center order: **Phase 6 Admin Route Security** (full scan: auth/RBAC/current-market/resource-market/step-up/member-denied/support-raw-ledger-denied/direct+in-process bypass denied/no unsecured legacy routes/no duplicated Phase 7 owner logic) → P7-S8 → P7-S9 → P7-S10 → Phase 7 Final Delivery Report.

_Forward-only record. Do not delete or rewrite._
