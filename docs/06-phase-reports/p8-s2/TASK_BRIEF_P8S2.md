# P8-S2 Task Brief — Advanced Financial Reconciliation

**Executor:** OpenClaw-managed coding subagent (A' role, D-060 — Codex CLI unavailable) · **Role:** Implementer (may NOT self-approve)
**Phase:** 8 — FINAL DELIVERY & PRODUCTION READINESS · **Sub-phase:** P8-S2 (G-02)
**Branch:** `task/p8-s2-reconciliation` (worktree `.local/wt-p8-s2`, based on `phase/8-final-delivery-readiness` HEAD)
**Authority:** D-058 · P8_S0_CONTRACT_FREEZE.md §2 · P8_S0_GAP_AUDIT_REPORT.md G-02 · D-059 · D-060

---

## 1. Context

- Phase 8 gap audit (P8-S0) confirmed **no reconciliation engine exists** (G-02). P7-S9 reports are on-screen operational views, not reconciliation.
- P8-S1 (Ads & Content) is delivered and merged (see `docs/06-phase-reports/p8-s1/P8_S1_FINAL_GATE_RECORD.md` for the established module patterns: canonical RBAC catalog, market guard, idempotency, audit, admin-*-ops adapter pattern, route manifests, fresh-PG test conventions).
- You are the IMPLEMENTER (A' role). An independent reviewer (B') and verifier will follow. You may not self-approve.
- Work ONLY in worktree `.local/wt-p8-s2` (branch `task/p8-s2-reconciliation`).

## 2. Required reading (before editing)

1. `AGENTS.md`
2. `docs/00-master/PROJECT_MASTER_CONTROL.md` · `docs/00-master/BASELINE_ACKNOWLEDGMENT_V1.1.md` (LOCKED L-01..L-27, E-01..E-30)
3. `docs/06-phase-reports/p8-s0/P8_S0_CONTRACT_FREEZE.md` (§2 P8-S2, global contracts) · `P8_S0_GAP_AUDIT_REPORT.md` (G-02)
4. `docs/06-phase-reports/p8-s1/P8_S1_FINAL_GATE_RECORD.md` + `P8_S1_DELIVERY_REPORT.md` (module/pattern reference)
5. Inspect existing code BEFORE editing: `apps/api/src/admin-report-ops/**` (P7-S9 reporting patterns), `apps/api/src/admin-audit-ops/**` (audit viewer), `apps/api/src/admin-dashboard/**`, `apps/api/src/merchant/mcp*.ts` + `apps/api/src/wallet/**` (MCP/iPoint ledger owners — READ ONLY), `apps/api/src/commission/**`, `apps/api/src/redemption/**` (commission/redemption domains — READ ONLY), `apps/api/src/platform-access` (RBAC catalog), `apps/admin-web/src/route-manifest.ts`, `packages/database/migrations/0037_*.sql` + `checksums.json`, `apps/api/src/ads-content/ads-content.integration.spec.ts` (fresh-PG test conventions incl. fail-closed DB guard pattern).

## 3. Frozen contracts (non-negotiable)

- Ledgers (MCP, iPoint wallet, commission) are **append-only immutable**; transactions/receipts/refunds are immutable records. **NEVER write, update, or delete ledger/transaction rows** from this new domain.
- **NO destructive automatic correction. NO rewriting immutable financial history to make totals match.** Reconciliation is DETECTION + REVIEW + TRACEABILITY only. Any correction must remain a governed manual operation through the existing frozen owners (Maker/Checker where frozen finance contracts require it).
- Market isolation (E-14): every reconciliation record market-scoped; runs bounded to one market.
- Server-side authorization (E-11) on every route; privileged actions audited (E-12); UTC storage + IANA processing (E-07); exact decimal arithmetic (E-04) — use `numeric` columns and the repository's decimal conventions; versioned forward-only migrations (E-09); secrets outside Git (E-13); no physical deletion (soft-delete/archive only).
- Idempotency + retry safety for reconciliation run execution (a re-run of the same run id must not duplicate rows).
- RBAC permission codes must be added to the canonical catalog (e.g. `reconciliation.view`, `reconciliation.run`, `reconciliation.exception.manage` — follow P8-S1 conventions; `manage` restricted to SUPER_ADMIN/OPERATIONS_ADMIN/appropriate finance roles as the catalog allows).

## 4. Exact scope (implement ONLY this)

New **Advanced Financial Reconciliation** domain:

1. **Schema + migration `0038_reconciliation.sql`** (migration ID assigned by OpenClaw — exactly 0038; do NOT modify 0000–0037; update `checksums.json` → 39/39; forward-test on fresh DB; document rollback).
   - Suggested tables (follow repository conventions, market-scoped, audit columns, soft delete): `reconciliation_runs` (id, public_id, market_id, kind, status PENDING/RUNNING/COMPLETED/FAILED/CANCELLED, window start/end, totals summary, run by, timestamps, version), `reconciliation_exceptions` (id, run_id FK, market_id, kind, reference_type/reference_id, expected/actual amounts (numeric), difference, reason/classification, status OPEN/ACKNOWLEDGED/RESOLVED/CLOSED, investigation notes, resolved_by/at, audit), `reconciliation_run_items` (per-item matched/unmatched evidence snapshot, immutable), idempotency records (reuse the P8-S1 `ads_content_idempotency_keys` pattern — a shared `reconciliation_idempotency_keys` table or the established convention).
   - Kinds (D-058 §12): `mcp`, `ipoint`, `transaction_ledger`, `commission`, `refund`, `redemption`.
2. **Reconciliation engine** (`apps/api/src/reconciliation/**` or `admin-reconciliation-ops/**` — follow P8-S1 module layout):
   - Run lifecycle: create → execute (detect) → complete/fail; idempotent re-execution; retry-safe; per-market bounded windows.
   - Difference detection per kind, comparing the authoritative source against the derived target **without writing either**:
     - MCP: `mcp_ledger` net vs merchant `mcp_balance` (or ledger-sum vs balance invariant).
     - iPoint: wallet ledger net vs wallet balance.
     - transaction-to-ledger: confirmed transactions vs MCP debit entries + reward entitlements (expected vs actual).
     - commission: commission entitlements vs ledger postings (expected vs actual).
     - refund: refund requests vs compensating ledger entries.
     - redemption: redemption orders vs wallet debit entries + voucher/inventory state.
   - Reads must go through the frozen owner read surfaces or direct read-only queries on immutable tables — **no writes**.
   - Exception queue: mismatch detection creates exceptions with expected/actual/difference, classification, status lifecycle, investigation notes (admin), immutable audit of every state change.
   - Immutable run/exception audit: who/when/what/before-after/reason/result.
3. **API** (admin only, market-scoped, canonical RBAC): list/create/execute(re-run)/cancel runs; list exceptions; exception detail; acknowledge/resolve/close exception (with reason + audit); no correction endpoints (corrections remain governed manual operations).
4. **Admin Web** (`apps/admin-web/src/**`): reconciliation page(s) — run list + create/execute UI, exception queue with investigation surface (notes), status actions, market-scoped, canonical route-manifest entries + permissions, full UI states (loading/empty/error/success/disabled/expired/permission-denied/offline/retry).
5. **api-client**: typed reconciliation client additions.
6. **Tests**: unit + integration (fresh PostgreSQL test DB, e.g. `ipoint_p8s2_test`, with the P8-S1 fail-closed DB-guard pattern): per-kind difference detection (mismatch found / match clean), run lifecycle + idempotent re-run (no duplicates), exception queue lifecycle + audit, RBAC 401/403, market isolation (409/403 semantics per canonical guard), no-write assertion (ledger balances unchanged after runs), no destructive auto-correction assertion.

## 5. Do Not Touch

- Ledger/transaction/refund/reward/commission/redemption tables and their frozen owner code — READ ONLY.
- Migrations 0000–0037 and existing schema tables (new tables only).
- `main`, `phase/8-final-delivery-readiness`, `phase/7-admin-operations` (you work on `task/p8-s2-reconciliation` only).
- P8-S1 code (unless a strictly additive shared-pattern reuse; no edits to ads-content files).
- Untracked artifacts, no test deletion, no placeholder text, no secrets.

## 6. Acceptance criteria

- Migration 0038 forward + rollback documented; checksums 39/39; drift clean.
- All 6 kinds produce correct match/mismatch detection on seeded fixtures (real PostgreSQL).
- Reconciliation runs never write to ledgers/transactions; balances byte-identical after runs (asserted in tests).
- Idempotent re-run returns the original result; no duplicate run items/exceptions.
- Exception queue full lifecycle with immutable audit; admin investigation notes persisted.
- RBAC: 401 unauthenticated; 403 wrong permission; market-scoped data only; canonical 409 for selected-market mismatch.
- OpenAPI validated; typecheck/build/lint/format pass; unit + integration pass on real PostgreSQL; admin-web tests pass; no secrets.

## 7. Tests / verification (run and record EXACT results — host executes; you write the tests and report)

- `pnpm --filter @ipoint/api typecheck` / `build` / `openapi:validate`
- `pnpm --filter @ipoint/api exec vitest run src/reconciliation/` (or your module path) on fresh PG test DB with the fail-closed guard pattern
- `pnpm --filter @ipoint/database db:checksum` / `db:drift` / fresh migration
- `pnpm --filter @ipoint/admin-web typecheck/test/build` · `pnpm --filter @ipoint/api-client typecheck/test`
- prettier/eslint on changed paths

## 8. Git boundaries (STRICT)

- Work ONLY in worktree `.local/wt-p8-s2`, branch `task/p8-s2-reconciliation` (created from `phase/8-final-delivery-readiness` HEAD).
- Scoped commits, conventional messages (`feat(p8-s2): …`), exact-path staging.
- NEVER: `git add .` / `-A`, clean, stash, reset --hard, rebase, amend, force push, pushing to phase/main branches, opening PRs.
- Do NOT run git commits yourself if the sandbox blocks git metadata writes — leave changes uncommitted and report; the host gate will commit with your reported commit plan. (You may attempt commits; if `index.lock`/metadata writes fail, stop and report.)

## 9. Required final report

Write `docs/06-phase-reports/p8-s2/P8_S2_DELIVERY_REPORT.md`: task+scope, executor (D-060 subagent, model, session), branch, proposed commit SHAs or plan, changed files, tests written + results (host will execute), DB/API changes (migration 0038 detail + rollback), RBAC codes added, security impact, assumptions, risks, outstanding work, no-write guarantees, rollback note.

## 10. Declaration

You are the IMPLEMENTER (A'). You may NOT approve your own work or declare P8-S2 accepted. Independent reviewer (B') and verifier follow. Report honestly; do not fabricate results.
