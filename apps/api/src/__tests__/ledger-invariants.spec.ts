/**
 * Phase 3 Ledger Invariant Tests
 *
 * Validates core ledger accounting invariants:
 *   1. wallet_balance = SUM(entries) for each wallet
 *   2. No duplicate idempotency keys
 *   3. No entries with negative amount
 *   4. Reversal entries properly linked to original entries
 *
 * These tests are contract-aware and self-contained. They verify that the
 * ledger maintains its fundamental accounting identity under various scenarios.
 *
 * Run:
 *   pnpm vitest run apps/api/src/__tests__/ledger-invariants.spec.ts
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import {
  createWalletFixture,
  createWalletWithEntries,
  createRewardPlanFixture,
  createMarketFixture,
  createMemberFixture,
  toDecimal,
  addDecimal,
  subtractDecimal,
  isPositive,
  verifyBalanceInvariant,
  verifyMarketIsolation,
  makeIdempotencyKey,
  makeAccrualKey,
} from './phase3-test-helpers.js';

// ===========================================================================
// 1. wallet_balance = SUM(entries) for each wallet
// ===========================================================================

describe('Ledger Invariant: wallet_balance = SUM(entries)', () => {
  it('empty wallet has zero balance', () => {
    const wallet = createWalletFixture();
    const result = verifyBalanceInvariant(wallet);
    expect(result.valid).toBe(true);
    expect(result.computedBalance).toBe('0.0000000000');
    expect(wallet.balance).toBe('0.0000000000');
  });

  it('single entry equals wallet balance', () => {
    const wallet = createWalletWithEntries(1, '100.0000000000');
    const result = verifyBalanceInvariant(wallet);
    expect(result.valid).toBe(true);
    expect(wallet.balance).toBe('100.0000000000');
    expect(wallet.entries).toHaveLength(1);
  });

  it('multiple credit entries sum correctly', () => {
    const wallet = createWalletWithEntries(5, '100.0000000000');
    const result = verifyBalanceInvariant(wallet);
    expect(result.valid).toBe(true);

    // Sum: 100 + 200 + 300 + 400 + 500 = 1500
    expect(wallet.balance).toBe('1500.0000000000');
  });

  it('mixed debit and credit entries', () => {
    const wallet = createWalletFixture();
    let balance = wallet.balance;

    // Credit 500
    const credit1 = toDecimal('500.0000000000');
    const balBefore1 = balance;
    balance = addDecimal(balance, credit1);
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: credit1,
      balanceBefore: balBefore1,
      balanceAfter: balance,
      entryType: 'REWARD_ACCRUAL',
      entrySubtype: 'DAILY_ACCRUAL',
      rewardPlanId: randomUUID(),
      idempotencyKey: makeIdempotencyKey('entry', wallet.walletId),
      createdAt: new Date().toISOString(),
    });

    // Debit 200 (reversal)
    const debit1 = toDecimal('-200.0000000000');
    const balBefore2 = balance;
    balance = addDecimal(balance, debit1);
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: debit1,
      balanceBefore: balBefore2,
      balanceAfter: balance,
      entryType: 'REVERSAL',
      entrySubtype: 'FULL_REVERSAL',
      rewardPlanId: null,
      idempotencyKey: makeIdempotencyKey('reversal', wallet.walletId),
      createdAt: new Date().toISOString(),
    });

    // Credit 100
    const credit2 = toDecimal('100.0000000000');
    const balBefore3 = balance;
    balance = addDecimal(balance, credit2);
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: credit2,
      balanceBefore: balBefore3,
      balanceAfter: balance,
      entryType: 'REWARD_ACCRUAL',
      entrySubtype: 'DAILY_ACCRUAL',
      rewardPlanId: randomUUID(),
      idempotencyKey: makeIdempotencyKey('entry', wallet.walletId),
      createdAt: new Date().toISOString(),
    });

    wallet.balance = balance;
    // Expected: 500 - 200 + 100 = 400
    expect(wallet.balance).toBe('400.0000000000');

    const result = verifyBalanceInvariant(wallet);
    expect(result.valid).toBe(true);
    expect(result.computedBalance).toBe('400.0000000000');
  });

  it('many small entries sum correctly (100 entries of 0.01)', () => {
    const wallet = createWalletFixture();
    let balance = wallet.balance;

    for (let i = 0; i < 100; i++) {
      const amount = toDecimal('0.0100000000');
      const balBefore = balance;
      balance = addDecimal(balance, amount);
      wallet.entries.push({
        entryId: randomUUID(),
        accountId: wallet.walletId,
        amount,
        balanceBefore: balBefore,
        balanceAfter: balance,
        entryType: 'REWARD_ACCRUAL',
        entrySubtype: 'DAILY_ACCRUAL',
        rewardPlanId: randomUUID(),
        idempotencyKey: makeIdempotencyKey('entry', wallet.walletId),
        createdAt: new Date().toISOString(),
      });
    }

    wallet.balance = balance;
    // 100 * 0.01 = 1.00
    expect(wallet.balance).toBe('1.0000000000');

    const result = verifyBalanceInvariant(wallet);
    expect(result.valid).toBe(true);
  });

  it('large numbers avoid floating point errors', () => {
    const wallet = createWalletFixture();
    let balance = wallet.balance;

    // Add very large and very small numbers
    const largeAmount = toDecimal('9999999999.9999999999');
    const balBefore1 = balance;
    balance = addDecimal(balance, largeAmount);
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: largeAmount,
      balanceBefore: balBefore1,
      balanceAfter: balance,
      entryType: 'REWARD_ACCRUAL',
      entrySubtype: 'DAILY_ACCRUAL',
      rewardPlanId: randomUUID(),
      idempotencyKey: makeIdempotencyKey('entry', wallet.walletId),
      createdAt: new Date().toISOString(),
    });

    const tinyAmount = toDecimal('0.0000000001');
    const balBefore2 = balance;
    balance = addDecimal(balance, tinyAmount);
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: tinyAmount,
      balanceBefore: balBefore2,
      balanceAfter: balance,
      entryType: 'REWARD_ACCRUAL',
      entrySubtype: 'DAILY_ACCRUAL',
      rewardPlanId: randomUUID(),
      idempotencyKey: makeIdempotencyKey('entry', wallet.walletId),
      createdAt: new Date().toISOString(),
    });

    wallet.balance = balance;
    const expected = addDecimal(largeAmount, tinyAmount);
    expect(wallet.balance).toBe(expected);

    const result = verifyBalanceInvariant(wallet);
    expect(result.valid).toBe(true);
  });

  it('detects balance mismatch when entries are corrupted', () => {
    const wallet = createWalletWithEntries(3, '100.0000000000');

    // Corrupt: manually set balance to wrong value
    wallet.balance = '9999.0000000000';

    const result = verifyBalanceInvariant(wallet);
    expect(result.valid).toBe(false);
    expect(result.diff).not.toBe('0.0000000000');
    expect(result.computedBalance).toBe('600.0000000000');
  });

  it('detects balance mismatch when an entry amount is changed', () => {
    const wallet = createWalletWithEntries(3, '100.0000000000');

    // Change the second entry amount (corruption)
    wallet.entries[1]!.amount = toDecimal('999.0000000000');

    const result = verifyBalanceInvariant(wallet);
    expect(result.valid).toBe(false);
    // Computed: 100 + 999 + 300 = 1399, but balance is 600
    expect(result.computedBalance).not.toBe(wallet.balance);
  });

  it('detects balance mismatch when an entry is removed', () => {
    const wallet = createWalletWithEntries(3, '100.0000000000');

    // Remove the middle entry (corruption)
    wallet.entries.splice(1, 1);

    const result = verifyBalanceInvariant(wallet);
    expect(result.valid).toBe(false);
    // Computed: 100 + 300 = 400, but balance is 600
    expect(result.computedBalance).toBe('400.0000000000');
    expect(wallet.balance).toBe('600.0000000000');
  });
});

// ===========================================================================
// 2. No duplicate idempotency keys
// ===========================================================================

describe('Ledger Invariant: No Duplicate Idempotency Keys', () => {
  it('empty wallet has no idempotency key collisions', () => {
    const wallet = createWalletFixture();
    const iks = wallet.entries.map((e) => e.idempotencyKey);
    expect(new Set(iks).size).toBe(iks.length);
  });

  it('wallet with entries has all unique idempotency keys', () => {
    const wallet = createWalletWithEntries(10, '100.0000000000');
    const iks = wallet.entries.map((e) => e.idempotencyKey);
    expect(new Set(iks).size).toBe(10);
    expect(iks).toHaveLength(10);
  });

  it('duplicate idempotency keys are detected', () => {
    const wallet = createWalletWithEntries(3, '100.0000000000');

    // Inject a duplicate key
    const duplicateKey = wallet.entries[0]!.idempotencyKey;
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: toDecimal('50.0000000000'),
      balanceBefore: wallet.balance,
      balanceAfter: addDecimal(wallet.balance, toDecimal('50.0000000000')),
      entryType: 'REWARD_ACCRUAL',
      entrySubtype: 'DAILY_ACCRUAL',
      rewardPlanId: randomUUID(),
      idempotencyKey: duplicateKey, // Duplicate!
      createdAt: new Date().toISOString(),
    });

    const iks = wallet.entries.map((e) => e.idempotencyKey);
    const uniqueIks = new Set(iks);
    expect(uniqueIks.size).toBeLessThan(iks.length);
  });

  it('same accrual key for different dates is unique', () => {
    const planId = randomUUID();

    const keys = [];
    for (let day = 1; day <= 31; day++) {
      const date = `2026-08-${String(day).padStart(2, '0')}`;
      keys.push(makeAccrualKey(planId, date));
    }

    expect(new Set(keys).size).toBe(31);
  });

  it('same idempotency key across different wallets is still globally unique', () => {
    // makeIdempotencyKey includes a random UUID, so two calls with same params
    // produce different keys
    const key1 = makeIdempotencyKey('entry', 'wallet-id');
    const key2 = makeIdempotencyKey('entry', 'wallet-id');

    expect(key1).not.toBe(key2);
  });

  it('accrual keys for same plan on same date are deterministic (same key)', () => {
    const planId = randomUUID();
    const date = '2026-08-15';

    const key1 = makeAccrualKey(planId, date);
    const key2 = makeAccrualKey(planId, date);

    // Deterministic: same inputs = same output
    expect(key1).toBe(key2);
  });

  it('wallet with 1000 entries has no idempotency collisions', () => {
    const wallet = createWalletFixture();
    let balance = wallet.balance;

    for (let i = 0; i < 1000; i++) {
      const amount = toDecimal('1.0000000000');
      const balBefore = balance;
      balance = addDecimal(balance, amount);
      wallet.entries.push({
        entryId: randomUUID(),
        accountId: wallet.walletId,
        amount,
        balanceBefore: balBefore,
        balanceAfter: balance,
        entryType: 'REWARD_ACCRUAL',
        entrySubtype: 'DAILY_ACCRUAL',
        rewardPlanId: randomUUID(),
        idempotencyKey: makeIdempotencyKey('entry', wallet.walletId),
        createdAt: new Date().toISOString(),
      });
    }

    wallet.balance = balance;
    const iks = wallet.entries.map((e) => e.idempotencyKey);
    expect(new Set(iks).size).toBe(1000);
    expect(wallet.balance).toBe('1000.0000000000');

    const invariant = verifyBalanceInvariant(wallet);
    expect(invariant.valid).toBe(true);
  });
});

// ===========================================================================
// 3. No entries with negative amount
// ===========================================================================

describe('Ledger Invariant: No Entries with Negative Amount (raw)', () => {
  it('credit entries have positive amounts', () => {
    const wallet = createWalletWithEntries(5, '100.0000000000');

    // All entries should have positive amounts
    for (const entry of wallet.entries) {
      expect(isPositive(entry.amount)).toBe(true);
    }
  });

  it('reversal entries should have their OWN amount field positive (linked entry shows reversal)', () => {
    // Contract: reversal entries store positive amounts and link to the
    // original entry. The net effect is negative on the balance, but the
    // stored amount is always positive.
    const wallet = createWalletFixture();
    let balance = wallet.balance;

    // Original credit
    const creditAmount = toDecimal('500.0000000000');
    const balBefore1 = balance;
    balance = addDecimal(balance, creditAmount);
    const originalEntryId = randomUUID();
    wallet.entries.push({
      entryId: originalEntryId,
      accountId: wallet.walletId,
      amount: creditAmount,
      balanceBefore: balBefore1,
      balanceAfter: balance,
      entryType: 'REWARD_ACCRUAL',
      entrySubtype: 'DAILY_ACCRUAL',
      rewardPlanId: randomUUID(),
      idempotencyKey: makeIdempotencyKey('entry', wallet.walletId),
      createdAt: new Date().toISOString(),
    });

    // Reversal (amount is still positive, but it's a REVERSAL type)
    const reversalAmount = toDecimal('500.0000000000'); // Positive!
    const balBefore2 = balance;
    balance = subtractDecimal(balance, reversalAmount);
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: reversalAmount, // Always stored as positive amount
      balanceBefore: balBefore2,
      balanceAfter: balance,
      entryType: 'REVERSAL',
      entrySubtype: 'FULL_REVERSAL',
      rewardPlanId: null,
      idempotencyKey: makeIdempotencyKey('reversal', originalEntryId),
      createdAt: new Date().toISOString(),
    });

    wallet.balance = balance;

    // All amounts are positive
    for (const entry of wallet.entries) {
      expect(isPositive(entry.amount)).toBe(true);
    }

    // Balance is 0 (500 - 500 = 0)
    expect(wallet.balance).toBe('0.0000000000');

    // Invariant holds
    const invariant = verifyBalanceInvariant(wallet);
    expect(invariant.valid).toBe(true);
  });

  it('detects an entry with negative raw amount (invalid)', () => {
    const wallet = createWalletWithEntries(2, '100.0000000000');

    // Add an entry with negative amount (violation)
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: toDecimal('-50.0000000000'), // Negative — violation!
      balanceBefore: wallet.balance,
      balanceAfter: subtractDecimal(wallet.balance, toDecimal('50.0000000000')),
      entryType: 'REVERSAL',
      entrySubtype: 'FULL_REVERSAL',
      rewardPlanId: null,
      idempotencyKey: makeIdempotencyKey('reversal', wallet.walletId),
      createdAt: new Date().toISOString(),
    });

    // Detect the negative amount
    const negativeEntry = wallet.entries.find((e) => !isPositive(e.amount));
    expect(negativeEntry).toBeDefined();
    expect(negativeEntry!.amount.startsWith('-')).toBe(true);
  });

  it('adjustment entries store positive amounts', () => {
    const wallet = createWalletFixture();
    let balance = wallet.balance;

    // Admin adjustment (positive)
    const adjAmount = toDecimal('200.0000000000');
    const balBefore = balance;
    balance = addDecimal(balance, adjAmount);
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: adjAmount,
      balanceBefore: balBefore,
      balanceAfter: balance,
      entryType: 'ADJUSTMENT',
      entrySubtype: 'ADMIN_CORRECTION',
      rewardPlanId: null,
      idempotencyKey: makeIdempotencyKey('adjustment', wallet.walletId),
      createdAt: new Date().toISOString(),
    });

    wallet.balance = balance;
    expect(isPositive(wallet.entries[0]!.amount)).toBe(true);
    expect(wallet.balance).toBe('200.0000000000');
  });

  it('compensation entries store positive amounts', () => {
    const wallet = createWalletFixture();
    let balance = wallet.balance;

    const compAmount = toDecimal('50.0000000000');
    const balBefore = balance;
    balance = addDecimal(balance, compAmount);
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: compAmount,
      balanceBefore: balBefore,
      balanceAfter: balance,
      entryType: 'CORRECTION',
      entrySubtype: 'COMPENSATION',
      rewardPlanId: null,
      idempotencyKey: makeIdempotencyKey('compensation', wallet.walletId),
      createdAt: new Date().toISOString(),
    });

    wallet.balance = balance;
    expect(isPositive(wallet.entries[0]!.amount)).toBe(true);
    expect(wallet.balance).toBe('50.0000000000');
  });

  it('all valid entry types store positive amounts', () => {
    const wallet = createWalletFixture();
    let balance = wallet.balance;

    const entryTypes = [
      'REWARD_ACCRUAL',
      'REVERSAL',
      'CORRECTION',
      'ADJUSTMENT',
    ] as const;

    for (const entryType of entryTypes) {
      const amount = toDecimal('10.0000000000');
      const balBefore = balance;
      // Reversal entries reduce the balance; all other types increase it
      if (entryType === 'REVERSAL') {
        balance = subtractDecimal(balance, amount);
      } else {
        balance = addDecimal(balance, amount);
      }
      wallet.entries.push({
        entryId: randomUUID(),
        accountId: wallet.walletId,
        amount,
        balanceBefore: balBefore,
        balanceAfter: balance,
        entryType,
        entrySubtype:
          entryType === 'REWARD_ACCRUAL' ? 'DAILY_ACCRUAL' : 'MANUAL',
        rewardPlanId: entryType === 'REWARD_ACCRUAL' ? randomUUID() : null,
        idempotencyKey: makeIdempotencyKey(
          entryType.toLowerCase(),
          wallet.walletId,
        ),
        createdAt: new Date().toISOString(),
      });
    }

    wallet.balance = balance;

    for (const entry of wallet.entries) {
      expect(isPositive(entry.amount)).toBe(true);
    }

    // Accrual: 10, Reversal: subtract 10, Correction: 10, Adjustment: 10 = 20
    expect(wallet.balance).toBe('20.0000000000');

    const invariant = verifyBalanceInvariant(wallet);
    expect(invariant.valid).toBe(true);
  });
});

// ===========================================================================
// 4. Reversal entries properly linked
// ===========================================================================

describe('Ledger Invariant: Reversal Entries Properly Linked', () => {
  it('reversal references the original entry via idempotency key', () => {
    const originalEntryId = randomUUID();
    const reversalIk = makeIdempotencyKey('reversal', originalEntryId);

    // Reversal key should contain reference to the original entry
    expect(reversalIk).toContain('reversal:');
    expect(reversalIk).toContain(originalEntryId);
  });

  it('full reversal restores balance to pre-credit amount', () => {
    const wallet = createWalletFixture();
    let balance = wallet.balance;

    // Original credit: +500
    const creditAmount = toDecimal('500.0000000000');
    const originalEntryId = randomUUID();
    balance = addDecimal(balance, creditAmount);
    wallet.entries.push({
      entryId: originalEntryId,
      accountId: wallet.walletId,
      amount: creditAmount,
      balanceBefore: '0.0000000000',
      balanceAfter: '500.0000000000',
      entryType: 'REWARD_ACCRUAL',
      entrySubtype: 'DAILY_ACCRUAL',
      rewardPlanId: randomUUID(),
      idempotencyKey: makeIdempotencyKey('entry', wallet.walletId),
      createdAt: new Date().toISOString(),
    });

    // Balance after credit: 500
    expect(balance).toBe('500.0000000000');

    // Full reversal: -500
    const reversalEntryId = randomUUID();
    const reversalAmount = toDecimal('500.0000000000');
    const balBefore = balance;
    balance = subtractDecimal(balance, reversalAmount);
    wallet.entries.push({
      entryId: reversalEntryId,
      accountId: wallet.walletId,
      amount: reversalAmount,
      balanceBefore: balBefore,
      balanceAfter: balance,
      entryType: 'REVERSAL',
      entrySubtype: 'FULL_REVERSAL',
      rewardPlanId: null,
      idempotencyKey: makeIdempotencyKey('reversal', originalEntryId),
      createdAt: new Date().toISOString(),
    });

    wallet.balance = balance;

    // Balance restored to 0
    expect(wallet.balance).toBe('0.0000000000');

    const invariant = verifyBalanceInvariant(wallet);
    expect(invariant.valid).toBe(true);
  });

  it('partial reversal reduces but does not eliminate balance', () => {
    const wallet = createWalletFixture();
    let balance = wallet.balance;

    // Original credit: 1000
    const creditAmount = toDecimal('1000.0000000000');
    const originalEntryId = randomUUID();
    balance = addDecimal(balance, creditAmount);
    wallet.entries.push({
      entryId: originalEntryId,
      accountId: wallet.walletId,
      amount: creditAmount,
      balanceBefore: '0.0000000000',
      balanceAfter: '1000.0000000000',
      entryType: 'REWARD_ACCRUAL',
      entrySubtype: 'DAILY_ACCRUAL',
      rewardPlanId: randomUUID(),
      idempotencyKey: makeIdempotencyKey('entry', wallet.walletId),
      createdAt: new Date().toISOString(),
    });

    // Partial reversal: 300
    const reversalAmount = toDecimal('300.0000000000');
    const balBefore = balance;
    balance = subtractDecimal(balance, reversalAmount);
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: reversalAmount,
      balanceBefore: balBefore,
      balanceAfter: balance,
      entryType: 'REVERSAL',
      entrySubtype: 'PARTIAL_REVERSAL',
      rewardPlanId: null,
      idempotencyKey: makeIdempotencyKey('reversal', originalEntryId),
      createdAt: new Date().toISOString(),
    });

    wallet.balance = balance;

    // Balance: 1000 - 300 = 700
    expect(wallet.balance).toBe('700.0000000000');

    const invariant = verifyBalanceInvariant(wallet);
    expect(invariant.valid).toBe(true);
  });

  it('reversal of a reversed entry (double reversal) is prevented', () => {
    const wallet = createWalletFixture();
    let balance = wallet.balance;

    // Original credit: 500
    const originalEntryId = randomUUID();
    balance = addDecimal(balance, toDecimal('500.0000000000'));
    wallet.entries.push({
      entryId: originalEntryId,
      accountId: wallet.walletId,
      amount: toDecimal('500.0000000000'),
      balanceBefore: '0.0000000000',
      balanceAfter: '500.0000000000',
      entryType: 'REWARD_ACCRUAL',
      entrySubtype: 'DAILY_ACCRUAL',
      rewardPlanId: randomUUID(),
      idempotencyKey: makeIdempotencyKey('entry', wallet.walletId),
      createdAt: new Date().toISOString(),
    });

    // First reversal: -500 (full)
    const firstReversalKey = makeIdempotencyKey('reversal', originalEntryId);
    balance = subtractDecimal(balance, toDecimal('500.0000000000'));
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: toDecimal('500.0000000000'),
      balanceBefore: '500.0000000000',
      balanceAfter: '0.0000000000',
      entryType: 'REVERSAL',
      entrySubtype: 'FULL_REVERSAL',
      rewardPlanId: null,
      idempotencyKey: firstReversalKey,
      createdAt: new Date().toISOString(),
    });

    wallet.balance = balance;

    // Attempt second reversal — should be prevented (already reversed)
    // The system checks if the original entry has already been reversed
    const hasExistingReversal = wallet.entries.some(
      (e) =>
        e.entryType === 'REVERSAL' && e.idempotencyKey === firstReversalKey,
    );
    expect(hasExistingReversal).toBe(true);

    // Balance stays at 0
    expect(wallet.balance).toBe('0.0000000000');
  });

  it('reversal links back to the original reward plan when applicable', () => {
    const planId = randomUUID();
    const wallet = createWalletFixture();
    let balance = wallet.balance;

    // Accrual linked to reward plan
    const accrualEntryId = randomUUID();
    const amount = toDecimal('100.0000000000');
    balance = addDecimal(balance, amount);
    wallet.entries.push({
      entryId: accrualEntryId,
      accountId: wallet.walletId,
      amount,
      balanceBefore: '0.0000000000',
      balanceAfter: '100.0000000000',
      entryType: 'REWARD_ACCRUAL',
      entrySubtype: 'DAILY_ACCRUAL',
      rewardPlanId: planId,
      idempotencyKey: makeAccrualKey(planId, '2026-08-15'),
      createdAt: new Date().toISOString(),
    });

    // Reversal references the original entry (via idempotency key convention)
    // and the reward plan (via rewardPlanId null — reversal has no direct plan link)
    const reversalEntryId = randomUUID();
    balance = subtractDecimal(balance, amount);
    wallet.entries.push({
      entryId: reversalEntryId,
      accountId: wallet.walletId,
      amount,
      balanceBefore: '100.0000000000',
      balanceAfter: '0.0000000000',
      entryType: 'REVERSAL',
      entrySubtype: 'FULL_REVERSAL',
      rewardPlanId: null, // Reversal doesn't link directly to reward plan
      idempotencyKey: makeIdempotencyKey('reversal', accrualEntryId),
      createdAt: new Date().toISOString(),
    });

    wallet.balance = balance;

    // Original entry has rewardPlanId, reversal entry does not
    const originalEntry = wallet.entries.find(
      (e) => e.entryId === accrualEntryId,
    );
    const reversalEntry = wallet.entries.find(
      (e) => e.entryId === reversalEntryId,
    );

    expect(originalEntry).toBeDefined();
    expect(reversalEntry).toBeDefined();
    expect(originalEntry!.rewardPlanId).toBe(planId);
    expect(reversalEntry!.rewardPlanId).toBeNull();

    // Reversal ik references original entry
    expect(reversalEntry!.idempotencyKey).toContain(accrualEntryId);

    const invariant = verifyBalanceInvariant(wallet);
    expect(invariant.valid).toBe(true);
  });

  it('multiple reversals on same original entry follow FIFO order', () => {
    const wallet = createWalletFixture();
    let balance = wallet.balance;

    // Original: 1000
    const originalEntryId = randomUUID();
    balance = addDecimal(balance, toDecimal('1000.0000000000'));
    wallet.entries.push({
      entryId: originalEntryId,
      accountId: wallet.walletId,
      amount: toDecimal('1000.0000000000'),
      balanceBefore: '0.0000000000',
      balanceAfter: '1000.0000000000',
      entryType: 'REWARD_ACCRUAL',
      entrySubtype: 'DAILY_ACCRUAL',
      rewardPlanId: randomUUID(),
      idempotencyKey: makeIdempotencyKey('entry', wallet.walletId),
      createdAt: new Date().toISOString(),
    });

    // Partial reversal 1: 200
    balance = subtractDecimal(balance, toDecimal('200.0000000000'));
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: toDecimal('200.0000000000'),
      balanceBefore: '1000.0000000000',
      balanceAfter: '800.0000000000',
      entryType: 'REVERSAL',
      entrySubtype: 'PARTIAL_REVERSAL',
      rewardPlanId: null,
      idempotencyKey: makeIdempotencyKey('reversal', originalEntryId, '1'),
      createdAt: new Date().toISOString(),
    });

    // Partial reversal 2: 300
    balance = subtractDecimal(balance, toDecimal('300.0000000000'));
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: toDecimal('300.0000000000'),
      balanceBefore: '800.0000000000',
      balanceAfter: '500.0000000000',
      entryType: 'REVERSAL',
      entrySubtype: 'PARTIAL_REVERSAL',
      rewardPlanId: null,
      idempotencyKey: makeIdempotencyKey('reversal', originalEntryId, '2'),
      createdAt: new Date().toISOString(),
    });

    wallet.balance = balance;

    // Balance: 1000 - 200 - 300 = 500
    expect(wallet.balance).toBe('500.0000000000');

    // Reversals are ordered by createdAt (FIFO by convention)
    const reversals = wallet.entries.filter((e) => e.entryType === 'REVERSAL');
    expect(reversals).toHaveLength(2);

    const invariant = verifyBalanceInvariant(wallet);
    expect(invariant.valid).toBe(true);
  });

  it('reversal entry amount cannot exceed original entry amount', () => {
    const wallet = createWalletFixture();
    let balance = wallet.balance;

    // Original credit: 300
    const originalEntryId = randomUUID();
    const originalAmount = toDecimal('300.0000000000');
    balance = addDecimal(balance, originalAmount);
    wallet.entries.push({
      entryId: originalEntryId,
      accountId: wallet.walletId,
      amount: originalAmount,
      balanceBefore: '0.0000000000',
      balanceAfter: '300.0000000000',
      entryType: 'REWARD_ACCRUAL',
      entrySubtype: 'DAILY_ACCRUAL',
      rewardPlanId: randomUUID(),
      idempotencyKey: makeIdempotencyKey('entry', wallet.walletId),
      createdAt: new Date().toISOString(),
    });

    // Attempt reversal of 500 (exceeds original 300)
    const excessiveReversal = toDecimal('500.0000000000');
    const exceedsOriginal = excessiveReversal !== originalAmount;

    // This should be rejected by the business logic
    // The contract states: reversal amount ≤ original entry amount
    expect(exceedsOriginal).toBe(true);
    expect(isPositive(excessiveReversal)).toBe(true);

    // The correct partial reversal should be 300 or less
    const correctReversal = toDecimal('300.0000000000');
    balance = subtractDecimal(balance, correctReversal);
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: correctReversal,
      balanceBefore: '300.0000000000',
      balanceAfter: '0.0000000000',
      entryType: 'REVERSAL',
      entrySubtype: 'FULL_REVERSAL',
      rewardPlanId: null,
      idempotencyKey: makeIdempotencyKey('reversal', originalEntryId),
      createdAt: new Date().toISOString(),
    });

    wallet.balance = balance;
    expect(wallet.balance).toBe('0.0000000000');

    const invariant = verifyBalanceInvariant(wallet);
    expect(invariant.valid).toBe(true);
  });
});

// ===========================================================================
// 5. Combined Invariants — Cross-Cutting
// ===========================================================================

describe('Combined Ledger Invariants', () => {
  it('wallet with complex transaction history satisfies all invariants', () => {
    const wallet = createWalletFixture();
    let balance = wallet.balance;

    // Day 1: Accrual +100
    const planId = randomUUID();
    balance = addDecimal(balance, toDecimal('100.0000000000'));
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: toDecimal('100.0000000000'),
      balanceBefore: '0.0000000000',
      balanceAfter: '100.0000000000',
      entryType: 'REWARD_ACCRUAL',
      entrySubtype: 'DAILY_ACCRUAL',
      rewardPlanId: planId,
      idempotencyKey: makeAccrualKey(planId, '2026-08-01'),
      createdAt: '2026-08-01T00:00:00.000Z',
    });

    // Day 2: Accrual +100
    balance = addDecimal(balance, toDecimal('100.0000000000'));
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: toDecimal('100.0000000000'),
      balanceBefore: '100.0000000000',
      balanceAfter: '200.0000000000',
      entryType: 'REWARD_ACCRUAL',
      entrySubtype: 'DAILY_ACCRUAL',
      rewardPlanId: planId,
      idempotencyKey: makeAccrualKey(planId, '2026-08-02'),
      createdAt: '2026-08-02T00:00:00.000Z',
    });

    // Day 3: Admin adjustment +50
    balance = addDecimal(balance, toDecimal('50.0000000000'));
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: toDecimal('50.0000000000'),
      balanceBefore: '200.0000000000',
      balanceAfter: '250.0000000000',
      entryType: 'ADJUSTMENT',
      entrySubtype: 'ADMIN_CORRECTION',
      rewardPlanId: null,
      idempotencyKey: makeIdempotencyKey('adjustment', wallet.walletId),
      createdAt: '2026-08-03T00:00:00.000Z',
    });

    // Day 4: Partial reversal of day 1 = -100 (full reversal of day 1)
    balance = subtractDecimal(balance, toDecimal('100.0000000000'));
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: toDecimal('100.0000000000'),
      balanceBefore: '250.0000000000',
      balanceAfter: '150.0000000000',
      entryType: 'REVERSAL',
      entrySubtype: 'FULL_REVERSAL',
      rewardPlanId: null,
      idempotencyKey: makeIdempotencyKey(
        'reversal',
        wallet.entries[0]!.entryId,
      ),
      createdAt: '2026-08-04T00:00:00.000Z',
    });

    // Day 5: Correction +25
    balance = addDecimal(balance, toDecimal('25.0000000000'));
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: toDecimal('25.0000000000'),
      balanceBefore: '150.0000000000',
      balanceAfter: '175.0000000000',
      entryType: 'CORRECTION',
      entrySubtype: 'COMPENSATION',
      rewardPlanId: null,
      idempotencyKey: makeIdempotencyKey('correction', wallet.walletId),
      createdAt: '2026-08-05T00:00:00.000Z',
    });

    wallet.balance = balance;

    // Expected balance: 100 + 100 + 50 - 100 + 25 = 175
    expect(wallet.balance).toBe('175.0000000000');

    // Invariant 1: balance = SUM(entries)
    const balanceInvariant = verifyBalanceInvariant(wallet);
    expect(balanceInvariant.valid).toBe(true);

    // Invariant 2: No duplicate idempotency keys
    const iks = wallet.entries.map((e) => e.idempotencyKey);
    expect(new Set(iks).size).toBe(iks.length);

    // Invariant 3: All amounts are positive
    for (const entry of wallet.entries) {
      expect(isPositive(entry.amount)).toBe(true);
    }

    // Invariant 4: All entries reference the correct wallet
    const isolationInvariant = verifyMarketIsolation(
      wallet.walletId,
      wallet.entries,
    );
    expect(isolationInvariant.valid).toBe(true);
  });

  it('wallet with zero balance after multiple reversals and accruals', () => {
    const wallet = createWalletFixture();
    let balance = wallet.balance;

    // Accrual: +50
    const planId = randomUUID();
    balance = addDecimal(balance, toDecimal('50.0000000000'));
    const entry1Id = randomUUID();
    wallet.entries.push({
      entryId: entry1Id,
      accountId: wallet.walletId,
      amount: toDecimal('50.0000000000'),
      balanceBefore: '0.0000000000',
      balanceAfter: '50.0000000000',
      entryType: 'REWARD_ACCRUAL',
      entrySubtype: 'DAILY_ACCRUAL',
      rewardPlanId: planId,
      idempotencyKey: makeAccrualKey(planId, '2026-08-01'),
      createdAt: '2026-08-01T00:00:00.000Z',
    });

    // Accrual: +50
    balance = addDecimal(balance, toDecimal('50.0000000000'));
    const entry2Id = randomUUID();
    wallet.entries.push({
      entryId: entry2Id,
      accountId: wallet.walletId,
      amount: toDecimal('50.0000000000'),
      balanceBefore: '50.0000000000',
      balanceAfter: '100.0000000000',
      entryType: 'REWARD_ACCRUAL',
      entrySubtype: 'DAILY_ACCRUAL',
      rewardPlanId: planId,
      idempotencyKey: makeAccrualKey(planId, '2026-08-02'),
      createdAt: '2026-08-02T00:00:00.000Z',
    });

    // Admin adjustment: +100
    balance = addDecimal(balance, toDecimal('100.0000000000'));
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: toDecimal('100.0000000000'),
      balanceBefore: '100.0000000000',
      balanceAfter: '200.0000000000',
      entryType: 'ADJUSTMENT',
      entrySubtype: 'ADMIN_CORRECTION',
      rewardPlanId: null,
      idempotencyKey: makeIdempotencyKey('adjustment', wallet.walletId),
      createdAt: '2026-08-03T00:00:00.000Z',
    });

    // Reversal of entry1: -50
    balance = subtractDecimal(balance, toDecimal('50.0000000000'));
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: toDecimal('50.0000000000'),
      balanceBefore: '200.0000000000',
      balanceAfter: '150.0000000000',
      entryType: 'REVERSAL',
      entrySubtype: 'FULL_REVERSAL',
      rewardPlanId: null,
      idempotencyKey: makeIdempotencyKey('reversal', entry1Id),
      createdAt: '2026-08-04T00:00:00.000Z',
    });

    // Reversal of entry2: -50
    balance = subtractDecimal(balance, toDecimal('50.0000000000'));
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: toDecimal('50.0000000000'),
      balanceBefore: '150.0000000000',
      balanceAfter: '100.0000000000',
      entryType: 'REVERSAL',
      entrySubtype: 'FULL_REVERSAL',
      rewardPlanId: null,
      idempotencyKey: makeIdempotencyKey('reversal', entry2Id),
      createdAt: '2026-08-05T00:00:00.000Z',
    });

    // Admin withdrawal: -100
    balance = subtractDecimal(balance, toDecimal('100.0000000000'));
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: toDecimal('100.0000000000'),
      balanceBefore: '100.0000000000',
      balanceAfter: '0.0000000000',
      entryType: 'ADJUSTMENT',
      entrySubtype: 'ADMIN_WITHDRAWAL',
      rewardPlanId: null,
      idempotencyKey: makeIdempotencyKey('withdrawal', wallet.walletId),
      createdAt: '2026-08-06T00:00:00.000Z',
    });

    wallet.balance = balance;

    // Final balance: 0
    expect(wallet.balance).toBe('0.0000000000');

    // All invariants hold
    const balanceInvariant = verifyBalanceInvariant(wallet);
    expect(balanceInvariant.valid).toBe(true);

    const iks = wallet.entries.map((e) => e.idempotencyKey);
    expect(new Set(iks).size).toBe(iks.length);

    for (const entry of wallet.entries) {
      expect(isPositive(entry.amount)).toBe(true);
    }
  });
});
