# P7-S7B Delivery Report — Manual iPoint Adjustment Admin Web UI (Maker/Checker)

- **Branch:** `task/p7-s7b-ipoint-admin` (worktree `/workspace/.local/wt-p7-s7b-ipoint-admin`, base `phase/7-admin-operations` @ `a9fe4fbb`)
- **Executor class:** OPENCLAW_MANAGED_CODING_SUBAGENT (D-048, implementer)
- **Scope:** P7-S7B Manual iPoint Adjustment Admin Web UI over the frozen SEC-01 owner (`WalletAdjustmentOwnerService`) + Phase 7 adapter routes + typed api-client (SEC-01 report §6 / P7-S1 §17, P7-OD-03/10/11/18/20, P7-AC-13..16).
- **Status:** implementation complete; gate evidence in `/workspace/.local/s7b-gate/evidence/`.

---

## 1. Commit list (not pushed)

| SHA | Commit | Scope |
|---|---|---|
| `87c69919` | feat(api-client): P7-S7B manual iPoint adjustment typed client | `AdminIpointAdjustOpsApiClient` (append-only) + 5 typed tests |
| `feefbdc1` | feat(api): P7-S7B manual iPoint adjustment Phase 7 adapter | `apps/api/src/admin-ipoint-adjust-ops/` (controller/service/dto/types/errors/module) + app.module registration; 7 unit + 8 real-PG HTTP integration tests |
| `e4426726` | feat(admin-web): P7-S7B manual iPoint adjustment Maker/Checker UI | queue/create/detail pages, model + states, route manifest updates, admin-api/app integration; 10 model + 15 page tests |
| `d5ced47c` | docs(p7-s7b): record manual iPoint adjustment Maker/Checker delivery report | repo copy of this report |
| `401137ce` | fix(api): drop unnecessary type assertions in ipoint adapter projection | eslint gate cleanup in `AdminIpointAdjustOpsService.toView` |
| `b9de3c63` | fix(api-client): prefer-const in S7B list test (eslint gate) | eslint gate cleanup in the api-client test |

No push performed. Working tree clean on `task/p7-s7b-ipoint-admin`.

---

## 2. Scope decision: Phase 7 adapter routes BUILT (not deferred)

SEC-01 delivery report §6.1 explicitly states the HTTP adapter is **to be built in S7B**, §6.2 lists the read projections as "S7B or safe adapter", §6.3 defines the transport contracts (`x-market-id` server context, `Idempotency-Key` on create, `x-step-up-token` for checker/execute) and §6.4 the error-code mapping. This is the S7B interface contract referenced by the task; therefore S7B **builds the Phase 7 adapter** (no frozen owner file touched). The S7A precedent (`mcp.controller.ts` handle() pattern) was followed for the owner-error → HTTP mapping.

**No frozen file was modified:** `wallet-adjustment.owner.*`, `mcp-adjustment.owner.*`, `merchant/**`, `reward/**`, `redemption/**`, `domain/commission/**`, `packages/database/migrations` are all untouched (verified by `git diff HEAD~3 --stat`: only adapter/UI/api-client files + `app.module.ts` import registration).

---

## 3. Interface contract (Phase 7 adapter — `apps/api/src/admin-ipoint-adjust-ops/`)

| Route (all marketScoped RbacGuard) | Permission | Notes |
|---|---|---|
| `POST /admin/ipoint-adjust-ops/markets/:marketId/adjustments` | `wallet.ipoint.adjust.maker` | Maker create → durable DRAFT; `Idempotency-Key` mandatory (same key+payload replays; different payload → 409) |
| `POST .../adjustments/:requestId/submit` | `wallet.ipoint.adjust.maker` | DRAFT → SUBMITTED (owner enforces maker identity) |
| `POST .../adjustments/:requestId/decision` | `wallet.ipoint.adjust.checker` | SUBMITTED → APPROVED \| REJECTED; `x-step-up-token` required (catalog stepUpRequired); APPROVED\|REJECTED only — no auto-execute |
| `POST .../adjustments/:requestId/execute` | `wallet.ipoint.adjust.execute` | APPROVED → EXECUTING → EXECUTED \| FAILED; `x-step-up-token` required; above-soft execution disabled until `secure_evidence_available` |
| `GET .../adjustments?state=&limit=&offset=` | `wallet.ipoint.read` | Finance queue projection (newest first) |
| `GET .../adjustments/:requestId` | `wallet.ipoint.read` | Detail incl. immutable decision history |
| `GET .../config` | `wallet.ipoint.read` | Maker-form support: versioned per-market caps + secure-evidence capability + active reason-code catalog; `configured:false` for unconfigured markets (no fallback) |
| `GET .../wallets?query=` | `wallet.ipoint.read` | Masked wallet/member lookup (public member id, display name, exact balance; never evidence/credentials) |

### Error mapping (SEC-01 §6.4, S7A §7.4 accepted pattern)

| `WalletAdjustmentOwnerError` code(s) | HTTP |
|---|---:|
| `PERMISSION_DENIED`, `MARKET_ACCESS_DENIED`, `MAKER_REQUIRED`, `MAKER_CHECKER_CONFLICT`, `CHECKER_ROUTING_DENIED` | 403 |
| `WALLET_NOT_FOUND`, `REQUEST_NOT_FOUND`, `MARKET_NOT_FOUND`, `WALLET_LOOKUP_EMPTY` | 404 |
| `MARKET_SELECTION_REQUIRED`, `MARKET_CONTEXT_MISMATCH`, `IDEMPOTENCY_CONFLICT`, `STATE_CONFLICT`, `PRIOR_REQUEST_INVALID` | 409 |
| `IDEMPOTENCY_KEY_REQUIRED`, `INVALID_FIELD`, `DECISION_REASON_REQUIRED`, `INVALID_AMOUNT` | 400 |
| `MARKET_NOT_CONFIGURED`, `ABOVE_HARD_CAP`, `REASON_CODE_INVALID`, `ATTACHMENT_REQUIRED`, `EVIDENCE_STORAGE_UNAVAILABLE`, `INSUFFICIENT_BALANCE` | 422 |
| `EXECUTION_FAILED` / unknown | 500 (owner code preserved; never swallowed) |

Response body always `{ error: { code, message, details? }, requestId, timestamp }`.

---

## 4. Admin Web surface

- **Finance queue** (`/admin/:marketId/ipoint-adjustments`, `wallet.ipoint.read`): state filter (ALL + 7 lifecycle states), exact amounts, direction, reason code, case reference, maker/checker ids, UTC timestamps, per-row link to the detail.
- **Maker create** (`/admin/:marketId/ipoint-adjustments/new`, `wallet.ipoint.adjust.maker`): wallet search + select, direction, exact amount (≤10 decimals), market reason-code catalog with high-risk flags, explanation, case reference, opaque attachment reference (required above soft cap / high-risk as a UI affordance), **automatic Idempotency-Key**, **double gate** (permission + `canPerformSensitiveAdminWrite`), explicit blocked state for unconfigured markets.
- **Checker detail** (`/admin/:marketId/ipoint-adjustments/:requestId`, `wallet.ipoint.read`): evidence + audit summary, immutable decision history, maker submit, checker decide (reason mandatory; **Maker≠Checker UI disable** mirroring the owner inequality), step-up token flow (`beginStepUp` → verify → `x-step-up-token` on decide/execute), checker execute with the **blocked state** when above-soft and `secureEvidenceAvailable=false` (server remains the authority).
- Design System states: loading skeleton / empty / error+retry / permission-denied / blocked (unconfigured market, above-soft execution) / offline notice / success + error action alerts. axe clean (jsdom, zero critical/serious).

### Route manifest changes (append-only + gate release)

- `ipoint-adjustments`: permission `wallet.ipoint.adjust.maker` → `wallet.ipoint.read` (the queue must be reachable by maker AND checker Finance roles); the stale **GATE-SEC-01 capability gate was removed** with the workflow implementation (same precedent as S6C/S6D gate removal).
- Added append-only `ipoint-adjust-create` and `ipoint-adjust-detail` routes (36 total, verified by route-manifest tests).

---

## 5. Security / workflow guarantees (no bypass)

- No client-side control is authorization: the frozen SEC-01 owner re-checks permission, selected market, caps routing, evidence rules, Maker≠Checker inequality and idempotency on every command.
- The UI disables the checker controls for the maker's own request and the above-soft execution when secure evidence is disabled — but the server enforces both regardless (integration tests prove 403 `MAKER_CHECKER_CONFLICT` and 422 `EVIDENCE_STORAGE_UNAVAILABLE`).
- Step-up tokens are obtained only through the MFA step-up flow and passed in `x-step-up-token`; the canonical RbacGuard consumes the grant (catalog `stepUpRequired`).
- Wallet lookup returns masked identity + exact balance only; never evidence contents or credentials.
- No migration, no seed, no catalog change (permissions `wallet.ipoint.adjust.maker/.checker/.execute` and `wallet.ipoint.read` already exist from SEC-01).

---

## 6. Test matrix (evidence in `/workspace/.local/s7b-gate/evidence/`)

| # | Gate | Command (exact) | Result | EXIT_CODE |
|---|---|---|---|---|
| 01 | checksum | `pnpm --filter @ipoint/database db:checksum` | 36 immutable checksums verified | 0 |
| 02 | api-client typecheck | `pnpm --filter @ipoint/api-client typecheck` | pass | 0 |
| 03 | api-client test | `pnpm --filter @ipoint/api-client test` | 80 passed (5 new S7B) | 0 |
| 04 | api-client build | `pnpm --filter @ipoint/api-client build` | pass | 0 |
| 05 | api typecheck | `pnpm --filter @ipoint/api typecheck` | pass | 0 |
| 06 | api build | `pnpm --filter @ipoint/api build` | pass | 0 |
| 07 | admin-web typecheck | `pnpm --filter @ipoint/admin-web typecheck` | pass | 0 |
| 08 | admin-web test | `pnpm --filter @ipoint/admin-web test` | 275 passed (25 new S7B) | 0 |
| 09 | admin-web build | `pnpm --filter @ipoint/admin-web build` | pass | 0 |
| 10 | S7B adapter unit | `pnpm --filter @ipoint/api test src/admin-ipoint-adjust-ops/admin-ipoint-adjust-ops.spec.ts` | 7 passed | 0 |
| 11 | S7B adapter HTTP | `pnpm --filter @ipoint/api test src/admin-ipoint-adjust-ops/admin-ipoint-adjust-ops.integration.spec.ts` (fresh DB `ipoint_gate_s7b_http`) | 8 passed | 0 |
| 12 | SEC-01 unit regression | `pnpm --filter @ipoint/api test src/wallet/wallet-adjustment.owner.spec.ts` | 18 passed | 0 |
| 13 | SEC-01 integration regression | `...wallet-adjustment.owner.integration.spec.ts` (fresh DB) | 22 passed | 0 |
| 14 | S7A regression | `src/merchant/mcp-adjustment.owner.{spec,integration}.spec.ts` (fresh DB) | 43 passed | 0 |
| 15 | S6E regression | `src/market/market-owner.{spec,integration}.spec.ts` (fresh DB) | 46 passed | 0 |
| 16 | S6D regression | `src/admin-commission-ops/admin-commission-ops.{spec,integration}.spec.ts` (fresh DB) | 41 passed | 0 |
| 17 | OpenAPI | `pnpm --filter @ipoint/api openapi:validate` | 247 paths (baseline 240 + 7 new), all validations passed | 0 (PASS_DETECTED) |
| 18 | eslint (changed files) | `npx eslint <25 files>` | 0 problems | 0 |
| 19 | prettier (changed files) | `npx prettier --check <25 files>` | clean | 0 |

---

## 7. Pre-existing upstream debt (unchanged, not S7B)

Identical to SEC-01 §8 / S7A §8: the `packages/database` suite has 4 pre-existing failures on the `phase/7-admin-operations` baseline (p7-s2c catalog count 66-vs-67, frozen six-role matrix counts, stale `^0019_` phase3-schema expectation, stale 20-migration schema.unit list). Authoritative `db:checksum` verifies 36/36. Not S7B regressions.

## 8. Gaps / follow-ups (none blocking)

- **Above-soft-cap execution** remains disabled end-to-end until the secure-evidence storage policy is approved and `secure_evidence_available` is enabled per market (P7-OD-11 governance prerequisite, SEC-01 §6.5). The UI shows the explicit blocked state; the server enforces it (422).
- **No attachment upload surface** was built (only the opaque reference pass-through), consistent with the frozen contract (opaque references only, never contents).
- The S7A `mcp-adjustments` Admin Web page remains a shell placeholder (out of S7B scope); S7B delivered the iPoint workflow only.

*Executor: OPENCLAW_MANAGED_CODING_SUBAGENT (implementer). No push performed; branch `task/p7-s7b-ipoint-admin` only.*
