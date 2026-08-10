# P8-S8 — Full Final UAT Plan

> Phase 8 · Sub-phase **P8-S8** · Branch `task/p8-s8-full-final-uat` (base `16dd9139` = `phase/8-final-delivery-readiness` HEAD)
> Contract: `P8_S0_CONTRACT_FREEZE.md` §8 (G-08) · Brief: `TASK_BRIEF_P8S8.md` @ `5059616f` (D-073)
> Executor: **verifier class** (contract §8: "UAT execution by verifier class"; D-060 pool) — verification and evidence only; no production code.
> Open decision points: O-1 full U-01..U-36 API L0 matrix + browser critical journeys; O-2 18/18 baseline folded into the expanded suite (single host run, no separate full re-run); O-3 no new CI job, browser evidence host-only; O-4 fresh `ipoint_p8s8_*` DB + negative-path seeds; O-5 routine fixes in-brief, Critical/High → §11 A→B→C, OBS-04/SEC-01 never S8 fixes; O-6 PASS-with-documented-limitations + GATE CONDITION stamp; O-7 S8 deliverables = P8-S9 UAT input layer.

_Forward-only plan. Do not delete or rewrite._

---

## 1. Mission and scope boundary

Execute the contract §8 (G-08) Full Final UAT at Phase 8 state: an evidence-backed end-to-end acceptance of the complete business-journey set (U-01..U-22) plus the full negative-path set (U-23..U-36), at API level (L0 single-user acceptance profile) with actual browser E2E for the critical user-facing journeys (host, Chromium, real API + real PostgreSQL on a dedicated `ipoint_p8s8_*` DB).

Explicitly OUT of scope (cite, do not re-run): S6 L1/L2 load storms, S5e static consistency scans, S7 backup/migration/security rehearsals, P7-S10 18/18 baseline as a standalone re-run (O-2), S5a/S5b/S5c vitest suites, full-repo CI (O-3).

## 2. Scenario inventory — U-01..U-36 (contract §8, one row each)

Legend — Layers: API (L0 single-user acceptance over real HTTP), UI (browser journey, §4). Reuse: J* = S6 journey id (cited structure/evidence), P7-S10 gates 10-16 (cited baseline), S5e cells (cited static baseline), NEW = explicit UAT execution added.

### 2.1 Positive journeys

| # | Journey (contract §8) | Layers | Reuse | UAT acceptance assertions (focus) |
|---|---|---|---|---|
| U-01 | member registration/login (+ OTP, MFA, session reuse) | API + UI (member) | J1, P7-S10 gate 11 | registration validations, OTP issue/verify, complete + idempotent replay, login, refresh, session reuse detection, logout, rate-limit 429 ceiling |
| U-02 | market switching | API + UI (member) | S5e market cells, P7-S10 gate 12 | current-market resolution, switch, market-scoped lists refresh, cross-market 409/403 denial (U-23) |
| U-03 | merchant discovery | API + UI (member) | Phase 1/2 discovery, S5e | market-scoped discovery results, member content home, no cross-market fallback |
| U-04 | merchant transaction (preview/confirm/receipt/history) | API + UI (merchant) | J2, S5c | preview exact-decimal, confirm atomicity (1 tx/1 fee/1 debit/1 reward link/1 wallet entry), receipt, history, idempotency-key discipline, double-submit guard |
| U-05 | MCP (merchant cash pool) | API | J3 | MCP read/ledger, governed adjustment workflow (maker→submit→decision→execute), caps, audit, idempotency |
| U-06 | iPoint earning | API | J4 | earn exactly-once, reward sources/entries, rule-driven crediting, no double credit |
| U-07 | wallet | API + UI (member) | J4/J6, S5b wallet page | balance correctness, ledger visibility, exact-decimal display, no fabricated zero |
| U-08 | agent/referral commission | API | J5, S5b team page | rate-driven commission, outbox drain to ledger, no double-processing, referral tree |
| U-09 | merchant package | API | Phase 4 package owner, S5e | package eligibility, purchase/assign, package state lifecycle |
| U-10 | special percentage | API | Phase 4, S5e | special % applied exactly, no override of safety/eligibility/price invariants |
| U-11 | reward rules | API | J4, P7-S6A | rule schedule/list, canonical enum usage, market-scoped config |
| U-12 | redemption (catalog/quote/order/voucher) | API + UI (member) | J6, S5b, P6-S6 | catalog market-scoped, quote correctness, order-create exactly-once, voucher issue, OBS-01 quote-race 409 treated as expected |
| U-13 | fulfilment (pickup/backorder/suspend/exception/retry) | API + UI (admin) | J7, P7-S8 | queue transitions, suspend/resume, retry bounded, failed-fulfilment handling (U-34) |
| U-14 | refund (reversal/refund) | API | J8, SEC-02, P7-S8 | reversal-request, refund-request, retry-safe exactly-once, refund ledger + wallet + inventory atomicity, identity guard |
| U-15 | manual MCP Maker/Checker | API + UI (admin) | J3 chain, P7-S7A | maker create/submit, checker approve/reject, exactly-one transition, step-up, audit |
| U-16 | manual iPoint Maker/Checker | API + UI (admin) | J9, P7-S7B, SEC-01 | same assertion set as U-15 on the iPoint adjust chain |
| U-17 | admin workflows | API + UI (admin) | phase7-admin.spec.ts, P8-S1..S4 | admin CRUD across P8 domains, RBAC gates, market isolation, step-up where required |
| U-18 | audit | API + UI (admin) | P7-S9, E-12 | every mutating journey writes audit; immutability; filter/search; no raw ledger exposure to support role |
| U-19 | reports (R01-R19) | API + UI (admin) | J11, P8-S4 | asOf/freshness/stale/unavailable semantics, market scope, masking, no fabricated zero, no export |
| U-20 | ads/content | API + UI (member/admin) | J12, P8-S1 | placement/schedule lifecycle, market isolation, member read surface, MCP debit via owner (append-only entry type) |
| U-21 | reconciliation (run/execute/exceptions) | API + UI (admin) | J10, P8-S2 | run-create/execute, exception queue lifecycle, mismatch detection, no auto-correction, **OBS-04-mitigated profile only** (§6) |
| U-22 | risk queues | API + UI (admin) | P8-S3 | indicator definitions, detection queue, admin review surface, no enforcement side-effects beyond flagging/review |

### 2.2 Negative paths

| # | Negative path (contract §8) | Reuse | UAT execution |
|---|---|---|---|
| U-23 | cross-market denial (resource/current-market 409/403) | S5e, P7-S10 gate 12, S6 | explicit: member/merchant/admin attempts on foreign-market resources → 403/409, zero cross-market fallback assertion |
| U-24 | permission denial (RBAC) | S5e RBAC 49/49, P7-S10 gate 10 | explicit: role without permission → 403 on API; denied state on UI |
| U-25 | duplicate/replay (idempotency-key reuse, double submit) | S6 storms, S5c | one-key replay → single result single financial chain; UI double-submit guard |
| U-26 | insufficient balance | S6 write-path edges | confirm/debit/redemption/refund with insufficient balance → clean rejection, no partial write, no negative balance |
| U-27 | expiry (OTP, quote, voucher) | P7-S10 gate 11, P6 | expired OTP/quote/voucher → documented error code, no consumption |
| U-28 | suspension (member/merchant/account) | P7-S10, Phase 2 auth state | suspended account cannot login/transact; documented status code |
| U-29 | retry (bounded retries, retry-safe) | S6 retry-site table | runtime cross-check of one write path (confirm + refund retry) |
| U-30 | worker failure (outbox, daily jobs) | S6 outbox + OBS-03 | outbox dispatch failure state → bounded retry, no double-processing, backlog drains |
| U-31 | network/API failure (downstream unavailable) | S6 harness error handling, S7 | API/DB/Redis unavailable → documented error contract, graceful degradation, no data corruption |
| U-32 | concurrency (double decision, storm race) | S6 §3.3 storm set | J9 double-decision + J8 same-key replay at L0/L1 acceptance scale; cite S6 L2 evidence |
| U-33 | stale/unavailable (freshness semantics) | S5a, J11 | stale report/read surface → honest STALE/UNAVAILABLE state, no fabricated zero |
| U-34 | failed fulfilment | J7, P7-S8 | fulfilment exception path → FULFILMENT_EXCEPTION state, retry bounded, audit rows |
| U-35 | refund retry (duplicate refund request) | J8, SEC-02 | refund retry with same key → exactly one refund, second returns consumed/claim-first result |
| U-36 | reconciliation mismatch (difference detection) | P8-S2 18/18, J10 | seeded mismatch → difference detected, exception queued, no auto-correction, audit immutable |

## 3. Execution environment

| Item | Value |
|---|---|
| Host | Windows, Node 26.4.0, pnpm 9.15.9 (Node 24 CI parity note per P4-S7 residual risk 2 — recorded, not resolved) |
| PostgreSQL | 17 on `127.0.0.1:55432` (`ipoint`/`ipoint-local-only`); dedicated fresh `ipoint_p8s8_*` DBs only, created via `db:migrate` + `db:seed` + UAT fixtures; never `ipoint_ci`, never production data |
| Redis | `127.0.0.1:56379` (S7 module; limiter/lock/queue surface; graceful degradation verified in U-31) |
| API layer | `apps/api/src/uat/**` vitest suite, fail-closed `P8S8_DESTRUCTIVE_TEST` opt-in + `^ipoint_p8s8_[a-z0-9_]{1,63}$` dedicated-DB guard (S1-S4/S6 pattern), real HTTP against a real listening NestJS AppModule |
| Browser layer | Playwright Chromium (installed), `playwright.config.ts` webservers (api:3100, member-web:4173, merchant-web:4174, admin-web:4175), `scripts/run-e2e.mjs` (db:migrate + db:seed + playwright) with `E2E_DATABASE_URL` override to `ipoint_p8s8_browser` on 55432; host-only evidence (K-02 precedent) |
| Evidence | raw outputs under gitignored `.local/p8-s8-uat/**` (API run JSON per scenario, browser reports/screenshots, DB assertion outputs); summarized with per-claim references in the results matrix |

## 4. Data / fixture strategy (O-4)

- Fresh `ipoint_p8s8_test` (API suite) and `ipoint_p8s8_browser` (browser suite) DBs, dropped/recreated per run, migrated (40/40 checksums frozen) and foundation-seeded, then UAT fixtures.
- World fixtures mirror the S6 harness (market + super/ops/support admins + member + merchant branch with MCP + package + QR + reward rule) plus UAT-only negative-path seeds:
  - suspended member/merchant accounts (U-28);
  - expired OTP (issued then `expires_at` moved to the past) (U-27);
  - expired quote (issued then `expires_at` moved to the past) and expired voucher (U-27);
  - insufficient-balance MCP/wallet fixtures (U-26);
  - mismatched ledger row for reconciliation difference detection (U-36);
  - outbox row in dispatch-failure state (U-30);
  - foreign-market resources for cross-market denial (U-23).
- Test-scale dataset is sufficient (S6/S7 precedent). No production-like or production data anywhere (contract §8 Do-Not-Touch).

## 5. Severity guide (mirror S5e/S6/S7, brief §8.2)

- **Critical** = financial invariant / security bypass / cross-market contamination.
- **High** = broken contract a real user journey hits (blocks UAT pass for that scenario).
- **Medium** = contract drift / behavior deviation with no current user-visible break (must be fixed or explicitly DOCUMENTED with rationale).
- **Low** = cosmetic / documentation / evidence-precision.
- Approval bar at S8 close: **0 Critical / 0 High / 0 Medium** from the UAT-introduced defect set; Lows documented; OBS-04/SEC-01 handled per §6 (not UAT defects, but gate-condition dependencies).

## 6. OBS-04 / SEC-01 acceptance wording (mandatory, brief §3.7)

1. **OBS-04**: UAT reconciliation scenarios (U-21, U-36) execute at the **OBS-04-mitigated profile** (≤5-way/serial, watchdog, client timeouts, FIX-002 bounds) — sustained L2 reconciliation storms are explicitly out of UAT scope (S6 §9 evidence stands). Recorded verbatim: *"OBS-04 (High, OPEN, D-070/D-072) is a known engine-level limitation on the reconciliation path; remediation decision (Option A bounded P8-S2-domain fix / Option B documented-risk precedent) is PENDING Bryan. UAT does not remediate, re-classify, or hide it. Until Bryan decides, no '0 unresolved HIGH' declaration is possible; the P8-S9 final gate depends on that decision."*
2. **SEC-01**: recorded verbatim: *"SEC-01 (10 pre-existing HIGH dependency advisories, D-072) is structurally pre-existing (frozen lockfile), financial-path zero exposure; written risk acceptance or bounded upgrade decision is PENDING Bryan. UAT defect log excludes it (not UAT-introduced) and flags it as a gate-condition dependency for P8-S9."*
3. **Gate condition stamp**: while either item is PENDING Bryan, the UAT results matrix header carries: `PASS with documented limitations: OBS-04/SEC-01 PENDING Bryan — see matrix §6; final 0C/0H declaration deferred to P8-S9 pending Bryan decision`.

## 7. Acceptance criteria dimensions (brief §3.3)

Every scenario evaluated against: (1) business correctness (exact-decimal end-to-end, no fabricated zero, canonical state enums); (2) permissions (RBAC at runtime, 403 on denial, step-up); (3) market isolation (zero cross-market fallback); (4) idempotency/concurrency (one key per attempt, replay single result, exactly-once financial deltas); (5) Maker/Checker (exactly one accepted transition, step-up, audit); (6) historical immutability (no rewrite; refunds/reversals additive); (7) no cross-market fallback (explicit zero-fallback assertion per negative path U-23); (8) 0 Critical / 0 High UAT-introduced defects at close, with the OBS-04/SEC-01 gate conditions handled per §6.

## 8. Execution schedule

| Stage | Work | Commit |
|---|---|---|
| A | UAT plan (this document) | `docs(p8-s8): add uat plan` |
| B | API U-01..U-36 suite + execution | `test(p8-s8): add uat api suite` + per-group evidence commits |
| C | Browser E2E expansion + host execution | `test(p8-s8): add uat browser suites` |
| D | Results matrix + defect log | `docs(p8-s8): add uat results matrix and defect log` |
| E | Delivery report (P8-S9 handoff) | `docs(p8-s8): add uat delivery report` |

## 9. Expected-outcome catalogue (not defects — brief §3.8)

OBS-01 (quote-race 409), OBS-02 (bounded 55P03), OBS-03 (outbox expected rejection), OBS-05 (403-by-design on the deprecated recharge route). UAT cross-checks these against the S6 catalogue and records them as expected, never as defects.

## 10. Release-checklist cross-reference (S7 §4)

The UAT results matrix maps every scenario to the S7 release-checklist rows it evidences: row 8 (unit/integration/real-PG suites — UAT API suite runs on real PG), row 9 (RBAC — U-24), row 13 (backup — cited), row 14 (load — S6 cited via U-29/U-32), row 15 (monitoring — U-31 health/ready), row 16 (OBS-04 dependency — §6), row 18 (ledger reconciliation — U-21/U-36), row 19 (git state — delivery report). Rows 1-7, 10-12, 17, 20 are P8-S9 gate inputs cited from S5d/S5e/S6/S7 evidence.

## 11. Do Not Touch (brief §5, binding)

Frozen owners, migrations 0000-0039 + `checksums.json` (40/40), production data, OBS-04/SEC-01 remediation, no weakening of guards/tests/type strictness, no `.npmrc`, no `git add .`, no merge to `main`/`phase/8`, no deployment, UTF-8 no BOM on all committed files, untracked baseline 119 untouched (L-8 not fixed), no `git gc/prune/repack/reflog`.
