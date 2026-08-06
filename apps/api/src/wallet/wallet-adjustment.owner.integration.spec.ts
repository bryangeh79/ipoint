import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import {
  accounts,
  adminUsers,
  auditLogs,
  ipointAdjustmentDecisions,
  ipointAdjustmentMarketRules,
  ipointAdjustmentReasonCodes,
  ipointAdjustmentRequests,
  marketAccess,
  markets,
  memberWalletAccounts,
  memberWalletEntries,
  members,
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
import { WalletAdjustmentOwnerService } from './wallet-adjustment.owner.service.js';
import { canonicalHash } from './wallet-adjustment.owner.service.js';
import type {
  CreateAdjustmentCommand,
  WalletAdjustmentOwnerActor,
} from './wallet-adjustment.owner.types.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'Sec01-Owner-Password-123!';

describe.skipIf(!databaseUrl)(
  'P7 SEC-01 Manual iPoint Adjustment owner integration (real PostgreSQL)',
  () => {
    let app: INestApplication;
    let auth: AuthService;
    let database: DatabaseService;
    let owner: WalletAdjustmentOwnerService;
    let rateLimiter: InMemoryRateLimiter;
    let marketId: string; // MY, MYR, Asia/Kuala_Lumpur (Malaysia baseline)
    let marketZZId: string; // no caps rule -> blocked
    let memberId: string;
    let walletId: string;
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
      overrides: Partial<WalletAdjustmentOwnerActor> = {},
    ): WalletAdjustmentOwnerActor {
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
          name: `${code} SEC-01 Test Market`,
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
            description: `${code} sec01 integration test permission`,
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
          displayName: `SEC-01 Admin ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserId = inserted[0]?.id ?? '';
      const roleRows = await database.db
        .insert(roles)
        .values({
          code: options.roleCode,
          name: `SEC-01 Test Role (${options.roleCode})`,
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

    async function createMemberAndWallet(
      marketOverride?: string,
    ): Promise<{ memberId: string; walletId: string }> {
      const account = await createAccount();
      const memberRows = await database.db
        .insert(members)
        .values({
          accountId: account.accountId,
          publicMemberId: `pub_${randomUUID()}`,
          referralCode: `REF${randomUUID().slice(0, 8).toUpperCase()}`,
          status: 'ACTIVE',
          kycLevel: 'LEVEL_1',
        })
        .returning({ id: members.id });
      const mId = memberRows[0]?.id ?? '';
      const walletRows = await database.db
        .insert(memberWalletAccounts)
        .values({ memberId: mId, marketId: marketOverride ?? marketId })
        .returning({ id: memberWalletAccounts.id });
      const wId = walletRows[0]?.id ?? '';
      await database.db
        .update(memberWalletAccounts)
        .set({ availableBalance: '5000' })
        .where(eq(memberWalletAccounts.id, wId));
      return { memberId: mId, walletId: wId };
    }

    function createCommand(
      overrides: Partial<CreateAdjustmentCommand> = {},
    ): CreateAdjustmentCommand {
      return {
        walletAccountId: walletId,
        direction: 'CREDIT',
        amount: '100',
        reasonCode: 'OPERATIONAL_CORRECTION',
        explanation: 'Integration test correction',
        caseReference: `CASE-${randomUUID()}`,
        idempotencyKey: randomUUID(),
        ...overrides,
      };
    }

    async function walletBalance(): Promise<string> {
      const rows = await database.db
        .select({ availableBalance: memberWalletAccounts.availableBalance })
        .from(memberWalletAccounts)
        .where(eq(memberWalletAccounts.id, walletId))
        .limit(1);
      return rows[0]?.availableBalance ?? 'MISSING';
    }

    async function ledgerEntryCount(): Promise<number> {
      const rows = await database.db
        .select({ id: memberWalletEntries.id })
        .from(memberWalletEntries)
        .where(eq(memberWalletEntries.walletAccountId, walletId));
      return rows.length;
    }

    async function requestRow(requestId: string) {
      const rows = await database.db
        .select()
        .from(ipointAdjustmentRequests)
        .where(eq(ipointAdjustmentRequests.id, requestId))
        .limit(1);
      return rows[0];
    }

    async function auditActions(requestId: string): Promise<string[]> {
      const rows = await database.db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, 'ipoint_adjustment_request'),
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
        'sec01-owner-pepper-at-least-32-characters',
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
      owner = app.get(WalletAdjustmentOwnerService);
      rateLimiter = app.get<InMemoryRateLimiter>(AUTH_RATE_LIMITER);
      await migrate(database.pool);
      await seedFoundation(database.db);

      marketId = await ensureActiveMarket('MY', 'MYR', 'Asia/Kuala_Lumpur');
      marketZZId = await ensureActiveMarket('ZZ', 'USD', 'Asia/Singapore');

      const makerPerms = [
        'wallet.ipoint.adjust.maker',
        'wallet.ipoint.adjust.checker',
        'wallet.ipoint.adjust.execute',
      ] as const;
      superAdmin = await createAdmin({
        roleCode: 'SUPER_ADMIN',
        permissionCodes: [...makerPerms],
        marketIds: [marketId],
      });
      financeApprover = await createAdmin({
        roleCode: 'FINANCE_APPROVER',
        permissionCodes: [
          'wallet.ipoint.adjust.checker',
          'wallet.ipoint.adjust.execute',
        ],
        marketIds: [marketId],
      });
      financeOperator = await createAdmin({
        roleCode: 'FINANCE_OPERATOR',
        permissionCodes: ['wallet.ipoint.adjust.maker'],
        marketIds: [marketId],
      });

      const seeded = await createMemberAndWallet();
      memberId = seeded.memberId;
      walletId = seeded.walletId;
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

        const submitted = await owner.submit(maker, created.id);
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

        const executed = await owner.execute(checker, created.id);
        expect(executed.state).toBe('EXECUTED');
        expect(executed.executedAt).not.toBeNull();
        expect(executed.ledgerEntryId).not.toBeNull();

        expect(normalizeDecimal(await walletBalance())).toBe('5100');
        expect(await ledgerEntryCount()).toBe(1);

        const entry = (
          await database.db
            .select()
            .from(memberWalletEntries)
            .where(eq(memberWalletEntries.walletAccountId, walletId))
        )[0];
        expect(entry?.entryType).toBe('ADJUSTMENT');
        expect(normalizeDecimal(entry?.amount ?? '')).toBe('100');
        expect(normalizeDecimal(entry?.balanceBefore ?? '')).toBe('5000');
        expect(normalizeDecimal(entry?.balanceAfter ?? '')).toBe('5100');
        expect(entry?.referenceType).toBe('IPOINT_ADJUSTMENT');
        expect(entry?.referenceId).toBe(executed.id);

        const decisionRows = await database.db
          .select()
          .from(ipointAdjustmentDecisions)
          .where(eq(ipointAdjustmentDecisions.adjustmentRequestId, created.id));
        expect(decisionRows).toHaveLength(1);
        expect(decisionRows[0]?.decision).toBe('APPROVED');

        const actions = await auditActions(created.id);
        expect(actions).toEqual(
          expect.arrayContaining([
            'ipoint.adjustment.create',
            'ipoint.adjustment.submit',
            'ipoint.adjustment.approve',
            'ipoint.adjustment.execute',
          ]),
        );
      });

      it('executes an exact-opposite debit and rejects an insufficient debit', async () => {
        // Exact-opposite correction: DEBIT of the same magnitude.
        const maker = actorOf(financeOperator);
        const created = await owner.create(
          maker,
          createCommand({ direction: 'DEBIT', amount: '50' }),
        );
        await owner.submit(maker, created.id);
        const checker = actorOf(financeApprover);
        await owner.decide(checker, created.id, {
          decision: 'APPROVED',
          reason: 'Exact-opposite debit',
          requireAttachment: false,
        });
        const executed = await owner.execute(checker, created.id);
        expect(executed.state).toBe('EXECUTED');
        expect(normalizeDecimal(await walletBalance())).toBe('5050');

        // Insufficient debit -> execution attempt fails -> FAILED, no ledger.
        const wallet = (
          await database.db
            .select({ availableBalance: memberWalletAccounts.availableBalance })
            .from(memberWalletAccounts)
            .where(eq(memberWalletAccounts.id, walletId))
            .limit(1)
        )[0];
        const huge = await owner.create(
          maker,
          createCommand({
            direction: 'DEBIT',
            amount: String(Number(wallet?.availableBalance ?? 0) + 1),
          }),
        );
        await owner.submit(maker, huge.id);
        await owner.decide(checker, huge.id, {
          decision: 'APPROVED',
          reason: 'Will fail on balance',
          requireAttachment: false,
        });
        const failed = await owner.execute(checker, huge.id);
        expect(failed.state).toBe('FAILED');
        expect(failed.failedAt).not.toBeNull();
        expect(normalizeDecimal(await walletBalance())).toBe('5050');
        expect(await ledgerEntryCount()).toBe(2); // only the two successes
        const actions = await auditActions(huge.id);
        expect(actions).toContain('ipoint.adjustment.execute_failed');
      });

      it('rejects a retry after FAILED without a duplicate ledger effect', async () => {
        const maker = actorOf(financeOperator);
        // Above the current balance but within the soft cap, so no
        // evidence gate applies and the execution fails at the ledger.
        const created = await owner.create(
          maker,
          createCommand({ direction: 'DEBIT', amount: '6000' }),
        );
        await owner.submit(maker, created.id);
        const checker = actorOf(financeApprover);
        await owner.decide(checker, created.id, {
          decision: 'APPROVED',
          reason: 'Will fail on balance',
          requireAttachment: false,
        });
        const failed = await owner.execute(checker, created.id);
        expect(failed.state).toBe('FAILED');
        const before = await ledgerEntryCount();
        const replay = await owner.execute(checker, created.id);
        expect(replay.state).toBe('FAILED');
        expect(await ledgerEntryCount()).toBe(before);
      });
    });

    describe('Maker/Checker inequality (runtime, every amount)', () => {
      it('denies the maker as checker, including Super Admin acting alone', async () => {
        // Super Admin as maker: the same Super Admin may not decide.
        const created = await owner.create(
          actorOf(superAdmin),
          createCommand({ amount: '500' }),
        );
        await owner.submit(actorOf(superAdmin), created.id);
        await expect(
          owner.decide(actorOf(superAdmin), created.id, {
            decision: 'APPROVED',
            reason: 'Same person',
            requireAttachment: false,
          }),
        ).rejects.toMatchObject({
          code: 'WALLET_ADJUSTMENT_MAKER_CHECKER_CONFLICT',
        });
        // A different Super Admin approves; then the maker may not execute.
        const secondSuperAdmin = await createAdmin({
          roleCode: 'SUPER_ADMIN',
          permissionCodes: [
            'wallet.ipoint.adjust.maker',
            'wallet.ipoint.adjust.checker',
            'wallet.ipoint.adjust.execute',
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
          owner.execute(actorOf(superAdmin), created.id),
        ).rejects.toMatchObject({
          code: 'WALLET_ADJUSTMENT_MAKER_CHECKER_CONFLICT',
        });
        const executed = await owner.execute(
          actorOf(secondSuperAdmin),
          created.id,
        );
        expect(executed.state).toBe('EXECUTED');
      });

      it('denies a maker submit by anyone but the maker', async () => {
        const created = await owner.create(
          actorOf(financeOperator),
          createCommand({ amount: '10' }),
        );
        // Super Admin holds the maker permission but is not the maker.
        await expect(
          owner.submit(actorOf(superAdmin), created.id),
        ).rejects.toMatchObject({ code: 'WALLET_ADJUSTMENT_MAKER_REQUIRED' });
      });
    });

    describe('caps routing (P7-OD-10 Malaysia 10,000 / 100,000)', () => {
      it('lets a Finance Approver check at/below the soft cap (10,000)', async () => {
        const created = await owner.create(
          actorOf(financeOperator),
          createCommand({ amount: '10000' }),
        );
        await owner.submit(actorOf(financeOperator), created.id);
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
        await owner.submit(actorOf(financeOperator), created.id);
        await expect(
          owner.decide(actorOf(financeApprover), created.id, {
            decision: 'APPROVED',
            reason: 'Finance Approver must not clear above soft cap',
            requireAttachment: false,
          }),
        ).rejects.toMatchObject({
          code: 'WALLET_ADJUSTMENT_CHECKER_ROUTING_DENIED',
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
        ).rejects.toMatchObject({ code: 'WALLET_ADJUSTMENT_ABOVE_HARD_CAP' });
      });

      it('blocks execution above the soft cap until secure evidence storage is enabled', async () => {
        const created = await owner.create(
          actorOf(financeOperator),
          createCommand({
            amount: '15000',
            attachmentReference: 'att-15000',
          }),
        );
        await owner.submit(actorOf(financeOperator), created.id);
        await owner.decide(actorOf(superAdmin), created.id, {
          decision: 'APPROVED',
          reason: 'Super Admin clears above soft cap',
          requireAttachment: false,
        });
        // secure_evidence_available defaults to false -> execution disabled.
        await expect(
          owner.execute(actorOf(superAdmin), created.id),
        ).rejects.toMatchObject({
          code: 'WALLET_ADJUSTMENT_EVIDENCE_STORAGE_UNAVAILABLE',
        });
        const stillApproved = await requestRow(created.id);
        expect(stillApproved?.state).toBe('APPROVED');
        // Enable secure evidence for MY and retry the same approved request.
        await database.db
          .update(ipointAdjustmentMarketRules)
          .set({ secureEvidenceAvailable: true })
          .where(eq(ipointAdjustmentMarketRules.marketCode, 'MY'));
        const executed = await owner.execute(actorOf(superAdmin), created.id);
        expect(executed.state).toBe('EXECUTED');
        // Restore the disabled default for the remaining suites.
        await database.db
          .update(ipointAdjustmentMarketRules)
          .set({ secureEvidenceAvailable: false })
          .where(eq(ipointAdjustmentMarketRules.marketCode, 'MY'));
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
          code: 'WALLET_ADJUSTMENT_ATTACHMENT_REQUIRED',
        });
      });

      it('requires an attachment for a high-risk reason code', async () => {
        await expect(
          owner.create(
            actorOf(financeOperator),
            createCommand({ reasonCode: 'FRAUD_RECOVERY' }),
          ),
        ).rejects.toMatchObject({
          code: 'WALLET_ADJUSTMENT_ATTACHMENT_REQUIRED',
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
        await owner.submit(actorOf(financeOperator), created.id);
        await expect(
          owner.decide(actorOf(financeApprover), created.id, {
            decision: 'APPROVED',
            reason: 'I need the attachment first',
            requireAttachment: true,
          }),
        ).rejects.toMatchObject({
          code: 'WALLET_ADJUSTMENT_ATTACHMENT_REQUIRED',
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
        await owner.submit(maker, created.id);
        const checker = actorOf(financeApprover);
        const rejected = await owner.decide(checker, created.id, {
          decision: 'REJECTED',
          reason: 'Evidence insufficient',
          requireAttachment: false,
        });
        expect(rejected.state).toBe('REJECTED');
        expect(rejected.checkerAdminUserId).toBe(financeApprover.adminUserId);

        // Immutable: cannot resubmit or re-decide a rejected request.
        await expect(owner.submit(maker, created.id)).rejects.toMatchObject({
          code: 'WALLET_ADJUSTMENT_STATE_CONFLICT',
        });
        await expect(
          owner.decide(checker, created.id, {
            decision: 'APPROVED',
            reason: 'Too late',
            requireAttachment: false,
          }),
        ).rejects.toMatchObject({ code: 'WALLET_ADJUSTMENT_STATE_CONFLICT' });

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
          code: 'WALLET_ADJUSTMENT_IDEMPOTENCY_CONFLICT',
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
        await owner.submit(maker, replacement.id);
        await owner.decide(checker, replacement.id, {
          decision: 'APPROVED',
          reason: 'Attachment supplied',
          requireAttachment: false,
        });
        await owner.execute(checker, replacement.id);
        expect((await requestRow(replacement.id))?.state).toBe('EXECUTED');
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
          code: 'WALLET_ADJUSTMENT_IDEMPOTENCY_CONFLICT',
        });
      });
    });

    describe('market guards and no-fallback blocking', () => {
      it('blocks a market with no caps rule (no fallback)', async () => {
        // A wallet in a market with no ipoint_adjustment_market_rules row.
        const zzWallet = await createMemberAndWallet(marketZZId);
        const adminWithZZ = await createAdmin({
          roleCode: 'SUPER_ADMIN',
          permissionCodes: [
            'wallet.ipoint.adjust.maker',
            'wallet.ipoint.adjust.checker',
            'wallet.ipoint.adjust.execute',
          ],
          marketIds: [marketId, marketZZId],
        });
        await expect(
          owner.create(
            actorOf(adminWithZZ, { currentMarketId: marketZZId }),
            createCommand({ walletAccountId: zzWallet.walletId }),
          ),
        ).rejects.toMatchObject({
          code: 'WALLET_ADJUSTMENT_MARKET_NOT_CONFIGURED',
        });
      });

      it('denies a market the admin has no access to', async () => {
        const zzWallet = await createMemberAndWallet(marketZZId);
        // financeOperator holds the maker permission but has no access to ZZ.
        await expect(
          owner.create(
            actorOf(financeOperator, { currentMarketId: marketZZId }),
            createCommand({ walletAccountId: zzWallet.walletId }),
          ),
        ).rejects.toMatchObject({
          code: 'WALLET_ADJUSTMENT_MARKET_ACCESS_DENIED',
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
        await owner.submit(maker, created.id);
        const checker = actorOf(financeApprover);
        await owner.decide(checker, created.id, {
          decision: 'APPROVED',
          reason: 'Concurrent execute',
          requireAttachment: false,
        });
        const [a, b] = await Promise.all([
          owner.execute(checker, created.id),
          owner.execute(checker, created.id),
        ]);
        const states = [a.state, b.state].sort();
        expect(states).toEqual(['EXECUTED', 'EXECUTED']);
        expect(a.id).toBe(b.id);
        const entries = await database.db
          .select({ id: memberWalletEntries.id })
          .from(memberWalletEntries)
          .where(eq(memberWalletEntries.referenceId, created.id));
        expect(entries).toHaveLength(1);
      });

      it('lets exactly one concurrent decision win and the loser see the decided state', async () => {
        const maker = actorOf(financeOperator);
        const created = await owner.create(
          maker,
          createCommand({ amount: '4' }),
        );
        await owner.submit(maker, created.id);
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
        expect(reason.code).toBe('WALLET_ADJUSTMENT_STATE_CONFLICT');
        const decisionRows = await database.db
          .select()
          .from(ipointAdjustmentDecisions)
          .where(eq(ipointAdjustmentDecisions.adjustmentRequestId, created.id));
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
        await owner.submit(maker, created.id);
        const checker = actorOf(financeApprover);
        await owner.decide(checker, created.id, {
          decision: 'APPROVED',
          reason: 'Will fail at the ledger seam',
          requireAttachment: false,
        });
        const balanceBefore = await walletBalance();
        const entriesBefore = await ledgerEntryCount();
        const spy = vi
          .spyOn(owner, 'appendLedgerEntry')
          .mockRejectedValueOnce(new Error('injected ledger failure'));
        const failed = await owner.execute(checker, created.id);
        spy.mockRestore();
        expect(failed.state).toBe('FAILED');
        // Full rollback: no ledger effect, no balance change.
        expect(await walletBalance()).toBe(balanceBefore);
        expect(await ledgerEntryCount()).toBe(entriesBefore);
        // Retry-safe: a later execute replays FAILED with no new entries.
        const replay = await owner.execute(checker, created.id);
        expect(replay.state).toBe('FAILED');
        expect(await ledgerEntryCount()).toBe(entriesBefore);
        expect(await auditActions(created.id)).toContain(
          'ipoint.adjustment.execute_failed',
        );
      });

      it('keeps the request APPROVED on a validation failure (retryable)', async () => {
        const maker = actorOf(financeOperator);
        const created = await owner.create(
          maker,
          createCommand({ amount: '20000', attachmentReference: 'att-20000' }),
        );
        await owner.submit(maker, created.id);
        await owner.decide(actorOf(superAdmin), created.id, {
          decision: 'APPROVED',
          reason: 'Approved above soft cap',
          requireAttachment: false,
        });
        // Evidence storage disabled -> validation failure -> stays APPROVED.
        await expect(
          owner.execute(actorOf(superAdmin), created.id),
        ).rejects.toMatchObject({
          code: 'WALLET_ADJUSTMENT_EVIDENCE_STORAGE_UNAVAILABLE',
        });
        expect((await requestRow(created.id))?.state).toBe('APPROVED');
      });
    });

    describe('no direct balance mutation', () => {
      it('only changes the wallet balance through an immutable ledger entry', async () => {
        const before = await walletBalance();
        const maker = actorOf(financeOperator);
        const created = await owner.create(
          maker,
          createCommand({ amount: '1' }),
        );
        await owner.submit(maker, created.id);
        const checker = actorOf(financeApprover);
        await owner.decide(checker, created.id, {
          decision: 'APPROVED',
          reason: 'Ledger-only mutation',
          requireAttachment: false,
        });
        await owner.execute(checker, created.id);
        const after = await walletBalance();
        expect(normalizeDecimal(after)).toBe(
          String(Number(normalizeDecimal(before)) + 1),
        );
        // Every executed request produced exactly one immutable ledger row.
        const entries = await database.db
          .select()
          .from(memberWalletEntries)
          .where(eq(memberWalletEntries.walletAccountId, walletId));
        const executed = await database.db
          .select()
          .from(ipointAdjustmentRequests)
          .where(eq(ipointAdjustmentRequests.state, 'EXECUTED'));
        expect(entries.length).toBe(executed.length);
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
