import type {
  AdminRedemptionRateCreateResultDto,
  AdminRedemptionRateListDto,
} from '@ipoint/api-client';

/**
 * P7-S6C redemption-configuration page-test fixtures. Rates are exact
 * decimal strings exactly as the adapter returns them (full technical
 * precision + display-only ≤6-decimal values, never parsed).
 */

export const redemptionOpsMarketA = '11111111-1111-4111-8111-111111111111';

export const redemptionOpsMarketSg = '99999999-9999-4999-8999-999999999999';

export const redemptionConfigFixture: AdminRedemptionRateListDto = {
  market_id: redemptionOpsMarketA,
  market_code: 'MY',
  timezone: 'Asia/Kuala_Lumpur',
  configured: true,
  config: {
    initial_rate: '1',
    minimum_rate: '0.5',
    maximum_rate: '2',
    currency: 'MYR',
    display_unit: 'RM per 1 iPoint',
    technical_decimals: 10,
    display_decimals: 6,
  },
  rates: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      rate_type: 'POINTS_PER_CURRENCY',
      rate_value: '1.1234567890',
      display_rate: '1.123457',
      effective_from_utc: '2026-08-31T16:00:00.000Z',
      effective_from_local: '2026-09-01 00:00:00',
      effective_until_utc: null,
      effective_until_local: null,
      window_status: 'ACTIVE',
      created_by: 'admin-1',
      created_at: '2026-08-04T00:00:00.000Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222223',
      rate_type: 'POINTS_PER_CURRENCY',
      rate_value: '1.0000000000',
      display_rate: '1',
      effective_from_utc: '2026-01-01T00:00:00.000Z',
      effective_from_local: '2026-01-01 08:00:00',
      effective_until_utc: '2026-08-31T16:00:00.000Z',
      effective_until_local: '2026-09-01 00:00:00',
      window_status: 'EXPIRED',
      created_by: 'admin-1',
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ],
};

export const redemptionConfigEmptyFixture: AdminRedemptionRateListDto = {
  market_id: redemptionOpsMarketA,
  market_code: 'MY',
  timezone: 'Asia/Kuala_Lumpur',
  configured: true,
  config: {
    initial_rate: '1',
    minimum_rate: '0.5',
    maximum_rate: '2',
    currency: 'MYR',
    display_unit: 'RM per 1 iPoint',
    technical_decimals: 10,
    display_decimals: 6,
  },
  rates: [],
};

export const redemptionBlockedFixture: AdminRedemptionRateListDto = {
  market_id: redemptionOpsMarketSg,
  market_code: 'SG',
  timezone: 'Asia/Singapore',
  configured: false,
  config: null,
  rates: [],
};

export const redemptionRateCreateFixture: AdminRedemptionRateCreateResultDto = {
  id: '33333333-3333-4333-8333-333333333333',
  rate_type: 'POINTS_PER_CURRENCY',
  rate_value: '1.5000000000',
  display_rate: '1.5',
  effective_date: '2026-10-01',
  effective_from_utc: '2026-09-30T16:00:00.000Z',
  effective_from_local: '2026-10-01 00:00:00',
  timezone: 'Asia/Kuala_Lumpur',
  market_id: redemptionOpsMarketA,
  created_by: 'admin-1',
  created_at: '2026-08-04T00:00:00.000Z',
};
