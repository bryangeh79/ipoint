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
  adPlacements,
  ads,
  adminUsers,
  auditLogs,
  contentArticles,
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

// ---------------------------------------------------------------------------
// Fail-closed destructive fresh-database guard (H-01).
//
// The suite recreates its database with `DROP DATABASE ... WITH (FORCE)`.
// That is only safe by construction when the parsed database name matches a
// dedicated P8-S1 test pattern, is not a protected maintenance database, and
// the operator explicitly opted in. Otherwise the suite fails before any
// connection is opened.
// ---------------------------------------------------------------------------
const TEST_DATABASE_NAME_PATTERN = /^ipoint_p8s1_[a-z0-9_]{1,63}$/u;
const PROTECTED_DATABASE_NAMES = new Set([
  'postgres',
  'template0',
  'template1',
]);
export const DESTRUCTIVE_TEST_OPT_IN_ENV = 'P8S1_DESTRUCTIVE_TEST';

/**
 * Returns the database name parsed from a PostgreSQL URL only when it matches
 * the dedicated test pattern and is not a protected maintenance database;
 * otherwise returns null (fail-closed).
 */
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

/**
 * The destructive test requires an explicit opt-in environment variable so a
 * mistaken DATABASE_URL can never trigger a DROP by itself.
 */
export function destructiveTestOptIn(
  env: Record<string, string | undefined>,
): boolean {
  const value = env[DESTRUCTIVE_TEST_OPT_IN_ENV]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

describe('P8-S1 destructive fresh-database guard', () => {
  it('accepts only the dedicated ipoint_p8s1_* test pattern', () => {
    expect(
      testDatabaseName(
        'postgresql://user:pass@127.0.0.1:55432/ipoint_p8s1_test',
      ),
    ).toBe('ipoint_p8s1_test');
    expect(
      testDatabaseName('postgres://localhost/ipoint_p8s1_migration_test'),
    ).toBe('ipoint_p8s1_migration_test');
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
    expect(testDatabaseName('postgresql://localhost/ipoint_p8s1')).toBeNull();
    expect(
      testDatabaseName('postgresql://localhost/ipoint_p8s1_test_x%2Fbad'),
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
      const dbName = testDatabaseName(databaseUrl);
      if (!dbName) {
        throw new Error(
          `P8-S1 integration suite is fail-closed: DATABASE_URL must name a dedicated test database matching ^ipoint_p8s1_[a-z0-9_]+$ and must not be a protected database (received ${databaseUrl ?? 'unset'}).`,
        );
      }
      if (!destructiveTestOptIn(process.env)) {
        throw new Error(
          `P8-S1 integration suite is fail-closed: set ${DESTRUCTIVE_TEST_OPT_IN_ENV}=1 to allow recreating the dedicated test database "${dbName}".`,
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
      const firstPlacement = await supertest(server)
        .post(`${base(marketA)}/placements`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          code: 'HOME_HERO',
          name: 'Home hero',
          description: 'Primary member home placement',
          position: 0,
          reason: 'Shared placement fixture for the P8-S1 suite.',
        })
        .expect(201);
      placementId = String((firstPlacement.body as { id: string }).id);
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
        code: 'HOME_HERO_RETRY',
        name: 'Home hero retry',
        description: 'Idempotent placement fixture',
        position: 1,
        reason: 'Exercise retry-safe placement writes.',
      };
      const firstPlacement = await supertest(server)
        .post(`${base(marketA)}/placements`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', placementKey)
        .send(placementBody)
        .expect(201);
      const createdPlacementId = String(
        (firstPlacement.body as { id: string }).id,
      );
      const replayPlacement = await supertest(server)
        .post(`${base(marketA)}/placements`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', placementKey)
        .send(placementBody)
        .expect(201);
      expect((replayPlacement.body as { id: string }).id).toBe(
        createdPlacementId,
      );
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

    it('requires an explicit nonblank sponsor label on every ad', async () => {
      const rejected = await supertest(server)
        .post(`${base(marketA)}/ads`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          placementId,
          title: 'Missing label ad',
          creativeMediaUrl: 'https://cdn.example.test/missing-label.webp',
          creativeAltText: 'Missing label creative',
          reason: 'Sponsor label must be explicit.',
        })
        .expect(400);
      expect(
        (rejected.body as { error: { code: string } }).error.code,
      ).toBe('VALIDATION_ERROR');
      await supertest(server)
        .post(`${base(marketA)}/ads`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          placementId,
          title: 'Blank label ad',
          creativeMediaUrl: 'https://cdn.example.test/blank-label.webp',
          creativeAltText: 'Blank label creative',
          sponsorLabel: '   ',
          reason: 'Sponsor label must be nonblank.',
        })
        .expect(400);
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

    it('keeps merged update windows consistent with current status', async () => {
      const hour = 3_600_000;
      const now = Date.now();
      const futureStart = new Date(now + hour).toISOString();
      const futureEnd = new Date(now + 4 * hour).toISOString();
      const pastStart = new Date(now - 2 * hour).toISOString();
      const pastEnd = new Date(now - hour).toISOString();
      const laterStart = new Date(now + 2 * hour).toISOString();
      const laterEnd = new Date(now + 5 * hour).toISOString();
      const nextDay = new Date(now + 24 * hour).toISOString();
      const adUpdate = (
        adId: string,
        expectedVersion: number,
        body: Record<string, unknown>,
      ) =>
        supertest(server)
          .patch(`${base(marketA)}/ads/${adId}`)
          .set(bearer(admin.token))
          .set('Idempotency-Key', randomUUID())
          .send({ ...body, expectedVersion, reason: 'Window invariant test.' });

      // ACTIVE ad: future start or past end must be rejected; a valid window
      // edit succeeds; then the record is paused to keep member reads stable.
      const activeAd = await supertest(server)
        .post(`${base(marketA)}/ads`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          placementId,
          title: 'Active window ad',
          creativeMediaUrl: 'https://cdn.example.test/active-window.webp',
          creativeAltText: 'Active window creative',
          sponsorLabel: 'Sponsored',
          scheduleStartAt: pastStart,
          scheduleEndAt: nextDay,
          reason: 'Windowed active campaign.',
        });
      const activeAdId = String((activeAd.body as { id: string }).id);
      const activeAdVersion = (activeAd.body as { version: number }).version;
      await supertest(server)
        .post(`${base(marketA)}/ads/${activeAdId}/status`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          status: 'ACTIVE',
          expectedVersion: activeAdVersion,
          reason: 'Activate windowed campaign.',
        })
        .expect(200);
      await adUpdate(activeAdId, activeAdVersion + 1, {
        scheduleStartAt: futureStart,
      }).expect(400);
      await adUpdate(activeAdId, activeAdVersion + 1, {
        scheduleEndAt: pastEnd,
      }).expect(400);
      const activeTitle = await adUpdate(activeAdId, activeAdVersion + 1, {
        title: 'Active window ad (edited)',
      }).expect(200);
      await supertest(server)
        .post(`${base(marketA)}/ads/${activeAdId}/status`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          status: 'PAUSED',
          expectedVersion: (activeTitle.body as { version: number }).version,
          reason: 'Return windowed campaign to the pool.',
        })
        .expect(200);

      // SCHEDULED ad: a past merged start must be rejected; a still-future
      // start succeeds.
      const scheduledAd = await supertest(server)
        .post(`${base(marketA)}/ads`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          placementId,
          title: 'Scheduled window ad',
          creativeMediaUrl: 'https://cdn.example.test/scheduled-window.webp',
          creativeAltText: 'Scheduled window creative',
          sponsorLabel: 'Sponsored',
          scheduleStartAt: futureStart,
          scheduleEndAt: futureEnd,
          reason: 'Windowed scheduled campaign.',
        })
        .expect(201);
      const scheduledAdId = String((scheduledAd.body as { id: string }).id);
      const scheduledAdVersion = (scheduledAd.body as { version: number })
        .version;
      await supertest(server)
        .post(`${base(marketA)}/ads/${scheduledAdId}/status`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          status: 'SCHEDULED',
          expectedVersion: scheduledAdVersion,
          reason: 'Schedule windowed campaign.',
        })
        .expect(200);
      await adUpdate(scheduledAdId, scheduledAdVersion + 1, {
        scheduleStartAt: pastStart,
      }).expect(400);
      await adUpdate(scheduledAdId, scheduledAdVersion + 1, {
        scheduleStartAt: laterStart,
      }).expect(200);

      // EXPIRED ad: a future merged end must be rejected; content edits on a
      // fully-past window succeed.
      const expiredAdRows = await database.db
        .insert(ads)
        .values({
          marketId: marketA,
          placementId,
          title: 'Expired window ad',
          creativeMediaUrl: 'https://cdn.example.test/expired-window.webp',
          creativeAltText: 'Expired window creative',
          isSponsored: true,
          sponsorLabel: 'Sponsored',
          status: 'EXPIRED',
          scheduleStartAt: new Date(pastStart),
          scheduleEndAt: new Date(pastEnd),
          createdByAdminUserId: admin.adminUserId,
          updatedByAdminUserId: admin.adminUserId,
        })
        .returning({ id: ads.id });
      const expiredAdId = String(expiredAdRows[0]?.id ?? '');
      await adUpdate(expiredAdId, 1, { scheduleEndAt: laterEnd }).expect(400);
      await adUpdate(expiredAdId, 1, {
        title: 'Expired window ad (edited)',
      }).expect(200);

      // Articles follow the same lifecycle/window invariants.
      const activeArticle = await supertest(server)
        .post(`${base(marketA)}/articles`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          slug: 'active-window-article',
          title: 'Active window article',
          excerpt: 'Active window excerpt',
          body: 'Active window body',
          publishAt: pastStart,
          unpublishAt: nextDay,
          reason: 'Windowed active article.',
        })
        .expect(201);
      const activeArticleId = String((activeArticle.body as { id: string }).id);
      const activeArticleVersion = (activeArticle.body as { version: number })
        .version;
      await supertest(server)
        .post(`${base(marketA)}/articles/${activeArticleId}/status`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          status: 'ACTIVE',
          expectedVersion: activeArticleVersion,
          reason: 'Activate windowed article.',
        })
        .expect(200);
      const articleUpdate = (
        articleId: string,
        expectedVersion: number,
        body: Record<string, unknown>,
      ) =>
        supertest(server)
          .patch(`${base(marketA)}/articles/${articleId}`)
          .set(bearer(admin.token))
          .set('Idempotency-Key', randomUUID())
          .send({ ...body, expectedVersion, reason: 'Window invariant test.' });
      await articleUpdate(activeArticleId, activeArticleVersion + 1, {
        publishAt: futureStart,
      }).expect(400);
      await articleUpdate(activeArticleId, activeArticleVersion + 1, {
        unpublishAt: pastEnd,
      }).expect(400);
      const activeArticleTitle = await articleUpdate(
        activeArticleId,
        activeArticleVersion + 1,
        { title: 'Active window article (edited)' },
      ).expect(200);
      await supertest(server)
        .post(`${base(marketA)}/articles/${activeArticleId}/status`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          status: 'PAUSED',
          expectedVersion: (activeArticleTitle.body as { version: number })
            .version,
          reason: 'Return windowed article to the pool.',
        })
        .expect(200);

      const scheduledArticle = await supertest(server)
        .post(`${base(marketA)}/articles`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          slug: 'scheduled-window-article',
          title: 'Scheduled window article',
          excerpt: 'Scheduled window excerpt',
          body: 'Scheduled window body',
          publishAt: futureStart,
          unpublishAt: futureEnd,
          reason: 'Windowed scheduled article.',
        })
        .expect(201);
      const scheduledArticleId = String(
        (scheduledArticle.body as { id: string }).id,
      );
      const scheduledArticleVersion = (
        scheduledArticle.body as { version: number }
      ).version;
      await supertest(server)
        .post(`${base(marketA)}/articles/${scheduledArticleId}/status`)
        .set(bearer(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({
          status: 'SCHEDULED',
          expectedVersion: scheduledArticleVersion,
          reason: 'Schedule windowed article.',
        })
        .expect(200);
      await articleUpdate(scheduledArticleId, scheduledArticleVersion + 1, {
        publishAt: pastStart,
      }).expect(400);
      await articleUpdate(scheduledArticleId, scheduledArticleVersion + 1, {
        publishAt: laterStart,
      }).expect(200);

      const expiredArticleRows = await database.db
        .insert(contentArticles)
        .values({
          marketId: marketA,
          slug: 'expired-window-article',
          title: 'Expired window article',
          excerpt: 'Expired window excerpt',
          body: 'Expired window body',
          status: 'EXPIRED',
          publishAt: new Date(pastStart),
          unpublishAt: new Date(pastEnd),
          authorAdminUserId: admin.adminUserId,
          updatedByAdminUserId: admin.adminUserId,
        })
        .returning({ id: contentArticles.id });
      const expiredArticleId = String(expiredArticleRows[0]?.id ?? '');
      await articleUpdate(expiredArticleId, 1, {
        unpublishAt: laterEnd,
      }).expect(400);
      await articleUpdate(expiredArticleId, 1, {
        title: 'Expired window article (edited)',
      }).expect(200);
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
      const homeBody = home.body as {
        market_id: string;
        ads: Array<{ public_id: string }>;
      };
      // The member Home surface is server-side market-scoped: it must expose
      // the member's own market only and never fall back to another market.
      expect(homeBody.market_id).toBe(marketA);
      const foreignPublicId = String(foreignAd[0]?.id ?? '');
      const homePublicIds = homeBody.ads.map((item) => item.public_id);
      expect(homePublicIds).not.toContain(foreignPublicId);
      const audit = await database.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, articleId));
      expect(audit.length).toBeGreaterThanOrEqual(2);
    });

    it('returns a bounded home projection without article bodies', async () => {
      for (let index = 0; index < 12; index += 1) {
        await database.db.insert(ads).values({
          marketId: marketA,
          placementId,
          title: `Bulk ad ${index}`,
          creativeMediaUrl: 'https://cdn.example.test/bulk.webp',
          creativeAltText: 'Bulk creative',
          isSponsored: true,
          sponsorLabel: 'Sponsored',
          status: 'ACTIVE',
          createdByAdminUserId: admin.adminUserId,
          updatedByAdminUserId: admin.adminUserId,
        });
        await database.db.insert(contentArticles).values({
          marketId: marketA,
          slug: `bulk-article-${index}`,
          title: `Bulk article ${index}`,
          excerpt: `Bulk excerpt ${index}`,
          body: `Bulk body ${index}`,
          status: 'ACTIVE',
          authorAdminUserId: admin.adminUserId,
          updatedByAdminUserId: admin.adminUserId,
        });
      }
      const home = await supertest(server)
        .get('/api/v1/members/content/home')
        .set(bearer(memberToken))
        .expect(200);
      const body = home.body as {
        ads: Array<Record<string, unknown>>;
        articles: Array<Record<string, unknown>>;
      };
      expect(body.ads).toHaveLength(10);
      expect(body.articles).toHaveLength(10);
      for (const article of body.articles) {
        expect('body' in article).toBe(false);
        expect(article['title']).toBeTruthy();
        expect(article['excerpt']).toBeTruthy();
      }
      expect((home.body as { as_of: string }).as_of).toBeTruthy();
    });
  },
);
