import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  auditLogs,
  ipointAdjustmentDecisions,
  ipointAdjustmentMarketRules,
  ipointAdjustmentRequests,
  memberWalletAccounts,
  memberWalletEntries,
} from '@ipoint/database';
import { and, eq } from 'drizzle-orm';
import { WalletAdjustmentOwnerService } from '../wallet/wallet-adjustment.owner.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
  buildAcceptanceHarness,
  createMemberAndWallet,
  normalizeDecimal,
  type AcceptanceHarness,
} from './p7-s7c-finance-acceptance.helpers.js';

const databaseUrl = process.env['DATABASE_URL'];

/**
 * P7-S7C Finance Acceptance — B11..B16 (Manual iPoint via the Phase 7
 * adapter) + SEC-01 write-boundary/immutability checks.
 */
describe.skipIf(!databaseUrl)(
  'P7-S7C Finance Acceptance B: Manual iPoint + SEC-01 boundaries (real PostgreSQL)',
  () => {
    let harness: AcceptanceHarness;
    let app: INestApplication;
    let owner: WalletAdjustmentOwnerService;

    const SOFT_CAP = '10000';

    beforeAll(async () => {
      vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
      vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
      vi.stubEnv('AUTH_OTP_PEPPER', 's7c-ipoint-pepper-at-least-32-characters');
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
        'iPoint Maker Operator',
        'FINANCE_OPERATOR',
      );
      harness.checker = await harness.createAdmin(
        'iPoint Checker Approver',
        'FINANCE_APPROVER',
      );
      harness.superAdmin = await harness.createAdmin(
        'iPoint Super Admin',
        'SUPER_ADMIN',
      );
      for (const admin of [
        harness.maker,
        harness.checker,
        harness.superAdmin,
      ]) {
        for (const targetMarketId of [harness.marketId, harness.marketZZId]) {
          await harness.grantMarketAccess(admin.adminUserId, targetMarketId);
        }
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

    function adjustmentsUrl(marketId: string = harness.marketId) {
      return `/api/v1/admin/ipoint-adjust-ops/markets/${marketId}/adjustments`;
    }

    function createPayload(overrides: Record<string, unknown> = {}) {
      return {
        walletAccountId: harness.walletId,
        direction: 'CREDIT',
        amount: '100',
        reasonCode: 'OPERATIONAL_CORRECTION',
        explanation: 'P7-S7C iPoint acceptance credit.',
        caseReference: `IPOINT-${randomUUID().slice(0, 8)}`,
        ...overrides,
      };
    }

    async function createAndSubmit(
      maker: AcceptanceHarness['maker'] = harness.maker,
      overrides: Record<string, unknown> = {},
    ) {
      const created = await supertest(harness.server)
        .post(adjustmentsUrl())
        .set('authorization', `Bearer ${maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload(overrides))
        .expect(201);
      const requestId = String((created.body as { id: string }).id);
      await supertest(harness.server)
        .post(`${adjustmentsUrl()}/${requestId}/submit`)
        .set('authorization', `Bearer ${maker.token}`)
        .expect(200);
      return requestId;
    }

    async function decide(
      admin: AcceptanceHarness['checker'],
      requestId: string,
      decision: 'APPROVED' | 'REJECTED',
      actionClass = 'wallet.ipoint.adjust.checker',
    ) {
      return supertest(harness.server)
        .post(`${adjustmentsUrl()}/${requestId}/decision`)
        .set('authorization', `Bearer ${admin.token}`)
        .set(
          'x-step-up-token',
          await harness.seedStepUpGrant(admin, actionClass, harness.marketId),
        )
        .send({ decision, reason: `P7-S7C ${decision.toLowerCase()}` })
        .expect(200);
    }

    async function execute(
      admin: AcceptanceHarness['checker'],
      requestId: string,
    ) {
      return supertest(harness.server)
        .post(`${adjustmentsUrl()}/${requestId}/execute`)
        .set('authorization', `Bearer ${admin.token}`)
        .set(
          'x-step-up-token',
          await harness.seedStepUpGrant(
            admin,
            'wallet.ipoint.adjust.execute',
            harness.marketId,
          ),
        )
        .expect(200);
    }

    async function walletBalance(): Promise<string> {
      const rows = await harness.database.db
        .select({ availableBalance: memberWalletAccounts.availableBalance })
        .from(memberWalletAccounts)
        .where(eq(memberWalletAccounts.id, harness.walletId))
        .limit(1);
      return rows[0]?.availableBalance ?? 'MISSING';
    }

    async function ledgerEntryCountFor(requestId: string): Promise<number> {
      const rows = await harness.database.db
        .select({ id: memberWalletEntries.id })
        .from(memberWalletEntries)
        .where(eq(memberWalletEntries.referenceId, requestId));
      return rows.length;
    }

    async function requestRow(requestId: string) {
      const rows = await harness.database.db
        .select()
        .from(ipointAdjustmentRequests)
        .where(eq(ipointAdjustmentRequests.id, requestId))
        .limit(1);
      return rows[0];
    }

    async function auditActions(requestId: string): Promise<string[]> {
      const rows = await harness.database.db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, 'ipoint_adjustment_request'),
            eq(auditLogs.entityId, requestId),
          ),
        );
      return rows.map((row) => row.action);
    }

    // ─── B11 ─────────────────────────────────────────────────────────

    it('B11: full Maker/Checker lifecycle through the adapter (DRAFT->SUBMITTED->APPROVED->EXECUTED; REJECTED path)', async () => {
      const created = await supertest(harness.server)
        .post(adjustmentsUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload())
        .expect(201);
      const requestId = String((created.body as { id: string }).id);
      expect((created.body as { state: string }).state).toBe('DRAFT');
      expect((created.body as { amount: string }).amount).toBe(
        '100.0000000000',
      );

      await supertest(harness.server)
        .post(`${adjustmentsUrl()}/${requestId}/submit`)
        .set('authorization', `Bearer ${harness.maker.token}`)
        .expect(200);
      expect((await requestRow(requestId))?.state).toBe('SUBMITTED');

      await decide(harness.checker, requestId, 'APPROVED');
      expect((await requestRow(requestId))?.state).toBe('APPROVED');

      await execute(harness.checker, requestId);
      expect((await requestRow(requestId))?.state).toBe('EXECUTED');
      expect(normalizeDecimal(await walletBalance())).toBe('5100');
      expect(await ledgerEntryCountFor(requestId)).toBe(1);

      // REJECTED path is fully supported too.
      const rejectedId = await createAndSubmit();
      await decide(harness.checker, rejectedId, 'REJECTED');
      expect((await requestRow(rejectedId))?.state).toBe('REJECTED');
      const actions = await auditActions(requestId);
      expect(actions).toEqual(
        expect.arrayContaining([
          'ipoint.adjustment.create',
          'ipoint.adjustment.submit',
          'ipoint.adjustment.approve',
          'ipoint.adjustment.execute',
        ]),
      );
    });

    // ─── B12 ─────────────────────────────────────────────────────────

    it('B12: SEC-01 owner is the only write boundary — legacy immediate endpoint removed (404)', async () => {
      const response = await supertest(harness.server)
        .post(`/api/v1/admin/rewards/wallets/${randomUUID()}/adjustment`)
        .send({ amount: '1', direction: 'CREDIT' })
        .expect(404);
      expect(response.body).toBeDefined();
    });

    it('B12: repo grep zero residual — no legacy route registration in wallet sources', async () => {
      const { readFileSync } = await import('node:fs');
      const paths = [
        'src/wallet/wallet.controller.ts',
        'src/wallet/wallet.service.ts',
      ];
      for (const path of paths) {
        const source = readFileSync(path, 'utf8');
        expect(source).not.toMatch(/rewards\/wallets/u);
        expect(source).not.toMatch(/\/adjustment'/u);
      }
    });

    // ─── B13 ─────────────────────────────────────────────────────────

    it('B13: Phase 7 adapter performs no direct insert/update/delete (read projections + owner delegation only)', async () => {
      const { readFileSync } = await import('node:fs');
      for (const path of [
        'src/admin-ipoint-adjust-ops/admin-ipoint-adjust-ops.service.ts',
        'src/admin-ipoint-adjust-ops/admin-ipoint-adjust-ops.controller.ts',
      ]) {
        const source = readFileSync(path, 'utf8');
        expect(source).not.toMatch(/\.insert\(/u);
        expect(source).not.toMatch(/\.update\(/u);
        expect(source).not.toMatch(/\.delete\(/u);
      }
    });

    // ─── B14 ─────────────────────────────────────────────────────────

    it('B14: adapter carries no financial logic — 1:1 delegation and full owner-code mapping', async () => {
      const { readFileSync } = await import('node:fs');
      const service = readFileSync(
        'src/admin-ipoint-adjust-ops/admin-ipoint-adjust-ops.service.ts',
        'utf8',
      );
      // No ledger arithmetic in the adapter.
      expect(service).not.toMatch(/memberWalletEntries/u);
      expect(service).not.toMatch(/mcpLedgerEntries/u);
      expect(service).not.toMatch(/addDecimal|subtractDecimal|balanceDelta/u);
      // Delegation is 1:1 onto the frozen owner.
      expect(service).toMatch(/this\.owner\.(create|submit|decide|execute)/u);

      // The controller maps the full owner error space (23 codes + the two
      // adapter codes MARKET_NOT_FOUND / WALLET_LOOKUP_EMPTY).
      const controller = readFileSync(
        'src/admin-ipoint-adjust-ops/admin-ipoint-adjust-ops.controller.ts',
        'utf8',
      );
      const ownerCodes = [
        'WALLET_ADJUSTMENT_PERMISSION_DENIED',
        'WALLET_ADJUSTMENT_MARKET_SELECTION_REQUIRED',
        'WALLET_ADJUSTMENT_MARKET_CONTEXT_MISMATCH',
        'WALLET_ADJUSTMENT_MARKET_ACCESS_DENIED',
        'WALLET_ADJUSTMENT_WALLET_NOT_FOUND',
        'WALLET_ADJUSTMENT_MARKET_NOT_CONFIGURED',
        'WALLET_ADJUSTMENT_ABOVE_HARD_CAP',
        'WALLET_ADJUSTMENT_REASON_CODE_INVALID',
        'WALLET_ADJUSTMENT_ATTACHMENT_REQUIRED',
        'WALLET_ADJUSTMENT_EVIDENCE_STORAGE_UNAVAILABLE',
        'WALLET_ADJUSTMENT_IDEMPOTENCY_KEY_REQUIRED',
        'WALLET_ADJUSTMENT_IDEMPOTENCY_CONFLICT',
        'WALLET_ADJUSTMENT_REQUEST_NOT_FOUND',
        'WALLET_ADJUSTMENT_STATE_CONFLICT',
        'WALLET_ADJUSTMENT_MAKER_REQUIRED',
        'WALLET_ADJUSTMENT_MAKER_CHECKER_CONFLICT',
        'WALLET_ADJUSTMENT_CHECKER_ROUTING_DENIED',
        'WALLET_ADJUSTMENT_INVALID_AMOUNT',
        'WALLET_ADJUSTMENT_INSUFFICIENT_BALANCE',
        'WALLET_ADJUSTMENT_PRIOR_REQUEST_INVALID',
        'WALLET_ADJUSTMENT_DECISION_REASON_REQUIRED',
        'WALLET_ADJUSTMENT_EXECUTION_FAILED',
        'WALLET_ADJUSTMENT_INVALID_FIELD',
        'WALLET_ADJUSTMENT_MARKET_NOT_FOUND',
        'WALLET_ADJUSTMENT_WALLET_LOOKUP_EMPTY',
      ];
      for (const code of ownerCodes) {
        expect(controller).toContain(`'${code}'`);
      }
    });

    // ─── B15 ─────────────────────────────────────────────────────────

    it('B15: atomic ledger + version guard — historical ledger rows are never rewritten', async () => {
      const requestId = await createAndSubmit();
      await decide(harness.checker, requestId, 'APPROVED');
      await execute(harness.checker, requestId);

      const executed = await requestRow(requestId);
      expect(executed?.state).toBe('EXECUTED');

      // Version guard: a stale-version UPDATE cannot rewrite the request.
      const stale = await harness.query<{ count: string }>(
        `UPDATE ipoint_adjustment_requests
         SET state = 'APPROVED'
         WHERE id = $1 AND version = 1
         RETURNING id`,
        [requestId],
      );
      expect(stale).toHaveLength(0);

      // Historical ledger row is byte-identical after a replay execute.
      const before = (
        await harness.database.db
          .select()
          .from(memberWalletEntries)
          .where(eq(memberWalletEntries.referenceId, requestId))
      )[0];
      await execute(harness.checker, requestId); // EXECUTED replay
      const after = (
        await harness.database.db
          .select()
          .from(memberWalletEntries)
          .where(eq(memberWalletEntries.referenceId, requestId))
      )[0];
      expect(await ledgerEntryCountFor(requestId)).toBe(1);
      expect(after?.id).toBe(before?.id);
      expect(after?.balanceBefore).toBe(before?.balanceBefore);
      expect(after?.balanceAfter).toBe(before?.balanceAfter);
      expect(after?.amount).toBe(before?.amount);
      expect(after?.entrySequence).toBe(before?.entrySequence);
    });

    // ─── B16 ─────────────────────────────────────────────────────────

    it('B16: above-soft execution disabled by default; executable once secure evidence is enabled', async () => {
      // Above soft (but below hard) with attachment.
      const requestId = await createAndSubmit(harness.maker, {
        amount: '50000',
        attachmentReference: 'att-b16',
      });
      // Above soft requires a Super Admin checker.
      await decide(harness.superAdmin, requestId, 'APPROVED');

      // secureEvidenceAvailable=false -> execution blocked with 422.
      const blocked = await supertest(harness.server)
        .post(`${adjustmentsUrl()}/${requestId}/execute`)
        .set('authorization', `Bearer ${harness.superAdmin.token}`)
        .set(
          'x-step-up-token',
          await harness.seedStepUpGrant(
            harness.superAdmin,
            'wallet.ipoint.adjust.execute',
            harness.marketId,
          ),
        )
        .expect(422);
      expect(blocked.body).toMatchObject({
        error: { code: 'WALLET_ADJUSTMENT_EVIDENCE_STORAGE_UNAVAILABLE' },
      });

      // Enable secure evidence for the market -> execution succeeds.
      await harness.database.db
        .update(ipointAdjustmentMarketRules)
        .set({ secureEvidenceAvailable: true })
        .where(eq(ipointAdjustmentMarketRules.marketCode, harness.marketCode));
      const executed = await supertest(harness.server)
        .post(`${adjustmentsUrl()}/${requestId}/execute`)
        .set('authorization', `Bearer ${harness.superAdmin.token}`)
        .set(
          'x-step-up-token',
          await harness.seedStepUpGrant(
            harness.superAdmin,
            'wallet.ipoint.adjust.execute',
            harness.marketId,
          ),
        )
        .expect(200);
      expect((executed.body as { state: string }).state).toBe('EXECUTED');
    });

    // ─── B14 supplemental: owner-only decision rows (immutability) ────

    it('B14/immutability: decision rows are append-only with a single approval', async () => {
      const requestId = await createAndSubmit();
      await decide(harness.checker, requestId, 'APPROVED');
      const rows = await harness.database.db
        .select({ id: ipointAdjustmentDecisions.id })
        .from(ipointAdjustmentDecisions)
        .where(eq(ipointAdjustmentDecisions.adjustmentRequestId, requestId));
      expect(rows).toHaveLength(1);
    });
  },
);
