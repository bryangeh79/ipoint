# ORM GATE CLOSED — DRIZZLE APPROVED

# P0-S4A ORM Comparison — Reproducible PoC Evidence

> **Big Phase:** Phase 0 — Engineering Foundation
>
> **Small Phase:** P0-S4A — Reproducible ORM Evaluation
>
> **Evidence date:** 2026-07-16
>
> **Branch:** `task/p0-s4a-orm-poc`
>
> **Status:** **P0-S4A COMPLETE; ORM GATE CLOSED — DRIZZLE APPROVED BY D-006**

## 1. Scope and evidence policy

This report replaces the earlier documentation-only evidence gap with a checked-in, executable PoC under `experiments/orm-comparison/`. It compares Prisma ORM 7.8.0 and Drizzle ORM 0.45.2 using separate PostgreSQL 17.10 containers, identical core columns, the same deterministic seed, and the same domain assertions.

Evidence labels:

- **[POC]**: produced by the tracked runner and retained in `experiments/orm-comparison/results/`.
- **[OFFICIAL]**: first-party behavior encoded in the tested CLI/API.
- **[INFERRED]**: engineering interpretation; not vendor guarantee or governance approval.
- **[LIMITATION]**: a known boundary that must remain visible at the gate.

No production file under `apps/` or `packages/` is modified. Both NestJS providers are experimental only.

## 2. Reproduction baseline

**[POC]** Complete command:

```powershell
pnpm install --frozen-lockfile
pnpm orm-poc
```

**[POC]** The runner starts and later removes:

| ORM     | Image                | Database             | Host port |
| ------- | -------------------- | -------------------- | --------: |
| Prisma  | `postgres:17-alpine` | `ipoint_prisma_poc`  |     55431 |
| Drizzle | `postgres:17-alpine` | `ipoint_drizzle_poc` |     55432 |

**[POC]** Recorded PostgreSQL is 17.10, `max_connections=100`, `deadlock_timeout=100ms`, default isolation `read committed`, server timezone UTC. Serializable tests explicitly request serializable isolation.

**[POC]** Package/runtime baseline:

| Component                             | Version  |
| ------------------------------------- | -------- |
| Prisma / client / PG adapter          | 7.8.0    |
| Drizzle ORM                           | 0.45.2   |
| Drizzle Kit                           | 0.31.10  |
| node-postgres                         | 8.22.0   |
| NestJS experimental provider baseline | 10.4.22  |
| pnpm                                  | 9.15.9   |
| Docker                                | 29.3.1   |
| Validated target Node                 | v24.18.0 |

**[POC]** P0-S4B repeated the complete PoC on Node v24.18.0. All assertions passed and runtime-specific evidence is retained in `results/node-v24.18.0-*` files. The earlier Node v26.4.0 evidence remains retained as historical evidence.

**[WITHDRAWN]** “Prisma on Node 22 has behavior differences.” No Node 22 execution exists in this evidence set, so the claim has no evidentiary basis.

## 3. Data model and SQL evidence

**[POC]** Both ORMs define the same eight entities:

1. Market
2. Wallet
3. LedgerEntry
4. AdjustmentRequest
5. AdjustmentAction
6. AuditEvent
7. VersionedRule
8. IdempotencyRecord

**[POC]** Live-catalog comparison reports identical tables, column order, PostgreSQL data types, nullability, numeric precision/scale, and enum UDT names. The complete signature is in `results/schema-comparison.json`.

**[POC]** Both final schemas include:

- UUID primary keys and separate unique public IDs;
- exact `numeric(24,8)` wallet, ledger, and adjustment amounts;
- `timestamptz(6)` persisted timestamps;
- PostgreSQL enums and positive/range checks;
- market, wallet, request, reversal, and executed-ledger foreign keys;
- public/source/idempotency/version uniqueness;
- market/status, wallet/effective-time, audit, approval, rule-effective, and lock indexes;
- `maker_id != checker_id` when checker is present;
- an append-only trigger rejecting ledger UPDATE/DELETE with SQLSTATE `55000`.

**[POC]** Prisma emits many uniqueness rules as unique indexes; Drizzle emits several as `UNIQUE` constraints. The PostgreSQL representation differs, but the uniqueness semantics and required behavior are equivalent and directly exercised.

## 4. Migration experiments

| Experiment              | Prisma result                                               | Drizzle result                                       |
| ----------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| Initial migration       | 2 migrations applied                                        | 3 migrations applied                                 |
| From-zero rebuild       | 8/8 tables + deterministic seed                             | 8/8 tables + deterministic seed                      |
| Additive migration      | Nullable `correlation_id` + partial index present           | Same                                                 |
| Destructive migration   | Column/index removed                                        | Same                                                 |
| Recovery SQL            | Column/index recreated                                      | Same                                                 |
| Recovery data           | Previous value became NULL                                  | Previous value became NULL                           |
| Migration history check | Applied SQL comment change not detected by `migrate status` | Applied SQL comment change not detected by `migrate` |
| Live drift              | Prisma diff exited 2 and generated rogue-column removal SQL | Read-only catalog probe detected rogue column        |

**[LIMITATION]** Recovery SQL restores structure, not removed values. A production destructive migration needs backup/restore rehearsal, data recovery design, and explicit destructive-change approval.

**[LIMITATION]** Neither tested deployment/status path detected a comment-only change in an already-applied SQL file. CI should independently checksum immutable migration files.

**[INFERRED]** Prisma has the stronger tested non-mutating live-drift workflow: `prisma migrate diff --from-config-datasource --to-schema ... --exit-code --script`. For stable Drizzle Kit, this PoC did not establish an equivalent non-mutating live-database command, so it used a PostgreSQL catalog probe.

## 5. Transaction and concurrency evidence

**[POC]** Both ORMs passed:

- explicit rollback;
- inner savepoint rollback while the outer write commits;
- wallet snapshot + ledger atomicity under injected failure;
- serializable concurrent wallet updates;
- bounded application-owned retry;
- deliberate deadlock detection;
- connection cleanup.

**[POC/PARTIAL]** Ten deliberately conflicting serializable credits produced, for each ORM:

- final balance 10;
- exactly 10 ledger entries;
- 45 observed serialization conflicts;
- 55 total attempts;
- maximum 10 attempts within a bound of 20.

The bound of 20 is an experimental correctness-probe setting, not a production retry recommendation. Production retry count, backoff, jitter, observability, and exhaustion handling remain to be designed.

**[POC]** The deadlock probe created opposing row-lock order. PostgreSQL selected exactly one victim with SQLSTATE `40P01` for each ORM. Prisma exposed it through a `P2010` raw-query wrapper with the original PostgreSQL code in metadata; Drizzle exposed the driver error/cause with `40P01`.

**[INFERRED]** Both require project-owned classification, backoff, observability, and a bounded retry policy. The run does not support a claim of automatic ORM retry.

## 6. Idempotency evidence

**[POC]** For both ORMs:

- sequential same-key retry returned the original ledger entry and exact decimal result;
- sixteen concurrent callers using the same key produced one result, one ledger row, and zero duplicates;
- same key with a different request hash was rejected;
- the idempotency result was persisted and returned consistently.

**[INFERRED]** Correctness came from transaction scope plus PostgreSQL unique constraints and persisted results. It is not an ORM feature by itself.

## 7. Maker/Checker evidence

**[POC/PARTIAL]** For both ORMs:

- maker self-approval was rejected and the request stayed PENDING;
- two concurrent checkers produced one execution and one non-executing outcome;
- a later repeat did not execute again;
- the observed transition was PENDING → APPROVED → EXECUTED;
- exactly two action rows, two audit rows, and one ledger row were retained;
- the executed ledger FK and request idempotency constraints remained valid.

**[INFERRED]** The observed exactly-once result depends on the row-locking transaction plus database uniqueness and foreign-key constraints. The database check provides defense in depth, but production still requires authenticated actor authorization and market/action permission checks outside this PoC.

## 8. Ledger evidence

**[POC]** Direct UPDATE and DELETE both failed with SQLSTATE `55000` under both ORMs.

**[POC]** A compensating debit retained the original entry and produced:

- wallet balance `20.00000000`;
- signed ledger total `20.00000000`;
- original ledger row still present;
- reversal link to the original entry.

**[INFERRED]** The trigger is a strong guard for the application role, but production privilege design must also prevent trigger bypass or ownership-level DDL/DML abuse.

## 9. NestJS integration evidence

**[POC/PARTIAL]** Project-owned experimental providers exist separately under `prisma/` and `drizzle/`, not under `apps/api`.

Both passed:

- module startup and shutdown hooks;
- dependency injection by explicit provider token;
- AsyncLocalStorage transaction propagation to a nested consumer;
- rollback-based test isolation;
- connection cleanup with zero pool connections after module close.

The probes create real Nest testing modules, start them, inject each provider, use transaction context, roll back test data, close the modules, and verify zero pool connections. **[LIMITATION]** These are lifecycle/transaction probes, not production modules. Authentication, authorization, telemetry, health integration, request scoping, and production pooling policy remain deferred until an ORM is approved.

## 10. Failures and limitations retained as evidence

The reproducibility work found and corrected:

- Windows/Node 26 `.cmd` child-process incompatibility;
- Prisma raw-query deserialization of PostgreSQL internal `char` and `void` types;
- an insufficient initial retry bound under deliberately synchronized conflicts;
- exact-decimal object/string normalization for persisted idempotency responses.

Details are retained in `results/known-failures.md`. Final command stdout/stderr, exit codes, and timings are in `results/commands.jsonl` and `results/timing.json`.

Additional limitations:

- one-machine timings are not performance benchmarks;
- concurrency levels are correctness probes, not load tests;
- shared operations intentionally use reviewable raw SQL inside each ORM's real transaction adapter so domain semantics remain identical; query-builder ergonomics were not scored;
- no production API, permission system, real money movement, or external integration was exercised.

## 11. Evidence-based recommendation

### Recommendation

**[INFERRED] `APPROVE_DRIZZLE`**, with **MEDIUM** confidence and the mitigations below. This is a recommendation to the Command Center, not an ORM selection or gate closure.

### Why Drizzle fits iPoint

- **Ledger and Maker/Checker:** both ORMs passed the same PostgreSQL transaction and constraint probes, so correctness is database- and application-owned. Drizzle keeps the SQL, locking, constraint, and driver-error surface closer to the implementation that iPoint must review carefully.
- **Migration reviewability and recovery:** direct SQL migrations are easier to inspect alongside append-only triggers, exact-decimal constraints, recovery SQL, and market-scoped indexes. This matters more to iPoint than maximizing ordinary CRUD abstraction.
- **Decimal precision and multi-market:** both candidates preserve `numeric(24,8)`, `market_id`, UTC timestamps, and versioned rules. Drizzle does not receive a correctness advantage here, but it does not block these locked requirements.
- **Modular monolith and long-term maintenance:** a thin typed SQL layer fits explicit domain-module boundaries and reduces pressure to make the ORM client the architecture boundary.
- **Team DX and CI complexity:** Prisma has the stronger tested drift command and a more guided client workflow; Drizzle's smaller abstraction surface is preferred for ledger-heavy code, provided CI adds the missing migration controls.

### Maximum risk

**[POC]** The maximum identified Drizzle risk is migration governance: this PoC did not establish a stable, non-mutating Drizzle Kit live-database diff equivalent to the tested Prisma command, and neither tool detected a comment-only change to applied migration SQL.

### Risk mitigation

Before production schema work, require immutable migration checksums, a read-only PostgreSQL catalog/schema-dump diff in CI, forward migration tests from zero and from the latest release snapshot, explicit destructive-change approval, backup/restore rehearsal, and reviewed recovery SQL. Keep ledger constraints and append-only triggers in explicit SQL migrations.

### Why not Prisma for this gate

Prisma is not rejected on correctness; it passed the same core probes and had the stronger tested live-drift workflow. It is not the primary recommendation because iPoint's highest-risk work will already require explicit PostgreSQL SQL, constraints, locks, triggers, and recovery review. The additional client abstraction does not remove that responsibility, and the PoC did not demonstrate enough offsetting advantage for ledger-heavy modules.

### Where Prisma fits

Prisma remains a strong fit for CRUD-heavy modules, teams prioritizing generated-client ergonomics, and environments where its non-mutating live-schema diff is the dominant operational requirement. It remains a valid Command Center option.

### Confidence

**MEDIUM.** Functional evidence is strong for both ORMs and Node 24 LTS validation now passes, but production authorization is not tested, the retry policy is experimental, and long-duration maintenance evidence does not yet exist.

## 12. Evidence files

- `experiments/orm-comparison/README.md`
- `experiments/orm-comparison/results/commands.jsonl`
- `experiments/orm-comparison/results/versions.json`
- `experiments/orm-comparison/results/environment.json`
- `experiments/orm-comparison/results/schema-comparison.json`
- `experiments/orm-comparison/results/migration-results.json`
- `experiments/orm-comparison/results/drift-results.json`
- `experiments/orm-comparison/results/concurrency-results.json`
- `experiments/orm-comparison/results/test-summary.json`
- `experiments/orm-comparison/results/timing.json`
- `experiments/orm-comparison/results/sql/`
- `experiments/orm-comparison/results/known-failures.md`
- `experiments/orm-comparison/results/node-v26.4.0-commands.jsonl`
- `experiments/orm-comparison/results/node-v26.4.0-environment.json`
- `experiments/orm-comparison/results/node-v26.4.0-test-summary.json`
- `experiments/orm-comparison/results/node-v26.4.0-versions.json`
- `experiments/orm-comparison/results/node-v24.18.0-commands.jsonl`
- `experiments/orm-comparison/results/node-v24.18.0-environment.json`
- `experiments/orm-comparison/results/node-v24.18.0-test-summary.json`
- `experiments/orm-comparison/results/node-v24.18.0-versions.json`
- `experiments/orm-comparison/results/GATE_EVIDENCE_INDEX.md`

## 13. Gate verification

| Check                                                                                                  | Result                                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                       | PASS                                                                                                                    |
| `pnpm exec prettier --check experiments/orm-comparison docs/06-phase-reports/P0-S4A_ORM_COMPARISON.md` | PASS                                                                                                                    |
| `pnpm format:check`                                                                                    | DOCUMENTED BASELINE EXCEPTION: 95 pre-existing files outside PoC ownership; exact paths are in `GATE_EVIDENCE_INDEX.md` |
| `pnpm lint`                                                                                            | PASS                                                                                                                    |
| `pnpm typecheck`                                                                                       | PASS                                                                                                                    |
| `pnpm build`                                                                                           | PASS                                                                                                                    |
| `pnpm test`                                                                                            | PASS: 7 files, 33 tests                                                                                                 |
| `pnpm orm-poc`                                                                                         | PASS on target Node v24.18.0; all PoC assertions passed                                                                 |
| `git diff --check`                                                                                     | PASS                                                                                                                    |

## 14. ORM Gate decision

ChatGPT Command Center selected `APPROVE_DRIZZLE` and recorded the production-baseline requirements in D-006. Prisma was evaluated but not selected. PostgreSQL remains the source of truth, decimal values use `numeric`, migrations require explicit reviewable SQL and mandatory checksums, applied migration recovery is forward-fix, and ledger immutability remains a database/application design responsibility.

P0-S4B repeated the complete PoC on target Node v24.18.0. All assertions passed, the disposable containers were removed, and the D-006 target-runtime validation condition is satisfied for review.

---

> **ORM GATE CLOSED — DRIZZLE APPROVED**
>
> The PoC evidence informed D-006. Governance approval selects Drizzle; the evidence itself remains bounded by the recorded Node 24 LTS limitation.
