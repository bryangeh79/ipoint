# iPoint Engineering Rules

> This file is restored from the legacy workspace AGENTS.md (2026-07-15). It defines engineering workflow rules for Codex CLI.
> Relevance: Every Codex CLI worker must read this file before starting any implementation task.

---

## 1. Operating model

- ChatGPT is the product owner, architect, task planner, and final QA authority.
- Codex CLI is the primary code-writing and repository execution agent.
- Gemini CLI / Pro is the independent reviewer and test-gap analyst.
- GitHub is the engineering source of truth.
- Continue automatically unless a decision is financially material, legally sensitive, destructive, irreversible, production-facing, or changes an approved business rule.

## 2. Canonical workspace

- Development machine project root: `C:\AI_WORKSPACE\iPoint App`
- GitHub repository: `https://github.com/bryangeh79/ipoint`
- Git remote: `origin`
- Integration branch: `develop`
- Production branch: `main`
- All Codex CLI commands must run from the canonical project root unless a task explicitly requires a subdirectory.
- If the local directory is missing, clone the repository into the canonical project root.
- If the directory exists, verify `origin` points to the canonical GitHub repository before making changes.

## 3. Delivery principle

Use "complete first, perfect next":

1. deliver a working vertical slice;
2. verify business correctness;
3. add failure handling and tests;
4. refine UI/UX;
5. harden security, performance, and operations.

Do not stop for ordinary implementation choices. Record reasonable assumptions in `DECISIONS.md` and continue.

## 4. Locked product constraints

- UI/UX must follow iPoint Product Design System V1.0 and the approved member, merchant, and admin layouts.
- Architecture must support One Account + Multi Market from the beginning.
- Initial launch market is Malaysia, but country and market must not be hard-coded.
- MCP, iPoint, and commission changes must use ledger entries, not direct mutable balances.
- Monetary and point calculations must use decimal-safe types; never use floating point.
- Financial and audit records must not be hard-deleted.
- Daily reward processing must be timezone-aware, versioned, idempotent, retryable, and auditable.
- Do not implement real withdrawals, cross-border settlement, lending, IPO subscription, or regulated wallet functions without explicit approval.

## 5. Branch and Git rules

- Never develop directly on `main`.
- Use `develop` as the integration branch.
- Use short-lived branches such as `feat/...`, `fix/...`, `chore/...`.
- Prefer small, intentional commits.
- Push after approximately three small completed tasks, except database, ledger, auth, permission, and transaction-state changes, which require dedicated commits.
- Open a Draft PR for each phase or meaningful workstream.

## 6. Mandatory startup routine

At the start of every Codex session:

1. change directory to `C:\AI_WORKSPACE\iPoint App`;
2. read this file;
3. read `PROJECT_STATUS.md`;
4. read `tasks/active.yaml` and `tasks/backlog.yaml`;
5. run `git status`, verify the branch, and verify `git remote -v`;
6. fetch and rebase or fast-forward safely from the appropriate remote branch;
7. identify the highest-priority unblocked task;
8. execute without requesting confirmation unless it meets a stop condition.

## 7. Mandatory completion routine

Before marking work complete:

- format;
- lint;
- typecheck;
- unit tests;
- integration tests where applicable;
- build;
- migration validation where applicable;
- secret scan and dependency audit when configured;
- update `PROJECT_STATUS.md`;
- move task state appropriately;
- update architecture or decision records if behavior changed;
- commit with a conventional commit message;
- push the current feature branch;
- update the Draft PR.

## 8. Stop conditions

Pause and request Bryan's decision only for:

- changes to approved commissions, reward rates, exchange rates, or payment rules;
- production deployment;
- real payment, refund, withdrawal, settlement, or money movement;
- destructive or irreversible database actions;
- legal, privacy, tax, or regulatory positioning;
- paid purchases or meaningful recurring cost commitments;
- changes to the approved design system or brand direction;
- major architecture replacement;
- irreconcilable conflicts between approved PRDs.

## 9. Quality priorities

1. accounting and ledger correctness;
2. transaction integrity and idempotency;
3. admin control and auditability;
4. security and authorization;
5. usable UI/UX;
6. performance and polish.
