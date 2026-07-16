# P0-S4A ORM Comparison Re-validation — Prisma vs Drizzle

> **Big Phase:** Phase 0 — Engineering Foundation
> **Small Phase:** P0-S4A — ORM Comparison and Recommendation
> **Re-validation date:** 2026-07-16
> **Status:** **RECOMMENDATION ONLY — AWAITING COMMAND CENTER ORM GATE**
> **Scope:** Documentation and evidence correction only. This report does not select or install an ORM.

---

## 1. Evidence labels

Every material technical or project claim in this report uses one of these labels:

- **[OFFICIAL]** — directly supported by first-party Prisma, Drizzle, NestJS, or iPoint governance documentation.
- **[REGISTRY]** — observed from the package metadata and distribution tags published to the npm registry.
- **[THIRD-PARTY]** — supported by a community-maintained package or source, not by the ORM/framework owner.
- **[INFERRED]** — engineering judgment derived from official capabilities and iPoint requirements; it is not a vendor guarantee.
- **[POC]** — observed from reproducible local commands or tracked PoC artifacts. ORM capability claims are not marked `[POC]` unless their artifacts and commands are available in this branch.

The original report's deleted temporary PoCs are not reproducible from Git. Their measurements and completion claims are therefore not accepted as evidence in this re-validation.

---

## 2. Executive finding

- **[REGISTRY]** On 2026-07-16, the npm `latest` tags resolve to Prisma ORM `7.8.0`, Drizzle ORM `0.45.2`, and Drizzle Kit `0.31.10`. Prisma v6.x and Drizzle ORM v0.40.x must not be presented as the current baselines.
- **[REGISTRY]** Drizzle ORM v1 is not the npm stable line at this review date. The `latest` tag remains `0.45.2`, while the `rc` tag resolves to `1.0.0-rc.4`.
- **[INFERRED]** This report therefore compares the current stable package lines and excludes release-candidate-only behavior from production scoring.
- **[INFERRED]** Both ORMs can model the core PostgreSQL structures iPoint needs, but neither ORM by itself guarantees ledger immutability, Maker/Checker separation, idempotency, or audit completeness.
- **[INFERRED]** The original 366–366 tie was an arithmetic result of subjective scores, not empirical proof of equivalence. Several decisive inputs were inaccurate, so that total must not be used at the ORM gate.
- **[INFERRED]** No ORM should be declared from the current evidence. A checked-in, reproducible PoC is still required for project-specific transaction, migration, PostgreSQL constraint, and NestJS lifecycle questions.

---

## 3. Critical claim re-validation

### 3.1 Prisma transactions and retry behavior

- **[OFFICIAL]** Prisma supports nested writes, batch transactions, and interactive transactions. A nested write is one atomic ORM operation over related records; it is not a nested database transaction or savepoint.
- **[OFFICIAL]** Nested `$transaction` rollback behavior through SQL savepoints was introduced in Prisma ORM v7.5.0.
- **[OFFICIAL]** Prisma documents transaction isolation settings and returns `P2034` for transaction write conflicts or deadlocks.
- **[INFERRED]** The original claim of automatic built-in serialization retry was inaccurate. Prisma's official example implements a bounded retry loop in application code; iPoint must design and test its own retry policy.

### 3.2 Prisma down migrations

- **[OFFICIAL]** Prisma Migrate has no native `migrate down` command that automatically reverses an applied migration.
- **[OFFICIAL]** Prisma documents a `migrate diff --script` workflow that can generate a `down.sql` file. For a failed production migration, operators can execute that SQL and then use `migrate resolve --rolled-back` after verifying database state.
- **[OFFICIAL]** If an up migration completed successfully and must be reverted, Prisma's documented approach is to restore the desired schema state and create a new forward migration.
- **[INFERRED]** Prisma therefore supports an official down-SQL recovery workflow, but not native history-rewinding rollback. Custom SQL and data changes still require manually authored reversal logic.

### 3.3 Drizzle down migrations

- **[OFFICIAL]** Drizzle Kit documents `generate`, `migrate`, `push`, `pull`, `check`, `up`, and `export`. The documented `migrate` flow applies previously unapplied SQL migration files.
- **[OFFICIAL]** Drizzle Kit can create empty custom SQL migrations, allowing a team to author explicit compensating or reversal SQL.
- **[OFFICIAL]** The official command set does not document a native automatic `down`/rollback command. `drizzle-kit up` upgrades migration snapshots; it does not roll back a database. The v1 migration guide also removes the older `drop` command.
- **[INFERRED]** The original Drizzle rollback score was overstated. Human-readable SQL can make recovery easier to review, but that is not equivalent to generated or automatically applied down migrations.

### 3.4 Prisma and NestJS integration

- **[OFFICIAL]** NestJS publishes an official Prisma recipe showing direct integration through a project-owned `PrismaService` and Nest dependency injection.
- **[OFFICIAL]** The current recipe explicitly covers Prisma v7 module-format and driver-adapter setup. It does not instruct projects to install an official Nest-owned or Prisma-owned integration module.
- **[REGISTRY]** `pnpm view @nestjs/prisma version` returns npm `E404`; there is no package by that name in the registry at this review date.
- **[THIRD-PARTY]** `nestjs-prisma` is maintained under the `notiz-dev` GitHub organization. npm reports version `0.27.0` and the repository `notiz-dev/nestjs-prisma`.
- **[INFERRED]** The original statements that an official `@nestjs/prisma` package is maintained by the Prisma team and that `nest add @nestjs/prisma` is the official path were inaccurate.
- **[INFERRED]** Drizzle can also be wrapped in a small project-owned Nest provider. The absence of an official Nest recipe is an ecosystem/documentation difference, not proof that its runtime integration is technically weaker.

### 3.5 Current version baseline

| Product        | Re-validated package baseline | Classification | Gate treatment                                              |
| -------------- | ----------------------------: | -------------- | ----------------------------------------------------------- |
| Prisma ORM     |            `7.8.0` (`latest`) | **[REGISTRY]** | Compare current v7 behavior; do not present v6.x as current |
| Prisma ORM v6  |             `6.19.2` (`prev`) | **[REGISTRY]** | Historical compatibility line only                          |
| Drizzle ORM    |           `0.45.2` (`latest`) | **[REGISTRY]** | Stable comparison baseline                                  |
| Drizzle Kit    |          `0.31.10` (`latest`) | **[REGISTRY]** | Stable migration-tool baseline                              |
| Drizzle ORM v1 |           `1.0.0-rc.4` (`rc`) | **[REGISTRY]** | Track separately; do not score RC-only behavior as stable   |

### 3.6 Scoring tie rationale

- **[INFERRED]** The original score used undocumented judgment calls, including Prisma 5/5 for transaction support and NestJS integration, Drizzle 5/5 for rollback, and Prisma 5/5 vs Drizzle 2/5 for drift detection.
- **[OFFICIAL]** Drizzle Kit's `check` validates generated migration-history consistency and branch collisions. It is not the same operation as comparing a live database to the expected schema.
- **[OFFICIAL]** Prisma `migrate diff` can compare schema sources, and Prisma migration history detects changed or missing applied migration files.
- **[INFERRED]** Those tools solve overlapping but different problems. A single “drift detection” number hid the distinction between migration-history integrity and live-schema drift.
- **[INFERRED]** Because the original inputs were materially wrong and no reproducible benchmark exists, the 366–366 total is withdrawn rather than recalculated into another false-precision number.

### 3.7 Ledger, Maker/Checker, audit, and versioned-rule claims

- **[OFFICIAL]** iPoint requires append-only MCP, iPoint, and commission ledgers; compensating entries; atomic critical writes; idempotency; and Maker/Checker separation for all manual MCP/iPoint credit and debit adjustments.
- **[INFERRED]** Prisma `create` and Drizzle `insert` APIs do not enforce append-only behavior. Both also expose update/delete operations unless application design and database permissions prevent them.
- **[INFERRED]** Maker/Checker requires domain state transitions, authorization, a `maker_id != checker_id` invariant, concurrency protection, idempotent execution, and privileged-action audit. Merely defining relations and unique indexes is insufficient.
- **[INFERRED]** Database roles, restrictive grants, constraints where expressible, and optional triggers can provide defense in depth. Service-level authorization and tests remain mandatory.
- **[INFERRED]** Neither ORM receives a scoring advantage for these business invariants until a PoC proves the complete flow under concurrent approval/execution attempts.

---

## 4. Corrected capability comparison

| Criterion                                   | Prisma                                                       | Drizzle                                                                                                 | Evidence assessment                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL numeric, UUID, timestamptz, enum | Supported                                                    | Supported                                                                                               | **[OFFICIAL]** Both expose the required column families. **[INFERRED]** Exact project DDL still needs PoC inspection |
| Interactive transaction                     | `$transaction(async tx => ...)`                              | `db.transaction(async tx => ...)`                                                                       | **[OFFICIAL]** Both support callback transactions                                                                    |
| Nested transaction/savepoint                | Available from Prisma 7.5                                    | Nested `tx.transaction(...)` savepoints documented                                                      | **[OFFICIAL]** Current stable lines support the listed behavior                                                      |
| Serialization/deadlock retry                | Project-owned retry policy required                          | Project-owned retry policy required                                                                     | **[INFERRED]** No automatic retry claim is accepted for either baseline                                              |
| Generated up migration SQL                  | Supported                                                    | Supported                                                                                               | **[OFFICIAL]** Both produce reviewable SQL migration files                                                           |
| Native automatic down command               | Not documented                                               | Not documented                                                                                          | **[OFFICIAL]** Both require explicit recovery/reversal workflow                                                      |
| Down SQL assistance                         | `migrate diff --script` official workflow                    | Custom SQL migration authoring                                                                          | **[OFFICIAL]** Capabilities differ; neither rewinds production history automatically                                 |
| Migration-history integrity                 | Applied migration checks and history validation              | `drizzle-kit check` for generated-history consistency/collisions                                        | **[OFFICIAL]** Both capabilities are documented. **[INFERRED]** Validate exact CI commands in PoC                    |
| Live schema comparison                      | `migrate diff` supports schema-source comparison             | `push` introspects and diffs before applying; no equivalent non-mutating drift command established here | **[OFFICIAL]** Listed behavior is documented. **[INFERRED]** Prisma has the clearer non-mutating official workflow   |
| NestJS integration                          | Official NestJS recipe; optional third-party `nestjs-prisma` | Project-owned provider; optional community packages                                                     | **[OFFICIAL] [THIRD-PARTY] [INFERRED]** No official ORM-specific Nest package for either is assumed                  |
| Ledger/Maker/Checker enforcement            | Application/database design required                         | Application/database design required                                                                    | **[INFERRED]** ORM-neutral domain requirement                                                                        |
| Raw SQL                                     | Tagged raw query APIs                                        | SQL template integrated with query builder                                                              | **[OFFICIAL]** Listed APIs are documented. **[INFERRED]** Project query ergonomics require PoC                       |

---

## 5. PoC evidence status

### 5.1 What is verifiable in this branch

- **[POC]** ORM capability PoC evidence: none. No Prisma schema, Drizzle schema, generated migration, benchmark script, transaction test, or command transcript is tracked in this branch.
- **[INFERRED]** Illustrative snippets in the original report are examples, not execution evidence.

### 5.2 Original claims that are withdrawn

The following original claims are not independently reproducible and are withdrawn:

- **[POC] WITHDRAWN** “complete schema definition covering all 8 entity groups”;
- **[POC] WITHDRAWN** Prisma schema validation, client generation in 383 ms, and migration-diff success;
- **[POC] WITHDRAWN** Drizzle validation, 12-table/6-enum/17-index migration generation;
- **[POC] WITHDRAWN** 2 s vs 500 ms migration generation, 100–200 ms vs 5–10 ms startup, and 15 MB vs 200 KB bundle measurements;
- **[POC] WITHDRAWN** transaction, Maker/Checker, versioned-rule, audit, pagination, and raw-SQL patterns described as verified.

### 5.3 Minimum reproducible gate PoC

Before Command Center can use this comparison to choose an ORM, a new checked-in PoC should demonstrate:

1. **[INFERRED]** The same PostgreSQL schema subset in both ORMs: market, wallet, ledger entry, adjustment request/action, audit event, versioned rule, and idempotency record.
2. **[INFERRED]** Exact generated up SQL plus explicit recovery SQL for one additive and one destructive schema change.
3. **[INFERRED]** Concurrent wallet update + ledger append with optimistic conflict and bounded retry.
4. **[INFERRED]** Concurrent Maker/Checker attempts proving self-approval rejection and exactly-once execution.
5. **[INFERRED]** Live-schema drift and migration-history collision checks using documented CLI commands.
6. **[INFERRED]** A project-owned NestJS provider with startup, shutdown, transaction propagation, and test isolation.
7. **[INFERRED]** Repeated measurements on the same machine, Node version, PostgreSQL version, driver, schema, and command sequence.

---

## 6. Recommendation posture

### No ORM declaration at this review

- **[INFERRED]** Prisma currently has stronger first-party NestJS learning material and a clearer non-mutating schema-diff workflow.
- **[INFERRED]** Drizzle currently exposes savepoint nesting in its stable transaction API and offers SQL-oriented schema/query composition with fewer generated-client concerns.
- **[INFERRED]** These are trade-offs, not a sufficient project decision. The corrected evidence removes the original decisive Prisma integration claim and the original decisive Drizzle rollback claim.
- **[INFERRED]** The gate should remain open until the reproducible PoC in Section 5.3 is reviewed.

---

## 7. Production migration and recovery policy

The following policy is ORM-neutral:

- **[INFERRED]** Production migration history should be append-only. A successful migration that must be reversed should normally be followed by a new forward migration restoring the intended schema.
- **[INFERRED]** Every risky migration requires reviewed recovery SQL, data-backfill/reversal handling, lock-impact assessment, and a tested application rollback order.
- **[INFERRED]** A failed migration must be reconciled with the ORM's migration-history table only after the database state has been verified.
- **[INFERRED]** Ledger corrections must use compensating entries through the approved Maker/Checker path; schema rollback procedures do not authorize ad hoc ledger update/delete operations.
- **[INFERRED]** `push`, reset, drop, or other destructive development shortcuts must not be part of the production deployment path.

---

## 8. Repository and verification evidence

- **[POC]** The clean branch is based directly on `c7c588b6b999a48f15923a7e68f22fea03360c77`; neither `ee0f607b` nor `903345d0` was cherry-picked.
- **[POC]** The current damaged worktree's file blob is `13da9dcff6e98e4cc9427433cf2405fd64f4a1df`, while commit `903345d0` contains the corrected report blob `8ffd81f70ebd039740276cccd4d0b9dcea078454`. The latter was used as the content baseline because it matches the task's stated “Codex-validated version” intent.
- **[POC]** Package baselines were queried without installing ORM dependencies: Prisma `7.8.0`, Drizzle ORM `0.45.2`, Drizzle Kit `0.31.10`, `nestjs-prisma` `0.27.0`, and `@nestjs/prisma` returned `E404`.
- **[POC]** Clean-worktree install, lint, typecheck, build, test, whitespace, and one-file-diff results are recorded in the delivery evidence accompanying this commit.

---

## 9. Decision gate checklist

| #   | Gate item                                                       | Status           |
| --- | --------------------------------------------------------------- | ---------------- |
| 1   | Current stable package baselines corrected                      | Complete         |
| 2   | Prisma transaction and retry claims corrected                   | Complete         |
| 3   | Prisma down-migration claim corrected                           | Complete         |
| 4   | Drizzle down-migration claim corrected                          | Complete         |
| 5   | Prisma/NestJS official vs third-party distinction corrected     | Complete         |
| 6   | Original scoring tie rationale corrected                        | Complete         |
| 7   | Ledger and Maker/Checker claims classified as domain invariants | Complete         |
| 8   | Original PoC independently reproducible                         | **Not complete** |
| 9   | New side-by-side project PoC checked in                         | **Not complete** |
| 10  | Command Center ORM gate decision recorded                       | **Not complete** |

---

## 10. First-party references

- [Prisma transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
- [Prisma v7.5 nested transaction savepoints](https://www.prisma.io/changelog/2026-03-11)
- [Prisma down migration workflow](https://docs.prisma.io/docs/orm/prisma-migrate/workflows/generating-down-migrations)
- [Prisma Migrate commands](https://www.prisma.io/docs/cli/migrate)
- [Prisma migration histories](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/migration-histories)
- [Prisma release notes](https://www.prisma.io/changelog)
- [Drizzle transactions and savepoints](https://orm.drizzle.team/docs/transactions)
- [Drizzle migration fundamentals](https://orm.drizzle.team/docs/migrations)
- [Drizzle Kit overview](https://orm.drizzle.team/docs/kit-overview)
- [Drizzle Kit check](https://orm.drizzle.team/docs/drizzle-kit-check)
- [Drizzle custom migrations](https://orm.drizzle.team/docs/kit-custom-migrations)
- [Drizzle v0 to v1 changes](https://orm.drizzle.team/docs/v0-v1-changes)
- [NestJS Prisma recipe](https://docs.nestjs.com/recipes/prisma)
- [NestJS database integrations](https://docs.nestjs.com/techniques/database)

## 11. Package and third-party references

- npm distribution tags queried with `pnpm view prisma dist-tags --json`, `pnpm view drizzle-orm dist-tags --json`, and `pnpm view drizzle-kit dist-tags --json` on 2026-07-16.
- [notiz-dev/nestjs-prisma](https://github.com/notiz-dev/nestjs-prisma) — **[THIRD-PARTY]** community NestJS integration package and schematic.

---

> **IMPORTANT**
>
> **RECOMMENDATION ONLY — AWAITING COMMAND CENTER ORM GATE**
>
> This re-validation corrects the comparison evidence but does not select Prisma or Drizzle. No ORM dependency or production integration is authorized by this report. The final selection requires a reproducible PoC, Command Center review, and a recorded governance decision.
