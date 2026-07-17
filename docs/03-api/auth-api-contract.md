# Auth API Contract

> **Document Status**: FROZEN — v1.0  
> **Last Updated**: 2026-07-18  
> **Classification**: LOCKED (approved product rules — implement as specified)  
> **Authority**: Phase 2 — Sprint 4A (API Contract Freeze)  
> **Command Center Acceptance**: D-019 (2026-07-18) — P2-S4 ACCEPTED FOR CLOSURE  
> **Canonical Response Casing**: `camelCase` (legacy mixed fields temporarily compatible)  
> **Canonical Routes**: Non-member paths under `/auth/` are canonical. Member aliases are **deprecated**.

---

## Table of Contents

1. [Base URL & Conventions](#1-base-url--conventions)
2. [Authentication & Security](#2-authentication--security)
3. [Endpoint Catalog](#3-endpoint-catalog)
   - [3.1 Login & Session](#31-login--session)
   - [3.2 Registration Flow](#32-registration-flow)
   - [3.3 Password Reset Flow](#33-password-reset-flow)
   - [3.4 General OTP Operations](#34-general-otp-operations)
   - [3.5 Member-Specific Aliases](#35-member-specific-aliases)
4. [Error Codes](#4-error-codes)
5. [DTO Field Reference](#5-dto-field-reference)
6. [Rate-Limiting Behavior](#6-rate-limiting-behavior)
7. [Idempotency](#7-idempotency)
8. [Differences Inventory](#8-differences-inventory)
9. [Suggested Freeze Items](#9-suggested-freeze-items)
10. [Open Questions](#10-open-questions)

---

## 1. Base URL & Conventions

| Property                  | Value                                                        |
| ------------------------- | ------------------------------------------------------------ |
| **Base URL**              | `/api/v1`                                                    |
| **Content-Type**          | `application/json`                                           |
| **Encoding**              | UTF-8                                                        |
| **Field Case (Request)**  | `snake_case`                                                 |
| **Field Case (Response)** | `camelCase` (token responses), `snake_case` (OTP responses)  |
| **Date Format**           | ISO 8601 — `YYYY-MM-DDTHH:mm:ss.sssZ` (UTC)                  |
| **Idempotency Header**    | `Idempotency-Key` (HTTP header) or in-body `idempotency_key` |

### 1.1 Naming Inconsistency Note

Request DTO fields use `snake_case` (e.g., `otp_id`, `refresh_token`, `idempotency_key`).  
Response token objects use `camelCase` (e.g., `accessToken`, `refreshToken`).  
OTP-issue responses use `snake_case` (e.g., `otp_id`, `expires_at`).

This mixing of conventions is a known artifact.

---

## 2. Authentication & Security

| Mechanism               | Details                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| **Bearer Token**        | `Authorization: Bearer <token>` — required for protected endpoints  |
| **Token Format**        | Opaque, 32+ character hex string                                    |
| **Access Token TTL**    | Configured via `accessTtlSeconds` (default: 900s / 15min)           |
| **Refresh Token TTL**   | Configured via `refreshTtlSeconds` (default: 604800s / 7 days)      |
| **OTP Code**            | 6-digit numeric string                                              |
| **OTP TTL**             | Configured via `otpTtlSeconds` (default: 300s / 5min)               |
| **OTP Max Attempts**    | Configured via `otpMaxAttempts` (default: 5)                        |
| **OTP Resend Cooldown** | Configured via `otpResendCooldownSeconds` (default: 60s)            |
| **Guard**               | `AuthGuard` validates Bearer token via `AuthService.resolveActor()` |

---

## 3. Endpoint Catalog

### 3.1 Login & Session

#### `POST /api/v1/auth/login` — Authenticate & Issue Tokens

| Property           | Value                                |
| ------------------ | ------------------------------------ |
| **Authentication** | None                                 |
| **Idempotent**     | No (creates unique session per call) |
| **Rate Limit**     | Composite: email-based + IP-based    |

**Request Body** (`loginSchema` — strict object):

| Field      | Type     | Required | Validation                               |
| ---------- | -------- | -------- | ---------------------------------------- |
| `email`    | `string` | ✅       | `.email()`; trimmed and `.toLowerCase()` |
| `password` | `string` | ✅       | `min(12)`, `max(256)`                    |

**Response `200`**:

```json
{
  "accessToken": "opaque-hex-string-64+",
  "refreshToken": "opaque-hex-string-64+",
  "accessExpiresAt": "2026-07-18T01:41:00.000Z",
  "refreshExpiresAt": "2026-07-25T01:26:00.000Z"
}
```

**Error Responses**:

| Status | Code                       | Condition                            |
| ------ | -------------------------- | ------------------------------------ |
| `401`  | `AUTH_INVALID_CREDENTIALS` | Email not found or password mismatch |
| `401`  | `AUTH_ACCOUNT_INACTIVE`    | Account status is not `ACTIVE`       |
| `429`  | `AUTH_RATE_LIMITED`        | Rate limit exceeded                  |

---

#### `POST /api/v1/auth/refresh` — Rotate Refresh Token

| Property           | Value                                             |
| ------------------ | ------------------------------------------------- |
| **Authentication** | None (uses refresh token from body)               |
| **Idempotent**     | No (each call invalidates previous refresh token) |
| **Rate Limit**     | IP-based: 30 req / 60s window                     |

**Request Body** (`refreshSchema` — strict object):

| Field           | Type     | Required | Validation                       |
| --------------- | -------- | -------- | -------------------------------- |
| `refresh_token` | `string` | ✅       | `.trim()`, `min(32)`, `max(512)` |

**Response `200`**: Same shape as login response (new `accessToken`, `refreshToken`, `accessExpiresAt`, `refreshExpiresAt`).

**Error Responses**:

| Status | Code                   | Condition                                                 |
| ------ | ---------------------- | --------------------------------------------------------- |
| `401`  | `AUTH_SESSION_INVALID` | Refresh token not found or expired                        |
| `401`  | `AUTH_REFRESH_REUSED`  | Refresh token already consumed (rotation reuse detection) |
| `429`  | `AUTH_RATE_LIMITED`    | Rate limit exceeded                                       |

**Notes**:

- Token rotation: calling `/auth/refresh` with token `R1` returns `R2` and invalidates `R1`. Replaying `R1` after rotation triggers `AUTH_REFRESH_REUSED` and revokes the entire session family (`R2` also invalidated).

---

#### `POST /api/v1/auth/logout` — Revoke Session

| Property           | Value                                |
| ------------------ | ------------------------------------ |
| **Authentication** | `Bearer` token (via `AuthGuard`)     |
| **Idempotent**     | No (but replayed calls return `401`) |
| **Rate Limit**     | None                                 |

**Request Headers**:

| Header          | Required | Value                  |
| --------------- | -------- | ---------------------- |
| `Authorization` | ✅       | `Bearer <accessToken>` |

**Response `204`**: No body.

**Error Responses**:

| Status | Code                   | Condition                                  |
| ------ | ---------------------- | ------------------------------------------ |
| `401`  | `AUTH_SESSION_INVALID` | Token invalid, expired, or already revoked |

---

### 3.2 Registration Flow

#### `POST /api/v1/auth/registration/initiate` — Initiate Registration

| Property           | Value                                |
| ------------------ | ------------------------------------ |
| **Authentication** | None                                 |
| **Idempotent**     | Yes (via optional `idempotency_key`) |
| **Rate Limit**     | Composite: email-based + IP-based    |

**Request Body** (`registrationInitiateSchema` — strict object):

| Field                | Type     | Required | Validation                                                         |
| -------------------- | -------- | -------- | ------------------------------------------------------------------ |
| `email`              | `string` | ✅       | `.email()`; trimmed, `.toLowerCase()`                              |
| `password`           | `string` | ✅       | `min(12)`, `max(256)`                                              |
| `account_country`    | `string` | ✅       | `.trim().toUpperCase()`, regex `/^[A-Z]{2}$/`                      |
| `terms_version`      | `string` | ✅       | `.trim()`, `min(1)`, `max(64)`                                     |
| `disclaimer_version` | `string` | ✅       | `.trim()`, `min(1)`, `max(64)`                                     |
| `privacy_version`    | `string` | ✅       | `.trim()`, `min(1)`, `max(64)`                                     |
| `locale`             | `string` | ✅       | `.trim()`, `min(2)`, `max(32)`                                     |
| `referral_code`      | `string` | ❌       | `.trim()`, `min(8)`, `max(64)`, regex `/^[A-Za-z0-9]+$/`, nullable |
| `idempotency_key`    | `string` | ❌       | `.trim()`, `min(8)`, `max(128)`                                    |

**Response `202`**:

```json
{
  "otp_id": "uuid-string",
  "expires_at": "2026-07-18T01:31:00.000Z",
  "delivery_status": "NOT_SENT",
  "development_code": "123456"
}
```

> `development_code` is only present in non-production environments (`NODE_ENV=development|test`).

**Error Responses**:

| Status | Code                         | Condition                                     |
| ------ | ---------------------------- | --------------------------------------------- |
| `400`  | `VALIDATION_ERROR`           | Zod validation failure                        |
| `409`  | `AUTH_MEMBER_ALREADY_EXISTS` | Email already registered                      |
| `429`  | `AUTH_RATE_LIMITED`          | Rate limit exceeded                           |
| `409`  | `AUTH_IDEMPOTENCY_CONFLICT`  | Idempotency key reused with different payload |

---

#### `POST /api/v1/auth/registration/verify` — Verify Registration OTP

| Property           | Value                                            |
| ------------------ | ------------------------------------------------ |
| **Authentication** | None                                             |
| **Idempotent**     | Yes (safe to replay with same `otp_id` + `code`) |
| **Rate Limit**     | None (OTP attempt tracking via `otpMaxAttempts`) |

**Request Body** (`verifyOtpSchema` — strict):

| Field    | Type     | Required | Validation                   |
| -------- | -------- | -------- | ---------------------------- |
| `otp_id` | `string` | ✅       | `.uuid()`                    |
| `code`   | `string` | ✅       | `.trim()`, regex `/^\d{6}$/` |

**Response `200`**:

```json
{ "verified": true }
```

**Error Responses**:

| Status | Code                          | Condition                       |
| ------ | ----------------------------- | ------------------------------- |
| `400`  | `AUTH_OTP_INVALID`            | Wrong code or OTP not found     |
| `400`  | `AUTH_OTP_EXPIRED`            | OTP TTL exceeded                |
| `400`  | `AUTH_OTP_ATTEMPTS_EXHAUSTED` | Max attempts reached            |
| `400`  | `AUTH_FLOW_INVALID`           | OTP already used (`usedAt` set) |

---

#### `POST /api/v1/auth/registration/complete` — Complete Registration

| Property           | Value                                                                 |
| ------------------ | --------------------------------------------------------------------- |
| **Authentication** | None                                                                  |
| **Idempotent**     | **Yes** (required `idempotency_key`) — same key returns cached result |
| **Rate Limit**     | None                                                                  |

**Request Body** (`registrationCompleteSchema` — strict):

| Field             | Type     | Required | Validation                      |
| ----------------- | -------- | -------- | ------------------------------- |
| `otp_id`          | `string` | ✅       | `.uuid()`                       |
| `idempotency_key` | `string` | ✅       | `.trim()`, `min(8)`, `max(128)` |

**Transactions**: Account creation, credential insertion, member profile, referrals, consent records, audit logs, entity timeline — all in a single database transaction.

**Response `200`**:

```json
{
  "accountId": "uuid-string",
  "memberId": "uuid-string",
  "publicMemberId": "mem_A1B2C3D4E5F6G7H8",
  "referralCode": "ABCD1234"
}
```

**Error Responses**:

| Status | Code                                | Condition                                                 |
| ------ | ----------------------------------- | --------------------------------------------------------- |
| `400`  | `AUTH_FLOW_INVALID`                 | OTP not verified, already used, or purpose mismatch       |
| `400`  | `AUTH_MARKET_INVALID`               | `account_country` not found or market inactive            |
| `409`  | `AUTH_MEMBER_ALREADY_EXISTS`        | Email already registered between OTP issue and completion |
| `400`  | `AUTH_REFERRAL_INVALID`             | Referral code not found or self-referral                  |
| `500`  | `AUTH_IDENTIFIER_GENERATION_FAILED` | Could not generate unique identifiers (extremely rare)    |
| `409`  | `AUTH_IDEMPOTENCY_CONFLICT`         | Key reused with different payload                         |

---

#### `POST /api/v1/auth/registration/resend` — Resend Registration OTP

| Property           | Value                                           |
| ------------------ | ----------------------------------------------- |
| **Authentication** | None                                            |
| **Idempotent**     | No                                              |
| **Rate Limit**     | Cooldown-based (via `otpResendCooldownSeconds`) |

**Request Body** (`registrationResendSchema` — strict):

| Field    | Type     | Required | Validation |
| -------- | -------- | -------- | ---------- |
| `otp_id` | `string` | ✅       | `.uuid()`  |

**Response `202`**: Same shape as registration initiate response.

**Error Responses**:

| Status | Code                | Condition                                                     |
| ------ | ------------------- | ------------------------------------------------------------- |
| `400`  | `AUTH_FLOW_INVALID` | OTP not found, wrong purpose, or already used                 |
| `429`  | `AUTH_OTP_COOLDOWN` | Resend cooldown not yet expired; includes `retryAfterSeconds` |
| `429`  | `AUTH_RATE_LIMITED` | Registration email/IP rate limit exceeded                     |

---

### 3.3 Password Reset Flow

#### `POST /api/v1/auth/password-reset/initiate` — Initiate Password Reset

| Property           | Value                             |
| ------------------ | --------------------------------- |
| **Authentication** | None                              |
| **Idempotent**     | No                                |
| **Rate Limit**     | Composite: email-based + IP-based |

**Request Body** (`passwordResetInitiateSchema` — strict):

| Field   | Type     | Required | Validation                          |
| ------- | -------- | -------- | ----------------------------------- |
| `email` | `string` | ✅       | `.email()`, `.trim().toLowerCase()` |

**Response `202`**: Same OTP response shape as registration initiation.

> Neutral response: returns an OTP even if the email is unknown (prevents email enumeration).

**Error Responses**:

| Status | Code                | Condition           |
| ------ | ------------------- | ------------------- |
| `429`  | `AUTH_RATE_LIMITED` | Rate limit exceeded |

---

#### `POST /api/v1/auth/password-reset/verify` — Verify Password Reset OTP

| Property           | Value                             |
| ------------------ | --------------------------------- |
| **Authentication** | None                              |
| **Idempotent**     | Yes (same as registration verify) |
| **Rate Limit**     | OTP attempt tracking only         |

**Request Body**: Same as `verifyOtpSchema`.

**Response `200`**: `{ "verified": true }`

**Error Responses**: Same as registration verify, plus:

| Status | Code               | Condition                               |
| ------ | ------------------ | --------------------------------------- |
| `400`  | `AUTH_OTP_INVALID` | Purpose mismatch (not `PASSWORD_RESET`) |

---

#### `POST /api/v1/auth/password-reset/complete` — Complete Password Reset

| Property           | Value                                |
| ------------------ | ------------------------------------ |
| **Authentication** | None                                 |
| **Idempotent**     | **Yes** (required `idempotency_key`) |
| **Rate Limit**     | None                                 |

**Request Body** (`passwordResetCompleteSchema` — strict):

| Field             | Type     | Required | Validation                      |
| ----------------- | -------- | -------- | ------------------------------- |
| `otp_id`          | `string` | ✅       | `.uuid()`                       |
| `new_password`    | `string` | ✅       | `min(12)`, `max(256)`           |
| `idempotency_key` | `string` | ✅       | `.trim()`, `min(8)`, `max(128)` |

**Transactions**: Credential upsert (`INSERT ... ON CONFLICT DO UPDATE`), session revocation (all sessions for account), OTP consumption, audit log — in a single database transaction.

**Response `204`**: No body.

**Error Responses**:

| Status | Code                        | Condition                                              |
| ------ | --------------------------- | ------------------------------------------------------ |
| `400`  | `AUTH_FLOW_INVALID`         | OTP not verified, already used, or missing `accountId` |
| `400`  | `AUTH_IDEMPOTENCY_CONFLICT` | Key reused with different payload                      |

---

#### `POST /api/v1/auth/password/reset` — Reset Password from Generic OTP

| Property           | Value                                         |
| ------------------ | --------------------------------------------- |
| **Authentication** | None                                          |
| **Idempotent**     | No                                            |
| **Rate Limit**     | IP-based: 5 req / 3600s window (on OTP issue) |

**Request Body** (`resetPasswordSchema` — strict):

| Field          | Type     | Required | Validation            |
| -------------- | -------- | -------- | --------------------- |
| `otp_id`       | `string` | ✅       | `.uuid()`             |
| `new_password` | `string` | ✅       | `min(12)`, `max(256)` |

**Response `204`**: No body.

**Error Responses**:

| Status | Code               | Condition                                        |
| ------ | ------------------ | ------------------------------------------------ |
| `400`  | `AUTH_OTP_INVALID` | OTP not found, purpose mismatch, or not consumed |

---

### 3.4 General OTP Operations

#### `POST /api/v1/auth/otp/issue` — Issue Generic OTP

| Property           | Value                                      |
| ------------------ | ------------------------------------------ |
| **Authentication** | None                                       |
| **Idempotent**     | No                                         |
| **Rate Limit**     | IP+destination-based: 5 req / 3600s window |

**Request Body** (`issueOtpSchema` — strict):

| Field         | Type     | Required | Validation                                   |
| ------------- | -------- | -------- | -------------------------------------------- |
| `destination` | `string` | ✅       | `.email()`, `.trim().toLowerCase()`          |
| `purpose`     | `enum`   | ✅       | `"EMAIL_VERIFICATION"` or `"PASSWORD_RESET"` |

**Response `202`**: Same OTP response shape.

**Error Responses**:

| Status | Code                | Condition           |
| ------ | ------------------- | ------------------- |
| `429`  | `AUTH_RATE_LIMITED` | Rate limit exceeded |

---

#### `POST /api/v1/auth/otp/verify` — Verify Generic OTP

| Property           | Value |
| ------------------ | ----- |
| **Authentication** | None  |
| **Idempotent**     | Yes   |

**Request Body**: Same as `verifyOtpSchema`.

**Response `200`**: `{ "verified": true }`

**Error Responses**: Same as registration verify.

---

### 3.5 Member-Specific Aliases

All member endpoints delegate to their non-member counterparts. They exist as convenience aliases under `/api/v1/auth/member/`.

| Method | Alias Path                                    | Delegates To                           | Notes                                                |
| ------ | --------------------------------------------- | -------------------------------------- | ---------------------------------------------------- |
| `POST` | `/api/v1/auth/member/login`                   | `/api/v1/auth/login`                   | Same as login                                        |
| `POST` | `/api/v1/auth/member/refresh`                 | `/api/v1/auth/refresh`                 | Same as refresh                                      |
| `POST` | `/api/v1/auth/member/logout`                  | `/api/v1/auth/logout`                  | Same as logout; `@UseGuards(AuthGuard)`              |
| `POST` | `/api/v1/auth/member/register`                | `/api/v1/auth/registration/initiate`   | **Path diff:** `register` vs `registration/initiate` |
| `POST` | `/api/v1/auth/member/register/verify`         | `/api/v1/auth/registration/verify`     | Same DTO / response                                  |
| `POST` | `/api/v1/auth/member/register/complete`       | `/api/v1/auth/registration/complete`   | Same DTO / response                                  |
| `POST` | `/api/v1/auth/member/register/resend-otp`     | `/api/v1/auth/registration/resend`     | **Path diff:** `resend-otp` vs `resend`              |
| `POST` | `/api/v1/auth/member/password-reset/request`  | `/api/v1/auth/password-reset/initiate` | **Path diff:** `request` vs `initiate`               |
| `POST` | `/api/v1/auth/member/password-reset/verify`   | `/api/v1/auth/password-reset/verify`   | Same DTO / response                                  |
| `POST` | `/api/v1/auth/member/password-reset/complete` | `/api/v1/auth/password-reset/complete` | Same DTO / response                                  |

> All member endpoints use the same request DTOs, validations, error codes, and rate-limit behavior as their non-member counterparts.

---

## 4. Error Codes

All errors are returned in the following envelope:

```json
{
  "error": {
    "code": "AUTH_XXXX",
    "message": "Human-readable description."
  },
  "requestId": "uuid"
}
```

### 4.1 Complete Error Code Catalog

| Code                                | HTTP Status                  | Thrown By                                                                      | Description                                                         |
| ----------------------------------- | ---------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `AUTH_INVALID_CREDENTIALS`          | `401`                        | `login()`                                                                      | Email not found or password does not match                          |
| `AUTH_ACCOUNT_INACTIVE`             | `401`                        | `login()` → `assertLoginAllowed()`                                             | Account status is not `ACTIVE`                                      |
| `AUTH_MEMBER_INACTIVE`              | `403`                        | `login()` → `assertLoginAllowed()`                                             | Member exists but status is not `ACTIVE`                            |
| `AUTH_MEMBER_ALREADY_EXISTS`        | `409`                        | `initiateRegistration()` (also in `completeRegistration()` TX)                 | Email already registered                                            |
| `AUTH_SESSION_INVALID`              | `401`                        | `resolveActor()`, `rotateRefreshToken()`, `AuthGuard`                          | Session not found, expired, or revoked                              |
| `AUTH_REFRESH_REUSED`               | `401`                        | `rotateRefreshToken()`                                                         | Refresh token replay detected after rotation                        |
| `AUTH_OTP_INVALID`                  | `400`                        | `verifyOtp()`, `verifyMemberOtp()`, `resetPasswordFromOtp()`                   | Wrong code, wrong purpose, or OTP not found                         |
| `AUTH_OTP_EXPIRED`                  | `400`                        | `verifyOtp()`, `verifyMemberOtp()`                                             | OTP TTL exceeded                                                    |
| `AUTH_OTP_ATTEMPTS_EXHAUSTED`       | `400`                        | `verifyOtp()`, `verifyMemberOtp()`                                             | Max OTP attempts reached                                            |
| `AUTH_OTP_COOLDOWN`                 | `429`                        | `resendRegistrationOtp()`                                                      | Resend cooldown not yet elapsed                                     |
| `AUTH_RATE_LIMITED`                 | `429`                        | All rate-limited operations                                                    | Generic rate-limit exceeded                                         |
| `AUTH_PASSWORD_WEAK`                | _Not thrown in current code_ | —                                                                              | Reserved / defined in type union                                    |
| `AUTH_IDEMPOTENCY_CONFLICT`         | `409`                        | `checkIdempotency()`, `recordIdempotency()`                                    | Idempotency key reused with mismatched payload                      |
| `AUTH_IDEMPOTENCY_REQUIRED`         | _Not thrown in current code_ | —                                                                              | Reserved / defined in type union                                    |
| `AUTH_MARKET_INVALID`               | `400`                        | `completeRegistration()` TX                                                    | Country/market code not found or market inactive                    |
| `AUTH_REFERRAL_INVALID`             | `400`                        | `completeRegistration()` TX                                                    | Referral code not found or self-referral                            |
| `AUTH_FLOW_INVALID`                 | `400`                        | `resendRegistrationOtp()`, `completeRegistration()`, `completePasswordReset()` | OTP used, wrong purpose, or flow state invalid                      |
| `AUTH_FLOW_EXPIRED`                 | _Not thrown in current code_ | —                                                                              | Reserved / defined in type union                                    |
| `AUTH_IDENTIFIER_GENERATION_FAILED` | `500`                        | `completeRegistration()` TX                                                    | Failed to generate unique identifiers (collision retries exhausted) |
| `VALIDATION_ERROR`                  | `400`                        | Zod validation pipe / NestJS `ValidationPipe`                                  | Request body fails schema validation                                |

### 4.2 Error Mapping Logic (controller `handle()` method)

| AuthError Code               | HTTP Exception                             | Status |
| ---------------------------- | ------------------------------------------ | ------ |
| `AUTH_RATE_LIMITED`          | `HttpException`                            | `429`  |
| `AUTH_OTP_COOLDOWN`          | `HttpException`                            | `429`  |
| `AUTH_INVALID_CREDENTIALS`   | `UnauthorizedException`                    | `401`  |
| `AUTH_ACCOUNT_INACTIVE`      | `UnauthorizedException`                    | `401`  |
| `AUTH_SESSION_INVALID`       | `UnauthorizedException`                    | `401`  |
| `AUTH_REFRESH_REUSED`        | `UnauthorizedException`                    | `401`  |
| `AUTH_MEMBER_INACTIVE`       | `ForbiddenException`                       | `403`  |
| `AUTH_IDEMPOTENCY_CONFLICT`  | `HttpException`                            | `409`  |
| `AUTH_MEMBER_ALREADY_EXISTS` | `HttpException`                            | `409`  |
| All other `AuthError` codes  | `BadRequestException`                      | `400`  |
| Non-`AuthError` exceptions   | Propagated as-is (caught by global filter) | varies |

---

## 5. DTO Field Reference

### 5.1 Request DTOs

| Schema                        | Fields                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loginSchema`                 | `email` (string, email, trimmed+lowercased), `password` (string, 12–256)                                                                                                                            |
| `refreshSchema`               | `refresh_token` (string, trimmed, 32–512)                                                                                                                                                           |
| `issueOtpSchema`              | `destination` (string, email, trimmed+lowercased), `purpose` (enum: `EMAIL_VERIFICATION` \| `PASSWORD_RESET`)                                                                                       |
| `verifyOtpSchema`             | `otp_id` (string, uuid), `code` (string, trimmed, `/^\d{6}$/`)                                                                                                                                      |
| `resetPasswordSchema`         | `otp_id` (string, uuid), `new_password` (string, 12–256)                                                                                                                                            |
| `registrationInitiateSchema`  | `email`, `password`, `account_country` (ISO 3166-1 alpha-2), `referral_code` (optional, nullable), `terms_version`, `disclaimer_version`, `privacy_version`, `locale`, `idempotency_key` (optional) |
| `registrationResendSchema`    | `otp_id` (string, uuid)                                                                                                                                                                             |
| `registrationCompleteSchema`  | `otp_id` (string, uuid), `idempotency_key` (string, 8–128)                                                                                                                                          |
| `passwordResetInitiateSchema` | `email` (string, email, trimmed+lowercased)                                                                                                                                                         |
| `passwordResetVerifySchema`   | Same as `verifyOtpSchema`                                                                                                                                                                           |
| `passwordResetCompleteSchema` | `otp_id` (string, uuid), `new_password` (string, 12–256), `idempotency_key` (string, 8–128)                                                                                                         |

### 5.2 Response Shapes

| Endpoint                        | Status | Response Fields                                                                                                              |
| ------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `POST /login`                   | `200`  | `accessToken` (string), `refreshToken` (string), `accessExpiresAt` (ISO 8601), `refreshExpiresAt` (ISO 8601)                 |
| `POST /refresh`                 | `200`  | Same as login                                                                                                                |
| `POST /logout`                  | `204`  | (no body)                                                                                                                    |
| `POST /registration/initiate`   | `202`  | `otp_id` (string, uuid), `expires_at` (ISO 8601), `delivery_status` ("NOT_SENT"), `development_code` (string, dev/test only) |
| `POST /registration/verify`     | `200`  | `verified` (boolean, always `true`)                                                                                          |
| `POST /registration/complete`   | `200`  | `accountId` (string, uuid), `memberId` (string, uuid), `publicMemberId` (string), `referralCode` (string)                    |
| `POST /registration/resend`     | `202`  | Same as initiate                                                                                                             |
| `POST /password-reset/initiate` | `202`  | Same OTP shape as above                                                                                                      |
| `POST /password-reset/verify`   | `200`  | `{ "verified": true }`                                                                                                       |
| `POST /password-reset/complete` | `204`  | (no body)                                                                                                                    |
| `POST /password/reset`          | `204`  | (no body)                                                                                                                    |
| `POST /otp/issue`               | `202`  | Same OTP shape                                                                                                               |
| `POST /otp/verify`              | `200`  | `{ "verified": true }`                                                                                                       |

---

## 6. Rate-Limiting Behavior

### 6.1 Bucket Configuration

| Scope                  | Key Pattern                    | Limit                                     | Window                                     | Enforced By                           |
| ---------------------- | ------------------------------ | ----------------------------------------- | ------------------------------------------ | ------------------------------------- |
| Login (email)          | `login:email:<email>`          | `loginEmailRateLimitCount` (configurable) | `loginEmailRateLimitWindowSeconds`         | `AuthService.login()`                 |
| Login (IP)             | `login:ip:<ip>`                | `loginIpRateLimitCount`                   | `loginIpRateLimitWindowSeconds`            | `AuthService.login()`                 |
| Refresh (IP)           | `refresh:<ip>`                 | 30                                        | 60s                                        | `AuthService.rotateRefreshToken()`    |
| Registration (email)   | `registration:email:<email>`   | `registrationEmailRateLimitCount`         | `registrationEmailRateLimitWindowSeconds`  | `AuthService.initiateRegistration()`  |
| Registration (IP)      | `registration:ip:<ip>`         | `registrationIpRateLimitCount`            | `registrationIpRateLimitWindowSeconds`     | `AuthService.initiateRegistration()`  |
| Password Reset (email) | `password-reset:email:<email>` | `passwordResetEmailRateLimitCount`        | `passwordResetEmailRateLimitWindowSeconds` | `AuthService.initiatePasswordReset()` |
| Password Reset (IP)    | `password-reset:ip:<ip>`       | `passwordResetIpRateLimitCount`           | `passwordResetIpRateLimitWindowSeconds`    | `AuthService.initiatePasswordReset()` |
| Generic OTP (IP+dest)  | `otp:<purpose>:<ip>:<dest>`    | 5                                         | 3600s                                      | `AuthService.issueOtp()`              |
| OTP Resend Cooldown    | N/A (OTP record field)         | 1                                         | `otpResendCooldownSeconds` (default 60s)   | `AuthService.resendRegistrationOtp()` |

### 6.2 Composite Rate Limiting

Login, registration, and password-reset initiation apply **composite** rate limits: ALL buckets must be under their limit. If any bucket is exceeded, the operation is denied with `AUTH_RATE_LIMITED`.

### 6.3 Implementation Note

The current implementation uses `InMemoryRateLimiter` (single-process, local map). As documented in `auth/README.md`, this is a **development/test baseline only**. Production deployment requires binding `AUTH_RATE_LIMITER` to a distributed implementation (e.g., Redis).

---

## 7. Idempotency

### 7.1 Supported Idempotent Operations

| Scope                            | Idempotency Key Source             | Behavior                                                               |
| -------------------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| `member.registration.initiate`   | Optional in-body `idempotency_key` | Caches `IssuedOtp`; returns cached OTP on replay                       |
| `member.registration.complete`   | Required in-body `idempotency_key` | Caches `RegistrationCompletionResult`; returns cached result on replay |
| `member.password-reset.complete` | Required in-body `idempotency_key` | Caches acknowledgment; returns 204 on replay                           |

### 7.2 Conflict Detection

If a different payload is submitted with the same idempotency key within the TTL window, the endpoint returns `409` with `AUTH_IDEMPOTENCY_CONFLICT`.

### 7.3 Key Storage

Idempotency records are stored in the `authIdempotencyKeys` PostgreSQL table with TTL configured via `idempotencyTtlSeconds` (default: 86400s / 24h).

---

## 8. Differences Inventory

### 8.1 Path Naming Inconsistencies

The following path naming differences exist between the _non-member_ and _member_ route families:

| Non-member (existing)           | Member (alias)                         | Issue                                                               |
| ------------------------------- | -------------------------------------- | ------------------------------------------------------------------- |
| `/auth/registration/initiate`   | `/auth/member/register`                | Uses `register` (verb) vs `registration` (noun) + `initiate` suffix |
| `/auth/registration/resend`     | `/auth/member/register/resend-otp`     | Action suffix differs: `resend` vs `resend-otp`                     |
| `/auth/password-reset/initiate` | `/auth/member/password-reset/request`  | Action verb differs: `initiate` vs `request`                        |
| `/auth/registration/verify`     | `/auth/member/register/verify`         | Consistent; just path prefix differs                                |
| `/auth/registration/complete`   | `/auth/member/register/complete`       | Consistent                                                          |
| `/auth/password-reset/verify`   | `/auth/member/password-reset/verify`   | Consistent                                                          |
| `/auth/password-reset/complete` | `/auth/member/password-reset/complete` | Consistent                                                          |

### 8.2 Endpoints That Exist in Code But Not Documented in This Contract

All auth endpoints in `auth.controller.ts` are documented above. No undocumented endpoints found.

### 8.3 DTO Field Naming Convention Mismatches

| Area                 | Convention   | Example                                                                                           |
| -------------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| Request DTOs         | `snake_case` | `otp_id`, `idempotency_key`, `refresh_token`, `referral_code`, `account_country`, `terms_version` |
| Token responses      | `camelCase`  | `accessToken`, `refreshToken`, `accessExpiresAt`, `refreshExpiresAt`                              |
| OTP responses        | `snake_case` | `otp_id`, `expires_at`, `delivery_status`                                                         |
| Completion responses | `camelCase`  | `accountId`, `memberId`, `publicMemberId`, `referralCode`                                         |

This mixing of conventions across response types is a known artifact. A decision is needed on whether to standardize.

### 8.4 Error Codes Thrown vs. Documented

| Error Code                      | Thrown In                                | Documented Here                                                                                        |
| ------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `VALIDATION_ERROR`              | Zod validation pipe (not an `AuthError`) | ✅ Yes                                                                                                 |
| All 19 `AuthErrorCode` variants | `auth.errors.ts`                         | ✅ 17 documented + 2 reserved (`AUTH_PASSWORD_WEAK`, `AUTH_IDEMPOTENCY_REQUIRED`, `AUTH_FLOW_EXPIRED`) |

**Note**: `AUTH_PASSWORD_WEAK`, `AUTH_IDEMPOTENCY_REQUIRED`, and `AUTH_FLOW_EXPIRED` are defined in the `AuthErrorCode` type union but are **not thrown** anywhere in the current codebase. They are included as reserved codes.

### 8.5 Rate-Limit Behavior Requiring Clarification

| Item                           | Clarification Needed                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| OTP resend cooldown rate limit | Returns `AUTH_OTP_COOLDOWN` (429) but the cooldown window is per-OTP-record, not a traditional sliding-window counter |
| Refresh token rate limit       | 30 req/60s is hardcoded in `rotateRefreshToken()`; not configurable via `AuthSettings`                                |
| Generic OTP issue rate limit   | 5 req/3600s is hardcoded in `issueOtp()`; not configurable via `AuthSettings`                                         |

### 8.6 Field Naming: Task Spec vs Actual Code

The task specification lists endpoints with paths that differ from the actual implementation:

| Task-specified Path           | Actual Code Path                   | Status                                              |
| ----------------------------- | ---------------------------------- | --------------------------------------------------- |
| `/auth/register/initiate`     | `/auth/registration/initiate`      | 🔴 Mismatch                                         |
| `/auth/register/verify-otp`   | `/auth/registration/verify`        | 🔴 Mismatch                                         |
| `/auth/register/complete`     | `/auth/registration/complete`      | 🔴 Mismatch                                         |
| `/auth/register/resend-otp`   | `/auth/registration/resend`        | 🔴 Mismatch                                         |
| `/auth/forgot-password`       | `/auth/password-reset/initiate`    | 🔴 Different flow                                   |
| `/auth/reset-password`        | `/auth/password/reset`             | 🔴 Different flow                                   |
| `/member/login`               | `/auth/member/login`               | 🔴 Missing `/auth/` prefix                          |
| `/member/refresh`             | `/auth/member/refresh`             | 🔴 Missing `/auth/` prefix                          |
| `/member/logout`              | `/auth/member/logout`              | 🔴 Missing `/auth/` prefix                          |
| `/member/register/initiate`   | `/auth/member/register`            | 🔴 Missing `/auth/` prefix + `initiate` not in path |
| `/member/register/verify-otp` | `/auth/member/register/verify`     | 🔴 `verify-otp` vs `verify`                         |
| `/member/register/complete`   | `/auth/member/register/complete`   | 🔴 Missing `/auth/` prefix                          |
| `/member/register/resend-otp` | `/auth/member/register/resend-otp` | ✅ Match                                            |
| `/member/forgot-password`     | No direct endpoint                 | 🔴 Does not exist                                   |
| `/member/reset-password`      | No direct endpoint                 | 🔴 Does not exist                                   |

---

## 9. Suggested Freeze Items

### 9.1 Can Be Frozen Immediately (Stable Endpoints)

The following endpoints have thorough test coverage in `auth.http.integration.spec.ts` and their behavior is fully understood:

| Endpoint                                    | Reason                                            |
| ------------------------------------------- | ------------------------------------------------- |
| `POST /auth/login`                          | Locked behavior, full HTTP test coverage          |
| `POST /auth/refresh`                        | Locked behavior, token rotation tested            |
| `POST /auth/logout`                         | Locked behavior, revocation tested                |
| `POST /auth/registration/initiate`          | Locked behavior, idempotency tested               |
| `POST /auth/registration/verify`            | Locked behavior                                   |
| `POST /auth/registration/complete`          | Locked behavior, idempotency + transaction tested |
| `POST /auth/registration/resend`            | Locked behavior, cooldown tested                  |
| `POST /auth/password-reset/initiate`        | Locked behavior, neutral response tested          |
| `POST /auth/password-reset/verify`          | Locked behavior                                   |
| `POST /auth/password-reset/complete`        | Locked behavior, idempotency tested               |
| `POST /auth/otp/issue`                      | Locked behavior                                   |
| `POST /auth/otp/verify`                     | Locked behavior                                   |
| `POST /auth/password/reset`                 | Locked behavior                                   |
| `POST /auth/member/login`                   | Alias of `/auth/login`                            |
| `POST /auth/member/refresh`                 | Alias of `/auth/refresh`                          |
| `POST /auth/member/logout`                  | Alias of `/auth/logout`                           |
| `POST /auth/member/register`                | Alias of `/auth/registration/initiate`            |
| `POST /auth/member/register/verify`         | Alias of `/auth/registration/verify`              |
| `POST /auth/member/register/complete`       | Alias of `/auth/registration/complete`            |
| `POST /auth/member/register/resend-otp`     | Alias of `/auth/registration/resend`              |
| `POST /auth/member/password-reset/request`  | Alias of `/auth/password-reset/initiate`          |
| `POST /auth/member/password-reset/verify`   | Alias of `/auth/password-reset/verify`            |
| `POST /auth/member/password-reset/complete` | Alias of `/auth/password-reset/complete`          |

### 9.2 Command Center Decisions (D-019)

The following decisions apply as of P2-S4 acceptance (2026-07-18).

**Response Field Casing**

- **Decision**: `camelCase` is the canonical standard for all new API responses.
- **Legacy**: Currently mixed responses (token responses in camelCase, OTP responses in snake_case, completion responses in camelCase) are NOT modified in this phase to avoid breaking existing consumers.
- **Contract marker**: Each endpoint table should note `Canonical: camelCase | Legacy: mixed fields temporarily compatible`.
- **Migration**: A dedicated compatibility/migration phase is required before enforcing uniform camelCase.

**Member Route Path Variants**

- **Canonical route**: The non-member paths under `/auth/` are canonical (e.g., `/auth/registration/initiate`).
- **Aliases**: Member alias paths under `/auth/member/` are **retained temporarily** to avoid breaking existing callers.
- **Deprecation**: All aliases MUST be marked `deprecated: true` in the OpenAPI spec.
- **No new aliases**: No additional route aliases may be created.
- **Future removal**: Alias deletion must occur in a dedicated API version migration phase.

**Rate Limit Configurability**

- Refresh rate limit (was hardcoded 30/60s): **RESOLVED** — now configurable via `AUTH_REFRESH_RATE_LIMIT_COUNT` / `AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS` env vars (default: 30/60).
- Generic OTP issue rate limit (5/3600s): Remains hardcoded but should be made configurable in a follow-up.

**InMemoryRateLimiter → Redis**

- **Decision**: Deferred. Current InMemoryRateLimiter is acceptable for single-instance development and testing.
- **Prerequisite**: Redis must be implemented BEFORE any of these conditions occur: multi-API-instance deployment, horizontal scaling, load-balanced multi-node, or production public launch.
- **Backlog item**: `AUTH-INFRA-001` — Distributed Redis Rate Limiter.
- **Risk**: ACCEPTED for single-instance phase; BLOCKER before multi-instance production.

**Unimplemented Error Codes (AUTH_PASSWORD_WEAK, AUTH_FLOW_EXPIRED, AUTH_IDEMPOTENCY_REQUIRED)**

- **Decision**: These codes are NOT part of the public runtime contract. They must be:
  1. Removed from endpoint-level error response descriptions in this contract.
  2. Kept in the internal type union as reserved/future codes.
  3. NOT deleted from production code to avoid breaking references.
- **Rationale**: Public contract must match real runtime behavior exactly.

**POST /auth/member/password-reset/request Path**

- **Decision**: Canonical path is `/auth/password-reset/initiate`. The member alias `/auth/member/password-reset/request` is retained temporarily and marked deprecated.
- **Future**: Rename to `/auth/member/password-reset/initiate` in a future API version migration.

---

## 10. Open Questions

1. **Frontend DTOs**: Frontend apps (member-web, merchant-web, admin-web) currently have no API client DTO files. The only API client exists at `packages/api-client/src/index.ts` and defines `AuthTokens` and `ApiErrorBody` interfaces. Field alignment cannot be fully verified until frontend DTOs are implemented.

2. **`development_code` exposure**: The OTP code is returned in non-production environments. Is this acceptable for staging environments used by external testers, or should a separate QA configuration be provided?

3. **Neutral email response for password reset**: `initiatePasswordReset()` returns a `202` with a valid OTP even for unknown emails. The OTP cannot be verified without access to the email, but the `development_code` in test/dev would expose a valid code. Should the development code be suppressed for unknown email password-reset requests?

4. **Refresh rate limit hardcoding**: The 30 req/60s limit for `rotateRefreshToken()` is hardcoded in the service rather than configured via `AuthSettings`. Should this be made configurable?

5. **Generic OTP rate limit hardcoding**: The 5 req/3600s limit for `issueOtp()` is hardcoded. Should this be made configurable?

6. **Member registration OTP resend cooldown**: The cooldown is enforced on the specific OTP record, not on the email or IP. Multiple resend requests could be made by creating new OTP records (via initiating a new registration). Is this an intentional design?

---

## Appendix: Source Files

| File                   | Path                                              |
| ---------------------- | ------------------------------------------------- |
| Controller             | `apps/api/src/auth/auth.controller.ts`            |
| DTOs                   | `apps/api/src/auth/auth.dto.ts`                   |
| Service                | `apps/api/src/auth/auth.service.ts`               |
| Errors                 | `apps/api/src/auth/auth.errors.ts`                |
| Types                  | `apps/api/src/auth/auth.types.ts`                 |
| Guard                  | `apps/api/src/auth/auth.guard.ts`                 |
| Constants              | `apps/api/src/auth/auth.constants.ts`             |
| Rate Limit Port        | `apps/api/src/auth/rate-limit.port.ts`            |
| Auth Store Port        | `apps/api/src/auth/auth-store.port.ts`            |
| HTTP Integration Tests | `apps/api/src/auth/auth.http.integration.spec.ts` |
| Unit Tests             | `apps/api/src/auth/auth.controller.spec.ts`       |
| API Client             | `packages/api-client/src/index.ts`                |

> **End of Auth API Contract — v1.0 (FROZEN)**
