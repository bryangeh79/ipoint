# P4-S7 Transaction Engine Hardening Evidence

> Scope: P4-S7 only
>
> Branch: `phase/4-transaction-engine`
>
> Authorization: D-036
>
> Local environment: Windows, Node 26.4.0, pnpm 9.15.9, PostgreSQL 17 on
> `127.0.0.1:55440`

## Implemented hardening

- Transaction responses no longer expose package, market, reward-rule, branch,
  or preview-session database UUIDs. Preview confirmation uses an authenticated,
  opaque, one-hour workflow reference encrypted with a domain-separated key.
- Transaction write boundaries apply PostgreSQL-local `statement_timeout`
  (10 seconds) and `lock_timeout` (3 seconds).
- Automatic retry is bounded to two retries and only SQLSTATE `40001`
  (serialization failure) or `40P01` (deadlock). HTTP, validation,
  authorization, constraint, balance, and other business failures are not
  retried.
- Lock order is normalized as advisory operation key, transaction/correction,
  MCP account, then member wallet. Correction execution has an advisory lock.
- Unknown-error logs contain only allowlisted error metadata, request ID,
  method, and route template. SQL text, SQL parameters, raw URL identifiers,
  tokens, balances, and exception messages are not logged.
- Transaction controllers add `no-store`, `no-cache`, CSP, referrer, MIME-sniff,
  and frame-denial headers.
- DTOs remain strict and add bounded cursor, correction code/note, control
  character, and transaction-number validation.
- Dedicated database-integration and transaction-integration scripts now run
  explicitly in Phase 4 CI. They are no longer silently excluded by the
  workspace `*.integration.*` rule.

## Required evidence matrix

|   # | Required evidence                      | Evidence                                                                                                                   |
| --: | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
|   1 | Merchant/member cross-access isolation | `transaction-read.spec.ts` merchant/member ownership and cross-party tests; correction acceptance tests 6, 22, and 24      |
|   2 | Branch isolation                       | Read tests 9-10 and branch-filter authorization predicate                                                                  |
|   3 | Market isolation                       | Preview cross-market tampering rejection, consumption-market wallet test, and market-scoped read predicates                |
|   4 | Role-boundary enforcement              | Merchant auth tests plus correction acceptance tests 1-6; Cashier denied for reversal/refund                               |
|   5 | Malformed/oversized input rejection    | Preview amount/note/QR tests, correction strict DTO tests, hardening bounds tests                                          |
|   6 | Cursor tampering rejection             | Read tests 25-27 and hardening non-canonical/oversized cursor tests                                                        |
|   7 | Idempotency replay storm               | 20 concurrent Preview requests plus 20 concurrent Confirm requests return one result and one financial chain               |
|   8 | Concurrent Confirm stress              | Same-preview concurrency test and 20-request Confirm latency batch                                                         |
|   9 | Concurrent reversal/refund stress      | Correction acceptance tests 18-20 and 34                                                                                   |
|  10 | No duplicate financial writes          | Preview/Confirm replay, concurrency state counts, correction exactly-once counts                                           |
|  11 | Lock/deadlock behavior                 | Advisory locks, normalized lock order, `40P01` retry-boundary test, 3-second lock timeout                                  |
|  12 | Rollback after injected failures       | Preview/Confirm critical-boundary injection matrix and correction rollback test                                            |
|  13 | Log redaction                          | Safe-error metadata tests and injected-failure logs containing no SQL parameters, raw tokens, UUID URL values, or balances |
|  14 | EXPLAIN key read paths                 | See query-plan evidence below                                                                                              |
|  15 | Index justification                    | Existing indexes satisfy all key read paths; no migration added                                                            |
|  16 | Endpoint p50/p95/p99                   | See latency evidence below                                                                                                 |
|  17 | Zero unexpected error rate             | 20 concurrent requests per measured endpoint, 80 total, zero unexpected responses                                          |
|  18 | P4-S1-S6 regression                    | `pnpm test:transaction`: 113 passed, 0 failed, 0 skipped                                                                   |
|  19 | Phase 3 regression                     | Wallet/reward/transaction-reward/daily-job/admin-reward/ledger: 124 passed, 0 failed, 4 skipped                            |
|  20 | Migration rebuild                      | Database integration: 22 passed, 0 failed, 0 skipped                                                                       |
|  21 | Checksum/migrate/seed                  | 18 checksums verified; migrations current; seed idempotent on two runs                                                     |
|  22 | Drift                                  | No database schema drift detected                                                                                          |

## Query-plan evidence and index decision

Evidence database contained 270 confirmed transaction rows.

| Read path      | Plan used                                    | Execution |
| -------------- | -------------------------------------------- | --------: |
| Merchant list  | `transactions_merchant_time_idx` index scan  |  0.354 ms |
| Member list    | `transactions_member_time_idx` index scan    |  0.344 ms |
| Receipt/detail | `transactions_number_unique` index-only scan |  0.131 ms |

The only sequential scan in the captured plans belonged to the evidence
fixture's subquery used to choose the most recently created sample row. The
actual merchant, member, and detail paths all used their intended indexes.
Because the required paths did not sequentially scan the transaction table, no
P4-S7 index migration is justified.

## Concurrent local endpoint latency

Twenty requests per endpoint were issued concurrently against local NestJS and
PostgreSQL. These figures are engineering evidence, not a production SLA.

| Endpoint        |       p50 |       p95 |       p99 |
| --------------- | --------: | --------: | --------: |
| Preview         |  83.92 ms | 100.21 ms | 100.29 ms |
| Confirm         | 308.93 ms | 525.12 ms | 525.93 ms |
| Merchant list   |  33.13 ms |  36.56 ms |  36.75 ms |
| Merchant detail |  25.38 ms |  28.06 ms |  28.34 ms |

Unexpected error rate: **0 / 80 (0%)**.

## Verification results

| Command / suite                     | Result                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                 | Failed: 5 pre-existing, out-of-scope files; all P4-S7 files passed targeted Prettier                |
| `pnpm lint`                         | Failed: 73 pre-existing errors in untracked host/bridge helper files; all P4-S7 files passed ESLint |
| `pnpm typecheck`                    | Passed                                                                                              |
| `pnpm build`                        | Passed                                                                                              |
| `pnpm test:database`                | 49 passed, 0 failed, 0 skipped                                                                      |
| `pnpm test`                         | 970 passed, 0 failed, 0 skipped                                                                     |
| `pnpm test:database:integration`    | 22 passed, 0 failed, 0 skipped                                                                      |
| `pnpm test:transaction`             | 113 passed, 0 failed, 0 skipped                                                                     |
| Phase 3 targeted regression         | 124 passed, 0 failed, 4 skipped                                                                     |
| Migration checksum / migrate / seed | 18 verified; current; idempotent across two seed runs                                               |
| Drift                               | No schema drift                                                                                     |

## Residual risks and limitations

1. The latency and EXPLAIN evidence is local and uses 270 rows, not a
   production-scale dataset. A later authorized production-readiness phase must
   repeat it with representative cardinality, network latency, and sustained
   load.
2. Local verification uses Node 26.4.0 while Phase 4 CI uses Node 24. The CI job
   remains the authoritative runtime parity check.
3. The existing in-memory rate limiter remains single-instance. Distributed
   rate limiting remains backlog item `AUTH-INFRA-001` and is required before
   multi-instance public production launch.
4. Rotation of the shared authentication pepper invalidates outstanding opaque
   Preview references. Their maximum lifetime is already limited to 60 minutes,
   and no confirmed financial state is lost.
5. `PHASE_REGISTRY.md` has a stale top-level Phase 4 Batch A summary, while its
   current-action section and D-036 correctly authorize P4-S7. Governance
   cleanup is intentionally not included in this engineering commit.
6. P4-S8 final acceptance, production deployment, admin execution APIs,
   analytics, exports, and feature expansion remain outside this scope.
