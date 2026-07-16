import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from '../schema/index.js';

export type Database = ReturnType<typeof createDatabase>['db'];

export function createDatabase(connection: string | PoolConfig) {
  const pool = new Pool(
    typeof connection === 'string'
      ? { connectionString: connection }
      : connection,
  );
  return { pool, db: drizzle(pool, { schema }) };
}
