import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import {
  accounts,
  adminMfaFactors,
  adminStepUpGrants,
  adminUsers,
  ipointAdjustmentMarketRules,
  ipointAdjustmentReasonCodes,
  markets,
  mcpAccounts,
  mcpAdjustmentMarketRules,
  mcpAdjustmentReasonCodes,
  merchantBranches,
  merchantGroups,
  members,
  memberWalletAccounts,
  roles,
  sessions,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { and, eq, isNull } from 'drizzle-orm';
import type { Server } from 'node:http';
import supertest from 'supertest';
import { totpCode } from '../auth/admin-mfa.crypto.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import { AccessAdministrationService } from '../platform-access/access-administration.service.js';
import { MarketService } from '../platform-access/market.service.js';

/**
 * P7-S7C Finance Acceptance shared fixtures.
 *
 * Mirrors the accepted fixture patterns of the SEC-01 / S7A / S7B
 * integration suites: fresh real-PostgreSQL DB, foundation seed (which
 * ships the MY caps rules + reason-code catalogs for both the MCP and
 * iPoint adjustment owners), role-assigned admins, sessions with bound
 * Current Admin Market, MFA enrollment and step-up grant seeding.
 */

export function decodeBase32(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let accumulator = 0;
  let bits = 0;
  const output: number[] = [];
  for (const character of value.replace(/=+$/u, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid base32 fixture value.');
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >> bits) & 0xff);
    }
  }
  return Buffer.from(output);
}

export interface FixtureAdmin {
  id: string;
  email: string;
  password: string;
  adminUserId: string;
  token: string;
}

export interface AcceptanceHarness {
  app: INestApplication;
  server: Server;
  database: DatabaseService;
  auth: AuthService;
  administration: AccessAdministrationService;
  marketService: MarketService;
  marketId: string;
  marketCode: string;
  marketZZId: string;
  walletId: string;
  walletZZId: string;
  mcpAccountId: string;
  mcpAccountZZId: string;
  maker: FixtureAdmin;
  checker: FixtureAdmin;
  superAdmin: FixtureAdmin;
  readOnly: FixtureAdmin;
  /** Fresh DB creation/drop helpers */
  dropCreateDb(databaseUrl: string): Promise<void>;
  /** Raw SQL query on the suite DB */
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ) => Promise<T[]>;
  bindCurrentMarket(accountId: string, targetMarketId: string): Promise<void>;
  enrollMfa(email: string, password: string): Promise<void>;
  seedStepUpGrant(
    admin: FixtureAdmin,
    actionClass: string,
    marketId: string,
  ): Promise<string>;
  createAdmin(label: string, roleCode: string): Promise<FixtureAdmin>;
  grantMarketAccess(adminUserId: string, marketId: string): Promise<void>;
}

/**
 * Boot the full AppModule against a fresh database. The caller is
 * responsible for providing `process.env.DATABASE_URL` (already pointing at
 * the suite DB) and for dropping/creating the DB via `dropCreateDb`.
 */
export async function buildAcceptanceHarness(): Promise<AcceptanceHarness> {
  const { Test } = await import('@nestjs/testing');
  const { AppModule } = await import('../app.module.js');
  const { configureApplication } = await import('../app.setup.js');

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication();
  configureApplication(app, {
    enableShutdownHooks: false,
    scanSwaggerRoutes: false,
  });
  await app.init();
  const server = app.getHttpServer() as Server;
  const database = app.get(DatabaseService);
  const auth = app.get(AuthService);
  const administration = app.get(AccessAdministrationService);
  const marketService = app.get(MarketService);
  const { migrate } = await import('@ipoint/database');
  await migrate(database.pool);
  await seedFoundation(database.db);

  const harness: AcceptanceHarness = {
    app,
    server,
    database,
    auth,
    administration,
    marketService,
    marketId: '',
    marketCode: '',
    marketZZId: '',
    walletId: '',
    walletZZId: '',
    mcpAccountId: '',
    mcpAccountZZId: '',
    maker: null as unknown as FixtureAdmin,
    checker: null as unknown as FixtureAdmin,
    superAdmin: null as unknown as FixtureAdmin,
    readOnly: null as unknown as FixtureAdmin,
    dropCreateDb: async (url) => {
      const dbName = new URL(url).pathname.replace(/^\//u, '');
      const maintenanceUrl = url.replace(/\/[^/]+$/u, '/postgres');
      const admin = new Pool({ connectionString: maintenanceUrl });
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${dbName}"`);
      await admin.end();
    },
    query: async <T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      params?: unknown[],
    ) => {
      const result = await database.pool.query(text, params);
      return result.rows as T[];
    },
    bindCurrentMarket: async (accountId, targetMarketId) => {
      const sessionRows = await database.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt)),
        )
        .orderBy(sessions.createdAt)
        .limit(1);
      const sessionId = sessionRows[0]?.id;
      if (!sessionId) throw new Error('No active session for admin account.');
      await database.db
        .update(sessions)
        .set({
          currentAdminMarketId: targetMarketId,
          currentAdminMarketSelectedAt: new Date(),
          marketContextVersion: 2,
        })
        .where(eq(sessions.id, sessionId));
    },
    enrollMfa: async (email, password) => {
      const enrollment = await supertest(server)
        .post('/api/v1/auth/admin/mfa/enrollment/start')
        .send({ email, password })
        .expect(202);
      const body = enrollment.body as {
        otpauth_uri?: string;
        enrollment_challenge_id?: string;
      };
      const secret = decodeBase32(
        new URL(body.otpauth_uri ?? '').searchParams.get('secret') ?? '',
      );
      await supertest(server)
        .post('/api/v1/auth/admin/mfa/enrollment/confirm')
        .send({
          challenge_id: body.enrollment_challenge_id,
          code: totpCode(secret, Math.floor(Date.now() / 30_000)),
        })
        .expect(200);
    },
    seedStepUpGrant: async (admin, actionClass, targetMarketId) => {
      const token = `stepup_${randomUUID()}${randomUUID()}`;
      const sessionRows = await database.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(eq(sessions.accountId, admin.id), isNull(sessions.revokedAt)),
        )
        .orderBy(sessions.createdAt)
        .limit(1);
      const sessionId = sessionRows[0]?.id;
      if (!sessionId) throw new Error('No active session for step-up.');
      const factorRows = await database.db
        .select({ id: adminMfaFactors.id })
        .from(adminMfaFactors)
        .where(
          and(
            eq(adminMfaFactors.adminUserId, admin.adminUserId),
            eq(adminMfaFactors.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      const factorId = factorRows[0]?.id;
      if (!factorId) throw new Error('No active MFA factor for step-up.');
      const issuedAt = new Date();
      await database.db.insert(adminStepUpGrants).values({
        grantHash: createHash('sha256').update(token).digest('hex'),
        sessionId,
        adminUserId: admin.adminUserId,
        factorId,
        actionClass,
        marketId: targetMarketId,
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + 9 * 60 * 1000),
      });
      return token;
    },
    createAdmin: async (label, roleCode) => {
      const email = `${randomUUID()}@example.com`;
      const password = `${label.replaceAll(' ', '-')}-Password-123!`;
      const rows = await database.db
        .insert(accounts)
        .values({
          publicId: `acct_${randomUUID()}`,
          email,
          accountCountry: 'MY',
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        })
        .returning({ id: accounts.id });
      const id = rows[0]?.id ?? '';
      await auth.setPassword(id, password);
      const inserted = await database.db
        .insert(adminUsers)
        .values({ accountId: id, displayName: label })
        .returning({ id: adminUsers.id });
      const adminUserId = inserted[0]?.id ?? '';
      const roleRows = await database.db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.code, roleCode));
      await administration.assignRole(adminUserId, roleRows[0]?.id ?? '', {
        adminUserId,
        reason: 'P7-S7C acceptance fixture',
      });
      const session = await auth.createAdminSession(id, adminUserId, {
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      });
      return {
        id,
        email,
        password,
        adminUserId,
        token: session.accessToken,
      };
    },
    grantMarketAccess: async (adminUserId, targetMarketId) => {
      await administration.grantMarketAccess(adminUserId, targetMarketId, {
        adminUserId,
        reason: 'P7-S7C acceptance fixture',
      });
    },
  };

  // Market A: explicitly configured with caps rules + reason-code catalog
  // (both owners share the same market; rules are inserted explicitly so the
  // suite is independent of the foundation 'MY' baseline).
  const market = await marketService.create(
    {
      code: `T${randomUUID().replaceAll('-', '').slice(0, 5)}`,
      name: 'P7-S7C Acceptance Market',
      currencyCode: 'MYR',
      timezone: 'Asia/Kuala_Lumpur',
      defaultLocale: 'en-MY',
    },
    { adminUserId: randomUUID(), reason: 'P7-S7C acceptance setup' },
  );
  harness.marketId = market.id;
  harness.marketCode = market.code;
  await marketService.setStatus(market.id, 'ACTIVE', {
    adminUserId: randomUUID(),
    reason: 'P7-S7C acceptance setup',
  });
  await database.db.insert(ipointAdjustmentMarketRules).values({
    marketCode: market.code,
    softCap: '10000',
    hardCap: '100000',
    secureEvidenceAvailable: false,
    isActive: true,
  });
  await database.db.insert(mcpAdjustmentMarketRules).values({
    marketCode: market.code,
    softCap: '10000',
    hardCap: '100000',
    secureEvidenceAvailable: false,
    isActive: true,
  });
  for (const table of [ipointAdjustmentReasonCodes, mcpAdjustmentReasonCodes]) {
    await database.db.insert(table).values([
      {
        marketCode: market.code,
        code: 'OPERATIONAL_CORRECTION',
        label: 'Operational correction of a processing error',
        isHighRisk: false,
        isActive: true,
      },
      {
        marketCode: market.code,
        code: 'FRAUD_RECOVERY',
        label: 'Recovery of a fraudulent movement',
        isHighRisk: true,
        isActive: true,
      },
    ]);
  }

  // Market ZZ: ACTIVE but NO caps rules row -> explicit unavailable (no
  // fallback).
  const marketZZ = await marketService.create(
    {
      code: `Z${randomUUID().replaceAll('-', '').slice(0, 5)}`,
      name: 'P7-S7C Unconfigured Market',
      currencyCode: 'USD',
      timezone: 'Asia/Singapore',
      defaultLocale: 'en-SG',
    },
    { adminUserId: randomUUID(), reason: 'P7-S7C acceptance setup' },
  );
  harness.marketZZId = marketZZ.id;
  await marketService.setStatus(marketZZ.id, 'ACTIVE', {
    adminUserId: randomUUID(),
    reason: 'P7-S7C acceptance setup',
  });

  return harness;
}

/** Create a member + wallet row inside a target market. */
export async function createMemberAndWallet(
  harness: AcceptanceHarness,
  targetMarketId: string,
): Promise<{ memberId: string; walletId: string }> {
  const account = await harness.createAdmin(
    `Member ${randomUUID()}`,
    'KYC_REVIEWER',
  );
  const memberRows = await harness.database.db
    .insert(members)
    .values({
      accountId: account.id,
      publicMemberId: `pub_${randomUUID()}`,
      referralCode: `REF${randomUUID().slice(0, 8).toUpperCase()}`,
      status: 'ACTIVE',
      kycLevel: 'LEVEL_1',
    })
    .returning({ id: members.id });
  const memberId = memberRows[0]?.id ?? '';
  const walletRows = await harness.database.db
    .insert(memberWalletAccounts)
    .values({ memberId, marketId: targetMarketId })
    .returning({ id: memberWalletAccounts.id });
  const walletId = walletRows[0]?.id ?? '';
  await harness.database.db
    .update(memberWalletAccounts)
    .set({ availableBalance: '5000' })
    .where(eq(memberWalletAccounts.id, walletId));
  return { memberId, walletId };
}

/** Create a merchant group + branch + MCP account inside a target market. */
export async function createMerchantAndMcpAccount(
  harness: AcceptanceHarness,
  targetMarketId: string,
): Promise<string> {
  const account = await harness.createAdmin(
    `Merchant ${targetMarketId.slice(0, 8)}`,
    'KYC_REVIEWER',
  );
  const groupRows = await harness.database.db
    .insert(merchantGroups)
    .values({
      accountId: account.id,
      marketId: targetMarketId,
      name: `P7-S7C Group ${randomUUID()}`,
    })
    .returning({ id: merchantGroups.id });
  const branchRows = await harness.database.db
    .insert(merchantBranches)
    .values({
      merchantGroupId: groupRows[0]?.id ?? '',
      merchantId: `m_${randomUUID()}`,
      marketId: targetMarketId,
      name: `P7-S7C Branch ${randomUUID()}`,
      status: 'ACTIVE',
    })
    .returning({ id: merchantBranches.id });
  const accountRows = await harness.database.db
    .insert(mcpAccounts)
    .values({
      merchantBranchId: branchRows[0]?.id ?? '',
      marketId: targetMarketId,
      availableBalance: '5000',
      totalBalance: '5000',
      status: 'ACTIVE',
      version: 1,
    })
    .returning({ id: mcpAccounts.id });
  return accountRows[0]?.id ?? '';
}

/** Trim numeric(38,10) trailing zeros for exact string assertions. */
export function normalizeDecimal(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.includes('.')) return trimmed;
  const [wholeRaw, fraction] = trimmed.split('.');
  const whole = wholeRaw ?? '';
  const significant = (fraction ?? '').replace(/0+$/u, '');
  return significant === '' ? whole : `${whole}.${significant}`;
}

export { markets };
