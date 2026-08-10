// P8-S7 monitoring probe (host-run) — detects the OBS-04 class and the ops
// doc §7 indicator set on a live PostgreSQL. Template/validation form only:
// this probe is ops tooling, not a runtime dependency of the API.
//
// Indicators (each with definition, source query, threshold proposal — the
// threshold values are CONFIGURABLE proposals per O-5, not production policy):
//   1. idle-in-transaction sessions (age)          -> the OBS-04 class
//   2. reconciliation_runs RUNNING stall age       -> run_execute stall
//   3. connection pool saturation %                -> pool exhaustion
//   4. outbox PENDING backlog                      -> worker health
//   5. deadlock / rollback counter deltas          -> DB health (S6 method)
//
// Usage:
//   $env:DATABASE_URL='postgresql://ipoint:ipoint-local-only@127.0.0.1:55432/<db>'
//   node scripts/p8-s7/monitoring-probe.mjs
// Output: JSON with per-indicator { value, threshold, fired } + evidence rows.
import { createRequire } from 'node:module';

const require = createRequire(
  new URL('../../packages/database/package.json', import.meta.url),
);
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.');
}

// CONFIGURABLE proposal thresholds (O-5): S7 proposes; production values are
// a Bryan/Command Center production-launch decision, never hard-coded policy.
const THRESHOLDS = {
  idleInTransactionMaxSeconds: Number(
    process.env.P8S7_THRESHOLD_IDLE_SECONDS ?? 300,
  ),
  reconcileRunStallMaxSeconds: Number(
    process.env.P8S7_THRESHOLD_RUN_STALL_SECONDS ?? 300,
  ),
  poolSaturationMaxPercent: Number(
    process.env.P8S7_THRESHOLD_POOL_SATURATION_PERCENT ?? 80,
  ),
  outboxPendingMax: Number(process.env.P8S7_THRESHOLD_OUTBOX_PENDING ?? 100),
};

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

async function snapshot() {
  const outboxTable = await pool.query(
    `SELECT to_regclass('public.transaction_commission_dispatch') AS t`,
  );
  const hasOutbox = outboxTable.rows[0]?.t !== null;

  const idle = await pool.query(
    `SELECT
       count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_tx_count,
       coalesce(max(extract(epoch FROM (now() - xact_start)))::int, 0) AS max_idle_tx_age_seconds,
       count(*) FILTER (WHERE state = 'idle in transaction' AND query ILIKE '%reconciliation_runs%')::int AS idle_tx_reconcile_count
     FROM pg_stat_activity
     WHERE datname = current_database() AND pid <> pg_backend_pid()`,
  );

  const connections = await pool.query(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (WHERE state = 'active')::int AS active,
       count(*) FILTER (WHERE state = 'idle')::int AS idle
     FROM pg_stat_activity
     WHERE datname = current_database() AND pid <> pg_backend_pid()`,
  );
  const maxConnections = await pool.query(
    `SELECT current_setting('max_connections')::int AS max_connections`,
  );

  const stalledRuns = await pool.query(
    `SELECT count(*)::int AS n,
            coalesce(max(extract(epoch FROM (now() - started_at)))::int, 0) AS max_stall_seconds
     FROM reconciliation_runs
     WHERE status = 'RUNNING' AND started_at IS NOT NULL`,
  );

  const deadlocks = await pool.query(
    `SELECT xact_rollback, deadlocks
     FROM pg_stat_database
     WHERE datname = current_database()`,
  );

  const outbox = hasOutbox
    ? await pool.query(
        `SELECT count(*)::int AS pending,
                coalesce(max(extract(epoch FROM (now() - created_at)))::int, 0) AS max_pending_age_seconds
         FROM transaction_commission_dispatch
         WHERE status = 'PENDING'`,
      )
    : null;

  return {
    idle: idle.rows[0],
    connections: connections.rows[0],
    maxConnections: maxConnections.rows[0]?.max_connections ?? 100,
    stalledRuns: stalledRuns.rows[0],
    deadlocks: deadlocks.rows[0],
    outbox: outbox?.rows[0] ?? null,
  };
}

try {
  const s = await snapshot();

  const poolSaturationPercent = Math.round(
    ((s.connections?.total ?? 0) / (s.maxConnections ?? 100)) * 100,
  );

  const indicators = {
    idle_in_transaction: {
      definition: 'OBS-04 class — sessions idle in transaction (age seconds)',
      value: s.idle?.max_idle_tx_age_seconds ?? 0,
      sessions: s.idle?.idle_tx_count ?? 0,
      reconcilePathSessions: s.idle?.idle_tx_reconcile_count ?? 0,
      thresholdSeconds: THRESHOLDS.idleInTransactionMaxSeconds,
      fired: (s.idle?.max_idle_tx_age_seconds ?? 0) > THRESHOLDS.idleInTransactionMaxSeconds,
    },
    reconciliation_run_stall: {
      definition: 'reconciliation run_execute stall — RUNNING runs older than threshold',
      value: s.stalledRuns?.max_stall_seconds ?? 0,
      runningRuns: s.stalledRuns?.n ?? 0,
      thresholdSeconds: THRESHOLDS.reconcileRunStallMaxSeconds,
      fired:
        (s.stalledRuns?.n ?? 0) > 0 &&
        (s.stalledRuns?.max_stall_seconds ?? 0) > THRESHOLDS.reconcileRunStallMaxSeconds,
    },
    connection_pool_saturation: {
      definition: 'pool saturation — active+idle sessions vs max_connections',
      value: poolSaturationPercent,
      totalSessions: s.connections?.total ?? 0,
      activeSessions: s.connections?.active ?? 0,
      maxConnections: s.maxConnections ?? 100,
      thresholdPercent: THRESHOLDS.poolSaturationMaxPercent,
      fired: poolSaturationPercent >= THRESHOLDS.poolSaturationMaxPercent,
    },
    outbox_pending_backlog: {
      definition: 'outbox worker health — PENDING dispatch rows and age',
      value: s.outbox?.pending ?? 0,
      maxPendingAgeSeconds: s.outbox?.max_pending_age_seconds ?? 0,
      threshold: THRESHOLDS.outboxPendingMax,
      fired: (s.outbox?.pending ?? 0) > THRESHOLDS.outboxPendingMax,
    },
    db_deadlock_delta: {
      definition: 'DB health — pg_stat_database deadlock counter (delta between snapshots)',
      value: s.deadlocks?.deadlocks ?? 0,
      txnRollbacks: s.deadlocks?.xact_rollback ?? 0,
      threshold: 0,
      fired: false, // delta semantics: compare two probe runs
    },
  };

  const firedAny = Object.values(indicators).some((i) => i.fired);
  console.log(JSON.stringify({ indicators, firedAny }, null, 2));
  console.log(firedAny ? 'PROBE_RESULT: ALERT' : 'PROBE_RESULT: OK');
} finally {
  await pool.end().catch(() => undefined);
}
