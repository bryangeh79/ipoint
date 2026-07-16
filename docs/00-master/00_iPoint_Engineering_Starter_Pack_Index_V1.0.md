# iPoint Engineering Starter Pack Index V1.0

> Status: Baseline for engineering planning and Phase execution
> Owner: Bryan
> Product and architecture authority: ChatGPT Command Center
> Project manager: OpenClaw
> Engineering executors: Codex CLI workers

## 1. Purpose

This starter pack converts the approved iPoint product documents into an engineering-ready baseline. It is not a replacement for the Member, Merchant, Admin, Commission, International Architecture, Product Design System, or App Flow documents. It defines how those documents must be implemented safely and consistently.

## 2. Required reading order

1. `docs/00-master/PROJECT_MASTER_CONTROL.md`
2. `docs/00-master/00_iPoint_Engineering_Starter_Pack_Index_V1.0.md`
3. `docs/03-architecture/01_iPoint_System_Architecture_V1.0.md`
4. `docs/03-architecture/02_iPoint_Complete_App_Flow_and_Screen_Flow_V1.0.md`
5. `docs/03-architecture/03_iPoint_Database_ERD_and_Ledger_Specification_V1.0.md`
6. `docs/03-architecture/04_iPoint_API_Contract_Specification_V1.0.md`
7. `docs/04-engineering/05_iPoint_Engineering_Standards_and_Git_Workflow_V1.0.md`
8. `docs/04-engineering/06_iPoint_Deployment_Security_and_Operations_V1.0.md`
9. `docs/05-roadmap/07_iPoint_MVP_Roadmap_and_Acceptance_V1.0.md`
10. Approved product PRDs and the official Product Design System.

## 3. Product modules

The system has three product surfaces and one shared domain core:

- Member application
- Merchant application
- Admin platform
- Shared identity, market, transaction, ledger, reward, commission, redemption, audit, notification, and configuration services

## 4. Locked product principles

- One account can operate across multiple markets.
- Account Country and Current Market are different concepts.
- Market-sensitive content and wallet views follow Current Market.
- Cross-market consumption belongs to the consumption market wallet.
- Member, Merchant, Agent, Transaction, and Receipt public identifiers are separate from internal database UUIDs.
- Merchant service fee is charged from confirmed transaction value according to the package version selected for that transaction.
- MCP, iPoint, and commission movements require immutable ledger records.
- Daily iPoint reward settlement occurs using each market's local 00:00 boundary.
- Reward rates, redemption rates, merchant service-fee packages, special rates, commission rates, and market policies must be configurable and versioned.
- UI and UX must follow the official iPoint Product Design System; screenshots are reference material, not the design authority.
- High-regulation future modules such as e-wallet, lending, IPO subscription, and cross-border settlement are not part of the current MVP.

## 5. Delivery operating model

### ChatGPT Command Center

Defines Big Phases, approves product and architecture decisions, reviews commits and evidence, and issues APPROVED, CHANGES REQUIRED, REJECTED, or READY FOR NEXT PHASE decisions.

### OpenClaw

Does not write code. It decomposes an approved Big Phase into small phases, assigns work to Codex CLI workers, manages dependencies and file ownership, collects commits and test evidence, and submits a consolidated report.

### Codex CLI workers

Write code only within assigned scope. Every small phase must produce committed code, test evidence, changed-file listing, known risks, and outstanding work.

## 6. Definition of Done

A task is not complete unless all applicable checks pass:

- Scope implemented without unauthorized expansion
- Lint passes
- Type checking passes
- Build passes
- Unit tests pass
- Integration tests pass where applicable
- E2E or manual evidence exists for critical flow
- Database migration and rollback are validated where applicable
- Security and permission checks are covered
- UI states include loading, empty, error, disabled, success, permission denied, expired, suspended, and offline where relevant
- Git commit is present with a clear conventional message
- OpenClaw report is complete
- ChatGPT Command Center approves the result

## 7. Scope control

All requirements must be classified as:

- `LOCKED`: approved and may be implemented
- `CONFIGURABLE`: structure may be implemented, but values must not be hard-coded
- `DEFERRED`: may be documented or designed for extensibility, but must not be implemented in the current MVP unless explicitly promoted
- `OPEN`: unresolved; no production implementation without a decision

## 8. Conflict rule

When documents conflict, follow the authority order in `PROJECT_MASTER_CONTROL.md`. Never silently choose one interpretation. OpenClaw must escalate the conflict before assigning implementation.
