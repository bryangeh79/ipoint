# P7-S0E Phase 7 Admin Operations Contract Draft

> **Status: DRAFT / UNDER COMMAND CENTER REVIEW / NOT IMPLEMENTATION AUTHORIZATION**
>
> This is a documentation-only synthesis of P7-S0A/B/C/D at base SHA `99c35c7c5581747a8eb8b9e6600b4489691c4fa0`. Nothing in this document is FINAL, ACCEPTED, or FROZEN. Phase 7 remains `NOT_AUTHORIZED` in `PHASE_REGISTRY.md`. Open items are explicitly marked and must not be implemented as production behavior.

## 1. Product objective

Phase 7 should provide a safe, market-aware Admin Operations workspace for authorized staff to observe platform health, perform approved member/merchant/agent/KYC operations, manage prospective commercial-rule versions, execute the two mandated manual financial-adjustment workflows with segregation of duties, and investigate an immutable audit trail.

Phase 7 owns the administration experience and integration boundary. It does **not** own or reinterpret Phase 1-6 domain truth. Every write must be routed to the owning service; every read must retain server-side permission and market isolation.

## 2. Commercial and operational value

- Reduces operational handling time by consolidating queues, search, status, evidence, and next actions.
- Protects revenue and customer balances through prospective versioning, immutable ledgers, explicit market scope, and dual control where mandated.
- Enables multi-market scaling without relying on client-only filters or combining unlike currencies/wallets.
- Gives support, finance, KYC, and governance staff least-privilege views instead of broad Super Admin access.
- Improves incident investigation through correlation IDs, immutable timelines, safe projections, and audit-of-audit.
- Prevents false operational confidence by replacing page-derived or fabricated counts with bounded server-owned aggregates.

## 3. MVP boundary

The minimum viable Phase 7 is:

1. Admin authentication hardening, MFA decision/implementation, session lifecycle, server-authorized market selector, and permission-catalog reconciliation.
2. A routed responsive Admin Web shell using the shared Design System.
3. Market-scoped dashboard aggregates with freshness/as-of metadata.
4. Reuse of proven Phase 1/2 member, merchant, KYC, package, and MCP commands.
5. Safe adapters for Phase 3/5/6 reads and configuration only after their prerequisite security/route gaps are authorized and closed.
6. Domain-specific manual MCP Maker/Checker; manual iPoint remains blocked until a compliant command exists.
7. Read-only, allowlisted operational audit viewer and bounded basic reports.

### Capability assessment gate

This table applies the required seven product lenses to every proposed capability. “Now” means it belongs in the Phase 7 MVP **only after listed prerequisites**; it is not implementation authorization.

| Capability | Product-positioning fit | Commercial / operational value | Development complexity | Long-term maintenance risk | Phase 7 now? | Deferred / blocked condition | Minimum viable deliverable |
|---|---|---|---|---|---|---|---|
| Admin auth/session/MFA | Essential SaaS control plane | Prevents privileged-account takeover and enables revocation | High | Medium | Yes, prerequisite | MFA/session policies need Bryan decisions | Admin eligibility/status enforcement, MFA, logout, session list/revoke, audited expiry |
| Roles/permissions/market grants | Direct fit with locked three-dimensional model | Least privilege and scalable staffing | High | High if codes drift | Yes, prerequisite | Custom role designer deferred | Six-role evaluated template, server-owned permission catalog, grant/revoke API |
| Market context | Core multi-market fit | Prevents cross-market errors/leakage | Medium | Low if centralized | Yes, prerequisite | Global view pending P7-OD-02 | Server-authorized selector; explicit market on writes |
| Dashboard | Strong daily-operations fit | Faster triage and prioritization | Medium | Medium due metric definitions | Yes | Advanced BI/risk deferred | Bounded selected-market counts with as-of/freshness and drill-down |
| Member Operations | Proven direct fit | Support and account-lifecycle efficiency | Low | Low | Yes | New lifecycle policy blocked by O-10 | Existing read/status/session/reverification/note commands |
| Merchant Operations | Proven direct fit | Onboarding, availability, and revenue operations | Medium | Medium | Yes | Attribution reassignment remains open | Existing market-scoped lookup/review/status commands |
| Agent Operations | Fit, but inherited implementation unsafe | Activation and commission operations | High | High | Blocked until remediation | O-02/O-05/O-10 and SEC-04/08/09 | Market-safe read queue and existing lifecycle commands after owner hardening |
| KYC Review | Essential operational fit | Faster compliant onboarding | Medium | High due privacy/retention | Yes, with masking policy | O-08 per-market retention/legal policy | Member and merchant queues, masked evidence, existing transitions |
| Market Configuration | Necessary platform administration | Enables controlled market launch/status | High | High blast radius | Limited MVP | New-market legal/commercial setup is separate | Read registry; tightly controlled status command with dependency preview |
| Reward Rate Management | Direct configurable-rule fit | Controls reward economics prospectively | High | High | Blocked until O-06 and owner hardening | SEC-10/19 and reward semantic conflict | Version create/schedule/history with non-overlap, local/UTC effective time |
| Redemption Rate Management | Direct configurable-rule fit | Controls market redemption economics | Medium | High | After safe Phase 6 adapter | SEC-15 and unreachable controller | Append-only create/list; no historical quote/order mutation |
| Merchant Package Management | Proven direct fit | Supports merchant monetization packages | Low | Medium | Yes | Existing-assignment effect needs P7-OD-08 | Reuse version/activate/assign/default commands and history |
| Commission Parameter Management | Direct configurable-rule fit | Controls future commission costs | High | High | Blocked until Phase 5 remediation | SEC-04/05/06/11 | Frozen source/generation-only create/schedule/history with market enforcement |
| Manual iPoint Adjustment | Required control capability | Corrects balances safely | High | Very high | Contract now; execution blocked | SEC-01/14; separate Phase 3 authorization | Durable Maker/Checker request/decision/execute API and queue |
| Manual MCP Adjustment | Required and substantially implemented | Corrects merchant MCP safely | Medium | High | Yes through existing service | Clarify evidence/max/escalation/retry/correction policy | Queue plus existing create/submit/decision/execute flow |
| Maker/Checker | Locked only for manual MCP/iPoint; P6 refund separate | Fraud/error prevention | High | High if generalized | Yes, domain-specific | No universal approval engine | Separate identities, no self-approval, immutable decision and execution audit |
| Audit Viewer | Core governance fit | Investigation and accountability | High | High privacy risk | Yes | Export pending P7-OD-14 | Market-scoped allowlist projection, filters, cursor pagination, audit-of-audit |
| Basic Reports/exports | Bounded operational fit | Routine operations and finance review | Medium | Medium | Reports yes; export decision open | Advanced reconciliation/BI Phase 9 | Selected-market as-of tables; optional masked export |
| Admin PWA | Approved web/PWA direction | Mobile visibility and lightweight work | Medium | High for privileged writes | Shell/readiness yes | Approval scope O-09/P7 decisions | Responsive routed shell, install metadata, no offline queued privileged writes |

## 4. Explicit non-goals

- No production code, migration, schema, test, CI, or frozen-domain change during P7-S0.
- No advertising/content operations (Phase 8).
- No advanced reconciliation, fraud/risk case workflow, regulatory reporting, warehouse, predictive analytics, or BI (Phase 9).
- No full cross-domain E2E/recovery program (Phase 10) or production hardening/load/backup/UAT program (Phase 11).
- No cross-market wallet transfer, withdrawal/cash-out, cross-border settlement, licensed wallet, lending, IPO execution, five-level rewards, advertising bidding, AI risk engine, or advanced recommendation.
- No global financial totals that add different currencies or market wallets.
- No edit-in-place of ledgers, confirmed transactions, receipts, commission entries, quotes, orders, or historical rule versions.
- No merchant/branch attribution reassignment, agent reapplication policy, inactive-user consequences, agent course verification automation, or new-market compliance rules until their OPEN decisions are resolved.
- No real notification send, payment, refund, voucher reveal, or other production side effect merely because a UI control exists.

## 5. Admin actors and roles

The locked authorization model remains **Role + Market Access + Action Permission**. P7-S0C’s six-role draft is evaluated, not frozen:

| Draft role | MVP purpose | Default boundary | Status |
|---|---|---|---|
| Super Admin | Access governance and exceptional platform administration | Small membership; MFA; no self-approval; assigned markets for market data unless P7-OD-02 authorizes global mode | OPEN via P7-OD-01/02 |
| Operations Admin | Daily member, merchant, fulfilment, and operational actions | No financial adjustment or commercial-rate authority by default | Draft |
| Finance Operator | Finance reads and manual MCP/iPoint Maker duties | Cannot approve own or any request if assigned as maker | Draft |
| Finance Approver | Independent Checker duties and finance evidence review | Cannot create the request it checks | Draft |
| KYC Reviewer | Member/merchant KYC review | Masked evidence; assigned markets only | Draft |
| Support / Read-only Auditor | Support lookup plus allowlisted read-only audit | No writes, raw KYC, voucher reveal, or unredacted export | Draft; may split later |

The role template never replaces per-action checks. System roles are not generic CRUD records. P7-OD-01 decides the final simplified set.

## 6. Authentication and session contract

Reuse the existing shared credential/session engine and token rotation; do not create an Admin-only parallel token system. An Admin session is usable only when the account and `admin_users` record are active and the account is eligible for Admin access.

Required MVP contract:

- Login produces a session only after credential validation, Admin eligibility/status validation, and the approved MFA challenge.
- MFA is currently **MISSING**; P7-OD-12 is a prerequisite decision and implementation gate for sensitive Phase 7 operations.
- Access/refresh expiry, idle and absolute durations follow P7-OD-13; refresh reuse revokes the token family.
- Admin Web provides logout, session/device list, current-session marker, per-session and forced-all revocation as authorized.
- Revocation is effective on the next server request; local state never overrides server state.
- Login failures, MFA lifecycle, refresh/reuse, logout, forced revocation, and policy denial generate safe security evidence.
- Password reset reuses the shared flow, revokes existing sessions, and gains an Admin Web route; no credential or token material is logged.

## 7. Permission model

- Permission codes are server-owned catalog entries and must be reconciled with every route decorator before UI exposure.
- The foundation seed gaps identified in S0B/C/D (`member.kyc.review`, reward, wallet adjustment, agent, and commission families) are prerequisites, not UI workarounds.
- Every protected API requires active Admin identity plus an exact action permission. Market-owned resources additionally require an active `market_access` grant.
- UI visibility/disabled states improve usability only; crafted requests must receive server denial.
- Super Admin’s seed behavior must not silently gain every newly added permission without catalog review.
- Broad or duplicated codes (package manage/assign, merchant KYC, MCP refund) must be reconciled into a least-privilege matrix before assignment.
- Custom role creation and department hierarchy are not MVP requirements.

## 8. Multi-market access contract

- The server returns the Admin’s active accessible markets after authentication; the free-form Market UUID login field is retired in a future authorized implementation.
- Ordinary pages operate in one selected **Current Admin Market**. A local last-selection hint is non-authoritative and must be revalidated.
- Every write includes an explicit target market in a stable route/command. The server verifies target resource market, permission, and active grant.
- No UI-only filtering, arbitrary `x-market-id`, or client loop is an authorization mechanism.
- Revoked access fails on the next request and invalidates displayed context.
- Successful and denied switches are auditable security events.
- Cross-market financial values remain separated by market/currency; no implicit FX conversion.
- Whether Super Admin gets a global mode is OPEN under P7-OD-02. The recommended MVP is one selected market at a time.

## 9. Dashboard contract

Dashboard data must come from bounded server-owned aggregate queries, scoped to authorized market and time range, with `asOf`, freshness status, definition label, and drill-down permission.

MVP cards may include status-defined active members/merchants/agents, separate member/merchant pending KYC counts, workflow-specific pending approvals, MCP low-balance warnings after threshold policy, real reward-job failures, redemption exceptions after safe adapters, transaction totals by status/currency, and commission totals by frozen type/generation/currency/status.

SEC-17/18 are binding constraints: fabricated reward jobs and counts derived from the first 20 merchants must never be displayed as totals. Missing sources display “Unavailable” with reason, not zero. Freshness is OPEN under P7-OD-16. No cross-market/cross-currency sum is permitted.

## 10. Member Operations contract

Reuse `AdminMemberService` and its existing APIs for lookup/detail, suspend/reactivate/close, session revocation, reverification, and notes. Reads and writes retain service-level market access, masking, row locks, status transitions, history, and audit. Wallets are read-only from Member Operations; manual adjustment is a separate workflow. O-10 prevents any new inactivity lifecycle or balance consequence.

MVP: search/list/detail, clear status and current market, masked profile/KYC summary, timeline, permitted commands with reason/confirmation, and permission-denied/empty/error states.

## 11. Merchant Operations contract

Reuse merchant, package, and MCP services. Phase 7 controllers/UI must not write merchant, package, MCP, attribution, or transaction tables directly. Market, merchant branch, actor, reason, and idempotency key remain explicit.

MVP: merchant/application/KYC queues, branch detail, status commands, package assignment/history, MCP account/ledger/reconciliation, recharge/refund request operations already proven safe, and audit drill-down. Attribution is read-only; reassignment remains OPEN. Redemption catalog remains platform-owned and is not a merchant operation.

## 12. Agent Operations contract

The owning service is the frozen Phase 5 agent-activation service, but current runtime evidence is duplicated/unsafe. Agent UI remains blocked until separate authorization resolves doubled routes, duplicate implementations, missing permission seed, server market checks, actor attribution, concurrency, hard-coded MYR/fee gaps, and swallowed commission errors (SEC-04/08/09).

After remediation, MVP is a market-scoped queue/detail plus existing approve/reject/suspend/reactivate/deactivate commands, with complete transition/audit and visible commission-posting outcome. O-02 course verification, O-05 fee/currency, and O-10 inactivity behavior remain blocked; the UI may display stored facts only.

## 13. KYC Review contract

Use existing member `member.kyc.review` and merchant KYC services after permission-catalog reconciliation. Member and merchant queues remain distinct because their state machines and authorities differ.

The server enforces market scope; evidence is masked/allowlisted; view/start/decision/reverification events are auditable; decision reason and required evidence are retained; no raw document export by default. O-08 controls per-market retention, legal access, masking depth, and evidence lifecycle. P7-OD-15 sets MVP masking requirements without inventing retention law.

## 14. Market Configuration contract

Market registry is global platform configuration with high blast radius. MVP should provide read/list/detail and, only with explicit permission, create or activate/deactivate commands through `MarketService` with reason, dependency preview, audit, idempotency, and concurrency protection.

Market codes, currency, scale, timezone, and legal/commercial requirements are not generic editable labels after dependent data exists. Deactivation must not rewrite domain records. Launching a new market remains gated by O-05/O-08 and centrally approved configuration.

## 15. Reward Rate Management contract

Reward rules are market-scoped, versioned, effective-time, forward-only configuration. Historical/accrued/distributed rewards never recalculate. Inputs remain decimal strings; market-local effective time is shown alongside resolved UTC.

The current route is unsafe (SEC-10) and scheduler/rule-selection semantics are not fully aligned (SEC-19/C-03), so creation is blocked until separately authorized Phase 3 integration hardening establishes market access, idempotency + payload hash, non-overlap, atomic audit, and the canonical rule selection behavior. O-06/P7-OD-05 decides range/precision; P7-OD-04 decides immediate versus future market-local activation. No UI default freezes either decision.

## 16. Redemption Rate Management contract

Create only immutable market-scoped rate versions with effective time and audit. Existing quote/order snapshots remain unchanged under D-043 OD-22 and the baseline redemption lock. The UI may list current/history and schedule a new version; “cancel” must not mutate an immutable row. Supersession requires a prospective version if separately authorized.

Runtime exposure is blocked until the Phase 6 controller is safely registered or a Phase 7 adapter is authorized, permission/market enforcement is added, idempotency is honored, and SEC-15 is resolved. P7-OD-06 decides commercial range/precision.

## 17. Merchant Package Management contract

Reuse the existing market-scoped package service for profile/version creation, draft update, activation/cancellation, special percentage creation, assignment, and default selection. Active/historical records and transaction snapshots are immutable; changes are prospective.

D-010 remains locked: special merchant service fee is `> 0%` and `<= 100%`; implemented precision is up to six decimals. P7-OD-07 decides special-package approval authority without automatically adding Maker/Checker. P7-OD-08 decides existing-assignment behavior. MVP exposes history/effective-time warnings and validated selectors rather than raw IDs.

## 18. Commission Parameter Management contract

Only the three frozen sources are allowed: `AGENT_UPGRADE`, `MEMBER_CONSUMPTION`, and `MERCHANT_RECRUITMENT`. Agent upgrade and member consumption follow the frozen G1/G2 boundaries; merchant recruitment remains one generation. Five-level rewards remain deferred.

Changes are immutable market-scoped versions, effective only for future source events; posted ledgers and snapshots never recalculate. Exposure is blocked pending Phase 5 authorization to resolve doubled routes, market leakage, missing permission/audit/idempotency, and generation validation conflict (SEC-04/05/06/11). P7-OD-09 confirms future-only behavior; no alternative is implemented unless frozen governance changes.

## 19. Manual iPoint Adjustment contract

**DRAFT / BLOCKED.** The current one-step endpoint is non-compliant with D-002 C-03 and must not be exposed.

Required request: immutable request ID; wallet/member and verified market; `CREDIT|DEBIT`; positive canonical decimal amount; point unit; reason code; explanation; evidence reference per P7-OD-11; auth-derived maker/checker; `PENDING|APPROVED|REJECTED|EXECUTED|FAILED`; idempotency keys + payload hashes; expected version; correction linkage.

Execution requires distinct actors, request and wallet locking in deterministic order, approval-time revalidation, one transaction through the owning wallet ledger service, append-only ledger entry, balance projection, request transition, and audit. A correction is a new independently approved exact-opposite request. The workflow is blocked until a compliant command API and any required forward migration receive separate Phase 3/Phase 7 authorization.

## 20. Manual MCP Adjustment contract

**DRAFT over an existing compliant foundation.** Reuse existing request/decision/account/ledger service and DB constraints. All amounts require Maker/Checker; maker, checker, and any separate executor identities follow the approved segregation policy.

Request includes account/market/currency derivation, `CREDIT|DEBIT`, positive decimal amount, reason/explanation/evidence, actor/time, immutable state, idempotency/payload hash, and audit. Decision/execution lock and revalidate request/account; ledger append, projection, request transition, and audit are atomic. Original ledger entries never mutate. Phase 7 must clarify canonical approval-versus-execution retry behavior, explicit failed-attempt history, correction linkage, maximum/escalation policy (P7-OD-10), evidence policy (P7-OD-11), and rejected-request handling (P7-OD-18).

## 21. Maker / Checker contract

- Mandatory for **manual MCP** and **manual iPoint** credit/debit at every amount under D-002 C-03.
- Domain-specific request, decision, execution, permission, and audit chains; no generic cross-domain writer.
- Maker and checker are different authenticated Admin identities; request-supplied actor IDs are ignored/rejected.
- No self-approval even for Super Admin; role assignment does not replace runtime inequality checks.
- Checker revalidates permission, market grant, target, amount, current state/version, evidence, and available balance/limit at decision/execution time.
- A rejected request never executes. Edit-versus-recreate is OPEN under P7-OD-18.
- Do **not** generalize Maker/Checker to configuration or ordinary operations. The locked baseline says only manual MCP/iPoint adjustments require it. Phase 6 redemption-refund Maker/Checker remains a separate frozen workflow and permission set.

## 22. Audit Viewer contract

The viewer is read-only and server-filtered. It projects allowlisted fields from `audit_logs`, `security_events`, `entity_timelines`, and explicitly approved domain workflow records; it does not expose raw table JSON.

MVP filters: bounded time range, selected market, actor, action, resource type/ID, request ID, result, and Maker/Checker state, with cursor pagination. Show UTC and market-local time. Before/after defaults hidden and is available only for approved resource/field pairs.

Never expose credentials, secrets, tokens, cookies, hashes, OTP/recovery codes, KYC document payloads, payment credentials, voucher plaintext/ciphertext/IV/auth tags, or decryption material. Viewing/searching/exporting audit data is itself audited with safe filter metadata. SEC-16/20 are Phase 7 scope prerequisites.

## 23. Basic Reports contract

Basic reports are selected-market, bounded-date, reproducible read models with definitions and `asOf` timestamps. Candidate MVP reports: member/merchant/agent status, KYC queue aging, MCP account/ledger reconciliation summary, workflow queue counts, transaction totals by status/currency, reward-job results from real runs, commission totals by frozen source/generation/status/currency, and redemption operational exceptions after safe adapter remediation.

No client-side financial recomputation, arbitrary raw SQL export, cross-currency sum, advanced reconciliation, risk scoring, warehouse, or Phase 9 BI. Whether CSV/basic export is included is OPEN under P7-OD-14; any export must apply identical market permission, masking, audit, retention, row/time limits, and asynchronous-job policy where needed.

## 24. Frozen-domain integration rules

1. Phase 7 owns UX and orchestration, not domain truth.
2. Every mutation is an authenticated, permissioned, market-validated command to the owning service.
3. No direct writes to wallet/ledger, MCP, transaction/receipt, commission, redemption, KYC, package, attribution, or audit tables.
4. Configuration is append/version/schedule, never historical edit.
5. Financial read models use server-derived decimal values and compensation semantics.
6. Originals stay immutable; corrections append linked compensating records.
7. Market context is never authorization; every request revalidates access.
8. Sensitive evidence is minimized, allowlisted, masked, and access-audited.
9. OPEN/DEFERRED behavior remains visibly blocked rather than filled with defaults.
10. Inherited gaps require separate authorization from the frozen owner; Phase 7 cannot “fix by facade” if the underlying command remains unsafe.

## 25. Error handling

- Return stable domain/security error codes and safe messages; never leak SQL, stack traces, secrets, internal IDs unnecessarily, or voucher material.
- Include a request/correlation ID visible to operators and recorded in audit.
- Distinguish validation, authentication, permission, market denial, state conflict, idempotency mismatch, stale version, concurrency retryable failure, and service unavailable.
- UI covers inline field errors, page errors, permission denied, session expired, offline/retry, blocked prerequisite, and partial aggregate availability.
- No false success: unavailable metrics are not zero; unsent notifications are not “notified”; failed downstream commission/refund effects are surfaced.
- A critical command either commits domain effect + state + audit atomically or reports failure without partial state.

## 26. Idempotency

All critical writes require an operation-scoped idempotency key and canonical payload hash. Same key + same payload returns the original result; same key + different payload returns conflict. Keys are not stored/logged in plaintext where the existing domain uses hashes.

Create/schedule/activate rule operations, market status commands, adjustment request/decision/execution, retries, exports, and other side-effecting admin actions must define their own namespace and retention. UI retry reuses the same key after uncertain outcome. Read requests do not require idempotency.

## 27. Concurrency

- Commands revalidate current state, permission, market grant, and expected version inside the transaction.
- Financial workflows lock request then target aggregate in a deterministic order and rely on owning-domain unique/advisory/row locks.
- Configuration prevents overlapping effective periods at the database or serializable/advisory-lock boundary; pre-check alone is insufficient.
- Losing concurrent requests return the original idempotent result or a stable conflict; they leave no partial ledger, state, or audit.
- Revoked market/role/session access takes effect on the next request, including queued approval pages.
- Aggregate dashboards may be eventually current but must display as-of/freshness rather than imply a single cross-domain transaction snapshot.

## 28. Security

### SEC-01..SEC-20 disposition

| Finding | Disposition | Gate / owner |
|---|---|---|
| SEC-01 iPoint adjustment lacks Maker/Checker | Prerequisite; block endpoint/UI | Separate Phase 3 + Phase 7 authorization for compliant command |
| SEC-02 redemption refund lacks wallet ledger credit | Critical frozen-domain blocker | Separate Phase 6 remediation decision P7-OD-19 |
| SEC-03 P6 controllers lack permission/market scope | Prerequisite for any P7 exposure | Phase 7 safe adapter or separately authorized P6 remediation |
| SEC-04 doubled P5 controller prefixes | Prerequisite | Separate Phase 5 remediation/adapter ownership P7-OD-21 |
| SEC-05 commission search cross-market | Prerequisite | Phase 5/Phase 7 market-safe adapter |
| SEC-06 commission-rate access cross-market | Prerequisite | Phase 5/Phase 7 market-safe adapter |
| SEC-07 commission adjustment controller unreachable | Do not claim capability; decide remediation | Separate Phase 5 authorization P7-OD-21 |
| SEC-08 unsafe agent activation path | Block operations | Separate Phase 5 remediation |
| SEC-09 hard-coded agent currency/fee and duplicate service | Block fee/activation exposure | O-05 plus Phase 5 remediation |
| SEC-10 reward config access/idempotency/audit/overlap gaps | Block create | Separate Phase 3 integration hardening |
| SEC-11 commission generation/range conflict | Block editor | Frozen Phase 5 contract reconciliation |
| SEC-12 permission seed/decorator drift | Phase 7 prerequisite | Dedicated permission/RBAC migration and acceptance |
| SEC-13 client-controlled market context | Phase 7 core scope | Server-authorized selector and per-request enforcement |
| SEC-14 wallet idempotency lacks payload hash | Included in SEC-01 remediation | Separate compliant wallet command |
| SEC-15 redemption rate idempotency/cancel conflict | Block unsafe operations | Phase 6 adapter/remediation |
| SEC-16 generic audit redaction insufficient | Phase 7 core scope | Deny-by-default viewer projection |
| SEC-17 fabricated reward-job rows | Remove from operational truth; replace adapter | Phase 3 read integration authorization |
| SEC-18 20-row dashboard counts | Phase 7 core scope | Server aggregate API |
| SEC-19 scheduler uniqueness/timing ambiguity | Not fixed by UI; blocks precise claims | Separate Phase 3 authorization/contract clarification |
| SEC-20 incomplete audit viewer evidence/audit-of-audit | Phase 7 core scope | Viewer/capture policy and acceptance tests |

Additional controls: mandatory MFA as decided, least privilege, secure headers/CORS for actual methods, input validation, rate limiting, step-up for voucher reveal or other high-risk secrets, no offline queuing/replay of privileged writes, and no secret values in code/logs/exports.

## 29. Auditability

Every privileged write records actor, target, action, market, UTC time, market-local display time, before/after version references or safe projection, reason, result, request/correlation ID, IP and approved device/user-agent metadata, idempotency reference, and related domain record/ledger ID. Maker/Checker records both identities/timestamps and the execution outcome.

Audit writes occur in the owning transaction where practical. If a read or cross-system action cannot be atomic, the contract must make failure visible and retain correlation. Audit records are append-only and never physically deleted. Retention and sensitive-field visibility follow O-08/P7-OD-15.

## 30. UI and Design System

- Use `@ipoint/design-tokens` and `@ipoint/ui`; do not create a second token system or sample screenshots.
- Replace in-memory/hash-only navigation with a stable routed shell supporting refresh/back/deep links and route guards.
- Provide desktop side navigation and touch-friendly mobile drawer/bottom alternative; current hidden mobile navigation is unacceptable.
- Show user, role, selected market, session/logout, and permission-aware actions.
- Use typed API DTOs instead of ad hoc `JsonRecord`/casing fallbacks.
- Every applicable screen covers loading, empty, error, success, disabled, expired, suspended, permission denied, offline, retry, stale/conflict, and blocked-prerequisite states.
- PWA scope follows O-09/P7-OD-20. MVP may provide installable/read-capable responsive shell, but must never queue privileged writes offline or claim approval scope not decided.
- Accessibility acceptance includes keyboard navigation, focus recovery, semantic labels, contrast, responsive layout, and AdminApp-specific axe/browser evidence.

## 31. API integration

- Runtime paths use the application’s single `/api/v1` global prefix; doubled-prefix routes are treated as defects, not client contracts.
- Only registered controllers count as APIs; declared-but-unregistered controllers remain missing.
- Phase 7 introduces typed, documented adapters where needed, delegating to owning services and preserving domain transaction/idempotency semantics.
- Every endpoint documents actor, permission, market, input/output schema, errors, idempotency, audit, and owner.
- Generate/validate the complete registered Admin OpenAPI surface before typed client integration; current auth-focused validation is insufficient.
- Do not impersonate member/merchant actors to reuse their endpoints.
- Sensitive fields use explicit response projections; raw domain entities are not returned.

## 32. Testing and acceptance

The following 20 proposed scenarios form the draft acceptance map. They are planning evidence requirements, not current test claims.

| ID | Acceptance scenario | Contract mapping / minimum evidence |
|---|---|---|
| P7-AC-01 | Eligible active Admin completes approved MFA and enters Admin Web; ineligible/suspended Admin is denied | §§6, 28; real HTTP/DB + browser |
| P7-AC-02 | Access expiry/refresh works; forced session revocation blocks the next request and UI returns to login safely | §§6, 25; real HTTP/DB + browser |
| P7-AC-03 | Six-role approved matrix enforces least privilege; missing permission cannot be bypassed by crafted request/UI | §§5, 7; permission matrix integration |
| P7-AC-04 | Admin sees only granted markets; revoked market and arbitrary route/header market are denied server-side | §8; cross-market HTTP/DB negative tests |
| P7-AC-05 | Every write uses explicit target market and rejects resource/market mismatch atomically | §§8, 31; command integration |
| P7-AC-06 | Dashboard counts equal bounded server aggregates, show as-of/freshness, and never use page/fabricated zeros | §9; DB fixtures + browser states |
| P7-AC-07 | Member lookup/status/session/reverification/note flows reuse existing commands with masking and audit | §10; regression + browser |
| P7-AC-08 | Merchant application/KYC/status operations preserve market, idempotency, status history, and MCP | §§11, 13; regression + browser |
| P7-AC-09 | Agent operations remain blocked before prerequisite remediation; after authorization, market/actor/commission failures are correctly surfaced | §12; negative gate then owner acceptance |
| P7-AC-10 | Member and merchant KYC evidence follows approved masks/retention; unauthorized export/raw document access denied and audited | §13; privacy/security tests |
| P7-AC-11 | Reward/package/redemption/commission configuration creates prospective versions only; concurrent overlap and stale update are rejected | §§15-18, 26-27; DB/API concurrency tests |
| P7-AC-12 | Historical transaction, reward, commission, quote, order, and ledger snapshots remain unchanged after config changes | §§15-18, 24; frozen-domain regression |
| P7-AC-13 | Manual MCP request passes maker→checker→execute with different identities, exact ledger result, atomic audit, and idempotent replay | §§20-21; real DB/API + browser |
| P7-AC-14 | Same-person MCP/iPoint approval is denied at every amount, including Super Admin | §21; DB/service/API negative tests |
| P7-AC-15 | Manual iPoint endpoint/UI cannot execute until compliant workflow exists; later workflow proves request/decision/ledger atomicity and payload-hash mismatch rejection | §19; blocker test then owner acceptance |
| P7-AC-16 | Rejected/failed/retried adjustment follows approved policy and cannot duplicate ledger effects | §§19-21, 25-27; concurrency/retry tests |
| P7-AC-17 | Audit viewer enforces market, permission, allowlists, bounded filters/pagination, redaction, and audit-of-audit | §§22, 28-29; security HTTP/DB + browser |
| P7-AC-18 | Voucher secrets, credentials, tokens, KYC payloads, and internal errors never appear in viewer, export, logs, or generic API results | §§22, 25, 28; privacy/log scans |
| P7-AC-19 | Basic reports preserve market/currency and compensation semantics; cross-currency totals and Phase 9 analytics are absent | §23; aggregate fixtures + contract tests |
| P7-AC-20 | Routed responsive Admin Web passes desktop/mobile navigation, deep link, all required states, keyboard, axe, and PWA no-offline-write rules | §30; component + Playwright visual/accessibility evidence |

Acceptance also requires format, lint, typecheck, build, unit, real PostgreSQL/API integration, relevant frozen-domain regression, OpenAPI consistency, secret scan where configured, and exact evidence counts. No test may be hidden or relabelled.

## 33. Deferred scope

- Phase 8: advertising submission/review, content, banners, advertisement MCP charging.
- Phase 9: advanced reconciliation, risk cases, fraud scoring, regulatory reporting, warehouse, BI, predictive analytics.
- Phase 10: full platform cross-market E2E, broad failure recovery, total UI consistency/regression.
- Phase 11: production security/performance, distributed rate limiting, backup/restore rehearsal, monitoring, UAT/deployment.
- Phase 12: deferred-module evaluation.
- Other deferred/open items listed in §4 remain excluded unless formally promoted.

## 34. Migration expectations

P7-S0 creates **no migrations**. Future Phase 7 migrations must be forward-only, centrally numbered/coordinated, isolated by owner, tested from the accepted base, and include compatibility/recovery notes. Ledger, auth, permission, market, and Maker/Checker schema changes require dedicated commits and review.

Possible future migration needs—permission catalog, MFA/session metadata, safe adjustment workflow, audit capture fields, aggregate indexes—are proposals only. No migration may mutate historical financial/audit rows or modify a frozen domain without explicit owner authorization.

## 35. Proposed P7-S1+ breakdown

All sub-phases are **DRAFT / NOT AUTHORIZED**. Count: **10**.

| Sub-phase | Dependencies | Ownership / conflict boundary | Deliverable | Acceptance evidence |
|---|---|---|---|---|
| P7-S1 Contract decisions and architecture baseline | Bryan P7-OD decisions; Command Center review of P7-S0 | Documentation/governance only | Approved Phase 7 brief, role/permission/market/API/error/acceptance contracts | Decision traceability; no undecided item frozen |
| P7-S2 Admin identity, MFA, sessions, RBAC and market context | P7-S1; P7-OD-01/02/12/13 | Auth + platform-access owner; dedicated auth/permission migration commits | Admin eligibility, MFA, session controls, permission catalog, market selector/grants | P7-AC-01..05; security, HTTP/DB and browser evidence |
| P7-S3 Admin Web shell and typed integration foundation | P7-S2 contracts; Design System | `apps/admin-web`, shared client/types/UI only | Routed responsive shell, navigation, typed DTO client, state/error framework, PWA-safe baseline | P7-AC-20 plus component/axe/Playwright |
| P7-S4 Dashboard and bounded operational read models | P7-S2/3; metric/freshness decisions | Phase 7 read adapters; no domain writes | Market-scoped aggregates, freshness/as-of, drill-down, no fabricated counts | P7-AC-06; query-plan/bounds evidence |
| P7-S5 Member, merchant and KYC operations integration | P7-S2/3; masking decision | Phase 7 UI/adapters; reuse Phase 1/2 commands unchanged | Member/merchant/KYC queues, detail, approved actions, evidence/timelines | P7-AC-07/08/10 plus frozen regression |
| P7-S6 Market, package and commercial configuration | P7-S2/3; P7-OD-04..09; prerequisite owner remediations | One domain owner at a time; centrally coordinated migrations | Market/package UI plus safe reward/redemption/commission adapters where authorized | P7-AC-11/12; concurrency/idempotency/audit |
| P7-S7 Manual MCP and iPoint Maker/Checker | P7-S2/3; P7-OD-10/11/18/20; Phase 3 authorization for wallet | MCP existing owner; wallet workflow isolated dedicated ledger/migration commit | MCP queue/history; compliant iPoint request/decision/execute or explicit blocked state | P7-AC-13..16; atomic ledger and segregation evidence |
| P7-S8 Agent and Phase 6 operational adapters | Separate Phase 5/6 remediation decisions P7-OD-19/21 | Frozen owner work isolated from Phase 7 facade/UI | Market-safe agent queues/commands; redemption order/exception/refund views only after remediation | P7-AC-09 plus owner-specific regression/security |
| P7-S9 Audit viewer and basic reports | P7-S2; masking/export decisions; safe domain projections | Phase 7 read models; no raw export/BI | Audit viewer, audit-of-audit, bounded operational reports, optional masked export | P7-AC-17..19; redaction/privacy/performance evidence |
| P7-S10 Integration, security, accessibility and delivery evidence | P7-S2..S9 complete; no unresolved blocker in shipped scope | Verification/docs only except separately dispatched remediation | Full acceptance matrix, OpenAPI, regression, responsive/PWA evidence, delivery report | P7-AC-01..20; all applicable CI gates with exact results |

Dependency order: `S1 -> S2 -> S3`; `S4/S5` may follow in parallel only with non-overlapping owners; `S6/S7/S8` require their explicit decisions and frozen-owner gates; `S9` follows safe projections; `S10` is final verification. Database migration IDs and frozen-domain branches must be centrally coordinated.

---

## Evidence synthesized

- `P7-S0A_GOVERNANCE_AND_FROZEN_DOMAIN_AUDIT.md`
- `P7-S0B_ADMIN_BACKEND_CAPABILITY_INVENTORY.md`
- `P7-S0C_ADMIN_WEB_AUTH_RBAC_MARKET_AUDIT.md`
- `P7-S0D_GAP_MAKER_CHECKER_AUDIT_SECURITY_ANALYSIS.md`
- Governing master files and D-002 C-03, D-010, D-024, D-028 through D-045.

**Document status: DRAFT / UNDER COMMAND CENTER REVIEW / NOT IMPLEMENTATION AUTHORIZATION**
