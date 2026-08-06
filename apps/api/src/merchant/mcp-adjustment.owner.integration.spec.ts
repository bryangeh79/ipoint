import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import {
  accounts,
  adminUsers,
  auditLogs,
  mcpAccounts,
  mcpAdjustmentDecisions,
  mcpAdjustmentMarketRules,
  mcpAdjustmentReasonCodes,
  mcpAdjustmentRequests,
  mcpLedgerEntries,
  marketAccess,
  markets,
  merchantBranches,
  merchantGroups,
  migrate,
  permissions,
  roleAssignments,
  rolePermissions,
  roles,
  sessions,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { and, eq, isNull } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';
import type { InMemoryRateLimiter } from '../auth/rate-limit.port.js';
import { AUTH_RATE_LIMITER } from '../auth/auth.constants.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import { McpAdjustmentOwnerService } from './mcp-adjustment.owner.service.js';
import { canonicalHash } from './mcp-adjustment.owner.service.js';
import type {
  CreateMcpAdjustmentCommand,
  McpAdjustmentOwnerActor,
} from './mcp-adjustment.owner.types.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'S7a-Owner-Password-123!';

describe.skipIf(!databaseUrl)(
  'P7-S7A Manual MCP Adjustment owner integration (real PostgreSQL)',
  () => {
    let app: INestApplication;
    let auth: AuthService;
    let database: DatabaseService;
    let owner: McpAdjustmentOwnerService;
    let rateLimiter: InMemoryRateLimiter;
    let marketId: string; // MY, MYR, Asia/Kuala_Lumpur (Malaysia baseline)
    let marketZZId: string; // no caps rule -> blocked
    let mcpAccountId: string;
    let superAdmin: { adminUserId: string; accountId: string };
    let financeApprover: { adminUserId: string; accountId: string };
    let financeOperator: { adminUserId: string; accountId: string };

    const ADMIN_TEMPLATE_ROLE_CODES = [
      'SUPER_ADMIN',
      'OPERATIONS_ADMIN',
      'FINANCE_OPERATOR',
      'FINANCE_APPROVER',
      'KYC_REVIEWER',
      'SUPPORT_READONLY_AUDITOR',
    ] as const;

    function actorOf(
      admin: { adminUserId: string },
      overrides: Partial<McpAdjustmentOwnerActor> = {},
    ): McpAdjustmentOwnerActor {
      return {
        adminUserId: admin.adminUserId,
        ipAddress: '127.0.0.1',
        requestId: `req-${randomUUID()}`,
        currentMarketId: marketId,
        marketContextVersion: 2,
        ...overrides,
      };
    }

    /** Trim numeric(38,10) trailing zeros for exact string assertions. */
    function normalizeDecimal(value: string): string {
      const trimmed = value.trim();
      if (!trimmed.includes('.')) return trimmed;
      const [wholeRaw, fraction] = trimmed.split('.');
      const whole = wholeRaw ?? '';
      const significant = (fraction ?? '').replace(/0+$/u, '');
      return significant === '' ? whole : `${whole}.${significant}`;
    }

    async function ensureActiveMarket(
      code: string,
      currencyCode: string,
      timezone: string,
    ): Promise<string> {
      const existing = await database.db
        .select({ id: markets.id })
        .from(markets)
        .where(eq(markets.code, code))
        .limit(1);
      if (existing[0]) {
        await database.db
          .update(markets)
          .set({ status: 'ACTIVE' })
          .where(eq(markets.id, existing[0].id));
        return existing[0].id;
      }
      const inserted = await database.db
        .insert(markets)
        .values({
          code,
          name: `${code} S7A Test Market`,
          status: 'ACTIVE',
          currencyCode,
          timezone,
          defaultLocale: 'en-MY',
        })
        .returning({ id: markets.id });
      return inserted[0]?.id ?? '';
    }

    async function createAccount(): Promise<{ accountId: string }> {
      const inserted = await database.db
        .insert(accounts)
        .values({
          publicId: `acct_${randomUUID()}`,
          email: `${randomUUID()}@example.com`,
          accountCountry: 'MY',
          status: 'ACTIVE',
        })
        .returning({ id: accounts.id });
      const accountId = inserted[0]?.id ?? '';
      await auth.setPassword(accountId, password);
      return { accountId };
    }

    async function ensurePermissions(
      codes: readonly string[],
    ): Promise<string[]> {
      await database.db
        .insert(permissions)
        .values(
          codes.map((code) => ({
            code,
            description: `${code} s7a integration test permission`,
          })),
        )
        .onConflictDoNothing({ target: permissions.code });
      const rows = await database.db.select().from(permissions);
      return rows
        .filter((row) => codes.includes(row.code))
        .map((row) => row.id);
    }

    async function createAdmin(options: {
      roleCode: (typeof ADMIN_TEMPLATE_ROLE_CODES)[number];
      permissionCodes: readonly string[];
      marketIds: string[];
    }): Promise<{ adminUserId: string; accountId: string }> {
      const account = await createAccount();
      const inserted = await database.db
        .insert(adminUsers)
        .values({
          accountId: account.accountId,
          displayName: `S7A Admin ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserId = inserted[0]?.id ?? '';
      const roleRows = await database.db
        .insert(roles)
        .values({
          code: options.roleCode,
          name: `S7A Test Role (${options.roleCode})`,
          isSystem: false,
        })
        .onConflictDoNothing({ target: roles.code })
        .returning({ id: roles.id });
      let roleId = roleRows[0]?.id ?? '';
      if (!roleId) {
        const existing = await database.db
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.code, options.roleCode))
          .limit(1);
        roleId = existing[0]?.id ?? '';
      }
      await database.db.insert(roleAssignments).values({ adminUserId, roleId });
      const permissionIds = await ensurePermissions(options.permissionCodes);
      await database.db
        .delete(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId));
      if (permissionIds.length > 0) {
        await database.db
          .insert(rolePermissions)
          .values(
            permissionIds.map((permissionId) => ({ roleId, permissionId })),
          )
          .onConflictDoNothing();
      }
      if (options.marketIds.length > 0) {
        await database.db
          .insert(marketAccess)
          .values(
            options.marketIds.map((marketId) => ({ adminUserId, marketId })),
          );
      }
      return { adminUserId, accountId: account.accountId };
    }

    async function createMerchantAndMcpAccount(
      marketOverride?: string,
    ): Promise<string> {
      const account = await createAccount();
      const groupRows = await database.db
        .insert(merchantGroups)
        .values({
          accountId: account.accountId,
          marketId: marketOverride ?? marketId,
          name: `S7A Group ${randomUUID()}`,
        })
        .returning({ id: merchantGroups.id });
      const groupId = groupRows[0]?.id ?? '';
      const branchRows = await database.db
        .insert(merchantBranches)
        .values({
          merchantGroupId: groupId,
          merchantId: `m_${randomUUID()}`,
          marketId: marketOverride ?? marketId,
          name: `S7A Branch ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: merchantBranches.id });
      const branchId = branchRows[0]?.id ?? '';
      const accountRows = await database.db
        .insert(mcpAccounts)
        .values({
          merchantBranchId: branchId,
          marketId: marketOverride ?? marketId,
          availableBalance: '5000',
          totalBalance: '5000',
          status: 'ACTIVE',
          version: 1,
        })
        .returning({ id: mcpAccounts.id });
      return accountRows[0]?.id ?? '';
    }

    function createCommand(
      overrides: Partial<CreateMcpAdjustmentCommand> = {},
    ): CreateMcpAdjustmentCommand {
      return {
        mcpAccountId,
        entryType: 'MANUAL_CREDIT',
        amount: '100',
        reasonCode: 'OPERATIONAL_CORRECTION',
        explanation: 'Integration test correction',
        caseReference: `CASE-${randomUUID()}`,
        idempotencyKey: randomUUID(),
        ...overrides,
      };
    }

    async function accountBalance(): Promise<string> {
      const rows = await database.db
        .select({ availableBalance: mcpAccounts.availableBalance })
        .from(mcpAccounts)
        .where(eq(mcpAccounts.id, mcpAccountId))
        .limit(1);
      return rows[0]?.availableBalance ?? 'MISSING';
    }

    async function ledgerEntryCount(): Promise<number> {
      const rows = await database.db
        .select({ id: mcpLedgerEntries.id })
        .from(mcpLedgerEntries)
        .where(eq(mcpLedgerEntries.mcpAccountId, mcpAccountId));
      return rows.length;
    }

    async function requestRow(requestId: string) {
      const rows = await database.db
        .select()
        .from(mcpAdjustmentRequests)
        .where(eq(mcpAdjustmentRequests.id, requestId))
        .limit(1);
      return rows[0];
    }

    async function auditActions(requestId: string): Promise<string[]> {
      const rows = await database.db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, 'MCP_ADJUSTMENT_REQUEST'),
            eq(auditLogs.entityId, requestId),
          ),
        );
      return rows.map((row) => row.action);
    }

    beforeAll(async () => {
      const dbName = new URL(databaseUrl ?? '').pathname.replace(/^\//u, '');
      const maintenanceUrl = (databaseUrl ?? '').replace(
        /\/[^/]+$/u,
        '/postgres',
      );
      const admin = new Pool({ connectionString: maintenanceUrl });
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${dbName}"`);
      await admin.end();

      vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
      vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
      vi.stubEnv(
        'AUTH_OTP_PEPPER',
        's7a-owner-pepper-at-least-32-characters',
      );
      vi.stubEnv(
        'REDEMPTION_VOUCHER_ENCRYPTION_KEY',
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      );
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('LOG_LEVEL', 'silent');
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleFixture.createNestApplication();
      configureApplication(app, {
        enableShutdownHooks: false,
        scanSwaggerRoutes: false,
      });
      await app.init();
      auth = app.get(AuthService);
      database = app.get(DatabaseService);
      owner = app.get(McpAdjustmentOwnerService);
      rateLimiter = app.get<InMemoryRateLimiter>(AUTH_RATE_LIMITER);
      await migrate(database.pool);
      await seedFoundation(database.db);

      marketId = await ensureActiveMarket('MY', 'MYR', 'Asia/Kuala_Lumpur');
      marketZZId = await ensureActiveMarket('ZZ', 'USD', 'Asia/Singapore');

      const makerPerms = [
        'merchant.mcp.adjust',
        'merchant.mcp.adjust.approve',
        'merchant.mcp.adjust.execute',
        'merchant.mcp.view',
      ] as const;
      superAdmin = await createAdmin({
        roleCode: 'SUPER_ADMIN',
        permissionCodes: [...makerPerms],
        marketIds: [marketId],
      });
      financeApprover = await createAdmin({
        roleCode: 'FINANCE_APPROVER',
        permissionCodes: [
          'merchant.mcp.adjust.approve',
          'merchant.mcp.adjust.execute',
          'merchant.mcp.view',
        ],
        marketIds: [marketId],
      });
      financeOperator = await createAdmin({
        roleCode: 'FINANCE_OPERATOR',
        permissionCodes: ['merchant.mcp.adjust', 'merchant.mcp.view'],
        marketIds: [marketId],
      });

      mcpAccountId = await createMerchantAndMcpAccount();
    });

    afterAll(async () => {
      (
        rateLimiter as unknown as { buckets?: Map<string, unknown> }
      ).buckets?.clear();
      await app?.close();
    });

    beforeEach(() => {
      (
        rateLimiter as unknown as { buckets?: Map<string, unknown> }
      ).buckets?.clear();
    });

    describe('full credit lifecycle: create -> submit -> approve -> execute', () => {
      it('executes an approved credit and projects the exact ledger effect', async () => {
        const maker = actorOf(financeOperator);
        const created = await owner.create(
          maker,
          createCommand({ amount: '100' }),
        );
        expect(created.state).toBe('DRAFT');
        expect(created.makerAdminUserId).toBe(financeOperator.adminUserId);
        expect(created.checkerAdminUserId).toBeNull();
        expect(created.reasonCode).toBe('OPERATIONAL_CORRECTION');
        expect(created.caseReference).not.toBe('');
        expect(created.attachmentReference).toBeNull();

        const submitted = await owner.submit(maker, { requestId: created.id });
        expect(submitted.state).toBe('SUBMITTED');
        expect(submitted.submittedAt).not.toBeNull();

        const checker = actorOf(financeApprover);
        const approved = await owner.decide(checker, created.id, {
          decision: 'APPROVED',
          reason: 'Approved by integration test',
          requireAttachment: false,
        });
        expect(approved.state).toBe('APPROVED');
        expect(approved.checkerAdminUserId).toBe(financeApprover.adminUserId);

        const executed = await owner.execute(checker, { requestId: created.id });
        expect(executed.state).toBe('EXECUTED');
        expect(executed.executedAt).not.toBeNull();
        expect(executed.ledgerEntryId).not.toBeNull();

        expect(normalizeDecimal(await accountBalance())).toBe('5100');
        expect(await ledgerEntryCount()).toBe(1);

        const entry = (
          await database.db
            .select()
            .from(mcpLedgerEntries)
            .where(eq(mcpLedgerEntries.mcpAccountId, mcpAccountId))
        )[0];
        expect(entry?.entryType).toBe('MANUAL_CREDIT');
        expect(entry?.direction).toBe('CREDIT');
        expect(normalizeDecimal(entry?.amount ?? '')).toBe('100');
        expect(normalizeDecimal(entry?.balanceDelta ?? '')).toBe('100');
        expect(normalizeDecimal(entry?.availableDelta ?? '')).toBe('100');
        expect(entry?.sourceType).toBe('MCP_ADJUSTMENT');
        expect(entry?.sourceId).toBe(executed.id);

        const decisionRows = await database.db
          .select()
          .from(mcpAdjustmentDecisions)
          .where(
            eq(mcpAdjustmentDecisions.adjustmentRequestId, created.id),
          );
        expect(decisionRows).toHaveLength(1);
        expect(decisionRows[0]?.decision).toBe('APPROVED');
        expect(decisionRows[0]?.checkerAdminUserId).toBe(
          financeApprover.adminUserId,
        );

        const actions = await auditActions(created.id);
        expect(actions).toEqual(
          expect.arrayContaining([
            'MCP_ADJUSTMENT_CREATED',
            'MCP_ADJUSTMENT_SUBMITTED',
            'MCP_ADJUSTMENT_APPROVED',
            'MCP_ADJUSTMENT_EXECUTED',
          ]),
        );
      });

      it('executes a debit and rejects an insufficient debit (FAILED, no ledger)', async () => {
        const maker = actorOf(financeOperator);
        const created = await owner.create(
          maker,
          createCommand({ entryType: 'MANUAL_DEBIT', amount: '50' }),
        );
        await owner.submit(maker, { requestId: created.id });
        const checker = actorOf(financeApprover);
        await owner.decide(checker, created.id, {
          decision: 'APPROVED',
          reason: 'Exact-opposite debit',
          requireAttachment: false,
        });
        const executed = await owner.execute(checker, { requestId: created.id });
        expect(executed.state).toBe('EXECUTED');
        expect(normalizeDecimal(await accountBalance())).toBe('5050');

        // Insufficient debit -> execution attempt fails -> FAILED, no ledger.
        const wallet = (
          await database.db
            .select({ availableBalance: mcpAccounts.availableBalance })
            .from(mcpAccounts)
            .where(eq(mcpAccounts.id, mcpAccountId))
            .limit(1)
        )[0];
        const huge = await owner.create(
          maker,
          createCommand({
            entryType: 'MANUAL_DEBIT',
            amount: String(Number(wallet?.availableBalance ?? 0) + 1),
          }),
        );
        await owner.submit(maker, { requestId: huge.id });
        await owner.decide(checker, huge.id, {
          decision: 'APPROVED',
          reason: 'Will fail on balance',
          requireAttachment: false,
        });
        const failed = await owner.execute(checker, { requestId: huge.id });
        expect(failed.state).toBe('FAILED');
        expect(failed.failedAt).not.toBeNull();
        expect(normalizeDecimal(await accountBalance())).toBe('5050');
        expect(await ledgerEntryCount()).toBe(2); // only the two successes
        const actions = await auditActions(huge.id);
        expect(actions).toContain('MCP_ADJUSTMENT_EXECUTE_FAILED');
      });

      it('rejects a retry after FAILED without a duplicate ledger effect', async () => {
        const maker = actorOf(financeOperator);
        const created = await owner.create(
          maker,
          createCommand({ entryType: 'MANUAL_DEBIT', amount: '6000' }),
        );
        await owner.submit(maker, { requestId: created.id });
        const checker = actorOf(financeApprover);
        await owner.decide(checker, created.id, {
          decision: 'APPROVED',
          reason: 'Will fail on balance',
          requireAttachment: false,
        });
        const failed = await owner.execute(checker, { requestId: created.id });
        expect(failed.state).toBe('FAILED');
        const before = await ledgerEntryCount();
        const replay = await owner.execute(checker, { requestId: created.id });
        expect(replay.state).toBe('FAILED');
        expect(await ledgerEntryCount()).toBe(before);
      });
    });

    describe('Maker/Checker inequality (runtime, every amount)', () => {
      it('denies the maker as checker, including Super Admin acting alone', async () => {
        const created = await owner.create(
          actorOf(superAdmin),
          createCommand({ amount: '500' }),
        );
        await owner.submit(actorOf(superAdmin), { requestId: created.id });
        await expect(
          owner.decide(actorOf(superAdmin), created.id, {
            decision: 'APPROVED',
            reason: 'Same person',
            requireAttachment: false,
          }),
        ).rejects.toMatchObject({
          code: 'MCP_ADJUSTMENT_MAKER_CHECKER_CONFLICT',
        });
        // A different Super Admin approves; then the maker may not execute.
        const secondSuperAdmin = await createAdmin({
          roleCode: 'SUPER_ADMIN',
          permissionCodes: [
            'merchant.mcp.adjust',
            'merchant.mcp.adjust.approve',
            'merchant.mcp.adjust.execute',
          ],
          marketIds: [marketId],
        });
        const approved = await owner.decide(
          actorOf(secondSuperAdmin),
          created.id,
          {
            decision: 'APPROVED',
            reason: 'Second distinct Super Admin',
            requireAttachment: false,
          },
        );
        expect(approved.state).toBe('APPROVED');
        await expect(
          owner.execute(actorOf(superAdmin), { requestId: created.id }),
        ).rejects.toMatchObject({
          code: 'MCP_ADJUSTMENT_MAKER_CHECKER_CONFLICT',
        });
        const executed = await owner.execute(actorOf(secondSuperAdmin), {
          requestId: created.id,
        });
        expect(executed.state).toBe('EXECUTED');
      });

      it('denies a maker submit by anyone but the maker', async () => {
        const created = await owner.create(
          actorOf(financeOperator),
          createCommand({ amount: '10' }),
        );
        await expect(
          owner.submit(actorOf(superAdmin), { requestId: created.id }),
        ).rejects.toMatchObject({ code: 'MCP_ADJUSTMENT_MAKER_REQUIRED' });
      });
    });

    describe('caps routing (P7-OD-10 Malaysia 10,000 / 100,000)', () => {
      it('lets a Finance Approver check at/below the soft cap (10,000)', async () => {
        const created = await owner.create(
          actorOf(financeOperator),
          createCommand({ amount: '10000' }),
        );
        await owner.submit(actorOf(financeOperator), { requestId: created.id });
        const approved = await owner.decide(
          actorOf(financeApprover),
          created.id,
          {
            decision: 'APPROVED',
            reason: 'At soft cap, Finance Approver may check',
            requireAttachment: false,
          },
        );
        expect(approved.state).toBe('APPROVED');
      });

      it('requires a Super Admin checker above the soft cap', async () => {
        const created = await owner.create(
          actorOf(financeOperator),
          createCommand({ amount: '10001', attachmentReference: 'att-1' }),
        );
        await owner.submit(actorOf(financeOperator), { requestId: created.id });
        await expect(
          owner.decide(actorOf(financeApprover), created.id, {
            decision: 'APPROVED',
            reason: 'Finance Approver must not clear above soft cap',
            requireAttachment: false,
          }),
        ).rejects.toMatchObject({
          code: 'MCP_ADJUSTMENT_CHECKER_ROUTING_DENIED',
        });
        const approved = await owner.decide(actorOf(superAdmin), created.id, {
          decision: 'APPROVED',
          reason: 'Super Admin clears above soft cap',
          requireAttachment: false,
        });
        expect(approved.state).toBe('APPROVED');
      });

      it('rejects an amount above the hard cap at create', async () => {
        await expect(
          owner.create(
            actorOf(financeOperator),
            createCommand({ amount: '100000.01' }),
          ),
        ).rejects.toMatchObject({ code: 'MCP_ADJUSTMENT_ABOVE_HARD_CAP' });
      });

      it('blocks execution above the soft cap until secure evidence storage is enabled', async () => {
        const created = await owner.create(
          actorOf(financeOperator),
          createCommand({
            amount: '15000',
            attachmentReference: 'att-15000',
          }),
        );
        await owner.submit(actorOf(financeOperator), { requestId: created.id });
        await owner.decide(actorOf(superAdmin), created.id, {
          decision: 'APPROVED',
          reason: 'Super Admin clears above soft cap',
          requireAttachment: false,
        });
        // secure_evidence_available defaults to false -> execution disabled.
        await expect(
          owner.execute(actorOf(superAdmin), { requestId: created.id }),
        ).rejects.toMatchObject({
          code: 'MCP_ADJUSTMENT_EVIDENCE_STORAGE_UNAVAILABLE',
        });
        const stillApproved = await requestRow(created.id);
        expect(stillApproved?.status).toBe('APPROVED');
        // Enable secure evidence for MY and retry the same approved request.
        await database.db
          .update(mcpAdjustmentMarketRules)
          .set({ secureEvidenceAvailable: true })
          .where(eq(mcpAdjustmentMarketRules.marketCode, 'MY'));
        const executed = await owner.execute(actorOf(superAdmin), {
          requestId: created.id,
        });
        expect(executed.state).toBe('EXECUTED');
        // Restore the disabled default for the remaining suites.
        await database.db
          .update(mcpAdjustmentMarketRules)
          .set({ secureEvidenceAvailable: false })
          .where(eq(mcpAdjustmentMarketRules.marketCode, 'MY'));
      });
    });

    describe('evidence and attachment rules (P7-OD-11)', () => {
      it('requires an attachment above the soft cap at create', async () => {
        await expect(
          owner.create(
            actorOf(financeOperator),
            createCommand({ amount: '12000' }),
          ),
        ).rejects.toMatchObject({
          code: 'MCP_ADJUSTMENT_ATTACHMENT_REQUIRED',
        });
      });

      it('requires an attachment for a high-risk reason code', async () => {
        await expect(
          owner.create(
            actorOf(financeOperator),
            createCommand({ reasonCode: 'FRAUD_RECOVERY' }),
          ),
        ).rejects.toMatchObject({
          code: 'MCP_ADJUSTMENT_ATTACHMENT_REQUIRED',
        });
        const created = await owner.create(
          actorOf(financeOperator),
          createCommand({
            reasonCode: 'FRAUD_RECOVERY',
            attachmentReference: 'opaque-ref-fraud',
          }),
        );
        expect(created.attachmentReference).toBe('opaque-ref-fraud');
      });

      it('cannot approve when the checker explicitly requests an attachment', async () => {
        const created = await owner.create(
          actorOf(financeOperator),
          createCommand({ amount: '5' }),
        );
        await owner.submit(actorOf(financeOperator), { requestId: created.id });
        await expect(
          owner.decide(actorOf(financeApprover), created.id, {
            decision: 'APPROVED',
            reason: 'I need the attachment first',
            requireAttachment: true,
          }),
        ).rejects.toMatchObject({
          code: 'MCP_ADJUSTMENT_ATTACHMENT_REQUIRED',
        });
      });
    });

    describe('rejected requests: immutable + replacement linkage (P7-OD-18)', () => {
      it('rejects immutably and links a replacement via priorRequestId', async () => {
        const maker = actorOf(financeOperator);
        const originalKey = randomUUID();
        const originalCommand = createCommand({
          amount: '25',
          idempotencyKey: originalKey,
        });
        const created = await owner.create(maker, originalCommand);
        await owner.submit(maker, { requestId: created.id });
        const checker = actorOf(financeApprover);
        const rejected = await owner.decide(checker, created.id, {
          decision: 'REJECTED',
          reason: 'Evidence insufficient',
          requireAttachment: false,
        });
        expect(rejected.state).toBe('REJECTED');
        expect(rejected.checkerAdminUserId).toBe(financeApprover.adminUserId);

        // Immutable: cannot resubmit or re-decide a rejected request.
        await expect(
          owner.submit(maker, { requestId: created.id }),
        ).rejects.toMatchObject({ code: 'MCP_ADJUSTMENT_STATE_CONFLICT' });
        await expect(
          owner.decide(checker, created.id, {
            decision: 'APPROVED',
            reason: 'Too late',
            requireAttachment: false,
          }),
        ).rejects.toMatchObject({ code: 'MCP_ADJUSTMENT_STATE_CONFLICT' });

        // Replaying the ORIGINAL key + payload returns the immutable
        // rejected request (idempotent replay, no new record).
        const replay = await owner.create(maker, { ...originalCommand });
        expect(replay.id).toBe(created.id);
        expect(replay.state).toBe('REJECTED');

        // Re-using the original key with a DIFFERENT payload is a 409.
        await expect(
          owner.create(
            maker,
            createCommand({
              amount: '25',
              idempotencyKey: originalKey,
              priorRequestId: created.id,
            }),
          ),
        ).rejects.toMatchObject({
          code: 'MCP_ADJUSTMENT_IDEMPOTENCY_CONFLICT',
        });

        // Replacement: NEW request + NEW idempotency key + explicit linkage.
        const replacement = await owner.create(
          maker,
          createCommand({
            amount: '25',
            attachmentReference: 'opaque-attachment-2',
            priorRequestId: created.id,
            idempotencyKey: randomUUID(),
          }),
        );
        expect(replacement.priorRequestId).toBe(created.id);
        await owner.submit(maker, { requestId: replacement.id });
        await owner.decide(checker, replacement.id, {
          decision: 'APPROVED',
          reason: 'Attachment supplied',
          requireAttachment: false,
        });
        await owner.execute(checker, { requestId: replacement.id });
        expect((await requestRow(replacement.id))?.status).toBe('EXECUTED');
      });
    });

    describe('idempotency and payload-hash protection', () => {
      it('replays the same key + payload and conflicts on a different payload', async () => {
        const maker = actorOf(financeOperator);
        const key = randomUUID();
        const command = createCommand({ amount: '7', idempotencyKey: key });
        const first = await owner.create(maker, command);
        const replay = await owner.create(maker, { ...command });
        expect(replay.id).toBe(first.id);
        await expect(
          owner.create(
            maker,
            createCommand({ amount: '8', idempotencyKey: key }),
          ),
        ).rejects.toMatchObject({
          code: 'MCP_ADJUSTMENT_IDEMPOTENCY_CONFLICT',
        });
      });
    });

    describe('market guards and no-fallback blocking', () => {
      it('blocks a market with no caps rule (no fallback)', async () => {
        // An MCP account in a market with no mcp_adjustment_market_rules row.
        const zzAccount = await createMerchantAndMcpAccount(marketZZId);
        const adminWithZZ = await createAdmin({
          roleCode: 'SUPER_ADMIN',
          permissionCodes: [
            'merchant.mcp.adjust',
            'merchant.mcp.adjust.approve',
            'merchant.mcp.adjust.execute',
          ],
          marketIds: [marketId, marketZZId],
        });
        await expect(
          owner.create(
            actorOf(adminWithZZ, { currentMarketId: marketZZId }),
            createCommand({ mcpAccountId: zzAccount }),
          ),
        ).rejects.toMatchObject({
          code: 'MCP_ADJUSTMENT_MARKET_NOT_CONFIGURED',
        });
      });

      it('denies a market the admin has no access to', async () => {
        const zzAccount = await createMerchantAndMcpAccount(marketZZId);
        // financeOperator holds the maker permission but has no access to ZZ.
        await expect(
          owner.create(
            actorOf(financeOperator, { currentMarketId: marketZZId }),
            createCommand({ mcpAccountId: zzAccount }),
          ),
        ).rejects.toMatchObject({
          code: 'MCP_ADJUSTMENT_MARKET_ACCESS_DENIED',
        });
      });
    });

    describe('deterministic concurrency', () => {
      it('lets exactly one concurrent execution win and the loser replay', async () => {
        const maker = actorOf(financeOperator);
        const created = await owner.create(
          maker,
          createCommand({ amount: '3' }),
        );
        await owner.submit(maker, { requestId: created.id });
        const checker = actorOf(financeApprover);
        await owner.decide(checker, created.id, {
          decision: 'APPROVED',
          reason: 'Concurrent execute',
          requireAttachment: false,
        });
        const [a, b] = await Promise.all([
          owner.execute(checker, { requestId: created.id }),
          owner.execute(checker, { requestId: created.id }),
        ]);
        const states = [a.state, b.state].sort();
        expect(states).toEqual(['EXECUTED', 'EXECUTED']);
        expect(a.id).toBe(b.id);
        const entries = await database.db
          .select({ id: mcpLedgerEntries.id })
          .from(mcpLedgerEntries)
          .where(eq(mcpLedgerEntries.sourceId, created.id));
        expect(entries).toHaveLength(1);
      });

      it('lets exactly one concurrent decision win and the loser see the decided state', async () => {
        const maker = actorOf(financeOperator);
        const created = await owner.create(
          maker,
          createCommand({ amount: '4' }),
        );
        await owner.submit(maker, { requestId: created.id });
        const checker = actorOf(financeApprover);
        const results = await Promise.allSettled([
          owner.decide(checker, created.id, {
            decision: 'APPROVED',
            reason: 'Concurrent decide A',
            requireAttachment: false,
          }),
          owner.decide(checker, created.id, {
            decision: 'APPROVED',
            reason: 'Concurrent decide B',
            requireAttachment: false,
          }),
        ]);
        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        expect(fulfilled).toHaveLength(1);
        const rejected = results.filter((r) => r.status === 'rejected');
        expect(rejected).toHaveLength(1);
        const reason = (rejected[0] as PromiseRejectedResult).reason as {
          code?: string;
        };
        expect(reason.code).toBe('MCP_ADJUSTMENT_STATE_CONFLICT');
        const decisionRows = await database.db
          .select()
          .from(mcpAdjustmentDecisions)
          .where(
            eq(mcpAdjustmentDecisions.adjustmentRequestId, created.id),
          );
        expect(decisionRows).toHaveLength(1);
      });
    });

    describe('atomic failure handling', () => {
      it('rolls back the ledger append on injected failure and marks FAILED', async () => {
        const maker = actorOf(financeOperator);
        const created = await owner.create(
          maker,
          createCommand({ amount: '12' }),
        );
        await owner.submit(maker, { requestId: created.id });
        const checker = actorOf(financeApprover);
        await owner.decide(checker, created.id, {
          decision: 'APPROVED',
          reason: 'Will fail at the ledger seam',
          requireAttachment: false,
        });
        const balanceBefore = await accountBalance();
        const entriesBefore = await ledgerEntryCount();
        const spy = vi
          .spyOn(owner, 'appendLedgerEntry')
          .mockRejectedValueOnce(new Error('injected ledger failure'));
        const failed = await owner.execute(checker, { requestId: created.id });
        spy.mockRestore();
        expect(failed.state).toBe('FAILED');
        // Full rollback: no ledger effect, no balance change.
        expect(await accountBalance()).toBe(balanceBefore);
        expect(await ledgerEntryCount()).toBe(entriesBefore);
        // Retry-safe: a later execute replays FAILED with no new entries.
        const replay = await owner.execute(checker, { requestId: created.id });
        expect(replay.state).toBe('FAILED');
        expect(await ledgerEntryCount()).toBe(entriesBefore);
        expect(await auditActions(created.id)).toContain(
          'MCP_ADJUSTMENT_EXECUTE_FAILED',
        );
      });

      it('keeps the request APPROVED on a validation failure (retryable)', async () => {
        const maker = actorOf(financeOperator);
        const created = await owner.create(
          maker,
          createCommand({
            amount: '20000',
            attachmentReference: 'att-20000',
          }),
        );
        await owner.submit(maker, { requestId: created.id });
        await owner.decide(actorOf(superAdmin), created.id, {
          decision: 'APPROVED',
          reason: 'Approved above soft cap',
          requireAttachment: false,
        });
        // Evidence storage disabled -> validation failure -> stays APPROVED.
        await expect(
          owner.execute(actorOf(superAdmin), { requestId: created.id }),
        ).rejects.toMatchObject({
          code: 'MCP_ADJUSTMENT_EVIDENCE_STORAGE_UNAVAILABLE',
        });
        expect((await requestRow(created.id))?.status).toBe('APPROVED');
      });
    });

    describe('no direct balance mutation', () => {
      it('only changes the MCP balance through an immutable ledger entry', async () => {
        const before = await accountBalance();
        const maker = actorOf(financeOperator);
        const created = await owner.create(
          maker,
          createCommand({ amount: '1' }),
        );
        await owner.submit(maker, { requestId: created.id });
        const checker = actorOf(financeApprover);
        await owner.decide(checker, created.id, {
          decision: 'APPROVED',
          reason: 'Ledger-only mutation',
          requireAttachment: false,
        });
        await owner.execute(checker, { requestId: created.id });
        const after = await accountBalance();
        expect(normalizeDecimal(after)).toBe(
          String(Number(normalizeDecimal(before)) + 1),
        );
        // Every executed request produced exactly one immutable ledger row.
        const entries = await database.db
          .select()
          .from(mcpLedgerEntries)
          .where(eq(mcpLedgerEntries.mcpAccountId, mcpAccountId));
        const executed = await database.db
          .select()
          .from(mcpAdjustmentRequests)
          .where(eq(mcpAdjustmentRequests.status, 'EXECUTED'));
        expect(entries.length).toBe(executed.length);
      });
    });

    describe('Finance read projections (queue / history)', () => {
      it('lists requests for the market with state filtering and detail', async () => {
        const maker = actorOf(financeOperator);
        const created = await owner.create(
          maker,
          createCommand({ amount: '2' }),
        );
        await owner.submit(maker, { requestId: created.id });
        await owner.decide(actorOf(financeApprover), created.id, {
          decision: 'APPROVED',
          reason: 'Queue projection',
          requireAttachment: false,
        });
        const all = await owner.listForMarket(marketId, {
          limit: 50,
          offset: 0,
        });
        expect(all.items.some((item) => item.id === created.id)).toBe(true);
        const submitted = await owner.listForMarket(marketId, {
          state: 'SUBMITTED',
          limit: 50,
          offset: 0,
        });
        expect(
          submitted.items.some((item) => item.id === created.id),
        ).toBe(false);
        const approved = await owner.listForMarket(marketId, {
          state: 'APPROVED',
          limit: 50,
          offset: 0,
        });
        expect(approved.items.some((item) => item.id === created.id)).toBe(
          true,
        );
        const detail = await owner.detail(marketId, created.id);
        expect(detail.request.id).toBe(created.id);
        expect(detail.decisions).toHaveLength(1);
        await expect(
          owner.detail(marketId, randomUUID()),
        ).rejects.toMatchObject({ code: 'MCP_ADJUSTMENT_REQUEST_NOT_FOUND' });
      });
    });

    describe('idempotency helper derivation', () => {
      it('derives a stable sha256 canonical hash', () => {
        expect(canonicalHash({ a: 1, b: 2 })).toHaveLength(64);
        expect(canonicalHash({ a: 1, b: 2 })).toBe(
          canonicalHash({ b: 2, a: 1 }),
        );
      });
    });
  },
);
