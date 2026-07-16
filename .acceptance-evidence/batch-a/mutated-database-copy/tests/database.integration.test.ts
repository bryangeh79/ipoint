import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '../src/client.js';
import { migrate } from '../src/migration-runner.js';
import { verifyMigrationChecksums } from '../src/migration-checksums.js';
import { assertNoSchemaDrift } from '../src/drift-check.js';
import { accounts, auditLogs, entityTimelines } from '../schema/index.js';
import { seedFoundation } from '../seeds/foundation.js';

const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)('database foundation integration', () => {
  const connection = createDatabase(databaseUrl ?? '');
  let db: Database;

  beforeAll(async () => {
    db = connection.db;
    await migrate(connection.pool);
  });

  afterAll(async () => {
    await connection.pool.end();
  });

  it('rebuilds from zero with all migrations and no drift', async () => {
    await expect(verifyMigrationChecksums()).resolves.toHaveProperty(
      '0000_database_foundation.sql',
    );
    await expect(assertNoSchemaDrift(connection.pool)).resolves.toBeUndefined();
  });

  it('enforces normalization, uniqueness, and foreign keys', async () => {
    await expect(
      connection.pool.query(
        `INSERT INTO accounts (public_id, email, account_country)
         VALUES ('bad-email', 'UPPER@EXAMPLE.COM', 'MY')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });

    const email = `${randomUUID()}@example.com`;
    const publicId = `acct_${randomUUID()}`;
    const inserted = await db
      .insert(accounts)
      .values({ publicId, email, accountCountry: 'MY' })
      .returning({ id: accounts.id });
    expect(inserted).toHaveLength(1);
    await expect(
      db.insert(accounts).values({
        publicId: `acct_${randomUUID()}`,
        email,
        accountCountry: 'MY',
      }),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
    await expect(
      connection.pool.query(
        `INSERT INTO credentials
          (account_id, secret_hash, hash_algorithm)
         VALUES ($1, $2, 'scrypt')`,
        [randomUUID(), 'x'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('rejects plaintext-shaped secrets at the database boundary', async () => {
    const account = await db
      .insert(accounts)
      .values({
        publicId: `acct_${randomUUID()}`,
        email: `${randomUUID()}@example.com`,
        accountCountry: 'MY',
      })
      .returning({ id: accounts.id });
    await expect(
      connection.pool.query(
        `INSERT INTO credentials
          (account_id, secret_hash, hash_algorithm)
         VALUES ($1, 'plaintext-password', 'scrypt')`,
        [account[0]?.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('persists timestamp instants independently of the session timezone', async () => {
    await connection.pool.query(`SET TIME ZONE 'Asia/Kuala_Lumpur'`);
    const result = await connection.pool.query<{ utc: string }>(`
      SELECT to_char('2026-07-16T01:02:03.456Z'::timestamptz AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS utc;
    `);
    expect(result.rows[0]?.utc).toBe('2026-07-16T01:02:03.456Z');
  });

  it('runs the deterministic seed twice without duplicates', async () => {
    await seedFoundation(db);
    await seedFoundation(db);
    const counts = await connection.pool.query<{
      roles: string;
      permissions: string;
    }>(`
      SELECT
        (SELECT count(*) FROM roles) AS roles,
        (SELECT count(*) FROM permissions) AS permissions
    `);
    expect(counts.rows[0]).toEqual({ roles: '2', permissions: '5' });
  });

  it('detects applied migration checksum changes', async () => {
    await connection.pool.query(
      `UPDATE database_migrations SET checksum = repeat('0', 64)
       WHERE filename = '0000_database_foundation.sql'`,
    );
    await expect(migrate(connection.pool)).rejects.toThrow(
      'Applied migration checksum mismatch',
    );
    const checksums = await verifyMigrationChecksums();
    await connection.pool.query(
      `UPDATE database_migrations SET checksum = $1
       WHERE filename = '0000_database_foundation.sql'`,
      [checksums['0000_database_foundation.sql']],
    );
  });

  it('detects live schema drift without mutating it', async () => {
    await connection.pool.query(
      'ALTER TABLE accounts ADD COLUMN rogue_column text',
    );
    await expect(assertNoSchemaDrift(connection.pool)).rejects.toThrow(
      'Database schema drift detected',
    );
    await connection.pool.query(
      'ALTER TABLE accounts DROP COLUMN rogue_column',
    );
    await expect(assertNoSchemaDrift(connection.pool)).resolves.toBeUndefined();
  });

  it('keeps audit and entity timeline records append-only', async () => {
    const audit = await db
      .insert(auditLogs)
      .values({
        actorType: 'SYSTEM',
        action: 'foundation.test',
        entityType: 'account',
        entityId: randomUUID(),
        result: 'SUCCESS',
      })
      .returning({ id: auditLogs.id });
    const timeline = await db
      .insert(entityTimelines)
      .values({
        actorType: 'SYSTEM',
        entityType: 'account',
        entityId: randomUUID(),
        eventType: 'foundation.tested',
        summary: 'Append-only verification.',
      })
      .returning({ id: entityTimelines.id });
    await expect(
      db
        .update(auditLogs)
        .set({ reason: 'mutated' })
        .where(sql`${auditLogs.id} = ${audit[0]?.id}`),
    ).rejects.toMatchObject({ cause: { code: '55000' } });
    await expect(
      db
        .delete(entityTimelines)
        .where(sql`${entityTimelines.id} = ${timeline[0]?.id}`),
    ).rejects.toMatchObject({ cause: { code: '55000' } });
  });
});
