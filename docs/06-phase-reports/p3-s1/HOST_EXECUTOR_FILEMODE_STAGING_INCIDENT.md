# HOST_EXECUTOR_FILEMODE_STAGING_INCIDENT

**Date:** 2026-07-22
**Status:** RESOLVED — Index cleaned, no data loss

## Root Cause

The `codex-host-executor-p3` sub-agent (session `3e2e31ba`) used `git add -A` as part of its push workflow. This staged all 520 files with file-mode changes (`100644 → 100755`) introduced by the sub-agent `write` tool across the entire session.

## Responsible Session

- **Session key:** `agent:main:subagent:3e2e31ba`
- **Run ID:** `beea4a3d-77cb-4409-83e6-b005754a2bc4`

## Culprit Command

```
git add -A
```

Not from a script — executed directly by the sub-agent.

## Why Content Is Safe

- All 520 staged changes were pure file-mode (`100644 → 100755`)
- Zero semantic content changes
- Legitimate Phase 3 fixes were already committed at `59c17da` before staging
- No binary data was corrupted

## Recovery

```powershell
git config core.fileMode false
git reset HEAD -- .
```

## Prevention

1. `core.fileMode false` is now set in the repository
2. `scripts/host-executor-push.ps1` now has explicit safety headers
3. All future scripts must audit staged files before commit
4. `git add -A` and `git add .` are permanently prohibited in automation
