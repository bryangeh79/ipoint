# P8-S1 Delivery Report - Ads & Content Operations

## 1. Task and scope

- Task: implement the Phase 8 P8-S1 Ads & Content Operations domain only.
- Executor: `CODEX_CLI` / `GPT-5` / `Session A (IMPLEMENTER)`.
- Branch: `task/p8-s1-ads-content`.
- Base: `c5097c1d` from `phase/8-final-delivery-readiness`.
- Role boundary: implementation evidence only. This report does not approve or accept P8-S1.

## 2. Commit chain

| Commit                                     | Scope                                                   |
| ------------------------------------------ | ------------------------------------------------------- |
| `2c74c6c6b5c954a5cf4c757757bfba52f8b9d146` | `feat(p8-s1): add ads content schema and permissions`   |
| `d9c155fee5e09dbfd817656552425de99d45ec97` | `feat(p8-s1): implement ads content APIs`               |
| `2cf071930203b43b3d60caa148278d3139bd2b33` | `feat(p8-s1): add ads content web operations`           |
| `386dbe3428060ce9a4f3f48d836f32489d1e8678` | `test(p8-s1): align migration and home regressions`     |
| `71f5f0f5d6cc0757e32b0a1eeb5b7b43b21f437d` | `test(p8-s1): repair integration verification fixtures` |
| `f9828b59c0b1831e3576d1c351eda796e8207f16` | `fix(p8-s1): keep openapi validation side-effect free`  |
| `516bb9b27d62594d1865da8609552aaafa845b4a` | `style(p8-s1): format home content regression`          |

The final documentation commit contains this report and the executor-provenance entry. Its SHA is necessarily produced after this file is authored and is reported in the final handoff.

## 3. Changed files

### Database and permissions

- `packages/database/migrations/0037_ads_content_operations.sql`
- `packages/database/migrations/checksums.json`
- `packages/database/schema/index.ts`
- `packages/database/src/expected-schema.ts`
- `packages/database/src/permission-catalog.ts`
- `packages/database/tests/p8-s1-schema.test.ts`
- `packages/database/tests/p7-s2c-permission-catalog.test.ts`
- `packages/database/tests/schema.unit.test.ts`
- `packages/database/tests/phase3-schema.test.ts`
- `packages/database/tests/database.integration.test.ts`

### API and typed client

- `apps/api/src/app.module.ts`
- `apps/api/src/ads-content/ads-content.module.ts`
- `apps/api/src/ads-content/ads-content.controller.ts`
- `apps/api/src/ads-content/ads-content.service.ts`
- `apps/api/src/ads-content/ads-content.dto.ts`
- `apps/api/src/ads-content/ads-content.types.ts`
- `apps/api/src/ads-content/ads-content.dto.spec.ts`
- `apps/api/src/ads-content/ads-content.integration.spec.ts`
- `apps/api/src/platform-access/platform-access.integration.spec.ts`
- `apps/api/src/__scripts__/openapi-validate.ts`
- `packages/api-client/src/index.ts`

### Admin and member web

- `apps/admin-web/src/admin-api.ts`
- `apps/admin-web/src/admin-app.tsx`
- `apps/admin-web/src/admin.css`
- `apps/admin-web/src/route-manifest.ts`
- `apps/admin-web/src/route-manifest.test.ts`
- `apps/admin-web/src/ads-content-page.tsx`
- `apps/admin-web/src/ads-content-page.test.tsx`
- `apps/member-web/src/api/client.ts`
- `apps/member-web/src/pages/HomePage.tsx`
- `apps/member-web/src/member-web.css`
- `apps/member-web/src/i18n/locales/en/translation.json`
- `apps/member-web/src/i18n/locales/zh/translation.json`
- `apps/member-web/src/test/features/HomePage.test.tsx`

### Governance evidence

- `docs/00-master/EXECUTOR_PROVENANCE_REGISTER.md`
- `docs/06-phase-reports/p8-s1/P8_S1_DELIVERY_REPORT.md`

## 4. Implementation delivered

- Added market-scoped ad placements, configurable/versioned advertisement fee configuration, advertisements, content articles, and retry-safe idempotency records.
- Froze lifecycle states as `DRAFT`, `SCHEDULED`, `ACTIVE`, `PAUSED`, `EXPIRED`, and `ARCHIVED`, with explicit server-side transition and schedule rules.
- Added optimistic versions, public IDs separate from internal IDs, compound foreign keys preventing cross-market placement/fee references, UTC schedules, soft archive fields, and physical-delete rejection triggers.
- Added admin selected-market list/read/create/update/transition APIs for ads and content, plus placement list/create APIs.
- Added strict input validation, HTTP(S)-only media/target URLs, required sponsor/promoted labels, alternative-text checks, idempotency-key enforcement, and before/after/reason audit writes in the same transaction as each privileged mutation.
- Added member Current Market Home read surface returning only `ACTIVE`, in-window, non-archived records; it performs no cross-market fallback.
- Added typed admin/member API clients, Admin navigation/pages for placements, ads, content, scheduling and lifecycle actions, and Member Home sponsored/promoted cards.
- Added loading, empty, error, success, disabled, expired, suspended, permission-denied, offline and retry UI behavior.
- Ads do not participate in discovery ranking, eligibility, pricing, safety, financial rules, rewards, commission, redemption, transactions, or security controls.

## 5. Migration 0037 and rollback

- Migration ID: exactly `0037_ads_content_operations.sql`.
- Added enums: `ads_content_status`, `ad_placement_status`, `ad_fee_config_status`.
- Added tables: `ad_placements`, `ad_fee_configs`, `ads`, `content_articles`, `ads_content_idempotency_keys`.
- Added permissions and controlled-role assignments in the same forward migration.
- Existing migrations `0000`-`0036` were not edited.
- Checksum evidence: 38 migration files, 38 manifest entries, zero calculated SHA-256 mismatches. Migration 0037 checksum: `e56d2478e50f3e5500a4853a3a4d947ed7815438abe09b8a7b2216eb9aab79e6`.
- Rollback policy: forward-only. Roll back application exposure by deploying the prior application commit; leave additive tables, enums and historical/audit data intact. Do not physically delete domain history. A destructive schema rollback would require a separately approved backup/restore procedure and is not supplied by P8-S1.
- Fresh-DB execution completed against the dedicated `ipoint_p8s1_migration_test` database in `ipoint-postgres-1` (`127.0.0.1:55432`): the database was verified by exact name, recreated empty, migrated through all 38 files, and queried with `migration_count = 38` and latest filename `0037_ads_content_operations.sql`.
- `pnpm --config.script-shell= --filter @ipoint/database db:checksum` passed: `Verified 38 immutable migration checksum(s).`
- `pnpm --config.script-shell= --filter @ipoint/database db:drift` passed: `No database schema drift detected.`

## 6. RBAC and security impact

- Added canonical market-scoped permissions: `ads.view`, `ads.manage`, `content.view`, `content.manage`.
- View permissions extend all six controlled role templates; manage permissions extend only `SUPER_ADMIN` and `OPERATIONS_ADMIN`.
- Admin routes use `AuthGuard`, `RbacGuard`, exact canonical permissions, and server Current Admin Market enforcement. There is no Super Admin bypass.
- Cross-market URL context is rejected by the canonical market guard; resource-detail lookup also returns 403 for a foreign-market identifier.
- Member reads derive Current Market server-side and never accept a market ID from the client.
- All privileged writes require audit reason and idempotency key; successful writes and audit append atomically.
- Sponsored ads are enforced as labelled at DTO and database-check levels. Promoted articles require a label; media requires alternative text.
- Static owner-bypass scan found no MCP, wallet, reward, commission, redemption, transaction, or frozen-owner call/write in the new domain.

## 7. Advertisement MCP fee decision

C-11 is implemented as an isolated, market-scoped, effective-time, status-controlled, versioned fee structure with no seeded/default commercial values. No advertisement MCP debit was implemented because the approved pricing rule and a safe documented callable extension on the frozen MCP owner are absent. The implementation performs no direct MCP table write and does not rewrite MCP owner internals.

## 8. Tests and verification - exact results

### Passed

- Effective pnpm invocation used `--config.script-shell=` to bypass a host-level `script-shell=cmd.exe` setting that otherwise opened `cmd.exe` without executing package scripts. No global configuration was changed.
- Typecheck: database, API, api-client, admin-web and member-web all passed with exit 0.
- Build: database, API and api-client passed with exit 0.
- Admin Web production build passed: Vite 7.2.6 transformed 1,662 modules and emitted the production bundle; it retained the non-failing existing warning that the 600.43 kB JS chunk exceeds 500 kB.
- Member Web production/PWA build passed: Vite 7.2.6 transformed 1,662 modules; the 439.29 kB JS bundle, service worker and Workbox output were generated.
- Database unit/schema suite on fresh PostgreSQL: 5 files, 65/65 tests passed.
- Database integration suite on fresh PostgreSQL: 1 file, 22/22 tests passed, including rebuild-from-zero, checksum, drift and upgrade-from-0001 coverage.
- P8-S1 API DTO + real-PostgreSQL HTTP integration: 2 files, 8/8 tests passed. Coverage includes lifecycle, schedule negatives, 401/403 RBAC, selected-market mismatch, audit before/after/reason, idempotent replay, stale versions, ACTIVE-only member reads, sponsor/promoted labels, paused visibility and no cross-market fallback.
- Platform-access permission regression on fresh PostgreSQL: 1 file, 6/6 tests passed; canonical catalog count is 71 and controlled roles remain 6.
- API client: 1 file, 95/95 tests passed.
- Admin Web: 40 files, 322/322 tests passed, including P8-S1 Ads/Content 2/2.
- Member Web: 19 files, 272/272 tests passed, including Home Ads/Content 10/10.
- OpenAPI runtime validation passed after making the validator side-effect-free: 274 total paths, 31 auth paths/operations, 0 broken schema references and 0 duplicate operation IDs. Node emitted a non-failing `DEP0205 module.register()` deprecation warning.
- Migration checksum passed at 38/38; fresh migration applied through 0037; drift passed clean.
- Changed-path ESLint passed on 28 TypeScript/TSX paths with 0 errors; Prettier passed on 35 supported changed paths; final `git diff --check` passed.

### Executed but not green

- A full API Vitest attempt was executed serially against one fresh shared database (`vitest run --no-file-parallelism --maxWorkers=1`). It exited 1 after 254.7 seconds. The captured output enumerated 34 failure entries, dominated by frozen-owner test-harness issues unrelated to P8-S1: suites missing required `AUTH_OTP_PEPPER` or `REDEMPTION_VOUCHER_ENCRYPTION_KEY`, cleanup hooks running after failed setup, and cross-suite fixture accumulation in one shared database (for example package/member/KYC exact-count assertions). The run also exposed the P8-affected permission count drift from 67 to 71; that regression was fixed and independently rerun 6/6 green. P8-S1's isolated fresh-DB suite remains 8/8 green.

## 9. Assumptions, risks and outstanding work

- Targeting scope for V1 is the frozen market boundary plus placement; no unapproved demographic/profile targeting was invented.
- Advertisement fee configuration is schema-only until commercial pricing and the MCP owner extension are approved.
- The P8-S1-specific gates, fresh migration/drift, OpenAPI and both Vite bundles are green. The remaining verification risk is the repository-wide API suite's legacy environment and database-isolation conventions; its single-shared-DB serial attempt is not green and must not be represented as such.
- Admin Web retains a non-failing bundle-size warning (600.43 kB). Optimization is deferred because it is not required for P8-S1 correctness.
- This implementer does not self-approve. Independent Reviewer B and Verifier C must review the commits and may rerun the broader API matrix with the established per-suite fresh-database/environment orchestration.

## 10. Git and remote status

- Shared Git metadata writes now work and the seven real scoped implementation/test/style commits listed in section 2 are on `task/p8-s1-ads-content`.
- The first commit succeeded, but Git's automatic post-commit repack reported `fatal: too-short tree object`; subsequent commits used command-local `gc.auto=0`. Normal status, log, diff and commit operations continued to work. No history rewrite or destructive repair was attempted.
- `git fsck --connectivity-only --no-dangling` returned exit 0 but emitted `error: too-short tree object` twice, consistent with the failed automatic repack; this was not destructively repaired inside the task.
- Initial push succeeded: `task/p8-s1-ads-content` was created on `origin`, and `git ls-remote` matched the implementation head `516bb9b27d62594d1865da8609552aaafa845b4a`.
- The final documentation commit SHA and its final local/remote comparison are reported in the handoff because they are necessarily produced after this file is authored.
- No force push, rebase, amend, stash, clean, Main/phase push, PR, merge or deployment occurred.
- `phase/8-final-delivery-readiness` and `main` were not modified.

## 11. Next required step

Hand the real commit chain and this evidence to independent Reviewer B and Verifier C. The verifier should preserve the green P8-S1 isolated fresh-DB run and separately address repository-wide API suite environment/database orchestration without rewriting frozen owners.
