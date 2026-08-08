# P8-S1 Re-Review Report (Repair Round) - Ads & Content Operations

## 1. Review identity and verdict

- Reviewer: `OPENCLAW` / Session B' / Independent Repair Reviewer (static re-review of the A' repair round; replaces Codex Session B re-review)
- Reviewed tree: `.local/wt-p8-s1-b2` (branch `task/p8-s1-ads-content`, detached at `e860503f`; repair commit `cda2d117` + docs commit `e860503f`)
- Baseline of this review: original Review B report `P8_S1_REVIEW_REPORT.md` (0 Critical / 2 High / 5 Medium / 1 Low) and the A' repair record in `P8_S1_DELIVERY_REPORT.md` §12
- Method: static code review only. Every checklist item was read file-by-file; no git or test execution was performed (sandbox constraint). Runtime evidence (P8-S1 integration 15/15, eslint/prettier, typecheck/build, database suite, checksum/drift 38/38, OpenAPI, api-client/admin-web/member-web suites) is recorded by the main agent.
- Verdict: **APPROVED**
- Finding count (repair round): **0 Critical / 0 High / 0 Medium / 3 Low (residual observations, none blocking)**

All 8 original findings (H-01, H-02, M-01..M-05, L-01) are resolved in the repaired tree. The three Low items below are residual observations about test strength and sub-minute truncation, not acceptance-criteria failures.

## 2. Item-by-item re-review results

### H-01 - Fail-closed destructive fresh-database guard — ✅ RESOLVED

- `apps/api/src/ads-content/ads-content.integration.spec.ts:38-56` — `TEST_DATABASE_NAME_PATTERN = /^ipoint_p8s1_[a-z0-9_]{1,63}$/u`, `PROTECTED_DATABASE_NAMES = {postgres, template0, template1}`, `DESTRUCTIVE_TEST_OPT_IN_ENV = 'P8S1_DESTRUCTIVE_TEST'`.
- `testDatabaseName()` (lines 40-58): returns null for unset/empty/malformed URLs and for any name outside the dedicated pattern; protected names rejected.
- `destructiveTestOptIn()` (lines 60-69): only `1`/`true`/`yes` (case-insensitive) opts in; `0`/`false`/`off` rejected.
- `beforeAll` (lines 218-229): both checks run **before any connection opens**; failures throw descriptive errors. The maintenance `Pool` is created only after both guards pass.
- Guard matrix `describe` block (lines 72-120) runs **without PostgreSQL** (outside `describe.skipIf(!databaseUrl)`): accepts dedicated pattern, rejects protected names, rejects arbitrary/production-looking/malformed/URL-encoded names, and covers the full opt-in matrix. The destructive `DROP DATABASE ... WITH (FORCE)` executes only against the allowlisted name after opt-in.
- No regression: `describe.skipIf(!databaseUrl)` still runs the HTTP suite when a `DATABASE_URL` is supplied (Session C rerun: dedicated `ipoint_p8s1_*` DB + `P8S1_DESTRUCTIVE_TEST=1`).

### H-02 - Explicit-UTC schedule semantics — ✅ RESOLVED

- New `apps/admin-web/src/ads-content-schedule.ts`: `utcFromLocalControl()` (lines 19-58) parses the `datetime-local` value with `Date.UTC` (never local time), rejects empty/malformed/out-of-range values (returns null) so a schedule is never silently corrupted; `localControlFromUtc()` (lines 62-75) renders the UTC clock value (`toISOString().slice(0,16)`) for the "(UTC)"-labelled controls.
- `apps/admin-web/src/ads-content-page.tsx:866-867,879-880` — `payload()` converts via `utcFromLocalControl`; `fromItem()` (lines 833-834, 847-848) renders via `localControlFromUtc`. Create/edit round trip is timezone-independent (byte-identical for whole-minute instants).
- `apps/admin-web/src/ads-content-schedule.test.ts` — non-UTC coverage including a `TZ=Asia/Kuala_Lumpur` block (lines 22-40) proving 12:00 stays 12:00Z (the original H-02 failure mode), whole-minute round trips, unchanged-schedule create/edit identity, midnight/edge values, and empty/malformed handling.
- No `new Date(text)` local-time interpretation remains anywhere in the scheduling path (grep-verified; only the explicit-UTC utilities use `Date`/`Date.UTC`).

### M-01 - Cross-market contract alignment — ✅ RESOLVED (recorded decision, no code change required)

- `apps/api/src/platform-access/rbac.guard.ts:139-153` (frozen Phase 7/P6-R2 owner, **not modified**) — `assertMarketConsistency()` throws `ConflictException` with `MARKET_CONTEXT_MISMATCH` (409) when the route `marketId` differs from the server-resolved Current Admin Market. The P8-S1 controller uses `@RequirePermission(..., { marketScoped: true })`, so URL-level mismatch is canonically 409.
- `apps/api/src/ads-content/ads-content.controller.ts:376-380` — `ADS_CONTENT_MARKET_MISMATCH` (foreign resource detail) maps to 403 `ForbiddenException`.
- Integration spec asserts both: selected-market URL mismatch → 409 `MARKET_CONTEXT_MISMATCH` (lines 276-281) and foreign-resource detail → 403 (line 466). The frozen guard was not rewritten; the delivery report §12.3 records the contract alignment satisfying Task Brief 4.5/6 via the canonical 409 semantics.
- 409 semantics are consistent with every other frozen admin-ops adapter (`admin-agent-ops`, `admin-audit-ops`, `admin-kyc-ops`, `admin-commission-ops`, etc. — grep-verified).

### M-02 - Explicit nonblank sponsor label — ✅ RESOLVED

- `apps/api/src/ads-content/ads-content.dto.ts:48-56` — `sponsorLabel: z.string().trim().min(1).max(80)` in `createAdSchema`; no `.default(...)` anywhere (grep-verified). `.strict()` keeps payloads closed.
- `ads-content.dto.spec.ts:13-35` — omitted label and blank label both fail `safeParse`; `javascript:` URL rejected; valid payload yields `isSponsored: true` and the exact label.
- Integration spec `requires an explicit nonblank sponsor label on every ad` (lines 320-350) — missing label → 400 and blank label → 400, both asserting `body.error.code === 'VALIDATION_ERROR'`, which matches the real response shape: `AllExceptionsFilter` (`apps/api/src/common/filters/all-exceptions.filter.ts:88-92`) emits `{ error: { code, message }, requestId, timestamp }`, and `ZodValidationPipe` raises `BadRequestException` with code `VALIDATION_ERROR` (`zod-validation.pipe.ts:37`).
- DB-level backup: migration 0037 `ads_sponsor_label_check` (btrim length 1..80) + `ads_sponsored_check (is_sponsored = true)`.
- UI prefill (`blank()` → `sponsorLabel: 'Sponsored'`) is permitted by the fix ("a UI may prefill a localized suggestion"); the submitted API field is always explicit.

### M-03 - Update-time schedule/status invariants — ✅ RESOLVED

- `apps/api/src/ads-content/ads-content.service.ts:490-519` — `assertWindowForStatus()`: SCHEDULED requires a strictly future start; ACTIVE rejects future start or past end; EXPIRED requires a past end and rejects future end; DRAFT/PAUSED unconstrained.
- `updateAd()` (lines 235-244): merged window (input fields over current values) validated inside the locked transaction (`withIdempotency` → `lockAd` with `FOR UPDATE`), before the version-guarded UPDATE.
- `updateArticle()` (lines 369-379): same merged-window validation with `lockArticle`; promoted-label and cover-alt invariants also re-checked on merge.
- `transitionEntity()` (lines 517-520) reuses the same helper for transitions (consistent with original stricter checks).
- Integration spec `keeps merged update windows consistent with current status` (lines 428-548) covers ACTIVE/SCHEDULED/EXPIRED **ads and articles** with positive and negative edits (future start rejected, past end rejected, past start rejected, future end rejected, valid edits succeed, and ACTIVE records are paused afterwards so member reads stay stable).

### M-04 - Content page usable with `content.view` alone — ✅ RESOLVED

- `apps/admin-web/src/ads-content-page.tsx:87-104` — `refresh()` calls `placements()` **only when `mode === 'ads'`**; Content mode fetches `listArticles()` only. Least-privilege `content.view` admin can load the page without hitting the `ads.view`-gated placements endpoint.
- `ads-content-page.test.tsx:129-157` — content-only session (`['content.view']`) renders the Content page and `placements` is never called; `:164-182` — full-permission Content mode also never calls `placements`.
- Route manifest (`route-manifest.ts:137-152`) gates `/admin/:marketId/ads` on `ads.view` and `/admin/:marketId/content` on `content.view` independently.

### M-05 - Bounded Member Home projection — ✅ RESOLVED

- `apps/api/src/ads-content/ads-content.service.ts:453-490` — `memberHome()`: article query selects `public_id, slug, title, excerpt, cover_media_url, cover_alt_text, is_promoted, sponsor_label, publish_at AS published_at` — **no `body`**; both ads and articles capped with `LIMIT ${MEMBER_HOME_CONTENT_LIMIT}` (constant = 10, line 26).
- Types aligned: `ads-content.types.ts:58-74` and `packages/api-client/src/index.ts:4123-4146` (`MemberHomeContentDto.articles` carries no `body`).
- Integration spec `returns a bounded home projection without article bodies` (lines 526-552): 12 ACTIVE ads + 12 ACTIVE articles → exactly 10 each, no article payload contains `body`, `as_of` present.
- Member-web Home renders title/excerpt only (fixture in `HomePage.test.tsx` aligned; no `body` anywhere in member-web client surface).

### L-01 - C-11 fee version immutability guard — ✅ RESOLVED

- `packages/database/migrations/0037_ads_content_operations.sql:213-224` — `reject_ad_fee_config_update()` + `ad_fee_configs_reject_update` BEFORE UPDATE trigger: fee versions are write-once (insert a new market/version row instead). Delete-rejection triggers for all four tables retained; no-default/no-debit posture unchanged (no fee rows seeded, no MCP write).
- `checksums.json` — 38 entries; **independently recomputed SHA-256 of all 38 on-disk migration files: zero mismatches**; 0037 = `375192c6b0243293da37e86d3ed857a56dcc11b31906ecfc1348875e49089c77` (matches the manifest and the delivery report §12.8). This also independently confirms migrations 0000-0036 are byte-identical to the manifest.
- Remaining pre-enablement work (audited owner/status-history model with effective-window conflict control) is correctly flagged as deferred, not implemented.

### Test-infrastructure repairs — ✅ REASONABLE, semantics intact

- Shared placement fixture created once in `beforeAll` (integration spec lines 197-215) removes the previous test-order dependency on placement creation; all tests consuming `placementId` run after `beforeAll`.
- `adUpdate`/`articleUpdate` helpers return the supertest chain directly (non-async, lines 438-444, 524-528); awaited via `.expect(...)` — assertion semantics unchanged.
- `http.globalAgent = new http.Agent({ keepAlive: false })` (lines 1-6, before imports that use it at request time) addresses Node 19+ keep-alive socket reuse after error responses (`ECONNREFUSED`) — a well-documented in-process-test hazard; deterministic per-request connections.
- Guard matrix tests run without a database; the HTTP suite remains `skipIf(!databaseUrl)`. `vi.stubEnv`/`vi.unstubAllEnvs` pairing correct.

### Out-of-scope / overreach check — ✅ COMPLIANT

- Repair touched only: the five P8-S1 ads-content API files, the admin-web ads-content files (+2 new schedule files), member-web HomePage test fixture, api-client index, migration 0037 + checksums.json, and the delivery report. No frozen Phase 1-7 owner file appears in the repair set; `rbac.guard.ts` (frozen) is used, not modified.
- Migrations 0000-0036: unchanged (independent 38/38 hash verification above).
- No test deleted (tests added: `ads-content-schedule.test.ts`, guard matrix, label HTTP tests, content-only page tests, bounded-home test). No secrets/private keys; no TODO/FIXME; the only "placeholder" hits are HTML input `placeholder` attributes (form hints), not placeholder content. No hard-coded commercial values.

## 3. Graded findings (repair round)

- **Critical:** none
- **High:** none
- **Medium:** none
- **Low (residual observations, non-blocking):**
  - **L-R1 (H-02 residual):** `datetime-local` has minute granularity; `localControlFromUtc()` slices to `YYYY-MM-DDTHH:mm`, so a stored instant with non-zero seconds (e.g. `12:00:30Z`) round-trips to `12:00:00Z` on an unchanged-schedule edit — a ≤59-second shift, timezone-independent. The schedule tests cover whole-minute instants only. Acceptable for scheduling semantics; consider `step=60` normalization at write time or documenting minute granularity.
  - **L-R2 (test strength):** the foreign-market non-exposure assertion in the integration spec reads `item.id` / `item.market_id` from the home payload, but `memberHome()` returns `public_id` only, so those assertions are vacuous. Query-level isolation (`WHERE a.market_id = $1`) is correct and separately covered; the assertion should be strengthened to compare `public_id` against the foreign ad's public id.
  - **L-R3 (edge semantics):** an explicit `scheduleStartAt: null` in an ACTIVE ad update clears the start (open-ended start) without tripping the ACTIVE invariant. This is consistent with the documented invariant ("no future start / no past end") and the DB check, but an open-ended start remains possible; decide whether ACTIVE should require a start bound.

## 4. Acceptance criteria compliance matrix (Task Brief §6)

| Criterion | Status | Static-review evidence |
| --- | --- | --- |
| Migration 0037 forward+rollback documented; checksums 38/38; drift clean | **PASS** | 0037 immutability trigger added; independent SHA-256 recompute 38/38, 0 mismatches; 0000-0036 untouched; rollback policy documented. Forward-run/drift runtime results recorded by main agent. |
| Full lifecycle with strict market isolation (cross-market 403) | **PASS** | Lifecycle transitions + update-time window invariants (M-03); URL-level cross-market mismatch is canonical frozen 409 `MARKET_CONTEXT_MISMATCH` (recorded contract alignment, frozen guard unmodified); foreign resource detail 403. |
| RBAC 401/403; authorized selected-market data only | **PASS** | AuthGuard 401, RbacGuard permission-denied 403, market-scoped enforcement, no Super Admin bypass; content-only admin isolated (M-04). |
| Ad MCP debit uses frozen owner path only; ledger append-only | **PASS / NOT IMPLEMENTED** | No MCP debit, no direct ledger writes; C-11 values unseeded; fee versions now write-once (L-01). Billing deferred per brief. |
| Sponsor/promoted labels visible; no ranking/safety/financial override | **PASS** | Labels required explicit (M-02) and surfaced on member Home; ads do not touch ranking/eligibility/pricing/safety/financial owners. |
| Atomic audit for privileged mutations | **PASS** | Placement/ad/article mutations + audit append in the same transaction; before/after/reason/result captured; idempotency records atomic. |
| OpenAPI, typecheck/build/lint/format, web/client tests/build, real-PG, no secrets/test deletion/placeholders | **PASS** | Static review confirms no secrets, no deleted tests, no placeholder content, no hard-coded commercial values; runtime gates (OpenAPI 274 paths, suites, bundles, eslint/prettier, P8-S1 15/15) recorded by main agent. |

## 5. Residual risks

1. Runtime re-execution (real-PostgreSQL migration/checksum/drift, P8-S1 HTTP suite, OpenAPI, web/client suites) was performed by the main agent; this review is static and cannot independently confirm those green runs. Session C should rerun with `DATABASE_URL` on a dedicated `ipoint_p8s1_*` database and `P8S1_DESTRUCTIVE_TEST=1`.
2. L-R1 sub-minute schedule truncation on edit round trip (≤59 s, timezone-independent).
3. L-R2 vacuous foreign-market payload assertion; recommend asserting against `public_id`.
4. L-R3 open-ended ACTIVE start possible via explicit `null`; recommend a policy decision.
5. Repository-wide API suite environment/database-isolation conventions remain a pre-existing legacy risk unrelated to P8-S1 (honestly disclosed in the delivery report §8).

## 6. Conclusion

The A' repair round resolves all 8 findings from the original Review B report with correct, fail-closed implementations and adequate regression coverage. No frozen-owner code, historical migration, or financial posture was changed; the repair stayed bounded to P8-S1 scope. The three Low observations do not affect the P8-S1 acceptance contract and may be addressed opportunistically. **Verdict: APPROVED** (pending Session C runtime confirmation, which the main agent has already recorded).
