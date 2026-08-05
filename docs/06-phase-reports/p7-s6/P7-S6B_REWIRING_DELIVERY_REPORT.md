# P7-S6B — Rewiring Delivery Report (order §8: canonical Phase 3 owner command)

| Field         | Value                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Record**    | P7-S6B rewiring to the D-050 secured canonical Phase 3 owner command (Command Center order 2026-08-04 §8)          |
| **Status**    | `P7-S6B_REWIRED_TO_CANONICAL_OWNER` / pending the §8 independent review and the forward-only final S6B gate record |
| **Decisions** | D-048, D-049, D-050, D-052; P7-S6B_CORRECTION_PROVISIONAL_GATE (CG-02 blocked)                                     |
| **Branch**    | `task/p7-s6b-rewire-canonical` (base `0081a2d9` — phase HEAD incl. D-050 owner remediation merged at `277e7fc3`)   |
| **Executor**  | `OPENCLAW_MANAGED_CODING_SUBAGENT` (D-048)                                                                         |
| **Pushed**    | NO (integration/push is OpenClaw's)                                                                                |
| **Date**      | 2026-08-05                                                                                                         |

## 1. Scope delivered (order §8)

The S6B reward-configuration adapter (`apps/api/src/admin-reward-ops/**`) is
rewired to the NOW-SECURED canonical Phase 3 owner command
`AdminRewardService.createRuleVersion` (D-050/D-052, already integrated).
The owner command — untouched by this task (frozen) — is now the sole
enforcement boundary for the create path; the adapter keeps only legitimate
Phase 7 orchestration/read/UI behavior.

| Order §8 item                 | Delivered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Wire to the owner          | The adapter's create path now passes **`reason`** (the adapter's mandatory reason), **`idempotencyKey`** (the client `Idempotency-Key`) and the **server `currentMarketId`** (RbacGuard `adminMarketContext` → `AdminRewardOpsActor.currentMarketId`) into `owner.createRuleVersion` exactly per the D-050 contract (`CreateRuleVersionCommand.reason/idempotencyKey`, `AdminRewardActor.currentMarketId`). No owner control was weakened.                                                                                                                                                                                                                                                                                                                               |
| 2. Remove duplicated controls | Deleted from the adapter: its own rate governance check (see §2 for the one retained classification comparison), activation-future pre-check (kept only the date→instant conversion; the owner re-validates), overlap pre-check, session-level advisory lock (`pg_advisory_lock`/`unlock`, `REWARD_CREATE_LOCK_NAMESPACE`), idempotency claim/mechanism writes (`merchant_api_idempotency_keys` scope `reward.rule.create`, payload hash, replay/conflict logic, `REWARD_CREATE_IDEMPOTENCY_SCOPE`) and the privileged audit record (`ADMIN_REWARD_RULE_VERSION_CREATED`, `AuditService` injection). The read projection (`listRules`) is unchanged; the response mapping now consumes the owner's resolved `effectiveFrom`/`effectiveFromLocal`/`timezone`/`createdAt`. |
| 3. Error mapping              | The adapter maps every owner `ADMIN_REWARD_*` code to the pre-existing S6B external contract (see §4): 400 `IDEMPOTENCY_KEY_REQUIRED` / `REASON_REQUIRED`, 403 `PERMISSION_DENIED` / `MARKET_ACCESS_DENIED`, 409 `REWARD_EFFECTIVE_WINDOW_OVERLAP` / `REWARD_IDEMPOTENCY_CONFLICT` / `MARKET_SELECTION_REQUIRED` / `MARKET_CONTEXT_MISMATCH`, 422 `REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT` / `REWARD_RATE_PRECISION_EXCEEDED` / `REWARD_ACTIVATION_NOT_FUTURE`, 404 `REWARD_MARKET_NOT_FOUND`. All 8 create-path integration tests pass again (original `REWARD_*` 201/409/422 semantics).                                                                                                                                                                                 |
| 4. Frozen owner untouched     | `apps/api/src/admin-reward/**` NOT modified (frozen); no other domain touched; no migration/seed/permission-catalog change; `packages/database` untouched (checksums 31/31). Admin Web surface semantics unchanged — the UI already sends `reason` + `Idempotency-Key` and the adapter's external response shape is byte-identical to before, so the api-client and Admin Web contract is unchanged (verified by typecheck/tests/build).                                                                                                                                                                                                                                                                                                                                 |
| 5. api-client                 | Typed client unchanged (it already sends `reason` + `Idempotency-Key`; the D-050 owner contract did not change the adapter's external response shape). `@ipoint/api-client` typecheck exit 0, tests 59/59.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## 2. Duplicated owner controls removed (exact deletions)

All of the following lived in `admin-reward-ops.service.ts` before the
rewiring and are now deleted (the owner enforces each one inside its
transaction):

1. **Rate governance bound** — `REWARD_RATE_GOVERNANCE_MAX` comparison that
   rejected `> 0.05%/day` was the adapter's own enforcement; the owner
   re-validates with `ADMIN_REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT` (BigInt
   exact math). **Retained exception (documented):** a single pure string
   comparison remains BEFORE the package-max check so that a rate above the
   ceiling is surfaced as `REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT` and never
   mislabeled as `REWARD_RATE_EXCEEDS_PACKAGE_MAX` for packages C–F (whose
   maxima equal the ceiling). This is external-contract classification
   (pre-existing S6B semantics pinned by unit + integration tests), not
   enforcement — the owner remains the authority; an in-process bypass is
   still rejected by the owner with the same 422 semantics. Removing it
   would change the documented S6B external contract, which order §8
   explicitly requires preserving.
2. **Activation future pre-check** — `effectiveFrom.getTime() <= Date.now()`
   rejection deleted; the adapter only converts the market-local DATE to the
   UTC instant (owner's multi-probe `resolveLocalMidnight`, re-exported) and
   the owner rejects same-day/backdated/DST-skipped activations with
   `ADMIN_REWARD_ACTIVATION_NOT_FUTURE` → mapped 422. A `null` resolution
   (DST-skipped midnight, no constructible instant) still surfaces as
   `REWARD_ACTIVATION_NOT_FUTURE` (input-conversion edge, not enforcement).
3. **Overlap pre-check** — the `latest.effective_from >= effective_from`
   query inside the adapter's claim transaction deleted; the owner performs
   the strictly-increasing check under its own advisory lock.
4. **Session-level advisory lock** — `SELECT pg_advisory_lock/unlock`,
   `REWARD_CREATE_LOCK_NAMESPACE`, `rewardCreateLockKey` deleted; the owner
   uses its transaction-scoped `pg_advisory_xact_lock` (exactly one winner
   under race — proven by the concurrency integration test).
5. **Idempotency claim/mechanism writes** — `merchant_api_idempotency_keys`
   insert/conflict/replay/cleanup logic, `REWARD_CREATE_IDEMPOTENCY_SCOPE`,
   `canonicalPayloadHash` computation deleted; the owner claims
   `reward.rule.owner.create:<marketId>:<adminUserId>` with its own
   canonical payload hash, replays the original result and rejects
   same-key/different-payload with 409.
6. **Privileged audit** — `AuditService` injection and the
   `ADMIN_REWARD_RULE_VERSION_CREATED` record deleted; the owner's atomic
   `reward.rule_version.create` audit carries actor, market, reason and the
   request correlation (HTTP middleware request id on route calls; the
   Idempotency-Key is the in-process fallback — D-050 contract §5).

## 3. Changed files (exact paths)

```
apps/api/src/admin-reward-ops/admin-reward-ops.service.ts        (rewired create; deleted duplicated controls; owner error mapping; owner-helper re-exports)
apps/api/src/admin-reward-ops/admin-reward-ops.controller.ts     (RbacGuard adminMarketContext → actor; new external-code HTTP mapping)
apps/api/src/admin-reward-ops/admin-reward-ops.types.ts          (actor currentMarketId/marketContextVersion; owner-sourced error codes)
apps/api/src/admin-reward-ops/admin-reward-ops.errors.ts         (owner-sourced error factories: PERMISSION_DENIED, MARKET_*, IDEMPOTENCY_KEY_REQUIRED, REASON_REQUIRED)
apps/api/src/admin-reward-ops/admin-reward-ops.module.ts         (docstring only — module graph unchanged)
apps/api/src/admin-reward-ops/admin-reward-ops.spec.ts           (unit: 16 → 18; see §5)
apps/api/src/admin-reward-ops/admin-reward-ops.integration.spec.ts (audit test rewired to the canonical owner audit)
docs/06-phase-reports/p7-s6/P7-S6B_REWIRING_DELIVERY_REPORT.md   (this report)
```

Not modified: `apps/api/src/admin-reward/**` (D-050 owner, frozen),
`apps/api/src/reward/**`, `apps/api/src/app.module.ts`, `packages/**`,
`apps/admin-web/**`, `packages/api-client/**` (contract unchanged).

## 4. Owner error → adapter external contract mapping

| Owner code (D-050)                           | Adapter external code                  | HTTP |
| -------------------------------------------- | -------------------------------------- | ---- |
| `ADMIN_REWARD_REASON_REQUIRED`               | `REASON_REQUIRED`                      | 400  |
| `ADMIN_REWARD_IDEMPOTENCY_KEY_REQUIRED`      | `IDEMPOTENCY_KEY_REQUIRED`             | 400  |
| `ADMIN_REWARD_PERMISSION_DENIED`             | `PERMISSION_DENIED`                    | 403  |
| `ADMIN_REWARD_MARKET_ACCESS_DENIED`          | `MARKET_ACCESS_DENIED`                 | 403  |
| `ADMIN_REWARD_MARKET_NOT_FOUND`              | `REWARD_MARKET_NOT_FOUND`              | 404  |
| `ADMIN_REWARD_MARKET_SELECTION_REQUIRED`     | `MARKET_SELECTION_REQUIRED`            | 409  |
| `ADMIN_REWARD_MARKET_CONTEXT_MISMATCH`       | `MARKET_CONTEXT_MISMATCH`              | 409  |
| `ADMIN_REWARD_EFFECTIVE_WINDOW_OVERLAP`      | `REWARD_EFFECTIVE_WINDOW_OVERLAP`      | 409  |
| `ADMIN_REWARD_IDEMPOTENCY_CONFLICT`          | `REWARD_IDEMPOTENCY_CONFLICT`          | 409  |
| `ADMIN_REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT` | `REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT` | 422  |
| `ADMIN_REWARD_RATE_PRECISION_EXCEEDED`       | `REWARD_RATE_PRECISION_EXCEEDED`       | 422  |
| `ADMIN_REWARD_ACTIVATION_NOT_FUTURE`         | `REWARD_ACTIVATION_NOT_FUTURE`         | 422  |

## 5. Test evidence (all executed in this worktree)

DB: **`ipoint_gate_p6b_rw`** (fresh: `DROP DATABASE IF EXISTS ... WITH (FORCE)`

- `CREATE DATABASE`, `migrate()` + `seedFoundation()` in the spec's
  `beforeAll`; PostgreSQL `172.23.0.3:5432`, user `ipoint`).

| Suite / gate                                 | Command                                                                                                                                 | Result                                                                                                                                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S6B unit spec                                | `vitest run apps/api/src/admin-reward-ops/admin-reward-ops.spec.ts` (root config)                                                       | **18/18** exit 0                                                                                                                                                                                       |
| S6B integration spec                         | `cd apps/api && vitest run src/admin-reward-ops/admin-reward-ops.integration.spec.ts`                                                   | **20/20** exit 0                                                                                                                                                                                       |
| D-050 owner regression                       | `cd apps/api && vitest run src/admin-reward/admin-reward.owner.integration.spec.ts src/admin-reward/admin-reward.service.spec.ts`       | **56/56** exit 0 (33 integration + 23 unit)                                                                                                                                                            |
| S6A admin-package-ops regression             | `cd apps/api && vitest run src/admin-package-ops/admin-package-ops.spec.ts src/admin-package-ops/admin-package-ops.integration.spec.ts` | **36/36** exit 0                                                                                                                                                                                       |
| `@ipoint/api` typecheck                      | `pnpm --filter @ipoint/api typecheck`                                                                                                   | exit 0                                                                                                                                                                                                 |
| `@ipoint/api` build                          | `pnpm --filter @ipoint/api build`                                                                                                       | exit 0                                                                                                                                                                                                 |
| `@ipoint/api` openapi:validate               | `node dist/__scripts__/openapi-validate.js` (needs `REDEMPTION_VOUCHER_ENCRYPTION_KEY`)                                                 | **227 paths, 0 missing schemas, 0 duplicate operationIds — ✅ All runtime OpenAPI validations passed** (does not self-exit after PASS — pre-existing outbox-worker quirk; killed after reading output) |
| `@ipoint/api-client` typecheck / test        | `pnpm --filter @ipoint/api-client typecheck` / `test`                                                                                   | exit 0 / **59/59**                                                                                                                                                                                     |
| `@ipoint/admin-web` typecheck / test / build | `pnpm --filter @ipoint/admin-web typecheck` / `test` / `build`                                                                          | exit 0 / **185/185** / exit 0 (vite)                                                                                                                                                                   |
| `@ipoint/database` db:checksum               | `pnpm --filter @ipoint/database db:checksum`                                                                                            | **Verified 31 immutable migration checksum(s)** — unchanged by this task                                                                                                                               |
| prettier (all changed paths)                 | `prettier --check` on the 7 changed source files                                                                                        | clean                                                                                                                                                                                                  |
| eslint (changed paths)                       | `eslint` on the 7 changed source files                                                                                                  | exit 0 (0 errors)                                                                                                                                                                                      |

Note on expected counts: the task brief listed api-client 64/64 and
admin-web 205/205; the measured counts on this branch are **59/59** and
**185/185** respectively (consistent with the S6B internal record of 59 and
185 at delivery time; the branch HEAD carries no newer api-client/admin-web
test additions). No suite was skipped or filtered.

### 5.1 Unit-spec changes recorded (per order §8 "adjust any unit mocks...")

- Removed the `AuditService` mock and the third constructor argument (the
  adapter no longer audits) — the service constructor now takes
  `(database, owner)`.
- `canonicalPayloadHash`/`resolveLocalMidnight`/`localWallString`/
  `normalizeRateString` are now imported from the adapter module, which
  re-exports the canonical owner implementations (single implementation,
  no duplicated helper).
- Rewrote `rejects non-future market-local dates` → `rejects non-future
market-local dates via the canonical owner (mapped)`: the owner mock now
  rejects with `adminRewardActivationNotFutureError()` and the adapter is
  asserted to surface `REWARD_ACTIVATION_NOT_FUTURE` (activation enforcement
  is no longer duplicated).
- Added `delegates the create to the canonical owner with reason, key and
market context` (asserts the owner command receives `reason`,
  `idempotencyKey`, `currentMarketId`, `marketContextVersion`) and `maps
the owner idempotency-conflict rejection to the S6B 409 code`.
- Total: **16 → 18** unit tests, all green.

## 6. Contract mismatches found during the rewiring

1. **Audit request correlation** (test-side only): the D-050 owner records
   the HTTP middleware request id on route calls (the Idempotency-Key is
   the in-process fallback). The pre-rewiring S6B audit used the key as its
   correlation id. The rewired integration audit test asserts the owner's
   row carries a non-empty request id and proves the key correlation via
   the mechanism row + the stored version row (durable reason).
2. **Idempotency scope unified**: the adapter no longer claims keys; all
   creates now claim the owner scope
   `reward.rule.owner.create:<marketId>:<adminUserId>`. Same-key replay
   works within the adapter surface (proven). Cross-surface edge: a client
   that reuses one `Idempotency-Key` across BOTH the canonical route and
   the adapter route with different payloads will now get a 409
   `ADMIN_REWARD_IDEMPOTENCY_CONFLICT` (shared mechanism table) — a safe
   failure, documented as an assumption/risk (D-050 report §5 left this
   decision to the rewiring dispatch).
3. No D-050 owner-contract mismatch was found: the owner's
   `CreateRuleVersionCommand` fields and response shape matched the
   rewiring needs exactly; the adapter's external response shape is
   unchanged, so api-client / Admin Web required no change.

## 7. Assumptions and risks

- **Assumption**: keeping the single governance-vs-package classification
  comparison in the adapter is required to preserve the documented S6B
  external contract (see §2.1); the owner remains the enforcement
  authority and the same-key/rate violations are proven end-to-end by the
  integration suite (0.050001 → 422 `REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT`
  via the owner's own rejection path is still covered by the D-050 owner
  suite; the adapter path surfaces the same code through its surface
  classification).
- **Assumption**: the DST-safe resolution difference noted in the D-050
  report §5 is resolved by importing the owner's multi-probe
  `resolveLocalMidnight` (the adapter's single-probe copy was deleted).
- **Risk**: the shared idempotency scope makes keys replayable across the
  canonical and adapter surfaces only for identical owner payloads; a
  same-key/different-payload cross-surface call returns 409 (safe
  failure, no data loss).
- **Risk**: `openapi:validate` does not self-exit after PASS (pre-existing
  outbox-worker quirk, same as S4/S5/S6A/D-050; killed after reading the
  PASS output).
- Browser E2E remains host/CI-only (sandbox cannot launch Chromium); the
  Admin Web reward-config surface is covered by mock-based component specs
  (part of the 185/185) — NOT claimed as browser-passed.

## 8. Confirmation

- Frozen-owner scope: `apps/api/src/admin-reward/**` byte-identical
  (untouched); no other frozen domain touched; no migration/seed/
  permission-catalog change; `packages/database` checksums 31/31.
- Worktree clean after commits; main tree untouched (only its 102
  historical untracked artifacts remain, never modified).
- Not pushed, not merged; the §8 independent review and the forward-only
  final S6B gate record are OpenClaw's next steps.

_Forward-only record. Do not delete or rewrite._
