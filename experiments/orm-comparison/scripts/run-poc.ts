import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

import { Pool } from 'pg';

import { DrizzleHarness } from '../drizzle/harness.js';
import { PrismaHarness } from '../prisma/harness.js';
import {
  constraintSignature,
  runNestIntegrationProbe,
  runOrmExperiments,
  schemaSignature,
} from '../shared/experiments.js';
import type { OrmHarness } from '../shared/harness.js';

const packageRoot = resolve(import.meta.dirname, '..');
const resultsRoot = join(packageRoot, 'results');
const sqlResultsRoot = join(resultsRoot, 'sql');
const prismaUrl =
  'postgresql://ipoint_poc:ipoint_poc@localhost:55431/ipoint_prisma_poc';
const drizzleUrl =
  'postgresql://ipoint_poc:ipoint_poc@localhost:55432/ipoint_drizzle_poc';
const pnpmCli =
  process.platform === 'win32'
    ? join(process.env.APPDATA ?? '', 'npm/node_modules/pnpm/bin/pnpm.cjs')
    : undefined;
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';

interface CommandEvidence {
  command: string;
  cwd: string;
  startedAt: string;
  durationMs: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  expectedExitCodes: number[];
}

const commands: CommandEvidence[] = [];

const runCommand = (
  executable: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; expectedExitCodes?: number[] } = {},
): CommandEvidence => {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const result = spawnSync(executable, args, {
    cwd: packageRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    windowsHide: true,
  });
  const evidence: CommandEvidence = {
    command: [executable, ...args].join(' '),
    cwd: packageRoot,
    startedAt,
    durationMs: Math.round(performance.now() - started),
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    expectedExitCodes: options.expectedExitCodes ?? [0],
  };
  commands.push(evidence);
  process.stdout.write(
    `\n$ ${evidence.command}\n${evidence.stdout}${evidence.stderr}`,
  );
  if (!evidence.expectedExitCodes.includes(evidence.exitCode ?? -1)) {
    throw new Error(
      `Command failed with exit ${String(evidence.exitCode)}: ${evidence.command}`,
    );
  }
  return evidence;
};

const runPnpm = (
  args: string[],
  options: { env?: NodeJS.ProcessEnv; expectedExitCodes?: number[] } = {},
): CommandEvidence =>
  pnpmCli === undefined
    ? runCommand('pnpm', args, options)
    : runCommand(process.execPath, [pnpmCli, ...args], options);

const jsonReplacer = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value;

const writeJson = async (name: string, value: unknown): Promise<void> => {
  await writeFile(
    join(resultsRoot, name),
    `${JSON.stringify(value, jsonReplacer, 2)}\n`,
    'utf8',
  );
};

const resetDatabase = async (connectionString: string): Promise<void> => {
  const pool = new Pool({ connectionString });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } finally {
    await pool.end();
  }
};

const applySql = async (
  harness: OrmHarness,
  relativePath: string,
): Promise<void> => {
  await harness.execute(
    await readFile(join(packageRoot, relativePath), 'utf8'),
  );
};

const columnExists = async (
  harness: OrmHarness,
  table: string,
  column: string,
): Promise<boolean> => {
  const rows = await harness.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}') AS exists`,
  );
  return rows[0]?.exists === true;
};

const runMigrationSequence = async (
  harness: OrmHarness,
): Promise<Record<string, unknown>> => {
  const fromZeroTables = await harness.query<{ count: bigint | string }>(
    "SELECT count(*) AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('markets','wallets','ledger_entries','adjustment_requests','adjustment_actions','audit_events','versioned_rules','idempotency_records')",
  );
  await applySql(harness, 'shared/seed.sql');
  await applySql(harness, 'shared/additive.sql');
  const additiveColumnPresent = await columnExists(
    harness,
    'audit_events',
    'correlation_id',
  );
  await harness.execute(
    `INSERT INTO audit_events (public_id, market_id, actor_id, action, entity_type, entity_id, request_id, correlation_id) VALUES ('aud_migration_probe', '00000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'MIGRATION_PROBE', 'probe', '30000000-0000-4000-8000-000000000002', 'migration-probe', 'correlation-before-drop')`,
  );
  await applySql(harness, 'shared/destructive.sql');
  const destructiveColumnAbsent = !(await columnExists(
    harness,
    'audit_events',
    'correlation_id',
  ));
  await applySql(harness, 'shared/recovery.sql');
  const recovery = await harness.query<{
    correlation_id: string | null;
  }>(
    "SELECT correlation_id FROM audit_events WHERE public_id = 'aud_migration_probe'",
  );
  const recoveryColumnPresent = await columnExists(
    harness,
    'audit_events',
    'correlation_id',
  );
  await applySql(harness, 'shared/destructive.sql');

  return {
    fromZeroTableCount: Number(fromZeroTables[0]?.count ?? 0),
    fromZeroRebuildPassed: Number(fromZeroTables[0]?.count ?? 0) === 8,
    deterministicSeed: {
      marketId: '00000000-0000-4000-8000-000000000001',
      walletId: '00000000-0000-4000-8000-000000000002',
    },
    additiveColumnPresent,
    destructiveColumnAbsent,
    recoveryColumnPresent,
    recoveredPriorValue: recovery[0]?.correlation_id ?? null,
    recoveryDataLossDocumented: recovery[0]?.correlation_id === null,
  };
};

const runHistoryConflictProbes = async (): Promise<Record<string, unknown>> => {
  const prismaMigration = join(
    packageRoot,
    'prisma/migrations/0001_initial/migration.sql',
  );
  const drizzleMigration = join(
    packageRoot,
    'drizzle/migrations/0000_initial.sql',
  );
  const prismaOriginal = await readFile(prismaMigration, 'utf8');
  const drizzleOriginal = await readFile(drizzleMigration, 'utf8');
  let prismaStatus: CommandEvidence | undefined;
  let drizzleMigrate: CommandEvidence | undefined;
  try {
    await writeFile(
      prismaMigration,
      `${prismaOriginal}\n-- simulated history conflict\n`,
      'utf8',
    );
    prismaStatus = runPnpm(
      [
        'exec',
        'prisma',
        'migrate',
        'status',
        '--config',
        'prisma/prisma.config.ts',
      ],
      {
        env: { PRISMA_POC_DATABASE_URL: prismaUrl },
        expectedExitCodes: [0, 1],
      },
    );
  } finally {
    await writeFile(prismaMigration, prismaOriginal, 'utf8');
  }
  try {
    await writeFile(
      drizzleMigration,
      `${drizzleOriginal}\n-- simulated history conflict\n`,
      'utf8',
    );
    drizzleMigrate = runPnpm(
      [
        'exec',
        'drizzle-kit',
        'migrate',
        '--config',
        'drizzle/drizzle.config.ts',
      ],
      {
        env: { DRIZZLE_POC_DATABASE_URL: drizzleUrl },
        expectedExitCodes: [0, 1],
      },
    );
  } finally {
    await writeFile(drizzleMigration, drizzleOriginal, 'utf8');
  }
  return {
    prisma: {
      changedAppliedSqlDetected: prismaStatus?.exitCode !== 0,
      exitCode: prismaStatus?.exitCode,
      observation:
        `${prismaStatus?.stdout ?? ''}${prismaStatus?.stderr ?? ''}`.trim(),
    },
    drizzle: {
      changedAppliedSqlDetected: drizzleMigrate?.exitCode !== 0,
      exitCode: drizzleMigrate?.exitCode,
      observation:
        `${drizzleMigrate?.stdout ?? ''}${drizzleMigrate?.stderr ?? ''}`.trim(),
    },
  };
};

const runDriftProbes = async (
  prisma: OrmHarness,
  drizzle: OrmHarness,
): Promise<Record<string, unknown>> => {
  await prisma.execute('ALTER TABLE wallets ADD COLUMN rogue_drift_probe text');
  await drizzle.execute(
    'ALTER TABLE wallets ADD COLUMN rogue_drift_probe text',
  );
  const prismaDiff = runPnpm(
    [
      'exec',
      'prisma',
      'migrate',
      'diff',
      '--config',
      'prisma/prisma.config.ts',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--exit-code',
      '--script',
    ],
    {
      env: { PRISMA_POC_DATABASE_URL: prismaUrl },
      expectedExitCodes: [0, 2],
    },
  );
  const prismaCatalogDetected = await columnExists(
    prisma,
    'wallets',
    'rogue_drift_probe',
  );
  const drizzleCatalogDetected = await columnExists(
    drizzle,
    'wallets',
    'rogue_drift_probe',
  );
  await prisma.execute('ALTER TABLE wallets DROP COLUMN rogue_drift_probe');
  await drizzle.execute('ALTER TABLE wallets DROP COLUMN rogue_drift_probe');
  return {
    prisma: {
      cli: 'prisma migrate diff --from-config-datasource --to-schema ... --exit-code --script',
      exitCode: prismaDiff.exitCode,
      driftDetected: prismaDiff.exitCode === 2 && prismaCatalogDetected,
      stdout: prismaDiff.stdout,
      stderr: prismaDiff.stderr,
    },
    drizzle: {
      nonMutatingOfficialLiveDiffCommand: null,
      catalogProbeDetected: drizzleCatalogDetected,
      limitation:
        'Drizzle Kit stable has no equivalent documented non-mutating live-schema diff command; PoC used a read-only PostgreSQL catalog probe.',
    },
  };
};

const postgresEnvironment = async (
  harness: OrmHarness,
): Promise<Record<string, unknown>> => {
  const rows = await harness.query<{
    version: string;
    max_connections: string;
    deadlock_timeout: string;
    default_transaction_isolation: string;
    timezone: string;
  }>(
    `SELECT version(), current_setting('max_connections') AS max_connections, current_setting('deadlock_timeout') AS deadlock_timeout, current_setting('default_transaction_isolation') AS default_transaction_isolation, current_setting('TimeZone') AS timezone`,
  );
  return rows[0] ?? {};
};

const allCasesPassed = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.every(allCasesPassed);
  if (value !== null && typeof value === 'object') {
    const candidate = value as { passed?: unknown };
    if (typeof candidate.passed === 'boolean' && !candidate.passed)
      return false;
    return Object.values(value).every(allCasesPassed);
  }
  return true;
};

const main = async (): Promise<void> => {
  await mkdir(sqlResultsRoot, { recursive: true });
  const totalStarted = performance.now();
  let prisma: PrismaHarness | undefined;
  let drizzle: DrizzleHarness | undefined;
  let failed: unknown;
  try {
    runCommand(docker, [
      'compose',
      '-f',
      'compose.poc.yaml',
      'up',
      '-d',
      '--wait',
    ]);
    await resetDatabase(prismaUrl);
    await resetDatabase(drizzleUrl);

    runPnpm(
      ['exec', 'prisma', 'validate', '--config', 'prisma/prisma.config.ts'],
      { env: { PRISMA_POC_DATABASE_URL: prismaUrl } },
    );
    runPnpm(
      ['exec', 'prisma', 'generate', '--config', 'prisma/prisma.config.ts'],
      { env: { PRISMA_POC_DATABASE_URL: prismaUrl } },
    );
    runPnpm(
      [
        'exec',
        'prisma',
        'migrate',
        'deploy',
        '--config',
        'prisma/prisma.config.ts',
      ],
      { env: { PRISMA_POC_DATABASE_URL: prismaUrl } },
    );
    runPnpm(
      ['exec', 'drizzle-kit', 'check', '--config', 'drizzle/drizzle.config.ts'],
      { env: { DRIZZLE_POC_DATABASE_URL: drizzleUrl } },
    );
    runPnpm(
      [
        'exec',
        'drizzle-kit',
        'migrate',
        '--config',
        'drizzle/drizzle.config.ts',
      ],
      { env: { DRIZZLE_POC_DATABASE_URL: drizzleUrl } },
    );

    prisma = new PrismaHarness(prismaUrl);
    drizzle = new DrizzleHarness(drizzleUrl);
    await prisma.connect();
    await drizzle.connect();

    const migrationResults = {
      prisma: await runMigrationSequence(prisma),
      drizzle: await runMigrationSequence(drizzle),
      historyConflict: await runHistoryConflictProbes(),
    };
    const prismaColumns = await schemaSignature(prisma);
    const drizzleColumns = await schemaSignature(drizzle);
    const schemaComparison = {
      identicalColumnSignature:
        JSON.stringify(prismaColumns) === JSON.stringify(drizzleColumns),
      prismaColumns,
      drizzleColumns,
      prismaConstraints: await constraintSignature(prisma),
      drizzleConstraints: await constraintSignature(drizzle),
      note: 'Constraint object representation differs where Prisma emits unique indexes and Drizzle emits UNIQUE constraints; behavior probes verify the required invariants.',
    };
    const driftResults = await runDriftProbes(prisma, drizzle);

    const prismaResult = await runOrmExperiments(prisma);
    const drizzleResult = await runOrmExperiments(drizzle);
    const nestResults = {
      prisma: await runNestIntegrationProbe('prisma', prismaUrl, prisma),
      drizzle: await runNestIntegrationProbe('drizzle', drizzleUrl, drizzle),
    };
    const testSummary = {
      banner: 'RECOMMENDATION ONLY — AWAITING COMMAND CENTER ORM GATE',
      prisma: prismaResult,
      drizzle: drizzleResult,
      nestjs: nestResults,
      allPassed: allCasesPassed({ prismaResult, drizzleResult, nestResults }),
    };
    if (!testSummary.allPassed)
      throw new Error('one or more PoC assertions failed');

    const versions = {
      recordedAt: new Date().toISOString(),
      node: runCommand(process.execPath, ['--version']).stdout.trim(),
      pnpm: runPnpm(['--version']).stdout.trim(),
      docker: runCommand(docker, ['--version']).stdout.trim(),
      postgres: {
        prisma: await postgresEnvironment(prisma),
        drizzle: await postgresEnvironment(drizzle),
      },
      packages: {
        prisma: '7.8.0',
        prismaClient: '7.8.0',
        prismaPgAdapter: '7.8.0',
        drizzleOrm: '0.45.2',
        drizzleKit: '0.31.10',
        pg: '8.22.0',
        nestjs: '10.4.x',
      },
    };
    const environment = {
      os: `${process.platform} ${process.arch}`,
      cwd: packageRoot,
      containers: [
        {
          name: 'ipoint-orm-poc-prisma-postgres-1',
          image: 'postgres:17-alpine',
          hostPort: 55431,
          database: 'ipoint_prisma_poc',
        },
        {
          name: 'ipoint-orm-poc-drizzle-postgres-1',
          image: 'postgres:17-alpine',
          hostPort: 55432,
          database: 'ipoint_drizzle_poc',
        },
      ],
      credentials:
        'Local disposable PoC credentials are declared in compose.poc.yaml; no production secrets are used.',
      nodeSupportLimitation:
        'Host Node v26.4.0 is outside Prisma 7.8.0 documented supported majors (20.19+, 22.12+, 24.x). Commands completed, but results must be repeated on supported Node 24 before a production gate.',
    };

    await writeJson('versions.json', versions);
    await writeJson('environment.json', environment);
    await writeJson('migration-results.json', migrationResults);
    await writeJson('schema-comparison.json', schemaComparison);
    await writeJson('drift-results.json', driftResults);
    await writeJson('test-summary.json', testSummary);
    await writeJson('concurrency-results.json', {
      prisma: prismaResult.transactions.filter((item) =>
        ['concurrent-updates-bounded-retry', 'deadlock-detection'].includes(
          item.name,
        ),
      ),
      drizzle: drizzleResult.transactions.filter((item) =>
        ['concurrent-updates-bounded-retry', 'deadlock-detection'].includes(
          item.name,
        ),
      ),
    });
    await writeJson('timing.json', {
      totalDurationMs: Math.round(performance.now() - totalStarted),
      commands: commands.map(({ command, durationMs, exitCode }) => ({
        command,
        durationMs,
        exitCode,
      })),
    });
    await copyFile(
      join(packageRoot, 'prisma/migrations/0001_initial/migration.sql'),
      join(sqlResultsRoot, 'prisma-initial.sql'),
    );
    await copyFile(
      join(packageRoot, 'drizzle/migrations/0000_initial.sql'),
      join(sqlResultsRoot, 'drizzle-initial.sql'),
    );
    await copyFile(
      join(packageRoot, 'shared/additive.sql'),
      join(sqlResultsRoot, 'additive.sql'),
    );
    await copyFile(
      join(packageRoot, 'shared/destructive.sql'),
      join(sqlResultsRoot, 'destructive.sql'),
    );
    await copyFile(
      join(packageRoot, 'shared/recovery.sql'),
      join(sqlResultsRoot, 'recovery.sql'),
    );
  } catch (error) {
    failed = error;
    process.stderr.write(
      `\nPoC failed: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
  } finally {
    if (prisma !== undefined) await prisma.disconnect().catch(() => undefined);
    if (drizzle !== undefined)
      await drizzle.disconnect().catch(() => undefined);
    runCommand(docker, ['compose', '-f', 'compose.poc.yaml', 'down', '-v'], {
      expectedExitCodes: [0],
    });
    await writeFile(
      join(resultsRoot, 'commands.jsonl'),
      `${commands.map((command) => JSON.stringify(command)).join('\n')}\n`,
      'utf8',
    );
  }
  if (failed instanceof Error) throw failed;
  if (failed !== undefined) {
    throw new Error(
      typeof failed === 'string'
        ? failed
        : JSON.stringify(failed, jsonReplacer),
    );
  }
};

await main();
