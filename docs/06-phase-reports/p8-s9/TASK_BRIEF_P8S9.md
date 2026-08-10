# TASK_BRIEF_P8S9 - Production Readiness Gate (G-09)

> Phase 8 - Sub-phase **P8-S9** - Execution branch `task/p8-s9-production-readiness-gate` (based on `phase/8-final-delivery-readiness` HEAD)
> Contract: `P8_S0_CONTRACT_FREEZE.md` §9 (G-09) - D-058 §19 domain, as frozen 2026-08-08
> Gap audit: `P8_S0_GAP_AUDIT_REPORT.md` row **G-09** (Production Readiness Gate: "P7-S10 21/21 gate was Phase-7-scoped" - the Phase 8 final gate must re-verify the full §19 matrix at Phase 8 state)
> Executor: **Gate execution by verifier class** (contract §9 risk class HIGH "acceptance evidence" -> A->B->C) - independent verification agent (D-060 reviewer/verifier pool) - OpenClaw = integration gate keeper + gate record filer (no production code) - Defect fixes (only if a gate rerun proves a defect): A->B->C (Codex CLI preferred per D-058 §5, D-060 alternate)
> Verifier: OpenClaw host integration gate
> Risk class: **HIGH (acceptance evidence - final gate)** -> A->B->C for any defect fix; gate execution itself is verification-class work

---

## 1. Mission

Execute the **P8-S9 Production Readiness Gate (G-09) - the FINAL GATE of Phase 8 and of iPoint V1 engineering** - as a verifiable judgment process at Phase 8 state, per contract §9 / D-058 §19: consume the S1-S8 closed evidence set (cite, do not re-run host-only heavy evidence), re-run the gate-level lightweight checks that are cheap and executable at gate time (migration checksum/drift, full-repo typecheck/build/lint/format/OpenAPI, unit + guarded integration suites, RBAC matrix, zero-owner-bypass scan, secret scan, dependency audit, git state), execute the §19 gate matrix row by row, and produce a **definitive gate outcome** consumed by P8-S10 (Final Delivery Report).

The gate must end in one of two states:

1. **GATE GREEN** - gate matrix 100% green (or documented deviations with severity per contract AC), **0 unresolved CRITICAL / 0 unresolved HIGH** demonstrable at gate close; the gate record then carries the engineering recommendation `READY_FOR_COMMAND_CENTER_FINAL_ACCEPTANCE` (the only declaration OpenClaw may make; `PHASE_8_ACCEPTED/COMPLETE/CLOSED/FROZEN/IPOINT_V1_ENGINEERING_COMPLETE` remain exclusive to the Command Center per D-058).
2. **GATE CONDITION NOT FULLY MET** - if any PENDING Bryan decision (OBS-04, SEC-01, /members/me/qr L-06 gap) is still unresolved at gate close, or any gate row fails, the gate report MUST output an explicit **"GATE CONDITION 未满足项清单" (list of unmet gate conditions)** with severity, decision path, and recommendation, and hand that list to the Command Center / Bryan for final adjudication. The gate NEVER pretends 0 unresolved HIGH when a PENDING decision exists (honesty contract, D-058 "0 unresolved HIGH" final condition, S8 GATE CONDITION stamp precedent).

This is an **evidence + verification sub-phase**. No feature work. No new migrations (40/40 frozen). No production code by default; production changes are limited to §11 bounded fixes for defects actually proven by a gate rerun (see §3.4). The gate's outputs are the authoritative engineering input for **P8-S10 (Final Delivery Report)**; the boundary is: S9 produces the gate matrix verdict + unmet-conditions list + Bryan decision recommendations; S10 consumes them and composes the full D-058 §24 delivery inventory (including recomputed SELLABLE_DELIVERABLE_PROGRESS / PRODUCTION_READY_V1_PROGRESS - see §8.6).

## 2. Background - what S1..S8 already closed (do NOT redo)

| Sub-phase | Closed | Core evidence | Gate matrix rows that consume it |
|---|---|---|---|
| S1 (D-061) | Ads & Content Operations; migration 0037; **checksums 38/38**; 15/15 fresh-PG integration; RBAC ads/content.view/manage | `P8_S1_FINAL_GATE_RECORD.md` (merge `d41a33d7`), `P8_S1_DELIVERY_REPORT.md` | G-11 (S1 guarded suite), G-14 (RBAC catalog), G-21 (ads read surface via U-20) |
| S2 (D-062) | Reconciliation engine; migration 0038; **checksums 39/39**; 25/25 unit+integration; no destructive auto-correction | `P8_S2_FINAL_GATE_RECORD.md` (merge on `phase/8`), `P8_S2_DELIVERY_REPORT.md` | G-11 (S2 guarded suite 18/18 at S5d), G-21 (reconciliation invariants via U-21/U-36), G-22 (write-once triggers) |
| S3 (D-063) | Risk/Fraud/Operational controls; migration 0039; **checksums 40/40 frozen**; 35/35 schema + 32/32 tests; zero enforcement side-effects; BOM/em-dash repair precedent | `P8_S3_FINAL_GATE_RECORD.md` (merge `04babe35`), `P8_S3_DELIVERY_REPORT.md` | G-01 (checksum 40/40), G-11 (S3 guarded suite 20/20), G-22 (write-once triggers), G-27 (0C/0H) |
| S4 (D-062) | Advanced Reports R05-R19 on `admin-report-ops`; zero migrations; OpenAPI **299 paths**; 34/34 unit + 32/32 advanced integration + 14/14 P7-S9; no export | `P8_S4_FINAL_GATE_RECORD.md` (merge `79a86e57`), `P8_S4_DELIVERY_REPORT.md` | G-09 (OpenAPI baseline), G-11 (S4 guarded suite 32/32), G-23 (masking) |
| S5a (D-063) | Admin-web renders all 19 reports; admin-web **336/336** | `P8_S5A_FINAL_GATE_RECORD.md` (merge `e701ebd3`) | G-05 (admin-web), G-10 (unit), G-21 (reports U-19) |
| S5b (D-064) | member-web Wallet/Reward/Team/Redemption pages; member-web **311/311** + api-client 95/95 | `P8_S5B_FINAL_GATE_RECORD.md` (merge `a71d0a46`) | G-03 (member-web), G-06 (api-client), G-13 (PWA journeys) |
| S5c (D-065) | merchant-web transactions preview/confirm/receipt/history; merchant-web **24/24** + api-client **100/100**; new vitest infra | `P8_S5C_FINAL_GATE_RECORD.md` (merge `7fe4ed28`) | G-04 (merchant-web), G-06 (api-client), G-13 (PWA journeys) |
| S5d (D-066) | Full-repo Phase 8 CI `.github/workflows/p8-ci.yml` (6 jobs: quality/build/unit/database/openapi/api-integration); 2,070 unit tests; guarded S1-S4 suites 12/12+18/18+20/20+32/32 | `P8_S5D_FINAL_GATE_RECORD.md` (merge `eb83daaf`) | G-02..G-11 rerun methodology + CI evidence baseline |
| S5e (D-068) | Consistency matrix **11 dimensions all CONSISTENT**; RBAC **49/49**; controller map 48/48 guarded (F-04 closed); zero-owner-bypass **445 files / 0**; OpenAPI **285 paths**; F-06 drift set re-verified | `P8_S5E_CONSISTENCY_MATRIX.md`, `P8_S5E_CONTROLLER_MAP.md`, `P8_S5E_DELIVERY_REPORT.md`, `P8_S5E_FINAL_GATE_RECORD.md` (merge `b043e932`) | G-14 (RBAC), G-16 (multi-market), G-23 (zero-bypass), G-09 (OpenAPI), G-17/G-18 (idempotency/concurrency dims) |
| S6 (D-070) | Load/performance/concurrency: **12-journey L0/L1/L2** matrix (0 unexpected errors at reported levels), storm assertion set, retry-site table (0 unbounded), FIX-001..004 bounded fixes, additive L0 CI smoke; **OBS-04 documented HIGH residual** | `P8_S6_LOAD_PERFORMANCE_CONCURRENCY_REPORT.md` (merge `dc6a69ee`) | G-17 (idempotency), G-18 (concurrency), G-28 (load evidence), G-30 (OBS-04 decision row) |
| S7 (D-072) | Backup->restore->verify rehearsal **VERIFY PASS**; migration fresh+upgrade rehearsal **40/40 x2**; Redis module (ioredis 6.0.0 on `RateLimitPort`, lock/queue ports, PG correctness zero-touch, 14/14 suite); health readiness DB+Redis; monitoring/alert/dashboard templates (OBS-04-class indicators); runbooks + release checklist; log redaction; secret scan **1205 CLEAN**; **SEC-01 documented** (10 pre-existing HIGH deps) | `P8_S7_DELIVERY_REPORT.md`, `P8_S7_BACKUP_RESTORE_DR_REPORT.md`, `P8_S7_MIGRATION_REHEARSAL_REPORT.md`, `P8_S7_MONITORING_ALERTING_REPORT.md`, `P8_S7_OPS_RUNBOOKS_RELEASE_CHECKLIST.md`, `P8_S7_SECURITY_READINESS_REPORT.md` (merge `7916df69`) | G-01 (migration rehearsal), G-25 (SEC-01), G-26 (runtime checks), G-28 (ops readiness), G-30 (decision row) |
| S8 (D-074) | Full Final UAT: **U-01..U-36 36/36 PASS (41/41 tests, 224/224 assertions)** + **browser E2E 7/7 PASS** (real Chromium + real API + real PG); UAT-introduced defects **0C/0H/0M** after §11 rounds (DEF-001 wallet member scope, DEF-002 GET /members/me added, **DEF-003 Critical POST /wallets removed**, DEF-004 wallet-entries IDOR scoped, M-1 400 mapping, M-2 counts); OpenAPI **300 paths**; observations OBS-06/OBS-07/OBS-10 recorded; GATE CONDITION stamp applied | `P8_S8_UAT_PLAN.md`, `P8_S8_UAT_RESULTS_MATRIX.md`, `P8_S8_DEFECT_LOG.md`, `P8_S8_DELIVERY_REPORT.md` (merge `8095a9b6`), `apps/api/src/uat/**`, `tests/e2e/p8-s8-uat.spec.ts` | G-12 (browser E2E), G-13 (PWA journeys), G-29 (UAT consumption), G-30 (decision row), G-31 (0C/0H) |

P8-S9 therefore covers **ONLY** contract §9 (G-09): the executed final gate matrix. It does **not** re-run S6 L2 storms, does **not** re-run S7 backup/restore or migration rehearsals, does **not** re-execute the S8 UAT scenario set as fresh UAT work, and does **not** build any new business feature. It consumes all of the above as already-closed evidence (§3) and re-runs only the gate-level lightweight checks that are cheap, host-executable, and required for the §19 matrix (marked [R] RERUN in §3; everything else is [C] CITE).

### 2.1 The three PENDING items the gate matrix MUST handle explicitly

- **OBS-04 (High, OPEN - D-070/D-072/D-074, decision PENDING Bryan):** reconciliation-path idle-in-transaction connection-lifecycle stall - sessions stuck "idle in transaction / ClientRead" on ALL pooled connections holding `UPDATE reconciliation_runs`; requests block on the pool queue; no statement/lock timeout can fire because no statement is executing. FIX-002 (10s/3s `withIdempotency`) bounds waiters; FIX-004 closed the adjust-chain (J3/J9) sub-class; mitigation set active at HEAD (<=5-way/serial cap, watchdog 900s, client timeouts). Named remediation paths: **Option A** bounded P8-S2-domain fix (detect\* take tx param / pool acquire timeout / FOR UPDATE narrowing) vs **Option B** documented-risk precedent. **Resolution or formal Bryan acceptance is REQUIRED before the final gate** (D-058 "0 unresolved HIGH"). The gate consumes the decision; it does not make it.
- **SEC-01 (D-072, decision PENDING Bryan):** 10 pre-existing HIGH dependency advisories (multer x4 / lodash x1 / js-yaml x2 / fast-uri x2 / react-router x1) - structurally proven pre-existing (frozen lockfile; ioredis 0 contribution), financial-path zero exposure, reachability analysis documented. Remediation decision PENDING Bryan: **written risk acceptance at the final gate** vs bounded upgrade round (minimum recommended: multer via `@nestjs/platform-express`).
- **/members/me/qr (L-06 locked-feature gap, D-074 OBS-07, decision PENDING Bryan):** L-06 (BASELINE_ACKNOWLEDGMENT_V1.1 LOCKED, PMC V1.1 C-02) mandates "Member universal QR with short-lived rotating signed security token"; the Phase 2 API contract defines GET/POST/DELETE `/members/me/qr`, but the actual API has **no QR surface** (OBS-07 confirmed the gap). Decision PENDING Bryan: **bounded implement** (add the L-06 QR surface per the Phase 2 contract) vs **formal DEFERRED** (record as a documented gap with Bryan sign-off). The gate MUST NOT silently ignore L-06 (LOCKED class); it reports the gap as an unmet-or-deferred gate condition per Bryan's decision.

### 2.2 The three recorded observations the gate report must carry (not UAT defects, not silently dropped)

| ID | Class | Detail | Gate handling |
|---|---|---|---|
| OBS-06 | Observation (root cause unisolated) | merchant-web transactions page renders INTERNAL_ERROR state against the real API in the UAT harness (BW-MC1); the underlying API passes (U-04, BW-N1). Root cause not isolated within UAT (harness fixture/context interplay cannot be excluded) | Record in the gate report known-limitations section as a triage item for P8-S10 / implementer; verify at browser E2E rerun (G-12) whether it reproduces on the S9 run; if it reproduces, log as gate observation with severity, not silently |
| OBS-07 | member-web client path misuse | member-web client calls `/profile`, `/markets` paths that do not match backend routes (no backend surface affected) | Record as known limitation (member-web-side routing polish, no backend impact); the `/members/me/qr` component is the L-06 decision row (G-30) |
| OBS-10 | member-home error panel | member-home shows a red error panel caused by the `/profile` 404 (same family as OBS-07) | Record as known limitation tied to OBS-07; re-verify at G-12 browser rerun whether the error panel persists after DEF-002 (`GET /members/me` now exists) |

## 3. Scope - contract §9 (G-09), the gate matrix, item by item

Contract §9 scope text (verbatim): *"full final gate per D-058 §19 - migration checksums/drift/fresh/upgrade; api/member-web/merchant-web/admin-web/api-client/workers typecheck+build; full-repo lint/format/OpenAPI/unit/integration/real-PG/browser E2E/PWA-mobile critical journeys; RBAC, MFA/session, multi-market isolation, idempotency, concurrency, Maker/Checker, MCP/iPoint atomicity, commission/reward/redemption/refund/reconciliation invariants, ledger+audit immutability, privacy masking, secret scan, dependency/runtime checks, security review; operational readiness evidence (load, backup, restore, monitoring, alert, runbook, release checklist). Final condition: 0 unresolved CRITICAL / 0 HIGH."*

AC (verbatim): *"gate matrix 100% green (or documented deviations with severity), gate record filed."*

Legend: **[R] RERUN** = gate-level check executed fresh on host at S9 (cheap, reproducible, required for the matrix) - **[C] CITE** = closed S1-S8 evidence consumed as-is (host-only heavy evidence; re-running is prohibited by §5) - **[D] DECISION** = row outcome depends on a Bryan / Command Center decision recorded in G-30.

| # | Gate row (contract §9 item) | Action | Evidence source | RERUN / CITE / DECISION |
|---|---|---|---|---|
| G-01 | Migration checksums **40/40** + drift clean + fresh/upgrade integrity | Recompute checksums (SHA-256 recalc over `packages/database/migrations/` + `checksums.json`), run drift check, assert `packages/database/**` zero diff | S3 (40/40), S7 fresh+upgrade rehearsal 40/40 x2 | [R] checksum + drift; [C] fresh/upgrade rehearsal (O-1: rehearse again only if Bryan/OpenClaw so decides - default CITE) |
| G-02 | api typecheck + build | Fresh `tsc -p tsconfig.build.json --noEmit` + build | S5d CI job evidence; S8 post-fix build green | [R] |
| G-03 | member-web typecheck + build (incl. Vite PWA) | Fresh typecheck + build | S5b 311/311; S5d | [R] |
| G-04 | merchant-web typecheck + build | Fresh typecheck + build (TS2322 fix `5326c3de`/`fdbe9000` on tree) | S5c 24/24; S5d re-enable | [R] |
| G-05 | admin-web typecheck + build (incl. Vite PWA) | Fresh typecheck + build | S5a 336/336; S5d | [R] |
| G-06 | api-client typecheck + build | Fresh typecheck + build | S5b/S5c (95/95 + 100/100) | [R] |
| G-07 | workers + database + all packages typecheck + build | Fresh repo-wide typecheck + `pnpm -r --if-present build` (13 projects per S5d); workers = transaction-commission-outbox worker + job-scheduler + P8-S7 Redis module | S5d build job; S7 Redis module | [R] |
| G-08 | Full-repo lint (0 errors) + format | Fresh `pnpm lint` (0 errors; 2 pre-existing warnings documented) + prettier scoped check | S5d quality job | [R] |
| G-09 | OpenAPI runtime validation | Fresh `openapi:validate` (baseline **300 paths** at S8 close: `/members/me` added, POST `/wallets` absent, 0 broken $refs, 0 duplicate operationId) | S4 (299), S8 (300) | [R] |
| G-10 | Unit tests full repo | Fresh run: S5d baseline **2,070** + S8 post-fix additions (wallet 19/19, profile 9/9, member-self) | S5d unit job; S8 defect-log re-test evidence | [R] |
| G-11 | Integration real-PG guarded suites | Fresh run of the four P8 guarded suites (S1 12/12, S2 18/18, S3 20/20, S4 32/32) + S7 redis suite 14/14 + **S8 UAT L0 suite** (`apps/api/src/uat/**`, U-01..U-36, L0 acceptance profile) against dedicated fresh `ipoint_p8s9_*` DBs with fail-closed `P8S9_DESTRUCTIVE_TEST` opt-ins; never `ipoint_ci` | S1/S2/S3/S4/S7/S8 | [R] (UAT suite re-run at L0 as acceptance-context regression per D-073 O-7; **do NOT re-run L2 storms** - S6 evidence) |
| G-12 | Browser E2E (critical user-facing journeys) | Fresh host run of the S8 expanded suite `tests/e2e/p8-s8-uat.spec.ts` (7/7 baseline; member/merchant/admin critical journeys, real API + real PG, `ipoint_p8s9_browser`); P7-S10 18/18 baseline cited, not re-run separately (overlap folded in) | S8 7/7; P7-S10 gate 9 (K-02/D-056: 18/18 host) | [R] S8 suite on host; [C] 18/18 baseline |
| G-13 | PWA-mobile critical journeys | PWA build artifacts verified in G-03/G-05; PWA journey coverage cited from S5b/S5c pages + S8 browser journeys (admin PWA scope per O-09: read-only monitoring, no financial Maker/Checker) | S5b/S5c/S8; O-09 resolution | [C] |
| G-14 | RBAC / permission matrix | Fresh run of the repo-wide RBAC matrix spec (`p7-s10-rbac-matrix.spec.ts` -> **49/49**) + permission catalog scan; no new permission codes vs S5e catalog | S5e (49/49, catalog); S8 (no new codes) | [R] |
| G-15 | MFA / session | Cite P7-S10 gate 11 (**20/20**) + S8 U-01 (registration/login/OTP/MFA/session reuse) + auth suites (S7: auth 102/102) | P7-S10, S8, S7 | [C] |
| G-16 | Multi-market isolation | Cite P7-S10 gate 12 (**55/55**) + S5e dimension 2 (all CONSISTENT) + S8 U-02/U-23 (market switch, cross-market denial 403/409, zero fallback) | P7-S10, S5e, S8 | [C] |
| G-17 | Idempotency (exactly-once, replay, double-submit, retry bounds) | Cite S6 storm assertion set per write journey + retry-site table (0 unbounded) + S8 U-25/U-29/U-35 (replay, retry, refund retry) + S5e dimension 7; optional single L0 spot-check on one write path (O-1) | S6, S8, S5e | [C] (optional [R] L0 spot-check per O-1) |
| G-18 | Concurrency (races, double decision, storm) | Cite S6 §3.3 storm assertion set (J2/J3/J8/J9/J10 at L0/L1; J10 L2 = OBS-04) + S8 U-32 (double-decision + same-key replay at acceptance scale) | S6, S8 | [C] |
| G-19 | Maker/Checker (manual MCP + manual iPoint) | Cite P7-S10 gate 14 (**31/31**, no threshold exemption) + S8 U-15/U-16 (maker submit, checker approve/reject, exactly-one transition, step-up, audit) | P7-S10, S8 | [C] |
| G-20 | MCP / iPoint / refund atomicity | Cite P7-S10 gate 15 (**36/36**) + S8 U-05/U-14 + S2/S3 write-once triggers + DEF-003 tripwire (`LEDGER_ENTRY_CREATE_DISABLED`) as hardening at HEAD | P7-S10, S8, S2, S3 | [C] |
| G-21 | Commission / reward / redemption / refund / reconciliation invariants | Cite P7-S10 gate 16 (**82/82** reward/commission/redemption regression) + S8 U-06/U-08/U-11/U-12/U-14/U-21/U-36 + S4 reports R05-R19 (U-19) | P7-S10, S8, S4 | [C] |
| G-22 | Ledger + audit immutability | Cite P7-S10 gate 17 (**48/48**) + S8 U-18 (audit) + S2/S3 E-30 reject-delete/write-once triggers + S1 audit before/after/reason | P7-S10, S8, S2, S3, S1 | [C] |
| G-23 | Privacy masking + no cross-market fallback + zero owner bypass | Fresh zero-owner-bypass scan (S5e method: **445 files / 0 direct bypass** baseline; re-scan full scope at S9, expect 0) + masking evidence (S4 containsRawIdentifier assertions, S5e dimension 10) + U-23 zero-fallback cited | S5e, S4, S8, S1-S8 fix records (each fix carried a changed-scope re-scan 0 findings) | [R] zero-bypass scan; [C] masking + U-23 |
| G-24 | Secret scan | Fresh secret scan over tracked files (S7 method: **1205 tracked files CLEAN** baseline; S9 re-scan at HEAD incl. S8 additions) | S7 E13; S8 compliance check | [R] |
| G-25 | Dependency checks (**SEC-01**) | Fresh `pnpm audit --prod` (S7 baseline: **0C / 10H / 15M / 2L**, all pre-existing frozen-lockfile; ioredis 0 contribution) + verify no NEW advisories since S7; SEC-01 decision row -> G-30 | S7 E15; D-072 | [R] audit; [D] SEC-01 decision |
| G-26 | Runtime checks (health readiness, env contract, runtime validation) | Cite S7 health readiness (DB+Redis per-check, 3s bounds, no credential leak) + env contract + S8 OpenAPI runtime validation; optional live `GET /health/live` + `/health/ready` smoke on a dedicated S9 DB (O-1) | S7 §6/E7; S8 | [C] (optional [R] live smoke per O-1) |
| G-27 | Security review (aggregate 0C/0H across all reviewer verdicts) | Consume all S1-S8 independent reviewer verdicts (each APPROVED 0C/0H at close; S8 round-3 APPROVED 0C/0H/0M/1L) + DEF-003 Critical removed + DEF-004 IDOR scoped; final security posture statement | S1-S8 gate records + review reports | [C] |
| G-28 | Operational readiness evidence (load, backup, restore, monitoring, alert, runbook, release checklist) | Cite S6 load matrix (12 journeys, L0/L1/L2, 0 unexpected errors at reported levels) + S7 backup VERIFY PASS / migration 40/40 x2 / monitoring probe (OBS-04-class indicators) / runbooks / release checklist (20 lines); **never re-run** (host-only heavy evidence) | S6, S7 | [C] (never [R] - §5 Do Not Touch) |
| G-29 | UAT result consumption (36/36 + 7/7 + GATE CONDITION stamp) | Verify the S8 results matrix GATE CONDITION stamp exists and is explicit; consume U-01..U-36 + browser 7/7 as the acceptance layer (no re-execution of UAT scenarios as fresh UAT work; G-11 re-runs the L0 suite as regression, G-12 re-runs the browser suite at gate level) | S8 matrix §header/§6, delivery §7 handoff table | [C] consume + verify stamp |
| G-30 | **OBS-04 / SEC-01 / /members/me/qr decision status rows** | Record for each PENDING item the decision status at gate close (resolved / accepted / deferred / still pending) and the gate condition consequence - see §4 | D-070, D-072, D-074, D-058 | [D] DECISION (Bryan / Command Center) |
| G-31 | **Final condition: 0 unresolved CRITICAL / 0 unresolved HIGH** | Aggregate verdict: (a) UAT-introduced defect set 0C/0H/0M at S8 close; (b) no new defect opened by S9 reruns (any rerun failure -> §11 A->B->C path with severity); (c) OBS-04 / SEC-01 / L-06 QR status per G-30. **"0 unresolved HIGH" is declarable ONLY if all three are resolved/accepted by Bryan**; otherwise the gate report carries the unmet-conditions list (see §4) | S8 defect log §7; S9 rerun results; G-30 | [D] aggregate |
| G-32 | Git state: local=remote, `main` unchanged `69240bf8`, tracked 0 modified, untracked baseline preserved, no Main PR/Merge/Push, no production deployment | Fresh git checks at gate close (`git status`, `git log`, `git fsck --connectivity-only`, local vs origin hash comparison) | S1-S8 gate records (each recorded the same invariants) | [R] |

### 3.1 Gate matrix execution order and rerun discipline

1. **Static/git rows first** (G-32, G-01, G-08, G-14, G-23, G-24, G-25): cheap, no DB needed, establish the repo state.
2. **Build rows** (G-02..G-07): repo-wide typecheck + build must be green before any test rows run.
3. **Test rows** (G-10, G-11, G-12): unit, then guarded integration suites, then browser E2E (host, K-02 precedent) - each against dedicated fresh `ipoint_p8s9_*` DBs (never `ipoint_ci`, never shared dev DBs, never production data).
4. **Consumption rows** (G-13, G-15..G-22, G-26..G-29): evidence-backed CITE with per-row reference to the S1-S8 deliverable and, where applicable, the release-checklist cross-reference (S7 §4).
5. **Decision rows** (G-30, G-31): final aggregation with the PENDING-item disposition per §4.

### 3.2 Evidence reuse vs rerun - the boundary (contract §9 AC + D-073 O-7)

- **RERUN ([R]):** anything cheap, deterministic, and host-executable that the §19 matrix names directly: checksum/drift, all-apps typecheck+build, lint/format, OpenAPI validate, unit suites, the four P8 guarded integration suites, the S8 UAT L0 suite, the S8 browser suite, RBAC matrix spec, zero-owner-bypass scan, secret scan, `pnpm audit --prod`, git-state checks.
- **CITE ([C]):** host-only heavy evidence whose re-run costs hours or risks OBS-04-class stalls and adds no new information: S6 L1/L2 load storms, S7 backup->restore->verify rehearsal, S7 migration fresh+upgrade rehearsal, S7 monitoring probe demonstrations, P7-S10 18/18 browser baseline (overlap folded into G-12), and the S8 UAT scenario results as acceptance evidence (the L0 suite re-run in G-11 is regression, not re-UAT).
- **DECISION ([D]):** OBS-04, SEC-01, /members/me/qr - no engineering rerun can resolve these; only Bryan / Command Center can.

### 3.3 Severity guide (mirror S5e/S6/S7/S8)

- **Critical** = financial invariant / security bypass / cross-market contamination.
- **High** = broken contract a real user journey hits (blocks the affected gate row).
- **Medium** = contract drift / behavior deviation with no current user-visible break (must be fixed or explicitly DOCUMENTED with rationale).
- **Low** = cosmetic / documentation / evidence-precision.
- Approval bar at S9 close: **0 Critical / 0 High / 0 Medium** from anything S9 introduces or re-opens; Lows documented. The overall "0 unresolved HIGH" declaration additionally requires the G-30 decisions (OBS-04/SEC-01/QR) per §4.

### 3.4 Defect handling if a rerun proves a defect (§11 A->B->C)

- A gate rerun may prove a defect (e.g., G-10/G-11/G-12 failure, G-23 scan finding). Disposition follows §11: routine/repairable (lint, fixture, test-only, config) -> repair and continue with a written record; **Critical/High -> bounded repair round 1 -> independent review (Reviewer B') + verification -> round 2 -> only then Command Center** (D-058 §21). Production code fixes -> **Codex CLI preferred (D-058 §5), D-060 alternate executor only**; OpenClaw does not write production code.
- Any production-code touch requires a zero-owner-bypass re-scan over the changed scope (S5e method, 0 findings) and a full gate-matrix re-verification of the affected rows.
- Expected outcomes are not defects: OBS-01 (quote-race 409), OBS-02 (bounded 55P03), OBS-03 (outbox expected rejection), OBS-05 (403-by-design) - cross-check the S6 catalogue before logging anything.
- **OBS-04 / SEC-01 / L-06 QR never route into S9 fixes** - they are decision items (G-30), not rerun defects.

## 4. PENDING item handling - the three decision rows (G-30/G-31) and the unmet-conditions list

The gate matrix MUST define the output disposition for **all three possible states** of each PENDING item. The gate report never assumes a decision that has not been made, and never claims "0 unresolved HIGH" while a PENDING item is unresolved.

| Item | State A - Bryan RESOLVED / ACCEPTED | State B - still PENDING at gate close | State C - partial (mixed) |
|---|---|---|---|
| **OBS-04** (D-070 Option A / Option B) | Option A (bounded P8-S2-domain fix): the fix must be executed under §11 A->B->C **before** the gate closes, remediation evidence (fix record + re-scan + affected-row re-verification) attached to G-18/G-21/G-30, row goes GREEN. Option B (documented-risk precedent, written Bryan acceptance): attach the signed acceptance to G-30, row goes GREEN-with-accepted-risk (severity recorded, 0 unresolved HIGH achieved because the HIGH is formally accepted per the established precedent - D-037/D-070) | Row marked **NOT MET (PENDING)**; G-31 = "0 unresolved HIGH NOT declarable"; the unmet-conditions list MUST carry OBS-04 with the D-070 decision path and a recommendation (see §4.2) | Item resolved, other items pending: resolve each row independently; the unmet-conditions list carries only the unresolved rows |
| **SEC-01** (written risk acceptance vs bounded upgrade) | Written Bryan acceptance at the gate (per D-072 "written risk acceptance at final gate"): attach to G-25/G-30, row GREEN-with-accepted-risk. Bounded upgrade round: execute under §11 A->B->C with frozen-lockfile discipline and re-audit evidence, row GREEN | Row marked **NOT MET (PENDING)**; unmet-conditions list carries SEC-01 with the D-072 decision path and recommendation | Same as OBS-04 |
| **/members/me/qr** (L-06 LOCKED feature - bounded implement vs formal DEFERRED) | Bounded implement: authorized scope = the Phase 2 contract surface (GET/POST/DELETE `/members/me/qr` per `PHASE_2_API_CONTRACT.md`, ownership-only guard, signed rotating view token, no raw token exposure) under §11 A->B->C; OpenAPI + UAT-style scenario evidence; row GREEN. Formal DEFERRED: Bryan sign-off recorded in the gate report (deferred to Phase 12 backlog with the L-06 rationale), row GREEN-as-documented-deviation (LOCKED-rule deviation requires Bryan, never OpenClaw self-authorization) | Row marked **NOT MET (PENDING)**; unmet-conditions list carries the L-06 gap with the OBS-07 evidence reference and a recommendation | Same as OBS-04 |

### 4.1 The "GATE CONDITION 未满足项清单" (unmet gate conditions list) - mandatory output shape

If any G-30 row is in State B at gate close, OR any other gate row fails (G-01..G-29 non-green), the gate report MUST contain a dedicated section with one row per unmet condition:

| # | Gate row | Unmet condition | Severity | Evidence | Decision path | Recommended disposition |
|---|---|---|---|---|---|---|
| ... | G-xx | exact condition not met | Critical/High/Medium | rerun or citation evidence | D-070 / D-072 / Command Center / Bryan | concrete recommendation |

The list is handed to the Command Center / Bryan for final adjudication (D-058: final acceptance authority is Command Center only; business decisions remain Bryan). The gate record then states `GATE_CONDITION_NOT_FULLY_MET - <n> unmet condition(s) forwarded` and does NOT declare readiness for final acceptance until the list is cleared or formally accepted.

### 4.2 Bryan decision recommendation templates (deliverable in the gate report)

The gate report includes, for each PENDING item, a recommendation block the Command Center can convert directly into a Bryan decision request (D-058 §21 stop-condition 2 "new business decision required"):

1. **OBS-04 recommendation:** *"Option A (bounded P8-S2-domain fix: detect\* take tx parameter / pool acquire timeout / FOR UPDATE narrowing) is the engineering-recommended path to reach an unconditional 0 unresolved HIGH. Option B (documented-risk precedent, mirroring D-037) requires written Bryan acceptance that the reconciliation sustained-load stall remains a known limitation with the active mitigation set (5-way cap, watchdog 900s, client timeouts, FIX-002 bounds) and observability (S7 probe/alert/dashboard). If neither is decided before gate close, the gate records G-30 NOT MET and defers the 0C/0H declaration to Command Center."*
2. **SEC-01 recommendation:** *"Written Bryan risk acceptance is recommended (structurally pre-existing, frozen lockfile, financial-path zero exposure, reachability documented); the bounded multer upgrade (`@nestjs/platform-express`) remains the minimum recommended follow-up at production-launch policy time, not a gate blocker."*
3. **/members/me/qr recommendation:** *"Bounded implement is recommended ONLY if Bryan confirms the L-06 QR surface is in V1 scope (LOCKED rule; the surface is small: 3 ownership-guarded routes per the frozen Phase 2 contract). Otherwise formal DEFERRED to Phase 12 with Bryan sign-off - the gate records the deviation explicitly either way; silent omission is prohibited."*

## 5. Do Not Touch (frozen / prohibited)

- Frozen owners: Phase 1 merchant/MCP, Phase 2 member/auth, Phase 3 wallet/reward, Phase 4 transaction, Phase 5 agent/commission, Phase 6 redemption, Phase 7 admin-ops canonical owners + SEC-01/02 + P6-R2 hardened routes, P8-S1..S4 canonical owners. Gate execution is read/execute-through-API only.
- Migrations 0000-0039 + `checksums.json` (**40/40 frozen**). No new migration, no checksum edit, no drift. `packages/database/**` zero change.
- **Production data / deployment / credentials** - gate runs on dedicated `ipoint_p8s9_*` test DBs only; no production deployment, no production credentials, no `ipoint_ci`.
- OBS-04 / SEC-01 / L-06 QR remediation - decision items (G-30); never self-authorized by the gate executor.
- **Re-running host-only heavy evidence**: S6 L1/L2 load storms (OBS-04 stall risk + zero information gain), S7 backup->restore->verify rehearsal, S7 migration fresh+upgrade rehearsal (default CITE; re-run only per O-1 decision), P7-S10 18/18 browser baseline as a separate run, S8 UAT scenarios as fresh UAT work (G-11 L0 rerun + G-12 browser rerun are the gate-level regressions, not re-UAT).
- No weakening/skipping of existing guards or tests; no deletion of tests; no TypeScript strictness reduction; no lint/format config changes; no `.npmrc` committed.
- No merge to `main`, no push to `main`, no Main PR/Merge, no production deployment, no destructive DB operations outside the guarded `ipoint_p8s9_*` test DBs.
- No `git add .` / `git add -A`; exact-path staging only; scoped conventional commits; no clean/stash/reset --hard/rebase/amend/force-push; no bulk-add of the untracked baseline (**119 preserved** per P8-S0 - includes `.npmrc`, `.openclaw/`, and other P8-S0-classified untracked files; L-8 `p6-s1-schema.test.ts` stale filename recorded, NOT to be fixed by S9).
- All committed files UTF-8 **without BOM** (D-061 L-1..L-3 precedent: BOM/em-dash encoding corruption bit previous sub-phases - verify bytes before commit; ASCII-safe punctuation preferred in all committed docs).

## 6. Definition of done (verifier will check)

1. `docs/06-phase-reports/p8-s9/P8_S9_PRODUCTION_READINESS_GATE_REPORT.md` - the gate report: methodology, gate matrix (G-01..G-32) with per-row PASS / GREEN-with-accepted-risk / NOT MET + evidence reference + RERUN/CITE/DECISION marker, rerun command logs (summarized; raw under `.local/p8-s9-gate/**`), the **GATE CONDITION 未满足项清单** section (present and explicit if any row is NOT MET; explicitly "none" if fully green), the PENDING-item disposition table (§4), Bryan decision recommendation blocks (§4.2), OBS-06/OBS-07/OBS-10 known-limitations section, P8-S10 handoff table.
2. Gate matrix verdict: every row G-01..G-32 has an explicit outcome; **no row left blank or hand-waved**; every CITE row carries a reference a later verifier (P8-S10, Command Center) can inspect; every RERUN row carries a command + result.
3. PENDING-item handling: G-30/G-31 disposition matches the actual decision state at gate close (States A/B/C per §4); the gate report does NOT claim "0 unresolved HIGH" unless Bryan decisions are recorded; if not, the unmet-conditions list is present with decision paths and recommendations.
4. `docs/06-phase-reports/p8-s9/P8_S9_FINAL_GATE_RECORD.md` - filed by OpenClaw (integration gate keeper), NOT by the executor; contains the verdict, declarations limited to the OpenClaw-authorized set (`READY_FOR_COMMAND_CENTER_FINAL_ACCEPTANCE` or `GATE_CONDITION_NOT_FULLY_MET - <n> unmet condition(s) forwarded`); never `PHASE_8_ACCEPTED/COMPLETE/CLOSED/FROZEN/IPOINT_V1_ENGINEERING_COMPLETE` (D-058: Command Center only).
5. P8-S10 handoff: the gate report's handoff table lists exactly what S10 consumes (gate matrix results, unmet-conditions list, decision recommendations, OBS-06/07/10 records, rerun evidence refs) and what S10 must NOT re-run (the same heavy-evidence set).
6. Zero Do-Not-Touch violations: `git diff` shows no `packages/database/**` change, no production-code change outside documented §11 bounded fixes (each with fix record + zero-bypass re-scan), no `.npmrc`, no untracked-baseline additions, UTF-8 no BOM verified on all committed files, `git fsck --connectivity-only` clean, tracked files outside the S9 commit set 0 modified, `main` unchanged `69240bf8`, local = remote at close.
7. Full-repo CI state: the p8-ci.yml suite must remain green at S9 close - nothing S9 adds may regress lint/format/typecheck/build/unit/integration/OpenAPI (S9's rerun results are the evidence; a CI run on the S9 branch is the strongest proof - O-1 whether to trigger one).
8. Scoped conventional commits only (`docs(p8-s9): ...` for the gate report/records; `fix(p8-s9): ...` only for §11 bounded fixes); commit set = S9 files only; exact-path staging.
9. Executor provenance recorded per D-058 (executor class/model/branch/commits -> `EXECUTOR_PROVENANCE_REGISTER.md` via OpenClaw at gate time); PHASE_REGISTRY/DECISION_LOG updated by OpenClaw only.

## 7. Deliverables

- `docs/06-phase-reports/p8-s9/TASK_BRIEF_P8S9.md` (this brief)
- `docs/06-phase-reports/p8-s9/P8_S9_PRODUCTION_READINESS_GATE_REPORT.md` (gate matrix G-01..G-32 with outcomes + evidence, rerun logs summary, GATE CONDITION 未满足项清单, PENDING disposition + Bryan recommendation templates, OBS-06/07/10 section, P8-S10 handoff table)
- `docs/06-phase-reports/p8-s9/P8_S9_FINAL_GATE_RECORD.md` (filed by OpenClaw, not the executor)
- Evidence artifacts: raw rerun outputs under gitignored `.local/p8-s9-gate/**` - summarized (never pasted wholesale) into the gate report with per-claim references
- Optional §11 bounded-fix commits (only with written fix records + zero-bypass re-scan)
- Optional P8-S10 input pack: a one-page `P8_S9_TO_P8_S10_HANDOFF.md` (or a handoff section in the gate report) listing S10's input inventory - O-3 decides the form

## 8. Notes / guidance for the executor

### 8.1 Reading list (read before executing)

- `AGENTS.md`; `P8_S0_CONTRACT_FREEZE.md` §0/§9/§11/§12; `P8_S0_GAP_AUDIT_REPORT.md` (G-09 row); `P8_S0_PROGRESS_BASELINE.md` (opening 78% / 50%, final target 100%/100% - S9 provides evidence input, S10 recomputes).
- D-058 (DECISION_LOG.md) §19 gate scope + §21 stop conditions + final-condition wording; D-070 (OBS-04 + Option A/B), D-072 (SEC-01 + PENDING), D-074 (S8 close + OBS-06/07/10 + L-06 QR PENDING); D-059/D-060 (acceptance + executor authorization).
- `P7-S10_FINAL_GATE_RECORD.md` (21/21 gate matrix - the structural template for G-01..G-32; gate 9 K-02 host/CI constraint, gate 21 git invariants).
- `P8_S8_*` (UAT plan/results matrix/defect log/delivery report - the UAT consumption layer + GATE CONDITION stamp + DEF-001..004 fix records).
- `P8_S5E_*` (consistency matrix, controller map, delivery report - RBAC 49/49, zero-bypass 445/0, OpenAPI 285 methodology).
- `P8_S6_LOAD_PERFORMANCE_CONCURRENCY_REPORT.md` (§2 matrix, §9 OBS-01..05, §10 commands - L0 rerun methodology for G-11).
- `P8_S7_*` (delivery report + backup/restore + migration rehearsal + monitoring + runbooks + security - the ops evidence layer; release checklist §4 for cross-references).
- `P8_S0_UNTRACKED_CLASSIFICATION.md` (untracked 119 baseline - do not touch).

### 8.2 Evidence consumption vs rerun - the honesty boundary

- CITE rows must reference the exact deliverable + section (e.g., "S8 results matrix §6", "S7 delivery report §8") so P8-S10/Command Center can inspect without re-running.
- RERUN rows must record the exact command, environment (Node 26.4.0 host), database (dedicated `ipoint_p8s9_*`), and result. A rerun that fails is a finding with severity, not a silent retry.
- Never fabricate a PASS, a number, or a screenshot; a failed/absent run is reported as such (P4-S7/P8-S4/S6/S7/S8 precedent).
- If the S9 browser rerun (G-12) reproduces OBS-06 (merchant-web INTERNAL_ERROR), record it with the repro evidence and the U-04/BW-N1 green API evidence; do NOT attempt a production fix without §11 authorization - the gate records it and routes to Command Center per §11 stop conditions.

### 8.3 Host / CI constraints

- Browser E2E is **host-only for evidence** (K-02: sandbox lacks chromium system libs; precedent D-056/P7-S10 gate 9). The suite stays CI-runnable; adding/triggering a CI browser job is O-1.
- Node parity: host Windows Node 26.4.0 vs CI ubuntu Node 24 (P4-S7 residual risk 2) - record the note; do not resolve it in S9.
- Guarded integration suites require the fail-closed opt-in (`P8S9_DESTRUCTIVE_TEST=1`) + dedicated `^ipoint_p8s9_[a-z0-9_]+$` DBs - never `ipoint_ci`, never shared dev DBs.
- Redis (S7): gate integration suites that touch the limiter/lock surface may run with Redis on 127.0.0.1:6379 (S7 shape) or the in-memory fallback in test env; record which.

### 8.4 Rerun command map (host, S5d/S5e/S6/S7/S8 methods)

| Row | Command shape (host, Node 26) |
|---|---|
| G-01 | SHA-256 recalc over `packages/database/migrations/` + `checksums.json` (S3/S7 method); drift via the S7 rehearsal script `scripts/p8-s7/migration-rehearsal.ps1` or the database drift spec |
| G-02..G-07 | `pnpm exec tsc -p tsconfig.build.json --noEmit` (api), `pnpm --filter @ipoint/<app> build` + typecheck per app, `pnpm -r --if-present build` |
| G-08 | `pnpm lint` (0 errors, 2 pre-existing warnings documented) + prettier scoped check |
| G-09 | `openapi:validate` in apps/api (300 paths baseline; 0 duplicate operationId; POST /wallets absent; /members/me present) |
| G-10 | `pnpm -r exec vitest run` unit scope per S5d unit job (2,070 baseline + S8 additions) |
| G-11 | guarded suites: S1 `ipoint_p8s1_*`, S2 `ipoint_p8s2_*`, S3 `ipoint_p8s3_*`, S4 `ipoint_p8s4_*`, S7 redis, S8 UAT `apps/api/src/uat/**` on fresh `ipoint_p8s9_uat` - all with fail-closed guards |
| G-12 | `scripts/run-e2e.mjs` + `playwright.config.ts` (4 webservers) against `ipoint_p8s9_browser`; host Chromium; screenshots to `test-results/p8s9-*.png` |
| G-14 | `vitest run p7-s10-rbac-matrix.spec.ts` (49/49) + permission catalog scan (S5e `scan-perms.mjs`) |
| G-23 | zero-owner-bypass scan (S5e `scan-zerobypass.mjs`, 445 files baseline; expect 0 direct bypass) |
| G-24 | S7 secret-scan method (1205 tracked files CLEAN baseline; re-scan at HEAD) |
| G-25 | `pnpm audit --prod` + `pnpm audit` (0C/10H/15M/2L baseline; verify no NEW advisories) |
| G-32 | `git status --short`, `git log --oneline -3`, `git rev-parse HEAD` vs `origin/phase/8-final-delivery-readiness`, `git fsck --connectivity-only`, `git diff --stat` vs base |

### 8.5 OBS-04 execution discipline

No reconciliation L2 storms at S9 (prohibited - §5). If the G-11 L0 UAT suite (U-21/U-36) reproduces a pool stall, record it as an OBS-04-class observation with the S6 reproduction-ledger reference (`.local/p8-s6-load/2026-08-10T08-44Z-j10-l2-rerun-stall/OBSERVATION.md`) and the S7 alert-indicator reference - do NOT attempt an engine fix (Command Center decision).

### 8.6 Relationship to P8-S10

- S9 delivers the gate verdict; S10 composes the `PHASE 8 FINAL DELIVERY REPORT` (D-058 §24 inventory) and **recomputes SELLABLE_DELIVERABLE_PROGRESS / PRODUCTION_READY_V1_PROGRESS** (opening 78%/50%; final target 100%/100% with truthful reporting - D-058 §26). S9's job is to make that recomputation possible by proving the readiness evidence, not to compute the final percentages itself.
- S10's declaration limit: OpenClaw may declare `PHASE_8_DELIVERY_COMPLETE` + `READY_FOR_COMMAND_CENTER_FINAL_ACCEPTANCE` only; `PHASE_8_ACCEPTED/COMPLETE/CLOSED/FROZEN/IPOINT_V1_ENGINEERING_COMPLETE` remain Command Center-only.

### 8.7 Git discipline

Scoped conventional commits (`docs(p8-s9): ...`, `fix(p8-s9): ...` only for §11 fixes); exact-path staging; no `.npmrc`; UTF-8 no BOM (verify bytes; ASCII-safe punctuation); no untracked-baseline additions; `git fsck --connectivity-only` clean; tracked 0 modified outside the S9 commit set; local = remote at close; provenance recorded by OpenClaw at gate time.

## 9. Open decision points (surface to OpenClaw / Command Center)

- **O-1 - Which gate rows rerun vs cite (default envelope).** Default (this brief §3): RERUN = G-01 (checksum/drift), G-02..G-08 (typecheck/build/lint/format), G-09 (OpenAPI), G-10 (unit), G-11 (guarded integration incl. S8 UAT L0), G-12 (S8 browser suite on host), G-14 (RBAC), G-23 (zero-bypass), G-24 (secret scan), G-25 (audit), G-32 (git); CITE = everything else incl. S6 L1/L2, S7 rehearsals, P7-S10 18/18, S8 UAT scenarios-as-acceptance. OpenClaw confirms at dispatch; any row moved from CITE to RERUN must be justified in the gate report (extra run cost, extra risk e.g. OBS-04, or extra evidence value). Optional add-ons the dispatcher may select: G-26 live health smoke, G-17 single L0 idempotency spot-check, a p8-ci.yml run on the S9 branch as CI proof.
- **O-2 - OBS-04 / SEC-01 / /members/me/qr output shape when PENDING.** Default (§4): the three decision rows go NOT MET, the gate report carries the GATE CONDITION 未满足项清单 with decision paths + recommendation blocks, no "0 unresolved HIGH" claim, and the gate record states `GATE_CONDITION_NOT_FULLY_MET - <n> unmet condition(s) forwarded`. Alternative: hold gate close until Bryan decides (blocks the S9->S10 handoff - heavier; recommend the default so evidence flow continues and the decision is recorded as a dependency, mirroring D-073 O-6).
- **O-3 - S9 / S10 delivery boundary.** Default: S9 = gate matrix + gate report + gate record + handoff table (deliverable set §7); S10 = FINAL DELIVERY REPORT with the §24 inventory + progress recomputation, consuming the S9 outputs. Confirm the handoff is a section in the gate report (not a separate file) unless Command Center wants a standalone `P8_S9_TO_P8_S10_HANDOFF.md`.
- **O-4 - Bryan decision recommendation templates in the gate report.** Default: yes - §4.2 blocks are included so the Command Center can convert them directly into a Bryan decision request (D-058 §21 stop-condition 2). Alternative: gate report records only the decision paths without recommendations (weaker - recommend the default).
- **O-5 - OBS-06 / OBS-07 / OBS-10 disposition.** Default: recorded in the gate report known-limitations section; re-verified during G-12 (browser rerun); if OBS-06 reproduces, recorded with severity and routed to Command Center (no self-authorized production fix). Confirm they are NOT gate blockers while their API layers pass and no Bryan decision is pending on them (the L-06 QR component is the only Bryan-dependent part - G-30).
- **O-6 - Gate executor / verifier split.** Default (contract §9 A->B->C): gate execution by a verifier-class agent (D-060 reviewer/verifier pool), independent review of the gate report by a second independent reviewer, gate record filed by OpenClaw (integration gate keeper). Confirm the executor may NOT also file the gate record, and that any §11 production fix follows the full A->B->C chain.
- **O-7 - Gate-matrix green standard.** Default (contract AC): 100% green OR documented deviations with severity; the aggregate 0C/0H declaration additionally requires G-30 decisions per §4. Confirm "GREEN-with-accepted-risk" (written Bryan acceptance) counts as green for OBS-04/SEC-01 per the D-037/D-070 documented-risk precedent.
- **O-8 - Progress values at S9.** Default: S9 does not recompute SELLABLE_DELIVERABLE_PROGRESS / PRODUCTION_READY_V1_PROGRESS (S10 does, per D-058 §26); S9 only asserts the evidence rows the S10 recomputation consumes. Alternative: S9 also emits an interim progress estimate (extra, non-authoritative) - recommend the default.

_Forward-only brief. Do not delete or rewrite. Superseded only by a bounded addendum recorded in the P8-S9 gate record._
