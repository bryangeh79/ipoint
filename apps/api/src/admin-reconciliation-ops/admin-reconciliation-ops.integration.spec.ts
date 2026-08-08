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
  commissionLedger,
  commissionProcessing,
  marketAccess,
  markets,
  mcpAccounts,
  mcpLedgerEntries,
  mcpRefundRequests,
  memberWalletAccounts,
  memberWalletEntries,
  members,
  merchantBranches,
  merchantGroups,
  merchantPackageAssignments,
  migrate,
  marketTransactionSettings,
  redemptionCatalogItems,
  redemptionOrders,
  redemptionRateVersions,
  redemptionVoucherCodes,
  rewardPlans,
  rewardRuleVersions,
  rewardSources,
  roleAssignments,
  roles,
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
const password = 'P8-S2-Reconciliation-Password-123!';

// ---------------------------------------------------------------------------
// Fail-closed destructive fresh-database guard (P8-S1 H-01 pattern).
// ---------------------------------------------------------------------------
const TEST_DATABASE_NAME_PATTERN = /^ipoint_p8s2_[a-z0-9_]{1,63}$/u;
const PROTECTED_DATABASE_NAMES = new Set([
  'postgres',
  'template0',
  'template1',
]);
export const DESTRUCTIVE_TEST_OPT_IN_ENV = 'P8S2_DESTRUCTIVE_TEST';

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

describe('P8-S2 destructive fresh-database guard', () => {
  it('accepts only the dedicated ipoint_p8s2_* test pattern', () => {
    expect(
      testDatabaseName(
        'postgresql://user:pass@127.0.0.1:55432/ipoint_p8s2_test',
      ),
    ).toBe('ipoint_p8s2_test');
    expect(
      testDatabaseName('postgres://localhost/ipoint_p8s2_migration_test'),
    ).toBe('ipoint_p8s2_migration_test');
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
    expect(testDatabaseName('postgresql://localhost/ipoint_p8s2')).toBeNull();
    expect(
      testDatabaseName('postgresql://localhost/ipoint_p8s2_test_x%2Fbad'),
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
  'mcp_accounts',
  'mcp_ledger_entries',
  'mcp_refund_requests',
  'member_wallet_accounts',
  'member_wallet_entries',
  'transactions',
  'transaction_mcp_debits',
  'transaction_reward_links',
  'reward_sources',
  'reward_plans',
  'commission_processing',
  'commission_ledger',
  'redemption_refund_requests',
  'redemption_orders',
  'redemption_voucher_codes',
  'redemption_inventory',
  'redemption_catalog_items',
] as const;

describe.skipIf(!databaseUrl)(
  'P8-S2 Financial Reconciliation HTTP integration (real PostgreSQL)',
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

    // Shared fixture ids for the clean MCP run and no-write assertions.
    let mcpAccountId: string;
    let memberId: string;
    let walletAccountId: string;

    const base = (marketId: string) =>
      `/api/v1/admin/reconciliation/markets/${marketId}`;
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
      return {
        memberId: String(memberRows[0]?.id ?? ''),
        accountId: account.accountId,
      };
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
          'reconciliation-fixture',
          'P8-S2 fixture entry.',
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
      entryType: string;
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
          description: 'P8-S2 fixture entry.',
          reason: 'P8-S2 fixture entry.',
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
          confirmedAt: new Date(),
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

    async function runFixture(kind: string, token: string) {
      const response = await supertest(server)
        .post(`${base(marketA)}/runs`)
        .set(bearer(token))
        .set('Idempotency-Key', randomUUID())
        .send({ kind, ...WINDOW, reason: `${kind} fixture run.` })
        .expect(201);
      const runId = String((response.body as { id: string }).id);
      const executed = await supertest(server)
        .post(`${base(marketA)}/runs/${runId}/execute`)
        .set(bearer(token))
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      return { runId, body: executed.body as Record<string, unknown> };
    }

    beforeAll(async () => {
      const dbName = testDatabaseName(databaseUrl);
      if (!dbName) {
        throw new Error(
          `P8-S2 integration suite is fail-closed: DATABASE_URL must name a dedicated test database matching ^ipoint_p8s2_[a-z0-9_]+$ and must not be a protected database (received ${databaseUrl ?? 'unset'}).`,
        );
      }
      if (!destructiveTestOptIn(process.env)) {
        throw new Error(
          `P8-S2 integration suite is fail-closed: set ${DESTRUCTIVE_TEST_OPT_IN_ENV}=1 to allow recreating the dedicated test database "${dbName}".`,
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
        'p8-s2-reconciliation-pepper-at-least-32-characters',
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
            name: 'Malaysia P8-S2',
            status: 'ACTIVE',
            currencyCode: 'MYR',
            timezone: 'Asia/Kuala_Lumpur',
            defaultLocale: 'en-MY',
          },
          {
            code: 'SG',
            name: 'Singapore P8-S2',
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

      // Baseline consistent fixtures for market A. The account starts at zero
      // so the owner-projected balance after the single +100 RECHARGE posting
      // equals the ledger net (100 = 100); starting at 100 would double-count.
      const merchant = await createMerchant(marketA);
      mcpAccountId = await createMcpAccount(
        marketA,
        merchant.branchId,
        '0.0000000000',
        '0.0000000000',
      );
      await appendMcpEntry({
        mcpAccountId,
        sequence: 1,
        entryType: 'RECHARGE',
        direction: 'CREDIT',
        amount: '100.0000000000',
        balanceDelta: '100.0000000000',
        availableDelta: '100.0000000000',
        sourceType: 'recharge',
        effectiveAt: new Date(),
      });
      const member = await createMember(marketA);
      memberId = member.memberId;
      walletAccountId = await createWallet(marketA, memberId);
      await appendWalletEntry({
        walletAccountId,
        memberId,
        marketId: marketA,
        entrySequence: 1,
        entryType: 'AVAILABLE',
        amount: '50.0000000000',
        balanceBefore: '0.0000000000',
        balanceAfter: '50.0000000000',
      });
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
        .send({ kind: 'MCP', ...WINDOW, reason: 'Viewer cannot create.' })
        .expect(403);
      await supertest(server)
        .post(`${base(marketA)}/runs/${randomUUID()}/execute`)
        .set(bearer(viewer.token))
        .set('Idempotency-Key', randomUUID())
        .expect(403);
      await supertest(server)
        .post(`${base(marketA)}/exceptions/${randomUUID()}/acknowledge`)
        .set(bearer(viewer.token))
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: 1, reason: 'Viewer cannot manage.' })
        .expect(403);
      const mismatch = await supertest(server)
        .get(`${base(marketB)}/runs`)
        .set(bearer(admin.token))
        .expect(409);
      expect((mismatch.body as { error: { code: string } }).error.code).toBe(
        'MARKET_CONTEXT_MISMATCH',
      );
    });

    it('creates and executes a clean MCP run with no exceptions', async () => {
      const created = await supertest(server)
        .post(`${base(marketA)}/runs`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ kind: 'MCP', ...WINDOW, reason: 'Clean MCP run.' })
        .expect(201);
      const runId = String((created.body as { id: string }).id);
      expect((created.body as { status: string }).status).toBe('PENDING');
      const executed = await supertest(server)
        .post(`${base(marketA)}/runs/${runId}/execute`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      const body = executed.body as {
        status: string;
        matched_count: number;
        mismatched_count: number;
        exception_count: number;
      };
      expect(body.status).toBe('COMPLETED');
      expect(body.matched_count).toBe(2);
      expect(body.mismatched_count).toBe(0);
      expect(body.exception_count).toBe(0);
      const detail = await supertest(server)
        .get(`${base(marketA)}/runs/${runId}`)
        .set(bearer(admin.token))
        .expect(200);
      expect(
        (detail.body as { items: unknown[]; exceptions: unknown[] }).exceptions,
      ).toHaveLength(0);
      expect((detail.body as { items: unknown[] }).items).toHaveLength(2);
    });

    it('replays a completed run idempotently without duplicate evidence', async () => {
      const created = await supertest(server)
        .post(`${base(marketA)}/runs`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ kind: 'IPOINT', ...WINDOW, reason: 'Idempotency run.' })
        .expect(201);
      const runId = String((created.body as { id: string }).id);
      const executeKey = randomUUID();
      const first = await supertest(server)
        .post(`${base(marketA)}/runs/${runId}/execute`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', executeKey)
        .expect(200);
      const firstBody = first.body as { status: string };
      expect(firstBody.status).toBe('COMPLETED');
      // Replay with the SAME idempotency key returns the stored response.
      const replay = await supertest(server)
        .post(`${base(marketA)}/runs/${runId}/execute`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', executeKey)
        .expect(200);
      expect((replay.body as { id: string }).id).toBe(runId);
      // Replay with a FRESH key also returns the original result (no-op).
      await supertest(server)
        .post(`${base(marketA)}/runs/${runId}/execute`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      const items = await database.pool.query(
        'SELECT count(*)::int AS count FROM reconciliation_run_items WHERE run_id = $1',
        [runId],
      );
      expect(items.rows[0]?.['count']).toBe(1);
      const exceptions = await database.pool.query(
        'SELECT count(*)::int AS count FROM reconciliation_exceptions WHERE run_id = $1',
        [runId],
      );
      expect(exceptions.rows[0]?.['count']).toBe(0);
      // A concurrent-style RUNNING state conflicts instead of double-running.
      // The direct UPDATE must satisfy reconciliation_runs_timestamps_check
      // (RUNNING: started_at set, all other timestamps NULL).
      await database.pool.query(
        `UPDATE reconciliation_runs
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
      // Restore for the no-write snapshot (status is a reconciliation table).
      await database.pool.query(
        `UPDATE reconciliation_runs
            SET status = 'COMPLETED', started_at = now(), completed_at = now(),
                failed_at = NULL, cancelled_at = NULL,
                version = version + 1
          WHERE id = $1`,
        [runId],
      );
    });

    it('detects an MCP balance mismatch with exact expected/actual/difference', async () => {
      const merchant = await createMerchant(marketA);
      // Ledger is empty (0) while the maintained total balance says 95: a
      // legitimate drift scenario constructible without bypassing the frozen
      // ledger/balance protections (INSERT is allowed; UPDATE is not).
      const accountId = await createMcpAccount(
        marketA,
        merchant.branchId,
        '95.0000000000',
        '0.0000000000',
      );
      const { body } = await runFixture('MCP', admin.token);
      expect(body.mismatched_count).toBe(1);
      expect(body.exception_count).toBe(1);
      const list = await supertest(server)
        .get(`${base(marketA)}/exceptions`)
        .set(bearer(admin.token))
        .expect(200);
      const items = (list.body as { items: Array<Record<string, unknown>> })
        .items;
      const exception = items.find(
        (item) => item['reference_type'] === 'mcp_account_total',
      );
      expect(exception).toBeTruthy();
      expect(exception?.['expected_amount']).toBe('0.0000000000');
      expect(exception?.['actual_amount']).toBe('95.0000000000');
      expect(exception?.['difference_amount']).toBe('95.0000000000');
      expect(exception?.['status']).toBe('OPEN');
      expect(exception?.['classification']).toBe('AMOUNT_MISMATCH');
    });

    it('detects an iPoint wallet-entry ledger invariant violation', async () => {
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
        balanceAfter: '55.0000000000', // delta +55, signed amount +50
      });
      const { body } = await runFixture('IPOINT', admin.token);
      expect(body.mismatched_count).toBe(1);
      const list = await supertest(server)
        .get(`${base(marketA)}/exceptions`)
        .set(bearer(admin.token))
        .expect(200);
      const exception = (
        list.body as { items: Array<Record<string, unknown>> }
      ).items.find((item) => item['reference_type'] === 'wallet_entry');
      expect(exception?.['expected_amount']).toBe('50.0000000000');
      expect(exception?.['actual_amount']).toBe('55.0000000000');
      expect(exception?.['difference_amount']).toBe('5.0000000000');
    });

    it('detects missing MCP debit and reward entitlements for a confirmed transaction', async () => {
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
        amount: '100.0000000000',
        balanceDelta: '100.0000000000',
        availableDelta: '100.0000000000',
        sourceType: 'recharge',
        effectiveAt: new Date(),
      });
      const member = await createMember(marketA);
      // A complete transaction (debit + reward) that must match.
      await createTransactionFixture(marketA, {
        merchant,
        memberId: member.memberId,
        mcpAccountId: accountId,
        purchase: '40.0000000000',
        withDebit: true,
        withReward: true,
      });
      // A transaction missing both the debit and the reward entitlement.
      await createTransactionFixture(marketA, {
        merchant,
        memberId: member.memberId,
        mcpAccountId: accountId,
        purchase: '25.0000000000',
        withDebit: false,
        withReward: false,
      });
      const { body } = await runFixture('TRANSACTION_LEDGER', admin.token);
      expect(body.matched_count).toBe(2);
      expect(body.mismatched_count).toBe(2);
      const list = await supertest(server)
        .get(`${base(marketA)}/exceptions`)
        .set(bearer(admin.token))
        .expect(200);
      const items = (list.body as { items: Array<Record<string, unknown>> })
        .items;
      const missingDebit = items.find(
        (item) => item['reference_type'] === 'transaction_mcp_debit',
      );
      expect(missingDebit?.['classification']).toBe('MISSING_EXPECTED');
      expect(missingDebit?.['expected_amount']).toBe('25.0000000000');
      expect(missingDebit?.['actual_amount']).toBe('0.0000000000');
      const missingReward = items.find(
        (item) => item['reference_type'] === 'transaction_reward_source',
      );
      expect(missingReward?.['classification']).toBe('MISSING_EXPECTED');
    });

    it('detects a completed commission processing without its ledger posting', async () => {
      const member = await createMember(marketA);
      // Matched processing: one EARNED posting in MY.
      const matchedRows = await database.db
        .insert(commissionProcessing)
        .values({
          canonicalProcessingKey: `k-${randomUUID()}`,
          sourceType: 'AGENT_UPGRADE',
          sourceReference: `src-${randomUUID()}`,
          requestHash: '1'.repeat(64),
          status: 'COMPLETED',
          completionOutcome: 'CREATED',
          completedAt: new Date(),
        })
        .returning({ id: commissionProcessing.id });
      await database.db.insert(commissionLedger).values({
        publicReference: `r-${randomUUID().slice(0, 12)}`,
        beneficiaryId: member.memberId,
        sourceType: 'AGENT_UPGRADE',
        sourceReference: `src-${randomUUID().slice(0, 12)}`,
        market: 'MY',
        currency: 'MYR',
        amount: '10.0000000000',
        entryType: 'AGENT_UPGRADE_G1_EARN',
        postingStatus: 'EARNED',
        canonicalEntryKey: `cek-${randomUUID().slice(0, 12)}`,
        processingId: String(matchedRows[0]?.id ?? ''),
        effectiveTime: new Date(),
      });
      // Broken processing: COMPLETED/CREATED with no posting at all.
      await database.db.insert(commissionProcessing).values({
        canonicalProcessingKey: `k-${randomUUID()}`,
        sourceType: 'AGENT_UPGRADE',
        sourceReference: `src-${randomUUID()}`,
        requestHash: '2'.repeat(64),
        status: 'COMPLETED',
        completionOutcome: 'CREATED',
        completedAt: new Date(),
      });
      const { body } = await runFixture('COMMISSION', admin.token);
      expect(body.matched_count).toBe(1);
      expect(body.mismatched_count).toBe(1);
      const list = await supertest(server)
        .get(`${base(marketA)}/exceptions`)
        .set(bearer(admin.token))
        .expect(200);
      const exception = (
        list.body as { items: Array<Record<string, unknown>> }
      ).items.find(
        (item) => item['reference_type'] === 'commission_processing',
      );
      expect(exception?.['classification']).toBe('MISSING_EXPECTED');
    });

    it('detects an approved MCP refund without its compensating ledger credit', async () => {
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
        amount: '100.0000000000',
        balanceDelta: '100.0000000000',
        availableDelta: '100.0000000000',
        sourceType: 'recharge',
        effectiveAt: new Date(),
      });
      // Matched approved refund with its compensating CREDIT entry.
      const entryId = await appendMcpEntry({
        mcpAccountId: accountId,
        sequence: 2,
        entryType: 'REFUND',
        direction: 'CREDIT',
        amount: '10.0000000000',
        balanceDelta: '10.0000000000',
        availableDelta: '10.0000000000',
        sourceType: 'refund',
        effectiveAt: new Date(),
      });
      await database.db.insert(mcpRefundRequests).values({
        mcpAccountId: accountId,
        marketId: marketA,
        requestedByAccountId: merchant.merchantAccountId,
        amount: '10.0000000000',
        status: 'APPROVED',
        reason: 'Approved refund fixture.',
        idempotencyKey: `rik-${randomUUID()}`,
        payloadHash: '3'.repeat(64),
        reviewedByAdminUserId: adminId,
        reviewReason: 'Approved.',
        ledgerEntryId: entryId,
      });
      // Broken approved refund with no compensating entry.
      await database.db.insert(mcpRefundRequests).values({
        mcpAccountId: accountId,
        marketId: marketA,
        requestedByAccountId: merchant.merchantAccountId,
        amount: '20.0000000000',
        status: 'APPROVED',
        reason: 'Approved refund without ledger credit.',
        idempotencyKey: `rik-${randomUUID()}`,
        payloadHash: '4'.repeat(64),
        reviewedByAdminUserId: adminId,
        reviewReason: 'Approved.',
      });
      const { body } = await runFixture('REFUND', admin.token);
      expect(body.matched_count).toBe(1);
      expect(body.mismatched_count).toBe(1);
      const list = await supertest(server)
        .get(`${base(marketA)}/exceptions`)
        .set(bearer(admin.token))
        .expect(200);
      const exception = (
        list.body as { items: Array<Record<string, unknown>> }
      ).items.find((item) => item['reference_type'] === 'mcp_refund');
      expect(exception?.['classification']).toBe('MISSING_EXPECTED');
      expect(exception?.['expected_amount']).toBe('20.0000000000');
      expect(exception?.['actual_amount']).toBe('0.0000000000');
    });

    it('detects redemption orders missing wallet debits or voucher codes', async () => {
      const member = await createMember(marketA);
      const walletId = await createWallet(marketA, member.memberId);
      const itemRows = await database.db
        .insert(redemptionCatalogItems)
        .values({
          marketId: marketA,
          sku: `SKU-${randomUUID()}`,
          name: 'Voucher pack',
          itemType: 'DIGITAL_VOUCHER',
          ownership: 'PLATFORM_OWNED',
          status: 'ACTIVE',
          fiatReferenceValue: '10.0000000000',
          fiatCurrency: 'MYR',
          fulfilmentMode: 'DIGITAL',
          inventoryMode: 'UNLIMITED',
          createdBy: adminId,
        })
        .returning({ id: redemptionCatalogItems.id });
      const itemId = String(itemRows[0]?.id ?? '');
      const rateRows = await database.db
        .insert(redemptionRateVersions)
        .values({
          marketId: marketA,
          rateType: 'POINTS_PER_CURRENCY',
          rateValue: '1.0000000000',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          createdBy: adminId,
          reason: 'P8-S2 fixture rate.',
        })
        .returning({ id: redemptionRateVersions.id });
      const rateVersionId = String(rateRows[0]?.id ?? '');
      const baseOrder = {
        marketId: marketA,
        memberId: member.memberId,
        itemId,
        walletAccountId: walletId,
        rateVersionId,
        rateValue: '1.0000000000',
        status: 'CONFIRMED',
        unroundedPointCost: '30.0000000000',
        postedPointCost: '30.0000000000',
        totalPoints: '30.0000000000',
        quantity: '1',
        roundingMode: 'HALF_UP',
        itemSnapshot: { name: 'Voucher pack' },
        rateSnapshot: { rateValue: '1' },
        confirmedAt: new Date(),
      };
      // Matched order: wallet debit + one voucher code.
      const debitEntryId = await appendWalletEntry({
        walletAccountId: walletId,
        memberId: member.memberId,
        marketId: marketA,
        entrySequence: 1,
        entryType: 'REDEMPTION_DEBIT',
        amount: '30.0000000000',
        balanceBefore: '50.0000000000',
        balanceAfter: '20.0000000000',
        referenceType: 'redemption',
        referenceId: 'order-matched',
      });
      const orderRows = await database.db
        .insert(redemptionOrders)
        .values({
          ...baseOrder,
          orderReference: `ORD-${randomUUID()}`,
          walletEntryId: debitEntryId,
        })
        .returning({ id: redemptionOrders.id });
      await database.db.insert(redemptionVoucherCodes).values({
        orderId: String(orderRows[0]?.id ?? ''),
        catalogItemId: itemId,
        marketId: marketA,
        codeHash: 'a'.repeat(64),
        codeEncrypted: 'encrypted-voucher',
      });
      // Broken order: no wallet debit, no voucher codes.
      await database.db.insert(redemptionOrders).values({
        ...baseOrder,
        orderReference: `ORD-${randomUUID()}`,
        walletEntryId: null,
      });
      const { body } = await runFixture('REDEMPTION', admin.token);
      expect(body.matched_count).toBe(2);
      expect(body.mismatched_count).toBe(2);
      const list = await supertest(server)
        .get(`${base(marketA)}/exceptions`)
        .set(bearer(admin.token))
        .expect(200);
      const items = (list.body as { items: Array<Record<string, unknown>> })
        .items;
      const missingDebit = items.find(
        (item) => item['reference_type'] === 'redemption_order_debit',
      );
      expect(missingDebit?.['classification']).toBe('MISSING_EXPECTED');
      const missingVouchers = items.find(
        (item) => item['reference_type'] === 'redemption_order_vouchers',
      );
      expect(missingVouchers?.['classification']).toBe('MISSING_EXPECTED');
      expect(missingVouchers?.['expected_amount']).toBe('1.0000000000');
      expect(missingVouchers?.['actual_amount']).toBe('0.0000000000');
    });

    it('walks the exception lifecycle with immutable audit and notes', async () => {
      const merchant = await createMerchant(marketA);
      const accountId = await createMcpAccount(
        marketA,
        merchant.branchId,
        '80.0000000000',
        '80.0000000000',
      );
      await appendMcpEntry({
        mcpAccountId: accountId,
        sequence: 1,
        entryType: 'RECHARGE',
        direction: 'CREDIT',
        amount: '100.0000000000',
        balanceDelta: '100.0000000000',
        availableDelta: '100.0000000000',
        sourceType: 'recharge',
        effectiveAt: new Date(),
      });
      const { runId } = await runFixture('MCP', admin.token);
      const list = await supertest(server)
        .get(`${base(marketA)}/exceptions`)
        .set(bearer(admin.token))
        .expect(200);
      const exception = (
        list.body as { items: Array<Record<string, unknown>> }
      ).items.find((item) => item['reference_type'] === 'mcp_account_total');
      expect(exception).toBeTruthy();
      const exceptionId =
        (exception as { id?: string } | undefined)?.['id'] ?? '';

      // Strict chain: OPEN -> ACKNOWLEDGED -> RESOLVED -> CLOSED.
      // OPEN -> RESOLVED is not allowed (must acknowledge first).
      await supertest(server)
        .post(`${base(marketA)}/exceptions/${exceptionId}/resolve`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: 1, reason: 'Skip acknowledge.' })
        .expect(409);
      const acknowledged = await supertest(server)
        .post(`${base(marketA)}/exceptions/${exceptionId}/acknowledge`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: 1, reason: 'Acknowledged for review.' })
        .expect(200);
      expect((acknowledged.body as { status: string }).status).toBe(
        'ACKNOWLEDGED',
      );
      // Stale version is rejected.
      await supertest(server)
        .post(`${base(marketA)}/exceptions/${exceptionId}/acknowledge`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: 1, reason: 'Stale retry.' })
        .expect(409);
      // Investigation notes are appended and audited.
      const noted = await supertest(server)
        .post(`${base(marketA)}/exceptions/${exceptionId}/notes`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          expectedVersion: 2,
          notes: 'Cross-checked against merchant records.',
          reason: 'Investigation note.',
        })
        .expect(200);
      expect(
        String(
          (noted.body as { investigation_notes: string }).investigation_notes,
        ).includes('Cross-checked against merchant records.'),
      ).toBe(true);
      const resolved = await supertest(server)
        .post(`${base(marketA)}/exceptions/${exceptionId}/resolve`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: 3, reason: 'Root cause confirmed.' })
        .expect(200);
      expect((resolved.body as { status: string }).status).toBe('RESOLVED');
      const closed = await supertest(server)
        .post(`${base(marketA)}/exceptions/${exceptionId}/close`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: 4, reason: 'Closed after review.' })
        .expect(200);
      expect((closed.body as { status: string }).status).toBe('CLOSED');
      // CLOSED exceptions reject further notes.
      await supertest(server)
        .post(`${base(marketA)}/exceptions/${exceptionId}/notes`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          expectedVersion: 5,
          notes: 'Too late.',
          reason: 'Should be rejected.',
        })
        .expect(409);
      const audit = await database.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, exceptionId));
      const actions = audit.map((row) => row.action);
      expect(actions).toContain('reconciliation.exception.acknowledged');
      expect(actions).toContain('reconciliation.exception.resolved');
      expect(actions).toContain('reconciliation.exception.closed');
      expect(actions).toContain('reconciliation.exception.notes');
      expect(audit[0]?.reason).toBeTruthy();
      expect(String(runId).length).toBeGreaterThan(0);
    });

    it('isolates runs and exceptions by market', async () => {
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
        amount: '50.0000000000',
        balanceDelta: '50.0000000000',
        availableDelta: '50.0000000000',
        sourceType: 'recharge',
        effectiveAt: new Date(),
      });
      await selectMarket(admin.accountId, marketB);
      const created = await supertest(server)
        .post(`${base(marketB)}/runs`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ kind: 'MCP', ...WINDOW, reason: 'Market B run.' })
        .expect(201);
      const runBId = String((created.body as { id: string }).id);
      await supertest(server)
        .post(`${base(marketB)}/runs/${runBId}/execute`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      // Market A runs never see market B accounts.
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
      // A foreign-market run detail is 403.
      await supertest(server)
        .get(`${base(marketA)}/runs/${runBId}`)
        .set(bearer(admin.token))
        .expect(403);
      // Market B fixture accounts are clean: its run has no exceptions.
      const detailB = await database.pool.query(
        'SELECT exception_count FROM reconciliation_runs WHERE id = $1',
        [runBId],
      );
      expect(detailB.rows[0]?.['exception_count']).toBe(0);
    });

    it('cancels a PENDING run with reason and audit', async () => {
      const created = await supertest(server)
        .post(`${base(marketA)}/runs`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ kind: 'MCP', ...WINDOW, reason: 'Cancellation target.' })
        .expect(201);
      const runId = String((created.body as { id: string }).id);
      const cancelled = await supertest(server)
        .post(`${base(marketA)}/runs/${runId}/cancel`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: 1, reason: 'Out of scope.' })
        .expect(200);
      expect((cancelled.body as { status: string }).status).toBe('CANCELLED');
      // COMPLETED runs cannot be cancelled.
      const other = await supertest(server)
        .post(`${base(marketA)}/runs`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ kind: 'MCP', ...WINDOW, reason: 'Already complete.' })
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

    it('never writes to frozen financial tables and never auto-corrects', async () => {
      // Self-contained: create a clean fixture, snapshot the frozen tables,
      // execute runs of all six kinds, and assert the frozen tables are
      // byte-identical afterwards.
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
        amount: '100.0000000000',
        balanceDelta: '100.0000000000',
        availableDelta: '100.0000000000',
        sourceType: 'recharge',
        effectiveAt: new Date(),
      });
      const before = await snapshotFrozenTables();
      for (const kind of [
        'MCP',
        'IPOINT',
        'TRANSACTION_LEDGER',
        'COMMISSION',
        'REFUND',
        'REDEMPTION',
      ]) {
        const { body } = await runFixture(kind, admin.token);
        expect(body.status).toBe('COMPLETED');
      }
      const after = await snapshotFrozenTables();
      expect(after).toBe(before);
      // Exceptions are never auto-resolved: every non-matched run leaves its
      // exceptions OPEN until an administrator acts on them. The only row
      // moved out of OPEN is the one the lifecycle test explicitly closed.
      const nonOpen = await database.pool.query(
        `SELECT count(*)::int AS count FROM reconciliation_exceptions
          WHERE status <> 'OPEN'`,
      );
      expect(Number(nonOpen.rows[0]?.['count'] ?? 0)).toBe(1);
    });
  },
);
