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
| **Current Authorized Work** | **Phase 5 — Agent & Commission Engine** | Phase 4 COMPLETE/CLOSED. Phase 5 sub-phases: P5-S0 contract freeze, B/C/D Integration, Commission Engine. B Integration frozen at D-039. C Integration frozen at D-040. D Integration frozen at D-041. Phase 5 NOT_YET_CLOSED. Main PR/Main Merge NOT_AUTHORIZED. |
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
| **Phase 5** | Agent & Commission Engine | **B_INTEGRATION_FROZEN / C_INTEGRATION_FROZEN / D_INTEGRATION_ACCEPTED** | B Integration accepted at D-039. C Integration accepted at D-040. D Integration accepted at D-041. Technical implementation complete. Phase 5 NOT_YET_CLOSED. Main PR/Main Merge NOT_AUTHORIZED. Five-level team rewards DEFERRED. |
| **Phase 6** | Redemption Center | **NOT_AUTHORIZED** | Market catalog, rate, order, iPoint debit, refund |
| **Phase 7** | Admin Operations | **NOT_AUTHORIZED** | Dashboards, rule management, Maker/Checker, risk, audit, reports |
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
| **P5-S0** | Contract Freeze & Architecture | **COMPLETE** | Phase 5 contract freeze completed before B integration |
| **B Integration** | Transaction-level commission (Referral, Activation, G1/G2 Member Consumption, Merchant Recruitment, Rate Admin) | **ACCEPTED / FROZEN** | Accepted at D-039. SHA `ac7c2ec4`. CI Run 30238150798. B 15/15. |
| **C Integration** | Merchant Attribution (Parent/Branch merchant attribution, Referral validation, Market consistency) | **ACCEPTED / FROZEN** | Accepted at D-040. SHA `c615463a`. CI Run 30256953239. C 10/10. |
| **D Integration** | Correction Compensation (Reversal/Refund compensation, Commission ledger immutability, Atomic boundary) | **ACCEPTED / FROZEN** | Accepted at D-041. SHA `93ad0850`. CI Run 30260182865. D 10/10. |

## Current allowed actions

- Continue governance file maintenance
- Prepare Phase 5 final closure audit for Command Center review
- Prepare Main PR when authorized

## Current prohibited actions

- Modify B, C, or D integration test code
- Modify accepted commission semantics
- Modify attribution semantics
- Modify correction compensation semantics
- Modify original ledger immutability rules
- Modify atomic transaction boundary
- Change LOCKED business rules
- Implement DEFERRED modules (Five-level team rewards, Payout/Withdrawal, Wallet cash-out)
- Push or merge Main
- Open a Main PR
- Production deployment
- Force push, reset, amend pushed history, or rewrite `main` history
- Delete tests or lower TypeScript strictness
- Delete, clean, stash, or batch-add untracked files
- Start Phase 6 without authorization

---

*Last updated: 2026-07-27 | Updated by: OpenClaw | Based on decisions D-001 through D-041*
