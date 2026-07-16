---
title: Phase 1 State Machines
phase: P1-S1
status: planning-only
implementation_authorized: false
date: 2026-07-16
---

# Phase 1 State Machines

## 1. Common transition contract

Every transition validates expected current state, actor/permission, entity market, transition reason and optimistic version while holding the required database lock. State update, append-only domain history, audit log and timeline append are atomic. Notifications are durable intents only; no production send is authorized.

Merchant onboarding is represented by three independent state machines. Application Review determines only the application result. KYC Review determines only the KYC result. Operational Status is deterministically driven by activation policy, except explicit suspend/reactivate and closure actions.

## 2. Merchant Application Status

`MerchantApplicationStatus`: `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `RESUBMISSION_REQUIRED`, `APPROVED`, `REJECTED`

| From | To | Trigger / guard | Required evidence |
| --- | --- | --- | --- |
| `DRAFT` | `SUBMITTED` | Required application fields and versioned terms are complete | Submission time, immutable submission payload reference, audit/timeline |
| `SUBMITTED` | `UNDER_REVIEW` | Authorized reviewer claims review | Reviewer and review-start evidence |
| `UNDER_REVIEW` | `RESUBMISSION_REQUIRED` | Correctable deficiency with mandatory reason | Append-only decision evidence and notification intent |
| `RESUBMISSION_REQUIRED` | `SUBMITTED` | Merchant submits a new immutable application snapshot | New submission version; prior evidence retained |
| `UNDER_REVIEW` | `APPROVED` | Authorized reviewer approves the application | Append-only approval evidence and activation-policy evaluation |
| `UNDER_REVIEW` | `REJECTED` | Authorized reviewer issues terminal rejection with reason | Append-only rejection evidence |

Application approval does not approve KYC and does not directly set Operational Status to `ACTIVE`.

## 3. Merchant KYC Status

`MerchantKycStatus`: `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `RESUBMISSION_REQUIRED`, `APPROVED`, `REJECTED`

| From | To | Trigger / guard | Required evidence |
| --- | --- | --- | --- |
| `DRAFT` | `SUBMITTED` | Required market-versioned KYC evidence is valid | Immutable KYC submission snapshot and private document references |
| `SUBMITTED` | `UNDER_REVIEW` | Authorized KYC reviewer claims review | Reviewer and review-start evidence |
| `UNDER_REVIEW` | `RESUBMISSION_REQUIRED` | Correctable deficiency with mandatory reason | Append-only KYC review decision |
| `RESUBMISSION_REQUIRED` | `SUBMITTED` | Merchant submits a new immutable KYC snapshot | New submission version; old snapshot remains unchanged |
| `UNDER_REVIEW` | `APPROVED` | Market requirements satisfied | Append-only approval evidence and activation-policy evaluation |
| `UNDER_REVIEW` | `REJECTED` | Authorized reviewer issues terminal rejection with reason | Append-only rejection evidence |

KYC approval does not approve the application. Only the KYC state machine may determine the KYC result.

## 4. Merchant Operational Status

`MerchantOperationalStatus`: `PENDING_APPLICATION`, `PENDING_KYC`, `PENDING_MCP`, `ACTIVE`, `SUSPENDED`, `CLOSURE_PENDING`, `CLOSED`

### Deterministic activation policy

| Inputs | Derived Operational Status |
| --- | --- |
| Application is not `APPROVED` | `PENDING_APPLICATION` |
| Application is `APPROVED`, KYC is not `APPROVED` | `PENDING_KYC` |
| Application and KYC are `APPROVED`, MCP < 100 | `PENDING_MCP` |
| Application and KYC are `APPROVED`, MCP >= 100 | `ACTIVE` |

- KYC approved + MCP >= 100 results in `ACTIVE` once the application is also approved.
- The 100 MCP activation condition is evaluated centrally; after initial activation, MCP may fall below 100 without deactivation.
- `SUSPENDED` is an explicit operational override. Suspend preserves MCP and changes no Application or KYC status.
- Reactivate clears the suspension override and deterministically reevaluates the current activation inputs; it changes only Operational Status.
- Closure actions change only Operational Status. `CLOSED` is terminal and all history/MCP evidence remains retained.

| From | To | Trigger / guard |
| --- | --- | --- |
| Any pending operational status | Another pending status or `ACTIVE` | Deterministic reevaluation after Application, KYC or initial MCP input changes |
| `ACTIVE` | `SUSPENDED` | Authorized Admin with mandatory reason |
| `SUSPENDED` | Derived pending status or `ACTIVE` | Authorized reactivation followed by deterministic reevaluation |
| `ACTIVE`, `SUSPENDED` | `CLOSURE_PENDING` | Merchant closure request accepted for review |
| `CLOSURE_PENDING` | Derived pending status, `ACTIVE` or `SUSPENDED` | Closure rejected/cancelled; restore suspension override if it existed, otherwise reevaluate |
| `CLOSURE_PENDING` | `CLOSED` | Authorized closure approval and foundation checks complete |

Operational transitions append `merchant_status_history` with event time, actor and reason. That history has no update/delete/soft-delete path.

## 5. Merchant service-fee assignment profile

| State | Description |
| --- | --- |
| `Active` | Eligible for future transaction selection |
| `Paused` | Temporarily hidden/ineligible; assignment retained |
| `PendingChange` | Requested version/assignment change awaiting authorized review/effective time |

Transitions: `Active -> Paused` by merchant only if another active assignment remains; `Paused -> Active` when the referenced version is currently effective; `Active|Paused -> PendingChange` on change request; `PendingChange -> Active|Paused` on approve/reject/cancel according to prior state and effective-time rules. Default reassignment is atomic. Concurrent operations lock all assignments for the merchant; there must be at least one active default after commit. Rate/version rows are never overwritten.

## 6. MCP adjustment request

| State | Description |
| --- | --- |
| `Draft` | Maker prepares credit/debit reason and evidence |
| `PendingApproval` | Immutable request awaiting checker |
| `Approved` | Checker approved; not yet posted |
| `Rejected` | Terminal rejection with reason |
| `Executed` | Terminal; exactly one ledger entry posted |
| `Cancelled` | Terminal cancellation before approval |

Transitions: `Draft -> PendingApproval`, `Draft -> Cancelled`, `PendingApproval -> Approved|Rejected|Cancelled`, `Approved -> Executed`. Credit and debit both follow this flow; no threshold bypass. Checker must differ from maker. Approval uses one checker decision; execution revalidates separation, status, idempotency and available balance inside one transaction. Decision evidence is append-only and contains event timestamps only. One terminal decision and one execution idempotency key are unique.

## 7. MCP recharge request

| State | Description |
| --- | --- |
| `Pending` | Merchant request received |
| `Processing` | Authorized Admin review or verified gateway callback handling |
| `Completed` | Exactly one Recharge credit posted |
| `Failed` | Terminal processing failure/rejection with reason |

Transitions: `Pending -> Processing`, `Processing -> Completed|Failed`; retriable transport attempts do not change a terminal outcome. Manual recharge approval requires normal authorized review, not maker/checker. Gateway callback uses provider event ID + idempotency key, but production gateway integration is deferred. Completion atomically writes ledger/audit/timeline; failure writes no credit. Competing callbacks/reviews lock the request and return the same logical result.

## 8. MCP refund request foundation

| State | Description |
| --- | --- |
| `Pending` | Merchant/closure refund request submitted |
| `UnderReview` | Authorized Admin review in progress |
| `Approved` | Foundation approval recorded; no bank/gateway execution |
| `Rejected` | Terminal rejection with reason |

Transitions: `Pending -> UnderReview`, `UnderReview -> Approved|Rejected`. Under a future authorized Phase 1 foundation, approval atomically appends one `Refund` debit that removes the approved MCP from the spendable position and records a non-cash refund obligation; actual money movement is always deferred. Amount cannot exceed eligible MCP. Only one open refund request may reserve the same MCP amount; review uses account/request locks. Side effects: ledger (approval only), audit/timeline and notification intent; no payout or provider call.
