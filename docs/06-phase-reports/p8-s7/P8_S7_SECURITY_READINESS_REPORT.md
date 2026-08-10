# P8-S7 — Security Readiness Report

> Phase 8 · Sub-phase **P8-S7** · Contract `P8_S0_CONTRACT_FREEZE.md` §7 (G-07)
> Decisions: D-071 (O-4: reuse in-repo scanners + built-in `pnpm audit`; external tools gitleaks/osv-scanner NOT introduced)
> Executor: independent coding subagent (D-060 alternate executor authorization).

---

## 1. Relationship to closed SEC work (narrative table)

| Security item | Status at Phase 8 | Relationship to S7 |
|---|---|---|
| P2-S4 AHS-001 (High — OTP attempt race) | Fixed (atomic SQL increment, D-019) | Baseline; untouched |
| P2-S4 AHS-002 (Medium — registration email enumeration) | Documented, accepted (D-019) | Baseline; untouched |
| P2-S4 AHS-003 (Medium — in-memory rate limiter does not scale) | **CLOSED BY P8-S7** (F-02/D-019-C) | Redis rate limiter on the frozen `RateLimitPort` (`apps/api/src/redis/redis-rate-limiter.ts`); ceilings preserved (10/IP/300s, 5/email/300s config-sourced) |
| P2-S4 AHS-004 (Medium — resend resets attempt counter) | Documented, accepted (D-019) | Baseline; untouched |
| SEC-01 / SEC-02 / P6-R2 (admin route security, refund ledger owner) | Closed, frozen | Do-Not-Touch owners; not modified by S7 (zero-bypass scan 0 findings) |
| P7-S10 gate 19 (no secret exposure) | Closed (Phase 7 state) | **Re-run at Phase 8 state by S7 — 0 findings (§2)** |
| P7-S10 gate 20 (0C/0H review verdicts) | Closed (Phase 7 state) | Baseline; S7 adds its own dependency findings (§4) |
| P8-S5e zero-owner-bypass (445 files / 0) | Closed (Phase 8 state) | **Re-run over S7-changed scope — 0 findings (§3)** |
| P8-S6 FIX-001..004 (bounded load fixes) | Closed with round-1 evidence | Baseline; untouched by S7 |

## 2. Secret scan (P7-S10 gate-19 method, re-run at Phase 8 state)

**Command (real):** `node .local/p8-s7-check/scan-secrets.mjs` — scans every tracked file (git ls-files, **1205 files**) plus the S7 committed evidence/templates specifically.

**Result: SECRET_SCAN_RESULT: CLEAN — 0 findings.**

| Check | Result |
|---|---|
| Tracked env files | only `.env.example` (documented local-dev placeholders; `ipoint-local-only` is the compose bootstrap value, not production) |
| Private-key patterns (`BEGIN ... PRIVATE KEY`) | 0 |
| Cloud-credential patterns (AKIA, aws_secret_access_key) | 0 |
| Live-token patterns (ghp_, xox, sk-) | 0 |
| S7 files connection-string credentials | only the documented local-dev compose value allowed and found |
| `.npmrc` committed | **no** (untracked, preserved — never staged) |
| Production credentials in repo/fixtures/evidence | **none** — production credentials remain classified deployment blockers (contract §7) |

## 3. Zero-owner-bypass re-scan (S5e method over S7-changed scope)

**Command (real):** `node .local/p8-s7-check/scan-zerobypass-s7.mjs` over all 10 S7-changed production files (redis module ×6, health controller+module, auth module, app.module.ts).

**Result: 0 pattern hits** (no direct service/owner instantiation in controllers, no known frozen-owner-class `new` outside DI, no executable cross-market fallback). The full-repo S5e scanner additionally reports only the 5 documented benign hits (2 helper default-params, 1 doc string, 2 pre-existing) — unchanged S5e baseline.

## 4. Dependency scan (`pnpm audit`, O-4: built-in tool)

**Commands (real, raw output preserved):**
- `pnpm audit --prod` → **0 critical | 10 high | 15 moderate | 2 low** (production tree)
- `pnpm audit` (full workspace) → **2 critical | 24 high | 21 moderate | 2 low** (includes dev tooling)

**Classification (prod tree highs):**

| Package | Count | Exposure note |
|---|---|---|
| multer | 4 high | DoS advisories; pulled by `@nestjs/platform-express` (multipart parsing). API request bodies are JSON (no multipart upload surface) — reachability limited; still recorded. |
| lodash | 1 high | `_.template` code-injection advisory; transitive (no direct `_.template` use with attacker input found in api src scan). |
| js-yaml | 2 high | parse DoS (merge-key/omap chains); transitive. |
| fast-uri | 2 high | host-confusion via backslash in URI parsing; transitive. |
| react-router | 1 high | RSC-mode CSRF advisory; in the web-app prod trees. |

**S7 contribution: ZERO.** The only Phase 8 lockfile change is `ioredis` (authorized by F-02/O-2); ioredis appears in **no** advisory (verified in the raw audit output). All other versions are identical to the frozen Phase 8 base, so this posture is pre-existing.

**Disposition (discrepancy log entry SEC-01, severity-classified):** the production tree carries 10 HIGH advisories that predate S7. Per the frozen-lockfile discipline ("no dependency upgrade outside a written decision"), S7 does **not** upgrade them; the disposition is **documented + escalated**: a written dependency-upgrade decision (OpenClaw/Command Center/Bryan) is required before the Phase 8 final gate or at production launch. The S7 Redis addition did not increase the risk surface.

## 5. Environment / runtime validation (S7-relevant surface)

**Startup validation** (`packages/config/src/index.ts`, `parseServerEnvironment`): `DATABASE_URL` (required), `REDIS_URL` (required URL), `AUTH_OTP_PEPPER` (min 32 chars), plus the frozen `AUTH_*` numeric/semantic bounds and `NODE_ENV`/`PORT`/`LOG_LEVEL` enums. `REDEMPTION_VOUCHER_ENCRYPTION_KEY` is validated at use time (required + 64 hex chars, `redemption-fulfilment.service.ts:94-100`) — pre-existing lazy-validation design, documented (Low).

**`.env.example` contract verification:** scanned all `process.env['...']` reads in api src vs `.env.example` — **6 env names read by production code were not documented** (`AUTH_REFRESH_RATE_LIMIT_COUNT`, `AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS`, `DAILY_JOB_INTERVAL_MS`, `DAILY_JOB_WORKER_COUNT`, `REDEMPTION_SHIPPING_FEE_DEFAULT`, `REDEMPTION_VOUCHER_ENCRYPTION_KEY`) → **bounded documentation fix applied** (placeholders only, no values, no secrets) — FIX-S7-002. No env name is invented by S7 code (the Redis module reads only the existing `REDIS_URL` via `ConfigService.redisUrl`).

**Node parity:** CI ubuntu Node 24 vs host Node 26.4.0 parity note applies unchanged (P4-S7 residual risk 2); the Redis module and ioredis 6 require Node ≥ 20 — satisfied by both.

## 6. Permission / RBAC surface

No new permission codes, no new API routes, no export surfaces (S7 adds no controller). Health extension modifies the payload of the existing PUBLIC health route only. RBAC catalog untouched (S5e 49/49 baseline cited).

## 7. Discrepancy log (security)

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| SEC-01 | High (pre-existing) | Production dependency tree: 10 HIGH advisories (multer/lodash/js-yaml/fast-uri/react-router) — frozen lockfile, not S7-introduced (ioredis contributes 0) | Documented + escalated — written dependency-upgrade decision required (frozen-lockfile discipline) |
| SEC-02 | Low (pre-existing) | `REDEMPTION_VOUCHER_ENCRYPTION_KEY` validated at use time, not startup | Documented (lazy-validation design) |
| FIX-S7-002 | Low | `.env.example` missing 6 documented env names | FIXED (bounded documentation fix) |
| — | — | AHS-003 | CLOSED by S7 Redis rate limiter (§1) |

Approval bar status: **0 Critical / 0 High introduced by S7**; the 10 HIGH dependency advisories are pre-existing and escalated per the frozen-lockfile discipline (they cannot be fixed by S7 without a written upgrade decision; S7's own additions are clean).
