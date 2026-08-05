# iPoint Phase Registry

> Rules:
> - Only ChatGPT Command Center may mark a Phase as APPROVED.
> - Phase status values: NOT_AUTHORIZED / AUTHORIZED / PLANNING / IN_PROGRESS / UNDER_REVIEW / CHANGES_REQUIRED / APPROVED / BLOCKED / COMPLETE / APPROVED / BLOCKED
> - OpenClaw updates status as decisions arrive.
> - Before updating status, update DECISION_LOG.md with the authorizing decision.

---

## Current status summary

| Item | Status | Notes |
|---|---|---|
| **Baseline Acknowledgment** | **APPROVED** | V1.1 Correction is binding; where conflict exists, V1.1 wins |
| **PR #2** (docs: iPoint engineering starter pack) | **MERGED** | Squash merged to main: 3c850bd |
| **Current Authorized Work** | **Phase 7 Full Execution (D-047/D-048)** | P7-S2 through P7-S10 AUTHORIZED under D-047; continuous execution; frozen-owner remediation authorized in exact scope; **D-051 (Phase 1 special-percentage reason/audit) and D-052 (Phase 3 reward-rule owner security/versioning) MANDATORY under Command Center order 2026-08-04**; **P7-S6B DELIVERY_COMPLETE / OPENCLAW INTERNAL GATE PASSED / CG-02 REWARD OWNER GATE PASSED / D-050 OWNER REMEDIATION INTEGRATED (final gate record 2026-08-05 — OpenClaw internal declaration, NOT Command Center acceptance)**; P7-S6C RESUMING; Main PR/Main Merge/Push Main/Production Deployment NOT_AUTHORIZED. |
| **Executor Pool (Phase 7)** | **D-048 AUTHORIZED** | Codex CLI temporarily unavailable (workspace credits). OpenClaw-managed independent Coding Subagents AUTHORIZED as alternate executors for P7-S4..P7-S10 under D-048. OpenClaw remains PROHIBITED from directly writing production code. No alternate OpenAI account or authentication bypass. Testing/review/security/financial/Git requirements unchanged. Final Command Center acceptance not delegated. Executor class recorded per task in Executor Provenance Register. |
| **Phase 1** | **COMPLETE / ACCEPTED** | Accepted at `48239fea58716c3df0facbfa2c1b4a1865c05b21`; Pull Request to main AUTHORIZED under D-013 |
| **Phase 2** | **COMPLETE** | Approved at `d25fb1244f29573bcc008b08cd94286c7b7d0330` under D-027. P2-S1 through P2-S9 all COMPLETE / APPROVED. Phase 3 NOT_AUTHORIZED. |
| **Phase 1 Batch A** | **APPROVED** | P1-S2 through P1-S4 COMPLETE under D-011 |
| **Phase 1 Batch B** | **APPROVED** | P1-S5 through P1-S7 COMPLETE under D-012 |
| **Phase 1 Final Batch** | **APPROVED** | P1-S8 and P1-S9 COMPLETE under D-013 |
| **P0-S1** | **COMPLETE** | Repository audit completed |
| **P0-S2** | **COMPLETE** | Phase 0 application shells completed |
| **P0-S3** | **COMPLETE** | Backend foundation independently re-validated after D-005 |
| **P0-S4A Documentation** | **COMPLETE** | ORM comparison independently re-validated after D-005 |
| **P0-S4A PoC** | **COMPLETE** | Reproducible ORM comparison PoC integrated into the Phase branch |
| **ORM Gate** | **CLOSED - DRIZZLE APPROVED** | D-006 selects Drizzle for the production baseline |
| **Batch A** | **APPROVED** | D-007 accepts remote head `760cb8b8916b569f1a6be057b8cd4ba8546d2e87` |
| **P0-S4B** | **COMPLETE** | Node 24.18.0 validation passed; accepted under D-007 |
| **P0-S5** | **COMPLETE** | Accepted under D-007 |
| **P0-S6** | **COMPLETE** | Accepted under D-007 |
| **Batch B** | **APPROVED** | D-008 accepts remote head `fb3478f5e12724a837ece025024a375c673dc7ac` |
| **P0-S7** | **COMPLETE** | Accepted under D-008 |
| **P0-S8** | **COMPLETE** | Accepted under D-008 |
| **P0-S9** | **COMPLETE** | Final integration, audit, and acceptance completed under D-009 |

---

## Phase 0 sub-phase status

| Sub-phase | Scope | Status | Next gate |
|---|---|---|---|
| **P0-S1** | Repository audit and workspace classification | **COMPLETE** | None |
| **P0-S2** | Monorepo application shells | **COMPLETE** | None |
| **P0-S3** | NestJS backend foundation | **COMPLETE** | None |
| **P0-S4A Documentation** | ORM comparison and recommendation evidence | **COMPLETE** | None |
| **P0-S4A PoC** | Checked-in, reproducible ORM comparison PoC | **COMPLETE** | None |
| **ORM Gate** | ORM selection governance decision | **CLOSED - DRIZZLE APPROVED** | D-006 recorded |
| **Batch A** | P0-S4B through P0-S6 acceptance gate | **APPROVED** | D-007 recorded |
| **P0-S4B** | Post-ORM-gate Phase 0 work | **COMPLETE** | Node 24.18.0 validation passed |
| **P0-S5** | Batch A follow-on work | **COMPLETE** | D-007 accepted |
| **P0-S6** | Batch A follow-on work | **COMPLETE** | D-007 accepted |
| **Batch B** | P0-S7 Design System foundation and P0-S8 testing/CI/local environment | **APPROVED** | D-008 recorded |
| **P0-S7** | Design System foundation | **COMPLETE** | D-008 accepted |
| **P0-S8** | Testing, CI, and local environment | **COMPLETE** | D-008 accepted |
| **P0-S9** | Phase 0 final integration, audit, and acceptance | **COMPLETE** | Final acceptance completed under D-009 |

---

## Full Phase list

*Based on MVP Roadmap V1.0 (07_iPoint_MVP_Roadmap_and_Acceptance_V1.0.md), modified by V1.1 Correction C-01.*

| Phase | Scope | Status | Notes |
|---|---|---|---|
| **Phase 0** | General ledger technical skeleton, DB foundation, Auth framework, RBAC, Market module, Audit infrastructure, Design System tokens | **APPROVED** | Final acceptance approved under D-009 |
| **Phase 0 closure** | Final integration, audit, acceptance, and governance closure | **CLOSED** | Closed under D-009; Phase 1 requires new authorization |
| **Phase 1** | Merchant Onboarding + MCP Ledger | **COMPLETE / ACCEPTED** | Accepted at `48239fea58716c3df0facbfa2c1b4a1865c05b21` under D-013. Pull Request to main AUTHORIZED. Phase branch: phase/1-merchant-onboarding-mcp |
| **Phase 2** | Member Core (Profile, KYC, QR, merchant discovery, current market, referral) | **COMPLETE** | P2-S1 through P2-S9 all COMPLETE / APPROVED. Approved at `d25fb1244f29573bcc008b08cd94286c7b7d0330` under D-027 |
| **Phase 3** | iPoint Wallet Ledger + Reward Plan + 00:00 Daily Job | **COMPLETE / ACCEPTED / FROZEN** | Accepted under D-029. Final SHA 2ed57f4e. CI Run 30000394880. P3-S2+ NOT_AUTHORIZED. |
| **Phase 4** | Transaction Engine | **COMPLETE / CLOSED** | All 8 sub-phases (P4-S1 through P4-S8) accepted. Phase 4 closed under D-037. Final HEAD `87ea05aa`. CI Run 30099595759. Phase branch: phase/4-transaction-engine. Main PR/Main Merge NOT_AUTHORIZED. Production deployment NOT_AUTHORIZED. Phase 5 NOT_AUTHORIZED. |
| **Phase 5** | Agent & Commission Engine | **ACCEPTED / COMPLETE / CLOSED / FROZEN** | Final Technical Baseline `93ad0850`. Accepted CI Run 30260182865. B 15/15, C 10/10, D 10/10, Total 35/35, Semantic Gate SUCCESS. Phase 5 formally closed at D-042. Main PR/Main Merge NOT_AUTHORIZED. Five-level team rewards DEFERRED. |
| **Phase 6** | Redemption Center | **ACCEPTED / COMPLETE / CLOSED / FROZEN** | Final governance SHA `b4840498`. Accepted CI Run **30541203165** — 5/5 SUCCESS. D-045. P6-S0 through P6-S9 COMPLETE / ACCEPTED. Baseline modification prohibited. Main PR/Main Merge NOT_AUTHORIZED. Production deployment NOT_AUTHORIZED. Phase 7 was NOT_AUTHORIZED under D-045; current Phase 7 planning status is governed by D-046. |
| **Phase 7** | Admin Operations | **FULL EXECUTION AUTHORIZED** | P7-S1 ACCEPTED / COMPLETE / FROZEN under D-047; P7-S2..P7-S10 AUTHORIZED; Main PR/Main Merge NOT_AUTHORIZED; Production deployment NOT_AUTHORIZED. |
| **Phase 8** | Advertising & Content | **NOT_AUTHORIZED** | Merchant ad submission, admin review, MCP debit, member banners |
| **Phase 9** | Reporting, Risk & Audit | **NOT_AUTHORIZED** | Reconciliation reports, risk flags, case workflow |
| **Phase 10** | Full Integration & E2E | **NOT_AUTHORIZED** | Cross-market scenarios, failure recovery, UI consistency, regression |
| **Phase 11** | Security, Performance & Production Readiness | **NOT_AUTHORIZED** | Hardening, load testing, backup rehearsal, monitoring, UAT |
| **Phase 12** | Deferred modules evaluation | **NOT_AUTHORIZED** | Not part of initial MVP cadence |

---

## Phase 1 sub-phase status

| Sub-phase | Scope | Status | Next gate |
|---|---|---|---|
| **P1-S1** | Phase 1 planning & architecture approval | **COMPLETE** | Accepted under D-013 |
| **P1-S2** | Merchant Schema and Migrations | **COMPLETE** | Commits e8870a92 |
| **P1-S3** | Merchant Onboarding Domain/API | **COMPLETE** | Commits d40c4250, a5cc85f9 |
| **P1-S4** | Merchant KYC and Review | **COMPLETE** | Batch A approved under D-011 |
| **P1-S5** | Service Fee Package Management | **COMPLETE** | Batch B approved under D-012 |
| **P1-S6** | MCP Ledger and Recharge | **COMPLETE** | Batch B approved under D-012 |
| **P1-S7** | MCP Adjustment, Refund and Activation | **COMPLETE** | Batch B approved under D-012 |
| **P1-S8** | Merchant/Admin UI | **COMPLETE** | Accepted under D-013 |
| **P1-S9** | Integration, E2E and Final Acceptance | **COMPLETE** | Accepted under D-013 |

## Phase 2 sub-phase status

| Sub-phase | Scope | Status | Next gate |
|---|---|---|---|
| **P2-S1** | Architecture and contract freeze | **COMPLETE / APPROVED** | Approved at `8cdc0b2938ee7ceedb89c13716c6dae07d029c2f` under D-016 |
| **P2-S2** | Member Schema and Forward Migrations | **COMPLETE / APPROVED** | Approved under D-017 |
| **P2-S3** | Registration, OTP and Authentication | **COMPLETE / APPROVED** | Approved at `919e71a97eff7a18e5e2e7d2c23cb18636b1b870` under D-025 |
| **P2-S4** | Member Identity, Referral and QR Foundation | **COMPLETE / APPROVED** | Approved under D-019 (previously COMPLETE; confirmed under D-025) |
| **P2-S5** | Member Profile and Multi-Market Preferences | **COMPLETE / APPROVED** | Approved at `c089e7365ba7cccaa1a24612ee60cba79469910c` under D-021 |
| **P2-S6** | Member KYC Level 2 | **COMPLETE / APPROVED** | Approved at `071b65a6aaf4cafbf117594816b1ae7b8afd4676` under D-022 |
| **P2-S7** | Merchant Discovery by Current Market | **COMPLETE / APPROVED** | Approved at `89ccd6d499414c536e249616a11f5ee77c5e92b1` under D-023 |
| **P2-S8** | Admin Member Management and Audit | **COMPLETE / APPROVED** | Approved at `cb902fc96a6f8ddc5be469c38e3caa64d0eb87cb` under D-024 |
| **P2-S9** | Member UI Integration, E2E and Phase 2 Final Acceptance | **COMPLETE** | Approved at `d25fb1244f29573bcc008b08cd94286c7b7d0330` under D-027. All sub-stages (S9A-S9G) complete. E2E validation, production build audit, security audit, PWA audit, accessibility audit all pass. |

## Phase 3 sub-phase status

| Sub-phase | Scope | Status | Next gate |
|---|---|---|---|
| **P3-S1** | Architecture, Contract Audit and Engineering Freeze | **COMPLETE / ACCEPTED** | Accepted under D-029. Final SHA 2ed57f4e. |

## Phase 4 sub-phase status

| Sub-phase | Scope | Status | Next gate |
|---|---|---|---|
| **P4-S1** | Database Schema & Transaction Domain Model | **COMPLETE / ACCEPTED** | Part of Batch A baseline accepted under D-032. |
| **P4-S2** | Merchant Transaction Preview & Validation | **COMPLETE / ACCEPTED** | Accepted at dc546d69 under Phase 4 Batch A. |
| **P4-S3** | Atomic Transaction Confirmation | **COMPLETE / ACCEPTED** | Accepted at eab5cf14 under D-031. CI Run 30069548709. |
| **P4-S4** | Idempotency, Duplicate Protection & Concurrency | **COMPLETE / ACCEPTED** | Accepted at f80e2b59 under D-032. CI Run 30070245230. |
| **P4-S5** | Transaction History and Receipt List APIs | **COMPLETE / ACCEPTED** | Accepted at 264ca8c8 under D-034. CI Run 30090049883. |
| **P4-S6** | Reversal / Refund | **COMPLETE / ACCEPTED** | Accepted at cad3bfcc under D-036. CI Run 30092900182. |
| **P4-S7** | Hardening | **COMPLETE / ACCEPTED** | Accepted at SHA `87ea05aa` under D-037. CI Run 30099595759. |
| **P4-S8** | Final Verification & Closure | **COMPLETE / ACCEPTED** | Accepted under D-038. Phase 4 closed. |

## Phase 5 sub-phase status

| Sub-phase | Scope | Status | Next gate |
|---|---|---|---|
| **P5-S0** | Contract Freeze & Architecture | **COMPLETE** | `729cd950`. docs(p5-s0): freeze agent and commission engine contract |
| **P5-S1** | Agent Commission Schema & Migration | **COMPLETE** | `fca8f6cc`. feat(p5-s1): add agent commission domain schema and migration |
| **P5-S2** | Agent Activation Lifecycle | **COMPLETE** | `9d73aa31` (shared commit with P5-S3). Agent activation lifecycle service, controllers, types |
| **P5-S3** | Referral Engine | **COMPLETE** | `9d73aa31` (shared commit with P5-S2). Referral engine with cycle detection and anonymized tree |
| **P5-S4** | Commission Module Controller | **COMPLETE** | `36309f51`. Commission module controller and barrel exports |
| **P5-S5** | Correction Compensation | **COMPLETE** | `476f0fd4`. Correction compensation and idempotency |
| **P5-S6** | Commission Query/Admin | **COMPLETE** | `8f808b3b`. Commission query and admin capabilities |
| **P5-S7** | Security, Concurrency & Regression Hardening | **COMPLETE** | `b1a7b256`. Security, concurrency and regression hardening |
| **B Integration** | Transaction-level commission (Referral relationship, Agent upgrade, G1/G2 Member Consumption, Merchant Recruitment, Rate management) | **ACCEPTED / FROZEN** | Accepted at D-039. SHA `ac7c2ec4`. CI Run 30238150798. B 15/15. |
| **C Integration** | Merchant Attribution (Parent/Branch merchant attribution, Referral validation, Market consistency) | **ACCEPTED / FROZEN** | Accepted at D-040. SHA `c615463a`. CI Run 30256953239. C 10/10. |
| **D Integration** | Correction Compensation (Reversal/Refund compensation, Commission ledger immutability, Atomic boundary) | **ACCEPTED / FROZEN** | Accepted at D-041. SHA `93ad0850`. CI Run 30260182865. D 10/10. |

## Phase 6 sub-phase status

| Sub-phase | Scope | Status | Next gate |
|---|---|---|---|
| **P6-S0** | Contract Freeze & Architecture Draft | **COMPLETE / ACCEPTED** | All 30 Bryan decisions applied and frozen under D-043. P6-S0 contract locked. P6-S1 through P6-S9 all authorized. |
| **P6-S1** | Redemption Schema & Forward Migrations | **COMPLETE / ACCEPTED** | Database schema, migrations 0021-0026, Drizzle schema alignment. |
| **P6-S2** | Catalog & Rate Management | **COMPLETE / ACCEPTED** | Admin catalog CRUD, rate management, pickup locations. |
| **P6-S3** | Shipping & Fulfilment | **COMPLETE / ACCEPTED** | Shipping payment flow, delivery confirm, pickup fulfilment, failed confirm recovery. |
| **P6-S4** | Terms Evidence & Order Binding | **COMPLETE / ACCEPTED** | Order-level terms_version/terms_accepted_at, per-order acceptance record. |
| **P6-S5** | Voucher Contract & Security | **COMPLETE / ACCEPTED** | AES-256-GCM encrypted voucher codes, SHA-256 hash, unique constraint, atomic allocation. |
| **P6-S6** | Wallet Debit & Atomic Redemption | **COMPLETE / ACCEPTED** | Atomic redemption flow, concurrency isolation, POSTGRES_ISOLATION errors. |
| **P6-S7** | Idempotency, Refund & Recovery | **COMPLETE / ACCEPTED** | Idempotency mismatch detection, refund lifecycle, shipping payment recovery v2. |
| **P6-S8** | Hardening & Admin Operations | **COMPLETE / ACCEPTED** | Admin RBAC, redemption.voucher.reveal, schema canonical column alignment. |
| **P6-S9** | Final Integration, CI & Delivery | **COMPLETE / ACCEPTED** | CI Run 30541203165. Unit 150/150, Database 85/85, API 1164/1164, E2E ✅, Quality ✅. Final SHA `b4840498`. |

## Phase 7 sub-phase status

| Sub-phase | Scope | Status | Next gate |
|---|---|---|---|
| **P7-S0** | Governance audit, decision consolidation, and Admin Operations contract freeze | **ACCEPTED / COMPLETE / FROZEN** | D-046 (2026-08-01). Six audit deliverables plus five consolidated documents accepted; 22 P7 decisions frozen. |
| **P7-S1** | Phase 7 architecture baseline | **ACCEPTED / COMPLETE / FROZEN** | D-047 (2026-08-01). Nine architecture documents accepted at HEAD `38bb38c43faa5acf983e4c1a254d83b48969a085`. |
| **P7-S2** | Future Phase 7 implementation scope | **AUTHORIZED** | Continuous execution under D-047. |
| **P7-S3** | Future Phase 7 implementation scope | **AUTHORIZED** | Continuous execution under D-047. |
| **P7-S4** | Dashboard and bounded operational read models | **AUTHORIZED** | Continuous execution under D-047; D-048 executor substitution applies. Dispatch split: P7-S4A (server read models), P7-S4B (admin web dashboard), P7-S4C (verification). |
| **P7-S5** | Future Phase 7 implementation scope | **AUTHORIZED** | Continuous execution under D-047. |
| **P7-S6** | Commercial Configuration (Merchant Package / Reward / Redemption Rate / Commission) | **S6A DELIVERED** · **S6B DELIVERY_COMPLETE / OPENCLAW_INTERNAL_GATE_PASSED / CG-02_REWARD_OWNER_GATE_PASSED / D-050_OWNER_REMEDIATION_INTEGRATED** (final forward-only gate record `P7-S6B_FINAL_GATE_RECORD.md` 2026-08-05; independent review APPROVED 20/20; independent test gate PASSED 17/17; rewire `3020f907..3dbb34ad` FF-integrated; NOT Command Center acceptance) · **S6C RESUMED (task/p7-s6c-redemption-config updated from the new Phase 7 HEAD)** · S6D NOT_AUTHORIZED until D-052 gate completion confirmed by Command Center | Continuous execution under D-047/D-048; Command Center acceptance/closure/freeze of S6B and Phase 7 NOT declared. |
| **P7-S7** | Future Phase 7 implementation scope | **AUTHORIZED** | Continuous execution under D-047. |
| **P7-S8** | Future Phase 7 implementation scope | **AUTHORIZED** | Continuous execution under D-047. |
| **P7-S9** | Future Phase 7 implementation scope | **AUTHORIZED** | Continuous execution under D-047. |
| **P7-S10** | Future Phase 7 implementation scope | **AUTHORIZED** | Continuous execution under D-047. |
| **fix/p5-r1-agent-commission-owner** | Phase 5 Agent/Commission Owner Remediation | **AUTHORIZED** | Exact frozen-owner remediation scope authorized under D-047. |
| **fix/p3-p7-sec01-ipoint-maker-checker** | SEC-01 iPoint Maker/Checker Remediation | **AUTHORIZED** | Exact frozen-owner remediation scope authorized under D-047. |
| **fix/p6-r1-sec02-refund-ledger** | SEC-02 Phase 6 Refund Ledger Remediation | **AUTHORIZED** | Exact frozen-owner remediation scope authorized under D-047. |
| **fix/p6-r2-admin-route-security** | Phase 6 Admin Route Security Remediation | **AUTHORIZED** | Exact frozen-owner remediation scope authorized under D-047. |
| **fix/p3-p7-reward-rule-owner** | Phase 3 Reward-Rule Owner Security/Versioning Remediation (D-052, Command Center "D-050") | **INTEGRATED / CG-02 GATE PASSED (OpenClaw internal, 2026-08-05)** | Remediation `e0958c6e..3e44b1d8` integrated via merge `277e7fc3`; final gate record filed; Command Center acceptance/closure/freeze NOT declared. |

## Current allowed actions

- Phase 7 implementation under the exact D-047 scope
- P7-S2 through P7-S10 continuous execution under OpenClaw management
- Exact frozen-owner remediations authorized under D-047
- Forward-only database migrations required by authorized implementation sub-phases
- Tests and minimal necessary CI changes for authorized Phase 7 implementation and remediation

## Current prohibited actions

- Open a Main PR, merge to `main`, or push to `main`
- Deploy to production
- Issue final Phase 7 acceptance, closure, or freeze (ChatGPT Command Center only)
- Perform destructive database rollback or rewrite migration history
- Delete, clean, stash, or batch-add untracked artifacts
- Modify Phase 3-6 frozen code outside the exact D-047 authorized remediation scopes
- Change LOCKED business rules
- Implement DEFERRED modules (Five-level team rewards, Payout/Withdrawal, Wallet cash-out, Backorder/Waitlist)
- Implement Agent Reapplication Policy (OPEN, not implemented)
- Implement Merchant/Branch Attribution Change Policy (OPEN, not implemented)
- Implement OPEN questions from OPEN_QUESTIONS.md
- Force push, reset, amend pushed history, or rewrite `main` history
- Delete tests or lower TypeScript strictness
- Modify B, C, or D integration test code
- Force push, rebase, or amend pushed history
- Reduce TypeScript strictness
- Skip CI gates

---

*Last updated: 2026-08-04 | Updated by: OpenClaw | Based on decisions D-001 through D-052 (incl. Command Center order 2026-08-04: S6B gate revocation, D-051/D-052 owner remediations, S6C pause)*
