# P7-S6C Internal Delivery Report — Admin Redemption Rate Configuration

| Field           | Value                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| Status          | `P7-S6C_DELIVERY_COMPLETE` / pending OpenClaw integration review                                            |
| Phase authority | `CONTINUING_UNDER_D-048` (§5 written handoff; redemption rate configuration)                                |
| Executor class  | `OPENCLAW_MANAGED_CODING_SUBAGENT` (D-048; Codex CLI unavailable)                                           |
| Worktree        | `C:\AI_WORKSPACE\iPoint App\.local\wt-p7-s6c-redemption`                                                    |
| Branch          | `task/p7-s6c-redemption-config` (base `7dca2c33` — includes accepted S6A + S6B)                             |
| Scope           | P7-S6C: Admin Redemption Rate Configuration (frozen contract §7.2, ChatGPT Command Center order 2026-08-04) |
| Pushed          | NO (OpenClaw integrates and pushes)                                                                         |
| Date            | 2026-08-04                                                                                                  |

## 1. Scope delivered

Phase 7 **read projection + orchestrated create** over the FROZEN Phase 6 redemption owner
(`apps/api/src/redemption`). No frozen Phase 1/3/5/6 owner file was modified (frozen-path
`git diff` over `apps/api/src/redemption`, `apps/api/src/reward`, `apps/api/src/admin-reward`,
`apps/api/src/merchant`, `apps/api/src/package`, `apps/api/src/agent-activation`,
`apps/api/src/commission`, `packages/database/migrations|schema|seeds` is EMPTY); the single
`redemption_rate_versions` insert is delegated to the frozen owner command
`RedemptionService.createRateVersion` **unchanged**.

### 1.1 Phase 7 adapter — `apps/api/src/admin-redemption-ops/` (new)

| Route                                                       | Permission (canonical catalog)                                             | Read / Write | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/admin/redemption-ops/markets/:marketId/rates`  | `redemption.rate.read` (all admin roles except KYC_REVIEWER, marketScoped) | Read         | Selected-market redemption rate configuration: the approved §7.2 per-market bounds (initial / minimum / maximum / currency / display unit) or the **explicit blocked state** (`configured: false`) for markets without an approved rule — NO other-market fallback. Every `POINTS_PER_CURRENCY` version with full technical precision (`rate_value`, ≤10 decimals), the server-derived ≤6-decimal display value (`display_rate`, display-only), projected effective windows in market-local time AND resolved UTC, window status (SCHEDULED/ACTIVE/SUPERSEDED/EXPIRED).                                                                |
| `POST /api/v1/admin/redemption-ops/markets/:marketId/rates` | `redemption.rate.manage` (SUPER_ADMIN only, marketScoped)                  | Write        | §7.2 per-market bounds enforcement (Malaysia initial RM1.00 / min RM0.50 / max RM2.00 per 1 iPoint — at-bounds accepted), ≤10-decimal technical precision, strictly-future market-local 00:00 activation (local + resolved UTC returned), overlap prevention serialized with a session-level PostgreSQL advisory lock, exact idempotency (`Idempotency-Key` + canonical payload hash in the shared `merchant_api_idempotency_keys` mechanism table — replay returns the original result; same key + different payload → 409), mandatory reason + privileged audit. The insert delegates to the frozen Phase 6 owner command unchanged. |

The adapter never writes domain tables directly: its only writes are the idempotency mechanism
rows and the canonical audit records; `redemption_rate_versions` is written exclusively by the
frozen owner command.

### 1.2 Per-market configuration (CONFIGURABLE — versioned rules)

The §7.2 approved values live in a **versioned Phase 7 rules map** (`REDEMPTION_RATE_MARKET_RULES`
in the adapter types) keyed by canonical market code — never hard-coded in logic. The map approves
only `MY` (Malaysia: initial `1.0000000000`, minimum `0.5000000000`, maximum `2.0000000000`, MYR,
`RM per 1 iPoint`) under D-046 §7.2. Every other market resolves to NO rule → blocked state
(`REDEMPTION_RATE_MARKET_BLOCKED`, 422 on write, `configured: false` on read). The map is injected
via a DI provider (`REDEMPTION_RATE_RULES_PROVIDER`) so the approval catalog can evolve without
touching logic; the integration suite overrides the provider with additional test codes carrying
the SAME Malaysia values purely to produce multi-market evidence (production catalog stays MY-only).

### 1.3 Admin Web — `/admin/:marketId/config/redemption-rates`

- The existing manifest entry referenced `redemption.rate.read` — a code that did NOT exist in the
  catalog. The catalog is Phase 7-owned, so `redemption.rate.read` (all admin roles except
  KYC_REVIEWER, marketScoped — mirroring `reward.rule.read`) was **added** to
  `packages/database/src/permission-catalog.ts` (zero drift resolved; `seedFoundation` seeds it).
  The stale `gate('redemption.rate.schedule', 'SEC-03/15')` was removed from the entry (same defect
  class as the S6B reward-rates gate — the schedule capability is now implemented via
  `redemption.rate.manage`); the route-manifest zero-drift test now asserts the canonical permission
  and the absence of the stale gate.
- New `redemption-config-model.ts` (window-status labels, §7.2 rate grammar `^\d+(\.\d{1,10})?$`,
  per-market bounds check against the server-provided config via exact-decimal comparison, future
  market-local date validity, market-local-midnight → UTC display helper, permission gates — UI
  affordance only), `redemption-config-states.tsx` (loading/empty/error/permission-denied/offline/
  blocked), `redemption-config-page.tsx`:
  - Approved §7.2 bounds table (initial/min/max/currency/display unit) + rate versions table with
    the ≤6-decimal display value AND the full technical precision, window badges, market-local
    window AND resolved UTC columns.
  - **Explicit blocked state** for unapproved markets (no fallback to Malaysia).
  - Configure action (SUPER_ADMIN only, `redemption.rate.manage` + online-desktop write
    environment): rate input (client validation mirrors the server grammar/bounds), future-date-only
    picker with market-local wall time AND resolved UTC preview, mandatory reason, auto-generated
    Idempotency-Key. Explicit blocked notice for non-SUPER_ADMIN actors.
- All design-system states covered (loading/empty/error/success/denied/blocked/offline/retry);
  axe critical/serious-clean (jsdom) for both the configured and blocked states.

### 1.4 Typed api-client (append-only)

`AdminRedemptionOpsApiClient` (`listRates` + `createRate`) with typed DTOs mirroring the
adapter contract, `Idempotency-Key` header support, rates as exact decimal strings (never parsed),
and the explicit blocked-state read model. Append-only section after the S6B reward-ops block;
append-only tests in `index.test.ts` (+5).

## 2. Frozen-owner findings (Phase 6 rate management — P6-S2)

Reported per the dispatch rule ("if the owner lacks a needed command, STOP and report the exact gap"):

1. **The owner allows exactly ONE version per market + rate type, forever.** The Phase 6 schema
   is append-only (`reject_update`/`reject_delete` triggers) and enforces a gist exclusion over
   `[effective_from, effective_until)` per (market, rate_type); the owner's own overlap pre-check in
   `createRateVersion` is **degenerate** — `existing.effective_from < COALESCE(new.effective_until,
'infinity')` (identical condition twice) — so ANY second version for the same market + type is
   rejected with `REDEMPTION_RATE_OVERLAP`, even a future-effective successor that the gist
   constraint would legally allow (adjacent half-open windows). `cancelRateVersion` is also broken
   (UPDATE blocked by the append-only trigger and referencing non-existent `updated_at`/`updated_by`
   columns). **Consequence:** the P7-S6C surface delivers initial configuration + immutable history
   - overlap prevention exactly as §7.2 requires, but a _rate change_ (a successor version) after
     the initial baseline is impossible under the frozen owner — the adapter maps the owner's stable
     overlap rejection to `409 REDEMPTION_RATE_OVERLAP` (documented, tested) rather than inventing a
     bypass. **Recommended owner remediation (for OpenClaw/Command Center dispatch):** fix the owner
     pre-check to a proper half-open overlap test (`existing.start < new.end AND new.start <
existing.end`) and repair/replace `cancelRateVersion` (or allow bounded-window creates) so
     future successor versions become creatable. This is a Phase 6 owner change requiring separate
     authorization; Phase 7 must not implement it inside frozen code.
2. **`fiatCurrency` and `notes` are accepted by the owner DTO but dropped** (no columns on
   `redemption_rate_versions`). The adapter passes the market's approved currency code (from the
   versioned rule) through to the owner as the DTO requires; the storage model simply has no
   per-version currency column. The market-level currency is authoritative in the read model.
3. **No mandatory-reason gap:** unlike the S6A special-percentage case, §7.2's mandatory reason +
   privileged audit is fully satisfied by the Phase 7 audit record (same accepted S6B pattern — the
   Phase 7 audit is not inside the owner's transaction).

Everything else required by §7.2 is satisfied by the frozen owner: immutable forward-only versions
(triggers + no edit/delete routes), quote/order rate locking (OD-22: `rate_version_id` +
`rate_snapshot` bound at quote time; order confirmation uses the snapshot — "we do not reject a
valid quote just because its original rate version later expired"), exact decimals
(`numeric(38,10)`), and per-market scoping.

## 3. Evidence (all executed in this worktree)

### 3.1 P7-S6C suites

| Suite                                                              | DB                                                                                                                                       | Result       |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `admin-redemption-ops.spec.ts` (unit)                              | —                                                                                                                                        | **19/19** ✅ |
| `admin-redemption-ops.integration.spec.ts` (HTTP, real PostgreSQL) | `ipoint_gate_p6c` (fresh: `DROP DATABASE IF EXISTS ... WITH (FORCE)` + `CREATE DATABASE`; `migrate()` + `seedFoundation()` in beforeAll) | **22/22** ✅ |
| **P7-S6C API total**                                               |                                                                                                                                          | **41/41** ✅ |

Coverage includes: 401/403/409 RBAC + selected-market enforcement (`MARKET_CONTEXT_MISMATCH`,
`MARKET_SELECTION_REQUIRED`, `MARKET_ACCESS_DENIED`); **Malaysia bounds** — 0.49 → 422
`REDEMPTION_RATE_BELOW_MINIMUM`, 2.01 → 422 `REDEMPTION_RATE_ABOVE_MAXIMUM`, and at-bounds
0.50 / 1.00 / 2.00 all accepted (each on its own configured market — the frozen owner allows one
version per market + type); **ten-decimal technical precision** accepted (`1.1234567890` stored
exactly, `display_rate` = `1.123457`) and eleven decimals → 400; **six-decimal display is
display-only** (stored `numeric(38,10)` value never rounded — proven on create AND read);
**per-market isolation** (a version in one market never appears in another) and **no fallback**
(SG market: `configured: false`, `config: null`, create → 422 `REDEMPTION_RATE_MARKET_BLOCKED`,
no row, no audit); **version immutability** (no PATCH/PUT/DELETE routes → 404, and the owner's
reject-update/reject-delete triggers reject direct UPDATE/DELETE); **no historical quote/order
repricing** (v0 [2026-01-01, 2026-09-01) seeded, quote + order lock v0 at 1.0000000000 / cost
50.0000000000, successor v1 [2026-09-01, ∞) at 2.00 seeded — quote and order rows keep
`rate_version_id` = v0, snapshot `1.0000000000`, cost unchanged; `getEffectiveRate` still v0);
**overlap prevention** (second version rejected on the same AND later dates with 409
`REDEMPTION_RATE_OVERLAP`); **concurrent race** (two parallel creates → exactly one 201 + one 409,
exactly one new row); **idempotency** (replay returns the original version id; same key +
different payload → 409 `REDEMPTION_IDEMPOTENCY_CONFLICT`); **privileged audit** (action
`ADMIN_REDEMPTION_RATE_VERSION_CREATED` with mandatory reason + actor + requestId correlation +
market + after-payload; mechanism row statusCode 201); **exact decimal storage** checks;
future market-local 00:00 activation with local + resolved UTC (UTC+8) and SCHEDULED status.

### 3.2 Gates

| Gate                                                            | Result                                                                                                                                                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @ipoint/api typecheck` / `build`                 | ✅ exit 0 / exit 0                                                                                                                                                                                    |
| `pnpm --filter @ipoint/api openapi:validate`                    | ✅ **228 paths, 0 missing schemas, 0 duplicate operationIds** (`✅ All runtime OpenAPI validations passed.`); does not self-exit after PASS (pre-existing outbox-worker quirk, same as S4/S5/S6A/S6B) |
| `pnpm --filter @ipoint/database db:checksum`                    | ✅ **Verified 30 immutable migration checksum(s)** (30/30)                                                                                                                                            |
| `pnpm --filter @ipoint/api-client typecheck` / `test` / `build` | ✅ exit 0 / **64/64** (+5) / exit 0                                                                                                                                                                   |
| `pnpm --filter @ipoint/admin-web typecheck`                     | ✅ exit 0                                                                                                                                                                                             |
| `pnpm --filter @ipoint/admin-web test`                          | ✅ **205/205** (185 prior + 20 new: 11 model, 9 page; route-manifest zero-drift assertions green)                                                                                                     |
| `pnpm --filter @ipoint/admin-web build`                         | ✅ exit 0 (1634 modules, vite)                                                                                                                                                                        |
| prettier (all changed paths)                                    | ✅ clean (formatting fix committed separately)                                                                                                                                                        |
| eslint (changed paths, scoped)                                  | ✅ exit 0 (0 errors; warnings are the existing admin-web scope-ignore notices, same as S6A/S6B)                                                                                                       |

### 3.3 Regression (integrated tree = this worktree)

| Suite                                  | DB                                          | Result                                  |
| -------------------------------------- | ------------------------------------------- | --------------------------------------- |
| P7-S6A admin-package-ops (unit + HTTP) | `ipoint_gate_p6c_s6a` (pre-created, fresh)  | **36/36** ✅ (4 unit + 32 integration)  |
| P7-S6B admin-reward-ops (unit + HTTP)  | `ipoint_gate_p6c_s6b` (fresh, self-created) | **36/36** ✅ (16 unit + 20 integration) |

### 3.4 Pre-existing findings (NOT caused by P7-S6C — same classes as S6A/S6B)

1. Phase 1 `merchant.integration.spec.ts` (7 fails) and Phase 2 `admin-kyc.http.integration.spec.ts`
   (12 fails) are stale vs the accepted P7-S2 RbacGuard contract — unrelated to this work
   (A/B-proven in S6A).
2. `openapi:validate` does not self-exit after PASS (pre-existing outbox-worker handle).
3. Browser E2E remains host/CI-only (sandbox cannot launch Chromium); the new UI flows are covered
   by mock-based component specs (9 page tests) — NOT claimed as browser-passed.

## 4. Changed files

```
apps/api/src/admin-redemption-ops/admin-redemption-ops.controller.ts        (new)
apps/api/src/admin-redemption-ops/admin-redemption-ops.dto.ts               (new)
apps/api/src/admin-redemption-ops/admin-redemption-ops.errors.ts            (new)
apps/api/src/admin-redemption-ops/admin-redemption-ops.module.ts            (new)
apps/api/src/admin-redemption-ops/admin-redemption-ops.service.ts           (new)
apps/api/src/admin-redemption-ops/admin-redemption-ops.types.ts             (new)
apps/api/src/admin-redemption-ops/admin-redemption-ops.spec.ts              (new, 19 tests)
apps/api/src/admin-redemption-ops/admin-redemption-ops.integration.spec.ts  (new, 22 tests)
apps/api/src/app.module.ts                                                  (register AdminRedemptionOpsModule)
packages/database/src/permission-catalog.ts                                 (add redemption.rate.read — Phase 7-owned catalog)
apps/admin-web/src/redemption-config-model.ts                               (new)
apps/admin-web/src/redemption-config-model.test.ts                          (new, 11 tests)
apps/admin-web/src/redemption-config-states.tsx                             (new)
apps/admin-web/src/redemption-config-page.tsx                               (new)
apps/admin-web/src/redemption-config-page.test.tsx                          (new, 9 tests)
apps/admin-web/src/test/redemption-config-fixtures.ts                       (new)
apps/admin-web/src/test/redemption-config-mock.ts                           (new)
apps/admin-web/src/route-manifest.ts                                        (removed stale SEC-03/15 gate from redemption-rates entry)
apps/admin-web/src/route-manifest.test.ts                                   (zero-drift assertion for redemption-rates)
apps/admin-web/src/admin-api.ts                                             (adminRedemptionOpsApi client)
apps/admin-web/src/admin-app.tsx                                            (redemption-rates route case)
packages/api-client/src/index.ts                                            (append-only redemption section)
packages/api-client/src/index.test.ts                                       (append-only tests, +5)
docs/06-phase-reports/p7-s6/P7-S6C_INTERNAL_DELIVERY_REPORT.md              (this report)
```

No frozen Phase 1/3/5/6 owner file, no migration, and no seed change were made (the permission
catalog addition is Phase 7-owned and `seedFoundation` derives from it). No `admin.css` change was
needed (the existing `admin-reward-*` classes are reused).

## 5. Assumptions and risks

- **Assumption:** the redemption rate surface configures `POINTS_PER_CURRENCY` — the canonical
  conversion type the frozen quote flow actually consumes (`required_iPoint =
fiat_reference_value / rate`; a value of 1.00 = RM1.00 per 1 iPoint, matching the §7.2 Malaysia
  baseline). Other rate types (e.g. `CURRENCY_PER_POINT`) remain owner-managed and are not shown on
  this surface.
- **Assumption:** the versioned per-market rules map keyed by market code IS the "owner/market
  configuration" source for the CONFIGURABLE §7.2 values (there is no market-configuration table in
  the schema; the markets row supplies timezone/currency and the map supplies the approved bounds).
- **Risk:** a rate _change_ (successor version) after the initial baseline is impossible under the
  frozen Phase 6 owner (finding §2.1) — the surface honestly returns 409 and the UI copy states
  versions are immutable; a separately authorized Phase 6 owner remediation is required for
  successor scheduling.
- **Risk:** the integration suite overrides the rules provider with additional test market codes
  (MA–MI) carrying the identical Malaysia values; the PRODUCTION catalog approves only MY.
- **Risk:** `openapi:validate` needs `REDEMPTION_VOUCHER_ENCRYPTION_KEY` and does not self-exit
  after PASS (pre-existing).
- Sandbox limitation: git commits were authored via the bundled dugite git binary (no system git in
  the sandbox); OpenClaw should verify the worktree/ref state on the host before review.

## 6. Confirmation

- No frozen Phase 1/3/5/6 owner file modified (frozen-path diff EMPTY); no migration written; no
  seed change.
- The adapter never writes domain tables directly; the single `redemption_rate_versions` insert
  delegates to the frozen Phase 6 owner command unchanged.
- No direct table writes from the UI; no client-side rate arithmetic; no historical recalculation;
  append-only versions (no edit/delete routes + owner triggers); no other P7-S6 domain
  (package/reward/commission) touched.
- Not pushed, not merged; OpenClaw integration review pending.

`P7-S6C_DELIVERY_COMPLETE` / pending OpenClaw integration review / NOT Command Center acceptance.
