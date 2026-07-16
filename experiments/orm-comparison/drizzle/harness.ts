import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type QueryResult } from 'pg';

import type {
  IsolationLevel,
  OrmHarness,
  QueryResultRow,
  SqlExecutor,
} from '../shared/harness.js';
import * as schema from './schema.js';

type DrizzleExecutor = {
  execute(statement: ReturnType<typeof sql.raw>): Promise<QueryResult>;
};

const wrap = (executor: DrizzleExecutor): SqlExecutor => ({
  async query<T extends QueryResultRow>(statement: string): Promise<T[]> {
    const result = await executor.execute(sql.raw(statement));
    return result.rows as T[];
  },
  async execute(statement: string): Promise<number> {
    const result = await executor.execute(sql.raw(statement));
    return result.rowCount ?? 0;
  },
});

export class DrizzleHarness implements OrmHarness {
  readonly name = 'drizzle' as const;
  readonly pool: Pool;
  readonly db: NodePgDatabase<typeof schema>;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 20 });
    this.db = drizzle({ client: this.pool, schema });
  }

  async connect(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }

  async query<T extends QueryResultRow>(statement: string): Promise<T[]> {
    const result = await this.db.execute(sql.raw(statement));
    return result.rows as T[];
  }

  async execute(statement: string): Promise<number> {
    const result = await this.db.execute(sql.raw(statement));
    return result.rowCount ?? 0;
  }

  transaction<T>(
    callback: (executor: SqlExecutor) => Promise<T>,
    isolationLevel: IsolationLevel = 'ReadCommitted',
  ): Promise<T> {
    return this.db.transaction(
      (transaction) =>
        callback(wrap(transaction as unknown as DrizzleExecutor)),
      {
        isolationLevel:
          isolationLevel === 'Serializable' ? 'serializable' : 'read committed',
      },
    );
  }

  async nestedSavepointProbe(): Promise<{
    outerPersisted: boolean;
    innerPersisted: boolean;
    mechanism: string;
  }> {
    const outerId = crypto.randomUUID();
    const innerId = crypto.randomUUID();

    await this.db.transaction(async (outer) => {
      await outer.execute(
        sql.raw(
          `INSERT INTO audit_events (public_id, market_id, actor_id, action, entity_type, entity_id, request_id) VALUES ('aud_outer_${outerId}', '00000000-0000-4000-8000-000000000001', '${outerId}', 'NESTED_OUTER', 'probe', '${outerId}', 'nested')`,
        ),
      );
      try {
        await outer.transaction(async (inner) => {
          await inner.execute(
            sql.raw(
              `INSERT INTO audit_events (public_id, market_id, actor_id, action, entity_type, entity_id, request_id) VALUES ('aud_inner_${innerId}', '00000000-0000-4000-8000-000000000001', '${innerId}', 'NESTED_INNER', 'probe', '${innerId}', 'nested')`,
            ),
          );
          throw new Error('intentional nested rollback');
        });
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== 'intentional nested rollback'
        ) {
          throw error;
        }
      }
    });

    const rows = await this.query<{ action: string }>(
      `SELECT action FROM audit_events WHERE entity_id IN ('${outerId}', '${innerId}') ORDER BY action`,
    );
    return {
      outerPersisted: rows.some((row) => row.action === 'NESTED_OUTER'),
      innerPersisted: rows.some((row) => row.action === 'NESTED_INNER'),
      mechanism: 'Drizzle nested transaction savepoint',
    };
  }
}
