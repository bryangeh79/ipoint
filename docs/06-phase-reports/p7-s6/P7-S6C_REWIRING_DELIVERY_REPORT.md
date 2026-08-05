# P7-S6C — Rewiring Delivery Report (order §15: D-053 secured Phase 6 redemption-rate owner)

| Field         | Value                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Record**    | P7-S6C rewiring to the D-053 secured Phase 6 redemption-rate owner command (Command Center order 2026-08-05 §15)    |
| **Status**    | `P7-S6C_REWIRED_TO_CANONICAL_OWNER` / pending the §15 independent review and the forward-only final S6C gate record |
| **Decisions** | D-046, D-048, D-049, D-053; D-053 owner integrated at `09279dc5` (CG-03 gate passed)                                |
| **Branch**    | `task/p7-s6c-redemption-config` (worktree `C:\AI_WORKSPACE\iPoint App\.local\wt-p7-s6c-rewire` @ `ee4dcb3f`)        |
| **Executor**  | `OPENCLAW_MANAGED_CODING_SUBAGENT` (D-048 §5 written handoff, continuation dispatch)                                |
| **Pushed**    | NO (integration/push is OpenClaw's)                                                                                 |
| **Date**      | 2026-08-05                                                                                                          |

## 1. Scope delivered (order §15)

The S6C redemption-rate configuration adapter
(`apps/api/src/admin-redemption-ops/**`) is rewired to the NOW-SECURED Phase 6
redemption-rate owner command `RedemptionService.createRateVersion` /
`cancelRateVersion` (D-053, already integrated and gated). The owner commands —
untouched by this task (frozen) — are now the SOLE enforcement boundary for
every owner-level business control; the adapter keeps only legitimate Phase 7
orchestration / read / UI behavior.

| Order §15 item                | Delivered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Wire to the owner          | The adapter's create path passes **`reason`** (mandatory), **`idempotencyKey`** (client `Idempotency-Key`) and the **server `currentMarketId`** + **`marketContextVersion`** (RbacGuard `adminMarketContext` → `AdminRedemptionOpsActor`) into `owner.createRateVersion` exactly per the D-053 contract (`CreateRateVersionCommand.reason/idempotencyKey`, `RedemptionAdminActor.currentMarketId`). The cancel path passes the same actor context plus **`reason`** + **`idempotencyKey`** into `owner.cancelRateVersion` (D-053 §9). No owner control was weakened.                                                                                                                                                                                        |
| 2. Remove duplicated controls | Deleted from the adapter: its own per-market rules map + bounds enforcement, precision enforcement, currency check, activation-future pre-check (kept only the date→instant conversion via the canonical helper), overlap pre-check, session-level advisory lock (`pg_advisory_lock`/`unlock`), idempotency claim/mechanism writes (`merchant_api_idempotency_keys` scope `redemption.rate.owner.create`, payload hash, replay/conflict logic) and the privileged audit record (`ADMIN_REDEMPTION_RATE_VERSION_CREATED`, `AuditService` injection). The adapter now performs ZERO writes: the only `redemption_rate_versions` insert and the append-only cancellation events come from the owner commands (proven by the no-direct-write integration test). |
| 3. Error mapping              | The adapter maps EVERY owner `REDEMPTION_RATE_*` code to the pre-existing S6C external contract (see §4) — including the D-053 cancel codes `REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE`, `REDEMPTION_RATE_ALREADY_CANCELLED` and `REDEMPTION_RATE_VERSION_NOT_FOUND`. Unknown owner codes propagate as-is and surface as 500 — no error is swallowed into a 2xx.                                                                                                                                                                                                                                                                                                                                                                                              |
| 4. Frozen owner untouched     | `apps/api/src/redemption/**` byte-identical (frozen); no other domain touched; no migration/seed/permission-catalog change; `packages/database` untouched (checksums 32/32).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 5. Read projection            | Unchanged contract: approved per-market bounds resolved from the canonical `redemption_rate_market_rules` table (the SAME source the owner enforces, D-053 §6), explicit blocked state `configured: false` for unconfigured markets (no cross-market fallback), full technical precision + ≤6-decimal display value, market-local AND resolved UTC windows, and the `CANCELLED` window state for voided scheduled versions.                                                                                                                                                                                                                                                                                                                                 |
| 6. Cancel surface (NEW)       | `POST /api/v1/admin/redemption-ops/markets/:marketId/rates/:versionId/cancel` (`redemption.rate.manage`, SUPER_ADMIN-only, marketScoped, mandatory Idempotency-Key + reason) — the append-only cancellation surface D-053 §9 made possible. Typed api-client method + Admin Web cancel orchestration added (see §5).                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## 2. Duplicated owner controls removed (exact deletions)

All of the following lived in `admin-redemption-ops.service.ts` before the
rewiring and are now deleted (the owner enforces each one inside its own
transaction):

1. **Per-market rules catalog + bounds enforcement** — the in-memory
   `REDEMPTION_RATE_MARKET_RULES` map, the `scaledDecimal` bound comparisons
   and the `REDEMPTION_RATE_BELOW_MINIMUM` / `REDEMPTION_RATE_ABOVE_MAXIMUM`
   / `REDEMPTION_RATE_MARKET_BLOCKED` rejections. The owner re-validates
   against the versioned `redemption_rate_market_rules` market data (Malaysia
   seeded; unconfigured markets → 422 `REDEMPTION_RATE_MARKET_BLOCKED`).
2. **Precision + currency checks** — the ≤10-decimal grammar enforcement and
   the fiat-currency comparison. The owner validates both (BigInt exact math).
3. **Activation-future pre-check** — `effectiveFrom.getTime() <= Date.now()`
   rejection deleted; the adapter only converts the market-local DATE to the
   UTC instant via the canonical owner helper `resolveLocalMidnight`
   (re-exported, single implementation) and the owner rejects
   same-day/backdated/DST-skipped activations with
   `REDEMPTION_RATE_ACTIVATION_NOT_FUTURE` → mapped 422. A `null` resolution
   (skipped/ambiguous midnight) still surfaces as
   `REDEMPTION_ACTIVATION_NOT_FUTURE` (input-conversion edge, not enforcement).
4. **Overlap pre-check** — the adapter's `latest.effective_from` comparison
   deleted; the owner performs the strictly-increasing half-open chain check
   under its market-scoped `pg_advisory_xact_lock` (D-053 §8).
5. **Session-level advisory lock** — `SELECT pg_advisory_lock/unlock`,
   `REDEMPTION_CREATE_LOCK_NAMESPACE` and the lock-key derivation deleted; the
   owner's transaction-scoped lock serializes creates AND cancels (exactly one
   winner under race — proven by the concurrency integration test).
6. **Idempotency claim/mechanism writes** — the
   `merchant_api_idempotency_keys` insert/conflict/replay/cleanup logic, the
   `redemption.rate.owner.create` scope constant, the `canonicalPayloadHash`
   computation and the replay/conflict branches deleted; the owner claims
   `redemption.rate.owner.create:<marketId>:<adminUserId>` (create) and
   `redemption.rate.owner.cancel:<marketId>:<adminUserId>` (cancel) with its
   own canonical payload hash, replays the original result and rejects
   same-key/different-payload with 409.
7. **Privileged audit** — `AuditService` injection and the
   `ADMIN_REDEMPTION_RATE_VERSION_CREATED` record deleted; the owner's atomic
   `redemption.rate_version.create` / `redemption.rate_version.cancel` audit
   carries actor, market, exact rate, rate type, reason, correlation request
   id and result, committed in the same transaction as the write + the
   idempotency claim (D-053 §11).

## 3. Retained adapter responsibilities (legitimate Phase 7 behavior)

1. Read projection `listRates` (approved config from the canonical rules
   table, explicit blocked state, full precision + display value, market-local
   - UTC windows incl. `CANCELLED`).
2. Market-local calendar DATE → exact UTC instant conversion
   (`resolveLocalMidnight`, canonical owner helper — the owner re-verifies).
3. Market row lookup + owner error → S6C external contract mapping.
4. Create/cancel response mapping (create reads the exact stored rate back
   from the immutable owner row; cancel consumes the owner's normalized exact
   value and the append-only cancellation event).
5. Transport contract: DTO grammar, mandatory `Idempotency-Key`, HTTP status
   mapping, RbacGuard `adminMarketContext` pass-through.

## 4. Owner error → adapter external contract mapping

| Owner code (D-053)                          | Adapter external code                     | HTTP |
| ------------------------------------------- | ----------------------------------------- | ---- |
| `REDEMPTION_RATE_REASON_REQUIRED`           | `REASON_REQUIRED`                         | 400  |
| `REDEMPTION_RATE_IDEMPOTENCY_KEY_REQUIRED`  | `IDEMPOTENCY_KEY_REQUIRED`                | 400  |
| `REDEMPTION_RATE_PERMISSION_DENIED`         | `PERMISSION_DENIED`                       | 403  |
| `REDEMPTION_RATE_MARKET_ACCESS_DENIED`      | `MARKET_ACCESS_DENIED`                    | 403  |
| `REDEMPTION_RATE_MARKET_NOT_FOUND`          | `REDEMPTION_MARKET_NOT_FOUND`             | 404  |
| `REDEMPTION_RATE_NOT_FOUND`                 | `REDEMPTION_RATE_VERSION_NOT_FOUND`       | 404  |
| `REDEMPTION_RATE_MARKET_SELECTION_REQUIRED` | `MARKET_SELECTION_REQUIRED`               | 409  |
| `REDEMPTION_RATE_MARKET_CONTEXT_MISMATCH`   | `MARKET_CONTEXT_MISMATCH`                 | 409  |
| `REDEMPTION_RATE_IDEMPOTENCY_CONFLICT`      | `REDEMPTION_IDEMPOTENCY_CONFLICT`         | 409  |
| `REDEMPTION_RATE_OVERLAP`                   | `REDEMPTION_RATE_OVERLAP`                 | 409  |
| `REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE`   | `REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE` | 409  |
| `REDEMPTION_RATE_ALREADY_CANCELLED`         | `REDEMPTION_RATE_ALREADY_CANCELLED`       | 409  |
| `REDEMPTION_RATE_MARKET_BLOCKED`            | `REDEMPTION_RATE_MARKET_BLOCKED`          | 422  |
| `REDEMPTION_RATE_BELOW_MINIMUM`             | `REDEMPTION_RATE_BELOW_MINIMUM`           | 422  |
| `REDEMPTION_RATE_ABOVE_MAXIMUM`             | `REDEMPTION_RATE_ABOVE_MAXIMUM`           | 422  |
| `REDEMPTION_RATE_CURRENCY_MISMATCH`         | `REDEMPTION_RATE_CURRENCY_MISMATCH`       | 422  |
| `REDEMPTION_RATE_PRECISION_EXCEEDED`        | `REDEMPTION_RATE_PRECISION_EXCEEDED`      | 422  |
| `REDEMPTION_RATE_ACTIVATION_NOT_FUTURE`     | `REDEMPTION_ACTIVATION_NOT_FUTURE`        | 422  |

Every code is unit-tested on both the create and the cancel path (the cancel
suite covers the cancellability/idempotency/not-found subset; the create suite
covers the full matrix). Unknown owner codes are re-thrown and surface as 500.

## 5. New cancel surface

- **API**: `POST /api/v1/admin/redemption-ops/markets/:marketId/rates/:versionId/cancel`
  (`redemption.rate.manage`, SUPER_ADMIN-only, marketScoped; mandatory
  `Idempotency-Key` header + `{ reason }` body). 200 returns the append-only
  cancellation event (`id`, `rate_version_id`, `market_id`, normalized exact
  `rate_value`, `effective_from_utc`, `reason`, `cancelled_by`, `cancelled_at`);
  the immutable rate-version row is never updated/deleted. 409
  `REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE` for active/expired/historically-used
  versions, 409 `REDEMPTION_RATE_ALREADY_CANCELLED` for a second cancellation,
  409 `REDEMPTION_IDEMPOTENCY_CONFLICT` for same-key/different-payload, 404
  `REDEMPTION_RATE_VERSION_NOT_FOUND` for an unknown version.
- **api-client** (`packages/api-client/src/index.ts`): typed
  `cancelRate(marketId, versionId, { reason }, idempotencyKey)` →
  `AdminRedemptionRateCancelResultDto`; the `AdminRedemptionRateVersionDto`
  `window_status` union now includes `CANCELLED`. Tests: +2.
- **Admin Web** (`apps/admin-web/src/redemption-config-*`): the versions table
  shows a per-row **Cancel version** action ONLY for SCHEDULED versions and
  ONLY when the capability gates pass (`redemption.rate.manage` permission AND
  the owner write environment `canPerformSensitiveAdminWrite`) — the server
  remains the authority. The inline form requires a mandatory reason and sends
  an auto-generated Idempotency-Key; success refreshes the projection, which
  then shows the explicit **Cancelled** badge (error tone). The blocked /
  unconfigured states are unchanged (`configured: false`, no fallback).
  Read-only actors see no cancel action and no create form. Tests: +4 (1
  model, 3 page).

## 6. Defects found and fixed during the rewiring (in the adapter scope)

1. **Broken owner-helper imports** (left by the interrupted previous session):
   the service used `export { … } from` without local imports, so
   `localWallString` / `resolveLocalMidnight` / `normalizeRateString` were
   unresolved at compile time. Fixed: local import + re-export (single
   implementation). The re-exported-but-unused `canonicalPayloadHash` /
   `scaledRate` are now re-export-only (eslint-clean).
2. **`configured: true` for unconfigured markets** (real rewiring defect): the
   read projection computed `configured: rule !== null` while `marketRuleRow`
   returns `undefined` for a missing rule — `undefined !== null` is `true`, so
   a market without an approved rule was reported `configured: true` with
   `config: null`. Fixed to `rule !== undefined && rule !== null` (explicit
   blocked state; integration + unit both prove `configured: false`, `config:
null`, no fallback).
3. **`ownerActor` type mismatch**: `ipAddress` is required on
   `RedemptionAdminActor` but optional on the surface actor; the adapter now
   normalizes `ipAddress ?? ''` (the controller always supplies a client
   address; the owner only records it on the audit row).

## 7. Test evidence (all executed in this worktree)

DBs: **`ipoint_gate_p6c_rw`** (S6C integration — fresh:
`DROP DATABASE IF EXISTS … WITH (FORCE)` + `CREATE DATABASE`, `migrate()` +
`seedFoundation()` in the spec's `beforeAll`),
**`ipoint_gate_p6c_reg`** (Phase 6 regression — pre-migrated + pre-seeded),
**`ipoint_gate_p6b_rw`** (S6B integration — self-created). PostgreSQL
`172.23.0.3:5432`, user `ipoint`.

| Suite / gate                                                        | Command                                                                                                                             | Result                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S6C unit spec                                                       | `vitest run src/admin-redemption-ops/admin-redemption-ops.spec.ts` (root config)                                                    | **19/19** exit 0                                                                                                                                                                                                                                                  |
| S6C integration spec                                                | `cd apps/api && vitest run src/admin-redemption-ops/admin-redemption-ops.integration.spec.ts`                                       | **30/30** exit 0 (fresh DB, real PG, HTTP)                                                                                                                                                                                                                        |
| **P7-S6C API total**                                                |                                                                                                                                     | **49/49**                                                                                                                                                                                                                                                         |
| Phase 6 redemption full regression (11 files, owner suite excluded) | `cd apps/api && vitest run src/redemption/…` (11 suites, pre-migrated + seeded `ipoint_gate_p6c_reg`)                               | **235/235** exit 0 (admin.hardening 40, concurrency 8, fulfilment.checkpointE 41, fulfilment.service 10, integration 28, p6-atomicity 17, refund.checkpointE 24, refund.service 8, regression-performance 17, security-privacy 20, shipping-market-commission 22) |
| S6B regression                                                      | `cd apps/api && vitest run src/admin-reward-ops/admin-reward-ops.spec.ts src/admin-reward-ops/admin-reward-ops.integration.spec.ts` | **38/38** exit 0 (18 unit + 20 integration)                                                                                                                                                                                                                       |
| `@ipoint/api` typecheck / build                                     | `pnpm --filter @ipoint/api typecheck` / `build`                                                                                     | exit 0 / exit 0                                                                                                                                                                                                                                                   |
| `@ipoint/api` openapi:validate                                      | `pnpm --filter @ipoint/api openapi:validate` (needs `REDEMPTION_VOUCHER_ENCRYPTION_KEY`)                                            | **237 paths, 0 missing schemas, 0 duplicate operationIds — ✅ All runtime OpenAPI validations passed** (does not self-exit after PASS — pre-existing outbox-worker quirk; killed after reading the PASS output)                                                   |
| `@ipoint/api-client` typecheck / test / build                       | `pnpm --filter @ipoint/api-client typecheck` / `test` / `build`                                                                     | exit 0 / **66/66** (+2 cancel tests) / exit 0                                                                                                                                                                                                                     |
| `@ipoint/admin-web` typecheck / test / build                        | `pnpm --filter @ipoint/admin-web typecheck` / `test` / `build`                                                                      | exit 0 / **209/209** (+4: 1 model, 3 page) / exit 0 (vite)                                                                                                                                                                                                        |
| `@ipoint/database` db:checksum                                      | `pnpm --filter @ipoint/database db:checksum`                                                                                        | **Verified 32 immutable migration checksum(s)** — unchanged by this task                                                                                                                                                                                          |
| prettier (all changed paths)                                        | `prettier --check` on the 17 changed source files                                                                                   | clean                                                                                                                                                                                                                                                             |
| eslint (changed paths)                                              | `eslint` on the changed source files                                                                                                | exit 0 (0 errors; 7 warnings are the pre-existing admin-web scope-ignore notices, same as S6A/S6B)                                                                                                                                                                |

Integration coverage includes: create via the secured owner 201 (owner atomic
audit row `redemption.rate_version.create` + exactly ONE owner-scoped
mechanism row `redemption.rate.owner.create:<marketId>:<adminUserId>` + the
legacy `ADMIN_REDEMPTION_RATE_VERSION_CREATED` action absent — no-direct-write
evidence); idempotent replay and same-key/different-payload 409 (create AND
cancel); cross-market 409; missing reason/key 400; blocked market 422 (no row,
no claim, no audit); concurrent race → exactly one 201 + one 409 + one row;
history immutable (no edit/delete routes + reject-update/reject-delete
triggers); cancel 200 append-only (version row untouched, cancellation event +
owner cancel audit + owner cancel mechanism row, read projection `CANCELLED`);
second cancel 409 `ALREADY_CANCELLED`; active/expired cancel 409
`CANNOT_CANCEL_EFFECTIVE`; cancel replay + different-reason 409; cancel in an
unconfigured market succeeds (cancel is independent of create-blocked config);
rate locking (quotes/orders never repriced).

### 7.1 Unit-spec changes recorded (order §15 "adjust any unit mocks…")

- Removed the `AuditService` mock and the third constructor argument (the
  adapter no longer audits) — the service constructor now takes `(database,
owner)`; the owner mock covers `createRateVersion` + `cancelRateVersion`.
- `canonicalPayloadHash` / `resolveLocalMidnight` / `localWallString` /
  `normalizeRateString` / `scaledRate` are imported from the adapter module,
  which re-exports the canonical owner implementations (single
  implementation).
- New delegation tests: `delegates the entire create with reason, key and the
server market context` (asserts the owner command receives `reason`,
  `idempotencyKey`, `currentMarketId`, `marketContextVersion`, `requestId`,
  `ipAddress`, the resolved UTC `effectiveFrom`, the canonical rate type and
  the market's fiat currency) and `delegates the cancel with reason + key and
maps the append-only response`.
- New mapping tests: the FULL owner error matrix on the create path (18 codes)
  plus the cancel-path subset; unknown owner errors propagate (never
  swallowed into a 2xx).
- New read-projection tests: `CANCELLED` window state + configured market;
  explicit blocked state (`configured: false`, no fallback); unknown market →
  `REDEMPTION_MARKET_NOT_FOUND`.
- Total: **19** unit tests, all green.

## 8. Contract notes and mismatches found during the rewiring

1. **Legal future successor versions now work (behavior change vs the
   pre-rewiring surface)**: the frozen gist exclusion that rejected EVERY
   second version was removed by migration 0031 (documented D-053 deviation
   §5.1). Under the secured owner, a strictly-later-start successor returns
   201 (the old surface returned 409 for any second version). The S6C
   integration suite now proves: same-start → 409 `REDEMPTION_RATE_OVERLAP`;
   later-start successor → 201; the predecessor is projected `SUPERSEDED`;
   historical rows byte-identical. UI copy ("versions are immutable") is
   unchanged in meaning — existing rows are immutable; scheduling a future
   successor is a new append-only row.
2. **Create vs cancel response precision**: the create response carries the
   exact stored value read back from the immutable owner row (full technical
   precision, e.g. `1.5000000000`); the cancel response carries the owner's
   normalized exact value (e.g. `1.55`). The read projection always carries
   the full technical precision. Documented, tested.
3. **Audit/mechanism correlation**: the owner records the HTTP middleware
   request id on route calls (the Idempotency-Key is the in-process
   fallback). The integration audit test asserts a non-empty correlation id
   and proves the key correlation via the owner-scoped mechanism row + the
   durable reason on the version row.
4. **Idempotency scope unified**: the adapter no longer claims keys; all
   creates claim `redemption.rate.owner.create:<marketId>:<adminUserId>` and
   cancels claim `redemption.rate.owner.cancel:<marketId>:<adminUserId>`
   (scope separation per D-053 §10 — see D-053 report §5.3).
5. No D-053 owner-contract mismatch was found: the owner's
   `CreateRateVersionCommand` / `CancelRateVersionCommand` fields and response
   shapes matched the rewiring needs exactly.

## 9. Changed files (exact paths)

```
apps/api/src/admin-redemption-ops/admin-redemption-ops.service.ts      (rewired create/cancel; deleted duplicated controls; owner error mapping; canonical helper import + re-export; configured fix)
apps/api/src/admin-redemption-ops/admin-redemption-ops.controller.ts   (RbacGuard adminMarketContext → actor; cancel route; new external-code HTTP mapping)
apps/api/src/admin-redemption-ops/admin-redemption-ops.types.ts        (actor currentMarketId/marketContextVersion; owner-sourced error codes; CANCELLED window state)
apps/api/src/admin-redemption-ops/admin-redemption-ops.errors.ts       (owner-sourced error factories incl. CANNOT_CANCEL_EFFECTIVE / ALREADY_CANCELLED)
apps/api/src/admin-redemption-ops/admin-redemption-ops.dto.ts          (cancel DTO schema)
apps/api/src/admin-redemption-ops/admin-redemption-ops.module.ts       (docstring only — module graph unchanged)
apps/api/src/admin-redemption-ops/admin-redemption-ops.spec.ts         (rewritten: 19 unit tests)
apps/api/src/admin-redemption-ops/admin-redemption-ops.integration.spec.ts (rewritten: 30 HTTP tests on a fresh real-PG DB)
packages/api-client/src/index.ts                                        (cancelRate typed method; CANCELLED in window_status union)
packages/api-client/src/index.test.ts                                   (+2 cancel tests)
apps/admin-web/src/redemption-config-model.ts                           (CANCELLED label; cancellable affordance; cancel error copy)
apps/admin-web/src/redemption-config-model.test.ts                      (+1 test, extended error-copy assertions)
apps/admin-web/src/redemption-config-states.tsx                         (Cancelled badge tone)
apps/admin-web/src/redemption-config-page.tsx                           (cancel orchestration behind the manage + owner-write gates)
apps/admin-web/src/redemption-config-page.test.tsx                      (+3 page tests)
apps/admin-web/src/test/redemption-config-fixtures.ts                   (SCHEDULED fixture version)
apps/admin-web/src/test/redemption-config-mock.ts                       (cancel route mock)
docs/06-phase-reports/p7-s6/P7-S6C_REWIRING_DELIVERY_REPORT.md         (this report)
```

Not modified: `apps/api/src/redemption/**` (D-053 owner, frozen),
`apps/api/src/reward/**`, `apps/api/src/admin-reward/**`,
`apps/api/src/admin-reward-ops/**`, `packages/database/**` (migrations,
schema, seeds, permission catalog), any other frozen domain.

## 10. Assumptions and risks

- **Assumption**: the new cancel surface is a legitimate Phase 7 addition —
  D-053 §9 authorizes the append-only cancellation contract and order §15
  requires the S6C surface to expose the secured owner's cancel capability
  (the pre-rewiring S6C surface had no cancel route because the frozen owner's
  `cancelRateVersion` was broken; it is now repaired and secured).
- **Assumption**: the D-053 deviation (migration 0031 removed the frozen gist
  exclusion) makes later-start successors legal; the S6C suite documents the
  resulting 201 successor behavior (see §8.1).
- **Risk**: shared owner idempotency scopes make a client-reused key replay
  across the canonical Phase 6 route and the S6C adapter surface only for
  identical owner payloads; same-key/different-payload cross-surface calls
  return 409 (safe failure).
- **Risk**: `openapi:validate` does not self-exit after PASS (pre-existing
  outbox-worker quirk, same as S4/S5/S6A/S6B/D-050).
- **Sandbox note**: the worktree's `node_modules` symlinks were created on the
  host (absolute Windows paths) and were repaired to relative links in the
  sandbox to run the toolchain; `node_modules` is untracked, so no git impact.
- Browser E2E remains host/CI-only (sandbox cannot launch Chromium); the
  Admin Web cancel flow is covered by mock-based component specs (part of the
  209/209) — NOT claimed as browser-passed.

## 11. Confirmation

- Frozen-owner scope: `apps/api/src/redemption/**` byte-identical (untouched);
  no other frozen domain touched; no migration/seed/permission-catalog change;
  `packages/database` checksums 32/32.
- The adapter performs NO direct writes: zero `redemption_rate_versions`
  insert/update/delete outside the owner commands, zero idempotency-mechanism
  writes, zero `AuditService` usage (grep-verified across the adapter files).
- Both create and cancel delegate with `reason` + `idempotencyKey` +
  `currentMarketId` (server-owned); the read projection exposes `CANCELLED`
  and the explicit `configured: false` blocked state.
- Worktree carries only the 17 intended source changes + this report; not
  pushed, not merged; the §15 independent review and the forward-only final
  S6C gate record are OpenClaw's next steps.

_Forward-only record. Do not delete or rewrite._
