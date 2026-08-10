# P8-S6 Load / Performance / Concurrency Evidence Report

> Phase 8 · Sub-phase **P8-S6** · Branch `task/p8-s6-load-performance-concurrency`
> Contract: `P8_S0_CONTRACT_FREEZE.md` §6 (G-06) · Brief: `docs/06-phase-reports/p8-s6/TASK_BRIEF_P8S6.md`
> D-069 (O-1..O-4): zero new dependencies; additive CI L0 smoke; zero production code by default (bounded fixes only, FIX-001..004); no invented thresholds — measured values + delta.
> Executor provenance and gate record: filed by OpenClaw at gate time (D-058). Reviewer: Reviewer B' (D-060).

---

## 1. Scope and method

Systematic load / performance / concurrency evidence for the 12 critical journeys of
contract §6 at Phase 8 state, over real HTTP (Node built-in `fetch`, real listening
NestJS server) against a dedicated fresh `ipoint_p8s6_*` PostgreSQL 17 database
(`127.0.0.1:55432`, compose container). Zero new dependencies (frozen lockfile, O-1).
Measurement profiles:

| Level | Concurrency | Iterations/op | Use                                                             |
| ----- | ----------- | ------------- | --------------------------------------------------------------- |
| L0    | 2           | 3             | CI smoke (additive `p8-ci.yml` step, O-2) — green 17/17         |
| L1    | 5           | 10            | host ramp evidence — 12/12 journeys                             |
| L2    | 20          | 20            | host sustained storm (P4-S7 precedent) — 11/12 + J10 documented |

Percentiles from per-request latency samples (ms). Throughput = samples / wall time.
"Unexpected error" = status outside the op's documented expected set. Rate-limiter
buckets are cleared between measured blocks (P2-S4D / P4-S7 methodology); login-family
ops are measured at the frozen limiter ceiling (10/IP/300s, 5/email/300s) and the 429
beyond the ceiling is measured explicitly (J1 L2). Config-scheduling ops (J4 rule,
J5 rate) are measured serially — overlapping windows are a documented 409 business
invariant, not a load failure. Adjust-chain ops (J3/J9) are measured at the 5-way
L2 profile; since round-1 FIX-004 their write boundaries carry the frozen
transaction-engine timeouts (statement 10s / lock 3s / 2 retries). Reconciliation
(J10) remains capped at L2 (OBS-04 residual, §9).

**Honesty contract**: every number is traceable to raw evidence under
`apps/api/.local/p8-s6-load/**` (per-journey JSON + summary) and the commands in §10.
No number is fabricated; a failed measurement is reported as such.

### Journey inventory and storms

| #   | Journey                                        | Write-path storm (§3.3 assertion set)                    | L1  | L2                   |
| --- | ---------------------------------------------- | -------------------------------------------------------- | --- | -------------------- |
| J1  | auth/login (+refresh, OTP, session reuse)      | — (session lifecycle; limiter ceiling + 429 observation) | ✅  | ✅                   |
| J2  | transactions (preview/confirm/receipt/history) | 20-way one-key preview + confirm storms                  | ✅  | ✅                   |
| J3  | MCP debit (governed adjustment workflow)       | double-decision storm                                    | ✅  | ✅ (5-way chain)     |
| J4  | reward (rule ops + earn exactly-once)          | 10-way confirm storm → reward sources/entries            | ✅  | ✅                   |
| J5  | commission (rate ops + outbox drain)           | outbox drain, no double-processing                       | ✅  | ✅                   |
| J6  | redemption (catalog/quote/order)               | 20-way order storm (distinct quotes)                     | ✅  | ✅                   |
| J7  | fulfilment (queues/suspend/resume/retry)       | per-iteration fresh state transitions                    | ✅  | ✅                   |
| J8  | refund (reversal/refund, retry-safe)           | 20-way same-key reversal + execution exactly-once        | ✅  | ✅                   |
| J9  | Maker/Checker (iPoint adjust)                  | double-decision storm                                    | ✅  | ✅ (5-way chain)     |
| J10 | reconciliation (run/execute/exceptions)        | storm scale history: persisted evidence 20-way (L1 `…06-27-47…`, L2 06:41 trial); HEAD bounds at 2-way L1 / serial L2 (`a4ead703`→`b4bd5082`); round-1 L2 re-run stalled again (OBS-04 residual, §9) | ✅  | ⚠ L2 stalled (OBS-04) — L1 evidence + note |
| J11 | reports (R01–R19)                              | read storm (scale 0.25 at L2)                            | ✅  | ✅                   |
| J12 | content delivery (ads/content home)            | read storm                                               | ✅  | ✅                   |

---

## 2. Journey matrix (measured, host)

### L1 — concurrency 5 × 10 (evidence: `.local/p8-s6-load/2026-08-10T06-27-47.381Z-…`)

All ops 0 unexpected errors (12/12 journeys; J6 order-create 409s are the documented
quote-race outcome, counted as expected errors).

| Journey | Op                          |   n |     tps |     p50 |   p95 |   p99 | err | unexp |
| ------- | --------------------------- | --: | ------: | ------: | ----: | ----: | --: | ----: |
| J1      | login                       |  10 |    62.6 |   107.5 | 145.0 | 145.0 |   0 |     0 |
| J1      | refresh                     |  10 |    75.5 |    11.2 |  15.1 |  15.1 |   0 |     0 |
| J1      | otp/issue                   |  10 |   459.4 |    19.7 |  20.9 |  20.9 |   0 |     0 |
| J1      | otp/verify                  |  10 |   328.3 |    16.5 |  18.0 |  18.0 |   0 |     0 |
| J1      | session-reuse               |  50 |   552.1 |     7.6 |  17.2 |  18.9 |   0 |     0 |
| J2      | preview                     |  50 |   205.2 |    21.1 |  41.8 |  43.2 |   0 |     0 |
| J2      | confirm                     |  50 |    45.3 |    64.2 | 179.7 | 240.6 |   0 |     0 |
| J2      | receipt/detail              |  50 |   574.3 |     8.3 |  12.1 |  12.6 |   0 |     0 |
| J2      | history/list                |  50 |   490.0 |     9.7 |  12.3 |  12.4 |   0 |     0 |
| J3      | merchant-mcp-read           |  50 |   736.4 |     5.7 |  15.1 |  15.7 |   0 |     0 |
| J3      | merchant-mcp-ledger         |  50 |   479.8 |     9.9 |  13.1 |  13.8 |   0 |     0 |
| J3      | admin-mcp-read              |  50 |   545.0 |     8.3 |  14.9 |  15.3 |   0 |     0 |
| J3      | adjust-create               |  50 |   250.4 |    18.2 |  31.3 |  32.2 |   0 |     0 |
| J3      | adjust-submit               |  50 |   129.9 |    16.4 |  21.4 |  22.5 |   0 |     0 |
| J3      | adjust-decision             |  50 |    79.9 |    22.3 |  27.1 |  31.0 |   0 |     0 |
| J3      | adjust-execute              |  50 |    53.7 |    26.1 |  37.8 |  49.7 |   0 |     0 |
| J4      | rule-schedule               |  10 |    33.2 |    31.0 |  31.6 |  31.6 |   0 |     0 |
| J4      | rule-list                   |  50 |   282.5 |    15.9 |  29.8 |  30.0 |   0 |     0 |
| J5      | rate-schedule               |  10 |    42.9 |    18.8 |  31.2 |  31.2 |   0 |     0 |
| J5      | rate-list                   |  50 |   328.5 |    14.6 |  18.4 |  18.9 |   0 |     0 |
| J6      | catalog                     |  50 |   774.8 |     5.8 |  10.3 |  11.8 |   0 |     0 |
| J6      | quote                       |  50 |   523.6 |     8.8 |  13.2 |  13.6 |   0 |     0 |
| J6      | order-create                |  50 |   141.7 |    15.6 |  41.9 |  52.3 | 40¹ |     0 |
| J7      | queues                      |  50 |   473.3 |     8.9 |  21.1 |  21.5 |   0 |     0 |
| J7      | queue-status                |  50 |   443.9 |     9.8 |  20.8 |  22.0 |   0 |     0 |
| J7      | order-detail                |  50 |   363.3 |    12.7 |  19.6 |  21.3 |   0 |     0 |
| J7      | suspend                     |  50 |   299.2 |    13.6 |  16.8 |  18.0 |   0 |     0 |
| J7      | resume                      |  50 |   298.6 |    13.9 |  15.3 |  15.7 |   0 |     0 |
| J7      | fulfilment-retry            |  50 |   262.1 |    13.8 |  15.7 |  16.0 |   0 |     0 |
| J8      | reversal-request            |  50 |    50.0 |    11.1 |  17.1 |  22.4 |   0 |     0 |
| J8      | refund-request              |  50 |    51.4 |    11.1 |  12.3 |  20.0 |   0 |     0 |
| J8      | request-reads               | 100 |    50.1 |     4.0 |   5.0 |   7.9 |   0 |     0 |
| J9      | maker-create                |  50 |   233.6 |    18.9 |  29.2 |  30.0 |   0 |     0 |
| J9      | maker-submit                |  50 |   127.8 |    16.3 |  20.3 |  21.6 |   0 |     0 |
| J9      | checker-decision            |  50 |    77.5 |    22.9 |  27.1 |  27.8 |   0 |     0 |
| J9      | checker-execute             |  50 |    47.5 |    32.3 |  43.3 |  56.8 |   0 |     0 |
| J9      | queue-read                  |  50 |   411.0 |    10.7 |  16.3 |  16.6 |   0 |     0 |
| J10     | run-create                  |  50 |   285.6 |    15.9 |  28.5 |  29.4 |   0 |     0 |
| J10     | run-execute                 |  50 |   280.9 |    15.5 |  29.4 |  35.8 |   0 |     0 |
| J10     | run-list/detail/exceptions  | 150 | 375–596 |    8–12 |  9–24 | 10–25 |   0 |     0 |
| J11     | report-list                 |  50 |   359.1 |     8.2 |  55.1 |  56.2 |   0 |     0 |
| J11     | report-R01..R19             | 950 | 543–669 | 7.0–7.5 |  8–24 |  9–25 |   0 |     0 |
| J12     | placement/ad/article create | 150 | 299–337 |   14–16 | 18–29 | 18–30 |   0 |     0 |
| J12     | ad/article activate         | 100 | 151–159 |   15–16 | 17–20 | 17–22 |   0 |     0 |
| J12     | admin-ads-list              |  50 |   384.4 |    11.4 |  23.8 |  24.2 |   0 |     0 |
| J12     | member-content-home         |  50 |   704.9 |     6.5 |  10.1 |  10.7 |   0 |     0 |

¹ 40 errors = `REDEMPTION_QUOTE_EXPIRED` 409s (ms-granular quote idempotency dedupe,
OBS-01) — expected, zero unexpected.

### L2 — concurrency 20 × 20 (evidence: `.local/p8-s6-load/2026-08-10T08-01-57.497Z-…`

and final `…08-16-57.531Z…`; J3/J9 chains 5×10, J4/J5 schedule serial, J11 scale 0.25)

> **L-2 note (not two independent runs):** `…08-01-57.497Z…` and `…08-16-57.531Z…`
> are two incremental snapshots of the SAME run (identical summary SHA-256
> `A43AF4776387`, same runId `run-2026-08-10T07-59-55.615Z`). The 08-16-57 write is
> the final post-watchdog snapshot after J10 stalled; both contain the same 11
> completed journeys (J10 absent).

| Journey | Op                           |    n |      tps |     p50 |    p95 |    p99 |  err |                 unexp |
| ------- | ---------------------------- | ---: | -------: | ------: | -----: | -----: | ---: | --------------------: |
| J1      | login/refresh/otp (ceiling)  |   40 |   64–386 |  11–108 | 14–144 | 14–144 |    0 |                     0 |
| J1      | session-reuse                |  400 |    743.8 |    26.1 |   35.4 |   41.6 |    0 |                     0 |
| J1      | logout                       |   10 |     77.5 |     8.0 |    8.9 |    8.9 |    0 |                     0 |
| J1      | limiter burst 15             |   15 |        — |       — |      — |      — |    — | PASS (10×200 + 5×429) |
| J2      | preview                      |  400 |    288.2 |    67.4 |   78.4 |   94.4 |    0 |                     0 |
| J2      | confirm                      |  400 |     52.7 |   104.3 |  863.8 | 1115.3 |    0 |                     0 |
| J2      | receipt/detail               |  400 |   1038.6 |    18.6 |   21.7 |   25.5 |    0 |                     0 |
| J2      | history/list                 |  400 |    623.9 |    30.3 |   40.2 |   50.4 |    0 |                     0 |
| J3      | mcp reads                    | 1200 | 553–1099 |   18–35 |  21–39 |  27–50 |    0 |                     0 |
| J3      | adjust chain (5-way)         |  200 |   52–268 |   16–28 |  17–38 |  18–41 |    0 |                     0 |
| J4      | rule-schedule/list           |  420 |   34–240 |   30–82 |  32–96 | 38–100 |    0 |                     0 |
| J5      | rate-schedule/list           |  420 |   33–247 |   31–80 |  32–92 |  33–94 |    0 |                     0 |
| J6      | catalog/quote                |  800 |  701–841 |   22–27 |  32–33 |  41–51 |    0 |                     0 |
| J6      | order-create                 |  400 |    206.7 |    48.0 |   90.7 |  109.6 | 390¹ |                     0 |
| J7      | fulfilment ops               | 2400 |  371–600 |   33–49 |  40–55 |  41–59 |    0 |                     0 |
| J8      | reversal/refund ops          | 1600 |    50–52 |   27–37 |  41–84 | 55–177 |    0 |                     0 |
| J9      | adjust chain (5-way) + queue |  600 |   50–480 |   15–40 |  19–49 |  21–54 |    0 |                     0 |
| J11     | report-list                  |   25 |    260.8 |     8.4 |   61.3 |   61.5 |    0 |                     0 |
| J11     | report-R01..R19              |  475 |  455–627 | 7.3–8.9 |   9–21 |  10–22 |    0 |                     0 |
| J12     | content ops + member home    | 2400 |  170–360 |   55–94 | 59–106 | 61–113 |    0 |                     0 |

¹ 390 errors = expected quote-race 409s (OBS-01), zero unexpected.

**L-1 note (J9 n):** the J9 L2 row counts chain ops 50×4 = 200 (maker-create /
submit / checker-decision / checker-execute at 5-way × 10) + queue-read 400
(20×20, uncapped) = **600 samples** (per-op breakdown in
`…08-16-57.531Z…/J9.json`; the earlier “250” under-counted the uncapped
queue-read).

**Round-1 post-FIX-004 re-runs (J3/J9 at L2):** both adjust chains were re-run in
a dedicated `ipoint_p8s6_test` DB after FIX-004 (evidence `…08-41-59.831Z-p8s6-l2/`
and `…08-42-19.242Z-p8s6-l2/`): J3 1200 read + 200 chain samples, J9 200 chain +
400 queue samples — **0 unexpected errors each**, double-decision storm PASS
(200/409, final state APPROVED), no pool stall. The table numbers above (same
5-way profile) are unchanged and remain valid; the re-runs prove the
OBS-04-class adjust-chain stall is closed (see FIX-004).

**J10 L2**: reconciliation run-create/execute at L2 stalled the DB pool on 4
observed attempts (OBS-04 — see §9; persisted-evidence vs console-observed
enumeration in the OBS-04 row); the L2 row uses the L1 numbers above. The
900s-journey watchdog fired on the final evidence run and was **console-observed
only** — no J10.json was persisted for that attempt (the final snapshot
`…08-16-57.531Z…` holds the same 11 journeys as `…08-01-57.497Z…`, see L-2 note).
Console citation: `J10 threw: journey exceeded 900s watchdog (OBS-04 pool stall)`.
A round-1 L2 re-run (16:43 MYT 2026-08-10, post-FIX-004) reproduced the stall:
pg_stat_activity showed 10/10 pooled sessions “idle in transaction / ClientRead”
on `update reconciliation_runs` (snapshots in
`…08-44Z-j10-l2-rerun-stall/OBSERVATION.md`; test timeout + pool teardown hang,
client killed → PG aborted all 10 sessions within seconds — the residual is the
client-side connection lifecycle, see OBS-04).

---

## 3. Transactions delta vs P4-S7 baseline

P4-S7 (pre-Phase-8, 270 rows, supertest in-process, 20 concurrent/endpoint):
Preview 83.92/100.21/100.29 ms, Confirm 308.93/525.12/525.93 ms, merchant list
33.13/36.56/36.75 ms, merchant detail 25.38/28.06/28.34 ms (p50/p95/p99), 0/80 unexpected.

P8-S6 re-measurement (Phase 8 state, same endpoint families):

| Endpoint | P4-S7 p50 | S6 L1 p50 | S6 L2 p50 | Δ (L1)    | note                                                                                                                                                                              |
| -------- | --------- | --------- | --------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview  | 83.92     | 21.1      | 67.4      | −62.8 ms  | Phase 8 state adds middleware/audit/P8 tables; method differs (real HTTP fetch vs supertest in-process) and data volume is still test-scale; preview is snapshot-only (no writes) |
| Confirm  | 308.93    | 64.2      | 104.3     | −244.7 ms | same method caveats; confirm p95/p99 at L2 (863/1115 ms) show 20-way contention on the advisory-locked write boundary — expected serialization cost, zero errors                  |

Method note: P4-S7 used supertest against the in-process server; S6 uses real HTTP
(`fetch`, keep-alive, real sockets). Deltas are indicative, not apples-to-apples
(P4-S7 residual risk 2; Node 26 host vs Node 24 CI parity applies).

---

## 4. Storm results (exactly-once assertion set, §3.3)

| Journey | Storm                                 | Assertion                                                                                                                           | L1   | L2                      | Evidence    |
| ------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------- | ----------- |
| J2      | 20 concurrent preview, one key        | single preview session + single idempotency record                                                                                  | PASS | PASS                    | `…/J2.json` |
| J2      | 20 concurrent confirm, one key        | one chain (1 tx/1 fee/1 debit/1 reward link/1 source/1 plan/1 wallet entry); MCP delta exactly −10.00                               | PASS | PASS                    |             |
| J3      | double-decision on one MCP adjustment | exactly one accepted transition (final APPROVED, one winner)                                                                        | PASS | PASS                    |             |
| J4      | 10-way confirm storm                  | reward_sources delta = confirms; TRANSACTION_REWARD wallet entries delta = confirms                                                 | PASS | PASS                    |             |
| J5      | outbox drain under commission writes  | backlog → 0 within bound; no duplicate (tx,event); attempts ≤ max_attempts                                                          | PASS | PASS                    |             |
| J6      | 20-way order storm (distinct quotes)  | exactly 20 orders, 20 wallet debits, 0×5xx                                                                                          | PASS | PASS                    |             |
| J8      | 20 concurrent reversals, one key      | exactly one correction_request; execution restores MCP fee exactly once (+10.00 delta); re-execution rejected with no second impact | PASS | PASS                    |             |
| J9      | double-decision on one iPoint adjust  | exactly one accepted transition                                                                                                     | PASS | PASS                    |             |
| J10     | same-run execute storm (20-way in persisted evidence; 2-way at HEAD) | exactly one COMPLETED run; waiters bounded (FIX-002 timeouts) — 55P03-class 500s are OBS-02 (bounded) | PASS | L1 PASS (20-way, bounded); L2 trial PASS w/ 9 bounded 55P03 (06:41); L2 HEAD-scale re-run stalled (OBS-04 residual) |             |

**Unexpected-error scope (M-2):** the final reported matrix — 12/12 journeys at
L0/L1, 11/11 persisted journeys at L2 — shows 0 unexpected errors in every
measured storm. One earlier L2 trial (06:41 run, `…06-43-42.109Z…`, pre-ceiling
commit) recorded 9 unexpected 500s on J10 run-execute: all bounded `55P03`
lock-timeout waiters (OBS-02) with final state COMPLETED and the storm assertion
PASS; that trial is documented in §2/§9 and is NOT part of the final matrix
(P4-S7 precedent: 0/80 target).

**Scale-history note (M-1):** persisted J10 storm evidence is **20-way** — L1
06-27-47 assertion lists 20 concurrent statuses (17×500 bounded 55P03 + 3×200,
final COMPLETED); L2 06:41 trial run-execute n=400 at 20×20 (9×500 bounded). The
report’s earlier “5-way” wording was the intermediate intended ceiling, not what
the evidence shows. HEAD code now bounds the storm at **2-way (L1-only) with
serial L2** (commits `a4ead703` → `d90597b6` → `48ff8125` → `e2a84297` →
`b4bd5082`, OBS-04 mitigations). All three values are now reconciled above and
in §1/§2.

---

## 5. Defects found and bounded fixes (§11 / §3.7)

### FIX-001 — High (fixed, round 1, commit `fd835ef8`)

**`GET /api/v1/redemption/catalog/:itemId/quote` passed the ACCOUNT id as the member
id** → `redemption_quotes.member_id` FK (23503) → every member quote request 500 →
the member redemption order flow (quote → confirmOrder) was unreachable over HTTP
(no existing spec exercised this route with a member token). Fix: resolve the member
id first (`resolveMemberId`), mirroring the confirmOrder route. Evidence: pre-fix J6
quote 6/6 × 500 (`…/05-37-36.018Z-p8s6-l0/J6.json`); post-fix 0 unexpected at L0/L1/L2.

### FIX-002 — High (fixed, round 1, commit `1db4fb69`)

**Reconciliation execute under concurrency: unbounded lock wait + connection leak.**
A 20-way execute of one run could leave the winning transaction stalled
("idle in transaction" after a client abort) holding the run row lock indefinitely;
waiters (no `lock_timeout` on this path) blocked forever and exhausted the pool
(observed: 8 sessions stuck 18+ min, stalling subsequent journeys in the first L1 run).
Fix: apply the frozen transaction-engine timeouts (`statement_timeout` 10s,
`lock_timeout` 3s — P4-S7 contract) at the start of every reconciliation write
transaction (`withIdempotency`). Post-fix: waiters fail bounded; J10 storm all-bounded
at L1. Residual (Low): a lost client connection can still hold a run lock until the
backend reaps the socket. Commit note (L-3): `1db4fb69` also bundled the necessary
prettier reformatting of the helper functions `toScaledBigInt`/`sub`/`eqScaled`
(pure formatting, no semantic change).

### FIX-003 — High (fixed, round 1, commit `1db4fb69`)

**Concurrent redemption orders sharing a quote → 23505 → 500.**
The quote idempotency key is ms-granular (`quote:{member}:{item}:{qty}:{Date.now()}`);
concurrent quote calls in the same millisecond return the SAME quote, and two order
confirms on one quote raced the `uq_order_quote` unique index → unhandled 500 (~30%
of a 10-way storm pre-fix; 3/10 reproduced in a probe). Fix: `FOR UPDATE` on the quote
load in `confirmOrder` so the second consumer observes the consumed quote and returns
the bounded `REDEMPTION_QUOTE_EXPIRED` 409. Post-fix status histogram (traceable,
M-6 — replaces the earlier inline console string): J6 L1 order-create n=50 →
**10×201 + 40×409** (`…/2026-08-10T06-27-47.381Z…/J6.json`); J6 L2 order-create
n=400 → **10×201 + 390×409** (`…/2026-08-10T08-16-57.531Z…/J6.json`); 0×500 at
every level. (The probe string `201,409,201,201,201,201,409,409,409,201` was
console-observed during development and is superseded by the persisted
histograms.)

### FIX-004 — Medium (OBS-04 routine-repairable part; fixed round 1, commit `d6bab1da`)

**MCP/iPoint adjust-owner write boundaries ran without transaction
timeouts/retries (reviewer H-1).** The 10 `DatabaseService.runTransaction` call
sites in `apps/api/src/merchant/mcp-adjustment.owner.service.ts`
(create/submit/decide/execute/markFailed) and `apps/api/src/wallet/wallet-adjustment.owner.service.ts`
(same 5) passed NO options → no `statement_timeout`, no `lock_timeout`, no
40001/40P01 retry. Under a sustained decision storm, waiters blocked on the
request row lock (or on a stalled client’s open transaction) without any time
bound — the OBS-04 class reproduced on both adjust chains at ≥10-way during
development.
- **Root cause:** bounded-fix gap — write boundaries missing the frozen engine
timeouts (FIX-002 precedent: `1db4fb69` applied them to reconciliation
`withIdempotency` only).
- **Fix:** pass the frozen `TRANSACTION_EXECUTION_OPTIONS` (statement 10s /
lock 3s / 2 retries, P4-S7 contract, `transaction-reliability.ts:11-15`) at all
10 call sites. `set_config(..., true)` is session-local → pooled connections are
not mutated after COMMIT/ROLLBACK; retries are SQLSTATE 40001/40P01 only
(`database.service.ts:26-73`). Diff: 2 files, 12 insertions / 10 deletions
(1 import + 10 call-site option args). No behavior change beyond
timeouts/retry bounds; no migration; checksums untouched.
- **Tests:** owner unit suites 38/38 (mcp 20/20, wallet 18/18); L0 full load
suite 17/17; L2 re-runs — J3 (1200 read + 200 chain samples) and J9 (200 chain +
400 queue): **0 unexpected errors each**, double-decision storm PASS (200/409,
final APPROVED), no pool stall (evidence `…08-41-59.831Z-p8s6-l2/`,
`…08-42-19.242Z-p8s6-l2/`).
- **Zero-bypass re-scan** (P7-S10 gate-18 / S5e method, `node .local/p8-s5e/scan-zerobypass.mjs`):
464 files scanned (445 S5e baseline + 19 S6 load files), 5 benign keyword hits
(same classes as the S5e baseline: 2 helper default-params + 1 explicit
no-fallback comment), **0 direct owner bypass**.
- **Residual (unchanged, escalated):** the OBS-04 engine-level part —
idle-in-transaction connection lifecycle on the reconciliation path — is
unaffected by FIX-004 and remains OPEN for the Command Center (§9).

### 5.1 Round-1 reviewer closure (CHANGES REQUIRED → resubmission)

| Item | Finding | Disposition | Where addressed |
| ---- | ------- | ----------- | --------------- |
| **H-1** | 10 `runTransaction` calls (mcp L233/309/377/494/948, wallet L231/309/377/497/960) missing timeouts/retries | **FIXED — FIX-004** (options at all 10 sites; re-run evidence J3/J9 L2 PASS) | §5 FIX-004; commit `d6bab1da` |
| **M-1** | J10 storm scale inconsistent (report 5-way / evidence 20-way / HEAD 2-way) | **Corrected** — scale history reconciled + difference reason documented | §1 journey table, §2 J10 note, §4 scale-history note |
| **M-2** | “Zero unexpected errors in every measured storm” overstates | **Corrected** — scoped to the final reported matrix; 06:41 L2 trial (9× bounded 55P03) recorded separately | §4 |
| **M-3** | watchdog citation console-only | **Corrected** — marked console-observed; no J10.json persisted; L-2 snapshot identity clarified | §2 J10 note |
| **M-4** | OBS-04 “Reproduced 4×” not matched to persisted evidence | **Corrected** — per-reproduction enumeration (persisted vs console) + round-1 pg_stat_activity snapshots added | §9 OBS-04 row, `…08-44Z-j10-l2-rerun-stall/OBSERVATION.md` |
| **M-5** | retry-site first row implied engine-wide defaults | **Corrected** — per-call-site opt-in qualifier + not-opted-in domain list (incl. J3/J9 post-FIX-004 state) | §6 |
| **M-6** | FIX-003 verification string console-only | **Corrected** — replaced with persisted histograms (J6 L1 10×201+40×409; L2 10×201+390×409) | §5 FIX-003 |
| **L-1** | §2 L2 J9 n=250 wrong | **Corrected** — 600 (chain 50×4=200 + queue 400) | §2 L-1 note |
| **L-2** | 08-16-57 vs 08-01-57 identical bytes | **Corrected** — clarified as one run, two snapshots (same summary SHA) | §2 L-2 note |
| **L-3** | FIX-002 commit bundled prettier reflow | **Recorded** in the fix record | §5 FIX-002 |
| **L-4** | FOR UPDATE OF hardening suggestion | **Recorded** — see §9 OBS-04 residual note (lock-target narrowing candidate for Command Center) | §9 |
| **L-5** | historical process note | **Recorded** — see §9 OBS-04 reproduction ledger | §9 |
| **L-6** | quote-key entropy product decision | **Recorded** — ms-granular quote idempotency key is a product decision (OBS-01 documented, safe/bounded); entropy change would be a Command Center product call | §9 OBS-01 |

---

## 6. Retry-site table

Static scan (`run-retry-scan.ts`, 460 files, 1757 candidate sites) + manual
verification. **No unbounded retry site found**; the six loop-flagged sites are
bounded (visited-set cycle guards, `running`-flag scheduler loops, cleared samplers).

| Site                                                  | Bound                                                           | Guard                                                           | Evidence                                               |
| ----------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| `DatabaseService.runTransaction` (transaction engine) — **opt-in per call site (M-5)** | 2 retries + statement 10s / lock 3s | SQLSTATE 40001/40P01 only; never HTTP/validation/business; timeouts/retries apply ONLY where the caller passes `TRANSACTION_EXECUTION_OPTIONS` | `database.service.ts:26-73`; options `transaction-reliability.ts:11-15` |
| `transaction-reliability.ts`                          | statement 10s / lock 3s / 2 retries                             | centralized write-boundary limits                               | `transaction-reliability.ts:14`                        |
| Outbox worker                                         | `max_attempts`, BATCH 10, stale-lock recovery                   | `attempts < max_attempts`; `FOR UPDATE SKIP LOCKED` claim       | worker:27,31,111,114; J5 drain PASS; DB-obs drain 60→0 |
| Commission integrator                                 | replay key `canonical_processing_key` per tx                    | exactly-once on replay; admin reprocess endpoint                | `transaction-commission.integrator.ts:12-19`           |
| Reconciliation `withIdempotency`                      | 10s / 3s (FIX-002)                                              | FOR UPDATE run/exception locks + idempotency-key rows           | J10 storm bounded (L1)                                 |
| Redemption confirmOrder                               | quote FOR UPDATE (FIX-003) + wallet advisory lock               | consumed-quote 409, never 500                                   | J6 storm 0×5xx                                         |
| MCP/iPoint adjust workflows                           | operation-scoped idempotency keys + step-up grants (single-use) | same-key replay returns original result; Maker≠Checker enforced | J3/J9 storms                                           |
| UI double-submit guards                               | `isSubmitting` / idempotency keys                               | member-web `useKyc.ts`, `CountryChangePage.tsx:272`             | S5b/S5c suites                                         |

**Per-call-site opt-in note (M-5):** the engine applies timeouts/retries only
where the caller passes `TRANSACTION_EXECUTION_OPTIONS`. Opted-in at HEAD:
transaction confirm/correction write boundaries (`transaction.service.ts:458,1047`,
`transaction-correction.service.ts:296,580`), reconciliation `withIdempotency`
(FIX-002, `admin-reconciliation-ops.service.ts:1272+`), and — since round-1
FIX-004 — all 10 MCP/iPoint adjust-owner write boundaries (J3 MCP, J9 iPoint:
create/submit/decide/execute/markFailed in `mcp-adjustment.owner.service.ts` and
`wallet-adjustment.owner.service.ts`). **NOT opted-in at HEAD**: auth, kyc, market,
merchant, reward, redemption, fulfilment, refund, job/scheduler write boundaries
— they run without statement/lock timeouts and without 40001/40P01 retry (no
unbounded retry exists, but long lock waits are not time-boxed there). The engine
never retries without options.

---

## 7. DB / worker behaviour

Evidence: `.local/p8-s6-load/*-db-observations/observations.json` (see §10 commands).

| Observation                                        | Result                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| EXPLAIN transactions merchant/member list          | index-based plans (no seq scan)                                                          |
| EXPLAIN transactions detail/receipt                | `transactions_number_unique` index scan                                                  |
| EXPLAIN reconciliation runs queue / outbox pending | index-based plans                                                                        |
| 30-way confirm storm                               | 1093 ms, 30×201, 0 errors                                                                |
| Deadlock counter delta (pg_stat_database)          | 0 → 0 (no deadlocks)                                                                     |
| Transaction rollback/commit delta                  | rollback 0 → 0 (no unexpected rollbacks); commit +168                                    |
| Connection pool                                    | 2 → 10 sessions during storm; stable at pool max, no exhaustion (pre-round-1 DB-obs run) |
| Lock-wait samples during storm                     | 1–8 sessions waiting on locks (advisory-lock serialization, bounded)                     |
| Outbox drain                                       | 60 PENDING → 0 in 2.6 s; 60 COMPLETED; attempts ≤ max_attempts (0 over)                  |
| Timeout defaults                                   | statement/lock timeouts set locally per write boundary (0 session defaults, as designed) |
| OBS-04 round-1 L2 re-run pool state (16:44/16:50 MYT, pg_stat_activity) | **10/10 pooled sessions “idle in transaction / ClientRead” on `update reconciliation_runs`** (tx_age = query_age = 4:42); client kill → PG aborted all 10 within seconds (client-side lifecycle, no DB leak) |

---

## 8. Limitations (honesty section)

- Sustained load (L1/L2) is host-only (Windows, Node 26.4.0, PostgreSQL 17 on
  `127.0.0.1:55432`) — K-02-class constraint, mirroring the browser-E2E precedent
  (D-056 / P7-S10 gate 9). CI runs only the additive L0 smoke (Node 24, ubuntu);
  Node 26 host vs Node 24 CI parity note applies (P4-S7 residual risk 2).
- Dataset cardinality is test-scale (hundreds–low-thousands of rows), not
  production-scale; EXPLAIN plans and latencies are indicative.
- Latency method differs from P4-S7 (real HTTP fetch + keep-alive vs supertest
  in-process); deltas are indicative.
- Login-family ops are measured at the frozen rate-limiter ceiling (10/IP/300s,
  5/email/300s); sustained single-IP login throughput beyond the ceiling is
  intentionally blocked (security property; 429 observed and asserted at L2).
- J3/J9 adjust chains are measured at the 5-way L2 profile; since round-1 FIX-004
  their write boundaries carry the frozen transaction timeouts/retries and both
  chains complete at L2 with 0 unexpected errors (the OBS-04-class ≥10-way adjust
  chain stall is closed). J10 reconciliation remains capped at ≤5-way/serial at L2
  because the OBS-04 idle-in-transaction pool stall reproduced again in the
  round-1 L2 re-run (see §9) — the residual is engine-level and escalated.
- J6 order-create reports the quote-race 409 as an expected error (OBS-01) — the
  latency percentiles include those 409s.
- No production SLA is claimed (P4-S7 wording: engineering evidence).

## 9. Discrepancy log (severity-classified)

| ID      | Severity        | Class                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Status                                                |
| ------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| FIX-001 | High            | broken member redemption journey via HTTP (quote route account/member id mix-up)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | FIXED round 1 — **Reviewer B' verification required** |
| FIX-002 | High            | unbounded lock wait + pool leak under concurrent run execute                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | FIXED round 1 — **Reviewer B' verification required** |
| FIX-003 | High            | concurrent order 500 on shared quote (23505)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | FIXED round 1 — traceability corrected in round-1 revision (M-6) |
| FIX-004 | Medium          | adjust-owner write boundaries missing frozen transaction timeouts/retries (OBS-04 routine-repairable part; reviewer H-1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | FIXED round 1 — **Reviewer B' verification required** |
| OBS-04  | **High — OPEN (residual)** | **Idle-in-transaction connection-lifecycle stall on the reconciliation path.** Sessions stuck “idle in transaction / ClientRead” on ALL pooled connections (10/10) holding `UPDATE reconciliation_runs`; requests block on the pool queue. No statement/lock timeout can fire because no statement is executing (client idle) — FIX-002’s 10s/3s bound waiters but cannot prevent this class. **Reproduction ledger (M-4 — evidence vs console):** (a) *persisted evidence* — L2 run `…07-59-55.615Z` family: J10 900s watchdog fired, J10.json absent from the `…08-16-57.531Z` final snapshot (console: `J10 threw: journey exceeded 900s watchdog`); L2 run `…07-52-08.117Z` family: J10 absent (process terminated, console-observed); (b) *completed trials* — L1 06-27-47 J10 storm 20-way completed with 17 bounded 55P03 (OBS-02) 500s, assertion PASS; L2 06:41 trial J10 20-way completed with 9 bounded 55P03 500s, assertion PASS (both persisted); (c) *round-1 re-run (post-FIX-004)* 2026-08-10 ~16:43 MYT: L2 J10 stalled again — pg_stat_activity snapshots 10/10 idle-in-transaction on `update reconciliation_runs` (tx_age = query_age = 4:42), test timeout + pool teardown hang; client killed → PG aborted all 10 sessions in seconds (residual is client-side lifecycle, no DB-side leak; the earlier 18-min L1 stall was the same class). J3/J9 adjust-chain stalls (the remainder of the former 4× total, console-observed during development) are **closed by FIX-004** — round-1 L2 re-runs pass 0 unexpected. Engine-level fix (pool acquire timeout / tx-scoped connection discipline / driver tracing; FOR UPDATE OF narrowing per reviewer L-4) is OUT of bounded-fix scope — **Command Center decision** (D-069 O-3, §3.7). | OPEN — escalated (residual scoped to the reconciliation path; adjust chains closed via FIX-004) |
| OBS-01  | Medium          | quote ms-granular idempotency key dedupes concurrent distinct requests into one quote → 409 consumed for the loser (safe, bounded; J6 ~98%)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | documented                                            |
| OBS-02  | Low             | reconciliation lock-timeout waiters surface as 500 (55P03), not 409                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | documented                                            |
| OBS-03  | Low             | outbox worker logs "Dispatch failed: not CONFIRMED" for transactions reversed before drain                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | expected business rejection, bounded (attempts ≤ max) |
| OBS-05  | Low             | deprecated recharge route (`merchant.mcp.recharge.review`) 403s by design (P7-S2C)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | verified as intended                                  |

Approval bar: 0 Critical / 0 High / 0 Medium at final gate — FIX-001..003 (High)
are fixed with round-1 evidence, with traceability corrections in this round-1
revision; FIX-004 (Medium, OBS-04 routine-repairable part) is fixed in round 1
with re-run evidence and requires Reviewer B' verification; OBS-04 (High,
residual — reconciliation idle-in-transaction connection lifecycle only) is
escalated to the Command Center per §3.7 stop conditions; the J3/J9 adjust-chain
class of OBS-04 is closed by FIX-004. **The S6 gate cannot be approved as fully
green while the OBS-04 residual is open** — this is flagged explicitly for the
verifier. Round-1 closure table: §5.1.

## 10. Evidence commands and raw outputs

```powershell
# L0/L1/L2 (host)
$env:DATABASE_URL='postgresql://ipoint:ipoint-local-only@127.0.0.1:55432/ipoint_p8s6_test'
$env:P8S6_DESTRUCTIVE_TEST='1'; $env:P8S6_LOAD_LEVEL='L0'   # L1 | L2
cd apps/api
pnpm vitest run src/load/load.spec.ts --reporter verbose   # L0 (CI shape; 17/17 green)
pnpm exec tsx src/load/run-load.ts                          # L0/L1/L2 (host runner)

# DB/worker observations + retry scan
pnpm exec tsx src/load/run-db-observations.ts
pnpm exec tsx src/load/run-retry-scan.ts

# Round-1 re-run (post-FIX-004, 2026-08-10 MYT, dedicated ipoint_p8s6_test DB)
$env:P8S6_LOAD_LEVEL='L0'
pnpm vitest run src/load/load.spec.ts --reporter verbose     # 17/17 (…08-41-44.592Z-p8s6-l0)
$env:P8S6_LOAD_LEVEL='L2'
pnpm vitest run src/load/load.spec.ts -t "J3 MCP debit"     # 1/1 PASS (…08-41-59.831Z-p8s6-l2)
pnpm vitest run src/load/load.spec.ts -t "J9 Maker/Checker" # 1/1 PASS (…08-42-19.242Z-p8s6-l2)
pnpm vitest run src/load/load.spec.ts -t "J10 reconciliation" # stalled — OBS-04 residual reproduced
#   (pg_stat_activity snapshots in …08-44Z-j10-l2-rerun-stall/OBSERVATION.md)
```

Raw evidence (host): `apps/api/.local/p8-s6-load/` —
`2026-08-10T06-27-47.381Z-run-…` (L1 12/12), `2026-08-10T08-01-57.497Z-run-…` and
`2026-08-10T08-16-57.531Z-run-…` (L2, incremental — same run, two snapshots, see
L-2 note), `2026-08-10T06-43-42.109Z-run-…` (L2 trial incl. J10 20-way,
9× bounded 55P03), `*-db-observations/` (DB/worker), `*-retry-scan/` (retry
sites), round-1 re-runs `2026-08-10T08-41-44.592Z-p8s6-l0` (L0 17/17),
`2026-08-10T08-41-59.831Z-p8s6-l2` (J3), `2026-08-10T08-42-19.242Z-p8s6-l2` (J9),
`2026-08-10T08-44Z-j10-l2-rerun-stall/OBSERVATION.md` (J10 stall snapshots). Each
run's `summary.json` + per-journey `J*.json` contains every sample, percentile,
status histogram, assertion and observation.
