import { AsyncLocalStorage } from 'node:async_hooks';

import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import type { OrmHarness, SqlExecutor } from './harness.js';

export abstract class ExperimentalOrmProvider
  implements OnModuleInit, OnModuleDestroy
{
  private readonly transactionStorage = new AsyncLocalStorage<SqlExecutor>();

  protected constructor(readonly harness: OrmHarness) {}

  async onModuleInit(): Promise<void> {
    await this.harness.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.harness.disconnect();
  }

  currentTransaction(): SqlExecutor | undefined {
    return this.transactionStorage.getStore();
  }

  async runInTransaction<T>(callback: () => Promise<T>): Promise<T> {
    return this.harness.transaction((transaction) =>
      this.transactionStorage.run(transaction, callback),
    );
  }
}
