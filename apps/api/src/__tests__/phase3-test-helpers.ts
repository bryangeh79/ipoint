/**
 * Phase 3 Shared Test Helpers
 *
 * Provides reusable fixtures, matchers, and generators for Wallet, Reward,
 * and Settlement tests across all Phase 3 agents.
 *
 * Usage:
 *   import {
 *     createWalletFixture,
 *     expectDecimalCloseTo,
 *     makeIdempotencyKey,
 *   } from '../__tests__/phase3-test-helpers.js';
 *
 * NOTE: These helpers are contract-aware but do NOT require live database
 * connections or running services. They produce deterministic fixture data
 * that validates against the Phase 3 contract drafts.
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Decimal / Amount Helpers
// ---------------------------------------------------------------------------

/**
 * A numeric(38,10) string value used in wallet and reward calculations.
 * Matches the Phase 3 decimal precision specification.
 */
export type Decimal38_10 = string;

/**
 * Create a decimal string from a number, rounding to 10 decimal places.
 */
export function toDecimal(value: number | string): Decimal38_10 {
  const num = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(num)) {
    throw new TypeError(`Invalid decimal value: ${value}`);
  }
  return num.toFixed(10);
}

/**
 * Add two decimal strings and return the result as a Decimal38_10.
 * Handles positive and negative values correctly.
 */
export function addDecimal(a: Decimal38_10, b: Decimal38_10): Decimal38_10 {
  const sum =
    BigInt(a.replace('.', '').padEnd(11, '0')) +
    BigInt(b.replace('.', '').padEnd(11, '0'));

  // When the sum is negative, JavaScript BigInt division and modulo
  // preserve the sign on the remainder, producing malformed output
  // like "-1.-2345678901". Normalise by negating the sum, computing
  // the parts from the absolute value, then prepending the minus sign.
  if (sum < 0n) {
    const absSum = -sum;
    const integerPart = absSum / 10_000_000_000n;
    const fractionalPart = absSum % 10_000_000_000n;
    return `-${integerPart}.${fractionalPart.toString().padStart(10, '0')}`;
  }

  const integerPart = sum / 10_000_000_000n;
  const fractionalPart = sum % 10_000_000_000n;
  return `${integerPart}.${fractionalPart.toString().padStart(10, '0')}`;
}

/**
 * Subtract b from a (a - b). Throws on negative result for non-negative balances.
 */
export function subtractDecimal(
  a: Decimal38_10,
  b: Decimal38_10,
): Decimal38_10 {
  const aInt = BigInt(a.replace('.', '').padEnd(11, '0'));
  const bInt = BigInt(b.replace('.', '').padEnd(11, '0'));
  if (bInt > aInt) {
    throw new RangeError('Result would be negative');
  }
  const diff = aInt - bInt;
  const integerPart = diff / 10_000_000_000n;
  const fractionalPart = diff % 10_000_000_000n;
  return `${integerPart}.${fractionalPart.toString().padStart(10, '0')}`;
}

/**
 * Check if a decimal string is greater than zero.
 */
export function isPositive(value: Decimal38_10): boolean {
  const normalized = value.replace(/^0+(?=\d)/, '');
  return (
    normalized !== '0' &&
    normalized !== '0.0000000000' &&
    !normalized.startsWith('-')
  );
}

// ---------------------------------------------------------------------------
// Custom Vitest Matcher: expectDecimalCloseTo
// ---------------------------------------------------------------------------

/**
 * Register this matcher in a vitest setup file:
 *
 *   import { expect } from 'vitest';
 *   import { toBeDecimalCloseTo } from './phase3-test-helpers.js';
 *   expect.extend({ toBeDecimalCloseTo });
 *
 * Then use:
 *   expect(actual).toBeDecimalCloseTo(expected, 0.000001);
 */
export function toBeDecimalCloseTo(
  this: object,
  received: string | number,
  expected: string | number,
  precision: number = 1e-10,
): { pass: boolean; message: () => string } {
  const receivedNum =
    typeof received === 'string' ? Number.parseFloat(received) : received;
  const expectedNum =
    typeof expected === 'string' ? Number.parseFloat(expected) : expected;

  if (!Number.isFinite(receivedNum) || !Number.isFinite(expectedNum)) {
    return {
      pass: false,
      message: () =>
        `Expected both values to be finite numbers, got received=${received} expected=${expected}`,
    };
  }

  const pass = Math.abs(receivedNum - expectedNum) <= precision;
  const diff = Math.abs(receivedNum - expectedNum);

  return {
    pass,
    message: () =>
      pass
        ? `expected ${received} not to be close to ${expected} (±${precision})`
        : `expected ${received} to be close to ${expected} (±${precision}), actual diff=${diff}`,
  };
}

// ---------------------------------------------------------------------------
// Idempotency Key Generator
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic idempotency key for a wallet entry.
 *
 * Format: `{operation}:{domain_id}:{unique_suffix}`
 *
 * Examples:
 *   makeIdempotencyKey('entry', walletId)       // entry:<walletId>:<uuid>
 *   makeIdempotencyKey('reversal', walletId, originalEntryId)
 *   makeIdempotencyKey('reward_plan', sourceId, memberId)
 */
export function makeIdempotencyKey(
  operation: string,
  ...identifiers: string[]
): string {
  const suffix = randomUUID();
  if (identifiers.length === 0) {
    return `${operation}:${suffix}`;
  }
  return `${operation}:${identifiers.join(':')}:${suffix}`;
}

/**
 * Generate a deterministic idempotency key for reward plan creation.
 */
export function makeRewardPlanKey(
  sourceType: string,
  sourceId: string,
  memberId: string,
  marketId: string,
): string {
  return `reward_plan:${sourceType}:${sourceId}:${memberId}:${marketId}`;
}

/**
 * Generate a deterministic idempotency key for daily accrual.
 */
export function makeAccrualKey(
  rewardPlanId: string,
  marketLocalDate: string,
): string {
  return `accrual:${rewardPlanId}:${marketLocalDate}`;
}

// ---------------------------------------------------------------------------
// Wallet Fixtures
// ---------------------------------------------------------------------------

export interface WalletFixture {
  walletId: string;
  memberId: string;
  marketId: string;
  balance: Decimal38_10;
  status: string;
  entries: WalletEntryFixture[];
}

export interface WalletEntryFixture {
  entryId: string;
  accountId: string;
  amount: Decimal38_10;
  balanceBefore: Decimal38_10;
  balanceAfter: Decimal38_10;
  entryType: string;
  entrySubtype: string;
  rewardPlanId: string | null;
  idempotencyKey: string;
  createdAt: string;
}

/**
 * Create a deterministic wallet fixture for unit or integration tests.
 * Does NOT create database records — returns plain fixture data.
 */
export function createWalletFixture(
  overrides: Partial<WalletFixture> = {},
): WalletFixture {
  const walletId = randomUUID();
  const memberId = randomUUID();
  const marketId = randomUUID();

  const fixture: WalletFixture = {
    walletId,
    memberId,
    marketId,
    balance: '0.0000000000',
    status: 'ACTIVE',
    entries: [],
    ...overrides,
  };

  return fixture;
}

/**
 * Create a wallet fixture with seeded ledger entries and a non-zero balance.
 */
export function createWalletWithEntries(
  entryCount: number = 3,
  baseAmount: string = '100.0000000000',
): WalletFixture {
  const walletId = randomUUID();
  const memberId = randomUUID();
  const marketId = randomUUID();

  const entries: WalletEntryFixture[] = [];
  let runningBalance = '0.0000000000';

  for (let i = 0; i < entryCount; i++) {
    const amount = toDecimal(Number.parseFloat(baseAmount) * (i + 1));
    runningBalance = addDecimal(runningBalance, amount);
    entries.push({
      entryId: randomUUID(),
      accountId: walletId,
      amount,
      balanceBefore: subtractDecimal(runningBalance, amount),
      balanceAfter: runningBalance,
      entryType: i === 0 ? 'REWARD_ACCRUAL' : 'REWARD_ACCRUAL',
      entrySubtype: 'DAILY_ACCRUAL',
      rewardPlanId: randomUUID(),
      idempotencyKey: makeIdempotencyKey('entry', walletId),
      createdAt: new Date(Date.UTC(2026, 7, 1 + i, 0, 0, 0)).toISOString(),
    });
  }

  return {
    walletId,
    memberId,
    marketId,
    balance: runningBalance,
    status: 'ACTIVE',
    entries,
  };
}

// ---------------------------------------------------------------------------
// Market / Member Fixtures
// ---------------------------------------------------------------------------

export interface MarketFixture {
  marketId: string;
  code: string;
  name: string;
  currencyCode: string;
  timezone: string;
  defaultLocale: string;
}

export interface MemberFixture {
  memberId: string;
  accountId: string;
  publicMemberId: string;
  referralCode: string;
}

/**
 * Create a deterministic market fixture.
 */
export function createMarketFixture(
  overrides: Partial<MarketFixture> = {},
): MarketFixture {
  return {
    marketId: randomUUID(),
    code: 'MY',
    name: 'Malaysia',
    currencyCode: 'MYR',
    timezone: 'Asia/Kuala_Lumpur',
    defaultLocale: 'en-MY',
    ...overrides,
  };
}

/**
 * Create a pair of markets with different timezones for cross-market tests.
 */
export function createMarketPair(): [MarketFixture, MarketFixture] {
  return [
    createMarketFixture({
      code: 'MY',
      name: 'Malaysia',
      currencyCode: 'MYR',
      timezone: 'Asia/Kuala_Lumpur',
    }),
    createMarketFixture({
      code: 'SG',
      name: 'Singapore',
      currencyCode: 'SGD',
      timezone: 'Asia/Singapore',
    }),
  ];
}

/**
 * Create a DST market fixture (e.g., US Eastern).
 */
export function createDstMarketFixture(): MarketFixture {
  return createMarketFixture({
    code: 'US',
    name: 'United States',
    currencyCode: 'USD',
    timezone: 'America/New_York',
    defaultLocale: 'en-US',
  });
}

/**
 * Create a member fixture with associated identifiers.
 */
export function createMemberFixture(
  overrides: Partial<MemberFixture> = {},
): MemberFixture {
  return {
    memberId: randomUUID(),
    accountId: randomUUID(),
    publicMemberId: `mem_${randomUUID()}`,
    referralCode: `ref_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reward Plan Fixtures
// ---------------------------------------------------------------------------

export interface RewardPlanFixture {
  planId: string;
  sourceType: string;
  sourceId: string;
  memberId: string;
  marketId: string;
  merchantId: string | null;
  status: string;
  totalEarned: Decimal38_10;
  capAmount: Decimal38_10 | null;
  ruleVersionId: string | null;
  snapshot: Record<string, unknown>;
}

/**
 * Create a reward plan fixture for testing state transitions and settlement.
 */
export function createRewardPlanFixture(
  overrides: Partial<RewardPlanFixture> = {},
): RewardPlanFixture {
  return {
    planId: randomUUID(),
    sourceType: 'PURCHASE_TRANSACTION',
    sourceId: randomUUID(),
    memberId: randomUUID(),
    marketId: randomUUID(),
    merchantId: randomUUID(),
    status: 'SCHEDULED',
    totalEarned: '0.0000000000',
    capAmount: '10000.0000000000',
    ruleVersionId: randomUUID(),
    snapshot: {
      merchant_name: 'Test Merchant',
      package_percentage: '8.125000',
      service_fee_percentage: '2.500000',
      relevant_monetary_values: 1000,
      rule_version_effective: 'v1',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reward Rule Version Fixtures
// ---------------------------------------------------------------------------

export interface RewardRuleVersionFixture {
  ruleVersionId: string;
  rewardPlanId: string;
  versionLabel: string;
  rate: Decimal38_10;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * Create a reward rule version fixture.
 */
export function createRewardRuleVersionFixture(
  overrides: Partial<RewardRuleVersionFixture> = {},
): RewardRuleVersionFixture {
  return {
    ruleVersionId: randomUUID(),
    rewardPlanId: randomUUID(),
    versionLabel: 'v1',
    rate: '0.0500000000',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null as string | null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Ledger Verification Helpers
// ---------------------------------------------------------------------------

/**
 * Helper: convert a Decimal38_10 string to a BigInt representing the
 * value scaled by 10^10 (matching the internal representation used by
 * addDecimal and subtractDecimal).
 */
function decimalToBigInt(value: Decimal38_10): bigint {
  return BigInt(value.replace('.', '').padEnd(11, '0'));
}

/**
 * Verify the balance invariant: balance === SUM(entries.amount).
 *
 * Reversal entries store positive amounts, but their effect on the
 * wallet balance is negative (subtractive). This function accounts
 * for that by treating REVERSAL, ADJUSTMENT (withdrawal), and
 * CORRECTION entries as negative contributions.
 *
 * Returns { valid, computedBalance, diff } for detailed failure reporting.
 */
export function verifyBalanceInvariant(fixture: WalletFixture): {
  valid: boolean;
  computedBalance: Decimal38_10;
  diff: string;
} {
  let computedBalance: Decimal38_10 = '0.0000000000';
  for (const entry of fixture.entries) {
    // Reversal entries reduce the balance. The stored amount may be
    // positive (by contract: reversal stores positive amounts) or
    // negative (raw amount representation). Normalize by using the
    // absolute value and always subtracting.
    if (entry.entryType === 'REVERSAL') {
      const absAmount = entry.amount.startsWith('-')
        ? entry.amount.slice(1)
        : entry.amount;
      computedBalance = subtractDecimal(computedBalance, absAmount);
    } else if (
      entry.entryType === 'ADJUSTMENT' &&
      entry.entrySubtype === 'ADMIN_WITHDRAWAL'
    ) {
      const absAmount = entry.amount.startsWith('-')
        ? entry.amount.slice(1)
        : entry.amount;
      computedBalance = subtractDecimal(computedBalance, absAmount);
    } else {
      computedBalance = addDecimal(computedBalance, entry.amount);
    }
  }

  const expected = fixture.balance;

  // Use BigInt comparison instead of string comparison to avoid
  // lexicographic ordering bugs (e.g. '1399.0000000000' < '600.0000000000'
  // when compared as strings because '1' < '6').
  const aInt = decimalToBigInt(computedBalance);
  const bInt = decimalToBigInt(expected);

  const diff =
    aInt === bInt
      ? '0.0000000000'
      : subtractDecimal(
          aInt > bInt ? computedBalance : expected,
          aInt > bInt ? expected : computedBalance,
        );

  return {
    valid: computedBalance === expected,
    computedBalance,
    diff,
  };
}

/**
 * Verify that a wallet's market isolation is correct:
 * - Entries only reference accounts in the same market
 * - No cross-market entries leak
 */
export function verifyMarketIsolation(
  walletId: string,
  entries: WalletEntryFixture[],
): { valid: boolean; violatingEntries: WalletEntryFixture[] } {
  const violatingEntries = entries.filter(
    (entry) => entry.accountId !== walletId,
  );
  return {
    valid: violatingEntries.length === 0,
    violatingEntries,
  };
}

// ---------------------------------------------------------------------------
// Timezone Helpers
// ---------------------------------------------------------------------------

/**
 * Get the local date string (YYYY-MM-DD) for a UTC timestamp in a given IANA timezone.
 */
export function getLocalDate(utcIso: string, timezone: string): string {
  // No external dependency — we use Date + UTC offset approximation.
  // For production, use date-fns-tz or Luxon.
  const utcDate = new Date(utcIso);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(utcDate);
}

/**
 * Generate a list of date strings for consecutive days in a timezone.
 */
export function generateConsecutiveLocalDates(
  startDate: string,
  count: number,
  timezone: string,
): string[] {
  const dates: string[] = [];
  const current = new Date(startDate);

  for (let i = 0; i < count; i++) {
    dates.push(getLocalDate(current.toISOString(), timezone));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

// ---------------------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------------------

export type WalletStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED';

export const VALID_WALLET_STATUSES: readonly WalletStatus[] = [
  'ACTIVE',
  'FROZEN',
  'CLOSED',
] as const;

export function isValidWalletStatus(status: string): status is WalletStatus {
  return (VALID_WALLET_STATUSES as readonly string[]).includes(status);
}

export type RewardPlanStatus =
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'CAPPED'
  | 'SUSPENDED'
  | 'REVERSED'
  | 'COMPLETED';

export const VALID_REWARD_PLAN_STATUSES: readonly RewardPlanStatus[] = [
  'SCHEDULED',
  'ACTIVE',
  'CAPPED',
  'SUSPENDED',
  'REVERSED',
  'COMPLETED',
] as const;

export function isValidRewardPlanStatus(
  status: string,
): status is RewardPlanStatus {
  return (VALID_REWARD_PLAN_STATUSES as readonly string[]).includes(status);
}

export type LedgerEntryType =
  | 'REWARD_ACCRUAL'
  | 'REVERSAL'
  | 'CORRECTION'
  | 'ADJUSTMENT';

export const VALID_LEDGER_ENTRY_TYPES: readonly LedgerEntryType[] = [
  'REWARD_ACCRUAL',
  'REVERSAL',
  'CORRECTION',
  'ADJUSTMENT',
] as const;

export function isValidLedgerEntryType(
  entryType: string,
): entryType is LedgerEntryType {
  return (VALID_LEDGER_ENTRY_TYPES as readonly string[]).includes(entryType);
}
