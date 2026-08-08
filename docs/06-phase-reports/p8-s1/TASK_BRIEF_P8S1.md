# P8-S1 Task Brief — Ads & Content Operations

**Executor:** Codex CLI Session A (IMPLEMENTER) · **Role:** Implementer (may NOT self-approve)
**Phase:** 8 — FINAL DELIVERY & PRODUCTION READINESS · **Sub-phase:** P8-S1
**Branch:** `task/p8-s1-ads-content` (worktree `.local/wt-p8-s1`, based on `phase/8-final-delivery-readiness`)
**Authority:** D-058 · P8_S0_CONTRACT_FREEZE.md §1 · P8_S0_GAP_AUDIT_REPORT.md G-01

---

## 1. Context

- Phase 8 is the final engineering phase for iPoint V1 (D-058). Gap audit (P8-S0) confirmed **no ads/content module exists** anywhere in the repository (G-01). `discovery` carries only merchant `banner_url` (merchant image field) — do not confuse it with platform ads.
- You are Codex CLI Session A (IMPLEMENTER). Independent Reviewer (Session B) and Independent Verifier (Session C) will review/verify your work afterwards. You may not approve your own work.
- Work ONLY inside this worktree: `.local/wt-p8-s1` (branch `task/p8-s1-ads-content`, created from `phase/8-final-delivery-readiness` HEAD).

## 2. Required reading (in order)

1. `AGENTS.md`
2. `docs/00-master/PROJECT_MASTER_CONTROL.md` (§2 authority order, §4 requirement status classes)
3. `docs/00-master/BASELINE_ACKNOWLEDGMENT_V1.1.md` (LOCKED rules L-01..L-27, engineering E-01..E-30)
4. `docs/04-engineering/CODEX_WORKFLOW_RULES.md` (if present)
5. `docs/06-phase-reports/p8-s0/P8_S0_CONTRACT_FREEZE.md` (global contracts + §1 P8-S1)
6. `docs/06-phase-reports/p8-s0/P8_S0_GAP_AUDIT_REPORT.md` (G-01, F-05)
7. Inspect existing code BEFORE editing: look at `apps/api/src/admin-*-ops` adapter patterns, `apps/api/src/discovery/discovery.service.ts` (member-facing read surface), `apps/api/src/merchant/mcp*.ts` (MCP ledger owner), `apps/api/src/platform-access` (RBAC catalog), `apps/admin-web/src/route-manifest.ts` + an existing admin page, `packages/database/migrations/0036_*.sql` + `checksums.json` (migration format), `apps/api/src/__tests__` integration test conventions (fresh PostgreSQL test DB).

## 3. Frozen contracts

- All LOCKED business rules and engineering principles from Baseline V1.1 apply. Especially: server-side authorization (E-11), market isolation via `market_id` (E-14), complete privileged-action audit (E-12), append-only ledgers (E-10), exact decimal arithmetic (E-04), UTC storage + IANA market timezone (E-07), public identifiers separate from internal keys (E-08), versioned forward-only migrations (E-09), secrets outside Git (E-13), no physical deletion (E-30/soft-delete `archived_at`).
- **Ads must NEVER override** safety, eligibility, pricing, financial rules, market restrictions, trusted ranking, or security controls (D-058 §11).
- **CONFIGURABLE (C-11)**: any advertisement MCP fee value must be configurable/versioned (market scope, effective time, status, audit) — never hard-coded. If fee structure is not defined by an approved rule, implement the configurable structure with no default commercial values, and flag in the report (do NOT invent pricing).

## 4. Exact scope (implement ONLY this)

New **Ads & Content Operations** domain:

1. **Schema + migration `0037_ads_content_operations.sql`** (migration ID assigned by OpenClaw — use exactly 0037; do NOT modify 0000–0036; update `checksums.json` → 38/38; forward-test the migration on a fresh DB; document rollback).
   - Suggested tables (follow repository conventions; market-scoped with `market_id`; audit columns; soft delete): `ad_placements` (placement code/position), `ads` (title, creative media refs, target url, placement, market_id, sponsor/promoted label flag, status, schedule start/end, versioned fee config ref if applicable, created_by/audit), `content_articles` (news/content publishing, market_id, status, publish schedule, author, audit), status lifecycle states (propose and freeze exact states, e.g. DRAFT → SCHEDULED → ACTIVE → PAUSED → EXPIRED → ARCHIVED with transition rules).
   - If ad MCP billing is required by existing contracts: add a MCP ledger entry-type extension ONLY through the frozen MCP owner's documented extension point (entry types enum + owner service method); do NOT rewrite MCP owner internals. If no safe extension point exists, implement billing as a clearly isolated, config-driven capability and state the deferral in the report.

2. **API** (new NestJS module `apps/api/src/ads-content/**` or `admin-ads-ops/**` + member read surface):
   - **Admin**: create/read/update/list/status transitions/schedule management for ads and content; market isolation (selected-market enforcement like existing admin-*-ops); audit on all privileged actions; RBAC permission codes added to the canonical catalog (e.g. `ads.manage`, `ads.view`, `content.manage`, `content.view` — follow catalog conventions; update permission catalog + route manifests); no Maker/Checker required (no manual financial adjustment is being introduced).
   - **Member**: read-only banner/content surfaces (market-scoped, ACTIVE only, sponsor/promoted label included), integrated with the existing discovery/home contract style.
3. **Admin Web** (`apps/admin-web/src/**`): ads/content management pages (list/detail/create/edit/status actions/scheduling, sponsor labelling), market-scoped, canonical route-manifest entries with the new permissions, full UI states (loading/empty/error/success/disabled/expired/suspended/permission-denied/offline/retry).
4. **Member Web** (`apps/member-web/src/**`): banner/content display components on Home (market-scoped, active only, sponsor label visible).
5. **Tests**: unit + integration (fresh PostgreSQL test DB e.g. `ipoint_p8s1_test`): lifecycle, market isolation (cross-market 403), RBAC (401/403), audit trail, schedule/status validation, idempotent retry-safe writes where applicable, no cross-market fallback, no owner bypass. OpenAPI validation for new paths. No placeholder text.

## 5. Do Not Touch

- Frozen Phase 1–7 owners: merchant/MCP owner internals, member/auth, wallet/reward, transaction, commission, redemption, admin ops canonical owners, SEC-01/02 owners, P6-R2 hardened routes (their logic/code must not be rewritten; you only add NEW files and, where strictly needed, extend entry-type enums / permission catalogs / route manifests through documented extension points).
- Migrations 0000–0036 and existing `schema/*.ts` table definitions (new tables only, additive).
- `main`, `phase/7-admin-operations`, `phase/8-final-delivery-readiness` (you work on `task/p8-s1-ads-content` only; do not push to those branches).
- Untracked artifacts (none exist in this worktree by design).
- No changes to reward/commission/redemption/transaction business logic.

## 6. Acceptance criteria

- Migration 0037 forward + rollback documented; checksums 38/38; drift clean.
- Full ads/content lifecycle works with strict market isolation (cross-market denied 403).
- RBAC: unauthenticated 401; insufficient permission 403; market-scoped data only for authorized admin.
- Ad MCP debit (if implemented) uses existing owner ledger path only; ledger append-only; no direct table writes outside the owner.
- Sponsor/promoted labelling present on member display; ads never alter ranking/safety/financial behavior.
- Audit entries for every privileged action (who/when/what/before-after/reason/result).
- OpenAPI validated; api typecheck/build/lint/format pass; admin-web + api-client typecheck/test/build pass; new unit + integration suites pass on real PostgreSQL; no secret material; no test deletion; no placeholder text.

## 7. Tests / verification (run and record EXACT results)

- `pnpm --filter @ipoint/api typecheck` · `pnpm --filter @ipoint/api build` · `pnpm --filter @ipoint/api openapi:validate`
- `pnpm --filter @ipoint/api test` (or vitest run targeted + affected regression suites) on a fresh PostgreSQL test DB
- `pnpm --filter @ipoint/admin-web typecheck` / `test` / `build` · `pnpm --filter @ipoint/api-client typecheck` / `test`
- `pnpm --filter @ipoint/database db:checksum` / `db:drift` / migration on fresh DB (use repository scripts; record output)
- prettier/eslint on changed paths
- If any suite fails due to pre-existing environment issues, record honestly (do not hide, do not delete tests).

## 8. Git boundaries (STRICT)

- Work ONLY in this worktree (`.local/wt-p8-s1`), branch `task/p8-s1-ads-content`.
- Scoped commits, conventional messages (`feat(p8-s1): …`), exact-path staging.
- **NEVER**: `git add .` / `git add -A`, `git clean`, `git stash`, `git reset --hard`, `git rebase`, `git commit --amend`, force push, pushing to `phase/8-final-delivery-readiness` or `main`, opening PRs.
- You MAY push `task/p8-s1-ads-content` to `origin` when your work is complete (host credentials available). If push fails, leave the branch local and record it in the report.

## 9. Required final report

Write `docs/06-phase-reports/p8-s1/P8_S1_DELIVERY_REPORT.md` containing: task + scope, executor (CODEX_CLI + model + session id), branch, full commit SHAs, changed files list, tests executed + exact results, DB/API changes (migration 0037 detail + rollback), RBAC/permission codes added, security impact, assumptions, risks, outstanding work, rollback note, local=remote status, worktree/phase-branch sync note.

## 10. Declaration

You are the IMPLEMENTER. You may NOT approve your own work, declare P8-S1 accepted, or bypass any gate. Independent Reviewer and Verifier follow. Report completion honestly; do not fabricate test results.
