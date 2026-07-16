#!/usr/bin/env node
// Phase 0 Governance Close — Codex CLI task
// Updates PHASE_REGISTRY.md and DECISION_LOG.md, commits, pushes

import { readFileSync, writeFileSync } from 'fs';

const PHASE_REGISTRY = 'docs/00-master/PHASE_REGISTRY.md';
const DECISION_LOG = 'docs/00-master/DECISION_LOG.md';

// ── 1. Update PHASE_REGISTRY.md ──

let pr = readFileSync(PHASE_REGISTRY, 'utf8');

// Current Authorized Phase: P0-S9 IN_PROGRESS → NONE
pr = pr.replace(
  `| **Current Authorized Phase** | **P0-S9** | IN_PROGRESS under D-008 final integration authorization |`,
  `| **Current Authorized Phase** | **NONE** | Phase 0 is CLOSED and APPROVED under D-009 |`,
);

// P0-S9 IN_PROGRESS → COMPLETE
pr = pr.replace(
  `| **P0-S9** | **IN_PROGRESS** | Final integration, audit, and acceptance verification under D-008 |`,
  `| **P0-S9** | **COMPLETE** | Final integration, audit, and acceptance completed under D-009 |`,
);

// Phase 0 PENDING → APPROVED
pr = pr.replace(
  `| **Phase 0** | General ledger technical skeleton, DB foundation, Auth framework, RBAC, Market module, Audit infrastructure, Design System tokens | **PENDING** | P0-S9 final acceptance verification in progress; ChatGPT decision required |`,
  `| **Phase 0** | General ledger technical skeleton, DB foundation, Auth framework, RBAC, Market module, Audit infrastructure, Design System tokens | **APPROVED** | ChatGPT Command Center decision D-009 recorded |
| **Phase 0** | General ledger technical skeleton, DB foundation, Auth framework, RBAC, Market module, Audit infrastructure, Design System tokens | **CLOSED** | Phase 0 is closed. Phase 1 must begin under a new Command Center authorization. |`,
);

// Sub-phase status: P0-S9 IN_PROGRESS → COMPLETE
pr = pr.replace(
  `| **P0-S9** | Phase 0 final integration, audit, and acceptance | **IN_PROGRESS** | Final evidence and GitHub CI required |`,
  `| **P0-S9** | Phase 0 final integration, audit, and acceptance | **COMPLETE** | ChatGPT Command Center approved under D-009 |`,
);

// Allowed actions - update to Phase 0 closed context
pr = pr.replace(
  /## Current allowed actions[\s\S]*?(?=## Current prohibited actions)/,
  `## Current allowed actions

- ✅ Read and analyze existing Phase 0 documentation and code
- ✅ Close Phase 0 governance record (D-009)
- ✅ PR #4 Draft → Ready for Review; squash merge to main
- ✅ Verify main CI after merge
- ✅ Append Decision Log entries only when a new decision is issued
- ✅ Update PHASE_REGISTRY.md as authorized status decisions arrive
`,
);

// Prohibited actions
pr = pr.replace(
  /## Current prohibited actions[\s\S]*?(?=\n---)/,
  `## Current prohibited actions

- ❌ Start Phase 1 or create Phase 1 branch without a new explicit Command Center authorization
- ❌ Use OpenClaw sub-agents for engineering execution or accept invalidated sub-agent output as evidence
- ❌ Change LOCKED business rules
- ❌ Hard-code CONFIGURABLE values
- ❌ Implement DEFERRED modules
- ❌ Invent behavior for OPEN questions
- ❌ Delete, clean, stash, or batch-add untracked files
`,
);

// Last updated
pr = pr.replace(
  /Last updated: .*? \| Updated by: Codex CLI \| Based on decisions.*?\n/,
  `Last updated: 2026-07-16 | Updated by: Codex CLI | Based on decisions D-001 through D-009 and ChatGPT Command Center authorization\n`,
);

writeFileSync(PHASE_REGISTRY, pr, 'utf8');

// ── 2. Update DECISION_LOG.md ──

let dl = readFileSync(DECISION_LOG, 'utf8');

const d009Entry = `---

## D-009: Phase 0 Engineering Foundation Accepted

| Field | Value |
|---|---|
| **Decision ID** | D-009 |
| **Date** | 2026-07-16 |
| **Source** | ChatGPT Command Center — Phase 0 Final Acceptance Decision |
| **Old Rule** | Phase 0 was PENDING; P0-S9 was IN_PROGRESS under D-008. Phase 0 acceptance awaited a ChatGPT Command Center decision. |
| **New Decision** | Accept Phase 0 Engineering Foundation at PR #4 head \`f9706c4bd4719a180cd83953d3c1ca94bda9eef4\`. GitHub CI run ID 29486889386 (push) and 29486891153 (pull_request) both SUCCESS with all five jobs passed (Quality, Unit tests, Database tests, API tests, E2E). Mark P0-S9 COMPLETE. Mark Phase 0 APPROVED and CLOSED. Phase 1 must begin under a new explicit Command Center authorization in a new chat session. |
| **Reason** | All Phase 0 sub-phases (P0-S1 through P0-S9) are complete. The full-scope integration audit found 0 PROHIBITED and 0 UNEXPECTED files. Fresh detached-HEAD verification passed all quality, type, build, test (71 unit + 49 API + 11 database + 1 E2E), migration, checksum, seed-idempotency, and drift gates. GitHub CI confirmed all five jobs SUCCESS on both push and pull_request events. No business-scope leakage was accepted. |
| **Affected Files** | docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md, docs/06-phase-reports/PHASE_0_FINAL_ACCEPTANCE_REPORT.md, PR #4 |
| **Affected Phases** | P0-S9, Phase 0 |
| **Migration** | NONE (governance closure only) |
| **Approver** | ChatGPT Command Center |
| **Basis** | Phase 0 Final Acceptance Decision (2026-07-16) — COMMAND CENTER FINAL DECISION |
| **Status** | **APPROVED** |
`;

// Insert D-009 before the end marker
dl = dl.replace(/(\*— End of current entries.*?\*)/, d009Entry + `\n$1`);

writeFileSync(DECISION_LOG, dl, 'utf8');

console.log(
  'Phase 0 governance files updated: PHASE_REGISTRY.md + DECISION_LOG.md',
);
console.log(
  'Ready for commit: docs(governance): close Phase 0 engineering foundation',
);
