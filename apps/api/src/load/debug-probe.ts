import 'reflect-metadata';
import { bootLoadApp, httpCall } from './harness.js';
import { seedRedemptionFixture } from './journeys/j06-redemption.js';

process.env['P8S6_LOAD_LEVEL'] = 'L0';
const ctx = await bootLoadApp({ level: 'L0', silent: true });
const fixture = await seedRedemptionFixture(ctx);
const memberToken = ctx.world.merchant.memberToken;

// Pre-generate 5 distinct quotes serially.
const quotes: Array<{ quoteId: string; postedPointCost: string }> = [];
for (let i = 0; i < 20; i += 1) {
  const q = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/redemption/catalog/${fixture.itemId}/quote?quantity=1`,
    token: memberToken,
  });
  const b = q.body as { quoteId?: string; postedPointCost?: string };
  quotes.push({
    quoteId: String(b.quoteId),
    postedPointCost: String(b.postedPointCost),
  });
  console.log('quote', i, 'id', String(b.quoteId).slice(0, 8));
}

const orders = await Promise.all(
  quotes.map((qb, i) =>
    httpCall(ctx.baseUrl, {
      method: 'POST',
      path: '/api/v1/redemption/orders',
      token: memberToken,
      body: {
        quoteId: qb.quoteId,
        idempotencyKey: `probe-storm-${i}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        expectedItemVersion: 1,
        expectedTotalPoints: qb.postedPointCost,
        expectedQuantity: '1',
        fulfilment: {
          type: 'PICKUP',
          pickupLocationId: fixture.pickupLocationId,
        },
        termsAcceptance: { accepted: true, termsVersion: 'v1' },
      },
    }),
  ),
);
for (const o of orders)
  console.log('order', o.status, JSON.stringify(o.body).slice(0, 160));
process.exit(0);
