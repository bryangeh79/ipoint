import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  accounts,
  adPlacements,
  ads,
  adminUsers,
  auditLogs,
  marketAccess,
  markets,
  memberMarketPreferences,
  members,
  migrate,
  roleAssignments,
  roles,
  sessions,
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
const password = 'P8-S1-Ads-Content-Password-123!';

describe.skipIf(!databaseUrl)(
  'P8-S1 Ads & Content HTTP integration (real PostgreSQL)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let marketA: string;
    let marketB: string;
    let admin: { adminUserId: string; accountId: string; token: string };
    let viewer: { adminUserId: string; accountId: string; token: string };
    let memberToken: string;
    let placementId: string;
    let adId: string;
    let articleId: string;

    const base = (marketId: string) =>
      `/api/v1/admin/ads-content/markets/${marketId}`;
    const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

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

    async function createMember() {
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
      await database.db.insert(memberMarketPreferences).values({
        memberId: memberRows[0]?.id ?? '',
        marketId: marketA,
        isEnabled: true,
        isCurrent: true,
      });
      const response = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email: account.email, password })
        .expect(200);
      return String((response.body as { accessToken: string }).accessToken);
    }

    beforeAll(async () => {
      const dbName = new URL(databaseUrl ?? '').pathname.replace(/^\//u, '');
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
        'p8-s1-ads-content-pepper-at-least-32-characters',
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
            name: 'Malaysia P8-S1',
            status: 'ACTIVE',
            currencyCode: 'MYR',
            timezone: 'Asia/Kuala_Lumpur',
            defaultLocale: 'en-MY',
          },
          {
            code: 'SG',
            name: 'Singapore P8-S1',
            status: 'ACTIVE',
            currencyCode: 'SGD',
            timezone: 'Asia/Singapore',
            defaultLocale: 'en-SG',
          },
        ])
        .returning({ id: markets.id });
      marketA = marketRows[0]?.id ?? '';
      marketB = marketRows[1]?.id ?? '';
      admin = await createAdmin([marketA], 'SUPER_ADMIN');
      viewer = await createAdmin([marketA], 'SUPPORT_READONLY_AUDITOR');
      await selectMarket(admin.accountId, marketA);
      await selectMarket(viewer.accountId, marketA);
      memberToken = await createMember();
    });

    afterAll(async () => {
      await app?.close();
      vi.unstubAllEnvs();
    });
    it('enforces authentication, permissions and selected-market access', async () => {
      await supertest(server)
        .get(`${base(marketA)}/ads`)
        .expect(401);
      await supertest(server)
        .post(`${base(marketA)}/placements`)
        .set(bearer(viewer.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          code: 'HOME_HERO',
          name: 'Home hero',
          position: 0,
          reason: 'Viewer cannot create.',
        })
        .expect(403);
      const mismatch = await supertest(server)
        .get(`${base(marketB)}/ads`)
        .set(bearer(admin.token))
        .expect(409);
      expect((mismatch.body as { error: { code: string } }).error.code).toBe(
        'MARKET_CONTEXT_MISMATCH',
      );
    });

    it('creates a placement and ad with retry-safe writes and complete audit', async () => {
      const placementKey = randomUUID();
      const placementBody = {
        code: 'HOME_HERO',
        name: 'Home hero',
        description: 'Primary member home placement',
        position: 0,
        reason: 'Open the approved home placement.',
      };
      const firstPlacement = await supertest(server)
        .post(`${base(marketA)}/placements`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', placementKey)
        .send(placementBody)
        .expect(201);
      const replayPlacement = await supertest(server)
        .post(`${base(marketA)}/placements`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', placementKey)
        .send(placementBody)
        .expect(201);
      placementId = String((firstPlacement.body as { id: string }).id);
      expect((replayPlacement.body as { id: string }).id).toBe(placementId);
      await supertest(server)
        .post(`${base(marketA)}/placements`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', placementKey)
        .send({ ...placementBody, name: 'Different' })
        .expect(409);

      const ad = await supertest(server)
        .post(`${base(marketA)}/ads`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          placementId,
          title: 'Local dining week',
          summary: 'Discover selected local dining offers.',
          creativeMediaUrl: 'https://cdn.example.test/dining.webp',
          creativeAltText: 'A prepared local meal',
          targetUrl: 'https://example.test/dining',
          sponsorLabel: 'Sponsored',
          reason: 'Approved market campaign draft.',
        })
        .expect(201);
      adId = String((ad.body as { id: string }).id);
      expect(
        (ad.body as { status: string; is_sponsored: boolean }).status,
      ).toBe('DRAFT');
      expect((ad.body as { is_sponsored: boolean }).is_sponsored).toBe(true);
      const audit = await database.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, adId));
      expect(audit).toHaveLength(1);
      expect(audit[0]?.reason).toBe('Approved market campaign draft.');
      expect(audit[0]?.before).toBeNull();
      expect(audit[0]?.after).toBeTruthy();
    });

    it('validates lifecycle schedules and publishes ACTIVE labelled content only', async () => {
      await supertest(server)
        .post(`${base(marketA)}/ads/${adId}/status`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          status: 'SCHEDULED',
          expectedVersion: 1,
          reason: 'Schedule validation negative path.',
        })
        .expect(400);
      const activatedAd = await supertest(server)
        .post(`${base(marketA)}/ads/${adId}/status`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          status: 'ACTIVE',
          expectedVersion: 1,
          reason: 'Campaign approved for immediate publication.',
        })
        .expect(200);
      expect(
        (activatedAd.body as { status: string; version: number }).status,
      ).toBe('ACTIVE');

      const article = await supertest(server)
        .post(`${base(marketA)}/articles`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          slug: 'local-market-update',
          title: 'Local market update',
          excerpt: 'This week in your current market.',
          body: 'Verified market news for iPoint members.',
          isPromoted: true,
          sponsorLabel: 'Promoted',
          reason: 'Publish approved local editorial content.',
        })
        .expect(201);
      articleId = String((article.body as { id: string }).id);
      await supertest(server)
        .post(`${base(marketA)}/articles/${articleId}/status`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          status: 'ACTIVE',
          expectedVersion: 1,
          reason: 'Editorial review complete.',
        })
        .expect(200);

      const home = await supertest(server)
        .get('/api/v1/members/content/home')
        .set(bearer(memberToken))
        .expect(200);
      const body = home.body as {
        market_id: string;
        ads: Array<{ sponsor_label: string }>;
        articles: Array<{ sponsor_label: string }>;
      };
      expect(body.market_id).toBe(marketA);
      expect(body.ads).toHaveLength(1);
      expect(body.ads[0]?.sponsor_label).toBe('Sponsored');
      expect(body.articles).toHaveLength(1);
      expect(body.articles[0]?.sponsor_label).toBe('Promoted');
    });

    it('removes PAUSED ads from member reads and rejects stale updates', async () => {
      await supertest(server)
        .patch(`${base(marketA)}/ads/${adId}`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          title: 'Stale title',
          expectedVersion: 1,
          reason: 'Stale update must fail.',
        })
        .expect(409);
      await supertest(server)
        .post(`${base(marketA)}/ads/${adId}/status`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          status: 'PAUSED',
          expectedVersion: 2,
          reason: 'Pause campaign for operational review.',
        })
        .expect(200);
      const home = await supertest(server)
        .get('/api/v1/members/content/home')
        .set(bearer(memberToken))
        .expect(200);
      expect(
        (home.body as { ads: unknown[]; articles: unknown[] }).ads,
      ).toHaveLength(0);
      expect((home.body as { articles: unknown[] }).articles).toHaveLength(1);
    });

    it('does not expose another market through list or member fallback', async () => {
      const foreignPlacement = await database.db
        .insert(adPlacements)
        .values({
          marketId: marketB,
          code: 'HOME_HERO',
          name: 'Foreign hero',
          position: 0,
          createdByAdminUserId: admin.adminUserId,
          updatedByAdminUserId: admin.adminUserId,
        })
        .returning({ id: adPlacements.id });
      const foreignAd = await database.db
        .insert(ads)
        .values({
          marketId: marketB,
          placementId: foreignPlacement[0]?.id ?? '',
          title: 'Foreign market ad',
          creativeMediaUrl: 'https://cdn.example.test/foreign.webp',
          creativeAltText: 'Foreign market creative',
          isSponsored: true,
          sponsorLabel: 'Sponsored',
          status: 'ACTIVE',
          createdByAdminUserId: admin.adminUserId,
          updatedByAdminUserId: admin.adminUserId,
        })
        .returning({ id: ads.id });
      const list = await supertest(server)
        .get(`${base(marketA)}/ads`)
        .set(bearer(admin.token))
        .expect(200);
      expect(
        (list.body as { items: Array<{ market_id: string }> }).items.every(
          (item) => item.market_id === marketA,
        ),
      ).toBe(true);
      await supertest(server)
        .get(`${base(marketA)}/ads/${foreignAd[0]?.id ?? ''}`)
        .set(bearer(admin.token))
        .expect(403);
      const home = await supertest(server)
        .get('/api/v1/members/content/home')
        .set(bearer(memberToken))
        .expect(200);
      expect((home.body as { ads: unknown[] }).ads).toHaveLength(0);
      const audit = await database.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, articleId));
      expect(audit.length).toBeGreaterThanOrEqual(2);
    });
  },
);
