export interface RateLimitPort {
  consume(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimiter implements RateLimitPort {
  private readonly buckets = new Map<string, Bucket>();

  consume(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const now = Date.now();
    const current = this.buckets.get(key);
    const bucket =
      !current || current.resetAt <= now
        ? { count: 0, resetAt: now + windowSeconds * 1000 }
        : current;
    bucket.count += 1;
    this.buckets.set(key, bucket);
    return Promise.resolve(bucket.count <= limit);
  }
}
