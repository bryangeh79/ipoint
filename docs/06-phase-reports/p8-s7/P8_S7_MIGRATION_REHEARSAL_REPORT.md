# P8-S7 — Migration Integrity Rehearsal Report

> Phase 8 · Sub-phase **P8-S7** · Contract `P8_S0_CONTRACT_FREEZE.md` §7 (G-07)
> F-08 (migration state clean) + P8-S0 gap matrix G-07: "migration integrity (fresh + upgrade rehearsal)"
> Executor: independent coding subagent (D-060 alternate executor authorization).

---

## 1. Scope and method

Rehearsal-only evidence runs on the frozen migration set **0000–0039 (40/40)** — zero new migrations, zero checksum edits, zero drift. Host PostgreSQL 17 (docker `ipoint-postgres-1`, 127.0.0.1:55432), dedicated `ipoint_p8s7_fresh_*` / `ipoint_p8s7_upgrade_*` databases. Tooling is the frozen `pnpm db:migrate` / `pnpm db:checksum` / `pnpm db:drift` / `pnpm db:seed` (p8-ci `database` job shape). Script: `scripts/p8-s7/migration-rehearsal.ps1`.

- **Fresh rehearsal**: apply 0000–0039 to an empty database; verify 40/40 checksums, drift clean, seed succeeds.
- **Upgrade rehearsal**: stage the Phase 7 head set (0000–0036, 37 files) exactly as the runner would record it (same SQL in order + sha256 checksum rows), then let the frozen runner apply only the Phase 8 additions (0037–0039); verify forward-only application, 40/40 checksums, drift clean, seed succeeds.

## 2. Evidence (real run `20260810t172154`, `.local/p8-s7-migration/20260810t172154/`)

### Fresh rehearsal (`ipoint_p8s7_fresh_20260810t172154`)

| Step | Result (real output) |
|---|---|
| `pnpm db:checksum` (pre) | "Verified 40 immutable migration checksum(s)." |
| `pnpm db:migrate` | "Database migrations are current." |
| Applied migrations | **40** (count from `database_migrations`) |
| `pnpm db:checksum` (post) | 40/40 verified |
| `pnpm db:drift` | "No database schema drift detected." |
| `pnpm db:seed` | "Foundation and agent commission seeds are current." |

### Upgrade rehearsal (`ipoint_p8s7_upgrade_20260810t172154`)

| Step | Result (real output) |
|---|---|
| Staged Phase 7 head set | **37 files (0000–0036)** applied via psql + recorded with runner-identical sha256 checksums |
| `pnpm db:checksum` (pre-migrate) | 40/40 verified (manifest vs files — unchanged) |
| `pnpm db:migrate` | "Database migrations are current." — applied **only** 0037–0039 (forward-only) |
| Applied migrations | **40** (last applied: `0039_risk_controls.sql`) |
| `pnpm db:checksum` (post) | 40/40 verified |
| `pnpm db:drift` | "No database schema drift detected." |
| `pnpm db:seed` | "Foundation and agent commission seeds are current." |

### Integrity assertions

- **40/40 unchanged after BOTH rehearsals** — `db:checksum` exit 0 on fresh and upgrade; `git diff` over `packages/database/**` is empty (frozen set untouched by S7).
- **Forward-only** — the upgrade path applied exactly the 3 remaining files; no re-application, no checksum mismatch, no drift.

## 3. Honesty note

During development the first script attempt failed on a harness bug (timestamp casing produced a PostgreSQL case-fold mismatch between `CREATE DATABASE` and the connection URL; plus Windows PowerShell 5.1 native-stderr handling) — reported as failures at the time, fixed, and re-run to completion. The authoritative run is `20260810t172154`. No numbers fabricated.

## 4. Evidence inventory

- Script (committed): `scripts/p8-s7/migration-rehearsal.ps1`
- Raw evidence (gitignored): `.local/p8-s7-migration/20260810t172154/` (per-step logs + summary.json)
- Report: this file
