/**
 * Auth API Performance Baseline
 *
 * Measures endpoint latency for critical auth flows under controlled conditions.
 * Uses a real PostgreSQL test database; mocks external email/SMS providers.
 *
 * Prerequisites:
 *   DATABASE_URL=postgresql://ipoint_test:ipoint_test@127.0.0.1:55440/ipoint_database_test
 *
 * Run:
 *   pnpm vitest run apps/api/src/__tests__/auth.performance.spec.ts
 */

import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { migrate } from '@ipoint/database';
import type { Server } from 'node:http';
import supertest from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';
import { AUTH_RATE_LIMITER } from '../auth/auth.constants.js';
import type { InMemoryRateLimiter } from '../auth/rate-limit.port.js';
import { DatabaseService } from '../database/database.service.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const databaseUrl = process.env['DATABASE_URL'];
const ITERATIONS = 50;
const WARMUP_ITERATIONS = 3;
const ALLOWED_FAILURE_RATE_PCT = 5;

interface EndpointResult {
  label: string;
  timingsMs: number[];
  errors: number;
  ok: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
}

function report(label: string, result: EndpointResult): void {
  const { timingsMs, errors } = result;
  const sorted = [...timingsMs].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const avg = timingsMs.reduce((a, b) => a + b, 0) / timingsMs.length;
  const totalMs = timingsMs.reduce((a, b) => a + b, 0);
  const throughput = totalMs > 0 ? (timingsMs.length / totalMs) * 1000 : 0;
  const errorRate = (errors / timingsMs.length) * 100;

  // Store in global results accumulator
   
  globalResults[label] = { p50, p95, p99, avg, throughput, errorRate };
}

function createInitiatePayload(email: string) {
  return {
    email,
    password: `Perf-Test-${randomUUID().slice(0, 8)}!`,
    account_country: 'MY',
    referral_code: null,
    terms_version: 'v1',
    disclaimer_version: 'v1',
    privacy_version: 'v1',
    locale: 'en-MY',
  };
}

// Global accumulator so the summary test can print a table
const globalResults: Record<
  string,
  {
    p50: number;
    p95: number;
    p99: number;
    avg: number;
    throughput: number;
    errorRate: number;
  }
> = {};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!databaseUrl)('Auth Performance Baseline', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let rateLimiter: InMemoryRateLimiter;
  let preCreatedEmail: string;
  let preCreatedPassword: string;

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv(
      'AUTH_OTP_PEPPER',
      'perf-baseline-otp-pepper-with-at-least-32-chars!',
    );
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', 'silent');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app, {
      enableShutdownHooks: false,
      scanSwaggerRoutes: false,
    });
    await app.init();
    server = app.getHttpServer() as Server;
    database = app.get(DatabaseService);
    rateLimiter = app.get(AUTH_RATE_LIMITER);

    // Run migrations once
    try {
      await migrate(database.pool);
    } catch (error) {
      // Ignore collision when another test file already ran migration
      if (
        !(
          error instanceof Error &&
          'message' in error &&
          String(error.message).includes('pg_type_typname_nsp_index')
        )
      ) {
        throw error;
      }
    }

    // Create a pre-registered member + market for login / refresh / forgot-password tests
    preCreatedEmail = `perf-baseline-${randomUUID()}@example.com`;
    preCreatedPassword = `Perf-Baseline-${randomUUID().slice(0, 8)}!`;

    // Insert a market record for MY if missing
    const { markets } = await import('@ipoint/database');
    const { eq } = await import('drizzle-orm');

    const existingMarkets = await database.db
      .select({ id: markets.id })
      .from(markets)
      .where(eq(markets.code, 'MY'))
      .limit(1);

    if (!existingMarkets[0]) {
      await database.db.insert(markets).values({
        code: 'MY',
        name: 'Malaysia',
        status: 'ACTIVE',
        currencyCode: 'MYR',
        timezone: 'Asia/Kuala_Lumpur',
        defaultLocale: 'en-MY',
      });
    }

    // Full registration flow for a persistent test member
    const initPayload = createInitiatePayload(preCreatedEmail);
    const initRes = await supertest(server)
      .post('/api/v1/auth/registration/initiate')
      .send(initPayload)
      .expect(202);

    const initBody = initRes.body as {
      otp_id: string;
      development_code: string;
    };

    await supertest(server)
      .post('/api/v1/auth/registration/verify')
      .send({ otp_id: initBody.otp_id, code: initBody.development_code })
      .expect(200);

    const completeRes = await supertest(server)
      .post('/api/v1/auth/registration/complete')
      .send({
        otp_id: initBody.otp_id,
        idempotency_key: `perf-setup-${randomUUID().slice(0, 12)}`,
      })
      .expect(200);

    console.log(
      '[SETUP] Pre-created member. Complete:',
      JSON.stringify(completeRes.body),
    );
  });

  beforeEach(() => {
    // Clear rate limiter buckets to avoid test-to-test interference
    const buckets = (
      rateLimiter as unknown as { buckets?: Map<string, unknown> }
    ).buckets;
    if (buckets) buckets.clear();
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  // -----------------------------------------------------------------------
  // POST /api/v1/auth/register/initiate
  // -----------------------------------------------------------------------
  it('POST /api/v1/auth/registration/initiate — 50 iterations', async () => {
    const result: EndpointResult = {
      label: 'register/initiate',
      timingsMs: [],
      errors: 0,
      ok: true,
    };

    for (let i = 0; i < ITERATIONS + WARMUP_ITERATIONS; i++) {
      const email = `perf-init-${randomUUID()}@example.com`;
      const payload = createInitiatePayload(email);
      const start = Date.now();

      try {
        const res = await supertest(server)
          .post('/api/v1/auth/registration/initiate')
          .send(payload);

        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          if (res.status >= 400) result.errors++;
        }
      } catch {
        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          result.errors++;
        }
      }
    }

    report('register/initiate', result);
    expect(result.errors).toBeLessThanOrEqual(
      Math.ceil((ALLOWED_FAILURE_RATE_PCT / 100) * ITERATIONS),
    );
  });

  // -----------------------------------------------------------------------
  // POST /api/v1/auth/register/verify-otp
  // -----------------------------------------------------------------------
  it('POST /api/v1/auth/registration/verify — 50 iterations', async () => {
    const result: EndpointResult = {
      label: 'register/verify-otp',
      timingsMs: [],
      errors: 0,
      ok: true,
    };

    for (let i = 0; i < ITERATIONS + WARMUP_ITERATIONS; i++) {
      const email = `perf-verify-${randomUUID()}@example.com`;
      const payload = createInitiatePayload(email);

      // Prepare: initiate registration to get an OTP
      const initRes = await supertest(server)
        .post('/api/v1/auth/registration/initiate')
        .send(payload)
        .expect(202);

      const { otp_id, development_code } = initRes.body as {
        otp_id: string;
        development_code: string;
      };

      const start = Date.now();
      try {
        const res = await supertest(server)
          .post('/api/v1/auth/registration/verify')
          .send({ otp_id, code: development_code });

        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          if (res.status >= 400) result.errors++;
        }
      } catch {
        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          result.errors++;
        }
      }
    }

    report('register/verify-otp', result);
    expect(result.errors).toBeLessThanOrEqual(
      Math.ceil((ALLOWED_FAILURE_RATE_PCT / 100) * ITERATIONS),
    );
  });

  // -----------------------------------------------------------------------
  // POST /api/v1/auth/register/complete
  // -----------------------------------------------------------------------
  it('POST /api/v1/auth/registration/complete — 50 iterations', async () => {
    const result: EndpointResult = {
      label: 'register/complete',
      timingsMs: [],
      errors: 0,
      ok: true,
    };

    for (let i = 0; i < ITERATIONS + WARMUP_ITERATIONS; i++) {
      const email = `perf-complete-${randomUUID()}@example.com`;
      const payload = createInitiatePayload(email);

      // Prepare: initiate + verify an OTP
      const initRes = await supertest(server)
        .post('/api/v1/auth/registration/initiate')
        .send(payload)
        .expect(202);

      const initBody = initRes.body as {
        otp_id: string;
        development_code: string;
      };

      await supertest(server)
        .post('/api/v1/auth/registration/verify')
        .send({
          otp_id: initBody.otp_id,
          code: initBody.development_code,
        })
        .expect(200);

      const idempotencyKey = `perf-complete-${randomUUID().slice(0, 12)}`;

      const start = Date.now();
      try {
        const res = await supertest(server)
          .post('/api/v1/auth/registration/complete')
          .send({
            otp_id: initBody.otp_id,
            idempotency_key: idempotencyKey,
          });

        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          if (res.status >= 400) result.errors++;
        }
      } catch {
        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          result.errors++;
        }
      }
    }

    report('register/complete', result);
    expect(result.errors).toBeLessThanOrEqual(
      Math.ceil((ALLOWED_FAILURE_RATE_PCT / 100) * ITERATIONS),
    );
  });

  // -----------------------------------------------------------------------
  // POST /api/v1/auth/login
  // -----------------------------------------------------------------------
  it('POST /api/v1/auth/login — 50 iterations', async () => {
    const result: EndpointResult = {
      label: 'login',
      timingsMs: [],
      errors: 0,
      ok: true,
    };

    for (let i = 0; i < ITERATIONS + WARMUP_ITERATIONS; i++) {
      const start = Date.now();
      try {
        const res = await supertest(server)
          .post('/api/v1/auth/login')
          .send({ email: preCreatedEmail, password: preCreatedPassword });

        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          if (res.status >= 400) result.errors++;
        }
      } catch {
        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          result.errors++;
        }
      }
    }

    report('login', result);
    expect(result.errors).toBeLessThanOrEqual(
      Math.ceil((ALLOWED_FAILURE_RATE_PCT / 100) * ITERATIONS),
    );
  });

  // -----------------------------------------------------------------------
  // POST /api/v1/auth/refresh
  // -----------------------------------------------------------------------
  it('POST /api/v1/auth/refresh — 50 iterations', async () => {
    const result: EndpointResult = {
      label: 'refresh',
      timingsMs: [],
      errors: 0,
      ok: true,
    };

    for (let i = 0; i < ITERATIONS + WARMUP_ITERATIONS; i++) {
      // Prepare: log in to obtain a fresh refresh token
      const loginRes = await supertest(server)
        .post('/api/v1/auth/login')
        .send({ email: preCreatedEmail, password: preCreatedPassword })
        .expect(200);

      const refreshToken = (loginRes.body as { refreshToken: string })
        .refreshToken;

      const start = Date.now();
      try {
        const res = await supertest(server)
          .post('/api/v1/auth/refresh')
          .send({ refresh_token: refreshToken });

        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          if (res.status >= 400) result.errors++;
        }
      } catch {
        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          result.errors++;
        }
      }
    }

    report('refresh', result);
    expect(result.errors).toBeLessThanOrEqual(
      Math.ceil((ALLOWED_FAILURE_RATE_PCT / 100) * ITERATIONS),
    );
  });

  // -----------------------------------------------------------------------
  // POST /api/v1/auth/forgot-password → password-reset/initiate
  // -----------------------------------------------------------------------
  it('POST /api/v1/auth/password-reset/initiate — 50 iterations', async () => {
    const result: EndpointResult = {
      label: 'forgot-password',
      timingsMs: [],
      errors: 0,
      ok: true,
    };

    for (let i = 0; i < ITERATIONS + WARMUP_ITERATIONS; i++) {
      const targetEmail = `perf-forgot-${randomUUID()}@example.com`;

      const start = Date.now();
      try {
        const res = await supertest(server)
          .post('/api/v1/auth/password-reset/initiate')
          .send({ email: targetEmail });

        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          if (res.status >= 400) result.errors++;
        }
      } catch {
        if (i >= WARMUP_ITERATIONS) {
          result.timingsMs.push(Date.now() - start);
          result.errors++;
        }
      }
    }

    report('forgot-password', result);
    expect(result.errors).toBeLessThanOrEqual(
      Math.ceil((ALLOWED_FAILURE_RATE_PCT / 100) * ITERATIONS),
    );
  });

  // -----------------------------------------------------------------------
  // Summary — prints the baseline results table
  // -----------------------------------------------------------------------
  it('prints baseline results summary', () => {
    console.log('\n');
    console.log('='.repeat(120));
    console.log('AUTH PERFORMANCE BASELINE RESULTS');
    console.log('='.repeat(120));
    console.log(
      `${'Endpoint'.padEnd(40)} ${'P50 (ms)'.padEnd(10)} ${'P95 (ms)'.padEnd(10)} ${'P99 (ms)'.padEnd(10)} ${'Avg (ms)'.padEnd(10)} ${'Throughput'.padEnd(14)} ${'Error Rate'.padEnd(10)}`,
    );
    console.log('-'.repeat(120));

    for (const [label, data] of Object.entries(globalResults)) {
      console.log(
        `${label.padEnd(40)} ${String(data.p50).padEnd(10)} ${String(data.p95).padEnd(10)} ${String(data.p99).padEnd(10)} ${data.avg.toFixed(1).padEnd(10)} ${data.throughput.toFixed(1).padEnd(6)} req/s${' '.repeat(4)} ${data.errorRate.toFixed(1).padEnd(3)}%`,
      );
    }

    console.log('-'.repeat(120));
    console.log(
      `Iterations per endpoint: ${ITERATIONS} (excl. ${WARMUP_ITERATIONS} warmup)`,
    );
    console.log(`Database URL: ${databaseUrl ?? 'N/A'}`);
    console.log('='.repeat(120));
    console.log('\n');
  });
});
