# P7-S5C Internal Delivery Report — Admin KYC Review + Privacy/Evidence

| Status          | Value                                |
| --------------- | ------------------------------------ |
| Delivery        | `DELIVERY_COMPLETE`                  |
| Internal gate   | `OPENCLAW_INTERNAL_GATE_PASSED`      |
| Phase authority | `CONTINUING_UNDER_D-047` via `D-048` |
| Executor class  | `OPENCLAW_MANAGED_CODING_SUBAGENT`   |
| Task ID         | `P7-S5C`                             |

## 1. Scope delivered

P7-S5C delivered the safe **selected-market KYC review + privacy/evidence**
surface (frozen contract §6.4) on top of the frozen Phase 2 member KYC owner
(`AdminKycService`) and the frozen Phase 1 merchant KYC owner
(`MerchantService`):

- **Member KYC queue + case detail** — server-scoped to the Current Admin
  Market via the canonical P7-S2 machinery (`RbacGuard` +
  `RequirePermission`, market-scoped); deterministic paged queue; masked
  summaries by default (identity/contact masked for every role; document
  rows are metadata only — no content, object key, or filename anywhere).
- **Merchant KYC submissions queue + submission detail** — server-scoped;
  masked summaries using the owner's own masking helper
  (`maskMerchantKycSnapshot`) verbatim.
- **Review actions (member)** — start-review / request-more-info / approve /
  reject / require-reverification delegated **untouched** to the frozen
  `AdminKycService` commands (owner state machine, idempotency, write-audit).
- **Review decision (merchant)** — approve / reject / resubmission with
  rejected fields delegated **untouched** to the frozen Phase 1
  `MerchantService.reviewKyc`.
- **Evidence rules (§6.4)** — raw (minimum) evidence is served ONLY through
  dedicated `/evidence` endpoints behind the canonical
  `member.kyc.evidence.view` / `merchant.kyc.evidence.view` permissions
  (catalog: market-scoped, step-up MFA required, sensitive reason required)
  plus an **audit-of-view record for every detail and every evidence view**;
  Support-role reads never receive raw identity/contact or document content;
  no raw KYC export exists anywhere on the surface.
- **Admin Web UI** — `/admin/:marketId/kyc/members` and
  `/admin/:marketId/kyc/merchants` queues plus case-detail surfaces
  (masked summaries; evidence panel gated by permission + recorded reason +
  MFA step-up + audit confirmation), with all required loading / empty /
  error / permission-denied / conflict / offline / disabled states,
  responsive 320px+ and keyboard + axe-verified accessibility (jsdom).
- **Typed client** — self-contained append-only P7-S5C section in
  `packages/api-client` (DTOs + `AdminKycOpsApiClient`).
- **Browser verification spec** — ready-to-run mock-based Playwright spec
  (`kyc.e2e.spec.ts`, the S5B pattern); unexecuted in this sandbox (browser
  limitation, §9).

No frozen Phase 1/2 owner code was modified; no migrations/schema changes;
no direct domain-table writes in production code; nothing pushed.

## 2. Branch and worktree map

| Worktree    | Branch                    | Starting SHA                               | Delivered commits |
| ----------- | ------------------------- | ------------------------------------------ | ----------------: |
| `wt-p7-s5c` | `task/p7-s5c-kyc-privacy` | `8777b20b03412b706ee19755afe74dabceef4f14` |                 6 |

No push was performed; OpenClaw reviews and pushes.

## 3. Commit map (full SHAs)

1. `1343fe802d4c0efb09f9f26c1aaaec2a70617099` — `feat(admin): add selected-market kyc review and evidence controls` (code + tests; 30 files, +7781/−5)
2. `1098cb9f86329bed259491f6df06da944a6a249d` — `test(admin): add mock-based kyc review browser verification spec` (ready-to-run Playwright spec, unexecuted in sandbox)
3. `aee62f916903e1ff0a2f1198f225dfcb37567576` — `docs(p7-s5c): record internal delivery report` (this report)
4. `7d45302c79b75cdab216dc19e4b93a4465f35219` — `fix(p7-s5c): commit and verify denied-access audit filter` (defect fix: filter + unit/integration tests, see §2a)
5. `9845f2e74083785f4be4ea2811c007947dd8dcb4` — `docs(p7-s5c): record denied-audit filter fix` (this §2a update)
6. `5cc13ece68d6943842727fc4bd75fb7ebb9e635c` — `test(admin-api): extend vitest hook timeout for db-heavy suites` (hook-timeout resolution, §2b)

## 2a. Defect fix (P7-S5C-FIX) — denied-access audit filter

**Defect**: commit `1343fe80` referenced a module that was NOT in the commit
tree — `admin-kyc-ops.controller.ts` imports
`./admin-kyc-ops.denied.filter.js` and applies
`@UseFilters(AdminKycDeniedAuditFilter)`, but `git ls-tree 1343fe80
apps/api/src/admin-kyc-ops/` showed no `admin-kyc-ops.denied.filter.ts`; the
file existed only as an untracked worktree artifact. A clean checkout of the
branch therefore failed typecheck/build (missing module), while the worktree
passed only because the untracked file was present.

**Fix**: the filter file was reviewed, covered with tests, and committed
(commit 4 above). `git ls-tree HEAD apps/api/src/admin-kyc-ops/` now includes
`admin-kyc-ops.denied.filter.ts`, and `git grep -n "denied.filter" HEAD --
apps/api/src/admin-kyc-ops/` resolves within HEAD.

**Review findings (executor review, no code change required)**:

- `AuditService.recordPrivilegedAction` call shape matches the actual
  `PrivilegedAuditInput` signature exactly (`actor`, `action`, `entity`,
  `marketId`, `result: 'DENIED'`, `reason`, `requestId`, `ipAddress`,
  `summary`); `result: 'DENIED'` is a legal enum value.
- Actor extraction matches `RequestActor` (`type: 'ADMIN_USER'` +
  `adminUserId`, set by `AuthGuard`); non-admin actors are skipped.
- Error serialization is parity with the global `AllExceptionsFilter`
  (`{ error: { code, message, details? }, requestId, timestamp }`); the
  only divergence (array-message → `Validation failed`) cannot occur here
  because this adapter's Zod pipe throws `BadRequestException`, which this
  filter does not catch.
- Route-pattern mapping produces the same action codes the adapter uses for
  SUCCESS audit-of-view (`member/merchant.kyc.ops.queue.view/.view/
.evidence.view`; decide actions → `.decide`). Intentional divergence,
  documented: DENIED merchant rows use the `merchant_branch` entity (branch
  id from the URL — no DB lookup at denial time) while SUCCESS rows use
  `merchant_kyc_submission`; `merchant_branch` is a first-class audit entity
  type (`AuditService.queryEntity`). Market id is captured when the guard
  has resolved it (reason/step-up/mismatch denials); permission/market-level
  denials occur pre-market-resolution and carry the entity context instead.
- Fail-open confirmed: audit-append failure logs and still returns the
  denial (fail-open for observability, fail-closed for access).

**Test coverage added** (filter previously had zero tests):

- New unit spec `admin-kyc-ops.denied.filter.spec.ts` (11 tests): denied
  evidence view → 403 `PERMISSION_DENIED` audited with
  `member.kyc.ops.evidence.view`; 422 `SENSITIVE_VIEW_REASON_REQUIRED`
  audited; `MARKET_ACCESS_DENIED` audited; review-action denial →
  `member.kyc.ops.decide`; merchant evidence → `merchant.kyc.ops.evidence.view`
  on the branch entity; merchant queue denial → `merchant.kyc.ops.queue.view`;
  URL-path fallback when `request.route` is absent; non-denial conflicts
  (e.g. `ADMIN_KYC_INVALID_STATE`) serialized but NOT audited; non-admin
  actor not audited; fail-open on audit-append failure; unexpected errors
  serialized as `INTERNAL_ERROR` without audit.
- Real-DB integration additions (4 tests in `admin-kyc-ops.integration.spec.ts`):
  denied review action audited with `member.kyc.ops.decide` (+ exact row
  assertions); `MARKET_ACCESS_DENIED` denial audited; non-denial responses
  (404 unknown case, 409 invalid state) NOT audited (before/after counts +
  standard error contract); fail-open — audit service rejection still
  returns 403 `PERMISSION_DENIED` with the error contract.

**Suite result**: 54 → **69 passed** (33 unit: 22 pre-existing + 11 new;
36 real-DB integration: 32 pre-existing + 4 new) on a freshly recreated
`ipoint_p7s5c_test`; typecheck, build, prettier, and eslint all clean.

## 4. Reuse-vs-adapter decision (task 4.1) — evidence

**Decision: a Phase 7 adapter layer was required and created**
(`apps/api/src/admin-kyc-ops/**`). The frozen Phase 2 member KYC endpoints
and the frozen Phase 1 merchant KYC endpoints were NOT modified.

Evidence from inspection of the frozen surfaces (read-only):

| Capability                   | Owner surface exists?                                                                                     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Member KYC queue             | `GET /admin/kyc/cases` (`member.kyc.read`)                                                                | Owner list accepts the market filter from the **client query** (`marketId`); the P7-S2 `RbacGuard.assertMarketConsistency` never inspects query parameters, and the owner list only requires a grant on the case market — never equality with the server-owned Current Admin Market. **Adapter forces `marketId = server market`** and makes a client market param structurally impossible (`.omit({ marketId: true })` → 400). |
| Member KYC case detail       | `GET /admin/kyc/cases/:id` (`member.kyc.read`)                                                            | Owner asserts only a market grant; returns **unmasked** `legalFullName` / `dateOfBirth` / `residentialAddress` to every reader incl. Support. §6.4 requires Support-role masked identity/contact summaries. **Adapter enforces market equality and masks identity/contact fields on the plain detail; raw evidence is served only via the dedicated evidence endpoint.**                                                        |
| Member KYC actions (5)       | `POST .../start-review\|request-more-info\|approve\|reject\|require-reverification` (`member.kyc.decide`) | Owner commands reused **unchanged** (state machine, idempotency, atomic audit). Adapter only pre-validates selected-market equality then delegates the exact DTO + Idempotency-Key.                                                                                                                                                                                                                                             |
| Merchant KYC queue           | `GET /admin/markets/:marketId/merchants/kyc` (`merchant.kyc.view`, marketScoped)                          | Owner route already market-scoped; the adapter still provides the server-market queue (`listKycQueue`) so the UI never sends a market id and the response carries the server market envelope.                                                                                                                                                                                                                                   |
| Merchant KYC evidence/detail | `GET .../merchants/:branchId/kyc/review` (`merchant.kyc.approve`)                                         | Owner `getKycForReview` returns the FULL snapshot and has a review-start side effect — wrong for Support reads. The adapter's masked detail is a **read-only projection** over immutable owner rows applying the owner's exported `maskMerchantKycSnapshot` verbatim (S5B precedent: read-only projections); full evidence is delegated to `getKycForReview` behind `merchant.kyc.evidence.view`.                               |
| Merchant KYC review decision | `POST .../merchants/:branchId/kyc/review` (`merchant.kyc.approve`)                                        | Owner `reviewKyc` reused **unchanged** (decision + rejected fields, idempotency, atomic audit + operational-status evaluation).                                                                                                                                                                                                                                                                                                 |

Owner-reuse evidence: `git diff` against HEAD shows **zero changes** under
`apps/api/src/admin-kyc/`, `apps/api/src/kyc/`, `apps/api/src/admin-member/`,
`apps/api/src/merchant/`, or `packages/database/` (verified before commit;
see §12). The real-DB integration suite additionally proves owner behaviour
is preserved end-to-end through the adapter (owner history rows, owner audit
rows, member KYC level bump on approve, idempotency replay, owner
state-machine conflicts).

## 5. API delivery (`apps/api/src/admin-kyc-ops/**`, new)

All routes are market-scoped: the RbacGuard resolves the server-owned Current
Admin Market and rejects client disagreement (409 `MARKET_CONTEXT_MISMATCH`);
the adapter re-validates case/submission market equality before any owner
delegation.

| Path                                                       | Method | Permission (canonical)                                              | Behaviour                                                                                         |
| ---------------------------------------------------------- | ------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `/api/v1/admin/kyc-ops/members`                            | GET    | `member.kyc.read`                                                   | Selected-market paged queue (masked summaries); owner list forced to server market                |
| `/api/v1/admin/kyc-ops/members/:id`                        | GET    | `member.kyc.read`                                                   | Masked case detail (identity/contact masked for every role) + audit-of-view `member.kyc.ops.view` |
| `/api/v1/admin/kyc-ops/members/:id/evidence`               | GET    | `member.kyc.evidence.view` (step-up + reason enforced by the guard) | Full minimum evidence (owner response verbatim) + audit-of-view `member.kyc.ops.evidence.view`    |
| `/api/v1/admin/kyc-ops/members/:id/start-review`           | POST   | `member.kyc.decide`                                                 | Owner command untouched (Idempotency-Key required)                                                |
| `/api/v1/admin/kyc-ops/members/:id/request-more-info`      | POST   | `member.kyc.decide`                                                 | Owner command untouched                                                                           |
| `/api/v1/admin/kyc-ops/members/:id/approve`                | POST   | `member.kyc.decide`                                                 | Owner command untouched                                                                           |
| `/api/v1/admin/kyc-ops/members/:id/reject`                 | POST   | `member.kyc.decide`                                                 | Owner command untouched                                                                           |
| `/api/v1/admin/kyc-ops/members/:id/require-reverification` | POST   | `member.kyc.decide`                                                 | Owner command untouched                                                                           |
| `/api/v1/admin/kyc-ops/merchants`                          | GET    | `merchant.kyc.view`                                                 | Selected-market submissions queue (masked; owner `listKycQueue`)                                  |
| `/api/v1/admin/kyc-ops/merchants/:branchId`                | GET    | `merchant.kyc.view`                                                 | Masked submission detail (owner mask helper) + audit-of-view `merchant.kyc.ops.view`              |
| `/api/v1/admin/kyc-ops/merchants/:branchId/evidence`       | GET    | `merchant.kyc.evidence.view` (step-up + reason)                     | Owner `getKycForReview` verbatim + audit-of-view `merchant.kyc.ops.evidence.view`                 |
| `/api/v1/admin/kyc-ops/merchants/:branchId/review`         | POST   | `merchant.kyc.approve`                                              | Owner `reviewKyc` untouched (decision/reason/rejected_fields + Idempotency-Key)                   |

Error contract: adapter market mismatch → 409 `MARKET_CONTEXT_MISMATCH`;
owner `AdminKycError` mapped exactly as the frozen owner controller maps it
(404 `ADMIN_KYC_CASE_NOT_FOUND`, 403 `ADMIN_KYC_SELF_REVIEW` /
`ADMIN_KYC_MARKET_ACCESS_DENIED`, 409 state/idempotency conflicts); owner
merchant HTTP exceptions propagate as-is; guard denials → 403
`PERMISSION_DENIED` / `MARKET_ACCESS_DENIED` / `MFA_STEP_UP_REQUIRED`, 409
`MARKET_SELECTION_REQUIRED`, 422 `SENSITIVE_VIEW_REASON_REQUIRED`.

Files: `admin-kyc-ops.module.ts`, `admin-kyc-ops.controller.ts`,
`admin-kyc-ops.service.ts`, `admin-kyc-ops.dto.ts`, `admin-kyc-ops.errors.ts`,
`admin-kyc-ops.types.ts`, `admin-kyc-ops.service.spec.ts`,
`admin-kyc-ops.integration.spec.ts`. Registration is the two-line addition
to `apps/api/src/app.module.ts` (import + module list), the same minimal
wiring P7-S4A/S5A used; the frozen `AdminKycModule` and `MerchantModule` are
imported as-is.

## 6. Evidence rules implementation (frozen contract §6.4)

- **Minimum evidence only**: `member.kyc.evidence.view` / `merchant.kyc.evidence.view` holders receive exactly the owner's review detail (identification numbers and emails remain owner-masked); no financial or unrelated data is exposed on the KYC surface.
- **Support sees masked summaries, no raw documents**: the plain detail endpoints mask `legalFullName`, `dateOfBirth`, and `residentialAddress` for **every** role; document rows are metadata only; merchant snapshots apply the owner's `maskMerchantKycSnapshot` verbatim. Raw content, object keys, and original filenames never appear (asserted in tests).
- **Super Admin has no automatic raw access**: raw evidence requires the dedicated permission even for Super Admin (catalog is not bypassed by role); the guard enforces step-up MFA + recorded reason on every evidence request.
- **Recorded reason**: `x-sensitive-access-reason` (8–500 chars) enforced by the canonical guard (422 `SENSITIVE_VIEW_REASON_REQUIRED`).
- **Audit of every view**: each masked detail view and each evidence view writes an immutable privileged audit record (`member.kyc.ops.view`, `member.kyc.ops.evidence.view`, `merchant.kyc.ops.view`, `merchant.kyc.ops.evidence.view`) through the canonical `AuditService` with the same entity type/id the owner uses for write-audit (correlates in the future Audit Viewer).
- **No raw export**: no download/export endpoint exists on the surface; `AdminKycOpsApiClient` has no export method; no `object_key`/`originalFilename`/raw content in any response (asserted).

## 7. UI delivery (`apps/admin-web/src/**`)

| Path                                       | Purpose                                                                                                                                                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kyc-model.ts`                             | pure presentation model: status labels/tones, review-action availability (status + permission + write environment), evidence-gate copy, hrefs, stable error copy                                                                          |
| `kyc-states.tsx`                           | queue skeleton, status badges, locked-evidence notice, unavailable-action affordance                                                                                                                                                      |
| `kyc-evidence-panel.tsx`                   | the only place raw evidence is requested: recorded reason prompt → server 403 triggers the MFA step-up challenge/verify flow → retry with fresh grant token; audit confirmation surfaced; never persists evidence beyond the current view |
| `kyc-member-queue-page.tsx`                | `/admin/:marketId/kyc/members` — status filter, paging, masked rows, loading/empty/error/denied/conflict states                                                                                                                           |
| `kyc-member-detail-page.tsx`               | case detail — masked identity summary, document metadata table, history, review actions (reason + idempotency), gated evidence panel                                                                                                      |
| `kyc-merchant-queue-page.tsx`              | `/admin/:marketId/kyc/merchants` — status filter, offset paging, masked rows                                                                                                                                                              |
| `kyc-merchant-detail-page.tsx`             | submission detail — masked snapshot, review decision metadata, review actions (incl. rejected fields for resubmission), gated evidence panel                                                                                              |
| `kyc.e2e.spec.ts`                          | ready-to-run mock-based Playwright verification (queues, masked detail, evidence reveal, denied state, 320px reflow + axe)                                                                                                                |
| `admin-app.tsx`                            | append-only route wiring: four new cases at the END of the route switch (`member-kyc`, `merchant-kyc`, `member-kyc-detail`, `merchant-kyc-detail`)                                                                                        |
| `route-manifest.ts`                        | two new append-only case-detail routes (`member-kyc-detail`, `merchant-kyc-detail`); route-count test updated 31 → 33                                                                                                                     |
| `admin-api.ts`                             | append-only `adminKycOpsApi` export                                                                                                                                                                                                       |
| `admin.css`                                | KYC styles on design tokens only (appended section)                                                                                                                                                                                       |
| `test/kyc-fixtures.ts`, `test/kyc-mock.ts` | shared fixtures + shell/kyc fetch mock (mutable case store, evidence gating simulation)                                                                                                                                                   |

Required UI states covered and tested: permission-denied (route-level and
evidence-level), conflict (market mismatch + state conflict), disabled (no
Current Admin Market), offline (environment gating via write environment),
loading, empty, error with retry, success with server-confirmed message,
evidence-locked, evidence step-up, and audit confirmation.

## 8. Typed client (`packages/api-client/src/index.ts`)

Self-contained append-only section at the END of the file:
`AdminKycOpsStatus`, `AdminKycOpsListQuery`, `AdminKycOpsMemberSummaryDto`,
`AdminKycOpsCaseListItemDto`, `AdminKycOpsListPageDto`,
`AdminKycOpsDocumentDto`, `AdminKycOpsHistoryEntryDto`,
`AdminKycOpsEvidenceAccessDto`, `AdminKycOpsCaseDetailDto`,
`AdminKycOpsEvidenceRequest`, `AdminKycOpsActionId`,
`AdminKycOpsActionRequest`, merchant queue/detail/review DTOs, plus the
`AdminKycOpsApiClient` class (`memberKycList`, `memberKycDetail`,
`memberKycEvidence`, `memberKycAction`, `merchantKycList`,
`merchantKycDetail`, `merchantKycEvidence`, `merchantKycReview`). No market
id is ever sent by the client; evidence requests carry
`x-sensitive-access-reason` and `x-step-up-token` headers; no raw export
method exists. Tests appended as a delimited block in
`packages/api-client/src/index.test.ts`.

## 9. Tests and verification (exact commands, inside worktree)

Environment: Linux sandbox; worktree `/workspace/.local/wt-p7-s5c` (root
`/workspace/node_modules` symlinks are broken, so everything ran inside the
worktree). Dedicated test database `ipoint_p7s5c_test` at `172.23.0.3:5432`
(dropped/recreated before each integration run — the suite asserts exact row
counts and requires a clean schema; procedure: recreate DB, then run once).

| Command                                                                                                                                           | Result                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @ipoint/api typecheck`                                                                                                             | PASS, exit 0                                                                                                                                                                                                                                                                                               |
| `pnpm --filter @ipoint/api build`                                                                                                                 | PASS, exit 0                                                                                                                                                                                                                                                                                               |
| `DATABASE_URL=postgres://ipoint:ipoint-local-only@172.23.0.3:5432/ipoint_p7s5c_test pnpm --filter @ipoint/api exec vitest run src/admin-kyc-ops/` | **69/69 passed** (33 unit + 36 real-DB integration on a freshly recreated DB), exit 0                                                                                                                                                                                                                      |
| Full api directory parallel run (fresh DB, full env, hook-timeout fix in place)                                                                   | **0 hook timeouts**; 8 files / 43 tests failed — all pre-existing drift or shared-DB parallel interference, none S5C (§2b); the S5C `admin-kyc-ops` suite passed in the final run                                                                                                                          |
| Pre-S5C baseline (`8777b20b`) full api directory parallel run (same env, same node_modules)                                                       | 18 hook timeouts; 22 files / 28 tests failed — proves the flake pre-exists S5C (§2b)                                                                                                                                                                                                                       |
| `pnpm --filter @ipoint/admin-web typecheck`                                                                                                       | PASS, exit 0                                                                                                                                                                                                                                                                                               |
| `pnpm --filter @ipoint/admin-web test`                                                                                                            | **147/147 passed** (19 files; 109 pre-existing + 38 new incl. axe), exit 0                                                                                                                                                                                                                                 |
| `pnpm --filter @ipoint/admin-web build`                                                                                                           | PASS (**1625 modules transformed**), exit 0                                                                                                                                                                                                                                                                |
| `pnpm --filter @ipoint/api-client typecheck`                                                                                                      | PASS, exit 0                                                                                                                                                                                                                                                                                               |
| `pnpm --filter @ipoint/api-client test`                                                                                                           | **49/49 passed** (41 pre-existing + 8 new), exit 0                                                                                                                                                                                                                                                         |
| `pnpm exec prettier --check` on all changed paths                                                                                                 | clean                                                                                                                                                                                                                                                                                                      |
| `pnpm exec eslint apps/api/src/admin-kyc-ops apps/api/src/app.module.ts`                                                                          | clean, exit 0                                                                                                                                                                                                                                                                                              |
| `pnpm exec eslint packages/api-client/src/index.ts packages/api-client/src/index.test.ts`                                                         | clean, exit 0                                                                                                                                                                                                                                                                                              |
| `pnpm exec eslint apps/admin-web/src/kyc-model.ts`                                                                                                | 0 errors (repo ignores `apps/admin-web/src/**` by design — same as P7-S4B/S5A)                                                                                                                                                                                                                             |
| `pnpm exec playwright test --config=apps/admin-web/playwright.admin.config.ts`                                                                    | **BLOCKED in sandbox**, exit 1: every spec (incl. 4 `kyc.e2e.spec.ts` cases) failed at `browserType.launch` — `Host system is missing dependencies to run browsers` (`playwright install-deps` / `apt-get install libx11-6 libxext6 libxcb1`). Not claimed as passed; spec is mock-based and host/CI-ready |
| axe (component-level, jsdom)                                                                                                                      | zero serious/critical on loaded member/merchant KYC queue + detail paths                                                                                                                                                                                                                                   |

Coverage delivered (mapped to P7-S0 §6.4 / P7-AC-10): market isolation
server-side (queue + detail + actions across two markets with two grants);
permission denial (401/403/guard + crafted-request negatives); **raw-evidence
gating** (no permission → 403; no recorded reason → 422; no step-up → 403;
grant consumed exactly once; full evidence only with permission + reason +
step-up); **audit-of-view rows asserted in the DB** for masked detail and
evidence views (member + merchant); masked-summary behaviour for
Support-role surfaces (identity/contact masked, no raw documents, no
object_key/originalFilename in any response); review-action flows
(start-review → request-more-info / approve / reject; approve bumps member
KYC level; require-reverification from APPROVED only; invalid transition
409; cross-market action blocked with no state change; idempotency replay
single-effect); merchant review decision (+ idempotency, + rejected fields
rule); required UI states; responsive/a11y (axe zero serious/critical via
jsdom).

### Browser limitation (exact, unchanged from P7-S4B/S5A)

Browsers cannot launch in this sandbox (Chromium was registered previously
but the image lacks browser runtime libraries — `libglib-2.0`, `libnss3`,
`libX11`, `libxcb` missing under `/usr/lib` — and apt package lists are on a
read-only filesystem). Accessibility of the covered paths is therefore
verified with jsdom `axe-core` runs in the kyc page tests (zero
serious/critical). The delivered `kyc.e2e.spec.ts` (Playwright, mock-based,
matching `playwright.admin.config.ts` `**/*.e2e.spec.ts`) was **not
executed** here; no browser run is claimed as passed.

## 10. Risks and limitations

- **Upstream P7-S2C step-up action-class constraint (frozen, outside allowed
  paths)**: the frozen `/auth/admin/mfa/step-up/challenge` schema accepts
  only `^[A-Z0-9_:.]+$` action classes, while the RbacGuard consumes grants
  whose `action_class` equals the **lowercase** catalog permission code. A
  real-flow grant can therefore never satisfy the guard for catalog
  permissions — the guard fails closed (403 `MFA_STEP_UP_REQUIRED`), which is
  the safe direction. The integration suite seeds a valid grant row directly
  to exercise the canonical guard + adapter evidence path end-to-end, and
  pins the frozen constraint with an explicit test. Remediating the
  action-class mismatch belongs to the P7-S2 owner (frozen code). The UI
  evidence flow implements the full challenge/verify UX and surfaces the 403
  correctly; the grant-seeding remediation is server-side only.
- **Unowned artifact found in the worktree (resolved by P7-S5C-FIX)**: commit
  `1343fe80` referenced `admin-kyc-ops.denied.filter.ts` (via `@UseFilters`
  in the controller) without the file being in the commit tree; the file
  existed only as an untracked worktree artifact, so a clean checkout failed
  typecheck/build. The P7-S5C-FIX subagent reviewed the filter (correct:
  audit shape, actor extraction, serialization parity, route mapping),
  added unit + real-DB integration coverage (11 + 4 tests), and committed it
  (`7d45302c`). See §2a.
- The `kyc.e2e.spec.ts` (Playwright) is delivered ready-to-run but
  unexecuted in this sandbox; it follows the accepted S5B
  `merchant.e2e.spec.ts` pattern.
- The integration suite requires a freshly recreated dedicated database
  (exact-count assertions); the recreate-then-run procedure is in §9.
- Root e2e (`playwright.admin.config.ts`) remains out of allowed paths;
  browser execution requires the host/CI (pre-existing limitation,
  unchanged).
- `jiti/` tooling cache left untracked (same pattern as P7-S4A/S4B/S5A).

## 2b. Hook-timeout investigation (open test-infra issue — resolved)

**Symptom**: the full api test directory run in parallel (`pnpm --filter
@ipoint/api exec vitest run`, all 83 files) was flaky: 15–24 suites failed
with `Error: Hook timed out in 10000ms.` in their `beforeAll` (Nest
`AppModule` compile + `migrate` + `seedFoundation` on the shared Postgres
plus `vi.stubEnv`). The two KYC spec files passed alone but the combined
parallel run exceeded vitest's default 10s hook budget.

**Root cause — pre-existing, not introduced by S5C**: reproduced on the
pre-S5C baseline (`8777b20b`, via a detached worktree with the same
node_modules): the baseline full-directory parallel run produced **18 hook
timeouts** and 22 failed files / 28 failed tests. The DB-heavy Nest
integration suites (admin-dashboard, auth, kyc, merchant, redemption,
transaction, and the P7-S5A/S5B/S5C ops suites) all boot a full `AppModule`
and run migrations in `beforeAll`; under parallel load that legitimately
outlasts the 10s default. S5C only adds one more heavy suite to the same
pool — it is a victim of the pre-existing condition, not its cause.

**Fix (sanctioned, not a requirements reduction)**: raised `hookTimeout` to
`60_000` in `apps/api/vitest.config.ts` (commit 6, `5cc13ece`). A timeout
increase changes no assertion, skips no test, and lowers no coverage — it
only gives the legitimately long DB-heavy hooks their full budget. The
change is 8 lines, documented in the config itself.

**Post-fix verification (fresh DB per the clean-DB rule)**:

| Run                                                  | Result                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Full api directory, pre-fix (S5C HEAD, env complete) | 15 hook timeouts; 20 files / 13 tests failed                                            |
| Full api directory, post-fix run 1                   | **0 hook timeouts**; 10 files / 47 tests failed (all suites now run to completion)      |
| Full api directory, post-fix run 2                   | **0 hook timeouts**; 8 files / 43 tests failed                                          |
| Full api directory, post-fix final (HEAD `5cc13ece`) | **0 hook timeouts**; 8 files / 43 tests failed; S5C `admin-kyc-ops` suite itself passed |

**What the remaining failures are (all pre-existing, none S5C)**: with the
hook budget fixed, the suites that previously timed out now run to
completion and expose (a) pre-existing test/implementation drift — e.g.
`auth.integration.spec.ts` expects `AUTH_REFRESH_REUSED` but the auth
service (changed in P7-S2A `b9384e95`) throws `SESSION_REUSE_DETECTED`; the
auth failure reproduces identically when the suite runs ALONE; (b) env-
dependent suites that require `REDIS_URL`/`AUTH_OTP_PEPPER` exported (e.g.
redemption/transaction suites — they fail standalone too without those
vars, so the command must export them, which the scoped runs do); and (c)
shared-DB parallel interference — every integration suite runs against the
same `ipoint_p7s5c_test` database, and the market fixtures (MA/MB) and
fixed requestIds collide across concurrently-running suites (e.g.
`admin-kyc-ops` "lists only the selected market" expects exactly 3 rows and
occasionally sees other suites' rows; the identical assertion in the
S5A/S5B suites flakes the same way in the same parallel run). The same
failure classes appear on the pre-S5C baseline run, so none of them is a
P7-S5C regression. The authoritative S5C verification remains the scoped
fresh-DB run (§9): 69/69.

## 11. Git state

- Worktree: `/workspace/.local/wt-p7-s5c` (branch `task/p7-s5c-kyc-privacy`).
- Starting SHA: `8777b20b03412b706ee19755afe74dabceef4f14`.
- Commits: 6 (code+tests, browser spec, delivery report, P7-S5C-FIX
  filter+tests, report update, hook-timeout fix). No amend, no rebase, no
  reset, no force, NO PUSH.
- Exact-path staging only; the 102 historical untracked artifacts in the
  main checkout were untouched; `jiti/` remains untracked (same pattern as
  P7-S4A/S4B/S5A). `apps/api/vitest.config.ts` carries the committed
  hook-timeout tuning (`hookTimeout: 60_000`, commit `5cc13ece`) for the
  DB-heavy integration suites — see §2b.

## 12. Internal gate result

`OPENCLAW_INTERNAL_GATE_PASSED` — API adapter unit + real-DB integration
69/69 on a clean dedicated DB (54 pre-existing + 15 added by P7-S5C-FIX:
11 filter unit + 4 denied-audit integration), Admin Web 147/147 + build 1625
modules, API client 49/49, all typechecks, prettier, and eslint (API +
client) green; axe zero serious/critical on covered paths; frozen Phase 1/2
owner code byte-identical (`git diff` shows zero changes under `admin-kyc/`,
`kyc/`, `admin-member/`, `merchant/`, `packages/database/`); raw evidence
gating (permission + reason + step-up + audit-of-view) proven server-side;
denied-sensitive-access audit (P7-S5C-FIX) committed and tracked in HEAD;
the open test-infra flake (vitest 10s hook timeout on the full parallel api
directory run) is resolved and committed (`hookTimeout: 60_000`, §2b) — the
flake was proven pre-existing on the pre-S5C baseline, and the remaining
full-directory failures are pre-existing drift / shared-DB parallel
interference, none S5C (authoritative S5C evidence is the scoped fresh-DB
run above); commits scoped exactly; nothing pushed.
