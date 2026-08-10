/**
 * P8-S8 Full Final UAT — harness (boot, world fixtures, evidence).
 *
 * Boots the real NestJS application (AppModule) against a dedicated fresh
 * `ipoint_p8s8_*` PostgreSQL database (drop/create + migrate + foundation
 * seed), listens on an ephemeral local port and drives every U-01..U-36
 * scenario over real HTTP with Node's built-in `fetch`. Raw evidence is
 * recorded under the gitignored `.local/p8-s8-uat/**` directory.
 *
 * Fail-closed: every entry point must pass the `P8S8_DESTRUCTIVE_TEST`
 * opt-in + dedicated-database guard from `guards.ts` before anything runs.
 *
 * The world-building helpers (admin/member/merchant fixtures, role
 * permission grants, MFA/step-up seeding, rate-limiter clearing) are reused
 * from the S6 load harness — UAT is the acceptance-context execution of the
 * same frozen API surface (brief §3.4: reuse structure, add explicit
 * business assertions per scenario).
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrate, markets } from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import { AccessAdministrationService } from '../platform-access/access-administration.service.js';
import { MarketService } from '../platform-access/market.service.js';
import { RedemptionService } from '../redemption/redemption.service.js';
import { TransactionCommissionOutboxWorker } from '../transaction/transaction-commission-outbox.worker.js';
import { TransactionCorrectionService } from '../transaction/transaction-correction.service.js';
import {
  createAdmin,
  createMember,
  createMerchantFixture,
  ensureRolePermissions,
  insertMarket,
  selectMarket,
} from '../load/harness.js';
import type {
  AdminActor,
  LoadContext,
  JourneyResult,
  LoadWorld,
} from '../load/harness.js';
import { assertUatAllowed } from './guards.js';

export interface UatContext extends Omit<LoadContext, 'world'> {
  world: UatWorld;
}

/** Permission union exercised by the U-01..U-36 scenarios (super-admin role). */
export const UAT_SUPER_ADMIN_PERMISSIONS: readonly string[] = [
  'admin.market.select',
  'dashboard.view',
  'member.read',
  'member.status.manage',
  'member.note.read',
  'member.note.create',
  'member.kyc.read',
  'member.kyc.decide',
  'merchant.view',
  'merchant.mcp.view',
  'merchant.mcp.adjust',
  'merchant.mcp.adjust.approve',
  'merchant.mcp.adjust.execute',
  'merchant.package.view',
  'merchant.package.manage',
  'merchant.package.assign',
  'merchant.special_package.manage',
  'merchant.approve',
  'merchant.suspend',
  'reward.rule.read',
  'reward.rule.schedule',
  'redemption.rate.read',
  'commission.rate.read',
  'commission.read',
  'market.read',
  'agent.read',
  'redemption.order.read',
  'redemption.refund.create',
  'redemption.refund.approve',
  'redemption.fulfilment.manage',
  'wallet.ipoint.read',
  'wallet.ipoint.adjust.maker',
  'wallet.ipoint.adjust.checker',
  'wallet.ipoint.adjust.execute',
  'audit.read',
  'audit.sensitive-diff.view',
  'report.read',
  'ads.manage',
  'ads.view',
  'content.manage',
  'content.view',
  'reconciliation.run',
  'reconciliation.view',
  'reconciliation.exception.manage',
  'risk.view',
  'risk.review.manage',
];

export interface UatWorld extends LoadWorld {
  secondaryMarketId: string;
  supportAdmin: AdminActor;
}

async function dropAndCreateDatabase(
  databaseUrl: string,
  databaseName: string,
): Promise<void> {
  const maintenanceUrl = databaseUrl.replace(/\/[^/]+$/u, '/postgres');
  const { Pool } = await import('pg');
  const maintenance = new Pool({ connectionString: maintenanceUrl });
  try {
    await maintenance.query(
      `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
    );
    await maintenance.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await maintenance.end();
  }
}

export async function bootUatApp(): Promise<UatContext> {
  const databaseUrl = process.env['DATABASE_URL'];
  const { databaseName } = assertUatAllowed(databaseUrl);
  const envStub = (key: string, value: string): void => {
    process.env[key] = value;
  };

  const env: Record<string, string> = {
    DATABASE_URL: databaseUrl ?? '',
    REDIS_URL: 'redis://127.0.0.1:56379',
    AUTH_OTP_PEPPER: 'p8-s8-uat-pepper-at-least-32-characters',
    REDEMPTION_VOUCHER_ENCRYPTION_KEY:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  };
  for (const [key, value] of Object.entries(env)) envStub(key, value);

  await dropAndCreateDatabase(databaseUrl ?? '', databaseName);

  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = module.createNestApplication();
  configureApplication(app, {
    enableShutdownHooks: false,
    scanSwaggerRoutes: false,
  });
  const database = app.get(DatabaseService);
  await migrate(database.pool);
  await seedFoundation(database.db);
  await app.init();
  const server = app.getHttpServer() as Server;
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port =
    typeof address === 'object' && address !== null ? address.port : 0;

  const auth = app.get(AuthService);
  const ctx: UatContext = {
    level: 'L0',
    app,
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    auth,
    database,
    db: database.db,
    pool: database.pool,
    administration: app.get(AccessAdministrationService),
    marketService: app.get(MarketService),
    redemption: app.get(RedemptionService),
    outboxWorker: app.get(TransactionCommissionOutboxWorker),
    corrections: app.get(TransactionCorrectionService),
    world: await buildWorld(database, auth),
    envStub,
  };
  return ctx;
}

async function buildWorld(
  database: DatabaseService,
  auth: AuthService,
): Promise<UatWorld> {
  const market = await insertMarket(database);
  // The canonical Malaysia market (code MY): member registration resolves
  // the member's wallet market from account_country against markets.code
  // (auth.service.ts:589), so the UAT world must include the MY market for
  // the registration journeys (U-01, U-08) to run over the public API.
  await database.db
    .insert(markets)
    .values({
      code: 'MY',
      name: 'Malaysia (UAT canonical)',
      status: 'ACTIVE',
      currencyCode: 'MYR',
      timezone: 'Asia/Kuala_Lumpur',
      defaultLocale: 'en-MY',
    })
    .onConflictDoNothing({ target: markets.code });
  // Secondary (foreign) market for market-switching and cross-market denial.
  const secondaryRows = await database.db
    .insert(markets)
    .values({
      code: `U${randomUUID().replaceAll('-', '').slice(0, 7)}`.toUpperCase(),
      name: 'P8-S8 UAT Secondary Market',
      status: 'ACTIVE',
      currencyCode: 'SGD',
      timezone: 'Asia/Singapore',
      defaultLocale: 'en-SG',
    })
    .returning({ id: markets.id });
  const secondaryMarketId = secondaryRows[0]?.id ?? '';

  const superAdmin = await createAdmin(
    database,
    auth,
    [market.id],
    'SUPER_ADMIN',
  );
  const opsAdmin = await createAdmin(
    database,
    auth,
    [market.id],
    'OPERATIONS_ADMIN',
  );
  const supportAdmin = await createAdmin(
    database,
    auth,
    [market.id],
    'SUPPORT_READONLY_AUDITOR',
  );
  const member = await createMember(database, auth, market.id);
  const merchant = await createMerchantFixture(
    database,
    auth,
    market.id,
    superAdmin.adminUserId,
  );
  // Merchant discovery surfaces require is_publicly_visible = true
  // (discovery.service.ts queryMerchants condition) plus a merchant_profiles
  // row (the discovery query INNER JOINs merchant_profiles) — fixture
  // attributes the S6 world builder does not set.
  await database.pool.query(
    `UPDATE merchant_branches SET is_publicly_visible = true WHERE id = $1`,
    [merchant.branchId],
  );
  await database.pool.query(
    `INSERT INTO merchant_profiles (merchant_branch_id)
     VALUES ($1)
     ON CONFLICT DO NOTHING`,
    [merchant.branchId],
  );
  // Registration referral codes are normalized to UPPERCASE at initiate
  // (auth.service.ts) and matched exactly against members.referral_code at
  // complete; the S6 world builder generates lowercase codes — normalize
  // the fixture so the U-08 referral journey resolves (product-generated
  // codes are already uppercase, e.g. 'UAETX8TB').
  await database.pool.query(
    `UPDATE members SET referral_code = upper(referral_code) WHERE id = $1`,
    [merchant.memberId],
  );
  await selectMarket(database, superAdmin.accountId, market.id);
  await selectMarket(database, opsAdmin.accountId, market.id);
  await selectMarket(database, supportAdmin.accountId, market.id);
  // Seed an ACTIVE TOTP factor for the super admin so step-up-gated
  // surfaces (special percentages U-10, raw audit U-18) can obtain grants.
  await database.pool.query(
    `INSERT INTO admin_mfa_factors (
        account_id, admin_user_id, factor_type, secret_ciphertext,
        secret_nonce, secret_auth_tag, key_id, algorithm, status,
        confirmed_at
       ) VALUES ($1, $2, 'TOTP', $3, $3, $3, 'uat-key', 'AES-256-GCM',
                 'ACTIVE', now())
     ON CONFLICT DO NOTHING`,
    [
      superAdmin.accountId,
      superAdmin.adminUserId,
      `cipher-${randomUUID().replaceAll('-', '')}`,
    ],
  );
  const world: UatWorld = {
    marketId: market.id,
    marketCode: market.code,
    superAdmin,
    opsAdmin,
    supportAdmin,
    member,
    merchant,
    secondaryMarketId,
  };
  // Grant the scenario permission union to the super-admin role.
  const ctxStub = {
    db: database.db,
  } as unknown as UatContext;
  await ensureRolePermissions(ctxStub, 'SUPER_ADMIN', [
    ...UAT_SUPER_ADMIN_PERMISSIONS,
  ]);
  return world;
}

// ---------------------------------------------------------------------------
// Evidence recording (gitignored .local/p8-s8-uat/**)
// ---------------------------------------------------------------------------

export function recordUatEvidence(
  ctx: UatContext,
  results: JourneyResult[],
  runId: string,
): string {
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const dir = join(
    process.cwd(),
    '.local',
    'p8-s8-uat',
    `${timestamp}-${runId}`,
  );
  mkdirSync(dir, { recursive: true });
  const summary = {
    runId,
    startedAt: results[0]?.startedAt ?? new Date().toISOString(),
    endedAt: results[results.length - 1]?.endedAt ?? new Date().toISOString(),
    databaseName: process.env['DATABASE_URL'] ?? '',
    scenarios: results.map((result) => ({
      scenarioId: result.journeyId,
      scenarioName: result.journeyName,
      durationMs: result.durationMs,
      assertionCount: result.assertions.length,
      passedAssertions: result.assertions.filter((a) => a.pass).length,
      failedAssertions: result.assertions.filter((a) => !a.pass).length,
      assertions: result.assertions,
      observations: result.observations,
      notes: result.notes,
    })),
  };
  writeFileSync(
    join(dir, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf-8',
  );
  for (const result of results) {
    writeFileSync(
      join(dir, `${result.journeyId}.json`),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf-8',
    );
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Degraded boot for U-31 (network/API failure contract)
// ---------------------------------------------------------------------------

export interface DegradedApp {
  app: INestApplication;
  server: Server;
  baseUrl: string;
}

/**
 * Boot a second app instance with environment overrides (e.g. a dead
 * REDIS_URL or DATABASE_URL) WITHOUT dropping/recreating the database, for
 * the U-31 downstream-unavailable contract probes. The caller closes it.
 */
export async function bootDegradedApp(
  overrides: Record<string, string>,
): Promise<DegradedApp> {
  const env: Record<string, string> = {
    DATABASE_URL: process.env['DATABASE_URL'] ?? '',
    REDIS_URL: 'redis://127.0.0.1:56379',
    AUTH_OTP_PEPPER: 'p8-s8-uat-pepper-at-least-32-characters',
    REDEMPTION_VOUCHER_ENCRYPTION_KEY:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    ...overrides,
  };
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = module.createNestApplication();
    configureApplication(app, {
      enableShutdownHooks: false,
      scanSwaggerRoutes: false,
    });
    await app.init();
    const server = app.getHttpServer() as Server;
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    return { app, server, baseUrl: `http://127.0.0.1:${port}` };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
