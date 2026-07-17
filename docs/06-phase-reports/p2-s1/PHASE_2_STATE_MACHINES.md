---
title: Phase 2 State Machines
phase: P2-S1
status: freeze
implementation_authorized: false
date: 2026-07-17
---

# Phase 2 State Machines

## 1. Common transition rules

- Validate the current state before every transition.
- Validate actor type, permission, and market context.
- Use optimistic locking or equivalent transactional locking.
- Append audit and timeline evidence in the same logical transaction.
- Do not silently rewrite history.

## 2. Member status

States:

- `PENDING_EMAIL_VERIFICATION`
- `ACTIVE`
- `SUSPENDED`
- `CLOSED`

### Transition table

| From | To | Trigger | Guards | Evidence |
|---|---|---|---|---|
| `PENDING_EMAIL_VERIFICATION` | `ACTIVE` | Email OTP verified and registration completed | OTP single-use, validated market, consent captured | Audit, timeline, registration snapshot |
| `ACTIVE` | `SUSPENDED` | Admin suspend | Admin permission and market access required | Audit, timeline, reason |
| `SUSPENDED` | `ACTIVE` | Admin reactivate | Admin permission and market access required | Audit, timeline, reason |
| `ACTIVE` | `CLOSED` | Admin close or governed closure path | Closure policy must be explicit | Audit, timeline, terminal evidence |
| `SUSPENDED` | `CLOSED` | Admin close after suspension | Closure policy must be explicit | Audit, timeline, terminal evidence |

### Notes

- Member status is independent from KYC level.
- Closing is terminal.
- Suspended members must not be able to bypass permission checks through cached sessions.

## 3. KYC status

States:

- `NOT_STARTED`
- `DRAFT`
- `SUBMITTED`
- `UNDER_REVIEW`
- `APPROVED`
- `REJECTED`
- `MORE_INFO_REQUIRED`
- `REVERIFICATION_REQUIRED`

### Transition table

| From | To | Trigger | Guards | Evidence |
|---|---|---|---|---|
| `NOT_STARTED` | `DRAFT` | Member begins KYC | Member authenticated | Draft snapshot |
| `DRAFT` | `SUBMITTED` | Member submits | Required fields and documents present | Submission snapshot, document refs |
| `SUBMITTED` | `UNDER_REVIEW` | Admin claims case | Admin permission and market access required | Review-start audit |
| `UNDER_REVIEW` | `APPROVED` | Admin approves | Reviewer is authorized | Review decision, timeline |
| `UNDER_REVIEW` | `REJECTED` | Admin rejects | Reason required | Review decision, timeline |
| `UNDER_REVIEW` | `MORE_INFO_REQUIRED` | Admin requests more info | Reason required | Review decision, timeline |
| `MORE_INFO_REQUIRED` | `SUBMITTED` | Member resubmits | New snapshot required | New submission version |
| `APPROVED` | `REVERIFICATION_REQUIRED` | Policy requires re-check | Policy-driven | Timeline, audit |
| `REVERIFICATION_REQUIRED` | `UNDER_REVIEW` | Admin starts review | Authorized reviewer | Review-start audit |

### Notes

- KYC status and member status must remain separate.
- Level 1 may be satisfied by email verification, but the KYC case still tracks submission and review workflow.
- Level 2 approval depends on the approved identity, contact, address, and document set.

## 4. Account-country change request

States:

- `PENDING`
- `APPROVED`
- `REJECTED`
- `CANCELLED`

### Transition table

| From | To | Trigger | Guards | Evidence |
|---|---|---|---|---|
| `PENDING` | `APPROVED` | Admin approves | Market access and review permission required | Before/after values, reason |
| `PENDING` | `REJECTED` | Admin rejects | Review permission required | Reason, reviewer, timeline |
| `PENDING` | `CANCELLED` | Member cancels | Request still pending | Cancellation evidence |

### Notes

- Approval updates the authoritative account country.
- Request history is retained even after approval.
- The request may not be reused for a different country.

## 5. QR identity

States:

- `ACTIVE`
- `ROTATED`
- `REVOKED`

### Transition table

| From | To | Trigger | Guards | Evidence |
|---|---|---|---|---|
| `ACTIVE` | `ROTATED` | Member rotates QR or admin forces rotation | New token must be unpredictable | Rotation audit and new active row |
| `ACTIVE` | `REVOKED` | Member or admin revokes QR | Revocation reason required | Revocation audit |
| `ROTATED` | `REVOKED` | Old token expires or is revoked | Historical row stays immutable | Timeline |

### Notes

- Only one QR identity may be active at a time.
- Rotation creates a new active token and deactivates the old one.
- The QR payload must not reveal email, phone, or internal IDs.

## 6. Referral relationship

States:

- `ACTIVE`
- `CORRECTED`
- `VOIDED`

### Rules

- One direct referrer per member.
- No self-referral.
- No referral cycles.
- Admin correction must be explicit, reasoned, and auditable.
- Referral correction does not create commission behavior in this phase.

## 7. Terms and disclaimer acceptance

States:

- `ACCEPTED`
- `SUPERSEDED`

Rules:

- Acceptance is versioned.
- A later document version creates a new acceptance row.
- Older acceptances remain for audit.

