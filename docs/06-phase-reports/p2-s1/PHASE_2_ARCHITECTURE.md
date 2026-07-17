---
title: Phase 2 Architecture
phase: P2-S1
status: freeze
implementation_authorized: false
date: 2026-07-17
---

# Phase 2 Architecture

## 1. Architecture objective

Member Core must be a modular domain inside the existing modular monolith.

The architecture must preserve:

- one platform account per member
- account-country separation from current market
- current market persistence in member market preferences as the single source of truth
- server-side authorization
- immutable auditability
- append-only timeline evidence
- safe use of the existing auth, RBAC, market access, and merchant discovery foundations
- no wallet, reward, commission, settlement, or other Phase 2 money-moving behavior

## 2. Domain boundaries

### 2.1 Identity and session boundary

Owns:

- account registration
- email verification OTP
- login
- refresh token rotation
- logout
- password reset

Reuses the current auth module and session store patterns.

### 2.2 Member core boundary

Owns:

- member public identity
- member status
- profile
- market preferences
- current market selection
- referral code, active referrer linkage, and immutable referral history
- QR identity lifecycle
- KYC case and document workflow
- account-country change request workflow

This boundary must not own transaction, reward, commission, or payment behavior.

### 2.3 Merchant discovery boundary

Owns read-only discovery of enabled merchant branches for the member's current market.

It may consume merchant read models from the merchant domain, but it must not mutate merchant data.
Discovery must use a stable default sort order with deterministic branch or merchant name fallback. No personalization, ad bidding, behavioral ranking, or paid ranking is allowed in Phase 2.

### 2.4 Admin member operations boundary

Owns:

- member search
- suspend and reactivate
- referral correction
- account-country change review
- KYC review
- member timeline and audit visibility

All admin operations remain subject to role, permission, and market-access enforcement.

## 3. Cross-cutting services

### 3.1 RBAC and market access

The current `RbacGuard` and market-access enforcement model is the correct baseline.

Phase 2 must preserve:

- role check
- permission check
- market access check
- resource-level ownership check for member self-service routes

### 3.2 Audit and timeline

Every privileged or state-changing member action must emit:

- an audit log row
- an entity timeline row
- a domain event or append-only history entry when the domain requires it

### 3.3 Sensitive-data handling

Sensitive member data includes:

- email
- phone
- address
- government identity fields
- KYC documents
- QR tokens
- account-country review notes

Sensitive fields must be redacted in logs and masked in non-privileged responses.

## 4. Existing system reuse

### 4.1 Auth reuse

Use the existing auth patterns for:

- password hashing
- OTP issuance and verification
- refresh token rotation
- logout invalidation
- password reset handoff

The member auth namespace should be contract-compatible with the existing auth envelope and error handling.

### 4.2 Merchant reuse

Use the merchant module's patterns for:

- ownership validation
- idempotency keys
- transactional audit writes
- masked document responses
- branch-based discovery dependencies

### 4.3 Database reuse

Reuse the current database authority:

- `accounts` for auth identity and account country
- `credentials`, `sessions`, `otps` for auth/session flows
- `markets` for enabled-market resolution
- `member_market_preferences` for current market and enabled-market persistence
- `member_referrals` and `member_referral_history` for current direct referrer state and immutable correction history
- `audit_logs` and `entity_timelines` for governance evidence

## 5. Proposed member-core module map

| Module                | Responsibility                              | Read dependencies                  | Write dependencies                                                            |
| --------------------- | ------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| Member Identity       | member public record and lifecycle          | accounts, auth session context     | members, status history, audit, timeline                                      |
| Member Profile        | profile fields and contact data             | members, accounts                  | member_profiles, audit, timeline                                              |
| Member Market Context | current market and preferences              | markets, member preference records | member_market_preferences, audit, timeline                                    |
| Member Referral       | referral code, active referrer, and history | accounts, members                  | member_referrals, member_referral_history, audit, timeline                    |
| Member QR             | QR identity lifecycle                       | members                            | member_qr_identities, audit, timeline                                         |
| Member KYC            | KYC case workflow and documents             | members, markets                   | member_kyc_cases, member_kyc_documents, audit, timeline                       |
| Country Review        | account-country change request              | accounts, markets, admins          | member_account_country_change_requests, audit, timeline                       |
| Discovery             | merchant read-only discovery                | merchants, markets                 | none                                                                          |
| Admin Member Ops      | search and governed state changes           | members, markets, audit, timelines | member status, KYC, QR, country review, referral correction, closure handling |

## 6. Data flow

### 6.1 Registration flow

1. Public visitor requests member registration.
2. System validates enabled market and verifies email OTP.
3. System creates or confirms the account identity.
4. System creates the member aggregate with Member ID, referral code, status, and account-country assignment.
5. System creates the initial profile and market preference records, including exactly one current market row marked as current.
6. System records consent, audit, and timeline evidence.

### 6.2 Current market flow

1. Authenticated member requests enabled markets.
2. System resolves allowed markets from market status and member preference.
3. Member selects current market.
4. Server persists the current market selection to member market preferences and derives request/session context from that source of truth.
5. Discovery and future member surfaces read from that context.

### 6.3 KYC flow

1. Member creates or edits a draft KYC case.
2. Member submits evidence and documents.
3. Admin reviews the case.
4. Case outcome updates KYC state only.
5. Audit, timeline, and document access control are preserved.

### 6.4 Account-country change flow

1. Member submits a change request.
2. Admin reviews current and requested country values.
3. Approved requests update the authoritative account country.
4. The change is fully audited and timeline-tracked.

### 6.5 Referral correction flow

1. Admin proposes a correction for the member's direct referrer.
2. Server validates no self-referral and no referral cycle in the same transaction.
3. The current referral row is updated only after an immutable history row is appended.
4. The correction captures `old_referrer_member_id`, `new_referrer_member_id`, `correction_reason`, `authorized_actor`, `request_id`, and `occurred_at`.
5. Future commission systems must read referral history at transaction time; Phase 2 does not calculate commission.

## 7. Architecture constraints

- No member data may be mutated by merchant or admin modules directly.
- No client-provided market identifier is authoritative without server validation.
- No QR payload may include internal IDs, email, phone, or other direct identifiers.
- No QR payload may include sensitive data or plaintext token material.
- No KYC document binary is stored in the relational database.
- No implementation may blur Account Country and Current Market into one field.
- No implementation may use `primary_market_id` as an ambiguous current-market field.
- No state transition may be accepted without audit and timeline evidence.
- No referral correction may overwrite history without an immutable audit trail.

## 8. Reuse summary

This phase should reuse the existing infrastructure for identity, security, audit, and merchant discovery patterns rather than inventing a separate stack.

The main design decision is domain separation, not technology replacement.
