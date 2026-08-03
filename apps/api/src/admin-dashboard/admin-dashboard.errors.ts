import {
  DashboardError,
  type DashboardErrorCode,
} from './admin-dashboard.types.js';

function dashboardError(
  code: DashboardErrorCode,
  message: string,
  details?: Record<string, unknown>,
): DashboardError {
  return new DashboardError(code, message, details);
}

export function dashboardMetricUndefinedError(
  metricId: string,
): DashboardError {
  return dashboardError(
    'DASHBOARD_METRIC_UNDEFINED',
    'This metric is not available.',
    { metricId },
  );
}

export function dashboardDataUnavailableError(
  metricId: string,
  reason: string,
): DashboardError {
  return dashboardError(
    'DASHBOARD_DATA_UNAVAILABLE',
    'This metric is currently unavailable.',
    { metricId, reason },
  );
}

export function dashboardDataStaleError(
  metricId: string,
  asOf: string,
): DashboardError {
  return dashboardError('DASHBOARD_DATA_STALE', 'This metric is out of date.', {
    metricId,
    asOf,
  });
}

export function dashboardFilterInvalidError(message: string): DashboardError {
  return dashboardError('DASHBOARD_FILTER_INVALID', message);
}
