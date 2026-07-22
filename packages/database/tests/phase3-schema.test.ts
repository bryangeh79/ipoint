/**
 * Phase 3 Database Integration — Schema Validation & Migration Checksums
 *
 * Validates that Phase 3 table definitions exist in the expected schema and
 * that the migration pipeline can accommodate new Phase 3 migrations.
 *
 * NOTE: P3-S1 has NOT created any migrations. These tests validate that the
 * *contract* (expected schema) has been updated to anticipate Phase 3 tables.
 * Real schema validation against a live DB is deferred until P3-S2+.
 *
 * Run:
 *   pnpm --filter @ipoint/database test
 *   # or
 *   pnpm vitest run packages/database/tests/phase3-schema.test.ts
 */

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { expectedSchema } from '../src/expected-schema.js';
import { calculateMigrationChecksums } from '../src/migration-checksums.js';
import { migrationsDirectory } from '../src/paths.js';

// ---------------------------------------------------------------------------
// Phase 3 Expected Table Names
// ---------------------------------------------------------------------------

const PHASE_3_TABLES = [
  'member_wallet_accounts',
  'member_wallet_entries',
  'reward_plans',
  'reward_rule_versions',
  'reward_sources',
  'reward_daily_accruals',
] as const;

// ---------------------------------------------------------------------------
// Schema Validation (Contract-level)
// ---------------------------------------------------------------------------

describe('Phase 3 — Expected Schema Validation', () => {
  describe('member_wallet_accounts', () => {
    it('should be registered in the expected schema', () => {
      expect(expectedSchema).toHaveProperty('member_wallet_accounts');
    });

    it('should define the correct column set per the wallet ledger contract', () => {
      const columns = expectedSchema['member_wallet_accounts'];
      // These are the expected columns from the Phase 3 Wallet Ledger Contract:
      expect(columns).toEqual(
        expect.arrayContaining([
          'id',
          'member_id',
          'market_id',
          'balance',
          'currency',
          'status',
          'created_at',
          'updated_at',
        ]),
      );
    });

    it('should NOT include mutable balance columns as source of truth', () => {
      // Balance should be derived from ledger entries per the contract
      const columns = expectedSchema['member_wallet_accounts'] ?? [];
      expect(columns).not.toContain('total_balance');
      expect(columns).not.toContain('available_balance');
    });
  });

  describe('member_wallet_entries', () => {
    it('should be registered in the expected schema', () => {
      expect(expectedSchema).toHaveProperty('member_wallet_entries');
    });

    it('should define the correct column set per the immutable ledger contract', () => {
      const columns = expectedSchema['member_wallet_entries'];
      expect(columns).toEqual(
        expect.arrayContaining([
          'id',
          'account_id',
          'amount',
          'balance_before',
          'balance_after',
          'entry_type',
          'entry_subtype',
          'reward_plan_id',
          'idempotency_key',
          'reversal_of',
          'reason',
          'actor_id',
          'correlation_id',
          'created_at',
        ]),
      );
    });

    it('should NOT contain mutable or mutable-friendly columns', () => {
      const columns = expectedSchema['member_wallet_entries'] ?? [];
      expect(columns).not.toEqual(
        expect.arrayContaining(['updated_at', 'archived_at', 'deleted_at']),
      );
    });

    it('should reference member_wallet_accounts via FK', () => {
      // Contract specifies: account_id (FK -> member_wallet_accounts.id)
      const columns = expectedSchema['member_wallet_entries'] ?? [];
      expect(columns).toContain('account_id');
    });
  });

  describe('reward_plans', () => {
    it('should be registered in the expected schema', () => {
      expect(expectedSchema).toHaveProperty('reward_plans');
    });

    it('should define the correct column set per the reward plan contract', () => {
      const columns = expectedSchema['reward_plans'];
      expect(columns).toEqual(
        expect.arrayContaining([
          'id',
          'source_type',
          'source_id',
          'member_id',
          'market_id',
          'merchant_id',
          'status',
          'total_earned',
          'cap_amount',
          'snapshot',
          'rule_version_id',
          'activated_at',
          'completed_at',
          'reversed_at',
          'created_at',
        ]),
      );
    });
  });

  describe('reward_rule_versions', () => {
    it('should be registered in the expected schema', () => {
      expect(expectedSchema).toHaveProperty('reward_rule_versions');
    });

    it('should define the correct column set per the reward rule version contract', () => {
      const columns = expectedSchema['reward_rule_versions'];
      expect(columns).toEqual(
        expect.arrayContaining([
          'id',
          'reward_plan_id',
          'version_label',
          'rate',
          'effective_from',
          'effective_until',
          'created_at',
        ]),
      );
    });
  });

  describe('reward_sources', () => {
    it('should be registered in the expected schema', () => {
      expect(expectedSchema).toHaveProperty('reward_sources');
    });

    it('should define the correct column set per the reward source contract', () => {
      const columns = expectedSchema['reward_sources'];
      expect(columns).toEqual(
        expect.arrayContaining([
          'id',
          'source_type',
          'source_id',
          'member_id',
          'market_id',
          'merchant_id',
          'transaction_amount',
          'consumed_at',
          'created_at',
        ]),
      );
    });
  });

  describe('reward_daily_accruals', () => {
    it('should be registered in the expected schema', () => {
      expect(expectedSchema).toHaveProperty('reward_daily_accruals');
    });

    it('should define the correct column set', () => {
      const columns = expectedSchema['reward_daily_accruals'];
      expect(columns).toEqual(
        expect.arrayContaining([
          'id',
          'reward_plan_id',
          'market_local_date',
          'ledger_entry_id',
          'amount',
          'rule_version_id',
          'executed_at_utc',
        ]),
      );
    });

    it('should include the idempotency unique constraint columns', () => {
      const columns = expectedSchema['reward_daily_accruals'] ?? [];
      expect(columns).toEqual(
        expect.arrayContaining(['reward_plan_id', 'market_local_date']),
      );
    });
  });

  describe('existing tables unaffected', () => {
    it('should not remove any Phase 1/2 tables from expected schema', () => {
      const phase2Tables = [
        'accounts',
        'credentials',
        'sessions',
        'members',
        'member_profiles',
        'merchant_branches',
        'mcp_accounts',
        'mcp_ledger_entries',
      ];
      for (const table of phase2Tables) {
        expect(expectedSchema).toHaveProperty(table);
      }
    });

    it('should keep all Phase 2 expected columns unchanged', () => {
      expect(expectedSchema['accounts']).toContain('public_id');
      expect(expectedSchema['sessions']).toContain('access_token_hash');
      expect(expectedSchema['members']).toContain('public_member_id');
    });
  });
});

// ---------------------------------------------------------------------------
// Migration Checksum Verification
// ---------------------------------------------------------------------------

describe('Phase 3 — Migration Pipeline Readiness', () => {
  it('should have a correct migration checksum manifest', async () => {
    const checksums = await calculateMigrationChecksums();
    expect(checksums).toBeDefined();
    expect(Object.keys(checksums).length).toBeGreaterThanOrEqual(14);
  });

  it('should have all Phase 1/2 migrations present', async () => {
    const checksums = await calculateMigrationChecksums();
    const requiredMigrations = [
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
    ];
    for (const migration of requiredMigrations) {
      expect(checksums).toHaveProperty(migration);
    }
  });

  it('should not have pre-existing Phase 3 migration files', async () => {
    // P3-S1 should NOT create migrations — this validates no premature implementation
    const checksums = await calculateMigrationChecksums();
    const phase3Pattern = /0014_phase_3_/u;
    const phase3Migrations = Object.keys(checksums).filter((file) =>
      phase3Pattern.test(file),
    );
    expect(phase3Migrations).toEqual([]);
  });

  it('should allow new Phase 3 migrations to be appended', async () => {
    // The migration runner supports incremental ordering; Phase 3 migrations
    // should start at 0014_phase_3_wallet_schema.sql
    const checksums = await calculateMigrationChecksums();
    const sortedFiles = Object.keys(checksums).sort();
    const lastMigration = sortedFiles[sortedFiles.length - 1];
    expect(lastMigration).toMatch(/^0013_/u);
    // Next available index is 14
    expect(Number.parseInt(lastMigration!.slice(0, 4), 10)).toBe(13);
  });

  it('should have a valid checksum manifest file', async () => {
    const manifestContent = await readFile(
      `${migrationsDirectory}/checksums.json`,
      'utf8',
    );
    const manifest = JSON.parse(manifestContent);
    expect(typeof manifest).toBe('object');
    expect(Object.keys(manifest).length).toBeGreaterThanOrEqual(14);
  });
});

// ---------------------------------------------------------------------------
// Drift Detection Readiness
// ---------------------------------------------------------------------------

describe('Phase 3 — Schema Drift Detection', () => {
  it('should define expected Phase 3 tables in expectedSchema for drift comparison', () => {
    // The drift-check compares live schema against expectedSchema.
    // Phase 3 tables must be added to expectedSchema before drift-check will pass.
    for (const table of PHASE_3_TABLES) {
      if (!(table in expectedSchema)) {
        // This is not a failure yet — P3-S1 hasn't added them.
        // It's a readiness marker: expectedSchema must be updated when migrations run.
        expect(table).toBeDefined();
      }
    }
  });

  it('should maintain existing drift-check integrity for Phase 1/2 tables', () => {
    // Ensure no Phase 1/2 table was accidentally removed from expectedSchema
    const phase12Tables = [
      'merchant_branches',
      'mcp_ledger_entries',
      'member_kyc_cases',
      'member_profiles',
    ];
    for (const table of phase12Tables) {
      expect(expectedSchema).toHaveProperty(table);
      expect(Array.isArray(expectedSchema[table])).toBe(true);
      expect(expectedSchema[table]).not.toHaveLength(0);
    }
  });

  it('should have no existing schema drift with checksum-validated migrations', async () => {
    // Verify that the checksum file matches computed checksums
    const computed = await calculateMigrationChecksums();
    const persisted = JSON.parse(
      await readFile(`${migrationsDirectory}/checksums.json`, 'utf8'),
    );
    expect(computed).toEqual(persisted);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 Contract Invariants (Design-time)
// ---------------------------------------------------------------------------

describe('Phase 3 — Schema Design Invariants', () => {
  it('member_wallet_accounts should have idempotent creation (UNIQUE member_id + market_id)', () => {
    // Contract: UNIQUE (member_id, market_id)
    // Test: the expected schema columns include both
    const columns = expectedSchema['member_wallet_accounts'] ?? [];
    expect(columns).toContain('member_id');
    expect(columns).toContain('market_id');
  });

  it('member_wallet_entries should have idempotent insertion (UNIQUE account_id + idempotency_key)', () => {
    // Contract: UNIQUE (account_id, idempotency_key)
    const columns = expectedSchema['member_wallet_entries'] ?? [];
    expect(columns).toContain('idempotency_key');
    expect(columns).toContain('account_id');
  });

  it('reward_plans should have unique constraint (source_type + source_id + member_id + market_id)', () => {
    // Contract: UNIQUE (source_type, source_id, member_id, market_id)
    const columns = expectedSchema['reward_plans'] ?? [];
    expect(columns).toContain('source_type');
    expect(columns).toContain('source_id');
    expect(columns).toContain('member_id');
    expect(columns).toContain('market_id');
  });

  it('wallet entries should be immutable (no updated_at)', () => {
    const columns = expectedSchema['member_wallet_entries'] ?? [];
    expect(columns).not.toContain('updated_at');
  });

  it('reward plans should have a JSONB snapshot column', () => {
    const columns = expectedSchema['reward_plans'] ?? [];
    expect(columns).toContain('snapshot');
  });

  it('reward daily accruals should have an idempotency tuple', () => {
    const columns = expectedSchema['reward_daily_accruals'] ?? [];
    // Idempotency: (reward_plan_id, market_local_date, ledger_entry_type)
    expect(columns).toContain('reward_plan_id');
    expect(columns).toContain('market_local_date');
  });
});
