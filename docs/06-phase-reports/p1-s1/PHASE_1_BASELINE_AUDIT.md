---
title: Phase 1 Baseline Audit
phase: P1-S1
status: planning-only
implementation_authorized: false
baseline_sha: 46912b557227954e392ed622189eda82892cd717
date: 2026-07-16
---

# Phase 1 Baseline Audit

## 1. Audit conclusion

Phase 0 is a usable technical foundation for Phase 1 planning. It provides identity, authentication, market registry, three-dimensional Admin access control, append-only audit/timeline primitives, explicit Drizzle schema, and checksum-controlled SQL migrations. It intentionally contains no Merchant, MCP, package, transaction, payment, or storage-provider business implementation.

This document is a readiness assessment only. Phase 1 implementation remains **NOT AUTHORIZED**.

## 2. Accepted reusable baseline

| Capability      | Existing artifact                                              | Phase 1 use                                                                       | Readiness                                  |
| --------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------ |
| Accounts        | `accounts`                                                     | Merchant login identity; public account ID remains separate from Merchant ID      | Usable                                     |
| Credentials     | `credentials`                                                  | Password hash only; immutable merchant login email policy is a domain rule to add | Usable                                     |
| Sessions        | `sessions`                                                     | Access/refresh session resolution, expiry, revocation                             | Usable                                     |
| OTP             | `otps`                                                         | Email verification/password reset/step-up foundation                              | Usable                                     |
| Security events | `security_events`                                              | Login and authentication evidence                                                 | Usable                                     |
| Markets         | `markets`                                                      | Market, ISO currency, IANA timezone and locale reference                          | Usable                                     |
| Admin identity  | `admin_users`                                                  | Reviewer, maker and checker identity                                              | Usable                                     |
| RBAC            | `roles`, `permissions`, `role_permissions`, `role_assignments` | Action-permission evaluation                                                      | Usable; Phase 1 permissions must be seeded |
| Market access   | `market_access`                                                | Server-side Admin market scope                                                    | Usable                                     |
| Audit           | `audit_logs`                                                   | Privileged before/after/reason/result/request evidence                            | Usable                                     |
| Timeline        | `entity_timelines`                                             | Merchant, KYC, MCP and request history                                            | Usable                                     |

## 3. Auth guard and RBAC assessment

- `AuthGuard` requires a Bearer access token and resolves an active session actor.
- `RbacGuard` is deny-by-default when no permission metadata is present, requires an Admin actor, and can require a market ID from route or `X-Market-Id`.
- `RbacService` evaluates active Admin, active account, active role assignment, permission code, active market grant, and active market.
- `RequirePermission()` already supports the Phase 1 naming pattern such as `merchant.view` and `merchant.mcp.adjust`.
- Merchant self-service ownership/branch-scope authorization does not yet exist and must be a separate guard/policy in implementation; Admin RBAC must not be reused as merchant ownership authorization.
- Existing audit writes `audit_logs` and `entity_timelines` in the caller transaction and redacts sensitive values.

## 4. Migration ownership

| Migration                             | Purpose                                                               | Status                                              |
| ------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| `0000_database_foundation.sql`        | Generic identity, auth, market, Admin RBAC, audit and timeline tables | Existing, checksum locked                           |
| `0001_auth_session_access_expiry.sql` | Adds mandatory access-token session expiry                            | Existing, checksum locked                           |
| `0002_*`                              | First Phase 1 schema extension                                        | Reserved as next migration ID; not created in P1-S1 |

The migration runner applies explicit SQL files in filename order, records filename/checksum in `database_migrations`, rejects altered applied migrations, and wraps each migration in a transaction. `checksums.json` currently contains exactly `0000` and `0001`.

## 5. Phase 1 gaps

### Merchant

- Branch/public Merchant ID, optional reserved `group_id`, application, KYC, private document metadata, profile/media metadata, status history, referral, terms/disclaimer acceptance.
- Merchant ownership guard, application/KYC services, status transition policy, private file adapter port, and Admin review services.

### Package

- Standard A-F package definitions, versioned rates/effective periods, approved special percentages, merchant assignments, default/active/paused/pending-change behavior, and overlap/conflict validation.

### MCP

- MCP account and append-only ledger; recharge, refund foundation, manual adjustment request/decision; idempotency, concurrency locking, balance projection, maker/checker execution, and reconciliation contracts.

### Cross-cutting

- Phase 1 permission seeds; merchant branch authorization; terms version records; notification port; file metadata/access policy; domain errors/events; outbox decision for later implementation.

## 6. Business-logic leakage verification

The accepted Phase 0 schema guard rejects `member`, `merchant`, `wallet`, `commission`, and `ipoint` from production migration `0000`. Repository inspection confirms:

- no Merchant/KYC/package/MCP production tables;
- no MCP ledger or balance implementation;
- no transaction, receipt, payment, refund, storage, messaging, AI, or external provider integration;
- only generic decimal helpers and an isolated ORM comparison experiment exist outside production paths;
- Merchant/Member apps are placeholder shells.

Result: **PASS — no Phase 1 business logic leaked into the Phase 0 baseline.**

## 7. Constraints carried forward

- PostgreSQL source of truth; Drizzle schema plus explicit reviewable SQL migration.
- UUID internal keys and separate public identifiers.
- Market-scoped business records carry `market_id`.
- Exact PostgreSQL `numeric`; never JavaScript floating point for value calculations.
- Ledger/audit/history are append-only; corrections use compensating entries.
- UTC timestamps; market timezone only for business-time evaluation.
- No production cloud keys, payment calls, payout, refund execution, or real notification send in the planning scope.
