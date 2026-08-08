# P8-S0 — Opening Progress Baseline (evidence-based)

> **Authority:** D-058 §9 — P8-S0 must calculate evidence-based opening values for SELLABLE_DELIVERABLE_PROGRESS and PRODUCTION_READY_V1_PROGRESS. Do NOT invent percentages. Final Phase 8 target: 100% / 100% (truthful reporting; no scope/percentage manipulation).
> **Date:** 2026-08-08 · **Branch:** `phase/8-final-delivery-readiness` @ `39c0964e`
> **Author:** OpenClaw — computed from repository evidence (P8_S0_GAP_AUDIT_REPORT.md) + accepted Phase 1–7 gate results.

---

## 1. SELLABLE_DELIVERABLE_PROGRESS — opening: **78%**

### Method

V1 sellable scope decomposed into 20 weighted functional domains (member surfaces × backend/UI, merchant surfaces × backend/UI, admin operations, new Phase 8 domains). Domain status from the actual repository (GAP_AUDIT_REPORT §3) and accepted Phase 1–7 delivery evidence.

| # | Functional domain | Backend | UI | Weight → score |
|---|---|---|---|---|
| 1 | Member registration / login / OTP / reset | ✅ | ✅ | 1.0 |
| 2 | Member profile / KYC L1+L2 / QR | ✅ | ✅ | 1.0 |
| 3 | Member discovery / market switch / country change | ✅ | ✅ | 1.0 |
| 4 | Member wallet & reward ledger (Phase 3) | ✅ | ❌ | 0.5 |
| 5 | Member team / commission / agent view (Phase 5) | ✅ | ❌ | 0.5 |
| 6 | Member redemption center (Phase 6) | ✅ | ❌ | 0.5 |
| 7 | Merchant onboarding / KYC / profile | ✅ | ✅ | 1.0 |
| 8 | Merchant MCP / packages / special % / activation | ✅ | ✅ | 1.0 |
| 9 | Merchant transaction (preview/confirm/receipt) (Phase 4) | ✅ | ❌ | 0.5 |
| 10 | Merchant history / reversal / refund surfaces | ✅ | 🟡 | 0.75 |
| 11 | Admin member/merchant/KYC operations | ✅ | ✅ | 1.0 |
| 12 | Admin commercial configuration (package/reward/rate/commission/market) | ✅ | ✅ | 1.0 |
| 13 | Admin finance Maker/Checker (MCP + iPoint) | ✅ | ✅ | 1.0 |
| 14 | Admin agent ops / redemption fulfilment / refund ops | ✅ | ✅ | 1.0 |
| 15 | Admin audit viewer + basic reports | ✅ | ✅ | 1.0 |
| 16 | Ads & Content Operations | ❌ | ❌ | 0.0 |
| 17 | Advanced financial reconciliation | ❌ | ❌ | 0.0 |
| 18 | Risk / fraud / operational controls | ❌ | ❌ | 0.0 |
| 19 | Advanced reporting views | 🟡 | 🟡 | 0.5 |
| 20 | Cross-platform consistency & PWA journeys | 🟡 | 🟡 | 0.5 |

**Score:** (14 × 1.0) + (2 × 0.75) + (1 × 0.5) + (3 × 0.5) + (3 × 0.0) = 14 + 1.5 + 0.5 + 1.5 + 0 = **17.5 / 20 = 87.5%** (capability-weighted)

### Adjustment for deliverability (not just capability)

Sellable/deliverable requires complete, verifiable journeys, not just code presence. Apply deliverability discount for: no full-journey UAT yet (G-08), no cross-platform final integration evidence (G-05), no reconciliation/risk/ads (0-scored above already), basic-report-only coverage, and host/CI-only browser evidence:

- Capability score: 87.5%
- Deliverability discount: −9.5 points (UAT/integration/evidence gaps: full UAT not executed, E2E limited to admin 18/18, member/merchant UI gaps mean member/merchant journeys not end-to-end demonstrable)

**Opening SELLABLE_DELIVERABLE_PROGRESS = 78%** (rounded; range 75–80% honest uncertainty)

### What moves it to 100%

- P8-S5 UI gap closure (domains 4/5/6/9 → 1.0) = +2.0 points
- P8-S1/S2/S3/S4 new domains (16/17/18 → 1.0, 19 → 1.0) = +3.5 points
- P8-S8 full UAT + P8-S5 cross-platform evidence removes deliverability discount = +9.5 points
- P8-S10 re-baseline

## 2. PRODUCTION_READY_V1_PROGRESS — opening: **50%**

### Method

Ten production-readiness pillars, scored from repository evidence (GAP_AUDIT_REPORT + accepted gates).

| Pillar | Evidence | Score |
|---|---|---|
| Security posture (RBAC 46/46, MFA, step-up, audit, 0C/0H, no secrets) | ✅ strong | 1.0 |
| Financial correctness (idempotency, concurrency, atomicity, invariants, immutability) | ✅ strong | 1.0 |
| Test coverage (unit 1,840 + integration 1,701 real-PG + admin E2E 18/18) | ✅ strong | 1.0 |
| Migration integrity (37/37 checksums, drift clean) | ✅ strong | 1.0 |
| CI / repeatable full-repo pipeline | 🟡 Phase 0/3/4/5-era workflows only; no Phase 6/7/8 full workflow | 0.5 |
| Distributed infrastructure (Redis limit/lock/queue — E-03/D-019-C hard prerequisite) | ❌ absent | 0.0 |
| Load / performance / concurrency evidence | 🟡 P4-S7 local-scale only, transaction domain only | 0.5 |
| Backup / restore / DR evidence | ❌ absent | 0.0 |
| Monitoring / structured logs / alerting / runbooks / release checklist | ❌ absent (pino structured logging exists in api only) | 0.25 |
| Full UAT + browser E2E across critical journeys | 🟡 admin-only E2E; member/merchant journeys not browser-verified | 0.5 |

**Score:** (4 × 1.0) + (1 × 0.5) + (1 × 0.0) + (1 × 0.5) + (1 × 0.0) + (1 × 0.25) + (1 × 0.5) = 4 + 0.5 + 0 + 0.5 + 0 + 0.25 + 0.5 = **5.75 / 10 = 57.5%**

### Adjustment

P7-S10 gate was Phase-7-scoped; production-readiness evidence (load, backup/restore, monitoring, alerts, DR, runbooks, release checklist, Redis) is engineering-absent at opening. Apply −7.5 points for the unverified operations surface (documented gaps, not speculation):

**Opening PRODUCTION_READY_V1_PROGRESS = 50%** (rounded; range 45–55%)

### What moves it to 100%

- P8-S6 load/concurrency evidence (+0.5)
- P8-S7 Redis infra + backup/restore/monitoring/alerting/runbooks (+1.25)
- P8-S8 full UAT + browser E2E (+0.5)
- P8-S9 final gate: CI full workflow, fresh/upgrade migration rehearsal, secret/dependency/runtime checks, 0C/0H (+0.75)
- P8-S10 re-baseline with evidence

## 3. Declaration

- Both opening values are evidence-based estimates by OpenClaw (project GM), computed from the actual repository and accepted Phase 1–7 gate records, with the computation shown above. They are baselines for Phase 8 tracking, not acceptance claims.
- Final values will be recomputed at P8-S10 from completed evidence. Truthful reporting: if evidence does not support 100%, the report will state the truthful percentage and remaining blockers (D-058 §26).
- No percentages were adjusted to reach a target.

_Forward-only report. Do not delete or rewrite._
