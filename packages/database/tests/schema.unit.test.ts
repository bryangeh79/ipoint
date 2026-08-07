import { readFile } from 'node:fs/promises';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  adminMemberNotes,
  memberKycCases,
  memberKycCaseStatus,
  memberKycIdentificationType,
  memberKycIdempotencyKeys,
  memberProfiles,
  merchantBranchCategories,
  merchantBranches,
  merchantCategories,
  merchantPackageAssignments,
  merchantProfiles,
} from '../schema/index.js';
import { expectedSchema } from '../src/expected-schema.js';
import { calculateMigrationChecksums } from '../src/migration-checksums.js';
import { migrationsDirectory } from '../src/paths.js';

describe('database foundation schema', () => {
  it('contains every required generic platform entity', () => {
    expect(Object.keys(expectedSchema)).toEqual(
      expect.arrayContaining([
        'accounts',
        'credentials',
        'sessions',
        'otps',
        'security_events',
        'markets',
        'admin_users',
        'roles',
        'permissions',
        'role_permissions',
        'role_assignments',
        'market_access',
        'audit_logs',
        'entity_timelines',
        'members',
        'member_profiles',
        'member_market_preferences',
        'member_referrals',
        'member_referral_history',
        'member_terms_acceptances',
        'member_qr_identities',
        'member_kyc_cases',
        'member_kyc_idempotency_keys',
        'member_kyc_documents',
        'member_account_country_change_requests',
        'member_status_history',
        'admin_member_notes',
        'member_kyc_history',
      ]),
    );
  });

  it('contains every Phase 1 merchant, package, and MCP entity', () => {
    expect(Object.keys(expectedSchema)).toEqual(
      expect.arrayContaining([
        'merchant_groups',
        'merchant_account_access',
        'merchant_branches',
        'merchant_profiles',
        'merchant_categories',
        'merchant_branch_categories',
        'merchant_api_idempotency_keys',
        'merchant_profile_gallery_entries',
        'merchant_applications',
        'merchant_application_submissions',
        'merchant_application_reviews',
        'merchant_kyc_submissions',
        'merchant_kyc_reviews',
        'merchant_documents',
        'merchant_referrals',
        'merchant_terms_acceptances',
        'merchant_status_history',
        'merchant_id_counters',
        'service_fee_profiles',
        'service_fee_versions',
        'special_percentages',
        'merchant_package_assignments',
        'mcp_accounts',
        'mcp_ledger_entries',
        'mcp_recharge_requests',
        'mcp_refund_requests',
        'mcp_adjustment_requests',
        'mcp_adjustment_decisions',
      ]),
    );
  });

  it('defines the merchant discovery query contract without exposing legacy branches', () => {
    expect(expectedSchema.merchant_branches).toEqual(
      expect.arrayContaining([
        'market_id',
        'status',
        'is_publicly_visible',
        'is_online',
        'is_offline',
        'coordinates',
        'display_order',
      ]),
    );

    const config = getTableConfig(merchantBranches);
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column]),
    );
    expect(columns['is_publicly_visible']?.notNull).toBe(true);
    expect(columns['is_publicly_visible']?.default).toBe(false);
    expect(columns['coordinates']?.notNull).toBe(false);
    expect(columns['coordinates']?.columnType).toBe('PgPointObject');
    expect(columns['display_order']?.default).toBe(0);
    expect(config.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        'merchant_branches_discovery_idx',
        'merchant_branches_coordinates_gist_idx',
        'merchant_branches_name_search_idx',
      ]),
    );
    expect(config.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        'merchant_branches_coordinates_check',
        'merchant_branches_display_order_check',
      ]),
    );
  });

  it('defines market-scoped merchant categories and discovery support indexes', () => {
    expect(expectedSchema.merchant_categories).toEqual([
      'id',
      'market_id',
      'code',
      'name',
      'sort_order',
      'is_active',
      'created_at',
      'updated_at',
    ]);
    expect(expectedSchema.merchant_branch_categories).toEqual([
      'merchant_branch_id',
      'category_id',
      'market_id',
      'is_primary',
      'created_at',
    ]);

    expect(
      getTableConfig(merchantCategories).indexes.map(
        (index) => index.config.name,
      ),
    ).toContain('merchant_categories_market_active_idx');
    expect(
      getTableConfig(merchantBranchCategories).indexes.map(
        (index) => index.config.name,
      ),
    ).toEqual(
      expect.arrayContaining([
        'merchant_branch_categories_category_idx',
        'merchant_branch_categories_primary_unique',
      ]),
    );
    expect(
      getTableConfig(merchantProfiles).indexes.map(
        (index) => index.config.name,
      ),
    ).toContain('merchant_profiles_about_search_idx');
    expect(
      getTableConfig(merchantPackageAssignments).indexes.map(
        (index) => index.config.name,
      ),
    ).toContain('merchant_package_assignments_branch_status_idx');
  });

  it('keeps Phase 1 evidence and ledger tables mutation-free', () => {
    for (const table of [
      'merchant_application_submissions',
      'merchant_application_reviews',
      'merchant_kyc_submissions',
      'merchant_kyc_reviews',
      'merchant_documents',
      'merchant_referrals',
      'merchant_terms_acceptances',
      'merchant_status_history',
      'mcp_ledger_entries',
      'mcp_adjustment_decisions',
    ] as const) {
      expect(expectedSchema[table]).not.toEqual(
        expect.arrayContaining(['updated_at', 'archived_at', 'deleted_at']),
      );
    }
  });

  it('stores only hashes for credentials, sessions, and OTP secrets', () => {
    expect(expectedSchema.credentials).toContain('secret_hash');
    expect(expectedSchema.sessions).toEqual(
      expect.arrayContaining(['access_token_hash', 'refresh_token_hash']),
    );
    expect(expectedSchema.otps).toContain('code_hash');
    const secretColumns = [
      ...expectedSchema.credentials,
      ...expectedSchema.sessions,
      ...expectedSchema.otps,
    ];
    expect(secretColumns).not.toEqual(
      expect.arrayContaining([
        'password',
        'secret',
        'access_token',
        'refresh_token',
        'code',
        'token',
      ]),
    );
  });

  it('defines nullable member profile display name and phone verification columns', () => {
    expect(expectedSchema.member_profiles).toEqual(
      expect.arrayContaining([
        'display_name',
        'phone_normalized',
        'phone_verification_status',
        'phone_changed_at',
        'phone_verified_at',
      ]),
    );

    const config = getTableConfig(memberProfiles);
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column]),
    );

    expect(columns['display_name']?.notNull).toBe(false);
    expect(columns['phone_normalized']?.notNull).toBe(false);
    expect(columns['phone_verification_status']?.notNull).toBe(true);
    expect(columns['phone_verification_status']?.default).toBe('NOT_PROVIDED');
    expect(columns['phone_changed_at']?.columnType).toBe('PgTimestamp');
    expect(columns['phone_verified_at']?.columnType).toBe('PgTimestamp');
  });

  it('defines member profile phone constraints and the partial unique index', () => {
    const config = getTableConfig(memberProfiles);

    expect(config.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        'check_phone_verification_status',
        'check_phone_null_consistency',
        'check_phone_pending_consistency',
        'check_phone_verified_consistency',
      ]),
    );
    expect(config.indexes.map((index) => index.config.name)).toContain(
      'member_profiles_phone_normalized_unique',
    );
  });

  it('includes phone verification columns in member_profiles', () => {
    expect(expectedSchema.member_profiles).toEqual(
      expect.arrayContaining([
        'phone_normalized',
        'phone_verification_status',
        'phone_changed_at',
        'phone_verified_at',
      ]),
    );
  });

  it('has display_name nullable in member_profiles', () => {
    // display_name must be present but is nullable (no NOT NULL constraint)
    expect(expectedSchema.member_profiles).toContain('display_name');
  });

  it('has valid phone verification status enum values', () => {
    // phone_verification_status uses CHECK constraint with these values
    const validStatuses = ['NOT_PROVIDED', 'PENDING', 'VERIFIED'] as const;
    expect(validStatuses).toHaveLength(3);
    expect(validStatuses).toEqual(
      expect.arrayContaining(['NOT_PROVIDED', 'PENDING', 'VERIFIED']),
    );
  });

  it('has phone verification status column with valid default', () => {
    expect(expectedSchema.member_profiles).toContain(
      'phone_verification_status',
    );
  });

  it('defines the complete KYC state machine and identification types', () => {
    expect(memberKycCaseStatus.enumValues).toEqual([
      'NOT_STARTED',
      'DRAFT',
      'SUBMITTED',
      'UNDER_REVIEW',
      'APPROVED',
      'REJECTED',
      'MORE_INFO_REQUIRED',
      'REVERIFICATION_REQUIRED',
    ]);
    expect(memberKycIdentificationType.enumValues).toEqual([
      'PASSPORT',
      'NATIONAL_ID',
      'DRIVING_LICENSE',
      'RESIDENCE_PERMIT',
      'OTHER',
    ]);
  });

  it('defines KYC Level 2 data and submission snapshot columns', () => {
    expect(expectedSchema.member_kyc_cases).toEqual(
      expect.arrayContaining([
        'legal_full_name',
        'identification_type',
        'identification_number',
        'date_of_birth',
        'nationality',
        'residential_address',
        'account_country_snapshot',
        'submission_market_id',
        'consent_version',
        'submitted_at',
      ]),
    );

    const config = getTableConfig(memberKycCases);
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column]),
    );
    expect(columns['identification_type']?.enumValues).toEqual(
      memberKycIdentificationType.enumValues,
    );
    expect(columns['date_of_birth']?.columnType).toBe('PgDateString');
    expect(columns['residential_address']?.columnType).toBe('PgJsonb');
    expect(columns['submission_market_id']?.columnType).toBe('PgUUID');
    expect(config.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        'member_kyc_cases_nationality_check',
        'member_kyc_cases_account_country_snapshot_check',
        'member_kyc_cases_residential_address_check',
        'member_kyc_cases_level_2_submission_fields_check',
      ]),
    );
  });

  it('defines scoped KYC idempotency storage', () => {
    expect(expectedSchema.member_kyc_idempotency_keys).toEqual([
      'id',
      'scope',
      'key',
      'request_hash',
      'response',
      'status_code',
      'created_at',
      'updated_at',
    ]);
    const config = getTableConfig(memberKycIdempotencyKeys);
    expect(
      config.uniqueConstraints.map((constraint) => constraint.name),
    ).toContain('member_kyc_idempotency_scope_key_unique');
    expect(config.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        'member_kyc_idempotency_request_hash_check',
        'member_kyc_idempotency_result_check',
      ]),
    );
  });

  it('defines append-only admin member notes with bounded non-empty content', () => {
    expect(expectedSchema.admin_member_notes).toEqual([
      'id',
      'member_id',
      'admin_user_id',
      'market_id',
      'content',
      'is_internal',
      'created_at',
    ]);

    const config = getTableConfig(adminMemberNotes);
    expect(config.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        'admin_member_notes_content_not_empty_check',
        'admin_member_notes_content_max_length_check',
      ]),
    );
    expect(
      config.indexes.map((indexDefinition) => indexDefinition.config.name),
    ).toContain('admin_member_notes_member_created_at_idx');
  });

  it('keeps migrations explicit SQL and in the checksum set', async () => {
    const checksums = await calculateMigrationChecksums();
    expect(Object.keys(checksums)).toEqual([
      '0000_database_foundation.sql',
      '0001_auth_session_access_expiry.sql',
      '0002_phase_1_merchant_package_mcp.sql',
      '0003_merchant_api_support.sql',
      '0004_service_fee_package_management.sql',
      '0005_mcp_ledger_recharge.sql',
      '0006_mcp_adjustment_refund_governance.sql',
      '0007_phase_2_member_schema_forward_migrations.sql',
      '0008_phase_2_member_registration_auth.sql',
      '0009_add_sessions_family_id_index.sql',
      '0010_member_profile_phone_and_default_market_hardening.sql',
      '0011_member_kyc_level_2_hardening.sql',
      '0012_merchant_discovery_indexes.sql',
      '0013_admin_member_notes.sql',
      '0014_phase_3_reward_and_wallet_schema.sql',
      '0015_phase_4_transaction_schema.sql',
      '0016_phase_4_s3_audit_idempotency_nullable.sql',
      '0017_phase_4_s6_correction_requests.sql',
      '0018_phase_5_agent_commission_schema.sql',
      '0019_phase_5_commission_outbox.sql',
      '0020_phase_6_redemption_center_canonical.sql',
      '0021_phase_6_redemption_contract_corrections.sql',
      '0022_phase_6_inventory_direct_consumption.sql',
      '0023_phase_6_final_contract_alignment.sql',
      '0024_phase_6_terms_order_binding.sql',
      '0025_phase_6_shipping_terms_constraints.sql',
      '0026_phase_6_shipping_recovery_v2.sql',
      '0027_admin_mfa_session_policy.sql',
      '0028_admin_market_session_context.sql',
      '0029_p5_r1_agent_fee_version_snapshot.sql',
      '0030_p3_d050_reward_rule_reason.sql',
      '0031_p6_d053_redemption_rate_owner.sql',
      '0032_p5_d054_commission_rate_reason.sql',
      '0033_p1_d051_special_percentage_reason.sql',
      '0034_p3_p7_sec01_ipoint_adjustment_owner.sql',
      '0035_p7_s7a_mcp_adjustment_conformance.sql',
      '0036_p6_sec02_refund_ledger_owner.sql',
    ]);
    const migration = await readFile(
      `${migrationsDirectory}/0000_database_foundation.sql`,
      'utf8',
    );
    expect(migration).toContain('CREATE TRIGGER audit_logs_append_only');
    expect(migration).toContain('CREATE TRIGGER entity_timelines_append_only');
    expect(migration).not.toMatch(/member|merchant|wallet|commission|ipoint/iu);

    const phaseOneMigration = await readFile(
      `${migrationsDirectory}/0002_phase_1_merchant_package_mcp.sql`,
      'utf8',
    );
    expect(phaseOneMigration).toContain('CREATE FUNCTION reject_update()');
    expect(phaseOneMigration).toContain('CREATE FUNCTION reject_delete()');
    expect(phaseOneMigration).toContain('CREATE FUNCTION generate_merchant_id');
    expect(phaseOneMigration).not.toMatch(
      /CREATE TABLE (transactions|receipts|rewards|commissions|advertisements)/iu,
    );

    const memberProfileHardeningMigration = await readFile(
      `${migrationsDirectory}/0010_member_profile_phone_and_default_market_hardening.sql`,
      'utf8',
    );
    expect(memberProfileHardeningMigration).toContain(
      'ADD COLUMN IF NOT EXISTS phone_normalized text',
    );
    expect(memberProfileHardeningMigration).toContain(
      "ADD COLUMN IF NOT EXISTS phone_verification_status text NOT NULL DEFAULT 'NOT_PROVIDED'",
    );
    expect(memberProfileHardeningMigration).toEqual(
      expect.stringContaining('ALTER COLUMN display_name DROP NOT NULL'),
    );
    for (const constraint of [
      'check_phone_verification_status',
      'check_phone_null_consistency',
      'check_phone_pending_consistency',
      'check_phone_verified_consistency',
    ]) {
      expect(memberProfileHardeningMigration).toContain(
        `ADD CONSTRAINT ${constraint}`,
      );
    }
    expect(memberProfileHardeningMigration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS member_profiles_phone_normalized_unique',
    );
    expect(memberProfileHardeningMigration).not.toMatch(
      /CREATE UNIQUE INDEX[^;]*member_market_preferences/iu,
    );

    const memberKycHardeningMigration = await readFile(
      `${migrationsDirectory}/0011_member_kyc_level_2_hardening.sql`,
      'utf8',
    );
    expect(memberKycHardeningMigration).toContain(
      'CREATE TYPE member_kyc_identification_type AS ENUM',
    );
    expect(memberKycHardeningMigration).toContain(
      'ADD COLUMN identification_number text',
    );
    for (const constraint of [
      'member_kyc_cases_nationality_check',
      'member_kyc_cases_account_country_snapshot_check',
      'member_kyc_cases_residential_address_check',
      'member_kyc_cases_level_2_submission_fields_check',
      'member_kyc_idempotency_scope_key_unique',
      'member_kyc_idempotency_request_hash_check',
      'member_kyc_idempotency_result_check',
    ]) {
      expect(memberKycHardeningMigration).toContain(constraint);
    }
    expect(memberKycHardeningMigration).toContain(
      'CREATE INDEX member_kyc_cases_submission_market_idx',
    );
    expect(memberKycHardeningMigration).toContain(
      'CREATE TABLE member_kyc_idempotency_keys',
    );
    expect(memberKycHardeningMigration).toContain(
      'CONSTRAINT member_kyc_idempotency_scope_key_unique UNIQUE (scope, key)',
    );
    expect(memberKycHardeningMigration).toContain(
      '(response IS NULL AND status_code IS NULL)',
    );
    expect(memberKycHardeningMigration).toContain(
      '(response IS NOT NULL AND status_code BETWEEN 100 AND 599)',
    );

    const merchantDiscoveryMigration = await readFile(
      `${migrationsDirectory}/0012_merchant_discovery_indexes.sql`,
      'utf8',
    );
    expect(merchantDiscoveryMigration).toContain(
      'ADD COLUMN is_publicly_visible boolean NOT NULL DEFAULT false',
    );
    expect(merchantDiscoveryMigration).toContain(
      'CREATE INDEX merchant_branches_coordinates_gist_idx',
    );
    expect(merchantDiscoveryMigration).toContain(
      'CREATE TABLE merchant_categories',
    );
    expect(merchantDiscoveryMigration).toContain(
      'CREATE TABLE merchant_branch_categories',
    );
    expect(merchantDiscoveryMigration).not.toMatch(
      /ALTER TABLE service_fee_profiles|ALTER TABLE service_fee_versions/iu,
    );

    const adminMemberNotesMigration = await readFile(
      `${migrationsDirectory}/0013_admin_member_notes.sql`,
      'utf8',
    );
    expect(adminMemberNotesMigration).toContain(
      'CREATE TABLE admin_member_notes',
    );
    expect(adminMemberNotesMigration).toContain(
      'CONSTRAINT admin_member_notes_content_not_empty_check',
    );
    expect(adminMemberNotesMigration).toContain(
      'CONSTRAINT admin_member_notes_content_max_length_check',
    );
    expect(adminMemberNotesMigration).toContain(
      'CREATE INDEX admin_member_notes_member_created_at_idx',
    );
    expect(adminMemberNotesMigration).toContain(
      'CREATE TRIGGER admin_member_notes_append_only',
    );
  });
});
