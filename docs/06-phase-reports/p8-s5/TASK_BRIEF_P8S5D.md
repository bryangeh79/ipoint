# TASK_BRIEF_P8S5D — Full-Repo Phase 8 CI Workflow (F-03)

> Phase 8 · Sub-phase **P8-S5d** · Branch `task/p8-s5d-full-repo-ci` @ `18c4f547`
> Contract: `P8_S0_CONTRACT_FREEZE.md` §5 (G-05 part (c)) + gap audit F-03: "CI gap: workflows exist for Phases 0/3/4/5 era; a full-repo Phase 8 CI workflow is required for repeatable evidence"
> Executor: independent coding subagent (D-060 alternate executor authorization) · Verifier: OpenClaw host integration gate · Reviewer: independent Reviewer B' (D-060)

---

## 1. Mission

Add a **Phase 8 full-repo CI workflow** (`.github/workflows/p8-ci.yml`) that gives repeatable, evidence-grade verification of the whole repository as it stands at Phase 8 — all apps (`api`, `member-web`, `merchant-web`, `admin-web`), all packages (`api-client`, `business-rules`, `config`, `database`, `design-tokens`, `types`, `ui`, `validation`), and the P8 integration suites (P8-S1..S5) with their fail-closed DB guards.

## 2. Existing patterns to mirror (read these first)

- `.github/workflows/p5-ci.yml` — job layout (quality / build / unit-tests / database-tests / domain / integration), postgres service, env, `pnpm install --frozen-lockfile`.
- `.github/workflows/ci.yml` — env block (NODE_VERSION 24, PNPM_VERSION 9.15.9, AUTH_OTP_PEPPER, REDEMPTION_VOUCHER_ENCRYPTION_KEY).
- Root `package.json` scripts (already present): `format:check`, `lint`, `typecheck`, `build`, `test` (vitest workspace), `test:api`, `test:database`, `test:database:integration`, `openapi:validate`, `db:migrate`, `db:seed`, `db:checksum`, `db:drift`.

## 3. Required workflow design (`p8-ci.yml`)

Trigger: `workflow_dispatch` + `push` on `phase/8-final-delivery-readiness` + `task/p8-**` + `pull_request` targeting `phase/8-final-delivery-readiness` (mirror p5 pattern).

Env (top-level, mirror ci.yml): NODE_VERSION `24`, PNPM_VERSION `9.15.9`, AUTH_OTP_PEPPER, REDEMPTION_VOUCHER_ENCRYPTION_KEY (64 hex — use the same test value as ci.yml), plus the P8 guard envs listed in §5.

Jobs (each: checkout → pnpm/action-setup → setup-node with pnpm cache → `pnpm install --frozen-lockfile`):

1. **quality**: `pnpm format:check` → `pnpm lint` → `pnpm typecheck`
2. **build**: `pnpm build`
3. **unit**: `pnpm test -- --reporter verbose` (full vitest workspace — member-web, admin-web, merchant-web, api-client, database, etc.)
4. **database** (postgres:17-alpine service, `ipoint_ci` db): `pnpm db:checksum` → `pnpm db:migrate` → `pnpm db:seed` ×2 (mirror p5 idempotency check) → `pnpm db:drift` → `pnpm test:database` → `pnpm test:database:integration` → `pnpm db:checksum` → `pnpm db:drift` (post-migration checksum/drift must stay clean — 40/40)
5. **openapi**: `pnpm openapi:validate` (needs the api env)
6. **api-integration** (postgres + redis services): run the api integration suites with the P8 fail-closed guards — see §5. Use the service `ipoint_ci` DB as the migration base and let each guarded spec create/drop its own `ipoint_p8sN_*` database via its own DATABASE_URL override per step. Cover at least: P8-S1 (ads-content), P8-S2 (reconciliation), P8-S3 (risk-controls), P8-S4 (advanced reports), P8-S5a/b/c web suites already run in `unit` — the api-integration job focuses on the api P8 integration specs.

## 4. P8 fail-closed guard contract (MANDATORY — do not break it)

The P8 integration specs refuse to run unless BOTH hold:
- `DATABASE_URL` names the pattern DB `ipoint_p8sN_*` (e.g. `postgresql://ipoint:ipoint_ci@127.0.0.1:5432/ipoint_p8s1_test`), AND
- the matching `P8SN_DESTRUCTIVE_TEST=1` env is set (P8S1_DESTRUCTIVE_TEST … P8S4_DESTRUCTIVE_TEST).

In the workflow, each guarded suite must run with its own step-level env override:
```yaml
- name: P8-S4 advanced reports integration
  env:
    DATABASE_URL: postgresql://ipoint:ipoint_ci@127.0.0.1:5432/ipoint_p8s4_test
    P8S4_DESTRUCTIVE_TEST: '1'
    REDIS_URL: redis://127.0.0.1:6379
  run: cd apps/api && pnpm vitest run src/admin-report-ops --reporter verbose
```
- Inspect the actual spec files to confirm the exact guard env names and spec paths (see `apps/api/src/admin-*/` and any `*-advanced.integration.spec.ts` / P8-S1..S3 specs). Enumerate the real suite paths in the delivery report.
- Do NOT weaken, bypass, or "fix" the guards; do NOT run guarded specs against `ipoint_ci` directly.
- Include a `redis:7-alpine` service in any job whose specs touch Redis (reports/reconciliation suites stub REDIS_URL).

## 5. Guard env summary (verify against real specs, then record)

| Suite | DATABASE_URL (pattern) | Guard env |
|---|---|---|
| P8-S1 ads/content | `…/ipoint_p8s1_test` | `P8S1_DESTRUCTIVE_TEST=1` |
| P8-S2 reconciliation | `…/ipoint_p8s2_test` | `P8S2_DESTRUCTIVE_TEST=1` |
| P8-S3 risk controls | `…/ipoint_p8s3_test` | `P8S3_DESTRUCTIVE_TEST=1` |
| P8-S4 advanced reports | `…/ipoint_p8s4_test` | `P8S4_DESTRUCTIVE_TEST=1` |

## 6. Frozen / Do Not Touch

- ❌ `apps/api/`, `packages/database/` (incl. migrations/checksums — a CI workflow must not alter them), `docs/00-master/`.
- ❌ No changes to existing `ci.yml` / `p3-ci.yml` / `p4-ci.yml` / `p5-ci.yml` (legacy workflows stay as-is).
- ❌ No secrets in the workflow (test-only env values only; no production credentials).
- ❌ No `.npmrc` commit (delete the copied one in the worktree); UTF-8 no BOM, correct Unicode.

## 7. Definition of done (verifier will check)

1. `.github/workflows/p8-ci.yml` present; YAML parses (verify locally: `node -e` with `yaml` or `python -c "import yaml; yaml.safe_load(open(...))"` — use whatever is available; record the method).
2. Every `run:` command referenced by the workflow is exercised **locally** in the worktree with the same env shape (quality/build/unit/database/openapi commands all green; the guarded integration steps are validated by running ONE representative guarded suite locally with its guard env, e.g. P8-S4, to prove the step commands + guard envs are correct).
3. Trigger/`needs`/service wiring is structurally correct (review-level check: no job depends on a job it doesn't need; postgres/redis services attached only where used).
4. No changes outside `.github/workflows/p8-ci.yml` + delivery report (unless the guard-env discovery proves a spec path correction is needed — record it).
5. Delivery report `docs/06-phase-reports/p8-s5/P8_S5D_DELIVERY_REPORT.md`: workflow design, job/step map, guard env table with the REAL spec paths discovered, local verification evidence (command outputs summarized), commit map, assumptions.

## 8. Deliverables

- `.github/workflows/p8-ci.yml`
- `docs/06-phase-reports/p8-s5/P8_S5D_DELIVERY_REPORT.md`
- Scoped commit(s): `ci(p8-s5): add full-repo phase 8 ci workflow` + `docs(p8-s5): add P8-S5d delivery report`

## 9. Notes

- The workflow is for GitHub Actions; local execution of the full matrix is not possible. The verifier accepts: YAML parse + local execution of every referenced command (identical env shape) + one representative guarded P8 integration suite run locally with its guard env.
- Keep the workflow green-first: `cancel-in-progress: true` concurrency group, `permissions: contents: read` (plus `checks`/`pull-requests` write only if the workflow posts statuses — mirror p5 if needed).
- If a P8 suite currently fails on a fresh CI-like environment for a pre-existing reason (e.g. the known `p5-s1-schema.test.ts` baseline failure), do NOT include that file in the workflow's run scope — scope the workflow to the suites that are green, and note the exclusions in the delivery report.
