# iPoint Project Status

Last updated: 2026-07-15

## Current phase

Phase 0 — Engineering foundation and automation baseline

## Canonical environment

- Development machine project root: `C:\AI_WORKSPACE\ipoint`
- GitHub repository: `https://github.com/bryangeh79/ipoint`
- Integration branch: `develop`
- Active work branch: `chore/phase-0-automation-baseline`
- Primary implementation agent: Codex CLI
- Independent reviewer: Gemini CLI / Pro

## Completed

- GitHub repository initialized
- `develop` integration branch created
- autonomous engineering rules added
- Gemini review protocol added
- canonical local workspace and GitHub remote recorded
- Draft PR #1 opened for Phase 0 automation baseline

## In progress

- local repository synchronization at `C:\AI_WORKSPACE\ipoint`
- Phase 0 repository scaffold
- task queue initialization
- CI, monorepo, apps, packages, database, and test baseline

## Next

1. clone or synchronize the repository at the canonical workspace;
2. check out `chore/phase-0-automation-baseline`;
3. initialize pnpm monorepo;
4. create member, merchant, admin, and API application skeletons;
5. create shared UI, config, types, validation, and business-rule packages;
6. configure PostgreSQL, Redis, Prisma, Docker Compose;
7. configure lint, typecheck, unit tests, E2E baseline, build, and GitHub Actions;
8. run independent Gemini review and resolve actionable findings.

## Blockers

- The GitHub repository is ready.
- Local Codex CLI execution requires the development machine to open `C:\AI_WORKSPACE\ipoint`; ChatGPT's GitHub connector cannot directly execute commands on the Windows machine.

## Delivery target

Member registration → merchant onboarding → MCP top-up → scan transaction → MCP debit → daily iPoint distribution → admin audit.

## Overall progress

Phase 0: 15%
MVP: 1%
