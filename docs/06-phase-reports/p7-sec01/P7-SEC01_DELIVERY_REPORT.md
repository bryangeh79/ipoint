# SEC-01 Delivery Report — Manual iPoint Adjustment Maker/Checker (fix/p3-p7-sec01-ipoint-maker-checker)

- **Branch:** `fix/p3-p7-sec01-ipoint-maker-checker` (worktree `/workspace/.local/wt-p3-p7-sec01-ipoint`, base `phase/7-admin-operations` @ `8192fbdd`)
- **Scope:** GATE-SEC-01 owner remediation (A. migration 0034, B. wallet-domain owner, C. immediate endpoint disabled). P7-S7B UI explicitly OUT of scope (dependency list below).
- **Status:** implementation complete; gates recorded in `/workspace/.local/sec01-gate/evidence/`.

## 1. Commit list (not pushed)

| SHA | Commit | Scope |
|---|---|---|
| `b0640b4c` | feat(database): SEC-01 iPoint adjustment Maker/Checker schema (0034) | Migration 0034, checksums 34→35, schema/index.ts, expected-schema.ts, foundation seed (MY caps baseline) |
| `b7644429` | feat(wallet): SEC-01 manual iPoint adjustment owner (P7-OD-20) | `WalletAdjustmentOwnerService` + types/errors + wallet.module registration |
| `aa575301` | test(wallet): SEC-01 owner unit + real-PostgreSQL integration suites | 18 unit + 22 integration tests |
| `5539eb50` | fix(admin-reward): remove the immediate iPoint adjustment endpoint (P7-AC-15) | controller/service/dto/types/errors/spec cleanup (−666 lines) |
| `e5e934cc` | docs(sec01): record P7 SEC-01 iPoint Maker/Checker delivery report | repo copy of this report |
| `5761b728` | test(database): drop removed `wallet.adjustment.create` from deprecated-route drift set | keeps the DB suite drift test green after endpoint removal |

## 2. Owner contract (WalletAdjustmentOwnerService — `apps/api/src/wallet/wallet-adjustment.owner.service.ts`)

New wallet-domain code; existing member-facing wallet behavior untouched. Lifecycle (P7-OD-20):
`DRAFT -> SUBMITTED -> APPROVED | REJECTED -> EXECUTING -> EXECUTED | FAILED`

| Control | Enforcement |
|---|---|
| Identity/permission | server-side re-check per command (`wallet.ipoint.adjust.maker` / `.checker` / `.execute`, canonical catalog) + ACTIVE admin via `RbacService.isAllowed` |
| Market | server Current Admin Market required; wallet/request market must equal it (`MARKET_CONTEXT_MISMATCH`); active Market Access re-checked in every command |
| Maker/Checker inequality | runtime `checker != maker` at decide AND execute, every amount incl. Super Admin; DB CHECK `checker_admin_user_id <> maker_admin_user_id` as hard guarantee |
| Caps routing (P7-OD-10) | versioned per-market `ipoint_adjustment_market_rules` (MY baseline 10,000/100,000 seeded; no fallback — unconfigured market blocked `MARKET_NOT_CONFIGURED`). > hard cap rejected at create. ≤ soft: Finance Approver may check (RBAC). soft–hard: Super Admin role required (`CHECKER_ROUTING_DENIED` otherwise) |
| Evidence (P7-OD-11) | reasonCode (active market-scoped catalog) + explanation + caseReference + maker/checker identity+timestamps required; opaque attachment reference (≤500 chars, never contents) mandatory above soft cap / high-risk code / checker `requireAttachment`; above-soft EXECUTION disabled until `secure_evidence_available` (versioned per-market, default false) |
| Rejected handling (P7-OD-18) | rejected immutable (no resubmit/re-decide); replacement = new request + new idempotency key + `priorRequestId` linkage validated (existing REJECTED, same wallet+market); original key replay returns the immutable rejected record, different payload → 409 |
| Idempotency | operation-scoped unique (scope, key) on the request row (`ipoint.adjustment.owner.create:<wallet>:<actor>`); canonical payload hash (sorted keys, sha256, incl. operation/market/wallet/member/amount/direction/reason/actor); same key+payload replay; same key+different payload 409; DB unique = single winner |
| Execution | ONE transaction: row-lock request (FOR UPDATE) → revalidate everything (target/amount/evidence/limits/Maker inequality) → EXECUTING → dedicated wallet-domain ledger append (direction-aware, exact before/after, version guard, unique ledger idempotency key `ipoint-adjustment:<requestId>`, referenceType `IPOINT_ADJUSTMENT` + request id) → EXECUTED + audit. Terminal states replay (no ledger touch) |
| Failure semantics | validation failure before the ledger seam → stays APPROVED (retryable, no FAILED). Ledger/execution failure → full rollback (no partial ledger, balance unchanged) + durable FAILED + `execute_failed` audit; retry replays FAILED, never a duplicate ledger effect |
| Audit | `ipoint.adjustment.create/submit/approve/reject/execute/execute_failed` with who/when/what/before-after/reason/result in the same transaction |
| No direct mutation | only the dedicated append touches `member_wallet_accounts` (verified by grep, see evidence `grep-no-direct-mutation.txt`) |

## 3. Ledger-append contract note (frozen wallet ledger service)

The frozen `WalletService.createLedgerEntry` is credit-only (`ADJUSTMENT` always adds) and opens its own transaction, so it cannot express the required DEBIT direction or compose atomically with request state. Per the P7-S1 breakdown's "dedicated Wallet ledger command" deliverable, SEC-01 implements the direction-aware append inside the wallet domain (`appendLedgerEntry`) with identical immutable-ledger semantics (sequence, exact before/after, version guard, global idempotency key) and `WalletService` is left untouched. **Contract-interpretation note for Command Center** (not a blocker): the frozen service itself could not satisfy P7-OD-20's exact-opposite direction requirement; the dedicated command is the resolution within the authorized wallet-domain scope.

## 4. Caps / evidence implementation

- `ipoint_adjustment_market_rules` — per-market `soft_cap`/`hard_cap`/`secure_evidence_available`, versioned, upserted by seed (MY: 10000/100000, evidence disabled). No hard-coded values in service logic; unconfigured markets blocked.
- `ipoint_adjustment_reason_codes` — per-market catalog, `is_high_risk` flags; MY baseline: `OPERATIONAL_CORRECTION`, `EXACT_OPPOSITE_COMPENSATION` (low risk), `FRAUD_RECOVERY`, `SYSTEM_OUTAGE_REMEDY` (high risk). Values are CONFIGURABLE market data (Command Center approval required to change).
- Evidence gate: `secure_evidence_available=false` keeps above-soft-cap execution disabled (test proves disable → enable → execute on the same approved request).

## 5. Immediate endpoint disabled (P7-AC-15)

- `POST /api/v1/admin/rewards/wallets/:id/adjustment` (`@RequirePermission('wallet.adjustment.create')`) **removed** from `admin-reward.controller.ts`; `requestWalletAdjustment` + compensating-entry path removed from the service; DTO/types/errors cleaned; unit spec updated. No other references remain (grep evidence).
- OpenAPI paths: baseline 239 (phase/7 HEAD) → 238 (this branch). `openapi:validate` passes.
- The non-canonical `wallet.adjustment.create` permission remains absent from the catalog (p7-s2c guard spec still proves crafted requests with it are denied).

## 6. S7B dependency interface (what Phase 7 iPoint admin UI needs)

1. `WalletAdjustmentOwnerService` commands (HTTP adapter to be built in S7B):
   - `create(actor, {walletAccountId, direction, amount, reasonCode, explanation, caseReference, attachmentReference?, priorRequestId?, idempotencyKey})`
   - `submit(actor, requestId)`
   - `decide(actor, requestId, {decision, reason, requireAttachment})`
   - `execute(actor, requestId)`
2. Read projections needed by the UI (NOT implemented here, S7B or safe adapter): list requests by state+market, request detail with decision history, wallet/member lookup for the maker screen, opaque attachment reference pass-through (no content), evidence-status (secure storage) surfacing for above-soft queues.
3. Transport contracts for S7B: `x-market-id` server context + `Idempotency-Key` header on create; `x-step-up-token` for checker/execute (step-up grants already consumed by RbacGuard via catalog `stepUpRequired`).
4. Error-code mapping: the owner throws `WalletAdjustmentOwnerError` codes (list in `wallet-adjustment.owner.errors.ts`); S7B adapter should map to HTTP statuses (e.g., 404 not found, 403 permission/market, 409 state/idempotency/mismatch, 422 caps/evidence/amount).
5. Governance prerequisite: GATE-SEC-01 acceptance + secure evidence storage policy before exposing above-soft-cap execution in the UI.


## 7. Gate matrix (evidence in /workspace/.local/sec01-gate/evidence/)

| Gate | Command (exact) | Result | EXIT_CODE |
|---|---|---|---|
| 01-checksum | `pnpm --filter @ipoint/database db:checksum` | 35 immutable checksums verified | 0 |
| 02-sec01-unit | `pnpm --filter @ipoint/api test src/wallet/wallet-adjustment.owner.spec.ts` | 18 passed | 0 |
| 03-sec01-integration | `pnpm --filter @ipoint/api test src/wallet/wallet-adjustment.owner.integration.spec.ts` (isolated DB `ipoint_gate_sec01_owner`) | 22 passed | 0 |
| 04-s6b | `pnpm --filter @ipoint/api test src/admin-reward-ops/admin-reward-ops.spec.ts src/admin-reward-ops/admin-reward-ops.integration.spec.ts` | 38 passed | 0 |
| 05-wallet-domain | `pnpm --filter @ipoint/api test src/wallet/wallet.service.spec.ts src/wallet/wallet.http.integration.spec.ts` | 19 passed | 0 |
| 06-reward-domain | `pnpm --filter @ipoint/api test src/reward/reward.service.spec.ts src/reward/reward-o13-route.spec.ts` | 37 passed | 0 |
| 07-phase3-invariants | `pnpm --filter @ipoint/api test src/__tests__/ledger-invariants.spec.ts src/__tests__/concurrency.spec.ts src/__tests__/cross-module-integration.spec.ts` | 68 passed | 0 |
| 08-s6a | `pnpm --filter @ipoint/api test src/admin-package-ops/admin-package-ops.spec.ts src/admin-package-ops/admin-package-ops.integration.spec.ts` (pre-bootstrapped DB `ipoint_gate_sec01_s6a`) | 54 passed | 0 |
| 09-s6c | `pnpm --filter @ipoint/api test src/admin-redemption-ops/admin-redemption-ops.spec.ts src/admin-redemption-ops/admin-redemption-ops.integration.spec.ts` | 49 passed | 0 |
| 10-s6d | `pnpm --filter @ipoint/api test src/admin-commission-ops/admin-commission-ops.spec.ts src/admin-commission-ops/admin-commission-ops.integration.spec.ts` | 41 passed | 0 |
| 11-d051 | `pnpm --filter @ipoint/api test src/__tests__/d051-special-percentage.owner.integration.spec.ts` | 27 passed | 0 |
| 12-d054 | `pnpm --filter @ipoint/api test src/__tests__/commission-rate.owner.integration.spec.ts` | 51 passed | 0 |
| 13-s6e | `pnpm --filter @ipoint/api test src/market/market-owner.spec.ts src/market/market-owner.integration.spec.ts` | 46 passed | 0 |
| 14-api-typecheck | `pnpm --filter @ipoint/api typecheck` | pass | 0 |
| 15-api-build | `pnpm --filter @ipoint/api build` | pass | 0 |
| 16-openapi | `pnpm --filter @ipoint/api openapi:validate` | 238 paths (baseline 239), all validations passed | 0 |
| 17-api-client | `pnpm --filter @ipoint/api-client typecheck && test && build` | pass | 0 |
| 18-admin-web | `pnpm --filter @ipoint/admin-web typecheck && test && build` | pass | 0 |
| 19-lint-changed | `npx eslint <all changed files>` | 0 problems | 0 |
| 20-prettier-check | `npx prettier --check <all changed files>` | clean | 0 |

Notes: gate 02 originally ran without DATABASE_URL in the first matrix pass (env-setup requirement) and was re-run with the env set (18/18, EXIT_CODE=0). Gate 08 requires a pre-existing migrated+seeded database (S6A spec does not drop/create its own); it was bootstrapped with `create-db.mjs` + `db:migrate` + `db:seed` and re-run (54/54, EXIT_CODE=0). All other DB-heavy suites create their own isolated database in `beforeAll`.

## 8. Deviations / legacy notes

- **Pre-existing upstream database-test debt (NOT introduced by SEC-01, byte-identical on the `phase/7-admin-operations` baseline):** `packages/database` suite has 4 failures on baseline AND on this branch — (1) p7-s2c catalog count 66-vs-67 (S6E added codes, test not updated), (2) frozen six-role matrix counts, (3) `phase3-schema` "should allow Phase 5 migrations" stale `^0019_` expectation, (4) `schema.unit` 20-migration list stale. The authoritative `db:checksum` gate verifies 35/35. These are upstream items for the Command Center, not SEC-01 regressions.
- The ONE new DB-suite failure caused by SEC-01 (deprecated-route drift requiring the removed `wallet.adjustment.create` decorator) was fixed in `5761b728`; guard-level denial coverage of the literal code remains in `p7-s2c-rbac.guard.spec.ts`.

- None blocking. Interpretation note in §3 (dedicated wallet ledger command).
- `wallet.http.integration.spec.ts` tests are `.skip`-ped by default upstream (unchanged).
- The old admin-reward unit spec's wallet-adjustment tests were removed together with the removed endpoint (they tested the insecure immediate path).
