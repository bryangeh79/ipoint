# P7-S0A Governance and Frozen Domain Audit

> **Document status: DRAFT / UNDER_COMMAND_CENTER_REVIEW / NOT_IMPLEMENTATION_AUTHORIZATION**
>
> This report is a documentation-only repository audit. It does not authorize Phase 7 implementation, schema change, migration, production behavior, or modification of any Phase 3–6 frozen domain.

## 1. Audit metadata

| Field | Value |
|---|---|
| Audit | P7-S0A — Governance and Frozen Domain Audit |
| Repository | `bryangeh79/ipoint` |
| Worktree | `C:\AI_WORKSPACE\wt-p7-s0a` |
| Task branch | `task/p7-s0a-governance-frozen-audit` |
| Authorized Phase 7 branch | `phase/7-admin-operations` |
| Base SHA | `99c35c7c5581747a8eb8b9e6600b4489691c4fa0` |
| Base commit | `docs(governance): close and freeze Phase 6 under D-045` |
| Audit date | 2026-08-01 (Asia/Kuala_Lumpur) |
| Worker | Codex CLI worker |
| Method | Read-only inspection of governance documents, PRDs, contracts, schema, migrations, services, controllers, and tests |
| Scope | Phase 7 planning audit only; no implementation |

## 2. Repository governance state findings

### 2.1 Authorization and base state

1. The explicit P7-S0A command authorizes only this documentation audit. The task branch was created from the exact Phase 7 base SHA `99c35c7c5581747a8eb8b9e6600b4489691c4fa0`; repository refs show `phase/7-admin-operations` at that same SHA.
2. `docs/00-master/PHASE_REGISTRY.md` still records Phase 6 as closed/frozen and Phase 7 as not authorized. Under `docs/00-master/DOCUMENT_AUTHORITY.md`, the latest explicit Bryan/Command Center task command can authorize this narrowly scoped report, but it does not silently convert the registry into implementation authorization.
3. This report therefore cannot be treated as a Phase Brief, acceptance decision, frozen contract, implementation dispatch, or permission to repair inherited gaps.

### 2.2 Authority hierarchy and decision control

The controlling order is: Bryan's latest explicit instruction; latest ChatGPT Command Center brief/correction/acceptance; governing product PRDs; master governance documents; then lower-level engineering plans and reports. Conflicts must be escalated rather than reconciled by inventing behavior. `docs/00-master/PROJECT_MASTER_CONTROL.md`, `DOCUMENT_AUTHORITY.md`, and `OPENCLAW_OPERATING_RULES.md` also preserve the separation between Bryan as business decision owner, Command Center as architecture/acceptance authority, OpenClaw as coordinator, and Codex CLI as scoped engineering executor.

The four governance classes remain binding:

- **LOCKED:** implement exactly; Phase 7 may operate but cannot reinterpret the rule.
- **CONFIGURABLE:** values may be managed only through versioned, validated domain commands; never hard-code or overwrite history.
- **DEFERRED:** do not build production behavior in Phase 7 merely because an admin surface could expose it.
- **OPEN:** do not invent a default; retain a blocker or request a decision.

### 2.3 Phase boundaries and current restrictions

- Phase 3 wallet/reward ledger, Phase 4 transaction engine, Phase 5 agent/commission, and Phase 6 redemption behavior are inherited frozen domains under D-029, D-038, D-042, and D-045 respectively.
- Phase 7 is an operations layer. It may authenticate and authorize administrators, present read models, and submit commands to owning domains. It must not duplicate formulas, replay business logic in UI/backend admin modules, update domain tables directly, or introduce alternative ledger/transaction/order states.
- Advanced reporting/risk behavior remains outside the basic Phase 7 reporting boundary; advertising remains outside Phase 7. A read-only dashboard must not become a second settlement, commission, or redemption engine.
- No production code, migration, test, CI workflow, or frozen-domain modification is authorized by P7-S0A.

### 2.4 Git and artifact preservation rules

- Work must remain on the isolated task branch created from the authorized base and move forward only. No reset, rebase, amend, force-push, or history rewriting is permitted.
- Stage only the named report. `git add .` and `git add -A` are prohibited.
- Existing tracked changes and untracked artifacts are user/session state. They must not be deleted, cleaned, stashed, renamed, bulk-added, or repurposed.
- A later implementation task must start from an approved brief and must preserve separate review boundaries for database, ledger, authorization, permissions, and transaction-status changes.

### 2.5 Phase 7-relevant unresolved governance

| Reference | Phase 7 relevance | Required treatment |
|---|---|---|
| O-02 | Agent course verification method | Agent operations may display current state; do not invent verification automation. |
| O-05 | Market-specific agent fees | Configuration UI must wait for a locked/versioned rule contract. |
| O-06 | Reward rate minimum, maximum, and precision | Reward configuration must use current server validation; no UI-invented bounds. |
| O-08 | Market KYC, retention, and legal requirements | KYC/admin data access must be market-scoped and policy-driven. |
| O-09 | Admin PWA approval scope | Do not broaden Phase 7 web administration into an unapproved mobile/PWA approval channel. |
| O-10 | Inactive member/agent handling | Operations must not create new lifecycle or balance consequences. |
| D-042 open items | Agent reapplication; merchant/branch attribution change | Display existing facts only until separately decided. |
| D-043 OD-30 residual legal item | Final production legal terms | Preserve order-level accepted-terms evidence; production copy remains a deployment/legal dependency. |

## 3. Frozen domain boundaries — Phase 3/4/5/6

### 3.1 Phase 3 — Multi-Market Wallet and Reward Ledger

| Frozen rule | Governing document citation | Enforcing repository evidence and audit conclusion |
|---|---|---|
| One wallet per member per market | `docs/00-master/BASELINE_ACKNOWLEDGMENT_V1.1.md` L-05; `docs/00-master/DECISION_LOG.md` D-028/D-029; `docs/06-phase-reports/p3-s1/PHASE_3_WALLET_LEDGER_CONTRACT.md` §1 | `packages/database/schema/index.ts` defines the member/market unique wallet key; `packages/database/migrations/0014_phase_3_reward_and_wallet_schema.sql` creates the same uniqueness constraint; `packages/database/tests/phase3-schema.test.ts` checks the Phase 3 schema. Phase 7 must resolve the wallet by member plus market, never treat a member as having one global wallet. |
| Wallet ledger is append-only and wallet balance changes are paired with ledger entries | Baseline L-13, E-10, E-14; D-029; Wallet Ledger Contract §4 and §7; `docs/04-engineering/PHASE_3_LEDGER_INVARIANTS.md` | `apps/api/src/wallet/wallet.service.ts` performs balance projection update and ledger insert within the supplied transaction and enforces idempotency; `apps/api/src/wallet/wallet.service.spec.ts` tests these behaviors. `packages/database/schema/index.ts` omits an entry `updatedAt`, but migration `0014_phase_3_reward_and_wallet_schema.sql` does **not** install an UPDATE/DELETE immutability trigger. Service discipline is therefore material enforcement; Phase 7 direct SQL would bypass it. |
| Corrections are compensating entries; full reversal is exact-opposite and originals remain immutable | Baseline L-14 and E-04; D-029; `docs/06-phase-reports/p3-s1/PHASE_3_REVERSAL_AND_CORRECTION_SPEC.md` §1, §2, §6, §7 | `apps/api/src/wallet/wallet.service.ts` exposes append behavior rather than mutation. Phase 4 correction linkage is persisted through `correction_executions.wallet_ledger_entry_id` in `packages/database/migrations/0017_phase_4_s6_correction_requests.sql`. The Phase 3 design mentions `reversal_of`, but the implemented wallet-entry schema in `packages/database/schema/index.ts` has no such column. Phase 7 must use the owning correction command and cannot manufacture linkages. |
| Decimal arithmetic is mandatory; no binary floating-point for monetary/point calculations | Baseline E-07 and E-24; D-029; `docs/06-phase-reports/p3-s1/PHASE_3_DECIMAL_AND_CURRENCY_SPEC.md` | `packages/database/schema/index.ts` and migration `0014_phase_3_reward_and_wallet_schema.sql` use `numeric(38,10)`; `apps/api/src/reward/reward.service.ts` and `apps/api/src/daily-job/job.service.ts` use Decimal arithmetic; `apps/api/src/reward/reward.service.spec.ts` covers calculations. Admin preview/display must not recompute with JavaScript `number`. |
| Daily processing is market-local 00:00 using the market IANA timezone and a local business date | Baseline E-25 and E-30; D-029; `docs/06-phase-reports/p3-s1/PHASE_3_SETTLEMENT_AND_TIMEZONE_SPEC.md` | `apps/api/src/daily-job/job.service.ts` derives the market-local business date and uses an idempotency boundary; `apps/api/src/daily-job/job.service.spec.ts` and `apps/api/src/__tests__/timezone.integration.spec.ts` cover timezone behavior. Phase 7 may show schedules/status, not run a second UTC-based accrual calculation. |
| Reward rules are versioned configuration; manual iPoint adjustment requires controlled operations | Baseline L-16; D-029; Wallet Ledger Contract §6; Admin PRD §9.2 and §12 | Reward-rule commands exist in `apps/api/src/admin-reward/admin-reward.controller.ts` and `apps/api/src/admin-reward/admin-reward.service.ts`. However, the current `POST admin/rewards/wallets/:id/adjustment` service path applies a one-step wallet adjustment and does not implement the required Maker/Checker approval. **No compliant Phase 7 manual-iPoint command surface is currently evidenced.** It must be blocked pending separately authorized remediation, not exposed as compliant and not replaced with direct DB mutation. |

### 3.2 Phase 4 — Transaction Engine

| Frozen rule | Governing document citation | Enforcing repository evidence and audit conclusion |
|---|---|---|
| Confirmation is atomic across transaction, MCP, wallet/reward, audit, and dispatch/outbox effects | Baseline L-10, E-05 and E-10; D-030 P4-D13..D22; D-031; D-038; Admin PRD §11 | `apps/api/src/transaction/transaction.service.ts` runs the confirm path in one database transaction, uses locks, writes the transaction, delegates MCP and reward writes, records audit, and emits the dispatch/outbox effect. `apps/api/src/transaction/__tests__/transaction-preview.integration.spec.ts` covers commit/rollback and atomicity. Phase 7 may invoke the existing transaction command or read its result; it cannot reproduce the write sequence. |
| Idempotency and concurrency controls are mandatory | D-030 P4-D23..D24; D-032; D-038; Baseline E-06 | `packages/database/migrations/0015_phase_4_transaction_schema.sql` creates idempotency records/constraints; `apps/api/src/transaction/transaction.service.ts` checks idempotency and uses advisory locking; `apps/api/src/transaction/__tests__/transaction-preview.integration.spec.ts` covers idempotent retry and concurrency. Any admin retry must carry the original command/idempotency semantics. |
| Receipt and transaction records/snapshots are unique and immutable | Baseline L-11 and E-27; D-030 P4-D01..D06/P4-D25..D29; D-038; Admin PRD §11 | Migration `0015_phase_4_transaction_schema.sql` creates receipt uniqueness, snapshot checks, and immutability triggers for transactions and associated financial/audit rows; `packages/database/schema/index.ts` maps those structures; transaction integration tests verify receipt integrity. Phase 7 edits to completed transactions or receipt fields would violate the frozen contract. |
| Reversal/correction preserves originals, uses exact compensating effects, and rejects partial transaction reversal | Baseline L-12 and E-04; D-035; D-038; `docs/06-phase-reports/p4-s8/P4-S8_DELIVERY_REPORT.md` P4-D30..D36 | `packages/database/migrations/0017_phase_4_s6_correction_requests.sql` creates immutable correction request/execution records and constrained status transitions; `apps/api/src/transaction/transaction-correction.service.ts` orchestrates correction; `apps/api/src/transaction/__tests__/transaction-correction.acceptance.integration.spec.ts` checks partial-refund rejection, exact-once compensation, and unchanged originals. P4 leaves platform-admin execution to a later surface, so Phase 7 must call an authorized correction service/API once exposed and must not update transaction or ledger tables directly. |

### 3.3 Phase 5 — Agent and Commission

| Frozen rule | Governing document citation | Enforcing repository evidence and audit conclusion |
|---|---|---|
| Agent activation requires the frozen lifecycle gates: KYC level, payment, course completion, and admin approval | D-039; corrected final decision D-042; `docs/05-phase-contracts/P5-S0-AGENT-COMMISSION-ENGINE-CONTRACT.md` §4; Baseline §8.10 | `packages/database/migrations/0018_phase_5_agent_commission_schema.sql` and `packages/database/schema/index.ts` persist activation state; `apps/api/src/domain/agent-activation/agent-activation.service.ts` owns transitions; `apps/api/src/controllers/admin-agent-activation.controller.ts` exposes approve/reject/suspend/reactivate/deactivate commands; `apps/api/src/domain/agent-activation/agent-activation.service.spec.ts` verifies lifecycle rules. O-02 remains open, so Phase 7 cannot invent the course-verification method. |
| Referral/merchant attribution is persisted evidence, not an editable reporting label | D-040 and D-042; Phase 5 Contract §5; D-042 open attribution-change item | Migration `0018_phase_5_agent_commission_schema.sql` and `packages/database/schema/index.ts` establish merchant attribution uniqueness; `apps/api/src/__tests__/c-merchant-attribution.integration.spec.ts` tests attribution. No approved reassignment behavior is evidenced; Phase 7 must display attribution and block direct reassignment. |
| Only three commission sources exist: agent upgrade, member consumption, and merchant recruitment | Baseline D-07/E-28; D-042; Phase 5 Contract §7, §9 and Appendix A | `packages/database/schema/index.ts` constrains commission type to `AGENT_UPGRADE`, `MEMBER_CONSUMPTION`, and `MERCHANT_RECRUITMENT`; migration `0018_phase_5_agent_commission_schema.sql` creates the same contract. Owning services are `apps/api/src/domain/commission/agent-upgrade.service.ts`, `member-consumption.service.ts`, and `merchant-recruitment.service.ts`; integration evidence includes `apps/api/src/__tests__/b-transaction-commission.integration.spec.ts`. |
| Upgrade and member-consumption commissions support only G1/G2; merchant recruitment is one generation; no five-level reward implementation | Baseline D-07; D-042; Phase 5 Contract §9 and §28 | `packages/database/schema/index.ts` and migration `0018_phase_5_agent_commission_schema.sql` constrain generation values to `0`, `1`, or `2`; the three source services implement the corresponding boundaries. There is no five-level commission type/generation in the frozen schema. Phase 7 must not create five-level configuration fields, reports, or implied payouts. |
| Commission rates are versioned and snapshotted; parameter changes are forward-looking | D-042; Phase 5 Contract §10 and Appendix A; Admin PRD §9.6 | `apps/api/src/controllers/admin-rate.controller.ts` and `apps/api/src/domain/commission/rate.service.ts` expose active/history/create/schedule operations; migration `0018_phase_5_agent_commission_schema.sql` persists rate versions and snapshot data. Phase 7 may call these commands with permission and audit evidence; it cannot overwrite historical rates or recalculate settled entries. |
| Commission correction uses immutable exact-opposite compensation and domain Maker/Checker | D-042; Phase 5 Contract §14 and §18 | `apps/api/src/domain/commission/compensation.service.ts` creates the opposite entry without updating the original and enforces atomic/idempotent behavior; `apps/api/src/domain/commission/compensation.service.spec.ts` and `apps/api/src/__tests__/d-correction-compensation.integration.spec.ts` test it. Migration `0018_phase_5_agent_commission_schema.sql` supplies immutable ledger and adjustment-approval structures. Phase 7 must use the commission adjustment command, never write ledger rows itself. |

### 3.4 Phase 6 — Redemption Center

| Frozen rule | Governing document citation | Enforcing repository evidence and audit conclusion |
|---|---|---|
| Catalog is platform-owned | D-043 OD-01; D-045; `docs/06-phase-contracts/P6-S0-REDEMPTION-CENTER-CONTRACT.md` §46 OD-01; Admin PRD §14.2 | `packages/database/migrations/0020_phase_6_redemption_center_canonical.sql` constrains ownership to `PLATFORM_OWNED`; `packages/database/schema/redemption.ts` maps the catalog. Phase 7 merchant operations cannot create merchant-owned redemption inventory. |
| Confirmation performs direct atomic wallet debit; there is no point reservation | D-043 OD-05; D-045; Phase 6 Contract §46 OD-05; Baseline E-26 | `apps/api/src/redemption/redemption.service.ts` creates the order, inventory change, wallet debit, shipping binding, and terms evidence in a DB transaction; migration `0020_phase_6_redemption_center_canonical.sql` has no reservation table. `apps/api/src/redemption/redemption-p6-atomicity.spec.ts` and `redemption-concurrency.spec.ts` cover atomic/concurrent behavior. Phase 7 must not add reserve/release states. |
| Redemption rate is versioned and locked into the quote | D-043 OD-22; D-045; Phase 6 Contract §46 OD-22; Admin PRD §9.4 | Migration `0020_phase_6_redemption_center_canonical.sql` creates immutable rate versions and quote snapshot fields; `apps/api/src/redemption/redemption.service.ts` resolves the applicable rate and stores the quote snapshot; `apps/api/src/redemption/redemption-integration.spec.ts` exercises quotation/confirmation. Admin rate changes must be new versions and must not alter an existing quote/order. |
| Only full refund is allowed; member cancellation after confirm is prohibited | D-043 OD-11/OD-12/OD-17; D-045; Phase 6 Contract §46 OD-11, OD-12 and OD-17 | `packages/database/migrations/0020_phase_6_redemption_center_canonical.sql` creates refund-request Maker/Checker structures; `apps/api/src/redemption/redemption-refund.service.ts` and `apps/api/src/redemption/redemption-admin-refund.controller.ts` expose refund workflow; `apps/api/src/redemption/redemption-refund.checkpointE.spec.ts` checks approval controls. No member post-confirm cancellation command is evidenced. **Runtime gap:** the refund service marks the request/order completed/refunded but contains a placeholder comment instead of inserting the required `REDEMPTION_REFUND` wallet entry and restoring the wallet projection. Tests do not prove a successful wallet credit. Phase 7 refund execution must be blocked from production use until a separately authorized Phase 6 remediation closes this gap; direct DB repair is prohibited. |
| Shipping payment is bound to the order and recovery is controlled/idempotent | D-043 OD-07; D-045; Phase 6 Contract §46 OD-07 | Migrations `0025_phase_6_shipping_terms_constraints.sql` and `0026_phase_6_shipping_recovery_v2.sql` add binding/recovery constraints; `apps/api/src/redemption/redemption.service.ts` validates payment binding and recovery; `apps/api/src/redemption/redemption-shipping-market-commission.spec.ts` tests market/shipping boundaries. The same service currently returns a hard-coded default shipping fee of `10.00` where the contract calls for configuration; Phase 7 must not copy or legitimize that value as a configuration source. |
| Voucher secrets are encrypted; lookup/evidence uses a hash | D-043 OD-24; D-045; Phase 6 Contract §46 OD-24 | Migration `0020_phase_6_redemption_center_canonical.sql` persists encrypted voucher data and hash with immutability protections; `apps/api/src/redemption/redemption-fulfilment.service.ts` uses AES-256-GCM and SHA-256; `apps/api/src/redemption/redemption-fulfilment.service.spec.ts` and `redemption-security-privacy.spec.ts` cover custody/privacy. Phase 7 must never expose ciphertext/plaintext in logs, exports, or the generic audit viewer. |
| Accepted terms evidence is stored at order level | D-043 OD-30; D-045; Phase 6 Contract §46 OD-30 | Migrations `0025_phase_6_shipping_terms_constraints.sql` and the redemption schema store order-level terms version/evidence; `apps/api/src/redemption/redemption.service.ts` writes it during confirmation. Production legal copy remains a deployment/legal dependency, but Phase 7 must preserve and display immutable evidence rather than a mutable current-terms link. |
| Redemption generates no commission | D-043 OD-29; D-045; Phase 6 Contract §46 OD-29 | `apps/api/src/redemption/redemption.service.ts` has no Phase 5 commission-write dependency; migration `0020_phase_6_redemption_center_canonical.sql` defines no redemption commission artifact; `apps/api/src/redemption/redemption-shipping-market-commission.spec.ts` guards the boundary. Phase 7 must not add redemption commission configuration or reporting as earned commission. |

## 4. Phase 7 touchpoint analysis

| Capability | Frozen domain | Classification | Existing service/API to call | Direct-DB risk | Audit/authz boundary |
|---|---|---|---|---|---|
| Admin auth/session | Platform access; all domains transitively | Command-based session lifecycle plus read-only session state | Generic auth controller/service (`apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.service.ts`) for login/refresh/logout | Direct session/admin-user writes bypass credential, expiry, revocation, and audit controls | Dedicated admin eligibility; session revocation; Admin PRD §5.3 2FA/session requirements. Current repository evidence does not establish an admin-specific 2FA/session-management API, so this is an implementation prerequisite. |
| Admin user/role/permission management | Platform access | Command-based | `apps/api/src/platform-access/access-administration.service.ts` for role and market grants/revokes; no controller/API was evidenced | Direct writes can grant orphaned/cross-market authority without service audit | Maker identity, target admin, role, market, before/after, reason; least privilege and `admin.manage`. An authorized API surface is required before UI integration. |
| Multi-market context | Wallet, transaction, commission, redemption, KYC | Read-only context selection | `apps/api/src/platform-access/rbac.guard.ts`, `rbac.service.ts`, and market access records; route market or `x-market-id` | Querying without enforced market predicate leaks tenant/customer data | Role + market + action on every request; no client-only filtering; context changes logged where sensitive. |
| Dashboard | Phase 1–6 read models | Read-only | Compose approved domain query endpoints; no dedicated dashboard aggregate API was evidenced | Cross-table SQL risks leakage, inconsistent state, and recreated business metrics | `dashboard.view`, market scope, safe aggregation, freshness/as-of timestamp; no write action hidden in dashboard cards. |
| Member operations | Member lifecycle and Phase 3 wallet visibility | Read-only plus existing member commands | `apps/api/src/admin-member/admin-member.controller.ts` and `.service.ts` | Direct edits may bypass lifecycle, KYC, market, and audit rules | Per-action permission, market boundary, reason and before/after audit; wallet is read-only here. |
| Merchant operations | Merchant lifecycle, packages, attribution, Phase 4 transaction access | Read-only plus existing merchant commands | `apps/api/src/merchant/merchant.controller.ts` and `.service.ts` | Direct mutation may alter onboarding, attribution, status, or transaction eligibility inconsistently | Market scope, command permission, reason/evidence; attribution reassignment remains blocked/open. |
| Agent operations | Phase 5 activation and attribution | Command-based | `apps/api/src/controllers/admin-agent-activation.controller.ts` → `agent-activation.service.ts` | Direct state update skips KYC/payment/course/transition validation | Specific approve/reject/suspend/reactivate/deactivate permission, reason, actor, transition audit; O-02/O-10 unresolved behavior remains blocked. |
| KYC review | Member/merchant onboarding; market legal policy | Command-based review plus read-only evidence | `apps/api/src/admin-kyc/admin-kyc.controller.ts`/`.service.ts`; merchant KYC review routes in `merchant.controller.ts` | Direct status update bypasses reviewer, evidence, transition, and tenant controls | Reviewer permission, market scope, reason/evidence, immutable timeline; retention/export limited by O-08 policy. |
| Reward rate management | Phase 3 reward calculation | Configuration-based, versioned | Reward-rule commands in `apps/api/src/admin-reward/admin-reward.controller.ts`/`.service.ts` | Overwriting active/history rows changes past/future economics and may bypass precision validation | `reward.rule.manage`, market scope, effective time, before/after, reason; server validation governs O-06 limits. |
| Redemption rate management | Phase 6 quote/order snapshots | Configuration-based, versioned | `apps/api/src/redemption/admin-redemption.controller.ts` → `apps/api/src/redemption/redemption.service.ts` | Updating a rate/quote/order row can retroactively change locked value | Dedicated rate permission, market/effective-time scope, append-only version audit; existing quotes/orders never mutate. |
| Merchant package management | Merchant onboarding and Phase 5 recruitment inputs | Configuration-based | `apps/api/src/merchant/package.controller.ts`/`.service.ts` | Direct row edits bypass version/effective-date and commercial validation | Package-manage permission, market, effective date, reason, before/after; settled transactions/commissions remain untouched. |
| Special package percentage | Merchant package economics; commission input | Configuration-based | Existing merchant package service/API only where its validated contract supports the field | Direct updates can create an invalid percentage or retroactively affect commission | Enforce D-010 (`> 0%` and `<= 100%`), market/effective version, authorization and audit; do not hard-code. |
| Commission parameter management | Phase 5 commission engine | Configuration-based, versioned | `apps/api/src/controllers/admin-rate.controller.ts` → `apps/api/src/domain/commission/rate.service.ts` | Direct overwrite can change history/snapshots or introduce forbidden levels/sources | `commission.rate.manage`, market/source/generation scope, schedule/effective time, reason, before/after; only frozen types and G1/G2 boundaries. |
| Manual wallet (iPoint) adjustment | Phase 3 wallet ledger | Command-based; Maker/Checker required | Existing one-step admin-reward adjustment is **not compliant evidence** for Phase 7 use; no compliant command API currently exists | Critical: direct balance/entry writes break paired atomicity, idempotency, compensation, and approval | Separate maker and checker, segregation of duties, market/wallet scope, amount/reason/evidence/idempotency, immutable audit. Block until authorized compliant command path exists. |
| Manual MCP adjustment | Merchant MCP ledger | Command-based; Maker/Checker | `apps/api/src/merchant/mcp.controller.ts`/`.service.ts`; persistence in `packages/database/migrations/0002_phase_1_merchant_package_mcp.sql` | Critical: direct balance/ledger mutation bypasses approval and immutable MCP history | Separate maker/checker, permission and market scope, reason/evidence, idempotency, before/after and immutable audit. |
| Maker/Checker workflow | MCP, iPoint, Phase 5 commission adjustment, Phase 6 refund | Command-based orchestration per owning domain | Use each domain's existing workflow: MCP service; Phase 5 commission adjustment/compensation; Phase 6 refund service after its runtime gap is remediated | A generic approval table or DB update can approve the wrong aggregate or bypass domain revalidation | No self-approval; checker revalidates current aggregate/version; explicit reject/expire states; immutable actor/time/reason. Do not create one workflow that writes all domains. |
| Audit viewer | All domains | Read-only | `apps/api/src/platform-access/audit.controller.ts`/`.service.ts` | Raw SQL/export can leak cross-market PII, secrets, vouchers, or internal errors | `audit.view`, market scope, field redaction, pagination/export controls, access audit; never reveal voucher plaintext/ciphertext or secrets. |
| Basic reports | Phase 1–6 read models | Read-only | Approved list/query APIs per domain; no dedicated consolidated reporting service was evidenced | Reporting replicas/SQL can reinterpret ledger states, double-count compensations, or cross markets | Market-scoped, reproducible filters, as-of timestamps, export audit/redaction. Advanced analytics/risk belongs to later scope. |
| Phase 1–6 admin integration | All inherited domains | Read-only, command-based, or configuration-based according to owner | Route only to existing owning controller/service APIs identified above | Highest risk if an admin “integration” becomes an alternate write path | Central authn/RBAC/market context plus domain-specific permission, validation, idempotency, Maker/Checker, and audit. No copied formulas or cross-domain table writes. |

## 5. Phase 7 operating rules for frozen domains

1. **Own the administration experience, not the domain truth.** Phase 7 may provide navigation, forms, queues, timelines, and read models. The owning Phase 1–6 service remains the only writer of its aggregate.
2. **Every mutation is a command.** A Phase 7 endpoint must authenticate, authorize role + market + action, validate input, call the owning service, preserve its transaction/idempotency rules, and record audit evidence. Controllers must not issue domain-table updates.
3. **No direct database mutation.** Direct writes to wallet, wallet ledger, MCP ledger, transaction, receipt, commission, redemption order/rate/refund, KYC, or attribution tables violate or risk violating frozen contracts. Read queries must still use approved repositories/read services and enforced market predicates.
4. **Configuration is append/version/schedule, not edit-in-place.** Reward, redemption, package, special-percentage, and commission changes require server-side bounds, an effective time, immutable history, and snapshot preservation.
5. **Maker/Checker is domain-specific.** Separate actors, prevent self-approval, revalidate at approval time, and let the owning domain execute atomically. A generic Phase 7 approval record cannot substitute for the MCP, wallet, commission, or redemption contract.
6. **Read models do not recompute financial truth.** Dashboard/report/UI code must display server-derived amounts and states, including compensating entries, and must not recalculate Decimal formulas or reinterpret local business dates.
7. **Original financial records stay immutable.** Corrections create linked compensating records. Phase 7 must never offer “edit transaction,” “edit ledger,” “edit receipt,” “edit settled commission,” or “edit confirmed redemption” actions.
8. **Market scope is server-enforced.** The selected market is context, not authorization. Every request must independently enforce the administrator's market grant; exports and audit views follow the same rule.
9. **Sensitive evidence is minimized and redacted.** Audit/reporting must not expose secrets, credentials, voucher material, private keys, or unrestricted KYC data. Access to sensitive records is itself auditable.
10. **Open/deferred behavior remains blocked.** Phase 7 screens must not resolve O-02/O-05/O-06/O-08/O-09/O-10, attribution changes, agent reapplication, five-level rewards, member post-confirm cancellation, or advanced Phase 9 reporting through UI defaults.
11. **Inherited gaps require separate authorization.** The non-Maker/Checker iPoint adjustment path, incomplete redemption refund wallet credit, missing admin-specific 2FA/session management surface, missing access-administration controller, and hard-coded redemption shipping default are findings—not permission for this task or Phase 7 to modify frozen code.
12. **Acceptance needs end-to-end evidence.** Later Phase 7 delivery must prove RBAC/market isolation, command routing, idempotency, audit completeness, Maker/Checker segregation, immutable originals, and no direct DB bypass with targeted integration/acceptance tests.

## 6. Evidence index

### 6.1 Governance and product authority

- `AGENTS.md`
- `docs/00-master/PROJECT_MASTER_CONTROL.md`
- `docs/00-master/DOCUMENT_AUTHORITY.md`
- `docs/00-master/OPENCLAW_OPERATING_RULES.md`
- `docs/00-master/BASELINE_ACKNOWLEDGMENT_V1.1.md`
- `docs/00-master/DECISION_LOG.md` (especially D-028 through D-045)
- `docs/00-master/PHASE_REGISTRY.md`
- `docs/00-master/OPEN_QUESTIONS.md`
- `docs/04-engineering/CODEX_WORKFLOW_RULES.md`
- `Concept/iPoint_Admin_PRD_V1.0_Full_Official_Edition.docx` (§3.2, §4.2, §5, §6–§14, §17–§19 and D-01..D-16)

### 6.2 Phase 3 evidence

- `docs/06-phase-reports/p3-s1/PHASE_3_WALLET_LEDGER_CONTRACT.md`
- `docs/06-phase-reports/p3-s1/PHASE_3_REVERSAL_AND_CORRECTION_SPEC.md`
- `docs/06-phase-reports/p3-s1/PHASE_3_DECIMAL_AND_CURRENCY_SPEC.md`
- `docs/06-phase-reports/p3-s1/PHASE_3_SETTLEMENT_AND_TIMEZONE_SPEC.md`
- `docs/04-engineering/PHASE_3_LEDGER_INVARIANTS.md`
- `packages/database/schema/index.ts`
- `packages/database/migrations/0014_phase_3_reward_and_wallet_schema.sql`
- `apps/api/src/wallet/wallet.service.ts`
- `apps/api/src/wallet/wallet.service.spec.ts`
- `apps/api/src/reward/reward.service.ts`
- `apps/api/src/reward/reward.service.spec.ts`
- `apps/api/src/daily-job/job.service.ts`
- `apps/api/src/daily-job/job.service.spec.ts`
- `apps/api/src/__tests__/timezone.integration.spec.ts`
- `packages/database/tests/phase3-schema.test.ts`
- `apps/api/src/admin-reward/admin-reward.controller.ts`
- `apps/api/src/admin-reward/admin-reward.service.ts`

### 6.3 Phase 4 evidence

- `docs/06-phase-reports/p4-s8/P4-S8_DELIVERY_REPORT.md`
- `packages/database/migrations/0015_phase_4_transaction_schema.sql`
- `packages/database/migrations/0016_phase_4_s3_audit_idempotency_nullable.sql`
- `packages/database/migrations/0017_phase_4_s6_correction_requests.sql`
- `packages/database/schema/index.ts`
- `apps/api/src/transaction/transaction.service.ts`
- `apps/api/src/transaction/transaction-confirmation-reward.writer.ts`
- `apps/api/src/transaction/transaction-commission-dispatch.writer.ts`
- `apps/api/src/transaction/transaction-correction.service.ts`
- `apps/api/src/transaction/__tests__/transaction-preview.integration.spec.ts`
- `apps/api/src/transaction/__tests__/transaction-correction.acceptance.integration.spec.ts`
- `apps/api/src/transaction/__tests__/transaction-hardening.spec.ts`

### 6.4 Phase 5 evidence

- `docs/05-phase-contracts/P5-S0-AGENT-COMMISSION-ENGINE-CONTRACT.md`
- `packages/database/migrations/0018_phase_5_agent_commission_schema.sql`
- `packages/database/schema/index.ts`
- `apps/api/src/domain/agent-activation/agent-activation.service.ts`
- `apps/api/src/domain/agent-activation/agent-activation.service.spec.ts`
- `apps/api/src/controllers/admin-agent-activation.controller.ts`
- `apps/api/src/controllers/admin-rate.controller.ts`
- `apps/api/src/domain/commission/agent-upgrade.service.ts`
- `apps/api/src/domain/commission/member-consumption.service.ts`
- `apps/api/src/domain/commission/merchant-recruitment.service.ts`
- `apps/api/src/domain/commission/rate.service.ts`
- `apps/api/src/domain/commission/compensation.service.ts`
- `apps/api/src/domain/commission/compensation.service.spec.ts`
- `apps/api/src/__tests__/b-transaction-commission.integration.spec.ts`
- `apps/api/src/__tests__/c-merchant-attribution.integration.spec.ts`
- `apps/api/src/__tests__/d-correction-compensation.integration.spec.ts`

### 6.5 Phase 6 evidence

- `docs/06-phase-contracts/P6-S0-REDEMPTION-CENTER-CONTRACT.md`
- `packages/database/schema/redemption.ts`
- `packages/database/migrations/0020_phase_6_redemption_center_canonical.sql`
- `packages/database/migrations/0021_phase_6_redemption_contract_corrections.sql`
- `packages/database/migrations/0025_phase_6_shipping_terms_constraints.sql`
- `packages/database/migrations/0026_phase_6_shipping_recovery_v2.sql`
- `apps/api/src/redemption/redemption.service.ts`
- `apps/api/src/redemption/redemption-fulfilment.service.ts`
- `apps/api/src/redemption/redemption-refund.service.ts`
- `apps/api/src/redemption/redemption-admin-refund.controller.ts`
- `apps/api/src/redemption/redemption-integration.spec.ts`
- `apps/api/src/redemption/redemption-p6-atomicity.spec.ts`
- `apps/api/src/redemption/redemption-concurrency.spec.ts`
- `apps/api/src/redemption/redemption-fulfilment.service.spec.ts`
- `apps/api/src/redemption/redemption-security-privacy.spec.ts`
- `apps/api/src/redemption/redemption-shipping-market-commission.spec.ts`
- `apps/api/src/redemption/redemption-refund.checkpointE.spec.ts`
- `apps/api/src/redemption/redemption-regression-performance.spec.ts`
- `apps/api/src/redemption/redemption-admin.hardening.spec.ts`

### 6.6 Phase 7 integration-surface evidence

- `apps/api/src/auth/auth.controller.ts`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/platform-access/access-administration.service.ts`
- `apps/api/src/platform-access/rbac.guard.ts`
- `apps/api/src/platform-access/rbac.service.ts`
- `apps/api/src/platform-access/audit.controller.ts`
- `apps/api/src/platform-access/audit.service.ts`
- `apps/api/src/admin-member/admin-member.controller.ts`
- `apps/api/src/admin-member/admin-member.service.ts`
- `apps/api/src/admin-kyc/admin-kyc.controller.ts`
- `apps/api/src/admin-kyc/admin-kyc.service.ts`
- `apps/api/src/merchant/merchant.controller.ts`
- `apps/api/src/merchant/merchant.service.ts`
- `apps/api/src/merchant/package.controller.ts`
- `apps/api/src/merchant/package.service.ts`
- `apps/api/src/merchant/mcp.controller.ts`
- `apps/api/src/merchant/mcp.service.ts`
- `packages/database/migrations/0002_phase_1_merchant_package_mcp.sql`
- `apps/api/src/redemption/admin-redemption.controller.ts`
- `apps/api/src/redemption/redemption.service.ts`

## 7. Status

**DRAFT / UNDER_COMMAND_CENTER_REVIEW / NOT_IMPLEMENTATION_AUTHORIZATION**

This audit records repository evidence and planning constraints only. Command Center review is required before it can inform a Phase 7 implementation brief. The inherited gaps identified above remain blockers or follow-up candidates under their owning domain authority; they are not authorized fixes within P7-S0A.
