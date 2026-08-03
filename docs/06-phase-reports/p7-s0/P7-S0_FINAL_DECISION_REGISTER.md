# P7-S0 Final Decision Register

> **Status: FINAL / ACCEPTED / FROZEN UNDER D-046 / NOT P7-S1+ IMPLEMENTATION AUTHORIZATION**
>
> **Authority:** ChatGPT Command Center D-046 order, incorporating Bryan's approved commercial decisions.
>
> This register consolidates governance decisions only. It authorizes no production code, migration, schema, test, CI, frozen-domain modification, deployment, or P7-S1+ implementation.

## 1. Decision register

### P7-OD-01 — Admin Roles

- **Status:** APPROVED
- **Approved rule:** Phase 7 MVP uses exactly six roles: Super Admin, Operations Admin, Finance Operator, Finance Approver, KYC Reviewer, and Support / Read-only Auditor. There is no Department hierarchy and no custom role designer in MVP. Finance Operator and Finance Approver remain separate.
- **Enforcement / implementation notes:** Runtime Maker/Checker identity inequality is mandatory. A role is only an assignment template and never replaces Action Permission or Market Access. UI visibility is not authorization.

### P7-OD-02 — Admin Market Context

- **Status:** APPROVED
- **Approved rule:** Every Admin, including Super Admin, must select one authorized Current Admin Market. All ordinary reads and every write operate within one explicit market. There is no global operational write mode and no global financial total. Cross-market and cross-currency values remain separate. A read-only global overview is deferred.
- **Enforcement / implementation notes:** The server must validate active Market Access on every request; a route, header, browser state, or role label is context only. No silent cross-market aggregation or currency conversion is permitted.

### P7-OD-03 — Maker/Checker Scope

- **Status:** APPROVED
- **Approved rule:** Phase 7 Maker/Checker applies only to Manual MCP Adjustment and Manual iPoint Wallet Adjustment. Phase 6 Redemption Refund Maker/Checker remains an independent frozen workflow.
- **Enforcement / implementation notes:** Do not add Maker/Checker to Reward Rate, Redemption Rate, Merchant Package, Special Merchant Percentage, Commission Rate, Market Configuration, KYC, or ordinary Admin operations. Those operations use permission, MFA, prospective versioning, effective time, audit, idempotency, and concurrency controls.

### P7-OD-04 — Reward Rate Activation

- **Status:** APPROVED
- **Approved rule:** Reward Rate changes may activate only at a future market-local `00:00`. Immediate or same-day activation is excluded from MVP. The Admin UI must display the market-local effective time and resolved UTC. Existing and historical reward entries are never recalculated. Overlapping active versions are prohibited.
- **Enforcement / implementation notes:** Conversion uses the market IANA timezone. Scheduling requires database/transaction-level overlap protection, exact decimal handling, idempotency, and immutable audit evidence.

### P7-OD-05 — Reward Rate Range and Precision (MVP)

- **Status:** APPROVED
- **Approved rule:** Input is percentage points per day and displayed as `%/day`. Minimum `0%`; maximum `0.05%` per day; maximum input precision six decimal places. Storage uses a decimal string/exact decimal; JavaScript binary floating-point conversion is prohibited. Package reference limits are A `0.0125%/day`, B `0.025%/day`, and C/D/E/F `0.05%/day` maximum.
- **Enforcement / implementation notes:** A proposal above `0.05%/day` requires a new Bryan plus Command Center governance decision. Validation policy must be explicit and versioned; historical rewards and consumed rule snapshots remain unchanged.

### P7-OD-06 — Redemption Rate

- **Status:** APPROVED
- **Approved rule:** Redemption Rate is configured independently per market; there is no universal global commercial rate. Versions are forward-only and immutable, and historical quotes/orders retain the original Rate Version. Technical precision ceiling is ten decimal places; UI display precision is up to six decimals. Malaysia MVP displays local currency value per 1 iPoint: initial `1 iPoint = RM1.00`, minimum `RM0.50`, maximum `RM2.00`.
- **Enforcement / implementation notes:** Other markets are blocked until Initial, Minimum, Maximum, Currency, and Display Unit are explicitly configured. There is no silent Malaysia fallback. Overlap protection, market authorization, idempotency, audit, and quote/order snapshot preservation are mandatory.

### P7-OD-07 — Special Merchant Package Authority

- **Status:** APPROVED
- **Approved rule:** Only Super Admin may create or activate a special Merchant Package percentage in MVP, through a dedicated permission. Standard package management may be delegated separately. No additional Maker/Checker workflow applies. Every special percentage requires a reason and immutable audit evidence.
- **Enforcement / implementation notes:** The locked D-010 range remains `>0%` and `<=100%`. Super Admin role alone does not replace the dedicated permission or Current Admin Market validation.

### P7-OD-08 — Existing Merchant Package Assignments

- **Status:** APPROVED
- **Approved rule:** A new Package Version does not automatically affect existing Merchant Assignments. Existing merchants remain bound to their assigned version. A change requires explicit, audited reassignment. No automatic batch migration exists in MVP. Historical transactions remain unchanged.
- **Enforcement / implementation notes:** Assignment and transaction snapshots remain immutable. Any future bulk migration would require separate authorization, preview, audit, idempotency, and rollback design.

### P7-OD-09 — Commission Parameter Changes

- **Status:** APPROVED
- **Approved rule:** Commission parameter changes affect future qualifying source events only. Historical commissions are never recalculated. Existing ledger entries remain immutable. Corrections use exact-opposite compensation only.
- **Enforcement / implementation notes:** Preserve the corrected D-042 semantics: the original Commission Ledger entry is fully immutable and compensation is a new linked opposite entry.

### P7-OD-10 — Manual Adjustment Limits (Malaysia MVP)

- **Status:** APPROVED
- **Approved rule:** Manual MCP Adjustment has a soft cap of `10,000 MCP` and hard cap of `100,000 MCP` per request. Manual iPoint Adjustment has a soft cap of `10,000 iPoint` and hard cap of `100,000 iPoint` per request. Every amount requires distinct Maker and Checker identities. At or below Soft Cap, Finance Approver may check. Above Soft Cap and at or below Hard Cap, Super Admin must check. Above Hard Cap, the system rejects.
- **Enforcement / implementation notes:** No threshold exempts Maker/Checker. Limits are versioned and market-specific. Other markets remain blocked until configured. Role and threshold routing never weaken runtime identity inequality.

### P7-OD-11 — Adjustment Evidence

- **Status:** APPROVED
- **Approved rule:** Every manual MCP/iPoint adjustment requires Reason Code, detailed explanation, Case/Ticket Reference, Maker identity and timestamp, and Checker identity and timestamp. Attachment is mandatory when the amount exceeds Soft Cap, the Reason Code is high-risk, or the Checker explicitly requests it; attachment is not mandatory for ordinary requests.
- **Enforcement / implementation notes:** Store only an opaque protected attachment reference in the adjustment record; never raw file contents in Audit JSON. Evidence access is permission- and market-restricted. File type, size, malware scanning, and retention policy must be approved before production. If secure evidence storage is unavailable, above-Soft-Cap execution remains disabled.

### P7-OD-12 — Admin MFA

- **Status:** APPROVED
- **Approved rule:** MFA is mandatory for every Admin role. Generic email OTP alone must not be described as MFA unless it is implemented as an approved second factor. Sensitive actions may require step-up MFA. Enrollment, challenge, recovery, reset, and audit are required.
- **Enforcement / implementation notes:** Sensitive Admin operations remain disabled until MFA is implemented, verified, and accepted. Authentication success alone is insufficient.

### P7-OD-13 — Admin Session Policy

- **Status:** APPROVED
- **Approved rule:** Idle timeout is 30 minutes, absolute session duration is 8 hours, and refresh-family maximum is 7 days. Enforcement is server-side; client timers are not security controls. Required controls are current-session logout, individual session revocation, revoke all sessions, forced revocation after suspension, forced revocation after password reset, and refresh-token reuse family revocation.
- **Enforcement / implementation notes:** Revocation must take effect on the next request and be audited. Session rotation and token-family protections must reuse the canonical auth owner.

### P7-OD-14 — Basic Exports

- **Status:** APPROVED
- **Approved rule:** CSV and downloadable exports are excluded from the initial Phase 7 MVP. MVP provides on-screen bounded operational reports only. Async export infrastructure is deferred. Raw Audit, KYC, Voucher, and financial-ledger export is prohibited.
- **Enforcement / implementation notes:** Export may be reconsidered only after Admin security and masking are accepted. An unavailable export must be shown explicitly; the UI must not fall back to client-side downloads.

### P7-OD-15 — Sensitive Data Masking

- **Status:** APPROVED
- **Approved rule:** Sensitive data access is deny-by-default. KYC Reviewer sees only minimum review evidence. Support sees masked identity/contact data and no raw documents. Finance roles see only necessary financial identifiers. Super Admin does not automatically receive unrestricted raw KYC documents. Raw sensitive access requires a dedicated permission and a recorded reason. Every sensitive evidence view is audited. No raw document export exists in Phase 7 MVP.
- **Enforcement / implementation notes:** Apply server-side projections and field allowlists. UI masking alone is insufficient. Retention remains market/legal-policy governed.

### P7-OD-16 — Dashboard Freshness

- **Status:** APPROVED
- **Approved rule:** Operational queues and urgent status alerts are at most 60 seconds old; aggregate KPI counts are at most 5 minutes old. Every metric shows an `asOf` timestamp, freshness state, stale/unavailable state, and clear metric definition. Missing data displays `Unavailable`, never fabricated zero.
- **Enforcement / implementation notes:** Current 20-row merchant counts and fabricated reward-job results are prohibited as Dashboard truth. Metrics are bounded server read models and keep market/currency dimensions explicit.

### P7-OD-17 — Support Ledger Visibility

- **Status:** APPROVED
- **Approved rule:** Support / Read-only Auditor has no raw MCP, iPoint, or Commission Ledger access. Support receives masked transaction/reference summaries only. Detailed ledger access is restricted to authorized Finance roles.
- **Enforcement / implementation notes:** Enforcement is server-side through permission, market scope, and safe response projections; UI-only restrictions are prohibited.

### P7-OD-18 — Rejected Adjustment Handling

- **Status:** APPROVED
- **Approved rule:** Rejected adjustment requests are immutable and cannot be edited or resubmitted in place. The Maker creates a new request that references the prior request through `replacesRequestId`, `priorRequestId`, or an equivalent approved linkage. Rejection history remains permanently auditable.
- **Enforcement / implementation notes:** New requests receive new idempotency and decision records. No status/history overwrite or reuse of the rejected record is permitted.

### P7-OD-19 — Redemption Refund Ledger Gap (HARD GATE)

- **Status:** APPROVED
- **Approved rule:** The current Phase 6 refund approval must not be exposed through Phase 7. Isolated Phase 6 frozen-owner remediation is mandatory before refund approval can be enabled. Required remediation includes exact-opposite wallet ledger credit, wallet projection restoration, atomic order/refund/inventory/wallet transaction, idempotency and payload-mismatch protection, permission and market enforcement, Maker/Checker preservation, immutable audit evidence, concurrency tests, and full Phase 3 and Phase 6 regression.
- **Enforcement / implementation notes:** Until separately authorized and accepted, refund approval UI is unavailable. Only read-only refund status may be exposed through a safe market-scoped adapter. Direct database workarounds are prohibited.

### P7-OD-20 — Manual iPoint Adjustment (Required Phase 7 MVP Capability)

- **Status:** APPROVED
- **Approved rule:** A compliant durable Maker/Checker workflow is required for Phase 7 MVP but must be implemented only under a separately authorized integration sub-phase. The current immediate-execution endpoint must not be exposed. Lifecycle: Draft/Create, Submitted/Pending Checker, Approved, Rejected, Executing, Executed, Failed.
- **Enforcement / implementation notes:** Execution uses the frozen Phase 3 wallet ledger service. Direct balance mutation is prohibited. Exact-opposite correction semantics, forward-only migration, payload-hash idempotency, atomicity, concurrency protection, and deep financial regression are mandatory. D-046 authorizes no implementation.

### P7-OD-21 — Frozen Owner vs Phase 7 Adapter

- **Status:** APPROVED
- **Approved rule:** Ownership is capability-by-capability. Frozen-owner remediation is required for domain correctness defects, ledger defects, market authorization defects, permission defects, broken domain routes, incorrect generation/rate semantics, and atomicity or idempotency defects. Phase 7 adapters are allowed only for Admin-specific read projections, dashboard aggregation, queue composition, and safe orchestration that calls canonical owner services.
- **Enforcement / implementation notes:** Phase 7 must not duplicate domain business logic or legitimize an unsafe owner command behind a facade.

### P7-OD-22 — Admin PWA Scope

- **Status:** APPROVED
- **Approved rule:** Admin PWA MVP is read-only monitoring and safe navigation. It provides no financial Maker/Checker approval, privileged mobile approval, offline write queue, or background replay of privileged commands. Sensitive writes require the full online Admin Web flow.
- **Enforcement / implementation notes:** Offline/stale states must be explicit. Service workers must not cache or replay privileged command payloads.

## 2. Malaysia Agent Activation Fee decision

### P7-OD-AF-01 — Malaysia Agent Activation Fee

- **Status:** APPROVED
- **Approved rule:** Malaysia market, currency MYR, Agent Activation Fee `RM388.00`. Future implementation is market-scoped, currency-scoped, versioned, and future-effective only. Each activation record snapshots the fee version, amount, and currency; historical activations are never repriced. There is no hard-coded MYR fallback in canonical business logic. Other markets cannot activate agents until their fee configuration is approved.
- **Enforcement / implementation notes:** Malaysia Agent Upgrade Commission remains first generation `RM88` and second generation `RM38`. These amounts apply only to future qualifying Malaysia agent activation events and must be versioned before configurable Admin exposure. Fee configuration and frozen Phase 5 remediation require separate authorization.

## 3. Still-open governance items

The following are **OPEN**, not approved implementation behavior. Unavailable capabilities must be represented explicitly and no fallback may be invented.

| Open item                                | Status                | Required treatment                                                                                      |
| ---------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| Agent course verification automation     | OPEN                  | Display existing evidence/state only; no invented quiz, attendance, certificate, or automatic verifier. |
| Agent reapplication policy               | OPEN                  | No automatic eligibility, cooldown, reset, or lifecycle consequence.                                    |
| Merchant/branch attribution reassignment | OPEN                  | Existing attribution is read-only; no reassignment command or batch correction.                         |
| Per-market legal KYC retention periods   | OPEN                  | Retention and deletion behavior remain blocked pending market legal policy.                             |
| Inactive-user automatic consequences     | OPEN                  | No automatic suspension, balance, reward, agent, or commission consequence.                             |
| New-market compliance requirements       | OPEN                  | No market launch or fallback policy without explicit compliance configuration.                          |
| Advanced exports                         | OPEN / DEFERRED       | No async export, raw export, warehouse, or broad data extraction in Phase 7 MVP.                        |
| Global Admin dashboard                   | OPEN / DEFERRED       | No global mode; selected-market operational views only.                                                 |
| Financial approvals through PWA          | OPEN / DEFERRED       | Explicitly unavailable in MVP.                                                                          |
| Phase 8-12 modules                       | OPEN / NOT AUTHORIZED | No implementation or implied availability under D-046.                                                  |

## 4. Freeze and authorization statement

This register is the authoritative P7-S0 consolidation under D-046. It freezes decisions for later authorized planning and implementation. It does **not** authorize P7-S1 through P7-S10, any remediation gate, any migration, or any production behavior.
