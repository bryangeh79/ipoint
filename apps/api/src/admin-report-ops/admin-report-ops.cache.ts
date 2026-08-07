import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ReportFreshnessClass } from './admin-report-ops.types.js';
import { REPORT_FRESHNESS_BOUND_MS } from './admin-report-ops.types.js';
import type { ReportValue } from './admin-report-ops.types.js';

export interface CachedReportEntry {
  value: ReportValue;
  /** Source-query time stored at compute time (never the cache-read time). */
  asOf: string;
  /** Wall-clock time the entry was computed/stored. */
  computedAt: number;
}

/**
 * Short-lived snapshot cache for bounded reports (P7-S9 §7.2).
 *
 * - TTL is bounded by the report freshness class (60s QUEUE / 5m KPI), so
 *   a cache hit can never be fresher than the freshness SLA.
 * - The cache is NOT the source of truth: `asOf` always comes from the
 *   source-query time captured when the entry was computed.
 * - Entries older than the freshness bound are treated as expired on read
 *   (the caller re-queries the canonical source), but are NOT deleted: when
 *   a live re-query fails, the previous snapshot MAY be served explicitly
 *   marked STALE (`stale = true`) — it is never presented as fresh data.
 *   Expired entries are pruned on the next `set` (bounded LRU size).
 */
@Injectable()
export class ReportSnapshotCache {
  private readonly store = new Map<string, CachedReportEntry>();
  private readonly ttlMs: Record<ReportFreshnessClass, number>;
  private readonly maxEntries: number;

  constructor(
    @Optional()
    @Inject('REPORT_CACHE_MAX_ENTRIES')
    maxEntries?: number,
  ) {
    this.maxEntries = Math.max(1, maxEntries ?? 128);
    this.ttlMs = REPORT_FRESHNESS_BOUND_MS;
  }

  key(reportId: string, marketId: string): string {
    return `${reportId}:${marketId}`;
  }

  get(
    reportId: string,
    marketId: string,
    freshnessClass: ReportFreshnessClass,
  ): CachedReportEntry | undefined {
    const entry = this.store.get(this.key(reportId, marketId));
    if (!entry) return undefined;
    const ageMs = Date.now() - entry.computedAt;
    if (ageMs > this.ttlMs[freshnessClass]) return undefined;
    return entry;
  }

  /**
   * Raw snapshot lookup that ignores the TTL — used ONLY to serve the
   * previous snapshot explicitly marked STALE after a live re-query
   * failed. Never used to serve fresh data.
   */
  peek(reportId: string, marketId: string): CachedReportEntry | undefined {
    return this.store.get(this.key(reportId, marketId));
  }

  set(reportId: string, marketId: string, entry: CachedReportEntry): void {
    const key = this.key(reportId, marketId);
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
