import type { Pool } from 'pg';
import { createDatabase } from './client.js';
import { expectedSchema } from './expected-schema.js';

interface CatalogColumn {
  table_name: string;
  column_name: string;
}

export async function assertNoSchemaDrift(pool: Pool): Promise<void> {
  const result = await pool.query<CatalogColumn>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  const actual = new Map<string, string[]>();
  for (const row of result.rows) {
    const columns = actual.get(row.table_name) ?? [];
    columns.push(row.column_name);
    actual.set(row.table_name, columns);
  }

  const expectedTables = Object.keys(expectedSchema).sort();
  const actualTables = [...actual.keys()].sort();
  const differences: string[] = [];
  if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
    differences.push(
      `tables expected=${JSON.stringify(expectedTables)} actual=${JSON.stringify(actualTables)}`,
    );
  }
  for (const [table, columns] of Object.entries(expectedSchema)) {
    const actualColumns = actual.get(table);
    if (JSON.stringify(actualColumns) !== JSON.stringify(columns)) {
      differences.push(
        `${table} columns expected=${JSON.stringify(columns)} actual=${JSON.stringify(actualColumns)}`,
      );
    }
  }
  if (differences.length > 0) {
    throw new Error(
      `Database schema drift detected:\n${differences.join('\n')}`,
    );
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const { pool } = createDatabase(databaseUrl);
  try {
    await assertNoSchemaDrift(pool);
    console.log('No database schema drift detected.');
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('drift-check.ts')) {
  await main();
}
