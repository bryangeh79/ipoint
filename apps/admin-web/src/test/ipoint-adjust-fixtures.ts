import type {
  AdminIpointAdjustmentConfigDto,
  AdminIpointAdjustmentDetailDto,
  AdminIpointAdjustmentDto,
  AdminIpointAdjustmentQueueDto,
  AdminIpointWalletLookupDto,
} from '@ipoint/api-client';

/**
 * P7-S7B page-test fixtures: a configured market (MY baseline caps 10k/
 * 100k, evidence disabled), one maker (Finance Operator) and one checker
 * (Finance Approver), plus wallet/queue/detail/config projections.
 */

export const ipointAdjustMarketId = '77777777-7777-4777-8777-777777777777';

export const ipointAdjustMakerAdminId = '11111111-1111-4111-8111-111111111111';
export const ipointAdjustCheckerAdminId =
  '22222222-2222-4222-8222-222222222222';

export const ipointAdjustWalletId = '44444444-4444-4444-8444-444444444444';
export const ipointAdjustMemberId = '55555555-5555-4555-8555-555555555555';

export const ipointAdjustRequestId = '88888888-8888-4888-8888-888888888888';

export const ipointAdjustConfigFixture: AdminIpointAdjustmentConfigDto = {
  marketId: ipointAdjustMarketId,
  marketCode: 'MY',
  timezone: 'Asia/Kuala_Lumpur',
  currency: 'MYR',
  configured: true,
  rule: {
    marketCode: 'MY',
    softCap: '10000',
    hardCap: '100000',
    secureEvidenceAvailable: false,
    isActive: true,
  },
  reasonCodes: [
    {
      code: 'OPERATIONAL_CORRECTION',
      label: 'Operational correction of a processing error',
      isHighRisk: false,
      isActive: true,
    },
    {
      code: 'EXACT_OPPOSITE_COMPENSATION',
      label: 'Exact-opposite compensation',
      isHighRisk: false,
      isActive: true,
    },
    {
      code: 'FRAUD_RECOVERY',
      label: 'Fraud recovery',
      isHighRisk: true,
      isActive: true,
    },
  ],
};

export const ipointAdjustWalletFixture: AdminIpointWalletLookupDto[] = [
  {
    walletId: ipointAdjustWalletId,
    memberId: ipointAdjustMemberId,
    memberPublicId: 'pub_abc123',
    displayName: 'Ali Test',
    marketId: ipointAdjustMarketId,
    availableBalance: '5000.0000000000',
    archived: false,
  },
];

export function ipointAdjustRequestFixture(
  overrides: Partial<AdminIpointAdjustmentDto> = {},
): AdminIpointAdjustmentDto {
  return {
    id: ipointAdjustRequestId,
    walletAccountId: ipointAdjustWalletId,
    memberId: ipointAdjustMemberId,
    marketId: ipointAdjustMarketId,
    direction: 'CREDIT',
    amount: '5000.0000000000',
    state: 'DRAFT',
    reasonCode: 'OPERATIONAL_CORRECTION',
    explanation: 'Ops correction for a processing error.',
    caseReference: 'CASE-S7B-001',
    attachmentReference: null,
    makerAdminUserId: ipointAdjustMakerAdminId,
    checkerAdminUserId: null,
    submittedAt: null,
    executedAt: null,
    failedAt: null,
    priorRequestId: null,
    ledgerEntryId: null,
    version: 1,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    ...overrides,
  };
}

export const ipointAdjustQueueFixture: AdminIpointAdjustmentQueueDto = {
  marketId: ipointAdjustMarketId,
  items: [
    ipointAdjustRequestFixture(),
    ipointAdjustRequestFixture({
      id: '99999999-9999-4999-8999-999999999999',
      state: 'SUBMITTED',
      direction: 'DEBIT',
      amount: '2500.0000000000',
      caseReference: 'CASE-S7B-002',
    }),
  ],
  limit: 100,
  offset: 0,
};

export function ipointAdjustDetailFixture(
  request: AdminIpointAdjustmentDto = ipointAdjustRequestFixture(),
): AdminIpointAdjustmentDetailDto {
  return { request, decisions: [] };
}
