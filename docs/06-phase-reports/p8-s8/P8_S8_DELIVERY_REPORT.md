# P8-S8 — Full Final UAT Delivery Report

> Phase 8 · Sub-phase **P8-S8** · Branch `task/p8-s8-full-final-uat` (base `16dd9139` = `phase/8-final-delivery-readiness` HEAD)
> Contract: `P8_S0_CONTRACT_FREEZE.md` §8 (G-08) · Brief: `TASK_BRIEF_P8S8.md` @ `5059616f` (D-073; O-1..O-7 resolved)
> Executor: **verifier class** (contract §8; D-060 pool) — verification and evidence only; zero production code written.
> Status: **UAT EXECUTED — PASS with documented limitations (GATE CONDITION stamp in results matrix §header)**; final 0C/0H declaration deferred to P8-S9 per D-073 O-6.

---

## 1. Methodology

- **API layer (U-01..U-36, L0 acceptance profile):** a new guarded vitest suite under `apps/api/src/uat/**` boots the real NestJS `AppModule` over real HTTP (Node fetch) against a dedicated fresh `ipoint_p8s8_test` database (db:migrate + db:seed + UAT fixtures), fail-closed behind `P8S8_DESTRUCTIVE_TEST` + the `^ipoint_p8s8_[a-z0-9_]+$` database guard (S1-S4/S6 pattern). World/fixture builders are reused from the S6 load harness (brief §3.4: reuse structure, add explicit business assertions per scenario). Every scenario records per-assertion PASS/FAIL + observations to `.local/p8-s8-uat/<run>/U-XX.json` and `summary.json`.
- **Browser layer:** `tests/e2e/p8-s8-uat.spec.ts` runs on host (K-02 precedent) with Chromium against the real API + real PostgreSQL (`ipoint_p8s8_browser`, db:migrate + db:seed) via the `playwright.config.ts` webservers; screenshots to `test-results/p8s8-*.png`.
- **Honesty contract:** every PASS/FAIL/number is traceable to the raw evidence; the two HIGH defects are recorded, not hidden; expected outcomes (OBS-01/02/03/05) cross-checked, not logged as defects (matrix §4).

## 2. Evidence summary

| Layer | Result | Evidence |
|---|---|---|
| API U-01..U-36 (L0) | **35 PASS / 1 FAIL / 0 PARTIAL; 221/224 assertions** | `.local/p8-s8-uat/2026-08-10T10-51-09.828Z-p8s8-uat-l0/` (U-01..U-36.json + summary.json) |
| Browser suite | **7/7 PASS** (host, real API + real PG) | `test-results/p8s8-*.png`, `playwright-report/` |
| U-07 (API) + BW-M3 | FAIL → **DEF-001 (High)** — member wallet read surface empty/not-found | U-07.json, BW-M3 |
| BW-M1 | PASS with DEF-002 boundary — member-web login stuck at /login after 200 login (missing `GET /members/me`) | **DEF-002 (High)**, p8s8-member-login-def002.png |
| OBS-06 | merchant-web transactions page INTERNAL_ERROR state (API passes) — recorded observation | p8s8-merchant-transactions.png |

## 3. OBS-04 / SEC-01 gate-condition statement (D-073 O-6)

UAT closes as **PASS-with-documented-limitations** with the explicit GATE CONDITION stamp on the results matrix header:

- **OBS-04** (High, OPEN, D-070/D-072): UAT reconciliation scenarios (U-21/U-36) executed at the OBS-04-mitigated profile (serial, 25s client bounds); sustained L2 reconciliation storms explicitly out of UAT scope (S6 §9 evidence stands). UAT did not remediate, re-classify, or hide it. **No "0 unresolved HIGH" declaration is possible until Bryan decides**; the P8-S9 final gate depends on that decision.
- **SEC-01** (10 pre-existing HIGH dependency advisories, D-072): structurally pre-existing (frozen lockfile), financial-path zero exposure; written risk acceptance or bounded upgrade decision PENDING Bryan. Excluded from the UAT defect log; flagged as a gate-condition dependency for P8-S9.
- The matrix stamp reads: `PASS with documented limitations: OBS-04/SEC-01 PENDING Bryan — see §6; final 0C/0H declaration deferred to P8-S9 pending Bryan decision`.

## 4. Defects routed to Command Center (D-073 O-5 → §11 A→B→C)

| ID | Severity | Journey | Summary |
|---|---|---|---|
| DEF-001 | High | U-07 wallet | `GET /wallets` / `GET /wallets/:id` key `member_wallet_accounts.member_id` by the ACCOUNT id → empty/`WALLET_NOT_FOUND` for every member. Full repro in `P8_S8_DEFECT_LOG.md` §2. |
| DEF-002 | High | member-web login | `AuthProvider.loadUser` calls `GET /members/me` which does not exist in the API → login 200 but UI never reaches the authenticated home. Full repro in `P8_S8_DEFECT_LOG.md` §3. |

Both are production fixes — **not fixed by S8** (verifier class; §11 A→B→C via Command Center). No OBS-04/SEC-01-class item entered S8 fixes.

## 5. Routine in-brief fixes (test/fixture/doc only — recorded)

All harness-level corrections (response-shape parsing, replay payload-hash identity, enum/column corrections, OTP-expiry fixture constraint, append-only-trigger-compliant fixture construction, TOTP timing robustness, rate-limit-aware test design, MFA challenge rate-limit consolidation) were applied inside the UAT suite files only. Zero production code, zero migration (40/40 checksums frozen — verified), zero `packages/database/**` change.

## 6. Release-checklist cross-reference (S7 §4)

Rows 8/9/14/15/16/18/19 evidenced by UAT (matrix §5); rows 1-7/10-13/17/20 remain P8-S9 gate inputs cited from S5d/S5e/S6/S7 evidence.

## 7. P8-S9 handoff table (D-073 O-7: S8 deliverables = UAT input layer; P8-S9 cites, does not re-execute UAT scenarios)

| P8-S9 gate input | S8 deliverable | P8-S9 action |
|---|---|---|
| UAT plan (U-01..U-36 + browser inventory) | `P8_S8_UAT_PLAN.md` | cite |
| UAT results matrix (per-scenario PASS/FAIL + evidence refs + GATE CONDITION stamp) | `P8_S8_UAT_RESULTS_MATRIX.md` | cite; verify the GATE CONDITION stamp exists |
| UAT defect log (DEF-001/DEF-002 repro + disposition) | `P8_S8_DEFECT_LOG.md` | consume; drive DEF-001/DEF-002 through §11 A→B→C; re-run U-07 + BW-M1 after fixes |
| Browser E2E suite (member/merchant/admin critical journeys, real API + real PG) | `tests/e2e/p8-s8-uat.spec.ts` | run on host/CI-capable runner as part of the P8-S9 browser gate |
| API UAT suite (guarded, U-01..U-36) | `apps/api/src/uat/**` | run on host at P8-S9 as the acceptance-context regression (L0 profile); do NOT re-run L2 storms (S6 evidence) |
| Reconciliation acceptance (OBS-04-mitigated) | U-21/U-36 evidence + matrix §6 | cite; consume the OBS-04 decision dependency |
| OBS-04 / SEC-01 decisions | matrix §6 + delivery §3 | PENDING Bryan — P8-S9 consumes the decisions (not the UAT) |
| Defect-fix re-verification | DEF-001/DEF-002 fix records (post-A→B→C) | re-run U-07 / BW-M3 / BW-M1 after the authorized fixes |

**What P8-S9 re-runs:** the P8-S9 final gate matrix per D-058 §19 (checksums/drift/fresh+upgrade, all-apps typecheck+build, lint/format/OpenAPI/unit/integration/real-PG, browser E2E incl. this suite, RBAC/MFA/multi-market/idempotency/concurrency/Maker-Checker/atomicity/invariants/immutability/masking/secret/dependency/security, operational readiness). **What P8-S9 cites:** the UAT scenario results above (it does not re-execute U-01..U-36 as fresh UAT work).

## 8. Commit map (branch `task/p8-s8-full-final-uat`)

| SHA | Message | Files |
|---|---|---|
| `bf6f4d7c` | docs(p8-s8): add uat plan | `P8_S8_UAT_PLAN.md` |
| `e245b4bb` | test(p8-s8): add uat api suite (u-01..u-36, guarded, l0 acceptance) | `apps/api/src/uat/**` (8 files) |
| `fd07eea4` | style(p8-s8): prettier format uat suite | `apps/api/src/uat/**` |
| `88da998e` | test(p8-s8): add uat browser suite (member/merchant/admin critical journeys, real api + pg) | `tests/e2e/p8-s8-uat.spec.ts` |
| `96b99e72` | docs(p8-s8): add uat results matrix and defect log | `P8_S8_UAT_RESULTS_MATRIX.md`, `P8_S8_DEFECT_LOG.md` |
| `(next)` | docs(p8-s8): add uat delivery report | `P8_S8_DELIVERY_REPORT.md` |

## 9. Compliance / Do-Not-Touch verification

- `git diff` (vs base) shows **no `packages/database/**` change**; no `.npmrc`; no untracked-baseline additions (119 preserved; L-8 untouched).
- No migrations/checksums touched (40/40 frozen); no production code written (verifier class); no merge to `main`/`phase/8`; no deployment; no `git add .`.
- All committed files UTF-8 without BOM (byte-verified per commit).
- CI-equivalent checks green for the added code: api build-config typecheck 0 errors; eslint 0; prettier clean (uat suite + browser spec).
- Known limitation (recorded, not resolved): host Node 26.4.0 vs CI Node 24 parity note (P4-S7 residual risk 2); browser evidence host-only (K-02 precedent); OBS-06 merchant-web transactions-page UI state recorded for triage.
- Raw evidence under `.local/p8-s8-uat/**` and `test-results/` (gitignored) — summarized with per-claim references above.

_Forward-only report. Do not delete or rewrite._
