import type {
  AdminMarketDetailDto,
  AdminMarketUpdateResultDto,
} from '@ipoint/api-client';

/**
 * P7-S6E market-configuration page-test fixtures.
 */

export const marketConfigMarketA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

export const marketDetailFixture: AdminMarketDetailDto = {
  market_id: marketConfigMarketA,
  market_code: 'MY',
  name: 'Malaysia',
  status: 'ACTIVE',
  currency_code: 'MYR',
  timezone: 'Asia/Kuala_Lumpur',
  default_locale: 'en-MY',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  configured: true,
};

export function marketUpdateResultFixture(
  overrides: Partial<AdminMarketUpdateResultDto> = {},
): AdminMarketUpdateResultDto {
  return {
    id: marketConfigMarketA,
    code: 'MY',
    name: 'Malaysia Renamed',
    status: 'ACTIVE',
    currencyCode: 'MYR',
    timezone: 'Asia/Kuala_Lumpur',
    defaultLocale: 'en-MY',
    updatedAt: '2026-08-06T00:00:00.000Z',
    changed: [{ field: 'name', before: 'Malaysia', after: 'Malaysia Renamed' }],
    idempotencyDigest: 'a'.repeat(64),
    ...overrides,
  };
}
