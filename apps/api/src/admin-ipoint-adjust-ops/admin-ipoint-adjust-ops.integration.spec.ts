import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  accounts,
  adminMfaFactors,
  adminStepUpGrants,
  adminUsers,
  ipointAdjustmentMarketRules,
  ipointAdjustmentReasonCodes,
  markets,
  memberWalletAccounts,
  members,
  migrate,
  roles,
  sessions,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { and, eq, isNull } from 'drizzle-orm';
import type { Server } from 'node:http';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { totpCode } from '../auth/admin-mfa.crypto.js';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import { AccessAdministrationService } from '../platform-access/access-administration.service.js';
import { MarketService } from '../platform-access/market.service.js';

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
const password = 'Ipoint-Adjust-Ops-Password-123!';

/**
 * P7-S7B Admin iPoint Adjustment Operations HTTP integration (SEC-01 §6 /
 * P7-S1 §17) on a fresh real PostgreSQL database.
 *
 * Asserts the full Maker → Checker → execute workflow through the Phase 7
 * adapter over the FROZEN SEC-01 owner, plus the §6.4 error mapping
 * (403/404/409/422 — never a generic 500 for owner business codes) and
 * the read projections (queue, detail with decision history, config,
 * wallet lookup).
 */
describe.skipIf(!databaseUrl)(
  'Admin iPoint Adjustment Operations HTTP integration (P7-S7B, real PostgreSQL)',
  () => {
    let app: INestApplication;
    let server: Server;
    let database: DatabaseService;
    let auth: AuthService;
    let administration: AccessAdministrationService;
    let marketId: string;
    let marketZZId: string; // no caps rules row -> blocked
    let walletId: string;
    let walletZZId: string;
    let maker: {
      id: string;
      email: string;
      password: string;
      adminUserId: string;
    };
    let checker: {
      id: string;
      email: string;
      password: string;
      adminUserId: string;
    };
    let makerToken: string;
    let checkerToken: string;
    let memberId: string;

    const MARKET_SOFT_CAP = '10000';
    const MARKET_HARD_CAP = '100000';

    beforeAll(async () => {
      vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
      vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
      vi.stubEnv('AUTH_OTP_PEPPER', 's7b-http-otp-pepper-32-characters');
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
          name: 'S7B iPoint Adjustment Test Market',
          currencyCode: 'MYR',
          timezone: 'Asia/Kuala_Lumpur',
          defaultLocale: 'en-MY',
        },
        { adminUserId: randomUUID(), reason: 'S7B HTTP test setup' },
      );
      marketId = market.id;
      await marketService.setStatus(marketId, 'ACTIVE', {
        adminUserId: randomUUID(),
        reason: 'S7B HTTP test setup',
      });
      await database.db.insert(ipointAdjustmentMarketRules).values({
        marketCode: market.code,
        softCap: MARKET_SOFT_CAP,
        hardCap: MARKET_HARD_CAP,
        secureEvidenceAvailable: false,
        isActive: true,
      });
      await database.db.insert(ipointAdjustmentReasonCodes).values({
        marketCode: market.code,
        code: 'OPERATIONAL_CORRECTION',
        label: 'Operational correction of a processing error',
        isHighRisk: false,
        isActive: true,
      });

      // Unconfigured market: ACTIVE but NO caps rules row (no fallback).
      const marketZZ = await marketService.create(
        {
          code: `Z${randomUUID().replaceAll('-', '').slice(0, 5)}`,
          name: 'S7B Unconfigured Market',
          currencyCode: 'MYR',
          timezone: 'Asia/Kuala_Lumpur',
          defaultLocale: 'en-MY',
        },
        { adminUserId: randomUUID(), reason: 'S7B HTTP test setup' },
      );
      marketZZId = marketZZ.id;
      await marketService.setStatus(marketZZId, 'ACTIVE', {
        adminUserId: randomUUID(),
        reason: 'S7B HTTP test setup',
      });

      administration = app.get(AccessAdministrationService);
      ({ memberId, walletId } = await createMemberAndWallet(marketId));
      ({ walletId: walletZZId } = await createMemberAndWallet(marketZZId));

      maker = await createAdmin('Maker Admin');
      checker = await createAdmin('Checker Admin');
      for (const admin of [maker, checker]) {
        for (const targetMarketId of [marketId, marketZZId]) {
          await administration.grantMarketAccess(
            admin.adminUserId,
            targetMarketId,
            {
              adminUserId: admin.adminUserId,
              reason: 'S7B HTTP test setup',
            },
          );
        }
      }

      const makerSession = await auth.createAdminSession(
        maker.id,
        maker.adminUserId,
        { ipAddress: '127.0.0.1', userAgent: 'vitest' },
      );
      makerToken = makerSession.accessToken;
      await bindCurrentMarket(maker.id, marketId);
      await enrollMfa(maker.email, maker.password);

      const checkerSession = await auth.createAdminSession(
        checker.id,
        checker.adminUserId,
        { ipAddress: '127.0.0.1', userAgent: 'vitest' },
      );
      checkerToken = checkerSession.accessToken;
      await bindCurrentMarket(checker.id, marketId);
      await enrollMfa(checker.email, checker.password);
    });

    afterAll(async () => {
      await app?.close();
      vi.unstubAllEnvs();
    });

    async function createAdmin(label: string) {
      const email = `${randomUUID()}@example.com`;
      const accountPassword = `${label.replaceAll(' ', '-')}-Password-123!`;
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
      await auth.setPassword(id, accountPassword);
      const inserted = await database.db
        .insert(adminUsers)
        .values({ accountId: id, displayName: label })
        .returning({ id: adminUsers.id });
      const adminUserId = inserted[0]?.id ?? '';
      const roleRows = await database.db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.code, 'SUPER_ADMIN'));
      await administration.assignRole(adminUserId, roleRows[0]?.id ?? '', {
        adminUserId,
        reason: 'S7B HTTP test setup',
      });
      return { id, email, password: accountPassword, adminUserId };
    }

    async function createMemberAndWallet(
      targetMarketId: string,
    ): Promise<{ memberId: string; walletId: string }> {
      const account = await createAdmin(`Member ${randomUUID()}`);
      const memberRows = await database.db
        .insert(members)
        .values({
          accountId: account.id,
          publicMemberId: `pub_${randomUUID()}`,
          referralCode: `REF${randomUUID().slice(0, 8).toUpperCase()}`,
          status: 'ACTIVE',
          kycLevel: 'LEVEL_1',
        })
        .returning({ id: members.id });
      const mId = memberRows[0]?.id ?? '';
      const walletRows = await database.db
        .insert(memberWalletAccounts)
        .values({ memberId: mId, marketId: targetMarketId })
        .returning({ id: memberWalletAccounts.id });
      const wId = walletRows[0]?.id ?? '';
      await database.db
        .update(memberWalletAccounts)
        .set({ availableBalance: '5000' })
        .where(eq(memberWalletAccounts.id, wId));
      return { memberId: mId, walletId: wId };
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

    async function enrollMfa(email: string, accountPassword: string) {
      const enrollment = await supertest(server)
        .post('/api/v1/auth/admin/mfa/enrollment/start')
        .send({ email, password: accountPassword })
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

    /** Seed a fresh step-up grant for a checker action (catalog stepUp). */
    async function seedStepUpGrant(
      admin: { id: string; adminUserId: string },
      actionClass: string,
    ): Promise<string> {
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
        marketId,
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + 9 * 60 * 1000),
      });
      return token;
    }

    function adjustmentsUrl(targetMarketId = marketId) {
      return `/api/v1/admin/ipoint-adjust-ops/markets/${targetMarketId}/adjustments`;
    }

    function createPayload(overrides: Record<string, unknown> = {}) {
      return {
        walletAccountId: walletId,
        direction: 'CREDIT',
        amount: '5000',
        reasonCode: 'OPERATIONAL_CORRECTION',
        explanation: 'S7B HTTP workflow test.',
        caseReference: 'S7B-001',
        ...overrides,
      };
    }

    it('runs the full maker -> checker -> execute workflow with read projections', async () => {
      await bindCurrentMarket(maker.id, marketId);
      await bindCurrentMarket(checker.id, marketId);

      // Maker create (durable DRAFT) with Idempotency-Key.
      const key = randomUUID();
      const created = await supertest(server)
        .post(adjustmentsUrl())
        .set('authorization', `Bearer ${makerToken}`)
        .set('idempotency-key', key)
        .send(createPayload())
        .expect(201);
      const requestId = String((created.body as { id: string }).id);
      expect((created.body as { state: string }).state).toBe('DRAFT');
      // numeric(38,10) exact string with full precision (never parsed).
      expect((created.body as { amount: string }).amount).toBe(
        '5000.0000000000',
      );

      // Maker submit (DRAFT -> SUBMITTED).
      const submitted = await supertest(server)
        .post(`${adjustmentsUrl()}/${requestId}/submit`)
        .set('authorization', `Bearer ${makerToken}`)
        .expect(200);
      expect((submitted.body as { state: string }).state).toBe('SUBMITTED');

      // Checker approve with a fresh step-up grant.
      const approved = await supertest(server)
        .post(`${adjustmentsUrl()}/${requestId}/decision`)
        .set('authorization', `Bearer ${checkerToken}`)
        .set(
          'x-step-up-token',
          await seedStepUpGrant(checker, 'wallet.ipoint.adjust.checker'),
        )
        .send({ decision: 'APPROVED', reason: 'Evidence verified.' })
        .expect(200);
      expect((approved.body as { state: string }).state).toBe('APPROVED');

      // Checker execute (APPROVED -> EXECUTED) with a fresh step-up grant.
      const executed = await supertest(server)
        .post(`${adjustmentsUrl()}/${requestId}/execute`)
        .set('authorization', `Bearer ${checkerToken}`)
        .set(
          'x-step-up-token',
          await seedStepUpGrant(checker, 'wallet.ipoint.adjust.execute'),
        )
        .expect(200);
      expect((executed.body as { state: string }).state).toBe('EXECUTED');

      // Finance queue + detail read projections.
      const queue = await supertest(server)
        .get(adjustmentsUrl())
        .set('authorization', `Bearer ${checkerToken}`)
        .expect(200);
      expect(
        (queue.body as { items: Array<{ id: string }> }).items.map(
          (item) => item.id,
        ),
      ).toContain(requestId);

      const detail = await supertest(server)
        .get(`${adjustmentsUrl()}/${requestId}`)
        .set('authorization', `Bearer ${checkerToken}`)
        .expect(200);
      expect(
        (detail.body as { decisions: Array<{ decision: string }> }).decisions[0]
          ?.decision,
      ).toBe('APPROVED');
    });

    it('maps maker/checker conflict to 403 with the owner code preserved', async () => {
      await bindCurrentMarket(maker.id, marketId);
      const created = await supertest(server)
        .post(adjustmentsUrl())
        .set('authorization', `Bearer ${makerToken}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload())
        .expect(201);
      const requestId = String((created.body as { id: string }).id);
      await supertest(server)
        .post(`${adjustmentsUrl()}/${requestId}/submit`)
        .set('authorization', `Bearer ${makerToken}`)
        .expect(200);
      // The maker attempts to approve their own request: guard passes
      // (maker holds SUPER_ADMIN + step-up), the owner rejects with
      // MAKER_CHECKER_CONFLICT -> 403, not 500.
      const response = await supertest(server)
        .post(`${adjustmentsUrl()}/${requestId}/decision`)
        .set('authorization', `Bearer ${makerToken}`)
        .set(
          'x-step-up-token',
          await seedStepUpGrant(maker, 'wallet.ipoint.adjust.checker'),
        )
        .send({ decision: 'APPROVED', reason: 'Self approval must fail.' })
        .expect(403);
      expect(response.body).toMatchObject({
        error: { code: 'WALLET_ADJUSTMENT_MAKER_CHECKER_CONFLICT' },
      });
    });

    it('maps idempotency conflicts to 409 with the owner code preserved', async () => {
      await bindCurrentMarket(maker.id, marketId);
      const key = randomUUID();
      await supertest(server)
        .post(adjustmentsUrl())
        .set('authorization', `Bearer ${makerToken}`)
        .set('idempotency-key', key)
        .send(createPayload())
        .expect(201);
      const response = await supertest(server)
        .post(adjustmentsUrl())
        .set('authorization', `Bearer ${makerToken}`)
        .set('idempotency-key', key)
        .send(createPayload({ amount: '6000' }))
        .expect(409);
      expect(response.body).toMatchObject({
        error: { code: 'WALLET_ADJUSTMENT_IDEMPOTENCY_CONFLICT' },
      });
    });

    it('maps above-hard-cap requests to 422 with the owner code preserved', async () => {
      await bindCurrentMarket(maker.id, marketId);
      const response = await supertest(server)
        .post(adjustmentsUrl())
        .set('authorization', `Bearer ${makerToken}`)
        .set('idempotency-key', randomUUID())
        .send(
          createPayload({
            amount: String(Number(MARKET_HARD_CAP) + 1),
          }),
        )
        .expect(422);
      expect(response.body).toMatchObject({
        error: { code: 'WALLET_ADJUSTMENT_ABOVE_HARD_CAP' },
      });
    });

    it('maps missing requests to 404 with the owner code preserved', async () => {
      await bindCurrentMarket(maker.id, marketId);
      const response = await supertest(server)
        .post(`${adjustmentsUrl()}/${randomUUID()}/submit`)
        .set('authorization', `Bearer ${makerToken}`)
        .expect(404);
      expect(response.body).toMatchObject({
        error: { code: 'WALLET_ADJUSTMENT_REQUEST_NOT_FOUND' },
      });
    });

    it('maps unconfigured markets to 422 (no fallback) and exposes config blocked state', async () => {
      await bindCurrentMarket(maker.id, marketZZId);
      const response = await supertest(server)
        .post(adjustmentsUrl(marketZZId))
        .set('authorization', `Bearer ${makerToken}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload({ walletAccountId: walletZZId }))
        .expect(422);
      expect(response.body).toMatchObject({
        error: { code: 'WALLET_ADJUSTMENT_MARKET_NOT_CONFIGURED' },
      });

      // The maker-form config projection reports the explicit blocked
      // state for the unconfigured market.
      const config = await supertest(server)
        .get(`/api/v1/admin/ipoint-adjust-ops/markets/${marketZZId}/config`)
        .set('authorization', `Bearer ${makerToken}`)
        .expect(200);
      expect((config.body as { configured: boolean }).configured).toBe(false);
      expect((config.body as { rule: unknown }).rule).toBeNull();
    });

    it('exposes the wallet lookup and the configured maker config', async () => {
      await bindCurrentMarket(maker.id, marketId);
      const wallets = await supertest(server)
        .get(
          `/api/v1/admin/ipoint-adjust-ops/markets/${marketId}/wallets?query=pub_`,
        )
        .set('authorization', `Bearer ${makerToken}`)
        .expect(200);
      expect(
        (wallets.body as Array<{ walletId: string }>).some(
          (wallet) => wallet.walletId === walletId,
        ),
      ).toBe(true);

      const config = await supertest(server)
        .get(`/api/v1/admin/ipoint-adjust-ops/markets/${marketId}/config`)
        .set('authorization', `Bearer ${makerToken}`)
        .expect(200);
      expect((config.body as { configured: boolean }).configured).toBe(true);
      expect((config.body as { marketCode: string }).marketCode).toBeTruthy();
      expect(
        (config.body as { reasonCodes: Array<{ code: string }> }).reasonCodes[0]
          ?.code,
      ).toBe('OPERATIONAL_CORRECTION');
    });

    it('blocks above-soft execution until secure evidence is enabled (422)', async () => {
      await bindCurrentMarket(maker.id, marketId);
      await bindCurrentMarket(checker.id, marketId);
      // Above the soft cap (10,000) — below the hard cap.
      const created = await supertest(server)
        .post(adjustmentsUrl())
        .set('authorization', `Bearer ${makerToken}`)
        .set('idempotency-key', randomUUID())
        .send(
          createPayload({
            amount: '50000',
            // Above the soft cap: an opaque attachment reference is
            // mandatory (P7-OD-11 evidence rule, owner-enforced).
            attachmentReference: 'att-above-soft-1',
          }),
        )
        .expect(201);
      const requestId = String((created.body as { id: string }).id);
      await supertest(server)
        .post(`${adjustmentsUrl()}/${requestId}/submit`)
        .set('authorization', `Bearer ${makerToken}`)
        .expect(200);
      await supertest(server)
        .post(`${adjustmentsUrl()}/${requestId}/decision`)
        .set('authorization', `Bearer ${checkerToken}`)
        .set(
          'x-step-up-token',
          await seedStepUpGrant(checker, 'wallet.ipoint.adjust.checker'),
        )
        .send({
          decision: 'APPROVED',
          reason: 'Approved above soft cap.',
          requireAttachment: true,
        })
        .expect(200);
      // secure_evidence_available is false in the seed -> execution is
      // disabled server-side (P7-OD-11) -> 422, not 500.
      const response = await supertest(server)
        .post(`${adjustmentsUrl()}/${requestId}/execute`)
        .set('authorization', `Bearer ${checkerToken}`)
        .set(
          'x-step-up-token',
          await seedStepUpGrant(checker, 'wallet.ipoint.adjust.execute'),
        )
        .expect(422);
      expect(response.body).toMatchObject({
        error: { code: 'WALLET_ADJUSTMENT_EVIDENCE_STORAGE_UNAVAILABLE' },
      });
    });
  },
);
