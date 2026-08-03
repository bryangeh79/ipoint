# P7-S0E Bryan Open Decisions

> **Status: DRAFT / FOR BRYAN AND COMMAND CENTER DECISION / NOT IMPLEMENTATION AUTHORIZATION**
>
> Temporary IDs `P7-OD-*` are local to this draft. They are not governance Decision IDs and must not be treated as APPROVED, FINAL, ACCEPTED, or FROZEN. Where an item is already governed by a locked rule, it is identified as confirmation-only and does not reopen the rule unless Bryan explicitly directs a formal governance change.

## Decision register summary

| ID       | Area                                       |                                 MVP blocking? | Recommendation summary                            |
| -------- | ------------------------------------------ | --------------------------------------------: | ------------------------------------------------- |
| P7-OD-01 | Final simplified Admin roles               |                                           Yes | Adopt evaluated six-role set                      |
| P7-OD-02 | Super Admin global mode                    | Yes for global UI; no for selected-market MVP | Require selected market in MVP                    |
| P7-OD-03 | Maker/Checker beyond manual adjustments    |                             Confirmation only | Retain locked limited scope                       |
| P7-OD-04 | Reward-rate activation timing              |                                Yes for editor | Future market-local 00:00 only                    |
| P7-OD-05 | Reward-rate range/precision                |                                Yes for editor | Conservative per-market policy with explicit unit |
| P7-OD-06 | Redemption-rate range/precision            |                                Yes for editor | Per-market bounds; 10-decimal technical ceiling   |
| P7-OD-07 | Special package authority                  |                                           Yes | Super Admin-only MVP permission                   |
| P7-OD-08 | Package effect on assignments              |                                           Yes | Future assignments only by default                |
| P7-OD-09 | Commission future-only behavior            |                             Confirmation only | Retain frozen future-only behavior                |
| P7-OD-10 | Adjustment max/escalation                  |                                           Yes | Configurable soft cap; MC always required         |
| P7-OD-11 | Adjustment evidence                        |                                           Yes | Mandatory attachment for all requests             |
| P7-OD-12 | Admin MFA                                  |                         Critical prerequisite | Require MFA for every Admin                       |
| P7-OD-13 | Session duration/revocation                |                                           Yes | 30m idle, 8h absolute, 7d refresh maximum         |
| P7-OD-14 | Basic exports                              |                                            No | Include bounded masked CSV only                   |
| P7-OD-15 | KYC/sensitive masking                      |                                           Yes | Deny-by-default role-based masks                  |
| P7-OD-16 | Dashboard freshness                        |                                           Yes | Queues <=60s; aggregates <=5m                     |
| P7-OD-17 | Support ledger visibility                  |                                           Yes | No raw financial ledger by default                |
| P7-OD-18 | Rejected adjustment handling               |                                           Yes | Recreate with linkage; never edit                 |
| P7-OD-19 | Redemption refund ledger gap               |     Critical prerequisite for refund approval | Separate Phase 6 remediation now                  |
| P7-OD-20 | Compliant iPoint adjustment workflow       |             Critical prerequisite for feature | Authorize isolated Phase 3/7 remediation          |
| P7-OD-21 | Dead/unsafe Phase 5/6 controller ownership |                    Yes for those capabilities | Repair under frozen owner authorization           |
| P7-OD-22 | Admin PWA approval scope                   |                             Yes for PWA claim | Read-only MVP; no privileged mobile approvals     |

## P7-OD-01 — Final simplified Admin role set

- **Decision ID:** P7-OD-01
- **Question:** Which simplified role set should Phase 7 use for MVP?
- **Why the decision is required:** The repository seeds only `SUPER_ADMIN` and `VIEWER`; least-privilege operations require an approved assignment template before permission migration and UI work.
- **Current repository reality:** Role + Market Access + Action Permission is locked. P7-S0C evaluated six roles: Super Admin, Operations Admin, Finance Operator, Finance Approver, KYC Reviewer, and Support / Read-only Auditor.
- **Option A:** Adopt the six-role set exactly for MVP, reusing `VIEWER` for Support / Read-only Auditor.
- **Option B:** Use five roles by combining Finance Operator and Finance Approver, while relying on runtime same-person rejection.
- **Additional option:** Split Support and Auditor into separate roles, creating seven roles.
- **Command Center recommendation:** Option A. It is the smallest set that expresses financial segregation without introducing departments or a complex hierarchy.
- **Product impact:** Clear responsibility and predictable Admin navigation.
- **Commercial / operational impact:** Reduces Super Admin dependence and enables finance/KYC/support staffing.
- **Engineering complexity:** Medium; permission catalog, seed/migration, assignment templates, and tests are required.
- **Security or compliance impact:** Strong least privilege; Maker/Checker still requires runtime identity inequality.
- **MVP recommendation:** Approve Option A; defer custom roles and Support/Auditor split.
- **Consequence of deferring the decision:** RBAC migration, navigation, acceptance tests, and Admin onboarding remain blocked.

## P7-OD-02 — Super Admin global operation without market selection

- **Decision ID:** P7-OD-02
- **Question:** May Super Admin operate globally without selecting a market?
- **Why the decision is required:** Global mode changes aggregation, authorization, audit, UI, and the blast radius of writes.
- **Current repository reality:** Admin market context is currently a free-form client value. The server model supports multiple grants, but no safe global aggregate/write contract exists.
- **Option A:** Require Super Admin to select one granted target market for all ordinary pages and every write; no global mode in MVP.
- **Option B:** Allow a read-only global overview, while all writes still require explicit target market.
- **Additional option:** Allow global reads and writes without selection through a distinct break-glass permission.
- **Command Center recommendation:** Option A for MVP. A later read-only global view can be designed as a separate server aggregate.
- **Product impact:** Slightly more switching, much clearer context.
- **Commercial / operational impact:** Lowers cross-market operational mistakes and invalid currency aggregation.
- **Engineering complexity:** Option A low-to-medium; B high; global writes very high.
- **Security or compliance impact:** Option A minimizes tenant/data leakage and blast radius.
- **MVP recommendation:** One selected market at a time; explicit target market on all writes.
- **Consequence of deferring the decision:** Selected-market MVP may proceed, but no global dashboard or global-action claim may be implemented.

## P7-OD-03 — Maker/Checker for configuration changes

- **Decision ID:** P7-OD-03
- **Question:** Should configuration changes beyond manual MCP/iPoint adjustment require Maker/Checker?
- **Why the decision is required:** The P7 order asks for confirmation, but implementing a broader approval engine would change a locked baseline rule.
- **Current repository reality:** Baseline E-22 states dual approval applies **only** to manual MCP and iPoint adjustments. Phase 6 redemption refund has its own separate frozen Maker/Checker workflow. Ordinary configuration currently uses permission, validation, versioning, effective time, and audit.
- **Option A:** Retain the locked rule: no Maker/Checker for reward, redemption, package, commission, market, or ordinary operations.
- **Option B:** Formally reopen governance and require Maker/Checker for selected commercial configuration changes.
- **Command Center recommendation:** Option A. This is confirmation-only unless Bryan explicitly requests a formal change to the locked rule.
- **Product impact:** Keeps workflows understandable and avoids an approval bottleneck.
- **Commercial / operational impact:** Faster controlled configuration with immutable version/audit evidence.
- **Engineering complexity:** Option A low; Option B high and cross-domain.
- **Security or compliance impact:** Option A relies on least privilege, MFA, prospective versions, idempotency, and audit; it does not weaken mandated financial dual control.
- **MVP recommendation:** Do not generalize Maker/Checker.
- **Consequence of deferring the decision:** No blocker; the locked Option A continues to govern. Phase 7 must not implement Option B without new authority.

## P7-OD-04 — Reward-rate activation timing

- **Decision ID:** P7-OD-04
- **Question:** Should a reward-rate change activate immediately or only from a future market-local date?
- **Why the decision is required:** Rate selection affects prospective reward economics and the market-local daily job; current scheduler/plan binding does not prove safe arbitrary immediate activation.
- **Current repository reality:** Rules have UTC effective times and market timezones, but overlap protection, exact-midnight activation, and existing-plan rule selection have unresolved gaps.
- **Option A:** Schedule only for a future market-local date at `00:00`, displayed with resolved UTC; no same-day immediate activation.
- **Option B:** Permit immediate activation with a confirmation warning and server timestamp.
- **Additional option:** Permit both, but immediate activation requires a distinct emergency permission and reason.
- **Command Center recommendation:** Option A for MVP.
- **Product impact:** Predictable rate communication and daily reward behavior.
- **Commercial / operational impact:** Avoids intraday customer inconsistency and support disputes.
- **Engineering complexity:** Medium; timezone conversion, non-overlap, and job correlation are needed.
- **Security or compliance impact:** Reduces arbitrary economic changes and strengthens auditability.
- **MVP recommendation:** Future market-local `00:00` activation only.
- **Consequence of deferring the decision:** Reward-rate create/schedule UI remains blocked; history/read may proceed after market-safe access exists.

## P7-OD-05 — Reward-rate range and decimal precision

- **Decision ID:** P7-OD-05
- **Question:** What minimum, maximum, unit convention, and decimal precision are allowed for daily reward rates?
- **Why the decision is required:** O-06 is OPEN; UI/server validation cannot safely invent bounds or confuse percent with decimal fraction.
- **Current repository reality:** Storage is `numeric(38,10)` and only enforces non-negative values. The baseline lists up to `0.05%/day` as a reference, not a universal hard-coded rule.
- **Option A:** For MVP, express input as percentage points; allow `0%` through `0.05%` inclusive with up to 6 decimal places, stored canonically without binary floating point.
- **Option B:** Allow `0%` through `1%` inclusive with up to 10 decimal places.
- **Additional option:** Require each market to define approved min/max/precision before activation, with a technical ceiling of 10 decimals and no universal business maximum.
- **Command Center recommendation:** Option A for initial MVP markets, represented as versioned validation policy rather than a UI constant. Use the additional option before new-market launch.
- **Product impact:** Clear operator input and fewer economic mistakes.
- **Commercial / operational impact:** Caps exposure to the current reference envelope while retaining future market governance.
- **Engineering complexity:** Medium; canonical unit conversion and per-market policy versioning are needed.
- **Security or compliance impact:** Prevents excessive or ambiguous rates.
- **MVP recommendation:** Approve Option A for the initial market and require explicit future-market policy.
- **Consequence of deferring the decision:** Reward-rate mutation remains blocked under O-06.

## P7-OD-06 — Redemption-rate range and decimal precision

- **Decision ID:** P7-OD-06
- **Question:** What minimum, maximum, unit convention, and precision are allowed for redemption rates?
- **Why the decision is required:** A positive DB check exists, but no approved universal commercial range; incorrect units directly affect quoted point cost.
- **Current repository reality:** Rate versions use `numeric(38,10)`, are market-scoped and non-overlapping, and quotes/orders lock the selected version. `1 iPoint ≈ RM1` is provisional reference only.
- **Option A:** Require every market to define an approved positive min/max and display unit before activation; allow up to 10 decimal places technically, with no global business maximum.
- **Option B:** Apply one global `>0` through `1,000,000` range with up to 6 decimals.
- **Command Center recommendation:** Option A. Currency scale and commercial value differ by market, so a global range is unsafe.
- **Product impact:** Correct market-specific pricing and understandable quotes.
- **Commercial / operational impact:** Avoids accidental under/over-pricing while supporting different currencies.
- **Engineering complexity:** Medium; market policy and typed decimal validation are required.
- **Security or compliance impact:** Reduces configuration abuse; historical quote locking remains mandatory.
- **MVP recommendation:** Define the initial market bounds in the approved Phase 7 brief; block mutation for markets without policy.
- **Consequence of deferring the decision:** Redemption-rate history may be viewed, but creation/scheduling remains blocked.

## P7-OD-07 — Special merchant package approval authority

- **Decision ID:** P7-OD-07
- **Question:** Who may create and activate special merchant percentages?
- **Why the decision is required:** Special percentages change merchant economics and are currently under a broad package-manage permission.
- **Current repository reality:** D-010 locks the range to `>0%` and `<=100%`; existing service is versioned/idempotent/audited but does not establish a separate special-rate authority.
- **Option A:** Super Admin only for MVP through a dedicated special-package permission.
- **Option B:** Operations Admin may create/activate when explicitly assigned the dedicated permission; Super Admin is not required.
- **Additional option:** Operations Admin proposes and Super Admin approves, which would introduce a new non-mandated approval workflow.
- **Command Center recommendation:** Option A for MVP; revisit delegation after operating volume is known. Do not choose the additional option without changing the no-generalized-Maker/Checker rule.
- **Product impact:** Keeps exceptional commercial terms visibly exceptional.
- **Commercial / operational impact:** Reduces margin mistakes but may create a short-term Super Admin bottleneck.
- **Engineering complexity:** Low-to-medium with a dedicated permission.
- **Security or compliance impact:** Stronger commercial least privilege and audit.
- **MVP recommendation:** Super Admin-only special percentage authority; standard package operations may remain delegated.
- **Consequence of deferring the decision:** Special percentage create/activate UI remains hidden; existing standard package flows may proceed.

## P7-OD-08 — Effect of package changes on existing merchant assignments

- **Decision ID:** P7-OD-08
- **Question:** Should a new package version automatically affect existing merchant assignments?
- **Why the decision is required:** Assignment semantics determine which future transactions consume a new version and affect merchant expectations.
- **Current repository reality:** Transactions preserve transaction-time snapshots; package versions and assignments exist, but the business treatment of all existing assignments after a new version needs explicit confirmation.
- **Option A:** New versions affect only new assignments by default; existing assignments remain on their version until an explicit audited reassignment.
- **Option B:** Existing active assignments automatically roll to the new effective version at activation time.
- **Additional option:** Operator chooses per activation whether to migrate selected assignments through a previewed batch command.
- **Command Center recommendation:** Option A for MVP.
- **Product impact:** Predictable merchant terms and no surprise changes.
- **Commercial / operational impact:** More deliberate operations, lower dispute risk.
- **Engineering complexity:** Option A low; B medium-high; selective migration high.
- **Security or compliance impact:** Stronger evidence of which commercial terms applied.
- **MVP recommendation:** Explicit reassignment only; no bulk automatic migration.
- **Consequence of deferring the decision:** Package version creation may proceed, but activation affecting assigned merchants must be blocked or constrained to unassigned/new use.

## P7-OD-09 — Commission parameter effect on events

- **Decision ID:** P7-OD-09
- **Question:** Should commission parameter changes affect future events only?
- **Why the decision is required:** The area is listed for confirmation, but historical commission mutation would contradict the frozen Phase 5 contract.
- **Current repository reality:** Baseline E-28 and Phase 5 snapshots lock commission rules at the original business event. Posted ledger entries are immutable; corrections use exact-opposite compensation.
- **Option A:** Retain frozen future-event-only behavior; never recalculate historical commission.
- **Option B:** Formally reopen Phase 5 governance to permit retroactive recalculation.
- **Command Center recommendation:** Option A. This is confirmation-only unless Bryan explicitly directs a frozen-contract change.
- **Product impact:** Stable, explainable commission history.
- **Commercial / operational impact:** Avoids retroactive payout disputes and accounting restatement.
- **Engineering complexity:** Option A low; Option B extremely high and risky.
- **Security or compliance impact:** Preserves immutable accounting and audit evidence.
- **MVP recommendation:** Future source events only.
- **Consequence of deferring the decision:** No blocker; Option A remains controlling. No retroactive behavior may be built.

## P7-OD-10 — Manual adjustment maximum and escalation

- **Decision ID:** P7-OD-10
- **Question:** What maximum amount and escalation rule apply to manual MCP and iPoint adjustments?
- **Why the decision is required:** D-002 removes any Maker/Checker threshold exception, but does not define operational caps or higher-level escalation.
- **Current repository reality:** All amounts require distinct Maker/Checker. No approved universal maximum exists; markets/currencies/point exposure differ.
- **Option A:** Versioned per-market soft caps; requests above the standard cap require Super Admin checker/escalation, while Maker/Checker remains mandatory at every amount. A separately approved hard cap rejects larger requests.
- **Option B:** One global hard maximum for MCP and one for iPoint.
- **Additional option:** No maximum; rely only on Maker/Checker and audit.
- **Command Center recommendation:** Option A, with exact initial-market amounts supplied in the Phase 7 authorization.
- **Product impact:** Handles exceptional corrections without weakening controls.
- **Commercial / operational impact:** Limits loss exposure and makes escalation predictable.
- **Engineering complexity:** Medium; policy versions and approval routing are needed.
- **Security or compliance impact:** Strong risk control; never creates a dual-control exemption.
- **MVP recommendation:** Do not enable adjustment execution until initial market soft/hard caps are approved.
- **Consequence of deferring the decision:** Adjustment workflow can be built and tested, but production execution limits remain blocked.

## P7-OD-11 — Adjustment evidence attachment

- **Decision ID:** P7-OD-11
- **Question:** Is an evidence attachment mandatory for manual MCP/iPoint adjustments?
- **Why the decision is required:** Evidence quality affects checker review, dispute handling, retention, privacy, and storage design.
- **Current repository reality:** MCP supports an evidence reference, but policy is not consistently mandatory; the compliant iPoint request model does not yet exist.
- **Option A:** Require at least one opaque evidence attachment reference for every adjustment, plus reason code and explanation.
- **Option B:** Require evidence only above the escalation cap or for selected reason codes.
- **Additional option:** Never require attachments; explanation only.
- **Command Center recommendation:** Option A for MVP, with allowlisted file types/size, malware scanning, restricted access, retention, and no raw data in audit logs.
- **Product impact:** Better review confidence and support resolution.
- **Commercial / operational impact:** Slightly slower submission; materially better dispute evidence.
- **Engineering complexity:** Medium-high because secure evidence storage/lifecycle is required.
- **Security or compliance impact:** Strong audit value but introduces sensitive-data retention risk governed by O-08.
- **MVP recommendation:** Mandatory evidence; if secure storage is unavailable, block production adjustment rather than accept unsafe uploads.
- **Consequence of deferring the decision:** Request schema/storage and UI cannot be finalized; adjustments remain blocked.

## P7-OD-12 — Admin MFA requirement

- **Decision ID:** P7-OD-12
- **Question:** Which Admin users must complete MFA in MVP?
- **Why the decision is required:** MFA is missing and privileged Admin compromise has platform-wide impact.
- **Current repository reality:** Generic OTP exists but no factor enrollment, login challenge, recovery, trusted-device, or MFA policy exists. Baseline expectation already identifies mandatory 2FA for Super Admin.
- **Option A:** Require MFA for every Admin role at every new session; use step-up again for narrowly defined secret/high-risk actions.
- **Option B:** Require MFA only for Super Admin, Finance Approver, and high-risk actions.
- **Additional option:** Require only Super Admin MFA in MVP.
- **Command Center recommendation:** Option A.
- **Product impact:** One extra login step for all operators; consistent security model.
- **Commercial / operational impact:** Reduces account-takeover loss and incident cost.
- **Engineering complexity:** High; enrollment, challenge, recovery, factor reset, audit, and support procedures are required.
- **Security or compliance impact:** Critical positive control. Generic OTP alone must not be labelled MFA.
- **MVP recommendation:** MFA is a prerequisite for enabling sensitive Phase 7 operations.
- **Consequence of deferring the decision:** Sensitive Admin operations and production-readiness claims remain blocked.

## P7-OD-13 — Session duration and forced revocation

- **Decision ID:** P7-OD-13
- **Question:** What idle, absolute, refresh, and forced-revocation policy applies to Admin sessions?
- **Why the decision is required:** Existing token expiry/rotation exists, but Admin idle/device/revoke policy and UI are missing.
- **Current repository reality:** Access/refresh expiry and family reuse protection exist. There is no Admin session list, device control, idle timeout, revoke-all, or forced-revocation UI.
- **Option A:** 30-minute idle timeout, 8-hour absolute session, refresh-family maximum 7 days, immediate next-request enforcement for per-session/revoke-all/admin-suspension/password-reset events.
- **Option B:** 60-minute idle, 12-hour absolute, 30-day refresh maximum.
- **Additional option:** Role-based durations with stricter Finance/Super Admin values.
- **Command Center recommendation:** Option A for a simple secure MVP; revisit role-based durations later.
- **Product impact:** Predictable sign-in cadence and safer shared-workstation use.
- **Commercial / operational impact:** Modest login friction, reduced unauthorized-session exposure.
- **Engineering complexity:** Medium-high across server policy, activity semantics, UI, and tests.
- **Security or compliance impact:** Strong control if server-enforced; client timers alone are insufficient.
- **MVP recommendation:** Approve Option A and provide current/all-session revocation.
- **Consequence of deferring the decision:** Session-management implementation and acceptance criteria remain incomplete.

## P7-OD-14 — Basic exports in Phase 7 MVP

- **Decision ID:** P7-OD-14
- **Question:** Are basic exports included in Phase 7 MVP?
- **Why the decision is required:** Exports offer operational value but amplify cross-market and sensitive-data leakage risk.
- **Current repository reality:** No export/report job API, permission, audit, retention, or UI exists. Advanced reporting belongs to Phase 9.
- **Option A:** Include bounded, selected-market, masked CSV export for explicitly approved basic reports only; no raw audit/KYC/voucher export.
- **Option B:** Exclude all exports from Phase 7; on-screen reports only.
- **Additional option:** Include asynchronous large exports with downloadable artifacts and retention jobs.
- **Command Center recommendation:** Option A with strict row/date bounds and synchronous generation; defer large async export infrastructure.
- **Product impact:** Supports routine offline review without turning Phase 7 into BI.
- **Commercial / operational impact:** Saves manual copy work for finance/operations.
- **Engineering complexity:** Medium; permission, mask, CSV injection protection, audit, and limits are needed.
- **Security or compliance impact:** Moderate-high leakage risk; identical market/masking rules and audit-of-export are mandatory.
- **MVP recommendation:** Limited masked CSV only.
- **Consequence of deferring the decision:** On-screen basic reports can proceed; export controls/UI are omitted.

## P7-OD-15 — KYC and sensitive-member-data masking

- **Decision ID:** P7-OD-15
- **Question:** What sensitive fields may each Admin role view, and how must they be masked?
- **Why the decision is required:** KYC and member data access is market/legal sensitive; current masking exists in parts but no Phase 7-wide role matrix is approved.
- **Current repository reality:** Member and merchant services include masking controls, while O-08 leaves per-market retention/legal policy open. Generic audit JSON is not a safe viewer projection.
- **Option A:** Deny by default. KYC Reviewer sees the minimum review evidence; Support sees masked identity/contact and no documents; Finance sees only financial identifiers; Super Admin does not automatically receive raw document content without dedicated permission and reason.
- **Option B:** Allow Super Admin and KYC Reviewer full raw data; mask only other roles.
- **Additional option:** Field policy varies by market and requires a policy version before launch.
- **Command Center recommendation:** Option A for MVP plus the additional per-market policy before each market launch.
- **Product impact:** Slightly more controlled drill-down, clearer privacy boundaries.
- **Commercial / operational impact:** Reduces breach impact and compliance exposure.
- **Engineering complexity:** High; allowlisted DTOs, field permissions, secure evidence access, and tests are required.
- **Security or compliance impact:** Critical privacy control; audit every sensitive view.
- **MVP recommendation:** Approve Option A and block raw export/download by default.
- **Consequence of deferring the decision:** KYC detail UI, audit viewer, and exports remain blocked.

## P7-OD-16 — Dashboard freshness

- **Decision ID:** P7-OD-16
- **Question:** How fresh must dashboard data be?
- **Why the decision is required:** Freshness determines query design, caching, operator expectations, and whether a metric can drive action.
- **Current repository reality:** No aggregate dashboard exists; current merchant counts use the first 20 rows and reward-job rows are fabricated.
- **Option A:** Operational queues/status alerts update within 60 seconds; aggregate KPI counts within 5 minutes; every card displays `asOf` and stale/unavailable state.
- **Option B:** All dashboard data is request-time/live.
- **Additional option:** All data may be up to 15 minutes old.
- **Command Center recommendation:** Option A.
- **Product impact:** Timely triage without pretending all domains share one transaction snapshot.
- **Commercial / operational impact:** Good operational responsiveness with bounded infrastructure cost.
- **Engineering complexity:** Medium; cache/aggregate policy and invalidation are needed.
- **Security or compliance impact:** Low direct risk; false freshness is an operational integrity risk.
- **MVP recommendation:** 60-second queues, 5-minute aggregates, explicit as-of/stale labels.
- **Consequence of deferring the decision:** Dashboard formulas may be designed, but caching and acceptance cannot be finalized.

## P7-OD-17 — Support-user financial-ledger visibility

- **Decision ID:** P7-OD-17
- **Question:** May Support / Read-only Auditor users view financial ledgers?
- **Why the decision is required:** Ledger data assists support but exposes balances, commercial activity, and customer financial history.
- **Current repository reality:** Viewer seeding is incomplete and no unified safe ledger projection exists. Member wallet has no Admin read API; MCP and commission reads have different access maturity.
- **Option A:** No raw ledger access by default. Support receives masked transaction/reference summaries; Finance roles receive dedicated market-scoped ledger permissions.
- **Option B:** Allow Support read-only access to MCP and iPoint ledger entries, masked and market-scoped, but not commission.
- **Additional option:** Allow all financial ledgers read-only.
- **Command Center recommendation:** Option A.
- **Product impact:** Support may need an escalation to Finance for detailed balance disputes.
- **Commercial / operational impact:** Slightly more handoff, materially lower data exposure.
- **Engineering complexity:** Option A medium due safe summary DTO; broader access adds policy/test complexity.
- **Security or compliance impact:** Strong least privilege and privacy boundary.
- **MVP recommendation:** No Support raw-ledger permission.
- **Consequence of deferring the decision:** Support role must remain excluded from ledger/detail routes.

## P7-OD-18 — Rejected adjustment edit or recreate

- **Decision ID:** P7-OD-18
- **Question:** May a rejected manual adjustment be edited, or must it be recreated?
- **Why the decision is required:** Editing a reviewed request weakens immutable evidence and can invalidate the checker’s decision context.
- **Current repository reality:** Financial/audit history is append-only. MCP request core fields are protected; the future iPoint workflow is not implemented.
- **Option A:** Rejected requests are immutable; maker creates a new request with `replacesRequestId`/correlation to the rejection.
- **Option B:** Allow maker to edit the rejected request and resubmit with version history.
- **Command Center recommendation:** Option A.
- **Product impact:** Clear request history and no ambiguity about what was reviewed.
- **Commercial / operational impact:** Minor resubmission effort; better dispute/audit evidence.
- **Engineering complexity:** Low; clone/recreate UX and linkage are straightforward.
- **Security or compliance impact:** Strong immutability and non-repudiation.
- **MVP recommendation:** Recreate, never edit.
- **Consequence of deferring the decision:** Rejected requests remain terminal and no edit UI should be built.

## P7-OD-19 — Redemption refund wallet-ledger gap disposition

- **Decision ID:** P7-OD-19
- **Question:** Should Command Center authorize a separate Phase 6 remediation before any Phase 7 redemption-refund approval exposure?
- **Why the decision is required:** The current approval path can mark refund/order/inventory state without appending the required wallet refund ledger entry and restoring the wallet projection.
- **Current repository reality:** SEC-02 is critical; Phase 6 is frozen under D-045. Phase 7 has no authority to repair or bypass it.
- **Option A:** Authorize an isolated Phase 6 remediation with atomic wallet ledger credit, projection update, idempotency, market/RBAC, audit, and full regression before Phase 7 exposure.
- **Option B:** Defer remediation and disable/hide redemption-refund approval in Phase 7 MVP.
- **Command Center recommendation:** Option A if redemption refund operations are required in MVP; otherwise Option B with an explicit unavailable state. Never expose the current approval path.
- **Product impact:** Determines whether Admin can safely complete refunds.
- **Commercial / operational impact:** Critical customer-balance and support impact.
- **Engineering complexity:** High due frozen-domain financial regression.
- **Security or compliance impact:** Critical ledger integrity and authorization issue.
- **MVP recommendation:** Treat as a hard gate; preferred Option A.
- **Consequence of deferring the decision:** Redemption refund approval remains blocked; read-only order/refund status may proceed only through a safe market-scoped adapter.

## P7-OD-20 — Compliant manual iPoint adjustment implementation

- **Decision ID:** P7-OD-20
- **Question:** Should Phase 7 MVP include a separately authorized compliant manual iPoint Maker/Checker workflow?
- **Why the decision is required:** The capability is required by product governance, but the current one-step endpoint violates D-002 C-03 and lacks request/decision records.
- **Current repository reality:** SEC-01/14; no compliant API or persistence model exists. The lower-level wallet ledger remains frozen Phase 3 ownership.
- **Option A:** Authorize an isolated Phase 3/Phase 7 integration sub-phase for durable request/decision/execute, distinct actors, payload-hash idempotency, atomic ledger/projection/audit, and exact-opposite correction.
- **Option B:** Exclude manual iPoint adjustment execution from Phase 7 MVP and show a blocked/unavailable state.
- **Command Center recommendation:** Option A because the Admin PRD requires the operation and dual control; keep the current endpoint disabled throughout remediation.
- **Product impact:** Enables governed correction of member point balances.
- **Commercial / operational impact:** Important for support/finance corrections; high loss risk if wrong.
- **Engineering complexity:** High; likely forward migration and deep financial tests.
- **Security or compliance impact:** Critical segregation, ledger, idempotency, and audit control.
- **MVP recommendation:** Include only after separate authorization and acceptance; never ship the current path.
- **Consequence of deferring the decision:** Manual iPoint adjustment remains unavailable; no workaround or direct DB change is permitted.

## P7-OD-21 — Ownership of dead/unsafe controller remediation

- **Decision ID:** P7-OD-21
- **Question:** Should unreachable/unsafe Phase 5/6 Admin controllers be repaired under their frozen owner phases or replaced by Phase 7 adapters?
- **Why the decision is required:** Doubled prefixes, unregistered controllers, missing market checks, missing permissions, and duplicate services affect agent, commission, rate, redemption catalog/rate, and adjustment surfaces.
- **Current repository reality:** Source declarations do not equal reachable safe APIs. Phase 5/6 are frozen; P7-S0 cannot register, rename, or repair them.
- **Option A:** Authorize isolated frozen-owner remediations first, then let Phase 7 consume the corrected canonical APIs.
- **Option B:** Leave frozen code untouched and build market-safe Phase 7 adapters that call canonical owner services.
- **Additional option:** Decide per capability: owner remediation for domain correctness, Phase 7 adapter for read projection only.
- **Command Center recommendation:** Additional option. Repair domain/security defects under the owner; use Phase 7 adapters only for Admin-specific reads/orchestration.
- **Product impact:** Avoids duplicate business logic while enabling a coherent Admin UI.
- **Commercial / operational impact:** Slower initial sequencing but lower long-term defect and audit cost.
- **Engineering complexity:** High and requires strict ownership/commit separation.
- **Security or compliance impact:** Essential for market isolation and permission correctness.
- **MVP recommendation:** No UI exposure until each capability has an explicit owner and acceptance evidence.
- **Consequence of deferring the decision:** Agent, commission, redemption catalog/rate/refund/fulfilment operations remain blocked or read-only unavailable.

## P7-OD-22 — Admin PWA approval scope

- **Decision ID:** P7-OD-22
- **Question:** Which privileged actions, if any, may be performed through the Admin PWA in MVP?
- **Why the decision is required:** O-09 is OPEN; the current app has manifest metadata but no service worker, reliable mobile navigation, or offline safety contract.
- **Current repository reality:** Admin Web is only partially PWA-ready. Privileged writes must never be queued or replayed offline.
- **Option A:** PWA MVP is read-only/monitoring plus safe navigation; all privileged writes and approvals require the full online desktop/web flow.
- **Option B:** Allow selected lightweight non-financial approvals online, with MFA/step-up and no offline queue.
- **Additional option:** Allow financial Maker/Checker approvals on PWA.
- **Command Center recommendation:** Option A for MVP.
- **Product impact:** Mobile visibility without creating a high-risk mobile approval channel.
- **Commercial / operational impact:** Operators can monitor on mobile but complete actions in the full web workspace.
- **Engineering complexity:** Option A medium; approval options high.
- **Security or compliance impact:** Avoids lost/stolen-device and offline-replay risk.
- **MVP recommendation:** Read-only PWA; no privileged action queue, background replay, or financial approval.
- **Consequence of deferring the decision:** Only responsive web/manifest readiness may be claimed; no PWA approval action may be implemented.

---

## Decision handling rule

After Bryan decides, Command Center should convert approved choices into authoritative governance/Phase Brief language, reconcile any conflict with frozen documents explicitly, and then authorize only the corresponding sub-phases. Unanswered items stay OPEN and must be represented as blocked or unavailable in implementation—not silently defaulted.

**Document status: DRAFT / FOR DECISION / NOT IMPLEMENTATION AUTHORIZATION**
