import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '../src/client.js';
import { migrate } from '../src/migration-runner.js';
import { verifyMigrationChecksums } from '../src/migration-checksums.js';
import { assertNoSchemaDrift } from '../src/drift-check.js';
import { accounts, auditLogs, entityTimelines } from '../schema/index.js';
import { foundationPermissions, seedFoundation } from '../seeds/foundation.js';
import { migrationsDirectory } from '../src/paths.js';

const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)('database foundation integration', () => {
  const connection = createDatabase(databaseUrl ?? '');
  let db: Database;

  beforeAll(async () => {
    db = connection.db;
    await migrate(connection.pool);
  });

  afterAll(async () => {
    await connection.pool.end();
  });

  async function withDisposableDatabase(
    callback: (url: string) => Promise<void>,
  ): Promise<void> {
    const databaseName = `ipoint_p1_${randomUUID().replaceAll('-', '')}`;
    const adminUrl = new URL(databaseUrl!);
    adminUrl.pathname = '/postgres';
    const admin = createDatabase(adminUrl.toString());
    await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
    const disposableUrl = new URL(databaseUrl!);
    disposableUrl.pathname = `/${databaseName}`;
    try {
      await callback(disposableUrl.toString());
    } finally {
      await admin.pool.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      await admin.pool.end();
    }
  }

  it('rebuilds from zero with all migrations and no drift', async () => {
    await expect(verifyMigrationChecksums()).resolves.toHaveProperty(
      '0000_database_foundation.sql',
    );
    await expect(verifyMigrationChecksums()).resolves.toHaveProperty(
      '0011_member_kyc_level_2_hardening.sql',
    );
    await expect(verifyMigrationChecksums()).resolves.toHaveProperty(
      '0012_merchant_discovery_indexes.sql',
    );
    await expect(verifyMigrationChecksums()).resolves.toHaveProperty(
      '0013_admin_member_notes.sql',
    );
    await expect(verifyMigrationChecksums()).resolves.toHaveProperty(
      '0014_phase_3_reward_and_wallet_schema.sql',
    );
    await expect(verifyMigrationChecksums()).resolves.toHaveProperty(
      '0015_phase_4_transaction_schema.sql',
    );
    await expect(verifyMigrationChecksums()).resolves.toHaveProperty(
      '0016_phase_4_s3_audit_idempotency_nullable.sql',
    );
    await expect(verifyMigrationChecksums()).resolves.toHaveProperty(
      '0017_phase_4_s6_correction_requests.sql',
    );
    await expect(assertNoSchemaDrift(connection.pool)).resolves.toBeUndefined();
    await expect(migrate(connection.pool)).resolves.toBeUndefined();
    const applied = await connection.pool.query<{ filename: string }>(
      'SELECT filename FROM database_migrations ORDER BY filename',
    );
    expect(applied.rows.map((row) => row.filename)).toEqual([
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
    ]);

    const auditReferenceColumn = await connection.pool.query<{
      is_nullable: string;
    }>(
      `SELECT is_nullable
       FROM information_schema.columns
       WHERE table_name = 'transaction_audit_references'
         AND column_name = 'idempotency_record_id'`,
    );
    expect(auditReferenceColumn.rows).toEqual([{ is_nullable: 'YES' }]);
  });

  it('applies merchant discovery columns, category tables, and query indexes', async () => {
    const columns = await connection.pool.query<{
      column_name: string;
      is_nullable: string;
      column_default: string | null;
      data_type: string;
    }>(
      `SELECT column_name, is_nullable, column_default, data_type
       FROM information_schema.columns
       WHERE table_name = 'merchant_branches'
         AND column_name = ANY($1::text[])
       ORDER BY column_name`,
      [
        [
          'coordinates',
          'display_order',
          'is_offline',
          'is_online',
          'is_publicly_visible',
        ],
      ],
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'coordinates',
      'display_order',
      'is_offline',
      'is_online',
      'is_publicly_visible',
    ]);
    expect(
      columns.rows.find((row) => row.column_name === 'coordinates'),
    ).toMatchObject({ data_type: 'point', is_nullable: 'YES' });
    expect(
      columns.rows.find((row) => row.column_name === 'is_publicly_visible'),
    ).toMatchObject({ column_default: 'false', is_nullable: 'NO' });

    const objects = await connection.pool.query<{
      category_table: string;
      mapping_table: string;
      discovery_index: string;
      coordinates_index: string;
      branch_search_index: string;
      profile_search_index: string;
    }>(
      `SELECT
         to_regclass('merchant_categories')::text AS category_table,
         to_regclass('merchant_branch_categories')::text AS mapping_table,
         to_regclass('merchant_branches_discovery_idx')::text AS discovery_index,
         to_regclass('merchant_branches_coordinates_gist_idx')::text AS coordinates_index,
         to_regclass('merchant_branches_name_search_idx')::text AS branch_search_index,
         to_regclass('merchant_profiles_about_search_idx')::text AS profile_search_index`,
    );
    expect(objects.rows[0]).toEqual({
      category_table: 'merchant_categories',
      mapping_table: 'merchant_branch_categories',
      discovery_index: 'merchant_branches_discovery_idx',
      coordinates_index: 'merchant_branches_coordinates_gist_idx',
      branch_search_index: 'merchant_branches_name_search_idx',
      profile_search_index: 'merchant_profiles_about_search_idx',
    });

    const fixture = await createMerchantFixture();
    const legacyDefaults = await connection.pool.query<{
      is_publicly_visible: boolean;
      is_online: boolean;
      is_offline: boolean;
      coordinates: string | null;
      display_order: number;
    }>(
      `SELECT is_publicly_visible, is_online, is_offline,
              coordinates::text, display_order
       FROM merchant_branches
       WHERE id = $1`,
      [fixture.branchId],
    );
    expect(legacyDefaults.rows[0]).toEqual({
      is_publicly_visible: false,
      is_online: false,
      is_offline: false,
      coordinates: null,
      display_order: 0,
    });

    await expect(
      connection.pool.query(
        `UPDATE merchant_branches
         SET status = 'ACTIVE', is_publicly_visible = true,
             is_offline = true, coordinates = point(101.6869, 3.1390)
         WHERE id = $1`,
        [fixture.branchId],
      ),
    ).resolves.toBeDefined();
    await expect(
      connection.pool.query(
        `UPDATE merchant_branches SET coordinates = point(181, 0)
         WHERE id = $1`,
        [fixture.branchId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    const category = await connection.pool.query<{ id: string }>(
      `INSERT INTO merchant_categories (market_id, code, name)
       VALUES ($1, 'DINING', 'Dining') RETURNING id`,
      [fixture.marketId],
    );
    await expect(
      connection.pool.query(
        `INSERT INTO merchant_branch_categories
           (merchant_branch_id, category_id, market_id, is_primary)
         VALUES ($1, $2, $3, true)`,
        [fixture.branchId, category.rows[0]?.id, fixture.marketId],
      ),
    ).resolves.toBeDefined();

    const otherMarket = await connection.pool.query<{ id: string }>(
      `INSERT INTO markets
         (code, name, status, currency_code, timezone, default_locale)
       VALUES ($1, 'Other Market', 'ACTIVE', 'MYR',
               'Asia/Kuala_Lumpur', 'en-MY') RETURNING id`,
      [randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()],
    );
    const otherCategory = await connection.pool.query<{ id: string }>(
      `INSERT INTO merchant_categories (market_id, code, name)
       VALUES ($1, 'DINING', 'Dining') RETURNING id`,
      [otherMarket.rows[0]?.id],
    );
    await expect(
      connection.pool.query(
        `INSERT INTO merchant_branch_categories
           (merchant_branch_id, category_id, market_id)
         VALUES ($1, $2, $3)`,
        [fixture.branchId, otherCategory.rows[0]?.id, otherMarket.rows[0]?.id],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('applies the 0011 KYC constraints, index, and idempotency table', async () => {
    const constraints = await connection.pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conname = ANY($1::text[])
       ORDER BY conname`,
      [
        [
          'member_kyc_cases_nationality_check',
          'member_kyc_cases_account_country_snapshot_check',
          'member_kyc_cases_residential_address_check',
          'member_kyc_cases_level_2_submission_fields_check',
          'member_kyc_idempotency_scope_key_unique',
          'member_kyc_idempotency_request_hash_check',
          'member_kyc_idempotency_result_check',
        ],
      ],
    );
    expect(constraints.rows.map((row) => row.conname)).toEqual([
      'member_kyc_cases_account_country_snapshot_check',
      'member_kyc_cases_level_2_submission_fields_check',
      'member_kyc_cases_nationality_check',
      'member_kyc_cases_residential_address_check',
      'member_kyc_idempotency_request_hash_check',
      'member_kyc_idempotency_result_check',
      'member_kyc_idempotency_scope_key_unique',
    ]);
    const objects = await connection.pool.query<{
      idempotency_table: string;
      submission_market_index: string;
    }>(
      `SELECT
         to_regclass('member_kyc_idempotency_keys')::text AS idempotency_table,
         to_regclass('member_kyc_cases_submission_market_idx')::text
           AS submission_market_index`,
    );
    expect(objects.rows[0]).toEqual({
      idempotency_table: 'member_kyc_idempotency_keys',
      submission_market_index: 'member_kyc_cases_submission_market_idx',
    });
  });

  it('applies Phase 1 migrations cleanly when upgrading an isolated database from 0001', async () => {
    await withDisposableDatabase(async (url) => {
      const isolated = createDatabase(url);
      try {
        const checksums = await verifyMigrationChecksums();
        await isolated.pool.query(`
          CREATE TABLE database_migrations (
            filename text PRIMARY KEY,
            checksum text NOT NULL,
            applied_at timestamptz(6) NOT NULL DEFAULT now()
          )
        `);
        for (const filename of [
          '0000_database_foundation.sql',
          '0001_auth_session_access_expiry.sql',
        ]) {
          await isolated.pool.query(
            await readFile(`${migrationsDirectory}/${filename}`, 'utf8'),
          );
          await isolated.pool.query(
            `INSERT INTO database_migrations (filename, checksum)
             VALUES ($1, $2)`,
            [filename, checksums[filename]],
          );
        }
        await expect(migrate(isolated.pool)).resolves.toBeUndefined();
        await expect(
          assertNoSchemaDrift(isolated.pool),
        ).resolves.toBeUndefined();
      } finally {
        await isolated.pool.end();
      }
    });
  });

  it('enforces normalization, uniqueness, and foreign keys', async () => {
    await expect(
      connection.pool.query(
        `INSERT INTO accounts (public_id, email, account_country)
         VALUES ('bad-email', 'UPPER@EXAMPLE.COM', 'MY')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });

    const email = `${randomUUID()}@example.com`;
    const publicId = `acct_${randomUUID()}`;
    const inserted = await db
      .insert(accounts)
      .values({ publicId, email, accountCountry: 'MY' })
      .returning({ id: accounts.id });
    expect(inserted).toHaveLength(1);
    await expect(
      db.insert(accounts).values({
        publicId: `acct_${randomUUID()}`,
        email,
        accountCountry: 'MY',
      }),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
    await expect(
      connection.pool.query(
        `INSERT INTO credentials
          (account_id, secret_hash, hash_algorithm)
         VALUES ($1, $2, 'scrypt')`,
        [randomUUID(), 'x'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('rejects plaintext-shaped secrets at the database boundary', async () => {
    const account = await db
      .insert(accounts)
      .values({
        publicId: `acct_${randomUUID()}`,
        email: `${randomUUID()}@example.com`,
        accountCountry: 'MY',
      })
      .returning({ id: accounts.id });
    await expect(
      connection.pool.query(
        `INSERT INTO credentials
          (account_id, secret_hash, hash_algorithm)
         VALUES ($1, 'plaintext-password', 'scrypt')`,
        [account[0]?.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('persists timestamp instants independently of the session timezone', async () => {
    await connection.pool.query(`SET TIME ZONE 'Asia/Kuala_Lumpur'`);
    const result = await connection.pool.query<{ utc: string }>(`
      SELECT to_char('2026-07-16T01:02:03.456Z'::timestamptz AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS utc;
    `);
    expect(result.rows[0]?.utc).toBe('2026-07-16T01:02:03.456Z');
  });

  it('runs the deterministic seed twice without duplicates', async () => {
    await seedFoundation(db);
    await seedFoundation(db);
    const counts = await connection.pool.query<{
      roles: string;
      permissions: string;
      profiles: string;
      versions: string;
    }>(
      `
      SELECT
        (SELECT count(*) FROM roles
          WHERE code IN ('SUPER_ADMIN', 'VIEWER')) AS roles,
        (SELECT count(*) FROM permissions
          WHERE code = ANY($1::text[])) AS permissions,
        (SELECT count(*) FROM service_fee_profiles
          WHERE market_id IS NULL AND code IN ('A', 'B', 'C', 'D', 'E', 'F')) AS profiles,
        (SELECT count(*) FROM service_fee_versions v
          JOIN service_fee_profiles p ON p.id = v.service_fee_profile_id
          WHERE v.market_id IS NULL AND p.market_id IS NULL
            AND p.code IN ('A', 'B', 'C', 'D', 'E', 'F')) AS versions
    `,
      [foundationPermissions.map(([code]) => code)],
    );
    expect(counts.rows[0]).toEqual({
      roles: '2',
      permissions: String(foundationPermissions.length),
      profiles: '6',
      versions: '6',
    });
  });

  async function createMerchantFixture() {
    const account = await connection.pool.query<{ id: string }>(
      `INSERT INTO accounts (public_id, email, account_country)
       VALUES ($1, $2, 'MY') RETURNING id`,
      [`acct_${randomUUID()}`, `${randomUUID()}@example.com`],
    );
    const adminAccount = await connection.pool.query<{ id: string }>(
      `INSERT INTO accounts (public_id, email, account_country)
       VALUES ($1, $2, 'MY') RETURNING id`,
      [`acct_${randomUUID()}`, `${randomUUID()}@example.com`],
    );
    const market = await connection.pool.query<{ id: string }>(
      `INSERT INTO markets (code, name, status, currency_code, timezone, default_locale)
       VALUES ($1, 'Test Market', 'ACTIVE', 'MYR', 'Asia/Kuala_Lumpur', 'en-MY')
       RETURNING id`,
      [randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()],
    );
    const admin = await connection.pool.query<{ id: string }>(
      `INSERT INTO admin_users (account_id, display_name)
       VALUES ($1, 'Test Admin') RETURNING id`,
      [adminAccount.rows[0]?.id],
    );
    const group = await connection.pool.query<{ id: string }>(
      `INSERT INTO merchant_groups (account_id, market_id, name)
       VALUES ($1, $2, 'Default Group') RETURNING id`,
      [account.rows[0]?.id, market.rows[0]?.id],
    );
    const merchantId = await connection.pool.query<{ id: string }>(
      'SELECT generate_merchant_id($1, $2) AS id',
      [market.rows[0]?.id, 'of'],
    );
    const branch = await connection.pool.query<{ id: string }>(
      `INSERT INTO merchant_branches (merchant_group_id, merchant_id, market_id, name)
       VALUES ($1, $2, $3, 'Main Branch') RETURNING id`,
      [group.rows[0]?.id, merchantId.rows[0]?.id, market.rows[0]?.id],
    );
    return {
      accountId: account.rows[0]!.id,
      adminId: admin.rows[0]!.id,
      branchId: branch.rows[0]!.id,
      groupId: group.rows[0]!.id,
      marketId: market.rows[0]!.id,
    };
  }

  async function createMemberFixture() {
    const memberAccount = await connection.pool.query<{ id: string }>(
      `INSERT INTO accounts (public_id, email, account_country)
       VALUES ($1, $2, 'MY') RETURNING id`,
      [`acct_${randomUUID()}`, `${randomUUID()}@example.com`],
    );
    const referrerAccount = await connection.pool.query<{ id: string }>(
      `INSERT INTO accounts (public_id, email, account_country)
       VALUES ($1, $2, 'MY') RETURNING id`,
      [`acct_${randomUUID()}`, `${randomUUID()}@example.com`],
    );
    const adminAccount = await connection.pool.query<{ id: string }>(
      `INSERT INTO accounts (public_id, email, account_country)
       VALUES ($1, $2, 'MY') RETURNING id`,
      [`acct_${randomUUID()}`, `${randomUUID()}@example.com`],
    );
    const market = await connection.pool.query<{ id: string }>(
      `INSERT INTO markets (code, name, status, currency_code, timezone, default_locale)
       VALUES ($1, 'Member Market', 'ACTIVE', 'MYR', 'Asia/Kuala_Lumpur', 'en-MY')
       RETURNING id`,
      [randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()],
    );
    const alternateMarket = await connection.pool.query<{ id: string }>(
      `INSERT INTO markets (code, name, status, currency_code, timezone, default_locale)
       VALUES ($1, 'Alternate Market', 'ACTIVE', 'MYR', 'Asia/Kuala_Lumpur', 'en-MY')
       RETURNING id`,
      [randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()],
    );
    const admin = await connection.pool.query<{ id: string }>(
      `INSERT INTO admin_users (account_id, display_name)
       VALUES ($1, 'Member Admin') RETURNING id`,
      [adminAccount.rows[0]?.id],
    );
    const referrer = await connection.pool.query<{ id: string }>(
      `INSERT INTO members
        (account_id, public_member_id, referral_code, status, kyc_level)
       VALUES ($1, $2, $3, 'ACTIVE', 'LEVEL_2') RETURNING id`,
      [
        referrerAccount.rows[0]?.id,
        `mem_${randomUUID()}`,
        `ref_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      ],
    );
    const member = await connection.pool.query<{ id: string }>(
      `INSERT INTO members
        (account_id, public_member_id, referral_code, status, kyc_level)
       VALUES ($1, $2, $3, 'ACTIVE', 'LEVEL_1') RETURNING id`,
      [
        memberAccount.rows[0]?.id,
        `mem_${randomUUID()}`,
        `ref_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      ],
    );
    return {
      accountId: memberAccount.rows[0]!.id,
      adminId: admin.rows[0]!.id,
      alternateMarketId: alternateMarket.rows[0]!.id,
      marketId: market.rows[0]!.id,
      memberId: member.rows[0]!.id,
      referrerMemberId: referrer.rows[0]!.id,
    };
  }

  it('enforces merchant group and branch cardinality through foreign keys', async () => {
    const fixture = await createMerchantFixture();
    const secondMerchantId = await connection.pool.query<{ id: string }>(
      'SELECT generate_merchant_id($1, $2) AS id',
      [fixture.marketId, 'of'],
    );
    await expect(
      connection.pool.query(
        `INSERT INTO merchant_branches (merchant_group_id, merchant_id, market_id, name)
         VALUES ($1, $2, $3, 'Second Branch')`,
        [fixture.groupId, secondMerchantId.rows[0]?.id, fixture.marketId],
      ),
    ).resolves.toBeDefined();
    await expect(
      connection.pool.query(
        `INSERT INTO merchant_branches (merchant_group_id, merchant_id, market_id, name)
         VALUES ($1, $2, $3, 'Orphan Branch')`,
        [randomUUID(), `invalid_${randomUUID()}`, fixture.marketId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('generates concurrent-safe merchant IDs per market and channel', async () => {
    const fixture = await createMerchantFixture();
    const generated = await Promise.all(
      Array.from({ length: 25 }, async () => {
        const result = await connection.pool.query<{ id: string }>(
          'SELECT generate_merchant_id($1, $2) AS id',
          [fixture.marketId, 'qr'],
        );
        return result.rows[0]!.id;
      }),
    );
    expect(new Set(generated)).toHaveLength(25);
    expect(generated.every((id) => /^[a-z0-9]+_qr_\d{6}$/u.test(id))).toBe(
      true,
    );
    const numbers = generated
      .map((id) => Number(id.slice(-6)))
      .sort((left, right) => left - right);
    expect(numbers).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 1),
    );
  });

  it('enforces special percentage and financial check constraints', async () => {
    const fixture = await createMerchantFixture();
    for (const rate of ['0', '-1', '100.000001']) {
      await expect(
        connection.pool.query(
          `INSERT INTO special_percentages
            (rate, created_by_admin_user_id, market_id)
           VALUES ($1, $2, $3)`,
          [rate, fixture.adminId, fixture.marketId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }
    await expect(
      connection.pool.query(
        `INSERT INTO special_percentages
          (rate, created_by_admin_user_id, market_id)
         VALUES ('100', $1, $2)`,
        [fixture.adminId, fixture.marketId],
      ),
    ).resolves.toBeDefined();

    await expect(
      connection.pool.query(
        `INSERT INTO mcp_accounts
          (merchant_branch_id, market_id, available_balance, total_balance)
         VALUES ($1, $2, -1, 0)`,
        [fixture.branchId, fixture.marketId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces member uniqueness, referral, and market preference constraints', async () => {
    const fixture = await createMemberFixture();
    await expect(
      connection.pool.query(
        `INSERT INTO members (account_id, public_member_id, referral_code)
         VALUES ($1, $2, $3)`,
        [
          fixture.accountId,
          `mem_${randomUUID()}`,
          `ref_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        ],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      connection.pool.query(
        `INSERT INTO members (account_id, public_member_id, referral_code)
         VALUES ($1, $2, $3)`,
        [
          randomUUID(),
          `mem_${randomUUID()}`,
          `ref_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        ],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      connection.pool.query(
        `INSERT INTO member_market_preferences
          (member_id, market_id, is_current)
         VALUES ($1, $2, true)`,
        [fixture.memberId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await connection.pool.query(
      `INSERT INTO member_market_preferences
        (member_id, market_id, is_enabled, is_current, sort_order)
       VALUES ($1, $2, true, true, 0)`,
      [fixture.memberId, fixture.marketId],
    );
    await expect(
      connection.pool.query(
        `INSERT INTO member_market_preferences
          (member_id, market_id, is_enabled, is_current, sort_order)
         VALUES ($1, $2, true, true, 1)`,
        [fixture.memberId, fixture.alternateMarketId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      connection.pool.query(
        `INSERT INTO member_referrals
          (member_id, referrer_member_id, referral_code_snapshot, source)
         VALUES ($1, $1, 'snapshot', 'REGISTRATION')`,
        [fixture.memberId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await connection.pool.query(
      `INSERT INTO member_referrals
        (member_id, referrer_member_id, referral_code_snapshot, source)
       VALUES ($1, $2, $3, 'REGISTRATION')`,
      [fixture.memberId, fixture.referrerMemberId, 'snapshot'],
    );
    await expect(
      connection.pool.query(
        `INSERT INTO member_referrals
          (member_id, referrer_member_id, referral_code_snapshot, source)
         VALUES ($1, $2, $3, 'ADMIN_CORRECTION')`,
        [fixture.memberId, fixture.referrerMemberId, 'snapshot-2'],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('enforces member QR, KYC, country change, and history constraints', async () => {
    const fixture = await createMemberFixture();
    const activeQrTokenHash = `${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
    const rotatedQrTokenHash = `${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
    await connection.pool.query(
      `INSERT INTO member_qr_identities
        (member_id, public_qr_id, token_hash, status, issued_at)
       VALUES ($1, $2, $3, 'ACTIVE', now())`,
      [fixture.memberId, `qr_${randomUUID()}`, activeQrTokenHash],
    );
    await expect(
      connection.pool.query(
        `INSERT INTO member_qr_identities
          (member_id, public_qr_id, token_hash, status, issued_at)
         VALUES ($1, $2, $3, 'ACTIVE', now())`,
        [fixture.memberId, `qr_${randomUUID()}`, rotatedQrTokenHash],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await connection.pool.query(
      `INSERT INTO member_kyc_cases
        (member_id, market_id, level_requested)
       VALUES ($1, $2, 'LEVEL_2')`,
      [fixture.memberId, fixture.marketId],
    );
    await expect(
      connection.pool.query(
        `UPDATE member_kyc_cases
         SET status = 'SUBMITTED', submitted_at = now()
         WHERE member_id = $1`,
        [fixture.memberId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      connection.pool.query(
        `UPDATE member_kyc_cases
         SET nationality = 'my'
         WHERE member_id = $1`,
        [fixture.memberId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      connection.pool.query(
        `UPDATE member_kyc_cases
         SET account_country_snapshot = 'my'
         WHERE member_id = $1`,
        [fixture.memberId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      connection.pool.query(
        `UPDATE member_kyc_cases
         SET residential_address = '[]'::jsonb
         WHERE member_id = $1`,
        [fixture.memberId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      connection.pool.query(
        `UPDATE member_kyc_cases
         SET status = 'SUBMITTED',
             legal_full_name = 'Kyc Test Member',
             identification_type = 'NATIONAL_ID',
             identification_number = 'SENSITIVE-ID-123',
             date_of_birth = '1990-01-01',
             nationality = 'MY',
             residential_address = '{"line1":"Test address"}'::jsonb,
             account_country_snapshot = 'MY',
             submission_market_id = $2,
             consent_version = 'kyc-v1',
             submitted_at = now()
         WHERE member_id = $1`,
        [fixture.memberId, fixture.marketId],
      ),
    ).resolves.toBeDefined();
    await expect(
      connection.pool.query(
        `INSERT INTO member_kyc_cases
          (member_id, market_id, level_requested)
         VALUES ($1, $2, 'LEVEL_1')`,
        [fixture.memberId, fixture.marketId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    const idempotencyScope = `ACCOUNT:${fixture.accountId}:KYC_SUBMIT:${fixture.memberId}:${fixture.marketId}`;
    const idempotencyKey = randomUUID();
    const requestHash = 'a'.repeat(64);
    await connection.pool.query(
      `INSERT INTO member_kyc_idempotency_keys (scope, key, request_hash)
       VALUES ($1, $2, $3)`,
      [idempotencyScope, idempotencyKey, requestHash],
    );
    await expect(
      connection.pool.query(
        `INSERT INTO member_kyc_idempotency_keys (scope, key, request_hash)
         VALUES ($1, $2, $3)`,
        [idempotencyScope, idempotencyKey, requestHash],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      connection.pool.query(
        `INSERT INTO member_kyc_idempotency_keys (scope, key, request_hash)
         VALUES ($1, $2, 'too-short')`,
        [`${idempotencyScope}:short-hash`, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      connection.pool.query(
        `INSERT INTO member_kyc_idempotency_keys
          (scope, key, request_hash, response, status_code)
         VALUES ($1, $2, $3, '{}'::jsonb, 99)`,
        [`${idempotencyScope}:invalid-status`, randomUUID(), requestHash],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      connection.pool.query(
        `INSERT INTO member_account_country_change_requests
          (member_id, account_id, current_country, requested_country, reason)
         VALUES ($1, $2, 'MY', 'SG', 'move')`,
        [fixture.memberId, fixture.accountId],
      ),
    ).resolves.toBeDefined();
    await expect(
      connection.pool.query(
        `INSERT INTO member_account_country_change_requests
          (member_id, account_id, current_country, requested_country, reason)
         VALUES ($1, $2, 'MY', 'TH', 'move again')`,
        [fixture.memberId, fixture.accountId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    const terms = await connection.pool.query<{ id: string }>(
      `INSERT INTO member_terms_acceptances
        (member_id, document_type, document_version, locale)
       VALUES ($1, 'TERMS', 'v1', 'en-MY') RETURNING id`,
      [fixture.memberId],
    );
    await expect(
      connection.pool.query(
        `INSERT INTO member_terms_acceptances
          (member_id, document_type, document_version, locale)
         VALUES ($1, 'TERMS', 'v1', 'en-MY')`,
        [fixture.memberId],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    const referralHistory = await connection.pool.query<{ id: string }>(
      `INSERT INTO member_referral_history
        (member_id, old_referrer_member_id, new_referrer_member_id, event_type,
         correction_reason, authorized_actor_type, authorized_actor_id, request_id)
       VALUES ($1, NULL, $2, 'ASSIGNED', 'initial', 'SYSTEM', $3, $4)
       RETURNING id`,
      [
        fixture.memberId,
        fixture.referrerMemberId,
        fixture.adminId,
        randomUUID(),
      ],
    );
    const statusHistory = await connection.pool.query<{ id: string }>(
      `INSERT INTO member_status_history
        (member_id, from_status, to_status, actor_type, actor_id, reason)
       VALUES ($1, 'ACTIVE', 'SUSPENDED', 'ADMIN_USER', $2, 'violation')
       RETURNING id`,
      [fixture.memberId, fixture.adminId],
    );
    const kycHistory = await connection.pool.query<{ id: string }>(
      `INSERT INTO member_kyc_history
        (member_kyc_case_id, event_type, actor_type, actor_id, summary, metadata)
       VALUES (
         (SELECT id FROM member_kyc_cases WHERE member_id = $1),
         'SUBMITTED', 'SYSTEM', $2, 'submitted', '{"source":"test"}'
       ) RETURNING id`,
      [fixture.memberId, fixture.adminId],
    );
    for (const [table, id] of [
      ['member_referral_history', referralHistory.rows[0]!.id],
      ['member_status_history', statusHistory.rows[0]!.id],
      ['member_kyc_history', kycHistory.rows[0]!.id],
      ['member_terms_acceptances', terms.rows[0]!.id],
    ] as const) {
      await expect(
        connection.pool.query(`UPDATE ${table} SET id = id WHERE id = $1`, [
          id,
        ]),
      ).rejects.toMatchObject({ code: '55000' });
      await expect(
        connection.pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]),
      ).rejects.toMatchObject({ code: '55000' });
    }
  });

  it('keeps admin member notes valid, scoped, and append-only', async () => {
    const fixture = await createMemberFixture();
    const note = await connection.pool.query<{ id: string }>(
      `INSERT INTO admin_member_notes
        (member_id, admin_user_id, market_id, content, is_internal)
       VALUES ($1, $2, $3, 'Internal review note', true)
       RETURNING id`,
      [fixture.memberId, fixture.adminId, fixture.marketId],
    );

    for (const content of ['', '   ', 'x'.repeat(5001)]) {
      await expect(
        connection.pool.query(
          `INSERT INTO admin_member_notes
            (member_id, admin_user_id, market_id, content, is_internal)
           VALUES ($1, $2, $3, $4, true)`,
          [fixture.memberId, fixture.adminId, fixture.marketId, content],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }

    await expect(
      connection.pool.query(
        `UPDATE admin_member_notes SET content = 'mutated' WHERE id = $1`,
        [note.rows[0]!.id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      connection.pool.query('DELETE FROM admin_member_notes WHERE id = $1', [
        note.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: '55000' });
  });

  it('posts MCP ledger entries atomically with scoped idempotency and no negative balance', async () => {
    const fixture = await createMerchantFixture();
    const account = await connection.pool.query<{ id: string }>(
      `INSERT INTO mcp_accounts (merchant_branch_id, market_id)
       VALUES ($1, $2) RETURNING id`,
      [fixture.branchId, fixture.marketId],
    );
    const accountId = account.rows[0]!.id;
    const key = randomUUID();
    const credit = () =>
      connection.pool.query<{ entry_id: string; replayed: boolean }>(
        `SELECT * FROM append_mcp_ledger_entry(
          $1, 'RECHARGE', 'CREDIT', 100, 100, 100, 'TEST', NULL, $2,
          repeat('a', 64), 'SYSTEM', NULL, 'Concurrent recharge', now())`,
        [accountId, key],
      );
    const postings = await Promise.all([credit(), credit(), credit()]);
    expect(
      new Set(postings.map((row) => row.rows[0]!.entry_id)),
    ).toHaveProperty('size', 1);
    await expect(
      connection.pool.query(
        `SELECT * FROM append_mcp_ledger_entry(
          $1, 'RECHARGE', 'CREDIT', 101, 101, 101, 'TEST', NULL, $2,
          repeat('b', 64), 'SYSTEM', NULL, 'Mismatched replay', now())`,
        [accountId, key],
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(
      connection.pool.query(
        `SELECT * FROM append_mcp_ledger_entry(
          $1, 'REFUND', 'DEBIT', 101, -101, -101, 'TEST', NULL, $2,
          repeat('c', 64), 'SYSTEM', NULL, 'Overdraw attempt', now())`,
        [accountId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      connection.pool.query(
        `UPDATE mcp_accounts SET available_balance = 50 WHERE id = $1`,
        [accountId],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      connection.pool.query(
        `INSERT INTO mcp_ledger_entries
          (mcp_account_id, sequence, entry_type, direction, amount,
           balance_delta, available_delta, source_type, idempotency_key,
           payload_hash, actor_type, reason, effective_at)
         VALUES ($1, 2, 'RECHARGE', 'CREDIT', 1, 1, 1, 'TEST', $2,
           repeat('d', 64), 'SYSTEM', 'Direct insert', now())`,
        [accountId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    const reconciled = await connection.pool.query<{
      stored_total: string;
      stored_available: string;
      computed_total: string;
      computed_available: string;
    }>(
      `SELECT a.total_balance::text AS stored_total,
              a.available_balance::text AS stored_available,
              sum(l.balance_delta)::text AS computed_total,
              sum(l.available_delta)::text AS computed_available
       FROM mcp_accounts a JOIN mcp_ledger_entries l ON l.mcp_account_id = a.id
       WHERE a.id = $1 GROUP BY a.id`,
      [accountId],
    );
    expect(reconciled.rows[0]).toEqual({
      stored_total: '100.0000000000',
      stored_available: '100.0000000000',
      computed_total: '100.0000000000',
      computed_available: '100.0000000000',
    });
  });

  it('enforces package XOR and active-default constraints', async () => {
    await seedFoundation(db);
    const fixture = await createMerchantFixture();
    const version = await connection.pool.query<{ id: string }>(
      'SELECT id FROM service_fee_versions ORDER BY created_at LIMIT 1',
    );
    await expect(
      connection.pool.query(
        `INSERT INTO merchant_package_assignments
          (merchant_branch_id, status, is_default)
         VALUES ($1, 'ACTIVE', true)`,
        [fixture.branchId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const assignment = await connection.pool.query<{ id: string }>(
      `INSERT INTO merchant_package_assignments
        (merchant_branch_id, service_fee_version_id, status, is_default)
       VALUES ($1, $2, 'ACTIVE', true) RETURNING id`,
      [fixture.branchId, version.rows[0]?.id],
    );
    await expect(
      connection.pool.query(
        `UPDATE merchant_package_assignments
         SET status = 'PAUSED' WHERE id = $1`,
        [assignment.rows[0]?.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces package effective windows and reference-data immutability', async () => {
    const fixture = await createMerchantFixture();
    const profile = await connection.pool.query<{ id: string }>(
      `INSERT INTO service_fee_profiles (code, name, market_id)
       VALUES ($1, 'Window Test', $2) RETURNING id`,
      [`W${randomUUID().replaceAll('-', '').slice(0, 8)}`, fixture.marketId],
    );
    const firstVersion = await connection.pool.query<{ id: string }>(
      `INSERT INTO service_fee_versions
        (service_fee_profile_id, rate, effective_from, effective_to, status, market_id)
       VALUES ($1, '8.125000', '2026-01-01T00:00:00Z',
         '2027-01-01T00:00:00Z', 'ACTIVE', $2) RETURNING id`,
      [profile.rows[0]?.id, fixture.marketId],
    );
    await expect(
      connection.pool.query(
        `INSERT INTO service_fee_versions
          (service_fee_profile_id, rate, effective_from, effective_to, market_id)
         VALUES ($1, '9.000000', '2026-06-01T00:00:00Z',
           '2027-06-01T00:00:00Z', $2)`,
        [profile.rows[0]?.id, fixture.marketId],
      ),
    ).rejects.toMatchObject({ code: '23P01' });

    await connection.pool.query(
      `INSERT INTO merchant_package_assignments
        (merchant_branch_id, service_fee_version_id, status, is_default)
       VALUES ($1, $2, 'ACTIVE', true)`,
      [fixture.branchId, firstVersion.rows[0]?.id],
    );
    await expect(
      connection.pool.query(
        'UPDATE service_fee_versions SET rate = $1 WHERE id = $2',
        ['9.500000', firstVersion.rows[0]?.id],
      ),
    ).rejects.toMatchObject({ code: '55000' });

    const special = await connection.pool.query<{ id: string }>(
      `INSERT INTO special_percentages
        (rate, created_by_admin_user_id, description, market_id)
       VALUES ('100.000000', $1, 'Upper boundary', $2) RETURNING id`,
      [fixture.adminId, fixture.marketId],
    );
    await expect(
      connection.pool.query(
        'UPDATE special_percentages SET description = $1 WHERE id = $2',
        ['mutated', special.rows[0]?.id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      connection.pool.query('DELETE FROM special_percentages WHERE id = $1', [
        special.rows[0]?.id,
      ]),
    ).rejects.toMatchObject({ code: '55000' });
  });

  it('rejects UPDATE and DELETE on every Phase 1 append-only table', async () => {
    const fixture = await createMerchantFixture();
    const application = await connection.pool.query<{ id: string }>(
      `INSERT INTO merchant_applications (merchant_branch_id)
       VALUES ($1) RETURNING id`,
      [fixture.branchId],
    );
    const appSubmission = await connection.pool.query<{ id: string }>(
      `INSERT INTO merchant_application_submissions
        (merchant_application_id, submission_version, submitted_data)
       VALUES ($1, 1, '{}') RETURNING id`,
      [application.rows[0]?.id],
    );
    const appReview = await connection.pool.query<{ id: string }>(
      `INSERT INTO merchant_application_reviews
        (merchant_application_id, reviewer_admin_user_id, decision, reason)
       VALUES ($1, $2, 'APPROVED', 'verified') RETURNING id`,
      [application.rows[0]?.id, fixture.adminId],
    );
    const kycSubmission = await connection.pool.query<{ id: string }>(
      `INSERT INTO merchant_kyc_submissions
        (merchant_branch_id, submission_version, submitted_data)
       VALUES ($1, 1, '{}') RETURNING id`,
      [fixture.branchId],
    );
    const kycReview = await connection.pool.query<{ id: string }>(
      `INSERT INTO merchant_kyc_reviews
        (merchant_kyc_submission_id, reviewer_admin_user_id, decision, reason)
       VALUES ($1, $2, 'APPROVED', 'verified') RETURNING id`,
      [kycSubmission.rows[0]?.id, fixture.adminId],
    );
    const document = await connection.pool.query<{ id: string }>(
      `INSERT INTO merchant_documents
        (merchant_branch_id, document_type, file_name, mime_type, file_size_bytes,
         sha256_hash, object_key)
       VALUES ($1, 'LICENSE', 'license.pdf', 'application/pdf', 100,
         repeat('a', 64), $2) RETURNING id`,
      [fixture.branchId, `private/${randomUUID()}`],
    );
    const referral = await connection.pool.query<{ id: string }>(
      `INSERT INTO merchant_referrals (merchant_branch_id)
       VALUES ($1) RETURNING id`,
      [fixture.branchId],
    );
    const terms = await connection.pool.query<{ id: string }>(
      `INSERT INTO merchant_terms_acceptances
        (account_id, merchant_branch_id, terms_version)
       VALUES ($1, $2, 'v1') RETURNING id`,
      [fixture.accountId, fixture.branchId],
    );
    const history = await connection.pool.query<{ id: string }>(
      `INSERT INTO merchant_status_history
        (merchant_branch_id, new_status, changed_by_actor_type, changed_by_actor_id)
       VALUES ($1, 'PENDING_APPLICATION', 'SYSTEM', 'system') RETURNING id`,
      [fixture.branchId],
    );
    const mcpAccount = await connection.pool.query<{ id: string }>(
      `INSERT INTO mcp_accounts (merchant_branch_id, market_id)
       VALUES ($1, $2) RETURNING id`,
      [fixture.branchId, fixture.marketId],
    );
    const ledger = await connection.pool.query<{ id: string }>(
      `SELECT entry_id AS id FROM append_mcp_ledger_entry(
        $1, 'RECHARGE', 'CREDIT', 1, 1, 1, 'TEST', NULL, $2,
        repeat('a', 64), 'SYSTEM', NULL, 'Append-only test', now())`,
      [mcpAccount.rows[0]?.id, randomUUID()],
    );
    const adjustment = await connection.pool.query<{ id: string }>(
      `INSERT INTO mcp_adjustment_requests
        (mcp_account_id, market_id, maker_admin_user_id, entry_type, amount,
         reason, idempotency_key, payload_hash)
       VALUES ($1, $2, $3, 'MANUAL_CREDIT', 1, 'test', $4,
         repeat('e', 64)) RETURNING id`,
      [mcpAccount.rows[0]?.id, fixture.marketId, fixture.adminId, randomUUID()],
    );
    await expect(
      connection.pool.query(
        `INSERT INTO mcp_adjustment_decisions
          (adjustment_request_id, market_id, checker_admin_user_id, decision, reason)
         VALUES ($1, $2, $3, 'APPROVED', 'self approval')`,
        [adjustment.rows[0]?.id, fixture.marketId, fixture.adminId],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    const checker = await connection.pool.query<{ id: string }>(
      `WITH checker_account AS (
         INSERT INTO accounts (public_id, email, account_country)
         VALUES ($1, $2, 'MY') RETURNING id
       )
       INSERT INTO admin_users (account_id, display_name)
       SELECT id, 'Independent Checker' FROM checker_account RETURNING id`,
      [`acct_${randomUUID()}`, `${randomUUID()}@example.com`],
    );
    const decision = await connection.pool.query<{ id: string }>(
      `INSERT INTO mcp_adjustment_decisions
        (adjustment_request_id, market_id, checker_admin_user_id, decision, reason)
       VALUES ($1, $2, $3, 'APPROVED', 'verified') RETURNING id`,
      [adjustment.rows[0]?.id, fixture.marketId, checker.rows[0]?.id],
    );

    const appendOnlyRows = [
      ['merchant_application_submissions', appSubmission.rows[0]!.id],
      ['merchant_application_reviews', appReview.rows[0]!.id],
      ['merchant_kyc_submissions', kycSubmission.rows[0]!.id],
      ['merchant_kyc_reviews', kycReview.rows[0]!.id],
      ['merchant_documents', document.rows[0]!.id],
      ['merchant_referrals', referral.rows[0]!.id],
      ['merchant_terms_acceptances', terms.rows[0]!.id],
      ['merchant_status_history', history.rows[0]!.id],
      ['mcp_ledger_entries', ledger.rows[0]!.id],
      ['mcp_adjustment_decisions', decision.rows[0]!.id],
    ] as const;
    for (const [table, id] of appendOnlyRows) {
      await expect(
        connection.pool.query(`UPDATE ${table} SET id = id WHERE id = $1`, [
          id,
        ]),
      ).rejects.toMatchObject({ code: '55000' });
      await expect(
        connection.pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]),
      ).rejects.toMatchObject({ code: '55000' });
    }
  });

  it('keeps the account email immutable', async () => {
    const fixture = await createMerchantFixture();
    await expect(
      connection.pool.query('UPDATE accounts SET email = $1 WHERE id = $2', [
        `${randomUUID()}@example.com`,
        fixture.accountId,
      ]),
    ).rejects.toMatchObject({ code: '55000' });
  });

  it('detects applied migration checksum changes', async () => {
    await connection.pool.query(
      `UPDATE database_migrations SET checksum = repeat('0', 64)
       WHERE filename = '0000_database_foundation.sql'`,
    );
    await expect(migrate(connection.pool)).rejects.toThrow(
      'Applied migration checksum mismatch',
    );
    const checksums = await verifyMigrationChecksums();
    await connection.pool.query(
      `UPDATE database_migrations SET checksum = $1
       WHERE filename = '0000_database_foundation.sql'`,
      [checksums['0000_database_foundation.sql']],
    );
  });

  it('detects live schema drift without mutating it', async () => {
    await connection.pool.query(
      'ALTER TABLE accounts ADD COLUMN rogue_column text',
    );
    await expect(assertNoSchemaDrift(connection.pool)).rejects.toThrow(
      'Database schema drift detected',
    );
    await connection.pool.query(
      'ALTER TABLE accounts DROP COLUMN rogue_column',
    );
    await expect(assertNoSchemaDrift(connection.pool)).resolves.toBeUndefined();
  });

  it('keeps audit and entity timeline records append-only', async () => {
    const audit = await db
      .insert(auditLogs)
      .values({
        actorType: 'SYSTEM',
        action: 'foundation.test',
        entityType: 'account',
        entityId: randomUUID(),
        result: 'SUCCESS',
      })
      .returning({ id: auditLogs.id });
    const timeline = await db
      .insert(entityTimelines)
      .values({
        actorType: 'SYSTEM',
        entityType: 'account',
        entityId: randomUUID(),
        eventType: 'foundation.tested',
        summary: 'Append-only verification.',
      })
      .returning({ id: entityTimelines.id });
    await expect(
      db
        .update(auditLogs)
        .set({ reason: 'mutated' })
        .where(sql`${auditLogs.id} = ${audit[0]?.id}`),
    ).rejects.toMatchObject({ cause: { code: '55000' } });
    await expect(
      db
        .delete(entityTimelines)
        .where(sql`${entityTimelines.id} = ${timeline[0]?.id}`),
    ).rejects.toMatchObject({ cause: { code: '55000' } });
  });
});
