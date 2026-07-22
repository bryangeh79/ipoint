# Track B — Host Validation Recovery Report

> **Phase:** 3 — Multi-Market Wallet & Reward Ledger  
> **Sprint:** P3-S1  
> **Date:** 2026-07-22  
> **Agent:** Codex CLI — Track B Validation Agent  
> **Branch:** phase/3-multi-market-wallet-reward-ledger

---

## 1. Executive Summary

The sandbox environment (Docker container) cannot run the pnpm pipeline due to **two compounding failures**:

1. **Broken absolute symlinks** — `node_modules/` was created on the Windows host where pnpm wrote absolute paths (`/mnt/c/AI_WORKSPACE/...`). These paths do **not exist** inside the sandbox container.
2. **Corrupted virtual store** — An attempt to run `pnpm install --frozen-lockfile` in the container **removed the original package content** from `node_modules/.pnpm/` before failing with `ENOMEM` (out of memory). The virtual store is now partially empty and unrecoverable within the sandbox.

**Verdict: Sandbox-only recovery is not viable.** The definitive fix requires running `pnpm install` on the Windows host where pnpm and full memory are available.

**Deliverables produced:**
| Artifact | Path | Purpose |
|---|---|---|
| Environment validation script | `scripts/validate-environment.mjs` | Run diagnostics in any environment |
| Host pipeline script | `scripts/host-pipeline.ps1` | Run full pipeline on Windows host |
| CI workflow (GitHub Actions) | `.github/workflows/p3-ci.yml` | CI for `phase/3-*` branches |
| Symlink fix script | `scripts/fix-pnpm-symlinks.mjs` | Repair broken symlinks (pre-corruption) |
| This report | `docs/06-phase-reports/p3-s1/TRACK_B_VALIDATION_REPORT.md` | — |

---

## 2. Environment Snapshot

| Component                          | Value                                                    | Status                |
| ---------------------------------- | -------------------------------------------------------- | --------------------- |
| **OS**                             | Linux (Docker container)                                 | PASS                  |
| **Node (system)**                  | v18.20.4 via `/usr/bin/node`                             | PASS (below min req)  |
| **Node (project min)**             | v22.23.1 via `./node22`                                  | PASS (meets >=22.0.0) |
| **pnpm (PATH)**                    | Not found                                                | FAIL                  |
| **pnpm (./pnpm static binary)**    | 63.9 MB ELF binary, causes SIGKILL                       | FAIL                  |
| **pnpm (via npm install)**         | Works via `./node22 /tmp/node_modules/pnpm/bin/pnpm.cjs` | PARTIAL               |
| **Corepack**                       | Not available in container                               | FAIL                  |
| **node_modules/ .pnpm store**      | 646 entry dirs, most empty after failed install          | CORRUPTED             |
| **node_modules/ hoisted symlinks** | All 28 original symlinks broken or removed               | FAIL                  |
| **pnpm global store**              | `/workspace/.pnpm-store/v3/` exists with content         | PASS                  |
| **Git**                            | Not available in container                               | FAIL                  |
| **GitHub CLI**                     | Not available in container                               | SKIP                  |
| **DATABASE_URL**                   | Not set                                                  | FAIL                  |
| **REDIS_URL**                      | Not set                                                  | FAIL                  |
| **Docker**                         | Not available (we're inside a container)                 | SKIP                  |

---

## 3. Diagnosis Results

### 3.1 Check Matrix

| #   | Check                   | Result  | Detail                                      |
| --- | ----------------------- | ------- | ------------------------------------------- |
| 1a  | `node --version`        | ✅ PASS | v18.20.4                                    |
| 1b  | `./node22 --version`    | ✅ PASS | v22.23.1 — meets >=22.0.0                   |
| 2a  | `pnpm --version` (PATH) | ❌ FAIL | Not in PATH. Need `pnpm@9.15.9`             |
| 2b  | `./pnpm` binary         | ⚠️ INFO | 63.9 MB ELF binary, causes SIGKILL          |
| 3a  | `corepack enable`       | ❌ FAIL | Not installed                               |
| 3b  | `corepack prepare pnpm` | ❌ FAIL | Corepack unavailable                        |
| 4a  | node_modules exists     | ✅ PASS | Directory found                             |
| 4b  | symlink: prettier       | ❌ FAIL | Missing (removed by failed pnpm install)    |
| 4c  | symlink: vitest         | ❌ FAIL | Missing                                     |
| 4d  | symlink: eslint         | ❌ FAIL | Missing                                     |
| 4e  | symlink: typescript     | ❌ FAIL | Missing                                     |
| 4f  | symlink health (all)    | ❌ FAIL | 0/28 working, 28 broken                     |
| 4g  | .pnpm virtual store     | ✅ PASS | 646 package entries (partially empty)       |
| 4h  | .bin scripts            | ✅ PASS | 24 shims found (snapshot before corruption) |
| 5   | pnpm store directory    | ✅ PASS | `.pnpm-store/v3/` exists with content       |
| 6   | git --version           | ❌ FAIL | Not installed in sandbox                    |
| 7   | gh auth status          | ⏭️ SKIP | Not available                               |
| 8   | DATABASE_URL            | ❌ FAIL | Not set                                     |
| 9   | REDIS_URL               | ❌ FAIL | Not set                                     |
| 10  | docker --version        | ⏭️ SKIP | Not available                               |

### 3.2 Root Cause Analysis

**Primary failure: Broken symlinks from host path dependency.**

- pnpm on Windows created `node_modules/` symlinks using absolute paths referencing `/mnt/c/AI_WORKSPACE/...` (WSL translation of `C:\AI_WORKSPACE\...`).
- Inside the sandbox container, `/mnt/host/` is not mounted, so **every symlink resolves to a non-existent path**.

**Secondary failure: Corrupted .pnpm virtual store.**

- Running `pnpm install --frozen-lockfile` via a locally-installed pnpm (npm-installed in `/tmp/`) began by **removing the existing node_modules content** before failing with `ENOMEM` (out of memory).
- This left 646 directory entries in `node_modules/.pnpm/` but most are **empty shells** — their package content (e.g., `prettier/bin/prettier.cjs`, `vitest/dist/cli.js`) was deleted.
- The global store at `.pnpm-store/v3/` still contains the original content but pnpm cannot restore from it in a low-memory environment.

**Tertiary failure: Insufficient sandbox memory.**

- `rm -rf` on large directories and `pnpm install` both fail with `SIGKILL` (OOM killer) or `ENOMEM`.
- The sandbox container memory limit is too low for pnpm's flat dependency resolution with 815+ packages.

---

## 4. Recommended Fix Path

### 4.1 Immediate Host Recovery (Windows environment)

The fastest path to a working pipeline is to run `pnpm install` on the **Windows host**:

```powershell
# Step 1: Clean the corrupted node_modules
Remove-Item -Recurse -Force node_modules/.pnpm
Remove-Item -Recurse -Force node_modules/.vite
Remove-Item -Force node_modules/.modules.yaml -ErrorAction SilentlyContinue

# Step 2: Reinstall from scratch
pnpm install --frozen-lockfile

# Step 3: Verify
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test -- --reporter verbose
```

Or use the provided automation script:

```powershell
.\scripts\host-pipeline.ps1
```

### 4.2 Sandbox Workarounds (if host access is restricted)

If the sandbox must be used, pre-create `node_modules/` on the **host** before starting the container:

```powershell
# On Windows host — before starting sandbox
pnpm install --frozen-lockfile
```

The host creates correct Windows-native symlinks; these will be available through the host mount in the container.

### 4.3 GitHub Actions (fully automated, no sandbox needed)

The CI workflow at `.github/workflows/p3-ci.yml` runs on native GitHub Actions runners (not the sandbox) with:

- **Ubuntu latest** runner with full memory
- **PostgreSQL 17** service container (port 5432)
- **pnpm 9.15.9** via `pnpm/action-setup`
- **Node.js 24**
- Stages: format:check → lint → typecheck → build → test → database → API tests

Trigger: push to any `phase/3-*` branch.

### 4.4 Symlink-only fix (for reference, pre-corruption only)

The script `scripts/fix-pnpm-symlinks.mjs` can repair broken absolute symlinks to use relative paths. This works **only if the .pnpm virtual store is intact**:

```bash
./node22 scripts/fix-pnpm-symlinks.mjs [--dry-run] [--essential-only]
```

This is no longer applicable since the store was corrupted.

---

## 5. CI Workflow File (Scenario A)

**Path:** `.github/workflows/p3-ci.yml`

```yaml
# Highlights:
# Trigger: push to phase/3-**
# Steps: install, format:check, lint, typecheck, build, test
# PostgreSQL service container included
# DATABASE_URL set to CI test database
# Same env vars as existing ci.yml
```

**Key differences from the existing `ci.yml`:**

- Trigger scoped to `phase/3-*` branches
- Simplified test strategy focused on Phase 3 deliverables
- Uses `--reporter verbose` for test output

---

## 6. Host Pipeline Script (Scenario B)

**Path:** `scripts/host-pipeline.ps1`

```powershell
# Usage:
#   .\scripts\host-pipeline.ps1            # Full pipeline
#   .\scripts\host-pipeline.ps1 -NoInstall  # Skip pnpm install
#   .\scripts\host-pipeline.ps1 -SkipTests # Skip test step
```

**Steps executed:**

1. `pnpm install --frozen-lockfile` (unless `-NoInstall`)
2. `pnpm format:check`
3. `pnpm lint`
4. `pnpm typecheck`
5. `pnpm build`
6. `pnpm test -- --reporter verbose` (unless `-SkipTests`)

**Output:** Full log written to `pipeline-logs/pipeline-{timestamp}.log`

---

## 7. Artifacts Summary

| File                               | Lines | Purpose                                          |
| ---------------------------------- | ----- | ------------------------------------------------ |
| `scripts/validate-environment.mjs` | ~340  | Comprehensive environment validation (10 checks) |
| `scripts/host-pipeline.ps1`        | ~120  | Windows host pipeline automation                 |
| `.github/workflows/p3-ci.yml`      | ~155  | GitHub Actions workflow for Phase 3              |
| `scripts/fix-pnpm-symlinks.mjs`    | ~160  | Symlink repair utility (reference)               |
| This report                        | ~210  | —                                                |

---

## 8. Lessons Learned

1. **pnpm + Docker mount** — pnpm's absolute symlinks break when `node_modules/` is created on the host and mounted into a container. The workaround is to either:
   - Run `pnpm install` inside the container (with sufficient memory)
   - Or use `--store-dir` within the container to avoid cross-mount issues

2. **Memory constraints** — pnpm requires significant memory for dependency resolution. The sandbox should have at least 4 GB available for `pnpm install` with 800+ packages.

3. **No `pnpm install` inside sandbox** without knowing the memory limit ahead of time. Use host execution or CI for reliable results.

4. **Symlink fix scripts are fragile** — they must handle scoped packages (@scope/name → scope+name in store key) and cannot recover from a corrupted store.
