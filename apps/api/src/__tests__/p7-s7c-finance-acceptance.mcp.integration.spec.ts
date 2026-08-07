import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  auditLogs,
  mcpAdjustmentDecisions,
  mcpAdjustmentRequests,
  mcpLedgerEntries,
  mcpAccounts,
} from '@ipoint/database';
import { and, eq } from 'drizzle-orm';
import { McpAdjustmentOwnerService } from '../merchant/mcp-adjustment.owner.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
  buildAcceptanceHarness,
  createMerchantAndMcpAccount,
  normalizeDecimal,
  type AcceptanceHarness,
} from './p7-s7c-finance-acceptance.helpers.js';

const databaseUrl = process.env['DATABASE_URL'];

/**
 * P7-S7C Finance Acceptance — A1..A10 (Manual MCP).
 *
 * Full HTTP/controller + frozen MCP owner stack on a real PostgreSQL DB:
 * maker/checker lifecycle, immutability, runtime Maker≠Checker, caps
 * routing, evidence rules, idempotency, atomic ledger, double-approval
 * prevention, market isolation and immutable audit.
 */
describe.skipIf(!databaseUrl)(
  'P7-S7C Finance Acceptance A: Manual MCP (real PostgreSQL, HTTP full stack)',
  () => {
    let harness: AcceptanceHarness;
    let app: INestApplication;
    let owner: McpAdjustmentOwnerService;

    const SOFT_CAP = '10000';
    const HARD_CAP = '100000';

    beforeAll(async () => {
      vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
      vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
      vi.stubEnv('AUTH_OTP_PEPPER', 's7c-mcp-pepper-at-least-32-characters');
      vi.stubEnv(
        'REDEMPTION_VOUCHER_ENCRYPTION_KEY',
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      );
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('LOG_LEVEL', 'silent');

      // Fresh isolated DB for this suite (DROP/CREATE).
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
      owner = app.get(McpAdjustmentOwnerService);

      harness.mcpAccountId = await createMerchantAndMcpAccount(
        harness,
        harness.marketId,
      );
      harness.mcpAccountZZId = await createMerchantAndMcpAccount(
        harness,
        harness.marketZZId,
      );

      harness.maker = await harness.createAdmin(
        'MCP Maker Operator',
        'FINANCE_OPERATOR',
      );
      harness.checker = await harness.createAdmin(
        'MCP Checker Approver',
        'FINANCE_APPROVER',
      );
      harness.superAdmin = await harness.createAdmin(
        'MCP Super Admin',
        'SUPER_ADMIN',
      );
      harness.readOnly = await harness.createAdmin(
        'MCP Read Only Auditor',
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

    // ─── HTTP helpers ────────────────────────────────────────────────

    function createUrl(marketId: string = harness.marketId) {
      return `/api/v1/admin/markets/${marketId}/mcp/accounts/${harness.mcpAccountId}/adjustments`;
    }

    function createPayload(overrides: Record<string, unknown> = {}) {
      return {
        type: 'MANUAL_CREDIT',
        amount: '100',
        reasonCode: 'OPERATIONAL_CORRECTION',
        explanation: 'P7-S7C MCP acceptance credit.',
        caseReference: `MCP-${randomUUID().slice(0, 8)}`,
        ...overrides,
      };
    }

    async function createAndSubmit(
      makerToken: string = harness.maker.token,
      overrides: Record<string, unknown> = {},
    ) {
      const created = await supertest(harness.server)
        .post(createUrl())
        .set('authorization', `Bearer ${makerToken}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload(overrides))
        .expect(201);
      const requestId = String((created.body as { id: string }).id);
      await supertest(harness.server)
        .post(
          `/api/v1/admin/markets/${harness.marketId}/mcp/adjustments/${requestId}/submit`,
        )
        .set('authorization', `Bearer ${makerToken}`)
        .expect(200);
      return requestId;
    }

    async function decide(
      admin: AcceptanceHarness['checker'],
      requestId: string,
      decision: 'APPROVED' | 'REJECTED',
      actionClass = 'merchant.mcp.adjust.approve',
    ) {
      return supertest(harness.server)
        .post(
          `/api/v1/admin/markets/${harness.marketId}/mcp/adjustments/${requestId}/decision`,
        )
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
        .post(
          `/api/v1/admin/markets/${harness.marketId}/adjustments/${requestId}/execute`,
        )
        .set('authorization', `Bearer ${admin.token}`)
        .set(
          'x-step-up-token',
          await harness.seedStepUpGrant(
            admin,
            'merchant.mcp.adjust.execute',
            harness.marketId,
          ),
        )
        .expect(200);
    }

    async function accountBalance(): Promise<string> {
      const rows = await harness.database.db
        .select({ availableBalance: mcpAccounts.availableBalance })
        .from(mcpAccounts)
        .where(eq(mcpAccounts.id, harness.mcpAccountId))
        .limit(1);
      return rows[0]?.availableBalance ?? 'MISSING';
    }

    async function ledgerEntryCount(): Promise<number> {
      const rows = await harness.database.db
        .select({ id: mcpLedgerEntries.id })
        .from(mcpLedgerEntries)
        .where(eq(mcpLedgerEntries.mcpAccountId, harness.mcpAccountId));
      return rows.length;
    }

    async function auditActions(requestId: string): Promise<string[]> {
      const rows = await harness.database.db
        .select({
          action: auditLogs.action,
          before: auditLogs.before,
          after: auditLogs.after,
        })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, 'MCP_ADJUSTMENT_REQUEST'),
            eq(auditLogs.entityId, requestId),
          ),
        )
        .orderBy(auditLogs.occurredAt);
      return rows.map((row) => row.action);
    }

    async function decisionCount(requestId: string): Promise<number> {
      const rows = await harness.database.db
        .select({ id: mcpAdjustmentDecisions.id })
        .from(mcpAdjustmentDecisions)
        .where(eq(mcpAdjustmentDecisions.adjustmentRequestId, requestId));
      return rows.length;
    }

    async function requestRow(requestId: string) {
      const rows = await harness.database.db
        .select()
        .from(mcpAdjustmentRequests)
        .where(eq(mcpAdjustmentRequests.id, requestId))
        .limit(1);
      return rows[0];
    }

    // ─── A1 ──────────────────────────────────────────────────────────

    it('A1: maker create -> checker approve -> execute -> EXECUTED (full lifecycle, ledger + audit)', async () => {
      const created = await supertest(harness.server)
        .post(createUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload())
        .expect(201);
      const requestId = String((created.body as { id: string }).id);
      expect((created.body as { state: string }).state).toBe('DRAFT');
      expect(
        (created.body as { makerAdminUserId: string }).makerAdminUserId,
      ).toBe(harness.maker.adminUserId);

      await supertest(harness.server)
        .post(
          `/api/v1/admin/markets/${harness.marketId}/mcp/adjustments/${requestId}/submit`,
        )
        .set('authorization', `Bearer ${harness.maker.token}`)
        .expect(200);

      await decide(harness.checker, requestId, 'APPROVED');

      await execute(harness.checker, requestId);

      const row = await requestRow(requestId);
      expect(row?.status).toBe('EXECUTED');
      expect(row?.checkerAdminUserId).toBe(harness.checker.adminUserId);
      expect(normalizeDecimal(await accountBalance())).toBe('5100');
      expect(await ledgerEntryCount()).toBe(1);

      const entry = (
        await harness.database.db
          .select()
          .from(mcpLedgerEntries)
          .where(eq(mcpLedgerEntries.mcpAccountId, harness.mcpAccountId))
      )[0];
      expect(entry?.sourceType).toBe('MCP_ADJUSTMENT');
      expect(entry?.sourceId).toBe(requestId);
      expect(entry?.entryType).toBe('MANUAL_CREDIT');

      const actions = await auditActions(requestId);
      expect(actions).toEqual(
        expect.arrayContaining([
          'MCP_ADJUSTMENT_CREATED',
          'MCP_ADJUSTMENT_SUBMITTED',
          'MCP_ADJUSTMENT_APPROVED',
          'MCP_ADJUSTMENT_EXECUTED',
        ]),
      );
    });

    // ─── A2 ──────────────────────────────────────────────────────────

    it('A2: checker rejects immutably; only a new linked request (priorRequestId) is allowed', async () => {
      const requestId = await createAndSubmit();

      await decide(harness.checker, requestId, 'REJECTED');
      expect((await requestRow(requestId))?.status).toBe('REJECTED');

      // Immutable: a second decision is rejected with STATE_CONFLICT.
      const second = await supertest(harness.server)
        .post(
          `/api/v1/admin/markets/${harness.marketId}/mcp/adjustments/${requestId}/decision`,
        )
        .set('authorization', `Bearer ${harness.checker.token}`)
        .set(
          'x-step-up-token',
          await harness.seedStepUpGrant(
            harness.checker,
            'merchant.mcp.adjust.approve',
            harness.marketId,
          ),
        )
        .send({ decision: 'APPROVED', reason: 'Trying again.' })
        .expect(409);
      expect(second.body).toMatchObject({
        error: { code: 'MCP_ADJUSTMENT_STATE_CONFLICT' },
      });

      // New linked request via priorRequestId.
      const linked = await supertest(harness.server)
        .post(createUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload({ priorRequestId: requestId }))
        .expect(201);
      expect(
        (linked.body as { priorRequestId: string | null }).priorRequestId,
      ).toBe(requestId);
    });

    // ─── A3 ──────────────────────────────────────────────────────────

    it('A3: Maker≠Checker enforced at runtime (Super Admin alone rejected) and DB CHECK exists', async () => {
      // Super Admin as maker: creates + submits, then attempts to decide own.
      const created = await supertest(harness.server)
        .post(createUrl())
        .set('authorization', `Bearer ${harness.superAdmin.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload())
        .expect(201);
      const requestId = String((created.body as { id: string }).id);
      await supertest(harness.server)
        .post(
          `/api/v1/admin/markets/${harness.marketId}/mcp/adjustments/${requestId}/submit`,
        )
        .set('authorization', `Bearer ${harness.superAdmin.token}`)
        .expect(200);

      const response = await supertest(harness.server)
        .post(
          `/api/v1/admin/markets/${harness.marketId}/mcp/adjustments/${requestId}/decision`,
        )
        .set('authorization', `Bearer ${harness.superAdmin.token}`)
        .set(
          'x-step-up-token',
          await harness.seedStepUpGrant(
            harness.superAdmin,
            'merchant.mcp.adjust.approve',
            harness.marketId,
          ),
        )
        .send({ decision: 'APPROVED', reason: 'Self approval must fail.' })
        .expect(403);
      expect(response.body).toMatchObject({
        error: { code: 'MCP_ADJUSTMENT_MAKER_CHECKER_CONFLICT' },
      });

      // Hard database guarantee: both CHECK constraints exist.
      const constraints = await harness.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
         WHERE conname IN ('mcp_adjustment_checker_inequality', 'ipoint_adjustment_requests_checker_inequality')`,
      );
      expect(constraints.map((c) => c.conname).sort()).toEqual([
        'ipoint_adjustment_requests_checker_inequality',
        'mcp_adjustment_checker_inequality',
      ]);
    });

    // ─── A4 ──────────────────────────────────────────────────────────

    it('A4: caps routing — at/below soft OK for Finance Approver; above soft Super Admin only; above hard blocked; unconfigured market blocked', async () => {
      // At/below soft: FINANCE_APPROVER may check.
      const atSoft = await createAndSubmit(harness.maker.token, {
        amount: String(Number(SOFT_CAP)),
      });
      await decide(harness.checker, atSoft, 'APPROVED');

      // Above soft: FINANCE_APPROVER is denied routing; Super Admin passes.
      const aboveSoft = await createAndSubmit(harness.maker.token, {
        amount: '50000',
        attachmentReference: 'att-above-soft',
      });
      const denied = await supertest(harness.server)
        .post(
          `/api/v1/admin/markets/${harness.marketId}/mcp/adjustments/${aboveSoft}/decision`,
        )
        .set('authorization', `Bearer ${harness.checker.token}`)
        .set(
          'x-step-up-token',
          await harness.seedStepUpGrant(
            harness.checker,
            'merchant.mcp.adjust.approve',
            harness.marketId,
          ),
        )
        .send({ decision: 'APPROVED', reason: 'Routing must fail.' })
        .expect(403);
      expect(denied.body).toMatchObject({
        error: { code: 'MCP_ADJUSTMENT_CHECKER_ROUTING_DENIED' },
      });
      await decide(harness.superAdmin, aboveSoft, 'APPROVED');

      // Above hard cap: create is rejected.
      const aboveHard = await supertest(harness.server)
        .post(createUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(
          createPayload({
            amount: String(Number(HARD_CAP) + 1),
            attachmentReference: 'att-above-hard',
          }),
        )
        .expect(422);
      expect(aboveHard.body).toMatchObject({
        error: { code: 'MCP_ADJUSTMENT_ABOVE_HARD_CAP' },
      });

      // Unconfigured market (ZZ has no caps row -> no fallback).
      await harness.bindCurrentMarket(harness.maker.id, harness.marketZZId);
      const zz = await supertest(harness.server)
        .post(
          `/api/v1/admin/markets/${harness.marketZZId}/mcp/accounts/${harness.mcpAccountZZId}/adjustments`,
        )
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload())
        .expect(422);
      expect(zz.body).toMatchObject({
        error: { code: 'MCP_ADJUSTMENT_MARKET_NOT_CONFIGURED' },
      });
      await harness.bindCurrentMarket(harness.maker.id, harness.marketId);
    });

    // ─── A5 ──────────────────────────────────────────────────────────

    it('A5: reason/detail/case-reference required; attachment policy (above soft / high-risk); opaque reference only', async () => {
      // Required fields -> 400 VALIDATION_ERROR (transport fast-fail).
      const missingExplanation = await supertest(harness.server)
        .post(createUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload({ explanation: undefined }))
        .expect(400);
      expect(missingExplanation.body.error.code).toBe('VALIDATION_ERROR');

      const missingCase = await supertest(harness.server)
        .post(createUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload({ caseReference: undefined }))
        .expect(400);
      expect(missingCase.body.error.code).toBe('VALIDATION_ERROR');

      // Above soft without attachment -> 422 ATTACHMENT_REQUIRED.
      const noAttachment = await supertest(harness.server)
        .post(createUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload({ amount: '50000' }))
        .expect(422);
      expect(noAttachment.body).toMatchObject({
        error: { code: 'MCP_ADJUSTMENT_ATTACHMENT_REQUIRED' },
      });

      // High-risk reason code without attachment -> 422.
      const highRisk = await supertest(harness.server)
        .post(createUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload({ reasonCode: 'FRAUD_RECOVERY' }))
        .expect(422);
      expect(highRisk.body).toMatchObject({
        error: { code: 'MCP_ADJUSTMENT_ATTACHMENT_REQUIRED' },
      });

      // Opaque reference only: stored as-is, never contents.
      const opaque = await supertest(harness.server)
        .post(createUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(
          createPayload({
            amount: '50000',
            attachmentReference: 'att-opaque-001',
          }),
        )
        .expect(201);
      const requestId = String((opaque.body as { id: string }).id);
      const row = await requestRow(requestId);
      expect(row?.attachmentReference).toBe('att-opaque-001');
    });

    // ─── A6 ──────────────────────────────────────────────────────────

    it('A6: idempotency — same key + same payload replays; same key + different payload -> 409', async () => {
      const key = randomUUID();
      const payload = createPayload();
      const first = await supertest(harness.server)
        .post(createUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', key)
        .send(payload)
        .expect(201);
      const firstId = String((first.body as { id: string }).id);

      const replay = await supertest(harness.server)
        .post(createUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', key)
        .send(payload)
        .expect(201);
      expect(String((replay.body as { id: string }).id)).toBe(firstId);

      const conflict = await supertest(harness.server)
        .post(createUrl())
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', key)
        .send(createPayload({ amount: '200' }))
        .expect(409);
      expect(conflict.body).toMatchObject({
        error: { code: 'MCP_ADJUSTMENT_IDEMPOTENCY_CONFLICT' },
      });
    });

    // ─── A7 ──────────────────────────────────────────────────────────

    it('A7: atomic wallet/ledger — injected DB failure rolls back, durably FAILED, retry does not double-post', async () => {
      const requestId = await createAndSubmit();
      await decide(harness.checker, requestId, 'APPROVED');
      const balanceBefore = await accountBalance();
      const entriesBefore = await ledgerEntryCount();

      const spy = vi
        .spyOn(owner, 'appendLedgerEntry')
        .mockRejectedValueOnce(new Error('injected ledger failure'));

      const executed = await supertest(harness.server)
        .post(
          `/api/v1/admin/markets/${harness.marketId}/adjustments/${requestId}/execute`,
        )
        .set('authorization', `Bearer ${harness.checker.token}`)
        .set(
          'x-step-up-token',
          await harness.seedStepUpGrant(
            harness.checker,
            'merchant.mcp.adjust.execute',
            harness.marketId,
          ),
        )
        .expect(200);
      spy.mockRestore();

      expect((executed.body as { state: string }).state).toBe('FAILED');
      expect(normalizeDecimal(await accountBalance())).toBe(
        normalizeDecimal(balanceBefore),
      );
      expect(await ledgerEntryCount()).toBe(entriesBefore);

      // Retry-safe: no duplicate ledger effect.
      const retry = await supertest(harness.server)
        .post(
          `/api/v1/admin/markets/${harness.marketId}/adjustments/${requestId}/execute`,
        )
        .set('authorization', `Bearer ${harness.checker.token}`)
        .set(
          'x-step-up-token',
          await harness.seedStepUpGrant(
            harness.checker,
            'merchant.mcp.adjust.execute',
            harness.marketId,
          ),
        )
        .expect(200);
      expect((retry.body as { state: string }).state).toBe('FAILED');
      expect(await ledgerEntryCount()).toBe(entriesBefore);
    });

    // ─── A8 ──────────────────────────────────────────────────────────

    it('A8: double approval prevention — a request can only be approved once', async () => {
      const requestId = await createAndSubmit();
      await decide(harness.checker, requestId, 'APPROVED');

      const second = await supertest(harness.server)
        .post(
          `/api/v1/admin/markets/${harness.marketId}/mcp/adjustments/${requestId}/decision`,
        )
        .set('authorization', `Bearer ${harness.superAdmin.token}`)
        .set(
          'x-step-up-token',
          await harness.seedStepUpGrant(
            harness.superAdmin,
            'merchant.mcp.adjust.approve',
            harness.marketId,
          ),
        )
        .send({ decision: 'APPROVED', reason: 'Second approval must fail.' })
        .expect(409);
      expect(second.body).toMatchObject({
        error: { code: 'MCP_ADJUSTMENT_STATE_CONFLICT' },
      });
      expect(await decisionCount(requestId)).toBe(1);
    });

    // ─── A9 ──────────────────────────────────────────────────────────

    it('A9: market isolation — mismatched URL market and cross-market operations are rejected', async () => {
      // URL market differs from the Current Admin Market -> 409 (guard).
      const mismatch = await supertest(harness.server)
        .post(
          `/api/v1/admin/markets/${harness.marketZZId}/mcp/accounts/${harness.mcpAccountZZId}/adjustments`,
        )
        .set('authorization', `Bearer ${harness.maker.token}`)
        .set('idempotency-key', randomUUID())
        .send(createPayload())
        .expect(409);
      expect(mismatch.body).toMatchObject({
        error: { code: 'MARKET_CONTEXT_MISMATCH' },
      });

      // Cross-market: create in MY, then operate from ZZ context -> 409.
      const requestId = await createAndSubmit();
      await harness.bindCurrentMarket(harness.maker.id, harness.marketZZId);
      const cross = await supertest(harness.server)
        .post(
          `/api/v1/admin/markets/${harness.marketZZId}/mcp/adjustments/${requestId}/submit`,
        )
        .set('authorization', `Bearer ${harness.maker.token}`)
        .expect(409);
      expect(cross.body).toMatchObject({
        error: { code: 'MCP_ADJUSTMENT_MARKET_CONTEXT_MISMATCH' },
      });
      await harness.bindCurrentMarket(harness.maker.id, harness.marketId);
    });

    // ─── A10 ─────────────────────────────────────────────────────────

    it('A10: immutable audit — append-only with complete before/after values', async () => {
      const requestId = await createAndSubmit();
      await decide(harness.checker, requestId, 'REJECTED');

      const rows = await harness.database.db
        .select({
          action: auditLogs.action,
          before: auditLogs.before,
          after: auditLogs.after,
          result: auditLogs.result,
        })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, 'MCP_ADJUSTMENT_REQUEST'),
            eq(auditLogs.entityId, requestId),
          ),
        )
        .orderBy(auditLogs.occurredAt);
      expect(rows.map((r) => r.action)).toEqual([
        'MCP_ADJUSTMENT_CREATED',
        'MCP_ADJUSTMENT_SUBMITTED',
        'MCP_ADJUSTMENT_REJECTED',
      ]);
      // Every transition row carries complete before/after snapshots; the
      // CREATE row has an `after` snapshot (before is null by definition).
      for (const row of rows) {
        expect(row.after).not.toBeNull();
        expect(row.result).toBe('SUCCESS');
        if (row.action !== 'MCP_ADJUSTMENT_CREATED') {
          expect(row.before).not.toBeNull();
        }
      }
    });

    // ─── A3 DB CHECK (also asserted above); A-readiness guard ────────

    it('guards the harness invariants (configured market, maker != checker)', () => {
      expect(harness.marketId).toBeTruthy();
      expect(harness.maker.adminUserId).not.toBe(harness.checker.adminUserId);
    });
  },
);
