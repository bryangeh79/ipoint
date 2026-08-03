# Phase 7 Admin Operations — Final Phase Brief

> **Status: DRAFT / UNDER_COMMAND_CENTER_REVIEW / NOT_IMPLEMENTATION_AUTHORIZATION**
>
> This brief is an implementation-ready architecture and acceptance baseline derived strictly from D-046. It does not authorize P7-S1 through P7-S10, remediation, production code, schema, migration, tests, CI changes, deployment, Main PR, or Main merge. The 22 decisions P7-OD-01 through P7-OD-22 remain frozen and are not reopened, altered, or reinterpreted here.

## Audit metadata

| Field               | Value                                                       |
| ------------------- | ----------------------------------------------------------- |
| Phase               | Phase 7 — Admin Operations                                  |
| Planning task       | P7-S1A — Final Phase Brief                                  |
| Branch              | `task/p7-s1a-final-phase-brief`                             |
| Base SHA            | `f9f9b754085616914b064c982950219fe60f34fc`                  |
| Date                | 2026-08-01 (Asia/Kuala_Lumpur)                              |
| Worker              | Codex CLI worker                                            |
| Governing decision  | D-046                                                       |
| Frozen decision set | P7-OD-01 through P7-OD-22 plus P7-OD-AF-01                  |
| Authority state     | D-046 contract frozen; P7-S1+ implementation not authorized |

## 1. Phase objective

Deliver a secure, market-scoped Admin Operations layer for the existing iPoint platform domains. Phase 7 owns Admin Web/PWA experience, bounded operational read models, queue composition, and safe orchestration of canonical owner services. It does not take ownership of wallet, MCP, transaction, reward, commission, agent, KYC, package, redemption, voucher, or audit domain truth.

The phase must make privileged operations explicit, least-privileged, auditable, versioned where commercial rules are involved, and unavailable when a prerequisite gate is not accepted. A Phase 7 adapter may project or orchestrate an accepted owner capability; it must not duplicate domain formulas, write domain tables directly, impersonate Member/Merchant actors, or hide an unsafe owner command behind a facade (D-046, P7-OD-21).

## 2. Product and operational value

- Gives operations teams a single selected-market control plane for member, merchant, agent, KYC, financial, configuration, audit, and reporting work.
- Reduces fraud and operator error through MFA, session revocation, least privilege, Market Access, immutable audit, and distinct Maker/Checker identities.
- Preserves financial and commercial history by using forward-only versions, snapshots, exact decimal values, and append-only ledgers.
- Replaces misleading page-derived or fabricated dashboard values with bounded server-owned metrics that disclose freshness and failure.
- Enables support and review work without granting raw ledger, KYC, voucher, or secret access.
- Makes blocked, deferred, and open capabilities visible instead of presenting false success or unsafe fallback behavior.

## 3. MVP scope

The Phase 7 MVP consists of:

1. Admin eligibility, MFA, sessions, six role templates, Action Permissions, Market Access, and one Current Admin Market.
2. A routed responsive Admin Web shell and read-only monitoring/navigation PWA behavior.
3. Selected-market dashboard aggregates and operational queues with freshness metadata.
4. Member, merchant, agent, and KYC operational views/actions only where canonical owner commands are accepted and safe.
5. Market, reward, redemption, merchant package/special percentage, commission, and agent-fee configuration surfaces only where applicable owner gates are released.
6. Compliant Manual MCP and Manual iPoint Maker/Checker workflows; Manual iPoint remains blocked until SEC-01 is separately authorized and accepted.
7. A deny-by-default Audit Viewer and on-screen bounded operational reports.
8. Explicit blocked states for refund approval, unsafe agent/commission operations, unavailable exports, open policy questions, and unreleased remediation.

Every shipped surface must use typed contracts, stable safe errors, server-side authorization, explicit market scope, immutable privileged audit, operation-scoped idempotency for critical writes, and transaction/database-level concurrency controls as applicable.

### Implementation architecture baseline

- **API:** The canonical runtime prefix is `/api/v1`. Only registered controllers count as available. Every endpoint contract identifies actor eligibility, permission, market source/validation, request/response schema, owner domain, idempotency, audit, and safe errors. Doubled prefixes, dead controllers, and ad hoc casing/JSON fallbacks are defects, not contracts.
- **Permission:** A server-owned route-to-permission catalog must reconcile to zero drift. Six role templates grant explicit codes; dedicated codes cover special packages and sensitive evidence; Finance Maker and Checker capabilities remain separable; Support uses an explicit read-only allowlist.
- **Data:** Phase 7 read models are bounded projections. Domain truth stays in canonical owner records/ledgers. Critical writes use canonical payload hashes, deterministic locking, expected versions, immutable audits, and same-key/same-payload replay; same-key/different-payload returns a stable conflict.
- **Errors:** Safe typed errors distinguish validation, authentication, MFA required/step-up, permission denial, market denial, blocked prerequisite, state/version conflict, idempotency mismatch, retryable concurrency, and unavailable service. Responses/logs never disclose SQL, stacks, secrets, internal keys, or raw sensitive entities; safe correlation/request IDs are retained.
- **Migrations:** P7-S1A creates none. Any future migration is forward-only, centrally coordinated, owner-isolated, tested from the accepted baseline, and includes compatibility/recovery notes. Auth, permission, ledger, and transaction-state migrations use dedicated commits. No migration rewrites historical financial/audit rows or crosses a frozen owner without explicit authority.

## 4. Explicit non-goals

- No production implementation is authorized by this brief.
- No Phase 3-6 frozen owner change through a Phase 7 branch or facade.
- No custom role designer, Department hierarchy, or role-only authorization.
- No global operational write mode, cross-market financial total, cross-currency sum, silent currency conversion, or client-generated global aggregate.
- No downloadable CSV, client-side export, async export infrastructure, raw Audit/KYC/Voucher/ledger export, warehouse, BI, advanced reconciliation, fraud scoring, or regulatory reporting.
- No automatic package-assignment migration or bulk commercial migration.
- No financial/privileged approval through PWA, offline privileged write queue, or background replay.
- No invented behavior for agent course verification, agent reapplication, attribution reassignment, KYC retention, inactive users, or new-market compliance.
- No Phase 8-12 production scope and no real external send, payment, refund, voucher reveal, or production side effect merely because a control is displayed.

## 5. Frozen business rules (cite D-046 / P7-OD IDs)

The following D-046 rules are controlling:

| Decision    | Frozen requirement                                                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P7-OD-01    | Exactly six MVP roles; protected actions require Admin eligibility, accepted MFA, specific Action Permission, and active Market Access where scoped. Role and UI visibility are not authorization. |
| P7-OD-02    | Every Admin selects one authorized Current Admin Market; ordinary reads and all writes are single-market; no global write mode or global financial total.                                          |
| P7-OD-03    | Maker/Checker applies only to Manual MCP and Manual iPoint adjustments. Phase 6 refund Maker/Checker remains independent.                                                                          |
| P7-OD-04    | Reward Rate activation is only at a future market-local `00:00`; immediate/same-day activation and historical recalculation are excluded.                                                          |
| P7-OD-05    | Reward Rate input is `0%` to `0.05%/day`, up to six decimals, using exact decimal; higher values require new governance.                                                                           |
| P7-OD-06    | Redemption Rate uses per-market immutable forward versions; Malaysia initial RM1.00 per iPoint, range RM0.50-RM2.00; technical ceiling ten decimals, UI up to six; no other-market fallback.       |
| P7-OD-07    | Only Super Admin with dedicated permission may create/activate a special percentage; reason/audit required; D-010 range `>0%` and `<=100%`.                                                        |
| P7-OD-08    | New Package Versions never auto-migrate existing merchants; reassignment is explicit/audited and history is unchanged.                                                                             |
| P7-OD-09    | Commission changes affect future qualifying events only; history is immutable; corrections use linked exact-opposite entries under corrected D-042 semantics.                                      |
| P7-OD-10    | Malaysia Manual MCP/iPoint soft/hard caps are 10,000/100,000 units; every amount has distinct Maker/Checker and frozen Checker escalation.                                                         |
| P7-OD-11    | Every adjustment has reason code, explanation, case/ticket, Maker/Checker identity/time; attachment rules and secure opaque references are mandatory as specified.                                 |
| P7-OD-12    | MFA is mandatory for every Admin role, with enrollment, challenge, recovery, reset, audit, and step-up where required.                                                                             |
| P7-OD-13    | Sessions enforce 30-minute idle, 8-hour absolute, 7-day refresh-family maximum, and complete next-request revocation controls.                                                                     |
| P7-OD-14    | MVP reports are on-screen and bounded; downloadable/client/async/raw exports are excluded or prohibited.                                                                                           |
| P7-OD-15    | Sensitive data is deny-by-default; raw access needs dedicated permission/reason/audit; no raw KYC export.                                                                                          |
| P7-OD-16    | Queues/urgent alerts are no more than 60 seconds old; aggregate KPIs no more than 5 minutes old; every metric has definition, `asOf`, and freshness/unavailable state.                             |
| P7-OD-17    | Support has no raw MCP, iPoint, or Commission Ledger access and receives only masked transaction/reference summaries.                                                                              |
| P7-OD-18    | Rejected adjustment requests are immutable; replacement creates a new linked request with new idempotency/decision records.                                                                        |
| P7-OD-19    | Refund approval is blocked by SEC-02 until isolated Phase 6 owner remediation is separately accepted; safe read-only status only.                                                                  |
| P7-OD-20    | Manual iPoint is required MVP scope but blocked by SEC-01 until a separately authorized compliant durable workflow is accepted.                                                                    |
| P7-OD-21    | Correctness defects stay with frozen owners; Phase 7 owns only safe Admin projections/orchestration and cannot legitimize unsafe owner commands.                                                   |
| P7-OD-22    | Admin PWA is read-only monitoring/navigation; no privileged approval, offline write queue, or replay.                                                                                              |
| P7-OD-AF-01 | Malaysia Agent Activation Fee is RM388.00 MYR, with RM88 G1 and RM38 G2 for future qualifying Malaysia activations; versioned/snapshotted, no fallback; other markets blocked.                     |

## 6. Admin roles (six-role model per P7-OD-01)

| Role                        | MVP purpose                                                        | Mandatory boundary                                                                                                |
| --------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Super Admin                 | Platform governance and exceptional approved operations            | No self-approval bypass; no automatic raw KYC access; no global write mode; dedicated permissions still required. |
| Operations Admin            | Daily member, merchant, fulfilment, and operational queues         | No finance approvals, RBAC governance, or exceptional commercial authority by default.                            |
| Finance Operator            | Authorized finance reads/reconciliation and adjustment Maker       | Cannot check own request or gain Checker authority through role combination.                                      |
| Finance Approver            | Independent adjustment Checker within the frozen routing threshold | Cannot make the request it checks; above-soft-cap escalation still requires Super Admin.                          |
| KYC Reviewer                | Minimum-evidence member/merchant KYC review                        | No unrelated financial, ledger, package/rate, or status authority.                                                |
| Support / Read-only Auditor | Masked lookup and read-only audit/operational support              | No writes, raw ledgers, raw KYC documents, secret reveal, or export.                                              |

There are no departments or custom roles in MVP. These roles are controlled assignment templates. Runtime authorization always evaluates Admin eligibility/status, MFA, Action Permission, and active Market Access. Runtime Maker/Checker identity inequality is independent of roles and applies even to Super Admin.

## 7. Market context (P7-OD-02)

- Every Admin, including Super Admin, must select exactly one Current Admin Market from active grants.
- Every ordinary read is scoped to that selected market. Every write carries an explicit target market and validates that each target resource belongs to it.
- The server revalidates active Market Access on every request. Revocation must fail on the next request.
- URL, header, local storage, browser state, role label, and hidden UI controls are context only and never authorization.
- There is no global operational write, cross-market financial total, cross-currency sum, browser-loop aggregation, silent currency conversion, or Malaysia fallback.
- A read-only global overview remains deferred. Cross-market comparisons may not masquerade as an operational total.

## 8. Authentication and MFA requirements (P7-OD-12)

- Reuse the canonical authentication/session owner; no second Admin token or authentication model.
- Admin entry requires an active eligible Admin account and successful approved MFA.
- MFA is mandatory for all six Admin roles. Generic email OTP alone must not be described as MFA unless formally approved and implemented as a second factor.
- The solution must cover factor enrollment, login challenge, recovery, reset, lifecycle audit, and approved step-up for sensitive actions.
- MFA state and step-up must be enforced server-side and bound to the canonical session.
- Sensitive Admin operations remain disabled until the Admin MFA gate is separately authorized, implemented, verified, and accepted.
- Required evidence includes eligible/ineligible login, enrollment/challenge/recovery/reset, replay/rate-limit/expiry/concurrency, step-up, suspension, audit, accessibility, and proof that OTP-only is not falsely claimed as MFA.

## 9. Session requirements (P7-OD-13)

- Server-enforced idle timeout: 30 minutes.
- Server-enforced absolute session duration: 8 hours.
- Refresh-family maximum: 7 days, with rotation and token-family reuse protection.
- Required controls: current-session logout, individual session revocation, revoke all sessions, forced revocation after Admin suspension, forced revocation after password reset, and refresh-token reuse family revocation.
- Revocation is effective on the next request and is audited.
- Client timers may display expiry UX but are not security controls.
- Session operations reuse the canonical auth owner and return stable safe authentication/session errors without leaking token or internal details.

## 10. Dashboard scope (P7-OD-16)

- Selected-market, server-owned, bounded aggregates only.
- Operational queues and urgent status alerts must be no more than 60 seconds old; aggregate KPI counts must be no more than 5 minutes old.
- Every metric shows its definition, `asOf`, freshness state, and stale/unavailable behavior.
- Failed or missing source data displays `Unavailable`; it must never become fabricated zero.
- The existing first-20-merchants counts and fabricated reward-job rows are prohibited as dashboard truth.
- Financial values remain separated by market and currency. The client must not recompute ledger, reward, commission, or financial truth.
- Drill-down preserves market, permission, masking, metric filter, and time boundary.
- Candidate MVP data includes approved account/merchant/agent/KYC states, operational workflow counts, real reward-job status, and other safe read projections only after their owner gates are met.

## 11. Member Operations scope

- Reuse accepted Phase 2 Admin Member services/commands for selected-market lookup/detail, allowed status transitions, session revocation, reverification, and notes.
- Preserve typed validation, state/concurrency checks, required reason, masking, market enforcement, and atomic audit.
- Wallet/ledger detail is not exposed through Support or Member Operations beyond approved masked summaries. Manual iPoint is a separate Maker/Checker workflow.
- No direct member/account table mutation, no referral rewrite, and no invented inactivity policy or automatic balance/reward/agent/commission consequence.
- Required UI states include permission denial, suspended/closed status, conflict/stale state, and unavailable owner capability.

## 12. Merchant Operations scope

- Reuse accepted Phase 1 merchant application, business/responsible-person KYC, status, package assignment, and MCP owner commands.
- MVP may provide selected-market merchant/application/KYC queues, branch detail, approved status actions, package assignment/history, MCP account/ledger/reconciliation summaries, and proven-safe recharge/refund request operations.
- Suspension preserves MCP. Existing package assignment and historical transaction snapshots remain immutable.
- Branch and merchant IDs remain owner-controlled. Merchant/branch attribution is read-only; reassignment or batch correction is unavailable.
- No direct domain table writes, package auto-migration, broad Support ledger view, or unaccepted owner command exposure.

## 13. Agent Operations scope (incl. RM388 fee per D-046, O-05 partial resolution)

- Agent operations use the frozen Phase 5 agent/commission owner only after capability-specific route, Market Access, permission, actor attribution, atomicity, idempotency, fee/version, and commission defects are separately remediated and accepted.
- Malaysia Agent Activation Fee is `RM388.00` in MYR. G1 is RM88 and G2 is RM38 for future qualifying Malaysia activation events.
- The fee and commissions are market/currency scoped, versioned, prospective, and snapshotted on activation. Historical activations are never repriced.
- There is no hard-coded MYR/RM388 fallback in canonical business logic. Other-market activation is blocked until fee amount, currency, versions, and compliance are approved.
- Before the Phase 5 gate is released, only separately reviewed market-scoped safe read projections may be considered; writes remain explicitly unavailable.
- O-05 is resolved only for Malaysia. Agent course verification automation, reapplication policy, other-market fees/currencies, inactive-user consequences, and new-market compliance remain unavailable.

## 14. KYC Operations scope (P7-OD-15)

- KYC Reviewer receives only the minimum evidence required for member/merchant review.
- Support receives masked identity/contact summaries and no raw documents. Finance receives only necessary financial identifiers.
- Super Admin does not automatically receive unrestricted raw KYC evidence.
- Raw sensitive evidence requires an explicit dedicated permission, active Market Access, recorded reason, and audit event for every view.
- Server-side field allowlists and projections enforce masking; UI masking alone is insufficient.
- No raw KYC export is allowed. Market/legal retention and deletion remain open and no automated retention behavior may be invented.
- Approved owner commands must retain reason, status transition, concurrency, evidence, and immutable audit controls.

## 15. Configuration scope (P7-OD-04..09: reward, redemption, package, special percentage, commission, market config)

All configuration is market-scoped, uses decimal strings/exact decimal, and creates forward-only immutable versions with explicit unit/currency, status, effective time, idempotency/payload mismatch protection, overlap/concurrency protection, and privileged audit. It never recalculates history. Maker/Checker does not apply to these configuration operations.

### Reward rate (P7-OD-04/05)

- Input/display unit is `%/day`; range is `0%` through `0.05%/day`; maximum six input decimals.
- Reference maximums: A `0.0125%/day`, B `0.025%/day`, C/D/E/F `0.05%/day`.
- Activation occurs only at a future market-local `00:00`; display local time and resolved UTC using the market IANA timezone.
- Overlap is blocked at a database/transaction boundary. Existing rewards are never recalculated. Above `0.05%/day` requires new governance.

### Redemption rate (P7-OD-06)

- Independent per market, immutable and forward-only; each quote/order retains its original Rate Version.
- Technical precision ceiling is ten decimals; UI display is up to six.
- Malaysia uses local-currency value per 1 iPoint: initial RM1.00, minimum RM0.50, maximum RM2.00.
- Other markets remain blocked until Initial, Minimum, Maximum, Currency, and Display Unit are approved; there is no Malaysia fallback.

### Merchant package and special percentage (P7-OD-07/08)

- Standard package authority is assigned through dedicated permission.
- Only Super Admin with the dedicated special-package permission may create/activate a special percentage; reason and immutable audit are mandatory. D-010 locks the range to `>0%` and `<=100%`.
- New Package Versions do not alter existing Merchant Assignments. Reassignment is explicit and audited; automatic/bulk migration is absent. Historical transactions remain unchanged.

### Commission parameters (P7-OD-09)

- Changes affect future qualifying source events only. Historical commission entries and snapshots are immutable.
- Corrections append a linked exact-opposite entry. D-042 controls: original `source_type` is retained, compensation is represented by `REVERSAL_COMPENSATION` or `REFUND_COMPENSATION`, and the original Commission Ledger entry remains fully immutable.
- Editor exposure is blocked until applicable Phase 5 route/market/generation/range gates are accepted.

### Agent fee and market configuration

- The Malaysia RM388/RM88/RM38 rules follow Section 13 and require future-effective version/snapshot semantics.
- Market registry/status changes require dedicated permissions, accepted MFA/step-up policy, reason, dependency validation, explicit confirmation, idempotency, concurrency protection, and audit.
- No general row editor, global write mode, silent default, or automatic configuration replication across markets.

## 16. Manual MCP scope (P7-OD-03/10/11)

- Reuse the accepted MCP ledger owner and durable request/decision structures after validating alignment with D-046.
- Every amount requires distinct authenticated Maker and Checker identities derived by the server.
- Malaysia soft cap is 10,000 MCP; hard cap is 100,000 MCP. At/below soft cap, Finance Approver may check. Above soft through hard cap, Super Admin must check. Above hard cap is rejected.
- Required evidence: Reason Code, detailed explanation, Case/Ticket Reference, Maker identity/time, and Checker identity/time.
- Attachment is required above soft cap, for a high-risk Reason Code, or at Checker request. The record stores only an opaque protected reference. Above-soft-cap execution remains disabled until secure storage plus file type/size/malware/retention policy is approved.
- Checker revalidates session/MFA, permission, market, request/version/state, target, amount, evidence, limits/balance, and Maker inequality inside the decision/execution boundary.
- Rejected requests are immutable. A replacement is a new request with new idempotency/decision records and explicit prior-request linkage.
- Execution appends the owner ledger entry and commits request state and audit atomically. Direct MCP balance mutation is prohibited.

## 17. Manual iPoint scope (P7-OD-20: required MVP capability, blocked until separately authorized compliant workflow)

- Manual iPoint Adjustment is a required MVP capability, but SEC-01 blocks its implementation/exposure until a separately authorized Phase 3/Phase 7 integration is accepted.
- The existing immediate-execution endpoint must not be exposed, adapted, or represented as compliant.
- Required lifecycle: Draft/Create, Submitted/Pending Checker, Approved, Rejected, Executing, Executed, Failed.
- Apply the same distinct-identity, Malaysia 10,000/100,000 soft/hard caps, routing, evidence, attachment, rejection/replacement, and Checker revalidation rules as Manual MCP.
- Execution delegates to the frozen Phase 3 wallet ledger service. Direct balance mutation is prohibited.
- State transition, exact wallet ledger effect/projection, and immutable audit commit atomically. Corrections use linked exact-opposite entries.
- Gate release requires a forward-only migration, payload-hash idempotency, mismatch rejection, deterministic concurrency, failure/retry proof, and deep Phase 3 financial regression.
- Until gate release, the UI displays an explicit blocked prerequisite and provides no executable control.

## 18. Audit Viewer scope

- Read-only, selected-market, permissioned, server-filtered projections; never raw database rows or generic raw JSON.
- Bounded filters: time, market, actor, action, resource type/ID, request/correlation ID, result, and workflow state, using cursor pagination.
- Show UTC and market-local timestamps.
- Deny-by-default allowlists exclude credentials, tokens, cookies, hashes, OTP/recovery data, raw KYC payloads, payment credentials, voucher plaintext/ciphertext/IV/auth tags, attachment contents, and decryption material.
- Raw before/after JSON is hidden. Approved field-level differences require explicit permission.
- Viewing/searching sensitive or audit evidence is itself audited with safe filter metadata and a reason where required.
- Support receives masked summaries only; Finance receives only authorized financial detail. There is no raw Audit/KYC/Voucher/ledger export.

## 19. Basic Reports scope (P7-OD-14)

- On-screen, selected-market, bounded-date, reproducible read models with metric definitions and `asOf`.
- Candidate reports: approved member/merchant/agent states, KYC aging, workflow queues, MCP reconciliation summaries, transaction totals by status/currency, real reward-job outcomes, commission totals using compensation semantics, and safe redemption exception status after applicable gates.
- Reports preserve market and currency dimensions and never create cross-currency totals.
- Missing/blocked input produces an unavailable section, not fabricated zero or client recomputation.
- CSV/download, client export, async export, raw Audit/KYC/Voucher/financial-ledger export, warehouse/BI, risk scoring, and advanced reconciliation are excluded.

## 20. Admin PWA scope (P7-OD-22)

- PWA MVP is read-only monitoring and safe navigation with explicit offline/stale states.
- No financial Maker/Checker approval, privileged mobile approval, offline privileged write queue, or background replay of privileged commands.
- Service workers must not cache or replay privileged command payloads.
- Sensitive writes require the full online Admin Web, accepted MFA/step-up as applicable, server authorization, and live transaction-bound validation.
- The routed responsive shell must support desktop/mobile navigation, deep links, route guards, keyboard use, focus recovery, labels, contrast, and required loading/empty/error/success/disabled/expired/suspended/permission-denied/offline/retry/stale/conflict/blocked states.

## 21. Critical remediation gates (SEC-01, SEC-02, Admin MFA, RBAC/permission seed, Phase 5 route/market)

No Phase 7 UI or adapter can release an owner/security gate. Only the owning authority may implement remediation under a separate authorization, and Command Center must explicitly accept the required evidence. Until release, the affected capability is unavailable; a read-only adapter is allowed only after separate review proving permission, market scope, masking, and inability to invoke the blocked command.

| Gate         | D-046 requirement                                                                                                                                                                                          | Repository discrepancy accepted under D-046                                                                                                                                                                         | Blocked capability / owner                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GATE-SEC-01  | Durable Manual iPoint Maker/Checker, owner-ledger execution, exact-opposite correction, atomicity, payload-hash idempotency, concurrency, audit (P7-OD-03/10/11/18/20).                                    | Existing Admin iPoint endpoint executes immediately without durable Maker/Checker; replay does not compare payload hash (SEC-01/14).                                                                                | All Manual iPoint UI/API execution. Phase 3 wallet owner plus separately authorized Phase 7 integration owner. |
| GATE-SEC-02  | Refund approval must append exact-opposite wallet ledger credit and restore wallet projection in one atomic order/refund/inventory/wallet transaction (P7-OD-19).                                          | Existing Phase 6 approval can change refund/order/inventory and wallet projection without the required immutable wallet ledger entry (SEC-02).                                                                      | Refund approval; safe read-only status only. Phase 6 Redemption frozen owner.                                  |
| GATE-AUTH-01 | Accepted MFA for every Admin, complete factor lifecycle, audit, and step-up where required (P7-OD-12).                                                                                                     | Generic OTP exists, but accepted Admin factor enrollment/challenge/recovery/reset/lifecycle policy does not (Admin MFA finding).                                                                                    | Sensitive Admin operations and P7-S2 security acceptance. Canonical Auth/Platform Access owner.                |
| GATE-RBAC-01 | Six controlled role templates, server-owned route permission catalog, dedicated sensitive/special-package permissions, Finance separation, Support allowlist, active market grants (P7-OD-01/02/07/15/17). | Permission seeds/decorators are missing or inconsistent; broad grants and drift can create inaccessible routes or silently expand Super Admin (SEC-12).                                                             | Every affected protected feature. Platform Access/RBAC owner with frozen owners approving their route codes.   |
| GATE-P5-01   | Market-safe, permissioned, registered canonical Agent/Commission owner routes; versioned Malaysia fee snapshots and prospective commission semantics (P7-OD-09/21, P7-OD-AF-01).                           | Doubled/unregistered routes, cross-market access, missing Market Access, unsafe activation attribution/atomicity, hard-coded MYR/fallback, duplicate services, and generation/range conflict exist (SEC-04..09/11). | Agent and Commission Admin exposure by capability. Phase 5 Agent/Commission frozen owner.                      |

### D-046 versus repository conflict/gate register

These discrepancies are implementation gates, not resolutions or changes to D-046:

| ID    | Frozen contract expectation                                                                                              | Observed repository behavior/evidence                                                                                                                                                                                 | Required treatment                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| CG-01 | Server-authorized Current Admin Market on every request (P7-OD-02).                                                      | Current Admin Web market state is client-controlled/free-form, and several controllers omit independent Market Access checks (SEC-03/05/06/08/10/13).                                                                 | Block affected routes; resolve under RBAC/owner gates; never rely on UI state.                                            |
| CG-02 | Reward versions activate at future market-local midnight with overlap/idempotency/atomic-audit protection (P7-OD-04/05). | Reward create/list lacks Market Access, payload-hash idempotency, overlap constraint, and atomic audit; scheduler timing/queue uniqueness and plan-bound selection are not proven equivalent (SEC-10/19; prior C-03). | Separately authorize canonical Phase 3 owner hardening before configuration exposure; D-046 semantics remain controlling. |
| CG-03 | Redemption rates are append-only, idempotent, prospective versions (P7-OD-06).                                           | Rate creation accepts but ignores idempotency; cancellation attempts to mutate an immutable table/nonexistent columns; controller exposure is incomplete (SEC-15; prior C-04).                                        | Frozen-owner authorization or accepted safe adapter; no cancellation mutation or UI workaround.                           |
| CG-04 | Phase 6 Admin operations require permission and market enforcement; refund approval is hard-blocked (P7-OD-19/21).       | Fulfilment/refund Admin controllers use identity-only/global queues and refund has the SEC-02 ledger defect (SEC-02/03).                                                                                              | Safe reads require separate reviewed adapter; writes remain blocked until respective owner remediation.                   |
| CG-05 | Dashboard truth uses bounded real sources with freshness (P7-OD-16).                                                     | Reward jobs are fabricated from rule versions and merchant totals are derived from the first 20 rows (SEC-17/18); scheduler queue counts are not fully proven (SEC-19).                                               | Do not expose existing placeholders; build accepted server read models in P7-S4.                                          |
| CG-06 | Audit Viewer is deny-by-default and audit viewing is audited (P7-OD-15/17).                                              | Generic audit querying lacks the final resource allowlist/audit-of-view; redaction does not explicitly cover all voucher encrypted material; attribution fields are incomplete (SEC-16/20).                           | Build a safe projection in P7-S9 after RBAC/masking acceptance; never expose raw JSON.                                    |
| CG-07 | Critical commands use stable typed routes and safe atomic outcomes (P7-OD-21).                                           | Doubled prefixes, unregistered controllers, duplicate services, swallowed commission errors, and typed/runtime drift make apparent capabilities dead or unsafe (SEC-04/07/08/09).                                     | Canonical owner selected and repaired under isolated frozen-owner authorization before adapters/UI.                       |

## 22. Deferred scope (Phase 8-12, exports, global dashboard, PWA approvals)

- Phase 8 Advertising & Content production functionality.
- Phase 9 advanced reporting, risk, audit analytics, reconciliation, fraud scoring, warehouse, BI, and regulatory reporting.
- Phase 10 full-platform integration/E2E production scope beyond Phase 7 acceptance evidence.
- Phase 11 production readiness/deployment and Phase 12 deferred-module evaluation.
- Downloadable CSV/client/async exports and any raw Audit/KYC/Voucher/ledger export.
- Read-only global overview/dashboard, global mode, cross-market financial totals, and currency conversion.
- Financial or privileged PWA approvals, offline privileged writes, and replay.
- Custom roles, Department hierarchy, automatic package reassignment, and bulk commercial migration.
- Five-level team rewards, payout/withdrawal, wallet cash-out, and any other previously deferred regulated capability.

Deferred does not mean implicitly authorized later; each item needs a future explicit governance and phase authorization.

## 23. Open questions that remain unavailable (agent course verification, reapplication policy, attribution reassignment, KYC retention, inactive users, new-market compliance)

| Open item                                | Unavailable behavior                                                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent course verification                | No invented quiz, attendance, certificate upload, Admin confirmation, or automatic verifier. Existing evidence/state may be displayed only through a safe projection. |
| Agent reapplication policy               | No automatic eligibility, cooldown, reset, resubmission, or lifecycle consequence.                                                                                    |
| Merchant/branch attribution reassignment | Existing attribution is read-only; no reassignment command, batch correction, or fallback.                                                                            |
| Per-market KYC retention                 | No invented retention period, automated deletion, archival, or raw export; legal policy is required per market.                                                       |
| Inactive users                           | No automatic suspension, balance, reward, agent, commission, or account consequence.                                                                                  |
| New-market compliance                    | No launch, activation, commercial fallback, KYC fallback, or Malaysia-default behavior without explicit market compliance and configuration approval.                 |

O-05 is only partially resolved: Malaysia RM388.00 MYR, RM88 G1, and RM38 G2 are frozen; all other-market agent fees/currencies remain open. Unanswered behavior must be shown as blocked/unavailable, not silently defaulted.

## 24. Phase dependencies (S1 -> S2 -> S3 -> ... per frozen sequence; note which sub-phases are blocked by which remediation gates)

The frozen execution order is `P7-S1 -> P7-S2 -> P7-S3`. P7-S4 and P7-S5 may proceed only after P7-S3 with non-overlapping ownership. P7-S6, P7-S7, and P7-S8 additionally require their applicable owner/security gates and separate authorizations. P7-S9 follows accepted safe projections and masking. P7-S10 is the final integration/evidence gate. Completion of a dependency never grants authority to begin the next sub-phase.

| Sub-phase                                                        | Hard dependencies                                                    | Gate impact                                                                                                                                                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P7-S1 — Contract decisions and architecture baseline             | D-046 consolidation; documentation-only dispatch                     | This brief remains under review and is not implementation authorization.                                                                                                                     |
| P7-S2 — Admin identity, MFA, sessions, RBAC, market context      | Accepted P7-S1 plus separate authorization                           | GATE-AUTH-01 and GATE-RBAC-01 are owned/released here; affected security capability remains blocked until acceptance.                                                                        |
| P7-S3 — Admin Web shell and typed integration foundation         | P7-S2 contracts/security accepted; Product Design System             | Blocked until accepted MFA/session/RBAC/market foundations exist. It may create no frozen-domain command.                                                                                    |
| P7-S4 — Dashboard and bounded read models                        | Accepted P7-S2/S3 and metric definitions                             | CG-05 must be resolved; existing fabricated/page-derived values cannot be reused. No owner write gate is released here.                                                                      |
| P7-S5 — Member, merchant, KYC integration                        | Accepted P7-S2/S3; masking/retention boundaries                      | GATE-RBAC-01 and masking/audit-of-view prerequisites. Open attribution/inactivity/retention behavior remains excluded.                                                                       |
| P7-S6 — Market/package/commercial configuration                  | Accepted P7-S2/S3; P7-OD-04..09; each applicable owner authorization | GATE-P5-01 blocks commission/agent-fee surfaces; CG-02 blocks reward editor; CG-03 blocks redemption-rate surface until accepted; standard/special package follows safe Phase 1 owner.       |
| P7-S7 — Manual MCP and iPoint Maker/Checker                      | Accepted P7-S2/S3; P7-OD-10/11/18/20; secure evidence policy         | GATE-SEC-01 hard-blocks iPoint. MCP may ship only after D-046 conformance and base MFA/RBAC/market gates.                                                                                    |
| P7-S8 — Agent and Phase 6 operational adapters                   | Separate Phase 5/6 owner decisions; accepted P7-S2/S3                | GATE-P5-01 blocks Agent/Commission writes. GATE-SEC-02 blocks refund approval. CG-04 blocks unsafe Phase 6 Admin commands; safe reads require separate review.                               |
| P7-S9 — Audit Viewer and basic reports                           | Accepted P7-S2; accepted masking/safe projections                    | GATE-RBAC-01 plus CG-06 and all source-specific read gates. No export or domain recomputation.                                                                                               |
| P7-S10 — Integration, security, accessibility, delivery evidence | P7-S2..S9 complete for shipped scope                                 | All critical gates for shipped capabilities must be explicitly accepted, or blocked features must remain explicitly unavailable. Verification only except separately dispatched remediation. |

Frozen-owner remediation must use isolated branches/commits and separate acceptance from Phase 7 UI/facade work. Auth, permission, migration, ledger, and transaction-state changes require dedicated commits. No sub-phase is presently authorized by this document.

## 25. Final acceptance conditions (mapped to the 20 P7-AC scenarios and D-046 contract)

Phase 7 may be submitted for final acceptance only when every shipped scenario below has exact evidence and every blocked scenario is demonstrably unavailable. The D-046 Frozen Admin Operations Contract remains the controlling contract.

| Scenario | Final acceptance condition                                                                                                                                                                      | D-046 mapping                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| P7-AC-01 | Eligible active Admin completes approved MFA and enters Admin Web; ineligible/suspended Admin is denied.                                                                                        | P7-OD-01/12; Auth contract.               |
| P7-AC-02 | Idle/absolute/refresh expiry and rotation work; forced and reuse-family revocation block the next request and return UI safely to login.                                                        | P7-OD-13.                                 |
| P7-AC-03 | Six-role least-privilege matrix passes; missing permission cannot be bypassed through crafted requests or UI.                                                                                   | P7-OD-01/07/15/17.                        |
| P7-AC-04 | Admin sees only active granted markets; revoked/arbitrary URL/header/browser market is denied server-side.                                                                                      | P7-OD-02.                                 |
| P7-AC-05 | Every write carries explicit market and atomically rejects target/resource market mismatch.                                                                                                     | P7-OD-02/21.                              |
| P7-AC-06 | Dashboard equals bounded server aggregates, meets freshness policy, shows `asOf`/stale/unavailable, and never uses fabricated/page counts.                                                      | P7-OD-16.                                 |
| P7-AC-07 | Member lookup/status/session/reverification/note flows reuse owner commands with masking, market scope, concurrency, and audit.                                                                 | Frozen contract Section 6.1; P7-OD-21.    |
| P7-AC-08 | Merchant application/KYC/status/package/MCP operations preserve market, idempotency, state history, historical snapshots, and MCP on suspension.                                                | P7-OD-08/21; frozen contract Section 6.2. |
| P7-AC-09 | Agent operations are blocked before GATE-P5-01; after separate acceptance, market/actor/fee/commission failures surface atomically and safely.                                                  | P7-OD-09/21; P7-OD-AF-01.                 |
| P7-AC-10 | Member/merchant KYC follows minimum-evidence masking; unauthorized raw evidence/export is denied and every sensitive view is audited.                                                           | P7-OD-15.                                 |
| P7-AC-11 | Reward/redemption/package/special/commission/market configuration creates prospective versions only; invalid decimal/unit/bounds, overlap, stale, mismatch, and concurrency lose safely.        | P7-OD-04..09.                             |
| P7-AC-12 | Historical transaction, reward, commission, package assignment, quote, order, and ledger snapshots remain unchanged after configuration changes.                                                | P7-OD-04/06/08/09.                        |
| P7-AC-13 | Manual MCP completes Maker -> Checker -> execute with distinct identities, cap/evidence routing, exact owner-ledger result, atomic audit, and idempotent replay.                                | P7-OD-03/10/11.                           |
| P7-AC-14 | Same-person MCP/iPoint approval is denied at every amount, including Super Admin.                                                                                                               | P7-OD-03/10.                              |
| P7-AC-15 | Immediate iPoint endpoint/UI remains unavailable until GATE-SEC-01 release; the later workflow proves lifecycle, owner-ledger atomicity, exact projection, and payload-hash mismatch rejection. | P7-OD-20.                                 |
| P7-AC-16 | Rejected adjustment is immutable and replaced through a linked new request; failed/retried/concurrent execution creates no duplicate ledger effect.                                             | P7-OD-18/20.                              |
| P7-AC-17 | Audit Viewer enforces market, permission, filters, cursor bounds, allowlist/redaction, reason, and audit-of-view.                                                                               | P7-OD-15/17.                              |
| P7-AC-18 | Credentials, tokens, OTP/recovery data, raw KYC, voucher material, attachment contents, and internal errors never appear in viewer, export, logs, or generic API results.                       | P7-OD-14/15/17; security contract.        |
| P7-AC-19 | Basic on-screen reports preserve market/currency and D-042 compensation semantics; cross-currency totals, exports, and advanced analytics are absent.                                           | P7-OD-09/14/16.                           |
| P7-AC-20 | Routed responsive Admin Web passes desktop/mobile navigation, deep links, required states, keyboard/axe/accessibility, and PWA no-offline-write/no-approval rules.                              | P7-OD-22; UI/PWA contract.                |

Required final evidence includes exact format, lint, typecheck, build, unit, real PostgreSQL/API integration, applicable Phase 3-6 frozen-domain regression, OpenAPI consistency, security/privacy scans, idempotency/concurrency results, and desktop/mobile browser/Playwright/axe evidence. Failures may not be hidden, relabeled, or waived without Command Center authority. All critical gates for shipped capabilities require explicit Command Center acceptance; otherwise the capability must remain visibly unavailable.

---

**Authorization statement:** This document is a DRAFT under Command Center review. It is not accepted, complete, frozen, or implementation authorization. D-046 and its frozen P7-S0 documents remain authoritative.
