import type {
  AdminRewardRuleCreateResultDto,
  AdminRewardRuleListDto,
} from '@ipoint/api-client';

/**
 * P7-S6B reward-configuration page-test fixtures. Rates are exact decimal
 * strings exactly as the adapter returns them (%/day, never parsed).
 */

export const rewardOpsMarketA = '11111111-1111-4111-8111-111111111111';

export const rewardScheduleFixture: AdminRewardRuleListDto = {
  marketId: rewardOpsMarketA,
  timezone: 'Asia/Kuala_Lumpur',
  packages: [
    { code: 'A', max_rate_per_day: '0.0125' },
    { code: 'B', max_rate_per_day: '0.025' },
    { code: 'C', max_rate_per_day: '0.05' },
    { code: 'D', max_rate_per_day: '0.05' },
    { code: 'E', max_rate_per_day: '0.05' },
    { code: 'F', max_rate_per_day: '0.05' },
  ],
  rules: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Package B Reward Rate',
      description: null,
      reward_rate: '0.025',
      cap_type: 'NONE',
      cap_value: '0',
      minimum_reward: '0',
      package_reference: 'B',
      effective_from_utc: '2026-08-31T16:00:00.000Z',
      effective_from_local: '2026-09-01 00:00:00',
      effective_until_utc: null,
      effective_until_local: null,
      timezone: 'Asia/Kuala_Lumpur',
      window_status: 'SCHEDULED',
      market_id: rewardOpsMarketA,
      created_by: 'admin-1',
      created_at: '2026-08-04T00:00:00.000Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222223',
      name: 'Package A Reward Rate',
      description: null,
      reward_rate: '0.0125',
      cap_type: 'NONE',
      cap_value: '0',
      minimum_reward: '0',
      package_reference: 'A',
      effective_from_utc: '2026-01-01T00:00:00.000Z',
      effective_from_local: '2026-01-01 08:00:00',
      effective_until_utc: '2026-08-31T16:00:00.000Z',
      effective_until_local: '2026-09-01 00:00:00',
      timezone: 'Asia/Kuala_Lumpur',
      window_status: 'SUPERSEDED',
      market_id: rewardOpsMarketA,
      created_by: 'admin-1',
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ],
};

export const rewardScheduleEmptyFixture: AdminRewardRuleListDto = {
  marketId: rewardOpsMarketA,
  timezone: 'Asia/Kuala_Lumpur',
  packages: [
    { code: 'A', max_rate_per_day: '0.0125' },
    { code: 'B', max_rate_per_day: '0.025' },
    { code: 'C', max_rate_per_day: '0.05' },
    { code: 'D', max_rate_per_day: '0.05' },
    { code: 'E', max_rate_per_day: '0.05' },
    { code: 'F', max_rate_per_day: '0.05' },
  ],
  rules: [],
};

export const rewardRuleCreateFixture: AdminRewardRuleCreateResultDto = {
  id: '33333333-3333-4333-8333-333333333333',
  package_reference: 'C',
  reward_rate: '0.05',
  effective_date: '2026-10-01',
  effective_from_utc: '2026-09-30T16:00:00.000Z',
  effective_from_local: '2026-10-01 00:00:00',
  timezone: 'Asia/Kuala_Lumpur',
  market_id: rewardOpsMarketA,
  created_by: 'admin-1',
  created_at: '2026-08-04T00:00:00.000Z',
};
