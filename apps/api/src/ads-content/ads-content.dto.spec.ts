import { describe, expect, it } from 'vitest';
import {
  createAdSchema,
  createArticleSchema,
  transitionSchema,
} from './ads-content.dto.js';

describe('P8-S1 Ads & Content DTO contracts', () => {
  it('requires an explicit nonblank sponsor label and HTTP(S) creative URLs', () => {
    const base = {
      placementId: '22222222-2222-4222-8222-222222222222',
      title: 'Campaign',
      creativeMediaUrl: 'https://cdn.example.test/ad.webp',
      creativeAltText: 'Creative',
      reason: 'Approved campaign.',
    };
    // Omitted and blank sponsor labels must be rejected; there is no server
    // default that could silently publish an English fallback.
    expect(createAdSchema.safeParse(base).success).toBe(false);
    expect(
      createAdSchema.safeParse({ ...base, sponsorLabel: '   ' }).success,
    ).toBe(false);
    expect(
      createAdSchema.safeParse({
        ...base,
        creativeMediaUrl: 'javascript:alert(1)',
        sponsorLabel: 'Sponsored',
      }).success,
    ).toBe(false);
    const parsed = createAdSchema.parse({
      ...base,
      sponsorLabel: 'Sponsored',
    });
    expect(parsed.isSponsored).toBe(true);
    expect(parsed.sponsorLabel).toBe('Sponsored');
  });

  it('requires promoted articles to carry an explicit label', () => {
    const result = createArticleSchema.safeParse({
      slug: 'market-news',
      title: 'Market news',
      excerpt: 'Market update',
      body: 'Verified editorial content.',
      isPromoted: true,
      reason: 'Approved editorial content.',
    });
    expect(result.success).toBe(false);
  });

  it('accepts only the frozen lifecycle states and strict payloads', () => {
    expect(
      transitionSchema.parse({
        status: 'PAUSED',
        expectedVersion: 2,
        reason: 'Operational pause.',
      }).status,
    ).toBe('PAUSED');
    expect(
      transitionSchema.safeParse({
        status: 'PUBLISHED',
        expectedVersion: 2,
        reason: 'Invalid state.',
      }).success,
    ).toBe(false);
    expect(
      transitionSchema.safeParse({
        status: 'ACTIVE',
        expectedVersion: 2,
        reason: 'Valid reason.',
        ownerBypass: true,
      }).success,
    ).toBe(false);
  });
});
