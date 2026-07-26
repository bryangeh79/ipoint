# Phase 5 B Integration — Session Handoff State

## Status: B_INTEGRATION_CHANGES_REQUIRED

### What's Done (Accepted by Command Center)

| Deliverable | Status |
|---|---|
| Durable outbox migration (0019) | ✅ ACCEPTED |
| Same-transaction dispatch writing | ✅ ACCEPTED |
| Outbox worker structure | ✅ ACCEPTED |
| CI six-job pipeline | ✅ ACCEPTED |
| Anti-placeholder gate foundation | ✅ ACCEPTED |
| Worker: removed advisory lock (connection-safe) | ✅ PUSHED `d9031c26` |
| Worker: added processBatchOnce() public method | ✅ PUSHED `d9031c26` |
| ESG Lint: per-file overrides for outbox files | ✅ PUSHED |
| All existing 5 CI jobs pass | ✅ GREEN |
| Format/Lint/Typecheck | ✅ CLEAN |

### What's Broken (B Tests)

The file `apps/api/src/__tests__/b-transaction-commission.integration.spec.ts` has correct test structure (15 tests, no placeholders, no skips, no toBeDefined) but the `seedBase()` function uses raw SQL with **wrong column names** that don't match the actual PostgreSQL schemas.

#### Schema Mismatches Identified

**Markets table** (in `packages/database/migrations/0000_database_foundation.sql`):
- Columns: `id`, `code`, `name`, `status` (enum `market_status`), `currency_code`, `timezone`, `default_locale`, `created_at`, `updated_at`, `archived_at`
- My seed uses `country_code` (doesn't exist), `currency` (should be `currency_code`), missing `default_locale`
- ✅ **FIX APPLIED** in commit `d9031c26` — but not yet verified in CI

**Members table** (in `packages/database/migrations/0007_phase_2_member_schema_forward_migrations.sql`):
- Columns: `id`, `account_id` (FK→accounts, NOT NULL), `public_member_id`, `referral_code`, `status` (enum `member_status`), `kyc_level` (enum `member_kyc_level`), `closed_at`, `created_at`, `updated_at`, `archived_at`
- My seed uses `display_name`, `contact_number`, `country_code`, `joined_at` — none of these exist in `members`!
- Also missing `account_id` (NOT NULL FK) and `referral_code` (NOT NULL)
- **Fix needed**: Create accounts first, then insert members with correct columns

**Member_profiles table** (separate from members):
- Contains `display_name`, `phone`, `phone_verification_status`, etc.
- My seed data for display_name/contact_number should go here

**Merchant_groups table**:
- Columns: `id`, `account_id` (FK→accounts), `market_id` (FK→markets), `name`, `created_at`, `updated_at`
- My seed uses `id`, `name`, `market_id`, `status`, `created_at` — `status` column doesn't exist!
- **Fix needed**: Remove `status` from merchant_groups insert

**Merchant_branches table**:
- Columns: `id`, `merchant_group_id` (FK→merchant_groups), `merchant_id` (text, external), `market_id` (FK→markets), `name`, `status` (enum), `is_publicly_visible`, `is_online`, `is_offline`, `coordinates`, `display_order`, `version`, `created_at`, `updated_at`
- My seed references `merchant_id` (uuid FK) which is wrong — `merchant_id` is a text field, not a FK
- merchant_branches links to merchant_groups via `merchant_group_id`, not to a `merchants` table
- **Fix needed**: Insert merchant_groups first, then merchant_branches referencing it

**Transactions table**:
- Has `preview_session_id` (FK→transaction_preview_sessions, NOT NULL) — requires a preview session to exist
- My seed uses `gen_random_uuid()` for preview_session_id which violates FK constraint
- Also requires `merchant_branch_id` and `market_id` composite FK to merchant_branches
- **Fix needed**: Create a preview session first, then transaction referencing it

**Transaction_service_fees table**:
- Has `currency` (NOT NULL) and `rate` (NOT NULL) columns that my seed doesn't provide
- My seed uses only `transaction_id`, `market_id`, `amount`, `created_at`
- **Fix needed**: Add `currency` and `rate` columns

### Recommended Fix Strategy

1. **Use Drizzle ORM `.insert()` instead of raw SQL** for type-safe column mapping
2. Import the Drizzle schema:
   ```typescript
   import { markets, members, accounts, memberProfiles, merchantGroups, merchantBranches, transactions, transactionPreviewSessions, transactionServiceFees, referralRelationships, agentActivations, merchantAttributions, commissionRateVersions, transactionCommissionDispatch } from '@ipoint/database';
   ```
3. Use `db.insert(table).values({...}).returning()` for type-safe operations
4. Create entities in the correct order:
   - accounts → members → memberProfiles
   - accounts → merchantGroups → merchantBranches  
   - transactionPreviewSessions → transactions → transaction_service_fees
5. The `createConfirmedTransaction` helper needs special attention for the transactions FK chain

### Files Not Yet Committed

- `apps/api/src/__tests__/b-transaction-commission.integration.spec.ts` — seed SQL needs schema fix
- `scripts/p5-integration-gate.ps1` — working, pushed in `d9031c26`
- `apps/api/src/transaction/transaction-commission-outbox.worker.ts` — pushed in `d9031c26`

### Latest HEAD

`d9031c26` — `test(p5): real B integration tests + connection-safe worker + strengthened gate`

### Latest CI Run

30199779460 — Integration tests FAILED (seed SQL schema errors)

### Next Steps for Next Session

1. Fix `seedBase()` to use Drizzle ORM `.insert()` with correct schemas
2. Verify locally against a real PostgreSQL
3. Push and verify CI
4. Return B INTEGRATION FINAL DELIVERY REPORT — REAL DB VERIFICATION COMPLETE
