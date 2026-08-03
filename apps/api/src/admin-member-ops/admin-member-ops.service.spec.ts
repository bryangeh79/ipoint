import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AdminMemberService } from '../admin-member/admin-member.service.js';
import { memberMarketAccessDeniedError } from '../admin-member/admin-member.errors.js';
import type {
  AdminMemberDetailResponse,
  AdminMemberListResponse,
  AdminMemberNotesListResponse,
} from '../admin-member/admin-member.types.js';
import { AuditService } from '../platform-access/audit.service.js';
import { DatabaseService } from '../database/database.service.js';
import { AdminMemberOpsService } from './admin-member-ops.service.js';

/**
 * P7-S5A adapter unit tests.
 *
 * The frozen Phase 2 owner service and the canonical AuditService are mocked;
 * these tests prove the adapter enforces the selected-market contract and
 * delegates untouched inputs to the owner commands (no reimplementation of
 * state logic, masking, idempotency, or audit is present in the adapter).
 */

const ACTOR = { adminUserId: 'admin-1', ipAddress: '127.0.0.1' };
const MARKET_A = '11111111-1111-1111-1111-111111111111';
const MARKET_B = '22222222-2222-2222-2222-222222222222';

function detailFor(
  marketId: string,
  status: AdminMemberDetailResponse['status'] = 'ACTIVE',
): AdminMemberDetailResponse {
  return {
    publicMemberId: 'mem_public_1',
    displayName: null,
    email: 'a***@example.com',
    status,
    kycLevel: 'LEVEL_1',
    accountCountry: 'MY',
    currentMarketId: marketId,
    createdAt: '2026-08-01T00:00:00.000Z',
    closedAt: null,
    profile: {
      fullName: null,
      phone: null,
      phoneVerificationStatus: 'NOT_PROVIDED',
      birthDate: null,
      address: null,
      locale: null,
      language: null,
    },
    kyc: null,
    marketPreferences: [
      {
        marketId,
        marketCode: 'MA',
        isEnabled: true,
        isCurrent: true,
        sortOrder: 0,
        lastSelectedAt: null,
      },
    ],
    notes: [],
    statusHistory: [],
  };
}

const listResponse: AdminMemberListResponse = {
  members: [],
  total: 0,
  page: 1,
  pageSize: 20,
};

const notesResponse: AdminMemberNotesListResponse = {
  notes: [],
  total: 0,
  page: 1,
  pageSize: 20,
};

function createMocks() {
  const mocks = {
    listMembers: vi.fn().mockResolvedValue(listResponse),
    getMember: vi.fn().mockResolvedValue(detailFor(MARKET_A)),
    getMemberNotes: vi.fn().mockResolvedValue(notesResponse),
    suspendMember: vi.fn().mockResolvedValue(detailFor(MARKET_A, 'SUSPENDED')),
    reactivateMember: vi.fn().mockResolvedValue(detailFor(MARKET_A, 'ACTIVE')),
    closeMember: vi.fn().mockResolvedValue(detailFor(MARKET_A, 'CLOSED')),
    revokeSessions: vi.fn().mockResolvedValue(detailFor(MARKET_A)),
    requireReverification: vi
      .fn()
      .mockResolvedValue(detailFor(MARKET_A, 'ACTIVE')),
    addAdminNote: vi.fn().mockResolvedValue(detailFor(MARKET_A)),
  };
  const owner = mocks as unknown as AdminMemberService;

  const audit = {
    recordPrivilegedAction: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const database = {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: 'internal-member-1' }],
          }),
        }),
      }),
    },
  } as unknown as DatabaseService;

  const service = new AdminMemberOpsService(owner, audit, database);
  return { mocks, owner, audit, service };
}

const WRITE_METHODS = [
  'suspendMember',
  'reactivateMember',
  'closeMember',
  'revokeSessions',
  'requireReverification',
  'addAdminNote',
] as const;

describe('AdminMemberOpsService (P7-S5A selected-market adapter)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forces the server-owned Current Admin Market onto the owner list and echoes it', async () => {
    const { mocks, service } = createMocks();
    const result = await service.listMembers(ACTOR, MARKET_A, {
      page: 1,
      pageSize: 20,
      status: 'ACTIVE',
    });
    expect(mocks.listMembers).toHaveBeenCalledWith(ACTOR, {
      page: 1,
      pageSize: 20,
      status: 'ACTIVE',
      currentMarket: MARKET_A,
    });
    expect(result.marketId).toBe(MARKET_A);
  });

  it('never accepts a client market filter on the list (schema excludes it)', async () => {
    const { mocks, service } = createMocks();
    await service.listMembers(ACTOR, MARKET_A, {
      page: 1,
      pageSize: 20,
    });
    const passed = mocks.listMembers.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(passed['marketId']).toBeUndefined();
    expect(passed['currentMarket']).toBe(MARKET_A);
  });

  it('returns the owner detail for a member in the selected market and audits the view', async () => {
    const { mocks, audit, service } = createMocks();
    const detail = await service.getMember(ACTOR, MARKET_A, 'mem_public_1');
    expect(detail.currentMarketId).toBe(MARKET_A);
    expect(mocks.getMember).toHaveBeenCalledWith(ACTOR, 'mem_public_1');
    expect(audit.recordPrivilegedAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { type: 'ADMIN_USER', id: 'admin-1' },
        action: 'member.ops.view',
        entity: { type: 'member', id: 'internal-member-1' },
        marketId: MARKET_A,
        result: 'SUCCESS',
      }),
    );
  });

  it('rejects a member whose current market is not the selected market without auditing', async () => {
    const { mocks, audit, service } = createMocks();
    mocks.getMember.mockResolvedValue(detailFor(MARKET_B));
    await expect(
      service.getMember(ACTOR, MARKET_A, 'mem_public_1'),
    ).rejects.toMatchObject({ code: 'MEMBER_OPS_MARKET_MISMATCH' });
    expect(audit.recordPrivilegedAction).not.toHaveBeenCalled();
  });

  it.each([
    ['suspendMember', 'suspend'],
    ['reactivateMember', 'reactivate'],
    ['closeMember', 'close'],
    ['revokeSessions', 'revoke'],
    ['requireReverification', 'reverify'],
    ['addAdminNote', 'note'],
  ] as unknown as Array<[string, string]>)(
    'pre-validates the selected market and delegates %s untouched',
    async (method: string) => {
      const { mocks, service } = createMocks();
      const input = { reason: 'reason', idempotencyKey: 'key-1' };
      const raw = (
        service as unknown as Record<
          string,
          (
            actor: typeof ACTOR,
            marketId: string,
            memberId: string,
            payload: { reason: string; idempotencyKey: string },
          ) => Promise<AdminMemberDetailResponse>
        >
      )[method];
      if (!raw) throw new Error(`Unknown adapter method: ${method}`);
      const call = raw.bind(service);
      await call(ACTOR, MARKET_A, 'mem_public_1', input);
      expect(mocks[method as keyof typeof mocks]).toHaveBeenCalledWith(
        ACTOR,
        'mem_public_1',
        input,
      );
    },
  );

  it.each(WRITE_METHODS as unknown as string[])(
    'blocks %s for a member outside the selected market without calling the owner command',
    async (method: string) => {
      const { mocks, service } = createMocks();
      mocks.getMember.mockResolvedValue(detailFor(MARKET_B));
      const raw = (
        service as unknown as Record<
          string,
          (
            actor: typeof ACTOR,
            marketId: string,
            memberId: string,
            payload: { reason: string; idempotencyKey: string },
          ) => Promise<AdminMemberDetailResponse>
        >
      )[method];
      if (!raw) throw new Error(`Unknown adapter method: ${method}`);
      const call = raw.bind(service);
      await expect(
        call(ACTOR, MARKET_A, 'mem_public_1', {
          reason: 'reason',
          idempotencyKey: 'key-1',
        }),
      ).rejects.toMatchObject({ code: 'MEMBER_OPS_MARKET_MISMATCH' });
      expect(mocks[method as keyof typeof mocks]).not.toHaveBeenCalled();
    },
  );

  it('returns owner notes for a selected-market member without extra projection', async () => {
    const { mocks, service } = createMocks();
    const result = await service.getMemberNotes(
      ACTOR,
      MARKET_A,
      'mem_public_1',
      { page: 1, pageSize: 20 },
    );
    expect(result).toEqual(notesResponse);
    expect(mocks.getMemberNotes).toHaveBeenCalledWith(ACTOR, 'mem_public_1', {
      page: 1,
      pageSize: 20,
    });
  });

  it('propagates frozen owner errors (e.g. market grant denial) unchanged', async () => {
    const { mocks, service } = createMocks();
    mocks.getMember.mockRejectedValue(memberMarketAccessDeniedError());
    await expect(
      service.getMember(ACTOR, MARKET_A, 'mem_public_1'),
    ).rejects.toMatchObject({ code: 'ADMIN_MEMBER_MARKET_ACCESS_DENIED' });
  });
});
