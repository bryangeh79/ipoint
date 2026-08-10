# P8-S7 — Backup / Restore / DR Report

> Phase 8 · Sub-phase **P8-S7** · Contract `P8_S0_CONTRACT_FREEZE.md` §7 (G-07)
> Decisions: D-071 O-1 (host PG real rehearsal authorized on dedicated `ipoint_p8s7_*` DBs; production backup = deployment blocker), O-5 (RTO/RPO = CONFIGURABLE proposals)
> Ops template: `docs/04-engineering/06_iPoint_Deployment_Security_and_Operations_V1.0.md` §8 (backup/recovery)
> Executor: independent coding subagent (D-060 alternate executor authorization).

---

## 1. DB integrity baseline (before-state)

| Check | Result (real output) |
|---|---|
| Migration checksums | `pnpm db:checksum` → "Verified 40 immutable migration checksum(s)." |
| Schema drift | `pnpm db:drift` → "No database schema drift detected." |
| Host | PostgreSQL 17 (docker `ipoint-postgres-1`, 127.0.0.1:55432) — the S6 compose container |
| Frozen state | `packages/database/**` untouched by S7 (git diff empty; 40/40 checksums unchanged) |

## 2. Backup procedure (documented, ops doc §8 mapping)

**Command shape (host, script `scripts/p8-s7/backup-restore.ps1`):** custom-format `pg_dump` executed inside the PG container, dump copied out to evidence:

```
docker exec ipoint-postgres-1 pg_dump -h 127.0.0.1 -U ipoint -Fc -d <sourceDb> -f /tmp/<dump>.dump
docker cp ipoint-postgres-1:/tmp/<dump>.dump <evidence-dir>/
```

- **Format**: custom (`-Fc`) — compressed, restore-selective, the recommended operational format.
- **Naming convention**: `ipoint-<env>-<yyyyMMddTHHmmss>.dump` (S7 rehearsal uses `ipoint_p8s7_source_<ts>.dump`).
- **Retention convention (proposal)**: keep daily for 30 days, weekly for 12 months, plus the last known-good before any migration window — production retention is a deployment decision.
- **Backup validity rule (ops §8)**: *a backup is not considered valid until restoration has been tested* — this report performs exactly that test.

## 3. Actual restore test — rehearsal evidence (real, host, dedicated DBs only)

Rehearsal run `20260810t172809` (`.local/p8-s7-backup/20260810t172809/`):

| Step | Command (real) | Result |
|---|---|---|
| 1. Source DB create | `CREATE DATABASE ipoint_p8s7_source_20260810t172809` | ok |
| 2. Migrate + seed source at Phase 8 state | `pnpm db:migrate` / `pnpm db:seed` (DATABASE_URL=source) | "Database migrations are current." / seeds current |
| 3. Baseline integrity | `pnpm db:checksum` / `pnpm db:drift` | 40/40 / no drift |
| 4. Backup | `pg_dump -Fc` → `ipoint_p8s7_source_20260810t172809.dump` (**623,381 bytes**) | ok |
| 5. Restore DB create | `CREATE DATABASE ipoint_p8s7_restore_20260810t172809` | ok |
| 6. Restore | `pg_restore -d ipoint_p8s7_restore_20260810t172809 <dump>` | **exit 0** |
| 7. Verify (probe `scripts/p8-s7/verify-restored-db.mjs`) | row-count parity + migrations parity + write round trip + read query | **VERIFY_RESULT: PASS** |
| 8. Integrity on restored DB | `pnpm db:drift` / `pnpm db:checksum` | no drift / 40/40 |
| 9. Functional smoke on restored DB | boot API against restore DB; `GET /health/ready` | `{"status":"ok","checks":{"config":"ok","database":"ok","redis":"ok"}}` |

**Verification detail (from `verify-restored-db.log`, real numbers):**

| Table | source | restored | match |
|---|---|---|---|
| members / transactions / mcp_ledger_entries / member_wallet_entries / commission_ledger / redemption_orders / audit_logs | 0 | 0 | ✅ (seed state — no member data at Phase 8 seed) |
| database_migrations | 40 | 40 | ✅ (identical filename+checksum rows) |
| roles | 6 | 6 | ✅ |
| permissions | 76 | 76 | ✅ |
| Write-path round trip (INSERT audit_logs → ROLLBACK) | rowsAffected 1 | countBefore 0 = countAfter 0 | ✅ rolled back cleanly |
| Read query on restored DB | `SELECT count(*), min(occurred_at) FROM audit_logs` | ok | ✅ |

**Honesty note (S6 contract):** every number above is a real command's output; the rehearsal ran twice more during development (transient harness fixes — PowerShell 5.1 native-stderr handling and timestamp casing), and the final authoritative run is `20260810t172809`. No restore was fabricated; earlier harness failures were reported as failures during the run.

## 4. Recovery procedures

See `P8_S7_OPS_RUNBOOKS_RELEASE_CHECKLIST.md` §1 — restore procedure (identical to the rehearsed one), app rollback/forward recovery, post-restore **ledger reconciliation** (ops §8: run a P8-S2 reconciliation pass before re-opening writes; differences are investigated, never auto-corrected).

## 5. DR evidence / narrative

- **What is restored**: full PostgreSQL schema + data (custom-format dump). Redis holds only ephemeral coordination state (rate-limiter buckets, locks, queues) rebuilt from PG — PostgreSQL remains the source of truth (F-02).
- **Order**: PG infra → restore + verify (this report §3 steps) → app/workers at the matching commit → Redis → reconciliation run → traffic.
- **RTO/RPO (CONFIGURABLE proposals, O-5 — production values require Bryan/Command Center sign-off as a launch decision)**:
  - RPO ≤ 15 min — requires **PITR** (`pg_basebackup` + WAL archiving): documented capability, **deployment blocker, NOT rehearsed on host** (wal_archive setup is a deployment concern — not faked).
  - RTO ≤ 60 min — host rehearsal wall time at test scale was ~1 min; production sizing is a deployment concern.

## 6. Deployment blockers (contract §7)

1. Production backup automation (scheduling, retention, object-storage versioning) — deployment-time.
2. PITR/WAL archiving (`pg_basebackup` + archive_command + restore command) — deployment-time capability, documented not rehearsed.
3. Restore tests on a defined schedule (ops §8) — deployment-time SLA.
4. Production credentials — classified deployment blockers, never deliverables; none present in repo/evidence.

## 7. Evidence inventory

- Scripts (committed): `scripts/p8-s7/backup-restore.ps1`, `scripts/p8-s7/verify-restored-db.mjs`
- Raw evidence (gitignored): `.local/p8-s7-backup/20260810t172809/` (dump, verify.json, drift/checksum logs, health-smoke.log, summary.json)
- Report: this file
