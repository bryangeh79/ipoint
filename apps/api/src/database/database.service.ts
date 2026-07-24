import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, type Database } from '@ipoint/database';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';

export interface TransactionExecutionOptions {
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  maxRetries: number;
}

const RETRYABLE_TRANSACTION_CODES = new Set(['40001', '40P01']);

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly db: Database;
  readonly pool: Pool;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const database = createDatabase(config.databaseUrl);
    this.db = database.db;
    this.pool = database.pool;
  }

  async runTransaction<T>(
    cb: (
      tx: Database['transaction'] extends (cb: infer C) => unknown
        ? C extends (tx: infer T) => unknown
          ? T
          : never
        : never,
    ) => Promise<T>,
    options?: TransactionExecutionOptions,
  ): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.db.transaction(async (tx) => {
          if (options) {
            await tx.execute(sql`
              SELECT
                set_config(
                  'statement_timeout',
                  ${`${options.statementTimeoutMs}ms`},
                  true
                ),
                set_config(
                  'lock_timeout',
                  ${`${options.lockTimeoutMs}ms`},
                  true
                )
            `);
          }
          return cb(tx);
        });
      } catch (error) {
        if (
          !options ||
          attempt >= options.maxRetries ||
          !isRetryableTransactionError(error)
        ) {
          throw error;
        }
        attempt += 1;
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

export function isRetryableTransactionError(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const record = current as Record<string, unknown>;
    if (
      typeof record['code'] === 'string' &&
      RETRYABLE_TRANSACTION_CODES.has(record['code'])
    ) {
      return true;
    }
    current = record['cause'];
  }
  return false;
}
