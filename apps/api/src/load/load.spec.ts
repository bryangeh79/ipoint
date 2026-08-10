/**
 * P8-S6 load / performance / concurrency suite (vitest entry point).
 *
 * Fail-closed (S1–S4 H-01 pattern): the suite refuses to run unless
 * DATABASE_URL names a dedicated `ipoint_p8s6_*` database and
 * `P8S6_DESTRUCTIVE_TEST` is set. The destructive guard unit tests run
 * unconditionally; the load journeys run at the level selected by
 * `P8S6_LOAD_LEVEL` (default L0 — the CI smoke profile).
 *
 * Run (host, level L0/L1/L2):
 *   cd apps/api
 *   $env:DATABASE_URL='postgresql://ipoint:ipoint-local-only@127.0.0.1:55432/ipoint_p8s6_test'
 *   $env:P8S6_DESTRUCTIVE_TEST='1'; $env:P8S6_LOAD_LEVEL='L0'
 *   pnpm vitest run src/load/load.spec.ts --reporter verbose
 *
 * @packageDocumentation
 */

import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoadContext } from './harness.js';
import { bootLoadApp, recordRunEvidence } from './harness.js';
import { JOURNEYS } from './journeys/index.js';
import {
  assertLoadTestAllowed,
  destructiveTestOptIn,
  testDatabaseName,
} from './guards.js';

const databaseUrl = process.env['DATABASE_URL'];
const loadLevel = (process.env['P8S6_LOAD_LEVEL'] ?? 'L0') as
  | 'L0'
  | 'L1'
  | 'L2';

// ---------------------------------------------------------------------------
// Fail-closed guard unit tests (always run, mirroring the S1–S4 suites).
// ---------------------------------------------------------------------------

describe('P8-S6 destructive fresh-database guard', () => {
  it('accepts only the dedicated ipoint_p8s6_* test pattern', () => {
    expect(
      testDatabaseName(
        'postgresql://user:pass@127.0.0.1:55432/ipoint_p8s6_test',
      ),
    ).toBe('ipoint_p8s6_test');
    expect(
      testDatabaseName('postgres://localhost/ipoint_p8s6_migration_test'),
    ).toBe('ipoint_p8s6_migration_test');
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
    expect(testDatabaseName('postgresql://localhost/ipoint_p8s6')).toBeNull();
    expect(
      testDatabaseName('postgresql://localhost/ipoint_p8s6_bad%2Fname'),
    ).toBeNull();
    expect(testDatabaseName('not a url')).toBeNull();
    expect(testDatabaseName(undefined)).toBeNull();
    expect(testDatabaseName('')).toBeNull();
  });

  it('requires the explicit destructive opt-in', () => {
    expect(destructiveTestOptIn({ P8S6_DESTRUCTIVE_TEST: '1' })).toBe(true);
    expect(destructiveTestOptIn({ P8S6_DESTRUCTIVE_TEST: 'true' })).toBe(true);
    expect(destructiveTestOptIn({ P8S6_DESTRUCTIVE_TEST: 'yes' })).toBe(true);
    expect(destructiveTestOptIn({ P8S6_DESTRUCTIVE_TEST: '0' })).toBe(false);
    expect(destructiveTestOptIn({})).toBe(false);
  });

  it('fail-closes when DATABASE_URL is missing or wrong', () => {
    expect(() => assertLoadTestAllowed(undefined)).toThrow(/fail-closed/u);
    expect(() =>
      assertLoadTestAllowed('postgresql://localhost/ipoint_ci'),
    ).toThrow(/fail-closed/u);
  });
});

// ---------------------------------------------------------------------------
// Load journeys (guarded; skipped without the destructive opt-in).
// ---------------------------------------------------------------------------

describe.skipIf(!databaseUrl || !destructiveTestOptIn(process.env))(
  'P8-S6 load harness (guarded destructive suite)',
  () => {
    let ctx: LoadContext;
    let app: INestApplication;
    let server: Server;
    const results: Awaited<ReturnType<(typeof JOURNEYS)[number]['run']>>[] = [];

    beforeAll(async () => {
      ctx = await bootLoadApp({
        level: loadLevel,
        envStub: (key, value) => {
          process.env[key] = value;
        },
        silent: true,
      });
      app = ctx.app;
      server = ctx.server;
    }, 300_000);

    afterAll(async () => {
      const runId = `p8s6-${loadLevel.toLowerCase()}`;
      const dir = recordRunEvidence(ctx, results, runId);
      console.log(`[P8-S6] evidence written to ${dir}`);
      await app?.close();
      await new Promise<void>((resolve) => {
        if (server) server.close(() => resolve());
        else resolve();
      });
    });

    for (const journey of JOURNEYS) {
      it(`${journey.id} ${journey.name} (${loadLevel})`, async () => {
        const result = await journey.run(ctx);
        results.push(result);
        const failed = result.assertions.filter((a) => !a.pass);
        // Every measured op must have zero unexpected errors.
        const unexpected = result.ops.filter(
          (op) => op.unexpectedErrorCount > 0,
        );
        expect(unexpected, `${journey.id} unexpected errors`).toHaveLength(0);
        expect(failed, `${journey.id} assertions`).toHaveLength(0);
      }, 300_000);
    }
  },
);
