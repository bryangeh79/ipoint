# P1-S3 — Merchant Onboarding Domain/API (Phase 1 Batch A)

## Authorization

- **Source:** ChatGPT Command Center — Phase 1 Implementation Authorization (2026-07-16)
- **Decision:** D-010
- **Current Head:** e8870a92f91874c319fc8ea4e1acc895fe993b4d (phase branch)
- **Task Branch:** task/p1-s3-merchant-onboarding-api
- **Only P1-S3 scope.** P1-S2 schema is already committed.

## Context

P1-S2 established Drizzle schemas, migrations, seeds, and tests for Merchant, Package, and MCP domains under `packages/database/`. P1-S3 builds the NestJS service layer and API endpoints on top of that foundation.

## Required reading

- All existing Phase 0 auth/RBAC code under `apps/api/src/auth/` and `apps/api/src/platform-access/`
- All P1-S2 Drizzle schema in `packages/database/schema/index.ts`
- P1-S1 domain documents under `docs/06-phase-reports/p1-s1/`
- Merchant PRD and Admin PRD

## Implementation Scope

### 1. NestJS Module Structure

Create `apps/api/src/merchant/` module with:

- `merchant.module.ts` — imports DatabaseModule, PlatformAccessModule, AuthModule
- `merchant.service.ts` — core service with all business logic
- `merchant.controller.ts` — REST endpoints
- `merchant.errors.ts` — domain-specific error codes
- `dto/` — Zod validation schemas for each endpoint
- `guards/` — merchant ownership guard (validates the authenticated account owns the target branch via MerchantGroup)
- Tests in `__tests__/`

### 2. Merchant Registration Flow

`POST /api/v1/merchant/register`

- Uses existing Auth infrastructure (accounts, credentials, sessions)
- Email verification via existing OTP mechanism
- Creates account → creates default MerchantGroup for this account → creates first MerchantBranch under that group
- Captures referral/upline if provided (via MerchantReferral table)
- Records TermsAcceptance (version, locale, IP, device)
- Generates concurrent-safe Merchant ID: `{market_code}_{channel}_{running_number}`
- Returns branch_id, merchant_id, group_id
- Validate: account email is immutable primary email, no modifiable contact_email field

### 3. Merchant Profile Management

`GET /api/v1/merchant/branches/{branchId}/profile`
`PATCH /api/v1/merchant/branches/{branchId}/profile`

- Profile fields: display_name, phone, address, about, business_hours, website, whatsapp, socials
- Gallery: `POST /api/v1/merchant/branches/{branchId}/profile/gallery` — max 10 gallery entries
- Logo/banner via object_key metadata (no actual file upload in this phase)
- **Email**: PATCH must NOT accept `email` or `primary_email` fields. If present, return 400.
- **No separate contact_email field** in Profile. The account email is the only email.
- Business hours: weekly schedule as JSONB

### 4. Merchant Application

`POST /api/v1/merchant/branches/{branchId}/application/submit`

- Creates immutable application submission snapshot
- Transitions: DRAFT → SUBMITTED
- `GET /api/v1/merchant/branches/{branchId}/application` — view current status

### 5. Admin Application Review

`GET /api/v1/admin/markets/{marketId}/merchants/applications` — list queue
`POST /api/v1/admin/markets/{marketId}/merchants/{branchId}/application/review`

- Review transitions: SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED | RESUBMISSION_REQUIRED
- Each review record is append-only with reviewer, decision, reason, timestamp
- Application result is independent from KYC and Operational status

### 6. Operational Status Computation

After Application APPROVED, and when KYC status changes, compute:

- If Application not APPROVED → PENDING_APPLICATION
- If Application APPROVED, KYC not APPROVED → PENDING_KYC
- If Application + KYC APPROVED, MCP < 100 → PENDING_MCP
- If Application + KYC APPROVED, MCP >= 100 → ACTIVE
- Create status_history record on each change

### 7. Admin Suspend/Reactivate/Close

`POST /api/v1/admin/markets/{marketId}/merchants/{branchId}/suspend`
`POST /api/v1/admin/markets/{marketId}/merchants/{branchId}/reactivate`
`POST /api/v1/admin/markets/{marketId}/merchants/{branchId}/close`

- Suspend preserves MCP
- Reactivate reevaluates activation policy
- Close is terminal
- All transitions: audit log + entity timeline + status_history

### 8. Ownership & Market Guards

- `MerchantOwnershipGuard`: validates the authenticated account owns the target branch's MerchantGroup (via merchant_account_access)
- Market validation: every request checks `X-Market-Id` header or path market_id against the branch's market
- Admin requests use existing RbacGuard + RequirePermission

### 9. RBAC & Audit

- Use existing `RbacService` with `RequirePermission()`
- Permission codes: `merchant.view`, `merchant.approve`, `merchant.suspend`, `merchant.close`
- Every state transition writes AuditLog + EntityTimeline
- Existing AuthGuard + Bearer token for merchant self-service

### 10. Idempotency

- `Idempotency-Key` header support on write endpoints
- Return existing result for same key

## Integration with Existing Phase 0

- Auth: uses existing `AuthGuard` with Bearer tokens for merchant self-service
- Admin: uses existing `RbacGuard` + `RequirePermission` decorator
- Market: uses existing `MarketService` for validation
- Audit: uses existing `AuditService.recordPrivilegedAction()`
- Times: UTC storage, business-timezone evaluation per market

## Tests

- Unit tests for MerchantService (mock database)
- Integration tests for registration flow (real database in test compose)
- Integration tests for application review flow
- Integration tests for ownership guard (positive + negative)
- Integration tests for email immutability (reject PATCH with email field)
- Integration tests for operational status state machine
- At least use `pnpm test:api` targets

## Deliverables

- `apps/api/src/merchant/` — complete module
- Merchant controller with endpoints listed above
- Tests: unit + integration
- All existing tests still pass (pnpm test, pnpm test:api, pnpm test:database)

## Verifications

- `pnpm format:check` ✅
- `pnpm lint` ✅
- `pnpm typecheck` ✅
- `pnpm build` ✅
- `pnpm test` ✅ (all existing unit tests + new)
- `pnpm test:api` ✅ (API integration tests)
- `pnpm test:database` ✅ (P1-S2 integration tests unaffected)
- `pnpm db:checksum` ✅ (must still pass)
- `pnpm db:drift` ✅ (no schema drift)
- Ownership guard rejects unauthorized account
- Email immutability: PATCH with email = 400
- Admin without permission: 403
- Market mismatch: 403

## Prohibited

- No P1-S4 work (KYC review — that's next)
- No receipt, QR, transaction, reward, commission, advertising
- No merchant staff roles
- No modifiable contact_email field
- No direct file upload (metadata only)
- No main push
- No force push
