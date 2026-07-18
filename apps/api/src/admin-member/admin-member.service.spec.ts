import { randomUUID } from 'node:crypto';
import {
  adminMemberNotes,
  memberStatusHistory,
  sessions,
} from '@ipoint/database';
import { describe, expect, it, vi } from 'vitest';
import type { AdminKycService } from '../admin-kyc/admin-kyc.service.js';
import type { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import { AdminMemberService } from './admin-member.service.js';

const adminUserId = randomUUID();
const memberId = randomUUID();
const accountId = randomUUID();
const marketId = randomUUID();
const caseId = randomUUID();
const publicMemberId = 'MEM-TEST-001';
const now = new Date('2026-07-18T12:00:00.000Z');
const actor = { adminUserId };

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

function mutation(returning: unknown[][]) {
  const promise = Promise.resolve([]);
  return {
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn(() => Promise.resolve(returning.shift() ?? [])),
    then: promise.then.bind(promise),
  };
}

function createService(selects: unknown[][] = [], returning: unknown[][] = []) {
  const selectQueue = [...selects];
  const returningQueue = [...returning];
  const db = {
    select: vi.fn(() => query(selectQueue.shift() ?? [])),
    insert: vi.fn(() => mutation(returningQueue)),
    update: vi.fn(() => mutation(returningQueue)),
  };
  const database = {
    db,
    runTransaction: vi.fn((callback: (tx: typeof db) => Promise<unknown>) =>
      callback(db),
    ),
  };
  const audit = new AuditService(database as unknown as DatabaseService);
  const adminKyc = { requireReverification: vi.fn().mockResolvedValue({}) };
  return {
    service: new AdminMemberService(
      database as unknown as DatabaseService,
      audit,
      adminKyc as unknown as AdminKycService,
    ),
    db,
    database,
    adminKyc,
  };
}

function locked(status = 'ACTIVE') {
  return { memberId, accountId, publicMemberId, status, marketId };
}

function baseDetail(status = 'ACTIVE') {
  return {
    member: {
      id: memberId,
      accountId,
      publicMemberId,
      status,
      kycLevel: 'LEVEL_2',
      closedAt: status === 'CLOSED' ? now : null,
      createdAt: now,
    },
    account: { email: 'alice@example.com', accountCountry: 'MY' },
    profile: {
      displayName: 'Alice',
      fullName: 'Alice Member',
      phone: '+60123456789',
      phoneVerificationStatus: 'VERIFIED',
      birthDate: '1990-01-01',
      address: { city: 'Kuala Lumpur' },
      locale: 'en-MY',
      language: 'en',
    },
  };
}

function detailSelects(status = 'ACTIVE') {
  return [
    [baseDetail(status)],
    [
      {
        preference: {
          marketId,
          isEnabled: true,
          isCurrent: true,
          sortOrder: 0,
          lastSelectedAt: now,
        },
        marketCode: 'MY',
      },
    ],
    [
      {
        id: caseId,
        marketId,
        status: 'APPROVED',
        levelRequested: 'LEVEL_2',
        legalFullName: 'Alice Member',
        identificationType: 'NATIONAL_ID',
        identificationNumber: 'MY1234567890',
        submittedAt: now,
        reviewedAt: now,
        reverificationRequiredAt: null,
      },
    ],
    [],
    [],
  ];
}

function actionSelects(status = 'ACTIVE', responseStatus = status) {
  return [
    [locked(status)],
    [{ id: adminUserId }],
    [],
    ...detailSelects(responseStatus),
  ];
}

describe('AdminMemberService', () => {
  it('lists filtered members with masked email and pagination', async () => {
    const { service } = createService([
      [
        {
          publicMemberId,
          displayName: 'Alice',
          email: 'alice@example.com',
          status: 'ACTIVE',
          kycLevel: 'LEVEL_2',
          accountCountry: 'MY',
          currentMarketId: marketId,
          createdAt: now,
        },
      ],
      [{ value: 1 }],
    ]);
    const result = await service.listMembers(actor, {
      page: 1,
      pageSize: 20,
      status: 'ACTIVE',
      kycLevel: 'LEVEL_2',
      marketId,
      query: 'alice',
      createdAfter: new Date('2026-01-01T00:00:00Z'),
      createdBefore: new Date('2026-12-31T00:00:00Z'),
      sort: 'createdAt:desc',
    });
    expect(result).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(result.members[0]?.email).toBe('a***@example.com');
  });

  it('returns detail with profile, KYC, preferences, notes, history and masks sensitive fields', async () => {
    const { service } = createService([
      [{ memberId, accountId, marketId }],
      [{ id: adminUserId }],
      ...detailSelects(),
    ]);
    const result = await service.getMember(actor, publicMemberId);
    expect(result.profile.phone).toBe('********6789');
    expect(result.kyc?.identificationNumber).toBe('****7890');
    expect(result.marketPreferences[0]?.marketCode).toBe('MY');
  });

  it('suspends an ACTIVE member, revokes sessions, and appends history/audit', async () => {
    const { service, db, database } = createService(
      actionSelects('ACTIVE', 'SUSPENDED'),
      [[{ id: randomUUID() }], [{ id: memberId }]],
    );
    const result = await service.suspendMember(actor, publicMemberId, {
      reason: 'Risk review',
      idempotencyKey: 'suspend-1',
    });
    expect(result.status).toBe('SUSPENDED');
    expect(database.runTransaction).toHaveBeenCalledOnce();
    expect(db.update).toHaveBeenCalledWith(sessions);
    expect(db.insert).toHaveBeenCalledWith(memberStatusHistory);
  });

  it('reactivates without restoring or creating sessions', async () => {
    const { service, db } = createService(
      actionSelects('SUSPENDED', 'ACTIVE'),
      [[{ id: randomUUID() }], [{ id: memberId }]],
    );
    await service.reactivateMember(actor, publicMemberId, {
      reason: 'Review passed',
      idempotencyKey: 'reactivate-1',
    });
    expect(db.update).not.toHaveBeenCalledWith(sessions);
  });

  it('closes ACTIVE or SUSPENDED members only with confirmation and revokes sessions', async () => {
    const { service, db } = createService(
      actionSelects('SUSPENDED', 'CLOSED'),
      [[{ id: randomUUID() }], [{ id: memberId }]],
    );
    const result = await service.closeMember(actor, publicMemberId, {
      reason: 'Governed closure',
      confirmationText: 'CONFIRM',
      idempotencyKey: 'close-1',
    });
    expect(result.status).toBe('CLOSED');
    expect(db.update).toHaveBeenCalledWith(sessions);
  });

  it('rejects close without the exact confirmation text at the service boundary', async () => {
    const { service } = createService();
    await expect(
      service.closeMember(actor, publicMemberId, {
        reason: 'Closure',
        confirmationText: 'NO' as 'CONFIRM',
        idempotencyKey: 'close-bad',
      }),
    ).rejects.toMatchObject({
      code: 'ADMIN_MEMBER_CLOSE_CONFIRMATION_REQUIRED',
    });
  });

  it('revokes all active sessions as an idempotent audited transaction', async () => {
    const { service, db } = createService(actionSelects(), [
      [{ id: randomUUID() }],
    ]);
    await service.revokeSessions(actor, publicMemberId, {
      reason: 'Member requested logout',
      idempotencyKey: 'sessions-1',
    });
    expect(db.update).toHaveBeenCalledWith(sessions);
  });

  it('reuses the P2-S6 KYC service for reverification', async () => {
    const { service, adminKyc } = createService([
      [{ memberId, accountId, marketId }],
      [{ id: adminUserId }],
      [{ id: caseId, status: 'APPROVED' }],
      [{ memberId, accountId, marketId }],
      [{ id: adminUserId }],
      ...detailSelects(),
    ]);
    await service.requireReverification(actor, publicMemberId, {
      reason: 'Document expired',
      idempotencyKey: 'reverify-1',
    });
    expect(adminKyc.requireReverification).toHaveBeenCalledWith(
      expect.objectContaining({ adminUserId }),
      caseId,
      { reason: 'Document expired' },
      'reverify-1',
    );
  });

  it('adds an append-only length-bounded admin note', async () => {
    const { service, db } = createService(actionSelects(), [
      [{ id: randomUUID() }],
    ]);
    await service.addAdminNote(actor, publicMemberId, {
      content: ' Customer called support. ',
      isInternal: true,
      idempotencyKey: 'note-1',
    });
    expect(db.insert).toHaveBeenCalledWith(adminMemberNotes);
    await expect(
      service.addAdminNote(actor, publicMemberId, {
        content: 'x'.repeat(5001),
        isInternal: true,
        idempotencyKey: 'note-long',
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_MEMBER_NOTE_TOO_LONG' });
  });

  it('returns a cached response for the same idempotency key', async () => {
    const input = { reason: 'Risk review', idempotencyKey: 'same-key' };
    const { service, db } = createService();
    const hash = (
      service as unknown as { hashPayload(value: unknown): string }
    ).hashPayload(input);
    db.select
      .mockReset()
      .mockReturnValueOnce(query([locked('ACTIVE')]))
      .mockReturnValueOnce(query([{ id: adminUserId }]))
      .mockReturnValueOnce(
        query([{ requestHash: hash, response: { status: 'SUSPENDED' } }]),
      );
    await expect(
      service.suspendMember(actor, publicMemberId, input),
    ).resolves.toEqual({ status: 'SUSPENDED' });
    expect(db.update).not.toHaveBeenCalled();
  });

  it('allows only one conditional transition under concurrent attempts', async () => {
    const first = createService(actionSelects('ACTIVE', 'SUSPENDED'), [
      [{ id: randomUUID() }],
      [{ id: memberId }],
    ]);
    const second = createService(actionSelects('ACTIVE', 'SUSPENDED'), [
      [{ id: randomUUID() }],
      [],
    ]);
    const results = await Promise.allSettled([
      first.service.suspendMember(actor, publicMemberId, {
        reason: 'A',
        idempotencyKey: 'race-a',
      }),
      second.service.suspendMember(actor, publicMemberId, {
        reason: 'B',
        idempotencyKey: 'race-b',
      }),
    ]);
    expect(results.map((item) => item.status)).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(results[1]).toMatchObject({
      reason: { code: 'ADMIN_MEMBER_STATUS_TRANSITION_FAILED' },
    });
  });
});
