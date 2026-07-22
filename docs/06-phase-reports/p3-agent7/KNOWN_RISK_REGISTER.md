# Phase 3 — Known Risk Register

> **Author:** Agent 7 — Documentation & Delivery Evidence
> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357
> **Source:** Compiled from Agents 0 (Integration Plan), 4 (Settlement), and cross-contract analysis

---

## 1. Risk Classification Methodology

| Category | Description | Example |
|---|---|---|
| **Architecture** | Design decisions that affect multiple modules | Worker framework choice |
| **Integration** | Risks arising from combining agent work | Schema conflicts |
| **Data** | Data integrity, migration, or precision risks | Decimal precision mismatch |
| **Operations** | Production runtime and reliability risks | Settlement worker failure |
| **Security** | Authorization, isolation, or data protection risks | Cross-market wallet access |
| **Schedule** | Delivery timeline and dependency risks | Missing infrastructure modules |

### Risk Scoring

| Score | Likelihood | Impact | Response |
|---|---|---|---|
| 🔴 **Critical** | Very likely | Severe | Must mitigate before P3-S2 |
| 🟠 **High** | Likely | Significant | Mitigate during P3-S2/S3 |
| 🟡 **Medium** | Possible | Moderate | Monitor and plan mitigation |
| 🟢 **Low** | Unlikely | Minor | Accept and document |

---

## 2. Architecture Risks

### R-A01: Worker Infrastructure Not Available (🔴 Critical)

| Attribute | Value |
|---|---|
| **Description** | Settlement worker requires a job scheduling framework (BullMQ, pg-boss, or custom). If no infrastructure is available, daily settlement cannot execute. |
| **Root Cause** | No worker framework currently exists in the iPoint monorepo. Phase 0/1/2 did not require background job processing. |
| **Impact** | Settlement never runs → members never receive iPoint rewards. Phase 3 is functionally incomplete. |
| **Likelihood** | High — decision deferred to P3-S4 |
| **Severity** | Critical |
| **Mitigation** | 1. DECISION_REQUIRED: Choose BullMQ, pg-boss, or database polling in P3-S2<br>2. Design worker contract regardless of choice<br>3. Database polling fallback works without new infrastructure |
| **Owner** | Agent 4 (Settlement), Agent 0 (Integration) |
| **Status** | Open — blocked on DECISION_REQUIRED |

### R-A02: Distributed Lock Mechanism Undecided (🟠 High)

| Attribute | Value |
|---|---|
| **Description** | Without a distributed lock, concurrent settlement for the same market could cause duplicate accruals. |
| **Root Cause** | Lock strategy depends on Redis availability (SETNX) or PostgreSQL advisory lock choice. |
| **Impact** | Duplicate ledger entries → wallet balance inflation |
| **Likelihood** | Medium |
| **Severity** | High |
| **Mitigation** | 1. DECISION_REQUIRED: choose lock strategy in P3-S2<br>2. UNIQUE constraint on (plan_id, date, entry_type) is defense-in-depth<br>3. PostgreSQL advisory lock requires no additional infrastructure |
| **Owner** | Agent 0 (Integration) |
| **Status** | Open — blocked on DECISION_REQUIRED |

### R-A03: Redis Integration Module Missing (🟡 Medium)

| Attribute | Value |
|---|---|
| **Description** | If Redis is chosen for lock/queue, a NestJS module must be built or reused. No Redis abstraction module currently exists. |
| **Root Cause** | Redis not used in Phase 0/1/2 beyond basic OTP cache (likely raw ioredis). |
| **Impact** | Delay in settlement worker implementation if Redis is selected and module not available |
| **Likelihood** | Medium |
| **Severity** | Medium |
| **Mitigation** | 1. Design abstract Lock interface — swap Redis for PostgreSQL if needed<br>2. Build NestJS Redis module as part of P3-S2 prep work |
| **Owner** | Agent 0 (Integration) |
| **Status** | Open — depends on R-A01 resolution |

---

## 3. Integration Risks

### R-I01: Schema Migration Conflicts (🟡 Medium)

| Attribute | Value |
|---|---|
| **Description** | 6 tables and 5 enums created by 4 different agents. Schema additions must be staged in strict FK order. |
| **Root Cause** | Parallel agent work creates risk of unordered schema contributions |
| **Impact** | Migration failures during integration |
| **Likelihood** | Medium |
| **Severity** | Medium |
| **Mitigation** | 1. File Ownership Matrix defines exact table ownership<br>2. Agent 0 coordinates schema additions<br>3. Migration order explicitly defined in ERD and Migration Runbook |
| **Owner** | Agent 0 (Integration) |
| **Status** | Controlled — mitigation in place |

### R-I02: Module Registration Conflicts (🟢 Low)

| Attribute | Value |
|---|---|
| **Description** | Multiple agents adding modules to `app.module.ts` may cause merge conflicts. |
| **Root Cause** | Sequential merge process not followed |
| **Impact** | Integration delays |
| **Likelihood** | Low |
| **Severity** | Low |
| **Mitigation** | 1. Integration Plan defines exact registration order<br>2. All additions are append-only |
| **Owner** | All agents |
| **Status** | Controlled — mitigation in place |

### R-I03: Timezone Utility Duplication (🟡 Medium)

| Attribute | Value |
|---|---|
| **Description** | If timezone utilities are not shared, Agent 2 (rule resolution) and Agent 4 (settlement) may calculate local dates differently. |
| **Root Cause** | No shared timezone library defined in shared types/validation package |
| **Impact** | Rule resolved for wrong date → incorrect accrual amount |
| **Likelihood** | Medium |
| **Severity** | High |
| **Mitigation** | 1. DECISION_REQUIRED: Move timezone utility to `packages/validation` or `packages/types`<br>2. Both agents import from shared package |
| **Owner** | Agent 0 (Integration), Agent 4 |
| **Status** | Open — mitigation depends on type registration |

---

## 4. Data Risks

### R-D01: Decimal Precision Mismatch (🔴 Critical)

| Attribute | Value |
|---|---|
| **Description** | If one agent uses (38,10) and another uses (20,4), wallet entries will fail or truncate. |
| **Root Cause** | P3-S1 marked all precision fields as DECISION_REQUIRED |
| **Impact** | Database constraint violations, data loss, or incorrect accrual amounts |
| **Likelihood** | Medium (during parallel development) |
| **Severity** | Critical |
| **Mitigation** | 1. Agent 0's Decimal Strategy narrowed to single binary choice<br>2. Recommend (38,10) across the board<br>3. Must be resolved before any P3-S2+ implementation |
| **Owner** | ChatGPT Command Center (decision), Agent 0 (escalation) |
| **Status** | BLOCKED on DECISION_REQUIRED |

### R-D02: Accrual Rounding Discrepancy (🟡 Medium)

| Attribute | Value |
|---|---|
| **Description** | HALF_UP vs HALF_DOWN rounding can produce different accrual amounts at 6+ decimal places. |
| **Root Cause** | Rounding mode not yet decided |
| **Impact** | Minor discrepancy in reported vs calculated member balance |
| **Likelihood** | Medium |
| **Severity** | Medium |
| **Mitigation** | 1. Recommend HALF_UP for all accrual operations<br>2. Document rounding mode in decimal spec |
| **Owner** | ChatGPT Command Center |
| **Status** | Blocked on DECISION_REQUIRED |

### R-D03: Floating Point in Calculation (🟢 Low)

| Attribute | Value |
|---|---|
| **Description** | JavaScript Number used instead of decimal library for accrual calculation. |
| **Root Cause** | Codex worker error |
| **Impact** | Precision loss at >15 significant figures |
| **Likelihood** | Low |
| **Severity** | High |
| **Mitigation** | 1. Use `decimal.js` or `pg` numeric type<br>2. Lint rule: no `Number` for monetary calculations<br>3. Code review requirement |
| **Owner** | All agents (implementation), Agent 6 (lint rules) |
| **Status** | Monitored |

---

## 5. Operational Risks

### R-O01: Settlement Worker Fails to Start (🟠 High)

| Attribute | Value |
|---|---|
| **Description** | Worker process fails due to missing config, DB connection error, or startup race condition. |
| **Root Cause** | Configuration error, missing environment variable, worker start before migration |
| **Impact** | No reward accrual until manual restart |
| **Likelihood** | Medium (especially during initial deployment) |
| **Severity** | High |
| **Mitigation** | 1. Health check endpoint monitors worker status<br>2. Automatic retry on startup failure<br>3. Admin manual trigger available as fallback |
| **Owner** | Agent 4 (Settlement) |
| **Status** | Mitigation designed |

### R-O02: Market Timezone Misconfiguration (🟠 High)

| Attribute | Value |
|---|---|
| **Description** | Market configured with incorrect or non-IANA timezone → settlement runs on wrong day. |
| **Root Cause** | Human error during market setup |
| **Impact** | Incorrect accrual dates; reconciliation required |
| **Likelihood** | Low (once configured correctly) |
| **Severity** | High |
| **Mitigation** | 1. IANA timezone validation at market creation<br>2. Admin settlement status shows current local date<br>3. Accruals can be manually corrected via reversal |
| **Owner** | Agent 4 (Settlement), Admin operators |
| **Status** | Mitigation designed |

### R-O03: Market Midnight Detection Error (🟡 Medium)

| Attribute | Value |
|---|---|
| **Description** | Worker polls every N minutes; may miss market midnight boundary. |
| **Root Cause** | Polling interval too long relative to market density |
| **Impact** | Accrual delayed by up to N minutes |
| **Likelihood** | Low |
| **Severity** | Low |
| **Mitigation** | 1. 5-minute default polling interval<br>2. Multiple polls guarantee detection within interval<br>3. Idempotency prevents double accrual |
| **Owner** | Agent 4 (Settlement) |
| **Status** | Mitigation designed |

### R-O04: Worker Processes Same Plan Twice (🟢 Low)

| Attribute | Value |
|---|---|
| **Description** | Lock fails or race condition causes duplicate processing within same polling cycle. |
| **Root Cause** | Lock TTL too short or lock not released properly |
| **Impact** | Duplicate wallet entry |
| **Likelihood** | Very Low |
| **Severity** | High |
| **Mitigation** | 1. UNIQUE constraint on (plan_id, date, entry_type) — defense-in-depth<br>2. Lock TTL well above expected processing time<br>3. Alert on duplicate accrual detection |
| **Owner** | Agent 4 (Settlement) |
| **Status** | Mitigation designed |

---

## 6. Security Risks

### R-S01: Cross-Market Wallet Access Via ID Manipulation (🟠 High)

| Attribute | Value |
|---|---|
| **Description** | Member A in Market MY attempts to access Member B's wallet in Market SG by manipulating wallet ID in request. |
| **Root Cause** | Insufficient ownership verification |
| **Impact** | Data breach: member sees another member's wallet balance |
| **Likelihood** | Low |
| **Severity** | Critical |
| **Mitigation** | 1. Ownership guard: `wallet.member_id === token.member_id`<br>2. Market isolation: service layer filters by member's accessible markets<br>3. API returns 403, not 404, to prevent ID enumeration |
| **Owner** | Agent 1 (Wallet) |
| **Status** | Mitigation designed — implement with ownership guard |

### R-S02: Admin Exceeding Market Scope (🟠 High)

| Attribute | Value |
|---|---|
| **Description** | Admin with Market MY scope attempts to view wallets or trigger settlement for Market SG. |
| **Root Cause** | Missing market authorization check |
| **Impact** | Unauthorized data access |
| **Likelihood** | Low |
| **Severity** | High |
| **Mitigation** | 1. Market access scope checked on every admin API call<br>2. Existing `market_access` table reused<br>3. 403 response on scope violation |
| **Owner** | Agent 5 (Admin) |
| **Status** | Mitigation designed — scope check documented |

### R-S03: API Rate Limiting Not Applied (🟢 Low)

| Attribute | Value |
|---|---|
| **Description** | Wallet and reward plan endpoints not rate-limited, allowing abuse. |
| **Root Cause** | DECISION_REQUIRED — rate limit strategy not finalized |
| **Impact** | Service degradation, potential data scraping |
| **Likelihood** | Low |
| **Severity** | Medium |
| **Mitigation** | 1. DECISION_REQUIRED: apply same rate limit as existing auth endpoints<br>2. Per-member rate limit for wallet reads: 100 req/min |
| **Owner** | Agent 0 (Integration) |
| **Status** | Open — DECISION_REQUIRED |

---

## 7. Schedule Risks

### R-SC01: Phase 3 Sub-Phases Not Authorized (🔴 Critical)

| Attribute | Value |
|---|---|
| **Description** | P3-S2 through P3-S5 are NOT_AUTHORIZED. Implementation cannot begin until authorization is granted. |
| **Root Cause** | Governance process requires P3-S1 review before P3-S2+ can proceed |
| **Impact** | Entire Phase 3 stalled after P3-S1 |
| **Likelihood** | High (by design — governance control) |
| **Severity** | Critical (if Command Center review is delayed) |
| **Mitigation** | 1. Complete P3-S1 review promptly<br>2. Prepare P3-S2+ planning documentation during review<br>3. Parallel review and approval process where possible |
| **Owner** | OpenClaw (escalation), ChatGPT Command Center (approval) |
| **Status** | Governance-controlled |

### R-SC02: Agent Dependency Chain Delays (🟡 Medium)

| Attribute | Value |
|---|---|
| **Description** | Agent 4 depends on Agent 1+2+3; Agent 5 depends on previous waves. Sequential dependency chain means late delivery of one agent blocks subsequent agents. |
| **Root Cause** | DAG dependency structure |
| **Impact** | 16-day schedule may slip |
| **Likelihood** | Medium |
| **Severity** | Medium |
| **Mitigation** | 1. Clear ownership and deadlines per agent<br>2. Integration Plan defines exact merge order<br>3. Parallel work possible within waves |
| **Owner** | Agent 0 (Integration coordination) |
| **Status** | Mitigation in place — monitor during P3-S2+ |

---

## 8. Risk Register Summary

| ID | Risk | Category | Score | Status |
|---|---|---|---|---|
| R-A01 | Worker infrastructure unavailable | Architecture | 🔴 Critical | Open — DECISION_REQUIRED |
| R-D01 | Decimal precision mismatch | Data | 🔴 Critical | Open — DECISION_REQUIRED |
| R-SC01 | Sub-phases not authorized | Schedule | 🔴 Critical | Governance-controlled |
| R-A02 | Distributed lock undecided | Architecture | 🟠 High | Open — DECISION_REQUIRED |
| R-I03 | Timezone utility duplication | Integration | 🟡→🟠 High | Open — needs resolution |
| R-O01 | Worker fails to start | Operations | 🟠 High | Mitigation designed |
| R-O02 | Market timezone misconfiguration | Operations | 🟠 High | Mitigation designed |
| R-S01 | Cross-market wallet access | Security | 🟠 High | Mitigation designed |
| R-S02 | Admin exceeding market scope | Security | 🟠 High | Mitigation designed |
| R-A03 | Redis module missing | Architecture | 🟡 Medium | Open — depends on R-A01 |
| R-I01 | Schema migration conflicts | Integration | 🟡 Medium | Controlled |
| R-D02 | Accrual rounding discrepancy | Data | 🟡 Medium | Open — DECISION_REQUIRED |
| R-O03 | Midnight detection error | Operations | 🟡 Medium | Mitigation designed |
| R-SC02 | Agent dependency chain delays | Schedule | 🟡 Medium | Mitigation in place |
| R-I02 | Module registration conflicts | Integration | 🟢 Low | Controlled |
| R-D03 | Floating point in calculation | Data | 🟢 Low | Monitored |
| R-O04 | Worker processes same plan twice | Operations | 🟢 Low | Mitigation designed |
| R-S03 | Rate limiting not applied | Security | 🟢 Low | Open — DECISION_REQUIRED |

### Risk Dashboard

```
🔴 Critical: 3
🟠 High:     6
🟡 Medium:   6
🟢 Low:      3
────────────
Total:      18
```

---

## 9. Top 3 Risks for Immediate Attention

1. **R-A01 (Worker Infrastructure)** — 🔴 Critical: Without worker framework decision, Agent 4 cannot implement settlement. Resolution in P3-S2 required.

2. **R-D01 (Decimal Precision)** — 🔴 Critical: All agents need numeric precision finalized before DB schema implementation. Single binary choice: match MCP (38,10).

3. **R-SC01 (Phase Authorization)** — 🔴 Critical: P3-S2+ cannot begin until P3-S1 is reviewed and approved by Command Center.

---

## 10. Related Documents

| Document | Location |
|---|---|
| DECISION_REQUIRED Register | [`./DECISION_REQUIRED_REGISTER.md`](./DECISION_REQUIRED_REGISTER.md) |
| Delivery Evidence Summary | [`./P3_S1_DELIVERY_EVIDENCE.md`](./P3_S1_DELIVERY_EVIDENCE.md) |
| Integration Plan | [`../p3-agent0/PHASE_3_INTEGRATION_PLAN.md`](../p3-agent0/PHASE_3_INTEGRATION_PLAN.md) |
| Open Questions | [`../p3-s1/PHASE_3_OPEN_QUESTIONS.md`](../p3-s1/PHASE_3_OPEN_QUESTIONS.md) |
| Phase 3 Master Plan | [`../p3-s1/PHASE_3_MASTER_PLAN.md`](../p3-s1/PHASE_3_MASTER_PLAN.md) |
