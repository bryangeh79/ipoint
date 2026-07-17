# iPoint Phase Registry

> Rules:
> - Only ChatGPT Command Center may mark a Phase as APPROVED.
> - Phase status values: NOT_AUTHORIZED / AUTHORIZED / PLANNING / IN_PROGRESS / UNDER_REVIEW / CHANGES_REQUIRED / APPROVED / BLOCKED
> - OpenClaw updates status as decisions arrive.
> - Before updating status, update DECISION_LOG.md with the authorizing decision.

---

## Current status summary

| Item | Status | Notes |
|---|---|---|
| **Baseline Acknowledgment** | **APPROVED** | V1.1 Correction is binding; where conflict exists, V1.1 wins |
| **PR #2** (docs: iPoint engineering starter pack) | **MERGED** | Squash merged to main: 3c850bd |
| **Current Authorized Phase** | **NONE** | Phase 1 ACCEPTED under D-013; Phase 2 NOT_AUTHORIZED |
| **Phase 1** | **COMPLETE / ACCEPTED** | Accepted at `48239fea58716c3df0facbfa2c1b4a1865c05b21`; Pull Request to main AUTHORIZED under D-013 |
| **Phase 1 Batch A** | **APPROVED** | P1-S2 through P1-S4 COMPLETE under D-011 |
| **Phase 1 Batch B** | **APPROVED** | P1-S5 through P1-S7 COMPLETE under D-012 |
| **Phase 1 Final Batch** | **APPROVED** | P1-S8 and P1-S9 COMPLETE under D-013 |
| **P0-S1** | **COMPLETE** | Repository audit completed |
| **P0-S2** | **COMPLETE** | Phase 0 application shells completed |
| **P0-S3** | **COMPLETE** | Backend foundation independently re-validated after D-005 |
| **P0-S4A Documentation** | **COMPLETE** | ORM comparison independently re-validated after D-005 |
| **P0-S4A PoC** | **COMPLETE** | Reproducible ORM comparison PoC integrated into the Phase branch |
| **ORM Gate** | **CLOSED — DRIZZLE APPROVED** | D-006 selects Drizzle for the production baseline |
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
| **ORM Gate** | ORM selection governance decision | **CLOSED — DRIZZLE APPROVED** | D-006 recorded |
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
| **Phase 2** | Member Core (Profile, KYC, QR, merchant discovery, wallet shell, referral) | **NOT_AUTHORIZED** | Will be authorized after Phase 1 |
| **Phase 3** | iPoint Wallet Ledger + Reward Plan + 00:00 Daily Job | **NOT_AUTHORIZED** | Note: renamed from original Roadmap sequence per C-01 |
| **Phase 4** | Transaction Engine | **NOT_AUTHORIZED** | Draft, receipt, QR scan, atomic confirmation, MCP debit |
| **Phase 5** | Agent & Commission Engine | **NOT_AUTHORIZED** | Referral, activation, 3 commission types. Five-level team rewards DEFERRED |
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

## Current allowed actions

- ✅ Record D-013 in DECISION_LOG.md and synchronize this registry
- ✅ Push the governance update to `phase/1-merchant-onboarding-mcp`
- ✅ Create a Pull Request from `phase/1-merchant-onboarding-mcp` to `main`
- ✅ Monitor and require all Pull Request CI checks to pass
- ✅ Merge the authorized Pull Request to `main` after all required CI checks pass
- ✅ Verify the merge commit, remote `main`, D-013, and absence of Phase 2 content

## Current prohibited actions

- ❌ Start or implement Phase 2 or any otherwise not-authorized phase
- ❌ Push directly to `main`
- ❌ Merge the Pull Request while any required CI check is pending or failed
- ❌ Bypass required CI checks or branch protection
- ❌ Use OpenClaw sub-agents for engineering execution or accept invalidated sub-agent output as evidence
- ❌ OpenClaw writing production code or modifying source files
- ❌ Change LOCKED business rules (special service fee: >0% AND <=100% — LOCKED per D-010)
- ❌ Hard-code CONFIGURABLE values
- ❌ Implement DEFERRED modules
- ❌ Invent behavior for OPEN questions
- ❌ Implement transaction snapshots, sale calculations, receipts, rewards, commissions, or advertising charging
- ❌ Integrate fake or production payment/payout providers
- ❌ Implement Receipt, QR, Transaction, Reward, Commission or Advertising behavior
- ❌ Permit negative available MCP, ledger UPDATE/DELETE, maker self-approval, or MarketAccess bypass
- ❌ Delete, clean, stash, or batch-add untracked files
- ❌ Force push, reset, amend pushed history, or rewrite `main` history

---

*Last updated: 2026-07-17 | Updated by: Codex CLI | Based on decisions D-001 through D-013 and the ChatGPT Command Center Phase 1 Final Acceptance*
