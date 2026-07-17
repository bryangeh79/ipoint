# P1-S4 — Merchant KYC and Review (Phase 1 Batch A)

## Authorization

- **Source:** ChatGPT Command Center — Phase 1 Implementation Authorization (2026-07-16)
- **Decision:** D-010
- **Current Phase Branch Head:** 270f5635 (includes P1-S2 schema + P1-S3 merchant API)
- **Task Branch:** task/p1-s4-merchant-kyc-review
- **Only P1-S4 scope.** P1-S2 schema and P1-S3 merchant onboarding are already committed.

## Context

P1-S2 established Drizzle schemas (merchant_kyc_submissions, merchant_kyc_reviews, merchant_documents). P1-S3 built the merchant onboarding API (registration, profile, application/review, operational status). P1-S4 builds the KYC submission, document management, and admin review workflow on top of that foundation.

## Required Reading

- All P1-S2 Drizzle schema in `packages/database/schema/index.ts`
- Existing merchant module in `apps/api/src/merchant/`
- Existing auth/RBAC code under `apps/api/src/auth/` and `apps/api/src/platform-access/`
- Market service in `apps/api/src/platform-access/`
- P1-S1 domain documents under `docs/06-phase-reports/p1-s1/`
- Merchant PRD and Admin PRD

## Implementation Scope

### 1. KYC Submission Flow

`POST /api/v1/merchant/branches/{branchId}/kyc/submit`
`GET /api/v1/merchant/branches/{branchId}/kyc`

- Branch can have multiple KYC submissions (each is append-only immutable snapshot)
- First submission: DRAFT → SUBMITTED
- Resubmission: only when previous review is RESUBMISSION_REQUIRED
- KYC data:
  - Business certification: registration_number, business_name_registered, business_type (enum: sole_proprietorship, partnership, private_limited, public_limited, others), tax_id, registered_address, proof_of_registration_document_id (FK to merchant_documents)
  - PIC (Person In Charge) identity: full_name, identity_type (enum: nric, passport, others), identity_number, date_of_birth, nationality, proof_of_identity_document_id, proof_of_address_document_id
  - PIC contact: email (must match account email — immutable), phone (may differ from profile)
- Side-by-side diff support: KYC review UI needs previous submission data (GET returns current + previous)
- Validate: all required fields, max doc size advisory, MIME types (image/\*, application/pdf)

### 2. Document Management (Metadata Only)

`POST /api/v1/merchant/branches/{branchId}/documents/upload-intent`
`GET /api/v1/merchant/branches/{branchId}/documents`
`GET /api/v1/merchant/branches/{branchId}/documents/{documentId}`
`GET /api/v1/merchant/branches/{branchId}/documents/{documentId}/download-metadata`

- Document table schema (already exists in P1-S2 schema):
  - `id: uuid` PK
  - `branch_id: uuid` FK → merchant_branches
  - `document_type: merchant_document_type` enum (business_registration, pic_identity, pic_address_proof, bank_statement, financial_statement, operating_license, memorandum_articles, board_resolution, others)
  - `file_name: text` — original file name
  - `mime_type: text` — validated MIME
  - `file_size_bytes: integer` — validated size
  - `content_hash: text` — SHA-256 hex digest
  - `storage_key: text` — key for storage adapter (in Phase 1, validated metadata only)
  - `expires_at: timestamptz` — nullable, short-lived access expiry
  - `metadata: jsonb` — nullable, for storage adapter use
  - `uploaded_by: uuid` FK → accounts
  - `created_at: timestamptz` NOT NULL
- **No actual file upload in Phase 1.** Upload intent returns a storage_key that the adapter would use. Metadata validation is the focus.
- Validate:
  - MIME type: only `image/*` and `application/pdf` allowed
  - File size: max 15 MB per document (check file_size_bytes <= 15*1024*1024)
  - Content hash: 64-char hex SHA-256
  - Document type enumeration
- Each document is immutable once created (append-only semantics)
- `download-metadata` returns a signed / short-lived access contract (Phase 1: mock expiry + storage_key; actual signed URL deferred)

### 3. Admin KYC Review

`GET /api/v1/admin/markets/{marketId}/merchants/kyc` — list pending queue
`GET /api/v1/admin/markets/{marketId}/merchants/{branchId}/kyc/review` — view current KYC submission for review
`POST /api/v1/admin/markets/{marketId}/merchants/{branchId}/kyc/review`

- Review transitions:
  - SUBMITTED → UNDER_REVIEW (auto on first admin fetch for review, or explicit)
  - UNDER_REVIEW → APPROVED | REJECTED | RESUBMISSION_REQUIRED
- Review record fields: reviewer_id (uuid → accounts), decision (merchant_kyc_decision enum: approved, rejected, resubmission_required), reason (text), rejected_fields (text[] — specific field names to fix), created_at (timestamptz)
- All reviews are append-only (merchant_kyc_reviews table)
- Each review is an immutable record

### 4. Data Masking for KYC Data

- When merchant self-service GETs KYC submission after review, mask sensitive fields unless re-submission is required:
  - identity_number → `****1234` (last 4 chars visible)
  - tax_id → `***${last4}`
  - PIC phone → `***${last3}`
  - email → show full (it's the immutable account email anyway)
  - PIC full_name → show full
  - identity_type → show full
  - business_name_registered → show full
  - registration_number → `***${last4}`
- Masking function: if mask, show only last N chars prefixed with asterisks
- When resubmission is REQUIRED, show full unmasked data

### 5. Operational Status Computation Integration

- When KYC status changes (via review decision), the operational status for the branch MUST be recomputed:
  - Application not APPROVED → PENDING_APPLICATION
  - Application APPROVED, KYC not APPROVED → PENDING_KYC
  - Application + KYC APPROVED, MCP < 100 → PENDING_MCP
  - Application + KYC APPROVED, MCP >= 100 → ACTIVE
- Reuse or call the existing operational status computation from P1-S3
- Create status_history record on each change

### 6. RBAC

- Use existing `RbacService` with `RequirePermission()`
- Permission codes: `merchant.kyc.view`, `merchant.kyc.approve`
- KYC submit endpoint uses same AuthGuard as merchant self-service
- KYC review endpoints require `merchant.kyc.approve` permission
- Review queue listing requires `merchant.kyc.view` permission

### 7. Audit & Entity Timeline

- Every KYC submission is an AuditLog entry: `MERCHANT_KYC_SUBMITTED`
- Every KYC review decision is an AuditLog entry: `MERCHANT_KYC_REVIEWED`
- EntityTimeline entry for each KYC state transition

## Tests

- Unit tests for KYC service (mock database)
- Unit tests for data masking
- Integration tests for KYC submission flow (real database)
- Integration tests for KYC review workflow (submit → review → approve/reject/resubmission_required)
- Integration tests for data masking (masked vs unmasked based on review state)
- Integration tests for operational status computation after KYC changes
- Integration tests for document metadata validation (MIME, size, hash)
- Integration tests for resubmission flow (only allowed when RESUBMISSION_REQUIRED)
- All existing tests still pass

## Deliverables

- KYC submission service + controller endpoints
- Document metadata management (upload intent, list, get, download-metadata)
- Admin KYC review queue + review action
- Data masking for sensitive fields
- Operational status integration
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
- `pnpm db:checksum` ✅ (no schema changes expected beyond P1-S2)
- `pnpm db:drift` ✅ (no schema drift)

## Prohibited

- No actual file upload/download (metadata only in Phase 1)
- No actual storage adapter implementation (mock interface only)
- No receipt, QR, transaction, reward, commission, advertising
- No merchant staff roles
- No main push
- No force push
