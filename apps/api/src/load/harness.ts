/**
 * P8-S6 load / performance / concurrency harness — shared boot, fixtures,
 * measurement and evidence recording.
 *
 * The harness boots the real NestJS application (AppModule) against a
 * dedicated fresh `ipoint_p8s6_*` PostgreSQL database, listens on an
 * ephemeral local port and drives every journey over real HTTP with Node's
 * built-in `fetch` (zero new dependencies, frozen lockfile). Latency samples,
 * error sets, storm assertions and DB/worker observations are recorded as raw
 * JSON evidence under the gitignored `.local/p8-s6-load/**` directory.
 *
 * Fail-closed: every entry point must pass the `P8S6_DESTRUCTIVE_TEST`
 * opt-in + dedicated-database guard from `guards.ts` before anything runs.
 *
 * @packageDocumentation
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  accounts,
  adminMfaFactors,
  adminStepUpGrants,
  adminUsers,
  marketAccess,
  marketTransactionSettings,
  markets,
  memberMarketPreferences,
  memberProfiles,
  memberQrIdentities,
  members,
  merchantAccountAccess,
  merchantBranches,
  merchantGroups,
  merchantPackageAssignments,
  mcpAccounts,
  migrate,
  rewardRuleVersions,
  roleAssignments,
  roles,
  serviceFeeProfiles,
  serviceFeeVersions,
  sessions,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { and, eq, isNull } from 'drizzle-orm';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';
import { AuthService } from '../auth/auth.service.js';
import { AUTH_RATE_LIMITER } from '../auth/auth.constants.js';
import type { InMemoryRateLimiter } from '../auth/rate-limit.port.js';
import { DatabaseService } from '../database/database.service.js';
import { AccessAdministrationService } from '../platform-access/access-administration.service.js';
import { MarketService } from '../platform-access/market.service.js';
import { RedemptionService } from '../redemption/redemption.service.js';
import { TransactionCommissionOutboxWorker } from '../transaction/transaction-commission-outbox.worker.js';
import { TransactionCorrectionService } from '../transaction/transaction-correction.service.js';
import { assertLoadTestAllowed } from './guards.js';

// ---------------------------------------------------------------------------
// Levels and scale. These are measurement profiles only — the report does
// NOT invent pass/fail thresholds (D-069 O-4); numbers are measured facts.
// ---------------------------------------------------------------------------

export type LoadLevel = 'L0' | 'L1' | 'L2';

export const LOAD_LEVELS: readonly LoadLevel[] = ['L0', 'L1', 'L2'];

export const LEVEL_CONCURRENCY: Record<LoadLevel, number> = {
  L0: 2,
  L1: 5,
  L2: 20,
};

export const LEVEL_ITERATIONS: Record<LoadLevel, number> = {
  L0: 3,
  L1: 10,
  L2: 20,
};

export const PASSWORD = 'P8-S6-Load-Password-123!';

// ---------------------------------------------------------------------------
// Evidence types
// ---------------------------------------------------------------------------

export interface OpSample {
  op: string;
  status: number;
  latencyMs: number;
  ok: boolean;
}

export interface AssertionRecord {
  name: string;
  pass: boolean;
  detail: string;
}

export interface JourneyOpResult {
  op: string;
  samples: OpSample[];
  throughputPerSecond: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errorCount: number;
  unexpectedErrorCount: number;
  statuses: Record<string, number>;
}

export interface JourneyResult {
  journeyId: string;
  journeyName: string;
  level: LoadLevel;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  ops: JourneyOpResult[];
  assertions: AssertionRecord[];
  observations: string[];
  notes: string[];
}

export interface LoadContext {
  level: LoadLevel;
  app: INestApplication;
  server: Server;
  baseUrl: string;
  auth: AuthService;
  database: DatabaseService;
  db: DatabaseService['db'];
  pool: DatabaseService['pool'];
  administration: AccessAdministrationService;
  marketService: MarketService;
  redemption: RedemptionService;
  outboxWorker: TransactionCommissionOutboxWorker;
  corrections: TransactionCorrectionService;
  world: LoadWorld;
  envStub: (key: string, value: string) => void;
}

export interface AdminActor {
  adminUserId: string;
  accountId: string;
  token: string;
}

export interface MemberActor {
  accountId: string;
  memberId: string;
  email: string;
  password: string;
  token: string;
}

export interface MerchantFixture {
  marketId: string;
  marketCode: string;
  branchId: string;
  mcpAccountId: string;
  merchantToken: string;
  memberId: string;
  memberToken: string;
  qrToken: string;
  packageId: string;
  memberAccountId: string;
}

export interface LoadWorld {
  marketId: string;
  marketCode: string;
  superAdmin: AdminActor;
  opsAdmin: AdminActor;
  supportAdmin: AdminActor;
  member: MemberActor;
  merchant: MerchantFixture;
}

// ---------------------------------------------------------------------------
// Measurement helpers
// ---------------------------------------------------------------------------

export function percentiles(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedMs.length) - 1;
  return sortedMs[Math.max(0, Math.min(index, sortedMs.length - 1))] ?? 0;
}

export interface RunConcurrentOptions {
  op: string;
  concurrency: number;
  iterations: number;
  call: () => Promise<{ status: number; latencyMs: number }>;
  /** Statuses that are "expected" for this op; anything else = unexpected error. */
  expectedStatuses: ReadonlySet<number>;
}

export interface RunConcurrentResult {
  samples: OpSample[];
  errorCount: number;
  unexpectedErrorCount: number;
}

export async function runConcurrentAsync(
  options: RunConcurrentOptions,
): Promise<RunConcurrentResult> {
  const { op, concurrency, iterations, call, expectedStatuses } = options;
  const samples: OpSample[] = [];
  let errorCount = 0;
  let unexpectedErrorCount = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let i = 0; i < iterations; i += 1) {
        let status = 0;
        try {
          const result = await call();
          status = result.status;
          if (status >= 400) errorCount += 1;
          if (!expectedStatuses.has(status)) unexpectedErrorCount += 1;
          samples.push({
            op,
            status,
            latencyMs: result.latencyMs,
            ok: status < 400,
          });
        } catch (error) {
          errorCount += 1;
          unexpectedErrorCount += 1;
          const msg = error instanceof Error ? error.message : String(error);
          samples.push({ op, status, latencyMs: 0, ok: false });
          console.error(`[load] transport error on ${op}: ${msg}`);
        }
      }
    }),
  );
  return { samples, errorCount, unexpectedErrorCount };
}

export interface RunStats {
  throughputPerSecond: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export function summarizeSamples(
  samples: OpSample[],
  wallMs: number,
): RunStats {
  const sorted = samples.map((s) => s.latencyMs).sort((a, b) => a - b);
  return {
    throughputPerSecond: wallMs > 0 ? (samples.length / wallMs) * 1000 : 0,
    p50Ms: percentiles(sorted, 50),
    p95Ms: percentiles(sorted, 95),
    p99Ms: percentiles(sorted, 99),
  };
}

export async function measureOp(
  ctx: LoadContext,
  result: JourneyResult,
  opName: string,
  expectedStatuses: ReadonlySet<number>,
  call: () => Promise<{ status: number; latencyMs: number }>,
  options: { scale?: number } = {},
): Promise<void> {
  const concurrency = Math.max(
    1,
    Math.round(LEVEL_CONCURRENCY[ctx.level] * (options.scale ?? 1)),
  );
  const iterations = Math.max(
    1,
    Math.round(LEVEL_ITERATIONS[ctx.level] * (options.scale ?? 1)),
  );
  const startedAt = performance.now();
  const { samples, errorCount, unexpectedErrorCount } =
    await runConcurrentAsync({
      op: opName,
      concurrency,
      iterations,
      call,
      expectedStatuses,
    });
  const wallMs = performance.now() - startedAt;
  const stats = summarizeSamples(samples, wallMs);
  const statuses: Record<string, number> = {};
  for (const sample of samples) {
    statuses[String(sample.status)] =
      (statuses[String(sample.status)] ?? 0) + 1;
  }
  result.ops.push({
    op: opName,
    samples,
    throughputPerSecond: stats.throughputPerSecond,
    p50Ms: stats.p50Ms,
    p95Ms: stats.p95Ms,
    p99Ms: stats.p99Ms,
    errorCount,
    unexpectedErrorCount,
    statuses,
  });
}

// ---------------------------------------------------------------------------
// HTTP helper (Node built-in fetch against the listening server)
// ---------------------------------------------------------------------------

export interface HttpCallOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  token?: string;
  idempotencyKey?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface HttpCallResult {
  status: number;
  latencyMs: number;
  body: unknown;
}

export async function httpCall(
  baseUrl: string,
  options: HttpCallOptions,
): Promise<HttpCallResult> {
  const startedAt = performance.now();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(options.headers ?? {}),
  };
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
  if (options.idempotencyKey)
    headers['idempotency-key'] = options.idempotencyKey;
  const response = await fetch(`${baseUrl}${options.path}`, {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const latencyMs = performance.now() - startedAt;
  let body: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  return { status: response.status, latencyMs, body };
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

export interface BootOptions {
  level: LoadLevel;
  /** Vitest specs stub env via vi.stubEnv; the standalone runner assigns process.env. */
  envStub?: (key: string, value: string) => void;
  /** Silence the pino logger (defaults to true). */
  silent?: boolean;
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

export async function bootLoadApp(options: BootOptions): Promise<LoadContext> {
  const databaseUrl = process.env['DATABASE_URL'];
  const { databaseName } = assertLoadTestAllowed(databaseUrl);
  const envStub =
    options.envStub ??
    ((key: string, value: string) => {
      process.env[key] = value;
    });

  // Deterministic environment for the app instance (mirrors the S1–S4 suites).
  const env: Record<string, string> = {
    DATABASE_URL: databaseUrl ?? '',
    REDIS_URL: 'redis://127.0.0.1:56379',
    AUTH_OTP_PEPPER: 'p8-s6-load-pepper-at-least-32-characters',
    REDEMPTION_VOUCHER_ENCRYPTION_KEY:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    NODE_ENV: 'test',
    LOG_LEVEL: options.silent === false ? 'info' : 'silent',
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
  const ctx: LoadContext = {
    level: options.level,
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

/**
 * Clear the in-memory auth rate limiter buckets. This is the exact
 * measurement methodology used by the established perf baselines (P2-S4D
 * `auth.performance.spec.ts`, P4-S7): buckets are cleared between measured
 * blocks so the measured endpoint cost excludes prior blocks' artificial
 * 429 responses. The limiter's 429 behaviour itself is covered by the auth
 * integration suites and is NOT part of the latency measurement.
 */
export function clearRateLimiter(ctx: LoadContext): void {
  const limiter = ctx.app.get<InMemoryRateLimiter>(AUTH_RATE_LIMITER);
  limiter.clear();
}

// ---------------------------------------------------------------------------
// World fixtures (shared baseline for all journeys)
// ---------------------------------------------------------------------------

async function buildWorld(
  database: DatabaseService,
  auth: AuthService,
): Promise<LoadWorld> {
  const market = await insertMarket(database);
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
  await selectMarket(database, superAdmin.accountId, market.id);
  await selectMarket(database, opsAdmin.accountId, market.id);
  await selectMarket(database, supportAdmin.accountId, market.id);
  return {
    marketId: market.id,
    marketCode: market.code,
    superAdmin,
    opsAdmin,
    supportAdmin,
    member,
    merchant,
  };
}

export async function insertMarket(
  database: DatabaseService,
): Promise<{ id: string; code: string }> {
  const code = `T${randomUUID().replaceAll('-', '').slice(0, 7)}`.toUpperCase();
  const rows = await database.db
    .insert(markets)
    .values({
      code,
      name: `${code} P8-S6 Load Market`,
      status: 'ACTIVE',
      currencyCode: 'MYR',
      timezone: 'Asia/Kuala_Lumpur',
      defaultLocale: 'en-MY',
    })
    .returning({ id: markets.id, code: markets.code });
  const marketId = rows[0]?.id ?? '';
  await database.db.insert(marketTransactionSettings).values({
    marketId,
    currencyCode: 'MYR',
    currencyScale: 2,
    minimumTransactionAmount: '1',
    maximumTransactionAmount: '10000',
  });
  return { id: marketId, code };
}

async function createAccountRaw(
  database: DatabaseService,
  auth: AuthService,
  emailOverride?: string,
): Promise<{ accountId: string; email: string }> {
  const email = emailOverride ?? `${randomUUID()}@example.com`;
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
  const accountId = rows[0]?.id ?? '';
  await auth.setPassword(accountId, PASSWORD);
  return { accountId, email };
}

export async function createAccount(
  database: DatabaseService,
  auth: AuthService,
): Promise<{ accountId: string; email: string }> {
  return createAccountRaw(database, auth);
}

export async function createAdmin(
  database: DatabaseService,
  auth: AuthService,
  marketIds: string[],
  roleCode: string,
): Promise<AdminActor> {
  const account = await createAccount(database, auth);
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
  if (marketIds.length > 0) {
    await database.db
      .insert(marketAccess)
      .values(marketIds.map((marketId) => ({ adminUserId, marketId })));
  }
  const session = await auth.createAdminSession(
    account.accountId,
    adminUserId,
    { ipAddress: '127.0.0.1', userAgent: 'p8-s6-load' },
  );
  return {
    adminUserId,
    accountId: account.accountId,
    token: session.accessToken,
  };
}

export async function createMember(
  database: DatabaseService,
  auth: AuthService,
  marketId: string,
  emailOverride?: string,
): Promise<MemberActor> {
  const account = await createAccountRaw(database, auth, emailOverride);
  const memberRows = await database.db
    .insert(members)
    .values({
      accountId: account.accountId,
      publicMemberId: `MEM${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      referralCode: randomUUID().replaceAll('-', '').slice(0, 10),
      status: 'ACTIVE',
      kycLevel: 'LEVEL_1',
    })
    .returning({ id: members.id });
  const memberId = memberRows[0]?.id ?? '';
  await database.db.insert(memberProfiles).values({
    memberId,
    displayName: 'P8-S6 Load Member',
  });
  await database.db.insert(memberMarketPreferences).values({
    memberId,
    marketId,
    isEnabled: true,
    isCurrent: true,
  });
  const login = await auth.login(account.email, PASSWORD);
  return {
    accountId: account.accountId,
    memberId,
    email: account.email,
    password: PASSWORD,
    token: login.accessToken,
  };
}

export async function createMerchantFixture(
  database: DatabaseService,
  auth: AuthService,
  marketId: string,
  createdByAdminUserId: string,
): Promise<MerchantFixture> {
  const merchantAccount = await createAccount(database, auth);
  const merchantToken = (await auth.login(merchantAccount.email, PASSWORD))
    .accessToken;

  const groupRows = await database.db
    .insert(merchantGroups)
    .values({
      accountId: merchantAccount.accountId,
      marketId,
      name: 'P8-S6 Merchant Group',
    })
    .returning({ id: merchantGroups.id });
  const groupId = groupRows[0]?.id ?? '';
  await database.db.insert(merchantAccountAccess).values({
    accountId: merchantAccount.accountId,
    merchantGroupId: groupId,
    accessType: 'PRIMARY_OWNER',
  });
  const branchRows = await database.db
    .insert(merchantBranches)
    .values({
      merchantGroupId: groupId,
      merchantId: `OF${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      marketId,
      name: 'P8-S6 Merchant',
      status: 'ACTIVE',
    })
    .returning({ id: merchantBranches.id });
  const branchId = branchRows[0]?.id ?? '';
  const mcpRows = await database.db
    .insert(mcpAccounts)
    .values({
      merchantBranchId: branchId,
      marketId,
      availableBalance: '5000',
      totalBalance: '5000',
      status: 'ACTIVE',
    })
    .returning({ id: mcpAccounts.id });
  const mcpAccountId = mcpRows[0]?.id ?? '';

  const profileRows = await database.db
    .insert(serviceFeeProfiles)
    .values({
      code: `PKG_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      name: 'P8-S6 Package',
      marketId,
    })
    .returning({ id: serviceFeeProfiles.id });
  const versionRows = await database.db
    .insert(serviceFeeVersions)
    .values({
      serviceFeeProfileId: profileRows[0]?.id ?? '',
      rate: '10',
      effectiveFrom: new Date(Date.now() - 60_000),
      status: 'ACTIVE',
      marketId,
    })
    .returning({ id: serviceFeeVersions.id });
  const assignmentRows = await database.db
    .insert(merchantPackageAssignments)
    .values({
      merchantBranchId: branchId,
      serviceFeeVersionId: versionRows[0]?.id ?? '',
      status: 'ACTIVE',
      isDefault: true,
    })
    .returning({ id: merchantPackageAssignments.id });
  const packageId = assignmentRows[0]?.id ?? '';

  const member = await createMember(database, auth, marketId);
  const qrToken = `qr-${randomUUID()}`;
  await database.db.insert(memberQrIdentities).values({
    memberId: member.memberId,
    publicQrId: `qr-public-${randomUUID()}`,
    tokenHash: createHash('sha256').update(qrToken).digest('hex'),
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });

  // Active reward rule for the market (the transaction confirm rewards the
  // member at this rate; without a rule the confirm produces no reward link).
  await database.db.insert(rewardRuleVersions).values({
    name: 'P8-S6 Load Reward Rule',
    effectiveFrom: new Date(Date.now() - 60_000),
    rewardRate: '0.05',
    capType: 'FLAT',
    capValue: '1000',
    minimumReward: '0',
    marketId,
    createdBy: createdByAdminUserId,
  });

  return {
    marketId,
    marketCode: 'MY',
    branchId,
    mcpAccountId,
    merchantToken,
    memberId: member.memberId,
    memberToken: member.token,
    qrToken,
    packageId,
    memberAccountId: member.accountId,
  };
}

export async function selectMarket(
  database: DatabaseService,
  accountId: string,
  marketId: string,
): Promise<void> {
  const sessionRows = await database.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt)))
    .orderBy(sessions.createdAt)
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

export async function seedStepUpGrant(
  ctx: LoadContext,
  admin: AdminActor,
  actionClass: string,
  marketId: string,
): Promise<string> {
  const token = `stepup_${randomUUID()}${randomUUID()}`;
  const sessionRows = await ctx.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(eq(sessions.accountId, admin.accountId), isNull(sessions.revokedAt)),
    )
    .orderBy(sessions.createdAt)
    .limit(1);
  const sessionId = sessionRows[0]?.id;
  if (!sessionId) throw new Error('No active session for step-up grant.');
  const factorRows = await ctx.db
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
  if (!factorId) throw new Error('No active MFA factor for step-up grant.');
  const issuedAt = new Date();
  await ctx.db.insert(adminStepUpGrants).values({
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

// ---------------------------------------------------------------------------
// Journey result helpers
// ---------------------------------------------------------------------------

export function newJourneyResult(
  ctx: LoadContext,
  journeyId: string,
  journeyName: string,
): JourneyResult {
  return {
    journeyId,
    journeyName,
    level: ctx.level,
    startedAt: new Date().toISOString(),
    endedAt: '',
    durationMs: 0,
    ops: [],
    assertions: [],
    observations: [],
    notes: [],
  };
}

export function finishJourneyResult(result: JourneyResult): JourneyResult {
  result.endedAt = new Date().toISOString();
  result.durationMs = Date.parse(result.endedAt) - Date.parse(result.startedAt);
  return result;
}

// ---------------------------------------------------------------------------
// Evidence recording (gitignored .local/p8-s6-load/**)
// ---------------------------------------------------------------------------

export function recordRunEvidence(
  ctx: LoadContext,
  results: JourneyResult[],
  runId: string,
): string {
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const dir = join(
    process.cwd(),
    '.local',
    'p8-s6-load',
    `${timestamp}-${runId}`,
  );
  mkdirSync(dir, { recursive: true });
  const summary = {
    runId,
    level: ctx.level,
    startedAt: results[0]?.startedAt ?? new Date().toISOString(),
    endedAt: results[results.length - 1]?.endedAt ?? new Date().toISOString(),
    databaseName: process.env['DATABASE_URL'] ?? '',
    journeys: results.map((result) => ({
      journeyId: result.journeyId,
      journeyName: result.journeyName,
      level: result.level,
      durationMs: result.durationMs,
      ops: result.ops.map((op) => ({
        op: op.op,
        samples: op.samples.length,
        throughputPerSecond: Number(op.throughputPerSecond.toFixed(2)),
        p50Ms: Number(op.p50Ms.toFixed(2)),
        p95Ms: Number(op.p95Ms.toFixed(2)),
        p99Ms: Number(op.p99Ms.toFixed(2)),
        errorCount: op.errorCount,
        unexpectedErrorCount: op.unexpectedErrorCount,
        statuses: op.statuses,
      })),
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
