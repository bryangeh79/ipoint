# TASK_BRIEF_P8S8 - Full Final UAT (G-08)

> Phase 8 · Sub-phase **P8-S8** · Execution branch `task/p8-s8-full-final-uat` (based on `phase/8-final-delivery-readiness` HEAD)
> Contract: `P8_S0_CONTRACT_FREEZE.md` §8 (G-08) - D-058 §18 domain, as frozen 2026-08-08
> Gap audit: `P8_S0_GAP_AUDIT_REPORT.md` row **G-08** (Full Final UAT: "Phase 7 admin E2E 18/18 + per-phase integration suites; no full business-journey UAT across member/merchant/admin")
> Executor: **UAT execution by verifier class** (contract §8: "UAT execution by verifier class") - independent verification agent (D-060 reviewer/verifier pool) · Defect fixes: A→B→C (implementer → independent Reviewer B' → OpenClaw host integration gate; Codex CLI preferred per D-058 §5, D-060 alternate) · Verifier: OpenClaw host integration gate
> Risk class: **MEDIUM-HIGH (evidence gate)** → A→B→C for any defect fix; UAT execution itself is verification-class work

---

## 1. Mission

Deliver the **Full Final UAT evidence package for iPoint V1 at Phase 8 state** per contract §8 (G-08): an executed, evidence-backed end-to-end acceptance of the complete business journey set (member registration/login, market switching, merchant discovery, merchant transaction, MCP, iPoint earning, wallet, agent/referral commission, merchant package, special percentage, reward rules, redemption, fulfilment, refund, manual MCP Maker/Checker, manual iPoint Maker/Checker, admin workflows, audit, reports, ads/content, reconciliation, risk queues) **plus** the full negative-path set (cross-market denial, permission denial, duplicate/replay, insufficient balance, expiry, suspension, retry, worker failure, network/API failure, concurrency, stale/unavailable, failed fulfilment, refund retry, reconciliation mismatch), across member-web / merchant-web / admin-web × API × key journeys, with **actual Browser E2E for critical user-facing journeys** (host or CI with Chromium), a pass/fail/evidence results matrix, and a defect log with fixes.

The UAT is the **input evidence base for the P8-S9 Production Readiness Gate**: it must end in a state where P8-S9 can execute its final matrix without re-running UAT scenarios, and where the OBS-04 / SEC-01 acceptance wording is explicit (see §3.7).

This is an **evidence + verification sub-phase**. No feature work. No new migrations. Production code changes are limited to §11 bounded fixes for defects actually proven by UAT (see §3.8). UAT execution is verification-class work (contract §8), not implementer work.

## 2. Background - what S5a..S7 already closed (do NOT redo)

| Sub-phase | Closed | Evidence |
|---|---|---|
| S5a | admin-web renders all 19 reports (R01-R19), freshness honesty, no-export | `P8_S5A_FINAL_GATE_RECORD.md` (merge `e701ebd3`), admin-web 336/336 |
| S5b | member-web Wallet / Reward / Team / Redemption pages over frozen Phase 3/5/6 backends | `P8_S5B_FINAL_GATE_RECORD.md` (merge `a71d0a46`), member-web 311/311 |
| S5c | merchant-web transactions preview/confirm/receipt/history over frozen Phase 4 endpoints | `P8_S5C_FINAL_GATE_RECORD.md` (merge `7fe4ed28`), merchant-web 24/24 + api-client 100/100 |
| S5d | full-repo Phase 8 CI workflow `.github/workflows/p8-ci.yml` (6 jobs, fail-closed guarded suites against dedicated `ipoint_p8sN_*` DBs, never `ipoint_ci`) | `P8_S5D_FINAL_GATE_RECORD.md` (merge `eb83daaf`), D-066 |
| S5e | cross-platform consistency matrix (11 dimensions × all surfaces, all CONSISTENT), F-04 controller map (48 controllers all guarded, RBAC 49/49), F-06 drift set re-verified, zero-owner-bypass scan 445 files / 0 direct bypass, OpenAPI 285 paths | `P8_S5E_FINAL_GATE_RECORD.md` (merge `b043e932`), D-068 |
| S6 | load/performance/concurrency evidence: 12-journey L0/L1/L2 matrix (0 unexpected errors at reported levels), storm assertion set per write journey, retry-site table (0 unbounded), DB/worker observations, FIX-001..004 bounded fixes, additive L0 CI smoke; **OBS-04 documented HIGH residual** (§2.1) | `P8_S6_LOAD_PERFORMANCE_CONCURRENCY_REPORT.md`, `P8_S6_FINAL_GATE_RECORD.md` (merge `dc6a69ee`), D-069/D-070 |
| S7 | backup→restore→verify rehearsal (VERIFY PASS), migration fresh+upgrade rehearsal (40/40, drift clean), Redis module (ioredis on `RateLimitPort`, lock/queue ports, PG correctness zero-touch), health readiness DB+Redis checks, monitoring/alert/dashboard templates incl. OBS-04-class indicators, runbooks + release checklist, secret scan clean, security readiness; **SEC-01 documented** (10 pre-existing HIGH deps, decision PENDING Bryan) | `P8_S7_*` reports (merge `7916df69`), D-071/D-072 |

P8-S8 therefore covers **ONLY** contract §8 (G-08): the executed Full Final UAT. It does **not** re-run S5e's consistency matrix or scans, does **not** re-do S6 load storms, does **not** re-run S7 rehearsals, and does **not** build any new business feature. It reuses all of the above as already-closed evidence (§2.2) and adds the UAT layer that none of them provides: **end-to-end business acceptance executed across the real stack**.

### 2.1 The two PENDING items UAT must explicitly handle - OBS-04 and SEC-01

- **OBS-04 (High, OPEN - D-070/D-072, decision PENDING Bryan):** idle-in-transaction connection-lifecycle stall on the **reconciliation path** - sessions stuck "idle in transaction / ClientRead" on ALL pooled connections (10/10 observed via `pg_stat_activity`) holding `UPDATE reconciliation_runs`; requests block on the pool queue; no statement/lock timeout can fire because no statement is executing (client idle). FIX-002 (10s/3s `withIdempotency`) bounds waiters; FIX-004 closed the adjust-chain (J3/J9) sub-class; the engine-level residual is **a Command Center decision** (D-070 named remediation paths: Option A bounded P8-S2-domain fix / Option B documented-risk precedent; D-072 confirms decision PENDING Bryan). **Resolution or formal Bryan acceptance is REQUIRED before the Phase 8 final gate** (D-058: "0 unresolved HIGH"). S6 caps reconciliation at ≤5-way/serial for sustained runs; the mitigation set (5-way cap, watchdog 900s, client timeouts) is active at HEAD.
- **SEC-01 (D-072, decision PENDING Bryan):** 10 pre-existing HIGH dependency advisories (multer×4 / lodash×1 / js-yaml×2 / fast-uri×2 / react-router×1) - structurally proven pre-existing (frozen lockfile; ioredis 0 contribution), financial-path zero exposure, reachability analysis documented. Remediation decision PENDING Bryan (written risk acceptance at final gate vs bounded upgrade round; minimum recommended: multer via `@nestjs/platform-express`).
- **UAT acceptance wording (§3.7) must treat both explicitly**: UAT does not pretend they do not exist, does not re-classify them, does not remediate them outside the authorized decision path, and stamps the gate condition on the UAT report.

### 2.2 Existing UAT-relevant evidence - REUSE, do not regenerate

| Evidence | Scope | Location | Reuse in S8 |
|---|---|---|---|
| P7-S10 gate record 21/21 - gate 9 Browser/E2E host/CI-only (sandbox lacks chromium system libs; documented known limitation), gate 21 git local=remote; **K-02 D-056: BROWSER_E2E_GATE_PASSED 18/18 on real host** (Chromium 1.56.1 + real API + real PostgreSQL; 22/22 scenarios) | Repo-wide, Phase 7 state | `docs/06-phase-reports/p7-s10/P7-S10_FINAL_GATE_RECORD.md` | **Browser E2E baseline + host/CI constraint precedent** - UAT cites 18/18 as the Phase-7-scope baseline and extends it (do NOT re-run 18/18 as fresh UAT work unless O-2 so decides; sandbox cannot run it, host/CI only) |
| P8-S6 load harness - 12 journeys j01..j12 (`auth/login`, transactions, MCP debit, reward, commission, redemption, fulfilment, refund, Maker/Checker, reconciliation, reports, content delivery) with L0/L1/L2 profiles, fail-closed `P8S6_DESTRUCTIVE_TEST` guards, `P8SN_DESTRUCTIVE_TEST` pattern | API layer, Phase 8 state | `apps/api/src/load/**` (journeys/, harness.ts, run-load.ts), `P8_S6_LOAD_PERFORMANCE_CONCURRENCY_REPORT.md` | **API-layer scenario skeleton for UAT** - reuse journey structure + seeded fixture approach for UAT API scenarios at L0 (single-user acceptance); do NOT re-run L2 storms (OBS-04 + time cost) |
| P8-S6 journey matrix + OBS-01..05 catalogue (OBS-01 Medium quote-race 409 expected; OBS-02 Low 55P03 bounded; OBS-03 Low outbox expected rejection; OBS-05 Low 403-by-design) + FIX-001..004 | API layer, Phase 8 state | `P8_S6_LOAD_PERFORMANCE_CONCURRENCY_REPORT.md` §2/§9/§10 | **Expected-outcome catalogue** - UAT negative-path results must be cross-checked against it so expected outcomes are not logged as defects |
| S5e cross-platform consistency matrix (11 dimensions all CONSISTENT) + RBAC 49/49 + controller map + zero-bypass 445/0 | Phase 8 state | `P8_S5E_CONSISTENCY_MATRIX.md`, `P8_S5E_CONTROLLER_MAP.md`, `P8_S5E_DELIVERY_REPORT.md` | **Static baseline** - UAT verifies dynamically (runtime behavior) what S5e verified statically; UAT does not re-scan |
| S5b/S5c member/merchant web suites (311/311, 24/24 + api-client 100/100) + S5a admin-web 336/336 | Phase 8 state | `P8_S5B_FINAL_GATE_RECORD.md`, `P8_S5C_FINAL_GATE_RECORD.md`, `P8_S5A_FINAL_GATE_RECORD.md` | **UI unit/component coverage baseline** - UAT browser journeys build on top of these, do not replace them |
| S7 release checklist (20 lines, executable by P8-S9) | Phase 8 state | `P8_S7_OPS_RUNBOOKS_RELEASE_CHECKLIST.md` §4 | **Input to the UAT acceptance checklist** - UAT result matrix cross-references the release-checklist rows it evidences |
| Browser E2E suite in repo - `tests/e2e/{admin-shell, member-shell, phase7-admin}.spec.ts` (+ `merchant-admin.spec.ts` testIgnored per K-02/D-056), `apps/admin-web/src/{dashboard,kyc,merchant}.e2e.spec.ts` (mock-API), `apps/api/src/__tests__/app.e2e.spec.ts`, `playwright.config.ts` (4 webservers: api:3100, member-web:4173, merchant-web:4174, admin-web:4175), `scripts/run-e2e.mjs` (db:migrate + db:seed + playwright) | Repo, Phase 7 state | `tests/e2e/`, `apps/admin-web/`, `playwright.config.ts`, `scripts/run-e2e.mjs` | **Browser E2E extension base** - UAT expands this suite to member/merchant/admin critical journeys (contract AC), runs on host with real API + real PG |
| Migration state - 0000-0039 + `checksums.json` **40/40 frozen**; P8-S0 untracked baseline 119 (secret-free per F-05; do-not-bulk-add); L-8 (`packages/database/tests/p6-s1-schema.test.ts` stale filename) recorded repo-hygiene item (D-072) | Repo-wide | `packages/database/migrations/`, `P8_S0_UNTRACKED_CLASSIFICATION.md`, D-072 | **Do-Not-Touch scope** (§5); L-8 is recorded, NOT to be fixed by S8 |
| Node parity note - host Windows Node 26.4.0 vs CI ubuntu Node 24 (P4-S7 residual risk 2) | Environment | `P8_S6_LOAD_PERFORMANCE_CONCURRENCY_REPORT.md` §10, P4-S7 | **UAT runs on host Node 26**; parity note recorded, not resolved by S8 |

## 3. Scope - contract §8 (G-08), item by item

Contract §8 scope text (verbatim): *"real UAT across complete business journeys (member registration/login, market switching, merchant discovery, merchant transaction, MCP, iPoint earning, wallet, agent/referral commission, merchant package, special percentage, reward rules, redemption, fulfilment, refund, manual MCP Maker/Checker, manual iPoint Maker/Checker, admin workflows, audit, reports, ads/content, reconciliation, risk queues) + negative paths (cross-market denial, permission denial, duplicate/replay, insufficient balance, expiry, suspension, retry, worker failure, network/API failure, concurrency, stale/unavailable, failed fulfilment, refund retry, reconciliation mismatch). Critical user-facing journeys require actual Browser E2E (host or CI with Chromium)."*

AC (verbatim): *"UAT plan + executed scenarios + results matrix (pass/fail/evidence), browser E2E suite expanded to member/merchant/admin critical journeys, defect log with fixes."*

### 3.1 UAT scenario inventory - positive journeys (contract §8, one row each)

Every journey below is executed at **API level (L0, single-user acceptance profile)** and, where marked **UI**, also as a **browser journey** (see §3.5). Each row: scenario id (U-01..U-22), journey, execution layer (API / UI / both), reuse source (S6 journey id or prior suite) or NEW, and acceptance assertion set.

| # | Journey (contract §8) | Layers | Reuse | Acceptance assertions (UAT focus) |
|---|---|---|---|---|
| U-01 | member registration/login (+ OTP, MFA, session reuse) | API + UI (member) | J1 + P7-S10 gate 11 (20/20) | registration validations, OTP issue/verify, MFA step-up, session reuse detection, refresh, logout, rate-limit ceiling 429 |
| U-02 | market switching | API + UI (member) | S5e market-scope cells + P7-S10 gate 12 (55/55) | current-market resolution, switch, market-scoped lists, cross-market 409/403 denial (see U-23) |
| U-03 | merchant discovery | API + UI (member) | Phase 1 discovery + S5e | market-scoped discovery results, banner/content surfaces (P8-S1), no cross-market fallback |
| U-04 | merchant transaction (preview/confirm/receipt/history) | API + UI (merchant) | J2 + S5c merchant surface | preview correctness (exact-decimal amounts), confirm atomicity, receipt, history, idempotency key discipline, double-submit guard |
| U-05 | MCP (merchant cash pool) | API | J3 | MCP read/ledger, governed adjustment workflow (maker→submit→decision→execute), caps, audit, idempotency |
| U-06 | iPoint earning | API | J4 (reward earn) | earn exactly-once, reward sources/entries, rule-driven crediting, no double credit |
| U-07 | wallet | API + UI (member) | J4/J6 wallet surfaces + S5b wallet page | balance correctness, ledger visibility, exact-decimal display, no fabricated zero |
| U-08 | agent/referral commission | API | J5 + S5b team page | rate-driven commission, outbox drain to ledger, no double-processing, referral chain |
| U-09 | merchant package | API | Phase 4 package owner + S5e | package eligibility, purchase/confirm, package state lifecycle |
| U-10 | special percentage | API | Phase 4 + S5e | special % applied exactly, no override of safety/eligibility/price invariants |
| U-11 | reward rules | API | J4 + P7-S6A (D-051 owner) | rule schedule/list, canonical enum usage, market-scoped config |
| U-12 | redemption (catalog/quote/order/voucher) | API + UI (member) | J6 + S5b redemption page + P6-S6 | catalog market-scoped, quote correctness, order-create exactly-once, voucher issue, OBS-01 quote-race 409 treated as expected |
| U-13 | fulfilment (pickup/backorder/suspend/exception/retry) | API + UI (admin) | J7 + P7-S8 | queue transitions, suspend/resume, retry bounded, failed-fulfilment handling (see U-34) |
| U-14 | refund (reversal/refund) | API | J8 + SEC-02 owner + P7-S8 | reversal-request, refund-request, retry-safe exactly-once, refund ledger + wallet + inventory atomicity, identity guard |
| U-15 | manual MCP Maker/Checker | API + UI (admin) | J9 + P7-S7A | maker create/submit, checker approve/reject, exactly-one transition, step-up, audit |
| U-16 | manual iPoint Maker/Checker | API + UI (admin) | J9 + P7-S7B + SEC-01 owner | same assertion set as U-15 on the iPoint adjust chain |
| U-17 | admin workflows | API + UI (admin) | phase7-admin.spec.ts + P7-S8/S9 + P8-S1..S4 | admin CRUD across P8 domains, RBAC gates, market isolation, step-up where required |
| U-18 | audit | API + UI (admin) | P7-S9 audit viewer + E-12 | every mutating journey writes audit; immutability; filter/search; no raw ledger exposure to support role |
| U-19 | reports (R01-R19) | API + UI (admin) | J11 + P7-S9 + P8-S4 | asOf/freshness/stale/unavailable semantics, market scope, masking, no fabricated zero, no export |
| U-20 | ads/content | API + UI (member/admin) | J12 + P8-S1 | placement/schedule lifecycle, market isolation, member read surface, MCP debit via owner (append-only entry type) |
| U-21 | reconciliation (run/execute/exceptions) | API + UI (admin) | J10 + P8-S2 | run-create/execute, exception queue lifecycle, mismatch detection, no auto-correction, **OBS-04-mitigated execution profile only** (§3.7) |
| U-22 | risk queues | API + UI (admin) | P8-S3 | indicator definitions, detection queue, admin review surface, no enforcement side-effects beyond flagging/review |

### 3.2 UAT scenario inventory - negative paths (contract §8, one row each)

Each negative path is executed at API level (and UI level where the contract names a user-facing denial). Reuse = S6/S5e/P7-S10 evidence already covers it (UAT cross-checks + cites, does not re-invent); NEW = UAT must add an explicit scenario.

| # | Negative path (contract §8) | Reuse status | UAT execution |
|---|---|---|---|
| U-23 | cross-market denial (resource/current-market 409/403) | S5e market cells + P7-S10 gate 12 + S6 storms | NEW explicit UAT scenario: member/merchant/admin attempts on foreign-market resources → 403/409, zero cross-market fallback assertion |
| U-24 | permission denial (RBAC) | S5e RBAC 49/49 + P7-S10 gate 10 | NEW explicit UAT scenario: role without permission → 403 on API and no affordance/denied state on UI |
| U-25 | duplicate/replay (idempotency-key reuse, double submit) | S6 storms + S5c idempotency contract | UAT executes one-key replay → single result single financial chain; UI double-submit guard |
| U-26 | insufficient balance | S6 write-path storms (edge assertions) | NEW explicit UAT scenario: confirm/debit/redemption/refund with insufficient balance → clean rejection, no partial write, no negative balance |
| U-27 | expiry (OTP, quote, voucher, redemption rate window) | P7-S10 gate 11 (MFA/session) + P6 | NEW explicit UAT scenario per expiry surface: expired OTP/quote/voucher → documented error code, no consumption |
| U-28 | suspension (member/merchant/account) | P7-S10 + Phase 2 auth state | NEW explicit UAT scenario: suspended account cannot login/transact; documented status code |
| U-29 | retry (bounded retries, retry-safe) | S6 retry-site table (0 unbounded) | UAT cross-checks S6 retry-site table at runtime on one write path (confirm + refund retry) |
| U-30 | worker failure (outbox, daily jobs) | S6 outbox drain + OBS-03 expected rejection | NEW explicit UAT scenario: outbox dispatch failure state → bounded retry, no double-processing, backlog drains |
| U-31 | network/API failure (downstream unavailable) | S6 harness error handling | NEW explicit UAT scenario: API/DB/Redis unavailable → documented error contract, graceful degradation (S7 Redis fallback), no data corruption |
| U-32 | concurrency (double decision, storm race) | S6 §3.3 storm assertion set (J2/J3/J8/J9/J10) | UAT executes the J9 double-decision + J8 same-key replay at L0/L1 acceptance scale; cites S6 L2 evidence |
| U-33 | stale/unavailable (freshness semantics) | S5a/S5e capability states + J11 | NEW explicit UAT scenario: stale report/read surface → honest STALE/UNAVAILABLE state, no fabricated zero |
| U-34 | failed fulfilment | J7 + P7-S8 | UAT executes a fulfilment exception path → FULFILMENT_EXCEPTION state, retry bounded, audit rows |
| U-35 | refund retry (duplicate refund request) | J8 same-key storm + SEC-02 claim-first idempotency | UAT executes refund retry with same key → exactly one refund, second returns consumed/claim-first result |
| U-36 | reconciliation mismatch (difference detection) | P8-S2 suite 18/18 + J10 | UAT executes a seeded mismatch → difference detected, exception queued, no auto-correction, audit immutable |

### 3.3 Acceptance criteria dimensions (contract §8 AC + G-08 intent)

The UAT results matrix evaluates every scenario against these dimensions (each as a pass/fail/evidence column):

1. **Business correctness** - journey outcome matches the frozen Phase 1-7 + P8-S1..S4 contracts; exact-decimal amounts end-to-end; no fabricated zero; state transitions follow canonical enums (S5e state-lifecycle baseline).
2. **Permissions** - RBAC enforced at runtime (403 on denial, step-up where frozen), UI affordance/API guard consistency (S5e dimension 1 verified dynamically).
3. **Market isolation** - zero cross-market fallback; current-market/resource-market consistency (S5e dimension 2 + P7-S10 gate 12 at runtime).
4. **Idempotency/concurrency** - one key per attempt; replay returns single result; exactly-once financial deltas (S6 storm assertion set at UAT acceptance scale).
5. **Maker/Checker** - exactly one accepted transition per pending item; step-up; audit (P7-S10 gate 14 invariants at runtime).
6. **Historical immutability** - no rewrite of ledger/audit history; refunds/reversals are additive (P7-S10 gate 15/16 baseline).
7. **No cross-market fallback** - explicit zero-fallback assertion per negative path (U-23).
8. **0 Critical / 0 High** - UAT final state requires 0 unresolved Critical and 0 unresolved High defects from the UAT defect log (severity guide §8.2), with the OBS-04 / SEC-01 gate conditions handled per §3.7 (they are recorded PENDING items, not UAT-introduced defects, but they block any "0 unresolved HIGH" declaration until Bryan decides).

### 3.4 Relationship to the S6 12-journey harness - reuse vs new

- **REUSE (cite, do not re-run):** the S6 journey structure, fixture seeding approach, and expected-outcome catalogue (OBS-01..05) are the API-layer skeleton for U-01..U-22. S6 L1/L2 evidence (throughput, storm assertion sets, retry-site table) is cited as the load-context proof; UAT adds the **acceptance-context** execution (L0 single-user + explicit business assertions per scenario).
- **NEW in UAT:** (a) UI-layer browser journeys (§3.5) - S6 is API-only; (b) negative paths U-23/U-24/U-26/U-27/U-28/U-30/U-31/U-33/U-34/U-35/U-36 - S6 covers the storm/retry classes but not the explicit business-denial matrix of contract §8; (c) cross-domain journeys (e.g., transaction → commission → wallet → redemption chain) that no single S6 journey chains end-to-end.
- **Explicit non-goal:** UAT does not re-run L2 storms (OBS-04 reconciliation risk + evidence duplication); J10-class scenarios execute at the OBS-04-mitigated profile only (§3.7).

### 3.5 Browser E2E - 18/18 baseline inclusion + expansion (contract AC)

- **Baseline (18/18, K-02/D-056):** P7-S10 browser E2E 18/18 (22/22 scenarios) on real host (Chromium + real API + real PostgreSQL) is the Phase-7-scope baseline. UAT **cites** it and does not silently replace it; whether to re-run it fully inside UAT is O-2.
- **Expansion (contract AC "browser E2E suite expanded to member/merchant/admin critical journeys"):** new/expanded browser specs under `tests/e2e/` covering the critical user-facing journeys:
  - **member-web:** registration/login+OTP (U-01), market switching + discovery (U-02/U-03), merchant detail + transaction preview/confirm UI flow (U-04 member side), wallet view (U-07), redemption center flow (U-12), team/commission view (U-08), ads/content home surface (U-20).
  - **merchant-web:** login, overview, transaction preview/confirm/receipt/history UI (U-04 merchant side), MCP read surface (U-05).
  - **admin-web:** extend `phase7-admin.spec.ts` pattern to P8 domains - reconciliation run/exception UI (U-21), risk queues UI (U-22), ads/content admin (U-20), Maker/Checker approve/reject UI (U-15/U-16), reports R01-R19 freshness UI (U-19), audit viewer (U-18).
  - Negative-path browser coverage where user-facing: permission denial (U-24), cross-market denial (U-23), double-submit guard (U-25), stale/unavailable states (U-33).
- **Execution reality (K-02):** browser E2E runs **on host only** (sandbox lacks chromium system libs; CI-only per prior precedent D-056/P7-S10 gate 9 - the suite is host/CI-capable but the executed evidence is host). CI does not gain a browser job in S8 unless O-2 so decides. Every new browser spec uses the real API + real PostgreSQL pattern (`playwright.config.ts` webservers + `scripts/run-e2e.mjs`) against a dedicated `ipoint_p8s8_*` DB - never production data, never `ipoint_ci`.

### 3.6 Host/CI form

- **Host (primary):** Windows, Node 26.4.0, pnpm 9.15.9, PostgreSQL 17 (dedicated fresh `ipoint_p8s8_*` DBs, e.g. on `127.0.0.1:55432` per S6 compose or `55440` per P4-S7 env), Redis per S7 (limiter/lock surface, graceful degradation verified). API layer via the S6 harness pattern at L0; browser layer via `scripts/run-e2e.mjs` + `playwright.config.ts`.
- **CI (secondary):** additive, fail-closed only - the S6 L0 smoke already exists; S8 adds **no** new CI job by default (O-3). Full-repo CI must stay green at S8 close (nothing S8 adds may regress lint/format/typecheck/build/unit/integration/OpenAPI).
- **Data isolation:** every UAT run uses a fresh dedicated DB created via `db:migrate` + `db:seed` + UAT fixtures; no shared dev DB, no `ipoint_ci`, no production data (contract §8 Do-Not-Touch: production data).

### 3.7 OBS-04 / SEC-01 boundary - UAT acceptance wording (mandatory)

UAT acceptance must explicitly state the status dependency on the two PENDING items. Required wording in the UAT report (verbatim intent, not pretend-they-do-not-exist):

1. **OBS-04:** UAT reconciliation scenarios (U-21, U-36) execute at the **OBS-04-mitigated profile** (≤5-way/serial, watchdog, client timeouts, FIX-002 bounds) - sustained L2 reconciliation storms are explicitly out of UAT scope (S6 §9 evidence stands). The UAT report records: *"OBS-04 (High, OPEN, D-070/D-072) is a known engine-level limitation on the reconciliation path; remediation decision (Option A bounded P8-S2-domain fix / Option B documented-risk precedent) is PENDING Bryan. UAT does not remediate, re-classify, or hide it. Until Bryan decides, no '0 unresolved HIGH' declaration is possible; the P8-S9 final gate depends on that decision."*
2. **SEC-01:** the UAT report records: *"SEC-01 (10 pre-existing HIGH dependency advisories, D-072) is structurally pre-existing (frozen lockfile), financial-path zero exposure; written risk acceptance or bounded upgrade decision is PENDING Bryan. UAT defect log excludes it (not UAT-introduced) and flags it as a gate-condition dependency for P8-S9."*
3. **Gate condition stamp:** if either item is still PENDING at UAT close, the UAT results matrix header carries an explicit **GATE CONDITION** line (e.g., `PASS with documented limitations: OBS-04/SEC-01 PENDING Bryan - see §x; final 0C/0H declaration deferred to P8-S9 pending Bryan decision`). The verifier will check this stamp exists.

### 3.8 Defect handling - UAT defect log + §11 bounded fixes (A→B→C)

- Every UAT scenario records PASS / FAIL / PARTIAL with evidence (request/response pair, screen capture for UI, DB assertion output).
- **Defect log (contract AC "defect log with fixes"):** each defect carries id (DEF-xxx), severity (§8.2), scenario id, repro evidence, root cause, fix record (if fixed), re-test evidence, status (OPEN / FIXED / DOCUMENTED / WONT-FIX-with-rationale).
- **Fix path (contract §8 risk class MEDIUM-HIGH → A→B→C; §11 repair policy):** routine/repairable (lint, fixture, test-only, config) → repair and continue with a written record; **Critical/High → bounded repair round 1 → independent review (Reviewer B') + verification → round 2 → only then Command Center** (D-058 §21 stop conditions). Defect fixes are production code → **Codex CLI preferred (D-058 §5), D-060 alternate executor only**; OpenClaw does not write production code.
- **Zero-owner-bypass re-scan:** any production-code touch from a fix requires a re-run of the zero-owner-bypass scan over the changed scope (S5e method, 0 findings required); otherwise cite the S5e 445-file baseline as unchanged.
- **Expected outcomes are not defects:** OBS-01 (quote-race 409), OBS-02 (bounded 55P03), OBS-03 (outbox expected rejection), OBS-05 (403-by-design) are expected outcomes - UAT records them as expected, not as defects (cross-check §2.2 catalogue).

## 4. Safety gates (zero-bypass / data isolation / fail-closed / no-deployment)

1. **Zero-owner-bypass:** UAT executes through public API surfaces only; no direct owner instantiation, no DB manipulation outside test fixtures, no bypass of auth/RBAC (P7-S10 gate 18 / S5e scan state: 445 files / 0 bypass). If a fix touches production code, re-scan the changed scope → 0 findings.
2. **Data isolation / no production data (contract §8 Do-Not-Touch):** all UAT runs on dedicated fresh `ipoint_p8s8_*` DBs; never `ipoint_ci`, never shared dev DBs, never production data, no production deployment, no production credentials anywhere.
3. **Fail-closed spec guards:** any new API-level UAT spec with financial writes carries the `P8SN_DESTRUCTIVE_TEST` opt-in + dedicated DB guard (S1-S4/S6 pattern).
4. **Browser host/CI constraint:** browser E2E evidence is produced on host (K-02 precedent); the suite itself must stay runnable on CI (chromium-capable runner) without new CI wiring by default (O-3).
5. **Correctness gate:** UAT introduces no business-logic change, no migration (40/40 frozen), no benchmark/cosmetic-driven change, no weakening of guards/tests/type strictness.
6. **RBAC/permissions:** no new permission codes, no new API routes, no export surfaces.

## 5. Do Not Touch (frozen / prohibited)

- ❌ Frozen owners: Phase 1 merchant/MCP, Phase 2 member/auth, Phase 3 wallet/reward, Phase 4 transaction, Phase 5 agent/commission, Phase 6 redemption, Phase 7 admin-ops canonical owners + SEC-01/02 + P6-R2 hardened routes, P8-S1..S4 canonical owners (`ads-content`, `admin-reconciliation-ops`, `admin-risk-controls`, `admin-report-ops` extensions). Delegation/adapter pattern only; UAT is read/execute-through-API only.
- ❌ Migrations 0000-0039 + `checksums.json` (**40/40 frozen**). No new migration, no checksum edit, no drift. `packages/database/**` zero change.
- ❌ **Production data** (contract §8 Do-Not-Touch) - UAT uses dedicated test DBs only.
- ❌ OBS-04 / SEC-01 remediation - out of S8 scope (Command Center / Bryan decision path D-070/D-072); S8 records and stamps the dependency (§3.7), never self-authorizes a fix.
- ❌ No weakening/skipping of existing guards or tests; no deletion of tests; no TypeScript strictness reduction; no lint/format config changes; no `.npmrc` committed.
- ❌ No merge to `main`, no push to `main`, no production deployment, no destructive DB operations outside the guarded `ipoint_p8s8_*` test DBs.
- ❌ No `git add .` / `git add -A`; exact-path staging only; scoped conventional commits; no clean/stash/reset --hard/rebase/amend/force-push; no bulk-add of the untracked baseline (**119 preserved** - includes `.npmrc`, `.openclaw/`, and other P8-S0-classified untracked files; L-8 `p6-s1-schema.test.ts` stale filename recorded, NOT to be fixed by S8).
- ❌ All committed files UTF-8 **without BOM** (D-061 L-1..L-3 precedent: BOM/em-dash encoding corruption bit previous sub-phases - verify bytes before commit; ASCII-safe punctuation preferred in all committed docs).

## 6. Definition of done (verifier will check)

1. `docs/06-phase-reports/p8-s8/P8_S8_UAT_PLAN.md` - UAT plan: scenario inventory (U-01..U-36 mapping table to contract §8 journeys + negative paths), execution environment (host/CI, DBs, Redis, browsers), data/fixture strategy, severity guide (§8.2), execution schedule, acceptance criteria dimensions (§3.3), OBS-04/SEC-01 wording (§3.7), release-checklist cross-reference (S7 §4).
2. `docs/06-phase-reports/p8-s8/P8_S8_UAT_RESULTS_MATRIX.md` - executed results matrix: every scenario U-01..U-36 with PASS/FAIL/PARTIAL + evidence reference (request/response, screen capture, DB assertion, or cited prior suite); acceptance dimensions per scenario; GATE CONDITION stamp (§3.7) present and explicit; every claim traceable (S5e quality bar - no unverifiable assertions).
3. `docs/06-phase-reports/p8-s8/P8_S8_DEFECT_LOG.md` - defect log with fixes: DEF-xxx entries with severity, scenario link, repro evidence, root cause, fix record + re-test evidence, status; expected-outcome catalogue cross-check (OBS-01/02/03/05 not logged as defects); 0 unresolved Critical / 0 unresolved High from the UAT-introduced set at close (OBS-04/SEC-01 handled per §3.7, not as UAT defects).
4. Browser E2E expansion committed under `tests/e2e/` (and/or `apps/*/src/*.e2e.spec.ts` per existing convention) covering member/merchant/admin critical journeys; executed on host against real API + real PostgreSQL on a dedicated `ipoint_p8s8_*` DB; results (pass counts per suite + total) recorded in the results matrix; 18/18 baseline cited (re-run per O-2 or cited as-is).
5. Final evidence package ready for P8-S9: UAT report(s) + results matrix + defect log + browser suite results + release-checklist cross-reference table; stated relationship to P8-S9 (what P8-S9 re-runs vs cites).
6. Zero Do-Not-Touch violations: `git diff` shows no `packages/database/**` change, no production-code change outside documented §11 bounded fixes (each with fix record + zero-bypass re-scan), no `.npmrc`, no untracked-baseline additions, UTF-8 no BOM verified on all committed files, `git fsck` clean, tracked files outside the S8 commit set 0 modified.
7. Full-repo CI green at S8 close (lint/format/typecheck/build/unit/integration/OpenAPI per p8-ci.yml) - S8 adds no regression; no new CI job without O-3 decision.
8. Scoped conventional commits only (`docs(p8-s8): …`, `test(p8-s8): …` for browser specs/UAT tooling, `fix(p8-s8): …` only for §11 bounded fixes); commit set = S8 files only.
9. Executor provenance recorded per D-058 (executor class/model/branch/commits → `EXECUTOR_PROVENANCE_REGISTER.md` via OpenClaw at gate time); gate record `P8_S8_FINAL_GATE_RECORD.md` filed by OpenClaw (verifier), NOT by the executor; PHASE_REGISTRY/DECISION_LOG updated by OpenClaw only.

## 7. Deliverables

- `docs/06-phase-reports/p8-s8/TASK_BRIEF_P8S8.md` (this brief)
- `docs/06-phase-reports/p8-s8/P8_S8_UAT_PLAN.md` (UAT plan: scenarios U-01..U-36, environment, data, severity guide, acceptance dimensions, OBS-04/SEC-01 wording)
- `docs/06-phase-reports/p8-s8/P8_S8_UAT_RESULTS_MATRIX.md` (executed results matrix: pass/fail/evidence per scenario + GATE CONDITION stamp)
- `docs/06-phase-reports/p8-s8/P8_S8_DEFECT_LOG.md` (defect log with fixes: DEF-xxx, severity, repro, root cause, fix record, re-test, status)
- `docs/06-phase-reports/p8-s8/P8_S8_DELIVERY_REPORT.md` (methodology, evidence summary, OBS-04/SEC-01 gate-condition statement, release-checklist cross-reference, P8-S9 handoff list, bounded-fix records if any, commit map)
- `tests/e2e/**` - expanded browser E2E specs (member/merchant/admin critical journeys) committed as test code (guarded, real-API pattern)
- Optional UAT API-level tooling/specs under `apps/api/src/uat/**` or reuse of the S6 harness at L0 (guarded `P8S8_DESTRUCTIVE_TEST` pattern)
- Optional §11 bounded-fix commits (only with written fix records + zero-bypass re-scan)
- `docs/06-phase-reports/p8-s8/P8_S8_FINAL_GATE_RECORD.md` - filed by OpenClaw (verifier), not by the executor
- Evidence artifacts: raw outputs under gitignored `.local/p8-s8-uat/**` - summarized (never pasted wholesale) into the reports with per-claim references

## 8. Notes / guidance for the executor

### 8.1 Reading list

- Read first: `AGENTS.md`; `P8_S0_CONTRACT_FREEZE.md` §0/§8/§11/§12; `P8_S0_GAP_AUDIT_REPORT.md` (G-08 row + F-05/F-08); `P7-S10_FINAL_GATE_RECORD.md` (gate 9 K-02 host/CI constraint, gates 10-16 baselines, gate 21 git state); `P8_S6_LOAD_PERFORMANCE_CONCURRENCY_REPORT.md` (§2 matrix, §9 OBS-01..05, §10 commands); `P8_S5E_*` (consistency matrix + controller map + delivery report); `P8_S7_OPS_RUNBOOKS_RELEASE_CHECKLIST.md` §4 (release checklist - the UAT acceptance checklist input); `P8_S7_DELIVERY_REPORT.md` + D-071/D-072 (OBS-04/SEC-01 exact status); `playwright.config.ts` + `scripts/run-e2e.mjs` + one existing `tests/e2e/*.spec.ts` (browser pattern); one S1-S4 spec for the `P8SN_DESTRUCTIVE_TEST` guard shape; `apps/api/src/load/**` (journey skeleton).

### 8.2 Severity guide (mirror S5e/S6/S7)

- **Critical** = financial invariant / security bypass / cross-market contamination.
- **High** = broken contract a real user journey hits (blocks UAT pass for that scenario).
- **Medium** = contract drift / behavior deviation with no current user-visible break (must be fixed or explicitly DOCUMENTED with rationale).
- **Low** = cosmetic / documentation / evidence-precision.
- Approval bar at S8 close: **0 Critical / 0 High / 0 Medium** from the UAT-introduced defect set; Lows documented; OBS-04/SEC-01 handled per §3.7 (not UAT defects, but gate-condition dependencies).

### 8.3 Evidence reuse principle

P7-S10 gates and S5e are the *static/Phase-7* baselines (UAT verifies dynamically at Phase 8 state - do not copy old results as current); S6 is the *load-context* proof (UAT adds acceptance-context L0 execution + explicit business assertions - do not re-run L2 storms); S5b/S5c/S5a suites are the *UI unit* coverage (UAT browser journeys build on top - do not re-run the vitest suites as UAT work); the S7 release checklist is the *acceptance checklist input* (cross-reference, do not duplicate).

### 8.4 Host/CI + browser reality

- Browser E2E is **host-only for evidence** (K-02: sandbox lacks chromium system libs; precedent D-056/P7-S10 gate 9 - "host/CI-only", executed evidence on host). The suite must remain CI-runnable; adding a CI browser job is O-3.
- Sustained/concurrency evidence stays with S6 (host, L1/L2); UAT runs L0 acceptance profiles.
- Node 26 (host) vs Node 24 (CI) parity note applies (P4-S7 residual risk 2) - record it in the delivery report; do not resolve it in S8.

### 8.5 OBS-04 execution discipline

Reconciliation scenarios (U-21, U-36) execute at the mitigated profile (≤5-way/serial, watchdog, client timeouts, FIX-002 bounds). If a pool stall reproduces during UAT, record it in the defect log as an OBS-04-class observation with the S6 reproduction-ledger reference (`.local/p8-s6-load/2026-08-10T08-44Z-j10-l2-rerun-stall/OBSERVATION.md`) and the S7 alert-indicator reference - do NOT attempt an engine fix (out of scope; Command Center decision).

### 8.6 Raw evidence + honesty contract

Raw outputs (API responses, browser traces, DB assertions) go under gitignored `.local/p8-s8-uat/**`; reports summarize and reference. Never fabricate a PASS, a number, or a screenshot; a failed/absent run is reported as such (P4-S7/P8-S4/S6 precedent). Every matrix row must carry an evidence reference a later verifier (P8-S9) can re-run or inspect.

### 8.7 Git discipline

Scoped conventional commits (`docs(p8-s8): …`, `test(p8-s8): …`, `fix(p8-s8): …` only for §11 fixes); exact-path staging; no `.npmrc`; UTF-8 no BOM (verify bytes; ASCII-safe punctuation); no untracked-baseline additions; `git fsck` clean; tracked 0 modified outside the S8 commit set; provenance recorded by OpenClaw at gate time.

## 9. Open decision points (surface to OpenClaw / Command Center)

- **O-1 - UAT scenario depth and evidence form.** Default: full U-01..U-36 matrix executed at API level (L0 acceptance) + browser journeys for the critical user-facing set (§3.5), with S6/S5e/P7-S10 cited for the load/static layers. Alternative: full re-execution of every layer (incl. re-running S6 L1/L2 and the 18/18 baseline in full) - heavier, redundant evidence. Recommend the default; OpenClaw picks at dispatch.
- **O-2 - 18/18 browser baseline re-run.** Default: cite the P7-S10 18/18 (22/22 scenarios) as the Phase-7-scope baseline and run the UAT-expanded suite (baseline scenarios re-covered by the expanded member/admin suites where they overlap). Alternative: full re-run of the original 18/18 suite on host inside UAT before the expansion. Recommend: include the overlapping legacy scenarios inside the expanded suite run (single host run), no separate full baseline re-run.
- **O-3 - CI wiring for UAT.** Default: no new CI job; UAT browser evidence is host-only (K-02 precedent); full-repo CI stays as-is and green. Alternative: additive browser-E2E job on the ubuntu runner (chromium install, dedicated `ipoint_p8s8_*` DB) - CI time/stability cost; escalate if judged necessary.
- **O-4 - UAT data/fixture strategy.** Default: fresh dedicated `ipoint_p8s8_*` DB per run via `db:migrate` + `db:seed` + UAT fixtures (mirror S6/S7), plus fixture seeds for the negative paths that need seeded state (suspended accounts, expired vouchers, mismatched ledgers for U-36). Confirm no production-like dataset is required (test-scale is sufficient - S6/S7 precedent). Any production-data need is out of scope (contract §8 Do-Not-Touch).
- **O-5 - Defect disposition authority.** Default: UAT executor classifies and records; routine/repairable fixed in-brief with records; Critical/High → §11 bounded repair round 1 → Reviewer B' → round 2 → Command Center. Confirm the executor may apply D-060 alternate-executor fixes (Codex CLI priority per D-058 §5) and that OBS-04/SEC-01-class items never route into S8 fixes.
- **O-6 - OBS-04 / SEC-01 release wording at UAT close.** Default (§3.7): UAT reports PASS-with-documented-limitations + explicit GATE CONDITION stamp while either item is PENDING Bryan; no "0 unresolved HIGH" declaration by S8; the P8-S9 gate consumes the stamped result and depends on the Bryan decision. Alternative: hold UAT close until Bryan decides (blocks the S8→S9 handoff). Recommend the default (evidence flow continues; decision recorded as dependency).
- **O-7 - P8-S9 handoff boundary.** Confirm that the S8 deliverables (UAT plan + results matrix + defect log + expanded browser suite + delivery report) are the UAT input layer of the P8-S9 Production Readiness Gate (P8-S9 re-runs the gate matrix but does not re-execute UAT scenarios; it cites S8 results). Any UAT scenario P8-S9 is expected to re-run must be listed in the delivery report's handoff table.

_Forward-only brief. Do not delete or rewrite. Superseded only by a bounded addendum recorded in the P8-S8 gate record._
