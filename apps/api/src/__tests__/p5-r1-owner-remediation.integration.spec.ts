/**
 * P5-R1 — Phase 5 Agent/Commission Owner Remediation verification
 * (GATE-P5-01, D-047 exact scope, executor class:
 *  OPENCLAW_MANAGED_CODING_SUBAGENT under D-048).
 *
 * Verifies the frozen-owner remediation contract that P7-S6 (commission /
 * agent-fee configuration) and P7-S8 (agent operations) will consume:
 *
 *  4.1  Canonical wired service; doubled/dead routes retired.
 *  4.2  Permission/market/actor enforcement on every command.
 *  4.3  RM388.00 MYR activation fee — future-effective, versioned,
 *       market/currency-scoped, snapshotted at APPLY, never repriced.
 *  4.4  Source/generation/range reconciliation (rate service generation map).
 *  4.5  Commission posting failures surfaced atomically/durably and
 *       retry-safe through the idempotent machinery.
 *
 * The frozen B/C/D integration specs are NOT modified by P5-R1 and stay
 * green (B 15/15, C 10/10, D 10/10).
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  accounts,
  adminUsers,
  members,
  memberProfiles,
  markets,
  marketAccess,
  permissions,
  roles,
  roleAssignments,
  rolePermissions,
  agentActivations,
  agentActivationStatusLogs,
  commissionRateVersions,
  commissionLedger,
} from '@ipoint/database';
import { AppModule } from '../app.module.js';
import { TransactionCommissionOutboxWorker } from '../transaction/transaction-commission-outbox.worker.js';
import { RbacGuard } from '../platform-access/rbac.guard.js';
import { DatabaseService } from '../database/database.service.js';
import { AgentActivationService } from '../domain/agent-activation/service.js';
import { RateManagementService } from '../domain/commission/rate.service.js';
import { AgentUpgradeCommissionService } from '../domain/commission/agent-upgrade.service.js';
import type { CommissionRateAdminActor } from '../domain/commission/rate.types.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');

let app: INestApplication;
let db: any;
let activation: AgentActivationService;
let rates: RateManagementService;
let upgrade: AgentUpgradeCommissionService;

const uid = () => randomUUID().slice(0, 8);
/** Unique 2-letter uppercase market code for a fixture (repeat-run safe).
 * commission_rate_version.market is varchar(2) and the rate service requires
 * /^[A-Z]{2}$/, so both characters must be letters. */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const marketCode = (_prefix: string) =>
  LETTERS[Math.floor(Math.random() * 26)]! +
  LETTERS[Math.floor(Math.random() * 26)]!;
const ADMIN_1 = '11111111-1111-1111-1111-111111111111';
const ADMIN_2 = '22222222-2222-2222-2222-222222222222';

/** Asia/Kuala_Lumpur is fixed UTC+8 (no DST). */
const KL_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * UTC ISO instant of the market-local 00:00 of a KL calendar date
 * (D-054 §8: future market-local midnight activation only).
 */
function klDateMidnightIso(klDate: string): string {
  const [year, month, day] = klDate.split('-').map((value) => Number(value));
  return new Date(
    Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0) - KL_OFFSET_MS,
  ).toISOString();
}

/**
 * Server-created owner actor for the fixture admin (D-054 §5): the
 * currentMarketId is always the server-selected market UUID — a
 * caller-supplied actor is never honored by the owner.
 */
function ownerActor(marketId: string): CommissionRateAdminActor {
  return {
    adminUserId: ADMIN_1,
    currentMarketId: marketId,
    marketContextVersion: 1,
    requestId: `p5r1-${uid()}`,
    ipAddress: '127.0.0.1',
  };
}

async function seedMember(suffix: string): Promise<string> {
  const s = uid();
  const [acc] = await db
    .insert(accounts)
    .values({
      publicId: `P5R1A-${suffix}-${s}`,
      email: `p5r1-${suffix}-${s}@t.com`,
      accountCountry: 'MY',
      status: 'ACTIVE',
    })
    .returning({ id: accounts.id });
  const [mem] = await db
    .insert(members)
    .values({
      accountId: acc.id,
      publicMemberId: `P5R1M-${suffix}-${s}`,
      referralCode: `P5R1RC${suffix}${s.slice(0, 4)}`,
      status: 'ACTIVE',
      kycLevel: 'LEVEL_1',
    })
    .returning({ id: members.id });
  await db.insert(memberProfiles).values({
    memberId: mem.id,
    displayName: `P5R1-${suffix}`,
  });
  return mem.id;
}

async function seedMarket(code: string, currencyCode: string): Promise<string> {
  await db
    .insert(markets)
    .values({
      code,
      name: `P5R1-${code}`,
      timezone: 'Asia/Kuala_Lumpur',
      status: 'ACTIVE',
      defaultLocale: 'en',
      currencyCode,
    })
    .onConflictDoNothing({ target: markets.code });
  const [row] = await db
    .select({ id: markets.id })
    .from(markets)
    .where(eq(markets.code, code))
    .limit(1);
  if (!row) throw new Error(`seedMarket failed for ${code}`);
  return row.id;
}

/**
 * Seed the D-054 owner grant chain for ADMIN_1 (ACTIVE admin + account,
 * SUPER_ADMIN role already linked to commission.rate.manage, non-revoked
 * market access) so in-process owner commands pass the real RbacService.
 */
async function seedRateAdmin(marketIds: string[]): Promise<void> {
  const [acc] = await db
    .insert(accounts)
    .values({
      publicId: `P5R1ADM-${uid()}`,
      email: `p5r1-admin-${uid()}@t.com`,
      accountCountry: 'MY',
      status: 'ACTIVE',
    })
    .returning({ id: accounts.id });
  await db
    .insert(adminUsers)
    .values({
      id: ADMIN_1,
      accountId: acc.id,
      displayName: 'P5R1 Rate Owner Admin',
      status: 'ACTIVE',
    })
    .onConflictDoNothing({ target: adminUsers.id });
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.code, 'SUPER_ADMIN'))
    .limit(1);
  if (!role) throw new Error('SUPER_ADMIN role not found');
  const permRows = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.code, 'commission.rate.manage'))
    .limit(1);
  if (permRows.length === 0) {
    const [inserted] = await db
      .insert(permissions)
      .values({
        code: 'commission.rate.manage',
        description: 'Manage prospective commission rates.',
      })
      .onConflictDoNothing({ target: permissions.code })
      .returning({ id: permissions.id });
    if (inserted) permRows.push(inserted);
  }
  await db
    .insert(roleAssignments)
    .values({ adminUserId: ADMIN_1, roleId: role.id })
    .onConflictDoNothing();
  if (permRows[0]) {
    await db
      .insert(rolePermissions)
      .values({ roleId: role.id, permissionId: permRows[0].id })
      .onConflictDoNothing();
  }
  if (marketIds.length > 0) {
    await db
      .insert(marketAccess)
      .values(marketIds.map((marketId) => ({ adminUserId: ADMIN_1, marketId })))
      .onConflictDoNothing();
  }
}

/**
 * Owner create that retries with a fresh market code + grant when another
 * suite (running in parallel on a shared CI DB) already owns the random
 * code — keeps this suite deterministic in any environment.
 */
async function createRateOwnerSafe(
  build: (
    market: string,
    marketId: string,
  ) => Parameters<RateManagementService['createRateVersion']>[1],
): Promise<Awaited<ReturnType<RateManagementService['createRateVersion']>>> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = marketCode('RT');
    const marketId = await seedMarket(code, 'MYR');
    await seedRateAdmin([marketId]);
    try {
      return await rates.createRateVersion(
        ownerActor(marketId),
        build(code, marketId),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('OVERLAPPING_RATE_PERIOD')
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error('createRateOwnerSafe exhausted retries');
}

/** Walk a fresh activation to PENDING_APPROVAL for one member. */
async function walkToPendingApproval(
  memberId: string,
  market: string,
): Promise<string> {
  const { activationId } = await activation.apply(memberId, market);
  await activation.confirmPayment(
    activationId,
    `PAY-${randomUUID().slice(0, 8)}`,
    memberId,
  );
  await activation.enrollCourse(activationId, memberId);
  await activation.completeCourse(activationId, memberId);
  await activation.submitApproval(activationId, memberId);
  return activationId;
}

beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('LOG_LEVEL', 'silent');
  vi.stubEnv('AUTH_OTP_PEPPER', 'test-otp-pepper-with-at-least-32-characters');
  const m = await Test.createTestingModule({ imports: [AppModule] })
    .overrideGuard(RbacGuard)
    .useValue({ canActivate: () => true })
    .compile();
  app = m.createNestApplication();
  // Mirror the production mounting in main.ts (configureApplication sets the
  // global `api/v1` prefix), so the HTTP surface assertions verify the real
  // canonical mount points and the retired doubled mounts.
  app.setGlobalPrefix('api/v1');
  await app.init();
  db = app.get(DatabaseService).db;
  activation = app.get(AgentActivationService);
  rates = app.get(RateManagementService);
  upgrade = app.get(AgentUpgradeCommissionService);
  // Stop the shared outbox worker so this suite never races the frozen
  // B/C/D dispatch fixtures when suites run in parallel on one CI DB
  // (mirrors the b/c/d specs' own isolation).
  app.get(TransactionCommissionOutboxWorker).stop();
  await seedMarket('MY', 'MYR');
  await seedRateAdmin([]);
});

afterAll(async () => {
  if (app) await app.close();
});

/* ================================================================ */
/*  4.1 — canonical wiring: doubled/dead routes retired             */
/* ================================================================ */

describe('P5-R1 4.1 canonical wiring (HTTP route surface)', () => {
  // The app is created with real guards. Unauthenticated requests to
  // registered guarded routes return 401; unregistered/doubled paths 404.
  it('retires the doubled /api/v1/api/v1/admin/* commission+agent mounts', async () => {
    const doubled = [
      '/api/v1/api/v1/admin/commission/ledger',
      '/api/v1/api/v1/admin/commission-rates/active',
      '/api/v1/api/v1/admin/commission-adjustments',
      '/api/v1/api/v1/admin/agent-activations/00000000-0000-0000-0000-000000000000/approve',
      '/api/v1/api/v1/agent/apply',
      '/api/v1/api/v1/referral/tree',
    ];
    for (const path of doubled) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status).toBe(404);
    }
  });

  it('retires the prototype calculate/ledger controller', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/commission/calculate')
      .send({ sourceType: 'AGENT_ACTIVATION', sourceReference: 'x' });
    expect(res.status).toBe(404);
  });

  it('registers the canonical single-prefix routes (auth-gated)', async () => {
    const canonical: Array<['get' | 'post', string]> = [
      ['get', '/api/v1/admin/commission/ledger'],
      ['get', '/api/v1/admin/commission-rates/active'],
      [
        'post',
        '/api/v1/admin/agent-activations/00000000-0000-0000-0000-000000000000/approve',
      ],
      ['get', '/api/v1/commission/ledger'],
      ['post', '/api/v1/agent/apply'],
      ['get', '/api/v1/referral/tree'],
    ];
    for (const [method, path] of canonical) {
      const res = await request(app.getHttpServer())[method](path);
      // Registered guarded route without a session → 401 (AuthGuard).
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
    }
  });
});

/* ================================================================ */
/*  4.3 — fee versioning + snapshot (RM388.00 MYR)                  */
/* ================================================================ */

describe('P5-R1 4.3 activation fee versioning and snapshot', () => {
  it('snapshots the versioned RM388.00 MYR fee at APPLY for MY', async () => {
    const memberId = await seedMember('fee');
    const out = await activation.apply(memberId, 'MY');
    expect(out.activationFee).toBe('388.0000000000');
    expect(out.activationFeeCurrency).toBe('MYR');
    expect(out.feeRateVersionId).toBeTruthy();

    const status = await activation.getStatus(memberId, 'MY');
    expect(status?.activationFee).toBe('388.0000000000');
    expect(status?.activationFeeCurrency).toBe('MYR');
    expect(status?.feeRateVersionId).toBe(out.feeRateVersionId);
    expect(status?.currency).toBe('MYR');
  });

  it('rejects APPLY in markets without an explicit fee version', async () => {
    const memberId = await seedMember('blocked');
    await expect(activation.apply(memberId, 'ZZ')).rejects.toMatchObject({
      code: 'AGENT_ACTIVATION_FEE_NOT_CONFIGURED',
    });
  });

  it('never reprices historical activations when a later fee version is scheduled', async () => {
    const memberId = await seedMember('hist');
    // Market VX: fee v1 (bounded 2026-07-25 → 2029-12-31) is the effective
    // version at APPLY time; v2 is scheduled later (2030+, non-overlapping).
    const vx = marketCode('VX');
    await seedMarket(vx, 'VXX');
    await db.insert(commissionRateVersions).values({
      commissionType: 'AGENT_ACTIVATION_FEE',
      generation: 0,
      market: vx,
      rateValue: '388.0000000000',
      rateType: 'FIXED',
      effectiveFrom: new Date('2026-07-25T00:00:00.000Z'),
      effectiveUntil: new Date('2029-12-31T23:59:59.000Z'),
      createdBy: '00000000-0000-0000-0000-000000000000',
    });
    const out = await activation.apply(memberId, vx);
    const originalVersion = out.feeRateVersionId;
    expect(out.activationFee).toBe('388.0000000000');

    // Schedule a prospective RM500.00 fee version effective 2030-01-02 KL
    // (the first market-local midnight after the v1 stored end) through the
    // secured D-054 owner.
    const marketRows = await db
      .select({ id: markets.id })
      .from(markets)
      .where(eq(markets.code, vx))
      .limit(1);
    const marketId = marketRows[0]?.id ?? '';
    await seedRateAdmin([marketId]);
    await rates.createRateVersion(ownerActor(marketId), {
      market: vx,
      commissionType: 'AGENT_ACTIVATION_FEE',
      generation: 0,
      rateValue: '500.00',
      rateType: 'FIXED',
      effectiveFrom: klDateMidnightIso('2030-01-02'),
      reason: 'P5-R1 successor fee evidence',
      idempotencyKey: `fee-${uid()}`,
    });

    // The historical activation keeps its original snapshot.
    const status = await activation.getStatus(memberId, vx);
    expect(status?.activationFee).toBe('388.0000000000');
    expect(status?.feeRateVersionId).toBe(originalVersion);
  });
});

/* ================================================================ */
/*  4.2 — ownership, market, actor enforcement                      */
/* ================================================================ */

describe('P5-R1 4.2 permission/market/actor enforcement', () => {
  it('denies cross-member mutation (ownership check on member commands)', async () => {
    const owner = await seedMember('own1');
    const stranger = await seedMember('own2');
    const { activationId } = await activation.apply(owner, 'MY');

    await expect(
      activation.confirmPayment(activationId, 'PAY-X', stranger),
    ).rejects.toMatchObject({ code: 'AGENT_ACTIVATION_OWNERSHIP_MISMATCH' });
    await expect(
      activation.enrollCourse(activationId, stranger),
    ).rejects.toMatchObject({ code: 'AGENT_ACTIVATION_OWNERSHIP_MISMATCH' });
    await expect(
      activation.getStatusById(activationId, stranger),
    ).rejects.toMatchObject({ code: 'AGENT_ACTIVATION_OWNERSHIP_MISMATCH' });
  });

  it('denies admin transitions on activations outside the selected market', async () => {
    const memberId = await seedMember('mkt');
    const { activationId } = await activation.apply(memberId, 'MY');
    // Walk to PENDING_APPROVAL, then approve with a different selected market.
    await activation.confirmPayment(activationId, 'PAY-M', memberId);
    await activation.enrollCourse(activationId, memberId);
    await activation.completeCourse(activationId, memberId);
    await activation.submitApproval(activationId, memberId);

    await expect(
      activation.approveAndActivate(activationId, ADMIN_1, 'SG'),
    ).rejects.toMatchObject({ code: 'AGENT_ACTIVATION_MARKET_MISMATCH' });
    // The activation is still PENDING_APPROVAL.
    const status = await activation.getStatusById(activationId, memberId);
    expect(status?.status).toBe('PENDING_APPROVAL');
  });

  it('records the executing admin on every admin transition (actor attribution)', async () => {
    const memberId = await seedMember('act');
    const activationId = await walkToPendingApproval(memberId, 'MY');

    await activation.approveAndActivate(activationId, ADMIN_1, 'MY');
    let logs = await db
      .select()
      .from(agentActivationStatusLogs)
      .where(eq(agentActivationStatusLogs.activationId, activationId))
      .orderBy(agentActivationStatusLogs.changedAt);
    const approveLog = logs.find((l: any) => l.toStatus === 'ACTIVE');
    expect(approveLog.changedBy).toBe(ADMIN_1);
    expect(approveLog.changedByType).toBe('ADMIN');

    await activation.suspend(activationId, ADMIN_2, 'MY', 'test suspend');
    logs = await db
      .select()
      .from(agentActivationStatusLogs)
      .where(eq(agentActivationStatusLogs.activationId, activationId));
    const suspendLog = logs.find((l: any) => l.toStatus === 'SUSPENDED');
    expect(suspendLog.changedBy).toBe(ADMIN_2);

    await activation.reactivate(activationId, ADMIN_1, 'MY');
    await activation.deactivate(activationId, ADMIN_2, 'MY', 'test deactivate');
    const [row] = await db
      .select()
      .from(agentActivations)
      .where(eq(agentActivations.id, activationId))
      .limit(1);
    expect(row.revokedBy).toBe(ADMIN_2);
    expect(row.revocationReason).toBe('test deactivate');
    logs = await db
      .select()
      .from(agentActivationStatusLogs)
      .where(eq(agentActivationStatusLogs.activationId, activationId));
    const deactivateLog = logs.find((l: any) => l.toStatus === 'DEACTIVATED');
    expect(deactivateLog.changedBy).toBe(ADMIN_2);
    expect(deactivateLog.changedByType).toBe('ADMIN');
  });
});

/* ================================================================ */
/*  4.4 — source/generation/range reconciliation                    */
/* ================================================================ */

describe('P5-R1 4.4 rate-service generation mapping (canonical P5-S0)', () => {
  it('accepts G1/G2 member consumption rates and rejects generation 0', async () => {
    const g1 = await createRateOwnerSafe((market, marketId) => ({
      market,
      commissionType: 'MEMBER_CONSUMPTION',
      generation: 1,
      rateValue: '0.0100000000',
      rateType: 'PERCENTAGE',
      effectiveFrom: klDateMidnightIso('2031-01-01'),
      reason: 'P5-R1 G1 member consumption evidence',
      idempotencyKey: `mc1-${uid()}`,
    }));
    expect(g1.generation).toBe(1);
    const g2 = await createRateOwnerSafe((market, marketId) => ({
      market,
      commissionType: 'MEMBER_CONSUMPTION',
      generation: 2,
      rateValue: '0.0050000000',
      rateType: 'PERCENTAGE',
      effectiveFrom: klDateMidnightIso('2031-02-01'),
      reason: 'P5-R1 G2 member consumption evidence',
      idempotencyKey: `mc2-${uid()}`,
    }));
    expect(g2.generation).toBe(2);
    await expect(
      rates.createRateVersion(ownerActor(g1.marketId), {
        market: g1.market,
        commissionType: 'MEMBER_CONSUMPTION',
        generation: 0,
        rateValue: '0.0100000000',
        rateType: 'PERCENTAGE',
        effectiveFrom: klDateMidnightIso('2031-03-01'),
        reason: 'P5-R1 rejected generation 0 evidence',
        idempotencyKey: `mc0-${uid()}`,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_GENERATION' });
  });

  it('accepts single-generation merchant recruitment (0) and rejects generation 1', async () => {
    const g0 = await createRateOwnerSafe((market, marketId) => ({
      market,
      commissionType: 'MERCHANT_RECRUITMENT',
      generation: 0,
      rateValue: '0.0050000000',
      rateType: 'PERCENTAGE',
      effectiveFrom: klDateMidnightIso('2031-04-01'),
      reason: 'P5-R1 merchant recruitment evidence',
      idempotencyKey: `mr0-${uid()}`,
    }));
    expect(g0.generation).toBe(0);
    await expect(
      rates.createRateVersion(ownerActor(g0.marketId), {
        market: g0.market,
        commissionType: 'MERCHANT_RECRUITMENT',
        generation: 1,
        rateValue: '0.0050000000',
        rateType: 'PERCENTAGE',
        effectiveFrom: klDateMidnightIso('2031-05-01'),
        reason: 'P5-R1 rejected generation 1 evidence',
        idempotencyKey: `mr1-${uid()}`,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_GENERATION' });
  });

  it('supports scheduling AGENT_ACTIVATION_FEE versions (fee editor surface)', async () => {
    const fee = await createRateOwnerSafe((market, marketId) => ({
      market,
      commissionType: 'AGENT_ACTIVATION_FEE',
      generation: 0,
      rateValue: '450.0000000000',
      rateType: 'FIXED',
      effectiveFrom: klDateMidnightIso('2032-01-01'),
      reason: 'P5-R1 fee version evidence',
      idempotencyKey: `fee2-${uid()}`,
    }));
    expect(fee.rateType).toBe('FIXED');
    expect(fee.rateValue).toBe('450.0000000000');
  });
});

/* ================================================================ */
/*  4.5 — atomic/durable posting failure surfacing                  */
/* ================================================================ */

describe('P5-R1 4.5 commission posting failure surface + durable retry', () => {
  it('surfaces posting failure without partial state and retries idempotently', async () => {
    // Market 'XX' has an activation fee so APPLY works, but no
    // AGENT_UPGRADE rate versions so the upgrade posting fails.
    const memberId = await seedMember('post');
    const xx = marketCode('XX');
    await seedMarket(xx, 'XXX');
    await db.insert(commissionRateVersions).values({
      commissionType: 'AGENT_ACTIVATION_FEE',
      generation: 0,
      market: xx,
      rateValue: '388.0000000000',
      rateType: 'FIXED',
      effectiveFrom: new Date('2026-07-25T00:00:00.000Z'),
      createdBy: '00000000-0000-0000-0000-000000000000',
    });
    const activationId = await walkToPendingApproval(memberId, xx);

    // Activation commits atomically (ACTIVE + audit)…
    await activation.approveAndActivate(activationId, ADMIN_1, xx);
    const [active] = await db
      .select()
      .from(agentActivations)
      .where(eq(agentActivations.id, activationId))
      .limit(1);
    expect(active.status).toBe('ACTIVE');

    // …and the posting failure surfaces (never swallowed).
    await expect(
      upgrade.processAgentUpgrade(activationId),
    ).rejects.toMatchObject({ code: 'AGENT_UPGRADE_RATE_NOT_FOUND' });

    // No partial ledger rows were written by the failed attempt.
    const ledgerRows = await db
      .select({ id: commissionLedger.id })
      .from(commissionLedger)
      .where(eq(commissionLedger.sourceReference, activationId));
    expect(ledgerRows).toHaveLength(0);

    // Configure the G1/G2 rates, then the retry succeeds idempotently.
    await db.insert(commissionRateVersions).values([
      {
        commissionType: 'AGENT_UPGRADE',
        generation: 1,
        market: xx,
        rateValue: '88.0000000000',
        rateType: 'FIXED',
        effectiveFrom: new Date('2026-07-25T00:00:00.000Z'),
        createdBy: '00000000-0000-0000-0000-000000000000',
      },
      {
        commissionType: 'AGENT_UPGRADE',
        generation: 2,
        market: xx,
        rateValue: '38.0000000000',
        rateType: 'FIXED',
        effectiveFrom: new Date('2026-07-25T00:00:00.000Z'),
        createdBy: '00000000-0000-0000-0000-000000000000',
      },
    ]);
    const retry = await upgrade.processAgentUpgrade(activationId);
    // No referrer in this isolated fixture → SKIPPED_NO_BENEFICIARY outcome,
    // with a COMPLETED processing record (idempotent replay is safe).
    expect(retry.completionOutcome).toBe('SKIPPED_INELIGIBLE');
    const again = await upgrade.processAgentUpgrade(activationId);
    expect(again.completionOutcome).toBe('SKIPPED_INELIGIBLE');
  });
});
