import { ApiError } from '@ipoint/api-client';
import { describe, expect, it } from 'vitest';
import {
  canScheduleRewardRules,
  canViewRewardRules,
  describeRewardReadError,
  describeRewardWriteError,
  formatRewardWindow,
  marketLocalToday,
  marketLocalTomorrow,
  orderRewardRules,
  resolveLocalMidnightUtc,
  rewardEffectiveDateFuture,
  rewardRateGrammarValid,
  rewardRateWithinGovernance,
  rewardRateWithinPackageMax,
  rewardWindowStatusLabel,
} from './reward-config-model.js';

describe('P7-S6B reward configuration model', () => {
  it('labels window statuses from the adapter exactly', () => {
    expect(rewardWindowStatusLabel('SCHEDULED')).toBe('Scheduled');
    expect(rewardWindowStatusLabel('ACTIVE')).toBe('Active');
    expect(rewardWindowStatusLabel('SUPERSEDED')).toBe('Superseded');
    expect(rewardWindowStatusLabel('EXPIRED')).toBe('Expired');
    expect(rewardWindowStatusLabel('ARCHIVED')).toBe('Archived');
    expect(rewardWindowStatusLabel('UNKNOWN')).toBe('UNKNOWN');
  });

  it('validates the §7.1 rate grammar (at most six decimals, no negatives)', () => {
    expect(rewardRateGrammarValid('0')).toBe(true);
    expect(rewardRateGrammarValid('0.000000')).toBe(true);
    expect(rewardRateGrammarValid('0.05')).toBe(true);
    expect(rewardRateGrammarValid('0.000001')).toBe(true);
    expect(rewardRateGrammarValid('0.0000001')).toBe(false); // 7 decimals
    expect(rewardRateGrammarValid('-0.01')).toBe(false);
    expect(rewardRateGrammarValid('.05')).toBe(false);
    expect(rewardRateGrammarValid('abc')).toBe(false);
  });

  it('enforces the 0.05%/day governance ceiling with exact decimals', () => {
    expect(rewardRateWithinGovernance('0')).toBe(true);
    expect(rewardRateWithinGovernance('0.05')).toBe(true);
    expect(rewardRateWithinGovernance('0.050000')).toBe(true);
    expect(rewardRateWithinGovernance('0.050001')).toBe(false);
    expect(rewardRateWithinGovernance('0.06')).toBe(false);
    expect(rewardRateWithinGovernance('abc')).toBe(false);
  });

  it('enforces the per-package maxima (A 0.0125, B 0.025, C–F 0.05)', () => {
    expect(rewardRateWithinPackageMax('0.0125', '0.0125')).toBe(true);
    expect(rewardRateWithinPackageMax('0.0126', '0.0125')).toBe(false);
    expect(rewardRateWithinPackageMax('0.025', '0.025')).toBe(true);
    expect(rewardRateWithinPackageMax('0.025001', '0.025')).toBe(false);
    expect(rewardRateWithinPackageMax('0.05', '0.05')).toBe(true);
    expect(rewardRateWithinPackageMax('0.050001', '0.05')).toBe(false);
  });

  it('accepts only strictly future market-local dates', () => {
    expect(rewardEffectiveDateFuture('2099-01-01', 'Asia/Kuala_Lumpur')).toBe(
      true,
    );
    expect(rewardEffectiveDateFuture('2020-01-01', 'Asia/Kuala_Lumpur')).toBe(
      false,
    );
    expect(rewardEffectiveDateFuture('not-a-date', 'Asia/Kuala_Lumpur')).toBe(
      false,
    );
    // Same-day is rejected too (server rejects non-future midnight).
    const today = marketLocalToday('Asia/Kuala_Lumpur');
    expect(rewardEffectiveDateFuture(today, 'Asia/Kuala_Lumpur')).toBe(false);
    // Tomorrow is the earliest acceptable picker value.
    expect(
      rewardEffectiveDateFuture(
        marketLocalTomorrow('Asia/Kuala_Lumpur'),
        'Asia/Kuala_Lumpur',
      ),
    ).toBe(true);
  });

  it('resolves market-local midnight to the exact UTC instant (UTC+8)', () => {
    const midnight = resolveLocalMidnightUtc('2026-09-01', 'Asia/Kuala_Lumpur');
    expect(midnight?.toISOString()).toBe('2026-08-31T16:00:00.000Z');
  });

  it('orders the schedule newest-first without client math', () => {
    const ordered = orderRewardRules([
      { effective_from_utc: '2026-01-01T00:00:00.000Z' },
      { effective_from_utc: '2026-06-01T00:00:00.000Z' },
    ]);
    expect(ordered[0]?.effective_from_utc).toBe('2026-06-01T00:00:00.000Z');
  });

  it('formats the effective window from server strings only', () => {
    expect(
      formatRewardWindow({
        effective_from_local: '2026-09-01 00:00:00',
        effective_until_local: null,
      }),
    ).toBe('2026-09-01 00:00:00 → open');
    expect(
      formatRewardWindow({
        effective_from_local: '2026-01-01 08:00:00',
        effective_until_local: '2026-09-01 00:00:00',
      }),
    ).toBe('2026-01-01 08:00:00 → 2026-09-01 00:00:00');
  });

  it('gates affordances on the canonical permissions only', () => {
    expect(canViewRewardRules(['reward.rule.read'])).toBe(true);
    expect(canViewRewardRules(['SUPER_ADMIN'])).toBe(false);
    expect(canScheduleRewardRules(['reward.rule.schedule'])).toBe(true);
    expect(canScheduleRewardRules(['reward.rule.read'])).toBe(false);
  });

  it('maps read errors to stable copy, including offline', () => {
    const denied = describeRewardReadError(
      new ApiError(403, { code: 'PERMISSION_DENIED' }),
    );
    expect(denied.title).toBe('Permission denied');
    const offline = describeRewardReadError(
      new ApiError(0, { code: 'NETWORK_OFFLINE' }),
    );
    expect(offline.title).toBe('You are offline');
    expect(describeRewardReadError(new Error('boom')).title).toBe(
      'Reward configuration unavailable',
    );
  });

  it('maps write errors to actionable copy', () => {
    const governance = describeRewardWriteError(
      new ApiError(422, { code: 'REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT' }),
    );
    expect(governance).toContain('governance');
    const overlap = describeRewardWriteError(
      new ApiError(409, { code: 'REWARD_EFFECTIVE_WINDOW_OVERLAP' }),
    );
    expect(overlap).toContain('overlaps');
    expect(describeRewardWriteError(new Error('boom'))).toBe(
      'The action could not be completed. Retry, or try again later.',
    );
  });
});
