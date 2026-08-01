# Phase 7 Admin Operations — Critical Remediation Plan

> **Status: DRAFT / UNDER_COMMAND_CENTER_REVIEW / NOT_IMPLEMENTATION_AUTHORIZATION**
>
> This document defines isolated future remediation packages only. It does not authorize production code, frozen-domain modification, schema, migration, test, CI, route registration, deployment, Main PR, or Main merge. Each package requires a separate Command Center brief, isolated owner branch/commit, independent verification, and explicit acceptance.

## 1. Isolation and gate rules

1. A Phase 7 UI or adapter cannot release a frozen-owner gate.
2. Each remediation uses its owning phase, a dedicated branch, a dedicated commit series, and regression evidence independent of Phase 7 presentation work.
3. Ledger, auth, permission, and transaction-state changes remain separate commits. No package may be combined merely to shorten delivery.
4. Until a gate is accepted, command routes are not registered for Phase 7 use. A read-only surface may proceed only where this plan explicitly permits it and a separate safe-adapter review proves permission, Current Admin Market, masking, bounded responses, and inability to invoke the blocked command.
5. No package changes D-046 product rules. OPEN behavior remains unavailable.

## 2. Package R1 — Phase 6 Redemption Refund Ledger Remediation (SEC-02)

### 2.1 Package metadata

| Field                           | Plan                                                                                                                                                                                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proposed future task ID         | `P6-R1-SEC-02-REFUND-WALLET-LEDGER`                                                                                                                                                                                                                  |
| Owner phase                     | **Phase 6 Redemption frozen owner**, with Phase 3 Wallet owner contract review                                                                                                                                                                       |
| Gate/findings                   | `GATE-SEC-02`, SEC-02, P7-OD-19                                                                                                                                                                                                                      |
| Current state                   | `REFUND APPROVAL UNAVAILABLE`                                                                                                                                                                                                                        |
| Migration expected              | **UNKNOWN** — existing linkage columns may be reusable, but a forward migration is required if separate original-debit/refund-entry linkage, idempotency payload hash, execution-attempt, or lock/version evidence is absent. No historical rewrite. |
| Blocking Phase 7 capability     | Redemption refund approval/execution; any dashboard/report must not imply refundable points were restored before accepted execution                                                                                                                  |
| Read-only UI before remediation | **YES, conditionally** — only safe selected-market refund queue/detail/status through a reviewed adapter; no approve/reject/create command if the route strategy has not independently passed SEC-03. Approval always unavailable.                   |
| Acceptance gate                 | Command Center accepts isolated Phase 6 remediation after all contract items and regressions below pass                                                                                                                                              |

### 2.2 Required contract

The accepted command must perform one indivisible refund operation:

1. Lock the refund request, order, original wallet debit/target wallet, and inventory aggregates in a documented deterministic order.
2. Verify active authenticated Checker, accepted MFA/step-up policy, `redemption.refund.checker`, active Market Access, request/order/wallet/inventory market equality, request state/version, and Maker != Checker inside the transaction.
3. Resolve and retain the **original redemption debit linkage** from `redemption_orders.wallet_entry_id` (or the accepted canonical replacement).
4. Append a new immutable **exact-opposite wallet ledger entry** with the approved `REDEMPTION_REFUND` semantics. The original debit is never edited.
5. Persist the **new refund-entry linkage** on the refund request/order/audit evidence without overwriting the original debit linkage.
6. Restore the wallet projection in the same atomic wallet/order/refund/inventory transaction, using the Phase 3 Wallet owner service/invariant rather than an independent balance formula.
7. Transition order/refund state and restore inventory in that same transaction. Any wallet, ledger, state, audit, or inventory failure rolls everything back.
8. Require an operation-scoped idempotency key and canonical payload hash for create, approve, and reject. Same key/same payload returns the original result; same key/different payload returns `IDEMPOTENCY_PAYLOAD_MISMATCH`.
9. Preserve the independent Phase 6 Maker/Checker workflow and immutable decision history. Same-person approval remains denied, including Super Admin.
10. Append immutable audit evidence for Maker, Checker, market, request/order, original debit, new refund entry, inventory effect, reason, idempotency/correlation reference, result, and retry attempt.
11. Define retry semantics: a transient failure leaves no partial effect; retry uses the same approval key/payload and returns one execution. A terminal failure is explicit and auditable; it is not false success.
12. Add duplicate Checker protection through request state/decision uniqueness and ledger idempotency, not UI disabling.
13. Preserve D-002 C-05: refund returns wallet points only; Reward Plan cap/progress is not reopened or recalculated.

### 2.3 Files likely affected

Only after separate authorization, expected owner files include:

- `apps/api/src/redemption/redemption-refund.service.ts`
- `apps/api/src/redemption/redemption-admin-refund.controller.ts` (only if included in the isolated route/security brief)
- `apps/api/src/redemption/redemption.dto.ts`
- `apps/api/src/redemption/redemption.module.ts`
- `apps/api/src/wallet/wallet.service.ts` or a new owner-approved transaction-capable Wallet command boundary
- `packages/database/schema/redemption.ts`
- `packages/database/schema/index.ts`
- `packages/database/migrations/<future_forward_only_refund_ledger_remediation>.sql` (**only if required by the accepted design**)
- `apps/api/src/redemption/redemption-p6-atomicity.spec.ts`
- `apps/api/src/redemption/redemption-integration.spec.ts`
- targeted new real PostgreSQL/API concurrency tests

The package must not touch unrelated Phase 6 catalog/fulfilment/rate behavior or rewrite Phase 3 wallet history.

### 2.4 Regression suites and acceptance evidence

- Successful approval proves original debit unchanged, one exact-opposite refund entry, correct new linkage, restored wallet projection, correct order/refund/inventory state, and one immutable audit chain.
- Injected failure at each ledger, wallet projection, order, refund, inventory, and audit step proves full rollback.
- Same key/same payload replay returns the original execution; same key/different payload is rejected.
- Concurrent approval storm proves one Checker decision and one ledger/projection/inventory effect.
- Same-person, missing permission, missing/expired MFA, revoked market grant, wrong-market target, stale request state/version, already-refunded order, and missing original debit all fail safely.
- Retry after an uncertain response reuses the original key and creates no duplicate.
- Full Phase 3 wallet regression, including ledger/projection invariants and corrections.
- Full Phase 6 redemption regression, including order rate lock, fulfilment, inventory, refund Maker/Checker, privacy, and atomicity.
- Registered runtime/OpenAPI route and safe error evidence if the controller is in scope.
- Clean format, lint, typecheck, build, real PostgreSQL tests, API tests, and no skipped gate tests.

**Release statement:** Refund approval remains unavailable until this package is independently accepted by Command Center.

## 3. Package R2 — Phase 3/Phase 7 Manual iPoint Adjustment Remediation (SEC-01)

### 3.1 Package metadata

| Field                           | Plan                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Proposed future task ID         | `P3-P7-R1-SEC-01-IPOINT-MAKER-CHECKER`                                                                                                                                                     |
| Owner phase                     | **Phase 3 Wallet/Ledger frozen owner** for financial truth and execution; separately authorized **Phase 7 integration owner** for Admin request workflow/API/UX                            |
| Gate/findings                   | `GATE-SEC-01`, SEC-01, SEC-14, P7-OD-03/10/11/18/20                                                                                                                                        |
| Current state                   | Current `POST /api/v1/admin/rewards/wallets/:id/adjustment` is prohibited from Phase 7 exposure                                                                                            |
| Migration expected              | **YES** — durable request, decision, execution-attempt/idempotency, replacement/correction, evidence-reference, cap/rule-version, state/version, and ledger linkage storage is not present |
| Blocking Phase 7 capability     | Manual iPoint create/submit/approve/reject/execute and correction                                                                                                                          |
| Read-only UI before remediation | **YES** — safe Finance-only wallet/ledger projection may proceed after separate adapter review; adjustment queue/actions remain unavailable                                                |
| Acceptance gate                 | Command Center accepts the migration, canonical Wallet execution boundary, API, concurrency and full Phase 3 financial regression                                                          |

### 3.2 Required lifecycle and immutable records

The durable lifecycle is:

`Draft/Create -> Pending Checker -> Approved | Rejected -> Executing -> Executed | Failed`

- `Draft/Create`: server derives Maker ID, target wallet/member/market, point unit, cap-policy version, and current market grant. Store positive decimal amount plus explicit `CREDIT`/`DEBIT` direction.
- `Pending Checker`: immutable financial fields are frozen; evidence completeness is validated before submission.
- `Approved/Rejected`: one immutable Checker decision. Maker and Checker are distinct authenticated identities at every amount and for every role, including Super Admin.
- `Executing`: exclusive execution attempt has begun under a deterministic request-then-wallet lock order.
- `Executed`: one immutable wallet ledger entry and wallet projection effect are linked to the request and committed with state/audit.
- `Failed`: records a safe failure code/attempt; retry policy distinguishes retryable from terminal failure and never claims ledger success without a committed ledger entry.

Rejected requests are never edited or resubmitted in place. A replacement is a new request with a new idempotency/decision chain and immutable `replacesRequestId`/`priorRequestId` linkage.

### 3.3 Malaysia caps, Checker routing, and evidence

- Soft cap: **10,000 iPoint** per request.
- Hard cap: **100,000 iPoint** per request.
- At or below soft cap: Finance Approver may check.
- Above soft cap through hard cap: Super Admin with the dedicated Checker permission must check.
- Above hard cap: reject before a durable executable request is accepted.
- All amounts require Maker/Checker; caps change Checker authority, never the dual-control requirement.
- Every request stores Reason Code, detailed explanation, Case/Ticket Reference, Maker identity/time, Checker identity/time, and the applied cap/evidence policy version.
- Attachment is required above soft cap, for high-risk Reason Code, or at Checker request. Store only a protected opaque reference.
- Above-soft-cap execution stays disabled until file type, size, malware scanning, storage, access, and retention policy is approved and available.

### 3.4 Financial, idempotency, concurrency, and audit contract

1. Execution calls the canonical Phase 3 Wallet ledger owner. The adjustment workflow must not implement an independent wallet balance formula or direct table mutation.
2. Wallet ledger is immutable. Normal adjustment appends one entry; a correction is a new independently approved request that appends a linked exact-opposite entry. The original entry is never modified.
3. Wallet projection and ledger entry commit atomically with request state, execution attempt, linkage, and privileged audit.
4. Create, submit, approve, reject, and execute use operation-scoped idempotency keys plus canonical payload hashes. Payload mismatch is rejected, not replayed as success.
5. Decision uniqueness, request row lock/version, wallet lock/version, ledger uniqueness, and deterministic lock order protect duplicate Checker and concurrent execution.
6. The Checker transaction revalidates session, MFA/step-up, permission, active grant, Current Admin Market, target wallet market, request state/version, amount, cap-policy version, evidence, available balance/negative-balance rule, and Maker inequality.
7. Audit chain is append-only: created, submitted, approved/rejected, execution started, executed/failed, retried, replaced, and corrected. It records both actors/timestamps, request/correlation/idempotency references, market, target, reason/evidence references, policy version, ledger IDs, result, and safe before/after projection.
8. Retry reuses the canonical execution key. A losing concurrent command returns the original result or a stable state/conflict error with no partial ledger, wallet, request, or audit effect.
9. The current immediate endpoint is disabled/retired safely or replaced only after compatibility review. It must never coexist as a bypass around the Maker/Checker API.

### 3.5 Files likely affected

- `apps/api/src/admin-reward/admin-reward.controller.ts` (disable/retire unsafe route only under authorization)
- `apps/api/src/admin-reward/admin-reward.service.ts` (remove from canonical adjustment execution path; retain safe reward ownership)
- `apps/api/src/admin-reward/admin-reward.dto.ts`
- `apps/api/src/wallet/wallet.service.ts` (owner-approved transaction-capable ledger command)
- future Phase 7 adjustment controller/service/DTO files under an approved Admin module
- `apps/api/src/platform-access/rbac.guard.ts` and permission catalog only through the separate RBAC package/commit
- `packages/database/schema/index.ts`
- `packages/database/migrations/<future_forward_only_ipoint_adjustment_workflow>.sql`
- focused real PostgreSQL/API/concurrency tests and existing Phase 3 wallet/reward suites

### 3.6 Required regression suites and acceptance evidence

- Full lifecycle positive and negative tests; immutable rejected request and linked replacement.
- Same-person denial at every amount, including Super Admin and multi-role users.
- Malaysia 10,000/100,000 boundary tests, Checker routing, missing/high-risk/Checker-requested evidence, and above-hard rejection.
- Payload-hash same-key same/different-payload tests for every critical transition.
- Concurrent create/decision/execute storms, injected rollback, retry after uncertain outcome, and duplicate Checker protection.
- CREDIT/DEBIT wallet projection and ledger exactness; insufficient-balance/negative-balance owner rules.
- Exact-opposite correction linkage and original entry immutability.
- Missing permission, MFA, market grant, wrong market, stale version, suspended Admin/member/wallet where applicable.
- Proof the old immediate endpoint is unreachable to Phase 7 and absent from the approved OpenAPI/client.
- Full Phase 3 wallet, reward, accrual, timezone, ledger, idempotency, and transaction integration regression.
- Format, lint, typecheck, build, real PostgreSQL/API/browser tests, and no hidden/skipped financial gate.

## 4. Package R3 — Phase 5 Agent and Commission Owner Remediation (GATE-P5-01)

### 4.1 Package metadata

| Field                           | Plan                                                                                                                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proposed future task ID         | `P5-R1-GATE-P5-01-AGENT-COMMISSION-OWNER`                                                                                                                                                                               |
| Owner phase                     | **Phase 5 Agent and Commission frozen owner**                                                                                                                                                                           |
| Gate/findings                   | GATE-P5-01; SEC-04/05/06/07/08/09/11; corrected D-042                                                                                                                                                                   |
| Migration expected              | **YES** for accepted agent fee version/snapshot storage and possibly permission/catalog changes; **UNKNOWN** for route/service consolidation itself. Permission work must remain a separate dedicated migration/commit. |
| Blocking Phase 7 capability     | Agent activation commands/queue completeness, Agent Activation Fee editor/history, Commission Rate editor/history, Commission Ledger Admin projection, any commission reprocess command                                 |
| Read-only UI before remediation | **Capability-specific only** — no current doubled/cross-market route. A new separately reviewed safe market-scoped projection may be accepted for queues/history; commands and raw ledger stay unavailable.             |
| Acceptance gate                 | Command Center accepts canonical services/routes, market/RBAC, fee/rate semantics, financial failure handling, and full B/C/D regression                                                                                |

### 4.2 Canonical routing and service ownership

1. Remove doubled API-prefix behavior. The application owns `/api/v1`; Phase 5 controllers use `admin/...`, never `api/v1/admin/...`.
2. Prove registered runtime paths and OpenAPI paths are identical. Dead/unregistered controller declarations are not accepted evidence.
3. Choose exactly one canonical Agent Activation implementation. The live module currently wires `apps/api/src/domain/agent-activation/service.ts`, while the larger unit suite targets the duplicate `apps/api/src/domain/agent-activation/agent-activation.service.ts`; the accepted package must consolidate behavior and tests without silently changing frozen business semantics.
4. Register, retire, or replace the unreachable commission-adjustment controller intentionally. It must not remain an apparent Maker/Checker capability.
5. Phase 7 later calls the accepted canonical services only; it cannot retain duplicate services behind different adapters.

### 4.3 Market authorization, actor attribution, and audit

- Every Agent/Commission Admin route requires active authenticated Admin, accepted MFA/step-up as applicable, a dedicated seeded permission, **server-side market authorization** through the server-bound Current Admin Market, active `market_access`, and target/source market equality.
- Market code/UUID mapping is canonical and validated server-side. Free-form `MY`/`market` request data is not authorization.
- Get-by-ID, ledger audit, queue/detail, rate history, rate create/schedule, reprocess, and activation transitions all re-resolve market from the resource.
- Approve/reject/suspend/reactivate/deactivate records the correct Admin actor ID, reason, request/correlation ID, market, before/after state, and result. No null/system actor is substituted for an authenticated Admin action.
- Privileged audit writes atomically with the owner state/version where feasible; immutable commission status/ledger evidence is retained.

### 4.4 Versioned Malaysia Agent Activation Fee

- Malaysia fee is **RM388.00 MYR**, versioned, market/currency scoped, and future-effective.
- Each qualifying activation snapshots fee version ID, amount, currency, and effective time.
- Historical activations are never repriced.
- Other markets cannot activate until an approved fee amount, currency, bounds, display unit, and compliance configuration exist. There is no MYR/RM388 fallback.
- Malaysia future qualifying Agent Upgrade Commission versions remain G1 **RM88** and G2 **RM38**. The activation source event retains the accepted rate snapshots.
- Fee/rate create and schedule require idempotency key, payload hash, non-overlap/concurrency protection, exact decimal strings, reason, actor, and immutable audit.

### 4.5 Commission rate and posting correctness

1. Commission parameter changes affect future qualifying source events only; existing ledger rows and snapshots are immutable.
2. Resolve the repository conflict where validation says generation `0` for `MEMBER_CONSUMPTION`/`MERCHANT_RECRUITMENT`, while accepted seed/posting behavior uses G1/G2 member consumption and one-generation merchant recruitment. The accepted Phase 5 contract, D-042 classification, and tests control; no silent normalization.
3. Use percentage-specific validation with an explicit unit convention and approved upper bounds. Generic non-negative numeric validation is insufficient.
4. Preserve exactly three official sources: `AGENT_UPGRADE`, `MEMBER_CONSUMPTION`, `MERCHANT_RECRUITMENT`.
5. Preserve D-042 compensation: original commission ledger fully immutable; compensation is a new linked exact-opposite entry with `REVERSAL_COMPENSATION` or `REFUND_COMPENSATION`, original `source_type`, original transaction reference, correction audit linkage, and original-entry reversal linkage.
6. Agent activation may not return false success while swallowing commission posting failure. The accepted design must choose and prove one of: atomic activation+posting; durable outbox/pending state with visible retry; or another Command Center-approved contract. The current `.catch(() => {})` outcome is prohibited.
7. Reprocess, if retained, requires permission, market scope, idempotency/payload hash, bounded source type, immutable audit, and safe failure visibility.

### 4.6 Files likely affected

- `apps/api/src/controllers/admin-agent-activation.controller.ts`
- `apps/api/src/controllers/admin-commission.controller.ts`
- `apps/api/src/controllers/admin-rate.controller.ts`
- `apps/api/src/agent-activation/agent-activation.module.ts`
- `apps/api/src/commission/commission.module.ts`
- `apps/api/src/domain/agent-activation/service.ts`
- `apps/api/src/domain/agent-activation/agent-activation.service.ts`
- `apps/api/src/domain/commission/agent-upgrade.service.ts`
- `apps/api/src/domain/commission/member-consumption.service.ts`
- `apps/api/src/domain/commission/merchant-recruitment.service.ts`
- `apps/api/src/domain/commission/rate.service.ts`
- `apps/api/src/domain/commission/query.service.ts`
- `apps/api/src/domain/commission/adjustment.service.ts`
- `apps/api/src/domain/commission/compensation.service.ts`
- `packages/database/schema/index.ts`
- `packages/database/seeds/foundation.ts` and a forward permission migration in a **separate permission commit**
- `packages/database/migrations/<future_agent_fee_version_and_snapshot>.sql`
- Phase 5 unit/API/real PostgreSQL tests and B/C/D integration suites

### 4.7 Required regression suites and acceptance evidence

- Registered single-prefix route/OpenAPI proof; intended routes succeed, doubled routes absent.
- One canonical Agent Activation service and tests that exercise the wired class.
- Permission catalog/seed zero drift; six-role/market-grant positive and negative HTTP matrix.
- Cross-market list/detail/write denial, arbitrary market code/ID denial, and grant revocation next-request effect.
- Correct actor/reason/audit for every transition.
- RM388 MYR fee version and activation snapshot; RM88/RM38 future-event versions; no other-market fallback.
- Generation 0 versus G1/G2 resolution, percentage-unit/range boundary tests, overlap, stale, idempotency mismatch, and concurrency.
- Activation commission failure is atomic or durably visible/retryable according to the accepted contract; no swallowed failure.
- D-042 compensation and original-ledger immutability regression.
- Complete Phase 5 B 15/15, C 10/10, D 10/10 frozen integration regression, plus new Admin HTTP/security/concurrency evidence.

## 5. Package R4 — Phase 6 Admin Route Security Remediation (SEC-03/15)

### 5.1 Package metadata

| Field                           | Plan                                                                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proposed future task ID         | `P6-R2-SEC-03-15-ADMIN-ROUTE-SECURITY`                                                                                                                                                                                                                        |
| Owner phase                     | **Phase 6 Redemption frozen owner** for controller registration/domain-command security, or a separately authorized **Phase 7 safe adapter** for read-only projections/orchestration                                                                          |
| Gate/findings                   | SEC-03 and SEC-15; P7-OD-06/15/17/19/21                                                                                                                                                                                                                       |
| Migration expected              | **NO** for route guards/registration alone; **UNKNOWN** if idempotency/payload-hash/audit linkage or immutable supersession requires new storage. Any migration is forward-only and isolated.                                                                 |
| Blocking Phase 7 capability     | Redemption catalog writes, rate writes/history reliability, order Admin reads, fulfilment exception writes, refund create/reject/read safety, refund approval (also SEC-02), voucher reveal                                                                   |
| Read-only UI before remediation | **YES, per capability** — only through a separately reviewed Phase 7 read adapter with selected-market predicate, dedicated permission, allowlisted fields, cursor bounds, and no command path. Voucher reveal is not ordinary read-only and remains blocked. |
| Acceptance gate                 | Owner/adapter strategy accepted route-by-route with permission/market/idempotency/audit/security evidence; SEC-02 remains an additional independent hard gate for refund approval                                                                             |

### 5.2 Route-by-route strategy

| Capability                  | Current repository state                                                                                                                                    | Required owner remediation or safe adapter strategy                                                                                                                                                                                                  | Before gate                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redemption refund routes    | Registered `AuthGuard + AdminGuard`; global lists/IDs; no action permission/Market Access; approval has SEC-02 ledger gap                                   | Owner routes must apply `redemption.refund.read/maker/checker`, active grant, resource-market equality, idempotency/hash, request/version locks, actor/reason/audit. Approval additionally requires Package R1.                                      | Safe market-scoped list/detail adapter only; create/approve/reject unavailable until route package accepted; approval additionally SEC-02 blocked. |
| Fulfilment exception routes | Registered identity-only/global controllers; state commands lack uniform idempotency and actor coverage                                                     | Prefer owner remediation for commands. A P7 adapter may provide queue/detail reads and may orchestrate only accepted owner commands after action permission, grant, resource market, idempotency, locks, audit, and CORS/OpenAPI method proof.       | Safe queue/detail adapter may proceed; commands unavailable.                                                                                       |
| Redemption rate routes      | Controller declared but not registered; permission not market-scoped; create ignores idempotency; cancel attempts immutable-row mutation/nonexistent fields | Owner chooses a canonical registered market-scoped route. Create/schedule is prospective, hashed-idempotent, overlap-safe, audited. “Cancel” is retired or replaced by an accepted superseding-version contract; immutable history is never updated. | Safe version-history adapter may proceed after market/field review; schedule unavailable.                                                          |
| Catalog routes              | Controller declared but not registered; service has domain commands but no Admin grant enforcement and no request-key contract                              | Owner registers and secures canonical routes, or Phase 7 supplies read projection and later orchestration that calls `RedemptionService`. Item IDs are re-resolved to market; writes use idempotency/hash, expected version, audit.                  | Safe catalog list/detail may proceed; create/update/status unavailable.                                                                            |
| Voucher reveal              | No controller; service accepts any Admin actor, decrypts, and audits domain event but does not enforce permission/market/step-up/reason                     | Narrow owner endpoint or Phase 7 orchestration after owner approval: `redemption.voucher.reveal`, active grant, order market, online Admin Web, step-up MFA, recorded reason, no-store response, plaintext nowhere else, one audit per view.         | Unavailable. No list/detail projection contains voucher material.                                                                                  |

### 5.3 Shared security and immutable-version requirements

1. All routes use canonical `/api/v1` once and are proven registered in Nest module/OpenAPI.
2. Every read/write enforces Admin eligibility, accepted MFA policy, dedicated permission, server-bound Current Admin Market, active grant, and resource-market equality. `AdminGuard` alone is insufficient.
3. Request DTOs are strict and typed. Internal SQL, stack, keys, ciphertext, IV/auth tag, voucher plaintext, KYC/raw attachment, or unallowlisted JSON never leaks.
4. Critical writes require operation-scoped idempotency key and payload hash. Same-key/different-payload fails.
5. Owner transaction/row locks or existing database constraints protect state/version and duplicate execution. Pre-check alone is insufficient.
6. Actor, market, target, action, reason, before/after safe projection, result, request/correlation and idempotency references are audited atomically with the owner action where feasible.
7. Redemption Rate history is immutable and forward-only. Existing quote/order rate-version snapshots never change. Cancellation may not mutate an immutable version.
8. Catalog/order/fulfilment/refund history is not exposed through a generic row editor. Only explicit accepted owner commands are callable.
9. Voucher plaintext is response-only, step-up protected, `Cache-Control: no-store`, excluded from logs/service-worker caches/audit payloads, and never exportable.

### 5.4 Files likely affected

- `apps/api/src/redemption/redemption.module.ts`
- `apps/api/src/redemption/admin-redemption.controller.ts`
- `apps/api/src/redemption/redemption-admin-refund.controller.ts`
- `apps/api/src/redemption/redemption-admin-fulfilment.controller.ts`
- `apps/api/src/redemption/redemption.controller.ts`
- `apps/api/src/redemption/redemption.service.ts`
- `apps/api/src/redemption/redemption-refund.service.ts` (refund security only here; ledger correctness remains Package R1)
- `apps/api/src/redemption/redemption-fulfilment.service.ts`
- Redemption DTO/error files
- `apps/api/src/platform-access/rbac.guard.ts` only if an approved general guard enhancement is required; otherwise route decorators/adapters use existing Platform Access
- `packages/database/seeds/foundation.ts` and forward permission migration only through isolated RBAC ownership
- `packages/database/schema/redemption.ts` and a future forward migration only if accepted idempotency/audit/version storage requires it
- Phase 6 real HTTP/PostgreSQL/security/concurrency tests and existing redemption suites
- future Phase 7 read-adapter files if Command Center chooses the adapter strategy

### 5.5 Required regression suites and acceptance evidence

- Registered/unregistered/OpenAPI route inventory with no dead/doubled paths.
- Positive/negative permission and Market Access matrix for catalog, rates, orders, fulfilment, refunds, and voucher reveal.
- Cross-market crafted IDs, arbitrary headers/path values, grant revocation, and Support/Finance least-privilege denial.
- Idempotency same-key same/different payload, stale expected version, concurrent command storms, and rollback injection.
- Immutable rate version and quote/order snapshot regression; rejected mutation/cancel behavior.
- Catalog and fulfilment state-machine/domain regression; no generic status edits.
- Refund read/create/reject security regression; refund approval stays disabled unless Package R1 is also accepted.
- Voucher step-up/reason/no-store/no-cache/no-log/no-export and one-audit-per-reveal tests.
- CORS/browser evidence for actual GET/POST/PATCH/PUT/DELETE methods only if those methods are authorized.
- Full Phase 6 redemption regression and relevant Phase 3 Wallet regression for any wallet-linked path.

## 6. Remediation package summary

| Package                              | Proposed task ID                          | Owner                                             | Migration                         | Acceptance gate                                                       | Blocks                                          | Read-only before remediation              |
| ------------------------------------ | ----------------------------------------- | ------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| R1 — Refund wallet ledger            | `P6-R1-SEC-02-REFUND-WALLET-LEDGER`       | Phase 6, reviewed against Phase 3 Wallet contract | UNKNOWN                           | Exact ledger/projection/atomicity + Phase 3/6 regression accepted     | Refund approval                                 | Yes: safe status only                     |
| R2 — Manual iPoint Maker/Checker     | `P3-P7-R1-SEC-01-IPOINT-MAKER-CHECKER`    | Phase 3 Wallet + authorized Phase 7 integration   | YES                               | Durable lifecycle/financial/concurrency + Phase 3 regression accepted | All iPoint adjustment commands                  | Yes: safe ledger read only                |
| R3 — Agent/Commission owner          | `P5-R1-GATE-P5-01-AGENT-COMMISSION-OWNER` | Phase 5                                           | YES/UNKNOWN by isolated component | Canonical route/service/market/fee/rate/posting + B/C/D accepted      | Agent and Commission Admin exposure             | Capability-specific safe projections only |
| R4 — Redemption Admin route security | `P6-R2-SEC-03-15-ADMIN-ROUTE-SECURITY`    | Phase 6 or authorized P7 read adapter             | NO/UNKNOWN                        | Route-by-route RBAC/market/idempotency/audit acceptance               | Catalog/rate/fulfilment/refund/voucher surfaces | Yes for reviewed safe reads; voucher no   |

## 7. Review boundary

All four packages remain **DRAFT / UNDER_COMMAND_CENTER_REVIEW / NOT_IMPLEMENTATION_AUTHORIZATION**. Their task IDs are proposals, not authorizations. Gate release requires an explicit Command Center acceptance decision; no Phase 7 UI, facade, or documentation status can release them.
