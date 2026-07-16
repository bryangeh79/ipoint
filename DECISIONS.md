# iPoint Engineering Decisions

## ADR-001: Phase 0 workspace baseline

- Date: 2026-07-15
- Status: Accepted
- Decision: Use a pnpm TypeScript workspace with independently buildable applications and shared packages.
- Reason: This is the smallest baseline that preserves explicit application boundaries without adding a task-runner dependency.

## ADR-002: Application runtimes

- Date: 2026-07-15
- Status: Accepted
- Decision: Use Vite and React for the member, merchant, and admin application shells; use Fastify for the API.
- Reason: These runtimes provide a small, typed foundation and do not impose unapproved product or visual decisions.

## ADR-003: Locked design assets

- Date: 2026-07-15
- Status: Accepted
- Decision: Phase 0 application shells must remain visually neutral until iPoint Product Design System V1.0 assets and approved layouts are committed to the repository.
- Reason: Inventing colors, typography, components, or layouts would violate the locked design constraint. The shared packages expose integration points only.

## ADR-004: Phase 0 data services

- Date: 2026-07-15
- Status: Accepted
- Decision: Use PostgreSQL as the system of record, Redis for ephemeral coordination, and Prisma for schema management. Local services run through Docker Compose.
- Reason: This matches the approved Phase 0 task while keeping persistence ownership explicit. No financial domain schema is introduced in the foundation commit.

## ADR-005: Configurable local service ports

- Date: 2026-07-15
- Status: Accepted
- Decision: Keep PostgreSQL and Redis container ports stable while allowing host ports to be overridden with `POSTGRES_PORT` and `REDIS_PORT`.
- Reason: The canonical development machine hosts other projects. Parameterized host ports prevent iPoint from requiring unsafe interruption of unrelated services.
