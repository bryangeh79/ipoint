import type { Pool } from 'pg';

export interface QueryResultRow {
  [column: string]: unknown;
}

export interface SqlExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    statement: string,
  ): Promise<T[]>;
  execute(statement: string): Promise<number>;
}

export type IsolationLevel = 'ReadCommitted' | 'Serializable';

export interface OrmHarness {
  readonly name: 'prisma' | 'drizzle';
  readonly pool: Pool;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  query<T extends QueryResultRow = QueryResultRow>(
    statement: string,
  ): Promise<T[]>;
  execute(statement: string): Promise<number>;
  transaction<T>(
    callback: (executor: SqlExecutor) => Promise<T>,
    isolationLevel?: IsolationLevel,
  ): Promise<T>;
  nestedSavepointProbe(): Promise<{
    outerPersisted: boolean;
    innerPersisted: boolean;
    mechanism: string;
  }>;
}

export const quote = (value: string): string =>
  `'${value.replaceAll("'", "''")}'`;

export const errorText = (error: unknown): string =>
  error instanceof Error
    ? `${error.name}: ${error.message} ${JSON.stringify(error)}`
    : String(error);

export const hasSqlState = (error: unknown, state: string): boolean => {
  const candidate = error as {
    code?: string;
    meta?: {
      code?: string;
      message?: string;
      database_error?: { code?: string };
    };
    cause?: unknown;
  };
  return (
    candidate.code === state ||
    candidate.meta?.code === state ||
    candidate.meta?.database_error?.code === state ||
    candidate.meta?.message?.includes(state) === true ||
    errorText(error).includes(state) ||
    (candidate.cause !== undefined && hasSqlState(candidate.cause, state))
  );
};
