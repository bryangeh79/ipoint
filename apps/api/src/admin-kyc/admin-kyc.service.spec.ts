import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import type { AuditService } from '../platform-access/audit.service.js';
import { approveSchema } from './admin-kyc.dto.js';
import { AdminKycService } from './admin-kyc.service.js';

const adminUserId = randomUUID();
const adminAccountId = randomUUID();
const memberAccountId = randomUUID();
const memberId = randomUUID();
const marketId = randomUUID();
const caseId = randomUUID();
const now = new Date('2026-07-18T10:00:00.000Z');

function kycCase(status = 'SUBMITTED') {
  return {
    id: caseId,
    memberId,
    marketId,
    status,
    version: 1,
    levelRequested: 'LEVEL_2',
    legalFullName: 'Alice Member',
    identificationType: 'NATIONAL_ID',
    identificationNumber: 'MY1234567890',
    dateOfBirth: '1990-01-02',
    nationality: 'MY',
    residentialAddress: { line1: '1 Test Street' },
    accountCountrySnapshot: 'MY',
    submissionMarketId: marketId,
    consentVersion: 'KYC_LEVEL_2_V1',
    submittedAt: now,
    reviewedAt: null,
    reviewedByAdminUserId: null,
    decisionReason: null,
    reverificationRequiredAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function detailRow(status: string, kycLevel = 'LEVEL_1') {
  return {
    kycCase: {
      ...kycCase(status),
      reviewedAt: status === 'UNDER_REVIEW' ? null : now,
      reviewedByAdminUserId: adminUserId,
      decisionReason: 'Reviewed for test',
      reverificationRequiredAt:
        status === 'REVERIFICATION_REQUIRED' ? now : null,
    },
    publicMemberId: 'MEM-TEST-001',
    memberStatus: 'ACTIVE',
    kycLevel,
    displayName: 'Alice',
    email: 'alice@example.com',
    accountCountry: 'MY',
  };
}

function historyRow(eventType = 'SUBMITTED') {
  return {
    id: randomUUID(),
    memberKycCaseId: caseId,
    eventType,
    actorType: 'ACCOUNT',
    actorId: memberAccountId,
    summary: eventType.toLowerCase(),
    metadata: {},
    occurredAt: now,
  };
}

interface FakeOptions {
  selects?: unknown[][];
  insertReturning?: unknown[][];
  updateReturning?: unknown[][];
  transactionError?: Error;
}

function createService(options: FakeOptions = {}) {
  const selects = [...(options.selects ?? [])];
  const insertReturning = [...(options.insertReturning ?? [])];
  const updateReturning = [...(options.updateReturning ?? [])];

  function query(result: unknown[]) {
    const promise = Promise.resolve(result);
    return {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      for: vi.fn().mockReturnThis(),
      then: promise.then.bind(promise),
    };
  }

  function mutation(returningQueue: unknown[][]) {
    const promise = Promise.resolve([]);
    return {
      values: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn(() => Promise.resolve(returningQueue.shift() ?? [])),
      then: promise.then.bind(promise),
    };
  }

  const db = {
    select: vi.fn(() => query(selects.shift() ?? [])),
    insert: vi.fn(() => mutation(insertReturning)),
    update: vi.fn(() => mutation(updateReturning)),
  };
  let rolledBack = false;
  const database = {
    db,
    runTransaction: vi.fn(
      async (callback: (tx: typeof db) => Promise<unknown>) => {
        try {
          if (options.transactionError) throw options.transactionError;
          return await callback(db);
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      },
    ),
  };
  const audit = {
    appendWithinTransaction: vi.fn().mockResolvedValue(undefined),
  };
  return {
    service: new AdminKycService(
      database as unknown as DatabaseService,
      audit as unknown as AuditService,
    ),
    database,
    audit,
    get rolledBack() {
      return rolledBack;
    },
  };
}

function actionService(
  fromStatus: string,
  toStatus: string,
  options: {
    selfReview?: boolean;
    cached?: boolean;
    failMember?: boolean;
  } = {},
) {
  const response = {
    ...detailRow(toStatus, toStatus === 'APPROVED' ? 'LEVEL_2' : 'LEVEL_1'),
  };
  const cachedResponse = {
    id: caseId,
    status: toStatus,
    member: { kycLevel: toStatus === 'APPROVED' ? 'LEVEL_2' : 'LEVEL_1' },
  };
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        action:
          toStatus === 'UNDER_REVIEW'
            ? 'start-review'
            : toStatus === 'MORE_INFO_REQUIRED'
              ? 'request-more-info'
              : toStatus === 'APPROVED'
                ? 'approve'
                : toStatus === 'REJECTED'
                  ? 'reject'
                  : 'require-reverification',
        caseId,
        reason: 'Reviewed for test',
      }),
    )
    .digest('hex');
  return createService({
    selects: [
      [
        {
          kycCase: kycCase(fromStatus),
          memberAccountId,
          memberId,
        },
      ],
      [
        {
          accountId: options.selfReview ? memberAccountId : adminAccountId,
        },
      ],
      options.cached
        ? [{ requestHash, response: cachedResponse, statusCode: 200 }]
        : [],
      ...(options.cached ? [] : [[response], [], [historyRow()]]),
    ],
    insertReturning: options.cached ? [] : [[{ id: randomUUID() }]],
    updateReturning: options.cached
      ? []
      : toStatus === 'APPROVED'
        ? [[{ id: caseId }], options.failMember ? [] : [{ id: memberId }]]
        : [[{ id: caseId }]],
  });
}

const actor = { adminUserId };
const input = { reason: 'Reviewed for test' };

describe('AdminKycService', () => {
  it('lists cases visible through the admin market access grant', async () => {
    const { service } = createService({
      selects: [[detailRow('SUBMITTED')], [{ value: 1 }]],
    });
    const result = await service.listCases(actor, {
      page: 1,
      pageSize: 20,
    });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('returns no cases when the admin has no market access', async () => {
    const { service } = createService({ selects: [[], [{ value: 0 }]] });
    await expect(
      service.listCases(actor, { page: 1, pageSize: 20 }),
    ).resolves.toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });

  it('gets case detail with masked identification number', async () => {
    const { service } = createService({
      selects: [
        [{ marketId }],
        [{ accountId: adminAccountId }],
        [detailRow('SUBMITTED')],
        [],
        [historyRow()],
      ],
    });
    const result = await service.getCase(actor, caseId);
    expect(result.identificationNumber).toBe('****7890');
    expect(result.member.email).toBe('a***@example.com');
  });

  it('starts review from SUBMITTED', async () => {
    const { service } = actionService('SUBMITTED', 'UNDER_REVIEW');
    await expect(
      service.startReview(actor, caseId, input, 'start-1'),
    ).resolves.toMatchObject({ status: 'UNDER_REVIEW' });
  });

  it('rejects start review from an invalid state', async () => {
    const { service } = actionService('DRAFT', 'UNDER_REVIEW');
    await expect(
      service.startReview(actor, caseId, input, 'start-invalid'),
    ).rejects.toMatchObject({ code: 'ADMIN_KYC_INVALID_STATE' });
  });

  it('requests more information from UNDER_REVIEW', async () => {
    const { service } = actionService('UNDER_REVIEW', 'MORE_INFO_REQUIRED');
    await expect(
      service.requestMoreInfo(actor, caseId, input, 'more-info-1'),
    ).resolves.toMatchObject({ status: 'MORE_INFO_REQUIRED' });
  });

  it('approves the case and returns the updated member LEVEL_2', async () => {
    const { service } = actionService('UNDER_REVIEW', 'APPROVED');
    await expect(
      service.approve(actor, caseId, input, 'approve-1'),
    ).resolves.toMatchObject({
      status: 'APPROVED',
      member: { kycLevel: 'LEVEL_2' },
    });
  });

  it('rolls back approval when the member KYC level update fails', async () => {
    const fake = actionService('UNDER_REVIEW', 'APPROVED', {
      failMember: true,
    });
    await expect(
      fake.service.approve(actor, caseId, input, 'approve-fail'),
    ).rejects.toThrow('Member KYC level update returned no row.');
    expect(fake.rolledBack).toBe(true);
    expect(fake.audit.appendWithinTransaction).not.toHaveBeenCalled();
  });

  it('rejects a case from UNDER_REVIEW', async () => {
    const { service } = actionService('UNDER_REVIEW', 'REJECTED');
    await expect(
      service.reject(actor, caseId, input, 'reject-1'),
    ).resolves.toMatchObject({ status: 'REJECTED' });
  });

  it('requires reverification from APPROVED', async () => {
    const { service } = actionService('APPROVED', 'REVERIFICATION_REQUIRED');
    await expect(
      service.requireReverification(actor, caseId, input, 'reverify-1'),
    ).resolves.toMatchObject({ status: 'REVERIFICATION_REQUIRED' });
  });

  it('allows only the first result of concurrent approve/reject decisions', async () => {
    const first = actionService('UNDER_REVIEW', 'APPROVED');
    const second = actionService('APPROVED', 'REJECTED');
    const results = await Promise.allSettled([
      first.service.approve(actor, caseId, input, 'concurrent-approve'),
      second.service.reject(actor, caseId, input, 'concurrent-reject'),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
    ]);
  });

  it('prevents an admin from reviewing their own member case', async () => {
    const { service } = actionService('SUBMITTED', 'UNDER_REVIEW', {
      selfReview: true,
    });
    await expect(
      service.startReview(actor, caseId, input, 'self-review'),
    ).rejects.toMatchObject({ code: 'ADMIN_KYC_SELF_REVIEW' });
  });

  it('returns the cached response for the same idempotency key', async () => {
    const { service } = actionService('UNDER_REVIEW', 'APPROVED', {
      cached: true,
    });
    await expect(
      service.approve(actor, caseId, input, 'cached-approve'),
    ).resolves.toMatchObject({ id: caseId, status: 'APPROVED' });
  });

  it('requires a non-empty review reason', () => {
    expect(approveSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(approveSchema.safeParse({}).success).toBe(false);
  });
});
