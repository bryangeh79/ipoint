# P8-S7 — Monitoring / Structured Logs / Redaction / Alerting Report

> Phase 8 · Sub-phase **P8-S7** · Branch `task/p8-s7-backup-restore-monitoring-security`
> Contract: `P8_S0_CONTRACT_FREEZE.md` §7 (G-07) · Gap audit row G-07 · Ops template: `docs/04-engineering/06_iPoint_Deployment_Security_and_Operations_V1.0.md` §7
> Decisions: D-071 (O-1..O-7): O-3 monitoring = committed templates + metric inventory + host-validated probes (no prom-client runtime endpoint); O-5 thresholds = CONFIGURABLE proposals; O-6 OBS-04 = observability only, remediation stays with the Command Center (D-070).
> Executor: independent coding subagent (D-060 alternate executor authorization).

---

## 1. Delivery form (O-3)

Per decision O-3, the monitoring deliverable is **template + host-validated probe form** — no runtime metrics dependency, no `/metrics` endpoint, no deployed infrastructure. This is self-consistent with the P8 no-deployment constraint:

| Artifact | Path | Form |
|---|---|---|
| Metric inventory (this report §2) | `docs/06-phase-reports/p8-s7/P8_S7_MONITORING_ALERTING_REPORT.md` | documentation |
| Alert rule template | `docs/06-phase-reports/p8-s7/alert-rules/p8-s7-alert-rules.yml` | Prometheus-compatible YAML config template |
| Dashboard template | `docs/06-phase-reports/p8-s7/dashboards/p8-s7-dashboard.json` | Grafana-compatible JSON template |
| Host probe (validated) | `scripts/p8-s7/monitoring-probe.mjs` | ops tooling, no API surface |

## 2. Metric inventory (mapping to ops doc §7)

Every indicator carries: definition, source (S6-proven measurement method §7/§10), threshold **proposal** (CONFIGURABLE per O-5 — production values are a Bryan/Command Center launch decision). Expected-outcome references (OBS-01/02/03/05) prevent false positives.

| # | Category (ops §7) | Indicator | Source (S6-proven) | Threshold proposal |
|---|---|---|---|---|
| M-1 | Auth failures/abuse | auth-surface 4xx (401/403/429) share | HTTP route metrics (template) | > 50% of auth requests for 10m → High |
| M-2 | Auth failures/abuse | sustained 429 burst | HTTP status=429 rate | > 5 req/s for 5m → Medium (frozen ceilings 10/IP/300s, 5/email/300s are the expected steady state) |
| M-3 | API error rate | 5xx share | HTTP status=5xx rate | > 5% for 10m → High |
| M-4 | API latency | p95 latency | histogram quantile | > 2s for 15m → Medium (indicative; production SLA is a launch decision) |
| M-5 | DB health | idle-in-transaction sessions (age) | `pg_stat_activity` snapshot (S6 §7) | any session > 300s (proposal; env-overridable in probe) → **High — OBS-04 class** |
| M-6 | DB health | reconciliation run_execute stall (RUNNING age) | `reconciliation_runs` query (probe) | RUNNING run > 300s → **High — OBS-04 class** |
| M-7 | DB health | connection pool saturation | `pg_stat_activity` count vs `max_connections` | ≥ 80% for 10m → High (OBS-04 pool-exhaustion signature) |
| M-8 | DB health | deadlock counter delta | `pg_stat_database` delta (S6 §7) | any increase in 15m → Medium (S6 baseline 0) |
| M-9 | Queue health | outbox PENDING backlog | `transaction_commission_dispatch` count (S6 outbox drain method) | > 100 PENDING for 15m → Medium (S6 baseline drains 60→0 in ~3s) |
| M-10 | Business | open reconciliation exceptions | `reconciliation_exceptions` | > 0 for 30m → High |
| M-11 | Business | MCP debit/adjustment 5xx | HTTP route metrics (admin mcp surface) | any for 15m → High |
| M-12 | Business | reward settlement stall | daily-job RUNNING age (ops §9 timezone-aware) | > 1h → Medium |
| M-13 | Business | admin privileged actions | audit log volume per action (existing AuditService) | change-rate anomaly → Medium (detection, no auto-action) |

**Expected-outcome catalogue (no-false-positive design):**

| OBS | Expected outcome | How the alert set stays quiet |
|---|---|---|
| OBS-01 (Medium) | quote ms-granular idempotency key → 409 for the loser of concurrent distinct requests (safe, bounded) | M-1 matcher counts 401/403/429 only; business 409s excluded from all alert rules |
| OBS-02 (Low) | reconciliation lock-timeout waiters surface as bounded 500 (55P03) | M-3 (5xx share) counts them, but M-6 targets RUNNING-state age, not 55P03 errors; OBS-02 is documented as expected in the reconciliation runbook |
| OBS-03 (Low) | outbox logs "Dispatch failed: not CONFIRMED" for reversed transactions (expected business rejection) | M-9 watches backlog count/age, never the log line |
| OBS-05 (Low) | deprecated recharge route 403s by design | M-1 route matcher covers `/api/v1/auth/.*` only; deprecated recharge excluded |

## 3. OBS-04 observability acceptance (O-6) — demonstrated on host

**Requirement:** the monitoring deliverable must make the known HIGH limitation (idle-in-transaction / pool-saturation stall on the reconciliation path) observable, and the indicator set must fire on a reproduced stall.

**Host demonstration (real commands, real output):**

1. Reproduced the OBS-04 class on a dedicated `ipoint_p8s7_obs04` database (full frozen migration set applied): 10 pooled connections held **idle in transaction**, each on its own `UPDATE reconciliation_runs` statement (the exact S6 stall signature), plus a stale `RUNNING` reconciliation run.
2. Ran the checked-in probe (`scripts/p8-s7/monitoring-probe.mjs`) against the stalled database — **PROBE_RESULT: ALERT** with both OBS-04 indicators firing:
   - `idle_in_transaction`: 10 sessions, age 100s (>60s proposal threshold), **10/10 on the reconciliation path** (`reconcilePathSessions: 10`) → fired
   - `reconciliation_run_stall`: stale RUNNING run age 700s (>120s proposal) → fired
3. After terminating the held sessions and cancelling the stale runs, the same probe reports **PROBE_RESULT: OK** (all indicators not fired) — the healthy baseline.

Raw evidence (host, gitignored): `.local/p8-s7-monitoring/stall-probe.json` (ALERT state) and `.local/p8-s7-monitoring/baseline-probe.json` (OK state). Thresholds are env-overridable in the probe (`P8S7_THRESHOLD_*`) — CONFIGURABLE per O-5.

**Dependency statement:** S7 delivers *observability of* OBS-04 only. Remediation (pool acquire timeout / tx-scoped connection discipline / driver tracing / FOR UPDATE OF narrowing) is the Command Center decision named in D-070 (Option A P8-S2-domain bounded fix / Option B documented-risk precedent). Per D-058, 0 unresolved HIGH is required before the Phase 8 final gate; this report records the dependency explicitly.

## 4. Structured logs + redaction verification

### 4.1 Baseline surface (Phase 8 state)

- `nestjs-pino` structured logging (`LoggerModule.forRootAsync` in `apps/api/src/app.module.ts`) with pino redact paths: `req.headers.authorization`, `req.headers.cookie`, `req.headers.idempotency-key`, `req.body.memberQrToken`, `req.body.password`, `req.body.refreshToken`, `res.headers.set-cookie` (censor `[REDACTED]`).
- `apps/api/src/common/logging/log-redaction.ts`: `safeErrorMetadata` (SAFE_DATABASE_CODES whitelist — error names + safe DB codes only) and `safeRequestRoute`.
- `AllExceptionsFilter` sanitizes internal error detail before responses/logs.

### 4.2 Static scan (real command)

`node .local/p8-s7-check/scan-log-redaction.mjs` — 467 api source files scanned; **0 log statements whose arguments carry sensitive keywords** (password/secret/pepper/token/otp/kyc/authorization/encryption-key classes).

### 4.3 Runtime spot check (real command)

Booted the real API (`LOG_LEVEL=info`) against host PostgreSQL + Redis and exercised auth paths with known sensitive values (`Sup3rSecret-P8S7-Value-987654321!` password, secret marker, the OTP pepper value). Assertions over the captured pino output:

| Assertion | Result |
|---|---|
| secret password in logs | **false** |
| secret marker in logs | **false** |
| OTP pepper in logs | **false** |
| bearer token prefix in logs | **false** |
| `requestId` field present (ops §7) | **true** |
| `service` field present (ops §7) | **true** (bounded fix, §4.4) |
| `env` field present (ops §7) | **true** (bounded fix, §4.4) |

Raw evidence: `.local/p8-s7-monitoring/log-redaction-runtime.txt` (LEAK_FINDINGS: NONE).

### 4.4 Bounded fix record — FIX-S7-001 (Low)

**Gap (verified):** pino `customProps` added only `requestId`; ops doc §7 requires logs to include service/module and environment (and market context where appropriate). Verified absent in runtime output.
**Fix (bounded, §11 repair policy):** `apps/api/src/app.module.ts` `customProps` now adds `service: 'ipoint-api'`, `env: NODE_ENV`, and `marketId` when the `x-market-id` header is present. No behavior change outside log metadata; zero-bypass scan over the changed scope remains 0 findings; no test asserted the previous shape (verified).
**Severity:** Low (documentation/observability compliance; no security impact).

## 5. Alert rules (deliverable)

Committed template: `docs/06-phase-reports/p8-s7/alert-rules/p8-s7-alert-rules.yml` — 13 rules across 5 groups (auth abuse, API health, database, workers, business), each with `expr` proposal, severity (Critical/High/Medium/Low per the P8 severity guide — no Critical rules proposed: nothing in the template fires on financial invariants by itself; those remain assertions in the test matrix), and runbook reference. Expected-outcome catalogue referenced in rule annotations (OBS-01..05) so rules do not false-positive.

## 6. Dashboard template (deliverable)

Committed template: `docs/06-phase-reports/p8-s7/dashboards/p8-s7-dashboard.json` — Grafana-compatible JSON with 6 panels mapping the inventory: auth abuse, API error/latency, **OBS-04 class (idle-in-transaction + run stall)**, DB pool/deadlocks, outbox backlog, reconciliation/MCP. Template only — applied at deployment time by a production monitoring stack.

## 7. Deployment note

All monitoring/alerting artifacts are **template + host-validated probe form** (O-3). Production monitoring deployment (exporter wiring, Alertmanager, retention, on-call routing) is a deployment-time activity — recorded as a deployment blocker in the delivery report, not performed by S7.

## 8. Discrepancy log (severity-classified)

| ID | Severity | Description | Disposition |
|---|---|---|---|
| FIX-S7-001 | Low | pino log fields missing `service`/`env`/market (ops §7) | FIXED (bounded, §4.4) |
| — | — | OBS-04 remediation | NOT in S7 scope — observability delivered (this report §3); remediation = Command Center decision (D-070); dependency recorded in delivery report |
| — | Low | Latency threshold (2s p95) is indicative, not an SLA | documented (O-5: production values are a launch decision) |
