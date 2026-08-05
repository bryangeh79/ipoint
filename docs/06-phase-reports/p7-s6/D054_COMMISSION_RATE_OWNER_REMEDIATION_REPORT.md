# P7-S6 — D-054 Phase 5 Commission-Rate Owner Remediation Delivery Report

| Field         | Value                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| **Record**    | D-054 delivery — Phase 5 commission-rate owner security/versioning/audit remediation (CG-04 gate)       |
| **Status**    | `D-054_OWNER_REMEDIATION_IMPLEMENTED` / pending OpenClaw integration + Command Center acceptance        |
| **Decisions** | D-048 (subagent authorization class) / D-054 (CG-04 command)                                            |
| **Branch**    | `fix/p5-p7-commission-rate-owner` (base = latest verified `phase/7-admin-operations` HEAD @ `7250c25f`) |
| **Executor**  | `OPENCLAW_MANAGED_CODING_SUBAGENT` (D-048)                                                              |
| **Pushed**    | NO (integration/push is OpenClaw's)                                                                     |
| **Date**      | 2026-08-05                                                                                              |

## 1. Scope delivered

Every control from the D-054 command §5–§12 now lives **inside the Phase 5
owner command** (`RateManagementService.createRateVersion`,
`apps/api/src/domain/commission/rate.service.ts`), so the canonical routes
(`POST /api/v1/admin/commission-rates` and
`POST /api/v1/admin/commission-rates/schedule`) **and** any in-process caller
(Phase 7 adapter) get identical enforcement. The original positional
`createRate` raw-insert path no longer exists — the owner command itself is
the enforcement boundary, mirroring the accepted D-050 reward-rule owner and
D-053 redemption-rate owner patterns.

| #   | Contract clause             | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §5 In-command authorization | `RbacService.isAllowed` (`commission.rate.manage`, SUPER_ADMIN-only catalog entry) re-checked server-side; ACTIVE admin + ACTIVE account + grant asserted; server Current Admin Market (`actor.currentMarketId`, UUID) required; the owner resolves the market row and requires the body market CODE to equal the server market's code (409 `COMMISSION_RATE_MARKET_CONTEXT_MISMATCH`); active market grant asserted (`assertMarketAccess` — revoked grants deny the very next request); caller-supplied `createdBy` is never accepted (the command type carries no such field and the owner derives `createdBy` from the server actor — proven by test)                                                                                                         |
| 2   | §5 Single owner boundary    | No callable unsecured overload/legacy raw-create method remains (`createRate` removed); all write call sites route through `createRateVersion` (proven by the in-process bypass suite: no-actor, no-current-market, revoked-grant, caller-`createdBy` cases)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 3   | §6 Frozen type contract     | `AGENT_UPGRADE`=FIXED/G1+G2; `MEMBER_CONSUMPTION`=PERCENTAGE/G1+G2; `MERCHANT_RECRUITMENT`=PERCENTAGE/G0; `AGENT_ACTIVATION_FEE`=FIXED/G0 — enforced in-command (frozen Phase 5 error codes `INVALID_COMMISSION_TYPE` / `INVALID_GENERATION` / `RATE_TYPE_MISMATCH` preserved); Malaysia values RM388/RM88/RM38/1%/0.5%/0.5% seed rows untouched; percentage storage units not reinterpreted; historical postings keep their rate-version snapshot (fee snapshot at APPLY proven by P5-R1 4.3)                                                                                                                                                                                                                                                                   |
| 4   | §7 Exact validation         | Decimal strings only (BigInt `scaledRate`, zero float arithmetic), ≤10 technical decimals, NUMERIC(38,10)-compatible (≤38 total digits), no silent rounding/truncation (stored verbatim, `0.1000000001` round-trip proven); rate_type + generation must match the frozen commission-type contract; market canonical (2-letter uppercase) and configured (ACTIVE market row); percentage ≤100% and negatives rejected; FIXED negatives rejected, currency = selected market's currency (`markets.currency_code`, FIXED is denominated in it; no client-supplied currency exists on this surface); **no invented commercial caps** — P5-S0 defines no FIXED upper bound and no lower bound other than `≥ 0` (frozen `chk_rate_value`), both preserved and recorded |
| 5   | §8 Effective-time contract  | Prospective only: strictly future market-local 00:00 (IANA multi-probe `resolveLocalMidnight` + `isMarketLocalMidnight`); same-day/backdated/non-midnight/DST-skipped (America/Havana 2027-03-14)/ambiguous (America/Havana 2027-11-07) rejected 422 `COMMISSION_RATE_ACTIVATION_NOT_FUTURE`; resolved UTC + local wall time + timezone returned; optional payload timezone must equal the market timezone (else 422 `COMMISSION_RATE_TIMEZONE_MISMATCH`); **P5-S0 verification** (see §5.5): no conflicting clause found → no `D054_EFFECTIVE_TIME_CONTRACT_CONFLICT`                                                                                                                                                                                           |
| 6   | §9 Versioning/overlap       | Append-only half-open `[effectiveFrom, effectiveUntil)` windows; strictly increasing starts per (commission_type, generation, market); a successor may start exactly at a predecessor's stored end; open-ended predecessor windows are derived `[start, next_start)` (logical half-open resolution in every resolver — latest start ≤ now wins); no UPDATE/DELETE (new `reject_update`/`reject_delete` triggers, migration 0032); transaction-scoped `pg_advisory_xact_lock` per market (deterministic concurrent outcome: one 201 + one 409); gist-exclusion replacement is a **documented deviation** (see §5.1) requiring independent review approval; **no cancellation feature added** (P5-S0 requires none)                                                |
| 7   | §10 Idempotency             | Operation-scoped mechanism rows in `merchant_api_idempotency_keys` (scope `commission.rate.owner.create:<marketId>:<adminUserId>`); canonical payload hash (sorted keys + sha256) covering operation/marketId/market code/commissionType/generation/rateType/exact rate/effectiveFrom/effectiveUntil/timezone/reason/actor scope; same key + same payload → exact replay (one row, 201); same key + different rate/type/generation/time/reason → 409 `COMMISSION_RATE_IDEMPOTENCY_CONFLICT`; concurrent same-key duplicates → single committed row (both 201, same id); failed transactions roll back version + claim + audit together (injected-failure proof); implemented in the owner only (never in a Phase 7 adapter)                                      |
| 8   | §11 Reason/audit            | Mandatory non-blank reason 1..500 (trimmed/normalized, no silent truncation; transport 400 + owner re-check); persisted durably on the version row (`commission_rate_version.reason`, migration 0032); legacy rows keep NULL (never backfilled — proven); atomic immutable audit (`audit.appendWithinTransaction` inside the same transaction as the rate row + idempotency claim) with actor/type/market/commissionType/generation/rateType/exact rate/effective window/timezone/reason/idempotency digest (see §5.6)/request id/result/created version id; injected audit failure rolls back all three (version + claim + audit) and the same key retry succeeds                                                                                               |
| 9   | §12 Direct/in-process       | Transport guards (`AuthGuard` + `RbacGuard` + `@RequirePermission`) remain defense-in-depth only; the owner re-enforces RBAC/market/reason/idempotency; cross-market payloads rejected (409); revoked grants rejected instantly; unknown-owner errors never surface as success (all bypass cases 403/409/422)                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## 2. Changed files

```
packages/database/migrations/0032_p5_d054_commission_rate_reason.sql   (new — forward-only)
packages/database/migrations/checksums.json                            (33 checksums)
packages/database/schema/index.ts                                      (commission_rate_version.reason)
packages/database/src/expected-schema.ts                               (reason column appended last)
apps/api/src/domain/commission/rate.service.ts                         (secured owner createRateVersion; legacy createRate removed; read surfaces updated to logical half-open resolution; exact-decimal + IANA midnight + payload-hash + lock-key helpers)
apps/api/src/domain/commission/rate.errors.ts                          (new — RateManagementError + frozen Phase 5 codes + COMMISSION_RATE_* owner codes)
apps/api/src/domain/commission/rate.types.ts                           (new — CommissionRateAdminActor + CreateRateVersionCommand/Response)
apps/api/src/domain/commission/rate.dto.ts                             (new — ownerRateCreateSchema, zod strict)
apps/api/src/controllers/admin-rate.controller.ts                      (both write routes → single owner; Idempotency-Key header; server actor/context; owner DTO; error mapping; 201 alignment)
apps/api/src/domain/commission/agent-upgrade.service.ts                (rate resolver ORDER BY effective_from DESC — logical half-open)
apps/api/src/domain/commission/member-consumption.service.ts           (same resolver fix)
apps/api/src/domain/commission/merchant-recruitment.service.ts         (same resolver fix)
apps/api/src/domain/agent-activation/service.ts                        (fee-version resolver fix — Phase 5 owner family, necessary for §8 "future events use the effective version"; disclosed)
apps/api/src/__tests__/commission-rate.owner.integration.spec.ts       (new — D-054 HTTP evidence suite, 51 tests)
apps/api/src/__tests__/p5-r1-owner-remediation.integration.spec.ts     (adapted to the secured owner command + future market-local-midnight timestamps + RBAC grant chain)
apps/api/src/domain/commission/commission.service.spec.ts              (unit harness adapted to the owner command; frozen validation assertions preserved; D-054 owner controls added)
docs/06-phase-reports/p7-s6/D054_COMMISSION_RATE_OWNER_REMEDIATION_REPORT.md (this report)
```

Not modified: `reward/**`, `admin-reward/**`, `admin-reward-ops/**`,
`redemption/**`, `admin-redemption-ops/**` (S6C adapter), `admin-web/**`,
`packages/api-client/**`, `permission-catalog.ts`, migrations 0000–0031
(byte-identical; checksums 32/32 unchanged for 0000–0031, now 33/33 total).

## 3. Migration 0032

- **`0032_p5_d054_commission_rate_reason.sql`** (forward-only, single
  migration owner D-054):
  1. `ALTER TABLE commission_rate_version DROP CONSTRAINT IF EXISTS
uq_rate_period` — see §5.1 for the documented deviation.
  2. `commission_rate_version.reason text` + `chk_commission_rate_reason`
     (`reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 500`) —
     legacy rows keep NULL, every new owner-written row carries the reason.
  3. `commission_rate_version_reject_update` / `_reject_delete` triggers
     (append-only hard guarantee; the frozen Phase 5 DDL 0018 only had such
     triggers on referral_relationship, agent_activation_status_log and
     commission_ledger — the rate table itself had none).
- `checksums.json` updated in the same commit: **33/33 verified**
  (`db:checksum`), `db:drift` clean on a migrated DB, `expected-schema.ts`
  and the drizzle schema updated (`reason` appended last to match
  PostgreSQL ordinal order).
- No seed changes: the frozen P5-R1 seeds (AGENT_ACTIVATION_FEE MY
  RM388, MERCHANT_RECRUITMENT MY 0.5%) are legacy rows that keep NULL
  reason and unchanged values.

## 4. Evidence gate — new suite `commission-rate.owner.integration.spec.ts`

Fresh isolated database (`DROP DATABASE IF EXISTS … WITH (FORCE)` +
`CREATE DATABASE`, `migrate()` + `seedFoundation()`), real PostgreSQL, HTTP
through the canonical routes, plus direct in-process owner calls for the
bypass proofs. **51/51 tests** across the D-054 command §14 matrix:

| Matrix              | Tests | Highlights                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §5 Authorization    | 11    | 401 unauthenticated; 403 member; 403 admin without `commission.rate.manage`; authorized admin 201; 409 no current market; 403 no grant; 409 body-vs-current market mismatch (owner code); 403 after grant revocation (next request); in-process bypass proofs — no actor, no Current Admin Market, caller-supplied `createdBy` ignored (server actor authoritative)                                                                                                                                                   |
| §6 Taxonomy         | 6     | AGENT_UPGRADE FIXED G1/G2 accepted + G0 rejected; MEMBER_CONSUMPTION PERCENTAGE G1/G2 accepted + G0 rejected; MERCHANT_RECRUITMENT PERCENTAGE G0 accepted + G1 rejected; AGENT_ACTIVATION_FEE FIXED G0 accepted + G1 rejected; RATE_TYPE_MISMATCH (AGENT_UPGRADE + PERCENTAGE) 400; invalid commission type 400 (transport VALIDATION_ERROR) + in-process `INVALID_COMMISSION_TYPE`                                                                                                                                   |
| §7 Decimal/business | 8     | 10-decimals stored verbatim, zero float drift (`0.1000000001`); >10 decimals 400/422; negative 400/422; >100% 422 + exactly 100% accepted; frozen zero boundary accepted; 38-digit budget exceeded → 400 `INVALID_RATE_VALUE`; payload timezone mismatch 422; cross-market payload 409 + unresolvable current market 422 `MARKET_NOT_FOUND`                                                                                                                                                                           |
| §8 Effective-time   | 8     | same-day/backdated 422; non-midnight 422; DST-skipped midnight (America/Havana 2027-03-14) 422; ambiguous repeated midnight (America/Havana 2027-11-07) 422; future KL midnight → 201 with exact UTC + local wall time + timezone; legal later-start successor after open-ended version 201; same-start overlap 409 `OVERLAPPING_RATE_PERIOD`; successor exactly at a legacy stored end 201 + legacy row byte-identical (values, created_by, NULL reason)                                                             |
| §10 Idempotency     | 9     | missing header 400; same key + same payload → exact replay, one mechanism row, 64-hex request_hash + status 201; same key + different rate / type+generation / time / reason → 409; cross-market-scope key reuse recorded as independent (D-053 §5.3 semantics, see §5.4); concurrent same-key duplicates → both 201 SAME id, single version row; injected audit failure → full rollback (no version, no claim, no new audit) then same-key retry 201                                                                 |
| §11 Reason/audit    | 9     | missing / blank / overlength reason → 400; 1-char and 500-char accepted and persisted on the row with server `createdBy`; reason normalized (trimmed) without truncation; atomic audit carries actor/market/type/generation/rateType/exact rate/window/timezone/reason/request id/result/created version id + idempotency digest; legacy NULL reason retained on the read surface; logical half-open resolution (latest start wins) + `/schedule` route identical owner enforcement with revoked-grant instant denial |

### Existing suites updated for the new contract

- `p5-r1-owner-remediation.integration.spec.ts` (13/13): direct rate
  creation now goes through the secured owner with a seeded RBAC grant
  chain (ACTIVE admin + SUPER_ADMIN role + `commission.rate.manage` +
  market grants), server actors with `currentMarketId`, mandatory reason +
  Idempotency-Key, and strictly future market-local-midnight timestamps
  (2030-01-02 KL for the successor fee after the v1 stored end). All frozen
  assertion semantics preserved (`INVALID_GENERATION`, fee snapshot
  immutability, no-reprice, posting failure surface).
- `commission.service.spec.ts` (101/101): the `CommissionRateService` block
  was adapted to the owner command — mocked chain + tx proxy harness with
  stubbed RbacService/AuditService; frozen validation assertions preserved
  (invalid type/generation/rate-type/market, overlap, immutability,
  queries); D-054 owner controls added (market selection/context, reason,
  idempotency key, precision, percentage cap, activation, replay/conflict).

### Regression (sandbox, real PostgreSQL + node v24.19.0)

| Gate                                                                                       | Result                           |
| ------------------------------------------------------------------------------------------ | -------------------------------- |
| D-054 owner suite (new)                                                                    | **51/51**                        |
| P5-R1 owner remediation                                                                    | **13/13**                        |
| B/C/D integration + ledger invariants                                                      | **66/66** (15 + 10 + 10 + 31)    |
| Commission domain units (commission/compensation/concurrency) + agent-activation           | **185/185** (101 + 27 + 16 + 41) |
| S6B regression (admin-reward-ops)                                                          | **38/38**                        |
| S6C regression (admin-redemption-ops)                                                      | **30/30**                        |
| Redemption dir regression (incl. D-053 owner 59/59)                                        | **294/294**                      |
| api `__tests__` (concurrency/cross-module/timezone/admin-dashboard)                        | **69/69**                        |
| api-client tests                                                                           | **66/66**                        |
| admin-web tests                                                                            | **209/209**                      |
| api typecheck / build; database typecheck; api-client typecheck+build; admin-web typecheck | all pass                         |
| `db:checksum`                                                                              | **33/33**                        |
| `db:drift`                                                                                 | clean                            |
| OpenAPI runtime validation                                                                 | passed (237 paths)               |
| eslint (changed files) / prettier                                                          | clean                            |

## 5. Assumptions, deviations and risks

### 5.1 REQUIRED DEVIATION — the frozen gist exclusion was dropped in 0032

The frozen `uq_rate_period` (EXCLUDE USING gist over
`tstzrange(effective_from, COALESCE(effective_until,'infinity'), '[)')`,
P5-S0 §23.5 / migration 0018) rejects ANY second version for the same
(commission_type, generation, market) once the first version is open-ended
(effective_until IS NULL) — every open-ended pair overlaps. All Phase 5
baseline rows (including the P5-R1 seeds) are open-ended, so a prospective
successor rate ("changing an active rate must create a legal future
successor", P5-S0 §10.2/§10.3) is structurally impossible while the
constraint exists, because the immutable append-only rows cannot be
retro-fitted with an end boundary (UPDATE is forbidden by §9 and by the new
reject_update trigger). Per the D-054 §9 pre-check: the gist exclusion does
**not** allow legal successors after an open-ended predecessor, so the
narrowly scoped forward-only replacement was required. Migration 0032
therefore removes the exclusion and adopts the D-050/D-053-accepted model:
owner chain rule (strictly increasing starts per type+generation+market,
respecting legacy stored ends) enforced under a market-scoped
`pg_advisory_xact_lock`, logical half-open resolution in every resolver
(latest start ≤ now wins; legacy stored ends still honored), DB uniqueness
support = the append-only triggers + the `merchant_api_idempotency_keys`
UNIQUE(scope,key) mechanism, and no historical row mutation. This
replacement **requires independent reviewer approval** and is covered by
dedicated concurrency/regression tests (concurrent same-key single row,
concurrent different-key one 201 + one 409, successor-at-stored-end,
legacy byte-identity).

### 5.2 No cancellation feature

P5-S0 defines no rate-version cancellation; D-054 §9 explicitly forbids
adding one unless the frozen contract requires it. None was added (no
`redemption_rate_cancellations`-style table for commission rates).

### 5.3 No new commercial caps (recorded)

P5-S0 defines no percentage lower bound beyond `rate_value >= 0` and no
FIXED upper bound; D-054 §7 mandates only "percentage ≤100% and negatives
rejected". The frozen `chk_rate_value >= 0` semantics and the absence of a
FIXED cap are preserved and recorded (a zero FIXED/PERCENTAGE value remains
legal per the frozen range; the suite asserts the 0% boundary acceptance).

### 5.4 Idempotency scope separation (recorded ambiguity resolution)

D-054 §10 prescribes the scope `commission.rate.owner.create:<marketId>:
<adminUserId>`. "Same key + different market → 409" cannot be enforced
across scopes by construction (the mechanism table keys on (scope, key)),
so — exactly as recorded for D-053 §5.3 — "different market" is interpreted
as same-scope-different-payload, and a key reused in a different market
scope commits independently (asserted as recorded behavior). The 409 is
enforced within each scope for rate/type/generation/time/reason. If unified
cross-market key rejection is required, the Command Center should prescribe
a single global scope with an explicit market discriminator in the hash.

### 5.5 P5-S0 effective-time verification — no contract conflict

The D-054 §8 pre-check ("verify P5-S0's effective-time semantics before
adopting market-local midnight") was executed against
`P5-S0-AGENT-COMMISSION-ENGINE-CONTRACT.md`: §10.1 (effective_from
TIMESTAMPTZ), §10.2 ("a new rate version is created with a new
effective_from timestamp; rate changes may be scheduled (future
effective_from)") and §10.3 ("rate changes are prospective only") contain
**no clause that conflicts** with resolving activation at the selected
market's local midnight — the contract is silent on timezone resolution,
and nothing forbids a market-local-date contract. The D-050/D-053-isomorphic
interpretation (strictly future market-local 00:00 in the market IANA
timezone) is therefore adopted; **no `D054_EFFECTIVE_TIME_CONTRACT_CONFLICT`
was raised**. Historical rows (e.g. the 0029 seeds at 00:00Z) keep their
stored instants untouched.

### 5.6 Audit payload-digest key naming (recorded)

The platform audit-redaction layer (`audit-redaction.ts`) scrubs any
`after` key whose name ends in `hash|token|secret|…`. The canonical payload
digest is therefore persisted in the audit as **`idempotencyDigest`** (same
sha256 hex value) so the D-054 §11 "payload hash in the audit" evidence
survives verbatim; the mechanism table stores the identical digest as
`request_hash` (unchanged).

### 5.7 Read-surface permission note

The read routes (`GET active/history/:id`) stay behind
`commission.rate.read` (SUPER*ADMIN/FINANCE*\*) + the selected-market check,
as in P5-R1; `getActiveRates` now returns the latest effective start per
definition (logical half-open). No catalog change was needed — the frozen
catalog already declares `commission.rate.manage` (SUPER_ADMIN,
marketScoped) and `commission.rate.read`.

### 5.8 Pre-existing stale tests (not in this gate, untouched)

`pnpm --filter @ipoint/database test` reports 4 failures that predate D-054
and are outside its scope (verified against the D-053 worktree):

- `tests/phase3-schema.test.ts` asserts the last migration is `0019_` —
  stale since migration 0020 landed.
- `tests/schema.unit.test.ts` asserts the checksum set equals a hardcoded
  20-migration list ending at 0019 — stale since 0021.
- `tests/p7-s2c-permission-catalog.test.ts` asserts exactly 66 catalog
  codes; the current phase/7 base carries 67 (`redemption.rate.read` was
  added during the D-053/S6C integration after that test was frozen). The
  permission catalog was **not** modified by D-054.
  The D-054 gate uses `db:checksum` (33/33) + `db:drift` (clean) +
  expected-schema alignment, all green.

### 5.9 Other notes

- Resolver semantics: active version = latest non-cancelled start ≤ NOW
  with stored end (if any) > NOW; commission resolvers (agent-upgrade,
  member-consumption, merchant-recruitment, agent-activation fee) now order
  by `effective_from DESC` so an open-ended predecessor never shadows its
  successor (derived `[start, next_start)` windows). The
  `agent-activation/service.ts` resolver change is a Phase 5 owner-family
  necessity for §8 ("future events use the effective version") and is
  disclosed here; it does not touch any other domain.
- The write routes now return **201** (aligned with the accepted D-050/D-053
  owner convention and the persisted `status_code` of the idempotency
  record); the frozen P5-S0 contract does not pin the create status code.
- OpenAPI runtime validation passed (237 paths); the validate script holds
  the process open after printing "passed" (background worker handle) — the
  D-053 matrix runner uses the same "passed-detection" watchdog.
- No push, no merge; OpenClaw integration + host gate execution pending.

## 6. Confirmation

- Owner scope only: `apps/api/src/domain/commission/**`, the Phase 5
  controllers/`__tests__`, the four commission-family resolvers, and
  `packages/database` (migration 0032 + checksums + schema +
  expected-schema) — no other frozen domain touched.
- Migrations 0000–0031 byte-identical; checksums 33/33; drift aligned;
  no catalog, seed or historical-row changes.
- `createRate` removed; the secured `createRateVersion` is the single write
  boundary; append-only triggers are the DB-level hard guarantee.
- No push, no merge; OpenClaw integration + host gate execution pending.

`D-054_OWNER_REMEDIATION_IMPLEMENTED` / pending OpenClaw verification,
independent review approval (§5.1 deviation), and Command Center acceptance /
NOT merged.
