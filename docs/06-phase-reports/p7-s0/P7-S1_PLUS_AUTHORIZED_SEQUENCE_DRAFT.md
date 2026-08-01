# P7-S1+ Authorized Sequence Draft

> **Status: DRAFT / NOT P7-S1+ IMPLEMENTATION AUTHORIZATION**
>
> This document records the D-046-compatible execution sequence for future Command Center authorization. Every sub-phase below is NOT AUTHORIZED. The word “authorized” in the title describes the sequence intended for later authorization, not present implementation authority.

## 1. Sequence rules

- Dependencies are hard gates unless a later Command Center order explicitly changes them.
- Frozen-owner changes use isolated branches/commits and separate acceptance from Phase 7 facade/UI work.
- Auth, permission, migration, ledger, and transaction-state changes remain in dedicated commits.
- No sub-phase may infer authority from completion of its dependency.
- P7-S10 begins only after all shipped-scope gates are accepted or the blocked capabilities are explicitly excluded.

## 2. Ten-sub-phase draft

| Sub-phase | Status | Dependencies | Ownership / conflict boundary | Deliverable | Required acceptance evidence |
|---|---|---|---|---|---|
| **P7-S1 — Contract decisions and architecture baseline** | **NOT AUTHORIZED** | D-046 consolidation accepted; governance Commit 2 completed if ordered | Documentation/governance only; no production changes | Approved Phase 7 Brief; role/permission/market/API/error/data/migration/acceptance architecture mapped to D-046 | Decision traceability for all 22 items, fee decision, open/deferred register, gate ownership, no undecided behavior frozen |
| **P7-S2 — Admin identity, MFA, sessions, RBAC and market context** | **NOT AUTHORIZED** | P7-S1; P7-OD-01/02/12/13; approved auth/permission migrations | Canonical auth and platform-access owners; dedicated auth/permission commits; no domain feature work | Admin eligibility, approved MFA/step-up, session policy/revocation, six role templates, reconciled permission catalog/seeds, market grants and selector | Real HTTP/PostgreSQL plus browser tests for MFA, expiry/revocation/reuse, least privilege, crafted-request denial, one-market context, grant revocation, audit |
| **P7-S3 — Admin Web shell and typed integration foundation** | **NOT AUTHORIZED** | P7-S2 contracts/security accepted; Product Design System | `apps/admin-web`, approved shared types/client/UI only; no frozen-domain command change | Routed responsive shell, protected navigation, typed DTO client, standardized states/errors, read-only PWA-safe foundation | Component, type, accessibility/axe, Playwright desktop/mobile, deep-link/back/refresh, permission denied, session expiry, offline and no-offline-write evidence |
| **P7-S4 — Dashboard and bounded operational read models** | **NOT AUTHORIZED** | P7-S2/S3; P7-OD-02/16; approved metric definitions | Phase 7 read adapters only; no domain writes or client calculation of truth | Selected-market aggregates, queue status, `asOf`, freshness/stale/unavailable states, drill-down | Fixture-backed aggregate correctness, <=60s queue and <=5m KPI policy, query bounds/performance, no 20-row/fabricated counts, currency separation |
| **P7-S5 — Member, merchant and KYC operations integration** | **NOT AUTHORIZED** | P7-S2/S3; P7-OD-15/17; retention/open-item boundaries | Phase 7 UI/adapters calling accepted Phase 1/2 owner commands; no direct table writes | Member/merchant/KYC queues and details, approved status/actions, masked evidence, notes/timelines, safe support views | Permission/market negative tests, masking/raw-denial/audit-of-view, real HTTP/DB/browser flows, Phase 1/2 regression, no attribution/inactivity invention |
| **P7-S6 — Market, package and commercial configuration** | **NOT AUTHORIZED** | P7-S2/S3; P7-OD-04..09; Malaysia fee rule; applicable Phase 3/5/6 owner gates | One canonical domain owner at a time; centrally coordinated migrations; Phase 7 owns UI/orchestration only | Safe market/package configuration plus reward/redemption/commission/agent-fee adapters only where separately accepted | Decimal-string/unit/bounds, future-local-midnight/UTC, version/overlap/stale/idempotency/concurrency/audit, historical snapshot regression, blocked other-market fallbacks |
| **P7-S7 — Manual MCP and iPoint Maker/Checker** | **NOT AUTHORIZED** | P7-S2/S3; P7-OD-10/11/18/20; SEC-01 owner authorization; evidence-storage policy | MCP owner reused; Phase 3 wallet workflow isolated; dedicated ledger/migration commits | MCP queue/history and compliant iPoint Draft/Create → Pending → Approved/Rejected → Executing → Executed/Failed workflow, or explicit blocked state until gate release | Distinct identity at every amount, soft/hard routing, evidence rules, rejection replacement, atomic owner-ledger state/audit, exact opposite, payload mismatch, concurrency/retry, Phase 3 regression |
| **P7-S8 — Agent and Phase 6 operational adapters** | **NOT AUTHORIZED** | Separate Phase 5/6 decisions under P7-OD-19/21; SEC-02 release before refund approval | Frozen owner remediation isolated from Phase 7 facade/UI; safe read adapters may be separately reviewed | Market-safe agent queues/commands after owner repair; redemption order/exception/refund read projections; refund approval only after SEC-02 acceptance | Owner-specific route/permission/market/atomicity/idempotency/security regression, fee snapshot and commission failure evidence, Phase 3/5/6 regression, blocked-state browser proof |
| **P7-S9 — Audit Viewer and basic reports** | **NOT AUTHORIZED** | P7-S2; P7-OD-14/15/17; safe domain projections | Phase 7 read models only; no raw export, BI, or domain recomputation | Deny-by-default Audit Viewer with audit-of-view and on-screen bounded operational reports; no download/export | Filter/pagination/market/permission/redaction tests, raw secret/KYC/voucher/ledger export denial, reproducibility/`asOf`, performance bounds, compensation and currency correctness |
| **P7-S10 — Integration, security, accessibility and delivery evidence** | **NOT AUTHORIZED** | P7-S2..S9 complete for shipped scope; all critical gates released or features explicitly unavailable | Verification/docs only except separately dispatched remediation; no opportunistic feature work | Full acceptance matrix, registered OpenAPI surface, regression/security/privacy/accessibility/PWA evidence, final delivery report | Exact CI results for format/lint/typecheck/build/unit/DB/API/E2E, frozen-domain regressions, concurrency/idempotency, OpenAPI, axe/Playwright, secret/privacy scans, clean scoped Git evidence |

## 3. Dependency order

`P7-S1 → P7-S2 → P7-S3` is strictly sequential. P7-S4 and P7-S5 may run only after P7-S3 and only with non-overlapping ownership. P7-S6, P7-S7, and P7-S8 require their applicable frozen-owner/security gates and separate authorization. P7-S9 follows accepted safe projections and masking. P7-S10 is the final integration and evidence gate.

## 4. Non-authorization statement

No entry in this draft is active work. No code, schema, migration, test, CI, route, permission, MFA, remediation, UI, or deployment may begin until a later explicit Command Center order authorizes the named sub-phase and its owner boundaries.
