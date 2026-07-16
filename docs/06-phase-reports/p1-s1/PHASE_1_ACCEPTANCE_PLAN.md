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

| Module        | Required targets                                                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merchant      | Public Merchant ID uniqueness, immutable login email, KYC submit/reject/resubmit, activation conditions, valid transitions, suspension/closure behavior, group reservation non-behavior         |
| Package       | Exact decimal validation, non-overlapping versions, effective resolution, standard/special exclusive assignment, default selection, last-active pause rejection, pending-change behavior        |
| MCP           | Direction/delta table, exact arithmetic, idempotency payload mismatch, negative-balance rejection, reversal rules, freeze/unfreeze projection, maker/checker separation, no-threshold invariant |
| RBAC          | Permission deny-by-default, active role/account/market checks, entity/header market mismatch, merchant ownership isolation                                                                      |
| Files/consent | Private classification, metadata validation, unauthorized read denial, terms version evidence, audit redaction                                                                                  |

## 3. Integration-test targets

- Fresh `0000 -> 0001 -> 0002` and upgrade-from-`0001`; idempotent migrate/seed/checksum/drift.
- Foreign keys, unique/exclusion/check constraints and append-only triggers.
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
3. Admin with correct permission and market access approves KYC.
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
- Group ID never grants cross-branch access or shared MCP.

Transaction/QR/receipt completion is a later-phase E2E and must not be faked in Phase 1.

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

| Merchant requirement                           | Phase 1 acceptance                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| Registration/KYC/profile                       | Golden path + rejection/resubmission + private file checks                          |
| KYC Approved + initial MCP condition -> Active | Activation integration/E2E; condition is configurable policy, not scattered literal |
| One branch = one Merchant ID                   | Unique/public-ID and isolation tests                                                |
| Multiple profiles/default/pause                | Package unit/integration tests; last active cannot pause                            |
| MCP wallet/ledger/top-up/refund                | Exact, idempotent, immutable foundation tests                                       |
| Suspension preserves MCP                       | E2E position equality before/after suspension                                       |
| Transaction success + MCP deduction            | Deferred to Transaction Engine                                                      |
| Advertising/analytics/POS/Bridge               | Deferred                                                                            |

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
