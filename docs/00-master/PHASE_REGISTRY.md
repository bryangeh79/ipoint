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
| **Current Authorized Phase** | **Batch A: P0-S4B → P0-S5 → P0-S6** | Sequential execution authorized by ChatGPT Command Center |
| **P0-S1** | **COMPLETE** | Repository audit completed |
| **P0-S2** | **COMPLETE** | Phase 0 application shells completed |
| **P0-S3** | **COMPLETE** | Backend foundation independently re-validated after D-005 |
| **P0-S4A Documentation** | **COMPLETE** | ORM comparison independently re-validated after D-005 |
| **P0-S4A PoC** | **COMPLETE** | Reproducible ORM comparison PoC integrated into the Phase branch |
| **ORM Gate** | **CLOSED — DRIZZLE APPROVED** | D-006 selects Drizzle for the production baseline |
| **P0-S4B** | **IN_PROGRESS** | Node 24 LTS validation is required before completion |
| **P0-S5** | **AUTHORIZED** | Authorized as the next Batch A sub-phase after P0-S4B |
| **P0-S6** | **AUTHORIZED** | Authorized as the final Batch A sub-phase after P0-S5 |

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
| **P0-S4B** | Post-ORM-gate Phase 0 work | **IN_PROGRESS** | Node 24 LTS validation before completion |
| **P0-S5** | Batch A follow-on work | **AUTHORIZED** | P0-S4B completion |
| **P0-S6** | Batch A follow-on work | **AUTHORIZED** | P0-S5 completion |

---

## Full Phase list

*Based on MVP Roadmap V1.0 (07_iPoint_MVP_Roadmap_and_Acceptance_V1.0.md), modified by V1.1 Correction C-01.*

| Phase | Scope | Status | Notes |
|---|---|---|---|
| **Phase 0** | General ledger technical skeleton, DB foundation, Auth framework, RBAC, Market module, Audit infrastructure, Design System tokens | **NOT_AUTHORIZED** | Awaiting Big Phase Brief |
| **Phase 1** | Merchant Onboarding + MCP Ledger | **NOT_AUTHORIZED** | Awaiting Big Phase Brief |
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

## Current allowed actions

- ✅ Read and analyze project documentation and existing Phase 0 evidence
- ✅ Execute authorized Batch A sequentially: P0-S4B → P0-S5 → P0-S6
- ✅ Run repository verification and quality gates for authorized work
- ✅ Append Decision Log entries only when a new decision is issued
- ✅ Update PHASE_REGISTRY.md as authorized status decisions arrive
- ✅ Escalate ORM evidence gaps, conflicts, and open questions

## Current prohibited actions

- ❌ Mark P0-S4B complete before Node 24 LTS validation passes
- ❌ Start work outside the authorized Batch A sequence
- ❌ Use OpenClaw sub-agents for engineering execution or accept invalidated sub-agent output as evidence
- ❌ Modify files outside the currently authorized scope
- ❌ Change LOCKED business rules
- ❌ Hard-code CONFIGURABLE values
- ❌ Implement DEFERRED modules
- ❌ Invent behavior for OPEN questions
- ❌ Delete, clean, stash, or batch-add untracked files
- ❌ Announce Phase completion without ChatGPT approval

---

*Last updated: 2026-07-16 | Updated by: Codex CLI | Based on decisions D-001, D-002, D-003, D-004, D-005, D-006 and current ChatGPT Command Center authorization*
