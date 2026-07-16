# iPoint Project Master Control

> This is the operating authority map for the iPoint repository. OpenClaw and every Codex CLI worker must read this file before accepting any Phase task.

## 1. Governance roles

### Bryan

Final business decision owner. Only Bryan may approve changes to business positioning, commercial rules, product scope, and major delivery priority.

### ChatGPT Command Center

Acts as product commander, architecture authority, and final engineering acceptance reviewer. It defines Big Phases, resolves requirement conflicts, reviews commits and test evidence, and issues one of the following decisions:

- `APPROVED`
- `CHANGES REQUIRED`
- `REJECTED`
- `READY FOR NEXT PHASE`

### OpenClaw

Acts as project general manager. OpenClaw does not write production code. It:

- Reads the full project baseline
- Receives an approved Big Phase
- Decomposes it into small phases
- Assigns small phases to Codex CLI workers
- Defines dependency order and file ownership
- Prevents overlapping changes and migration conflicts
- Collects commits, tests, screenshots, risks, and outstanding work
- Submits a consolidated report to ChatGPT Command Center
- Dispatches rework after review

OpenClaw may not change business rules, invent product features, redesign the UI language, change the technology stack without approval, bypass tests, approve its own Big Phase, or merge unreviewed work to `main`.

### Codex CLI workers

Codex CLI workers are the only engineering executors in this operating model. They write code, tests, migrations, documentation, and technical evidence within assigned scope. They may not expand scope, reinterpret locked rules, hard-code configurable values, or directly push to `main`.

## 2. Document authority order

When documents conflict, use this order:

1. Bryan's latest explicit written decision
2. Latest ChatGPT Command Center Phase Brief, Correction Notice, or acceptance decision
3. Latest approved Admin PRD
4. Latest Member PRD international architecture update
5. Latest approved Merchant PRD
6. Official iPoint Product Design System
7. This Project Master Control and Engineering Starter Pack
8. Member baseline PRD
9. Approved commission mechanism document
10. Complete App Flow and machine-readable flow specification
11. Early business-planning drafts
12. Screenshots and visual references

Never silently resolve a conflict. OpenClaw must record it and request a decision before implementation.

## 3. Historical-document warning

Early planning documents may state that development has not started, exclude modules later approved, or show provisional values. They are retained for business background only and are not engineering authority when newer PRDs or decisions exist.

Examples and provisional numbers are not automatically universal rules. Values such as RM388, 1 iPoint = RM1, reward percentages, advertising prices, and commission rates must be treated according to the latest approved market and rule configuration.

## 4. Requirement status classes

Every task and rule must be marked as one of:

### `LOCKED`

Approved and safe to implement according to the latest authority.

Current locked principles include:

- One Account + Multi Market
- Account Country is different from Current Market
- Market-specific Member wallets
- Cross-market consumption credits the consumption-market wallet
- Member universal QR
- Merchant public ID per branch
- MCP precharge model and immutable ledger
- Merchant can own multiple packages; transaction-time package selection appears only when more than one active package is available
- Transaction confirmation stores a rule/package snapshot
- Pending receipt expiry is 60 minutes
- Normal confirmed merchant transaction is not destructively cancellable
- Market-local 00:00 daily reward settlement
- Admin role + market access + action permission
- Maker/Checker for manual MCP and iPoint adjustments
- UI/UX follows the official Product Design System

### `CONFIGURABLE`

The capability and rule structure may be implemented, but values cannot be hard-coded:

- Merchant service-fee percentages
- Special merchant percentages
- Reward percentages
- Redemption rates
- Agent fee by market
- Commission percentages and fixed payouts
- Advertisement MCP fees
- KYC requirements
- Limits and risk thresholds
- Retention and market operating policies

All configurable rules require market scope, version, effective time, status, audit history, and historical calculation preservation.

### `DEFERRED`

Not part of current MVP unless explicitly promoted:

- Cross-market wallet transfer
- Automatic cash withdrawal
- Cross-border settlement
- Licensed e-wallet functions
- Consumer lending
- IPO subscription execution
- Final five-level team performance reward
- Advertisement bidding
- AI risk decision engine
- Advanced recommendation engine

### `OPEN`

Unresolved. Architecture may avoid blocking future decisions, but production behavior must not be invented.

## 5. Product truth summary

### Platform model

- Members join free.
- Merchants participate across online and offline scenarios.
- Merchant promotion service fee is the primary early revenue source.
- Advertisement revenue is a secondary source.
- iPoint is a consumption reward point, not a guaranteed investment return.

### Member

- No protected guest mode
- Registration/login/reset and consent
- Email verification
- KYC Level 1 and Level 2
- One universal account and referral code
- Account Country change requires controlled approval
- Current Market is switchable
- Merchant list/detail/map navigation
- Universal member QR
- Market wallet, daily reward, ledger, redemption, team, agent, and settings

### Merchant

- Login/reset, immutable email, referrer record, consent
- Business profile, contact, address, hours, media, About Us
- Business and responsible-person KYC
- Admin approval and MCP activation conditions
- MCP balance/ledger/calculator/top-up/refund
- Transaction amount entry, package selection, member QR scan, confirmation
- Transaction ID, Receipt ID, Member ID search
- Merchant advertising submission using MCP and Admin approval
- Suspension preserves MCP

### Admin

- Market, member, merchant, agent, KYC, transaction, MCP, iPoint, commission, redemption, advertising, risk, audit, reporting, and system-rule operations
- Configurable and versioned commercial rules
- Effective-time historical locking
- Maker/Checker on sensitive manual point adjustments
- Role, Market Access, and Action Permission

### Commission

Currently approved baseline:

- Qualifying member-consumption commission: first generation 1%, second generation 0.5%, calculated from the merchant service fee actually received by the company
- Recommended merchant commission: one generation only, 0.5% of the merchant service fee actually received by the company
- Agent-upgrade fee commission: first generation RM88 and second generation RM38 for the current Malaysia RM388 baseline
- Commission states include Pending, Qualified, Paid, Cancelled, and Frozen
- Final five-level team performance reward remains deferred

## 6. Engineering non-negotiables

- Modular monolith for V1 unless changed by an approved architecture decision
- PostgreSQL as source of truth
- Redis only as supporting cache/lock/queue infrastructure
- Exact decimal or integer arithmetic; no floating point for amounts, percentages, points, or commissions
- Append-only MCP, iPoint, and commission ledgers
- Atomic transaction confirmation
- Idempotency for critical writes and jobs
- UTC storage plus IANA market timezone processing
- Public identifiers separated from internal keys
- Versioned database migrations
- No physical deletion of ledger, transaction, approval, or audit history
- Server-side authorization
- Complete privileged-action audit
- Secrets outside Git

## 7. UI/UX authority

The official Product Design System is the authority for tokens, colors, typography, spacing, radius, components, states, and responsive behavior.

Screenshots and JPEG mockups are visual references only. Codex workers may not infer or invent system tokens from images.

All applicable pages must cover:

- Loading
- Empty
- Error
- Success
- Disabled
- Expired
- Suspended
- Permission denied
- Offline/retry

Shared components must be reused across Member, Merchant, and Admin when appropriate without erasing role-specific UX.

## 8. Git and execution rules

- No direct Codex CLI push to `main`
- Use isolated task branches
- One small phase has traceable commits
- OpenClaw assigns module/file ownership before parallel execution
- Database migration ordering is centrally coordinated
- No vague commit messages
- No hidden failed tests
- No task is complete without commit SHA and evidence

## 9. Phase lifecycle

1. ChatGPT Command Center issues a Big Phase brief.
2. OpenClaw proposes small phases, dependencies, owners, branches, acceptance criteria, and conflict controls.
3. ChatGPT Command Center approves or corrects the breakdown.
4. OpenClaw dispatches Codex CLI workers.
5. Codex workers implement, test, and commit.
6. OpenClaw verifies completeness and produces a consolidated report.
7. ChatGPT Command Center reviews logic, architecture, code, UI/UX, tests, Git history, and risks.
8. Rework occurs until approved.
9. Only approved work may progress toward integration/release.

## 10. Mandatory OpenClaw preflight

Before every Big Phase, OpenClaw must confirm:

- Latest baseline branch/ref read
- Applicable PRDs and design files read
- Requirement statuses identified
- Open decisions and contradictions listed
- Small-phase dependency graph prepared
- File/module ownership allocated
- Migration ownership allocated
- Test strategy defined
- UI evidence requirements defined
- Report format prepared

## 11. Mandatory worker report

Every small phase report includes:

- Task and scope
- Assigned worker and branch
- Commit SHA(s)
- Changed files
- Tests and exact results
- Database/API changes
- UI screenshots or evidence where applicable
- Security and permission impact
- Assumptions
- Risks
- Outstanding work
- Rollback or recovery note

## 12. Reading acknowledgment

OpenClaw must not merely summarize these documents. It must return:

1. Its understanding of the authority order
2. A list of locked, configurable, deferred, and open items
3. Its role boundaries
4. The expected Big Phase execution workflow
5. Any contradictions or missing decisions it detected
6. A statement that it will not write production code and will require Codex CLI commits and test evidence

Only after this acknowledgment is reviewed should Phase 0 be issued.
