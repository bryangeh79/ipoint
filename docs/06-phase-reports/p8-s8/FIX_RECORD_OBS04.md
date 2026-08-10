# FIX-005 - OBS-04 Engine Fix Record: reconciliation detect queries scoped to the transaction client

> Phase 8 - Bounded engine remediation (D-075 Option A) - Branch `fix/p8-obs04-engine`
> Authorized by: D-075 (Bryan, 2026-08-10) - "Option A - bounded engine remediation AUTHORIZED":
> reconciliation `detect*` methods take the tx-scoped client; pool acquire timeout via pool
> config where available; L-4 FOR UPDATE OF narrowing evaluated and recorded; frozen
> `DatabaseManager` foundation NOT modified without re-escalation.
> Executor: D-060 alternate executor (Codex CLI unavailable for this round).
> Related evidence: `docs/06-phase-reports/p8-s6/P8_S6_LOAD_PERFORMANCE_CONCURRENCY_REPORT.md` §9
> (OBS-04), `apps/api/.local/p8-s6-load/2026-08-10T08-44Z-j10-l2-rerun-stall/OBSERVATION.md`
> (round-1 stall reproduction snapshot), FIX-002 (`1db4fb69`, reconciliation withIdempotency
> timeouts), FIX-004 (`d6bab1da`, adjust-owner call-site timeouts).

---

## 1. Defect

**OBS-04 (High) - residual engine-level part:** the reconciliation run-execute path ran
pool-level queries (`DatabaseService.pool.query`) from INSIDE an open write transaction
(the `detect*` difference-detection queries invoked by `executeRun` inside
`withIdempotency`). Under sustained concurrent executes (20-way at L2), every in-flight
transaction held one pooled connection while its `detect*` queries waited for a FURTHER
pool connection. With a 10-connection pool and 20 concurrent transactions, all 10 pooled
sessions were simultaneously held by transactions that were themselves waiting on the
pool queue -> **pool-level deadlock**: 10/10 sessions "idle in transaction / ClientRead"
on `update reconciliation_runs`, requests blocked on the pool queue indefinitely. FIX-002's
statement/lock timeouts cannot fire because no statement is executing and no lock wait is
pending (client idle between its own statements); FIX-004 closed only the J3/J9
adjust-chain sub-class (different mechanism: unbounded lock waits on missing timeouts).

**Reproduction ledger (round-1 re-run, 2026-08-10 ~16:43 MYT, post-FIX-004):**
`pnpm vitest run src/load/load.spec.ts -t "J10 reconciliation"` at `P8S6_LOAD_LEVEL=L2`
against a fresh `ipoint_p8s6_*` DB. Test exceeded the 300s vitest timeout; `afterAll`
hung in `app.close()` (pool.end() cannot complete while 10 connections are stuck
idle-in-transaction); process killed manually at ~16:56 MYT. `pg_stat_activity` snapshots
(45s in and ~7 min in): **10/10 pooled sessions idle in transaction / ClientRead on
`update "reconciliation_runs" set "status" = $1, "started_at" = $2 ...`**, tx_age =
query_age = 4:42. After killing the Node client, PostgreSQL aborted all 10 sessions within
seconds (client-side connection lifecycle; no DB-side leak).

## 2. Root cause (exact positions)

All pool-level queries inside the `executeRun` write transaction, in
`apps/api/src/admin-reconciliation-ops/admin-reconciliation-ops.service.ts`:

| Site (pre-fix) | Line ref (HEAD `57c6d920`) | Query |
| --- | --- | --- |
| `detectMcp` | ~689 | ledger net vs maintained balances (`mcp_accounts`/`mcp_ledger_entries`) |
| `detectIpoint` | ~752 | wallet-entry ledger invariant (`member_wallet_entries`) |
| `detectTransactionLedger` | ~805 | tx-to-ledger + reward source (`transactions`/`transaction_mcp_debits`/`reward_sources`) |
| `detectCommission` | ~886 + market lookup | commission posting completeness (`commission_processing`/`commission_ledger`, `markets`) |
| `detectRefund` | ~963 + ~1018 | refund compensating credits (mcp + redemption refunds) |
| `detectRedemption` | ~1099 | redemption order debits + vouchers (`redemption_orders`) |
| `runNotFound` / `exceptionNotFound` | ~1209/~1229 | 404 lookups called from `lockRun`/`lockException` INSIDE the transaction |

Mechanism: `executeRun` -> `withIdempotency` -> handler(tx) -> `this.detect(...)` ->
`this.database.pool.query(...)` = a NEW pool acquisition per detection query while the
transaction already holds a connection. Under 20-way concurrency with pool max 10, the
pool cannot serve the nested acquisitions (all connections held by sibling transactions)
-> each holding transaction idles forever on the queue -> the exact 10/10
idle-in-transaction signature observed.

## 3. Fix (production diff: 1 file, `admin-reconciliation-ops.service.ts`)

- `detect` and all six `detect*` methods now take the transaction-scoped client
  (`tx: DatabaseTransaction`) as their first parameter; every detection query runs via
  `tx.execute(sql`...`)` - **never a fresh pool acquisition** - and the dispatcher +
  `executeRun` call site thread `tx` through.
- `runNotFound`/`exceptionNotFound` accept an optional transaction client: `lockRun` /
  `lockException` (in-transaction callers) pass `tx`; controller-level callers
  (`runById`/`exceptionById`, outside any transaction) keep the pool path.
- Zero behavior change: the SQL text is byte-identical (positional `$n` params become
  drizzle `sql`-template params in the same order; Date/uuid/`::numeric`/`::int` values
  serialize identically through the same pg driver). Detection remains strictly
  read-only; frozen financial tables are never written; no migration; no checksum
  change; no config change; no dependency change.
- After the fix, zero pool-level queries remain inside any reconciliation transaction:
  every statement in the `withIdempotency` handler paths (`executeRun`, `createRun`,
  `cancelRun`, exception actions) runs on the transaction client (`lockRun`,
  `lockException`, status updates, inserts, finalize, `writeAudit` ->
  `audit.appendWithinTransaction` were already tx-scoped; only `detect*` and the
  not-found lookups were pool-level).

## 4. Pool acquire timeout - deployment configuration item (D-075 item 2)

Investigated whether `connectionTimeoutMillis` (pool acquire timeout) is settable at the
config layer (CONFIGURABLE value) without touching frozen code:

- The env contract exposes only `DATABASE_URL` (`packages/config/src/index.ts`,
  `createDatabase(config.databaseUrl)` -> `packages/database/src/client.ts` ->
  `new Pool({ connectionString })`).
- Verified with the installed stack (pg 8.22.0 / pg-pool 3.14.0 /
  pg-connection-string 2.14.0, runtime probe `apps/api/.local/scratch-pool-timeout.mjs`):
  **a URL query parameter does NOT set the pool acquire timeout** - pg-pool reads
  `options.connectionTimeoutMillis` from the Pool options object, which is not populated
  from the connection string. A `?connectionTimeoutMillis=` URL param only flows into the
  per-client TCP `connect_timeout` (ConnectionParameters, seconds), i.e. bounds stuck
  socket connects, not pool-queue waits.
- Setting the pool acquire timeout therefore requires a change to the frozen foundation
  (`packages/database/src/client.ts`, `createDatabase`) - prohibited by D-075
  ("frozen `DatabaseManager` foundation NOT modified without re-escalation") and by
  P8-S9 Do-Not-Touch ("packages/database/** zero change").
- **Disposition:** recorded as a DEPLOYMENT CONFIGURATION ITEM, escalated to the Command
  Center: if a pool acquire timeout is required as defense-in-depth, the frozen
  `createDatabase` must accept an optional pool config (e.g. a new
  `DATABASE_POOL_CONNECTION_TIMEOUT_MS` env contract value) under a future bounded
  authorization. Not required for OBS-04 closure: the primary fix removes the only
  in-transaction pool acquisition on the reconciliation path, so the deadlock class
  cannot recur there (proven by the L2 storm acceptance, §6). Optional deployment
  hardening without code change: `?connect_timeout=`/`?statement_timeout=`/`?lock_timeout=`
  /`?idle_in_transaction_session_timeout=` URL params on DATABASE_URL (session-level
  startup params) - note the S6 design invariant "0 session defaults, as designed" (§7 of
  the S6 report) before setting session-wide timeouts.

## 5. L-4 evaluation - FOR UPDATE OF narrowing (D-075 item 3)

Reviewer L-4 suggested lock-target narrowing (`FOR UPDATE OF`) for the reconciliation
lock statements. Evaluation:

- The only FOR UPDATE statements on the reconciliation path are `lockRun` and
  `lockException` - both single-table queries (`SELECT * FROM reconciliation_runs WHERE
  id/market_id ... FOR UPDATE`, same for `reconciliation_exceptions`), **no joins, no
  lock amplification**: the lock set is already exactly the intended row(s).
  `FOR UPDATE OF reconciliation_runs` would produce an identical lock set - a no-op.
- OBS-04's root cause is pool acquisition inside an open transaction, not lock scope:
  FOR UPDATE OF narrowing would have zero effect on the stall. Lock waiters are already
  bounded by FIX-002 (`lock_timeout` 3s via `withIdempotency`; bounded 55P03 outcomes are
  documented as OBS-02).
- **Decision:** NOT APPLICABLE - no code change. Note for the future: if `lockRun`/
  `lockException` ever gain a JOIN, add `FOR UPDATE OF <table>` at the same time to keep
  the lock target explicit.

## 6. Verification (real environment, host)

All runs on host (Node 26.4.0, PostgreSQL 17.10 @ 127.0.0.1:55432), dedicated fresh
`ipoint_p8s6_*` / `ipoint_p8s2_*` databases, fail-closed destructive guards.

| Check | Command | Result |
| --- | --- | --- |
| P8-S2 unit | `pnpm vitest run src/admin-reconciliation-ops/admin-reconciliation-ops.spec.ts` | **7/7 PASS** |
| P8-S2 integration (real PG) | `P8S2_DESTRUCTIVE_TEST=1 DATABASE_URL=...ipoint_p8s2_obs04 pnpm vitest run src/admin-reconciliation-ops/admin-reconciliation-ops.integration.spec.ts` | **18/18 PASS** (all detect kinds: MCP/iPoint/transaction-ledger/commission/refund/redemption + lifecycle + market isolation + frozen-tables guard) |
| S6 load L0 (CI shape) | `P8S6_LOAD_LEVEL=L0 pnpm vitest run src/load/load.spec.ts` | **17/17 PASS** |
| **J10 L2 acceptance (stall recipe)** | `P8S6_LOAD_LEVEL=L2 pnpm vitest run src/load/load.spec.ts -t "J10 reconciliation"` | **PASS in 11.4s** - see §6.1 |
| Regression J2 L2 | same harness `-t "J2 transactions"` | PASS, 1600 samples, 0 unexpected |
| Regression J3 L2 | same harness `-t "J3 MCP debit"` | PASS, 2000 samples, 0 unexpected |
| Zero-owner-bypass re-scan | `node .local/p8-s5e/scan-zerobypass.mjs` (S5e method) | 478 files, 13 benign keyword hits (same classes as S5e baseline: helper default-params incl. the pre-existing `text` helper - not part of this diff; explicit no-fallback comment; UAT scenario names), **0 direct owner bypass** |
| CI-equivalent | `tsc -p tsconfig.build.json --noEmit`; `pnpm build`; eslint (changed files); prettier (changed files) | all clean |

### 6.1 J10 L2 acceptance - before vs after

**Before (round-1 re-run, 2026-08-10 16:43 MYT, post-FIX-004, HEAD `57c6d920`):**
stalled - 300s vitest timeout, teardown hang, manual kill ~16:56; pg_stat_activity
10/10 idle-in-transaction on `update reconciliation_runs` (tx_age 4:42). Evidence:
`apps/api/.local/p8-s6-load/2026-08-10T08-44Z-j10-l2-rerun-stall/OBSERVATION.md`.

**After (fix branch, evidence `apps/api/.local/p8-s6-load/2026-08-10T14-31-59.250Z-p8s6-l2/`):**

- Measured ops (the exact pre-fix stall recipe - 20-way sustained): run-execute **n=400,
  0 errors, 0 unexpected, all 200, p50 73ms / p99 104ms**; run-create 3, run-list 400,
  run-detail 400, exceptions-list 400 - all 0 unexpected.
- Same-run storm (new acceptance shape): **3 waves x 20 concurrent executes = 60/60
  status 200, 0 client-timeouts, 0 unexpected, final state COMPLETED every wave**,
  replay same-key -> same run (no second execution).
- `pg_stat_activity` (dedicated sampler, mid-wave + post-wave x 3): **idle-in-transaction
  = 0 at all 6 samples** (pre-fix: 10/10).
- Journey wall time 14.5s (pre-fix: never completed).

### 6.2 Harness change

`apps/api/src/load/journeys/j10-reconciliation.ts`: the same-run execute storm now runs
at L2 (20-way, 3 waves, sustained) with a pg_stat_activity idle-in-transaction sampler
between waves; L1 keeps its historical 2-way evidence shape; the measured L2 ops keep
the default 20-way profile (run-create stays serial - setup op). Bounded lock-timeout
waiters (OBS-02, 55P03) remain a documented expected storm outcome; any other status,
non-55P03 500, or client-side timeout fails the storm assertion. This replaces the
pre-fix OBS-04 caps that the round-1 evidence required.

## 7. Do-Not-Touch compliance

- `packages/database/**` zero change (frozen foundation untouched); migrations
  `0000-0039` + `checksums.json` **40/40 untouched**.
- No merge to main/phase/8; no deployment; no test deletion; no TS/lint/config changes;
  no `.npmrc`; no untracked-baseline additions; exact-path staging only; UTF-8 no BOM.
- SEC-01 (dependency upgrades) untouched (separate authorized branch `fix/p8-sec01-deps`).

## 8. Escalations / notes for the Command Center

1. **Pool acquire timeout** (`connectionTimeoutMillis` as a Pool option) is NOT settable
   via the current env contract (DATABASE_URL) - it requires a bounded change to the
   frozen `packages/database/src/client.ts` (createDatabase) under a future
   authorization (e.g. new `DATABASE_POOL_CONNECTION_TIMEOUT_MS` env value). Recorded as
   a deployment configuration item; not required for OBS-04 closure (primary fix proven
   sufficient by the L2 acceptance).
2. The J10 journey L2 profile is now uncapped (20-way) - the S6 report's historical
   "J10 capped at L2" statements refer to the pre-fix state and remain valid as evidence
   of the defect.
3. OBS-04 is CLOSED by this fix (engine-level residual eliminated); the fix record +
   re-scan + rerun evidence are the inputs for P8-S9 G-18/G-21/G-30.
