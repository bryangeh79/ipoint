---
title: Phase 2 Open Questions
phase: P2-S1
status: freeze
implementation_authorized: false
date: 2026-07-17
---

# Phase 2 Open Questions

## O-01: Current market persistence model

| Field | Value |
|---|---|
| ID | O-01 |
| Description | Current Market persistence in `member_market_preferences` is the single source of truth. Session and request context may read or derive Current Market, but Session must not become an independent authoritative source. Current Market switch must persist on success, and cache must not be the source of truth. |
| Impact | Member market switching, discovery, and request/session drift prevention |
| Status | RESOLVED |
| Resolution Decision ID | D-015 |
| Resolution | `member_market_preferences` is authoritative; Session and Request Context only derive Current Market; cache is never the source of truth. |

## O-02: QR token format and rotation policy

| Field | Value |
|---|---|
| ID | O-02 |
| Description | QR uses an unpredictable opaque token. The database stores the public QR identity and token hash. No plaintext token is stored, no internal DB ID appears in the QR, and no email, phone, or sensitive data appears in the QR. Phase 2 supports manual rotation and revocation only; automatic periodic rotation is deferred. Short-lived transaction challenge remains deferred to the Transaction Phase. |
| Impact | QR rendering, revocation, merchant verification, and token secrecy |
| Status | RESOLVED |
| Resolution Decision ID | D-015 |
| Resolution | Store only public QR identity plus token hash; allow manual rotation and revocation; defer periodic rotation and transaction challenge behavior. |

## O-03: KYC retention and purge policy

| Field | Value |
|---|---|
| ID | O-03 |
| Description | KYC retention per market is determined by Legal. The system must support per-market retention policy. Do not hard-code retention years without a Legal decision. This does not block P2-S2 basic schema design, but config and audit capability must be preserved. |
| Impact | KYC storage, compliance, and archival policy |
| Status | LEGAL_DECISION_REQUIRED |
| Decision needed by | Before KYC implementation hardcodes any retention rule |

## O-04: Merchant discovery ranking rules

| Field | Value |
|---|---|
| ID | O-04 |
| Description | Merchant Discovery MVP sort order is Admin display order or featured order if the model supports it, with a stable default sort and merchant or branch name as a deterministic fallback. Personalization, behavioral algorithms, ad bidding, and AI sorting are prohibited. |
| Impact | Member discovery ordering and merchant list behavior |
| Status | RESOLVED |
| Resolution Decision ID | D-015 |
| Resolution | Use stable admin/featured ordering first, then deterministic name fallback; no personalization or paid ranking. |

## O-05: Country-change review SLA and cooldown

| Field | Value |
|---|---|
| ID | O-05 |
| Description | Each member may have at most 1 pending Account Country change request. A pending period blocks duplicate requests. Rejected requests may be re-applied. MVP does not set a hardcoded cooldown; SLA is operational configuration, not hardcoded business logic. |
| Impact | Admin workload, abuse control, and request gating |
| Status | RESOLVED |
| Resolution Decision ID | D-015 |
| Resolution | Enforce one pending request at a time; reject duplicates while pending; allow re-application after rejection; keep cooldown operational only. |

## O-06: Closed-member behavior

| Field | Value |
|---|---|
| ID | O-06 |
| Description | CLOSED member cannot log in or perform any business operation. Data is retained for audit, legal, and customer service. Authorized Admin can view it. Member side only shows account closed status and customer service entry. Referral Code and QR are no longer valid, and CLOSED cannot auto-recover. |
| Impact | Authentication, member operations, support, and audit visibility |
| Status | RESOLVED |
| Resolution Decision ID | D-015 |
| Resolution | CLOSED is terminal, business-denying, and support-visible only to authorized admins. |

