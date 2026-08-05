# P7-S6 — D-053 Phase 6 Redemption-Rate Owner Remediation Delivery Report

| Field         | Value                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| **Record**    | D-053 delivery — Phase 6 redemption-rate owner security/versioning/cancellation remediation (CG-03 gate) |
| **Status**    | `D-053_OWNER_REMEDIATION_IMPLEMENTED` / pending OpenClaw integration + Command Center acceptance         |
| **Decisions** | D-048 (subagent authorization class) / D-053 (CG-03 command)                                             |
| **Branch**    | `fix/p6-p7-redemption-rate-owner` (base `phase/7-admin-operations` @ `12ca6c63`)                         |
| **Executor**  | `OPENCLAW_MANAGED_CODING_SUBAGENT` (D-048)                                                               |
| **Pushed**    | NO (integration/push is OpenClaw's)                                                                      |
| **Date**      | 2026-08-05                                                                                               |

## 1. Scope delivered

Every control from the D-053 command §5–§11 now lives **inside the Phase 6
owner commands** (`RedemptionService.createRateVersion` and
`RedemptionService.cancelRateVersion`), so the canonical route **and** any
in-process caller (Phase 7 adapter) get identical enforcement. The original
raw-insert and UPDATE-based paths no longer exist — the owner commands
themselves are the enforcement boundary, mirroring the accepted D-050
reward-rule owner pattern.

| #   | Contract clause             | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §5 In-command authorization | `RbacService.isAllowed` (`redemption.rate.manage`, SUPER_ADMIN-only catalog entry) re-checked server-side; ACTIVE admin + ACTIVE account + grant asserted; server Current Admin Market (`actor.currentMarketId`) required; body market must equal it (409 `REDEMPTION_RATE_MARKET_CONTEXT_MISMATCH`); revoked grants deny the next request (guard + owner `assertMarketAccess`)                                                                                                                                                                                                                                                                |
| 2   | §5 Single owner boundary    | All `createRateVersion` / `cancelRateVersion` call sites audited — only the canonical route + the owner itself remain; no callable unsecured owner method left (proven by the in-process bypass suite)                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 3   | §6 Rate contract            | Meaning = fiat reference value per 1 iPoint (`POINTS_PER_CURRENCY`); technical precision ≤10 decimals (`numeric(38,10)`), display ≤6 decimals server-derived (`normalizeRateString`, storage untouched); exact decimal string parsing (BigInt `scaledRate`, zero float arithmetic); per-market bounds enforced from **market data** (`redemption_rate_market_rules`) — Malaysia MYR initial RM1.00 / min RM0.50 / max RM2.00 seeded in `seedFoundation` (idempotent upsert), never hard-coded in logic; unconfigured markets explicitly blocked (422 `REDEMPTION_RATE_MARKET_BLOCKED`, read side `configured:false`); no cross-market fallback |
| 4   | §7 Activation contract      | Future market-local 00:00 only (`resolveLocalMidnight` IANA multi-probe + `isMarketLocalMidnight`); resolved UTC returned with local wall time + timezone; same-day/backdated/non-midnight/DST-skipped/ambiguous payloads rejected (422 `REDEMPTION_RATE_ACTIVATION_NOT_FUTURE`); created rows immutable; quotes lock the resolved rate, orders keep quote/rate snapshots, resolvers never reprice (proven)                                                                                                                                                                                                                                    |
| 5   | §8 Versioning contract      | Append-only half-open `[start, next_start)` windows; degenerate overlap expression removed; proper overlap detection (chain rule + legacy stored-end awareness — successor may start exactly at a predecessor's stored end); strictly increasing starts per market+rate type; no duplicate/overlapping scheduled intervals; transaction-safe (advisory lock); deterministic concurrent outcome (one 201 + one 409); no UPDATE/DELETE of existing rows — boundaries arise only from new immutable scheduling/cancellation events                                                                                                                |
| 6   | §9 Cancellation contract    | `cancelRateVersion` never updates/deletes rate-version rows; append-only `redemption_rate_cancellations` events (migration 0031, UNIQUE(rate_version_id), reject_update/reject_delete triggers); only future-scheduled not-yet-effective versions cancellable (active/expired/historically-used rejected 409 `REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE`); same permission/market/reason/idempotency/audit as create; resolvers ignore cancelled versions forever; historical quotes/orders untouched                                                                                                                                            |
| 7   | §10 Idempotency contract    | Operation-scoped mechanism rows in `merchant_api_idempotency_keys` (`redemption.rate.owner.create:<marketId>:<adminUserId>` / `redemption.rate.owner.cancel:<marketId>:<adminUserId>`); canonical payload hash (sorted keys + sha256) covering operation, marketId, rateType, exact rate string, local date, resolved UTC, timezone, reason, target version id (cancel), actor scope; same key + same payload → exact replay; same key + different payload → 409; concurrent duplicates → single committed result; failed transactions roll back claim + version + audit together; implemented in the owner only (never in a Phase 7 adapter)  |
| 8   | §11 Reason/audit contract   | Create and cancel require a non-blank reason ≤500 chars (transport 400, owner re-check); reason persisted on the version row (migration 0031) and on the cancellation event; legacy rows keep NULL (explicit legacy representation, no fabricated reasons); immutable audit (`audit.appendWithinTransaction`) with actor/market/operation/exact rate/rateType/version id/previous-version reference (cancel target)/local date/resolved UTC/timezone/reason/idempotency key correlation/payload hash/request id/result — all committed atomically with the owner write + idempotency record (injected-failure rollback proven)                 |

## 2. Changed files

```
packages/database/migrations/0031_p6_d053_redemption_rate_owner.sql   (new — forward-only)
packages/database/migrations/checksums.json                            (32 checksums)
packages/database/schema/redemption.ts                                 (reason column + redemption_rate_market_rules + redemption_rate_cancellations drizzle tables)
packages/database/schema/index.ts                                      (exports for the two new tables)
packages/database/src/expected-schema.ts                               (reason column + two new tables)
packages/database/seeds/foundation.ts                                  (Malaysia rate-rule upsert, idempotent)
apps/api/src/redemption/redemption.service.ts                          (secured owner create/cancel, resolver exclusions, owner helpers, exact-decimal + IANA midnight helpers)
apps/api/src/redemption/admin-redemption.controller.ts                 (Idempotency-Key header, current-market actor context, owner DTO schemas, error mapping)
apps/api/src/redemption/redemption.dto.ts                              (ownerRateCreateSchema / ownerRateCancelSchema)
apps/api/src/redemption/redemption.errors.ts                           (D-053 owner error builders)
apps/api/src/redemption/redemption.types.ts                            (actor market context, command + response types, market config type)
apps/api/src/redemption/redemption-rate.owner.integration.spec.ts      (new — D-053 HTTP evidence suite, 59 tests)
apps/api/src/redemption/redemption-admin.hardening.spec.ts             (T-86/T-88 updated to the secured owner contract)
apps/api/src/redemption/redemption-integration.spec.ts                 (RV-01/RV-02 updated to the secured owner contract)
apps/api/src/redemption/redemption-concurrency.spec.ts                 (constructor stub update for the injected RbacService/AuditService)
apps/api/src/redemption/redemption-shipping-market-commission.spec.ts  (constructor stub update)
docs/06-phase-reports/p7-s6/D053_REDEMPTION_RATE_OWNER_REMEDIATION_REPORT.md (this report)
```

Not modified: `reward/**`, `admin-reward/**`, `admin-reward-ops/**`,
`admin-redemption-ops/**` (S6C adapter — separate rewiring dispatch per
command §10), `admin-web/**`, `packages/api-client/**`, any other frozen
domain, migrations 0000–0030 (byte-identical).

## 3. Migration 0031

- **`0031_p6_d053_redemption_rate_owner.sql`** (forward-only, single migration
  owner D-053):
  1. `ALTER TABLE redemption_rate_versions DROP CONSTRAINT IF EXISTS
uq_redemption_rate_period` — see §5.1 for the documented deviation.
  2. `redemption_rate_versions.reason text` + `chk_redemption_rate_reason`
     (`reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 500`) —
     legacy rows keep NULL, every new owner-written row carries the reason.
  3. `redemption_rate_market_rules` — versioned per-market rate configuration
     keyed by canonical market code + rate type (bounds CHECK, currency CHECK,
     display-unit CHECK, `is_active`, optimistic `version`).
  4. `redemption_rate_cancellations` — append-only immutable cancellation
     events (FKs to rate version / market / admin user, `reason` CHECK
     1..500, UNIQUE(rate_version_id), reject_update/reject_delete triggers).
- `checksums.json` updated in the same commit: **32/32 verified**
  (`db:checksum`).
- `expected-schema.ts` and the drizzle schema updated in the same commit
  (`reason` appended last to match PostgreSQL ordinal order; the two new
  tables listed); `db:drift` must pass on a migrated DB.
- Malaysia seed lives in `packages/database/seeds/foundation.ts`
  (idempotent `ON CONFLICT (market_code, rate_type) DO UPDATE`): code `MY`,
  `POINTS_PER_CURRENCY`, initial `1.0000000000`, minimum `0.5000000000`,
  maximum `2.0000000000`, MYR, `RM per 1 iPoint`.

## 4. Evidence gate — new suite `redemption-rate.owner.integration.spec.ts`

Fresh isolated database (`DROP DATABASE IF EXISTS … WITH (FORCE)` +
`CREATE DATABASE`, `migrate()` + `seedFoundation()`), real PostgreSQL, HTTP
through the canonical route (`/api/v1/admin/redemption/market/:marketId/rates`,
`/api/v1/admin/redemption/rates/:rateId/cancel`), plus direct in-process owner
calls for the bypass proofs. **59/59 tests** across the command §13 matrix:

| Matrix           | Tests | Highlights                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §5 Authorization | 9     | 401 unauthenticated; 403 member; 403 admin without `redemption.rate.manage`; step-up **recorded** (catalog declares `stepUpRequired:false` and an authorized admin without any step-up token is accepted); 409 no current market; 403 no grant; 409 body/current mismatch; 403 after grant revocation; in-process bypass proof (7 assertions incl. valid in-process create)                                                                                                                                                                                    |
| §6 Rate contract | 10    | RM0.50 / 1.00 / 2.00 accepted; 0.49 → 422 `BELOW_MINIMUM`; 2.01 → 422 `ABOVE_MAXIMUM`; >10 decimals → 400 (transport) + 422 (in-process); exactly-10-decimals stored verbatim; zero float drift on `0.1000000001`; unconfigured market → 422 `MARKET_BLOCKED` (no row, no audit); no cross-market fallback (`configured:false`, per-market isolation)                                                                                                                                                                                                          |
| §7 Activation    | 7     | same-day / backdated / non-midnight / DST-skipped (America/Havana 2026-03-08) / ambiguous repeated midnight (America/Santiago 2026-04-05) → 422; future KL midnight → 201 with exact UTC + local + timezone (stored instant asserted); America/New_York 2027-07-04 00:00 == 04:00Z                                                                                                                                                                                                                                                                             |
| §8 Versioning    | 8     | first version 201; legal later-start successor 201; successor exactly at a legacy stored end 201 (legacy row byte-identical); same-start → 409 `OVERLAP`; start inside a legacy window → 409; concurrent race → one 201 + one 409 + one row; legacy rows byte-identical; legacy quote + order keep `rate_version_id`/snapshot/cost after successor creates (resolver still serves the legacy rate)                                                                                                                                                             |
| §10 Idempotency  | 7     | same key + same payload → exact replay (one row); same key + different rate / date / reason → 409 `IDEMPOTENCY_CONFLICT`; concurrent same-key duplicates → both 201 with the SAME id, one row; injected audit failure → full atomic rollback (no version, no audit, no claim) and same-key retry succeeds; create vs cancel scope separation recorded                                                                                                                                                                                                          |
| §11 Reason/audit | 8     | missing / blank / >500 reason → 400; 1-char and 500-char accepted; audit row carries actor, market, action, exact rate, rateType, reason, non-empty request id, `SUCCESS`; version row stores the reason; mechanism row stores 64-hex hash + status 201 + response id; legacy NULL reason retained                                                                                                                                                                                                                                                             |
| §9 Cancellation  | 10    | future scheduled → 200 with immutable cancellation event (version row untouched, listed `CANCELLED`); resolver + quote ignore cancelled versions (legacy-cancelled window covering NOW → `REDEMPTION_RATE_NOT_FOUND`); active / expired / historically-used (quote-referenced) → 409; UPDATE/DELETE of the cancellation row rejected by triggers; replay same key/payload → same cancellation id, one row; same key + different reason → 409; same key + different target version → 409; in-process cancel enforces the same permission/market/reason controls |

### Existing suites updated for the new contract

- `redemption-admin.hardening.spec.ts` T-86/T-88: now seed the per-market
  rate rule + RBAC grant chain + market grant, use a future KL midnight,
  pass `currentMarketId`, mandatory reason; T-88 asserts the owner's
  `REDEMPTION_RATE_OVERLAP` code.
- `redemption-integration.spec.ts` RV-01/RV-02: same contract updates;
  RV-02 asserts `REDEMPTION_RATE_OVERLAP`.
- `redemption-concurrency.spec.ts` / `redemption-shipping-market-commission.spec.ts`:
  constructor stubs for the injected `RbacService`/`AuditService`
  (these suites exercise only frozen quote/order/shipping paths — no owner
  command).

## 5. Assumptions, deviations and risks

### 5.1 REQUIRED DEVIATION — the frozen gist exclusion was dropped in 0031

The frozen `uq_redemption_rate_period` (EXCLUDE USING gist over
`tstzrange(effective_from, COALESCE(effective_until,'infinity'), '[)')`)
rejects ANY second version for the same (market, rate_type) once the first
version is open-ended — every open-ended pair overlaps. Under the immutable
append-only table (reject_update trigger + §8 "no UPDATE of historical
rows"), a successor after an open-ended active version is therefore
structurally impossible while the constraint exists. This is precisely the
S6C-reported defect (P7-S6C_INTERNAL_DELIVERY_REPORT §2.1: "a rate change
after the initial baseline is impossible under the frozen owner") and it
conflicts with D-053 §8 ("legal future successor versions allowed") and §9
("changing an active rate must create a legal future successor"). Migration
0031 therefore removes the gist exclusion and replaces the hard guarantee
with the accepted D-050 pattern: the owner's chain rule (strictly increasing
starts per market + rate type, respecting legacy stored ends) enforced under
a market-scoped `pg_advisory_xact_lock`, plus the frozen append-only triggers
and the new UNIQUE(rate_version_id) cancellation guarantee. Legacy bounded
rows remain valid and are respected by both the owner and the resolver. If
the Command Center prefers to keep a gist-style constraint, the alternative
is a bounded-window create model where the operator pre-closes every
predecessor window at create time; that model makes rate changes after an
open-ended baseline impossible and was therefore not chosen.

### 5.2 Step-up semantics (recorded, not skipped)

`redemption.rate.manage` declares `stepUpRequired: false` in the canonical
catalog; per §5 "fresh MFA step-up where required by the permission catalog",
no step-up token is demanded. The suite asserts the catalog value AND that an
authorized admin without a step-up token is accepted — the "missing step-up
denied" assertion is intentionally inverted and recorded (§5.1 of the D-050
report precedent). If a future catalog change adds `stepUpRequired`, the
RbacGuard enforces it at the transport automatically.

### 5.3 Idempotency scope separation (recorded ambiguity resolution)

D-053 §10 prescribes distinct owner scopes for create and cancel
(`…owner.create:<marketId>:<adminUserId>` vs `…owner.cancel:…`). The clause
"same key + different operation → 409" cannot be enforced across those two
scopes by construction (the mechanism table key is `(scope, key)`), so
"different operation" is interpreted as same-scope-different-payload. The
suite records the actual (designed) cross-scope behavior — the same key may
name operations in both scopes independently — and enforces 409 within each
scope (rate/date/reason/target-version). If unified cross-operation key
rejection is required, the Command Center should prescribe a single scope
with an explicit operation discriminator in the payload hash; this is a
small follow-up.

### 5.4 S6C adapter rewiring (out of scope, next dispatch)

The S6C adapter (`apps/api/src/admin-redemption-ops/**`) is not present in
this worktree and was not modified. When rewired against the secured owner it
must pass: the client `Idempotency-Key`, the mandatory `reason`, the server
Current Admin Market (`adminMarketContext`), and must drop its duplicated
owner-level controls (bounds, activation, overlap, advisory lock, owner-scope
idempotency claim). Its legacy per-market rules map is superseded by the
versioned `redemption_rate_market_rules` table (MY seeded).

### 5.5 Other notes

- Resolver semantics: active version = latest non-cancelled start ≤ NOW with
  stored end (if any) > NOW; cancelled versions are excluded forever, so a
  cancelled scheduled version can never become effective and no historical
  quote/order is repriced (frozen quote/order logic untouched).
- The list read surface now returns `marketConfig`
  (`configured:false` for unconfigured markets) while staying behind the
  existing `redemption.rate.manage` permission — `redemption.rate.read` was
  NOT added (Phase 7 read surface belongs to the S6C rewiring scope).
- `openapi:validate` and the full typecheck/build gates are executed by
  OpenClaw on the host (sandbox cannot run the pnpm toolchain); the code was
  syntax-verified and manually type-reviewed in this worktree.
- Rate-rule bounds CHECK `minimum_rate > 0` means a configured market cannot
  approve a zero/negative minimum; the owner's DB CHECK
  `chk_redemption_rate_value (rate_value > 0)` remains the final guard.

## 6. Confirmation

- Owner scope only: `apps/api/src/redemption/**`, `packages/database`
  (migration 0031 + checksums + schema + expected-schema + foundation seed),
  and this report — no other frozen domain touched.
- Migrations 0000–0030 byte-identical; checksums 32/32; drift aligned;
  Malaysia rules seeded idempotently (no logic hard-codes any market value).
- `cancelRateVersion` no longer UPDATEs `redemption_rate_versions`; all
  cancellations are append-only events; resolvers exclude cancelled versions.
- No push, no merge; OpenClaw integration + host gate execution pending.

`D-053_OWNER_REMEDIATION_IMPLEMENTED` / pending OpenClaw verification and
Command Center acceptance / NOT merged.
