import type {
  AdminCommissionRateCreateResultDto,
  AdminCommissionRateListDto,
} from '@ipoint/api-client';

/**
 * P7-S6D commission-configuration page-test fixtures. Rates are exact
 * decimal strings exactly as the adapter returns them (never parsed).
 */

export const commissionOpsMarketA = '11111111-1111-4111-8111-111111111111';

export const commissionTaxonomyFixture = [
  { commission_type: 'AGENT_UPGRADE', rate_type: 'FIXED', generations: [1, 2] },
  {
    commission_type: 'MEMBER_CONSUMPTION',
    rate_type: 'PERCENTAGE',
    generations: [1, 2],
  },
  {
    commission_type: 'MERCHANT_RECRUITMENT',
    rate_type: 'PERCENTAGE',
    generations: [0],
  },
  {
    commission_type: 'AGENT_ACTIVATION_FEE',
    rate_type: 'FIXED',
    generations: [0],
  },
];

/** Mutable deep copy of the taxonomy fixture (readonly-safe for DTOs). */
function taxonomyCopy(): AdminCommissionRateListDto['taxonomy'] {
  return commissionTaxonomyFixture.map((entry) => ({
    commission_type: entry.commission_type,
    rate_type: entry.rate_type,
    generations: [...entry.generations],
  }));
}

export const commissionConfigFixture: AdminCommissionRateListDto = {
  market_id: commissionOpsMarketA,
  market_code: 'MY',
  timezone: 'Asia/Kuala_Lumpur',
  currency: 'MYR',
  configured: true,
  taxonomy: taxonomyCopy(),
  definitions: [
    {
      commission_type: 'AGENT_UPGRADE',
      generation: 1,
      rate_type: 'FIXED',
      current: {
        id: 'version-upgrade-88',
        commission_type: 'AGENT_UPGRADE',
        generation: 1,
        rate_type: 'FIXED',
        rate_value: '88.0000000000',
        display_rate: '88',
        effective_from_utc: '2026-07-24T16:00:00.000Z',
        effective_from_local: '2026-07-25 00:00:00',
        effective_until_utc: '2026-08-31T16:00:00.000Z',
        effective_until_local: '2026-09-01 00:00:00',
        window_status: 'SUPERSEDED',
        reason: 'Legacy Malaysia upgrade fee',
        created_by: 'admin-1',
        created_at: '2026-07-24T00:00:00.000Z',
      },
      scheduled: [
        {
          id: 'version-upgrade-388',
          commission_type: 'AGENT_UPGRADE',
          generation: 1,
          rate_type: 'FIXED',
          rate_value: '388.0000000000',
          display_rate: '388',
          effective_from_utc: '2026-09-01T00:00:00.000Z',
          effective_from_local: '2026-09-01 08:00:00',
          effective_until_utc: null,
          effective_until_local: null,
          window_status: 'SCHEDULED',
          reason: 'Q3 rate review',
          created_by: 'admin-1',
          created_at: '2026-08-04T00:00:00.000Z',
        },
      ],
      history: [
        {
          id: 'version-upgrade-388',
          commission_type: 'AGENT_UPGRADE',
          generation: 1,
          rate_type: 'FIXED',
          rate_value: '388.0000000000',
          display_rate: '388',
          effective_from_utc: '2026-09-01T00:00:00.000Z',
          effective_from_local: '2026-09-01 08:00:00',
          effective_until_utc: null,
          effective_until_local: null,
          window_status: 'SCHEDULED',
          reason: 'Q3 rate review',
          created_by: 'admin-1',
          created_at: '2026-08-04T00:00:00.000Z',
        },
        {
          id: 'version-upgrade-88',
          commission_type: 'AGENT_UPGRADE',
          generation: 1,
          rate_type: 'FIXED',
          rate_value: '88.0000000000',
          display_rate: '88',
          effective_from_utc: '2026-07-24T16:00:00.000Z',
          effective_from_local: '2026-07-25 00:00:00',
          effective_until_utc: '2026-08-31T16:00:00.000Z',
          effective_until_local: '2026-09-01 00:00:00',
          window_status: 'SUPERSEDED',
          reason: 'Legacy Malaysia upgrade fee',
          created_by: 'admin-1',
          created_at: '2026-07-24T00:00:00.000Z',
        },
      ],
    },
    {
      commission_type: 'AGENT_UPGRADE',
      generation: 2,
      rate_type: 'FIXED',
      current: {
        id: 'version-upgrade-g2',
        commission_type: 'AGENT_UPGRADE',
        generation: 2,
        rate_type: 'FIXED',
        rate_value: '38.0000000000',
        display_rate: '38',
        effective_from_utc: '2026-07-24T16:00:00.000Z',
        effective_from_local: '2026-07-25 00:00:00',
        effective_until_utc: null,
        effective_until_local: null,
        window_status: 'ACTIVE',
        reason: null,
        created_by: 'admin-1',
        created_at: '2026-07-24T00:00:00.000Z',
      },
      scheduled: [],
      history: [
        {
          id: 'version-upgrade-g2',
          commission_type: 'AGENT_UPGRADE',
          generation: 2,
          rate_type: 'FIXED',
          rate_value: '38.0000000000',
          display_rate: '38',
          effective_from_utc: '2026-07-24T16:00:00.000Z',
          effective_from_local: '2026-07-25 00:00:00',
          effective_until_utc: null,
          effective_until_local: null,
          window_status: 'ACTIVE',
          reason: null,
          created_by: 'admin-1',
          created_at: '2026-07-24T00:00:00.000Z',
        },
      ],
    },
    {
      commission_type: 'MEMBER_CONSUMPTION',
      generation: 1,
      rate_type: 'PERCENTAGE',
      current: null,
      scheduled: [],
      history: [],
    },
    {
      commission_type: 'MEMBER_CONSUMPTION',
      generation: 2,
      rate_type: 'PERCENTAGE',
      current: null,
      scheduled: [],
      history: [],
    },
    {
      commission_type: 'MERCHANT_RECRUITMENT',
      generation: 0,
      rate_type: 'PERCENTAGE',
      current: null,
      scheduled: [],
      history: [],
    },
    {
      commission_type: 'AGENT_ACTIVATION_FEE',
      generation: 0,
      rate_type: 'FIXED',
      current: null,
      scheduled: [],
      history: [],
    },
  ],
};

export const commissionConfigBlockedFixture: AdminCommissionRateListDto = {
  market_id: commissionOpsMarketA,
  market_code: 'MY',
  timezone: 'Asia/Kuala_Lumpur',
  currency: 'MYR',
  configured: false,
  taxonomy: taxonomyCopy(),
  definitions: [
    {
      commission_type: 'AGENT_UPGRADE',
      generation: 1,
      rate_type: 'FIXED',
      current: null,
      scheduled: [],
      history: [],
    },
  ],
};

export const commissionRateCreateFixture: AdminCommissionRateCreateResultDto = {
  id: '33333333-3333-4333-8333-333333333333',
  commission_type: 'AGENT_UPGRADE',
  generation: 1,
  rate_type: 'FIXED',
  rate_value: '388.0000000000',
  display_rate: '388',
  effective_date: '2026-10-01',
  effective_from_utc: '2026-09-30T16:00:00.000Z',
  effective_from_local: '2026-10-01 00:00:00',
  timezone: 'Asia/Kuala_Lumpur',
  market_id: commissionOpsMarketA,
  created_by: 'admin-1',
  created_at: '2026-08-04T00:00:00.000Z',
};
