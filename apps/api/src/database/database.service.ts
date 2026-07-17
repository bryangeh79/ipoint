import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, type Database } from '@ipoint/database';
import type { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';

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
  ): Promise<T> {
    return this.db.transaction(cb);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
