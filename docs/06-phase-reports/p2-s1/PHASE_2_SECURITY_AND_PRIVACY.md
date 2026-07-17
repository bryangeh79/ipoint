---
title: Phase 2 Security and Privacy
phase: P2-S1
status: freeze
implementation_authorized: false
date: 2026-07-17
---

# Phase 2 Security and Privacy

## 1. Threat model summary

Phase 2 handles identity, account-country, current-market, referral, QR, and KYC data. The main risks are account takeover, enumeration, sensitive-data leakage, token replay, privilege abuse, incorrect market scoping, and history corruption.

## 2. Assets

| Asset | Why it matters |
|---|---|
| Email and password | Account takeover risk |
| OTP codes | Single-factor verification gate |
| Refresh tokens | Session persistence and replay risk |
| Member ID and referral code | Public identity and referral tampering risk |
| Current market preference | Market-context integrity and cache drift risk |
| QR token | Merchant-facing identity token |
| KYC documents | Highly sensitive personal data |
| Account-country change requests | Jurisdiction and compliance risk |
| Member status and suspension state | Access control risk |
| Audit and timeline records | Forensic evidence |

## 3. Trust boundaries

| Boundary | Risk | Required control |
|---|---|---|
| Browser -> API | Client tampering | Server validation, strict schemas |
| Public auth -> session creation | Enumeration and brute force | Rate limiting, OTP limits, generic errors |
| Member self-service -> member aggregate | Ownership abuse | Server-side ownership check |
| Admin -> market-scoped records | Privilege escalation | Role + permission + market access |
| API -> object storage | Document leakage | Signed URLs, short TTL, private buckets |
| API -> logs/audit | Sensitive value leakage | Redaction and masking |
| QR consumer -> member identity | Token cloning | Unpredictable tokens and rotation |

## 4. Key threats and mitigations

### 4.1 Password hashing

- Use a slow, memory-safe password hashing algorithm already approved by the platform baseline.
- Store hash version and algorithm metadata.
- Reject short or malformed passwords before hashing.
- Never log password material.

### 4.2 OTP expiry, attempts, rate limit, single use

- OTPs expire quickly.
- OTP attempts are capped.
- OTP verification is single-use.
- Resend and verify operations are rate limited.
- OTP responses must not reveal whether an account exists.

### 4.3 Email enumeration prevention

- Registration, OTP issue, login, and password reset should return generic responses.
- Distinguish success/failure only where operationally required.
- Do not reveal whether an email is registered, verified, suspended, or closed.

### 4.4 Refresh token rotation and revocation

- Use token family tracking.
- Rotate refresh tokens on every refresh.
- Revoke the whole family on logout or reuse detection.
- Reject replay of a previously used refresh token.

### 4.5 Session expiry and token replay

- Access tokens should be short-lived.
- Refresh tokens should have bounded lifetime.
- Replay detection should trigger family revocation and security event logging.

### 4.6 CORS

- Allow only approved member and admin web origins.
- Never use wildcard credentials mode for authenticated browser traffic.
- Preflight responses must not expose unrelated methods or headers.

### 4.7 QR identity

- QR token material must be unpredictable and not derived from member ID, email, phone, or database ID.
- Active QR identity should rotate on demand or on explicit policy event only.
- Phase 2 does not enforce automatic periodic rotation.
- Revocation must immediately stop reuse.
- The payload should be signed and versioned if rendered to merchants.
- The database stores the public QR identity and token hash only; plaintext token material is never persisted.

### 4.8 KYC file access

- Store documents in private object storage.
- Serve them through short-lived signed URLs or equivalent grants.
- Restrict file types and sizes.
- Validate content type against the uploaded bytes where possible.
- Reject malware or unsupported files.

### 4.9 Sensitive log redaction

- Redact emails, phone numbers, document metadata, account-country notes, token values, and QR secrets.
- Audit logs may store reason and before/after values only when required.
- Do not put raw KYC content in operational logs.

### 4.10 Admin sensitive access audit

- Every privileged action must be auditable.
- Include actor, action, object, market, reason, and result.
- Access to KYC and country-change detail must be visible in audit history.

### 4.11 MarketAccess enforcement

- Admin access must be checked against the target market.
- Route params or server-resolved entity market IDs are authoritative.
- A client-supplied market ID alone is never sufficient.

### 4.12 Referral tampering

- A member may only have one active direct referrer at a time.
- A member may not self-modify the referrer relationship.
- Referrer must not equal the member.
- Referral cycles must be rejected.
- Admin correction must require a reason, request ID, authorized actor, and audit event.
- Admin correction must run in a transaction and append immutable history rather than overwrite or delete the prior relationship.
- Phase 2 does not calculate commission, but later commission systems must be able to trace historical referral state at transaction time.

### 4.13 Account Country and Current Market separation

- Account Country is a compliance anchor.
- Current Market is a browsing and content context.
- Switching Current Market must not mutate Account Country.
- Account Country changes must go through review.
- Current Market must be persisted as the single source of truth in member market preferences.
- Session and request context may derive Current Market, but neither may become the authoritative source.
- Cache must never become the source of truth for Current Market.

### 4.14 Suspended member permissions

- Suspended members must not create or rotate sensitive identity artifacts.
- Suspended members must not submit KYC or country-change requests.
- Sensitive endpoints should return a clear suspension error.
- Existing sessions should be revoked or made non-authoritative when status changes.

### 4.15 Closed member protection

- CLOSED members cannot log in or perform any business operation.
- Member-facing routes should only expose closed status and support handoff entry points.
- Authorized admins may view closed-member data for audit and customer service.
- Referral code and QR identity are no longer valid for CLOSED members.
- CLOSED is terminal and cannot auto-recover.

## 5. Privacy controls

- Minimize exposed profile fields in discovery views.
- Mask phone, address, and KYC data by default.
- Avoid displaying referral structure beyond what the caller is entitled to see.
- Separate public member ID from internal account or member UUIDs.
- Use least privilege for admin detail views.
- Keep KYC retention policy per market configurable and auditable; do not hard-code retention years without Legal decision.

## 6. Observability rules

- Every request must carry a request ID.
- Security events should be recorded for failed logins, OTP abuse, token reuse, country-change approval, KYC review, suspension, and QR rotation.
- Logs must remain useful without exposing secrets.
