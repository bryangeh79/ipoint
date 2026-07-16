import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';

import type {
  IsolationLevel,
  OrmHarness,
  QueryResultRow,
  SqlExecutor,
} from '../shared/harness.js';

type PrismaExecutor = Pick<
  PrismaClient,
  '$queryRawUnsafe' | '$executeRawUnsafe'
>;

const wrap = (executor: PrismaExecutor): SqlExecutor => ({
  async query<T extends QueryResultRow>(statement: string): Promise<T[]> {
    return executor.$queryRawUnsafe<T[]>(statement);
  },
  async execute(statement: string): Promise<number> {
    return executor.$executeRawUnsafe(statement);
  },
});

export class PrismaHarness implements OrmHarness {
  readonly name = 'prisma' as const;
  readonly pool: Pool;
  readonly client: PrismaClient;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 20 });
    this.client = new PrismaClient({ adapter: new PrismaPg(this.pool) });
  }

  async connect(): Promise<void> {
    await this.client.$connect();
  }

  async disconnect(): Promise<void> {
    await this.client.$disconnect();
    await this.pool.end();
  }

  query<T extends QueryResultRow>(statement: string): Promise<T[]> {
    return this.client.$queryRawUnsafe<T[]>(statement);
  }

  execute(statement: string): Promise<number> {
    return this.client.$executeRawUnsafe(statement);
  }

  transaction<T>(
    callback: (executor: SqlExecutor) => Promise<T>,
    isolationLevel: IsolationLevel = 'ReadCommitted',
  ): Promise<T> {
    return this.client.$transaction(
      (transaction) => callback(wrap(transaction as PrismaExecutor)),
      { isolationLevel: Prisma.TransactionIsolationLevel[isolationLevel] },
    );
  }

  async nestedSavepointProbe(): Promise<{
    outerPersisted: boolean;
    innerPersisted: boolean;
    mechanism: string;
  }> {
    const outerId = crypto.randomUUID();
    const innerId = crypto.randomUUID();
    let mechanism = 'Prisma interactive transaction + SQL SAVEPOINT';

    await this.client.$transaction(async (outer) => {
      await outer.$executeRawUnsafe(
        `INSERT INTO audit_events (public_id, market_id, actor_id, action, entity_type, entity_id, request_id) VALUES ('aud_outer_${outerId}', '00000000-0000-4000-8000-000000000001', '${outerId}', 'NESTED_OUTER', 'probe', '${outerId}', 'nested')`,
      );

      const nested = outer as unknown as {
        $transaction?: <T>(
          callback: (inner: PrismaExecutor) => Promise<T>,
        ) => Promise<T>;
      };

      try {
        if (nested.$transaction !== undefined) {
          mechanism = 'Prisma 7.8 nested $transaction savepoint';
          await nested.$transaction(async (inner) => {
            await inner.$executeRawUnsafe(
              `INSERT INTO audit_events (public_id, market_id, actor_id, action, entity_type, entity_id, request_id) VALUES ('aud_inner_${innerId}', '00000000-0000-4000-8000-000000000001', '${innerId}', 'NESTED_INNER', 'probe', '${innerId}', 'nested')`,
            );
            throw new Error('intentional nested rollback');
          });
        } else {
          await outer.$executeRawUnsafe('SAVEPOINT poc_nested');
          try {
            await outer.$executeRawUnsafe(
              `INSERT INTO audit_events (public_id, market_id, actor_id, action, entity_type, entity_id, request_id) VALUES ('aud_inner_${innerId}', '00000000-0000-4000-8000-000000000001', '${innerId}', 'NESTED_INNER', 'probe', '${innerId}', 'nested')`,
            );
            throw new Error('intentional nested rollback');
          } catch {
            await outer.$executeRawUnsafe('ROLLBACK TO SAVEPOINT poc_nested');
          }
        }
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
      mechanism,
    };
  }
}
