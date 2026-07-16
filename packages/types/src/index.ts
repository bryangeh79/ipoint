export type MarketCode = string;

export interface HealthStatus {
  status: 'ok' | 'degraded';
  service: string;
  timestamp: string;
  version: string;
}
