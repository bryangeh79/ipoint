---
title: Phase 1 Acceptance Plan
phase: P1-S1
status: planning-only
implementation_authorized: false
date: 2026-07-16
---

# Phase 1 Acceptance Plan

## 1. Acceptance boundary

This plan defines evidence for a future authorized Phase 1 implementation. P1-S1 itself is accepted by document completeness, rule compliance, Git scope and remote verification; it does not execute Phase 1 business tests.

## 2. Unit-test targets

| Module        | Required targets                                                                                                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merchant      | MerchantGroup ownership/default creation, public Merchant ID uniqueness, immutable Account email, independent Application/KYC/Operational transitions, activation policy, suspension/closure behavior |
| Package       | Exact decimal validation, non-overlapping versions, effective resolution, standard/special exclusive assignment, default selection, last-active pause rejection, pending-change behavior              |
| MCP           | Direction/delta table, exact arithmetic, idempotency payload mismatch, negative-balance rejection, reversal rules, freeze/unfreeze projection, maker/checker separation, no-threshold invariant       |
| RBAC          | Permission deny-by-default, active role/account/market checks, entity/header market mismatch, merchant ownership isolation                                                                            |
| Files/consent | Private classification, metadata validation, unauthorized read denial, terms version evidence, audit redaction                                                                                        |

## 3. Integration-test targets

- Fresh `0000 -> 0001 -> 0002` and upgrade-from-`0001`; idempotent migrate/seed/checksum/drift.
- Foreign keys, unique/exclusion/check constraints and append-only triggers.
- Account owns MerchantGroup, MerchantGroup owns many branches, single-branch registration creates a default group, and no unique constraint exists on a branch Account ID.
- Application Review changes only Application Status; KYC Review changes only KYC Status; activation policy derives Operational Status.
- Approved Application + approved KYC + MCP >= 100 derives `ACTIVE`; suspension/reactivation affect only Operational Status and suspension preserves MCP.
- Append-only tables reject `UPDATE` and `DELETE`, contain no soft-delete column, and use compensation instead of mutation.
- Atomic KYC review/status history/audit/timeline.
- Concurrent activation versus suspension/closure; optimistic-version conflict.
- Concurrent package default/pause operations leave exactly one active default.
- Concurrent MCP debits/adjustments serialize by account and never create negative available MCP.
- Same idempotency key/same payload returns one posting; different payload is rejected.
- Recharge approval writes exactly one credit without maker/checker.
- Manual Credit and Debit cannot execute without distinct maker/checker.
- Refund approval creates foundation evidence only and never calls a real provider.
- Reconciliation reproduces total/available/frozen positions and detects tampering.

## 4. E2E scenarios

### Authorized Phase 1 golden path

1. Merchant registers and accepts versioned terms/disclaimer.
2. Merchant submits profile, KYC and private document metadata.
3. Admin with correct permission and market access independently approves the application and KYC.
4. Merchant submits recharge request; authorized Admin approves; one MCP credit posts.
5. Merchant becomes Active when configured activation condition is met.
6. Admin assigns approved service-fee version; merchant sees active/default profile.
7. Merchant and Admin can trace status, request, ledger, audit and timeline evidence.

### Negative paths

- Wrong-market Admin denied; missing action permission denied.
- KYC rejection permits a new submission version but preserves old review history.
- Suspended merchant can view state/MCP but cannot initiate prohibited operations; balance unchanged.
- Duplicate recharge callback/request does not duplicate credit.
- Maker attempts own approval: denied; both Credit and Debit covered at small and large amounts.
- Refund review produces no bank/gateway movement.
- MerchantGroup ownership grants access only through explicit group/branch ownership checks; it grants no group-level permissions, shared MCP or group settlement.
- `PATCH /merchant/me/profile` with `primary_email`, `login_email` or equivalent is rejected and leaves Account email unchanged.
- Admin cannot modify Merchant primary email through profile or merchant-management inputs.
- Suspend and reactivate leave Application/KYC statuses and MCP position unchanged; reactivation deterministically reevaluates Operational Status.

Transaction/QR completion is a later-phase E2E and must not be faked in Phase 1.

## 5. Admin PRD AC mapping

| AC    | Phase 1 evidence                                                      | Disposition                                                     |
| ----- | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| AC-01 | Permission + market-access integration/E2E denial and success matrix  | Full Phase 1                                                    |
| AC-02 | Maker != checker for manual MCP Credit/Debit, no threshold exceptions | Full MCP; iPoint deferred                                       |
| AC-03 | Reward job reads effective rate/version                               | Deferred to iPoint Reward phase                                 |
| AC-04 | Reward history unaffected by rate change                              | Deferred                                                        |
| AC-05 | Redemption snapshot                                                   | Deferred                                                        |
| AC-06 | Standard and special merchant assignments coexist                     | Full Phase 1                                                    |
| AC-07 | Package version/rate snapshot in transaction                          | Phase 1 provides immutable versions; transaction proof deferred |
| AC-08 | Commission source/rule chain                                          | Deferred                                                        |
| AC-09 | Ledger/rule/history update/delete rejection                           | MCP/package full; other domains deferred                        |
| AC-10 | Job retry/no duplicate reward                                         | MCP idempotency covered; reward job deferred                    |
| AC-11 | High-risk action in AuditLog and Timeline                             | Full Phase 1                                                    |
| AC-12 | Emergency module pause                                                | Deferred; suspension/status controls only                       |

## 6. Merchant PRD acceptance mapping

| Merchant requirement                                       | Phase 1 acceptance                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Registration/KYC/profile                                   | Default MerchantGroup + branch ownership, split reviews, rejection/resubmission, immutable email and private file checks |
| Application Approved + KYC Approved + MCP >= 100 -> Active | Deterministic activation integration/E2E; suspend/reactivate affect only Operational Status                              |
| One branch = one Merchant ID                               | Unique/public-ID and isolation tests                                                                                     |
| Multiple profiles/default/pause                            | Package unit/integration tests; last active cannot pause                                                                 |
| MCP wallet/ledger/top-up/refund                            | Exact, idempotent, immutable foundation tests                                                                            |
| Suspension preserves MCP                                   | E2E position equality before/after suspension                                                                            |
| Transaction success + MCP deduction                        | Deferred to Transaction Engine                                                                                           |
| Advertising/analytics/POS/Bridge                           | Deferred                                                                                                                 |

## 7. CI strategy

- Existing `quality`: format, lint, typecheck, build and unit tests.
- New `merchant-domain`: focused unit tests plus PostgreSQL integration for merchant/package/KYC/RBAC/file metadata.
- New `mcp-domain`: PostgreSQL integration for ledger concurrency, idempotency, maker/checker, reversal and reconciliation.
- Existing database job: migration checksum, fresh/upgrade migrate, seed twice, drift.
- E2E job: Phase 1 golden and negative paths with no real external side effects.
- Jobs use Node 24 LTS and ephemeral PostgreSQL; failure logs are retained and no failing gate is hidden.

## 8. P1-S1 document acceptance checks

- Exactly the required ten Markdown deliverables exist with YAML frontmatter.
- All `implementation_authorized` values are false and scope matrix implementation cells are NO.
- No file outside `docs/06-phase-reports/p1-s1/` differs from baseline.
- No migration, API, schema or production code file is created.
- Forbidden Phase 1 features are explicitly deferred.
- Branch is committed, pushed, and remote SHA matches local HEAD.
