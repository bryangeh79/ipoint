# P7-S6 — D-051 Phase 1 Special-Percentage Owner Remediation Delivery Report

| Field         | Value                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Record**    | D-051 delivery — Phase 1 special-percentage owner remediation (mandatory reason + audit + owner security)           |
| **Status**    | `D-051_DELIVERY_COMPLETE` / pending OpenClaw integration + independent review + Command Center acceptance           |
| **Decisions** | D-048 (subagent authorization class) / D-051 (Command Center order 2026-08-04 §5) / D-055 (continuous execution §3) |
| **Branch**    | `fix/p1-p7-special-percentage-owner` (base = latest verified `phase/7-admin-operations` HEAD @ `69537e7c`)          |
| **Executor**  | `OPENCLAW_MANAGED_CODING_SUBAGENT` (D-048, implementer role)                                                        |
| **Pushed**    | NO (integration/push is OpenClaw's)                                                                                 |
| **Date**      | 2026-08-06                                                                                                          |

## 1. Scope delivered

Every control from the D-051 command §1–§8 now lives **inside the Phase 1
owner command** (`PackageService.createSpecialPercentage`,
`apps/api/src/merchant/package.service.ts`), so the canonical Phase 1 route
(`POST /api/v1/admin/markets/:marketId/special-percentages`) **and** any
in-process caller get identical enforcement, mirroring the accepted D-050
(reward rule) / D-053 (redemption rate) / D-054 (commission rate) owner
patterns. The owner command is the enforcement boundary; the Phase 7 S6A
adapter surface is **not** modified and stays blocked (404 + UI blocked
state — proven by regression).

## 2. Changed files

```
packages/database/migrations/0033_p1_d051_special_percentage_reason.sql   (new — forward-only, D-051 sole owner)
packages/database/migrations/checksums.json                                (33 → 34 checksums; 0000-0032 byte-identical)
packages/database/schema/index.ts                                          (specialPercentages.reason)
packages/database/src/expected-schema.ts                                   (reason appended last, PostgreSQL ordinal order)
apps/api/src/merchant/package.service.ts                                   (secured owner createSpecialPercentage; marketRow / assertMarketAccess / sanitizeForAudit helpers; RbacService injected)
apps/api/src/merchant/package.controller.ts                                (server actor built from session + RbacGuard adminMarketContext; client can neither supply nor override actor/market)
apps/api/src/merchant/dto/package.dto.ts                                   (createSpecialPercentageSchema + mandatory reason: trim, non-blank, ≤500, strict)
apps/api/src/merchant/package.errors.ts                                    (new — SPECIAL_PERCENTAGE_* owner codes)
apps/api/src/merchant/package.types.ts                                     (new — SpecialPercentageAdminActor + CreateSpecialPercentageResponse)
apps/api/src/__tests__/d051-special-percentage.owner.integration.spec.ts   (new — D-051 owner evidence suite, 27 tests)
apps/api/src/merchant/__tests__/package.dto.spec.ts                        (updated to the D-051 DTO contract, 19 tests)
docs/06-phase-reports/p7-s6/D051_SPECIAL_PERCENTAGE_OWNER_REMEDIATION_REPORT.md (this report)
```

Not modified: `admin-package-ops/**` (S6A adapter — blocked surface kept
byte-identical; its rewire is a separate later dispatch), reward /
redemption / commission / wallet / transaction domains, admin-web,
api-client, permission-catalog, migrations 0000–0032 (byte-identical),
governance files, seed files.

## 3. Migration 0033 + pre-checks

`0033_p1_d051_special_percentage_reason.sql` (forward-only, single
migration owner D-051):

```sql
ALTER TABLE special_percentages
  ADD COLUMN reason text;

ALTER TABLE special_percentages
  ADD CONSTRAINT chk_special_percentages_reason CHECK (
    reason IS NULL OR (char_length(btrim(reason)) BETWEEN 1 AND 500)
  );
```

- Legacy rows keep `NULL` (never backfilled — D-051 §3); new rows are
  enforced 1..500 by the owner DTO + owner service + DB CHECK (final hard
  guarantee).
- `special_percentages` remains append-only (frozen
  `protect_service_fee_reference_data` trigger, migration 0004) — verified
  live: UPDATE rejected with `55000`.
- **Pre-check evidence** (recorded before the migration landed):
  - highest migration at base = `0032_p5_d054_commission_rate_reason.sql`
    (from base `69537e7c` checksums.json, 33 entries).
  - `db:checksum` at base = **33/33 verified**.
  - `git diff 69537e7c -- packages/database/migrations/` after the change =
    only `checksums.json` (append of the 0033 entry) — **0000-0032
    byte-identical**.
- Post-land: `db:checksum` **34/34**, `db:migrate` clean on a fresh DB,
  `db:drift` **clean** (expected-schema matches live catalog).
- Live DB proof (probe on a migrated database): `reason` column present in
  last ordinal position; legacy row reason stays `NULL`; whitespace-only
  reason rejected by the CHECK (`23514`); a valid reason stored verbatim.

## 4. Clause-by-clause implementation map (D-051 §1–§8)

| #   | Contract clause                 | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §1 Owner internal auth          | `merchant.special_package.manage` re-checked server-side via `RbacService.isAllowed` (ACTIVE admin + ACTIVE account + non-revoked role grant; SUPER_ADMIN-only catalog entry, `stepUpRequired` stays on the guard as defense-in-depth); server Current Admin Market (`actor.currentMarketId` from the RbacGuard `adminMarketContext`) required and must equal the command market (route id); market row must be ACTIVE; active `market_access` grant asserted — a revoked grant denies the very next request (tested); `adminUserId` and market always derive from the server session/guard — the DTO is `.strict()` so no actor/market field can be injected |
| 2   | §2 Mandatory reason             | `createSpecialPercentageSchema.reason`: `z.string().trim().min(1).max(500)` — trimmed, non-blank (whitespace-only rejected), ≤500; DTO required; owner re-checks in-process (`SPECIAL_PERCENTAGE_REASON_REQUIRED`) for direct callers; transport 400 `VALIDATION_ERROR` for HTTP                                                                                                                                                                                                                                                                                                                                                                              |
| 3   | §3 Durable reason storage       | `special_percentages.reason` column (migration 0033, `text`, nullable); legacy rows keep `NULL`, **never backfilled** (tested); new rows carry the reason, enforced by owner + CHECK                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 4   | §4 Idempotency + canonical hash | Owner scope `package.special.owner.create:<marketId>:<adminUserId>` (dedicated scope so pre-D-051 mechanism rows with the old payload shape are never replayed); canonical payload hash (sorted keys + sha256) covers operation/marketId/market code/rate/description/reason/actor scope; same key + same payload → exact replay (one row, same id); same key + different payload → 409 `SPECIAL_PERCENTAGE_IDEMPOTENCY_CONFLICT`; concurrent same-key duplicates → exactly one committed row (both 201, same id); failed transactions leave no claim (injected-failure proof)                                                                                |
| 5   | §5 Atomic immutable audit       | `special_percentages` row + idempotency claim + immutable audit (`SPECIAL_PERCENTAGE_CREATED` with reason, actor, market, payload-hash digest under `idempotencyDigest`) commit in **one** transaction; injected audit failure rolls back all three (row + claim + audit proven absent) and a same-key retry succeeds                                                                                                                                                                                                                                                                                                                                         |
| 6   | §6 Actor immutability           | `createdByAdminUserId` comes only from the server actor; the strict DTO rejects any actor-shaped body field (400 `VALIDATION_ERROR`, tested); in-process callers cannot override the recorded creator                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 7   | §7 Pinning                      | Creation never touches `merchant_package_assignments` — assignment rows proven byte-identical (count and contents) after an owner create; no assignment references the new special percentage; `assign`/`set-default` remain the only explicit audited reassignment paths (untouched)                                                                                                                                                                                                                                                                                                                                                                         |
| 8   | §8 No historical recalc         | Existing special-percentage rows (including seeded legacy rows) are byte-identical after an owner create; legacy reason stays `NULL`; no recalculation of any historical assignment/transaction on this surface                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## 5. Evidence gate — new suite `d051-special-percentage.owner.integration.spec.ts`

Fresh isolated database (`DROP DATABASE IF EXISTS … WITH (FORCE)` +
`CREATE DATABASE`, `migrate()` + `seedFoundation()` in beforeAll), real
PostgreSQL, HTTP through the canonical Phase 1 route (with fresh
server-seeded step-up grants per request, per the frozen catalog), plus
direct in-process owner calls for the bypass proofs. **27/27** tests:

| Matrix                | Tests | Highlights                                                                                                                                                                                                                                                                                                                                                |
| --------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 Authorization      | 9     | 401 unauthenticated; 403 member; 403 admin without `merchant.special_package.manage`; authorized SUPER_ADMIN-like actor 201; 409 no Current Admin Market (`MARKET_SELECTION_REQUIRED`); 403 no market grant; 403 immediately after grant revocation; in-process no-actor → 403 `SPECIAL_PERCENTAGE_PERMISSION_DENIED`; in-process no-current-market → 409 |
| §2/§3 Reason          | 5     | missing 400 `VALIDATION_ERROR`; blank/whitespace-only 400 (+ in-process `SPECIAL_PERCENTAGE_REASON_REQUIRED`); >500 400; 1-char/500-char accepted, trim applied and persisted on the row; durable row + audit evidence (reason, actor id, market, payload-hash digest, market code)                                                                       |
| §1 Market             | 2     | command market ≠ Current Admin Market → 409 (guard `MARKET_CONTEXT_MISMATCH` + in-process `SPECIAL_PERCENTAGE_MARKET_CONTEXT_MISMATCH`); cross-market isolation (market B stays empty)                                                                                                                                                                    |
| §4 Idempotency        | 4     | missing key 400; same key + same payload → exact replay, one row, one 64-hex-hash mechanism row; same key + different rate/description/reason → 409; concurrent same-key duplicates → both 201 SAME id, single row                                                                                                                                        |
| §5 Audit atomicity    | 1     | injected audit failure → 500, no row, no claim, no new audit for the market, then same-key retry 201                                                                                                                                                                                                                                                      |
| §6 Actor immutability | 2     | DTO with `createdByAdminUserId`/`adminUserId` → 400 `VALIDATION_ERROR`; server actor recorded as `created_by` for direct calls                                                                                                                                                                                                                            |
| §7/§8 Pinning/history | 2     | assignment rows byte-identical after create (no special refs); legacy historical row byte-identical, reason `NULL`                                                                                                                                                                                                                                        |
| §3 Legacy             | 1     | legacy rows keep `NULL` reason after a new owner create (never backfilled)                                                                                                                                                                                                                                                                                |
| DTO unit (updated)    | 19    | decimal boundaries preserved; reason required/trimmed/1..500; actor-shaped fields rejected                                                                                                                                                                                                                                                                |

## 6. Regression (sandbox, real PostgreSQL, node v26.4.0, pnpm 9.15.9)

| Gate                                                        | DB (isolated)                              | Result                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| D-051 owner suite (new) + dto spec (final run)              | `ipoint_d051_owner`                        | **46/46** (27 + 19)                                                                                               |
| P7-S6A (admin-package-ops unit + integration)               | `ipoint_d051_s6a`                          | **34/36** — 4 unit + 30 integration pass; **2 expected failures** (see §7.1); blocked-surface 404 test **passes** |
| Phase 1 merchant integration (A/B vs base)                  | `ipoint_d051_merchant_after`               | 7 failed / 3 passed — **identical failing set to baseline** (pre-existing P7-S2 staleness, §7.2); no new failures |
| S6B regression (admin-reward-ops)                           | `ipoint_d051_s6b`                          | **38/38**                                                                                                         |
| S6C regression (admin-redemption-ops)                       | `ipoint_d051_s6c`                          | **49/49**                                                                                                         |
| D-054 owner suite (commission-rate.owner, shared mechanism) | `ipoint_d051_d054`                         | **51/51**                                                                                                         |
| P5-R1 owner remediation                                     | `ipoint_d051_p5r1` (pre-migrated + seeded) | **13/13**                                                                                                         |
| `db:checksum`                                               | —                                          | **34/34** verified                                                                                                |
| `db:drift`                                                  | `ipoint_d051_migtest`                      | clean                                                                                                             |
| `db:migrate` (fresh DB)                                     | `ipoint_d051_migtest`                      | clean, 34 migrations                                                                                              |
| api typecheck / build                                       | —                                          | exit 0 / exit 0                                                                                                   |
| OpenAPI runtime validation                                  | —                                          | **passed** (238 paths, 0 errors)                                                                                  |
| eslint (changed files) / prettier (changed files)           | —                                          | clean                                                                                                             |

Evidence logs preserved under `/workspace/.local/d051-gate/evidence/`
(`d051-owner-suite.log`, `s6a-regression.log`, `s6b-regression.log`,
`s6c-regression.log`, `d054-owner-regression.log`, `p5r1-regression.log`,
`merchant-integration-after.log`, `baseline-merchant-integration.log`,
`99-openapi.log`, plus the pre/post checksum and drift runs).

## 7. Known limitations and recorded deviations

### 7.1 S6A suite: 2 owner-route tests now fail BY DESIGN (rewire deferred)

Two tests in `admin-package-ops.integration.spec.ts` assert the
**pre-remediation** owner behavior — that the Phase 1 owner route accepts
creation with only `rate` + `description` (201, audit reason NULL):

- `documents the gap: the owner command accepts creation without a
mandatory reason` (the literal gap-evidence test that motivated D-051);
- `accepts six decimals and enforces (0, 100] for special percentages`
  (its owner-route posts omit `reason`).

After D-051 both receive **400** (reason now mandatory) — direct positive
evidence of the remediation. Rewiring them is part of the **S6A rewire
dispatch** (explicitly a later, separate dispatch; this task forbids
modifying `admin-package-ops/**`), so they are left untouched and recorded
as expected failures: **34/36**. Every other S6A test passes, including
`exposes no special-percentage create/activate route on the Phase 7 surface
(blocked capability)` (404), `exposes no write routes on the Phase 7
adapter surface`, assignment pinning, and no-historical-recalculation —
proving the owner fix did **not** accidentally expose the S6A surface.

### 7.2 Phase 1 merchant integration suite: pre-existing failures (unchanged)

`merchant.integration.spec.ts` fails 7/10 at baseline and after D-051 with
an **identical failing set** (A/B diff = empty). The failures predate D-051
(P7-S2-era fixtures never select a Current Admin Market / step-up grant;
documented in the P7-S6A report §3.4). Not caused by, and not repairable
within, D-051 scope.

### 7.3 Idempotency scope semantics (recorded)

Same-key-different-payload → 409 is enforced **within** the owner scope
`package.special.owner.create:<marketId>:<adminUserId>` (mechanism table
uniqueness). A key reused under a different market/admin scope commits
independently (identical recorded semantics as D-054 §5.4 / D-053 §5.3);
the canonical payload hash discriminates market/admin within a scope.

### 7.4 S6A read projection unchanged

The S6A adapter's special-percentages read projection is an explicit
column list and does not surface `reason`; displaying the reason on the S6A
surface belongs to the S6A rewire dispatch.

### 7.5 Status code alignment

Owner create returns **201** and persists `status_code = 201` on the
idempotency record, aligned with the accepted D-050/D-053/D-054 owner
convention (the frozen Phase 1 contract does not pin the create status).

## 8. Commits (this worktree, not pushed)

```
5aa46870 feat(database): add special percentage reason column (0033)
c4257a8a feat(merchant): secure special percentage owner command (reason, audit, idempotency)
fb4dc276 test(p1): add d-051 special percentage owner evidence suite
<docs>   docs(p1): record d-051 owner remediation delivery          (this report)
```

## 9. Next steps (OpenClaw / Command Center)

1. Independent reviewer + separate integration/verifier per the D-051
   review model (implementer cannot self-review).
2. S6A rewire dispatch: point the S6A surface at the secured Phase 1 owner
   and rewire the two owner-route tests recorded in §7.1.
3. S6A final gate after rewire; P7-S6E sequencing per D-055/D-054 §17.
4. OpenClaw updates governance records (DECISION_LOG / PHASE_REGISTRY /
   Executor Provenance Register) and integrates this branch forward-only.
