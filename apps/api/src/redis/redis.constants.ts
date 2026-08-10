/**
 * P8-S7 Redis module — dependency tokens.
 *
 * The Redis module introduces the distributed primitives behind the
 * existing service boundaries (contract G-07 / gap audit F-02):
 *   - `LOCK_PORT`  — distributed lock for cross-instance coordination on
 *     NON-correctness surfaces only (never on PG financial write paths);
 *   - `QUEUE_PORT` — FIFO queue for non-critical dispatch only (the PG
 *     outbox worker stays the exactly-once path for business dispatch).
 *
 * PostgreSQL remains the source of truth for all business state. Redis
 * lock/queue must never replace or weaken any PG-based correctness
 * mechanism (advisory locks, idempotency keys, outbox exactly-once,
 * reconciliation withIdempotency).
 *
 * @packageDocumentation
 */

export const LOCK_PORT = Symbol('LOCK_PORT');
export const QUEUE_PORT = Symbol('QUEUE_PORT');
