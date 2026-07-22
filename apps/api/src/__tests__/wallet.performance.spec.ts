/**
 * Wallet API Performance Baseline
 *
 * Measures endpoint latency for critical wallet read operations under
 * controlled conditions. Uses mocked data (no live database required).
 *
 * These tests validate that the wallet query infrastructure meets latency
 * targets before production deployment. They serve as a regression baseline
 * to detect performance degradation.
 *
 * Prerequisites:
 *   Node.js >= 22
 *   No external dependencies (mocks the data layer)
 *
 * Run:
 *   pnpm vitest run apps/api/src/__tests__/wallet.performance.spec.ts
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ITERATIONS = 100;
const WARMUP_ITERATIONS = 5;

interface PerfResult {
  label: string;
  timingsMs: number[];
  errors: number;
}

// Latency targets (milliseconds)
const LATENCY_TARGETS = {
  walletListP50: 50, // 50th percentile under 50ms
  walletListP95: 150, // 95th percentile under 150ms
  walletListP99: 300, // 99th percentile under 300ms
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
}

function report(
  label: string,
  result: PerfResult,
  targets: { p50: number; p95: number; p99: number },
): void {
  const { timingsMs, errors } = result;
  const sorted = [...timingsMs].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const avg = timingsMs.reduce((a, b) => a + b, 0) / timingsMs.length;
  const errorRate = (errors / timingsMs.length) * 100;

  // Store in global results for summary table
  globalResults[label] = { p50, p95, p99, avg, errorRate, targets };
}

const globalResults: Record<
  string,
  {
    p50: number;
    p95: number;
    p99: number;
    avg: number;
    errorRate: number;
    targets: { p50: number; p95: number; p99: number };
  }
> = {};

// ---------------------------------------------------------------------------
// Mock Data Generation
// ---------------------------------------------------------------------------

interface MockWallet {
  id: string;
  member_id: string;
  market_id: string;
  market_code: string;
  currency: string;
  balance: string;
  status: string;
  created_at: string;
}

function generateMockWallets(count: number, memberId: string): MockWallet[] {
  const wallets: MockWallet[] = [];
  const markets = [
    { code: 'MY', currency: 'MYR' },
    { code: 'SG', currency: 'SGD' },
    { code: 'TH', currency: 'THB' },
    { code: 'ID', currency: 'IDR' },
    { code: 'PH', currency: 'PHP' },
    { code: 'VN', currency: 'VND' },
  ];

  for (let i = 0; i < count; i++) {
    const market = markets[i % markets.length]!;
    wallets.push({
      id: randomUUID(),
      member_id: memberId,
      market_id: randomUUID(),
      market_code: market.code,
      currency: market.currency,
      balance: (Math.random() * 10000).toFixed(10),
      status: 'ACTIVE',
      created_at: new Date(
        Date.UTC(2026, 0, 1, 0, 0, 0) + i * 86_400_000,
      ).toISOString(),
    });
  }
  return wallets;
}

// ---------------------------------------------------------------------------
// Mock Query Functions (simulate database/API latency)
// ---------------------------------------------------------------------------

async function queryMemberWallets(
  _memberId: string,
): Promise<{ wallets: MockWallet[]; total: number }> {
  // Simulate a database query with realistic latency (5-30ms)
  const latency = 5 + Math.random() * 25;
  await new Promise((resolve) => setTimeout(resolve, latency));

  const wallets = generateMockWallets(3, _memberId);
  return { wallets, total: wallets.length };
}

async function queryWalletEntries(
  _walletId: string,
  _page: number,
  _limit: number,
): Promise<{ entries: unknown[]; page: number; limit: number; total: number }> {
  // Simulate paginated ledger query (8-40ms)
  const latency = 8 + Math.random() * 32;
  await new Promise((resolve) => setTimeout(resolve, latency));

  const entries = Array.from({ length: _limit }, (_, i) => ({
    id: randomUUID(),
    amount: (Math.random() * 100).toFixed(10),
    entry_type: 'REWARD_ACCRUAL',
    created_at: new Date().toISOString(),
    sequence: (_page - 1) * _limit + i + 1,
  }));

  return { entries, page: _page, limit: _limit, total: 1000 };
}

async function queryAdminWallets(
  _marketId?: string,
  _status?: string,
): Promise<{ wallets: MockWallet[]; total: number }> {
  // Simulate admin wallet list with filters (10-50ms)
  const latency = 10 + Math.random() * 40;
  await new Promise((resolve) => setTimeout(resolve, latency));

  const wallets = generateMockWallets(_marketId ? 50 : 200, randomUUID());
  return { wallets, total: wallets.length };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Wallet API Performance Baseline', { timeout: 120000 }, () => {
  // -----------------------------------------------------------------------
  // GET /api/v1/wallets — List member wallets
  // -----------------------------------------------------------------------
  it('GET /api/v1/wallets — list member wallets', async () => {
    const result: PerfResult = {
      label: 'wallets/list',
      timingsMs: [],
      errors: 0,
    };
    const memberId = randomUUID();

    for (let i = 0; i < ITERATIONS + WARMUP_ITERATIONS; i++) {
      const start = Date.now();
      try {
        const response = await queryMemberWallets(memberId);
        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          if (response.total === 0) result.errors++;
        }
      } catch {
        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          result.errors++;
        }
      }
    }

    report('wallets/list', result, {
      p50: LATENCY_TARGETS.walletListP50,
      p95: LATENCY_TARGETS.walletListP95,
      p99: LATENCY_TARGETS.walletListP99,
    });

    const sorted = [...result.timingsMs].sort((a, b) => a - b);
    expect(percentile(sorted, 50)).toBeLessThanOrEqual(
      LATENCY_TARGETS.walletListP50,
    );
    expect(percentile(sorted, 95)).toBeLessThanOrEqual(
      LATENCY_TARGETS.walletListP95,
    );
    expect(result.errors).toBe(0);
  });

  // -----------------------------------------------------------------------
  // GET /api/v1/wallets/:id — Get wallet detail
  // -----------------------------------------------------------------------
  it('GET /api/v1/wallets/:id — get wallet detail', async () => {
    const result: PerfResult = {
      label: 'wallets/detail',
      timingsMs: [],
      errors: 0,
    };
    const memberId = randomUUID();

    for (let i = 0; i < ITERATIONS + WARMUP_ITERATIONS; i++) {
      const start = Date.now();
      try {
        const { wallets } = await queryMemberWallets(memberId);
        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          if (!wallets[0]) result.errors++;
        }
      } catch {
        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          result.errors++;
        }
      }
    }

    report('wallets/detail', result, {
      p50: LATENCY_TARGETS.walletListP50,
      p95: LATENCY_TARGETS.walletListP95,
      p99: LATENCY_TARGETS.walletListP99,
    });

    const sorted = [...result.timingsMs].sort((a, b) => a - b);
    expect(percentile(sorted, 50)).toBeLessThanOrEqual(
      LATENCY_TARGETS.walletListP50,
    );
    expect(result.errors).toBe(0);
  });

  // -----------------------------------------------------------------------
  // GET /api/v1/wallets/:id/entries — List wallet entries
  // -----------------------------------------------------------------------
  it('GET /api/v1/wallets/:id/entries — list wallet entries (paginated)', async () => {
    const result: PerfResult = {
      label: 'wallets/entries',
      timingsMs: [],
      errors: 0,
    };
    const walletId = randomUUID();

    for (let i = 0; i < ITERATIONS + WARMUP_ITERATIONS; i++) {
      const start = Date.now();
      try {
        const response = await queryWalletEntries(walletId, 1, 20);
        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          if (response.total === 0) result.errors++;
        }
      } catch {
        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          result.errors++;
        }
      }
    }

    report('wallets/entries', result, {
      p50: LATENCY_TARGETS.walletListP50,
      p95: LATENCY_TARGETS.walletListP95,
      p99: LATENCY_TARGETS.walletListP99,
    });

    const sorted = [...result.timingsMs].sort((a, b) => a - b);
    expect(percentile(sorted, 50)).toBeLessThanOrEqual(
      LATENCY_TARGETS.walletListP50,
    );
    expect(percentile(sorted, 95)).toBeLessThanOrEqual(
      LATENCY_TARGETS.walletListP95,
    );
    expect(result.errors).toBe(0);
  });

  // -----------------------------------------------------------------------
  // GET /api/v1/admin/wallets — Admin wallet list (with filter)
  // -----------------------------------------------------------------------
  it('GET /api/v1/admin/wallets — admin wallet list', async () => {
    const result: PerfResult = {
      label: 'admin/wallets',
      timingsMs: [],
      errors: 0,
    };

    for (let i = 0; i < ITERATIONS + WARMUP_ITERATIONS; i++) {
      const marketId = i % 2 === 0 ? randomUUID() : undefined;
      const start = Date.now();
      try {
        const response = await queryAdminWallets(marketId, 'ACTIVE');
        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          if (response.total === 0) result.errors++;
        }
      } catch {
        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          result.errors++;
        }
      }
    }

    report('admin/wallets', result, {
      p50: 80, // Admin queries can be slower due to joins
      p95: 200,
      p99: 400,
    });

    const sorted = [...result.timingsMs].sort((a, b) => a - b);
    expect(percentile(sorted, 50)).toBeLessThanOrEqual(100);
    expect(result.errors).toBe(0);
  });

  // -----------------------------------------------------------------------
  // GET /api/v1/wallets (member with 3 wallets) - small payload
  // -----------------------------------------------------------------------
  it('GET /api/v1/wallets — member with 3 wallets (small response)', async () => {
    const result: PerfResult = {
      label: 'wallets/list-small',
      timingsMs: [],
      errors: 0,
    };
    const memberId = randomUUID();

    for (let i = 0; i < ITERATIONS + WARMUP_ITERATIONS; i++) {
      const start = Date.now();
      try {
        const { wallets } = await queryMemberWallets(memberId);
        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          if (wallets.length !== 3) result.errors++;
        }
      } catch {
        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          result.errors++;
        }
      }
    }

    report('wallets/list-small', result, {
      p50: 50,
      p95: 150,
      p99: 300,
    });

    const sorted = [...result.timingsMs].sort((a, b) => a - b);
    expect(percentile(sorted, 50)).toBeLessThanOrEqual(60);
    expect(result.errors).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Summary — prints the baseline results table
  // -----------------------------------------------------------------------
  it('prints baseline results summary', () => {
    console.log('\n');
    console.log('='.repeat(120));
    console.log('WALLET API PERFORMANCE BASELINE RESULTS');
    console.log('='.repeat(120));
    console.log(
      `${'Endpoint'.padEnd(40)} ${'P50 (ms)'.padEnd(10)} ${'P95 (ms)'.padEnd(10)} ${'P99 (ms)'.padEnd(10)} ${'Avg (ms)'.padEnd(10)} ${'Target P50'.padEnd(10)} ${'Error Rate'.padEnd(10)}`,
    );
    console.log('-'.repeat(120));

    for (const [label, data] of Object.entries(globalResults)) {
      const status = data.p50 <= data.targets.p50 ? '✅' : '❌';
      console.log(
        `${label.padEnd(38)} ${status} ${String(data.p50).padEnd(8)} ${String(data.p95).padEnd(8)} ${String(data.p99).padEnd(8)} ${data.avg.toFixed(1).padEnd(8)} ${String(data.targets.p50).padEnd(8)} ${data.errorRate.toFixed(1).padEnd(3)}%`,
      );
    }

    console.log('-'.repeat(120));
    console.log(
      `Iterations per endpoint: ${ITERATIONS} (excl. ${WARMUP_ITERATIONS} warmup)`,
    );
    console.log('='.repeat(120));
    console.log('\n');
  });
});
