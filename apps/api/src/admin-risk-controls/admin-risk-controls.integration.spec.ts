import { randomUUID } from 'node:crypto';
import http from 'node:http';
// Node 19+ enables keep-alive on the global agent; the in-process Nest test
// server may close a connection after an error response, which makes a reused
// socket fail with ECONNREFUSED. Fresh connections per request keep the suite
// deterministic.
http.globalAgent = new http.Agent({ keepAlive: false });
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  accounts,
  adminUsers,
  auditLogs,
  ipointAdjustmentRequests,
  marketAccess,
  markets,
  mcpAccounts,
  mcpAdjustmentRequests,
  memberMarketPreferences,
  memberWalletAccounts,
  memberWalletEntries,
  members,
  merchantBranches,
  merchantGroups,
  merchantPackageAssignments,
  migrate,
  marketTransactionSettings,
  rewardRuleVersions,
  rewardPlans,
  rewardSources,
  riskEvents,
  riskReviewQueue,
  roleAssignments,
  roles,
  securityEvents,
  serviceFeeProfiles,
  serviceFeeVersions,
  sessions,
  transactionMcpDebits,
  transactionPreviewSessions,
  transactionRewardLinks,
  transactions,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { and, eq, isNull } from 'drizzle-orm';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'P8-S3-Risk-Controls-Password-123!';

// ---------------------------------------------------------------------------
// Fail-closed destructive fresh-database guard (P8-S1 H-01 pattern).
// ---------------------------------------------------------------------------
const TEST_DATABASE_NAME_PATTERN = /^ipoint_p8s3_[a-z0-9_]{1,63}$/u;
const PROTECTED_DATABASE_NAMES = new Set([
  'postgres',
  'template0',
  'template1',
]);
export const DESTRUCTIVE_TEST_OPT_IN_ENV = 'P8S3_DESTRUCTIVE_TEST';

export function testDatabaseName(
  databaseUrlValue: string | undefined,
): string | null {
  if (!databaseUrlValue) return null;
  let name: string;
  try {
    name = new URL(databaseUrlValue).pathname.replace(/^\//u, '').trim();
  } catch {
    return null;
  }
  if (!name) return null;
  if (PROTECTED_DATABASE_NAMES.has(name)) return null;
  if (!TEST_DATABASE_NAME_PATTERN.test(name)) return null;
  return name;
}

export function destructiveTestOptIn(
  env: Record<string, string | undefined>,
): boolean {
  const value = env[DESTRUCTIVE_TEST_OPT_IN_ENV]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

describe('P8-S3 destructive fresh-database guard', () => {
  it('accepts only the dedicated ipoint_p8s3_* test pattern', () => {
    expect(
      testDatabaseName(
        'postgresql://user:pass@127.0.0.1:55432/ipoint_p8s3_test',
      ),
    ).toBe('ipoint_p8s3_test');
    expect(
      testDatabaseName('postgres://localhost/ipoint_p8s3_migration_test'),
    ).toBe('ipoint_p8s3_migration_test');
  });

  it('rejects protected maintenance database names', () => {
    for (const name of ['postgres', 'template0', 'template1']) {
      expect(testDatabaseName(`postgresql://localhost/${name}`)).toBeNull();
    }
  });

  it('rejects arbitrary, production-looking or malformed names', () => {
    expect(testDatabaseName('postgresql://localhost/app')).toBeNull();
    expect(testDatabaseName('postgresql://localhost/ipoint_dev')).toBeNull();
    expect(
      testDatabaseName('postgresql://localhost/ipoint_production'),
    ).toBeNull();
    expect(testDatabaseName('postgresql://localhost/ipoint_p8s3')).toBeNull();
    expect(
      testDatabaseName('postgresql://localhost/ipoint_p8s3_test_x%2Fbad'),
    ).toBeNull();
    expect(testDatabaseName('not a url')).toBeNull();
    expect(testDatabaseName(undefined)).toBeNull();
    expect(testDatabaseName('')).toBeNull();
  });

  it('requires the explicit destructive-test opt-in', () => {
    expect(destructiveTestOptIn({})).toBe(false);
    expect(destructiveTestOptIn({ [DESTRUCTIVE_TEST_OPT_IN_ENV]: '0' })).toBe(
      false,
    );
    expect(
      destructiveTestOptIn({ [DESTRUCTIVE_TEST_OPT_IN_ENV]: 'false' }),
    ).toBe(false);
    expect(destructiveTestOptIn({ [DESTRUCTIVE_TEST_OPT_IN_ENV]: 'off' })).toBe(
      false,
    );
    expect(destructiveTestOptIn({ [DESTRUCTIVE_TEST_OPT_IN_ENV]: '1' })).toBe(
      true,
    );
    expect(
      destructiveTestOptIn({ [DESTRUCTIVE_TEST_OPT_IN_ENV]: 'TRUE' }),
    ).toBe(true);
    expect(destructiveTestOptIn({ [DESTRUCTIVE_TEST_OPT_IN_ENV]: 'yes' })).toBe(
      true,
    );
  });
});

const FROZEN_FINANCIAL_TABLES = [
  'accounts',
  'members',
  'member_market_preferences',
  'mcp_accounts',
  'mcp_ledger_entries',
  'mcp_adjustment_requests',
  'ipoint_adjustment_requests',
  'member_wallet_accounts',
  'member_wallet_entries',
  'transactions',
  'transaction_mcp_debits',
  'transaction_reward_links',
  'reward_sources',
  'reward_plans',
  'reward_rule_versions',
  'service_fee_profiles',
  'service_fee_versions',
  'security_events',
] as const;

describe.skipIf(!databaseUrl)(
  'P8-S3 Risk / Fraud / Operational Controls HTTP integration (real PostgreSQL)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let marketA: string;
    let marketB: string;
    let admin: { adminUserId: string; accountId: string; token: string };
    let finance: { adminUserId: string; accountId: string; token: string };
    let viewer: { adminUserId: string; accountId: string; token: string };
    let adminId: string;

    const base = (marketId: string) =>
      `/api/v1/admin/risk-controls/markets/${marketId}`;
    const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
    const WINDOW = {
      windowStart: '2026-01-01T00:00:00.000Z',
      windowEnd: '2031-01-01T00:00:00.000Z',
    };

    async function createAccount() {
      const email = `${randomUUID()}@example.com`;
      const rows = await database.db
        .insert(accounts)
        .values({
          publicId: `acct_${randomUUID()}`,
          email,
          accountCountry: 'MY',
          status: 'ACTIVE',
        })
        .returning({ id: accounts.id });
      const accountId = rows[0]?.id ?? '';
      await auth.setPassword(accountId, password);
      return { accountId, email };
    }

    async function createAdmin(marketIds: string[], roleCode: string) {
      const account = await createAccount();
      const adminRows = await database.db
        .insert(adminUsers)
        .values({
          accountId: account.accountId,
          displayName: roleCode,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserId = adminRows[0]?.id ?? '';
      const roleRows = await database.db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.code, roleCode))
        .limit(1);
      const roleId = roleRows[0]?.id ?? '';
      await database.db.insert(roleAssignments).values({ adminUserId, roleId });
      await database.db
        .insert(marketAccess)
        .values(marketIds.map((marketId) => ({ adminUserId, marketId })));
      const token = (
        await auth.createAdminSession(account.accountId, adminUserId, {
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        })
      ).accessToken;
      return { adminUserId, accountId: account.accountId, token };
    }

    async function selectMarket(accountId: string, marketId: string) {
      const sessionRows = await database.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt)),
        )
        .limit(1);
      await database.db
        .update(sessions)
        .set({
          currentAdminMarketId: marketId,
          currentAdminMarketSelectedAt: new Date(),
          marketContextVersion: 2,
        })
        .where(eq(sessions.id, sessionRows[0]?.id ?? ''));
    }

    async function createMerchant(marketId: string) {
      const account = await createAccount();
      const groupRows = await database.db
        .insert(merchantGroups)
        .values({ accountId: account.accountId, marketId, name: 'Group' })
        .returning({ id: merchantGroups.id });
      const branchRows = await database.db
        .insert(merchantBranches)
        .values({
          merchantGroupId: groupRows[0]?.id ?? '',
          merchantId: `M-${randomUUID()}`,
          marketId,
          name: 'Branch',
          status: 'ACTIVE',
        })
        .returning({ id: merchantBranches.id });
      return {
        branchId: String(branchRows[0]?.id ?? ''),
        merchantAccountId: account.accountId,
      };
    }

    async function createMember(marketId: string) {
      const account = await createAccount();
      const memberRows = await database.db
        .insert(members)
        .values({
          accountId: account.accountId,
          publicMemberId: `M-${randomUUID()}`,
          referralCode: `R-${randomUUID()}`,
          status: 'ACTIVE',
          kycLevel: 'LEVEL_1',
        })
        .returning({ id: members.id });
      const memberId = String(memberRows[0]?.id ?? '');
      if (marketId) {
        await database.db
          .insert(memberMarketPreferences)
          .values({
            memberId,
            marketId,
            isEnabled: true,
            isCurrent: true,
            sortOrder: 0,
          })
          .onConflictDoNothing();
      }
      return { memberId, accountId: account.accountId };
    }

    async function createMcpAccount(
      marketId: string,
      branchId: string,
      total: string,
      available: string,
    ) {
      const rows = await database.db
        .insert(mcpAccounts)
        .values({
          merchantBranchId: branchId,
          marketId,
          totalBalance: total,
          availableBalance: available,
          status: 'ACTIVE',
        })
        .returning({ id: mcpAccounts.id });
      return String(rows[0]?.id ?? '');
    }

    async function appendMcpEntry(input: {
      mcpAccountId: string;
      sequence: number;
      entryType: string;
      direction: 'CREDIT' | 'DEBIT';
      amount: string;
      balanceDelta: string;
      availableDelta: string;
      sourceType: string;
      sourceId?: string;
      effectiveAt: Date;
    }) {
      // MCP ledger entries may only be created through the frozen owner
      // function append_mcp_ledger_entry (migration 0005 guard); direct
      // inserts are rejected by protect_mcp_ledger_insert.
      const result = await database.pool.query(
        `SELECT * FROM append_mcp_ledger_entry(
           $1::uuid, $2::mcp_entry_type, $3::mcp_direction,
           $4::numeric(38,10), $5::numeric(38,10), $6::numeric(38,10),
           $7::text, $8::text, $9::text, $10::text,
           $11::text, $12::text, $13::text, $14::timestamptz
         )`,
        [
          input.mcpAccountId,
          input.entryType,
          input.direction,
          input.amount,
          input.balanceDelta,
          input.availableDelta,
          input.sourceType,
          input.sourceId ?? null,
          `ik-${randomUUID()}`,
          '0'.repeat(64),
          'SYSTEM',
          'risk-fixture',
          'P8-S3 fixture entry.',
          input.effectiveAt,
        ],
      );
      return String(result.rows[0]?.entry_id ?? '');
    }

    async function createWallet(marketId: string, memberId: string) {
      const rows = await database.db
        .insert(memberWalletAccounts)
        .values({
          memberId,
          marketId,
          pendingBalance: '0',
          availableBalance: '50.0000000000',
          reversedBalance: '0',
        })
        .returning({ id: memberWalletAccounts.id });
      return String(rows[0]?.id ?? '');
    }

    async function appendWalletEntry(input: {
      walletAccountId: string;
      memberId: string;
      marketId: string;
      entrySequence: number;
      entryType:
        | 'PENDING'
        | 'AVAILABLE'
        | 'REVERSED'
        | 'COMPENSATION'
        | 'ADJUSTMENT'
        | 'REDEMPTION_DEBIT'
        | 'REDEMPTION_REFUND';
      amount: string;
      balanceBefore: string;
      balanceAfter: string;
      referenceType?: string;
      referenceId?: string;
    }) {
      const rows = await database.db
        .insert(memberWalletEntries)
        .values({
          walletAccountId: input.walletAccountId,
          memberId: input.memberId,
          marketId: input.marketId,
          entrySequence: BigInt(input.entrySequence),
          entryType: input.entryType,
          amount: input.amount,
          balanceBefore: input.balanceBefore,
          balanceAfter: input.balanceAfter,
          idempotencyKey: `wik-${randomUUID()}`,
          referenceType: input.referenceType ?? null,
          referenceId: input.referenceId ?? null,
          description: 'P8-S3 fixture entry.',
          reason: 'P8-S3 fixture entry.',
        })
        .returning({ id: memberWalletEntries.id });
      return String(rows[0]?.id ?? '');
    }

    async function createTransactionFixture(
      marketId: string,
      opts: {
        merchant: { branchId: string; merchantAccountId: string };
        memberId: string;
        mcpAccountId: string;
        purchase: string;
        withDebit: boolean;
        withReward: boolean;
        confirmedAt?: Date;
      },
    ) {
      await database.db
        .insert(marketTransactionSettings)
        .values({
          marketId,
          currencyCode: 'MYR',
          currencyScale: 2,
          minimumTransactionAmount: '1.0000000000',
          maximumTransactionAmount: '1000000.0000000000',
        })
        .onConflictDoNothing();
      const ruleRows = await database.db
        .insert(rewardRuleVersions)
        .values({
          name: `Rule ${randomUUID()}`,
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          rewardRate: '0.0100000000',
          capType: 'NONE',
          capValue: '0',
          minimumReward: '0',
          marketId,
          createdBy: adminId,
        })
        .returning({ id: rewardRuleVersions.id });
      const ruleVersionId = String(ruleRows[0]?.id ?? '');
      const feeRows = await database.db
        .select({ id: serviceFeeVersions.id })
        .from(serviceFeeVersions)
        .limit(1);
      const existingDefault = await database.db
        .select({ id: merchantPackageAssignments.id })
        .from(merchantPackageAssignments)
        .where(
          and(
            eq(
              merchantPackageAssignments.merchantBranchId,
              opts.merchant.branchId,
            ),
            eq(merchantPackageAssignments.status, 'ACTIVE'),
            eq(merchantPackageAssignments.isDefault, true),
          ),
        )
        .limit(1);
      const packageRows = await database.db
        .insert(merchantPackageAssignments)
        .values({
          merchantBranchId: opts.merchant.branchId,
          serviceFeeVersionId: String(feeRows[0]?.id ?? ''),
          status: 'ACTIVE',
          isDefault: existingDefault.length === 0,
        })
        .returning({ id: merchantPackageAssignments.id });
      const packageId = String(packageRows[0]?.id ?? '');
      const previewRows = await database.db
        .insert(transactionPreviewSessions)
        .values({
          status: 'PREVIEWED',
          merchantBranchId: opts.merchant.branchId,
          merchantAccountId: opts.merchant.merchantAccountId,
          createdByStaffAccountId: opts.merchant.merchantAccountId,
          memberId: opts.memberId,
          protectedMemberReference: `ref-${randomUUID()}`,
          marketId,
          currency: 'MYR',
          purchaseAmount: opts.purchase,
          merchantPackageAssignmentId: packageId,
          merchantPackageVersion: 1,
          merchantPackageSnapshot: {},
          serviceFeeRate: '0.0500000000',
          serviceFeeAmount: '2.0000000000',
          estimatedMcpDebit: opts.purchase,
          rewardRuleVersionId: ruleVersionId,
          rewardRate: '0.0100000000',
          rewardPrincipal: opts.purchase,
          rewardCap: '100.0000000000',
          dailyRewardAmount: '0.4000000000',
          rewardStartBusinessDate: '2026-08-01',
          marketTimezone: 'Asia/Kuala_Lumpur',
          roundingMode: 'HALF_UP',
          previewedAt: new Date(),
        })
        .returning({ id: transactionPreviewSessions.id });
      const txnRows = await database.db
        .insert(transactions)
        .values({
          previewSessionId: String(previewRows[0]?.id ?? ''),
          status: 'CONFIRMED',
          merchantBranchId: opts.merchant.branchId,
          merchantAccountId: opts.merchant.merchantAccountId,
          confirmedByStaffAccountId: opts.merchant.merchantAccountId,
          memberId: opts.memberId,
          protectedMemberReference: `ref-${randomUUID()}`,
          marketId,
          currency: 'MYR',
          purchaseAmount: opts.purchase,
          merchantPackageAssignmentId: packageId,
          merchantPackageVersion: 1,
          merchantPackageSnapshot: {},
          rewardRuleVersionId: ruleVersionId,
          rewardRate: '0.0100000000',
          rewardPrincipal: opts.purchase,
          rewardCap: '100.0000000000',
          dailyRewardAmount: '0.4000000000',
          rewardStartBusinessDate: '2026-08-01',
          marketTimezone: 'Asia/Kuala_Lumpur',
          roundingMode: 'HALF_UP',
          confirmedAt: opts.confirmedAt ?? new Date(),
        })
        .returning({ id: transactions.id });
      const transactionId = String(txnRows[0]?.id ?? '');
      let debitEntryId: string | null = null;
      if (opts.withDebit) {
        debitEntryId = await appendMcpEntry({
          mcpAccountId: opts.mcpAccountId,
          sequence: 2,
          entryType: 'TRANSACTION_DEDUCTION',
          direction: 'DEBIT',
          amount: opts.purchase,
          balanceDelta: `-${opts.purchase}`,
          availableDelta: `-${opts.purchase}`,
          sourceType: 'transaction',
          sourceId: transactionId,
          effectiveAt: new Date(),
        });
        await database.db.insert(transactionMcpDebits).values({
          transactionId,
          marketId,
          mcpAccountId: opts.mcpAccountId,
          mcpLedgerEntryId: debitEntryId,
          amount: opts.purchase,
          balanceAfter: '60.0000000000',
        });
      }
      let rewardSourceId: string | null = null;
      if (opts.withReward) {
        const sourceRows = await database.db
          .insert(rewardSources)
          .values({
            sourceType: 'transaction',
            sourceId: transactionId,
            memberId: opts.memberId,
            marketId,
            merchantId: opts.merchant.branchId,
            transactionAmount: opts.purchase,
            currency: 'MYR',
          })
          .returning({ id: rewardSources.id });
        rewardSourceId = String(sourceRows[0]?.id ?? '');
        const planRows = await database.db
          .insert(rewardPlans)
          .values({
            sourceType: 'transaction',
            sourceId: transactionId,
            memberId: opts.memberId,
            marketId,
            merchantId: opts.merchant.branchId,
            status: 'ACTIVE',
            ruleVersionId: ruleVersionId,
          })
          .returning({ id: rewardPlans.id });
        await database.db.insert(transactionRewardLinks).values({
          transactionId,
          rewardSourceId,
          rewardPlanId: String(planRows[0]?.id ?? ''),
          rewardRuleVersionId: ruleVersionId,
        });
      }
      return { transactionId, debitEntryId, rewardSourceId };
    }

    async function snapshotFrozenTables(): Promise<string> {
      const parts: string[] = [];
      for (const table of FROZEN_FINANCIAL_TABLES) {
        const result = await database.pool.query(
          `SELECT * FROM ${table} ORDER BY id`,
        );
        parts.push(`${table}:${JSON.stringify(result.rows)}`);
      }
      return parts.join('|');
    }

    async function createDefinition(
      token: string,
      marketId: string,
      input: Record<string, unknown>,
    ) {
      const response = await supertest(server)
        .post(`${base(marketId)}/definitions`)
        .set(bearer(token))
        .set('Idempotency-Key', randomUUID())
        .send({ reason: 'P8-S3 fixture definition.', ...input })
        .expect(201);
      return response.body as Record<string, unknown>;
    }

    async function runFixture(category: string, token: string) {
      const response = await supertest(server)
        .post(`${base(marketA)}/runs`)
        .set(bearer(token))
        .set('Idempotency-Key', randomUUID())
        .send({ category, ...WINDOW, reason: `${category} fixture run.` })
        .expect(201);
      const runId = String((response.body as { id: string }).id);
      const executed = await supertest(server)
        .post(`${base(marketA)}/runs/${runId}/execute`)
        .set(bearer(token))
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      return { runId, body: executed.body as Record<string, unknown> };
    }

    async function firstEventFor(
      category: string,
      entityType: string,
    ): Promise<Record<string, unknown>> {
      const list = await supertest(server)
        .get(`${base(marketA)}/events?category=${category}`)
        .set(bearer(admin.token))
        .expect(200);
      const items = (list.body as { items: Array<Record<string, unknown>> })
        .items;
      const event = items.find(
        (item) =>
          item['category'] === category && item['entity_type'] === entityType,
      );
      expect(event, `expected a ${category}/${entityType} event`).toBeTruthy();
      return event as Record<string, unknown>;
    }

    beforeAll(async () => {
      const dbName = testDatabaseName(databaseUrl);
      if (!dbName) {
        throw new Error(
          `P8-S3 integration suite is fail-closed: DATABASE_URL must name a dedicated test database matching ^ipoint_p8s3_[a-z0-9_]+$ and must not be a protected database (received ${databaseUrl ?? 'unset'}).`,
        );
      }
      if (!destructiveTestOptIn(process.env)) {
        throw new Error(
          `P8-S3 integration suite is fail-closed: set ${DESTRUCTIVE_TEST_OPT_IN_ENV}=1 to allow recreating the dedicated test database "${dbName}".`,
        );
      }
      const maintenanceUrl = (databaseUrl ?? '').replace(
        /\/[^/]+$/u,
        '/postgres',
      );
      const { Pool } = await import('pg');
      const maintenance = new Pool({ connectionString: maintenanceUrl });
      await maintenance.query(
        `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`,
      );
      await maintenance.query(`CREATE DATABASE "${dbName}"`);
      await maintenance.end();
      vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
      vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:56379');
      vi.stubEnv(
        'AUTH_OTP_PEPPER',
        'p8-s3-risk-controls-pepper-at-least-32-characters',
      );
      vi.stubEnv(
        'REDEMPTION_VOUCHER_ENCRYPTION_KEY',
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      );
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('LOG_LEVEL', 'silent');
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = module.createNestApplication();
      configureApplication(app, {
        enableShutdownHooks: false,
        scanSwaggerRoutes: false,
      });
      auth = app.get(AuthService);
      database = app.get(DatabaseService);
      await migrate(database.pool);
      await seedFoundation(database.db);
      await app.init();
      server = app.getHttpServer() as Server;
      const marketRows = await database.db
        .insert(markets)
        .values([
          {
            code: 'MY',
            name: 'Malaysia P8-S3',
            status: 'ACTIVE',
            currencyCode: 'MYR',
            timezone: 'Asia/Kuala_Lumpur',
            defaultLocale: 'en-MY',
          },
          {
            code: 'SG',
            name: 'Singapore P8-S3',
            status: 'ACTIVE',
            currencyCode: 'SGD',
            timezone: 'Asia/Singapore',
            defaultLocale: 'en-SG',
          },
        ])
        .returning({ id: markets.id });
      marketA = marketRows[0]?.id ?? '';
      marketB = marketRows[1]?.id ?? '';
      admin = await createAdmin([marketA, marketB], 'SUPER_ADMIN');
      finance = await createAdmin([marketA], 'FINANCE_OPERATOR');
      viewer = await createAdmin([marketA], 'SUPPORT_READONLY_AUDITOR');
      adminId = admin.adminUserId;
      await selectMarket(admin.accountId, marketA);
      await selectMarket(finance.accountId, marketA);
      await selectMarket(viewer.accountId, marketA);
    });

    afterAll(async () => {
      await app?.close();
      vi.unstubAllEnvs();
    });

    it('enforces authentication, permissions and selected-market access', async () => {
      await supertest(server)
        .get(`${base(marketA)}/runs`)
        .expect(401);
      await supertest(server)
        .post(`${base(marketA)}/runs`)
        .set(bearer(viewer.token))
        .set('Idempotency-Key', randomUUID())
        .send({ category: 'SECURITY_EVENT', ...WINDOW, reason: 'Viewer.' })
        .expect(403);
      await supertest(server)
        .post(`${base(marketA)}/definitions`)
        .set(bearer(viewer.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          code: 'suspicious_amount_breach',
          category: 'SUSPICIOUS_TRANSACTION',
          name: 'Viewer attempt',
          config: { max_single_amount: '50000.0000000000' },
          reason: 'Viewer.',
        })
        .expect(403);
      // viewer CAN read (risk.view).
      await supertest(server)
        .get(`${base(marketA)}/events`)
        .set(bearer(viewer.token))
        .expect(200);
      const mismatch = await supertest(server)
        .get(`${base(marketB)}/runs`)
        .set(bearer(admin.token))
        .expect(409);
      expect((mismatch.body as { error: { code: string } }).error.code).toBe(
        'MARKET_CONTEXT_MISMATCH',
      );
    });

    it('versions indicator definitions: v2 supersedes v1 without mutating it', async () => {
      const v1 = await createDefinition(admin.token, marketA, {
        code: 'suspicious_amount_breach',
        category: 'SUSPICIOUS_TRANSACTION',
        name: 'Amount breach v1',
        config: { max_single_amount: '50000.0000000000' },
        severity: 'HIGH',
      });
      expect(v1['version']).toBe(1);
      expect(v1['severity']).toBe('HIGH');
      const v2 = await createDefinition(admin.token, marketA, {
        code: 'suspicious_amount_breach',
        category: 'SUSPICIOUS_TRANSACTION',
        name: 'Amount breach v2',
        config: { max_single_amount: '80000.0000000000' },
      });
      expect(v2['version']).toBe(2);
      expect(v2['severity']).toBe('MEDIUM'); // label default
      // v1 is now superseded but still retrievable and immutable.
      const v1Detail = await supertest(server)
        .get(`${base(marketA)}/definitions/${String(v1['id'])}`)
        .set(bearer(admin.token))
        .expect(200);
      expect(String(v1Detail.body['superseded_by_id'])).toBe(String(v2['id']));
      expect(v1Detail.body['config']).toEqual({
        max_single_amount: '50000.0000000000',
      });
      // Listing defaults to current versions only.
      const list = await supertest(server)
        .get(`${base(marketA)}/definitions?category=SUSPICIOUS_TRANSACTION`)
        .set(bearer(admin.token))
        .expect(200);
      const items = (list.body as { items: Array<Record<string, unknown>> })
        .items;
      expect(
        items.filter((item) => item['code'] === 'suspicious_amount_breach'),
      ).toHaveLength(1);
      expect(items[0]?.['version']).toBe(2);
    });

    it('detects a suspicious single-transaction amount breach', async () => {
      const merchant = await createMerchant(marketA);
      const accountId = await createMcpAccount(
        marketA,
        merchant.branchId,
        '0.0000000000',
        '0.0000000000',
      );
      await appendMcpEntry({
        mcpAccountId: accountId,
        sequence: 1,
        entryType: 'RECHARGE',
        direction: 'CREDIT',
        amount: '100000.0000000000',
        balanceDelta: '100000.0000000000',
        availableDelta: '100000.0000000000',
        sourceType: 'recharge',
        effectiveAt: new Date(),
      });
      const member = await createMember(marketA);
      await createDefinition(admin.token, marketA, {
        code: 'suspicious_amount_breach',
        category: 'SUSPICIOUS_TRANSACTION',
        name: 'Amount breach detector',
        config: { max_single_amount: '50000.0000000000' },
        severity: 'HIGH',
      });
      // Two transactions: one under the operator threshold, one above it.
      await createTransactionFixture(marketA, {
        merchant,
        memberId: member.memberId,
        mcpAccountId: accountId,
        purchase: '40.0000000000',
        withDebit: true,
        withReward: true,
      });
      const flagged = await createTransactionFixture(marketA, {
        merchant,
        memberId: member.memberId,
        mcpAccountId: accountId,
        purchase: '60000.0000000000',
        withDebit: true,
        withReward: true,
      });
      const { body } = await runFixture('SUSPICIOUS_TRANSACTION', admin.token);
      expect(body.status).toBe('COMPLETED');
      expect(body.definitions_scanned).toBe(1);
      expect(body.events_detected).toBe(1);
      const event = await firstEventFor(
        'SUSPICIOUS_TRANSACTION',
        'transaction',
      );
      expect(event['entity_id']).toBe(flagged.transactionId);
      expect(
        (event['payload'] as Record<string, unknown>)['purchase_amount'],
      ).toBe('60000.0000000000');
      expect(event['severity']).toBe('HIGH');
      // The flagged event enters the review queue (flagging only, no enforcement).
      const queue = await supertest(server)
        .get(`${base(marketA)}/queue`)
        .set(bearer(admin.token))
        .expect(200);
      const tasks = (queue.body as { items: Array<Record<string, unknown>> })
        .items;
      expect(tasks.some((task) => task['event_id'] === event['id'])).toBe(true);
    });

    it('detects a duplicate/replay confirmed transaction', async () => {
      const merchant = await createMerchant(marketA);
      const accountId = await createMcpAccount(
        marketA,
        merchant.branchId,
        '0.0000000000',
        '0.0000000000',
      );
      await appendMcpEntry({
        mcpAccountId: accountId,
        sequence: 1,
        entryType: 'RECHARGE',
        direction: 'CREDIT',
        amount: '200.0000000000',
        balanceDelta: '200.0000000000',
        availableDelta: '200.0000000000',
        sourceType: 'recharge',
        effectiveAt: new Date(),
      });
      const member = await createMember(marketA);
      const first = await createTransactionFixture(marketA, {
        merchant,
        memberId: member.memberId,
        mcpAccountId: accountId,
        purchase: '25.0000000000',
        withDebit: true,
        withReward: true,
        confirmedAt: new Date(Date.now() - 5 * 60 * 1000),
      });
      const second = await createTransactionFixture(marketA, {
        merchant,
        memberId: member.memberId,
        mcpAccountId: accountId,
        purchase: '25.0000000000',
        withDebit: true,
        withReward: true,
        confirmedAt: new Date(),
      });
      await createDefinition(admin.token, marketA, {
        code: 'duplicate_confirmed_transaction',
        category: 'DUPLICATE_REPLAY',
        name: 'Replay detector',
        config: { duplicate_window_minutes: 1440 },
      });
      const { body } = await runFixture('DUPLICATE_REPLAY', admin.token);
      expect(body.events_detected).toBe(1);
      const event = await firstEventFor('DUPLICATE_REPLAY', 'transaction');
      expect(event['entity_id']).toBe(second.transactionId);
      const payload = event['payload'] as Record<string, unknown>;
      expect(payload['prior_transaction_id']).toBe(first.transactionId);
      expect(payload['purchase_amount']).toBe('25.0000000000');
    });

    it('detects abnormal executed-adjustment velocity', async () => {
      const merchant = await createMerchant(marketA);
      const accountId = await createMcpAccount(
        marketA,
        merchant.branchId,
        '0.0000000000',
        '0.0000000000',
      );
      const member = await createMember(marketA);
      const walletId = await createWallet(marketA, member.memberId);
      await database.db.insert(mcpAdjustmentRequests).values({
        mcpAccountId: accountId,
        marketId: marketA,
        makerAdminUserId: adminId,
        entryType: 'MANUAL_CREDIT',
        amount: '10.0000000000',
        reason: 'P8-S3 MCP adjustment fixture.',
        evidence: {},
        status: 'EXECUTED',
        idempotencyKey: `mak-${randomUUID()}`,
        payloadHash: '1'.repeat(64),
        executedAt: new Date(),
      });
      await database.db.insert(ipointAdjustmentRequests).values({
        walletAccountId: walletId,
        memberId: member.memberId,
        marketId: marketA,
        direction: 'CREDIT',
        amount: '5.0000000000',
        state: 'EXECUTED',
        reasonCode: 'ADJ-001',
        explanation: 'P8-S3 iPoint adjustment fixture.',
        caseReference: `CASE-${randomUUID()}`,
        makerAdminUserId: adminId,
        idempotencyScope: `scope-${randomUUID()}`,
        idempotencyKey: `iak-${randomUUID()}`,
        payloadHash: '2'.repeat(64),
        requestHash: '3'.repeat(64),
        executedAt: new Date(),
      });
      await createDefinition(admin.token, marketA, {
        code: 'adjustment_execution_velocity',
        category: 'ABNORMAL_ADJUSTMENT',
        name: 'Adjustment velocity',
        config: { window_minutes: 1440, max_adjustment_count: 1 },
      });
      const { body } = await runFixture('ABNORMAL_ADJUSTMENT', admin.token);
      expect(body.events_detected).toBe(1);
      const event = await firstEventFor('ABNORMAL_ADJUSTMENT', 'admin_user');
      expect(event['entity_id']).toBe(adminId);
      expect(
        (event['payload'] as Record<string, unknown>)['adjustment_count'],
      ).toBe(2);
    });

    it('detects rate/config anomaly: overlapping effective periods', async () => {
      await database.db.insert(rewardRuleVersions).values([
        {
          name: 'Reward rate open v1',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          rewardRate: '0.0100000000',
          capType: 'NONE',
          capValue: '0',
          minimumReward: '0',
          marketId: marketA,
          createdBy: adminId,
        },
        {
          name: 'Reward rate open v2',
          effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
          rewardRate: '0.0200000000',
          capType: 'NONE',
          capValue: '0',
          minimumReward: '0',
          marketId: marketA,
          createdBy: adminId,
        },
      ]);
      const profileRows = await database.db
        .insert(serviceFeeProfiles)
        .values({
          code: `PROF-${randomUUID()}`,
          name: 'Fee profile',
          marketId: marketA,
        })
        .returning({ id: serviceFeeProfiles.id });
      const profileId = String(profileRows[0]?.id ?? '');
      await database.db.insert(serviceFeeVersions).values([
        {
          serviceFeeProfileId: profileId,
          rate: '5.000000',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: new Date('2026-02-01T00:00:00.000Z'),
          status: 'ACTIVE',
          marketId: marketA,
        },
        {
          serviceFeeProfileId: profileId,
          rate: '7.500000',
          effectiveFrom: new Date('2026-03-01T00:00:00.000Z'),
          status: 'ACTIVE',
          marketId: marketA,
        },
      ]);
      await createDefinition(admin.token, marketA, {
        code: 'rate_period_overlap',
        category: 'RATE_CONFIG_ANOMALY',
        name: 'Rate overlap detector',
        config: {},
      });
      const { body } = await runFixture('RATE_CONFIG_ANOMALY', admin.token);
      expect(body.events_detected).toBeGreaterThanOrEqual(2);
      const list = await supertest(server)
        .get(`${base(marketA)}/events?category=RATE_CONFIG_ANOMALY`)
        .set(bearer(admin.token))
        .expect(200);
      const items = (list.body as { items: Array<Record<string, unknown>> })
        .items;
      expect(
        items.some((item) => item['entity_type'] === 'reward_rule_version'),
      ).toBe(true);
      expect(
        // DB exclusion constraint (service_fee_versions_no_overlap) guarantees
        // ACTIVE/SCHEDULED service-fee versions never overlap, so the detector
        // must not false-positive on legal non-overlapping data.
        items.some((item) => item['entity_type'] === 'service_fee_version'),
      ).toBe(false);
    });

    it('detects a cross-market wallet-entry violation', async () => {
      const member = await createMember(marketA);
      const walletId = await createWallet(marketA, member.memberId);
      // The wallet account belongs to market A but the entry is booked under
      // market B: a cross-market inconsistency the DB does not constrain.
      await appendWalletEntry({
        walletAccountId: walletId,
        memberId: member.memberId,
        marketId: marketB,
        entrySequence: 1,
        entryType: 'AVAILABLE',
        amount: '50.0000000000',
        balanceBefore: '0.0000000000',
        balanceAfter: '50.0000000000',
      });
      await createDefinition(admin.token, marketA, {
        code: 'cross_market_wallet_entry',
        category: 'CROSS_MARKET_VIOLATION',
        name: 'Cross-market detector',
        config: {},
      });
      const { body } = await runFixture('CROSS_MARKET_VIOLATION', admin.token);
      expect(body.events_detected).toBe(1);
      const event = await firstEventFor(
        'CROSS_MARKET_VIOLATION',
        'wallet_entry',
      );
      expect(
        (event['payload'] as Record<string, unknown>)['wallet_market_id'],
      ).toBe(marketA);
      expect(
        (event['payload'] as Record<string, unknown>)['entry_market_id'],
      ).toBe(marketB);
      expect(event['entity_market_id']).toBe(marketB);
    });

    it('detects account/admin abuse: audit action velocity', async () => {
      // A dedicated admin actor isolates this assertion from audit rows other
      // tests generate through the API on the shared database.
      const dedicated = await createAdmin([marketA], 'FINANCE_OPERATOR');
      const entityId = randomUUID();
      for (let index = 0; index < 3; index += 1) {
        await database.db.insert(auditLogs).values({
          actorType: 'ADMIN_USER',
          actorId: dedicated.adminUserId,
          marketId: marketA,
          action: 'admin.member.note.create',
          entityType: 'member',
          entityId,
          result: 'SUCCESS',
          occurredAt: new Date(),
        });
      }
      await createDefinition(admin.token, marketA, {
        code: 'admin_action_velocity',
        category: 'ACCOUNT_ADMIN_ABUSE',
        name: 'Admin velocity',
        config: { window_minutes: 1440, max_actions: 2 },
      });
      const { body } = await runFixture('ACCOUNT_ADMIN_ABUSE', admin.token);
      expect(body.events_detected).toBeGreaterThanOrEqual(1);
      const list = await supertest(server)
        .get(`${base(marketA)}/events?category=ACCOUNT_ADMIN_ABUSE`)
        .set(bearer(admin.token))
        .expect(200);
      const items = (list.body as { items: Array<Record<string, unknown>> })
        .items;
      // Earlier tests also write audit rows (via the API) for the shared
      // super-admin, so locate the dedicated actor's velocity event.
      const event = items.find(
        (item) => item['entity_id'] === dedicated.adminUserId,
      );
      expect(event, 'dedicated admin velocity event').toBeTruthy();
      expect(
        (event?.['payload'] as Record<string, unknown>)['action_count'],
      ).toBeGreaterThanOrEqual(3);
    });

    it('detects a security-event failure burst', async () => {
      const member = await createMember(marketA);
      for (let index = 0; index < 3; index += 1) {
        await database.db.insert(securityEvents).values({
          accountId: member.accountId,
          eventType: 'LOGIN_FAILED',
          result: 'FAILURE',
          ipAddress: '203.0.113.10',
          userAgent: 'vitest',
          metadata: { attempt: index + 1 },
          occurredAt: new Date(),
        });
      }
      await createDefinition(admin.token, marketA, {
        code: 'security_event_failure_burst',
        category: 'SECURITY_EVENT',
        name: 'Security burst',
        config: { window_minutes: 60, max_failures: 2 },
      });
      const { body } = await runFixture('SECURITY_EVENT', admin.token);
      expect(body.events_detected).toBe(1);
      const event = await firstEventFor('SECURITY_EVENT', 'member');
      expect(event['entity_id']).toBe(member.memberId);
      expect(
        (event['payload'] as Record<string, unknown>)['failure_count'],
      ).toBe(3);
    });

    it('detects aging OPEN review tasks (review queue monitoring)', async () => {
      // First produce one flagged event so a review task exists.
      const merchant = await createMerchant(marketA);
      const accountId = await createMcpAccount(
        marketA,
        merchant.branchId,
        '0.0000000000',
        '0.0000000000',
      );
      await appendMcpEntry({
        mcpAccountId: accountId,
        sequence: 1,
        entryType: 'RECHARGE',
        direction: 'CREDIT',
        amount: '100000.0000000000',
        balanceDelta: '100000.0000000000',
        availableDelta: '100000.0000000000',
        sourceType: 'recharge',
        effectiveAt: new Date(),
      });
      const member = await createMember(marketA);
      const agedTxn = await createTransactionFixture(marketA, {
        merchant,
        memberId: member.memberId,
        mcpAccountId: accountId,
        purchase: '70000.0000000000',
        withDebit: true,
        withReward: true,
      });
      await createDefinition(admin.token, marketA, {
        code: 'suspicious_amount_breach',
        category: 'SUSPICIOUS_TRANSACTION',
        name: 'Aging setup detector',
        config: { max_single_amount: '50000.0000000000' },
      });
      await runFixture('SUSPICIOUS_TRANSACTION', admin.token);
      // Target this fixture's event (earlier fixtures are also re-detected).
      const eventList = await supertest(server)
        .get(`${base(marketA)}/events?category=SUSPICIOUS_TRANSACTION`)
        .set(bearer(admin.token))
        .expect(200);
      const agedEvent = (
        eventList.body as { items: Array<Record<string, unknown>> }
      ).items.find((item) => item['entity_id'] === agedTxn.transactionId);
      expect(agedEvent).toBeTruthy();
      const queue = await supertest(server)
        .get(`${base(marketA)}/queue`)
        .set(bearer(admin.token))
        .expect(200);
      const taskId = String(
        (
          queue.body as { items: Array<{ id: string; event_id: string }> }
        ).items.find((task) => task.event_id === agedEvent?.['id'])?.id ?? '',
      );
      // Backdate the OPEN task so it is older than max_open_days.
      await database.pool.query(
        `UPDATE risk_review_queue
            SET created_at = now() - interval '10 days'
          WHERE id = $1::uuid`,
        [taskId],
      );
      await createDefinition(admin.token, marketA, {
        code: 'review_queue_aging',
        category: 'REVIEW_QUEUE',
        name: 'Aging detector',
        config: { max_open_days: 7 },
      });
      const { body } = await runFixture('REVIEW_QUEUE', admin.token);
      expect(body.events_detected).toBe(1);
      const event = await firstEventFor('REVIEW_QUEUE', 'risk_review_task');
      expect(event['entity_id']).toBe(taskId);
    });

    it('replays a completed run idempotently without duplicate events', async () => {
      const merchant = await createMerchant(marketA);
      const accountId = await createMcpAccount(
        marketA,
        merchant.branchId,
        '0.0000000000',
        '0.0000000000',
      );
      await appendMcpEntry({
        mcpAccountId: accountId,
        sequence: 1,
        entryType: 'RECHARGE',
        direction: 'CREDIT',
        amount: '100000.0000000000',
        balanceDelta: '100000.0000000000',
        availableDelta: '100000.0000000000',
        sourceType: 'recharge',
        effectiveAt: new Date(),
      });
      const member = await createMember(marketA);
      await createTransactionFixture(marketA, {
        merchant,
        memberId: member.memberId,
        mcpAccountId: accountId,
        purchase: '90000.0000000000',
        withDebit: true,
        withReward: true,
      });
      await createDefinition(admin.token, marketA, {
        code: 'suspicious_amount_breach',
        category: 'SUSPICIOUS_TRANSACTION',
        name: 'Replay detector',
        config: { max_single_amount: '50000.0000000000' },
      });
      const created = await supertest(server)
        .post(`${base(marketA)}/runs`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          category: 'SUSPICIOUS_TRANSACTION',
          ...WINDOW,
          reason: 'Replay.',
        })
        .expect(201);
      const runId = String((created.body as { id: string }).id);
      const executeKey = randomUUID();
      const first = await supertest(server)
        .post(`${base(marketA)}/runs/${runId}/execute`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', executeKey)
        .expect(200);
      expect((first.body as { status: string }).status).toBe('COMPLETED');
      // Same idempotency key replays the stored response.
      const replay = await supertest(server)
        .post(`${base(marketA)}/runs/${runId}/execute`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', executeKey)
        .expect(200);
      expect((replay.body as { id: string }).id).toBe(runId);
      // Fresh key is also a no-op for COMPLETED runs.
      await supertest(server)
        .post(`${base(marketA)}/runs/${runId}/execute`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      const events = await database.pool.query(
        'SELECT count(*)::int AS count FROM risk_events WHERE run_id = $1',
        [runId],
      );
      expect((events.rows[0]?.['count'] as number) ?? 0).toBeGreaterThanOrEqual(
        1,
      );
      const countAfterReplays = (events.rows[0]?.['count'] as number) ?? 0;
      // A COMPLETED run must never add events on further fresh-key executions.
      await supertest(server)
        .post(`${base(marketA)}/runs/${runId}/execute`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      const afterExtra = await database.pool.query(
        'SELECT count(*)::int AS count FROM risk_events WHERE run_id = $1',
        [runId],
      );
      expect(afterExtra.rows[0]?.['count']).toBe(countAfterReplays);
      const tasks = await database.pool.query(
        'SELECT count(*)::int AS count FROM risk_review_queue WHERE event_id IN (SELECT id FROM risk_events WHERE run_id = $1)',
        [runId],
      );
      expect(tasks.rows[0]?.['count']).toBe(countAfterReplays);
      // A concurrent-style RUNNING state conflicts instead of double-running.
      await database.pool.query(
        `UPDATE risk_detection_runs
            SET status = 'RUNNING', started_at = now(),
                completed_at = NULL, failed_at = NULL, cancelled_at = NULL,
                version = version + 1
          WHERE id = $1`,
        [runId],
      );
      await supertest(server)
        .post(`${base(marketA)}/runs/${runId}/execute`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .expect(409);
      // Restore for later snapshots (status is a risk-domain column).
      await database.pool.query(
        `UPDATE risk_detection_runs
            SET status = 'COMPLETED', started_at = now(), completed_at = now(),
                failed_at = NULL, cancelled_at = NULL,
                version = version + 1
          WHERE id = $1`,
        [runId],
      );
    });

    it('re-executes FAILED and CANCELLED runs with a fresh snapshot (H-1)', async () => {
      const merchant = await createMerchant(marketA);
      const accountId = await createMcpAccount(
        marketA,
        merchant.branchId,
        '0.0000000000',
        '0.0000000000',
      );
      await appendMcpEntry({
        mcpAccountId: accountId,
        sequence: 1,
        entryType: 'RECHARGE',
        direction: 'CREDIT',
        amount: '100000.0000000000',
        balanceDelta: '100000.0000000000',
        availableDelta: '100000.0000000000',
        sourceType: 'recharge',
        effectiveAt: new Date(),
      });
      const member = await createMember(marketA);
      await createTransactionFixture(marketA, {
        merchant,
        memberId: member.memberId,
        mcpAccountId: accountId,
        purchase: '95000.0000000000',
        withDebit: true,
        withReward: true,
      });
      await createDefinition(admin.token, marketA, {
        code: 'suspicious_amount_breach',
        category: 'SUSPICIOUS_TRANSACTION',
        name: 'Retry detector',
        config: { max_single_amount: '50000.0000000000' },
      });
      const created = await supertest(server)
        .post(`${base(marketA)}/runs`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          category: 'SUSPICIOUS_TRANSACTION',
          ...WINDOW,
          reason: 'Retry.',
        })
        .expect(201);
      const runId = String((created.body as { id: string }).id);
      await supertest(server)
        .post(`${base(marketA)}/runs/${runId}/execute`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      // Force FAILED (timestamps + failure reason satisfy the CHECK), then
      // re-execute: terminal timestamps must be cleared and the run completes
      // with a fresh snapshot and no duplicated events.
      await database.pool.query(
        `UPDATE risk_detection_runs
            SET status = 'FAILED', started_at = now(), failed_at = now(),
                completed_at = NULL, cancelled_at = NULL,
                failure_reason = 'forced failure for retry test',
                version = version + 1
          WHERE id = $1`,
        [runId],
      );
      const retried = await supertest(server)
        .post(`${base(marketA)}/runs/${runId}/execute`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      expect((retried.body as { status: string }).status).toBe('COMPLETED');
      const eventsAfterRetry = await database.pool.query(
        'SELECT count(*)::int AS count FROM risk_events WHERE run_id = $1',
        [runId],
      );
      expect(
        (eventsAfterRetry.rows[0]?.['count'] as number) ?? 0,
      ).toBeGreaterThanOrEqual(1);
      // CANCELLED runs are also re-executable.
      const created2 = await supertest(server)
        .post(`${base(marketA)}/runs`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          category: 'REVIEW_QUEUE',
          ...WINDOW,
          reason: 'Cancel then retry.',
        })
        .expect(201);
      const runId2 = String((created2.body as { id: string }).id);
      await supertest(server)
        .post(`${base(marketA)}/runs/${runId2}/cancel`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: 1, reason: 'Cancel first.' })
        .expect(200);
      const retried2 = await supertest(server)
        .post(`${base(marketA)}/runs/${runId2}/execute`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      expect((retried2.body as { status: string }).status).toBe('COMPLETED');
    });

    it('walks the review queue lifecycle with append-only notes and audit', async () => {
      const merchant = await createMerchant(marketA);
      const accountId = await createMcpAccount(
        marketA,
        merchant.branchId,
        '0.0000000000',
        '0.0000000000',
      );
      await appendMcpEntry({
        mcpAccountId: accountId,
        sequence: 1,
        entryType: 'RECHARGE',
        direction: 'CREDIT',
        amount: '100000.0000000000',
        balanceDelta: '100000.0000000000',
        availableDelta: '100000.0000000000',
        sourceType: 'recharge',
        effectiveAt: new Date(),
      });
      const member = await createMember(marketA);
      const lifecycleTxn = await createTransactionFixture(marketA, {
        merchant,
        memberId: member.memberId,
        mcpAccountId: accountId,
        purchase: '55000.0000000000',
        withDebit: true,
        withReward: true,
      });
      await createDefinition(admin.token, marketA, {
        code: 'suspicious_amount_breach',
        category: 'SUSPICIOUS_TRANSACTION',
        name: 'Queue lifecycle detector',
        config: { max_single_amount: '50000.0000000000' },
      });
      await runFixture('SUSPICIOUS_TRANSACTION', admin.token);
      // Find this fixture's event (earlier flagged fixtures are re-detected).
      const eventList = await supertest(server)
        .get(`${base(marketA)}/events?category=SUSPICIOUS_TRANSACTION`)
        .set(bearer(admin.token))
        .expect(200);
      const lifecycleEvent = (
        eventList.body as { items: Array<Record<string, unknown>> }
      ).items.find((item) => item['entity_id'] === lifecycleTxn.transactionId);
      expect(lifecycleEvent).toBeTruthy();
      const queue = await supertest(server)
        .get(`${base(marketA)}/queue`)
        .set(bearer(admin.token))
        .expect(200);
      const task = (
        queue.body as { items: Array<Record<string, unknown>> }
      ).items.find((item) => item['event_id'] === lifecycleEvent?.['id']);
      expect(task).toBeTruthy();
      const taskId = String((task as { id?: string })?.['id'] ?? '');
      expect((task as { status?: string })?.['status']).toBe('OPEN');

      // Strict chain: OPEN -> IN_REVIEW -> RESOLVED.
      // IN_REVIEW actions from OPEN are rejected.
      await supertest(server)
        .post(`${base(marketA)}/queue/${taskId}/decide`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          expectedVersion: 1,
          decision: 'WATCH',
          decisionReason: 'Not yet assigned.',
          reason: 'Skip assign.',
        })
        .expect(409);
      await supertest(server)
        .post(`${base(marketA)}/queue/${taskId}/resolve`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: 1, reason: 'Skip assign.' })
        .expect(409);
      const assigned = await supertest(server)
        .post(`${base(marketA)}/queue/${taskId}/assign`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: 1, reason: 'Claiming for review.' })
        .expect(200);
      expect((assigned.body as { status: string }).status).toBe('IN_REVIEW');
      expect(
        (assigned.body as { assigned_admin_user_id: string })
          .assigned_admin_user_id,
      ).toBe(adminId);
      // Stale version is rejected.
      await supertest(server)
        .post(`${base(marketA)}/queue/${taskId}/assign`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: 1, reason: 'Stale retry.' })
        .expect(409);
      // Append an investigation note (version 2).
      const noted = await supertest(server)
        .post(`${base(marketA)}/queue/${taskId}/notes`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          expectedVersion: 2,
          notes: 'Cross-checked against merchant records.',
          reason: 'Investigation note.',
        })
        .expect(200);
      expect(
        String((noted.body as { notes: string }).notes).includes(
          'Cross-checked against merchant records.',
        ),
      ).toBe(true);
      expect(
        String((noted.body as { notes: string }).notes).includes(adminId),
      ).toBe(true);
      const decided = await supertest(server)
        .post(`${base(marketA)}/queue/${taskId}/decide`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          expectedVersion: 3,
          decision: 'WATCH',
          decisionReason: 'Monitor for 30 days.',
          reason: 'Decision recorded.',
        })
        .expect(200);
      expect((decided.body as { decision: string }).decision).toBe('WATCH');
      const resolved = await supertest(server)
        .post(`${base(marketA)}/queue/${taskId}/resolve`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: 4, reason: 'Review complete.' })
        .expect(200);
      expect((resolved.body as { status: string }).status).toBe('RESOLVED');
      // RESOLVED tasks reject notes.
      await supertest(server)
        .post(`${base(marketA)}/queue/${taskId}/notes`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          expectedVersion: 5,
          notes: 'Too late.',
          reason: 'Should be rejected.',
        })
        .expect(409);
      // Immutable audit trail covers every mutation.
      const audit = await database.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, taskId));
      const actions = audit.map((row) => row.action);
      expect(actions).toContain('risk.queue.assigned');
      expect(actions).toContain('risk.queue.notes');
      expect(actions).toContain('risk.queue.decided');
      expect(actions).toContain('risk.queue.resolved');
      expect(audit[0]?.reason).toBeTruthy();
    });

    it('isolates runs, events and definitions by market', async () => {
      // Market B fixture: one suspicious transaction in market B.
      await selectMarket(admin.accountId, marketB);
      const merchantB = await createMerchant(marketB);
      const accountB = await createMcpAccount(
        marketB,
        merchantB.branchId,
        '0.0000000000',
        '0.0000000000',
      );
      await appendMcpEntry({
        mcpAccountId: accountB,
        sequence: 1,
        entryType: 'RECHARGE',
        direction: 'CREDIT',
        amount: '100000.0000000000',
        balanceDelta: '100000.0000000000',
        availableDelta: '100000.0000000000',
        sourceType: 'recharge',
        effectiveAt: new Date(),
      });
      const memberB = await createMember(marketB);
      await createTransactionFixture(marketB, {
        merchant: merchantB,
        memberId: memberB.memberId,
        mcpAccountId: accountB,
        purchase: '75000.0000000000',
        withDebit: true,
        withReward: true,
      });
      await supertest(server)
        .post(`${base(marketB)}/definitions`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          code: 'suspicious_amount_breach',
          category: 'SUSPICIOUS_TRANSACTION',
          name: 'Market B detector',
          config: { max_single_amount: '50000.0000000000' },
          reason: 'Market B fixture.',
        })
        .expect(201);
      const runB = await supertest(server)
        .post(`${base(marketB)}/runs`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          category: 'SUSPICIOUS_TRANSACTION',
          ...WINDOW,
          reason: 'Market B run.',
        })
        .expect(201);
      const runBId = String((runB.body as { id: string }).id);
      await supertest(server)
        .post(`${base(marketB)}/runs/${runBId}/execute`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      // Market A lists never see market B runs.
      await selectMarket(admin.accountId, marketA);
      const listA = await supertest(server)
        .get(`${base(marketA)}/runs`)
        .set(bearer(admin.token))
        .expect(200);
      expect(
        (listA.body as { items: Array<{ market_id: string }> }).items.every(
          (item) => item.market_id === marketA,
        ),
      ).toBe(true);
      // Foreign-market run detail is 403.
      await supertest(server)
        .get(`${base(marketA)}/runs/${runBId}`)
        .set(bearer(admin.token))
        .expect(403);
      // Market B events are not visible through market A endpoints.
      const eventsB = await database.pool.query(
        `SELECT count(*)::int AS count FROM risk_events WHERE run_id = $1`,
        [runBId],
      );
      expect(eventsB.rows[0]?.['count']).toBe(1);
      const eventsA = await supertest(server)
        .get(`${base(marketA)}/events?category=SUSPICIOUS_TRANSACTION`)
        .set(bearer(admin.token))
        .expect(200);
      const itemsA = (eventsA.body as { items: Array<Record<string, unknown>> })
        .items;
      expect(itemsA.every((item) => item['market_id'] === marketA)).toBe(true);
    });

    it('cancels a PENDING run with reason and audit; COMPLETED runs cannot cancel', async () => {
      const created = await supertest(server)
        .post(`${base(marketA)}/runs`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ category: 'REVIEW_QUEUE', ...WINDOW, reason: 'Cancel target.' })
        .expect(201);
      const runId = String((created.body as { id: string }).id);
      const cancelled = await supertest(server)
        .post(`${base(marketA)}/runs/${runId}/cancel`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: 1, reason: 'Out of scope.' })
        .expect(200);
      expect((cancelled.body as { status: string }).status).toBe('CANCELLED');
      const audit = await database.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, runId));
      expect(audit.map((row) => row.action)).toContain('risk.run.cancelled');
      const other = await supertest(server)
        .post(`${base(marketA)}/runs`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ category: 'REVIEW_QUEUE', ...WINDOW, reason: 'Complete.' })
        .expect(201);
      const otherId = String((other.body as { id: string }).id);
      await supertest(server)
        .post(`${base(marketA)}/runs/${otherId}/execute`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      await supertest(server)
        .post(`${base(marketA)}/runs/${otherId}/cancel`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: 2, reason: 'Too late.' })
        .expect(409);
    });

    it('never writes to frozen financial tables and never enforces penalties', async () => {
      // Self-contained fixture: a member with an ACTIVE account, an MCP
      // account with a ledger entry, a wallet with an entry, and one flagged
      // suspicious transaction.
      const merchant = await createMerchant(marketA);
      const accountId = await createMcpAccount(
        marketA,
        merchant.branchId,
        '0.0000000000',
        '0.0000000000',
      );
      await appendMcpEntry({
        mcpAccountId: accountId,
        sequence: 1,
        entryType: 'RECHARGE',
        direction: 'CREDIT',
        amount: '100000.0000000000',
        balanceDelta: '100000.0000000000',
        availableDelta: '100000.0000000000',
        sourceType: 'recharge',
        effectiveAt: new Date(),
      });
      const member = await createMember(marketA);
      const walletId = await createWallet(marketA, member.memberId);
      await appendWalletEntry({
        walletAccountId: walletId,
        memberId: member.memberId,
        marketId: marketA,
        entrySequence: 1,
        entryType: 'AVAILABLE',
        amount: '50.0000000000',
        balanceBefore: '0.0000000000',
        balanceAfter: '50.0000000000',
      });
      await createTransactionFixture(marketA, {
        merchant,
        memberId: member.memberId,
        mcpAccountId: accountId,
        purchase: '60000.0000000000',
        withDebit: true,
        withReward: true,
      });
      const before = await snapshotFrozenTables();
      for (const category of [
        'SUSPICIOUS_TRANSACTION',
        'DUPLICATE_REPLAY',
        'ABNORMAL_ADJUSTMENT',
        'RATE_CONFIG_ANOMALY',
        'CROSS_MARKET_VIOLATION',
        'ACCOUNT_ADMIN_ABUSE',
        'SECURITY_EVENT',
        'REVIEW_QUEUE',
      ]) {
        const { body } = await runFixture(category, admin.token);
        expect(body.status).toBe('COMPLETED');
      }
      const after = await snapshotFrozenTables();
      expect(after).toBe(before);
      // Negative path: a flagged event does NOT freeze the member or the MCP
      // account, does NOT debit anything, and does NOT disable anyone.
      const memberState = await database.pool.query(
        'SELECT status FROM members WHERE id = $1::uuid',
        [member.memberId],
      );
      expect(memberState.rows[0]?.['status']).toBe('ACTIVE');
      const mcpState = await database.pool.query(
        'SELECT status FROM mcp_accounts WHERE id = $1::uuid',
        [accountId],
      );
      expect(mcpState.rows[0]?.['status']).toBe('ACTIVE');
      const walletState = await database.pool.query(
        'SELECT available_balance FROM member_wallet_accounts WHERE id = $1::uuid',
        [walletId],
      );
      expect(String(walletState.rows[0]?.['available_balance'])).toBe(
        '50.0000000000',
      );
      const frozenMembers = await database.pool.query(
        "SELECT count(*)::int AS count FROM members WHERE status IN ('SUSPENDED','CLOSED')",
      );
      expect(frozenMembers.rows[0]?.['count']).toBe(0);
      const flaggedRows = await database.db
        .select({ id: riskEvents.id })
        .from(riskEvents)
        .where(eq(riskEvents.marketId, marketA));
      expect(flaggedRows.length).toBeGreaterThan(0);
      // Every flagged event is queued for review (OPEN) - flagging only.
      const openTasks = await database.db
        .select({ id: riskReviewQueue.id })
        .from(riskReviewQueue)
        .where(eq(riskReviewQueue.status, 'OPEN'));
      expect(openTasks.length).toBeGreaterThan(0);
    });
  },
);
