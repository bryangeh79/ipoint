import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
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
      ]),
    );
  });

  it('keeps migrations explicit SQL and in the checksum set', async () => {
    const checksums = await calculateMigrationChecksums();
    expect(Object.keys(checksums)).toEqual([
      '0000_database_foundation.sql',
      '0001_auth_session_access_expiry.sql',
      '0002_phase_1_merchant_package_mcp.sql',
      '0003_merchant_api_support.sql',
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
  });
});
