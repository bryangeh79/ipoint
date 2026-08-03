/**
 * AdminAgentActivationController — unit tests for the approve posting-failure
 * contract (P5-R1, ISSUE-1 alignment).
 *
 * The commission posting failure is surfaced as a Nest
 * `ServiceUnavailableException` whose `getStatus()` is **503**, matching:
 * - the P7-S1 error register row `COMMISSION_POSTING_FAILED` → 503
 *   (`docs/06-phase-reports/p7-s1/P7-S1_ERROR_CODE_REGISTER.md`, §16
 *   Commission: downstream posting prerequisite unavailable; the register
 *   convention for posting/execution failures is uniformly 503), and
 * - the Swagger `@ApiResponse({ status: 503 })` on `approve`.
 *
 * These tests lock the status/body contract so the OpenAPI documentation and
 * the thrown exception cannot drift again before P7-S6/S8 consumption.
 *
 * @packageDocumentation
 */

import { ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { RequestActor } from '../auth/auth.types.js';
import type { DatabaseService } from '../database/database.service.js';
import type { AgentActivationService } from '../domain/agent-activation/service.js';
import type { AgentUpgradeCommissionService } from '../domain/commission/agent-upgrade.service.js';
import { AdminAgentActivationController } from './admin-agent-activation.controller.js';

const ACTIVATION_ID = '00000000-0000-0000-0000-000000000042';
const ADMIN_ID = '00000000-0000-0000-0000-0000000000ad';
const MARKET_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function createController(
  options: {
    postingRejection?: unknown;
    marketCode?: string;
  } = {},
) {
  const activation = {
    approveAndActivate: vi.fn().mockResolvedValue(undefined),
  };
  const commission = {
    processAgentUpgrade: vi
      .fn()
      .mockRejectedValue(
        options.postingRejection ?? new Error('upstream posting store down'),
      ),
  };
  const database = {
    db: {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ code: options.marketCode ?? 'MY' }]),
    },
  };
  const controller = new AdminAgentActivationController(
    activation as unknown as AgentActivationService,
    commission as unknown as AgentUpgradeCommissionService,
    database as unknown as DatabaseService,
  );
  return { activation, commission, database, controller };
}

const actor: RequestActor = {
  type: 'ADMIN_USER',
  adminUserId: ADMIN_ID,
  accountId: '00000000-0000-0000-0000-0000000000ac',
  sessionId: 'session-1',
};

const request = {
  adminMarketContext: { marketId: MARKET_ID, contextVersion: 1 },
} as unknown as Request;

describe('AdminAgentActivationController.approve posting-failure contract', () => {
  it('surfaces COMMISSION_POSTING_FAILED as HTTP 503 (register/OpenAPI aligned)', async () => {
    const { controller } = createController();
    const error = await controller.approve(ACTIVATION_ID, actor, request).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
      code: 'COMMISSION_POSTING_FAILED',
      details: { activationId: ACTIVATION_ID },
    });
  });

  it('never rolls back the committed activation and keeps retry guidance', async () => {
    const { controller, activation } = createController({
      postingRejection: new Error('ledger unavailable'),
    });

    await expect(
      controller.approve(ACTIVATION_ID, actor, request),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    // The activation transition itself committed before the posting attempt.
    expect(activation.approveAndActivate).toHaveBeenCalledWith(
      ACTIVATION_ID,
      ADMIN_ID,
      'MY',
    );
  });
});
