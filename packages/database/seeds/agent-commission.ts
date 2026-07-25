import type { Database } from '../src/client.js';
import { commissionRateVersions } from '../schema/index.js';

export const systemSeedActorId = '00000000-0000-0000-0000-000000000000';

export const myDefaultCommissionRates = [
  ['AGENT_UPGRADE', 1, '88.0000000000', 'FIXED'],
  ['AGENT_UPGRADE', 2, '38.0000000000', 'FIXED'],
  ['MEMBER_CONSUMPTION', 1, '0.0100000000', 'PERCENTAGE'],
  ['MEMBER_CONSUMPTION', 2, '0.0050000000', 'PERCENTAGE'],
  ['MERCHANT_RECRUITMENT', 1, '0.0050000000', 'PERCENTAGE'],
] as const;

export async function seedAgentCommissionRates(db: Database): Promise<void> {
  await db
    .insert(commissionRateVersions)
    .values(
      myDefaultCommissionRates.map(
        ([commissionType, generation, rateValue, rateType]) => ({
          commissionType,
          generation,
          market: 'MY',
          rateValue,
          rateType,
          effectiveFrom: new Date('2026-07-25T00:00:00.000Z'),
          createdBy: systemSeedActorId,
        }),
      ),
    )
    .onConflictDoNothing();
}
