---
title: Phase 1 Domain Map
phase: P1-S1
status: planning-only
implementation_authorized: false
architecture: modular-monolith
date: 2026-07-16
---

# Phase 1 Domain Map

## 1. Boundary model

Phase 1 remains a modular monolith. Domains may call published application interfaces or consume domain events; they must not update another domain's tables directly.

## 2. Merchant Domain

**Purpose and boundary.** Own merchant registration, group ownership, branch identity, profile, KYC evidence, application review, operational lifecycle, referral and consent. It does not own package rate definitions, MCP postings, member purchases, QR, advertising, commission or payout.

**Entities.** `MerchantGroup`, `MerchantBranch`, `MerchantProfile`, `MerchantApplication`, `MerchantKycSubmission`, `MerchantKycReview`, `MerchantDocument`, `MerchantStatusHistory`, `MerchantReferral`, `MerchantTermsAcceptance`.

**Invariants.** An Account owns a MerchantGroup; a MerchantGroup belongs to one market and owns many MerchantBranches. Every merchant, including a single-branch merchant, receives a default group. Branches do not have a unique Account ownership constraint. Group association grants no group-level permission and provides no shared MCP or group-level settlement. One branch has one unique, never-reused Merchant ID and one market matching its group. Merchant primary email is the immutable Account email; Merchant Profile has no separate modifiable email. Phone, WhatsApp and website may change, while a public support email remains a future independent product decision. Application, KYC and Operational statuses are independent. KYC approval plus MCP >= 100 deterministically activates the merchant; after activation MCP may fall below 100. Suspension/reactivation changes only Operational Status, and suspension preserves MCP. Suspended/closed merchants retain history and MCP. KYC documents and submission snapshots are immutable private metadata references.

**Phase 0 dependencies.** `accounts`, credentials/sessions/OTP, `markets`, Admin actors, RBAC, audit logs and entity timelines.

**Published interfaces.** `getMerchantGroup`, `getMerchantBranch`, `assertMerchantGroupOwnership`, `submitApplication`, `reviewApplication`, `submitKyc`, `reviewKyc`, `evaluateOperationalStatus`, `suspendMerchant`, `reactivateMerchant`, `recordTermsAcceptance`, and events such as `MerchantApplicationApproved`, `MerchantKycApproved`, `MerchantActivated`, `MerchantSuspended`, `MerchantClosed`.

**Other-domain interfaces.** Reads package eligibility from Package Domain and MCP eligibility/balance from MCP Domain. It cannot post ledger entries itself.

## 3. Package Domain

**Purpose and boundary.** Own reusable service-fee profile identity, versioned rates/effective periods, special approved percentages, and merchant assignment lifecycle. It does not calculate or confirm a member purchase in Phase 1.

**Entities.** `ServiceFeeProfile`, `ServiceFeePackageVersion`, `SpecialPercentage`, `MerchantPackageAssignment`.

**Invariants.** A-F are stable package codes with recorded values 2.5/5/10/15/20/25. Effective ranges for the same profile/market cannot overlap. Used versions are immutable. An assignment references exactly one standard version or special percentage. D-010 locks special percentage storage at `numeric(12,6)` and its range to rate > 0 and rate <= 100. Business increment and approval threshold remain OPEN. One active assignment is default; paused profiles are not selectable; the last active assignment cannot be paused. `PendingChange` never changes historical assignments or rates retroactively.

**Phase 0 dependencies.** `markets`, Admin RBAC, audit/timeline, exact-decimal utility.

**Published interfaces.** `resolveEffectivePackageVersion`, `listMerchantAssignments`, `assignPackage`, `setDefaultAssignment`, `requestPackageChange`, `pauseAssignment`, `resumeAssignment`.

**Other-domain interfaces.** Merchant Domain supplies branch status/market. Future Transaction Domain will resolve an effective immutable version and snapshot it; Phase 1 does not perform that transaction.

## 4. MCP Domain

**Purpose and boundary.** Own each branch's MCP account, append-only postings and recharge/refund/adjustment workflows. It does not own bank balances, payment-gateway settlement, member purchase execution, advertising operations or payouts.

**Entities.** `MCPAccount`, `MCPLedgerEntry`, `MCPRechargeRequest`, `MCPRefundRequest`, `MCPAdjustmentRequest`, `MCPAdjustmentDecision`.

**Invariants.** One MCP account per merchant branch/market. Exact numeric only. Every write has a scoped idempotency key. Ledger rows are immutable. Reversals are compensating rows. Available MCP cannot become negative. Manual credit/debit always uses maker/checker with maker != checker and no threshold. Recharge approval is a single authorized review, not maker/checker. Suspension preserves MCP. Refund Phase 1 is request/review/ledger foundation with no real money movement.

**Phase 0 dependencies.** `markets`, Admin actors, permissions/market access, audit/timeline, database transactions.

**Published interfaces.** `getMcpPosition`, `submitRecharge`, `reviewRecharge`, `recordGatewayRechargeCallback` (adapter contract only), `submitRefund`, `reviewRefund`, `submitAdjustment`, `decideAdjustment`, `executeApprovedAdjustment`, `appendReversal`.

**Other-domain interfaces.** Merchant Domain supplies branch/market/status. Future Transaction and Advertising domains may request idempotent debits through MCP application services only after their phases are authorized.

## 5. Governance cross-cutting boundary

- **RBAC evaluation:** existing `AuthGuard` + `RbacGuard`; Phase 1 permission codes are explicit endpoint metadata.
- **MarketAccess:** Admin market ID is server-validated against the target entity and active market grant; a header alone is never authoritative.
- **AuditLog and EntityTimeline:** state transitions and privileged writes are appended in the same database transaction as the domain change.
- **Maker/Checker:** adjustment request owns maker; decision owns checker; execution checks separation again inside the locked transaction.
- **Terms/disclaimer:** acceptance stores version, locale, time, IP/device evidence. Content authoring is outside this domain.
- **File access:** KYC service receives an opaque private object key from a `PrivateFileStoragePort`; DB stores metadata, classification and checksum, never binary or credentials.

## 6. File storage boundary

```ts
interface PrivateFileStoragePort {
  createUploadIntent(input: PrivateUploadIntent): Promise<OpaqueUploadIntent>;
  createShortLivedReadGrant(
    input: AuthorizedReadRequest,
  ): Promise<OpaqueReadGrant>;
  quarantine(objectKey: string, reason: string): Promise<void>;
}
```

The adapter contract must enforce private-by-default objects, authorized short-lived access, content-type/size constraints, malware-scan status, checksum and access audit. P1-S1 creates no provider adapter, bucket, cloud key, signed URL or real upload.

## 7. Dependency direction

`Phase 0 Platform Foundation -> Merchant / Package / MCP -> future Transaction, Advertising, Reward and Commission domains`. Future domains depend on Phase 1 interfaces; Phase 1 must not depend on their implementation.
