import type { RedisClientProvider } from './redis.client.js';

/**
 * FIFO queue port for NON-critical dispatch only.
 *
 * P8-S7 contract boundary (gap audit F-02 / O-2): the Redis queue is a
 * cross-instance coordination primitive for non-critical dispatch (e.g.
 * notification fan-out, cache warming). The outbox worker
 * (`transaction-commission-outbox.worker.ts`, PG-based exactly-once) stays
 * PG-backed and untouched — PostgreSQL remains the source of truth for all
 * business state.
 */
export interface QueuePort {
  /**
   * Push a message to the tail of the queue. Returns the new queue length.
   * When Redis is unreachable the queue degrades to a no-op and returns 0
   * (non-critical dispatch only — never business-critical state).
   */
  enqueue(queue: string, message: string): Promise<number>;
  /**
   * Pop the head of the queue, blocking up to `timeoutSeconds`. Returns
   * null when the queue is empty or Redis is unreachable.
   */
  dequeue(queue: string, timeoutSeconds: number): Promise<string | null>;
  /** Current queue length (0 when Redis is unreachable). */
  length(queue: string): Promise<number>;
}

/**
 * Redis-backed `QueuePort` (RPUSH / BLPOP / LLEN, FIFO order).
 */
export class RedisQueue implements QueuePort {
  private readonly namespace: string;

  constructor(
    private readonly clientProvider: RedisClientProvider,
    options: { namespace?: string } = {},
  ) {
    this.namespace = options.namespace ?? 'ipoint:queue';
  }

  async enqueue(queue: string, message: string): Promise<number> {
    try {
      const length = await this.clientProvider
        .getClient()
        .rpush(`${this.namespace}:${queue}`, message);
      return length;
    } catch {
      return 0;
    }
  }

  async dequeue(queue: string, timeoutSeconds: number): Promise<string | null> {
    try {
      const reply = await this.clientProvider
        .getClient()
        .blpop(`${this.namespace}:${queue}`, timeoutSeconds);
      if (!reply) return null;
      return reply[1] ?? null;
    } catch {
      return null;
    }
  }

  async length(queue: string): Promise<number> {
    try {
      const length = await this.clientProvider
        .getClient()
        .llen(`${this.namespace}:${queue}`);
      return length;
    } catch {
      return 0;
    }
  }
}
