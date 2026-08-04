# iPoint Open Questions

> Rules:
> - Each question has a stable ID, description, affected phases, dependency, and status.
> - When resolved, record Resolution Decision ID and status = RESOLVED.
> - Not to be deleted; resolved questions remain visible for reference.

---

## O-01: Merchant Group (chain store) activation rules

| Field | Value |
|---|---|
| **ID** | O-01 |
| **Description** | Merchant Group / chain store activation rules and timeline. Merchant PRD reserves `group_id` field but defines no activation rules or UI. |
| **Affected Phases** | Phase 3 (Merchant Core) |
| **Blocks Phase** | No (field reservation only) |
| **Status** | **OPEN** |
| **Decision needed by** | Before Phase 3 completion |

---

## O-02: Agent course system verification

| Field | Value |
|---|---|
| **ID** | O-02 |
| **Description** | Agent activation requires course completion. No system-level verification method defined (quiz, attendance, certificate upload, admin confirmation?). |
| **Affected Phases** | Phase 6 (Agent & Commission) |
| **Blocks Phase** | Medium risk |
| **Status** | **OPEN** |
| **Decision needed by** | Before Phase 6 planning |

---

## O-03: Advertisement MCP fee pricing model

| Field | Value |
|---|---|
| **ID** | O-03 |
| **Description** | MVP only supports basic ad submission and review. Advertisement MCP fee structure, minimum amounts, and charging rules not fully defined. |
| **Affected Phases** | Phase 9 (Advertising & Content) |
| **Blocks Phase** | No |
| **Status** | **OPEN** |
| **Decision needed by** | Before Phase 9 planning |

---

## O-04 (revised): Merchant staff / sub-account permissions

| Field | Value |
|---|---|
| **ID** | O-04 (revised per C-08) |
| **Description** | Merchant PRD V1.0 states "one merchant = one login account, no team permissions." However, chain store operations may create staff management needs. Temporarily removed from LOCKED. Only data boundary reservation allowed. |
| **Affected Phases** | Phase 3 (Merchant Core) |
| **Blocks Phase** | No (data reservation only; no UI) |
| **Status** | **OPEN** |
| **Decision needed by** | Before Phase 3 full staff UI implementation |

---

## O-05: Agent fees by market (amounts and currency)

| Field | Value |
|---|---|
| **ID** | O-05 |
| **Description** | Agent fee currently RM388 (Malaysia baseline). Amounts and currency for other markets not decided. |
| **Affected Phases** | Phase 6 (Agent & Commission) |
| **Blocks Phase** | No (CONFIGURABLE; values not hard-coded) |
| **Status** | **RESOLVED (Malaysia) / OPEN (other markets)** |
| **Resolution Decision ID** | D-046 |
| **Resolution** | Malaysia Agent Activation Fee is RM388.00 MYR; G1 commission is RM88 and G2 commission is RM38 for future qualifying Malaysia events. Other-market fee amounts and currencies remain OPEN. |
| **Decision needed by** | Before Phase 6 market expansion |

---

## O-06: Reward rate min/max and decimal precision

| Field | Value |
|---|---|
| **ID** | O-06 |
| **Description** | Reward percentages: allowed minimum, maximum, and decimal precision not formally approved. |
| **Affected Phases** | Phase 5 (iPoint Reward Engine) |
| **Blocks Phase** | No (CONFIGURABLE; validation rules can be defined later) |
| **Status** | **RESOLVED (Malaysia/initial MVP)** |
| **Resolution Decision ID** | D-046 |
| **Resolution** | Malaysia/initial MVP reward rate range is 0% to 0.05% per day with 6 decimal input precision. Any rate above 0.05% requires new governance. Other-market ranges remain governed by future decisions. |
| **Decision needed by** | Resolved for Malaysia/initial MVP 2026-08-01; other markets require future decisions |

---

## O-07: Special merchant service fee range and authorization

| Field | Value |
|---|---|
| **ID** | O-07 |
| **Description** | Admin PRD reserves special percentages (e.g., 8%, 12%). Allowed range and over-range authorization conditions not defined. |
| **Affected Phases** | Phase 3 (Merchant Core) |
| **Blocks Phase** | No (CONFIGURABLE) |
| **Status** | **RESOLVED** |
| **Resolution Decision ID** | D-010 |
| **Resolution** | Special service fee range: >0% AND <=100%. LOCKED business rule. |
| **Decision needed by** | Resolved 2026-07-17 |

---

## O-08: Market-specific KYC / data retention / legal compliance

| Field | Value |
|---|---|
| **ID** | O-08 |
| **Description** | Each market has independent legal requirements for KYC, data retention, and compliance. Details not yet documented per market. |
| **Affected Phases** | All Phases |
| **Blocks Phase** | No (build minimum baseline; extend per market) |
| **Status** | **OPEN** |
| **Decision needed by** | Before each new market launch |

---

## O-09: PWA admin approval operation scope

| Field | Value |
|---|---|
| **ID** | O-09 |
| **Description** | Admin PWA supports viewing and lightweight approvals. Exact scope of PWA-approvable operations not defined. |
| **Affected Phases** | Phase 7 (Admin Operations) |
| **Blocks Phase** | No |
| **Status** | **RESOLVED (Phase 7 MVP)** |
| **Resolution Decision ID** | D-046 |
| **Resolution** | Admin PWA is limited to read-only monitoring and safe navigation. No financial Maker/Checker approval, privileged mobile approval, or offline write queue is allowed; sensitive writes require the full online Admin Web. |
| **Decision needed by** | Resolved for Phase 7 MVP 2026-08-01 |

---

## O-10 (revised): Long-term inactive member/agent handling

| Field | Value |
|---|---|
| **ID** | O-10 (revised; was O-11) |
| **Description** | No rule defined for members/agents who remain inactive (no consumption, no promotion) for extended periods. |
| **Affected Phases** | Phase 6 (Agent & Commission) |
| **Blocks Phase** | No |
| **Status** | **OPEN** |
| **Decision needed by** | Before Phase 6 completion |

---

## O-13: Member-facing reward-rule creation route security (CRITICAL FINDING)

| Field | Value |
|---|---|
| **ID** | O-13 |
| **Description** | `POST /api/v1/rewards/rules` (apps/api/src/reward/reward.controller.ts) is guarded ONLY by `AuthGuard` — any authenticated ACCOUNT can call `RewardService.createRuleVersion` (raw insert): no RBAC/permission check, no market enforcement (`marketId` optional in member DTO), no §7.1 0.05%/day governance ceiling (any positive decimal accepted, e.g. `"999"`), no six-decimal limit, no future-market-local-00:00 rule, `effectiveTo` (closed windows) allowed, no reason, no audit, no idempotency; `createdBy` is client-suppliable (attribution spoofing). Severity: **HIGH** (authorization bypass + governance-limit bypass on a Phase 3 owner resource, unaudited, spoofable attribution). Confirmed by D-050 independent reviewer (2026-08-05); the D-050 fix branch correctly did NOT touch `apps/api/src/reward/**` (outside its scope). |
| **Affected Phases** | Phase 3 (frozen owner member surface), Phase 7 |
| **Blocks Phase** | No (D-050/CG-02 acceptance is independent); blocks safe member exposure of reward-rule creation; remediation decision required |
| **Status** | **OPEN — CRITICAL FINDING (remediation decision pending; candidate follow-on owner remediation)** |
| **Decision needed by** | Before any member-facing reward rule surface is exposed; recommended: remove/secure the member route (owner remediation, e.g. D-053) |

---

## Resolved questions (kept for reference)

| Original ID | Description | Resolution Decision ID | Status |
|---|---|---|---|
| O-04 (original) | MCP manual adjustment amount threshold | D-002 (C-03): No threshold; all adjustments require Maker/Checker | **RESOLVED** |
| O-10 (original) | Receipt 60 minutes configurable | D-002 (C-04): MVP locked 60 min, Admin not adjustable | **RESOLVED** |
| O-12 (original) | Redemption refund recalculates Reward Plan cap | D-002 (C-05): Refund only returns wallet points; Reward Plan unaffected | **RESOLVED** |
| O-05 (Malaysia portion) | Malaysia Agent Activation Fee and G1/G2 amounts | D-046: RM388.00 MYR; G1 RM88; G2 RM38. Other markets remain OPEN. | **RESOLVED (Malaysia)** |
| O-06 | Reward rate min/max and decimal precision | D-046: Malaysia/initial MVP 0% to 0.05% per day, 6 decimal input precision; above 0.05% requires new governance. | **RESOLVED (Malaysia/initial MVP)** |
| O-09 | PWA admin approval operation scope | D-046: Read-only monitoring and safe navigation only; sensitive writes require full online Admin Web. | **RESOLVED (Phase 7 MVP)** |
