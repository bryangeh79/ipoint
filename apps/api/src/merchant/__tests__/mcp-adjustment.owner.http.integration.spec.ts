import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  accounts,
  adminMfaFactors,
  adminStepUpGrants,
  adminUsers,
  mcpAccounts,
  mcpAdjustmentMarketRules,
  mcpAdjustmentReasonCodes,
  merchantBranches,
  merchantGroups,
  migrate,
  roles,
  sessions,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { and, eq, isNull } from 'drizzle-orm';
import type { Server } from 'node:http';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { totpCode } from '../../auth/admin-mfa.crypto.js';
import { AppModule } from '../../app.module.js';
import { configureApplication } from '../../app.setup.js';
import { AuthService } from '../../auth/auth.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { AccessAdministrationService } from '../../platform-access/access-administration.service.js';
import { MarketService } from '../../platform-access/market.service.js';

function decodeBase32(value: string): Buffer {
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

const databaseUrl = process.env['DATABASE_URL'];

/**
 * P7-S7A H-1 fix: HTTP-layer contract assertions for the MCP adjustment
 * owner error mapping. Every `McpAdjustmentOwnerError` must surface as the
 * D-046 / §7.4 HTTP status (403/404/409/422 — never a generic 500), with
 * the owner error code preserved in the response body.
 */
describe.skipIf(!databaseUrl)(
  'MCP adjustment owner HTTP error mapping (real PostgreSQL)',
  () => {
    let app: INestApplication;
    let server: Server;
    let database: DatabaseService;
    let auth: AuthService;
    let marketId: string;
    let market2Id: string;
    let mcpAccountId: string;
    let mcpAccount2Id: string;
    let makerAdmin: { id: string; adminUserId: string };
    let makerToken: string;

    const MARKET_SOFT_CAP = '10000';
    const MARKET_HARD_CAP = '100000';

    beforeAll(async () => {
      vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
      vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
      vi.stubEnv('AUTH_OTP_PEPPER', 'http-mapping-otp-pepper-32-characters');
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
      server = app.getHttpServer() as Server;
      database = app.get(DatabaseService);
      auth = app.get(AuthService);
      await migrate(database.pool);
      await seedFoundation(database.db);

      const marketService = app.get(MarketService);
      const market = await marketService.create(
        {
          code: `T${randomUUID().replaceAll('-', '').slice(0, 5)}`,
          name: 'HTTP Mapping Test Market',
          currencyCode: 'MYR',
          timezone: 'Asia/Kuala_Lumpur',
          defaultLocale: 'en-MY',
        },
        { adminUserId: randomUUID(), reason: 'HTTP mapping test setup' },
      );
      marketId = market.id;
      await marketService.setStatus(marketId, 'ACTIVE', {
        adminUserId: randomUUID(),
        reason: 'HTTP mapping test setup',
      });
      await database.db.insert(mcpAdjustmentMarketRules).values({
        marketCode: market.code,
        softCap: MARKET_SOFT_CAP,
        hardCap: MARKET_HARD_CAP,
        secureEvidenceAvailable: false,
        isActive: true,
      });
      await database.db.insert(mcpAdjustmentReasonCodes).values({
        marketCode: market.code,
        code: 'OPERATIONAL_CORRECTION',
        label: 'Operational correction of a processing error',
        isHighRisk: false,
        isActive: true,
      });

      // Unconfigured market: ACTIVE but NO caps rule row — the owner must
      // reject with MARKET_NOT_CONFIGURED (422, no fallback).
      const market2 = await marketService.create(
        {
          code: `Z${randomUUID().replaceAll('-', '').slice(0, 5)}`,
          name: 'Unconfigured Test Market',
          currencyCode: 'MYR',
          timezone: 'Asia/Kuala_Lumpur',
          defaultLocale: 'en-MY',
        },
        { adminUserId: randomUUID(), reason: 'HTTP mapping test setup' },
      );
      market2Id = market2.id;
      await marketService.setStatus(market2Id, 'ACTIVE', {
        adminUserId: randomUUID(),
        reason: 'HTTP mapping test setup',
      });

      mcpAccountId = await createMerchantAndMcpAccount(marketId);
      mcpAccount2Id = await createMerchantAndMcpAccount(market2Id);

      const administration = app.get(AccessAdministrationService);
      const account = await createAdminAccount('Mapping Maker Admin');
      const inserted = await database.db
        .insert(adminUsers)
        .values({ accountId: account.id, displayName: 'Mapping Maker Admin' })
        .returning({ id: adminUsers.id });
      makerAdmin = { id: account.id, adminUserId: inserted[0]?.id ?? '' };
      const roleRows = await database.db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.code, 'SUPER_ADMIN'));
      await administration.assignRole(
        makerAdmin.adminUserId,
        roleRows[0]?.id ?? '',
        {
          adminUserId: makerAdmin.adminUserId,
          reason: 'HTTP mapping test setup',
        },
      );
      // Market access for BOTH markets: the unconfigured-market assertion
      // must reach the owner (past the RbacGuard), which is the point of
      // the H-1 contract.
      for (const targetMarketId of [marketId, market2Id]) {
        await administration.grantMarketAccess(
          makerAdmin.adminUserId,
          targetMarketId,
          {
            adminUserId: makerAdmin.adminUserId,
            reason: 'HTTP mapping test setup',
          },
        );
      }

      const session = await auth.createAdminSession(
        makerAdmin.id,
        makerAdmin.adminUserId,
        { ipAddress: '127.0.0.1', userAgent: 'vitest' },
      );
      makerToken = session.accessToken;
      await bindCurrentMarket(makerAdmin.id, marketId);
      await enrollMfa(account.email, account.password);
    });

    afterAll(async () => {
      await app?.close();
      vi.unstubAllEnvs();
    });

    async function createAdminAccount(label: string) {
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
      return { id, email, password };
    }

    async function createMerchantAndMcpAccount(
      targetMarketId: string,
    ): Promise<string> {
      const account = await createAdminAccount(
        `Merchant ${targetMarketId.slice(0, 8)}`,
      );
      const groupRows = await database.db
        .insert(merchantGroups)
        .values({
          accountId: account.id,
          marketId: targetMarketId,
          name: `Mapping Group ${randomUUID()}`,
        })
        .returning({ id: merchantGroups.id });
      const branchRows = await database.db
        .insert(merchantBranches)
        .values({
          merchantGroupId: groupRows[0]?.id ?? '',
          merchantId: `m_${randomUUID()}`,
          marketId: targetMarketId,
          name: `Mapping Branch ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: merchantBranches.id });
      const accountRows = await database.db
        .insert(mcpAccounts)
        .values({
          merchantBranchId: branchRows[0]?.id ?? '',
          marketId: targetMarketId,
        })
        .returning({ id: mcpAccounts.id });
      return accountRows[0]?.id ?? '';
    }

    async function bindCurrentMarket(
      accountId: string,
      targetMarketId: string,
    ): Promise<void> {
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
    }

    /** Enroll the maker admin in MFA so step-up grants can be seeded. */
    async function enrollMfa(email: string, password: string): Promise<void> {
      const enrollment = await supertest(server)
        .post('/api/v1/auth/admin/mfa/enrollment/start')
        .send({ email, password })
        .expect(202);
      const secret = decodeBase32(
        new URL(enrollment.body.otpauth_uri as string).searchParams.get(
          'secret',
        ) ?? '',
      );
      await supertest(server)
        .post('/api/v1/auth/admin/mfa/enrollment/confirm')
        .send({
          challenge_id: enrollment.body.enrollment_challenge_id,
          code: totpCode(secret, Math.floor(Date.now() / 30_000)),
        })
        .expect(200);
    }

    /** Seed a fresh step-up grant for a checker action (P7-S2A catalog). */
    async function seedStepUpGrant(actionClass: string): Promise<string> {
      const token = `stepup_${randomUUID()}${randomUUID()}`;
      const sessionRows = await database.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.accountId, makerAdmin.id),
            isNull(sessions.revokedAt),
          ),
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
            eq(adminMfaFactors.adminUserId, makerAdmin.adminUserId),
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
        adminUserId: makerAdmin.adminUserId,
        factorId,
        actionClass,
        marketId,
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + 9 * 60 * 1000),
      });
      return token;
    }

    function createPayload(overrides: Record<string, unknown> = {}) {
      return {
        type: 'MANUAL_CREDIT',
        amount: '5',
        reasonCode: 'OPERATIONAL_CORRECTION',
        explanation: 'HTTP mapping contract test.',
        caseReference: 'HTTP-001',
        ...overrides,
      };
    }

    function adjustmentPath() {
      return `/api/v1/admin/markets/${marketId}/mcp/accounts/${mcpAccountId}/adjustments`;
    }

    it('maps maker/checker conflict to 403 with the owner code preserved', async () => {
      await bindCurrentMarket(makerAdmin.id, marketId);
      const created = await supertest(server)
        .post(adjustmentPath())
        .set('authorization', `Bearer ${makerToken}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload())
        .expect(201);
      const requestId = String((created.body as { id: string }).id);
      await supertest(server)
        .post(
          `/api/v1/admin/markets/${marketId}/mcp/adjustments/${requestId}/submit`,
        )
        .set('authorization', `Bearer ${makerToken}`)
        .expect(200);
      // The maker (a SUPER_ADMIN with a valid step-up grant) attempts to
      // approve their own request: guard passes, the owner rejects with
      // MAKER_CHECKER_CONFLICT — which must surface as 403, not 500.
      const response = await supertest(server)
        .post(
          `/api/v1/admin/markets/${marketId}/mcp/adjustments/${requestId}/decision`,
        )
        .set('authorization', `Bearer ${makerToken}`)
        .set(
          'x-step-up-token',
          await seedStepUpGrant('merchant.mcp.adjust.approve'),
        )
        .send({ decision: 'APPROVED', reason: 'Self approval must fail.' })
        .expect(403);
      expect(response.body).toMatchObject({
        error: { code: 'MCP_ADJUSTMENT_MAKER_CHECKER_CONFLICT' },
      });
    });

    it('maps idempotency conflicts to 409 with the owner code preserved', async () => {
      await bindCurrentMarket(makerAdmin.id, marketId);
      const key = randomUUID();
      await supertest(server)
        .post(adjustmentPath())
        .set('authorization', `Bearer ${makerToken}`)
        .set('idempotency-key', key)
        .send(createPayload())
        .expect(201);
      // Same key, different payload -> IDEMPOTENCY_CONFLICT -> 409.
      const response = await supertest(server)
        .post(adjustmentPath())
        .set('authorization', `Bearer ${makerToken}`)
        .set('idempotency-key', key)
        .send(createPayload({ amount: '6' }))
        .expect(409);
      expect(response.body).toMatchObject({
        error: { code: 'MCP_ADJUSTMENT_IDEMPOTENCY_CONFLICT' },
      });
    });

    it('maps above-hard-cap requests to 422 with the owner code preserved', async () => {
      await bindCurrentMarket(makerAdmin.id, marketId);
      const response = await supertest(server)
        .post(adjustmentPath())
        .set('authorization', `Bearer ${makerToken}`)
        .set('idempotency-key', randomUUID())
        .send(
          createPayload({
            amount: String(Number(MARKET_HARD_CAP) + 1),
          }),
        )
        .expect(422);
      expect(response.body).toMatchObject({
        error: { code: 'MCP_ADJUSTMENT_ABOVE_HARD_CAP' },
      });
    });

    it('maps missing requests to 404 with the owner code preserved', async () => {
      await bindCurrentMarket(makerAdmin.id, marketId);
      const response = await supertest(server)
        .post(
          `/api/v1/admin/markets/${marketId}/mcp/adjustments/${randomUUID()}/submit`,
        )
        .set('authorization', `Bearer ${makerToken}`)
        .expect(404);
      expect(response.body).toMatchObject({
        error: { code: 'MCP_ADJUSTMENT_REQUEST_NOT_FOUND' },
      });
    });

    it('maps unconfigured markets to 422 with the owner code preserved', async () => {
      // Switch the server Current Admin Market to the unconfigured market:
      // the RbacGuard passes (grant exists), the owner rejects with
      // MARKET_NOT_CONFIGURED (no fallback) -> 422.
      await bindCurrentMarket(makerAdmin.id, market2Id);
      const response = await supertest(server)
        .post(
          `/api/v1/admin/markets/${market2Id}/mcp/accounts/${mcpAccount2Id}/adjustments`,
        )
        .set('authorization', `Bearer ${makerToken}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload())
        .expect(422);
      expect(response.body).toMatchObject({
        error: { code: 'MCP_ADJUSTMENT_MARKET_NOT_CONFIGURED' },
      });
    });

    it('maps state conflicts to 409 with the owner code preserved', async () => {
      await bindCurrentMarket(makerAdmin.id, marketId);
      const created = await supertest(server)
        .post(adjustmentPath())
        .set('authorization', `Bearer ${makerToken}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload())
        .expect(201);
      const requestId = String((created.body as { id: string }).id);
      await supertest(server)
        .post(
          `/api/v1/admin/markets/${marketId}/mcp/adjustments/${requestId}/submit`,
        )
        .set('authorization', `Bearer ${makerToken}`)
        .expect(200);
      // A second submit on the same SUBMITTED request -> STATE_CONFLICT.
      const response = await supertest(server)
        .post(
          `/api/v1/admin/markets/${marketId}/mcp/adjustments/${requestId}/submit`,
        )
        .set('authorization', `Bearer ${makerToken}`)
        .expect(409);
      expect(response.body).toMatchObject({
        error: { code: 'MCP_ADJUSTMENT_STATE_CONFLICT' },
      });
    });
  },
);
