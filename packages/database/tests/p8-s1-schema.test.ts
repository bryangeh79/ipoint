import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  adFeeConfigs,
  adPlacements,
  ads,
  adsContentStatus,
  contentArticles,
} from '../schema/index.js';
import { expectedSchema } from '../src/expected-schema.js';

describe('P8-S1 Ads & Content schema', () => {
  it('freezes the shared lifecycle and market-scoped tables', () => {
    expect(adsContentStatus.enumValues).toEqual([
      'DRAFT',
      'SCHEDULED',
      'ACTIVE',
      'PAUSED',
      'EXPIRED',
      'ARCHIVED',
    ]);
    expect(expectedSchema.ads).toEqual(
      expect.arrayContaining([
        'public_id',
        'market_id',
        'placement_id',
        'sponsor_label',
        'status',
        'schedule_start_at',
        'schedule_end_at',
        'archived_at',
      ]),
    );
    expect(expectedSchema.content_articles).toEqual(
      expect.arrayContaining([
        'public_id',
        'market_id',
        'slug',
        'is_promoted',
        'sponsor_label',
        'publish_at',
        'unpublish_at',
        'archived_at',
      ]),
    );
  });

  it('enforces market consistency, schedules, soft deletion and optimistic versions', () => {
    expect(
      getTableConfig(adPlacements).uniqueConstraints.map((item) => item.name),
    ).toContain('ad_placements_id_market_unique');
    expect(
      getTableConfig(ads).foreignKeys.map((item) => item.getName()),
    ).toEqual(
      expect.arrayContaining([
        'ads_placement_market_fk',
        'ads_fee_config_market_fk',
      ]),
    );
    expect(getTableConfig(ads).checks.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        'ads_schedule_window_check',
        'ads_sponsored_check',
        'ads_archive_check',
        'ads_version_check',
      ]),
    );
    expect(
      getTableConfig(contentArticles).checks.map((item) => item.name),
    ).toEqual(
      expect.arrayContaining([
        'content_articles_promoted_label_check',
        'content_articles_schedule_window_check',
        'content_articles_archive_check',
      ]),
    );
  });

  it('provides versioned fee structure without a default commercial value', () => {
    expect(expectedSchema.ad_fee_configs).toEqual(
      expect.arrayContaining([
        'market_id',
        'version',
        'amount',
        'currency_code',
        'effective_from',
        'effective_to',
        'status',
        'reason',
      ]),
    );
    expect(
      getTableConfig(adFeeConfigs).uniqueConstraints.map((item) => item.name),
    ).toContain('ad_fee_configs_market_version_unique');
  });
});
