---
title: Phase 2 API Contract
phase: P2-S1
status: freeze
implementation_authorized: false
api_base: /api/v1
date: 2026-07-17
---

# Phase 2 API Contract

## 1. API principles

- Use versioned REST endpoints.
- Keep request and response envelopes stable.
- Require server-side validation for all inputs.
- Require idempotency for all retryable write operations.
- Never trust client-provided market or status values without server validation.
- Never expose raw KYC documents, QR tokens, or private account-country review notes in list responses.

## 2. Standard envelopes

### Success

```json
{
  "data": {},
  "meta": {},
  "requestId": "req_xxx"
}
```

### Error

```json
{
  "error": {
    "code": "MEMBER_CONFLICT",
    "message": "Member profile already exists.",
    "details": {}
  },
  "requestId": "req_xxx"
}
```

## 3. Common route families

### 3.1 Member auth

Planned member-scoped aliases over the existing auth service.

| Method | Path                                  | Actor         | RBAC         | MarketAccess                      | Request schema                      | Response schema           | Errors                                                                     | Idempotency | Audit | Sensitive handling                | Pagination |
| ------ | ------------------------------------- | ------------- | ------------ | --------------------------------- | ----------------------------------- | ------------------------- | -------------------------------------------------------------------------- | ----------- | ----- | --------------------------------- | ---------- |
| POST   | `/auth/member/register`               | Public        | None         | Market resolved from request body | `MemberRegisterRequest`             | `MemberRegisterResponse`  | `AUTH_*`, `MARKET_INVALID`, `OTP_INVALID`, `CONFLICT`                      | Required    | Yes   | Hide OTP secret and password data | No         |
| POST   | `/auth/member/otp/issue`              | Public        | None         | Market optional                   | `MemberOtpIssueRequest`             | `MemberOtpIssueResponse`  | `AUTH_RATE_LIMITED`, `VALIDATION`                                          | Required    | Yes   | Never reveal account existence    | No         |
| POST   | `/auth/member/otp/verify`             | Public        | None         | N/A                               | `MemberOtpVerifyRequest`            | `MemberOtpVerifyResponse` | `OTP_INVALID`, `OTP_EXPIRED`                                               | Required    | Yes   | No OTP code echo                  | No         |
| POST   | `/auth/member/login`                  | Public        | None         | N/A                               | `MemberLoginRequest`                | `MemberLoginResponse`     | `AUTH_INVALID_CREDENTIALS`, `AUTH_ACCOUNT_INACTIVE`, `AUTH_ACCOUNT_CLOSED` | Required    | Yes   | No account enumeration            | No         |
| POST   | `/auth/member/refresh`                | Public        | None         | N/A                               | `MemberRefreshRequest`              | `MemberRefreshResponse`   | `AUTH_SESSION_INVALID`, `AUTH_REFRESH_REUSED`                              | Required    | Yes   | Rotate tokens only                | No         |
| POST   | `/auth/member/logout`                 | Authenticated | Session only | N/A                               | none                                | 204                       | `AUTH_SESSION_INVALID`                                                     | Optional    | Yes   | Revoke session family             | No         |
| POST   | `/auth/member/password-reset/request` | Public        | None         | N/A                               | `MemberPasswordResetRequest`        | 202 envelope              | `AUTH_RATE_LIMITED`                                                        | Required    | Yes   | Hide email existence              | No         |
| POST   | `/auth/member/password-reset/confirm` | Public        | None         | N/A                               | `MemberPasswordResetConfirmRequest` | 204                       | `AUTH_*`                                                                   | Required    | Yes   | No password echo                  | No         |

### 3.2 Member self-service

| Method | Path                                 | Actor                | RBAC           | MarketAccess         | Request schema                     | Response schema               | Errors                                                                          | Idempotency | Audit | Sensitive handling                                                | Pagination |
| ------ | ------------------------------------ | -------------------- | -------------- | -------------------- | ---------------------------------- | ----------------------------- | ------------------------------------------------------------------------------- | ----------- | ----- | ----------------------------------------------------------------- | ---------- |
| GET    | `/members/me`                        | Authenticated member | Ownership only | N/A                  | none                               | `MemberMeResponse`            | `MEMBER_NOT_FOUND`, `MEMBER_SUSPENDED`, `MEMBER_CLOSED`, `AUTH_SESSION_INVALID` | No          | Yes   | Mask sensitive profile fields                                     | No         |
| GET    | `/members/me/profile`                | Authenticated member | Ownership only | N/A                  | none                               | `MemberProfileResponse`       | `MEMBER_NOT_FOUND`, `MEMBER_CLOSED`                                             | No          | Yes   | Own profile only                                                  | No         |
| PATCH  | `/members/me/profile`                | Authenticated member | Ownership only | N/A                  | `UpdateMemberProfileRequest`       | `MemberProfileResponse`       | `VALIDATION`, `CONFLICT`, `MEMBER_SUSPENDED`, `MEMBER_CLOSED`                   | Required    | Yes   | Reject attempts to change immutable fields                        | No         |
| GET    | `/members/me/market`                 | Authenticated member | Ownership only | Enabled-market check | none                               | `MemberMarketResponse`        | `MARKET_DISABLED`, `MEMBER_SUSPENDED`, `MEMBER_CLOSED`                          | No          | Yes   | No secrets                                                        | No         |
| PATCH  | `/members/me/market`                 | Authenticated member | Ownership only | Enabled-market check | `SwitchMemberMarketRequest`        | `MemberMarketResponse`        | `MARKET_INVALID`, `MARKET_DISABLED`, `MEMBER_CLOSED`                            | Required    | Yes   | Server validates selection and persists current market on success | No         |
| GET    | `/members/me/qr`                     | Authenticated member | Ownership only | N/A                  | none                               | `MemberQrResponse`            | `MEMBER_NOT_FOUND`, `QR_REVOKED`, `MEMBER_CLOSED`                               | No          | Yes   | Never expose raw sensitive token material                         | No         |
| POST   | `/members/me/qr`                     | Authenticated member | Ownership only | N/A                  | `RotateMemberQrRequest`            | `MemberQrResponse`            | `QR_ACTIVE_EXISTS`, `QR_REVOKED`, `MEMBER_CLOSED`                               | Required    | Yes   | Return only signed view token or display payload                  | No         |
| DELETE | `/members/me/qr`                     | Authenticated member | Ownership only | N/A                  | `RevokeMemberQrRequest`            | 204                           | `QR_NOT_FOUND`, `MEMBER_CLOSED`                                                 | Required    | Yes   | No raw token in errors                                            | No         |
| GET    | `/members/me/referral`               | Authenticated member | Ownership only | N/A                  | none                               | `MemberReferralResponse`      | `MEMBER_NOT_FOUND`, `MEMBER_CLOSED`                                             | No          | Yes   | Mask referrer private data                                        | No         |
| GET    | `/members/me/kyc`                    | Authenticated member | Ownership only | N/A                  | none                               | `MemberKycResponse`           | `MEMBER_NOT_FOUND`, `KYC_NOT_STARTED`, `MEMBER_CLOSED`                          | No          | Yes   | Mask document metadata                                            | No         |
| POST   | `/members/me/kyc`                    | Authenticated member | Ownership only | N/A                  | `SubmitMemberKycRequest`           | `MemberKycResponse`           | `VALIDATION`, `KYC_CONFLICT`, `MEMBER_SUSPENDED`, `MEMBER_CLOSED`               | Required    | Yes   | No raw document content in response                               | No         |
| GET    | `/members/me/account-country-change` | Authenticated member | Ownership only | N/A                  | none                               | `MemberCountryChangeResponse` | `MEMBER_NOT_FOUND`, `MEMBER_CLOSED`                                             | No          | Yes   | Hide reviewer-only notes                                          | No         |
| POST   | `/members/me/account-country-change` | Authenticated member | Ownership only | N/A                  | `RequestMemberCountryChange`       | `MemberCountryChangeResponse` | `CONFLICT`, `COUNTRY_INVALID`, `MEMBER_SUSPENDED`, `MEMBER_CLOSED`              | Required    | Yes   | Record reason and evidence only                                   | No         |
| DELETE | `/members/me/account-country-change` | Authenticated member | Ownership only | N/A                  | `CancelMemberCountryChangeRequest` | 204                           | `REQUEST_NOT_FOUND`, `REQUEST_NOT_PENDING`, `MEMBER_CLOSED`                     | Required    | Yes   | No reviewer note exposure                                         | No         |

### 3.3 Merchant discovery

| Method | Path                          | Actor                | RBAC           | MarketAccess                        | Request schema | Response schema                   | Errors                                                 | Idempotency | Audit    | Sensitive handling           | Pagination |
| ------ | ----------------------------- | -------------------- | -------------- | ----------------------------------- | -------------- | --------------------------------- | ------------------------------------------------------ | ----------- | -------- | ---------------------------- | ---------- |
| GET    | `/member-merchants`           | Authenticated member | Ownership only | Current-market enabled-market check | query filters  | `MerchantDiscoveryListResponse`   | `MARKET_DISABLED`, `MEMBER_SUSPENDED`, `MEMBER_CLOSED` | No          | Optional | Mask merchant private data   | Yes        |
| GET    | `/member-merchants/:branchId` | Authenticated member | Ownership only | Current-market enabled-market check | path param     | `MerchantDiscoveryDetailResponse` | `NOT_FOUND`, `MARKET_DISABLED`, `MEMBER_CLOSED`        | No          | Optional | No private merchant KYC data | No         |

### 3.4 Admin member operations

| Method | Path                                           | Actor | RBAC                           | MarketAccess                      | Request schema              | Response schema                  | Errors                                                               | Idempotency | Audit | Sensitive handling                              | Pagination |
| ------ | ---------------------------------------------- | ----- | ------------------------------ | --------------------------------- | --------------------------- | -------------------------------- | -------------------------------------------------------------------- | ----------- | ----- | ----------------------------------------------- | ---------- |
| GET    | `/admin/members`                               | Admin | `member.view`                  | Required for filtered market view | query filters               | `AdminMemberListResponse`        | `AUTH_PERMISSION_DENIED`, `AUTH_MARKET_ACCESS_DENIED`                | No          | Yes   | Mask private fields by default                  | Yes        |
| GET    | `/admin/members/:memberId`                     | Admin | `member.view`                  | Derived from member market        | path param                  | `AdminMemberDetailResponse`      | `NOT_FOUND`, `AUTH_MARKET_ACCESS_DENIED`                             | No          | Yes   | Mask KYC and contact fields unless privileged   | No         |
| POST   | `/admin/member-kyc/:caseId/review`             | Admin | `member.kyc.review`            | Derived from case market          | `ReviewMemberKycRequest`    | `MemberKycResponse`              | `VALIDATION`, `STATE_CONFLICT`, `AUTH_MARKET_ACCESS_DENIED`          | Required    | Yes   | No raw document echo                            | No         |
| GET    | `/admin/member-country-changes`                | Admin | `member.country.change.review` | Required for market filter        | query filters               | `AdminCountryChangeListResponse` | `AUTH_PERMISSION_DENIED`                                             | No          | Yes   | Mask requester and reviewer notes in list views | Yes        |
| POST   | `/admin/members/:memberId/suspend`             | Admin | `member.suspend`               | Derived from member market        | `MemberStatusActionRequest` | `MemberStatusResponse`           | `STATE_CONFLICT`, `NOT_FOUND`                                        | Required    | Yes   | Include reason, no sensitive payloads           | No         |
| POST   | `/admin/members/:memberId/reactivate`          | Admin | `member.suspend`               | Derived from member market        | `MemberStatusActionRequest` | `MemberStatusResponse`           | `STATE_CONFLICT`, `NOT_FOUND`                                        | Required    | Yes   | Include reason                                  | No         |
| POST   | `/admin/members/:memberId/referral-correction` | Admin | `member.referral.correct`      | Derived from member market        | `ReferralCorrectionRequest` | `MemberReferralResponse`         | `CONFLICT`, `NOT_FOUND`, `REFERRAL_CYCLE`, `REFERRAL_SELF_REFERENCE` | Required    | Yes   | No referrer private data leakage                | No         |
| GET    | `/admin/members/:memberId/timeline`            | Admin | `member.timeline.view`         | Derived from member market        | query filters               | `EntityTimelineResponse`         | `AUTH_MARKET_ACCESS_DENIED`                                          | No          | Yes   | Redact sensitive values                         | Yes        |
| GET    | `/admin/members/:memberId/audit`               | Admin | `audit.view`                   | Derived from member market        | query filters               | `AuditLogResponse`               | `AUTH_MARKET_ACCESS_DENIED`                                          | No          | Yes   | Redact secrets and document content             | Yes        |

## 4. Request and response schema notes

### 4.1 MemberRegisterRequest

Required fields:

- email
- password
- otp_id
- otp_code
- account_country
- market_id
- terms_version
- locale
- referral_code or referrer reference if supported by the registration flow

The response returns:

- member public ID
- account public ID
- member status
- current market
- referral code
- session tokens if login is combined with registration
- current market must be persisted to member market preferences before the response is returned

### 4.2 MemberProfileResponse

Returns:

- member public ID
- display name
- current status
- profile fields the owner may see
- masked sensitive fields only when required

### 4.3 MemberKycResponse

Returns:

- case ID
- KYC status
- requested level
- submission version
- masked document metadata
- review outcome if any

### 4.4 MemberQrResponse

Returns:

- QR public ID
- status
- issued and expiry timestamps
- display token or signed payload suitable for rendering
- public QR payload must not include internal database IDs, email, phone, or sensitive data
- stored QR material is token hash only; plaintext token is never persisted

Never return:

- internal UUIDs
- account email
- phone
- token secret

### 4.5 MemberMarketResponse

Returns:

- member public ID
- current market public ID
- enabled market list
- persisted current-market timestamp or version

The response must reflect the value persisted in `member_market_preferences`, not a session-only cache.

### 4.6 ReferralCorrectionRequest

Required fields:

- member_id
- old_referrer_member_id
- new_referrer_member_id
- correction_reason
- authorized_actor
- request_id
- occurred_at

The server must:

- validate no self-referral
- validate no referral cycle
- update the current referrer state in the same transaction
- append an immutable history row with the correction metadata

The response should return:

- current referral snapshot
- immutable history event reference
- masking equivalent to `MemberReferralResponse`

## 5. Error code model

Common codes:

- `AUTH_*`
- `MEMBER_NOT_FOUND`
- `MEMBER_SUSPENDED`
- `MEMBER_CLOSED`
- `VALIDATION_ERROR`
- `MARKET_DISABLED`
- `MARKET_ACCESS_DENIED`
- `COUNTRY_INVALID`
- `COUNTRY_CHANGE_CONFLICT`
- `KYC_CONFLICT`
- `QR_REVOKED`
- `REFERRAL_CYCLE`
- `REFERRAL_SELF_REFERENCE`
- `STATE_CONFLICT`
- `IDEMPOTENCY_CONFLICT`
- `AUTH_ACCOUNT_CLOSED`

Error responses must not expose implementation details or hidden data.

## 6. Pagination

List endpoints use:

- `page`
- `pageSize`
- `sort`
- `order`

Responses include:

- total count or cursor metadata
- current page info
- request ID

## 7. Idempotency

All write routes in this phase require `Idempotency-Key`.

Routes with state transition or request creation semantics must return the same logical result on replay.
Current market switches, referral corrections, QR rotation, KYC submissions, and account-country change requests must not create duplicate history rows on replay.

## 8. Sensitive-field handling

| Context            | Rule                                                                 |
| ------------------ | -------------------------------------------------------------------- |
| Own member reads   | Full data only for the authenticated owner, subject to masking rules |
| Admin lists        | Mask sensitive fields by default                                     |
| Admin detail views | Reveal only fields needed for the permission granted                 |
| QR responses       | No internal IDs or direct identity data in token payload             |
| KYC responses      | No raw document content or private object keys in general responses  |
