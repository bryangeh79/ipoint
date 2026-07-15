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
| **Status** | **OPEN** |
| **Decision needed by** | Before Phase 6 market expansion |

---

## O-06: Reward rate min/max and decimal precision

| Field | Value |
|---|---|
| **ID** | O-06 |
| **Description** | Reward percentages: allowed minimum, maximum, and decimal precision not formally approved. |
| **Affected Phases** | Phase 5 (iPoint Reward Engine) |
| **Blocks Phase** | No (CONFIGURABLE; validation rules can be defined later) |
| **Status** | **OPEN** |
| **Decision needed by** | Before Phase 5 verification |

---

## O-07: Special merchant service fee range and authorization

| Field | Value |
|---|---|
| **ID** | O-07 |
| **Description** | Admin PRD reserves special percentages (e.g., 8%, 12%). Allowed range and over-range authorization conditions not defined. |
| **Affected Phases** | Phase 3 (Merchant Core) |
| **Blocks Phase** | No (CONFIGURABLE) |
| **Status** | **OPEN** |
| **Decision needed by** | Before Phase 3 completion |

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
| **Affected Phases** | Phase 8 (Admin Operations) |
| **Blocks Phase** | No |
| **Status** | **OPEN** |
| **Decision needed by** | Before Phase 8 UI design |

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

## Resolved questions (kept for reference)

| Original ID | Description | Resolution Decision ID | Status |
|---|---|---|---|
| O-04 (original) | MCP manual adjustment amount threshold | D-002 (C-03): No threshold; all adjustments require Maker/Checker | **RESOLVED** |
| O-10 (original) | Receipt 60 minutes configurable | D-002 (C-04): MVP locked 60 min, Admin not adjustable | **RESOLVED** |
| O-12 (original) | Redemption refund recalculates Reward Plan cap | D-002 (C-05): Refund only returns wallet points; Reward Plan unaffected | **RESOLVED** |
