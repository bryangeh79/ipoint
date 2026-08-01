# P7-S0D Gap, Maker/Checker, Audit and Security Analysis

> **Status: DRAFT / UNDER_COMMAND_CENTER_REVIEW / NOT_IMPLEMENTATION_AUTHORIZATION**
>
> Documentation-only planning audit. This report records repository evidence and draft Phase 7 contracts. It does not authorize implementation, change any frozen Phase 3-6 domain contract, or resolve an OPEN question.

## 1. Audit metadata

| Field | Value |
|---|---|
| Phase / task | Phase 7 Admin Operations / P7-S0D |
| Audit type | Documentation-only gap and security audit |
| Worker | Codex CLI worker |
| Date | 2026-08-01 (Asia/Kuala_Lumpur) |
| Worktree | `C:\AI_WORKSPACE\wt-p7-s0d` |
| Branch | `task/p7-s0d-gap-security-analysis` |
| Base SHA | `99c35c7c5581747a8eb8b9e6600b4489691c4fa0` |
| Repository | `https://github.com/bryangeh79/ipoint.git` |
| Governing status | DRAFT; Command Center review required |

### 1.1 Authority and scope interpretation

- `AGENTS.md`, `PROJECT_MASTER_CONTROL.md`, `DOCUMENT_AUTHORITY.md`, `OPENCLAW_OPERATING_RULES.md`, `BASELINE_ACKNOWLEDGMENT_V1.1.md`, `DECISION_LOG.md`, `OPEN_QUESTIONS.md`, `PHASE_REGISTRY.md`, and `CODEX_WORKFLOW_RULES.md` were read before analysis.
- D-002 C-03 is applied literally: Maker/Checker is mandatory only for **Manual MCP Adjustment** and **Manual iPoint Wallet Adjustment**, with no amount threshold. This report does not add Maker/Checker to ordinary configuration changes.
- Phase 6 Redemption Refund Maker/Checker is a separate frozen workflow and must not be merged conceptually or technically with either manual adjustment workflow.
- D-010 and the frozen ledger rules are treated as controlling: financial corrections are append-only exact-opposite entries; direct balance mutation is prohibited.
- D-028 through D-045 were reviewed. D-042 is treated as the controlling correction to the conflicting statement in D-041.
- O-05, O-06, O-08, O-09, and O-10 remain OPEN. This audit identifies where they block final validation ranges or operational definitions; it does not invent answers.
- P7-S0A, P7-S0B, and P7-S0C reports were used as cross-checks. Findings below were independently tied back to repository paths and identifiers where practical.

## 2. Configuration inventory (Section A)

### 2.1 Cross-cutting conclusions

1. The repository already uses version rows and effective ranges for reward rules, redemption rates, merchant package rates, special merchant percentages, and commission rates. It does **not** provide one unified configuration registry or one uniform lifecycle.
2. An authenticated administrator with the applicable management permission is currently the sole creator/proposer in most implemented paths. There is no separately approved configuration checker role. This is consistent with D-002 C-03: configuration Maker/Checker must not be inferred.
3. “Frozen” below means the earlier phase froze the financial/domain semantics. It does not mean configurable numerical values should be hard-coded or that a Phase 7 UI may rewrite historical versions.
4. Existing financial records generally snapshot a rate or reference an immutable version. A new version must affect future qualifying events only. No operation in Phase 7 should recalculate settled historical ledger entries.
5. The requested market-local `00:00` activation has only partial support. Effective timestamps and market time zones exist, but the reward scheduler polls every five minutes and the accrual calculation follows the reward plan's stored `ruleVersionId` or snapshot. That is not proof that a newly effective rule is selected exactly at market-local midnight for every existing plan.

### 2.2 Per-parameter inventory

| # | Parameter | Current storage and precision | Scope / effective semantics / history | Propose / approve / audit | Frozen impact and validation | Concurrency / stale-update risk |
|---:|---|---|---|---|---|---|
| 1 | Daily iPoint reward percentage | `reward_rule_versions.reward_rate`, `numeric(38,10)`; schema identifier `rewardRuleVersions` in `packages/database/schema/index.ts`. | `market_id` is nullable, so a market version can fall back to a global version. `effective_from` inclusive and `effective_to` nullable; rows are retained and can be archived. `RewardService` selects a time-effective market/global rule, while `JobService.calculateDailyAccrual()` uses the plan's stored rule version or package snapshot. | Current create route requires `reward.rules.manage`; `AdminRewardService.createRuleVersion()` writes `created_by`. No separate approver. `audit_logs` records `reward.rule.created`, but the rule insert and privileged audit write are not one transaction. | Phase 3 reward calculation/ledger behavior is frozen; future versions must not rewrite accrued or settled entries. DB only checks `reward_rate >= 0`; O-06 leaves final allowed range open. DTO accepts up to 10 decimals but does not establish an approved upper bound. | No exclusion constraint or row version was found for overlapping reward periods. Parallel creators can produce ambiguous active versions. No idempotency key or expected-version token exists. **High stale/overlap risk.** |
| 2 | Reward rule version schedule, effective dates, and market-local `00:00` activation | Same `reward_rule_versions` row: UTC `timestamptz` effective bounds plus market `timezone` in `markets`; scheduler queue stores `marketTimezone` and `localBusinessDate`. | History is row-based, but there is no explicit business version number or approval status. `JobSchedulerService` derives each market's local date and polls on `DAILY_JOB_INTERVAL_MS` (default five minutes), not an exact midnight trigger. Existing reward plans can remain bound to a prior `ruleVersionId`. | Same proposer and audit path as #1; no separate approver. Required future evidence: creator, effective instant, market/time zone interpretation, prior and new version IDs, correlation/request ID, and job run that consumed the version. | Phase 3 daily distribution and market-timezone semantics are frozen; a Phase 7 editor may schedule future rows only. Validation should require a valid market time zone, an unambiguous conversion of market-local `00:00` to UTC, `effective_to > effective_from`, and no overlap. | Polling plus absent overlap exclusion can make the “winning” rule dependent on ordering. Plan snapshot/version binding conflicts with a simplistic “read latest rule at 00:00” assumption. **High semantic and concurrency risk.** |
| 3 | Redemption rate by market | `redemption_rate_versions.rate_value`, `numeric(38,10)`, with `rate_type`; defined in `packages/database/schema/redemption.ts` and migration `0020_phase_6_redemption_center_canonical.sql`. | Mandatory `market_id`; inclusive `effective_from`, nullable `effective_to`; GiST exclusion prevents overlapping ranges for market/type. Migration installs update/delete rejection triggers, giving append-only history. Orders/quotes retain rate-version snapshots. | `RedemptionService.createRateVersion()` accepts admin ID and an idempotency key, but the key is not used. The discovered admin controller is not registered in `RedemptionModule`, so it is not currently reachable. No separate approver is authorized. No platform audit event was found in the create path. | Phase 6 redemption rate lock-at-submission and refund behavior are frozen. New rates affect future submissions only, never existing orders. DB requires `rate_value > 0`; the final commercial range remains governed by open/configurable policy. | DB overlap exclusion is strong, but the pre-check can race harmlessly into a constraint error. Ignored idempotency leaves duplicate non-overlapping submissions possible. The cancel path attempts to mutate immutable rows and references update columns absent from the schema. **Medium operational risk / high contract conflict.** |
| 4 | Standard merchant default packages: 2.5%, 5%, 10%, 15%, 20%, 25% | Package profiles in `merchant_service_fee_profiles`; versions in `merchant_service_fee_versions.rate`, `numeric(12,6)`. Foundation seed creates A-F at 2.5/5/10/15/20/25. | Profiles and versions may be global (`market_id` nullable) or market-scoped. Versions have effective ranges and lifecycle status (`DRAFT`, scheduled/active behavior in service). Historical assigned rate/version fields are immutable. | `merchant.package.manage` is market-scoped and currently covers creation/lifecycle actions. `PackageService.createServiceFeeVersion()` records creator and an atomic audit event; activation is a separate permissioned action but is not D-002 Maker/Checker. No separate approver is authorized. | Phase 4 transaction package snapshot and service-fee semantics are frozen. New versions affect later qualifying assignments/transactions only. DTO requires >0, <=100, up to 6 decimals. Seeded package labels and percentages are current defaults, not justification for overwriting historical rows. | Service uses transactions, row locking for lifecycle changes, idempotent operations, and overlap-conflict handling. Draft edits use expected state/locking. **Low-to-medium risk**, mainly inconsistent global-vs-market resolution and permission exposure in a future UI. |
| 5 | Special merchant percentages such as 8% and 12% | `merchant_special_percentages.percentage`, `numeric(12,6)`, with merchant, optional market, effective range, description, and creator. | Append-only special-rate rows; migration rejects updates/deletes. Effective rows are selected prospectively and transaction snapshots preserve the applied value. No fixed whitelist restricts values to package A-F, so 8%/12% are structurally supported. | `merchant.package.manage` is market-scoped. Existing package service creates the row with an idempotency key and atomic audit entry. No separate approver is authorized. | Phase 4 transaction and package snapshot behavior is frozen. Future events only. DTO validation: >0, <=100, up to 6 decimals. | Immutability and idempotency are strong; effective-range conflict behavior must remain enforced for the same merchant/market. **Low-to-medium risk.** |
| 6 | Agent activation fee | No live fee configuration column or rate-version reference exists in `agent_activations`; live activation records only market/currency and lifecycle fields. The active `domain/agent-activation/service.ts` writes a hard-coded `MYR` currency. A different, non-wired `agent-activation.service.ts` contains an interface and a `388` MY fallback. | No live market-scoped fee row, effective dates, historical fee snapshot, or version retention. O-05 leaves the activation fee/configuration unresolved. | No safe live propose/approve/audit configuration workflow exists. Maker/Checker must not be invented. Any eventual configuration authority and validation need Command Center resolution. | Phase 5 agent activation/commission semantics are frozen, but the fee value/configuration is an unresolved gap. Existing records cannot be retroactively repriced. Validation range and supported currency/market mapping are **OPEN (O-05)**. | Hard-coded currency plus duplicate service implementations create stale-assumption and wrong-market risks. No version/overlap/idempotency protection exists because the live configuration does not exist. **High risk / blocked for final contract.** |
| 7 | Agent-upgrade commission G1 fixed amount | `commission_rate_versions.rate_value`, `numeric(38,10)`, `rate_type=FIXED`, `commission_type=AGENT_UPGRADE`, generation 1; migration seeds MY `88`. | Market is a two-character code, not the platform market UUID. Effective rows are versioned and GiST exclusion prevents overlap. Commission ledger rows snapshot `rate_version_id`, `rate_snapshot`, and calculation basis. | `commission.rate.manage` creates rows with actor ID. No separate approver and no platform `audit_logs` event was found in `RateManagementService`; historical row plus creator exists. | Phase 5 posting and ledger semantics are frozen. New version affects future source events only. Service enforces non-negative, <=10 decimals, <=38 total digits; currency compatibility and a commercial maximum need explicit policy. | DB overlap exclusion protects parallel periods; no idempotency key or expected state is present. Controller does not assert actor market access. **Medium-high risk.** |
| 8 | Agent-upgrade commission G2 fixed amount | Same table/precision as #7, generation 2; migration seeds MY `38`. | Same market/effective/history behavior as #7. | Same authority/audit gap as #7. | Same frozen/future-only behavior and validation gap as #7. | Same risk as #7. |
| 9 | Member-consumption agent commission G1 percentage | `commission_rate_versions.rate_value`, `numeric(38,10)`, `rate_type=PERCENTAGE`, `commission_type=MEMBER_CONSUMPTION`; migration seeds generation 1 at `0.01`. | Market/effective history and ledger snapshots exist. However, `RateManagementService` declares this type valid only for generation 0 while posting code and seed data use generation 1/2. | `commission.rate.manage`; no separate approver; no platform audit event found. | Phase 5 commission ledger behavior is frozen. Future source events only. Generic validation allows any non-negative 38,10 value and does not impose a percentage upper bound; scale convention (fraction versus percent) must remain explicit. | Overlap exclusion is strong, but the generation contract disagreement can make legitimate seeded rates unmanageable. No idempotency or market-access assertion. **High contract/stale-configuration risk.** |
| 10 | Member-consumption agent commission G2 percentage | Same as #9; migration seeds generation 2 at `0.005`. | Same as #9. | Same as #9. | Same as #9. | Same as #9. |
| 11 | Merchant referral/recruitment commission percentage | `commission_rate_versions.rate_value`, `numeric(38,10)`, `rate_type=PERCENTAGE`, `commission_type=MERCHANT_RECRUITMENT`; migration seeds generation 1 at `0.005`. | Same market/effective/history model. Service declares generation 0 only, while seed/posting semantics use generation 1. | `commission.rate.manage`; no separate approver; no platform audit event found. | Phase 5 merchant recruitment commission and ledger behavior are frozen. Future source events only. Same generic numeric validation and missing percentage-specific upper bound. | Same generation mismatch, missing idempotency, and missing market-access assertion. **High contract risk.** |

**Configuration parameters audited: 11.**

### 2.3 Required audit evidence per parameter

| # | Required evidence for any future configuration operation |
|---:|---|
| 1 | Reward rule ID, market/global scope, old and new rate, full effective range, creator, permission, business reason, request/idempotency key, payload hash, result, and first job/plan reference that consumed it. |
| 2 | Market ID, IANA time zone, entered local date/time, resolved UTC instant, prior/new version IDs, schedule action actor/time, activation result, and job-run/local-business-date correlation. |
| 3 | Redemption rate-version ID, market, rate type/value, effective range, creator, reason, request/idempotency key and hash, constraint result, and order/quote snapshot reference when consumed. |
| 4 | Package profile/version ID, package code, market/global scope, prior/new rate and lifecycle status, bounds, creator/activator, reason, request/idempotency key, result, and later assignment/transaction version snapshot. |
| 5 | Merchant ID, special-percentage ID, market, value, bounds, description/reason, creator, request/idempotency key and hash, result, and later transaction snapshot. |
| 6 | When authorized: fee-version ID, market, currency, amount, bounds, creator, effective range, reason, request/idempotency key and hash, result, and activation record's fee snapshot. No such evidence chain exists today. |
| 7 | Commission rate-version ID, `AGENT_UPGRADE/G1`, market, currency/fixed unit convention, value, bounds, creator, reason, request/idempotency key and hash, result, and resulting commission-ledger rate snapshot. |
| 8 | Same as #7 with `AGENT_UPGRADE/G2`. |
| 9 | Commission rate-version ID, `MEMBER_CONSUMPTION/G1`, market, fraction/percentage convention, value, bounds, creator, reason, request/idempotency key and hash, result, and ledger rate/calculation snapshot. |
| 10 | Same as #9 with `MEMBER_CONSUMPTION/G2`. |
| 11 | Commission rate-version ID, `MERCHANT_RECRUITMENT` generation, market, fraction/percentage convention, value, bounds, creator, reason, request/idempotency key and hash, result, and ledger rate/calculation snapshot. |

### 2.4 Required Phase 7 configuration-control baseline (draft, not authorization)

For every future configuration editor, the minimum safe control is not universal Maker/Checker. It is:

- permission plus server-side market-access enforcement;
- append-only prospective versions, with historical rows immutable;
- a market/time-zone-aware effective timestamp displayed in both market local time and UTC;
- domain-specific decimal-string validation without JavaScript floating-point conversion;
- database-level non-overlap or row-lock protection;
- idempotency key plus payload hash for create/activate operations;
- audit event in the same transaction where technically possible, capturing actor, market, old/new version reference, request ID, reason, result, and effective range;
- no recalculation or mutation of settled records;
- explicit Command Center resolution before implementing any validation still blocked by O-05/O-06/O-08/O-09/O-10.

## 3. Manual financial adjustment analysis (Section B)

### 3.1 Shared frozen requirements

- Mandatory Maker/Checker applies at **all amounts** to Manual MCP Adjustment and Manual iPoint Wallet Adjustment only.
- Maker and checker must be distinct authenticated admin identities. Identity comes only from the auth principal, never request input.
- Neither workflow may update a balance directly. Execution must call the existing domain ledger append service inside one database transaction, with the ledger entry and request state transition committed atomically.
- A correction is a new approved request that appends an exact-opposite ledger entry referencing the original entry/request. The original entry remains immutable.
- Phase 6 Redemption Refund Maker/Checker remains a different workflow, permission set, request table, and audit chain.

### 3.2 Draft MCP adjustment contract

#### Request record

| Field | Draft contract |
|---|---|
| `adjustmentRequestId` | Server UUID; immutable public correlation identifier. |
| `targetMcpAccountId` | Existing MCP account UUID; server verifies market ownership and locks the account at execution. |
| `marketId` | Platform market UUID derived/verified against the account and actor market access; immutable. |
| `currency` | Currency derived from the MCP account/market, stored as an immutable snapshot for human audit; never trusted from free-form client input. |
| `direction` | `CREDIT` or `DEBIT`; amount remains unsigned to avoid signed-direction ambiguity. Maps only to existing `MANUAL_CREDIT` / `MANUAL_DEBIT` ledger entry types. |
| `amount` | Canonical positive decimal string, exact `numeric(38,10)` semantics; >0; no `number` conversion. Final business maximum is configurable/open, not invented here. |
| `reasonCode` | Controlled operational enum/versioned reason reference; mandatory. |
| `explanation` | Mandatory human explanation, bounded length, redacted/safe for audit display. |
| `evidenceAttachmentRef` | Optional/required by reason policy; opaque reference to approved evidence storage, never raw secret material. |
| Maker | `makerAdminId`, `madeAt`; from auth and server clock. |
| Checker | `checkerAdminId`, `checkedAt`, `checkerDecisionReason`; populated once on decision. DB and service prohibit maker = checker. |
| State | `PENDING`, `APPROVED`, `REJECTED`, `EXECUTED`, `FAILED`. A local pre-submit draft may exist in UI, but an unreviewed financial request enters the durable queue as `PENDING`. Terminal decisions are immutable. |
| Idempotency | Maker create key plus payload hash, unique in an actor/market/operation namespace. Decision and execution use distinct idempotency keys; replay returns the prior result only when payload/target match. |
| Concurrency | Maker submit/decision/execution lock the request row (`SELECT ... FOR UPDATE`) and validate expected state/version. Execution additionally locks the target MCP account through the existing ledger append boundary. |
| Execution | One transaction: lock request, revalidate distinct checker and `APPROVED`, call existing MCP append function/service, obtain immutable ledger ID, transition to `EXECUTED`, append audit event. No partial commit. |
| Failure/retry | A transient failure rolls back both ledger and request execution attempt. The request may remain `APPROVED` with a separately audited failed attempt, or transition to `FAILED` only under an explicitly defined retryable/final failure policy. Retry reuses the canonical execution key. |
| Correction | A new Maker/Checker request has `correctionOfRequestId` and `reversalOfLedgerEntryId`, identical account/market/currency/amount and opposite direction. Execution appends, never edits or deletes. |
| Audit chain | `CREATED/PENDING -> APPROVED|REJECTED -> EXECUTION_STARTED -> EXECUTED|EXECUTION_FAILED`; every event includes request ID, actor, market, timestamp, request/correlation ID, reason/result, and related immutable ledger ID when available. |

#### MCP repository comparison

| Requirement | Existing evidence | Assessment / gap |
|---|---|---|
| Durable request and immutable financial identity | `mcp_adjustment_requests` includes request/account/market/maker/type/amount/reason/evidence/status/idempotency/payload hash/ledger ID/version; migration `0006_mcp_adjustment_refund_governance.sql` blocks mutation of core financial fields. | **Compliant foundation.** Currency is derived rather than snapshotted on the request; reason is free text rather than a controlled reason code. |
| Distinct checker and one decision | `mcp_adjustment_decisions` has a unique request decision; DB trigger and `McpService.decideAdjustment()` reject same maker/checker. | **Compliant.** |
| State model | Existing states include `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `EXECUTED`. | **Gap:** no explicit `FAILED` execution state/attempt chain; naming differs from draft. Existing DRAFT may remain if its transition semantics are preserved. |
| Idempotent create | `McpService.createAdjustment()` stores idempotency key and payload hash and detects mismatched replay. | **Compliant.** Decision/execution do not expose separate client idempotency contracts; execution derives `adjustment:{requestId}`. |
| Locking and duplicate protection | Submit, decision, and execution lock the request; decision uniqueness and status checks prevent second approval; execution returns the existing result if already executed. | **Strong compliance.** Keep the DB constraints and row locks. |
| Ledger-only atomic execution | `McpService.executeApprovedAdjustment()` calls database function `append_mcp_ledger_entry`, updates the request, and records audit in one transaction. | **Compliant.** Direct balance updates remain prohibited. |
| Separation of decision and execution | `approveAdjustment()` delegates to `decideAdjustment(..., 'APPROVED')`, and the decision path proceeds to execution. A separate `executeApprovedAdjustment()` also exists. | **Gap/ambiguity:** approval and execution are coupled while a separate execution method exists. Phase 7 must expose one unambiguous retry model and must not allow a second path to bypass the canonical state/lock checks. |
| Exact-opposite correction | Ledger append-only behavior exists. | **Gap:** no explicit correction-of/reversal-of relationship and validation was found for manual MCP requests. |
| Audit chain | Privileged audit events exist for create, submit, decision, and execution in the service transaction. | **Partial:** failure-attempt/retry metadata and a dedicated correction relationship are not explicit. |

### 3.3 Draft iPoint wallet adjustment contract

#### Request record

| Field | Draft contract |
|---|---|
| `adjustmentRequestId` | Server UUID; immutable. |
| `targetWalletId` / `memberId` | Canonical existing wallet plus owner; server resolves the wallet and market, never accepts an arbitrary balance row. |
| `marketId` | Verified platform market UUID; actor must have market access. |
| `pointUnit` | Immutable unit snapshot, e.g. `IPOINT`; this is not a fiat currency. |
| `direction` | `CREDIT` / `DEBIT`; maps to the existing wallet ledger adjustment/compensation types without signed ambiguity. |
| `amount` | Positive canonical decimal string with wallet precision (currently up to 10 decimal places); >0. Debit must be checked by the existing wallet service according to frozen negative-balance rules. |
| Reason/evidence | Controlled `reasonCode`, mandatory explanation, optional/required opaque evidence reference under reason policy. |
| Maker / checker | Auth-derived IDs and server timestamps; same-person prohibition in both DB constraint/trigger and service. |
| State | `PENDING`, `APPROVED`, `REJECTED`, `EXECUTED`, `FAILED`, with immutable terminal decisions. |
| Idempotency | Create payload hash; separate decision/execution keys; canonical ledger reference derived from request ID; mismatched replay is a conflict, not a successful return. |
| Concurrency | Lock request and wallet in a deterministic order. Decision uses request status/version. Execution delegates to the existing wallet ledger service, which owns wallet row lock and balance invariant. |
| Transaction | One transaction covers approved-state revalidation, immutable wallet ledger append, derived balance effect, request transition, ledger link, and audit event. No controller/service may update `wallets.balance` directly. |
| Retry / duplicates | Roll back partial failure; retry the same approved request with the same canonical key; ledger uniqueness and request lock prevent duplicate execution/approval. |
| Correction | New request references original request and ledger entry, requires a new distinct Maker/Checker decision, and appends the exact opposite amount/direction. It never changes the original entry. |
| Audit chain | Same chain as MCP, plus wallet owner/member reference where disclosure is permitted. Audit snapshots must exclude credentials and sensitive customer material. |

#### iPoint repository comparison

| Requirement | Existing evidence | Assessment / gap |
|---|---|---|
| Durable request / decision | `AdminRewardController.adjustWallet()` exposes one POST and `AdminRewardService.adjustWallet()` immediately performs the change. No wallet adjustment request/decision record was found. | **Critical gap:** no PENDING queue, checker, rejection, decision uniqueness, or durable Maker/Checker relationship. |
| Same-person prohibition | Only one actor participates. | **Critical gap:** frozen D-002 C-03 is not met. |
| Ledger reuse | The path locks the wallet, updates its balance, and inserts a wallet ledger row in one service transaction. | **Partial atomicity, but contract gap:** Phase 7 must call the existing wallet ledger append service boundary; the admin path must not own a direct balance update. |
| State / failure / retry | No request lifecycle; success is immediate. | **Critical gap:** no Pending/Approved/Rejected/Executed/Failed states or audited retry attempts. |
| Idempotency | Input has `idempotencyKey`; service returns an existing ledger row when the key already exists. | **High gap:** no payload hash comparison was found, so reuse with a different target/amount/reason can be falsely treated as success. |
| Duplicate approval / execution | Ledger key reduces duplicate inserts for the one-step operation. | **Gap:** there is no approval at all and no request lock/status/version protecting future two-person execution. |
| Correction | `compensatingEntry` can append a linked compensation in the same request and by the same actor. | **Critical gap:** a correction is not an independent Maker/Checker-approved exact-opposite request. The current optional compensation can combine original and compensation in one actor's operation. |
| Audit | One privileged audit event is recorded in the transaction. | **Gap:** no multi-actor event chain, decision reason, failed execution attempt, or correction approval chain. |

### 3.4 Notable Maker/Checker compliance gaps

1. iPoint wallet manual adjustment is currently a one-person immediate mutation path; this is the largest direct conflict with D-002 C-03.
2. The iPoint compensation option is not a compliant correction workflow because it can be initiated in the same operation by the same actor.
3. MCP has a strong request/decision/ledger foundation, but lacks an explicit FAILED/attempt model and explicit exact-opposite correction links.
4. MCP approval currently leads to execution while a separate execution method also exists; a Phase 7 contract must choose one canonical execution/retry route.
5. Neither workflow may be generalized from the separate Phase 6 Redemption Refund Maker/Checker contract.

## 4. Operational audit viewer analysis and MVP proposal (Section C)

### 4.1 Existing audit data

| Source | Existing fields / behavior | Gap for viewer |
|---|---|---|
| `audit_logs` / `auditLogs` | Actor type/ID, market ID, action, entity type/ID, before/after JSON, reason, result, request ID, IP, occurrence time. Migration installs append-only update/delete rejection. | No user-agent/device field; no dedicated Maker/Checker relationship; request IDs are not uniformly supplied; before/after safety depends on write-time key-name redaction. |
| `security_events` / `securityEvents` | Account ID, event type, result, IP, user agent, request ID, metadata, occurrence time. | Separate from privileged audit records; no resource type/ID, market, before/after, or stable actor snapshot in the same shape. |
| `entity_timelines` / `entityTimelines` | Entity type/ID, action, actor, market, summary, metadata, occurrence time. | Designed as an entity activity stream, not a complete security audit record; result, request ID, IP/device, and before/after are not first-class. |
| `AuditService` | Resolves market access for privileged writes/queries, redacts sensitive keys recursively, writes `audit_logs` and `entity_timelines`, and queries by entity type/ID with a limit. | No general filtered/paginated operations viewer; no audit-of-audit-view event; query returns stored rows without a second resource-specific field allowlist. |
| Domain request/decision tables | MCP adjustment, redemption refund, merchant package/version, KYC, and other domains hold richer lifecycle fields. | Maker/Checker relationship often must be joined/derived; there is no unified operational projection. |

### 4.2 MVP viewer proposal

The MVP should be a read-only, server-filtered operational viewer over a safe projection, not direct generic access to JSON blobs.

| Viewer field | Exists now? | MVP handling |
|---|---|---|
| Actor | Yes in `audit_logs`; account identity in `security_events` | Show stable actor ID/type and only approved display identity fields. |
| Action | Yes | Exact action code plus safe display label. |
| Resource type / ID | Yes in `audit_logs`; partial elsewhere | Filterable; link only to authorized admin routes. |
| Market | Yes in privileged audit; missing in some security events | Mandatory server-side market filter. Super Admin cross-market access must still be explicit and auditable. |
| Before / after | Yes where writers provide it | Show only for allowlisted resource/field pairs and authorized permission. Default hidden. Never render arbitrary JSON unfiltered. |
| Request ID | Schema exists | Capture consistently at the request boundary; show/copy as correlation ID. |
| Timestamp | Yes | Show UTC and selected-market local time. |
| IP | Available in both audit sources where captured | Mask or restrict based on permission and retention policy. |
| User agent / device | User agent exists only in `security_events`; device is absent | Add normalized user-agent/device capture only if privacy/retention policy approves it. Do not infer a trustworthy device identity from user-agent text. |
| Success / failure | `result` exists | Normalize result values and include safe failure code, not stack trace/internal error. |
| Reason | Exists in `audit_logs` | Show bounded, sanitized explanation/reason code. |
| Maker / Checker | Not a common audit field | Derive from request/decision tables and display both IDs/timestamps plus same-person validation result. A future projection may capture `relationshipType` and related actor IDs. |

MVP filters: time range, selected market, actor, action, resource type/ID, request ID, result, and Maker/Checker state. Default date ranges and bounded cursor pagination are required. Export, advanced analytics, regulatory reports, and enterprise retention/search infrastructure are excluded.

### 4.3 Sensitive-data controls

- Never expose passwords, secrets, tokens, cookies, credentials, hashes, OTP/recovery/verification codes, private keys, payment credentials, KYC document payloads, encrypted voucher values, voucher ciphertext/IV/auth tags, or decryption material.
- The current redaction regex in `platform-access/audit-redaction.ts` covers common credential key suffixes but does not explicitly cover voucher/ciphertext/encryption/KYC field names. A viewer must apply a second, deny-by-default field projection and domain-specific allowlists.
- Before/after JSON must be rendered as text, never injected as HTML. Large/nested data must be truncated safely.
- Audit-view access itself should generate an audit event with actor, filters (without sensitive values), market scope, request ID, result, and export flag.
- Authorization and market scope must be enforced in the API query; UI hiding is not a security boundary.

## 5. Dashboard and report feasibility (Section D1)

### 5.1 Current-state conclusion

The current Admin overview is not an aggregate dashboard. `AdminApp` fetches the first merchant page with `pageSize=20` and derives status counts/client metrics from those rows. P7-S0B and P7-S0C correctly flag that behavior. No repository evidence supports treating those values as platform totals.

### 5.2 Feasibility matrix

| Requested metric/view | Existing source / service | What Phase 7 would need | Feasibility / caveat |
|---|---|---|---|
| Active members | Member/account status and `AdminMemberService.listMembers()` exist. | Market-scoped aggregate count query and an approved definition. If “active” means recent activity, O-10 blocks the final rule; if it means status `ACTIVE`, label it explicitly. | Technically straightforward; definition-sensitive. |
| Active merchants | Merchant status plus `AdminMerchantService` list/search exist. | Server aggregate by selected market/status, independent of pagination. | Straightforward. Current 20-row UI count is invalid as a total. |
| Active agents | `agent_activations` holds lifecycle status; agent services exist, with duplicate live/dead implementations. | One canonical market-safe query adapter and aggregate. Resolve O-05/hard-coded currency issue before exposing fee-related detail. | Feasible after canonical-service clarification. |
| Pending KYC reviews | Merchant KYC/review and member KYC review tables/services exist. | Aggregate separate merchant/member queues by market and permission, with explicit status mappings and drill-down. | Feasible; do not merge different review authorities silently. |
| Pending Maker/Checker requests | MCP adjustment request status exists; redemption refund requests have separate Phase 6 workflow; wallet MC request does not exist. | Read-only union/projection preserving workflow type and permissions. Wallet count remains unavailable until its frozen-compliant request model exists. | Partial only. Never combine permission/approval actions. |
| MCP balance warnings | MCP accounts/ledger/balance and reconciliation service exist. | Market-scoped balance query plus configurable warning thresholds and currency-aware display. No cross-currency total. | Data feasible; warning policy/configuration not evidenced. |
| Reward-job failures | Real `daily_job_runs`, queue, retry counters, and `JobService` exist. | Replace the admin reward placeholder projection with a read-only adapter to real runs, bounded error summaries, selected market, retry state, and request/job IDs. | Feasible. Current admin endpoint fabricates completed zero-count rows from rule versions. |
| Redemption operational exceptions | Fulfilment exceptions/recovery and refund-request data/services exist. | Safe Phase 7 controller/service adapters with RBAC and market enforcement, plus separate queues for fulfilment and refund. | Feasible after security gaps are closed; existing P6 admin routes are identity-only/global. |
| Transaction totals | Transaction/read models and merchant/member transaction services exist. | Market/date/status/currency aggregates with compensation/reversal semantics and indexes verified against expected load. | Feasible as basic operational totals; not reconciliation or BI. |
| Basic commission totals | Commission ledger/query service and immutable rate snapshots exist. | Market-scoped aggregate by commission type/generation/currency/status; include correction/compensation semantics; fix route/market/generation contract gaps. | Feasible after P5 adapter hardening. No cross-currency sum. |
| Market-by-market summary | `markets`, statuses, and admin market-access mappings exist. | Server-authorized per-market aggregates; only explicitly global roles may request multiple markets, with each market kept separate and access audited. | Feasible, but P7 MVP should default to one selected market. |

### 5.3 Explicit exclusions

This draft does not propose an enterprise reporting warehouse, advanced reconciliation, fraud case management, regulatory reports, predictive analytics, advanced BI, or any Phase 9 risk workflow. It also does not authorize new financial calculation rules.

## 6. Security findings register (Section D2)

Severity is planning priority, not an acceptance decision. No secret value is reproduced in this report, and no critical exposed secret was found during this scoped inspection.

| ID | Severity | Finding | Repository evidence | Risk / required direction |
|---|---|---|---|---|
| SEC-01 | **Critical** | Manual iPoint wallet adjustment has no Maker/Checker and executes immediately. | `apps/api/src/admin-reward/admin-reward.controller.ts` (`adjustWallet`); `apps/api/src/admin-reward/admin-reward.service.ts` (`adjustWallet`); `apps/api/src/admin-reward/admin-reward.dto.ts` (`walletAdjustmentSchema`). | Direct conflict with D-002 C-03 at every amount. Phase 7 must not expose this as a compliant operations flow. |
| SEC-02 | **Critical** | Redemption refund approval credits the wallet balance but does not append the required immutable wallet ledger entry. | `apps/api/src/redemption/redemption-refund.service.ts` (`approveRefundRequest`, wallet update around the refund approval transaction); cross-check P7-S0A/P7-S0B. | Ledger/balance divergence and auditability failure in a frozen Phase 6 path. Escalate to Command Center; do not fix under P7-S0D. |
| SEC-03 | **High** | Phase 6 fulfilment exception and refund admin controllers use identity guards without permission or market-access enforcement and can query global queues. | `apps/api/src/redemption/redemption-admin-fulfilment.controller.ts`; `apps/api/src/redemption/redemption-admin-refund.controller.ts`; `apps/api/src/redemption/redemption.module.ts`. | Unauthorized or cross-market operations/data exposure. Requires a Phase 7 adapter or separately authorized frozen-domain remediation. |
| SEC-04 | **High** | P5 admin rate/commission controllers include `api/v1` inside controller paths while the application already sets global prefix `api/v1`. | `apps/api/src/app.setup.ts` (`setGlobalPrefix`); `apps/api/src/controllers/admin-rate.controller.ts` (`@Controller('api/v1/admin/commission-rates')`); `apps/api/src/controllers/admin-commission.controller.ts`. | Intended routes are likely mounted under doubled prefixes; UI/integration drift can create dead or unexpected endpoints. |
| SEC-05 | **High** | Commission admin ledger search explicitly treats admin searches as unconstrained and does not assert actor market access. | `apps/api/src/controllers/admin-commission.controller.ts` (`searchLedger`, comment and call to `adminSearch`); `apps/api/src/domain/commission/query.service.ts`. | Cross-market commission/beneficiary leakage risk. Permission alone is not market authorization. |
| SEC-06 | **High** | Commission-rate read/create endpoints accept arbitrary market codes and ID lookups without `market_access` enforcement. | `apps/api/src/controllers/admin-rate.controller.ts` (`getActiveRates`, `getRateHistory`, `getRateById`, `createRateVersion`); `apps/api/src/domain/commission/rate.service.ts`. | Cross-market reads and unauthorized configuration writes are possible for a permission-bearing restricted admin. |
| SEC-07 | **High** | `AdminAdjustmentController` defines commission Maker/Checker routes but is not registered in `CommissionModule`. | `apps/api/src/controllers/admin-commission.controller.ts` (`AdminAdjustmentController`); `apps/api/src/commission/commission.module.ts` controller list. | Apparent security/control capability is unreachable; operators may assume a protected workflow exists when it does not. |
| SEC-08 | **High** | Admin agent activation approval lacks server-side market authorization, swallows commission-posting failure, and reject/suspend paths discard the resolved admin identity. | `apps/api/src/controllers/admin-agent-activation.controller.ts`; `apps/api/src/domain/agent-activation/service.ts`; `apps/api/src/agent-activation/agent-activation.module.ts`. | Cross-market action risk, partial operational outcome, and incomplete actor/audit attribution. |
| SEC-09 | **High** | Live agent activation path hard-codes `MYR` and has no persisted fee/version snapshot; a separate non-wired service contains a `388` MY fallback. | `apps/api/src/domain/agent-activation/service.ts`; `apps/api/src/domain/agent-activation/agent-activation.service.ts`; `packages/database/schema/index.ts` (`agentActivations`); O-05. | Hard-coded market/currency assumptions and duplicate implementations can produce wrong-market financial behavior. |
| SEC-10 | **High** | Reward rule create/list paths do not assert actor market access; create has no idempotency or overlap constraint and audit is not atomic with the insert. | `apps/api/src/admin-reward/admin-reward.controller.ts`; `apps/api/src/admin-reward/admin-reward.service.ts` (`createRuleVersion`); `packages/database/schema/index.ts` (`rewardRuleVersions`). | Unauthorized market configuration, ambiguous effective rule, stale/duplicate writes, and unaudited committed change if the subsequent audit write fails. |
| SEC-11 | **High** | Commission-rate generation rules conflict with seeded/posting data, and percentage validation lacks a type-specific upper bound. | `apps/api/src/domain/commission/rate.service.ts` (`VALID_GENERATIONS`, validation); `packages/database/migrations/0018_phase_5_agent_commission_schema.sql` (seeded generations); commission posting services. | Valid configuration may be rejected or misinterpreted; an excessive percentage may pass generic validation. Requires governance clarification, not silent normalization. |
| SEC-12 | **High** | Foundation RBAC seed grants Super Admin every seeded permission, while required newer admin permission codes are missing or inconsistent. | `packages/database/seeds/foundation.ts` (permission code list and Super Admin assignment); permission decorators in admin reward, commission, agent and member/KYC controllers. | Permission drift can produce inaccessible routes or reliance on broad roles; adding codes later can silently expand Super Admin capability. |
| SEC-13 | **High** | Admin UI market selection is client-controlled/free-form persisted state; some current/future backends do not independently verify market access. | `apps/admin-web/src/admin-app.tsx` (current market/local storage and overview); P7-S0C; unsafe controllers in SEC-03/05/06/08/10. | UI-only restriction is bypassable and can amplify cross-market leakage. Server-side market derivation/authorization is mandatory. |
| SEC-14 | **Medium** | Wallet adjustment idempotency replay does not compare a payload hash. | `apps/api/src/admin-reward/admin-reward.service.ts` (`adjustWallet` existing-entry lookup); `admin-reward.dto.ts`. | Reusing a key with different wallet/amount/reason can return an unrelated prior result instead of rejecting the mismatch. |
| SEC-15 | **Medium** | Redemption rate creation accepts but ignores idempotency; cancellation attempts to update an immutable table and columns not present in the schema. | `apps/api/src/redemption/redemption.service.ts` (`createRateVersion`, `cancelRateVersion`); `packages/database/schema/redemption.ts`; `packages/database/migrations/0020_phase_6_redemption_center_canonical.sql`. | Duplicate requests and an internally contradictory cancellation contract. Current controller unreachability masks rather than resolves it. |
| SEC-16 | **Medium** | Audit redaction is key-name-regex based and does not explicitly cover encrypted voucher material; generic audit queries return stored before/after JSON. | `apps/api/src/platform-access/audit-redaction.ts`; `apps/api/src/platform-access/audit.service.ts`; voucher encrypted fields in redemption schema/migration. | A future generic viewer could disclose ciphertext/IV/auth tags or other sensitive domain data. Use deny-by-default projections and audited access. |
| SEC-17 | **Medium** | Admin reward job list is temporary fabricated operational data: it maps rule versions to `COMPLETED` jobs with zero counts instead of reading real job runs. | `apps/api/src/admin-reward/admin-reward.service.ts` (`listJobs`); `apps/api/src/daily-job/job.service.ts`; `apps/api/src/daily-job/job-scheduler.service.ts`. | Operators can miss real failures or believe nonexistent jobs succeeded. It must not power alerts or dashboard truth. |
| SEC-18 | **Medium** | Current dashboard counts are derived from only the first 20 merchants. | `apps/admin-web/src/admin-app.tsx` (overview request and local metric derivation); P7-S0B/P7-S0C. | Misleading operational totals and false assurance. Build server aggregates before labeling values as totals. |
| SEC-19 | **Medium** | Reward scheduler enqueue uses `ON CONFLICT DO NOTHING` without a demonstrated queue uniqueness constraint, while scheduler polling is not exact market-local midnight. | `apps/api/src/daily-job/job-scheduler.service.ts` (`ensureQueueSchema`, `enqueueDailyAccrualJobs`, `enqueueJob`); job-run advisory lock in same service. | Duplicate queue rows may accumulate; downstream job-run locks mitigate double posting but do not prove exact activation timing or clean operational counts. |
| SEC-20 | **Medium** | Audit viewer prerequisites are incomplete: privileged audit rows lack user-agent/device and dedicated Maker/Checker relation, correlation IDs are optional/inconsistent, and viewing audit data is not itself shown as audited. | `packages/database/schema/index.ts` (`auditLogs`, `securityEvents`, `entityTimelines`); `apps/api/src/platform-access/audit.service.ts`. | Attribution and investigation quality gaps; future viewer needs explicit capture policy and a safe projection. |

**Security findings recorded: 20 (2 Critical, 11 High, 7 Medium).**

## 7. Gap / Conflict / Technical Debt register summary

| Register ID | Type | Summary | Related evidence/findings | Disposition |
|---|---|---|---|---|
| G-01 | Gap | No compliant iPoint wallet adjustment request/decision/execution lifecycle. | SEC-01, SEC-14; Section 3.3 | Phase 7 draft contract only; implementation requires Command Center authorization. |
| G-02 | Gap | MCP adjustment lacks explicit failure-attempt and correction relationship contract. | Section 3.2 | Extend through existing MCP ledger service; do not replace it. |
| G-03 | Gap | No live versioned agent activation fee configuration. | SEC-09; O-05 | Block final commercial contract pending governance decision. |
| G-04 | Gap | No safe unified operational audit viewer/projection. | SEC-16, SEC-20; Section 4 | Phase 7 MVP candidate with strict allowlists. |
| G-05 | Gap | No true operational aggregate dashboard. | SEC-17, SEC-18; Section 5 | Build bounded market-scoped aggregate services; no BI expansion. |
| C-01 | Conflict | Redemption refund balance change lacks immutable wallet ledger entry. | SEC-02 | Command Center escalation; frozen Phase 6 remediation authorization required. |
| C-02 | Conflict | Commission generation validation says generation 0 while seed/posting uses generations 1/2. | SEC-11 | Resolve canonical Phase 5 contract before editor exposure. |
| C-03 | Conflict | Reward effective-at-midnight expectation is not equivalent to plan-bound rule-version calculation. | Parameters #1/#2; `JobService.calculateDailyAccrual()` | Command Center must confirm intended prospective plan behavior; do not reprice history. |
| C-04 | Conflict | Redemption rate cancellation attempts mutation of an append-only table. | SEC-15 | Replace conceptually with prospective superseding version only if separately authorized. |
| TD-01 | Technical debt | P5 controller routes duplicate global API prefix. | SEC-04 | Phase 7 adapter/remediation planning. |
| TD-02 | Technical debt | Multiple admin paths omit server-side market-access enforcement. | SEC-03/05/06/08/10/13 | Central market-safe query/command adapter required. |
| TD-03 | Technical debt | Dead/unregistered controllers and duplicate agent services distort capability inventory. | SEC-07/09 | Select canonical implementation before UI integration; do not delete under this task. |
| TD-04 | Technical debt | Configuration lifecycle, idempotency, audit atomicity, and validation are inconsistent by domain. | Section 2 | Standardize controls without imposing universal Maker/Checker. |
| TD-05 | Technical debt | Permission seed and route decorators have drifted. | SEC-12 | Permission inventory/migration must be separately authorized and reviewed. |
| TD-06 | Technical debt | Operational placeholders can present false success/counts. | SEC-17/18/19 | Do not use as dashboard truth. |

## 8. Evidence index

### 8.1 Governance and prior planning reports

- `AGENTS.md`
- `docs/00-master/PROJECT_MASTER_CONTROL.md`
- `docs/00-master/DOCUMENT_AUTHORITY.md`
- `docs/00-master/OPENCLAW_OPERATING_RULES.md`
- `docs/00-master/BASELINE_ACKNOWLEDGMENT_V1.1.md` — E-16, E-22, E-24 through E-30, section 8.11, ledger requirements
- `docs/00-master/DECISION_LOG.md` — D-002 C-03, D-010, D-028 through D-045 (including D-042 correction)
- `docs/00-master/OPEN_QUESTIONS.md` — O-05, O-06, O-08, O-09, O-10
- `docs/00-master/PHASE_REGISTRY.md`
- `docs/04-engineering/CODEX_WORKFLOW_RULES.md`
- `C:\AI_WORKSPACE\wt-p7-s0a\docs\06-phase-reports\p7-s0\P7-S0A_GOVERNANCE_AND_FROZEN_DOMAIN_AUDIT.md`
- `C:\AI_WORKSPACE\wt-p7-s0b\docs\06-phase-reports\p7-s0\P7-S0B_ADMIN_BACKEND_CAPABILITY_INVENTORY.md`
- `C:\AI_WORKSPACE\wt-p7-s0c\docs\06-phase-reports\p7-s0\P7-S0C_ADMIN_WEB_AUTH_RBAC_MARKET_AUDIT.md`

### 8.2 Database schema, migrations, and seed evidence

- `packages/database/schema/index.ts` — markets, security events, audit logs, entity timelines, service-fee profiles/versions, special percentages, MCP adjustment requests/decisions, reward rule versions, agent activations, commission rate versions
- `packages/database/schema/redemption.ts` — redemption rate versions and redemption operational records
- `packages/database/migrations/0000_database_foundation.sql` — append-only audit triggers
- `packages/database/migrations/0004_service_fee_package_management.sql` — special percentage and assignment immutability
- `packages/database/migrations/0006_mcp_adjustment_refund_governance.sql` — adjustment immutability and same-person checker trigger
- `packages/database/migrations/0014_phase_3_reward_and_wallet_schema.sql` — reward rule versions and reward ledger foundation
- `packages/database/migrations/0018_phase_5_agent_commission_schema.sql` — agent activation and commission rate/ledger structures and seed rates
- `packages/database/migrations/0020_phase_6_redemption_center_canonical.sql` — redemption rate exclusion and immutability
- `packages/database/seeds/foundation.ts` — package A-F defaults and permission/role seed behavior

### 8.3 API/domain evidence

- `apps/api/src/app.setup.ts`
- `apps/api/src/platform-access/audit.service.ts`
- `apps/api/src/platform-access/audit-redaction.ts`
- `apps/api/src/merchant/mcp.service.ts`
- `apps/api/src/merchant/package.service.ts`
- `apps/api/src/merchant/dto/package.dto.ts`
- `apps/api/src/reward/reward.service.ts`
- `apps/api/src/daily-job/job.service.ts`
- `apps/api/src/daily-job/job-scheduler.service.ts`
- `apps/api/src/admin-reward/admin-reward.controller.ts`
- `apps/api/src/admin-reward/admin-reward.dto.ts`
- `apps/api/src/admin-reward/admin-reward.service.ts`
- `apps/api/src/redemption/redemption.service.ts`
- `apps/api/src/redemption/redemption-refund.service.ts`
- `apps/api/src/redemption/redemption-admin-fulfilment.controller.ts`
- `apps/api/src/redemption/redemption-admin-refund.controller.ts`
- `apps/api/src/redemption/redemption.module.ts`
- `apps/api/src/domain/commission/rate.service.ts`
- `apps/api/src/domain/commission/query.service.ts`
- `apps/api/src/domain/commission/adjustment.service.ts`
- `apps/api/src/controllers/admin-rate.controller.ts`
- `apps/api/src/controllers/admin-commission.controller.ts`
- `apps/api/src/commission/commission.module.ts`
- `apps/api/src/domain/agent-activation/service.ts`
- `apps/api/src/domain/agent-activation/agent-activation.service.ts`
- `apps/api/src/controllers/admin-agent-activation.controller.ts`
- `apps/api/src/agent-activation/agent-activation.module.ts`

### 8.4 Admin web evidence

- `apps/admin-web/src/admin-app.tsx` — selected-market state, overview request, 20-row metric derivation, and client-side visibility behavior

## 9. Draft status

**DRAFT / UNDER_COMMAND_CENTER_REVIEW / NOT_IMPLEMENTATION_AUTHORIZATION**

Nothing in this report is FINAL, ACCEPTED, or FROZEN. No production code, migration, schema, test, CI workflow, decision log, phase registry, or frozen Phase 3-6 domain file was modified by P7-S0D.
