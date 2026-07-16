# ADR-006: Drizzle Database Foundation

- Status: Accepted
- Date: 2026-07-16
- Decision authority: D-006, ChatGPT Command Center
- Scope: P0-S4B generic platform database foundation

## Context

iPoint requires PostgreSQL as the source of truth, exact and reviewable database
behavior, UTC timestamp storage, immutable audit history, deterministic seeds,
and migration evidence that detects edits to already reviewed SQL. The P0-S4A
comparison established that correctness remains owned by PostgreSQL constraints
and application transactions. D-006 closed the ORM gate and approved Drizzle.

## Decision

Use Drizzle ORM and node-postgres for typed application access. Treat explicit,
reviewed SQL migrations as the migration authority. Every migration has a SHA-256
manifest entry and the applied checksum is persisted in PostgreSQL. Deployment
fails if either copy differs. A read-only catalog comparison detects unreviewed
tables or columns.

The initial schema contains only generic platform identity/authentication,
market, Admin RBAC, security-event, audit-log, and entity-timeline foundations.
AuditLog and EntityTimeline reject UPDATE and DELETE through PostgreSQL triggers.
Secrets are stored only as hashes, reinforced by schema naming and constraints.

## Consequences

- Database behavior remains directly reviewable and is not hidden behind ORM
  migration generation.
- The team owns SQL, transaction boundaries, drift manifests, and forward fixes.
- Adding or changing a column requires aligned Drizzle schema, SQL migration,
  expected catalog definition, checksum manifest, tests, and documentation.
- Applied migration recovery uses a new forward-fix migration. Destructive change
  or production restore requires explicit approval and a verified backup plan.
- No Member, Merchant, MCP, wallet, iPoint, or commission behavior is introduced.
