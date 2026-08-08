import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accounts,
  adminUsers,
  auditLogs,
  canonicalPermissionCodes,
  controlledRoleCodes,
  entityTimelines,
  migrate,
  roles,
  sessions,
} from '@ipoint/database';
import { asc, eq } from 'drizzle-orm';
import type { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { AccessAdministrationService } from './access-administration.service.js';
import { AuditService } from './audit.service.js';
import { AdminMarketContextService } from './admin-market-context.service.js';
import { MarketService } from './market.service.js';
import { RbacService } from './rbac.service.js';
import { seedFoundation } from '@ipoint/database/seeds/foundation';

const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)('market, RBAC, and audit integration', () => {
  let database: DatabaseService;
  let audit: AuditService;
  let marketsService: MarketService;
  let rbac: RbacService;
  let administration: AccessAdministrationService;
  let marketContext: AdminMarketContextService;
  let actorAdminUserId: string;
  let subjectAdminUserId: string;
  let supportRoleId: string;
  let marketId: string;
  let subjectAccountId: string;
  let subjectSessionId: string;

  beforeAll(async () => {
    database = new DatabaseService({ databaseUrl } as ConfigService);
    await migrate(database.pool);
    await seedFoundation(database.db);
    audit = new AuditService(database);
    marketsService = new MarketService(database, audit);
    rbac = new RbacService(database);
    administration = new AccessAdministrationService(database, audit);
    marketContext = new AdminMarketContextService(database, audit);

    const accountRows = await database.db
      .insert(accounts)
      .values([
        {
          publicId: `acct_${randomUUID()}`,
          email: `${randomUUID()}@example.com`,
          accountCountry: 'MY',
          status: 'ACTIVE',
        },
        {
          publicId: `acct_${randomUUID()}`,
          email: `${randomUUID()}@example.com`,
          accountCountry: 'MY',
          status: 'ACTIVE',
        },
      ])
      .returning({ id: accounts.id });
    const adminRows = await database.db
      .insert(adminUsers)
      .values([
        { accountId: accountRows[0]?.id ?? '', displayName: 'Actor' },
        { accountId: accountRows[1]?.id ?? '', displayName: 'Subject' },
      ])
      .returning({ id: adminUsers.id });
    actorAdminUserId = adminRows[0]?.id ?? '';
    subjectAdminUserId = adminRows[1]?.id ?? '';
    subjectAccountId = accountRows[1]?.id ?? '';
    const sessionRows = await database.db
      .insert(sessions)
      .values({
        accountId: subjectAccountId,
        familyId: randomUUID(),
        accessTokenHash: opaqueHash(),
        refreshTokenHash: opaqueHash(),
        accessExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .returning({ id: sessions.id });
    subjectSessionId = sessionRows[0]?.id ?? '';
    const roleRows = await database.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, 'SUPPORT_READONLY_AUDITOR'));
    supportRoleId = roleRows[0]?.id ?? '';
  });

  afterAll(async () => {
    await database.onApplicationShutdown();
  });

  it('persists the exact catalog/templates without Super Admin auto-expansion', async () => {
    const counts = await database.pool.query<{
      permissions: string;
      roles: string;
    }>(
      `SELECT
        (SELECT count(*) FROM permissions WHERE code = ANY($1::text[])) permissions,
        (SELECT count(*) FROM roles WHERE code = ANY($2::text[]) AND archived_at IS NULL) roles`,
      [canonicalPermissionCodes, controlledRoleCodes],
    );
    expect(counts.rows[0]).toEqual({ permissions: '71', roles: '6' });

    const futureCode = `future.unreviewed.${randomUUID()}`;
    await database.pool.query(
      'INSERT INTO permissions (code, description) VALUES ($1, $2)',
      [futureCode, 'Must not auto-expand a controlled role.'],
    );
    await seedFoundation(database.db);
    const autoGrant = await database.pool.query(
      `SELECT 1 FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE r.code = 'SUPER_ADMIN' AND p.code = $1`,
      [futureCode],
    );
    expect(autoGrant.rowCount).toBe(0);
  });

  it('creates an inactive global market and audits the privileged action', async () => {
    const market = await marketsService.create(
      {
        code: `T${randomUUID().replaceAll('-', '').slice(0, 5)}`,
        name: 'Test Market',
        currencyCode: 'MYR',
        timezone: 'Asia/Kuala_Lumpur',
        defaultLocale: 'en-MY',
      },
      { adminUserId: actorAdminUserId, reason: 'Integration test' },
    );
    marketId = market.id;
    expect(market.status).toBe('INACTIVE');
    await expect(marketsService.list()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: marketId })]),
    );
    await expect(
      marketsService.list({ includeInactive: true }),
    ).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: marketId })]),
    );
  });

  it('denies by default and requires role, action permission, and active market access', async () => {
    await expect(
      rbac.isAllowed({
        adminUserId: subjectAdminUserId,
        permission: 'audit.read',
      }),
    ).resolves.toBe(false);
    await administration.assignRole(subjectAdminUserId, supportRoleId, {
      adminUserId: actorAdminUserId,
      reason: 'Least privilege test',
    });
    await expect(
      rbac.isAllowed({
        adminUserId: subjectAdminUserId,
        permission: 'audit.read',
      }),
    ).resolves.toBe(true);
    await expect(
      rbac.isAllowed({
        adminUserId: subjectAdminUserId,
        permission: 'market.manage',
      }),
    ).resolves.toBe(false);
    await database.db
      .update(adminUsers)
      .set({ status: 'SUSPENDED' })
      .where(eq(adminUsers.id, subjectAdminUserId));
    await expect(
      rbac.isAllowed({
        adminUserId: subjectAdminUserId,
        permission: 'audit.read',
      }),
    ).resolves.toBe(false);
    await database.db
      .update(adminUsers)
      .set({ status: 'ACTIVE' })
      .where(eq(adminUsers.id, subjectAdminUserId));

    await marketsService.setStatus(marketId, 'ACTIVE', {
      adminUserId: actorAdminUserId,
      reason: 'Enable test market',
    });
    await administration.grantMarketAccess(subjectAdminUserId, marketId, {
      adminUserId: actorAdminUserId,
    });
    await expect(
      rbac.isAllowed({
        adminUserId: subjectAdminUserId,
        permission: 'audit.read',
        marketId,
      }),
    ).resolves.toBe(true);

    const otherMarket = await marketsService.create(
      {
        code: `T${randomUUID().replaceAll('-', '').slice(0, 5)}`,
        name: 'Other Market',
        currencyCode: 'SGD',
        timezone: 'Asia/Singapore',
        defaultLocale: 'en-SG',
      },
      { adminUserId: actorAdminUserId, reason: 'Cross-market denial test' },
    );
    await marketsService.setStatus(otherMarket.id, 'ACTIVE', {
      adminUserId: actorAdminUserId,
      reason: 'Cross-market denial test',
    });
    await expect(
      rbac.isAllowed({
        adminUserId: subjectAdminUserId,
        permission: 'audit.read',
        marketId: otherMarket.id,
      }),
    ).resolves.toBe(false);
  });

  it('bootstraps, switches, audits, and invalidates Current Admin Market', async () => {
    const actor = {
      type: 'ADMIN_USER' as const,
      accountId: subjectAccountId,
      adminUserId: subjectAdminUserId,
      sessionId: subjectSessionId,
    };
    await expect(marketContext.accessibleMarkets(actor)).resolves.toMatchObject(
      {
        currentMarketId: null,
        contextVersion: 1,
        items: expect.arrayContaining([
          expect.objectContaining({ id: marketId, isSelected: false }),
        ]),
      },
    );
    await expect(marketContext.bootstrap(actor)).resolves.toMatchObject({
      actor: { id: subjectAdminUserId },
      currentMarket: null,
      contextVersion: 1,
    });
    await expect(
      marketContext.selectCurrentMarket(
        actor,
        { marketId, expectedContextVersion: 1 },
        {
          adminUserId: subjectAdminUserId,
          requestId: 'p7-s2c-market-switch',
        },
      ),
    ).resolves.toMatchObject({ marketId, contextVersion: 2 });
    await expect(marketContext.bootstrap(actor)).resolves.toMatchObject({
      currentMarket: { id: marketId, isSelected: true },
      contextVersion: 2,
    });
    const switchAudit = await database.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.requestId, 'p7-s2c-market-switch'));
    expect(switchAudit).toEqual([{ action: 'admin.current_market.changed' }]);

    await expect(
      administration.revokeMarketAccess(subjectAdminUserId, marketId, {
        adminUserId: actorAdminUserId,
      }),
    ).resolves.toBe(true);
    await expect(marketContext.accessibleMarkets(actor)).resolves.toMatchObject(
      {
        currentMarketId: null,
        contextVersion: 3,
        items: [],
      },
    );
    await administration.grantMarketAccess(subjectAdminUserId, marketId, {
      adminUserId: actorAdminUserId,
    });
  });

  it('revokes market and role access immediately', async () => {
    await expect(
      administration.revokeMarketAccess(subjectAdminUserId, marketId, {
        adminUserId: actorAdminUserId,
      }),
    ).resolves.toBe(true);
    await expect(
      rbac.isAllowed({
        adminUserId: subjectAdminUserId,
        permission: 'audit.read',
        marketId,
      }),
    ).resolves.toBe(false);
    await administration.grantMarketAccess(subjectAdminUserId, marketId, {
      adminUserId: actorAdminUserId,
    });
    await expect(
      administration.revokeRole(subjectAdminUserId, supportRoleId, {
        adminUserId: actorAdminUserId,
      }),
    ).resolves.toBe(true);
    await expect(
      rbac.isAllowed({
        adminUserId: subjectAdminUserId,
        permission: 'audit.read',
      }),
    ).resolves.toBe(false);
  });

  it('redacts privileged before/after values and appends an entity timeline', async () => {
    const entityId = randomUUID();
    const requestId = randomUUID();
    await audit.recordPrivilegedAction({
      actor: { type: 'ADMIN_USER', id: actorAdminUserId },
      action: 'foundation.redaction.test',
      entity: { type: 'test_entity', id: entityId },
      before: { password: 'old-password', safe: 'before' },
      after: { nested: { accessToken: 'token-value', safe: 'after' } },
      result: 'SUCCESS',
      requestId,
      summary: 'Redaction verified.',
    });
    const auditRows = await database.db
      .select({
        actorType: auditLogs.actorType,
        actorId: auditLogs.actorId,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        requestId: auditLogs.requestId,
        occurredAt: auditLogs.occurredAt,
        before: auditLogs.before,
        after: auditLogs.after,
      })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, entityId));
    expect(auditRows[0]).toMatchObject({
      actorType: 'ADMIN_USER',
      actorId: actorAdminUserId,
      action: 'foundation.redaction.test',
      entityType: 'test_entity',
      entityId,
      requestId,
      before: { password: '[REDACTED]', safe: 'before' },
      after: { nested: { accessToken: '[REDACTED]', safe: 'after' } },
    });
    expect(auditRows[0]?.occurredAt).toBeInstanceOf(Date);
    await audit.recordPrivilegedAction({
      actor: { type: 'ADMIN_USER', id: actorAdminUserId },
      action: 'foundation.ordering.test',
      entity: { type: 'test_entity', id: entityId },
      result: 'SUCCESS',
      requestId,
      summary: 'Timeline ordering verified.',
    });
    const timelineRows = await database.db
      .select({
        eventType: entityTimelines.eventType,
        occurredAt: entityTimelines.occurredAt,
      })
      .from(entityTimelines)
      .where(eq(entityTimelines.entityId, entityId))
      .orderBy(asc(entityTimelines.occurredAt));
    expect(timelineRows).toHaveLength(2);
    expect(timelineRows.map((row) => row.eventType)).toEqual([
      'foundation.redaction.test',
      'foundation.ordering.test',
    ]);
    expect(timelineRows[0]?.occurredAt.getTime()).toBeLessThanOrEqual(
      timelineRows[1]?.occurredAt.getTime() ?? 0,
    );
  });
});

function opaqueHash(): string {
  return randomUUID().replaceAll('-', '').repeat(2);
}
