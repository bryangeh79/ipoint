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

### SEC-01 remediation record (D-075 — executed 2026-08-10)

**Authorization:** D-075 (Bryan directive 2026-08-10 22:15 MYT): upgrade multer to a patched version (preferred via `pnpm` overrides to avoid a NestJS major bump; verify no API breakage) **+ Bryan formal written risk acceptance of the remaining HIGH advisories with the reachability analysis recorded here**. Executed on branch `fix/p8-sec01-deps` (D-060 alternate-executor authorization). Zero production-code changes; lockfile change limited to the multer subtree + the overrides record.

**1. Multer upgrade record.**

| Field | Value |
|---|---|
| Advisories (prod tree) | HIGH: GHSA-xf7r-hgr6-v32p (patched ≥2.1.0), GHSA-v52c-386h-88mc (patched ≥2.1.0), GHSA-5528-5vmv-3xc2 (patched ≥2.1.1), GHSA-72gw-mp4g-v24j (patched ≥2.2.0 — binding); moderate GHSA-3p4h-7m6x-2hcm (patched ≥2.2.0) also cleared |
| Before | multer `2.0.2` (transitive: `@nestjs/platform-express@10.4.22` → multer, which declares the **exact** `"multer": "2.0.2"`) |
| After | multer `2.2.0` (latest stable dist-tag; fixes the full advisory set) |
| Mechanism | root `package.json` → `pnpm.overrides: { "multer": "2.2.0" }` (exact pin). An override is required because platform-express pins the exact version; it resolves the advisories **without** a NestJS major bump (D-075 preference). `pnpm install` regenerated the lockfile; `pnpm install --frozen-lockfile` re-verified the committed lockfile (CI parity) |
| Blast radius | multer has **zero direct or indirect code usage** in the repo (`git grep` over `apps/ packages/`: 0 hits for `FileInterceptor` / `MulterModule` / `multer` imports — no multipart upload surface; API request bodies are JSON). Dependency-level diff: `multer@2.0.2`→`2.2.0` drops `mkdirp`/`minimist` (pruned entirely) and `object-assign`/`xtend` (snapshot references removed; packages retained for other dependents). `pnpm-lock.yaml` diff = 27 lines, multer subtree + `overrides:` record only |
| No API breakage | All typechecks (api/database/all packages), full workspace build, lint, prettier (CI scope), `openapi:validate` (CI env), CI-equivalent unit suite (87 files / 1433 tests), and the guarded Redis integration suite (14/14) pass on the fixed state (details §CI equivalence below) |

**2. Audit before/after (commands real: `pnpm audit --prod` / `pnpm audit`).**

| Scope | Before | After | Delta |
|---|---|---|---|
| `--prod` | 0 critical / 10 high / 15 moderate / 2 low | 0 critical / **6 high** / 14 moderate / 2 low | multer 4 HIGH + 1 moderate cleared; **0 new advisories** |
| full workspace | 2 critical / 24 high / 21 moderate / 2 low | 2 critical / **20 high** / 20 moderate / 2 low | multer 4 HIGH + 1 moderate cleared; dev-tooling HIGH (vite×3, brace-expansion×6, nanoid×1) unchanged; **0 new advisories** |

**3. Bryan written risk acceptance (D-075) — remaining 6 HIGH advisories.** The audit after-state is exactly the enumerated acceptance set from D-075. (Note recorded transparently: D-075's summary text says "7" but its own enumeration `lodash×1 + js-yaml×2 + fast-uri×2 + react-router×1` sums to 6; the audit confirms **6** remaining = the enumerated set.) Each item is accepted by Bryan with the reachability conclusion; **re-review at the final production-launch strategy gate (P8-S9 G-30 context)**.

| Advisory (GHSA) | Package / version | Path | Reachability conclusion (financial paths: zero exposure) |
|---|---|---|---|
| GHSA-r5fr-rjxr-66jc (HIGH) | lodash 4.17.21 | transitive via `@nestjs/swagger@7.4.2` | `_.template` code-injection; no direct `_.template` use with attacker input in api src (S7 scan); **no upstream fix exists** (lodash 4.17.21 is the final published line; the advisory's "≥4.18.0" has no published release) — fix would require an @nestjs/swagger replacement, out of scope per D-075 |
| GHSA-52cp-r559-cp3m + GHSA-5p4m-2wfm-xmqj (HIGH) | js-yaml 4.1.0 | transitive via `@nestjs/swagger@7.4.2` | YAML parse DoS (merge-key/omap chains); no attacker-controlled YAML parsing in api runtime paths; fix requires a framework-level bump — out of scope per D-075 |
| GHSA-v2hh-gcrm-f6hx + GHSA-7p8r-x3mc-p8w7 (HIGH) | fast-uri 3.1.3 | transitive via Prisma CLI/dev toolchain (`drizzle-orm → @prisma/client@7.8.0 → prisma@7.8.0 → @prisma/dev@0.24.3 → @prisma/streams-local@0.1.2 → ajv@8.20.0`) | URI host-confusion via backslash; tooling-only surface (drizzle is the runtime ORM; the prisma dev CLI is not executed by production runtime paths) |
| GHSA-qwww-vcr4-c8h2 (HIGH) | react-router 7.18.1 | `react-router-dom@7.18.1 → react-router` in admin-web + member-web prod trees | RSC-mode CSRF; both web apps are Vite SPAs (no React Server Components) — RSC-specific condition not reachable; client-side routing only |

**Bryan acceptance statement:** the 6 remaining HIGH advisories are formally accepted in writing by Bryan (D-075) with the reachability analysis above (frontend/tooling/transitive paths, zero financial exposure) — recorded, not silent. Re-review scheduled at final production-launch strategy.

**4. Lockfile hygiene.** The override is the only dependency change (D-075: no other package touched). During lockfile regeneration, pnpm's optional-peer re-resolution flipped one unrelated dev-tooling edge (`@vitest/mocker` vite-context `tsx@4.20.6` vs `tsx@4.23.1`); the pre-existing edge was restored surgically so the committed `pnpm-lock.yaml` diff is strictly multer-only, and `pnpm install --frozen-lockfile` passes on the committed lockfile (CI parity).

**5. CI-equivalence evidence (host: Node 26.4.0 / pnpm 9.15.9; CI: ubuntu Node 24).** All pass: frozen-lockfile install; api/database/other-packages typecheck; `pnpm -r --if-present build`; `pnpm lint` (0 errors, 2 pre-existing warnings untouched); prettier on CI scope; `pnpm openapi:validate` with the CI workflow env; CI-equivalent unit suite (root `vitest.config.ts`, CI excludes — 87 files / 1433 tests / 52 skipped); guarded Redis integration suite (`redis.integration.spec.ts`, live PG on 127.0.0.1:55432 + live Redis on 127.0.0.1:56379, disposable `ipoint_p8s7_sec01smoke` DB, `P8S7_DESTRUCTIVE_TEST=1`) — **14/14 passed**, incl. live distributed primitives (rate-limiter ceilings, lock mutual exclusion, FIFO queue) and graceful-degradation paths.

**6. Observation (pre-existing, NOT introduced — outside SEC-01 scope):** booting the API on host Node 26.4.0 (`tsx src/main.ts`) reaches full `AppModule` + `@nestjs/platform-express` + multer load and then crashes in `@nestjs/swagger` route-parameter exploration (`parameter-metadata-accessor` — `PARAMTYPES_METADATA` undefined for a decorated handler). Reproduced **byte-identical at pre-fix HEAD (multer 2.0.2)**: same error, same stack, same load point, so the multer upgrade introduces zero behavioral difference. CI (Node 24) `openapi:validate` passes (verified locally with the CI env). Per the frozen-code red lines no production code was modified for this; it is recorded here for the Node-parity residual-risk register.

## 5. Environment / runtime validation (S7-relevant surface)

**Startup validation** (`packages/config/src/index.ts`, `parseServerEnvironment`): `DATABASE_URL` (required), `REDIS_URL` (required URL), `AUTH_OTP_PEPPER` (min 32 chars), plus the frozen `AUTH_*` numeric/semantic bounds and `NODE_ENV`/`PORT`/`LOG_LEVEL` enums. `REDEMPTION_VOUCHER_ENCRYPTION_KEY` is validated at use time (required + 64 hex chars, `redemption-fulfilment.service.ts:94-100`) — pre-existing lazy-validation design, documented (Low).

**`.env.example` contract verification:** scanned all `process.env['...']` reads in api src vs `.env.example` — **6 env names read by production code were not documented** (`AUTH_REFRESH_RATE_LIMIT_COUNT`, `AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS`, `DAILY_JOB_INTERVAL_MS`, `DAILY_JOB_WORKER_COUNT`, `REDEMPTION_SHIPPING_FEE_DEFAULT`, `REDEMPTION_VOUCHER_ENCRYPTION_KEY`) → **bounded documentation fix applied** (placeholders only, no values, no secrets) — FIX-S7-002. No env name is invented by S7 code (the Redis module reads only the existing `REDIS_URL` via `ConfigService.redisUrl`).

**Node parity:** CI ubuntu Node 24 vs host Node 26.4.0 parity note applies unchanged (P4-S7 residual risk 2); the Redis module and ioredis 6 require Node ≥ 20 — satisfied by both.

## 6. Permission / RBAC surface

No new permission codes, no new API routes, no export surfaces (S7 adds no controller). Health extension modifies the payload of the existing PUBLIC health route only. RBAC catalog untouched (S5e 49/49 baseline cited).

## 7. Discrepancy log (security)

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| SEC-01 | High (pre-existing) | Production dependency tree: 10 HIGH advisories (multer/lodash/js-yaml/fast-uri/react-router) — frozen lockfile, not S7-introduced (ioredis contributes 0) | **REMEDIATED per D-075** — multer 2.0.2→2.2.0 via `pnpm.overrides` (4 HIGH + 1 moderate cleared; audit 10→6 HIGH, 0 new); remaining 6 HIGH (lodash×1 / js-yaml×2 / fast-uri×2 / react-router×1) **accepted in writing by Bryan (D-075)** with reachability recorded (§4 SEC-01 remediation record); re-review at production-launch strategy |
| SEC-02 | Low (pre-existing) | `REDEMPTION_VOUCHER_ENCRYPTION_KEY` validated at use time, not startup | Documented (lazy-validation design) |
| FIX-S7-002 | Low | `.env.example` missing 6 documented env names | FIXED (bounded documentation fix) |
| — | — | AHS-003 | CLOSED by S7 Redis rate limiter (§1) |

Approval bar status: **0 Critical / 0 High introduced by S7**; the 10 pre-existing HIGH dependency advisories are disposed per D-075 — multer remediated (override to 2.2.0, audit 10→6 HIGH, 0 new) and the remaining 6 HIGH formally accepted in writing by Bryan with reachability recorded (§4); S7's own additions are clean.
