# iPoint Engineering Rules

## 1. Operating model

- ChatGPT is the product owner, architect, task planner, and final QA authority.
- Codex CLI is the primary code-writing and repository execution agent.
- Gemini CLI / Pro is the independent reviewer and test-gap analyst.
- GitHub is the engineering source of truth.
- Continue automatically unless a decision is financially material, legally sensitive, destructive, irreversible, production-facing, or changes an approved business rule.

## 2. Delivery principle

Use "complete first, perfect next":

1. deliver a working vertical slice;
2. verify business correctness;
3. add failure handling and tests;
4. refine UI/UX;
5. harden security, performance, and operations.

Do not stop for ordinary implementation choices. Record reasonable assumptions in `DECISIONS.md` and continue.

## 3. Locked product constraints

- UI/UX must follow iPoint Product Design System V1.0 and the approved member, merchant, and admin layouts.
- Architecture must support One Account + Multi Market from the beginning.
- Initial launch market is Malaysia, but country and market must not be hard-coded.
- MCP, iPoint, and commission changes must use ledger entries, not direct mutable balances.
- Monetary and point calculations must use decimal-safe types; never use floating point.
- Financial and audit records must not be hard-deleted.
- Daily reward processing must be timezone-aware, versioned, idempotent, retryable, and auditable.
- Do not implement real withdrawals, cross-border settlement, lending, IPO subscription, or regulated wallet functions without explicit approval.

## 4. Branch and Git rules

- Never develop directly on `main`.
- Use `develop` as the integration branch.
- Use short-lived branches such as `feat/...`, `fix/...`, `chore/...`.
- Prefer small, intentional commits.
- Push after approximately three small completed tasks, except database, ledger, auth, permission, and transaction-state changes, which require dedicated commits.
- Open a Draft PR for each phase or meaningful workstream.

## 5. Mandatory startup routine

At the start of every Codex session:

1. read this file;
2. read `PROJECT_STATUS.md`;
3. read `tasks/active.yaml` and `tasks/backlog.yaml`;
4. inspect repository status and current branch;
5. identify the highest-priority unblocked task;
6. execute without requesting confirmation unless it meets a stop condition.

## 6. Mandatory completion routine

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
- commit with a conventional commit message.

## 7. Stop conditions

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

## 8. Quality priorities

1. accounting and ledger correctness;
2. transaction integrity and idempotency;
3. admin control and auditability;
4. security and authorization;
5. usable UI/UX;
6. performance and polish.
