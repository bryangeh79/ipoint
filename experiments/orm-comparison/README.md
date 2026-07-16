# RECOMMENDATION ONLY — AWAITING COMMAND CENTER ORM GATE

# P0-S4A Reproducible ORM Evaluation

This checked-in PoC compares Prisma ORM 7.8.0 and Drizzle ORM 0.45.2 against the same PostgreSQL 17 model and the same iPoint-critical failure scenarios. It is evidence for the Command Center gate; it does not select an ORM and must not be copied into `apps/api` as production integration.

## Scope and safety

- Everything executable is under `experiments/orm-comparison/`.
- Two disposable `postgres:17-alpine` containers use separate databases and host ports: Prisma `55431`, Drizzle `55432`.
- The runner creates, tests, and removes both containers and volumes. It never uses the repository's normal `compose.yaml` database.
- Credentials in `compose.poc.yaml` are local disposable PoC values, not production secrets.
- No payment, message, AI, WhatsApp, or production side effect is enabled.

## Prerequisites

- Docker Engine with Compose
- pnpm 9.15.9
- A Prisma-supported Node release. Node 24 is recommended for reproducing the gate evidence.

The recorded host used Node 26.4.0. Prisma 7.8.0 printed that its supported majors are 20.19+, 22.12+, and 24.x. All commands completed on Node 26, but this is a material limitation: repeat the final gate run on Node 24 before production selection.

## Reproduction

From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm orm-poc
```

`pnpm orm-poc` performs the complete run:

1. starts and health-checks both PostgreSQL containers;
2. drops/recreates only the two disposable schemas;
3. validates/generates Prisma and checks Drizzle migration history;
4. applies both migration histories from zero;
5. applies deterministic seed data;
6. runs additive, destructive, recovery, history-conflict, and drift probes;
7. runs transaction, idempotency, Maker/Checker, ledger, and NestJS lifecycle tests;
8. records command stdout/stderr, exit codes, timings, versions, PostgreSQL settings, and assertions;
9. removes the containers and volumes in `finally`, including on failure.

Manual infrastructure commands are available for inspection:

```powershell
pnpm orm-poc:infra:up
pnpm orm-poc:infra:down
```

## Layout

- `prisma/`: Prisma schema, generated migration history, transaction harness, experimental Nest provider.
- `drizzle/`: Drizzle schema, generated migration history/snapshots, transaction harness, experimental Nest provider.
- `shared/`: deterministic seed, common test model, domain-constraint SQL, additive/destructive/recovery SQL.
- `scripts/run-poc.ts`: single reproducible orchestration entry point.
- `results/`: tracked evidence produced by the last complete run.

## Identical core model

The live catalog probe reports `identicalColumnSignature: true` across all eight tables. PostgreSQL represents some Prisma uniqueness declarations as unique indexes and the equivalent Drizzle declarations as `UNIQUE` constraints; required behavior is equivalent and is exercised directly.

| Entity            | Table                 | Required mapping                                                                                                                     |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Market            | `markets`             | UUID PK, public ID/code unique, currency, IANA timezone, status enum, `timestamptz(6)`                                               |
| Wallet            | `wallets`             | UUID/public ID, market FK, owner/currency composite unique, `numeric(24,8)` balance, optimistic version, composite status index      |
| LedgerEntry       | `ledger_entries`      | UUID/public ID, wallet/self-reversal FKs, positive exact amount, source-once and wallet/idempotency uniqueness, effective-time index |
| AdjustmentRequest | `adjustment_requests` | UUID/public ID, market/wallet/executed-ledger FKs, Maker≠Checker check, positive amount, state enum, idempotency unique              |
| AdjustmentAction  | `adjustment_actions`  | UUID/public ID, request FK, action enum, one action type per request, request/time index                                             |
| AuditEvent        | `audit_events`        | UUID/public ID, market FK, actor/entity/request trace fields, JSON before/after, composite audit indexes                             |
| VersionedRule     | `versioned_rules`     | UUID/public ID, market FK, exact version, effective `timestamptz`, JSON payload, unique market/type/scope/version                    |
| IdempotencyRecord | `idempotency_records` | UUID/public ID, unique scope/key, request hash, state, persisted response, lock/complete timestamps                                  |

Database migrations add defense-in-depth checks and an append-only ledger trigger. Any direct ledger UPDATE or DELETE raises SQLSTATE `55000`; correction requires a new compensating entry. Application authorization is still required in production.

## Test matrix and observed result

| Area            | Experiment                                         | Prisma                                          | Drizzle                                                                                     |
| --------------- | -------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A Schema/SQL    | Same 8 tables, types, nullability and precision    | Pass                                            | Pass                                                                                        |
| A Schema/SQL    | Generated initial SQL retained                     | Pass                                            | Pass                                                                                        |
| B Migration     | From-zero initial migration and deterministic seed | 8/8 tables                                      | 8/8 tables                                                                                  |
| B Migration     | Add nullable column/index                          | Pass                                            | Pass                                                                                        |
| B Migration     | Destructive drop                                   | Pass                                            | Pass                                                                                        |
| B Migration     | Forward recovery                                   | Schema recovered; prior value lost              | Schema recovered; prior value lost                                                          |
| B Migration     | Changed applied migration SQL                      | `migrate status` did not detect                 | `migrate` did not detect                                                                    |
| B Migration     | Live rogue-column drift                            | Prisma diff exit 2 and SQL output               | Read-only catalog probe detected; no equivalent non-mutating stable Kit command established |
| C Transaction   | Explicit rollback                                  | Pass                                            | Pass                                                                                        |
| C Transaction   | Nested transaction/savepoint rolls back inner only | Prisma 7.8 nested `$transaction` pass           | Drizzle nested transaction pass                                                             |
| C Transaction   | Wallet + ledger failure injection                  | Both writes rolled back                         | Both writes rolled back                                                                     |
| C Transaction   | 10 serializable concurrent credits                 | 10 ledger rows / balance 10                     | 10 ledger rows / balance 10                                                                 |
| C Transaction   | Bounded retry                                      | 45 conflicts, max 10 of 20 attempts             | 45 conflicts, max 10 of 20 attempts                                                         |
| C Transaction   | Deliberate deadlock                                | One SQLSTATE `40P01` victim                     | One SQLSTATE `40P01` victim                                                                 |
| D Idempotency   | Same key repeat                                    | Same entry/result                               | Same entry/result                                                                           |
| D Idempotency   | 16 concurrent callers                              | 1 result, 1 ledger, 0 duplicates                | 1 result, 1 ledger, 0 duplicates                                                            |
| D Idempotency   | Same key/different payload                         | Rejected                                        | Rejected                                                                                    |
| E Maker/Checker | Self-approval                                      | Rejected, remains PENDING                       | Rejected, remains PENDING                                                                   |
| E Maker/Checker | Two concurrent checkers                            | Exactly one execution                           | Exactly one execution                                                                       |
| E Maker/Checker | Repeat execution                                   | No second execution                             | No second execution                                                                         |
| E Maker/Checker | State/action/audit evidence                        | PENDING→APPROVED→EXECUTED, 2 actions, 2 audits  | Same                                                                                        |
| F Ledger        | Direct UPDATE/DELETE                               | Blocked                                         | Blocked                                                                                     |
| F Ledger        | Compensating debit                                 | Original retained; wallet 20 = signed ledger 20 | Same                                                                                        |
| G NestJS        | Startup/shutdown/DI                                | Pass                                            | Pass                                                                                        |
| G NestJS        | Transaction propagation/isolation                  | Pass                                            | Pass                                                                                        |
| G NestJS        | Connection cleanup                                 | 0 pool connections after close                  | 0 pool connections after close                                                              |

All assertions in the recorded complete run passed. Exact identifiers and error payloads are in `results/test-summary.json`; timings and retries are observations from one machine, not benchmarks.

## Evidence index

- `results/commands.jsonl`: every command launched by the final runner, stdout, stderr, exit code, start time, and duration.
- `results/versions.json`: Node, pnpm, Docker, PostgreSQL, ORM/driver/Nest versions and PostgreSQL settings.
- `results/environment.json`: containers, ports, databases, OS, and runtime limitation.
- `results/sql/`: Prisma/Drizzle initial SQL and additive/destructive/recovery SQL.
- `results/schema-comparison.json`: complete live column and constraint catalog evidence.
- `results/migration-results.json`: from-zero, additive, destructive, recovery and history-conflict outcomes.
- `results/drift-results.json`: Prisma CLI and Drizzle catalog drift evidence.
- `results/concurrency-results.json`: retries, serialization conflicts, and deadlock outcomes.
- `results/test-summary.json`: all domain and NestJS assertions.
- `results/timing.json`: command and total run timings.
- `results/known-failures.md`: failures found and corrected while making the PoC reproducible.

## Limitations and gate posture

1. The host Node major is outside Prisma's supported range; repeat on Node 24.
2. Neither tested deployment/status command detected an applied SQL file modified only by a comment. CI must checksum immutable migration files independently.
3. Drizzle Kit stable did not provide an established non-mutating live-schema diff command; the PoC used PostgreSQL catalog comparison.
4. Destructive recovery recreates structure but cannot reconstruct data. Production destructive migration requires backup/restore rehearsal and explicit approval.
5. The harness uses each ORM's real connection adapter and transaction/savepoint API, with reviewable raw SQL for cross-ORM-identical domain operations. It tests correctness and lifecycle, not query-builder ergonomics or application authorization.
6. Ten concurrent writers and sixteen idempotent callers are correctness probes, not load or performance tests.
7. Nest providers are experimental and remain outside `apps/api`; no production integration is authorized.

The evidence supports Command Center review but does not approve Prisma or Drizzle. The ORM Gate remains OPEN.
