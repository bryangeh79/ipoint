import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ipointAdjustmentDecisions,
  ipointAdjustmentRequests,
  memberWalletAccounts,
  memberWalletEntries,
} from '@ipoint/database';
import { and, eq } from 'drizzle-orm';
import { WalletAdjustmentOwnerService } from '../wallet/wallet-adjustment.owner.service.js';
import {
  buildAcceptanceHarness,
  createMemberAndWallet,
  normalizeDecimal,
  type AcceptanceHarness,
} from './p7-s7c-finance-acceptance.helpers.js';

const databaseUrl = process.env['DATABASE_URL'];

/**
 * P7-S7C Finance Acceptance — D24..D27 (Concurrency).
 *
 * Double-checker concurrent approval (row lock + unique decision row),
 * idempotent replay without double-posting, network retry safety and DB
 * failure injection with full atomic rollback.
 */
describe.skipIf(!databaseUrl)(
  'P7-S7C Finance Acceptance D: Concurrency (real PostgreSQL)',
  () => {
    let harness: AcceptanceHarness;
    let app: INestApplication;
    let owner: WalletAdjustmentOwnerService;

    beforeAll(async () => {
      vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
      vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
      vi.stubEnv('AUTH_OTP_PEPPER', 's7c-concurrency-pepper-32-characters');
      vi.stubEnv(
        'REDEMPTION_VOUCHER_ENCRYPTION_KEY',
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      );
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('LOG_LEVEL', 'silent');

      const { Pool } = await import('pg');
      const dbName = new URL(databaseUrl ?? '').pathname.replace(/^\//u, '');
      const maintenanceUrl = (databaseUrl ?? '').replace(
        /\/[^/]+$/u,
        '/postgres',
      );
      const admin = new Pool({ connectionString: maintenanceUrl });
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${dbName}"`);
      await admin.end();

      harness = await buildAcceptanceHarness();
      app = harness.app;
      owner = app.get(WalletAdjustmentOwnerService);

      const wallet = await createMemberAndWallet(harness, harness.marketId);
      harness.walletId = wallet.walletId;

      harness.maker = await harness.createAdmin(
        'Concurrency Maker',
        'FINANCE_OPERATOR',
      );
      harness.checker = await harness.createAdmin(
        'Concurrency Checker A',
        'FINANCE_APPROVER',
      );
      harness.superAdmin = await harness.createAdmin(
        'Concurrency Checker B',
        'SUPER_ADMIN',
      );
      for (const admin of [
        harness.maker,
        harness.checker,
        harness.superAdmin,
      ]) {
        await harness.grantMarketAccess(admin.adminUserId, harness.marketId);
      }
      for (const admin of [
        harness.maker,
        harness.checker,
        harness.superAdmin,
      ]) {
        await harness.enrollMfa(admin.email, admin.password);
        await harness.bindCurrentMarket(admin.id, harness.marketId);
      }
    });

    afterAll(async () => {
      await app?.close();
      vi.unstubAllEnvs();
    });

    // ─── Helpers ─────────────────────────────────────────────────────

    function adjustmentsUrl() {
      return `/api/v1/admin/ipoint-adjust-ops/markets/${harness.marketId}/adjustments`;
    }

    function createPayload(overrides: Record<string, unknown> = {}) {
      return {
        walletAccountId: harness.walletId,
        direction: 'CREDIT',
        amount: '100',
        reasonCode: 'OPERATIONAL_CORRECTION',
        explanation: 'P7-S7C concurrency credit.',
        caseReference: `CONC-${randomUUID().slice(0, 8)}`,
        ...overrides,
      };
    }

    async function createAndSubmit() {
      const created = await supertest(harness.server)
        .post(adjustmentsUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload())
        .expect(201);
      const requestId = String((created.body as { id: string }).id);
      await supertest(harness.server)
        .post(`${adjustmentsUrl()}/${requestId}/submit`)
        .set('authorization', `Bearer ${harness.maker.token}`)
        .expect(200);
      return requestId;
    }

    function decideRequest(
      admin: AcceptanceHarness['checker'],
      requestId: string,
      stepUpToken: string,
    ) {
      return supertest(harness.server)
        .post(`${adjustmentsUrl()}/${requestId}/decision`)
        .set('authorization', `Bearer ${admin.token}`)
        .set('x-step-up-token', stepUpToken)
        .send({ decision: 'APPROVED', reason: 'Concurrent approval.' });
    }

    async function ledgerEntryCount(): Promise<number> {
      const rows = await harness.database.db
        .select({ id: memberWalletEntries.id })
        .from(memberWalletEntries)
        .where(eq(memberWalletEntries.walletAccountId, harness.walletId));
      return rows.length;
    }

    async function walletBalance(): Promise<string> {
      const rows = await harness.database.db
        .select({ availableBalance: memberWalletAccounts.availableBalance })
        .from(memberWalletAccounts)
        .where(eq(memberWalletAccounts.id, harness.walletId))
        .limit(1);
      return rows[0]?.availableBalance ?? 'MISSING';
    }

    async function requestRow(requestId: string) {
      const rows = await harness.database.db
        .select()
        .from(ipointAdjustmentRequests)
        .where(eq(ipointAdjustmentRequests.id, requestId))
        .limit(1);
      return rows[0];
    }

    async function decisionRows(requestId: string) {
      return harness.database.db
        .select({ id: ipointAdjustmentDecisions.id })
        .from(ipointAdjustmentDecisions)
        .where(eq(ipointAdjustmentDecisions.adjustmentRequestId, requestId));
    }

    // ─── D24 ─────────────────────────────────────────────────────────

    it('D24: two checkers approving the same request concurrently — exactly one wins', async () => {
      const requestId = await createAndSubmit();
      const tokenA = await harness.seedStepUpGrant(
        harness.checker,
        'wallet.ipoint.adjust.checker',
        harness.marketId,
      );
      const tokenB = await harness.seedStepUpGrant(
        harness.superAdmin,
        'wallet.ipoint.adjust.checker',
        harness.marketId,
      );

      const [a, b] = await Promise.allSettled([
        decideRequest(harness.checker, requestId, tokenA),
        decideRequest(harness.superAdmin, requestId, tokenB),
      ]);

      const fulfilled = [a, b].filter(
        (r): r is PromiseFulfilledResult<supertest.Response> =>
          r.status === 'fulfilled' && r.value.status === 200,
      );
      const rejected409 = [a, b].filter(
        (r) =>
          r.status === 'fulfilled' &&
          r.value.status === 409 &&
          (r.value.body as { error?: { code?: string } }).error?.code ===
            'WALLET_ADJUSTMENT_STATE_CONFLICT',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected409).toHaveLength(1);
      expect(await decisionRows(requestId)).toHaveLength(1);
    });

    // ─── D25 ─────────────────────────────────────────────────────────

    it('D25: idempotent replay never double-posts to the ledger', async () => {
      const key = randomUUID();
      const payload = createPayload();
      const first = await supertest(harness.server)
        .post(adjustmentsUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', key)
        .send(payload)
        .expect(201);
      const requestId = String((first.body as { id: string }).id);

      // Replay same key + payload -> same request id.
      const replay = await supertest(harness.server)
        .post(adjustmentsUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', key)
        .send(payload)
        .expect(201);
      expect(String((replay.body as { id: string }).id)).toBe(requestId);

      await supertest(harness.server)
        .post(`${adjustmentsUrl()}/${requestId}/submit`)
        .set('authorization', `Bearer ${harness.maker.token}`)
        .expect(200);
      const token = await harness.seedStepUpGrant(
        harness.checker,
        'wallet.ipoint.adjust.checker',
        harness.marketId,
      );
      await decideRequest(harness.checker, requestId, token).expect(200);
      const execToken = await harness.seedStepUpGrant(
        harness.checker,
        'wallet.ipoint.adjust.execute',
        harness.marketId,
      );
      await supertest(harness.server)
        .post(`${adjustmentsUrl()}/${requestId}/execute`)
        .set('authorization', `Bearer ${harness.checker.token}`)
        .set('x-step-up-token', execToken)
        .expect(200);
      expect(await ledgerEntryCount()).toBe(1);
      expect(normalizeDecimal(await walletBalance())).toBe('5100');
    });

    // ─── D26 ─────────────────────────────────────────────────────────

    it('D26: network retry (same key resend) does not double-post', async () => {
      const key = randomUUID();
      const payload = createPayload();
      await supertest(harness.server)
        .post(adjustmentsUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', key)
        .send(payload)
        .expect(201);
      // Simulated transport retry with the exact same request.
      await supertest(harness.server)
        .post(adjustmentsUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', key)
        .send(payload)
        .expect(201);

      const rows = await harness.database.db
        .select({ id: ipointAdjustmentRequests.id })
        .from(ipointAdjustmentRequests)
        .where(
          and(
            eq(ipointAdjustmentRequests.walletAccountId, harness.walletId),
            eq(ipointAdjustmentRequests.idempotencyKey, key),
          ),
        );
      // Only the single original request exists — no duplicate row.
      expect(rows).toHaveLength(1);
    });

    // ─── D27 ─────────────────────────────────────────────────────────

    it('D27: injected DB failure rolls back atomically — no partial state', async () => {
      const requestId = await createAndSubmit();
      const token = await harness.seedStepUpGrant(
        harness.checker,
        'wallet.ipoint.adjust.checker',
        harness.marketId,
      );
      await decideRequest(harness.checker, requestId, token).expect(200);

      const balanceBefore = await walletBalance();
      const entriesBefore = await ledgerEntryCount();

      const spy = vi
        .spyOn(owner, 'appendLedgerEntry')
        .mockRejectedValueOnce(new Error('injected DB failure (deadlock)'));
      const execToken = await harness.seedStepUpGrant(
        harness.checker,
        'wallet.ipoint.adjust.execute',
        harness.marketId,
      );
      const executed = await supertest(harness.server)
        .post(`${adjustmentsUrl()}/${requestId}/execute`)
        .set('authorization', `Bearer ${harness.checker.token}`)
        .set('x-step-up-token', execToken)
        .expect(200);
      spy.mockRestore();

      expect((executed.body as { state: string }).state).toBe('FAILED');
      // Full rollback: no partial ledger, no balance change, not EXECUTING.
      expect(await ledgerEntryCount()).toBe(entriesBefore);
      expect(normalizeDecimal(await walletBalance())).toBe(
        normalizeDecimal(balanceBefore),
      );
      const row = await requestRow(requestId);
      expect(row?.state).toBe('FAILED');
      expect(row?.ledgerEntryId).toBeNull();
    });
  },
);
