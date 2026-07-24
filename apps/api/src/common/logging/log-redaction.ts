const SAFE_DATABASE_CODES = new Set([
  '23505',
  '23514',
  '40001',
  '40P01',
  '55P03',
  '57014',
]);

export interface SafeErrorMetadata {
  errorName: string;
  databaseCode?: string;
}

export function safeErrorMetadata(error: Error): SafeErrorMetadata {
  const databaseCode = findDatabaseCode(error);
  return {
    errorName: error.name,
    ...(databaseCode ? { databaseCode } : {}),
  };
}

export function safeRequestRoute(request: {
  baseUrl?: string;
  route?: { path?: unknown };
}): string {
  const routePath = request.route?.path;
  if (typeof routePath !== 'string') return 'unmatched';
  return `${request.baseUrl ?? ''}${routePath}`;
}

function findDatabaseCode(error: unknown): string | undefined {
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const record = current as Record<string, unknown>;
    const code = record['code'];
    if (typeof code === 'string' && SAFE_DATABASE_CODES.has(code)) {
      return code;
    }
    current = record['cause'];
  }
  return undefined;
}
