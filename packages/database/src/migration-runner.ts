import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { createDatabase } from './client.js';
import { migrationsDirectory } from './paths.js';
import { verifyMigrationChecksums } from './migration-checksums.js';

export async function migrate(pool: Pool): Promise<void> {
  const checksums = await verifyMigrationChecksums();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS database_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz(6) NOT NULL DEFAULT now()
    )
  `);

  for (const [filename, checksum] of Object.entries(checksums)) {
    const applied = await pool.query<{ checksum: string }>(
      'SELECT checksum FROM database_migrations WHERE filename = $1',
      [filename],
    );
    if (applied.rowCount === 1) {
      if (applied.rows[0]?.checksum !== checksum) {
        throw new Error(`Applied migration checksum mismatch: ${filename}`);
      }
      continue;
    }

    const sql = await readFile(`${migrationsDirectory}/${filename}`, 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO database_migrations (filename, checksum) VALUES ($1, $2)',
        [filename, checksum],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const { pool } = createDatabase(databaseUrl);
  try {
    await migrate(pool);
    console.log('Database migrations are current.');
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('migration-runner.ts')) {
  await main();
}
