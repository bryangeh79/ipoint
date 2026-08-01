# P7-S0 Frozen Admin Operations Contract

> **Status: FINAL / ACCEPTED / FROZEN UNDER D-046 / NOT P7-S1+ IMPLEMENTATION AUTHORIZATION**
>
> This documentation contract consolidates the Phase 7 Admin Operations boundary. It freezes what later authorized work must satisfy; it does not authorize implementation, remediation, migration, deployment, or modification of frozen Phase 3-6 owners.

## 1. Contract classification

Every requirement belongs to exactly one governance category.

### A. Approved business rules

- Six fixed MVP roles; no departments or custom role designer.
- Role + Action Permission + Market Access are all required; role alone never authorizes an action.
- One explicit Current Admin Market for every Admin and every ordinary read/write; no global operational write mode or cross-currency financial total.
- Manual adjustment Maker/Checker applies only to MCP and iPoint adjustments; Phase 6 refund Maker/Checker remains independent.
- Configuration changes are prospective, versioned, audited, idempotent, concurrency-safe, and never recalculate history.
- D-046 commercial values and bounds in the Final Decision Register are controlling.
- On-screen bounded reports only; no initial MVP downloads/exports.
- Admin PWA is read-only monitoring and navigation.

### B. Mandatory security prerequisites

- Accepted Admin MFA for every role, with enrollment, challenge, recovery, reset, audit, and step-up where required.
- Server-enforced 30-minute idle, 8-hour absolute, and 7-day refresh-family limits plus complete revocation controls.
- Reconciled permission catalog/RBAC seeds and route-by-route enforcement.
- Server-side Current Admin Market grant validation on every market-scoped request.
- Deny-by-default sensitive projections, recorded reasons for raw evidence access, audit-of-view, and no raw document/ledger export.
- Stable error contracts, payload-hash idempotency, database/transaction-level concurrency protection, and immutable privileged audit.

### C. Frozen owner remediation gates

- SEC-01 compliant Manual iPoint Adjustment requires a separately authorized Phase 3/Phase 7 integration workflow.
- SEC-02 refund wallet-ledger gap requires isolated Phase 6 frozen-owner remediation before approval exposure.
- Phase 5 broken/doubled routes, market authorization, agent activation, fee/version, commission generation/rate, and idempotency defects stay with the frozen owner.
- Phase 6 permission/market defects, unreachable domain routes, and redemption-rate conflicts require frozen-owner authorization when they affect domain correctness or commands.
- Phase 7 may create safe read projections and orchestration only after the canonical owner command is safe.

### D. Deferred scope

- Downloadable/CSV/async exports; advanced reporting, reconciliation, risk cases, fraud scoring, warehouse, BI, and regulatory reporting.
- Read-only global Admin overview/dashboard.
- Financial or privileged approvals through PWA; offline privileged writes or replay.
- Phase 8 advertising/content, Phase 9 advanced reporting/risk/audit, Phase 10 full-platform E2E, Phase 11 production readiness, and Phase 12 deferred-module evaluation.
- Custom roles, Department hierarchy, automatic package-assignment migration, and bulk commercial migrations.

### E. Still-open governance questions

- Agent course verification automation.
- Agent reapplication policy.
- Merchant/branch attribution reassignment.
- Per-market legal KYC retention periods and new-market compliance requirements.
- Inactive-user automatic consequences.
- Advanced export policy, global Admin dashboard, PWA financial approval, and any Phase 8-12 production behavior not separately approved.

OPEN behavior is unavailable. No default, Malaysia fallback, synthetic success, or UI-only workaround may fill an OPEN item.

## 2. Product and ownership boundary

Phase 7 is the secure operational layer for administering existing iPoint domains. It owns Admin UX, safe operational read models, queue composition, and orchestration of canonical owner services. It does not own wallet, MCP, transaction, reward, commission, agent, KYC, package, redemption, voucher, or audit domain truth.

Frozen owner remediation is required for correctness, ledger, market authorization, permission, route, generation/rate, atomicity, or idempotency defects. Phase 7 adapters may expose safe projections and invoke accepted canonical commands but must never duplicate formulas, mutate domain tables directly, impersonate Member/Merchant actors, or convert a broken owner command into an apparent supported feature.

## 3. Roles, permissions, and market context

### 3.1 MVP roles

| Role | Core purpose | Default prohibitions |
|---|---|---|
| Super Admin | Platform governance and exceptional approved operations | No same-person approval bypass; no automatic raw KYC access; no global write mode |
| Operations Admin | Daily member, merchant, fulfilment, and operational queues | No finance approvals, RBAC governance, or exceptional commercial authority by default |
| Finance Operator | Financial read/reconciliation and adjustment Maker | Cannot check own request or receive Checker authority by role combination |
| Finance Approver | Independent adjustment Checker | Cannot make the request it checks; escalation caps still apply |
| KYC Reviewer | Minimum-evidence member/merchant KYC review | No finance, ledger, package/rate, or unrelated status authority |
| Support / Read-only Auditor | Masked operational lookup and read-only audit | No writes, raw ledgers, raw KYC documents, secret reveal, or export |

There is no Department hierarchy and no custom role designer in MVP. System roles are controlled templates. Every protected action requires authenticated Admin status, accepted MFA, a specific Action Permission, and—when market-scoped—an active Market Access grant.

### 3.2 Current Admin Market

Every Admin selects one server-authorized Current Admin Market. Every write carries an explicit target market and validates the resource belongs to that market. Ordinary reads are selected-market reads. Revoked access fails on the next request. Local storage, URL parameters, headers, hidden buttons, and role labels are not authorization.

No cross-market financial total, cross-currency sum, global operational command, browser loop pretending to be a global aggregate, or silent currency conversion is allowed. A future read-only global overview is deferred.

## 4. Authentication, Admin eligibility, MFA, and sessions

- Reuse the canonical authentication/session owner; do not create a second Admin token model.
- Admin entry requires an active eligible Admin account and accepted MFA. Generic email OTP is not called MFA unless approved as a second factor.
- MFA must cover enrollment, challenge, recovery, reset, factor lifecycle audit, and step-up for sensitive evidence/secret operations where approved.
- Sensitive operations are disabled until the MFA gate is accepted.
- Server policy: 30-minute idle timeout, 8-hour absolute duration, 7-day refresh-family maximum.
- Required controls: current logout, individual revocation, revoke all, revocation after suspension/password reset, and refresh-reuse family revocation.
- Client timers may improve UX but are never a security boundary.

## 5. Dashboard contract

- All metrics are server-owned, selected-market, bounded read models.
- Operational queues and urgent alerts are no more than 60 seconds old; aggregate KPIs are no more than 5 minutes old.
- Every tile/row shows definition, `asOf`, freshness, stale, and unavailable state.
- Missing or failed source data displays `Unavailable`, never zero.
- The current 20-row merchant-derived counts and fabricated reward-job rows are prohibited as operational truth.
- Financial values remain separated by market and currency; no client-side ledger or commission recomputation.
- Drill-down must preserve the metric filter, market, permission, masking, and time boundary.

## 6. Member, merchant, agent, and KYC operations

### 6.1 Member operations

Reuse accepted Phase 2 Admin Member commands for selected-market lookup, status transitions, session revocation, reverification, and notes. Preserve typed input validation, concurrency/state checks, reason, masking, and atomic audit. No direct account/member mutation or invented inactivity consequence.

### 6.2 Merchant operations

Reuse accepted Phase 1 merchant application, KYC, status, package, and MCP owner commands. Suspension preserves MCP. Historical package/transaction evidence is immutable. Merchant/branch attribution reassignment remains unavailable.

### 6.3 Agent operations

Agent lifecycle writes remain unavailable until Phase 5 owner route, market, permission, actor attribution, fee version/snapshot, and atomic commission defects are separately remediated and accepted. Malaysia activation fee is RM388.00 MYR, future-effective and versioned; commission is RM88 G1 and RM38 G2 for future qualifying Malaysia activations. Other markets cannot activate until explicitly configured. Course verification and reapplication policy remain OPEN.

### 6.4 KYC review and sensitive evidence

KYC Reviewer receives only the minimum evidence needed. Support sees masked identity/contact summaries and no raw documents. Finance sees only required financial identifiers. Super Admin has no automatic unrestricted raw-document access. Raw evidence needs a dedicated permission, recorded reason, market authorization, and an audit record for every view. No raw KYC export is allowed. Legal retention remains market-specific and OPEN.

## 7. Commercial configuration contract

All configuration uses decimal strings/exact decimal, forward-only versions, explicit market/currency/unit, future effective time, immutable history, safe idempotency, payload mismatch rejection, overlap/concurrency protection, and privileged audit. Maker/Checker does not apply unless the operation is a Manual MCP or Manual iPoint Adjustment.

### 7.1 Reward Rate

- Input/display unit `%/day`, range `0%` through `0.05%/day`, maximum six input decimals.
- Package references: A `0.0125%`, B `0.025%`, C/D/E/F `0.05%` per day maximum.
- Activation only at a future market-local `00:00`; UI shows local time and resolved UTC.
- Overlap prohibited; historical rewards and existing entries are never recalculated.
- Above `0.05%/day` requires new Bryan and Command Center governance.

### 7.2 Redemption Rate

- Independent per market; no universal rate or Malaysia fallback.
- Immutable forward-only versions; quote/order retains original Rate Version.
- Technical ceiling ten decimals; UI displays up to six.
- Malaysia: local currency value per 1 iPoint; initial RM1.00, minimum RM0.50, maximum RM2.00.
- Other markets remain blocked until Initial, Minimum, Maximum, Currency, and Display Unit are approved.

### 7.3 Merchant Package and special percentage

- Standard package authority may be delegated through dedicated permissions.
- Only Super Admin with the dedicated permission may create/activate a special percentage; reason and immutable audit are mandatory. D-010 range `>0%` and `<=100%` remains locked.
- New Package Versions do not move existing Merchant Assignments. Reassignment is explicit and audited; no automatic batch migration. Historical transactions stay unchanged.

### 7.4 Commission parameters

- Changes affect future qualifying source events only.
- Historical commission ledger entries remain immutable; no recalculation.
- Corrections append linked exact-opposite compensation using the corrected D-042 semantics.
- Phase 5 route/market/generation/range defects block editor exposure until frozen-owner acceptance.

### 7.5 Market configuration

Market registry and status changes require dedicated permissions, MFA/step-up as specified, reason, dependency validation, explicit confirmation, idempotency, concurrency protection, and audit. No general row editor, global write mode, or default replication across markets is allowed.

## 8. Manual MCP and iPoint adjustments

### 8.1 Shared controls

- Distinct authenticated Maker and Checker at every amount; identity is server-derived.
- Malaysia soft/hard caps: MCP 10,000/100,000 MCP; iPoint 10,000/100,000 iPoint.
- At/below soft cap Finance Approver may check; above soft through hard cap Super Admin must check; above hard cap reject.
- Limits are versioned and market-specific; other markets stay blocked until configured.
- Required evidence: Reason Code, detailed explanation, Case/Ticket Reference, Maker identity/time, Checker identity/time.
- Attachment required above Soft Cap, for high-risk Reason Code, or at Checker request. Store only a protected opaque reference.
- Secure evidence storage, file type/size/malware/retention policy is prerequisite; above-Soft-Cap execution is disabled without it.
- Rejected requests are immutable. Replacement uses a new request linked to the prior request.
- Originals and requests are never physically deleted or edited to erase history.

### 8.2 Manual MCP Adjustment

Reuse the accepted MCP ledger owner and existing durable request/decision structures only after validating the D-046 cap/evidence/state contract. Execution appends the owner ledger entry and commits state/audit atomically. Direct MCP balance edits are prohibited.

### 8.3 Manual iPoint Adjustment

This is a required MVP capability but is a hard-gated future integration. The current immediate endpoint is prohibited. Required lifecycle: Draft/Create, Submitted/Pending Checker, Approved, Rejected, Executing, Executed, Failed. Execution delegates to the frozen Phase 3 wallet ledger service; direct balance mutation is prohibited. Corrections are exact-opposite linked entries. A forward-only migration and deep financial, payload-hash idempotency, concurrency, and Phase 3 regression evidence are required before release.

### 8.4 Maker/Checker decision boundary

The Checker revalidates session/MFA, permission, market grant, request/version/state, target, amount, evidence, available balance/limit, and Maker inequality inside the decision/execution boundary. Same-person approval is denied even for Super Admin. Phase 6 refund approval remains a separate workflow and is currently blocked by SEC-02.

## 9. Redemption refund hard gate

The existing Phase 6 approval command is not exposed. Release requires isolated Phase 6 owner remediation proving exact-opposite wallet ledger credit, wallet projection restoration, atomic order/refund/inventory/wallet state, idempotency and payload mismatch handling, permission and market enforcement, preserved Maker/Checker inequality, immutable audit, concurrency tests, and full Phase 3/6 regression. Until accepted, the UI shows only safe market-scoped read-only status and an explicit unavailable approval state. No direct DB workaround.

## 10. Audit Viewer

- Read-only, selected-market, permissioned, server-filtered projections; never raw table JSON.
- Bounded filters include time, market, actor, action, resource type/ID, request/correlation ID, result, and workflow state with cursor pagination.
- UTC and market-local timestamps are shown.
- Deny-by-default field allowlists exclude credentials, tokens, cookies, hashes, OTP/recovery data, raw KYC payloads, payment credentials, voucher plaintext/ciphertext/IV/auth tags, attachment contents, and decryption material.
- Raw before/after JSON is hidden; approved field-level differences require explicit permission.
- Viewing/searching sensitive or audit evidence is itself audited with safe filter metadata and recorded reason where required.
- Support receives masked summaries only; Finance receives only authorized financial detail.

## 11. Basic reports

MVP reports are on-screen, selected-market, bounded-date, reproducible read models with definitions and `asOf`. They may cover approved member/merchant/agent states, KYC aging, workflow queues, MCP reconciliation summaries, transaction totals by status/currency, real reward-job results, commission totals with compensation semantics, and safe redemption exception status after gates.

There is no CSV/download, client-side export, raw Audit/KYC/Voucher/ledger export, cross-currency sum, warehouse, BI, risk scoring, or advanced reconciliation. Unavailable inputs produce an unavailable section, not fabricated data.

## 12. UI, Design System, and PWA

- Use the official `@ipoint/design-tokens` and `@ipoint/ui`; no second token system or screenshot-derived tokens.
- Provide a stable routed responsive Admin Web shell with deep links, route guards, desktop and touch-friendly navigation.
- Always display actor, role context, Current Admin Market, session state, and permission-aware actions.
- All screens cover loading, empty, error, success, disabled, expired, suspended, permission denied, offline/retry, stale/conflict, and blocked-prerequisite states.
- Accessibility includes keyboard navigation, focus recovery, labels, contrast, responsive layout, and browser/axe evidence.
- Admin PWA is read-only monitoring/navigation. No mobile financial approval, privileged approval, offline write queue, or background replay. Sensitive writes use full online Admin Web.

## 13. API integration and error handling

- The canonical runtime prefix is `/api/v1`; doubled-prefix or unregistered routes are defects, not contracts.
- Only registered, permissioned, market-safe controllers count as available APIs.
- Typed DTOs and clients replace ad hoc JSON/casing fallbacks.
- Each endpoint documents actor, permission, market, schema, result, errors, idempotency, audit, and owning domain.
- Stable safe errors distinguish validation, authentication, MFA, permission, market denial, blocked prerequisite, state conflict, stale version, idempotency mismatch, retryable concurrency, and service unavailable.
- No SQL, stack trace, secret, internal key, voucher material, or raw sensitive entity leaks.
- Correlation/request IDs are returned safely and recorded.
- Critical commands report success only after domain effect, state, and audit commit atomically; no partial or false success.

## 14. Idempotency and concurrency

- Every critical write has an operation-scoped idempotency key plus canonical payload hash.
- Same key/same payload returns original result; same key/different payload returns conflict.
- UI retry after an uncertain outcome reuses the original key.
- Keys/hashes follow owner confidentiality and retention rules.
- Commands revalidate identity, MFA, permission, market grant, target state, and expected version inside the transaction.
- Financial workflows lock request then target aggregate in deterministic order and use owner locks/constraints.
- Configuration overlap is prevented at database, serializable, exclusion, or advisory-lock boundary; pre-check alone is insufficient.
- Losing concurrent commands produce the original idempotent result or stable conflict with no partial ledger/state/audit.

## 15. Security and auditability

Every privileged write records actor, market, target, action, UTC time, market-local display time, reason, result, request/correlation and idempotency references, approved IP/device/user-agent metadata, prior/new version or safe before/after projection, and related domain/ledger IDs. Maker/Checker records both identities/timestamps, decision, and execution result. Records are append-only and never physically deleted.

Security acceptance includes least privilege, MFA/step-up, secure headers/CORS for actual methods, input validation, rate limits, market isolation, payload redaction, no secrets in code/logs/reports, audit-of-audit, forced session revocation, and denial of UI-only authorization.

## 16. Migration expectations

P7-S0 creates no migration. Future migrations are forward-only, centrally coordinated, owner-isolated, tested from the accepted baseline, and include compatibility/recovery notes. Ledger, auth, permission, market, MFA/session, and Maker/Checker schema changes require dedicated commits and review. No migration may rewrite historical financial/audit rows or modify a frozen owner without explicit authorization.

## 17. Testing and acceptance contract

Later authorized delivery must provide exact evidence for:

1. Admin eligibility, MFA enrollment/challenge/recovery/step-up, session expiry, token-family reuse, and forced revocation.
2. Six-role least privilege plus crafted-request negative tests proving role, permission, and market separation.
3. Current Admin Market selection/revocation and cross-market denial for reads, writes, reports, evidence, and queues.
4. Dashboard definitions, data correctness, freshness/stale/unavailable behavior, and elimination of fabricated/page counts.
5. Member, merchant, KYC, package, reward, redemption, commission, and agent adapters with relevant frozen-owner regression.
6. Prospective configuration, local-midnight/UTC conversion, decimal-string validation, overlap/stale/concurrency rejection, and immutable historical snapshots.
7. MCP/iPoint Maker/Checker identity inequality at every amount, escalation caps, evidence policy, rejection replacement, payload mismatch, atomic ledger execution, retries, and correction compensation.
8. SEC-02 remediation before refund approval, including full Phase 3/6 regression.
9. Audit Viewer market/permission/filter/redaction/audit-of-view and denial of raw secret/evidence/export paths.
10. Bounded reports, market/currency separation, compensation semantics, responsive routed UI, accessibility, and PWA no-offline-write behavior.

Required gates include formatting, lint, typecheck, build, unit, real PostgreSQL/API integration, relevant frozen-domain regression, OpenAPI consistency, security/privacy scans, browser/Playwright evidence, and exact test results. No failure may be hidden, relabeled, or waived without Command Center authority.

## 18. Authorization boundary

This contract is FINAL, ACCEPTED, and FROZEN under D-046 as documentation. P7-S1 through P7-S10 and all remediation work remain NOT AUTHORIZED until separately dispatched.
