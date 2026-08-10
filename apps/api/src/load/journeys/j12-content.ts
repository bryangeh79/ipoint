/**
 * J12 — content delivery (ads / content member read surface).
 *
 * Contract §6 journey 12. Admin ops over real HTTP: placement / ad / article
 * creation + status transitions; member read surface `GET
 * /api/v1/members/content/home` stormed at full concurrency (this is the
 * "content delivery" surface the contract names).
 *
 * @packageDocumentation
 */

import type { LoadContext, JourneyResult } from '../harness.js';
import {
  finishJourneyResult,
  httpCall,
  measureOp,
  newJourneyResult,
} from '../harness.js';
import { randomSuffix, stringId } from './common.js';

const OK = new Set([200]);
const CREATED = new Set([201]);

export async function runJourneyJ12(ctx: LoadContext): Promise<JourneyResult> {
  const result = newJourneyResult(ctx, 'J12', 'content delivery');
  const world = ctx.world;
  const base = `/api/v1/admin/ads-content/markets/${world.marketId}`;
  const token = world.superAdmin.token;

  let placementId = '';
  let adId = '';
  let articleId = '';
  let adVersion = 1;
  let articleVersion = 1;

  await measureOp(ctx, result, 'placement-create', CREATED, async () => {
    const created = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/placements`,
      token,
      idempotencyKey: `j12-placement-${randomSuffix()}`,
      body: {
        code: `HOME_HERO_${randomSuffix()}`,
        name: 'Home hero',
        description: 'Primary member home placement',
        position: 0,
        reason: 'P8-S6 load fixture.',
      },
    });
    if (created.status === 201) {
      placementId = stringId(created.body, ['id']);
    }
    return created;
  });

  await measureOp(ctx, result, 'ad-create', CREATED, async () => {
    const created = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/ads`,
      token,
      idempotencyKey: `j12-ad-${randomSuffix()}`,
      body: {
        placementId,
        title: 'Local dining week',
        summary: 'Discover selected local dining offers.',
        creativeMediaUrl: 'https://cdn.example.test/dining.webp',
        creativeAltText: 'A prepared local meal',
        targetUrl: 'https://example.test/dining',
        sponsorLabel: 'Sponsored',
        reason: 'P8-S6 load fixture.',
      },
    });
    if (created.status === 201) {
      adId = stringId(created.body, ['id']);
      adVersion = Number((created.body as { version?: unknown })?.version ?? 1);
    }
    return created;
  });

  await measureOp(ctx, result, 'article-create', CREATED, async () => {
    const created = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/articles`,
      token,
      idempotencyKey: `j12-article-${randomSuffix()}`,
      body: {
        slug: `local-market-update-${randomSuffix()}`,
        title: 'Local market update',
        excerpt: 'This week in your current market.',
        body: 'Verified market news for iPoint members.',
        isPromoted: true,
        sponsorLabel: 'Promoted',
        reason: 'P8-S6 load fixture.',
      },
    });
    if (created.status === 201) {
      articleId = stringId(created.body, ['id']);
      articleVersion = Number(
        (created.body as { version?: unknown })?.version ?? 1,
      );
    }
    return created;
  });

  await measureOp(ctx, result, 'ad-activate', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/ads/${adId}/status`,
      token,
      idempotencyKey: `j12-ad-status-${randomSuffix()}`,
      body: {
        status: 'ACTIVE',
        expectedVersion: adVersion,
        reason: 'P8-S6 activate.',
      },
    }),
  );

  await measureOp(ctx, result, 'article-activate', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/articles/${articleId}/status`,
      token,
      idempotencyKey: `j12-article-status-${randomSuffix()}`,
      body: {
        status: 'ACTIVE',
        expectedVersion: articleVersion,
        reason: 'P8-S6 activate.',
      },
    }),
  );

  await measureOp(ctx, result, 'admin-ads-list', OK, async () =>
    httpCall(ctx.baseUrl, { method: 'GET', path: `${base}/ads`, token }),
  );

  // Member content delivery read surface (stormed at full scale).
  await measureOp(ctx, result, 'member-content-home', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'GET',
      path: '/api/v1/members/content/home',
      token: world.merchant.memberToken,
    }),
  );

  // -- assertions ----------------------------------------------------------
  const unexpected = result.ops.filter((op) => op.unexpectedErrorCount > 0);
  result.assertions.push({
    name: 'J12 all content ops have zero unexpected errors',
    pass: unexpected.length === 0,
    detail:
      unexpected.length === 0
        ? 'all content ops clean'
        : `unexpected errors on: ${unexpected.map((op) => op.op).join(', ')}`,
  });

  return finishJourneyResult(result);
}
