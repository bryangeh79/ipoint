# TASK_BRIEF_P8S6 — Load / Performance / Concurrency (G-06)

> Phase 8 · Sub-phase **P8-S6** · Branch `task/p8-s6-load-performance-concurrency` (based on `phase/8-final-delivery-readiness` HEAD)
> Contract: `P8_S0_CONTRACT_FREEZE.md` §6 (G-06) — D-058 §16 domain, as frozen 2026-08-08
> Gap audit: `P8_S0_GAP_AUDIT_REPORT.md` row **G-06** (Load / Performance / Concurrency; no separate F-xx item assigned to S6 — G-06 is its own gap row)
> Executor: independent coding subagent (D-060 alternate executor authorization; Codex CLI regains implementation priority when available per D-058 §5) · Reviewer: independent Reviewer B' (D-060) · Verifier: OpenClaw host integration gate
> Risk class: **HIGH** (financial correctness under load) → A→B→C model (implementer → independent reviewer → independent verifier; implementer never self-approves)

---

## 1. Mission

Produce a **verifiable Load / Performance / Concurrency evidence package for iPoint V1 at Phase 8 state**: systematic load tests on the 12 critical journeys named in contract §6 (auth/login, transactions, MCP debit, reward, commission, redemption, fulfilment, refund, Maker/Checker, reconciliation, reports, content delivery) with measured throughput, latency p50/p95/p99 and error rates; a concurrency storm per critical flow proving **no double debit/reward/commission/redemption/refund, no duplicate ledger entries, no unsafe replay, no race corruption, no unbounded retries**; DB/worker behaviour measurement; retry-bound verification; a written report with every claim traceable to evidence — **never trading financial correctness for speed** — plus bounded fixes (§11 repair policy) **only** where a defect is actually proven.

This is primarily an **evidence + verification** sub-phase with a small, fail-closed test-tooling delivery. No feature work. No new migrations. Production code changes are limited to the §11 bounded-repair path (see §3.7).

## 2. Background — what S5a..S5e already closed (do NOT redo)

| Sub-phase | Closed | Evidence |
|---|---|---|
| S5a | admin-web renders all 19 reports (R01–R19), freshness honesty, no-export | `P8_S5A_FINAL_GATE_RECORD.md` (merge `e701ebd3`), admin-web 336/336 |
| S5b | member-web Wallet / Reward / Team / Redemption pages over frozen Phase 3/5/6 backends | `P8_S5B_FINAL_GATE_RECORD.md` (merge `a71d0a46`), member-web 311/311 |
| S5c | merchant-web transactions preview/confirm/receipt/history over frozen Phase 4 endpoints | `P8_S5C_FINAL_GATE_RECORD.md` (merge `7fe4ed28`), merchant-web 24/24 + api-client 100/100 |
| S5d | full-repo Phase 8 CI workflow `.github/workflows/p8-ci.yml` (6 jobs, fail-closed guarded suites S1–S4 against dedicated `ipoint_p8sN_*` DBs, never `ipoint_ci`) | `P8_S5D_FINAL_GATE_RECORD.md` (merge `eb83daaf`), D-066 |
| S5e | cross-platform consistency matrix (11 dimensions × all surfaces, all CONSISTENT), F-04 controller map (48 controllers all guarded, RBAC 49/49), F-06 drift set re-verified, zero-owner-bypass scan 445 files / 0 direct bypass, OpenAPI 285 paths | `P8_S5E_FINAL_GATE_RECORD.md` (merge `b043e932`), D-068 |

P8-S6 therefore covers **ONLY** contract §6 (G-06): load tests, performance baselines, concurrency verification, retry bounds, DB/worker behaviour, and the report — plus any proven-defect bounded fixes. It does **not** re-run S5e's consistency matrix, does **not** re-close F-04/F-06, and does **not** build any new business feature.

### 2.1 Existing concurrency / performance evidence — REUSE, do not regenerate

| Evidence | Scope | Location | Reuse in S6 |
|---|---|---|---|
| P4-S7 latency baselines p50/p95/p99 (Preview 83.92/100.21/100.29 ms; Confirm 308.93/525.12/525.93 ms; merchant list 33.13/36.56/36.75 ms; merchant detail 25.38/28.06/28.34 ms; 20 concurrent/endpoint, 0/80 unexpected errors) | Transaction domain only, local-scale (270 rows), pre-Phase-8 state | `docs/06-phase-reports/p4-s7/P4-S7_HARDENING_EVIDENCE.md` | **Historical baseline** for the transactions journey; S6 re-measures at Phase 8 state and reports delta vs baseline (baseline itself is NOT re-run) |
| P4-S7 concurrency storm + exactly-once counts (20 concurrent preview + 20 concurrent confirm → one result, one financial chain; reversal/refund stress; no duplicate financial writes) | Transaction domain | same | Method + assertions template for every S6 storm (count-based no-duplicate assertions) |
| P4-S7 retry bound (2 retries, SQLSTATE `40001`/`40P01` only; no retry on HTTP/validation/business failures) + `statement_timeout` 10 s + `lock_timeout` 3 s + normalized advisory lock order | Transaction domain | same | Retry-bound verification target + lock-contention measurement pattern |
| P7-S10 gate 13 idempotency+concurrency 35/35; gate 15 atomicity 36/36 (MCP / iPoint / refund SEC-02); gate 14 Maker/Checker 31/31; gate 18 zero-owner-bypass 292 files / 0 findings | Repo-wide, Phase 7 state | `docs/06-phase-reports/p7-s10/P7-S10_FINAL_GATE_RECORD.md` | Cite as pre-S6 functional-concurrency proof; S6 adds **load-context** evidence on top (storms under sustained concurrency) |
| P6-S6 atomic redemption concurrency isolation (`POSTGRES_ISOLATION` errors, wallet debit & atomic redemption) | Redemption domain | Phase registry P6-S6 / P6 gate records | Redemption storm design + expected isolation-error handling |
| P8-S1..S4 fail-closed integration suites + `P8SN_DESTRUCTIVE_TEST` opt-in guard pattern (dedicated `ipoint_p8sN_*` fresh DBs, never `ipoint_ci`) | P8 domains | `apps/api/src/**/*.integration.spec.ts` (e.g. `admin-reconciliation-ops.integration.spec.ts`), p8-ci.yml | **Mandatory guard pattern** for every new S6 spec — S6 harness follows it exactly |
| P8-S5e zero-owner-bypass scan (method + 445 files / 0 direct bypass) and OpenAPI 285 paths | Phase 8 state | `P8_S5E_DELIVERY_REPORT.md` | Re-run only if S6 touches production code (bounded fix); otherwise cite as unchanged baseline |
| P7-S10 gate 9 / K-02 — Browser/E2E host/CI-only constraint precedent | — | D-056, P7-S10 gate record | S6 records the analogous constraint: **sustained load is host-only** (see §8) |

## 3. Scope — contract §6 (G-06), item by item

Contract §6 scope text (verbatim): *"systematic load tests on critical journeys (auth/login, transactions, MCP debit, reward, commission, redemption, fulfilment, refund, Maker/Checker, reconciliation, reports, content delivery); verify absence of double debit/reward/commission/redemption/refund, duplicate ledger entries, unsafe replay, race corruption, deadlocks, unbounded retries; measure meaningful operational latency + DB/worker behaviour; bounded fixes only where defects are proven."*

### 3.1 Load test harness (tooling, method, scenarios) — code delivery

- **Zero new dependencies** (frozen lockfile — do not touch `pnpm-lock.yaml`): harness uses Node's built-in `fetch` (Node ≥ 24 available on host and CI) against the running API + real PostgreSQL, plus the existing `supertest` dev dependency for spec-level asserts. No k6/artillery/autocannon/benchmark package is added without an explicit OpenClaw decision (lockfile impact — see §9 open decision O-1).
- **Home**: committed harness + specs under `apps/api/src/load/**` (or a per-domain `*.load.spec.ts` next to each owner, mirroring the `*.integration.spec.ts` convention). Runner script committed alongside (e.g. `apps/api/src/load/run-load.mjs`) so the evidence is reproducible; raw outputs go to gitignored `.local/p8-s6-load/**`.
- **Fail-closed guard**: every spec that writes financial state requires the `P8S6_DESTRUCTIVE_TEST` env opt-in and a dedicated fresh `ipoint_p8s6_*` database (exact S1–S4 `P8SN_DESTRUCTIVE_TEST` pattern; never `ipoint_ci`; destructive-suite skip otherwise). Read-only measurement specs (latency on read surfaces) additionally declare their expected harmless profile.
- **Scenario levels** (configurable constants in the harness): L0 single-user smoke (used by CI), L1 ramp (e.g. 5→20→40 concurrent, stepwise), L2 sustained storm (20 concurrent per P4-S7 precedent; higher values configurable, host-only). Every run records: start/end time, concurrency, iterations, error set, percentiles, DB used.
- **Journey inventory (the 12 from contract §6)** with existing home to build on:

| # | Journey | Existing surface / evidence to build on |
|---|---|---|
| 1 | auth/login (+ refresh, MFA, session reuse) | `apps/api/src/auth/**` (`auth.integration.spec.ts`), P7-S10 gate 11 MFA/session 20/20 |
| 2 | transactions (preview/confirm/receipt/history) | Phase 4 owner; P4-S7 latency baseline; S5c merchant surface |
| 3 | MCP debit | `apps/api/src/merchant/mcp*.ts` + `mcp-adjustment` owner; P7-S10 gate 15 atomicity 36/36 |
| 4 | reward (earn/credit) | Phase 3 reward owner; `admin-reward-ops` adapter |
| 5 | commission (incl. outbox worker path) | Phase 5 commission owner + `transaction-commission-outbox.worker.ts` |
| 6 | redemption (order/approve/voucher) | Phase 6 redemption owner; P6-S6 atomic redemption; S5b member redemption write path |
| 7 | fulfilment (pickup/backorder/suspend/exception) | `admin-redemption-fulfilment-ops` (P7-S8) |
| 8 | refund (reversal/refund, retry-safe) | Phase 4 correction/refund; SEC-02 hardened routes; P7-S8 refund ops |
| 9 | Maker/Checker (manual MCP + manual iPoint flows) | P7-S10 gate 14 Maker/Checker 31/31; `admin-*-ops` maker/checker adapters |
| 10 | reconciliation (run/exception queue) | `admin-reconciliation-ops` (P8-S2), S2 suite 18/18 |
| 11 | reports (R01–R19 read surfaces, asOf/freshness) | `admin-report-ops` (P7-S9) + P8-S4; S4 suite 32/32 |
| 12 | content delivery (ads/content member read surface) | `ads-content` (P8-S1), S1 suite 12/12 |

### 3.2 Performance baselines — p50/p95/p99 + throughput + error rates (evidence)

- For **each** of the 12 journeys, at L1/L2: report **throughput (req/s or ops/min), latency p50/p95/p99 (ms), error rate (expected vs unexpected)**. Zero unexpected errors is the target (P4-S7 precedent: 0/80).
- Transactions journey: report **delta vs the P4-S7 historical baseline** (same endpoint families) and explain any material delta (Phase 8 state includes more middleware/audit/P8 tables — expected drift must be explained, not hidden).
- Read-heavy journeys (reports, content delivery) additionally record response-size profile and stale/unavailable capability-state behaviour under load (no fabricated zeros; honest freshness semantics per S5a/S5e contract).
- Wording follows P4-S7: *"engineering evidence, not a production SLA."* Do not claim production capacity numbers.

### 3.3 Concurrency scenarios per critical flow (evidence + assertions)

For every **write-path** journey (2,3,4,5,6,7,8,9,10) run a storm (L2) with the exact no-duplicate assertion set:

1. **No double debit/reward/commission/redemption/refund** — exact-once financial deltas: balance deltas, commission records, redemption order/voucher counts, refund amounts sum to exactly the intended value (assert against pre/post state counts + sum-of-deltas; reuse P4-S7 exactly-once counting method).
2. **No duplicate ledger entries** — ledger row counts for the operation key equal expected count (1); no duplicate `(operation_key, entry_type)` rows.
3. **No unsafe replay** — concurrent + sequential replay of the same idempotency key / preview reference / workflow reference returns the same single result and single financial chain (P4-S7 pattern: 20 concurrent preview + 20 concurrent confirm → one chain).
4. **No race corruption** — final state equals serial expectation (no lost updates: balances, statuses, exception queues); no cross-party/cross-market leakage under concurrency.
5. **Deadlock observation** — record any `40P01`/lock-timeout events: expected ≤ bounded retry window (P4-S7: retry SQLSTATE `40001`/`40P01` only, 2 retries max); any deadlock that escapes the retry bound or exceeds `lock_timeout` 3 s is a **defect** (severity-classified, §8 severity guide).
6. **Maker/Checker storm** — concurrent double-approve/double-reject on the same pending item must yield exactly one accepted transition (gate 14 invariants under load).
7. **Read/write mixed storms** — e.g. reports + reconciliation running while transactions/MCP debit write (interference check; advisory-lock contention measurable).

### 3.4 DB / worker behaviour measurement (evidence)

- **EXPLAIN key read paths** per journey (reuse P4-S7 method): confirm intended index usage on merchant/member/detail/queue read paths at Phase 8 state (now includes P8 tables); any new sequential scan on a hot path = observation (severity-classified; **no index migration without a §3.7 bounded-fix decision**).
- **Lock/timeout effectiveness under load**: `statement_timeout` 10 s and `lock_timeout` 3 s actually fire under storm; advisory-lock contention profile (avg/max wait) on operation-keyed flows.
- **Outbox worker** (`transaction-commission-outbox.worker.ts`) and **daily-job scheduler**: drain behaviour under sustained commission/redemption writes; retry counts; no unbounded backlog growth within the test window; no double-processing of a single outbox row.
- **PG behaviour**: connection count / pool behaviour under L2 (no connection exhaustion), transaction rollback counts (expected = injected/business failures only), any `55000`-class isolation errors surfaced and handled per contract (P6-S6 `POSTGRES_ISOLATION` precedent).

### 3.5 Retry bound verification (evidence)

- Inventory **every retry site** in repo at Phase 8 state: API service retries (P4-S7: 2 max, SQLSTATE-limited), outbox worker retries, api-client retries, UI double-submit guards (S5b/S5c idempotency-key patterns), redemption/refund retry surfaces (P7-S8). Assert per site: **bounded count, idempotent-safe, no unbounded loop, no retry on non-retryable classes**.
- Static scan + runtime proof: any unbounded loop (e.g. `while` without bound, `setTimeout` re-arm without cap) on a retry path = **defect** (severity-classified). Deliverable: retry-site table (site → bound → guard → evidence) in the report.

### 3.6 Fail-closed CI 衔接 (code delivery, additive)

- The S6 **smoke suite (L0)** is wired into `.github/workflows/p8-ci.yml` following the S5d fail-closed pattern: dedicated `ipoint_p8s6_*` DB, `P8S6_DESTRUCTIVE_TEST` opt-in, bounded scale (small concurrency, short runtime), added as an additive step/job — **never** altering the S1–S4 guards, DBs, or the existing 6-job structure beyond additive extension.
- **Sustained load (L1/L2) is NOT CI material** (ephemeral shared runners; percentile stability and long storms are host evidence) — recorded as a documented limitation in the report (K-02-class constraint, §8).
- CI must stay green at the end of S6 (lint/format/typecheck/build/unit/integration/OpenAPI per p8-ci.yml) — S6 adds no regression.

### 3.7 Bounded fixes per §11 — boundary judgement (production code, only when proven)

- Default expectation: **zero production code change** (all S6 deliverables are test code + evidence + report).
- A defect proven by S6 evidence (e.g. deadlock escaping retry bound, double-write, unbounded retry, race corruption, correctness-affecting latency pathology) is handled as a **bounded fix per contract §11 repair policy**: routine/repairable → repair and continue; **Critical/High → bounded repair round 1 → independent review + verification → round 2 → only then Command Center** (D-058 §21 stop conditions). Each bounded fix requires a written fix record (root cause, fix, tests, evidence) in the delivery report, and a **re-run of the zero-owner-bypass static scan** over the changed area (method: P7-S10 gate 18 / S5e scan).
- **No schema migration is expected**: migrations 0000–0039 + checksums 40/40 are frozen. If a proven defect genuinely requires a schema change, STOP and escalate to OpenClaw/Command Center (irreversible-data / frozen-migration boundary — do not add migration 0040 on your own authority).
- **Never** change financial correctness for benchmark speed (contract §6 Do-Not-Touch; e.g. no skipping audit writes, no weakening advisory locks or timeouts, no batching that breaks exactly-once, no index-only "optimization" that changes semantics).

### 3.8 Code/test deliveries vs documentation deliveries

| Type | Items |
|---|---|
| Code (test tooling) | `apps/api/src/load/**` harness + runner + per-journey load specs (guarded), additive `p8-ci.yml` smoke wiring |
| Code (production) | **None by default**; only §11 bounded fixes with written fix records |
| Documentation | `P8_S6_LOAD_PERFORMANCE_CONCURRENCY_REPORT.md` (+ this brief; gate record `P8_S6_FINAL_GATE_RECORD.md` filed by OpenClaw after verification) |
| Evidence artifacts | Raw logs under gitignored `.local/p8-s6-load/**`, summarized (not pasted wholesale) into the report with per-claim references |

## 4. Safety gates (zero-bypass / fail-closed / performance gate)

1. **Zero-owner-bypass**: S6 introduces no direct invocation of frozen owners outside adapter/delegation patterns (P7-S10 gate 18 / S5e scan state: 445 files / 0 bypass). If any production file is touched (bounded fix), re-run the scan over the changed scope and assert 0 findings; otherwise cite the S5e scan as the unchanged baseline.
2. **Fail-closed spec guards**: every new S6 spec with financial writes carries the `P8S6_DESTRUCTIVE_TEST` opt-in + dedicated DB guard (S1–S4 H-01 pattern). No S6 spec runs against `ipoint_ci` or shared dev DBs.
3. **Performance/regression gate**: storm error rate = 0 unexpected; latency delta vs baseline explained; no correctness-for-speed trade accepted; no unbounded retry found; no deadlock escapes retry/lock bounds.
4. **RBAC / permissions**: S6 adds **no** permission codes, **no** new API routes, **no** export surfaces. Evidence tooling uses existing auth (service accounts / existing test credentials patterns from prior suites).
5. **No secrets**: harness/env files contain only test placeholders (existing `AUTH_OTP_PEPPER`-style CI test values); no production credentials anywhere.

## 5. Do Not Touch (frozen / prohibited)

- ❌ Frozen owners: Phase 1 merchant/MCP, Phase 2 member/auth, Phase 3 wallet/reward, Phase 4 transaction, Phase 5 agent/commission, Phase 6 redemption, Phase 7 admin-ops canonical owners + SEC-01/02 + P6-R2 hardened routes, P8-S1..S4 canonical owners (`ads-content`, `admin-reconciliation-ops`, `admin-risk-controls`, `admin-report-ops` extensions). Delegation/adapter pattern only.
- ❌ Migrations 0000–0039 + `checksums.json` (40/40 frozen). No new migration without escalation (§3.7).
- ❌ No benchmark-speed-driven changes to financial correctness (no skipped audit writes, no weakened locks/timeouts/retries, no semantics-changing "optimizations").
- ❌ No weakening/skipping of existing guards or tests; no deletion of tests; no TypeScript strictness reduction; no lint/format config changes.
- ❌ No new permission codes, no new API routes, no export/download surfaces.
- ❌ No merge to `main`, no push to `main`, no production deployment, no destructive DB operations outside the guarded `ipoint_p8s6_*` test DBs.
- ❌ No `git add .` / `git add -A`; exact-path staging only; scoped conventional commits; no clean/stash/reset --hard/rebase/amend/force-push; no bulk-add of the untracked baseline (119 preserved).
- ❌ Worktree `.npmrc` must not be committed. All committed files UTF-8 **without BOM** (previous sub-phases were bitten by BOM/em-dash encoding corruption — see D-061 L-1..L-3; verify bytes before commit).

## 6. Definition of done (verifier will check)

1. `docs/06-phase-reports/p8-s6/P8_S6_LOAD_PERFORMANCE_CONCURRENCY_REPORT.md` exists with: harness description + commands, journey matrix covering **all 12** journeys with throughput / p50/p95/p99 / error rate per journey, transactions delta vs P4-S7 baseline, storm results with the §3.3 no-duplicate assertion set (pass/fail per flow), retry-site table (bounded, idempotent-safe), DB/worker behaviour section (EXPLAIN, lock/timeout, outbox drain), limitations section (host-only sustained load, K-02-class; Node 26 host vs Node 24 CI parity note), severity-classified discrepancy log (0C/0H/0M required for approval; Lows documented), and (if any) bounded-fix records per §11.
2. Every claim in the report is traceable: evidence reference (file/line, test id, or `.local/p8-s6-load/**` raw output) per row — no unverifiable assertions (S5e quality bar).
3. Harness committed under `apps/api/src/load/**` with the `P8S6_DESTRUCTIVE_TEST` fail-closed guard; specs run green on host at L0/L1/L2 (recorded), smoke subset green in CI wiring (if wired — see O-2).
4. No duplicate financial writes / no unsafe replay / no race corruption / no unbounded retries / no escaped deadlocks — asserted per critical write flow with count-based checks; zero unexpected errors in measured storms.
5. Zero production-code change **unless** a documented §11 bounded fix (then: fix record + zero-bypass re-scan + reviewer re-verification). Zero migrations. Checksums 40/40 untouched.
6. `p8-ci.yml` (if modified) remains additive/fail-closed; full-repo CI evidence green at S6 close (lint/format/typecheck/build/unit/integration/OpenAPI — mirror S5d gate commands).
7. Scoped commits only; commit set = S6 files only (docs under `docs/06-phase-reports/p8-s6/`, harness under `apps/api/src/load/**`, optional additive CI change); no `.npmrc`, no untracked-baseline files, UTF-8 no BOM, `git fsck` clean.
8. Executor provenance recorded per D-058 (executor class/model/branch/commits → `EXECUTOR_PROVENANCE_REGISTER.md` via OpenClaw at gate time).
9. Gate record `P8_S6_FINAL_GATE_RECORD.md` filed by OpenClaw after verification; PHASE_REGISTRY/DECISION_LOG updated by OpenClaw (NOT by the executor).

## 7. Deliverables

- `docs/06-phase-reports/p8-s6/TASK_BRIEF_P8S6.md` (this brief)
- `docs/06-phase-reports/p8-s6/P8_S6_LOAD_PERFORMANCE_CONCURRENCY_REPORT.md` (main report)
- `apps/api/src/load/**` — harness (runner script + guarded load specs) committed as test code
- Optional additive `.github/workflows/p8-ci.yml` smoke wiring (see O-2)
- Optional §11 bounded-fix commits (only with written fix records)
- `docs/06-phase-reports/p8-s6/P8_S6_FINAL_GATE_RECORD.md` — filed by OpenClaw (verifier), not by the executor

## 8. Notes / guidance for the executor

- **Read first**: `AGENTS.md`; `P8_S0_CONTRACT_FREEZE.md` §0/§6/§11; `P8_S0_GAP_AUDIT_REPORT.md` (G-06 row); `P4-S7_HARDENING_EVIDENCE.md` (method + numbers); `P7-S10_FINAL_GATE_RECORD.md` (gates 13/14/15/18 methods); `P8_S5E_DELIVERY_REPORT.md` (scan methods, zero-bypass baseline); `P8_S5D_FINAL_GATE_RECORD.md` + `.github/workflows/p8-ci.yml` (fail-closed pattern); one S1–S4 spec for the `P8SN_DESTRUCTIVE_TEST` guard shape (e.g. `admin-reconciliation-ops.integration.spec.ts`).
- **Evidence reuse principle**: P4-S7 latency numbers are the *historical* transaction baseline (re-measure at Phase 8 state, report delta — do not copy old numbers as current); P7-S10 gates 13/14/15 are *functional* concurrency proof (S6 adds load-context storms — do not re-run the full 35/35 as S6 work); S5e scan is the *current* zero-bypass baseline (re-run only if production code touched).
- **Severity guide** (mirror S5e): Critical = financial invariant / security bypass under load; High = broken contract a real user journey hits under load (escaped deadlock, double-write, unbounded retry); Medium = drift/observation with no current user-visible break; Low = cosmetic/documentation. Approval bar: 0 Critical / 0 High / 0 Medium.
- **Host/CI constraints**: sustained load (L1/L2) runs on the host (Windows, Node 26.4.0, pnpm 9.15.9, PostgreSQL 17 on `127.0.0.1:55440` per P4-S7 environment); CI is ubuntu-latest Node 24 — load numbers are engineering evidence, not an SLA, and the Node 26 (host) vs Node 24 (CI) parity note applies (P4-S7 residual risk 2). Record the host-only-load limitation explicitly (K-02-class: browser E2E was host/CI-only for the same reason).
- **No new dependencies**: frozen lockfile. Node built-in `fetch` + existing `supertest` suffice; if a dedicated load tool is truly required, raise O-1 instead of adding it silently.
- **Raw evidence**: keep raw outputs in `.local/p8-s6-load/**` (gitignored — never commit raw logs); the report summarizes and references them. Never fabricate numbers; a failed/absent measurement is reported as such (honesty contract, P4-S7/P8-S4 precedent).
- **Migration/checksum discipline**: confirm `git diff` shows no `packages/database/**` change in the final commit set.
- **Provenance**: your executor class/model/branch/commits are recorded in `EXECUTOR_PROVENANCE_REGISTER.md` by OpenClaw at gate time — keep commits scoped and messages conventional (`test(p8-s6): …`, `docs(p8-s6): …`, `ci(p8-s6): …`).

## 9. Open decision points (surface to OpenClaw / Command Center)

- **O-1 — Load tooling**: default is zero-dependency in-repo harness (Node fetch + supertest, frozen lockfile). If the executor judges a dedicated tool (k6/artillery/autocannon) materially necessary, that is an explicit decision (pnpm-lock.yaml impact → CI re-validation) — escalate, do not self-authorize.
- **O-2 — CI wiring depth**: recommended = additive L0 smoke step/job in `p8-ci.yml` (fail-closed, S1–S4 pattern). Alternative = leave CI untouched and record the smoke as host evidence only (deferred to P8-S9 full gate). OpenClaw picks at dispatch; default per this brief is the additive smoke.
- **O-3 — Scope boundary confirmation**: G-06 is evidence + bounded-fix-only (no feature work, no migrations). If S6 evidence proves a schema-level defect, the migration question returns to Command Center (frozen 40/40 boundary) — this brief does **not** authorize migration 0040.
- **O-4 — Latency target values**: contract §6 asks for "meaningful operational latency" with no numeric SLA. S6 therefore reports measured values + delta-vs-baseline + observations; it does **not** invent pass/fail thresholds (any threshold proposal is a configurable/decision item, not an S6 invention).

_Forward-only brief. Do not delete or rewrite. Superseded only by a bounded addendum recorded in the P8-S6 gate record._
