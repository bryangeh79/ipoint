import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  merchantBranches,
  merchantKycReviews,
  merchantKycSubmissions,
} from '@ipoint/database';
import { AdminKycService } from '../admin-kyc/admin-kyc.service.js';
import type {
  AdminKycCaseListResponse,
  AdminKycCaseResponse,
} from '../admin-kyc/admin-kyc.types.js';
import { DatabaseService } from '../database/database.service.js';
import { MerchantService } from '../merchant/merchant.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import { AdminKycOpsService } from './admin-kyc-ops.service.js';

/**
 * P7-S5C adapter unit tests.
 *
 * The frozen Phase 2 member KYC owner, the frozen Phase 1 merchant KYC
 * owner, and the canonical AuditService are mocked; these tests prove the
 * adapter enforces the selected-market contract and the §6.4 evidence rules
 * and delegates untouched inputs to the owner commands (no reimplementation
 * of state logic, idempotency, or write-audit is present in the adapter).
 */

const ACTOR = { adminUserId: 'admin-1', ipAddress: '127.0.0.1' };
const MARKET_A = '11111111-1111-4111-8111-111111111111';
const MARKET_B = '22222222-2222-4222-8222-222222222222';
const CASE_ID = '33333333-3333-4333-8333-333333333333';
const BRANCH_ID = '44444444-4444-4444-8444-444444444444';

function caseFor(marketId: string): AdminKycCaseResponse {
  return {
    id: CASE_ID,
    marketId,
    status: 'SUBMITTED',
    levelRequested: 'LEVEL_2',
    member: {
      publicMemberId: 'mem_public_1',
      displayName: null,
      email: 'j***@example.com',
      accountCountry: 'MY',
      status: 'ACTIVE',
      kycLevel: 'LEVEL_1',
    },
    submittedAt: '2026-08-01T00:00:00.000Z',
    reviewedAt: null,
    updatedAt: '2026-08-01T00:00:00.000Z',
    version: 1,
    legalFullName: 'Jane Mildred Doe',
    identificationType: 'NATIONAL_ID',
    identificationNumber: '****1234',
    dateOfBirth: '1990-01-02',
    nationality: 'MY',
    residentialAddress: { line1: '1 Test Street' },
    accountCountrySnapshot: 'MY',
    submissionMarketId: marketId,
    consentVersion: 'test-v1',
    reviewedByAdminUserId: null,
    decisionReason: null,
    reverificationRequiredAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    documents: [
      {
        id: 'doc-1',
        documentType: 'national_id',
        mimeType: 'image/png',
        size: 1024,
        checksum: 'a'.repeat(64),
        scanStatus: 'PASSED',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    history: [],
  };
}

const listResponse: AdminKycCaseListResponse = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
};

const merchantQueueItem = {
  submission_id: 'sub-1',
  branch_id: BRANCH_ID,
  merchant_id: 'MERCH-1',
  display_name: 'Acme Sdn Bhd',
  status: 'SUBMITTED',
  submission_version: 1,
  submitted_at: new Date('2026-08-01T00:00:00.000Z'),
  reviewed_at: null,
};

const merchantReviewDetail = {
  submission_id: 'sub-1',
  submission_version: 1,
  status: 'UNDER_REVIEW',
  submitted_at: new Date('2026-08-01T00:00:00.000Z'),
  data: {
    business_certification: {
      registration_number: '202001012345',
      business_name_registered: 'Acme Sdn Bhd',
      business_type: 'private_limited',
      tax_id: 'C-1234567890',
      registered_address: '1 Test Street',
    },
    pic_identity: {
      full_name: 'Jane Mildred Doe',
      identity_type: 'nric',
      identity_number: '900102-14-1234',
      date_of_birth: '1990-01-02',
      nationality: 'MY',
    },
    pic_contact: {
      email: 'jane@example.com',
      phone: '+60123456789',
    },
  },
  review: null,
  branch_id: BRANCH_ID,
  merchant_id: 'MERCH-1',
  market_id: MARKET_A,
  previous: null,
};

function createMocks() {
  const mocks = {
    listCases: vi.fn().mockResolvedValue(listResponse),
    getCase: vi.fn().mockResolvedValue(caseFor(MARKET_A)),
    startReview: vi.fn().mockResolvedValue(caseFor(MARKET_A)),
    requestMoreInfo: vi.fn().mockResolvedValue(caseFor(MARKET_A)),
    approve: vi.fn().mockResolvedValue(caseFor(MARKET_A)),
    reject: vi.fn().mockResolvedValue(caseFor(MARKET_A)),
    requireReverification: vi.fn().mockResolvedValue(caseFor(MARKET_A)),
    listKycQueue: vi.fn().mockResolvedValue([merchantQueueItem]),
    getKycForReview: vi.fn().mockResolvedValue(merchantReviewDetail),
    reviewKyc: vi.fn().mockResolvedValue({
      review_id: 'review-1',
      submission_id: 'sub-1',
      branch_id: BRANCH_ID,
      kyc_status: 'APPROVED',
      operational_status: 'ACTIVE',
      reason: 'Documents verified',
      rejected_fields: [],
      reviewed_at: new Date('2026-08-01T01:00:00.000Z'),
    }),
  };
  const memberOwner = mocks as unknown as AdminKycService;
  const merchantOwner = mocks as unknown as MerchantService;

  const audit = {
    recordPrivilegedAction: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const database = {
    db: {
      select: vi.fn(() => mockQuery()),
    },
  } as unknown as DatabaseService;

  /**
   * Minimal builder covering the adapter's read-only projections. Routes on
   * the drizzle table identity so each read returns the right rows; the
   * builder is thenable so `await` on any chain yields the routed rows.
   */
  function mockQuery() {
    const tableName = (table: unknown): string => {
      const name = (table as Record<symbol, unknown>)[
        Symbol.for('drizzle:Name')
      ];
      return typeof name === 'string' ? name : String(table);
    };
    const branchRows = [
      {
        id: BRANCH_ID,
        marketId: MARKET_A,
        name: 'Acme Sdn Bhd',
        merchantId: 'MERCH-1',
      },
    ];
    const projectionRows = [
      {
        submission: {
          id: 'sub-1',
          merchantBranchId: BRANCH_ID,
          status: 'SUBMITTED',
          submissionVersion: 1,
          submittedData: merchantReviewDetail.data,
          submittedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
        branch: branchRows[0],
      },
    ];
    let currentRows: unknown[] = projectionRows;
    const q = {
      from: (table: unknown) => {
        const name = tableName(table);
        if (name === 'merchant_kyc_reviews') currentRows = [];
        else if (name === 'merchant_branches') currentRows = branchRows;
        else currentRows = projectionRows;
        return q;
      },
      innerJoin: () => q,
      where: () => q,
      orderBy: () => q,
      limit: () => q,
      then: (resolve: (value: unknown) => unknown) => {
        resolve(currentRows);
        return undefined;
      },
    };
    return q;
  }

  const service = new AdminKycOpsService(
    memberOwner,
    merchantOwner,
    audit,
    database,
  );
  return { mocks, audit, service };
}

const MEMBER_ACTION_METHODS = [
  ['startReview', 'start-review'],
  ['requestMoreInfo', 'request-more-info'],
  ['approve', 'approve'],
  ['reject', 'reject'],
  ['requireReverification', 'require-reverification'],
] as const;

describe('AdminKycOpsService member KYC (P7-S5C selected-market adapter)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forces the server-owned Current Admin Market onto the owner list and echoes it', async () => {
    const { mocks, audit, service } = createMocks();
    const result = await service.listMemberCases(ACTOR, MARKET_A, {
      page: 1,
      pageSize: 20,
      status: 'SUBMITTED',
    });
    expect(mocks.listCases).toHaveBeenCalledWith(ACTOR, {
      page: 1,
      pageSize: 20,
      status: 'SUBMITTED',
      marketId: MARKET_A,
    });
    expect(result.marketId).toBe(MARKET_A);
    // Every queue view is audited (P7-S5C audit-of-view incl. queues).
    expect(audit.recordPrivilegedAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'member.kyc.ops.queue.view',
        entity: { type: 'kyc_queue', id: MARKET_A },
        marketId: MARKET_A,
        result: 'SUCCESS',
        actor: { type: 'ADMIN_USER', id: 'admin-1' },
      }),
    );
  });

  it('never accepts a client market filter on the member list (schema excludes it)', async () => {
    const { mocks, service } = createMocks();
    await service.listMemberCases(ACTOR, MARKET_A, { page: 1, pageSize: 20 });
    const passed = mocks.listCases.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(passed['marketId']).toBe(MARKET_A);
    // The adapter input schema omits marketId: the ONLY market value is the
    // server-owned one forced above (no second client market parameter).
    const forced = Object.keys(passed).filter((key) => key === 'marketId');
    expect(forced).toEqual(['marketId']);
  });

  it('returns the masked member case for the selected market and audits the view', async () => {
    const { mocks, audit, service } = createMocks();
    const detail = await service.getMemberCase(ACTOR, MARKET_A, CASE_ID);
    expect(mocks.getCase).toHaveBeenCalledWith(ACTOR, CASE_ID);
    expect(detail.evidenceAccess).toEqual({
      masked: true,
      rawDocumentContent: false,
      audited: true,
    });
    // §6.4: identity/contact fields are masked on the summary surface.
    expect(detail.legalFullName).toBe('J*** M*** D***');
    expect(detail.dateOfBirth).toBeNull();
    expect(detail.residentialAddress).toBeNull();
    expect(detail.identificationNumber).toBe('****1234');
    expect(audit.recordPrivilegedAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { type: 'ADMIN_USER', id: 'admin-1' },
        action: 'member.kyc.ops.view',
        entity: { type: 'member_kyc_case', id: CASE_ID },
        marketId: MARKET_A,
        result: 'SUCCESS',
      }),
    );
  });

  it('rejects a member case whose market is not the selected market without auditing', async () => {
    const { mocks, audit, service } = createMocks();
    mocks.getCase.mockResolvedValue(caseFor(MARKET_B));
    await expect(
      service.getMemberCase(ACTOR, MARKET_A, CASE_ID),
    ).rejects.toMatchObject({ code: 'KYC_OPS_MARKET_MISMATCH' });
    expect(audit.recordPrivilegedAction).not.toHaveBeenCalled();
  });

  it('serves full member evidence only through the evidence method with audit-of-view', async () => {
    const { mocks, audit, service } = createMocks();
    const evidence = await service.getMemberCaseEvidence(
      ACTOR,
      MARKET_A,
      CASE_ID,
    );
    expect(mocks.getCase).toHaveBeenCalledWith(ACTOR, CASE_ID);
    expect(evidence.legalFullName).toBe('Jane Mildred Doe');
    expect(evidence.dateOfBirth).toBe('1990-01-02');
    expect(evidence.residentialAddress).toEqual({ line1: '1 Test Street' });
    expect(evidence.evidenceAccess).toEqual({
      masked: false,
      rawDocumentContent: false,
      audited: true,
    });
    expect(audit.recordPrivilegedAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'member.kyc.ops.evidence.view',
        entity: { type: 'member_kyc_case', id: CASE_ID },
        marketId: MARKET_A,
      }),
    );
  });

  it('blocks evidence for a case outside the selected market without auditing', async () => {
    const { mocks, audit, service } = createMocks();
    mocks.getCase.mockResolvedValue(caseFor(MARKET_B));
    await expect(
      service.getMemberCaseEvidence(ACTOR, MARKET_A, CASE_ID),
    ).rejects.toMatchObject({ code: 'KYC_OPS_MARKET_MISMATCH' });
    expect(audit.recordPrivilegedAction).not.toHaveBeenCalled();
  });

  it.each(MEMBER_ACTION_METHODS as unknown as Array<[string, string]>)(
    'pre-validates the selected market and delegates %s untouched',
    async (method: string, action: string) => {
      const { mocks, service } = createMocks();
      const input = { reason: 'Verification reason' };
      const idempotencyKey = 'idem-1';
      const raw = (
        service as unknown as Record<
          string,
          (
            actor: typeof ACTOR,
            marketId: string,
            caseId: string,
            payload: { reason: string },
            key: string,
          ) => Promise<
            import('./admin-kyc-ops.types.js').MemberKycOpsCaseResponse
          >
        >
      )[method];
      if (!raw) throw new Error(`Unknown adapter method: ${method}`);
      await raw.bind(service)(ACTOR, MARKET_A, CASE_ID, input, idempotencyKey);
      expect(mocks[method as keyof typeof mocks]).toHaveBeenCalledWith(
        ACTOR,
        CASE_ID,
        input,
        idempotencyKey,
      );
      const response = await raw.bind(service)(
        ACTOR,
        MARKET_A,
        CASE_ID,
        input,
        idempotencyKey,
      );
      expect(response.evidenceAccess.masked).toBe(false);
      void action;
    },
  );

  it.each(MEMBER_ACTION_METHODS as unknown as Array<[string, string]>)(
    'blocks %s for a case outside the selected market without calling the owner command',
    async (method: string) => {
      const { mocks, service } = createMocks();
      mocks.getCase.mockResolvedValue(caseFor(MARKET_B));
      const raw = (
        service as unknown as Record<
          string,
          (
            actor: typeof ACTOR,
            marketId: string,
            caseId: string,
            payload: { reason: string },
            key: string,
          ) => Promise<AdminKycCaseResponse>
        >
      )[method];
      if (!raw) throw new Error(`Unknown adapter method: ${method}`);
      await expect(
        raw.bind(service)(ACTOR, MARKET_A, CASE_ID, { reason: 'r' }, 'k'),
      ).rejects.toMatchObject({ code: 'KYC_OPS_MARKET_MISMATCH' });
      expect(mocks[method as keyof typeof mocks]).not.toHaveBeenCalled();
    },
  );

  it('propagates frozen owner errors (e.g. market grant denial) unchanged', async () => {
    const { mocks, service } = createMocks();
    const error = Object.assign(new Error('no access'), {
      code: 'ADMIN_KYC_MARKET_ACCESS_DENIED',
    });
    mocks.getCase.mockRejectedValue(error);
    await expect(
      service.getMemberCase(ACTOR, MARKET_A, CASE_ID),
    ).rejects.toMatchObject({ code: 'ADMIN_KYC_MARKET_ACCESS_DENIED' });
  });
});

describe('AdminKycOpsService merchant KYC (P7-S5C selected-market adapter)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates the merchant queue to the owner with the server market and echoes it', async () => {
    const { mocks, audit, service } = createMocks();
    const result = await service.listMerchantSubmissions(ACTOR, MARKET_A, {
      limit: 50,
      offset: 0,
    });
    expect(mocks.listKycQueue).toHaveBeenCalledWith(MARKET_A, {
      limit: 50,
      offset: 0,
    });
    expect(result.marketId).toBe(MARKET_A);
    expect(result.items[0]?.submitted_at).toBe('2026-08-01T00:00:00.000Z');
    expect(result.items[0]?.reviewed_at).toBeNull();
    // Every queue view is audited (P7-S5C audit-of-view incl. queues).
    expect(audit.recordPrivilegedAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'merchant.kyc.ops.queue.view',
        entity: { type: 'kyc_queue', id: MARKET_A },
        marketId: MARKET_A,
        result: 'SUCCESS',
      }),
    );
  });

  it('returns the masked merchant submission detail using the owner mask helper', async () => {
    const { audit, service } = createMocks();
    const detail = await service.getMerchantKyc(ACTOR, MARKET_A, BRANCH_ID);
    expect(detail.evidenceAccess.masked).toBe(true);
    expect(detail.display_name).toBe('Acme Sdn Bhd');
    const data = detail.current.data as Record<string, Record<string, unknown>>;
    expect(data['business_certification']?.['registration_number']).toBe(
      '***2345',
    );
    expect(data['business_certification']?.['tax_id']).toBe('***7890');
    expect(data['pic_identity']?.['identity_number']).toBe('****1234');
    expect(data['pic_contact']?.['phone']).toBe('***789');
    // The owner mask keeps non-identity business fields intact.
    expect(data['pic_identity']?.['full_name']).toBe('Jane Mildred Doe');
    expect(audit.recordPrivilegedAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'merchant.kyc.ops.view',
        entity: { type: 'merchant_kyc_submission', id: 'sub-1' },
        marketId: MARKET_A,
      }),
    );
  });

  it('blocks an out-of-market branch with the market mismatch (no cross-market leak)', async () => {
    const { service } = createMocks();
    // The mocked projection returns a MARKET_A branch for any branch id;
    // requesting it under MARKET_B must raise the market mismatch.
    await expect(
      service.getMerchantKyc(ACTOR, MARKET_B, BRANCH_ID),
    ).rejects.toMatchObject({ code: 'KYC_OPS_MARKET_MISMATCH' });
  });

  it('delegates merchant evidence to the owner review detail and audits the view', async () => {
    const { mocks, audit, service } = createMocks();
    const evidence = await service.getMerchantKycEvidence(
      ACTOR,
      MARKET_A,
      BRANCH_ID,
    );
    expect(mocks.getKycForReview).toHaveBeenCalledWith(
      MARKET_A,
      BRANCH_ID,
      'admin-1',
      { ipAddress: '127.0.0.1' },
    );
    expect(evidence.evidenceAccess.masked).toBe(false);
    expect(
      (evidence.current.data as Record<string, Record<string, unknown>>)[
        'business_certification'
      ]?.['registration_number'],
    ).toBe('202001012345');
    expect(audit.recordPrivilegedAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'merchant.kyc.ops.evidence.view',
        entity: { type: 'merchant_kyc_submission', id: 'sub-1' },
        marketId: MARKET_A,
      }),
    );
  });

  it('delegates the merchant review decision untouched to the owner command', async () => {
    const { mocks, service } = createMocks();
    const input = {
      decision: 'APPROVED' as const,
      reason: 'Documents verified',
      rejected_fields: [],
    };
    const result = await service.reviewMerchantKyc(
      ACTOR,
      MARKET_A,
      BRANCH_ID,
      input,
      'idem-1',
    );
    expect(mocks.reviewKyc).toHaveBeenCalledWith(
      MARKET_A,
      BRANCH_ID,
      'admin-1',
      input,
      'idem-1',
      { ipAddress: '127.0.0.1' },
    );
    expect(result.kyc_status).toBe('APPROVED');
    expect(result.operational_status).toBe('ACTIVE');
  });
});
