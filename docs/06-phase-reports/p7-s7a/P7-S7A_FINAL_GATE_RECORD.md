# P7-S7A — Final Forward-Only Gate Record (Manual MCP Adjustment Conformance)

| Field | Value |
|---|---|
| **Record** | P7-S7A FINAL GATE — McpAdjustmentOwnerService (D-046 conformance: Maker/Checker, caps, evidence, idempotency, atomic execution) |
| **Status** | `P7-S7A_DELIVERY_COMPLETE` / `P7-S7A_OPENCLAW_INTERNAL_GATE_PASSED` / `CONTINUING_UNDER_D-055` |
| **Order** | ChatGPT Command Center — D-055 sequence (SEC-01 → P7-S7A → S7B → S7C → SEC-02 …) |
| **Date** | 2026-08-07 |
| **Declaration** | OpenClaw internal gate — NOT Command Center acceptance/closure/freeze |

> Forward-only record. Do not delete or rewrite.

---

## 1. Delivery range

| Item | Value |
|---|---|
| **Branch** | `task/p7-s7a-mcp-conformance` (base `0fa7322c` = phase HEAD incl. SEC-01 gate record) |
| **Commits** | `b09c5b9b` (feat(database): migration 0035) · `8054a05f` (feat(merchant): McpAdjustmentOwnerService) · `885ef523` (test: 20 unit + 23 real-PG integration) · `fbeb9b80` (feat: controller/DTO rewiring −320 lines + Finance queue/detail read projections) · `11075e81` (test: Phase 1 suite alignment) · `daeff9ed` (style) · `a9ac3a52` (docs) · **H-1 fix**: `005ed4ab` (fix: owner error → HTTP status mapping + HTTP spec) · `3a3e76e4` (docs) |
| **Integration** | Merge `5a326f11` (--no-ff, ort, no conflicts) into `phase/7-admin-operations` |
| **Scope** | `apps/api/src/merchant/` (mcp-adjustment.owner.* + mcp.controller/service/dto rewiring + tests) + `packages/database` (0035 + checksums + schema + seeds + expected-schema) + report — 17 paths; `0000-0034` byte-identical; checksums 35/35 → 36/36; frozen `append_mcp_ledger_entry` (Phase 1 owner) zero-touch |

## 2. Owner contract (D-046 conformance)

1. **Maker/Checker**: lifecycle DRAFT→SUBMITTED→APPROVED|REJECTED→EXECUTING→EXECUTED|FAILED; runtime inequality check (incl. Super Admin) + DB CHECK `mcp_adjustment_checker_inequality` + 0006 decision trigger; no amount threshold.
2. **Caps routing**: versioned per-market `mcp_adjustment_market_rules` (MY 10,000/100,000 seed); >hard rejected at create; soft–hard requires SUPER_ADMIN checker; unconfigured market blocked (no fallback).
3. **Evidence**: reason code (market-scoped catalog, high-risk flags), explanation, case reference mandatory; attachment opaque reference mandatory above soft/high-risk/checker request; above-soft execution disabled until `secureEvidenceAvailable` (default false).
4. **Idempotency**: operation-scoped + canonical sha256 payload hash; same key+payload replay; different payload → 409; DB partial unique (scope,key) single winner under concurrency; failed tx no false success.
5. **Atomic execution**: one tx — row lock → revalidation → EXECUTING → `append_mcp_ledger_entry` (direction-aware, global idempotency key `mcp-adjustment:<requestId>`) → EXECUTED + audit; injected ledger failure → full rollback → durable FAILED (fresh tx + audit); retry no duplicate ledger effect.
6. **Immutability**: rejected immutable; replacement via new request + `priorRequestId`; evidence-identity trigger protects key evidence columns; ledger append-only; historical rows untouched (nullable new columns, never backfilled).
7. **No direct balance mutation**: execution only via `append_mcp_ledger_entry`; 0005 projection trigger forbids direct balance changes.
8. **H-1 fix (Review 2)**: `McpController.handle()` maps all 23 owner codes (403×5 / 404×2 / 409×5 / 400×4 / 422×6 / 500 default), propagate-first for non-owner errors, response body `{ error: { code, message, details? }, requestId, timestamp }` via global filter; 6-test HTTP spec (status + code) on full stack.

## 3. Independent review — Review 1 NOT APPROVED (H-1) → Review 2 APPROVED

- **Review 1** (`REVIEWER_S7A_20260806`): 0 Critical / **1 High (H-1 error mapping)** / 0 Medium / 2 Low — all other 13 dimensions PASS.
- **H-1 fix**: `005ed4ab` + `3a3e76e4` (3-file delta, strictly scoped).
- **Review 2** (`REVIEWER_S7A_REVIEW2_20260807`): **APPROVED — H-1 closed, 0 Critical / 0 High**; 23/23 codes mapped (set-difference verified), 6/6 HTTP tests assert status + code, response body format conformant, unknown errors propagate, no 2xx mapping, fix delta exactly 3 files, regression logs 29–39 consistent.

## 4. Independent verification — TEST GATE PASSED

`OPENCLAW_MANAGED_CODING_SUBAGENT` (separate verifier, D-048) on fresh isolated DBs `ipoint_ver_s7a_*` (Node v24.19.0 ≠ implementer v26.4.0; counts grep-verified): **20/20 gates** — checksum 36/36 (0000-0034 byte-identical), S7A unit 20/20, S7A integration 23/23, HTTP mapping 6/6, Phase 1 merchant unit 36/36 (integration 6/10 with identical pre-existing upstream-debt set), S6E 46/46, SEC-01 40/40, S6D 41/41, S6A 54/54, S6B 38/38, S6C 49/49, D-051 27/27, D-054 51/51, api typecheck/build, OpenAPI 240 paths / 0 missing / 0 duplicate, eslint 0 problems, prettier clean. H-1 fix independently confirmed (6/6 assertions incl. 403/404/409/422 codes). Verdict `.local/s7a-gate/evidence/VERIFIER_VERDICT.md`.

## 5. Post-integration verification

| Check | Result |
|---|---|
| Phase 7 merge | `5a326f11` (--no-ff, no conflicts) |
| Tracked modifications | 0 |
| Migration checksums | 36/36 (0035 appended; 0000-0034 byte-identical) |
| `main` | unchanged `69240bf84d7d8e0cf58c86ce25a88a5aa105db05`; no PR/merge/deploy |
| Upstream debt (non-blocking, baseline-identical) | DB-suite 4 failures (catalog 66-vs-67 / role matrix / stale schema expectations); Phase 1 merchant integration 4 failures (deprecated permissions ×2, step-up, O-13 PENDING_MCP drift) — all pre-existing, none introduced by S7A |

## 6. Declarations

```
P7-S7A_DELIVERY_COMPLETE
P7-S7A_OPENCLAW_INTERNAL_GATE_PASSED
```

OpenClaw internal gate — NOT Command Center acceptance. Next per D-055: **P7-S7B (iPoint Admin UI)** → P7-S7C (Finance acceptance) → SEC-02 → Phase 6 Admin Route Security → P7-S8 → P7-S9 → P7-S10 → Phase 7 Final Delivery Report.

*Forward-only record. Do not delete or rewrite.*
