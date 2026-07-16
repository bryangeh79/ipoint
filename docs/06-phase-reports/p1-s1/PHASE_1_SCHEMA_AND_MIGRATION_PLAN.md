---
title: Phase 1 Schema and Migration Plan
phase: P1-S1
status: planning-only
implementation_authorized: false
next_migration_id: 0002
date: 2026-07-16
---

# Phase 1 Schema and Migration Plan

## 1. Migration ownership and order

The next migration is `0002_phase_1_merchant_package_mcp.sql`, owned by the future single authorized Phase 1 database worker. P1-S1 does not create it.

Within `0002`, use dependency order:

1. enums and Merchant base tables;
2. Package definitions, versions, special percentages and assignments;
3. MCP account, ledger and request/decision tables;
4. foreign keys, unique/check constraints and indexes;
5. append-only triggers for ledgers, decisions and histories.

A single migration avoids partially deployable cross-domain foreign keys at this initial extension. If implementation risk requires splitting, reserve sequential IDs centrally before work; never let parallel workers independently claim `0002`.

## 2. Strategy

- Create-table and additive-enum only; no existing production-row transformation.
- Reference existing `accounts`, `markets`, `admin_users`, `audit_logs` and `entity_timelines` with `ON DELETE RESTRICT`.
- Use UUID defaults, `timestamptz(6)`, PostgreSQL `numeric`, explicit constraints, and no cascade deletion of financial/history records.
- `group_id` remains nullable UUID reservation without a Merchant Group table/FK until O-01 is resolved.
- Add append-only database triggers modeled after Phase 0 audit/timeline protection.
- Do not add cloud storage, provider credentials, webhook endpoints or production seed values in the migration.

## 3. Forward validation

Run against a fresh PostgreSQL database and an upgraded database at `0001`:

1. verify existing checksums;
2. apply `0002` transactionally;
3. rerun migrate idempotently;
4. run expected-schema and integration constraints;
5. verify append-only triggers reject update/delete;
6. run schema drift check;
7. validate SQL rollback rehearsal in disposable data only.

## 4. Rollback and recovery

Before production application, disposable-environment rollback may drop Phase 1 objects in reverse dependency order using a separately reviewed rollback script. After an applied migration reaches a shared/production environment, migration files are immutable: recover by forward-fix migration, disable affected feature paths, and preserve ledger/history. Never edit `0002`, delete its `database_migrations` row, or force a destructive rollback over business data.

## 5. Checksum plan

- Generate SHA-256 through the existing `migration-checksums.ts --write` workflow only after SQL review.
- Add exactly the final `0002` filename/hash to `migrations/checksums.json`.
- Run `pnpm db:checksum` before and after tests.
- Any content change after application requires a new numbered migration, not checksum replacement.

## 6. Seed idempotency

Future seed additions are limited to stable permission codes and approved package identities. Use natural unique keys and `onConflictDoNothing`/upsert only for safe descriptive fields. A-F rate values belong in versioned market-scoped records and require approved effective dates; examples must not become universal hard-coded production seeds. Re-running seed must create no duplicates and must not mutate used versions.
