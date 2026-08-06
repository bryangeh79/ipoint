# P7-S6E — Admin Market Configuration Delivery Report (secured market owner + Phase 7 surface)

| Field         | Value                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Record**    | P7-S6E delivery — Phase 7 Admin Market Configuration (secured `market.manage` owner + `market.read` Phase 7 surface)                                              |
| **Status**    | `P7-S6E_DELIVERY_COMPLETE` / pending the independent review + separate verification + the OpenClaw internal gate record                                           |
| **Decisions** | D-046, D-047, D-048, D-049; P7-S1 market contract (F:11 `market.manage` SUPER_ADMIN-only marketScoped step-up; `market.read` ALL roles marketScoped); P7-AC-11/12 |
| **Branch**    | `task/p7-s6e-market-config` (worktree `C:\AI_WORKSPACE\iPoint App\.local\wt-p7-s6e-market` @ `1802db37` base)                                                     |
| **Executor**  | `OPENCLAW_MANAGED_CODING_SUBAGENT` (D-048 §5 written handoff, continuation dispatch)                                                                              |
| **Pushed**    | NO (integration/push is OpenClaw's)                                                                                                                               |
| **Date**      | 2026-08-06                                                                                                                                                        |

## 1. Scope delivered

The secured market owner (`apps/api/src/market/market-owner.*` — a NEW
module in the Phase 7 market domain, continuing the pre-existing
`market-owner.types.ts` design from the interrupted prior dispatch) owns
EVERY `market.manage` control in-process; the Phase 7 surface
(`GET`/`PATCH /api/v1/admin/market-ops/markets/:marketId`) adds only the
read projection, the actor build and the error → HTTP mapping. The
existing member-facing `MarketService` / `MarketController`
(`members/me/market`) is byte-for-byte untouched.

| P7-S1 market contract / P7-AC item                                                                                   | Delivered                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `market.manage` SUPER_ADMIN-only, marketScoped, step-up required (P7-S1 D.2 row)                                     | Owner re-checks `rbac.isAllowed('market.manage')` in-process; the canonical RbacGuard enforces permission + market scope + step-up (`x-step-up-token`) as the first boundary. Non-SA → 403 `PERMISSION_DENIED`; no step-up → 403 `MFA_STEP_UP_REQUIRED` (integration-proven).                                                                                                                                                                 |
| Current Admin Market valid + command market == Current Admin Market (409 `MARKET_CONTEXT_MISMATCH`)                  | Owner requires the server-owned `currentMarketId` (RbacGuard `adminMarketContext`) and rejects any command market ≠ it; the guard also 409s URL/header mismatches. No-selection → 409 `MARKET_SELECTION_REQUIRED`.                                                                                                                                                                                                                            |
| Revoked grant denied                                                                                                 | Owner `assertMarketAccess` (non-revoked `market_access` + ACTIVE admin + ACTIVE market) → 403 `MARKET_ACCESS_DENIED`; revoked-grant test proves zero side effects (no row change, no claim, no audit).                                                                                                                                                                                                                                        |
| Controlled change surface: status ACTIVE ↔ INACTIVE, name/currencyCode/timezone/defaultLocale with format validation | Field allowlist in the owner + strict transport DTO (`.strict()`, unknown fields rejected). Currency `^[A-Z]{3}$`, name trim 1..200, IANA timezone via `Intl.DateTimeFormat`, BCP-47-style locale. No batch, no cross-market replication, no silent defaults.                                                                                                                                                                                 |
| Deactivation: explicit confirmation + dependency validation                                                          | `deactivationConfirmed` mandatory for ACTIVE → INACTIVE (400 `MARKET_DEACTIVATION_CONFIRMATION_REQUIRED`); dependency gate blocks while ACTIVE merchant branches, members with an enabled preference, or active/future configuration references (reward rule versions, commission rate versions by market code, active redemption rate rules) exist → 409 `MARKET_DEACTIVATION_DEPENDENCY` (all three dependency classes integration-proven). |
| Mandatory reason (trim, ≤500) + mandatory Idempotency-Key + canonical payload hash (replay / 409 conflict)           | Owner enforces reason and key (400); operation-scoped idempotency claim (`merchant_api_idempotency_keys`, scope `market.owner.update:<marketId>:<adminUserId>`) with the sorted-keys sha256 payload hash computed from the REQUEST (replay is deterministic even after the row changed). Same key + same payload → exact replay 200; same key + different payload → 409 `MARKET_IDEMPOTENCY_CONFLICT`.                                        |
| Atomic immutable audit (row + idempotency + audit in one transaction)                                                | The advisory-locked transaction updates the market row, claims the idempotency key and appends the privileged audit (`market.owner.update` with actor/market/reason/before/after/requestId/ipAddress) — any failure rolls everything back (injected-audit-failure test: 500 `MARKET_UPDATE_FAILED`, row unchanged, no claim, no audit).                                                                                                       |
| `market.read` ALL roles marketScoped (read projection)                                                               | `GET` returns the registry projection (id, code, name, status, currency, timezone, locale, timestamps, `configured`); non-ACTIVE markets are explicitly blocked (`configured: false`, no fallback) — over HTTP the guard 403s first.                                                                                                                                                                                                          |
| P7-AC-11 (configuration creates prospective versions only; invalid/degenerate input loses safely)                    | Every write is a controlled update validated by the owner; no partial writes survive (atomic tx); invalid fields/conflicts/concurrency all fail closed with documented codes.                                                                                                                                                                                                                                                                 |
| P7-AC-12 (historical snapshots unchanged after configuration changes)                                                | No market history is rewritten: `created_at` never changes, audit rows are append-only, no delete route exists (DELETE → 404 proven), no reward/commission/ledger domain touched.                                                                                                                                                                                                                                                             |

## 2. Changed files (exact paths)

```
apps/api/src/market/market-owner.types.ts            (kept + completed — actor/fields/command/response/error codes/MarketDetailResponse)
apps/api/src/market/market-owner.errors.ts           (new — one factory per MarketOwnerErrorCode)
apps/api/src/market/market-owner.dto.ts              (new — strict update schema, transport fast-fail)
apps/api/src/market/market-owner.service.ts          (new — secured owner + read projection + helpers)
apps/api/src/market/market-owner.controller.ts       (new — GET/PATCH surface, actor build, error → HTTP mapping)
apps/api/src/market/market-owner.module.ts           (new — module wiring)
apps/api/src/market/market-owner.spec.ts             (new — 20 unit tests)
apps/api/src/market/market-owner.integration.spec.ts (new — 26 HTTP tests on a fresh real-PG DB)
apps/api/src/app.module.ts                           (register MarketOwnerModule)
packages/api-client/src/index.ts                     (append-only — AdminMarketOpsApiClient + types)
packages/api-client/src/index.test.ts                (+3 client tests)
apps/admin-web/src/admin-api.ts                      (adminMarketOpsApi client)
apps/admin-web/src/route-manifest.ts                 (market route: market.read, no gate)
apps/admin-web/src/route-manifest.test.ts            (market route assertions; 33 → 34 routes)
apps/admin-web/src/admin-app.tsx                     (market route case)
apps/admin-web/src/market-config-model.ts            (new — pure presentation model)
apps/admin-web/src/market-config-model.test.ts       (new — 6 model tests)
apps/admin-web/src/market-config-page.tsx            (new — configuration form page)
apps/admin-web/src/market-config-page.test.tsx       (new — 8 page tests incl. axe a11y)
apps/admin-web/src/market-config-states.tsx          (new — design-system state components)
apps/admin-web/src/test/market-config-fixtures.ts    (new — page-test fixtures)
apps/admin-web/src/test/market-config-mock.ts        (new — adapter surface mock)
docs/06-phase-reports/p7-s6/P7-S6E_DELIVERY_REPORT.md (this report)
```

Not modified: `apps/api/src/market/market.service.ts` / `market.controller.ts`
/ `market.dto.ts` / `market.errors.ts` / `market.types.ts` /
`market.module.ts` (member-facing, untouched); `packages/database/**`
(migrations, schema, seeds, permission catalog — checksums unchanged);
`apps/api/src/domain/commission/**`, `apps/api/src/reward/**`,
`apps/api/src/redemption/**`, `apps/api/src/admin-*-ops/**`; any other
frozen domain.

## 3. Permission changes

**None.** Both `market.manage` (SUPER_ADMIN, marketScoped, stepUpRequired)
and `market.read` (ALL roles, marketScoped) already exist in the canonical
permission catalog (`packages/database/src/permission-catalog.ts`), and
the foundation seed derives from the catalog directly — so no catalog, no
seed, no migration change was needed and the migration checksum is
unchanged (33/33).

## 4. Commits (this worktree, not pushed)

```
9234cd54 feat(market): secured market owner for admin market configuration (P7-S6E)
dbf2aeb8 test(market): add P7-S6E secured owner unit + HTTP integration suites
cf6f42ec feat(api-client): add AdminMarketOpsApiClient (P7-S6E)
6f027a94 feat(admin-web): add market configuration page (P7-S6E)
91afc266 docs(market): record P7-S6E delivery report
```

## 5. Contract notes and design decisions

1. **Idempotency-before-state**: the payload hash is computed from the
   REQUEST (normalized requested fields + market + reason), and the
   idempotency claim is decided FIRST inside the locked transaction —
   before any current-state comparison — so a same-key/same-payload
   replay returns the stored result even when the row already reflects
   the payload (the initial implementation mis-fired as
   `MARKET_NO_CHANGES`; fixed and covered by the replay + concurrent
   tests).
2. **Deactivation is one-way on this surface**: the canonical guard (and
   the owner's `assertMarketAccess`) require an ACTIVE market, so after
   deactivation the market reads blocked (403 over HTTP,
   `configured: false` in-process) and cannot be re-activated through
   this surface — the documented P7-S1 guard semantics.
3. **Deactivation dependency set**: ACTIVE merchant branches, members
   with an enabled market preference, and active/future configuration
   references (reward rule versions, commission rate versions by market
   code, active redemption rate rules). Admin `market_access` grants are
   deliberately NOT a dependency: the acting admin's own grant is active
   by definition (the guard requires it) and grant lifecycle belongs to
   `rbac.market.grant` — treating grants as a dependency would make
   deactivation unreachable. Documented in the owner doc comment.
4. **HTTP status mapping** (controller): 403 permission/access/step-up
   (guard) — owner codes 403 `MARKET_PERMISSION_DENIED` /
   `MARKET_ACCESS_DENIED`; 404 `MARKET_NOT_FOUND`; 409 selection/context/
   idempotency-conflict/deactivation-dependency; 400 reason/key/no-
   changes/invalid-field/confirmation-required; 500 update-failed and
   unknown errors (never swallowed into a 2xx).
5. **Reason DTO interplay**: the strict DTO rejects a missing/blank/
   overlong reason with 400 `VALIDATION_ERROR` before the owner (which
   re-enforces the same rule in-process — unit-proven); a missing
   Idempotency-Key is rejected at the controller with 400
   `MARKET_IDEMPOTENCY_KEY_REQUIRED` (header, not body).
6. **Step-up in tests**: PATCH requires a fresh `x-step-up-token` grant
   for the `market.manage` action class bound to the market (canonical
   `admin_step_up_grants`); each test seeds its own grant.

## 5. Test evidence (all executed in this worktree, real PostgreSQL `172.23.0.3`)

| Gate                                                                        | Command                                                         | Result                                                                                                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Migration checksum                                                          | `pnpm --filter @ipoint/database db:checksum`                    | 33/33                                                                                                                               |
| **S6E unit** (owner + member-facing market unit)                            | `market-owner.spec.ts` + `market.service.spec.ts`               | 20 + 1 = **21/21**                                                                                                                  |
| **S6E integration** (fresh DB `ipoint_gate_s6e`)                            | `market-owner.integration.spec.ts`                              | **26/26**                                                                                                                           |
| Member-facing market regression (pre-bootstrapped `ipoint_gate_s6e_market`) | `market.http.integration.spec.ts`                               | pass                                                                                                                                |
| S6D regression                                                              | `admin-commission-ops` spec + integration                       | **41/41**                                                                                                                           |
| S6A rewire regression                                                       | `admin-package-ops` spec + integration                          | **54/54** (14 unit + 40 integ)                                                                                                      |
| S6B regression                                                              | `admin-reward-ops` spec + integration                           | **38/38**                                                                                                                           |
| S6C regression                                                              | `admin-redemption-ops` spec + integration                       | **49/49**                                                                                                                           |
| D-051 owner regression                                                      | `d051-special-percentage.owner.integration.spec.ts`             | **27/27**                                                                                                                           |
| O-13 new suite regression                                                   | `reward.service.spec.ts` + `reward-o13-route.spec.ts`           | **33 + 4 = 37/37**                                                                                                                  |
| `@ipoint/api-client` typecheck / test / build                               | `pnpm --filter @ipoint/api-client typecheck` / `test` / `build` | 0 / **75/75** / 0                                                                                                                   |
| `@ipoint/admin-web` typecheck / test / build                                | `pnpm --filter @ipoint/admin-web typecheck` / `test` / `build`  | 0 / **250/250** / 0                                                                                                                 |
| `@ipoint/api` typecheck / build                                             | `pnpm --filter @ipoint/api typecheck` / `build`                 | 0 / 0                                                                                                                               |
| OpenAPI (after build)                                                       | `pnpm --filter @ipoint/api openapi:validate`                    | PASS — **239 paths** (238 → +1 path `/admin/market-ops/markets/{marketId}` with GET + PATCH) / 0 missing / 0 duplicate operationIds |
| prettier / eslint (changed files)                                           | `prettier --check` / `eslint`                                   | clean / 0 errors                                                                                                                    |

S6E integration coverage (owner evidence suite): non-SA 403; no step-up
403 `MFA_STEP_UP_REQUIRED`; revoked grant 403 with zero side effects; no
selection 409; command ≠ current market 409 (guard + in-process owner
re-check); cross-market isolation (updates never leak); missing/blank/
overlong reason 400; missing key 400; invalid IANA timezone 400
`MARKET_INVALID_FIELD` (owner-level); invalid currency/locale/name 400
(transport); no-controlled-fields 400; successful controlled update 200
with `changed` diff + single audit (actor/market/reason captured);
idempotency replay (identical body, one claim row, one audit);
same-key/different-payload 409 with no extra audit; concurrent same-key
race → both 200 identical (advisory lock, deterministic winner, one row +
one audit); atomic audit injection → 500 `MARKET_UPDATE_FAILED` with full
rollback (row/claim/audit untouched); deactivation missing confirmation
400; deactivation dependency 409 for merchant branch / member preference /
configuration reference; deactivation success 200 then blocked (403
guard, `configured: false`, owner denies re-management); immutability
(`created_at` never rewritten, audit append-only, DELETE 404).

Behavior pinned: concurrent unique result (exactly one commit, replay for
the loser); history immutable (no delete/rewrite paths).

## 6. Assumptions and risks

- **Assumption**: the deactivation dependency set (merchant/member/
  configuration references; grants excluded) is the intended reading of
  "检查依赖该 market 的活跃资源" — documented in the owner and this
  report for the review.
- **Assumption**: 239 OpenAPI paths (one new path, two operations) is the
  expected delta from 238.
- **Risk**: `openapi:validate` does not self-exit after PASS (pre-existing
  outbox-worker quirk, same as S4/S5/S6A/S6B/S6C/D-050/D-051/D-054/S6D).
- Browser E2E remains host/CI-only (sandbox cannot launch Chromium); the
  Admin Web market flow is covered by mock-based component specs (part of
  250/250) — NOT claimed as browser-passed.

## 7. Confirmation

- Member-facing market behavior untouched (no edits to
  `market.service.ts` / `market.controller.ts` / `market.dto.ts` /
  `market.errors.ts` / `market.types.ts` / `market.module.ts`).
- No migration, no seed change, no permission-catalog change;
  `packages/database` checksums unchanged.
- No frozen domain touched (commission / reward / redemption / ledger /
  package / merchant / member owners).
- The owner performs the single controlled `markets` UPDATE plus the
  idempotency claim and the privileged audit in ONE advisory-locked
  transaction; no other write paths exist.
- Worktree carries only the intended source changes + this report; not
  pushed, not merged; the independent review + separate verification +
  the OpenClaw internal gate record are OpenClaw's next steps.

_Forward-only record. Do not delete or rewrite._
