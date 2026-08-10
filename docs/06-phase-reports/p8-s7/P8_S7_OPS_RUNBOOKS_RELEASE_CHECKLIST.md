# P8-S7 — Ops Runbooks & Release Checklist

> Phase 8 · Sub-phase **P8-S7** · Contract `P8_S0_CONTRACT_FREEZE.md` §7 (G-07)
> Authoritative template: `docs/04-engineering/06_iPoint_Deployment_Security_and_Operations_V1.0.md` §8 (backup/recovery), §10 (incident management), §12 (production-readiness evidence) + §3 (deployment model / forward recovery)
> Executor: independent coding subagent (D-060 alternate executor authorization).

---

## 1. Recovery procedures

### 1.1 Database restore (host-rehearsed, ops doc §8)

The restore procedure below is the exact procedure rehearsed in `P8_S7_BACKUP_RESTORE_DR_REPORT.md` (host, dedicated `ipoint_p8s7_*` DBs, VERIFY_RESULT: PASS).

1. **Identify the backup**: latest custom-format dump per the retention convention `ipoint-<env>-<yyyyMMddTHHmmss>.dump`.
2. **Create the target database** (never restore over a live database):
   `CREATE DATABASE <target>` (drop a stale target first with `WITH (FORCE)` after confirming no in-flight work).
3. **Restore**: `pg_restore -d <target> <dump>` (custom format).
4. **Verify (mandatory — a backup is not valid until restoration is tested, ops §8)**:
   - `pnpm db:checksum` → 40/40;
   - `pnpm db:drift` → clean;
   - row-count parity on representative tables (ledger, transactions, members, migrations) vs the source (probe: `scripts/p8-s7/verify-restored-db.mjs` with `P8S7_SOURCE_DATABASE_URL` / `P8S7_RESTORE_DATABASE_URL`);
   - write-path round trip (insert + rollback) on the restored DB;
   - API smoke: `/health/ready` reports `database: ok`.
5. **Ledger reconciliation after recovery (ops §8)**: run a P8-S2 reconciliation pass (admin reconciliation run) across all domains before re-opening writes — differences after a restore must be investigated, never auto-corrected.
6. **Expected outcome**: target DB fully usable; drift clean; checksums 40/40; reconciliation clean.

### 1.2 Application rollback / forward recovery (ops §3)

- **Rollback-to-commit**: deploy the previous known-good commit SHA (all apps + workers from the same SHA — workers must never run incompatible code against an unmigrated DB, ops §3).
- **Forward recovery**: migrations are forward-only and idempotently tracked in `database_migrations` (checksum-verified). To move forward: run `pnpm db:migrate` (applies only unapplied files, validates checksums) before deploying app code that requires the new schema.
- **Rollback of a migration** is NOT supported (forward-only); the recovery path is forward application or restore-from-backup (1.1).

### 1.3 DR narrative

- **What is restored**: full PostgreSQL schema + data (custom-format dump). Redis is a cache/coordination surface only — rebuilt from PG (rate-limiter buckets, locks, queues are ephemeral by design); PG remains the source of truth (F-02).
- **Order**: infrastructure (PG) → database restore + verify → app/workers at the matching commit → Redis start → reconciliation run → traffic.
- **RTO/RPO targets (CONFIGURABLE proposals, O-5 — Bryan/Command Center sign-off is the production-launch decision)**:
  - RPO: ≤ 15 minutes (requires PITR: `pg_basebackup` + WAL archiving — **deployment-blocker note**: not configured on host, not rehearsed; documented as production capability in `P8_S7_BACKUP_RESTORE_DR_REPORT.md` §6).
  - RTO: ≤ 60 minutes for full restore (host rehearsal wall time was well under this at test scale; production sizing is a deployment concern).
- **Deployment blockers recorded (contract §7)**: production backup automation, WAL archiving/PITR, object-storage retention, restore tests on a schedule (ops §8) — all deployment-time, none delivered by S7.

## 2. Operator runbooks (routine operations)

| Operation | Command / procedure | Expected outcome |
|---|---|---|
| Apply migrations | `pnpm db:migrate` (DATABASE_URL set) | "Database migrations are current." — checksum-verified forward application |
| Verify checksums | `pnpm db:checksum` | "Verified 40 immutable migration checksum(s)." |
| Check schema drift | `pnpm db:drift` | "No database schema drift detected." |
| Seed | `pnpm db:seed` | "Foundation and agent commission seeds are current." |
| Backup | `scripts/p8-s7/backup-restore.ps1` (host) → evidence in `.local/p8-s7-backup/<ts>/` | dump + restore + verify PASS |
| Migration rehearsal | `scripts/p8-s7/migration-rehearsal.ps1` (host) | fresh 40/40 + upgrade 37→40, drift clean |
| Redis health | `redis-cli ping` → `PONG`; API `/health/ready` shows `redis: ok` | healthy |
| Worker health | probe M-9 (outbox backlog < threshold, drains in seconds); daily-job audit rows | no backlog |
| Metric queries | `scripts/p8-s7/monitoring-probe.mjs` (DATABASE_URL set) → PROBE_RESULT: OK | all indicators not fired |
| Log locations | pino structured stdout (json); requestId per request | grep by `requestId` |
| Health probes | `GET /health/live` (liveness) · `GET /health/ready` (readiness, per-check status) | see `P8_S7_MONITORING_ALERTING_REPORT.md` |

## 3. Incident runbooks (ops doc §10 — severity levels + the seven named classes)

Severity guide (P8): Critical = financial invariant / security bypass; High = broken contract a real user journey hits; Medium = drift/observation; Low = cosmetic/doc.

### 3.1 Security incident (Critical/High)
- **Detection**: alert M-1 (auth failure burst), audit-log review of privileged actions, rate-limit 429 storm.
- **Containment**: revoke affected sessions (password reset revokes families), suspend affected accounts/merchants, rotate secrets (pepper/encryption keys are deployment-time), block offending IPs at the limiter/edge.
- **Correction**: fix the root cause (bounded repair round 1 → review → round 2 → Command Center if unresolved, §11).
- **Reconciliation**: audit every affected financial record; ledger reconciliation run.
- **Record**: timeline, impact, containment, correction, reconciliation, root cause, preventive action.

### 3.2 Incorrect ledger balance (Critical)
- **Detection**: reconciliation difference alert M-10, member/merchant reports, ledger-invariant tests in CI.
- **Containment**: freeze the affected domain's write path (admin controls), notify finance owner.
- **Correction**: P8-S2 reconciliation investigation; corrective entries via the frozen adjustment owners (Maker/Checker); NEVER direct SQL writes.
- **Reconciliation**: full reconciliation run; verify immutability (no history rewrite).

### 3.3 Duplicate transaction (High)
- **Detection**: idempotency-key violations, 409 storms (OBS-01 expected class is excluded — a real duplicate shows as ledger duplication), reconciliation mismatches.
- **Containment**: hold the affected merchant/member surface; check outbox worker state.
- **Correction**: refund/reversal via frozen refund owner; the outbox exactly-once path prevents double dispatch.
- **Reconciliation**: ledger + outbox drain verification.

### 3.4 Settlement failure (High)
- **Detection**: alert M-12 (reward settlement stall), commission outbox backlog M-9, daily-job failure audit rows.
- **Containment**: pause dependent jobs; preserve PENDING rows.
- **Correction**: rerun the settlement job (idempotent, unique market/date identity per ops §9); retry bounded by `max_attempts`.
- **Reconciliation**: settlement batch ledger check.

### 3.5 Payment/top-up mismatch (High)
- **Detection**: MCP debit failure alert M-11, transaction confirm 5xx, reconciliation differences.
- **Containment**: hold the affected transaction surface.
- **Correction**: investigate the payment provider/webhook log; correct via frozen MCP adjustment owner (Maker/Checker).
- **Reconciliation**: transaction-to-ledger reconciliation run.

### 3.6 Data exposure (Critical)
- **Detection**: secret-scan findings (CI gate 19 pattern), log-redaction runtime checks (S7 §4), unusual export/download audit rows.
- **Containment**: rotate exposed credentials (deployment-time), revoke access, isolate the affected data.
- **Correction**: remove exposure; harden the path (bounded fix rounds).
- **Reconciliation**: audit log review; notify per policy.
- **Record**: mandatory incident record with timeline.

### 3.7 Production outage (Critical/High)
- **Detection**: health probes degraded (`/health/ready` non-ok: database/redis unavailable), API error rate M-3, OBS-04 indicators M-5/M-6/M-7.
- **Containment**: switch to standby/replica if provisioned; if pool-stalled (OBS-04 class), terminate the idle-in-transaction sessions (client-side lifecycle — S6 proved PG aborts them cleanly) and restart workers.
- **Correction**: restore per §1; escalate OBS-04 class to the Command Center remediation decision (D-070) if it recurs.
- **Reconciliation**: full ledger reconciliation after recovery (ops §8).

## 4. Release checklist (executable by P8-S9)

Maps ops §12 + the P8-S9 final-gate matrix. Each line: check → evidence.

| # | Gate | Evidence to provide |
|---|---|---|
| 1 | Migration checksums | `pnpm db:checksum` → 40/40 |
| 2 | Migration drift | `pnpm db:drift` → clean |
| 3 | Fresh migration rehearsal | `P8_S7_MIGRATION_REHEARSAL_REPORT.md` (host evidence `.local/p8-s7-migration/`) |
| 4 | Upgrade migration rehearsal | same report (staged 0036 → 0039) |
| 5 | All apps typecheck + build | `pnpm -r typecheck` / `pnpm -r build` (CI quality+build jobs) |
| 6 | Lint + format | `pnpm lint` / `pnpm format:check` |
| 7 | OpenAPI validation | `pnpm openapi:validate` (285 paths, 0 duplicates) |
| 8 | Unit + integration + real-PG suites | CI unit/database/api-integration jobs green incl. P8-S7 redis suite |
| 9 | RBAC / permission catalog | `p7-s10-rbac-matrix.spec.ts` 49/49; permission catalog untouched (S5e 49/49) |
| 10 | Zero-owner-bypass scan | S7-changed scope 0 findings (`.local/p8-s7-check/scan-zerobypass-s7.mjs`) + S5e baseline |
| 11 | Secret scan clean | `P8_S7_SECURITY_READINESS_REPORT.md` — 0 findings at Phase 8 state incl. S7 files |
| 12 | Dependency scan | `pnpm audit` → 0 critical / 0 high |
| 13 | Backup restoration evidence | `P8_S7_BACKUP_RESTORE_DR_REPORT.md` (VERIFY_RESULT: PASS) |
| 14 | Load/performance evidence | `P8_S6_LOAD_PERFORMANCE_CONCURRENCY_REPORT.md` |
| 15 | Monitoring + alert readiness | `P8_S7_MONITORING_ALERTING_REPORT.md` + templates (alert-rules, dashboard, probe) |
| 16 | OBS-04 dependency | delivery report OBS-04 statement (observability delivered; remediation = Command Center D-070) |
| 17 | Runbook references | this checklist + §3 incident runbooks |
| 18 | Ledger reconciliation test | P8-S2 reconciliation suite green + post-recovery reconciliation procedure (§1.1 step 5) |
| 19 | Git state | local = remote; main unchanged; no Main PR/Merge/Push/Deploy |
| 20 | Deployment blockers | documented list (production backup/PITR/retention, monitoring deployment, alert routing, RTO/RPO sign-off) |

## 5. Deployment-blocker list (contract §7 — production credentials are blockers, not deliverables)

1. Production backup automation + object-storage retention + scheduled restore tests (ops §8) — deployment-time.
2. PITR: WAL archiving + `pg_basebackup` (documented capability; not rehearsed on host).
3. Monitoring stack deployment (exporters, Alertmanager, dashboards, retention) — S7 delivers templates only (O-3).
4. RTO/RPO + alert threshold sign-off (O-5) — Bryan/Command Center production-launch decision.
5. OBS-04 remediation decision (D-070) — required before the Phase 8 final gate (D-058: 0 unresolved HIGH).
6. Production Redis deployment (D-019-C hard prerequisite) with HA/backup policy.
