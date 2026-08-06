# P7-S7A Delivery Report — Manual MCP Adjustment Maker/Checker (D-046 conformance)

- **Branch:** `task/p7-s7a-mcp-conformance` (worktree `/workspace/.local/wt-p7-s7a-mcp`, base `phase/7-admin-operations` @ `0fa7322c`)
- **Executor class:** OPENCLAW_MANAGED_CODING_SUBAGENT (D-048)
- **Scope:** P7-S7A Manual MCP Adjustment conformance (D-046 P7-OD-03/10/11/18, P7-S1 §16). Owner + Finance read projections + tests. Admin Web UI explicitly OUT of scope (S7B).
- **Status:** implementation complete; gate evidence in `/workspace/.local/s7a-gate/evidence/`.

---

## 1. Commit list (not pushed)

| SHA | Commit | Scope |
|---|---|---|
| `b09c5b9b` | feat(database): P7-S7A MCP adjustment D-046 conformance schema (0035) | Migration 0035, checksums 35→36, schema/index.ts, expected-schema.ts, foundation seed (MY caps + reason codes) |
| `8054a05f` | feat(merchant): P7-S7A Manual MCP adjustment owner (D-046 conformance) | `McpAdjustmentOwnerService` + types + errors + module registration |
| `885ef523` | test(merchant): P7-S7A MCP adjustment owner unit + real-PG integration suites | 20 unit + 23 integration tests |
| `fbeb9b80` | feat(merchant): rewire MCP adjustment HTTP surface to the conformed owner | controller/DTO/mcp.service cleanup (−320 lines old flow), Finance queue/history projections |
| `11075e81` | test(merchant): align Phase 1 merchant integration suite with P7-S2A sessions and D-046 contract | ADMIN sessions + step-up grants + conformed evidence contract |
| `daeff9ed` | style(merchant): lint + prettier cleanup on P7-S7A changed files | eslint 0 problems, prettier clean |
| `005ed4ab` | fix(merchant): map mcp adjustment owner errors to http statuses + test | H-1 fix (independent review): `handle()` owner-error→HttpException mapping in `mcp.controller.ts` + HTTP-layer error-code spec (6 tests) |

---

## 2. Owner contract (McpAdjustmentOwnerService — `apps/api/src/merchant/mcp-adjustment.owner.service.ts`)

New merchant-domain code; existing recharge/refund/ledger behavior untouched. Lifecycle (P7-S1 §16 / D-046):
`DRAFT -> SUBMITTED -> APPROVED | REJECTED -> EXECUTING -> EXECUTED | FAILED`

| Control | Enforcement |
|---|---|
| Identity/permission | server-side re-check per command (`merchant.mcp.adjust` maker / `.approve` checker / `.execute` checker, canonical catalog) + ACTIVE admin via `RbacService.isAllowed` |
| Market | server Current Admin Market required; account/request market must equal it (`MARKET_CONTEXT_MISMATCH`); active Market Access re-checked in every command |
| Maker/Checker inequality | runtime `checker != maker` at decide AND execute, every amount incl. Super Admin; DB CHECK `checker_admin_user_id <> maker_admin_user_id` on the request row (migration 0035) |
| Caps routing (P7-OD-10) | versioned per-market `mcp_adjustment_market_rules` (MY baseline 10,000/100,000 MCP seeded; no fallback — unconfigured market blocked `MARKET_NOT_CONFIGURED`). > hard cap rejected at create. ≤ soft: Finance Approver may check (RBAC). soft–hard: Super Admin role required (`CHECKER_ROUTING_DENIED` otherwise) |
| Evidence (P7-OD-11) | reasonCode (active market-scoped catalog) + explanation + caseReference + maker/checker identity+timestamps required; opaque attachment reference (≤500 chars, never contents) mandatory above soft cap / high-risk code / checker `requireAttachment`; above-soft EXECUTION disabled until `secure_evidence_available` (versioned per-market, default false) |
| Rejected handling (P7-OD-18) | rejected immutable (no resubmit/re-decide); replacement = new request + new idempotency key + `priorRequestId` linkage validated (existing REJECTED, same account+market); original key replay returns the immutable rejected record, different payload → 409 |
| Idempotency | operation-scoped unique (scope, key) — scope `mcp.adjustment.owner.create:<account>:<actor>`; canonical payload hash (sorted keys sha256, incl. operation/market/account/entryType/amount/reasonCode/explanation/caseReference/attachment/priorRequestId/actor); same key+payload replay; same key+different payload 409; DB partial unique index = single winner |
| Execution | ONE transaction: row-lock request (FOR UPDATE) → revalidate everything (target/amount/evidence/limits/Maker inequality/caps) → EXECUTING → MCP ledger append (`append_mcp_ledger_entry`, the accepted direction-aware Phase 1 MCP ledger owner) → EXECUTED + audit. Terminal states replay (no ledger touch) |
| Failure semantics | validation failure before the ledger seam → stays APPROVED (retryable, no FAILED). Ledger/execution failure → full rollback (no partial ledger, balance unchanged) + durable FAILED + `MCP_ADJUSTMENT_EXECUTE_FAILED` audit; retry replays FAILED, never a duplicate ledger effect |
| Audit | `MCP_ADJUSTMENT_CREATED/SUBMITTED/APPROVED/REJECTED/EXECUTED/EXECUTE_FAILED` with who/when/what/before-after/reason/result in the same transaction |
| No direct mutation | only `append_mcp_ledger_entry` touches `mcp_accounts` balances (grep evidence) |
| Finance read projections | `listForMarket(marketId, {state?, limit, offset})` + `detail(marketId, requestId)` incl. immutable decision history — `merchant.mcp.view` (Finance roles + Super Admin) |

### Ledger-append contract note (accepted MCP ledger owner)

Unlike SEC-01's wallet case, the accepted Phase 1 MCP ledger append (`append_mcp_ledger_entry`, migration 0005) is **already direction-aware** (CREDIT/DEBIT with exact before/after deltas, balance invariants, global idempotency key). The conformed owner reuses it as-is inside the same transaction; **no contract-interpretation issue exists for MCP** (unlike the credit-only wallet service in SEC-01). No dedicated MCP ledger command was required.

---

## 3. D-046 alignment matrix

| D-046 requirement (P7-OD-03/10/11/18, P7-S1 §16) | Implementation | Verification |
|---|---|---|
| Reuse accepted MCP ledger owner + durable request/decision structures | `mcp_adjustment_requests`/`mcp_adjustment_decisions` reused (extended by 0035); `append_mcp_ledger_entry` reused | integration suite (ledger assertions) |
| Every amount distinct Maker/Checker, server-derived | runtime inequality + DB CHECK on request row | unit + integration (`Maker/Checker inequality`) |
| Malaysia soft 10,000 / hard 100,000; ≤soft Finance Approver may check; soft–hard Super Admin must check; >hard rejected | versioned per-market rules; RBAC + SUPER_ADMIN role check; hard-cap reject at create | integration (`caps routing`) |
| Evidence: reason code + explanation + case/ticket + Maker/Checker identity/time | reasonCode/explanation/caseReference columns + maker/checker ids + timestamps | integration (audit + decision rows) |
| Attachment opaque ref; mandatory above soft / high-risk / checker request | attachmentReference ≤500; enforced at create + decide | integration (`evidence and attachment rules`) |
| Above-soft execution disabled until secure storage approved | `secure_evidence_available` per-market, default false | integration (disable → enable → execute) |
| Checker revalidates session/MFA/permission/market/request/version/state/target/amount/evidence/limits/balance/Maker inequality | full revalidation at decide + execute; step-up via catalog; row version guards | integration (state/version guards, concurrency) |
| Rejected immutable; replacement = new request + new idempotency/decision + prior link | priorRequestId linkage; no resubmit/re-decide; new idempotency records | integration (`rejected requests`) |
| Atomic execution: ledger append + state + audit one transaction | single tx; injected failure → rollback → FAILED; retry no duplicate | integration (`atomic failure handling`) |
| Direct MCP balance mutation prohibited | only `append_mcp_ledger_entry`; grep evidence | `grep-no-direct-mutation` |
| D-002 C-03: Maker/Checker no amount threshold | inequality enforced at every amount incl. tiny amounts | unit + integration |
| Permission catalog | existing `merchant.mcp.adjust` (maker), `.adjust.approve`/`.adjust.execute` (checker, step-up), `.view` (Finance) — no catalog changes needed | catalog drift test unchanged |

---

## 4. Migration 0035 (single owner)

- `adjustment_state` enum extended with `SUBMITTED`, `EXECUTING`, `FAILED` (legacy `PENDING_APPROVAL`/`CANCELLED` rows untouched).
- `mcp_adjustment_requests` extended: `reason_code`, `case_reference`, `attachment_reference`, `checker_admin_user_id`, `submitted_at`, `executed_at`, `failed_at`, `idempotency_scope`, `prior_request_id`; CHECKs for evidence lengths + `checker <> maker`; legacy `(mcp_account_id, idempotency_key)` unique replaced by partial unique `(idempotency_scope, idempotency_key) WHERE scope IS NOT NULL` (operation-scoped idempotency, exactly like the accepted SEC-01 wallet owner); status+market index for the queue projection; evidence-identity immutability trigger.
- New tables: `mcp_adjustment_market_rules` (versioned per-market caps + secure-evidence flag), `mcp_adjustment_reason_codes` (market-scoped catalog with high-risk flags).
- Foundation seed: MY baseline 10,000/100,000 MCP (secure evidence disabled) + 4 reason codes (OPERATIONAL_CORRECTION, EXACT_OPPOSITE_COMPENSATION low-risk; FRAUD_RECOVERY, SYSTEM_OUTAGE_REMEDY high-risk).
- Checksums: 35 → **36/36** (`db:checksum` verified).
- New columns are nullable so legacy rows keep their original freeform representation (never backfilled with invented text — D-053 precedent); the owner requires them for every NEW request.

---

## 5. HTTP surface (S7A; Admin Web UI deferred to S7B)

Same accepted Phase 1 route paths, now owner-backed:
- `POST /admin/markets/:marketId/mcp/accounts/:accountId/adjustments` (maker) — D-046 evidence contract
- `POST /admin/markets/:marketId/merchants/:branchId/adjustments` (maker, branch resolve)
- `POST /admin/markets/:marketId/mcp/adjustments/:requestId/submit` (maker)
- `POST /admin/markets/:marketId/mcp/adjustments/:requestId/decision` (checker; APPROVED|REJECTED only — no auto-execute)
- `POST /admin/markets/:marketId/adjustments/:requestId/approve` (checker alias)
- `POST /admin/markets/:marketId/adjustments/:requestId/execute` (checker; no body)
- New Finance read projections: `GET /admin/markets/:marketId/mcp/adjustments?state=&limit=&offset=` and `GET /admin/markets/:marketId/mcp/adjustments/:requestId` (`merchant.mcp.view`)

The old auto-execute `decideAdjustment` combined approve+execute was removed (D-046 requires separate decide and execute boundaries with Checker revalidation at each). Old `mcp.service.ts` adjustment methods removed to eliminate bypass paths; recharge/refund/ledger untouched.

---

## 6. Test matrix (evidence in `/workspace/.local/s7a-gate/evidence/`)

| # | Gate | Command (exact) | Result | EXIT_CODE |
|---|---|---|---|---|
| 01 | checksum | `pnpm --filter @ipoint/database db:checksum` | 36 immutable checksums verified | 0 |
| 02 | S7A owner unit | `pnpm --filter @ipoint/api test src/merchant/mcp-adjustment.owner.spec.ts` | 20 passed | 0 |
| 03 | S7A owner integration | `pnpm --filter @ipoint/api test src/merchant/mcp-adjustment.owner.integration.spec.ts` (isolated DB `ipoint_gate_s7a_owner`) | 23 passed | 0 |
| 04 | Phase 1 MCP integration | `pnpm --filter @ipoint/api test src/merchant/__tests__/merchant.integration.spec.ts` | 6 passed / 4 pre-existing upstream failures (see §8) | 1 (upstream debt) |
| 05 | Phase 1 MCP unit | merchant.service + package.dto + ownership.guard + kyc-masking + kyc-storage specs | 36 passed | 0 |
| 06 | Phase 3 wallet invariants | `test src/__tests__/ledger-invariants.spec.ts src/__tests__/concurrency.spec.ts src/__tests__/cross-module-integration.spec.ts` | 68 passed | 0 |
| 07 | SEC-01 unit | `test src/wallet/wallet-adjustment.owner.spec.ts` | 18 passed | 0 |
| 08 | SEC-01 integration | `test src/wallet/wallet-adjustment.owner.integration.spec.ts` | 22 passed | 0 |
| 09 | S6E | `test src/market/market-owner.spec.ts src/market/market-owner.integration.spec.ts` | 46 passed | 0 |
| 10 | S6D | `test src/admin-commission-ops/admin-commission-ops.spec.ts …integration.spec.ts` | 41 passed | 0 |
| 11 | S6A | `test src/admin-package-ops/admin-package-ops.spec.ts …integration.spec.ts` (DB pre-created) | 54 passed | 0 (rerun) |
| 12 | S6B | `test src/admin-reward-ops/admin-reward-ops.spec.ts …integration.spec.ts` | 38 passed | 0 |
| 13 | S6C | `test src/admin-redemption-ops/admin-redemption-ops.spec.ts …integration.spec.ts` | 49 passed | 0 |
| 14 | D-051 | `test src/__tests__/d051-special-percentage.owner.integration.spec.ts` | 27 passed | 0 |
| 15 | D-054 | `test src/__tests__/commission-rate.owner.integration.spec.ts` | 51 passed | 0 |
| 16 | api typecheck | `pnpm --filter @ipoint/api typecheck` | pass | 0 |
| 17 | api build | `pnpm --filter @ipoint/api build` | pass | 0 |
| 18 | OpenAPI | `pnpm --filter @ipoint/api openapi:validate` | 240 paths (baseline 238 + 2 read projections), 0 missing, 0 duplicate, all validations passed | 0 (PASS_DETECTED) |
| 19 | api-client typecheck | `pnpm --filter @ipoint/api-client typecheck` | pass | 0 |
| 20 | api-client test | `pnpm --filter @ipoint/api-client test` | 75 passed | 0 |
| 21 | api-client build | `pnpm --filter @ipoint/api-client build` | pass | 0 |
| 22 | admin-web typecheck | `pnpm --filter @ipoint/admin-web typecheck` | pass | 0 |
| 23 | admin-web test | `pnpm --filter @ipoint/admin-web test` | 250 passed | 0 |
| 24 | admin-web build | `pnpm --filter @ipoint/admin-web build` | pass | 0 |
| 25 | lint (changed files) | `npx eslint <14 changed files>` | 0 problems | 0 |
| 26 | prettier (changed files) | `npx prettier --check <13 files>` | clean | 0 |
| 27 | DB package suite | `pnpm --filter @ipoint/database test` | 58 passed / 4 failed (identical to baseline upstream debt) | 1 (upstream debt) |
| 28 | admin-dashboard (supplementary) | `test src/admin-dashboard/admin-dashboard.integration.spec.ts` | 14 passed | 0 |

---

## 7. S7B dependency interface

1. `McpAdjustmentOwnerService` commands (HTTP adapter already wired in S7A):
   - `create(actor, {mcpAccountId, entryType, amount, reasonCode, explanation, caseReference, attachmentReference?, priorRequestId?, idempotencyKey})`
   - `submit(actor, {requestId})`
   - `decide(actor, requestId, {decision, reason, requireAttachment})`
   - `execute(actor, {requestId})`
2. Read projections already exposed: queue list (state-filterable, paginated) + detail with decision history (`merchant.mcp.view`).
3. Transport contracts: `x-market-id` server context + `Idempotency-Key` on create; `x-step-up-token` for checker/execute (catalog stepUpRequired).
4. Error-code mapping (final — enforced at the HTTP boundary by `McpController.handle()`, the accepted market-owner / admin-commission-ops pattern; H-1 fix `005ed4ab`):

   | `McpAdjustmentOwnerError` code(s) | HTTP | Meaning |
   |---|---:|---|
   | `MCP_ADJUSTMENT_PERMISSION_DENIED`, `MCP_ADJUSTMENT_MARKET_ACCESS_DENIED`, `MCP_ADJUSTMENT_MAKER_REQUIRED`, `MCP_ADJUSTMENT_MAKER_CHECKER_CONFLICT`, `MCP_ADJUSTMENT_CHECKER_ROUTING_DENIED` | 403 | permission / maker-checker / routing denial |
   | `MCP_ADJUSTMENT_ACCOUNT_NOT_FOUND`, `MCP_ADJUSTMENT_REQUEST_NOT_FOUND` | 404 | resource not found |
   | `MCP_ADJUSTMENT_MARKET_SELECTION_REQUIRED`, `MCP_ADJUSTMENT_MARKET_CONTEXT_MISMATCH`, `MCP_ADJUSTMENT_IDEMPOTENCY_CONFLICT`, `MCP_ADJUSTMENT_STATE_CONFLICT`, `MCP_ADJUSTMENT_PRIOR_REQUEST_INVALID` | 409 | market context / idempotency / state / replacement-reference conflicts |
   | `MCP_ADJUSTMENT_IDEMPOTENCY_KEY_REQUIRED`, `MCP_ADJUSTMENT_INVALID_FIELD`, `MCP_ADJUSTMENT_DECISION_REASON_REQUIRED`, `MCP_ADJUSTMENT_INVALID_AMOUNT` | 400 | request-format / required-field errors |
   | `MCP_ADJUSTMENT_MARKET_NOT_CONFIGURED`, `MCP_ADJUSTMENT_ABOVE_HARD_CAP`, `MCP_ADJUSTMENT_REASON_CODE_INVALID`, `MCP_ADJUSTMENT_ATTACHMENT_REQUIRED`, `MCP_ADJUSTMENT_EVIDENCE_STORAGE_UNAVAILABLE`, `MCP_ADJUSTMENT_INSUFFICIENT_BALANCE` | 422 | business / evidence / caps validation |
   | `MCP_ADJUSTMENT_EXECUTION_FAILED` | 500 | server-side execution failure (not client-correctable; owner code preserved) |

   Response body is always `{ error: { code, message, details? }, requestId, timestamp }`; unknown errors propagate unchanged (never swallowed, never mapped to 2xx). HTTP-layer assertions live in `mcp-adjustment.owner.http.integration.spec.ts` (6 tests: Maker≠Checker 403, idempotency 409, above-hard-cap 422, request-not-found 404, market-not-configured 422, state conflict 409 — status + owner code in body).
5. Governance prerequisite: above-soft-cap execution stays disabled until secure evidence storage policy is approved (P7-OD-11) — surfaced per-market via `secure_evidence_available`.

---

## 8. Deviations / upstream debt

- **Pre-existing upstream DB-suite debt (NOT introduced by S7A; byte-identical failure set on `phase/7-admin-operations` baseline):** 4 failures — (1) p7-s2c catalog count 66-vs-67 (S6E added codes, test not updated), (2) frozen six-role matrix counts, (3) phase3-schema "should allow Phase 5 migrations" stale `^0019_` expectation, (4) schema.unit 20-migration list stale. Authoritative `db:checksum` gate verifies 36/36. Documented by SEC-01 §8 as upstream items for Command Center; unchanged by S7A.
- **Pre-existing Phase 1 merchant integration suite debt:** on the pristine baseline the suite failed 7/10 because admin sessions were ACCOUNT-purpose (never satisfy the P7-S2A admin RbacGuard). S7A fixed the bootstrap (ADMIN sessions + Current Admin Market + step-up) so 6/10 now pass. The remaining 4 failures are upstream, not S7A regressions: (1) recharge route uses the P7-S2C-frozen deprecated `merchant.mcp.recharge.review` permission (authorizes nothing by design), (2) refund-review step in the maker-checker test uses the frozen deprecated `merchant.refund.manage` permission, (3) special-percentage route now requires step-up (P7-S2A catalog) which the old test never supplied, (4) activation status expectation `PENDING_MCP` vs the current `PENDING_KYC` policy (O-13/activation-policy drift, unrelated to MCP). Each failure was reproduced identically on the baseline with working sessions.
- **None blocking for S7A.** Contract-interpretation note: none required for the MCP ledger owner (already direction-aware; see §2).
- Admin Web UI intentionally not built (S7B scope); S7A delivers owner conformance + read projections + tests.

---

## 9. H-1 fix record (independent review remediation)

- **Finding:** REVIEWER_S7A_20260806 H-1 — `McpAdjustmentOwnerError` (plain `Error`) was never converted to `HttpException`; the global `AllExceptionsFilter` therefore returned **HTTP 500 INTERNAL_ERROR** for every owner business code (Maker≠Checker, idempotency, state, above-hard-cap, market-not-configured, request-not-found, …), contradicting the §7.4 contract and the repo's accepted owner pattern.
- **Fix commit:** `005ed4ab` — `fix(merchant): map mcp adjustment owner errors to http statuses + test`.
  - `apps/api/src/merchant/mcp.controller.ts`: added `handle()` (market-owner / admin-commission-ops pattern) wrapping all 8 owner surface calls (create ×2, submit, decision, approve-alias, execute, queue, detail); every `McpAdjustmentOwnerError` code maps to its §7.4 HTTP status (see §7.4 table); unknown errors propagate; `MCP_ADJUSTMENT_EXECUTION_FAILED` keeps 500 with owner code (server-side failure, not client-correctable).
  - `apps/api/src/merchant/__tests__/mcp-adjustment.owner.http.integration.spec.ts`: new HTTP-layer spec (supertest, real PG `ipoint_gate_s7a_http`) asserting status + `body.error.code` for the six contract cases.
- **Regression:** gate evidence logs 29–39 in `/workspace/.local/s7a-gate/evidence/` — S7A unit 20/20, S7A integration 23/23, HTTP spec 6/6, Phase 1 merchant integration 6/10 (identical 4-failure upstream set as gate 04), S6E 46/46, SEC-01 40/40, typecheck/build/lint/prettier clean.
- **Scope guard:** only `mcp.controller.ts` + new spec changed; no frozen domain, no SEC-01 wallet-adjustment.owner, no migrations, no tsconfig changes.

---

*Executor: OPENCLAW_MANAGED_CODING_SUBAGENT (implementer). No push performed; branch `task/p7-s7a-mcp-conformance` only.*
