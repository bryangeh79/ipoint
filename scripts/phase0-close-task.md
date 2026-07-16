# Phase 0 Governance Close — Codex CLI Task

## Summary

Execute the Phase 0 closure sequence exactly as authorized by ChatGPT Command Center.

## Authorized By

ChatGPT Command Center — COMMAND CENTER FINAL DECISION (2026-07-16 17:32 GMT+8)

## Execution Rules

- CODEX-ONLY: No OpenClaw sub-agent involvement
- Auth: CHATGPT_ACCOUNT_SESSION only
- No Phase 1 work of any kind
- No merging without passing CI

## Step 1: Update PHASE_REGISTRY.md

File: `docs/00-master/PHASE_REGISTRY.md`

Changes:

- Current Authorized Phase: `P0-S9 IN_PROGRESS` → `NONE` with note "Phase 0 is CLOSED and APPROVED under D-009"
- P0-S9 summary row: `IN_PROGRESS` → `COMPLETE` with note "Final integration, audit, and acceptance completed under D-009"
- Phase 0 Full Phase list: Change `PENDING` to `APPROVED` and add a second `CLOSED` row
- P0-S9 sub-phase status: `IN_PROGRESS` → `COMPLETE`
- Allowed Actions: Update to post-Phase 0 context (PR ready, squash merge, main CI)
- Prohibited Actions: Update to prevent Phase 1 without authorization
- Last updated note: Add D-009 reference

## Step 2: Update DECISION_LOG.md

File: `docs/00-master/DECISION_LOG.md`

Append D-009 entry before the end marker with these fields:

- Decision ID: D-009
- Date: 2026-07-16
- Source: ChatGPT Command Center — Phase 0 Final Acceptance Decision
- Old Rule: Phase 0 PENDING, P0-S9 IN_PROGRESS
- New Decision: Accept Phase 0 at PR #4 head `f9706c4bd4719a180cd83953d3c1ca94bda9eef4`. GitHub CI both runs SUCCESS. P0-S9 COMPLETE. Phase 0 APPROVED and CLOSED. Phase 1 requires new authorization.
- Reason: All sub-phases complete, full audit passed, all verification gates passed, CI SUCCESS, no business leakage
- Affected Files: docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md, docs/06-phase-reports/PHASE_0_FINAL_ACCEPTANCE_REPORT.md, PR #4
- Affected Phases: P0-S9, Phase 0
- Migration: NONE
- Approver: ChatGPT Command Center
- Basis: Phase 0 Final Acceptance Decision (2026-07-16)
- Status: **APPROVED**

## Step 3: Git Commit & Push

```bash
git add docs/00-master/PHASE_REGISTRY.md docs/00-master/DECISION_LOG.md
git commit -m "docs(governance): close Phase 0 engineering foundation"
git push origin phase/0-engineering-foundation
```

## Step 4: Poll GitHub CI

Watch the push-triggered workflow run until completion. The workflow is `.github/workflows/ci.yml`. Poll `gh run list --workflow ci.yml --branch phase/0-engineering-foundation --limit 1 --json databaseId,status,conclusion`.

Wait until all 5 jobs (Quality, Unit tests, Database tests, API tests, E2E) are all `status=completed` and `conclusion=success`.

## Step 5: PR #4 Draft → Ready for Review

Only if CI passes:

```bash
gh pr ready 4
```

Wait briefly, then verify PR state:

```bash
gh pr view 4 --json headRefOid,isDraft,mergeStateStatus,state
```

## Step 6: Squash Merge PR #4 into main

Only if:

- PR is OPEN, not Draft
- headRefOid matches the latest commit
- mergeStateStatus is CLEAN
- baseRefName is main

```bash
gh pr merge 4 --squash --subject "feat(phase-0): establish iPoint engineering foundation"
```

## Step 7: Verify main CI

Wait for the main CI workflow to complete. Poll `gh run list --workflow ci.yml --branch main --limit 1 --json databaseId,status,conclusion`.

Verify all 5 jobs SUCCESS.

## Step 8: Print Final Summary

Print:

- Execution Engine: Codex CLI
- OpenClaw Subagent Used: NO
- Auth Source: CHATGPT_ACCOUNT_SESSION
- Governance close commit SHA
- Final PR Head SHA
- PR #4 state
- Merge method
- Main squash commit SHA
- Main Head SHA
- Main CI run ID
- All job results
- PHASE_REGISTRY status
- D-009 status
- Tracked main status
- Primary workspace untracked inventory (summarize)
- Phase 1 status: NOT STARTED

## Prohibited

- Do NOT start Phase 1
- Do NOT create a Phase 1 branch
- Do NOT modify Merchant business schema
- Do NOT implement Merchant onboarding
- Do NOT modify main history
- Do NOT force push
- Do NOT commit untracked files
- Do NOT use ordinary merge or rebase merge
