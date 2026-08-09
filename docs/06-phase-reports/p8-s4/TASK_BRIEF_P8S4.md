# TASK BRIEF P8-S4 — Advanced Reports (G-04)

> **Authority:** D-058 · **Contract:** `docs/06-phase-reports/p8-s0/P8_S0_CONTRACT_FREEZE.md` §4 (P8-S4) · **Executor:** OpenClaw-managed independent coding subagent (D-060; Codex CLI unavailable) · **Risk class:** MEDIUM-HIGH (permissions + read surfaces) → A→B→C (lighter C where no writes)
> **Branch:** `task/p8-s4-advanced-reports` (created from `phase/8-final-delivery-readiness` @ `061b2409`) · **Worktree:** `.local/wt-p8-s4` · **Migration slot:** **0040** (checksums 40→41) — only if new permission codes are required; otherwise ZERO migration (mirror P7-S9 precedent)

---

## 1. Objective

Extend the **P7-S9 `admin-report-ops` owner** (frozen adapter/read-only patterns) with **advanced on-screen report views**: operations, finance, reconciliation, markets, members, merchants, agents, transactions, MCP, iPoint/reward, commission, redemption, fulfilment, refund, risk/exception — preserving RBAC, market isolation, privacy masking, and the asOf / freshness / stale / unavailable semantics. **Read-only projections over frozen tables. NEVER fabricate zero. NO unrestricted/raw export endpoints.**

## 2. Scope (from contract §4)

- New report definitions for the 15 advanced views (each: market-scoped aggregates/joins over existing frozen tables, bounded queries, no new business rules, no writes).
- Catalog permissions for the new report surface (or reuse of existing `report.read` with recorded rationale — mirror P7-S9 zero-new-permission precedent where defensible).
- Privacy masking consistent with P7-S9 (IDs masked, sensitive values redacted, raw ledgers never exposed to non-granted roles).
- Freshness semantics identical to P7-S9 (QUEUE 60s / KPI 5m TTL, `stale`/`unavailable`, `queryDurationMs`, no fabricated zero).
- Tests: unit + real-PG integration (RBAC 401/403, market isolation, masking, freshness, bounded queries, no-export assertions).

## 3. Do Not Touch (contract §4 + §0)

- ❌ P7-S9 report-owner canonical patterns: keep the adapter/read-only shape of `admin-report-ops` (cache/catalog/controller/service/types/module + errors); extend, do not rewrite.
- ❌ Frozen financial owners (Phase 1–7): read-only projections only; detection/reporting must never write to frozen financial/ledger/transaction/reward/commission/redemption tables.
- ❌ No export endpoints/methods/UI beyond authorization (no CSV/download anywhere, grep-verified — mirror P7-S9).
- ❌ Migrations 0000–0039 (checksums 40/40) — 0040 is the ONLY possible new migration (permission grants only); if zero new permission codes, ZERO migration.
- ❌ `main`, untracked 119, no `git add .`/`-A`, no clean/stash/reset --hard/rebase/amend/force-push.
- ❌ No invented business rules, no fabricated zero values, no invented thresholds, no DEFERRED/OPEN module implementation.

## 4. Deliverables

1. **Report definitions + adapter extensions** in `apps/api/src/admin-report-ops/` (extend existing owner, keep its module/controller patterns; new service methods or new sibling files as the owner's structure dictates):
   - 15 advanced report categories (contract §4 list) — each a market-scoped bounded read query over frozen tables with the P7-S9 response envelope (`asOf`, `freshness`, `stale`/`unavailable`, `queryDurationMs`, bounded LIMIT).
   - Risk/exception view must read only `risk_*` + `reconciliation_*` domain tables (read-only).
   - No writes anywhere in the module (assert in tests: zero DML in the module).
2. **Permissions**: add canonical permission code(s) to `packages/database/src/permission-catalog.ts` AND migration role grants (mirror P8-S2/P8-S3 pattern) IF new codes are needed; otherwise document the reuse decision. Keep `foundationPermissions` consistent; update catalog parity tests (`p7-s2c-permission-catalog.test.ts` role-matrix totals) if catalog changes.
3. **Tests**:
   - Unit: masking rules, freshness state machine, bounded-query guards, response envelope shape, permission gating.
   - Integration (real PG, HTTP): at least one scenario per advanced report category (correct market-scoped data), RBAC 401/403/409, market isolation (foreign market invisible/403), masking assertions, no-export assertion (no download/export endpoints registered), no-fabricated-zero (unconfigured/failed source → `UNAVAILABLE`, never 0-as-real), zero-DML assertion over frozen tables after running all reports.
   - Follow the P8-S3 fixture/debug lessons (see §7).
4. **Migration 0040** (ONLY if new permission codes): `packages/database/migrations/0040_advanced_report_permissions.sql` + checksums.json → 41 entries (do NOT touch existing 40 hashes) + schema/drift parity updates.
5. **Delivery report** `docs/06-phase-reports/p8-s4/P8_S4_DELIVERY_REPORT.md` (per D-058 §23: scope, commits, tests+results, DB/API changes, migration, security impact, assumptions, risks, rollback note, executor provenance) + OpenAPI docs for any new endpoints.
6. **Scope decision (pre-recorded, per M-1 precedent)**: admin-web UI for advanced reports is **deferred to P8-S5** (Cross-Platform Final Integration) together with reconciliation + risk review UIs — engine/API/tests only in this stage. Record in the delivery report.

## 5. Acceptance criteria (mirror contract §4 AC)

- [ ] 15 advanced report categories delivered over the P7-S9 owner; read-only; no export endpoints
- [ ] RBAC preserved: 401 unauth, 403 wrong permission, market-scoped, canonical 409 mismatch; catalog ≡ migration (or documented reuse)
- [ ] Privacy masking + freshness/stale/unavailable semantics identical to P7-S9; no fabricated zero
- [ ] Bounded queries (LIMIT ≤ 100, bounded windows); `queryDurationMs` present
- [ ] Migration 0040 (if any) forward + rollback documented; checksums 41/41 (or 40/40 unchanged); drift clean (host-verified)
- [ ] Typecheck/build/lint/format/OpenAPI clean (host-verified); unit + integration green on fresh PG (host-verified)
- [ ] No secrets, no placeholders, no test deletions, no frozen-owner writes

## 6. Git/commit discipline

- Work only inside `.local/wt-p8-s4` on branch `task/p8-s4-advanced-reports`. You (subagent) cannot run git — commit/staging is done by OpenClaw host after verification. Make file changes only.
- Do NOT touch any file outside the scope above.

## 7. Known pitfalls (from P8-S2/P8-S3 — apply these lessons)

- **Frozen tables are SELECT-only.** `mcp_ledger_entries` writable only via `append_mcp_ledger_entry` SQL function; `mcp_accounts` UPDATE protected. Your projections must never write these.
- **Migration-list parity tests** (`packages/database/tests/schema.unit.test.ts`, `tests/database.integration.test.ts`, `tests/phase3-schema.test.ts`) freeze the migration list — if 0040 is added, these must be updated too (0039→0040; phase3 head + next-index assertions).
- **File encoding: write UTF-8 WITHOUT BOM and keep non-ASCII characters correct** (use proper `—`/`·`/`§` Unicode, never paste garbled sequences). The host gate rejects em-dash mojibake and BOMs (P8-S3 L-1/L-2/L-3).
- **Integration tests share one fresh database**: use relative assertions or dedicated actors/markets for velocity/count checks (P8-S3 §15 #6/#7 lessons); MCP fixture recharges must cover fixture transaction amounts (`MCP_NEGATIVE_OR_INVALID_AVAILABLE_BALANCE` otherwise).
- **DB constraints are real**: do not seed data that violates exclusion/unique constraints (e.g. `service_fee_versions_no_overlap`); design fixtures around them.
- **Runtime helpers** (`and`/`eq`/`sql`) import from `drizzle-orm`; types (`Database`) from `@ipoint/database`. `requiredPositiveInt(config, key)` takes TWO arguments (P8-S3 TS2554 lesson).
- **Raw SQL row values are `unknown`**: assert before passing to `eq()`/comparisons (`as string`/`as number`), mirror `camelize()` usage in P8-S2/P8-S3.
- Exact decimals: use string/BigInt-scaled arithmetic, never floats, for monetary values (numeric(38,10) columns, string thresholds).
- The P7-S9 report response envelope is the contract: replicate its exact shapes (`asOf`, `freshness` states, `stale`, `unavailable`, `queryDurationMs`, `items`, bounded pagination).

## 8. Verification note

The host (OpenClaw) will run: fresh-PG integration with fail-closed guard env (`ipoint_p8s4_test` + `P8S4_DESTRUCTIVE_TEST` pattern — mirror P8-S3's guard), unit suites, checksum 40/40 or 41/41, drift, typecheck/build all packages, eslint, prettier, OpenAPI. Fix rounds follow review findings (A→B'→fix→B'' pattern). You are the implementer; an independent reviewer subagent will review your work. Do not self-approve.
