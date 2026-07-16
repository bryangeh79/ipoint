import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accounts,
  adminUsers,
  auditLogs,
  entityTimelines,
  migrate,
  roles,
} from '@ipoint/database';
import { eq } from 'drizzle-orm';
import type { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { AccessAdministrationService } from './access-administration.service.js';
import { AuditService } from './audit.service.js';
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
  let actorAdminUserId: string;
  let subjectAdminUserId: string;
  let viewerRoleId: string;
  let marketId: string;

  beforeAll(async () => {
    database = new DatabaseService({ databaseUrl } as ConfigService);
    await migrate(database.pool);
    await seedFoundation(database.db);
    audit = new AuditService(database);
    marketsService = new MarketService(database, audit);
    rbac = new RbacService(database);
    administration = new AccessAdministrationService(database, audit);

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
    const roleRows = await database.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, 'VIEWER'));
    viewerRoleId = roleRows[0]?.id ?? '';
  });

  afterAll(async () => {
    await database.onApplicationShutdown();
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
        permission: 'audit.view',
      }),
    ).resolves.toBe(false);
    await administration.assignRole(subjectAdminUserId, viewerRoleId, {
      adminUserId: actorAdminUserId,
      reason: 'Least privilege test',
    });
    await expect(
      rbac.isAllowed({
        adminUserId: subjectAdminUserId,
        permission: 'audit.view',
      }),
    ).resolves.toBe(true);
    await expect(
      rbac.isAllowed({
        adminUserId: subjectAdminUserId,
        permission: 'market.manage',
      }),
    ).resolves.toBe(false);

    await administration.grantMarketAccess(subjectAdminUserId, marketId, {
      adminUserId: actorAdminUserId,
    });
    await expect(
      rbac.isAllowed({
        adminUserId: subjectAdminUserId,
        permission: 'audit.view',
        marketId,
      }),
    ).resolves.toBe(false);
    await marketsService.setStatus(marketId, 'ACTIVE', {
      adminUserId: actorAdminUserId,
      reason: 'Enable test market',
    });
    await expect(
      rbac.isAllowed({
        adminUserId: subjectAdminUserId,
        permission: 'audit.view',
        marketId,
      }),
    ).resolves.toBe(true);
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
        permission: 'audit.view',
        marketId,
      }),
    ).resolves.toBe(false);
    await administration.grantMarketAccess(subjectAdminUserId, marketId, {
      adminUserId: actorAdminUserId,
    });
    await expect(
      administration.revokeRole(subjectAdminUserId, viewerRoleId, {
        adminUserId: actorAdminUserId,
      }),
    ).resolves.toBe(true);
    await expect(
      rbac.isAllowed({
        adminUserId: subjectAdminUserId,
        permission: 'audit.view',
      }),
    ).resolves.toBe(false);
  });

  it('redacts privileged before/after values and appends an entity timeline', async () => {
    const entityId = randomUUID();
    await audit.recordPrivilegedAction({
      actor: { type: 'ADMIN_USER', id: actorAdminUserId },
      action: 'foundation.redaction.test',
      entity: { type: 'test_entity', id: entityId },
      before: { password: 'old-password', safe: 'before' },
      after: { nested: { accessToken: 'token-value', safe: 'after' } },
      result: 'SUCCESS',
      summary: 'Redaction verified.',
    });
    const auditRows = await database.db
      .select({ before: auditLogs.before, after: auditLogs.after })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, entityId));
    expect(auditRows[0]).toEqual({
      before: { password: '[REDACTED]', safe: 'before' },
      after: { nested: { accessToken: '[REDACTED]', safe: 'after' } },
    });
    const timelineRows = await database.db
      .select({ id: entityTimelines.id })
      .from(entityTimelines)
      .where(eq(entityTimelines.entityId, entityId));
    expect(timelineRows).toHaveLength(1);
  });
});
