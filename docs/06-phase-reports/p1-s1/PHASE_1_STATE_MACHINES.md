---
title: Phase 1 State Machines
phase: P1-S1
status: planning-only
implementation_authorized: false
date: 2026-07-16
---

# Phase 1 State Machines

## 1. Common transition contract

Every transition validates expected current state, actor/permission, entity market, transition reason and optimistic version while holding the required database lock. State update, domain history, audit log and timeline append are atomic. Notifications are durable intents only; no production send is authorized.

## 2. Merchant lifecycle

| State            | Description                                                               |
| ---------------- | ------------------------------------------------------------------------- |
| Draft            | Registration/application incomplete                                       |
| PendingKYC       | Account/application complete; KYC evidence required                       |
| KYCSubmitted     | KYC submitted and immutable review snapshot pending                       |
| KYCRejected      | Rejected with reason; resubmission allowed                                |
| KYCApproved      | KYC accepted; activation prerequisites evaluated                          |
| AwaitingMCPTopup | KYC approved but initial MCP activation condition unmet                   |
| Active           | Merchant may use authorized operational features                          |
| Suspended        | Login/status view allowed; transaction/advertising blocked; MCP preserved |
| ClosurePending   | Closure/refund matters under review; new operations blocked               |
| Closed           | Terminal commercial relationship; history and MCP evidence retained       |

| From                          | To                | Trigger / guard                                                    | Required side effects                                                |
| ----------------------------- | ----------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Draft                         | PendingKYC        | Registration, profile minimum and versioned terms accepted         | Application history, audit, KYC CTA intent                           |
| PendingKYC, KYCRejected       | KYCSubmitted      | Required metadata/documents valid                                  | Freeze submission snapshot, history/audit, reviewer queue intent     |
| KYCSubmitted                  | KYCRejected       | Authorized reviewer + reason                                       | Review record, history/audit, rejection intent                       |
| KYCSubmitted                  | KYCApproved       | Authorized reviewer; market requirements satisfied                 | Review record, history/audit, activation evaluation                  |
| KYCApproved                   | AwaitingMCPTopup  | Initial MCP condition unmet                                        | History/audit, top-up CTA intent                                     |
| KYCApproved, AwaitingMCPTopup | Active            | Approved KYC and initial MCP condition met                         | Activation timestamp, history/audit, activation intent               |
| Active                        | Suspended         | Authorized Admin + reason                                          | Block capability, preserve MCP, history/audit                        |
| Suspended                     | Active            | Authorized reactivation; KYC remains valid                         | Restore capability, history/audit                                    |
| Active, Suspended             | ClosurePending    | Merchant closure request accepted for review                       | Closure request, history/audit                                       |
| ClosurePending                | Active, Suspended | Closure rejected/cancelled; restore prior eligible state           | Review reason, history/audit                                         |
| ClosurePending                | Closed            | Authorized closure approval and required foundation steps complete | Close timestamp, MCP preserved/refund foundation link, history/audit |

**Concurrency.** Only one active KYC review submission and one closure request per branch. Compare-and-swap `version` prevents competing review/status decisions. Active transition locks application and MCP account projection. Closed is terminal; no delete/reactivate shortcut.

## 3. Receipt/request foundation (no Transaction Engine)

| State         | Description                                                       |
| ------------- | ----------------------------------------------------------------- |
| Pending       | Receipt/request created but not yet exposed for member binding    |
| WaitingMember | Awaiting member binding within locked 60-minute expiry            |
| Completed     | Binding/confirmation outcome recorded by future authorized engine |
| Expired       | Expiry passed before completion                                   |

Transitions: `Pending -> WaitingMember` on issue; `WaitingMember -> Completed` on future idempotent confirmation; `Pending|WaitingMember -> Expired` on guarded expiry. Completion requires future Merchant/Member/MCP checks and atomic transaction logic and is **not implemented in Phase 1**. Unique receipt public ID and one binding key prevent duplicate completion. Expiry and completion race under a row lock; only one wins. Side effects are audit/timeline; future completion ledger/notification side effects are deferred.

## 4. Merchant service-fee assignment profile

| State         | Description                                                                   |
| ------------- | ----------------------------------------------------------------------------- |
| Active        | Eligible for future transaction selection                                     |
| Paused        | Temporarily hidden/ineligible; assignment retained                            |
| PendingChange | Requested version/assignment change awaiting authorized review/effective time |

Transitions: `Active -> Paused` by merchant only if another active assignment remains; `Paused -> Active` when referenced version is currently effective; `Active|Paused -> PendingChange` on change request; `PendingChange -> Active|Paused` on approve/reject/cancel according to prior state and effective-time rules. Default reassignment is atomic. Concurrent operations lock all assignments for the merchant; there must be at least one active default after commit. Rate/version rows are never overwritten.

## 5. MCP adjustment request

| State           | Description                                     |
| --------------- | ----------------------------------------------- |
| Draft           | Maker prepares credit/debit reason and evidence |
| PendingApproval | Immutable request awaiting checker              |
| Approved        | Checker approved; not yet posted                |
| Rejected        | Terminal rejection with reason                  |
| Executed        | Terminal; exactly one ledger entry posted       |
| Cancelled       | Terminal cancellation before approval           |

Transitions: `Draft -> PendingApproval`, `Draft -> Cancelled`, `PendingApproval -> Approved|Rejected|Cancelled`, `Approved -> Executed`. Credit and debit both follow this flow; no threshold bypass. Checker must differ from maker. Approval uses one checker decision; execution revalidates separation, status, idempotency and available balance inside one transaction. Side effects: decision/audit/timeline for every transition; ledger + balance projection + notification intent only on execution. One terminal decision and one execution idempotency key are unique.

## 6. MCP recharge request

| State      | Description                                                   |
| ---------- | ------------------------------------------------------------- |
| Pending    | Merchant request received                                     |
| Processing | Authorized Admin review or verified gateway callback handling |
| Completed  | Exactly one Recharge credit posted                            |
| Failed     | Terminal processing failure/rejection with reason             |

Transitions: `Pending -> Processing`, `Processing -> Completed|Failed`; retriable transport attempts do not change a terminal outcome. Manual recharge approval requires normal authorized review, **not maker/checker**. Gateway callback uses provider event ID + idempotency key, but production gateway integration is deferred. Completion atomically writes ledger/audit/timeline; failure writes no credit. Competing callbacks/reviews lock the request and return the same logical result.

## 7. MCP refund request foundation

| State       | Description                                             |
| ----------- | ------------------------------------------------------- |
| Pending     | Merchant/closure refund request submitted               |
| UnderReview | Authorized Admin review in progress                     |
| Approved    | Foundation approval recorded; no bank/gateway execution |
| Rejected    | Terminal rejection with reason                          |

Transitions: `Pending -> UnderReview`, `UnderReview -> Approved|Rejected`. Under the future authorized Phase 1 foundation, approval atomically appends one `Refund` debit that removes the approved MCP from the spendable position and records a non-cash refund obligation; actual money movement is always deferred. Amount cannot exceed eligible MCP. Only one open refund request may reserve the same MCP amount; review uses account/request locks. Side effects: ledger (approval only), audit/timeline and notification intent; no payout or provider call.
