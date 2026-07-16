# P1-S2 — Merchant Schema and Migrations (Phase 1 Batch A)

## Authorization

- **Source:** ChatGPT Command Center — Phase 1 Implementation Authorization (2026-07-16 18:27 GMT+8)
- **Decision:** D-010 — PHASE 1 IMPLEMENTATION AUTHORIZED
- **Batch A:** P1-S2 (current), P1-S3, P1-S4 authorized
- **P1-S5+:** NOT AUTHORIZED
- **Main merge:** NOT AUTHORIZED
- **Execution:** Codex CLI only; no OpenClaw sub-agent

## Git Strategy

1. Create phase branch `phase/1-merchant-onboarding-mcp` from `46912b557227954e392ed622189eda82892cd717`
2. Cherry-pick the two P1-S1 commits: `7c1bd3b` and `1f0ba5a` from `origin/task/p1-s1-baseline-domain-map`
3. Fix SpecialPercentage in the P1-S1 docs on the phase branch: rate > 0% and rate <= 100%, numeric(12,6)
4. Create task branch `task/p1-s2-merchant-schema` from the phase branch
5. Implement schema, migrations, seed, tests
6. Commit and push task branch

## Schema Requirements

### Enums (PostgreSQL via Drizzle)

Create proper Drizzle enum definitions for:

- `merchant_application_status`: 'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'RESUBMISSION_REQUIRED', 'APPROVED', 'REJECTED'
- `merchant_kyc_status`: 'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'RESUBMISSION_REQUIRED', 'APPROVED', 'REJECTED'
- `merchant_operational_status`: 'PENDING_APPLICATION', 'PENDING_KYC', 'PENDING_MCP', 'ACTIVE', 'SUSPENDED', 'CLOSURE_PENDING', 'CLOSED'
- `mcp_entry_type`: 'RECHARGE', 'TRANSACTION_DEDUCTION', 'ADVERTISING_DEDUCTION', 'MANUAL_CREDIT', 'MANUAL_DEBIT', 'REFUND', 'FREEZE', 'UNFREEZE', 'REVERSAL'
- `mcp_direction`: 'CREDIT', 'DEBIT'
- `adjustment_state`: 'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXECUTED', 'CANCELLED'
- `recharge_state`: 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'
- `refund_state`: 'PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'
- `service_fee_status`: 'ACTIVE', 'PAUSED', 'PENDING_CHANGE'
- `auth_account_access_type`: 'PRIMARY_OWNER' (only this in Phase 1)
- `merchant_status_reason_type`: text

### Merchant Domain Tables

**merchant_groups**

- id: uuid PK defaultRandom
- account_id: uuid FK → accounts, NOT NULL
- market_id: uuid FK → markets, NOT NULL
- name: text NOT NULL
- created_at: timestamptz(6) NOT NULL defaultNow
- updated_at: timestamptz(6) NOT NULL defaultNow

**merchant_account_access**

- id: uuid PK defaultRandom
- account_id: uuid FK → accounts, NOT NULL
- merchant_group_id: uuid FK → merchant_groups, NOT NULL
- access_type: auth_account_access_type NOT NULL default 'PRIMARY_OWNER'
- created_at: timestamptz(6) NOT NULL defaultNow
- Unique constraint on (account_id, merchant_group_id)

**merchant_branches**

- id: uuid PK defaultRandom
- merchant_group_id: uuid FK → merchant_groups, NOT NULL
- merchant_id: text NOT NULL UNIQUE (public ID: country-channel-number e.g. my-of-000001)
- market_id: uuid FK → markets, NOT NULL
- name: text NOT NULL
- status: merchant_operational_status NOT NULL default 'PENDING_APPLICATION'
- version: integer NOT NULL default 1
- created_at: timestamptz(6) NOT NULL defaultNow
- updated_at: timestamptz(6) NOT NULL defaultNow
- Index on merchant_group_id
- Index on merchant_id

**merchant_profiles**

- id: uuid PK defaultRandom
- merchant_branch_id: uuid FK → merchant_branches, NOT NULL UNIQUE
- logo_url: text
- banner_url: text
- about_us: text (max 1000 chars, validate in service layer)
- business_hours: jsonb
- phone: text
- whatsapp: text
- website: text
- social_links: jsonb
- created_at: timestamptz(6) NOT NULL defaultNow
- updated_at: timestamptz(6) NOT NULL defaultNow
- Gallery entries stored via a separate metadata approach (max 10)

**merchant_applications**

- id: uuid PK defaultRandom
- merchant_branch_id: uuid FK → merchant_branches, NOT NULL UNIQUE
- status: merchant_application_status NOT NULL default 'DRAFT'
- version: integer NOT NULL default 1
- created_at: timestamptz(6) NOT NULL defaultNow
- updated_at: timestamptz(6) NOT NULL defaultNow

**merchant_application_submissions** (append-only)

- id: uuid PK defaultRandom
- merchant_application_id: uuid FK → merchant_applications, NOT NULL
- submission_version: integer NOT NULL
- submitted_data: jsonb NOT NULL (immutable snapshot)
- submitted_at: timestamptz(6) NOT NULL defaultNow
- NO updated_at, NO soft-delete
- Append-only trigger

**merchant_application_reviews** (append-only)

- id: uuid PK defaultRandom
- merchant_application_id: uuid FK → merchant_applications, NOT NULL
- reviewer_admin_user_id: uuid FK → admin_users, NOT NULL
- decision: merchant_application_status (APPROVED/REJECTED/RESUBMISSION_REQUIRED)
- reason: text NOT NULL
- decided_at: timestamptz(6) NOT NULL defaultNow
- NO updated_at, NO soft-delete
- Append-only trigger

**merchant_kyc_submissions** (append-only)

- id: uuid PK defaultRandom
- merchant_branch_id: uuid FK → merchant_branches, NOT NULL
- status: merchant_kyc_status NOT NULL default 'DRAFT'
- submission_version: integer NOT NULL
- submitted_data: jsonb NOT NULL (immutable evidence snapshot)
- submitted_at: timestamptz(6) NOT NULL defaultNow
- NO updated_at, NO soft-delete
- Append-only trigger

**merchant_kyc_reviews** (append-only)

- id: uuid PK defaultRandom
- merchant_kyc_submission_id: uuid FK → merchant_kyc_submissions, NOT NULL
- reviewer_admin_user_id: uuid FK → admin_users, NOT NULL
- decision: merchant_kyc_status (APPROVED/REJECTED/RESUBMISSION_REQUIRED)
- reason: text NOT NULL
- decided_at: timestamptz(6) NOT NULL defaultNow
- NO updated_at, NO soft-delete
- Append-only trigger

**merchant_documents**

- id: uuid PK defaultRandom
- merchant_branch_id: uuid FK → merchant_branches, NOT NULL
- document_type: text NOT NULL
- file_name: text NOT NULL
- mime_type: text NOT NULL
- file_size_bytes: bigint NOT NULL
- sha256_hash: text NOT NULL
- object_key: text NOT NULL (opaque private key)
- uploaded_at: timestamptz(6) NOT NULL defaultNow
- NO updated_at (immutable after upload)
- Index on merchant_branch_id

**merchant_referrals** (append-only)

- id: uuid PK defaultRandom
- merchant_branch_id: uuid FK → merchant_branches, NOT NULL UNIQUE
- referrer_account_id: uuid FK → accounts
- referred_at: timestamptz(6) NOT NULL defaultNow
- NO updated_at, NO soft-delete

**merchant_terms_acceptances** (append-only)

- id: uuid PK defaultRandom
- account_id: uuid FK → accounts, NOT NULL
- merchant_branch_id: uuid FK → merchant_branches, NOT NULL
- terms_version: text NOT NULL
- accepted_at: timestamptz(6) NOT NULL defaultNow
- ip_address: text
- user_agent: text
- locale: text
- NO updated_at, NO soft-delete
- Append-only trigger

**merchant_status_history** (append-only)

- id: uuid PK defaultRandom
- merchant_branch_id: uuid FK → merchant_branches, NOT NULL
- previous_status: merchant_operational_status
- new_status: merchant_operational_status NOT NULL
- changed_by_actor_type: text NOT NULL
- changed_by_actor_id: text NOT NULL
- reason: text
- changed_at: timestamptz(6) NOT NULL defaultNow
- NO updated_at, NO soft-delete
- Append-only trigger

### Package Domain Tables

**service_fee_profiles**

- id: uuid PK defaultRandom
- code: text NOT NULL UNIQUE (A, B, C, D, E, F)
- name: text NOT NULL
- description: text
- created_at: timestamptz(6) NOT NULL defaultNow

**service_fee_versions**

- id: uuid PK defaultRandom
- service_fee_profile_id: uuid FK → service_fee_profiles, NOT NULL
- rate: numeric(12,6) NOT NULL (PostgreSQL numeric)
- effective_from: timestamptz(6) NOT NULL
- effective_to: timestamptz(6)
- status: service_fee_status NOT NULL default 'ACTIVE'
- market_id: uuid FK → markets
- created_at: timestamptz(6) NOT NULL defaultNow
- Exclusion constraint preventing overlapping effective ranges for same profile+market
- Check: rate > 0 AND rate <= 100

**special_percentages**

- id: uuid PK defaultRandom
- rate: numeric(12,6) NOT NULL
- created_by_admin_user_id: uuid FK → admin_users, NOT NULL
- description: text
- market_id: uuid FK → markets
- created_at: timestamptz(6) NOT NULL defaultNow
- Check: rate > 0 AND rate <= 100

**merchant_package_assignments**

- id: uuid PK defaultRandom
- merchant_branch_id: uuid FK → merchant_branches, NOT NULL
- service_fee_version_id: uuid FK → service_fee_versions
- special_percentage_id: uuid FK → special_percentages
- status: service_fee_status NOT NULL default 'ACTIVE'
- is_default: boolean NOT NULL default false
- version: integer NOT NULL default 1
- created_at: timestamptz(6) NOT NULL defaultNow
- updated_at: timestamptz(6) NOT NULL defaultNow
- Check: exactly one of service_fee_version_id or special_percentage_id must be set (use CHECK with XOR logic)
- Constraint: at least one active default per merchant_branch
- Index on merchant_branch_id, status

### MCP Domain Tables

**mcp_accounts**

- id: uuid PK defaultRandom
- merchant_branch_id: uuid FK → merchant_branches, NOT NULL UNIQUE
- market_id: uuid FK → markets, NOT NULL
- available_balance: numeric(24,8) NOT NULL default 0
- total_balance: numeric(24,8) NOT NULL default 0
- version: integer NOT NULL default 1
- created_at: timestamptz(6) NOT NULL defaultNow
- updated_at: timestamptz(6) NOT NULL defaultNow
- Check: available_balance >= 0
- Check: total_balance >= 0

**mcp_ledger_entries** (append-only)

- id: uuid PK defaultRandom
- mcp_account_id: uuid FK → mcp_accounts, NOT NULL
- sequence: bigint NOT NULL
- entry_type: mcp_entry_type NOT NULL
- direction: mcp_direction NOT NULL
- amount: numeric(24,8) NOT NULL
- balance_delta: numeric(24,8) NOT NULL
- available_delta: numeric(24,8) NOT NULL
- source_type: text NOT NULL
- source_id: text
- idempotency_key: text NOT NULL
- payload_hash: text NOT NULL
- actor_type: text NOT NULL
- actor_id: text
- approval_request_id: uuid
- reversal_of_entry_id: uuid (self-FK → mcp_ledger_entries.id)
- metadata: jsonb NOT NULL default '{}'
- effective_at: timestamptz(6) NOT NULL
- created_at: timestamptz(6) NOT NULL defaultNow
- Unique: (mcp_account_id, sequence)
- Unique: (mcp_account_id, idempotency_key)
- Unique index on reversal_of_entry_id where not null
- Check: amount > 0
- NO updated_at, NO soft-delete
- Append-only trigger

**mcp_recharge_requests**

- id: uuid PK defaultRandom
- mcp_account_id: uuid FK → mcp_accounts, NOT NULL
- market_id: uuid FK → markets, NOT NULL
- requested_by_account_id: uuid FK → accounts, NOT NULL
- amount: numeric(24,8) NOT NULL
- channel: text NOT NULL
- status: recharge_state NOT NULL default 'PENDING'
- idempotency_key: text NOT NULL
- provider_event_id: text
- reviewed_by_admin_user_id: uuid FK → admin_users
- review_reason: text
- ledger_entry_id: uuid FK → mcp_ledger_entries
- created_at: timestamptz(6) NOT NULL defaultNow
- updated_at: timestamptz(6) NOT NULL defaultNow
- Unique: (mcp_account_id, idempotency_key)
- Unique index on provider_event_id where not null
- Check: amount > 0

**mcp_refund_requests**

- id: uuid PK defaultRandom
- mcp_account_id: uuid FK → mcp_accounts, NOT NULL
- market_id: uuid FK → markets, NOT NULL
- requested_by_account_id: uuid FK → accounts, NOT NULL
- amount: numeric(24,8) NOT NULL
- status: refund_state NOT NULL default 'PENDING'
- reason: text NOT NULL
- idempotency_key: text NOT NULL
- reviewed_by_admin_user_id: uuid FK → admin_users
- review_reason: text
- ledger_entry_id: uuid FK → mcp_ledger_entries
- created_at: timestamptz(6) NOT NULL defaultNow
- updated_at: timestamptz(6) NOT NULL defaultNow
- Unique: (mcp_account_id, idempotency_key)
- Check: amount > 0

**mcp_adjustment_requests**

- id: uuid PK defaultRandom
- mcp_account_id: uuid FK → mcp_accounts, NOT NULL
- market_id: uuid FK → markets, NOT NULL
- maker_admin_user_id: uuid FK → admin_users, NOT NULL
- entry_type: mcp_entry_type NOT NULL (only MANUAL_CREDIT or MANUAL_DEBIT)
- amount: numeric(24,8) NOT NULL
- reason: text NOT NULL
- evidence: jsonb NOT NULL default '{}'
- status: adjustment_state NOT NULL default 'DRAFT'
- idempotency_key: text NOT NULL
- ledger_entry_id: uuid FK → mcp_ledger_entries
- version: integer NOT NULL default 1
- created_at: timestamptz(6) NOT NULL defaultNow
- updated_at: timestamptz(6) NOT NULL defaultNow
- Unique: (mcp_account_id, idempotency_key)
- Check: amount > 0
- Check: entry_type in ('MANUAL_CREDIT','MANUAL_DEBIT')

**mcp_adjustment_decisions** (append-only)

- id: uuid PK defaultRandom
- adjustment_request_id: uuid FK → mcp_adjustment_requests, NOT NULL UNIQUE
- market_id: uuid FK → markets, NOT NULL
- checker_admin_user_id: uuid FK → admin_users, NOT NULL
- decision: text NOT NULL (APPROVED or REJECTED)
- reason: text NOT NULL
- decided_at: timestamptz(6) NOT NULL defaultNow
- NO updated_at, NO soft-delete
- Append-only trigger
- Check: decision in ('APPROVED','REJECTED')

## Migration File

Create `0002_phase_1_merchant_package_mcp.sql` under `packages/database/migrations/`

Migration order:

1. Create custom enum types (using CREATE TYPE or Drizzle migration)
2. Create merchant_groups, merchant_account_access
3. Create merchant_branches (depends on merchant_groups)
4. Create merchant_profiles
5. Create merchant_applications, merchant_application_submissions, merchant_application_reviews
6. Create merchant_kyc_submissions, merchant_kyc_reviews
7. Create merchant_documents, merchant_referrals, merchant_terms_acceptances, merchant_status_history
8. Create service_fee_profiles, service_fee_versions, special_percentages
9. Create merchant_package_assignments
10. Create mcp_accounts, mcp_ledger_entries, mcp_recharge_requests, mcp_refund_requests
11. Create mcp_adjustment_requests, mcp_adjustment_decisions
12. Add append-only triggers
13. Add constraints and indexes

## Append-Only Triggers

For tables marked append-only, create BEFORE UPDATE and BEFORE DELETE triggers that raise an exception:

```sql
CREATE OR REPLACE FUNCTION reject_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'UPDATE is not allowed on append-only table %', TG_TABLE_NAME; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reject_delete() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'DELETE is not allowed on append-only table %', TG_TABLE_NAME; END;
$$ LANGUAGE plpgsql;
```

## Merchant ID Generation

Implement a function/service for concurrent-safe Merchant ID generation:

- Format: `{market_code}_{channel}_{running_number}` e.g. `my_of_000001`
- Use a dedicated sequence `merchant_branch_number_seq` per market-channel
- Or use atomic counter with `SELECT COALESCE(MAX(running_number), 0) + 1 FROM ... FOR UPDATE`
- Do NOT use MAX(id)+1 approach

## Seed Data

Create/update `seeds/foundation.ts` (or a new Phase 1 seed):

- Service fee profiles A-F with their standard values: A=2.5, B=5, C=10, D=15, E=20, F=25
- Phase 1 permission codes: merchant.view, merchant.approve, merchant.package.assign, merchant.mcp.adjust, etc.
- Idempotent: use onConflictDoNothing

## Tests Required (in packages/database/tests/)

- Schema unit test: verify all expected entities exist
- Migration integration: fresh migration, upgrade from 0001, idempotent rerun
- Append-only trigger tests: attempt UPDATE and DELETE on append-only tables, expect rejection
- Merchant ID generation: concurrent safety test
- MerchantGroup/Branch cardinality: verify FK constraints
- Special percentage rate check: 0 < rate <= 100
- Check constraint verification
- Seed idempotency: run twice, same result
- Drift check: no schema drift after migration
- Checksum verification

## Expected Schema Update

Update `packages/database/src/expected-schema.ts` to include the new Phase 1 columns per table.

## Files to Create/Modify

- `packages/database/schema/index.ts` — add all new tables and enums
- `packages/database/migrations/0002_phase_1_merchant_package_mcp.sql` — new migration
- `packages/database/migrations/checksums.json` — add checksum for 0002
- `packages/database/seeds/foundation.ts` — update with Phase 1 seeds
- `packages/database/src/expected-schema.ts` — update expected schema
- `packages/database/tests/schema.unit.test.ts` — add Phase 1 entity checks
- `packages/database/tests/database.integration.test.ts` — add Phase 1 migration/invariant tests

## Verification Gates

- ✅ `pnpm format:check`
- ✅ `pnpm lint`
- ✅ `pnpm typecheck`
- ✅ `pnpm build`
- ✅ `pnpm test` (unit tests)
- ✅ `pnpm test:database` (integration)
- ✅ `pnpm db:checksum`
- ✅ `pnpm db:migrate` (fresh + upgrade)
- ✅ `pnpm db:seed` (twice for idempotency)
- ✅ `pnpm db:drift`
- ✅ Append-only UPDATE/DELETE rejection
- ✅ Merchant ID concurrent generation
- ✅ Email immutability constraint check
- ✅ Secret pattern scan
- ✅ Scope leakage audit

## Prohibited

- No P1-S3, P1-S4, P1-S5+ work
- No receipt, QR, transaction, reward, commission, advertising
- No merchant staff roles
- No production cloud keys
- No binary in database
- No public KYC URLs
- No force push
- No main push
