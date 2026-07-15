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
| **Baseline Acknowledgment** | **APPROVED AFTER V1.1 CORRECTION** | V1.1 Correction is binding; where conflict exists, V1.1 wins |
| **PR #2** (docs: iPoint engineering starter pack) | **UNDER REVIEW** | Not merged; Draft PR on docs/project-master-baseline |
| **Current Authorized Phase** | **NONE** | No Big Phase Brief has been issued |
| **Phase 0** | **NOT_AUTHORIZED** | Engineering foundation awaiting Big Phase Brief |
| **Phase 1** | **NOT_AUTHORIZED** | Merchant Onboarding + MCP Ledger awaiting Big Phase Brief |

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

- ✅ Read and analyze project documentation
- ✅ Update governance files (AGENTS.md, DOCUMENT_AUTHORITY.md, OPENCLAW_OPERATING_RULES.md, BASELINE_ACKNOWLEDGMENT_V1.1.md, DECISION_LOG.md, OPEN_QUESTIONS.md, PHASE_REGISTRY.md)
- ✅ Append new Decision Log entries as decisions arrive
- ✅ Update PHASE_REGISTRY.md status as phases advance
- ✅ Prepare Phase breakdown proposals for ChatGPT review
- ✅ Escalate conflicts and open questions

## Current prohibited actions

- ❌ Start Phase 0 without an approved Big Phase Brief
- ❌ Assign Codex CLI to write production code
- ❌ Merge PR #2
- ❌ Modify files outside governance scope without Phase authorization
- ❌ Change LOCKED business rules
- ❌ Hard-code CONFIGURABLE values
- ❌ Implement DEFERRED modules
- ❌ Invent behavior for OPEN questions
- ❌ Delete, clean, stash, or batch-add untracked files
- ❌ Announce Phase completion without ChatGPT approval

---

*Last updated: 2026-07-16 | Updated by: OpenClaw | Based on decisions D-001, D-002, D-003*
