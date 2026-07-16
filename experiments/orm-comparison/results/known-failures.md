# Known failures observed while making the PoC reproducible

These are development-run failures corrected before the final complete evidence run. The final runner transcript is `commands.jsonl`.

| Attempt    | Exit | Failure                                                                                                                                                 | Correction                                                                                       |
| ---------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm poc` |    1 | Node 26 on Windows returned a null child exit when spawning `pnpm.cmd` without a shell.                                                                 | Invoke pnpm's Node CLI entry directly on Windows; do not enable a general command shell.         |
| `pnpm poc` |    1 | Prisma raw query could not deserialize PostgreSQL internal `char` from `pg_constraint.contype`.                                                         | Cast `contype::text` in the catalog probe.                                                       |
| `pnpm poc` |    1 | Prisma raw query could not deserialize PostgreSQL `void` from `SELECT pg_sleep(...)`.                                                                   | Select a supported integer through `FROM pg_sleep(...)`.                                         |
| `pnpm poc` |    1 | Eight retry attempts were insufficient for the deliberately synchronized serializable conflict burst.                                                   | Keep retry bounded but raise the experimental bound to 20 with backoff; maximum observed was 10. |
| `pnpm poc` |    1 | Prisma raw numeric returned a Decimal object while the persisted JSON idempotency response returned a string, causing strict result comparison to fail. | Normalize the response balance to its exact decimal string before persistence and return.        |

No failed run touched production services. Each run used disposable databases and removed both containers and volumes in `finally`.
