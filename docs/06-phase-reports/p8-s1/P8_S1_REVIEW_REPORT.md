# P8-S1 Independent Review Report - Ads & Content Operations

## 1. Review identity and verdict

- Reviewer: `CODEX_CLI` / Session B / Independent Reviewer
- Review branch: `review/p8-s1-b`
- Reviewed range: `c5097c1d..b7cf5e8b`
- Implementer branch/head: `task/p8-s1-ads-content` at `b7cf5e8b`
- Diff reviewed: 36 files, 4,854 insertions, 25 deletions
- Verdict: **CHANGES REQUIRED**
- Finding count: **0 Critical / 2 High / 5 Medium / 1 Low**

The implementation is additive and respects the frozen Phase 1-7 production-owner boundary, but it does not yet satisfy the P8-S1 acceptance contract. The fresh-database suite can delete an arbitrary configured database, and Admin schedule editing shifts UTC values according to the browser's local timezone.

## 2. Review method and evidence

- Read the P8-S1 task brief, delivery report, D-058/P8-S0 contract freeze, gap audit, and governing baseline files.
- Inspected the complete `git diff c5097c1d..b7cf5e8b`, including every changed file.
- Confirmed no production diff under frozen merchant/MCP, member/auth, wallet/reward, transaction, commission, redemption, SEC-01/02, P6-R2, or existing Admin Operations owners.
- Confirmed migrations `0000`-`0036` have no diff; only migration 0037 and `checksums.json` changed.
- Independently recalculated all migration SHA-256 values: 38 SQL files, 38 manifest entries, 0 mismatches.
- Confirmed no deleted files/tests and `git diff --check c5097c1d..b7cf5e8b` passed.
- Independently ran typecheck for database, API, API client, Admin Web, and Member Web: all passed. API TypeScript build also passed.
- Vitest/checksum-script/OpenAPI runtime re-execution was blocked because `tsx`/Vitest received `spawn EPERM`; Docker API access was denied. Reviewer B therefore does not claim an independent real-PostgreSQL rerun.

## 3. Severity-classified findings

### Critical

None.

### High

#### H-01 - The P8-S1 fresh-DB suite can destructively drop any database named by `DATABASE_URL`

- File: `apps/api/src/ads-content/ads-content.integration.spec.ts:142`
- Evidence: The suite extracts the database name directly from `DATABASE_URL`, connects to the `postgres` maintenance database, and executes `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)` at lines 142-152. It does not require an allowlisted name such as `ipoint_p8s1_test`, reject protected names, or require a destructive-test opt-in. This contradicts the delivery report's statement that the exact dedicated database name was verified and means the isolated suite is not safe by construction.
- Impact: A mistaken environment variable can cause irreversible deletion of a developer, shared, staging, or production database.
- Recommendation: Fail closed unless the parsed name matches a narrowly approved test-only pattern, explicitly reject protected names, and require a separate destructive-test opt-in. Add tests for the guard. Prefer database recreation in the test orchestrator.

#### H-02 - Admin scheduling corrupts absolute UTC times outside a UTC browser timezone

- File: `apps/admin-web/src/ads-content-page.tsx:723`
- Evidence: The fields are labelled `Start (UTC)` / `End (UTC)` but use `datetime-local` at lines 723-737. The serializer at lines 880-882 calls `new Date(text).toISOString()`, which interprets the string in the browser's local timezone. The reverse helper at lines 884-885 strips `Z` and displays the UTC clock value as a local value. In `Asia/Kuala_Lumpur`, entering `2026-08-08T12:00` serializes to `2026-08-08T04:00:00.000Z`.
- Impact: Ads/content can activate or expire hours earlier than intended, and an unchanged schedule can shift merely by editing and saving.
- Recommendation: Treat the control as explicit UTC without local conversion, or display the selected market's IANA timezone and convert through a timezone-aware boundary. Add non-UTC create/edit round-trip tests.

### Medium

#### M-01 - Selected-market cross-market requests return 409, not the required 403

- File: `apps/api/src/ads-content/ads-content.integration.spec.ts:229`
- Evidence: The test explicitly expects 409 and `MARKET_CONTEXT_MISMATCH` at lines 229-235. Task Brief sections 4.5 and 6 require cross-market denial with HTTP 403. Foreign resource detail lookup returns 403, but selected-market URL mismatch does not.
- Impact: The route contract and test matrix fail the frozen P8-S1 criterion and clients receive inconsistent authorization semantics.
- Recommendation: Align the P8-S1 adapter/routes and tests to 403 without rewriting the frozen Phase 7 guard owner, or obtain an explicit contract correction accepting canonical 409 behavior.

#### M-02 - Ad sponsor labels are defaulted rather than explicitly required

- File: `apps/api/src/ads-content/ads-content.dto.ts:43`
- Evidence: `sponsorLabel` uses `.default('Sponsored')` at line 53, so omission is accepted. The DTO test at `apps/api/src/ads-content/ads-content.dto.spec.ts:19` confirms and depends on that behavior. The brief requires sponsor labels to be required, while the delivery report claims they are required.
- Impact: The server cannot prove the operator/client supplied the market-appropriate disclosure label, and the English fallback can silently become production content in another locale.
- Recommendation: Remove the server default and require a nonblank explicit value. A UI may prefill a localized suggestion, but the submitted API field must be explicit. Add missing/blank HTTP tests.

#### M-03 - Schedule edits can leave lifecycle status inconsistent with the new window

- File: `apps/api/src/ads-content/ads-content.service.ts:232`
- Evidence: `updateAd` validates only end-after-start at lines 232-242; `updateArticle` does the same at lines 419-427. Neither validates the merged window against current status. The stricter checks at lines 861-887 run only on status transitions. An `ACTIVE` item can therefore be edited to a future start or past end, and a `SCHEDULED` item can receive a past start while retaining status.
- Impact: Admin state and member visibility diverge, breaking the claimed lifecycle contract.
- Recommendation: Validate merged schedules against current status inside the locked update transaction and add ACTIVE/SCHEDULED/EXPIRED update tests.

#### M-04 - The Content page unnecessarily requires `ads.view`

- File: `apps/admin-web/src/ads-content-page.tsx:83`
- Evidence: `refresh()` always calls `adminAdsContentApi.placements()` at line 91, including Content mode. The Content route requires only `content.view`, while the placements endpoint requires `ads.view`. A least-privilege content-only Admin can enter the route but receives 403 during load.
- Impact: The separately catalogued action permissions are not independently usable.
- Recommendation: Fetch placements only in Ads mode and test `content.view` without `ads.view`.

#### M-05 - Member Home content is unbounded and returns every full article body

- File: `apps/api/src/ads-content/ads-content.service.ts:515`
- Evidence: The query at lines 532-540 selects `body` and has no limit/pagination; the ads query is also unbounded. Article bodies may be 50,000 characters each. P8-S0 requires a member surface bounded to the discovery/home style.
- Impact: Content growth can make Home responses arbitrarily large, increasing latency, memory use, and denial-of-service exposure. Home currently renders only title/excerpt.
- Recommendation: Return a bounded Home projection, exclude `body`, cap ads/articles by an approved structural limit or placement contract, and expose article detail separately if needed.

### Low

#### L-01 - The dormant C-11 fee table lacks enforceable audit/history controls

- File: `packages/database/migrations/0037_ads_content_operations.sql:44`
- Evidence: `ad_fee_configs` has market/version/effective/status/creator/reason fields but no audit-history model or version-immutability trigger. Lines 182-190 reject deletes only. The baseline requires configurable rules to retain audit history and historical meaning.
- Impact: No billing API/debit exists, so immediate financial risk is low. A future writer could still mutate a fee version in place.
- Recommendation: Before fee management or billing is enabled, freeze immutable versions and add an audited owner/status-history model with effective-window conflict controls. Keep no-default/no-debit posture until C-11 and the MCP extension are approved.

## 4. Acceptance criteria compliance matrix

| Task Brief section 6 criterion | Status | Review evidence |
| --- | --- | --- |
| Migration 0037 forward/rollback; checksums 38/38; drift clean | **PASS WITH RUNTIME LIMITATION** | Additive migration; `0000`-`0036` unchanged; rollback documented; independent SHA-256 check 38/38. Implementer records fresh migration/drift success; Reviewer B could not rerun PostgreSQL because Docker was denied. |
| Full lifecycle and strict market isolation; cross-market 403 | **FAIL** | Lifecycle exists, but H-02/M-03 break schedule correctness and M-01 proves selected-market mismatch is 409. |
| RBAC 401/403 and authorized selected-market data only | **PARTIAL** | New Admin routes use `AuthGuard`, `RbacGuard`, canonical market-scoped permissions, and no Super Admin bypass. 401 and insufficient-permission 403 are tested. M-01/M-04 remain. |
| MCP debit uses frozen owner / ledger append-only | **PASS / NOT IMPLEMENTED** | No MCP debit or direct ledger write. C-11 values remain unseeded and billing is deferred. |
| Sponsor/promoted labels visible; no ranking/safety/financial override | **PARTIAL** | Member labels exist and no ranking/financial owner is touched, but M-02 accepts omitted labels through a hard-coded English default. |
| Atomic audit for privileged mutations | **PASS** | Placement/ad/article mutations append audit evidence in the same transaction as mutation and idempotency result. |
| OpenAPI, typecheck/build/lint/format, web/client tests/build, real-PG tests, no secrets/test deletion/placeholders | **FAIL** | Implementer reports targeted gates green and honestly discloses the full API-suite failure. Independent typechecks/API build passed; no deleted test or real secret. H-01 makes the fresh-DB suite unsafe, and M-02 contradicts required-label coverage. |

## 5. Do Not Touch and financial safety review

| Boundary | Result |
| --- | --- |
| Frozen Phase 1-7 production owners | **COMPLIANT** - no production diff in frozen merchant/MCP, member/auth, wallet/reward, transaction, commission, redemption, SEC-01/02, P6-R2, or existing Admin Operations owners. |
| Migrations `0000`-`0036` | **COMPLIANT** - zero changed historical migration files. |
| Existing schema table definitions | **COMPLIANT** - only new enums/tables and schema exports were added. |
| MCP/financial ledger writes | **COMPLIANT** - no debit and no direct ledger/table mutation from the new domain. |
| C-11 commercial values | **COMPLIANT** - no fee rows or default commercial values seeded. L-01 applies before activation. |
| Secrets and tests | **COMPLIANT WITH TEST-SAFETY FINDING** - no real credential/private key and no deleted tests; H-01 remains. |

## 6. Test quality and implementation honesty

- The implementer correctly disclosed that the full repository API suite was not green and did not claim a full pass.
- The P8-specific count is internally consistent: three DTO tests plus five real-PostgreSQL HTTP tests equals 8/8.
- Source confirms coverage for 401, insufficient-permission 403, selected-market mismatch, foreign-resource 403, activation/pause, stale versions, audit shape, idempotent replay/conflict, ACTIVE-only reads, labels, and no cross-market fallback.
- The suite does not enforce its claimed dedicated database name (H-01), explicitly accepts 409 for selected-market mismatch (M-01), and treats an omitted sponsor label as valid (M-02).
- No tests cover non-UTC schedule round trips, update-time status/window invariants, content-only permission isolation, bounded Home payloads, concurrent duplicates, or audit rollback under injected failure.
- The report is candid about broad-suite limits, but its required-label and cross-market coverage statements are stronger than the code/tests support.

## 7. Risks and required re-review scope

Repair must remain bounded to P8-S1 and must not rewrite frozen owners. Re-review should verify:

1. destructive fresh-DB allowlisting and protected-name refusal;
2. timezone-correct create/edit round trips in a non-UTC browser;
3. consistent cross-market 403 or an authoritative contract correction;
4. explicit sponsor-label validation;
5. update-time schedule/status invariants;
6. independent `content.view` behavior; and
7. bounded Member Home projections.

Session C should then rerun migration/checksum/drift, the P8-S1 real-PostgreSQL suite on an explicitly allowlisted fresh database, OpenAPI, affected RBAC/UI tests, and non-UTC scheduling tests.
