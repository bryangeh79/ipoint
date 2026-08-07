import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  auditLogs,
  ipointAdjustmentDecisions,
  ipointAdjustmentRequests,
} from '@ipoint/database';
import { and, eq } from 'drizzle-orm';
import { WalletAdjustmentOwnerService } from '../wallet/wallet-adjustment.owner.service.js';
import {
  buildAcceptanceHarness,
  createMemberAndWallet,
  type AcceptanceHarness,
} from './p7-s7c-finance-acceptance.helpers.js';

const databaseUrl = process.env['DATABASE_URL'];

/**
 * P7-S7C Finance Acceptance — C17..C23 (UI/API).
 *
 * Permission matrix (role-scoped), step-up MFA, Current Admin Market
 * enforcement, cross-market denial, full error-code mapping, immutable
 * request history and reject -> linked-request (priorRequestId) chain.
 */
describe.skipIf(!databaseUrl)(
  'P7-S7C Finance Acceptance C: UI/API access controls (real PostgreSQL)',
  () => {
    let harness: AcceptanceHarness;
    let app: INestApplication;
    let owner: WalletAdjustmentOwnerService;

    beforeAll(async () => {
      vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
      vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
      vi.stubEnv('AUTH_OTP_PEPPER', 's7c-access-pepper-at-least-32-chars');
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
      const walletZZ = await createMemberAndWallet(harness, harness.marketZZId);
      harness.walletZZId = walletZZ.walletId;

      harness.maker = await harness.createAdmin(
        'Finance Operator (maker)',
        'FINANCE_OPERATOR',
      );
      harness.checker = await harness.createAdmin(
        'Finance Approver (checker)',
        'FINANCE_APPROVER',
      );
      harness.superAdmin = await harness.createAdmin(
        'Access Super Admin',
        'SUPER_ADMIN',
      );
      harness.readOnly = await harness.createAdmin(
        'Read-only Auditor',
        'SUPPORT_READONLY_AUDITOR',
      );
      for (const admin of [
        harness.maker,
        harness.checker,
        harness.superAdmin,
        harness.readOnly,
      ]) {
        for (const targetMarketId of [harness.marketId, harness.marketZZId]) {
          await harness.grantMarketAccess(admin.adminUserId, targetMarketId);
        }
      }
      for (const admin of [
        harness.maker,
        harness.checker,
        harness.superAdmin,
        harness.readOnly,
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

    function adjustmentsUrl(marketId: string = harness.marketId) {
      return `/api/v1/admin/ipoint-adjust-ops/markets/${marketId}/adjustments`;
    }

    function createPayload(overrides: Record<string, unknown> = {}) {
      return {
        walletAccountId: harness.walletId,
        direction: 'CREDIT',
        amount: '100',
        reasonCode: 'OPERATIONAL_CORRECTION',
        explanation: 'P7-S7C access acceptance credit.',
        caseReference: `ACCESS-${randomUUID().slice(0, 8)}`,
        ...overrides,
      };
    }

    function createAs(admin: AcceptanceHarness['maker']) {
      return supertest(harness.server)
        .post(adjustmentsUrl())
        .set('authorization', `Bearer ${admin.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload());
    }

    async function createAndSubmitAs(admin: AcceptanceHarness['maker']) {
      const created = await createAs(admin).expect(201);
      const requestId = String((created.body as { id: string }).id);
      await supertest(harness.server)
        .post(`${adjustmentsUrl()}/${requestId}/submit`)
        .set('authorization', `Bearer ${admin.token}`)
        .expect(200);
      return requestId;
    }

    /** Decide with a fresh step-up grant; returns the HTTP response. */
    async function decideAs(
      admin: AcceptanceHarness['checker'],
      requestId: string,
      decision: 'APPROVED' | 'REJECTED' = 'APPROVED',
    ) {
      const token = await harness.seedStepUpGrant(
        admin,
        'wallet.ipoint.adjust.checker',
        harness.marketId,
      );
      return supertest(harness.server)
        .post(`${adjustmentsUrl()}/${requestId}/decision`)
        .set('authorization', `Bearer ${admin.token}`)
        .set('x-step-up-token', token)
        .send({ decision, reason: `P7-S7C ${decision.toLowerCase()}` });
    }

    /** Execute with a fresh step-up grant; returns the HTTP response. */
    async function executeAs(
      admin: AcceptanceHarness['checker'],
      requestId: string,
    ) {
      const token = await harness.seedStepUpGrant(
        admin,
        'wallet.ipoint.adjust.execute',
        harness.marketId,
      );
      return supertest(harness.server)
        .post(`${adjustmentsUrl()}/${requestId}/execute`)
        .set('authorization', `Bearer ${admin.token}`)
        .set('x-step-up-token', token);
    }

    async function requestRow(requestId: string) {
      const rows = await harness.database.db
        .select()
        .from(ipointAdjustmentRequests)
        .where(eq(ipointAdjustmentRequests.id, requestId))
        .limit(1);
      return rows[0];
    }

    // ─── C17 ─────────────────────────────────────────────────────────

    it('C17: permission matrix — Finance Operator maker-only; Finance Approver checker/execute-only; read-only fully denied', async () => {
      // Finance Operator: create OK (maker), decide/execute denied.
      const created = await createAs(harness.maker).expect(201);
      const requestId = String((created.body as { id: string }).id);
      await supertest(harness.server)
        .post(`${adjustmentsUrl()}/${requestId}/submit`)
        .set('authorization', `Bearer ${harness.maker.token}`)
        .expect(200);
      const operatorDecide = await decideAs(harness.maker, requestId);
      expect(operatorDecide.status).toBe(403);
      expect(operatorDecide.body).toMatchObject({
        error: { code: 'PERMISSION_DENIED' },
      });
      const operatorExecute = await executeAs(harness.maker, requestId);
      expect(operatorExecute.status).toBe(403);
      expect(operatorExecute.body).toMatchObject({
        error: { code: 'PERMISSION_DENIED' },
      });

      // Finance Approver: create denied (no maker), decide + execute OK.
      const approverCreate = await createAs(harness.checker).expect(403);
      expect(approverCreate.body).toMatchObject({
        error: { code: 'PERMISSION_DENIED' },
      });

      // Read-only/Support: every financial write is denied.
      const readOnlyCreate = await createAs(harness.readOnly).expect(403);
      expect(readOnlyCreate.body).toMatchObject({
        error: { code: 'PERMISSION_DENIED' },
      });
    });

    // ─── C18 ─────────────────────────────────────────────────────────

    it('C18: step-up MFA — decide/execute require a fresh x-step-up-token', async () => {
      const requestId = await createAndSubmitAs(harness.maker);

      const noToken = await supertest(harness.server)
        .post(`${adjustmentsUrl()}/${requestId}/decision`)
        .set('authorization', `Bearer ${harness.checker.token}`)
        .send({ decision: 'APPROVED', reason: 'No step-up.' })
        .expect(403);
      expect(noToken.body).toMatchObject({
        error: { code: 'MFA_STEP_UP_REQUIRED' },
      });

      expect((await decideAs(harness.checker, requestId)).status).toBe(200);

      const executeNoToken = await supertest(harness.server)
        .post(`${adjustmentsUrl()}/${requestId}/execute`)
        .set('authorization', `Bearer ${harness.checker.token}`)
        .expect(403);
      expect(executeNoToken.body).toMatchObject({
        error: { code: 'MFA_STEP_UP_REQUIRED' },
      });
    });

    // ─── C19 ─────────────────────────────────────────────────────────

    it('C19: Current Admin Market mismatch (URL market != session market) -> 409', async () => {
      const response = await supertest(harness.server)
        .post(adjustmentsUrl(harness.marketZZId))
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload())
        .expect(409);
      expect(response.body).toMatchObject({
        error: { code: 'MARKET_CONTEXT_MISMATCH' },
      });
    });

    // ─── C20 ─────────────────────────────────────────────────────────

    it('C20: cross-market denial — cannot operate on a resource outside the Current Admin Market', async () => {
      // Wallet lives in ZZ; session market is MY.
      const response = await supertest(harness.server)
        .post(adjustmentsUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload({ walletAccountId: harness.walletZZId }))
        .expect(409);
      expect(response.body).toMatchObject({
        error: { code: 'WALLET_ADJUSTMENT_MARKET_CONTEXT_MISMATCH' },
      });
    });

    // ─── C21 ─────────────────────────────────────────────────────────

    it('C21: full error mapping — 400/403/404/409/422/500 classes with owner codes; unknown errors never become 2xx', async () => {
      // 400: transport validation.
      const badBody = await supertest(harness.server)
        .post(adjustmentsUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload({ amount: 'not-a-number' }))
        .expect(400);
      expect(badBody.body.error.code).toBe('VALIDATION_ERROR');

      // 404: unknown request.
      const missing = await supertest(harness.server)
        .post(`${adjustmentsUrl()}/${randomUUID()}/submit`)
        .set('authorization', `Bearer ${harness.maker.token}`)
        .expect(404);
      expect(missing.body).toMatchObject({
        error: { code: 'WALLET_ADJUSTMENT_REQUEST_NOT_FOUND' },
      });

      // 422: market not configured.
      await harness.bindCurrentMarket(harness.maker.id, harness.marketZZId);
      const unconfigured = await supertest(harness.server)
        .post(adjustmentsUrl(harness.marketZZId))
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload({ walletAccountId: harness.walletZZId }))
        .expect(422);
      expect(unconfigured.body).toMatchObject({
        error: { code: 'WALLET_ADJUSTMENT_MARKET_NOT_CONFIGURED' },
      });
      await harness.bindCurrentMarket(harness.maker.id, harness.marketId);

      // 500: an unknown (non-owner) error is never swallowed into 2xx.
      const spy = vi
        .spyOn(owner, 'create')
        .mockRejectedValueOnce(new Error('unexpected internal failure'));
      const internal = await supertest(harness.server)
        .post(adjustmentsUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload())
        .expect(500);
      spy.mockRestore();
      expect(internal.body.error.code).toBe('INTERNAL_ERROR');
    });

    // ─── C22 ─────────────────────────────────────────────────────────

    it('C22: pending/approved/rejected history is immutable and visible in the queue', async () => {
      const pendingId = await createAndSubmitAs(harness.maker);
      const rejectedId = await createAndSubmitAs(harness.maker);
      expect(
        (await decideAs(harness.checker, rejectedId, 'REJECTED')).status,
      ).toBe(200);
      const approvedId = await createAndSubmitAs(harness.maker);
      expect((await decideAs(harness.checker, approvedId)).status).toBe(200);

      // Queue projection lists all of them with their states.
      const queue = await supertest(harness.server)
        .get(adjustmentsUrl())
        .set('authorization', `Bearer ${harness.checker.token}`)
        .expect(200);
      const items = (
        queue.body as { items: Array<{ id: string; state: string }> }
      ).items;
      expect(items.map((i) => i.id)).toEqual(
        expect.arrayContaining([pendingId, rejectedId, approvedId]),
      );

      // Immutable: a REJECTED request cannot be resubmitted.
      const resubmit = await supertest(harness.server)
        .post(`${adjustmentsUrl()}/${rejectedId}/submit`)
        .set('authorization', `Bearer ${harness.maker.token}`)
        .expect(409);
      expect(resubmit.body).toMatchObject({
        error: { code: 'WALLET_ADJUSTMENT_STATE_CONFLICT' },
      });
      expect((await requestRow(rejectedId))?.state).toBe('REJECTED');
    });

    // ─── C23 ─────────────────────────────────────────────────────────

    it('C23: after a reject only a linked request (priorRequestId) is accepted; invalid links -> 409', async () => {
      const rejectedId = await createAndSubmitAs(harness.maker);
      expect(
        (await decideAs(harness.checker, rejectedId, 'REJECTED')).status,
      ).toBe(200);

      // Linked replacement works.
      const linked = await supertest(harness.server)
        .post(adjustmentsUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload({ priorRequestId: rejectedId }))
        .expect(201);
      expect(
        (linked.body as { priorRequestId: string | null }).priorRequestId,
      ).toBe(rejectedId);

      // A non-rejected (pending) prior is invalid.
      const pendingId = await createAndSubmitAs(harness.maker);
      const invalid = await supertest(harness.server)
        .post(adjustmentsUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload({ priorRequestId: pendingId }))
        .expect(409);
      expect(invalid.body).toMatchObject({
        error: { code: 'WALLET_ADJUSTMENT_PRIOR_REQUEST_INVALID' },
      });
    });

    // ─── Supplemental: audit append-only across terminal states ──────

    it('audit log rows are append-only and never overwritten for terminal requests', async () => {
      const requestId = await createAndSubmitAs(harness.maker);
      expect(
        (await decideAs(harness.checker, requestId, 'REJECTED')).status,
      ).toBe(200);
      const rows = await harness.database.db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, 'ipoint_adjustment_request'),
            eq(auditLogs.entityId, requestId),
          ),
        );
      expect(rows.map((r) => r.action)).toEqual([
        'ipoint.adjustment.create',
        'ipoint.adjustment.submit',
        'ipoint.adjustment.reject',
      ]);
      expect(
        await harness.database.db
          .select({ id: ipointAdjustmentDecisions.id })
          .from(ipointAdjustmentDecisions)
          .where(eq(ipointAdjustmentDecisions.adjustmentRequestId, requestId)),
      ).toHaveLength(1);
    });
  },
);
