# P0-S4A ORM Gate Evidence Index

> Evidence status: **ORM GATE CLOSED — DRIZZLE APPROVED BY D-006**
>
> Runtime status: **UNVALIDATED_ON_TARGET_NODE_LTS**
>
> Observed runtime: **Node v26.4.0**; Node 24 LTS was not installed on the correction host.

## Locked versions

The package versions below were audited against `pnpm-lock.yaml`; runtime versions were recorded by the runner.

| Component                             | Evidence version |
| ------------------------------------- | ---------------: |
| Node                                  |          v26.4.0 |
| Prisma                                |            7.8.0 |
| `@prisma/client`                      |            7.8.0 |
| `@prisma/adapter-pg`                  |            7.8.0 |
| Drizzle ORM                           |           0.45.2 |
| Drizzle Kit                           |          0.31.10 |
| `pg`                                  |           8.22.0 |
| PostgreSQL                            |            17.10 |
| NestJS experimental provider packages |          10.4.22 |
| pnpm                                  |           9.15.9 |

## Runtime-specific primary evidence

- [Node v26.4.0 command transcript](./node-v26.4.0-commands.jsonl)
- [Node v26.4.0 environment](./node-v26.4.0-environment.json)
- [Node v26.4.0 test summary](./node-v26.4.0-test-summary.json)
- [Node v26.4.0 versions](./node-v26.4.0-versions.json)

These files are independently named for the runtime that actually produced them. They do not validate Node 24 LTS.

## Complete evidence inventory

### Runner output

- [Command transcript](./commands.jsonl)
- [Concurrency and deadlock results](./concurrency-results.json)
- [Drift results](./drift-results.json)
- [Environment](./environment.json)
- [Migration results](./migration-results.json)
- [Schema comparison](./schema-comparison.json)
- [Test summary and evidence classifications](./test-summary.json)
- [Timing](./timing.json)
- [Versions](./versions.json)
- [Known failures](./known-failures.md)

### SQL evidence

- [Prisma initial SQL](./sql/prisma-initial.sql)
- [Drizzle initial SQL](./sql/drizzle-initial.sql)
- [Additive migration SQL](./sql/additive.sql)
- [Destructive migration SQL](./sql/destructive.sql)
- [Recovery SQL](./sql/recovery.sql)

### Runtime-specific copies

- [Node v26.4.0 command transcript](./node-v26.4.0-commands.jsonl)
- [Node v26.4.0 environment](./node-v26.4.0-environment.json)
- [Node v26.4.0 test summary](./node-v26.4.0-test-summary.json)
- [Node v26.4.0 versions](./node-v26.4.0-versions.json)

## Assertion audit

| Audit question                                           | Classification | Evidence                                                                                                                                                         |
| -------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Are `passed=true` values based on real assertions?       | PASSED         | Each value is calculated from database state, returned values, caught SQLSTATE values, or Nest lifecycle state in `shared/experiments.ts`.                       |
| Does the runner exit non-zero on failures?               | PASSED         | Failed predicates throw; `main` rethrows after cleanup.                                                                                                          |
| Are containers, volumes, and pools cleaned in `finally`? | PASSED         | Both ORM pools disconnect and `docker compose down -v` runs in `finally`; no PoC container or volume remained after the recorded run.                            |
| Same model and constraints?                              | PARTIAL        | Same eight-table live column signature and same exercised domain invariants; generated constraint representation and migration histories are not byte-identical. |
| Same isolation level?                                    | PASSED         | Both default to read committed and explicitly use serializable for the concurrent credit probe.                                                                  |
| Is retry bound 20 production policy?                     | PARTIAL        | It is an experimental correctness-probe bound only.                                                                                                              |
| Is Maker/Checker exactly-once proven end-to-end?         | PARTIAL        | The observed result depends on row-locking transactions plus database uniqueness/FK constraints; production auth and permissions are not tested.                 |
| Is ledger append-only enforced?                          | PASSED         | PostgreSQL `BEFORE UPDATE OR DELETE` trigger rejects mutations with SQLSTATE `55000`; production privilege hardening is not tested.                              |
| Do NestJS tests start, inject, and close connections?    | PARTIAL        | Real Nest testing modules start, inject, transact, roll back, close, and reach zero pool connections; production app wiring is not tested.                       |

## Withdrawn claim

`WITHDRAWN`: “Prisma on Node 22 has behavior differences.” No Node 22 execution exists in this evidence set. Only Node v26.4.0 behavior was observed.

## Formatting exception inventory

`pnpm format:check` fails only on the following 95 pre-existing baseline files. No file under `experiments/orm-comparison/` fails the scoped Prettier check.

```text
.prettierrc.json
AGENTS.md
apps/admin-web/index.html
apps/admin-web/package.json
apps/admin-web/src/main.tsx
apps/admin-web/tsconfig.build.json
apps/admin-web/tsconfig.json
apps/admin-web/vite.config.ts
apps/api/package.json
apps/api/src/__tests__/app.e2e.spec.ts
apps/api/src/__tests__/setup.ts
apps/api/src/app.module.ts
apps/api/src/app.setup.ts
apps/api/src/common/filters/all-exceptions.filter.spec.ts
apps/api/src/common/filters/all-exceptions.filter.ts
apps/api/src/common/middleware/request-id.middleware.spec.ts
apps/api/src/common/middleware/request-id.middleware.ts
apps/api/src/common/pipes/zod-validation.pipe.spec.ts
apps/api/src/common/pipes/zod-validation.pipe.ts
apps/api/src/config/config.module.ts
apps/api/src/config/config.service.spec.ts
apps/api/src/config/config.service.ts
apps/api/src/health/health.controller.spec.ts
apps/api/src/health/health.controller.ts
apps/api/src/health/health.module.ts
apps/api/src/main.ts
apps/api/tsconfig.build.json
apps/api/tsconfig.json
apps/api/vitest.config.ts
apps/member-web/index.html
apps/member-web/package.json
apps/member-web/src/main.tsx
apps/member-web/tsconfig.build.json
apps/member-web/tsconfig.json
apps/member-web/vite.config.ts
apps/merchant-web/index.html
apps/merchant-web/package.json
apps/merchant-web/src/main.tsx
apps/merchant-web/tsconfig.build.json
apps/merchant-web/tsconfig.json
apps/merchant-web/vite.config.ts
compose.yaml
docs/00-master/00_iPoint_Engineering_Starter_Pack_Index_V1.0.md
docs/00-master/BASELINE_ACKNOWLEDGMENT_V1.1.md
docs/00-master/CODEX_QUOTA_RECOVERY_PROTOCOL.md
docs/00-master/DECISION_LOG.md
docs/00-master/DOCUMENT_AUTHORITY.md
docs/00-master/OPEN_QUESTIONS.md
docs/00-master/OPENCLAW_OPERATING_RULES.md
docs/00-master/PHASE_REGISTRY.md
docs/00-master/PROJECT_MASTER_CONTROL.md
docs/03-architecture/01_iPoint_System_Architecture_V1.0.md
docs/03-architecture/02_iPoint_Complete_App_Flow_and_Screen_Flow_V1.0.md
docs/03-architecture/03_iPoint_Database_ERD_and_Ledger_Specification_V1.0.md
docs/03-architecture/04_iPoint_API_Contract_Specification_V1.0.md
docs/04-engineering/05_iPoint_Engineering_Standards_and_Git_Workflow_V1.0.md
docs/04-engineering/06_iPoint_Deployment_Security_and_Operations_V1.0.md
docs/04-engineering/CODEX_WORKFLOW_RULES.md
docs/05-roadmap/07_iPoint_MVP_Roadmap_and_Acceptance_V1.0.md
docs/06-phase-reports/P0-S1_REPOSITORY_AUDIT_REPORT.md
eslint.config.mjs
packages/business-rules/package.json
packages/business-rules/src/index.test.ts
packages/business-rules/src/index.ts
packages/business-rules/tsconfig.build.json
packages/business-rules/tsconfig.json
packages/config/package.json
packages/config/src/index.ts
packages/config/tsconfig.build.json
packages/config/tsconfig.json
packages/design-tokens/package.json
packages/design-tokens/src/base.css
packages/design-tokens/src/index.ts
packages/design-tokens/tsconfig.build.json
packages/design-tokens/tsconfig.json
packages/types/package.json
packages/types/src/index.ts
packages/types/tsconfig.build.json
packages/types/tsconfig.json
packages/ui/package.json
packages/ui/src/index.ts
packages/ui/src/product-shell.tsx
packages/ui/tsconfig.build.json
packages/ui/tsconfig.json
packages/validation/package.json
packages/validation/src/index.ts
packages/validation/tsconfig.build.json
packages/validation/tsconfig.json
playwright.config.ts
pnpm-lock.yaml
README.md
tests/e2e/member-shell.spec.ts
tsconfig.base.json
tsconfig.json
vitest.config.ts
```

## Gate interpretation

The evidence package informed Command Center decision D-006, which selected `APPROVE_DRIZZLE`; Prisma was evaluated but not selected. Node 24 LTS validation remains the maximum evidence limitation and is required before P0-S4B completion.
