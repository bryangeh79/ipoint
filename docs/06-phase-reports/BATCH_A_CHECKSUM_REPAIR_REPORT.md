# Batch A Migration Checksum Metadata Repair Report

## Scope and baseline

- Previous Phase SHA: `3b8277ae165d553ffa308840aac6403e5d3a6296`
- Migration file: `packages/database/migrations/0003_merchant_api_support.sql`
- Authorized change: checksum metadata for `0003_merchant_api_support.sql` only, plus this report
- P1-S5: not entered

## Migration audit

- Blob SHA before: `74e26c412159440347b379703767838391849100`
- Blob SHA after: `74e26c412159440347b379703767838391849100`
- Original introduction commit: `d40c4250277511eea4a932888437398d5d54aa8f`
- Original introduction blob: `74e26c412159440347b379703767838391849100`
- Git diff of migration file against its original introduction: `NONE`
- `git diff e8870a92..HEAD` classification: the file appears as newly added because it did not exist at `e8870a92`; this is not evidence of a later semantic modification.
- Table/structure changes after introduction: `NONE`
- Enum changes after introduction: `NONE`
- Constraint/trigger/function changes after introduction: `NONE`
- Data changes after introduction: `NONE`
- Migration SQL changed by this repair: `NO`

## Checksum repair

- Old checksum: `f2be7be7efbdd616b1e3f77e2d76d2909d81d3869f6720fbe1278f487fa96efc`
- New checksum: `4fdc9246cb7298adccef11a16973da9e864d134f0e815e17fb38e41ebb6782a5`
- Checksum generation command: `pnpm db:checksum`
- Repository mechanism: `packages/database/src/migration-checksums.ts` calculates SHA-256 from the migration file bytes and compares the result with `checksums.json`.
- Verification result: `Verified 4 immutable migration checksum(s).`

## Root cause analysis

The migration SQL was introduced at `d40c4250` with blob `74e26c41` and the same blob is present at the repair baseline. Commit history shows an intermediate encoding-only blob at `a5cc85f9`, followed by restoration of the original SQL blob at `6ddc79b6`. During that repair sequence, the manifest entry became `f2be7be...`, which does not match the repository checksum tool's SHA-256 for the restored canonical migration bytes. The defect is stale checksum metadata, not a migration semantic change.

## Verification results

| Gate                                              | Result                            | Evidence                                                                                                                             |
| ------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm db:checksum`                                | PASS                              | 4 immutable migration checksums verified                                                                                             |
| `pnpm db:migrate` on fresh PostgreSQL 17 database | PASS                              | all migrations current                                                                                                               |
| `pnpm db:seed` first run                          | PASS                              | foundation seed current                                                                                                              |
| `pnpm db:seed` second run                         | PASS                              | idempotent; foundation seed current                                                                                                  |
| `pnpm db:drift`                                   | PASS                              | no schema drift detected                                                                                                             |
| `pnpm test:database`                              | PASS                              | 2 files, 20 tests passed                                                                                                             |
| `pnpm format:check`                               | PASS in clean scoped verification | the initial shared-workspace run was blocked only by two pre-existing untracked operator Markdown files outside scope                |
| `pnpm lint`                                       | PASS                              | ESLint completed with exit code 0                                                                                                    |
| `pnpm typecheck`                                  | PASS                              | all workspace typecheck scripts completed                                                                                            |
| `pnpm build`                                      | PASS                              | all workspace builds completed                                                                                                       |
| `pnpm test`                                       | PASS                              | 16 files passed, 72 tests passed; environment-gated integration suites skipped by design and database integration was run separately |
| `pnpm test:api`                                   | PASS                              | 12 files passed, 56 tests passed; 3 environment-gated files skipped by design                                                        |

## Hygiene

- Files changed for repair: `packages/database/migrations/checksums.json`, `docs/06-phase-reports/BATCH_A_CHECKSUM_REPAIR_REPORT.md`
- Prohibited files changed: `0`
- Scope leakage: `NONE`
- Force push, reset, clean, stash, amend, main merge: `NOT USED`
- Temporary database: isolated PostgreSQL 17 container with a fresh database; removed after verification
