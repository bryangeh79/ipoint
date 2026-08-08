# P8-S0 — Phase 8 Contract Freeze (P8-S1 … P8-S10)

> **Authority:** D-058 §23 (per-task contract) + §27 (continuous execution authorized; P8-S0 decomposition requires NO further Command Center confirmation).
> **Date:** 2026-08-08 · **Branch:** `phase/8-final-delivery-readiness` @ `39c0964e`
> **Status:** FROZEN for P8-S1..S10 task dispatch (OpenClaw internal; Command Center final acceptance remains reserved).
> **Executor rule:** Codex CLI ONLY for all production implementation. OpenClaw = dispatcher/coordinator/integration gate (no production code). High-risk domains (financial ledger/reconciliation, reward, commission, redemption, refund, Maker/Checker, migration, security, permissions, cross-market isolation, concurrency, backup/restore, production-readiness) require Codex A (implementer) → B (independent reviewer) → C (independent verifier). Implementer never self-approves.

---

## 0. Global contracts (apply to every task)

- **Context**: task brief references D-058, P8_S0_GAP_AUDIT_REPORT.md, relevant frozen Phase 1–7 owner docs and gate records.
- **Frozen contracts**: all LOCKED rules (BASELINE_ACKNOWLEDGMENT_V1.1 §2), CONFIGURABLE rule architecture (§3), Phase 1–7 frozen technical baselines; Phase 7 frozen domains (`b7b0d260`) may only be touched under a bounded integration/remediation owner; no owner rewrites.
- **Do Not Touch**: frozen owners (Phase 1 merchant/MCP, Phase 2 member/auth, Phase 3 wallet/reward, Phase 4 transaction, Phase 5 agent/commission, Phase 6 redemption, Phase 7 admin ops canonical owners + SEC-01/02, P6-R2 hardened routes), migration files 0000–0036 (checksums 37/37), `main`, untracked 119.
- **Git boundaries**: isolated worktree, task/fix branch off `phase/8-final-delivery-readiness`, exact-path staging, scoped conventional commits, forward-only integration via merge, local=remote verification, no `git add .`/`-A`, no clean/stash/reset --hard/rebase/amend/force-push, no Main PR/Merge/Push, no production deployment.
- **Acceptance criteria**: per-task AC + Definition of Done (format, lint, typecheck, build, unit, integration real-PG, OpenAPI, migration forward+rollback documented, security/permission coverage, UI states, audit, idempotency, concurrency, market isolation, evidence artifacts).
- **Required final report**: per D-058 §23 (scope, commits, tests+results, DB/API changes, migration, security impact, assumptions, risks, rollback note, executor provenance).
- **Executor provenance**: every task records executor class/model/branch/commits in EXECUTOR_PROVENANCE_REGISTER.md (CODEX_CLI entries for Phase 8).

## 1. P8-S1 — Ads & Content Operations (G-01)

- **Scope**: new Ads/Content domain — platform banners, market-specific content, news/content publishing, placements, scheduling, status lifecycle, admin management, market isolation (E-14), audit (E-12), sponsor/promoted-content labelling; ad MCP debit via frozen MCP ledger owner (append-only entry type extension only); member-facing display surfaces (home/banners) bounded to existing discovery contract.
- **Do Not Touch**: discovery merchant `banner_url` semantics, MCP owner debit logic (delegate via owner entry types), reward/commission engines.
- **AC**: schema + migration (next ID, checksums+1), admin CRUD + lifecycle + market isolation + audit, member read surface, MCP debit integration tests, no ads override of safety/eligibility/pricing/financial/market/ranking/security, RBAC codes added to catalog, OpenAPI, UI states.
- **Risk class**: HIGH (financial MCP debit + security/permissions) → A→B→C.

## 2. P8-S2 — Advanced Financial Reconciliation (G-02)

- **Scope**: MCP / iPoint / transaction-to-ledger / commission / refund / redemption reconciliation engine — difference detection, runs/snapshots, exception queues, admin investigation surfaces, immutable audit, market isolation, idempotency, retry safety, historical traceability.
- **Do Not Touch**: ledgers, transactions, reward/commission/redemption owners; NO destructive auto-correction; NO rewriting immutable financial history; Maker/Checker preserved wherever frozen finance contracts require it.
- **AC**: reconciliation per domain (unit + integration real-PG), mismatch detection scenarios, exception queue lifecycle, admin UI (investigate/close), zero auto-correction assertion, idempotent run re-execution, audit immutability.
- **Risk class**: HIGH (financial invariants) → A→B→C.

## 3. P8-S3 — Risk / Fraud / Operational Controls (G-03)

- **Scope**: detection/review layer — suspicious transaction indicators, duplicate/replay indicators, abnormal adjustment monitoring, rate/config anomaly detection, cross-market violation signals, account/admin abuse indicators, security event visibility, risk review queues.
- **Do Not Touch**: NO invented financial penalties, confiscation, legal fraud declarations, commission forfeiture, commercial blacklist policy, automatic permanent bans (Bryan/Command Center decision required for those); existing enforcement controls unchanged.
- **AC**: indicator definitions (configurable, market-scoped, versioned), detection service + queue + admin review UI, audit, no enforcement side-effects beyond flagging/review, tests incl. negative paths.
- **Risk class**: HIGH (permissions + security event surface) → A→B→C.

## 4. P8-S4 — Advanced Reports (G-04)

- **Scope**: extend `admin-report-ops` (P7-S9 owner) with advanced views: operations, finance, reconciliation, markets, members, merchants, agents, transactions, MCP, iPoint/reward, commission, redemption, fulfilment, refund, risk/exception — preserving RBAC, market isolation, privacy masking, asOf/freshness/stale/unavailable semantics; NEVER fabricate zero; no unrestricted/raw export unless separately authorized.
- **Do Not Touch**: P7-S9 report owner canonical patterns (adapter/read-only), frozen financial owners (read-only projections only).
- **AC**: new report definitions + catalog permissions + masking + freshness semantics + tests; no export endpoints added beyond authorization.
- **Risk class**: MEDIUM-HIGH (permissions/read surfaces) → A→B→C (lighter C where no writes).

## 5. P8-S5 — Cross-Platform Final Integration (G-05 + F-01/F-03/F-04/F-06)

- **Scope**: (a) UI gap closure — member wallet/reward view, team/commission view, redemption center, merchant transaction surface (preview/confirm/receipt/history) as adapters over frozen backends; (b) full consistency verification across Member/Merchant/Admin Web + API + api-client + workers: permissions, market scope, API/error contracts, decimal/currency/timezone semantics, date handling, state lifecycles, idempotency, retry behavior, audit, privacy masking, UI capability states; (c) full-repo CI workflow for Phase 8; (d) reconcile controller count 45 vs 46/46 (F-04); (e) verify legacy/deprecated path drift set (F-06).
- **Do Not Touch**: frozen owners (delegation only), migration history.
- **AC**: UI journeys wired to existing APIs with canonical permissions + market scope; zero owner bypass static scan; cross-platform contract matrix verified; CI green on full repo; controller mapping documented.
- **Risk class**: HIGH (broad integration; financial-adjacent UI) → A→B→C.

## 6. P8-S6 — Load / Performance / Concurrency (G-06)

- **Scope**: systematic load tests on critical journeys (auth/login, transactions, MCP debit, reward, commission, redemption, fulfilment, refund, Maker/Checker, reconciliation, reports, content delivery); verify absence of double debit/reward/commission/redemption/refund, duplicate ledger entries, unsafe replay, race corruption, deadlocks, unbounded retries; measure meaningful operational latency + DB/worker behaviour; bounded fixes only where defects are proven.
- **Do Not Touch**: no benchmark-speed-driven changes to financial correctness; frozen owners.
- **AC**: load test harness + evidence (throughput, latency p50/p95/p99, error rates), concurrency storm per critical flow, no-duplicate assertions, retry bound verification, report.
- **Risk class**: HIGH (financial correctness under load) → A→B→C.

## 7. P8-S7 — Backup / Restore / Monitoring / Security Readiness (G-07 + F-02)

- **Scope**: DB integrity, migration integrity (fresh + upgrade rehearsal), backup procedure + actual restore test, monitoring, structured logs, redaction, alerts, rate limiting, runtime validation, dependency checks, environment validation, health/readiness checks, recovery procedures, operator/incident runbooks, release checklist, DR evidence; **introduce Redis** behind service boundaries (distributed rate limiter/locks/queue — E-03/D-019-C prerequisite; PostgreSQL remains source of truth).
- **Do Not Touch**: business logic, frozen owners, ledger correctness; no secrets in repo/test fixtures/evidence (production credentials classified as deployment blockers, not required).
- **AC**: restore rehearsal evidence (backup → restore → verify), migration fresh+upgrade rehearsal, health/readiness endpoints, alert rules, runbooks/release checklist docs, Redis integration tests (limiter/lock), secret scan clean.
- **Risk class**: HIGH (infra + ops + security) → A→B→C.

## 8. P8-S8 — Full Final UAT (G-08)

- **Scope**: real UAT across complete business journeys (member registration/login, market switching, merchant discovery, merchant transaction, MCP, iPoint earning, wallet, agent/referral commission, merchant package, special percentage, reward rules, redemption, fulfilment, refund, manual MCP Maker/Checker, manual iPoint Maker/Checker, admin workflows, audit, reports, ads/content, reconciliation, risk queues) + negative paths (cross-market denial, permission denial, duplicate/replay, insufficient balance, expiry, suspension, retry, worker failure, network/API failure, concurrency, stale/unavailable, failed fulfilment, refund retry, reconciliation mismatch). Critical user-facing journeys require actual Browser E2E (host or CI with Chromium).
- **Do Not Touch**: production data; frozen owners.
- **AC**: UAT plan + executed scenarios + results matrix (pass/fail/evidence), browser E2E suite expanded to member/merchant/admin critical journeys, defect log with fixes.
- **Risk class**: MEDIUM-HIGH (evidence gate) → A→B→C for defect fixes; UAT execution by verifier class.

## 9. P8-S9 — Production Readiness Gate (G-09)

- **Scope**: full final gate per D-058 §19 — migration checksums/drift/fresh/upgrade; api/member-web/merchant-web/admin-web/api-client/workers typecheck+build; full-repo lint/format/OpenAPI/unit/integration/real-PG/browser E2E/PWA-mobile critical journeys; RBAC, MFA/session, multi-market isolation, idempotency, concurrency, Maker/Checker, MCP/iPoint atomicity, commission/reward/redemption/refund/reconciliation invariants, ledger+audit immutability, privacy masking, secret scan, dependency/runtime checks, security review; operational readiness evidence (load, backup, restore, monitoring, alert, runbook, release checklist). Final condition: 0 unresolved CRITICAL / 0 HIGH.
- **AC**: gate matrix 100% green (or documented deviations with severity), gate record filed.
- **Risk class**: HIGH (acceptance evidence) → A→B→C.

## 10. P8-S10 — Final Delivery Report (G-10)

- **Scope**: `PHASE 8 FINAL DELIVERY REPORT — READY FOR COMMAND CENTER FINAL ACCEPTANCE` with the full D-058 §24 inventory (executive summary, D-058 governance status, S0–S10 matrix, opening + final progress values, capability maps, commit/migration maps, executor provenance, A/B/C evidence, integration/financial/reconciliation/risk/reporting/performance/backup/monitoring/security/browser/UAT/multi-market evidence, known limitations, deployment blockers, Phase 12 deferred backlog, git state, local=remote, main unchanged, no Main PR/Merge/Push/Deploy, tracked status, untracked status, SELLABLE_DELIVERABLE_PROGRESS, PRODUCTION_READY_V1_PROGRESS).
- **Declaration limit**: OpenClaw may declare `PHASE_8_DELIVERY_COMPLETE` + `READY_FOR_COMMAND_CENTER_FINAL_ACCEPTANCE` ONLY. Never `PHASE_8_ACCEPTED/COMPLETE/CLOSED/FROZEN/IPOINT_V1_ENGINEERING_COMPLETE`.

## 11. Stop conditions (D-058 §21) — return to Command Center ONLY for

1. Frozen commercial/business-rule conflict · 2. New business decision required · 3. Legal/compliance decision required · 4. Irreversible data risk · 5. Financial invariant failure not safely repairable within authorized contracts · 6. Critical security defect unresolved after two bounded repair rounds · 7. Secret/credential/private-key exposure · 8. Main or Git history corruption · 9. Unexplained unsafe non-fast-forward.

Repair policy (§20): routine failures/review findings/lint/format/repairable defects/temp DB/env/git transport/Codex session end/migration sequencing/known integration conflicts/CI reruns — repair and continue; Critical/High → bounded repair round 1 → independent review/verification → round 2 → only then Command Center.

## 12. Freeze declaration

This contract freeze is effective for P8-S1 dispatch onward. Task briefs reference this file's section per sub-phase; deviations require a bounded addendum recorded in the sub-phase gate record.

_Forward-only contract. Do not delete or rewrite._
