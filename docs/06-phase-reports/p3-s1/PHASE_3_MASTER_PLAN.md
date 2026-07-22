# Phase 3 Master Plan — Multi-Market Wallet & Reward Ledger Foundation

> **Phase:** Phase 3 — Multi-Market Wallet & Reward Ledger Foundation
> **Sub-Phase:** P3-S1 — Architecture, Contract Audit and Engineering Freeze
> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357
> **Status:** P3-S1 IN_PROGRESS; P3-S2+ NOT_AUTHORIZED

---

## 1. Phase Objective

Establish the **Multi-Market Wallet** and **Reward Ledger Foundation** — the core financial infrastructure for iPoint rewards across markets.

After Phase 3, the system will:
- Maintain per-member, per-market wallet accounts
- Reward qualifying purchase transactions with iPoint daily accrual
- Execute settlement according to each consumption market's local timezone
- Preserve immutable ledger records with full audit and idempotency

---

## 2. Scope Diagram

```
Phase 3 Scope (Authorized)
┌─────────────────────────────────────────────────┐
│  Member Wallet Accounts (member_id + market_id)  │
│  Wallet Ledger Entries (immutable)              │
│  Reward Plans (source -> plan)                  │
│  Reward Rule Versions (versioned)               │
│  Daily Settlement Worker                        │
│  Compensation/Correction Entries                │
└─────────────────────────────────────────────────┘

Out of Scope (Phase 4+)
┌─────────────────────────────────────────────────┐
│  Full Transaction Engine (Phase 4)               │
│  Redemption Center (Phase 6)                     │
│  Agent/Commission (Phase 5)                      │
│  Admin Adjustment UI (Phase 7+)                  │
└─────────────────────────────────────────────────┘
```

---

## 3. Sub-Phase Planning

| Sub-Phase | Scope | Status |
|---|---|---|
| **P3-S1** | Architecture audit, contract freeze, design documents | **IN_PROGRESS** |
| **P3-S2** | Wallet schema, ledger contract, API endpoints (NOT_AUTHORIZED) | NOT_AUTHORIZED |
| **P3-S3** | Reward Plan, Rule Version, Source contracts (NOT_AUTHORIZED) | NOT_AUTHORIZED |
| **P3-S4** | Settlement worker, daily accrual, idempotent retry (NOT_AUTHORIZED) | NOT_AUTHORIZED |
| **P3-S5** | Integration, E2E, security audit, acceptance (NOT_AUTHORIZED) | NOT_AUTHORIZED |

---

## 4. P3-S1 Deliverables Checklist

| # | Deliverable | File | Status |
|---|---|---|---|
| 1 | Existing Architecture Audit | P3-S1_EXISTING_SYSTEM_AUDIT.md | ✅ |
| 2 | Phase 3 Master Plan | PHASE_3_MASTER_PLAN.md | ✅ |
| 3 | Phase 3 Architecture | PHASE_3_ARCHITECTURE.md | ✅ |
| 4 | Phase 3 ERD | PHASE_3_ERD.md | ✅ |
| 5 | Wallet State Model | PHASE_3_WALLET_LEDGER_CONTRACT.md | ✅ |
| 6 | Reward Plan State Machine | PHASE_3_REWARD_PLAN_CONTRACT.md | ✅ |
| 7 | Reward Rule Version Contract | PHASE_3_REWARD_RULE_VERSION_CONTRACT.md | ✅ |
| 8 | Reward Source Contract | PHASE_3_REWARD_SOURCE_CONTRACT.md | ✅ |
| 9 | Daily Settlement Contract | PHASE_3_SETTLEMENT_AND_TIMEZONE_SPEC.md | ✅ |
| 10 | Timezone and Market-Day Contract | PHASE_3_SETTLEMENT_AND_TIMEZONE_SPEC.md | ✅ |
| 11 | Idempotency Specification | PHASE_3_IDEMPOTENCY_SPEC.md | ✅ |
| 12 | Decimal, Currency and Precision Specification | PHASE_3_DECIMAL_AND_CURRENCY_SPEC.md | ✅ |
| 13 | Reversal and Correction Contract | PHASE_3_REVERSAL_AND_CORRECTION_SPEC.md | ✅ |
| 14 | Security and Privacy Boundary | PHASE_3_SECURITY_AND_PRIVACY.md | ✅ |
| 15 | RBAC and Market Access Matrix | PHASE_3_RBAC_MARKET_ACCESS_MATRIX.md | ✅ |
| 16 | API Contract Draft | PHASE_3_API_CONTRACT_DRAFT.md | ✅ |
| 17 | Migration Strategy | PHASE_3_MIGRATION_AND_ROLLBACK_STRATEGY.md | ✅ |
| 18 | Test and E2E Matrix | PHASE_3_TEST_AND_E2E_MATRIX.md | ✅ |
| 19 | Open Questions and Decision Register | PHASE_3_OPEN_QUESTIONS.md | ✅ |

---

## 5. Acceptance Gates

P3-S1 is accepted when Command Center verifies remotely:

1. Task branch exists at correct base lineage (49735cd4)
2. D-028 correctly recorded in DECISION_LOG.md
3. PHASE_REGISTRY correctly updated
4. No D-027 or Phase 2 frozen state modified
5. All required P3-S1 documents exist
6. No production schema or migration created
7. No runtime Phase 3 implementation introduced
8. All open questions are explicit
9. ERD, API and state models are mutually consistent
10. Timezone strategy is explicit
11. Idempotency strategy is explicit
12. Decimal strategy is explicit
13. Migration and rollback strategy is safe
14. Security threat model is present
15. Existing pipeline passes
16. Commits and remote SHA are verified
17. Changed files are all EXPECTED or ALLOWED_SUPPORTING

---

## 6. Key Dependencies

- **Redis** (config only, no module) — worker coordination
- **Worker Infrastructure** (MISSING) — settlement execution
- **Existing MCP Ledger** — pattern reference for wallet ledger
- **Existing Markets** (with IANA timezone) — settlement timezone source

---

## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Missing worker infrastructure | Cannot schedule daily settlement | Design worker contract in P3-S1; implement in P3-S4 |
| Missing Redis module | No distributed lock capability | Design lock contract; decide strategy |
| Decimal precision choice | Inconsistent reward calculation | Define in P3-S1 contract; mark DECISION_REQUIRED |
| Cross-market timezone errors | Settlement on wrong day | Explicit timezone contract with edge-case coverage |
| Concurrent execution | Duplicate accrual | Idempotency by reward_plan_id + market_local_date + ledger_entry_type |
