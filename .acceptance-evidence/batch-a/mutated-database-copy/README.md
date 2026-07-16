# @ipoint/database

Generic PostgreSQL foundation for identity, authentication, markets, admin RBAC,
security events, privileged audit, and entity timelines. Drizzle provides typed
queries; reviewed SQL under `migrations/` is the production migration authority.

## Commands

```powershell
$env:DATABASE_URL='postgresql://ipoint_test:ipoint_test@localhost:55440/ipoint_database_test'
pnpm --filter @ipoint/database db:checksum
pnpm --filter @ipoint/database db:migrate
pnpm --filter @ipoint/database db:seed
pnpm --filter @ipoint/database db:drift
pnpm --filter @ipoint/database test:integration
```

For a disposable rebuild, start `tests/compose.yaml`, run the commands above,
run the seed a second time, and remove the compose project with volumes.

## Migration policy

- SQL files are ordered, explicit, and immutable after application.
- `migrations/checksums.json` must change in the same review as a new migration.
- The runner verifies both the repository manifest and applied database checksum.
- Drift checks are read-only catalog comparisons.
- Applied migrations are never edited or rolled back destructively. Recovery is
  a reviewed forward-fix migration. Restore from a verified backup if a future
  destructive migration loses data; destructive migrations require approval.

Seeds contain only deterministic platform roles and permissions. They do not
create markets, commercial values, accounts, credentials, or production secrets.
