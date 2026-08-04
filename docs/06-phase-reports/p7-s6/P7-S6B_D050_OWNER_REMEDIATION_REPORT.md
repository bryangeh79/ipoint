# P7-S6B — D-050 Phase 3 Reward-Rule Owner Remediation Delivery Report

| Field         | Value                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------- |
| **Record**    | D-052/D-050 delivery — Phase 3 reward-rule owner security and versioning remediation (CG-02 gate) |
| **Status**    | `D-050_OWNER_REMEDIATION_IMPLEMENTED` / pending Command Center acceptance                         |
| **Decisions** | D-052 (MANDATORY / AUTHORIZED — EXECUTE NOW)                                                      |
| **Branch**    | `fix/p3-p7-reward-rule-owner` (base `e0958c6e`)                                                   |
| **Executor**  | `OPENCLAW_MANAGED_CODING_SUBAGENT` (D-048)                                                        |
| **Pushed**    | NO (integration/push is OpenClaw's)                                                               |
| **Date**      | 2026-08-04                                                                                        |

## 1. Scope delivered

Every control from the Command Center order §6 now lives **inside the Phase 3
owner command** (`AdminRewardService.createRuleVersion`), so the canonical
route **and** any in-process caller (Phase 7 adapter) get identical
enforcement. The original raw-insert path no longer exists: the owner command
itself is the enforcement boundary.

| #   | Order §6 control                        | Implementation                                                                                                                                                     |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Reward configuration permission         | `reward.rule.schedule` re-checked server-side via `RbacService.isAllowed` (canonical catalog, SUPER_ADMIN only) inside the command                                 |
| 2   | Admin identity validation               | Actor must carry a real `adminUserId`; permission check requires ACTIVE admin + ACTIVE account + granted permission                                                |
| 3   | Selected-market enforcement             | `actor.currentMarketId` (server Current Admin Market from the canonical RbacGuard) is required; market grant + ACTIVE market asserted inside the command           |
| 4   | Resource-market consistency             | Body `marketId` must equal `actor.currentMarketId` else `ADMIN_REWARD_MARKET_CONTEXT_MISMATCH` (409)                                                               |
| 5   | Exact 0%–0.05%/day                      | BigInt exact-decimal math (`scaledDecimal`), never floats                                                                                                          |
| 6   | Six-decimal precision                   | `^\d+(\.\d{1,6})?$` grammar in DTO (400) and again in the command (`ADMIN_REWARD_RATE_PRECISION_EXCEEDED`, 422)                                                    |
| 7   | Future market-local 00:00 only          | `isMarketLocalMidnight` (IANA timezone) + strictly-future check; same-day/backdated and DST-skipped midnights rejected (`ADMIN_REWARD_ACTIVATION_NOT_FUTURE`, 422) |
| 8   | Resolved UTC + market-local returned    | Create response returns `effectiveFrom` (UTC ISO), `effectiveFromLocal`, `timezone`                                                                                |
| 9   | Append-only versions                    | No update/delete routes (404); `effective_to` always NULL; versions immutable once written                                                                         |
| 10  | No overlapping ranges                   | Strictly increasing `effective_from` per market scope inside the advisory lock                                                                                     |
| 11  | Transaction-safe concurrency            | Market-scoped `pg_advisory_xact_lock` inside the single owner transaction; exactly one winner under race (proven)                                                  |
| 12  | Mandatory reason                        | DTO required (400 on missing/blank/overlength); command re-checks (1–500, `ADMIN_REWARD_REASON_REQUIRED`)                                                          |
| 13  | Durable reason storage                  | Forward-only migration **0030** adds `reward_rule_versions.reason` (nullable for legacy rows, CHECK 1–500 when set)                                                |
| 14  | Atomic immutable audit                  | Owner insert + `audit.appendWithinTransaction(tx)` in ONE transaction (actor, market, reason, request id)                                                          |
| 15  | Operation-scoped idempotency            | `Idempotency-Key` header mandatory; mechanism row in `merchant_api_idempotency_keys` unique `(scope, key)`                                                         |
| 16  | Canonical payload hash                  | Sorted-keys sha256 over the full command payload                                                                                                                   |
| 17  | Same-key/different-payload              | 409 `ADMIN_REWARD_IDEMPOTENCY_CONFLICT`                                                                                                                            |
| 18  | No historical recalculation             | Existing rule versions, `reward_plans`, `reward_sources` untouched (proven)                                                                                        |
| 19  | Secured canonical route + DTO + OpenAPI | Route, DTO and OpenAPI contract updated; OpenAPI validation green (227 paths)                                                                                      |

## 2. Changed files

```
packages/database/migrations/0030_p3_d050_reward_rule_reason.sql   (new — forward-only)
packages/database/migrations/checksums.json                        (31 checksums)
packages/database/src/expected-schema.ts                           (reward_rule_versions.reason)
packages/database/schema/index.ts                                  (drizzle reason column + check)
apps/api/src/admin-reward/admin-reward.service.ts                  (secured owner command)
apps/api/src/admin-reward/admin-reward.controller.ts               (Idempotency-Key header, market-context actor, error mapping, create response)
apps/api/src/admin-reward/admin-reward.dto.ts                      (reason/marketId required, rate grammar, effectiveTo removed)
apps/api/src/admin-reward/admin-reward.errors.ts                   (new owner error codes)
apps/api/src/admin-reward/admin-reward.types.ts                    (actor market context, command + create response types)
apps/api/src/admin-reward/admin-reward.service.spec.ts             (updated + D-050 service-level evidence)
apps/api/src/admin-reward/admin-reward.owner.integration.spec.ts   (new — D-050 HTTP evidence suite, 33 tests)
docs/06-phase-reports/p7-s6/P7-S6B_D050_OWNER_REMEDIATION_REPORT.md (this report)
```

Not modified: `apps/api/src/admin-reward-ops/**` (S6B adapter — separate rewiring
dispatch per order §8), any other frozen domain, migration 0029 and earlier
(byte-identical), permission catalog (already complete), admin-web (write
surface stays blocked, item 24).

## 3. Migration 0030

- `0030_p3_d050_reward_rule_reason.sql` — forward-only `ADD COLUMN reason
text` + `chk_reward_rule_versions_reason` (`reason IS NULL OR
char_length(btrim(reason)) BETWEEN 1 AND 500`). Legacy rows keep NULL; new
  secured-command rows always carry the operator reason.
- Single migration owner (D-052). `checksums.json` updated in the same commit:
  **31/31 verified** (`db:checksum`).
- `expected-schema.ts` updated in the same commit (column appended last to
  match PostgreSQL ordinal order); `db:drift` passes on a migrated DB.

## 4. Evidence gate (order §7) — executed on fresh DB `ipoint_gate_d050`

All tests ran on a fresh migrated/seeded isolated database
(`DROP DATABASE IF EXISTS ipoint_gate_d050 WITH (FORCE)` + `CREATE DATABASE`,
`migrate()` + `seedFoundation()`), with
`DATABASE_URL=postgresql://ipoint:ipoint-local-only@172.23.0.3:5432/ipoint_gate_d050`.

### 4.1 Owner security/versioning HTTP evidence suite (33/33)

| Item                                     | Result                                                                                                                                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. RBAC cannot be bypassed               | unauthenticated 401; member actor 403; admin without `reward.rule.schedule` 403; authorized admin 201                                                                                                                                   |
| 2. Market enforcement cannot be bypassed | no current market 409 `MARKET_SELECTION_REQUIRED`; no grant 403 `MARKET_ACCESS_DENIED`; body/current mismatch 409 `MARKET_CONTEXT_MISMATCH`; missing body market 400                                                                    |
| 3. 0 accepted                            | 201, rate `0`                                                                                                                                                                                                                           |
| 4. 0.05% accepted                        | 201, rate `0.05`                                                                                                                                                                                                                        |
| 5. Negative rejected                     | 400                                                                                                                                                                                                                                     |
| 6. Above 0.05% rejected                  | 422 `ADMIN_REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT` (0.050001)                                                                                                                                                                             |
| 7. >6 decimals rejected                  | 400 (0.0000001); six decimals exactly accepted (0.000001 → 201)                                                                                                                                                                         |
| 8. Same-day activation rejected          | 422 `ADMIN_REWARD_ACTIVATION_NOT_FUTURE`                                                                                                                                                                                                |
| 9. Future local midnight accepted        | 201, market-local + UTC returned                                                                                                                                                                                                        |
| 10. UTC conversion exact                 | KL 00:00 == `{date}T00:00:00.000Z − 8h` asserted on response AND stored row; NY EDT 2027-07-04 00:00 == `04:00:00Z` asserted; DST-skipped Havana 2026-03-08 midnight → 422                                                              |
| 11. Overlap rejected                     | same start → 409 `ADMIN_REWARD_EFFECTIVE_WINDOW_OVERLAP`; later start → 201                                                                                                                                                             |
| 12. Concurrent overlap → one winner      | parallel creates → exactly one 201 + one 409, exactly one row                                                                                                                                                                           |
| 13. Same-key/same-payload replay         | second call 201 with the original version id, one row total                                                                                                                                                                             |
| 14. Same-key/different-rate              | 409 `ADMIN_REWARD_IDEMPOTENCY_CONFLICT`                                                                                                                                                                                                 |
| 15. Same-key/different-time              | 409                                                                                                                                                                                                                                     |
| 16. Same-key/different-reason            | 409                                                                                                                                                                                                                                     |
| 17. Missing/blank/overlength reason      | 400 (and 1-char / 500-char accepted)                                                                                                                                                                                                    |
| 18. Audit actor/market/reason/request id | `reward.rule_version.create` row: actorId, marketId, reason, non-empty requestId, result SUCCESS; version row stores the reason; mechanism row stores 64-hex hash + status 201 + response id                                            |
| 19. Atomic rollback                      | injected audit failure → command rejects; zero version rows, zero new audit rows, zero mechanism claims; same key retried successfully after correction                                                                                 |
| 20. Historical immutability              | legacy closed-window row byte-identical after creates; `reward_plans`/`reward_sources` counts unchanged; legacy `reason` stays NULL                                                                                                     |
| 21. Migration checksum                   | `db:checksum` → **31/31**                                                                                                                                                                                                               |
| 22. Phase 3 owner regression             | unit spec 23/23; `reward.service.spec` 33/33; p7-s2c rbac/openapi specs green                                                                                                                                                           |
| 23. P7-S6B suite                         | unit 16/16; integration **12/20** — 8 create-path tests now fail with 500 because the owner enforces reason/key/market-context that the adapter does not (yet) pass — **expected conflict for the order §8 rewiring dispatch** (see §6) |
| 24. Admin Web write blocked              | no UI change; write surface unchanged                                                                                                                                                                                                   |

Unit spec expectations that asserted the old unsafe behavior were updated and
recorded: the create test previously asserted `runTransaction` was NOT called
(raw insert outside any transaction) and used `marketId: null` — both now
assert the secured behavior (single transaction, required market).

### 4.2 Additional gates

| Gate                                         | Result                                                                                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ipoint/api` typecheck                      | exit 0                                                                                                                                                                 |
| `@ipoint/api` build                          | exit 0                                                                                                                                                                 |
| `@ipoint/api` openapi:validate               | **227 paths, 0 missing schemas, 0 duplicate operationIds — ✅ passed** (does not self-exit after PASS — pre-existing outbox-worker quirk; killed after reading output) |
| `@ipoint/database` typecheck                 | exit 0                                                                                                                                                                 |
| `@ipoint/database` db:checksum               | **Verified 31 immutable migration checksum(s)**                                                                                                                        |
| `@ipoint/database` db:drift                  | No database schema drift detected                                                                                                                                      |
| `@ipoint/api-client` typecheck / test        | exit 0 / 59/59                                                                                                                                                         |
| `@ipoint/admin-web` typecheck / test / build | exit 0 / 185/185 / exit 0 (vite)                                                                                                                                       |
| prettier (all changed paths)                 | clean                                                                                                                                                                  |
| eslint (changed paths)                       | exit 0 (0 errors)                                                                                                                                                      |

Note: the task brief expected 228 OpenAPI paths; the measured count on this
branch is **227**, consistent with the P7-S6B record (227). No route was
added or removed by this remediation.

## 5. Assumptions and design notes

- **DST-edge rule**: `resolveLocalMidnight` uses multiple probes across the
  UTC day and accepts a date only when exactly one distinct 00:00 wall-clock
  instant exists for it. Skipped midnights (e.g. America/Havana spring-forward)
  are rejected; unambiguous real midnights on transition days (e.g.
  America/New_York DST-start day) are accepted with the correct instant; an
  ambiguous repeated midnight resolves to the single valid candidate the
  algorithm can observe (documented; production markets MY/SG have no DST).
  The S6B adapter's single-probe helper differs slightly for some DST dates —
  the rewiring dispatch should unify on the owner helper.
- **Idempotency scope**: the owner claims `reward.rule.owner.create:<marketId>:<adminUserId>`
  (distinct from the adapter's `reward.rule.create:...`). The rewiring dispatch
  should decide whether to unify the scopes so keys are replayable across the
  two surfaces.
- **Overlap rule**: strictly increasing `effective_from` per market scope
  (non-archived rows) inside the advisory lock — identical to the adapter's
  chain semantics and equivalent to the frozen settlement (latest
  `effective_from` wins). A new version may start inside a legacy closed
  window (`effective_to` set); frozen settlement then resolves the new version
  from its start — no historical reward is recalculated (proven by item 20).
- **Audit request id**: the HTTP middleware request id is recorded; in-process
  calls fall back to the Idempotency-Key. The S6B adapter's own audit
  (separate record) keeps using the key as its correlation id.
- **`reward.rule.schedule` step-up**: the canonical catalog entry does not
  declare `stepUpRequired`, so no step-up token is demanded by the guard; the
  catalog is authoritative (`reward.rule.schedule` remains SUPER_ADMIN only).

## 6. S6B adapter conflicts for the order §8 rewiring dispatch

The S6B adapter (`apps/api/src/admin-reward-ops/**`) was NOT modified. Its
integration suite now shows **12/20 passing**; the 8 failures are all on the
create path (`POST .../reward-ops/markets/:marketId/rules` → 500). Root cause:
the adapter delegates to the owner command without `reason`, without
`idempotencyKey`, and without the server current-market context, and the owner
now rejects those (`ADMIN_REWARD_REASON_REQUIRED` fires first). The rewiring
dispatch must:

1. Pass `reason` (the adapter's mandatory reason), the client `Idempotency-Key`,
   and the server Current Admin Market (`adminMarketContext` from the
   RbacGuard) into `owner.createRuleVersion`.
2. Delete the adapter's duplicated owner-level controls (rate bounds,
   activation resolution, overlap pre-check, advisory lock, owner-scope
   idempotency claim, payload hash) — the owner now enforces all of them.
3. Keep only Phase 7 orchestration/read/UI behavior (list projection, response
   mapping, adapter-level privileged audit record if still desired — note the
   owner already writes its own atomic audit with reason).
4. Re-run the S6B integration suite against the rewired delegation.

## 7. Additional finding (outside this dispatch's scope, for Command Center)

`apps/api/src/reward/reward.controller.ts` exposes `POST /api/v1/rewards/rules`
guarded only by `AuthGuard` (no RbacGuard): any authenticated ACCOUNT can
create a reward rule version through `RewardService.createRuleVersion` (raw
insert, `createdBy` defaults to the zero UUID, no rate bounds beyond the DB
`>= 0` check, no reason/audit/idempotency). This member-facing Phase 3 surface
was not part of the D-050 evidence gate. Recommend a follow-up authorization
to either remove the route or harden `RewardService.createRuleVersion` with
the same controls.

## 8. Confirmation

- Frozen-owner scope: only `apps/api/src/admin-reward/**`, `packages/database`
  (migration 0030 + schema/checksums), docs — no other frozen domain touched.
- Migration 0029 and earlier byte-identical; checksums 31/31; drift clean.
- No push, no merge, no main-tree changes; worktree clean after commits.
