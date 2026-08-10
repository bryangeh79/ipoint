// P8-S7 restore verification (host-run, backup-restore.ps1).
// Verifies a restored database against its source:
//   1. representative table row-count parity,
//   2. database_migrations full parity (filename + checksum),
//   3. a write-path round trip (insert + rollback) on the restored DB,
//   4. a read query on the restored DB.
// Evidence is printed as JSON lines; raw output is captured to
// .local/p8-s7-backup/<run>/verify.json by the caller.
import { createRequire } from 'node:module';

const require = createRequire(
  new URL('../../packages/database/package.json', import.meta.url),
);
const { Pool } = require('pg');

const sourceUrl = process.env.P8S7_SOURCE_DATABASE_URL;
const restoreUrl = process.env.P8S7_RESTORE_DATABASE_URL;
if (!sourceUrl || !restoreUrl) {
  throw new Error('P8S7_SOURCE_DATABASE_URL and P8S7_RESTORE_DATABASE_URL are required.');
}

const SPOT_TABLES = [
  'members',
  'transactions',
  'mcp_ledger_entries',
  'member_wallet_entries',
  'commission_ledger',
  'redemption_orders',
  'audit_logs',
  'database_migrations',
  // Foundation-seeded tables (non-zero rows at Phase 8 seed state).
  'roles',
  'permissions',
  'admin_users',
  'markets',
  'redemption_rate_versions',
];

async function countRows(pool, table) {
  const r = await pool.query(`SELECT count(*)::int AS n FROM "${table}"`);
  return r.rows[0]?.n ?? -1;
}

const source = new Pool({ connectionString: sourceUrl });
const restored = new Pool({ connectionString: restoreUrl });

const evidence = {
  sourceUrl: sourceUrl.replace(/\/\/[^@]+@/u, '//***@'),
  restoreUrl: restoreUrl.replace(/\/\/[^@]+@/u, '//***@'),
  rowCounts: {},
  migrationsParity: null,
  writeRoundTrip: null,
  readQuery: null,
};

try {
  for (const table of SPOT_TABLES) {
    const src = await countRows(source, table);
    const rst = await countRows(restored, table);
    evidence.rowCounts[table] = { source: src, restored: rst, match: src === rst };
    if (src !== rst) {
      throw new Error(`row-count mismatch on ${table}: source=${src} restored=${rst}`);
    }
  }

  const srcMigrations = await source.query(
    'SELECT filename, checksum FROM database_migrations ORDER BY filename',
  );
  const rstMigrations = await restored.query(
    'SELECT filename, checksum FROM database_migrations ORDER BY filename',
  );
  const same =
    JSON.stringify(srcMigrations.rows) === JSON.stringify(rstMigrations.rows);
  evidence.migrationsParity = {
    sourceCount: srcMigrations.rows.length,
    restoredCount: rstMigrations.rows.length,
    identical: same,
  };
  if (!same) {
    throw new Error('database_migrations parity mismatch between source and restore.');
  }

  // Write-path round trip on the RESTORED database: a full INSERT (all NOT
  // NULL columns, enum + uuid defaults exercised) inside a transaction that
  // is then rolled back. Proves the write path works without leaving residue.
  const before = await countRows(restored, 'audit_logs');
  const write = await restored.query(
    `BEGIN;
     INSERT INTO audit_logs
       (actor_type, action, entity_type, entity_id, result, reason, request_id)
     VALUES
       ('SYSTEM', 'p8-s7-restore-smoke', 'p8-s7-smoke', 'write-round-trip',
        'SUCCESS', 'P8-S7 restore write-path smoke', 'p8-s7-smoke');
     ROLLBACK;`,
  );
  const after = await countRows(restored, 'audit_logs');
  evidence.writeRoundTrip = {
    rowsAffected: write[1]?.rowCount ?? null,
    countBefore: before,
    countAfter: after,
    rolledBackCleanly: before === after,
  };
  if (before !== after) {
    throw new Error('write-path round trip left residue in audit_logs.');
  }

  const read = await restored.query(
    'SELECT count(*)::int AS n, min(occurred_at) AS oldest FROM audit_logs',
  );
  evidence.readQuery = { rows: read.rows[0] };

  console.log(JSON.stringify(evidence, null, 2));
  console.log('VERIFY_RESULT: PASS');
} catch (error) {
  console.error('VERIFY_RESULT: FAIL');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await source.end().catch(() => undefined);
  await restored.end().catch(() => undefined);
}
