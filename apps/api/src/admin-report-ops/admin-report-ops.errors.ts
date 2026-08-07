import { ReportError } from './admin-report-ops.types.js';

/** The market does not exist. */
export function reportMarketNotFoundError(): ReportError {
  return new ReportError(
    'REPORT_MARKET_NOT_FOUND',
    'The market was not found.',
  );
}

/** The report id is not part of the server-owned catalog. */
export function reportUndefinedError(reportId: string): ReportError {
  return new ReportError('REPORT_UNDEFINED', `Unknown report: ${reportId}`, {
    reportId,
  });
}

/**
 * The report has no compliant value right now (no durable source or the
 * source query failed with no previous snapshot). The response NEVER
 * fabricates a zero for an unavailable source.
 */
export function reportDataUnavailableError(
  reportId: string,
  reason: 'NO_DURABLE_SOURCE' | 'SOURCE_QUERY_FAILED',
): ReportError {
  return new ReportError(
    'REPORT_DATA_UNAVAILABLE',
    `Report ${reportId} is unavailable (${reason}).`,
    { reportId, reason },
  );
}

/** The report is being served from an explicitly stale snapshot. */
export function reportDataStaleError(
  reportId: string,
  asOf: string,
): ReportError {
  return new ReportError(
    'REPORT_DATA_STALE',
    `Report ${reportId} is stale (as of ${asOf}).`,
    { reportId, asOf },
  );
}
