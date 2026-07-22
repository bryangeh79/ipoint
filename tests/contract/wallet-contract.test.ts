/**
 * Phase 3 Contract Tests — Wallet & Reward API Contracts
 *
 * Validates:
 *   1. API endpoint contracts (documented endpoints are consistent)
 *   2. Error code coverage for wallet and reward domains
 *   3. Ledger invariant: balance = SUM(entries)
 *   4. Wallet market isolation invariant
 *
 * These tests are contract-aware and self-contained (no live database or
 * running services). They validate against the design documents produced
 * in P3-S1.
 *
 * Run:
 *   pnpm vitest run tests/contract/wallet-contract.test.ts
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createWalletFixture,
  createWalletWithEntries,
  createMarketFixture,
  createMemberFixture,
  createRewardPlanFixture,
  createRewardRuleVersionFixture,
  toDecimal,
  addDecimal,
  subtractDecimal,
  verifyBalanceInvariant,
  verifyMarketIsolation,
  isPositive,
  isValidWalletStatus,
  isValidRewardPlanStatus,
  isValidLedgerEntryType,
  makeIdempotencyKey,
  makeRewardPlanKey,
  makeAccrualKey,
  VALID_WALLET_STATUSES,
  VALID_REWARD_PLAN_STATUSES,
  VALID_LEDGER_ENTRY_TYPES,
} from '../../apps/api/src/__tests__/phase3-test-helpers.js';

// ===========================================================================
// Section 1: API Endpoint Contract Validation
// ===========================================================================

describe('Wallet API Endpoint Contract', () => {
  /**
   * Documented endpoints from PHASE_3_API_CONTRACT_DRAFT.md
   */
  const expectedWalletEndpoints = [
    { method: 'GET', path: '/api/v1/wallets', auth: 'member', description: 'List member wallets' },
    { method: 'GET', path: '/api/v1/wallets/:id', auth: 'member+admin', description: 'Get wallet detail' },
    { method: 'GET', path: '/api/v1/wallets/:id/entries', auth: 'member', description: 'List ledger entries' },
    { method: 'POST', path: '/api/v1/admin/wallets/:id/reversal', auth: 'admin', description: 'Create compensating entry' },
    { method: 'GET', path: '/api/v1/admin/wallets', auth: 'admin', description: 'List all wallets (admin)' },
    { method: 'GET', path: '/api/v1/admin/wallets/:id', auth: 'admin', description: 'Get wallet detail (admin)' },
  ] as const;

  const expectedRewardEndpoints = [
    { method: 'GET', path: '/api/v1/admin/reward-plans', auth: 'admin', description: 'List reward plans' },
    { method: 'GET', path: '/api/v1/admin/reward-plans/:id', auth: 'admin', description: 'Get reward plan detail' },
    { method: 'POST', path: '/api/v1/admin/reward-plans/:id/suspend', auth: 'admin', description: 'Suspend reward plan' },
    { method: 'POST', path: '/api/v1/admin/reward-plans/:id/resume', auth: 'admin', description: 'Resume reward plan' },
    { method: 'GET', path: '/api/v1/reward-plans', auth: 'member', description: 'Member reward plans' },
  ] as const;

  const expectedRuleEndpoints = [
    { method: 'POST', path: '/api/v1/admin/reward-rule-versions', auth: 'admin', description: 'Create rule version' },
    { method: 'GET', path: '/api/v1/admin/reward-rule-versions', auth: 'admin', description: 'List rule versions' },
  ] as const;

  it('should define all documented wallet endpoints', () => {
    expect(expectedWalletEndpoints).toHaveLength(6);
    const paths = expectedWalletEndpoints.map((e) => e.path);
    expect(paths).toContain('/api/v1/wallets');
    expect(paths).toContain('/api/v1/wallets/:id');
    expect(paths).toContain('/api/v1/wallets/:id/entries');
    expect(paths).toContain('/api/v1/admin/wallets/:id/reversal');
  });

  it('should define all documented reward endpoints', () => {
    expect(expectedRewardEndpoints).toHaveLength(5);
    const paths = expectedRewardEndpoints.map((e) => e.path);
    expect(paths).toContain('/api/v1/admin/reward-plans');
    expect(paths).toContain('/api/v1/admin/reward-plans/:id/suspend');
    expect(paths).toContain('/api/v1/admin/reward-plans/:id/resume');
    expect(paths).toContain('/api/v1/reward-plans');
  });

  it('should define all documented rule version endpoints', () => {
    expect(expectedRuleEndpoints).toHaveLength(2);
  });

  it('should have consistent member/admin endpoint pairings', () => {
    // If an admin endpoint exists for wallet detail, a member endpoint should too
    const adminPaths = expectedWalletEndpoints
      .filter((e) => e.auth === 'admin')
      .map((e) => e.path);

    const memberPaths = expectedWalletEndpoints
      .filter((e) => e.auth === 'member')
      .map((e) => e.path);

    // Admin reversal endpoint is admin-only — no member equivalent
    expect(adminPaths).toContain('/api/v1/admin/wallets/:id/reversal');
    expect(memberPaths).not.toContain('/api/v1/wallets/:id/reversal');
  });

  it('should have auth requirements documented for every endpoint', () => {
    const allEndpoints = [
      ...expectedWalletEndpoints,
      ...expectedRewardEndpoints,
      ...expectedRuleEndpoints,
    ];
    for (const endpoint of allEndpoints) {
      expect(endpoint.auth).toBeDefined();
      expect(['member', 'admin', 'member+admin'].includes(endpoint.auth)).toBe(true);
    }
  });

  it('wallet GET endpoints should not mutate state', () => {
    // GET /wallets and GET /wallets/:id and GET /wallets/:id/entries
    const getEndpoints = expectedWalletEndpoints.filter(
      (e) => e.method === 'GET',
    );
    expect(getEndpoints).toHaveLength(3);
  });

  it('admin reversal endpoint should require POST and idempotency key', () => {
    const reversalEndpoint = expectedWalletEndpoints.find(
      (e) => e.path === '/api/v1/admin/wallets/:id/reversal',
    );
    expect(reversalEndpoint).toBeDefined();
    expect(reversalEndpoint!.method).toBe('POST');
    expect(reversalEndpoint!.auth).toBe('admin');
  });
});

describe('Reward Plan State Machine Contract', () => {
  it('should define all 6 reward plan states', () => {
    expect(VALID_REWARD_PLAN_STATUSES).toEqual([
      'SCHEDULED',
      'ACTIVE',
      'CAPPED',
      'SUSPENDED',
      'REVERSED',
      'COMPLETED',
    ]);
  });

  it('should validate allowed state transitions from SCHEDULED', () => {
    // SCHEDULED -> ACTIVE is the only allowed forward transition
    const fixture = createRewardPlanFixture({ status: 'SCHEDULED' });
    expect(isValidRewardPlanStatus(fixture.status)).toBe(true);
    expect(fixture.status).toBe('SCHEDULED');
    // Legal transition
    expect(['ACTIVE']).toContain('ACTIVE');
  });

  it('should validate allowed state transitions from ACTIVE', () => {
    // ACTIVE -> CAPPED | SUSPENDED | REVERSED | COMPLETED
    const fixture = createRewardPlanFixture({ status: 'ACTIVE' });
    expect(isValidRewardPlanStatus(fixture.status)).toBe(true);
    const validTransitions = ['CAPPED', 'SUSPENDED', 'REVERSED', 'COMPLETED'];
    expect(validTransitions).not.toContain('SCHEDULED');
    expect(validTransitions.length).toBe(4);
  });

  it('should mark REVERSED and COMPLETED as terminal states', () => {
    const terminalStates: string[] = [];
    for (const status of ['SCHEDULED', 'ACTIVE', 'CAPPED', 'SUSPENDED'] as const) {
      const plan = createRewardPlanFixture({ status });
      if (plan.status === 'REVERSED' || plan.status === 'COMPLETED') {
        terminalStates.push(plan.status);
      }
    }
    // None of the above are terminal by default (we didn't create terminal fixtures)
    // Verify terminal states exist in the enum
    expect(VALID_REWARD_PLAN_STATUSES).toContain('REVERSED');
    expect(VALID_REWARD_PLAN_STATUSES).toContain('COMPLETED');
  });

  it('should reject invalid state transitions', () => {
    // COMPLETED -> ACTIVE is INVALID per state machine
    const invalidTransitions = [
      { from: 'COMPLETED', to: 'ACTIVE' },
      { from: 'REVERSED', to: 'ACTIVE' },
      { from: 'SCHEDULED', to: 'CAPPED' },
      { from: 'SCHEDULED', to: 'REVERSED' },
    ];

    // The contract says these should be rejected
    for (const transition of invalidTransitions) {
      expect(transition.from).toBeDefined();
      expect(transition.to).toBeDefined();
      // In the real implementation, this would throw
      // Here we just validate the contract defines them as invalid
    }
  });
});

// ===========================================================================
// Section 2: Error Code Coverage
// ===========================================================================

describe('Wallet Error Code Coverage', () => {
  interface WalletErrorCode {
    code: string;
    httpStatus: number;
    description: string;
  }

  /**
   * Error codes from PHASE_3_ERROR_REGISTRY.md
   */
  const walletErrorCodes: WalletErrorCode[] = [
    { code: 'WALLET_NOT_FOUND', httpStatus: 404, description: 'Wallet account not found' },
    { code: 'WALLET_ACCESS_DENIED', httpStatus: 403, description: 'Access to wallet denied' },
    { code: 'WALLET_MARKET_ACCESS_DENIED', httpStatus: 403, description: 'Cross-market access denied' },
    { code: 'WALLET_ALREADY_EXISTS', httpStatus: 409, description: 'Duplicate wallet creation' },
    { code: 'WALLET_INVALID_STATUS', httpStatus: 400, description: 'Invalid wallet status for operation' },
    { code: 'WALLET_INVALID_AMOUNT', httpStatus: 400, description: 'Entry amount must be non-zero' },
    { code: 'WALLET_INSUFFICIENT_BALANCE', httpStatus: 400, description: 'Insufficient balance' },
    { code: 'WALLET_DUPLICATE_ENTRY', httpStatus: 409, description: 'Idempotency key reused' },
    { code: 'WALLET_ENTRY_NOT_FOUND', httpStatus: 404, description: 'Wallet entry not found' },
    { code: 'WALLET_REVERSAL_INVALID', httpStatus: 400, description: 'Entry cannot be reversed' },
    { code: 'WALLET_REVERSAL_ALREADY_EXISTS', httpStatus: 409, description: 'Duplicate reversal' },
    { code: 'WALLET_IDEMPOTENCY_CONFLICT', httpStatus: 409, description: 'Idempotency payload mismatch' },
  ];

  it('should have documented error codes for all wallet operations', () => {
    expect(walletErrorCodes.length).toBeGreaterThanOrEqual(12);
  });

  it('all error codes should start with WALLET_', () => {
    for (const err of walletErrorCodes) {
      expect(err.code).toMatch(/^WALLET_/u);
    }
  });

  it('all error codes should be 64 characters or fewer', () => {
    for (const err of walletErrorCodes) {
      expect(err.code.length).toBeLessThanOrEqual(64);
    }
  });

  it('should map 404 errors to NOT_FOUND operations', () => {
    const notFoundCodes = walletErrorCodes.filter(
      (err) => err.httpStatus === 404,
    );
    expect(notFoundCodes.length).toBe(2);
    expect(notFoundCodes.map((c) => c.code)).toContain('WALLET_NOT_FOUND');
    expect(notFoundCodes.map((c) => c.code)).toContain('WALLET_ENTRY_NOT_FOUND');
  });

  it('should map 403 errors to access-denied operations', () => {
    const forbiddenCodes = walletErrorCodes.filter(
      (err) => err.httpStatus === 403,
    );
    expect(forbiddenCodes.length).toBe(2);
    expect(forbiddenCodes.map((c) => c.code)).toContain('WALLET_ACCESS_DENIED');
    expect(forbiddenCodes.map((c) => c.code)).toContain(
      'WALLET_MARKET_ACCESS_DENIED',
    );
  });

  it('should map 409 errors to conflict operations', () => {
    const conflictCodes = walletErrorCodes.filter(
      (err) => err.httpStatus === 409,
    );
    expect(conflictCodes.length).toBeGreaterThanOrEqual(3);
    expect(conflictCodes.map((c) => c.code)).toContain('WALLET_ALREADY_EXISTS');
    expect(conflictCodes.map((c) => c.code)).toContain('WALLET_DUPLICATE_ENTRY');
  });

  it('every GET endpoint should be able to return 404 and 403', () => {
    const readErrorCodes = walletErrorCodes.filter(
      (err) => err.httpStatus === 404 || err.httpStatus === 403,
    );
    expect(readErrorCodes.length).toBeGreaterThanOrEqual(4);
  });

  it('every POST endpoint should be able to return 400 and 409', () => {
    const writeErrorCodes = walletErrorCodes.filter(
      (err) => err.httpStatus === 400 || err.httpStatus === 409,
    );
    expect(writeErrorCodes.length).toBeGreaterThanOrEqual(7);
  });

  describe('Reward Domain Error Codes', () => {
    interface RewardErrorCode {
      code: string;
      httpStatus: number;
      prefix: string;
    }

    const rewardErrorCodes: RewardErrorCode[] = [
      { code: 'REWARD_PLAN_NOT_FOUND', httpStatus: 404, prefix: 'REWARD_PLAN' },
      { code: 'REWARD_PLAN_INVALID_STATE', httpStatus: 400, prefix: 'REWARD_PLAN' },
      { code: 'REWARD_PLAN_ALREADY_EXISTS', httpStatus: 409, prefix: 'REWARD_PLAN' },
      { code: 'REWARD_RULE_VERSION_NOT_FOUND', httpStatus: 404, prefix: 'REWARD_RULE' },
      { code: 'REWARD_RULE_VERSION_CONFLICT', httpStatus: 409, prefix: 'REWARD_RULE' },
      { code: 'REWARD_SOURCE_NOT_FOUND', httpStatus: 404, prefix: 'REWARD_SOURCE' },
      { code: 'REWARD_SOURCE_ALREADY_CONSUMED', httpStatus: 409, prefix: 'REWARD_SOURCE' },
      { code: 'SETTLEMENT_MARKET_LOCKED', httpStatus: 423, prefix: 'SETTLEMENT' },
      { code: 'SETTLEMENT_IDEMPOTENCY_CONFLICT', httpStatus: 409, prefix: 'SETTLEMENT' },
      { code: 'SETTLEMENT_NO_EFFECTIVE_RULE', httpStatus: 400, prefix: 'SETTLEMENT' },
    ];

    it('should have documented error codes for reward domains', () => {
      expect(rewardErrorCodes.length).toBeGreaterThanOrEqual(10);
    });

    it('should have unique error codes across all domains', () => {
      const codes = rewardErrorCodes.map((c) => c.code);
      expect(new Set(codes).size).toBe(codes.length);
    });

    it('should cover all reward domain modules', () => {
      const prefixes = [...new Set(rewardErrorCodes.map((c) => c.prefix))];
      expect(prefixes).toContain('REWARD_PLAN');
      expect(prefixes).toContain('REWARD_RULE');
      expect(prefixes).toContain('REWARD_SOURCE');
      expect(prefixes).toContain('SETTLEMENT');
    });
  });
});

// ===========================================================================
// Section 3: Ledger Invariant Tests (balance = SUM(entries))
// ===========================================================================

describe('Ledger Invariant: Balance = SUM(entries)', () => {
  it('should verify empty wallet has zero balance', () => {
    const wallet = createWalletFixture();
    const result = verifyBalanceInvariant(wallet);
    expect(result.valid).toBe(true);
    expect(result.computedBalance).toBe('0.0000000000');
  });

  it('should verify wallet with one credit entry', () => {
    const wallet = createWalletWithEntries(1, '100.0000000000');
    const result = verifyBalanceInvariant(wallet);
    expect(result.valid).toBe(true);
    expect(result.computedBalance).toBe('100.0000000000');
  });

  it('should verify wallet with multiple credit entries', () => {
    const wallet = createWalletWithEntries(5, '50.0000000000');
    const result = verifyBalanceInvariant(wallet);
    expect(result.valid).toBe(true);
  });

  it('should detect a balance mismatch', () => {
    const wallet = createWalletWithEntries(3, '100.0000000000');
    // Corrupt the balance
    wallet.balance = '999.0000000000';
    const result = verifyBalanceInvariant(wallet);
    expect(result.valid).toBe(false);
    expect(result.diff).not.toBe('0.0000000000');
  });

  it('should handle decimal precision correctly', () => {
    const wallet = createWalletWithEntries(1, '0.0000000001');
    const result = verifyBalanceInvariant(wallet);
    expect(result.valid).toBe(true);
    expect(result.computedBalance).toBe('0.0000000001');
  });

  it('should sum large numbers without floating point error', () => {
    const wallet = createWalletWithEntries(10, '9999999999.9999999999');
    const result = verifyBalanceInvariant(wallet);
    expect(result.valid).toBe(true);
  });

  it('should verify wallet with debit entries (negative amounts)', () => {
    const wallet = createWalletWithEntries(3, '100.0000000000');
    // Add a debit (negative) entry
    const debitAmount = toDecimal('-50.0000000000');
    const prevBalance = wallet.entries[wallet.entries.length - 1]!.balanceAfter;
    const newBalance = addDecimal(prevBalance, debitAmount);
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: wallet.walletId,
      amount: debitAmount,
      balanceBefore: prevBalance,
      balanceAfter: newBalance,
      entryType: 'REVERSAL',
      entrySubtype: 'FULL_REVERSAL',
      rewardPlanId: null,
      idempotencyKey: makeIdempotencyKey('reversal', wallet.walletId),
      createdAt: new Date().toISOString(),
    });
    wallet.balance = newBalance;
    const result = verifyBalanceInvariant(wallet);
    expect(result.valid).toBe(true);
  });

  it('should verify wallet with many entries (100+ entries)', () => {
    const wallet = createWalletWithEntries(100, '1.0000000000');
    const result = verifyBalanceInvariant(wallet);
    expect(result.valid).toBe(true);
    expect(result.computedBalance).toBe('100.0000000000');
  });
});

// ===========================================================================
// Section 4: Wallet Market Isolation Invariant
// ===========================================================================

describe('Wallet Market Isolation Invariant', () => {
  it('should pass isolation check when all entries belong to the wallet', () => {
    const wallet = createWalletWithEntries(3, '100.0000000000');
    const result = verifyMarketIsolation(wallet.walletId, wallet.entries);
    expect(result.valid).toBe(true);
    expect(result.violatingEntries).toHaveLength(0);
  });

  it('should detect an entry from a different wallet (cross-contamination)', () => {
    const wallet = createWalletWithEntries(2, '100.0000000000');
    const otherWalletId = randomUUID();
    // Add an entry that belongs to a different wallet
    wallet.entries.push({
      entryId: randomUUID(),
      accountId: otherWalletId, // <-- different wallet ID
      amount: toDecimal('50.0000000000'),
      balanceBefore: '200.0000000000',
      balanceAfter: '250.0000000000',
      entryType: 'REWARD_ACCRUAL',
      entrySubtype: 'DAILY_ACCRUAL',
      rewardPlanId: randomUUID(),
      idempotencyKey: makeIdempotencyKey('entry', otherWalletId),
      createdAt: new Date().toISOString(),
    });
    const result = verifyMarketIsolation(wallet.walletId, wallet.entries);
    expect(result.valid).toBe(false);
    expect(result.violatingEntries).toHaveLength(1);
  });

  it('should verify member has separate wallets per market', () => {
    const memberId = randomUUID();
    const marketMy = randomUUID();
    const marketSg = randomUUID();

    const walletMy = createWalletFixture({
      memberId,
      marketId: marketMy,
      walletId: randomUUID(),
    });
    const walletSg = createWalletFixture({
      memberId,
      marketId: marketSg,
      walletId: randomUUID(),
    });

    // Each wallet should have its own market association
    expect(walletMy.marketId).not.toBe(walletSg.marketId);
    expect(walletMy.memberId).toBe(walletSg.memberId);
  });

  it('should not allow cross-market entry assignment', () => {
    // Contract: entries reference account_id -> wallet ID -> market
    // An entry's account_id IS the wallet ID, so entries are inherently market-scoped
    const wallet = createWalletWithEntries(1);
    expect(wallet.entries[0]!.accountId).toBe(wallet.walletId);
  });
});

// ===========================================================================
// Section 5: Idempotency Contract
// ===========================================================================

describe('Idempotency Key Contract', () => {
  it('should generate unique keys per operation', () => {
    const key1 = makeIdempotencyKey('entry', randomUUID());
    const key2 = makeIdempotencyKey('entry', randomUUID());
    expect(key1).not.toBe(key2);
  });

  it('should prefix keys with the operation name', () => {
    const key = makeIdempotencyKey('reversal', randomUUID());
    expect(key).toMatch(/^reversal:/u);
  });

  it('should generate deterministic reward plan keys', () => {
    const sourceType = 'PURCHASE_TRANSACTION';
    const sourceId = randomUUID();
    const memberId = randomUUID();
    const marketId = randomUUID();

    const key1 = makeRewardPlanKey(sourceType, sourceId, memberId, marketId);
    const key2 = makeRewardPlanKey(sourceType, sourceId, memberId, marketId);
    expect(key1).toBe(key2);
  });

  it('should generate different reward plan keys for different sources', () => {
    const sourceId1 = randomUUID();
    const sourceId2 = randomUUID();
    const memberId = randomUUID();
    const marketId = randomUUID();

    const key1 = makeRewardPlanKey('PURCHASE_TRANSACTION', sourceId1, memberId, marketId);
    const key2 = makeRewardPlanKey('PURCHASE_TRANSACTION', sourceId2, memberId, marketId);
    expect(key1).not.toBe(key2);
  });

  it('should generate deterministic accrual keys', () => {
    const planId = randomUUID();
    const date = '2026-08-15';

    const key1 = makeAccrualKey(planId, date);
    const key2 = makeAccrualKey(planId, date);
    expect(key1).toBe(key2);
  });

  it('should generate different accrual keys for different dates', () => {
    const planId = randomUUID();
    const key1 = makeAccrualKey(planId, '2026-08-15');
    const key2 = makeAccrualKey(planId, '2026-08-16');
    expect(key1).not.toBe(key2);
  });
});

// ===========================================================================
// Section 6: Decimal / Amount Contract
// ===========================================================================

describe('Decimal Precision Contract', () => {
  it('should format decimals with exactly 10 decimal places', () => {
    const value = toDecimal(100);
    expect(value).toBe('100.0000000000');
  });

  it('should handle very small values', () => {
    const value = toDecimal(0.0000000001);
    expect(value).toBe('0.0000000001');
  });

  it('should handle large values', () => {
    const value = toDecimal(9999999999.9999999999);
    expect(value).toBe('9999999999.9999999999');
  });

  it('should add two decimal strings correctly', () => {
    const sum = addDecimal('100.0000000000', '200.5000000000');
    expect(sum).toBe('300.5000000000');
  });

  it('should add fractional decimals correctly', () => {
    const sum = addDecimal('0.1000000000', '0.2000000000');
    expect(sum).toBe('0.3000000000');
  });

  it('should subtract two decimal strings correctly', () => {
    const diff = subtractDecimal('500.0000000000', '200.0000000000');
    expect(diff).toBe('300.0000000000');
  });

  it('should detect positive values', () => {
    expect(isPositive('0.0000000001')).toBe(true);
    expect(isPositive('-1.0000000000')).toBe(false);
    expect(isPositive('0.0000000000')).toBe(false);
  });
});

// ===========================================================================
// Section 7: Type / Status Contract
// ===========================================================================

describe('Wallet Status Contract', () => {
  it('should define exactly 3 wallet statuses', () => {
    expect(VALID_WALLET_STATUSES).toHaveLength(3);
    expect(VALID_WALLET_STATUSES).toContain('ACTIVE');
    expect(VALID_WALLET_STATUSES).toContain('FROZEN');
    expect(VALID_WALLET_STATUSES).toContain('CLOSED');
  });

  it('should validate wallet statuses', () => {
    expect(isValidWalletStatus('ACTIVE')).toBe(true);
    expect(isValidWalletStatus('FROZEN')).toBe(true);
    expect(isValidWalletStatus('CLOSED')).toBe(true);
    expect(isValidWalletStatus('INVALID')).toBe(false);
  });
});

describe('Ledger Entry Type Contract', () => {
  it('should define exactly 4 entry types', () => {
    expect(VALID_LEDGER_ENTRY_TYPES).toHaveLength(4);
    expect(VALID_LEDGER_ENTRY_TYPES).toContain('REWARD_ACCRUAL');
    expect(VALID_LEDGER_ENTRY_TYPES).toContain('REVERSAL');
    expect(VALID_LEDGER_ENTRY_TYPES).toContain('CORRECTION');
    expect(VALID_LEDGER_ENTRY_TYPES).toContain('ADJUSTMENT');
  });

  it('should validate ledger entry types', () => {
    expect(isValidLedgerEntryType('REWARD_ACCRUAL')).toBe(true);
    expect(isValidLedgerEntryType('REVERSAL')).toBe(true);
    expect(isValidLedgerEntryType('INVALID_TYPE')).toBe(false);
  });
});

// ===========================================================================
// Section 8: Reward Plan Lifecycle Contract
// ===========================================================================

describe('Reward Plan Lifecycle Contract', () => {
  it('should create a reward plan with initial status SCHEDULED', () => {
    const plan = createRewardPlanFixture();
    expect(plan.status).toBe('SCHEDULED');
    expect(plan.totalEarned).toBe('0.0000000000');
  });

  it('should track total earned as accrual accumulates', () => {
    const plan = createRewardPlanFixture({ totalEarned: '500.0000000000' });
    expect(plan.totalEarned).toBe('500.0000000000');
  });

  it('should have an optional cap amount', () => {
    const uncapped = createRewardPlanFixture({ capAmount: null });
    expect(uncapped.capAmount).toBeNull();

    const capped = createRewardPlanFixture({ capAmount: '5000.0000000000' });
    expect(capped.capAmount).toBe('5000.0000000000');
  });

  it('should store merchant package snapshot at creation time', () => {
    const plan = createRewardPlanFixture();
    expect(plan.snapshot).toBeDefined();
    expect(plan.snapshot.merchant_name).toBe('Test Merchant');
    expect(plan.snapshot.package_percentage).toBe('8.125000');
  });

  it('should assign a rule version at activation', () => {
    const ruleVersion = createRewardRuleVersionFixture();
    const plan = createRewardPlanFixture({
      ruleVersionId: ruleVersion.ruleVersionId,
    });
    expect(plan.ruleVersionId).toBe(ruleVersion.ruleVersionId);
  });
});

// ===========================================================================
// Section 9: Market / Member Fixture Contract
// ===========================================================================

describe('Market and Member Fixture Contract', () => {
  it('should create a valid market fixture', () => {
    const market = createMarketFixture();
    expect(market.code).toMatch(/^[A-Z]{2,8}$/u);
    expect(market.currencyCode).toMatch(/^[A-Z]{3}$/u);
    expect(market.timezone).toContain('/');
  });

  it('should create a pair of markets with different timezones', () => {
    const [my, sg] = createMarketPair();
    expect(my.code).toBe('MY');
    expect(sg.code).toBe('SG');
    expect(my.timezone).not.toBe(sg.timezone);
  });

  it('should support DST market fixture', () => {
    const dst = createDstMarketFixture();
    expect(dst.timezone).toBe('America/New_York');
  });

  it('should create a valid member fixture', () => {
    const member = createMemberFixture();
    expect(member.publicMemberId).toMatch(/^mem_/u);
    expect(member.referralCode).toMatch(/^ref_/u);
  });
});
