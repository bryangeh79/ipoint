import type {
  AdminKycOpsCaseDetailDto,
  AdminKycOpsListPageDto,
  AdminKycOpsMerchantDetailDto,
  AdminKycOpsMerchantQueueDto,
} from '@ipoint/api-client';

/**
 * P7-S5C KYC review page-test fixtures.
 *
 * Deterministic masked summaries and evidence payloads shared by the queue
 * and detail page tests. Identity values are masked in the summary fixtures
 * and unmasked only in the evidence fixture (matching the server contract).
 */

export const kycOpsMarketA = '11111111-1111-4111-8111-111111111111';
export const kycOpsMarketB = '22222222-2222-4222-8222-222222222222';

export const kycOpsCaseId = '33333333-3333-4333-8333-333333333333';
export const kycOpsCaseId2 = '33333333-3333-4333-8333-333333333334';
export const kycOpsBranchId = '44444444-4444-4444-8444-444444444444';
export const kycOpsBranchId2 = '44444444-4444-4444-8444-444444444445';

export function memberKycListPageFixture(): AdminKycOpsListPageDto {
  return {
    items: [
      {
        id: kycOpsCaseId,
        marketId: kycOpsMarketA,
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
      },
      {
        id: kycOpsCaseId2,
        marketId: kycOpsMarketA,
        status: 'UNDER_REVIEW',
        levelRequested: 'LEVEL_2',
        member: {
          publicMemberId: 'mem_public_2',
          displayName: 'Acme Member',
          email: 'a***@example.com',
          accountCountry: 'MY',
          status: 'ACTIVE',
          kycLevel: 'LEVEL_1',
        },
        submittedAt: '2026-08-01T01:00:00.000Z',
        reviewedAt: null,
        updatedAt: '2026-08-01T01:10:00.000Z',
      },
      {
        id: '33333333-3333-4333-8333-333333333336',
        marketId: kycOpsMarketA,
        status: 'APPROVED',
        levelRequested: 'LEVEL_2',
        member: {
          publicMemberId: 'mem_public_3',
          displayName: null,
          email: 'r***@example.com',
          accountCountry: 'MY',
          status: 'ACTIVE',
          kycLevel: 'LEVEL_2',
        },
        submittedAt: '2026-07-30T00:00:00.000Z',
        reviewedAt: '2026-07-31T00:00:00.000Z',
        updatedAt: '2026-07-31T00:00:00.000Z',
      },
    ],
    page: 1,
    pageSize: 20,
    total: 3,
    marketId: kycOpsMarketA,
  };
}

export function memberKycDetailFixture(): AdminKycOpsCaseDetailDto {
  return {
    id: kycOpsCaseId,
    marketId: kycOpsMarketA,
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
    legalFullName: 'J*** M*** D***',
    identificationType: 'NATIONAL_ID',
    identificationNumber: '****1234',
    dateOfBirth: null,
    nationality: 'MY',
    residentialAddress: null,
    accountCountrySnapshot: 'MY',
    submissionMarketId: kycOpsMarketA,
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
    history: [
      {
        id: 'hist-1',
        eventType: 'SUBMITTED',
        actorType: 'MEMBER',
        actorId: null,
        summary: 'KYC case submitted.',
        metadata: {},
        occurredAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    evidenceAccess: {
      masked: true,
      rawDocumentContent: false,
      audited: true,
    },
  };
}

export function memberKycEvidenceFixture(): AdminKycOpsCaseDetailDto {
  return {
    ...memberKycDetailFixture(),
    legalFullName: 'Jane Mildred Doe',
    dateOfBirth: '1990-01-02',
    residentialAddress: { line1: '1 Test Street' },
    decisionReason: 'Documents verified',
    evidenceAccess: {
      masked: false,
      rawDocumentContent: false,
      audited: true,
    },
  };
}

export function merchantKycQueueFixture(): AdminKycOpsMerchantQueueDto {
  return {
    items: [
      {
        submission_id: 'sub-1',
        branch_id: kycOpsBranchId,
        merchant_id: 'MERCH-1',
        display_name: 'Acme Sdn Bhd',
        status: 'SUBMITTED',
        submission_version: 1,
        submitted_at: '2026-08-01T00:00:00.000Z',
        reviewed_at: null,
      },
      {
        submission_id: 'sub-2',
        branch_id: kycOpsBranchId2,
        merchant_id: 'MERCH-2',
        display_name: 'Beta Trading',
        status: 'RESUBMISSION_REQUIRED',
        submission_version: 2,
        submitted_at: '2026-07-30T00:00:00.000Z',
        reviewed_at: '2026-07-31T00:00:00.000Z',
      },
    ],
    marketId: kycOpsMarketA,
    limit: 50,
    offset: 0,
  };
}

export function merchantKycDetailFixture(): AdminKycOpsMerchantDetailDto {
  return {
    branch_id: kycOpsBranchId,
    merchant_id: 'MERCH-1',
    market_id: kycOpsMarketA,
    display_name: 'Acme Sdn Bhd',
    current: {
      submission_id: 'sub-1',
      submission_version: 1,
      status: 'SUBMITTED',
      submitted_at: '2026-08-01T00:00:00.000Z',
      data: {
        business_certification: {
          registration_number: '***2345',
          business_name_registered: 'Acme Sdn Bhd',
          business_type: 'private_limited',
          tax_id: '***7890',
          registered_address: '1 Integration Street',
        },
        pic_identity: {
          full_name: 'Jane Mildred Doe',
          identity_type: 'nric',
          identity_number: '****1234',
          date_of_birth: '1990-01-02',
          nationality: 'MY',
        },
        pic_contact: {
          email: 'jane@example.com',
          phone: '***789',
        },
      },
      review: null,
    },
    previous: null,
    evidenceAccess: {
      masked: true,
      rawDocumentContent: false,
      audited: true,
    },
  };
}

export function merchantKycEvidenceFixture(): AdminKycOpsMerchantDetailDto {
  return {
    ...merchantKycDetailFixture(),
    current: {
      ...merchantKycDetailFixture().current,
      status: 'UNDER_REVIEW',
      data: {
        business_certification: {
          registration_number: '202001012345',
          business_name_registered: 'Acme Sdn Bhd',
          business_type: 'private_limited',
          tax_id: 'C-1234567890',
          registered_address: '1 Integration Street',
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
    },
    evidenceAccess: {
      masked: false,
      rawDocumentContent: false,
      audited: true,
    },
  };
}
