import type {
  AdminMemberOpsListPageDto,
  AdminMemberOpsProfileDto,
} from '@ipoint/api-client';

/**
 * P7-S5A Member Operations test fixtures (test-only). Shapes mirror the
 * adapter DTOs; all sensitive fields are masked exactly as the owner service
 * returns them.
 */

export const memberOpsMarketA = '11111111-1111-4111-8111-111111111111';

export function memberOpsProfileFixture(
  overrides: Partial<AdminMemberOpsProfileDto> = {},
): AdminMemberOpsProfileDto {
  return {
    publicMemberId: 'mem_public_1',
    displayName: 'Jane Doe',
    email: 'j***@example.com',
    status: 'ACTIVE',
    kycLevel: 'LEVEL_2',
    accountCountry: 'MY',
    currentMarketId: memberOpsMarketA,
    createdAt: '2026-07-01T00:00:00.000Z',
    closedAt: null,
    profile: {
      fullName: 'J*** M****** D**',
      phone: '********6789',
      phoneVerificationStatus: 'VERIFIED',
      birthDate: null,
      address: null,
      locale: 'en-MY',
      language: 'en',
    },
    kyc: {
      caseId: 'kyc-case-1',
      marketId: memberOpsMarketA,
      status: 'APPROVED',
      levelRequested: 'LEVEL_2',
      legalFullName: 'J*** M****** D**',
      identificationType: 'NATIONAL_ID',
      identificationNumber: '****F24E',
      submittedAt: '2026-06-01T00:00:00.000Z',
      reviewedAt: '2026-06-05T00:00:00.000Z',
      reverificationRequiredAt: null,
    },
    marketPreferences: [
      {
        marketId: memberOpsMarketA,
        marketCode: 'MA',
        isEnabled: true,
        isCurrent: true,
        sortOrder: 0,
        lastSelectedAt: null,
      },
    ],
    notes: [
      {
        id: 'note-1',
        adminUserId: 'admin-1',
        marketId: memberOpsMarketA,
        content: 'Follow up on KYC documents.',
        isInternal: true,
        createdAt: '2026-07-02T00:00:00.000Z',
      },
    ],
    statusHistory: [
      {
        id: 'history-1',
        fromStatus: 'PENDING_EMAIL_VERIFICATION',
        toStatus: 'ACTIVE',
        actorType: 'SYSTEM',
        actorId: null,
        reason: null,
        occurredAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

export function memberOpsListPageFixture(
  overrides: Partial<AdminMemberOpsListPageDto> = {},
): AdminMemberOpsListPageDto {
  return {
    marketId: memberOpsMarketA,
    members: [
      {
        publicMemberId: 'mem_public_1',
        displayName: 'Jane Doe',
        email: 'j***@example.com',
        status: 'ACTIVE',
        kycLevel: 'LEVEL_2',
        accountCountry: 'MY',
        currentMarketId: memberOpsMarketA,
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      {
        publicMemberId: 'mem_public_2',
        displayName: null,
        email: 'k***@example.com',
        status: 'SUSPENDED',
        kycLevel: 'LEVEL_1',
        accountCountry: 'MY',
        currentMarketId: memberOpsMarketA,
        createdAt: '2026-06-15T00:00:00.000Z',
      },
      {
        publicMemberId: 'mem_public_3',
        displayName: 'Closed User',
        email: 'c***@example.com',
        status: 'CLOSED',
        kycLevel: 'NONE',
        accountCountry: 'MY',
        currentMarketId: memberOpsMarketA,
        createdAt: '2026-05-01T00:00:00.000Z',
      },
    ],
    total: 3,
    page: 1,
    pageSize: 20,
    ...overrides,
  };
}
