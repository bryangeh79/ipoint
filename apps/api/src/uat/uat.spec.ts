/**
 * P8-S8 Full Final UAT — vitest entry point (U-01..U-36).
 *
 * Fail-closed (S1-S4/S6 H-01 pattern): the suite refuses to run unless
 * DATABASE_URL names a dedicated `ipoint_p8s8_*` database and
 * `P8S8_DESTRUCTIVE_TEST` is set. The destructive guard unit tests run
 * unconditionally; the U-01..U-36 scenarios run serially at the L0
 * acceptance profile over real HTTP against the real API + PostgreSQL.
 *
 * Run (host):
 *   cd apps/api
 *   $env:DATABASE_URL='postgresql://ipoint:ipoint-local-only@127.0.0.1:55432/ipoint_p8s8_test'
 *   $env:P8S8_DESTRUCTIVE_TEST='1'
 *   pnpm vitest run src/uat/uat.spec.ts --reporter verbose
 *
 * @packageDocumentation
 */

import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UatContext } from './types.js';
import { bootUatApp, recordUatEvidence } from './harness.js';
import { UAT_SCENARIOS, runUatScenario } from './index.js';
import {
  assertUatAllowed,
  destructiveTestOptIn,
  testDatabaseName,
} from './guards.js';

const databaseUrl = process.env['DATABASE_URL'];

// ---------------------------------------------------------------------------
// Fail-closed guard unit tests (always run, mirroring the S1-S4/S6 suites).
// ---------------------------------------------------------------------------

describe('P8-S8 destructive fresh-database guard', () => {
  it('accepts only the dedicated ipoint_p8s8_* test pattern', () => {
    expect(
      testDatabaseName(
        'postgresql://user:pass@127.0.0.1:55432/ipoint_p8s8_test',
      ),
    ).toBe('ipoint_p8s8_test');
    expect(
      testDatabaseName('postgres://localhost/ipoint_p8s8_migration_test'),
    ).toBe('ipoint_p8s8_migration_test');
  });

  it('rejects protected maintenance database names', () => {
    for (const name of ['postgres', 'template0', 'template1']) {
      expect(testDatabaseName(`postgresql://localhost/${name}`)).toBeNull();
    }
  });

  it('rejects arbitrary, production-looking or malformed names', () => {
    expect(testDatabaseName('postgresql://localhost/app')).toBeNull();
    expect(testDatabaseName('postgresql://localhost/ipoint_dev')).toBeNull();
    expect(
      testDatabaseName('postgresql://localhost/ipoint_production'),
    ).toBeNull();
    expect(testDatabaseName('postgresql://localhost/ipoint_p8s8')).toBeNull();
    expect(testDatabaseName('not a url')).toBeNull();
    expect(testDatabaseName(undefined)).toBeNull();
  });

  it('requires the explicit destructive opt-in', () => {
    expect(destructiveTestOptIn({ P8S8_DESTRUCTIVE_TEST: '1' })).toBe(true);
    expect(destructiveTestOptIn({ P8S8_DESTRUCTIVE_TEST: 'true' })).toBe(true);
    expect(destructiveTestOptIn({ P8S8_DESTRUCTIVE_TEST: 'yes' })).toBe(true);
    expect(destructiveTestOptIn({ P8S8_DESTRUCTIVE_TEST: '0' })).toBe(false);
    expect(destructiveTestOptIn({})).toBe(false);
  });

  it('fail-closes when DATABASE_URL is missing or wrong', () => {
    expect(() => assertUatAllowed(undefined)).toThrow(/fail-closed/u);
    expect(() =>
      assertUatAllowed('postgresql://localhost/ipoint_ci'),
    ).toThrow(/fail-closed/u);
  });
});

// ---------------------------------------------------------------------------
// U-01..U-36 scenarios (guarded; skipped without the destructive opt-in).
// ---------------------------------------------------------------------------

describe.skipIf(!databaseUrl || !destructiveTestOptIn(process.env))(
  'P8-S8 Full Final UAT (guarded destructive suite, L0 acceptance profile)',
  () => {
    let ctx: UatContext;
    let app: INestApplication;
    let server: Server;
    const results: Awaited<ReturnType<(typeof UAT_SCENARIOS)[number]['run']>>[] = [];

    beforeAll(async () => {
      ctx = await bootUatApp();
      app = ctx.app;
      server = ctx.server;
    }, 300_000);

    afterAll(async () => {
      const runId = 'p8s8-uat-l0';
      const dir = recordUatEvidence(ctx, results, runId);
      console.log(`[P8-S8] UAT evidence written to ${dir}`);
      await app?.close();
      await new Promise<void>((resolve) => {
        if (server) server.close(() => resolve());
        else resolve();
      });
    });

    for (const scenario of UAT_SCENARIOS) {
      it(`${scenario.id} ${scenario.name}`, async () => {
        const result = await runUatScenario(scenario, ctx);
        results.push(result);
        const failed = result.assertions.filter((a) => !a.pass);
        expect(failed, `${scenario.id} assertions`).toHaveLength(0);
      }, 180_000);
    }
  },
);
