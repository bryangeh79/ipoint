---
title: Phase 2 Test and E2E Matrix
phase: P2-S1
status: freeze
implementation_authorized: false
date: 2026-07-17
---

# Phase 2 Test and E2E Matrix

## 1. Testing goals

- Prove the member contract is stable before implementation.
- Prove the account-country and current-market separation.
- Prove referral and QR rules are safe.
- Prove referral history is preserved during correction.
- Prove KYC and admin review flows are auditable.
- Prove sensitive data does not leak in logs or responses.

## 2. Unit test matrix

| Area | Cases |
|---|---|
| Auth | OTP expiry, OTP attempt limits, login success/failure, closed account login denied, refresh rotation, logout revocation, password reset handoff |
| Member status | PENDING_EMAIL_VERIFICATION -> ACTIVE, ACTIVE -> SUSPENDED, SUSPENDED -> ACTIVE, CLOSED terminal behavior |
| Profile | Immutable fields rejected, mutable fields accepted, masking rules applied |
| Market selection | Enabled market accepted, disabled market rejected, current market persisted correctly, session/request context derived from persisted value |
| Referral | Self-referral blocked, cycles blocked, single active referrer enforced, correction history preserved |
| QR | Token unpredictability, manual rotation, revocation, one active QR only, no plaintext token storage |
| KYC | Draft submit, resubmit, approval, rejection, more-info, reverification |
| Country change | Pending, single pending request enforced, approve, reject, cancel, conflict handling |
| Audit | Audit payload contents, redaction, actor and market consistency |
| Member closure | CLOSED blocks login and business operations, audit-only visibility remains |

## 3. Integration test matrix

| Area | Cases |
|---|---|
| Auth and member bootstrap | Registration, OTP verification, login, refresh, logout, password reset |
| Member self-service | Read and edit profile, switch market, request QR rotation, submit KYC, request country change |
| Admin review | List members, review KYC, review country changes, suspend/reactivate, referral correction with preserved history |
| Discovery | Current-market merchant discovery only, branch detail correctness, deterministic stable ordering |
| Security | Permission denied, market access denied, suspension denial, invalid ownership, request replay |

## 4. E2E scenarios

### 4.1 Happy path

1. Register member.
2. Verify email OTP.
3. Log in and create a session.
4. Fetch member summary.
5. Update profile.
6. Switch current market.
7. Verify the persisted current market is also the derived session/request context.
8. Submit KYC level 2.
9. Rotate QR identity manually.
10. Request account-country change.
11. Admin reviews KYC and country change.
12. Admin corrects referral while preserving history.
13. Admin suspends and reactivates member.

### 4.2 Negative path

1. Submit registration with disabled market.
2. Attempt OTP replay.
3. Attempt login with invalid credentials.
4. Attempt market switch to disabled market.
5. Attempt self-referral.
6. Attempt referral correction that would create a cycle.
7. Attempt QR rotation after revocation.
8. Attempt KYC submit with missing documents.
9. Attempt admin review without permission or market access.
10. Attempt account-country change while another request is pending.
11. Attempt protected access after suspension.
12. Attempt protected access after closure.

### 4.3 Sensitive-data path

1. Create KYC documents.
2. Request signed URL access.
3. Verify object key is not exposed to unauthorized responses.
4. Verify logs redact document secrets and token values.
5. Verify closed-member responses only expose closed status and support entry, not business actions.

## 5. Acceptance gates

- Auth contract tests
- Member service tests
- Admin review tests
- Audit redaction tests
- Market access tests
- E2E browser tests

## 6. Coverage notes

- Every state transition must have at least one positive test and one negative test.
- Every admin action must verify market access and permission checks.
- Every sensitive response must be checked for redaction or masking.
- No test should depend on production providers or real external sends.
