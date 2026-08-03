import { Inject, Injectable, Optional } from '@nestjs/common';
import type { DashboardFreshnessClass } from './admin-dashboard.types.js';
import { DASHBOARD_FRESHNESS_BOUND_MS } from './admin-dashboard.types.js';

export interface CachedMetricEntry {
  value: unknown;
  /** Source-query time stored at compute time (never the cache-read time). */
  asOf: string;
  /** Wall-clock time the entry was computed/stored. */
  computedAt: number;
}

/**
 * Short-lived optional cache for dashboard read models (P7-S4A 4.5).
 *
 * - Cache TTL is bounded by the metric freshness class (60s QUEUE / 5m KPI),
 *   so a cache hit can never be fresher than the freshness SLA.
 * - The cache is NOT the source of truth: `asOf` always comes from the source
 *   query time captured when the entry was computed.
 * - Entries older than the freshness bound are evicted on read; the caller
 *   re-queries the canonical source.
 */
@Injectable()
export class DashboardMetricCache {
  private readonly store = new Map<string, CachedMetricEntry>();
  private readonly ttlMs: Record<DashboardFreshnessClass, number>;

  constructor(
    @Optional()
    @Inject('DASHBOARD_CACHE_MAX_ENTRIES')
    maxEntries?: number,
  ) {
    this.maxEntries = Math.max(1, maxEntries ?? 256);
    this.ttlMs = DASHBOARD_FRESHNESS_BOUND_MS;
  }

  private readonly maxEntries: number;

  key(metricId: string, marketId: string): string {
    return `${metricId}:${marketId}`;
  }

  get(
    metricId: string,
    marketId: string,
    freshnessClass: DashboardFreshnessClass,
  ): CachedMetricEntry | undefined {
    const key = this.key(metricId, marketId);
    const entry = this.store.get(key);
    if (!entry) return undefined;
    const ageMs = Date.now() - entry.computedAt;
    if (ageMs > this.ttlMs[freshnessClass]) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  set(metricId: string, marketId: string, entry: CachedMetricEntry): void {
    const key = this.key(metricId, marketId);
    this.store.set(key, entry);
    if (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
  }

  clear(): void {
    this.store.clear();
  }
}
