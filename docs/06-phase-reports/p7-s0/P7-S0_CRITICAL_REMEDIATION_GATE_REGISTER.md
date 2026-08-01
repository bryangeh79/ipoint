# P7-S0 Critical Remediation Gate Register

> **Status: FINAL / ACCEPTED / FROZEN UNDER D-046 / NOT P7-S1+ IMPLEMENTATION AUTHORIZATION**
>
> This register defines release gates only. It does not authorize remediation or implementation.

## 1. Gate register

### GATE-SEC-01 — Manual iPoint Adjustment Maker/Checker

| Field | Value |
|---|---|
| **Finding reference** | SEC-01; P7-OD-03, P7-OD-10, P7-OD-11, P7-OD-18, P7-OD-20 |
| **Severity** | CRITICAL |
| **Current risk** | Existing Admin endpoint executes an iPoint wallet adjustment immediately without a durable Maker/Checker request/decision lifecycle. |
| **Required remediation** | Prohibit current endpoint exposure. Under separate authorization, add forward-only durable lifecycle Draft/Create, Submitted/Pending Checker, Approved, Rejected, Executing, Executed, Failed; distinct server-derived identities; Malaysia soft/hard routing; evidence policy; rejected-request replacement linkage; execution through frozen Phase 3 wallet ledger service; exact-opposite correction; atomic state/ledger/audit; payload-hash idempotency; market/permission/MFA enforcement; deterministic concurrency. |
| **Owning authority** | Phase 3 wallet/ledger frozen owner plus separately authorized Phase 7 integration owner; Command Center acceptance required |
| **Authorization status** | NOT AUTHORIZED / FEATURE BLOCKED |
| **Evidence required for gate release** | Approved brief and migration; real PostgreSQL/API/browser tests; same-person rejection at all amounts including Super Admin; caps/evidence/high-risk attachment; same-key same/different payload; concurrent decision/execution; failure/retry; immutable rejection/replacement; exact ledger/projection and compensation; full Phase 3 financial regression; clean OpenAPI/security/audit evidence |

### GATE-SEC-02 — Redemption Refund Wallet Ledger Gap

| Field | Value |
|---|---|
| **Finding reference** | SEC-02; P7-OD-19 |
| **Severity** | CRITICAL / HARD GATE |
| **Current risk** | Phase 6 refund approval can move order/refund/inventory state without appending the required wallet credit ledger entry and restoring the wallet projection. |
| **Required remediation** | Isolated Phase 6 owner change providing exact-opposite wallet ledger credit, wallet projection restoration, one atomic order/refund/inventory/wallet transaction, request idempotency and payload mismatch rejection, permission and market enforcement, preserved distinct Maker/Checker, immutable audit, deterministic locking/concurrency, safe recovery. |
| **Owning authority** | Phase 6 Redemption frozen owner; Command Center must separately authorize and accept |
| **Authorization status** | NOT AUTHORIZED / REFUND APPROVAL HARD-BLOCKED |
| **Evidence required for gate release** | Approved isolated remediation brief/commit; successful and rollback real-DB tests; duplicate/mismatch/concurrent approval tests; permission/market/same-person negative tests; exact wallet ledger and projection assertions; order/refund/inventory consistency; immutable audit; full Phase 3 wallet and Phase 6 redemption regression; safe Phase 7 adapter acceptance |

### GATE-AUTH-01 — Admin MFA Prerequisite

| Field | Value |
|---|---|
| **Finding reference** | Admin MFA capability MISSING; P7-OD-12; authentication audit |
| **Severity** | CRITICAL SECURITY PREREQUISITE |
| **Current risk** | Generic OTP exists but no accepted Admin MFA enrollment, bound factor, login challenge, recovery/reset, or lifecycle audit. Calling generic email OTP “MFA” would create a false security claim. |
| **Required remediation** | Implement approved second-factor policy for every Admin role, enrollment, challenge, recovery, reset, factor lifecycle audit, and step-up for sensitive actions. Keep sensitive operations disabled until accepted. Integrate with canonical auth/session owner and D-046 session rules. |
| **Owning authority** | Canonical Auth/Platform Access owner under separately authorized P7-S2; Command Center acceptance required |
| **Authorization status** | NOT AUTHORIZED / SENSITIVE ADMIN OPERATIONS BLOCKED |
| **Evidence required for gate release** | Threat/security-reviewed factor contract; real HTTP/DB/browser enrollment/challenge/recovery/reset tests; suspended/ineligible denial; step-up tests; replay/rate-limit/expiry/concurrency tests; complete audit events; session binding/revocation; accessibility and recovery UX evidence; proof no generic OTP-only false claim |

### GATE-RBAC-01 — RBAC and Permission Seed Remediation

| Field | Value |
|---|---|
| **Finding reference** | SEC-12; P7-S0B/C permission inventory; P7-OD-01/02/07/15/17 |
| **Severity** | HIGH / RELEASE PREREQUISITE |
| **Current risk** | Required controller permissions are missing or inconsistent in foundation seeds; broad permissions overlap; role grants can silently expand; UI role assumptions cannot prove route authorization. |
| **Required remediation** | Reconcile a server-owned permission catalog with every registered route; add six controlled role templates; dedicated special-package and sensitive-evidence permissions; explicit read-only Support allowlist; separate Finance Maker/Checker permissions; active Market Access checks; migration/seed repeatability; no suffix heuristic or role-only bypass. |
| **Owning authority** | Platform Access/RBAC owner under separately authorized P7-S2; frozen-domain owners approve codes on their routes |
| **Authorization status** | NOT AUTHORIZED / AFFECTED FEATURES BLOCKED |
| **Evidence required for gate release** | Route-to-permission inventory and zero drift; forward migration/seed twice/drift tests; six-role positive/negative matrix; crafted HTTP denial; market grant/revocation; same-person runtime inequality; Support raw ledger/KYC denial; Super Admin dedicated-permission tests; audit of role/permission/market changes; OpenAPI consistency |

### GATE-P5-01 — Phase 5 Route and Market Remediation

| Field | Value |
|---|---|
| **Finding reference** | SEC-04, SEC-05, SEC-06, SEC-07, SEC-08, SEC-09, SEC-11; P7-OD-09, P7-OD-21; Malaysia Agent Activation Fee decision |
| **Severity** | HIGH; CRITICAL FOR AFFECTED FINANCIAL/AGENT EXPOSURE |
| **Current risk** | Doubled API prefixes, unregistered controllers, cross-market commission access, missing Market Access enforcement, unsafe agent activation attribution/atomicity, hard-coded MYR/fallback fee behavior, and commission generation/range conflicts prevent safe Phase 7 exposure. |
| **Required remediation** | Capability-by-capability Phase 5 owner changes: canonical single-prefix registered routes, explicit permissions and active market grants, safe typed projections, actor attribution/audit, atomic failure semantics, versioned Malaysia RM388 fee snapshot with no fallback and other-market block, prospective RM88/RM38 commission versions, reconciled generation/unit/range rules, idempotency/payload hash and concurrency. Phase 7 may then add safe adapters only. |
| **Owning authority** | Phase 5 Agent/Commission frozen owner; Command Center separate authorization and acceptance; Phase 7 owns only later UI/read/orchestration adapters |
| **Authorization status** | NOT AUTHORIZED / AGENT AND COMMISSION ADMIN EXPOSURE BLOCKED BY CAPABILITY |
| **Evidence required for gate release** | Registered runtime/OpenAPI route proof; route/permission/market HTTP negative tests; no cross-market reads/writes; canonical service selection; atomic agent activation/commission failure tests; versioned fee and activation snapshot; no MYR/388 fallback for other markets; future-event-only rate tests; D-042 immutable compensation regression; idempotency/mismatch/concurrency; full Phase 5 B/C/D regression |

## 2. Gate release rules

1. Only the owning authority may implement a frozen-owner remediation.
2. A Phase 7 UI or adapter cannot release a domain gate.
3. Gate release requires an explicit Command Center acceptance decision after the listed evidence passes.
4. Until release, the affected action is unavailable and the UI must state the prerequisite; hidden or direct-database workarounds are prohibited.
5. Read-only access before release is allowed only through a separately reviewed, permissioned, market-scoped, masked adapter that cannot invoke the blocked command.

## 3. Current overall state

All five gates remain **NOT AUTHORIZED** for remediation under D-046. SEC-01, SEC-02, and Admin MFA block the affected MVP capabilities. RBAC/permission and Phase 5 route/market gates block only the surfaces that depend on them, but no dependent surface may be claimed complete before acceptance.
