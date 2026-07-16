# P1-S1 Phase 1 Baseline Audit and Domain Contract — Codex CLI Task

## Authorization

- **Source:** ChatGPT Command Center — Phase 1 Pre-Authorization Planning Order (2026-07-16 17:56 GMT+8)
- **Scope:** P1-S1 only — planning and document creation
- **Phase 1 implementation:** NOT AUTHORIZED
- **Execution engine:** Codex CLI only; no OpenClaw sub-agent
- **Auth:** CHATGPT_ACCOUNT_SESSION only

## Required Reading (before implementation)

- `AGENTS.md`
- `docs/04-engineering/CODEX_WORKFLOW_RULES.md`
- `docs/00-master/CODEX_QUOTA_RECOVERY_PROTOCOL.md` (if available)
- `Concept/iPoint_Merchant_PRD_V1.0_Full_Official_Edition.docx`
- `Concept/iPoint_Admin_PRD_V1.0_Full_Official_Edition.docx`
- `docs/05-roadmap/07_iPoint_MVP_Roadmap_and_Acceptance_V1.0.md`
- `docs/03-architecture/03_iPoint_Database_ERD_and_Ledger_Specification_V1.0.md`
- `docs/03-architecture/04_iPoint_API_Contract_Specification_V1.0.md`
- Existing Phase 0 codebase under `apps/api/`, `packages/database/`, `packages/`
- `docs/06-phase-reports/PHASE_0_FINAL_ACCEPTANCE_REPORT.md`

## Branch Strategy

- Create clean worktree from baseline: `46912b557227954e392ed622189eda82892cd717`
- Task branch: `task/p1-s1-baseline-domain-map`
- All planning documents go under `docs/06-phase-reports/p1-s1/`
- Do NOT create a `phase/1-*` branch

## Deliverables (10 documents minimum)

Create all documents under `docs/06-phase-reports/p1-s1/`. Use proper Markdown with YAML frontmatter and conventional structure.

### 1. PHASE_1_BASELINE_AUDIT.md

Audit the existing Phase 0 baseline for Phase 1 readiness:

- Existing entities usable by Merchant/MCP (accounts, credentials, sessions, markets, admin_users, roles, permissions, audit_logs, entity_timelines)
- Existing auth guards and RBAC framework
- Migration ownership: which migrations exist (0000, 0001), next migration ID = 0002
- Gaps: what entities/services need to be created
- Verify no business logic leakage from Phase 0

### 2. PHASE_1_SCOPE_MATRIX.md

Map every Phase 1 domain entity to:

- Entity name
- PRD source (Merchant PRD section / Admin PRD section)
- Requirement status (LOCKED/CONFIGURABLE/DEFERRED/OPEN)
- Phase 1 scope (In Scope / Out of Scope)
- Phase 1 implementation (YES/NO) — all must be NO for planning
- Key business rules

### 3. PHASE_1_DOMAIN_MAP.md

Domain boundaries for Phase 1:

- **Merchant Domain:** MerchantGroup (reserved), MerchantBranch, MerchantProfile, MerchantApplication, MerchantKYC, MerchantDocument, MerchantStatusHistory, MerchantReferral
- **Package Domain:** ServiceFeeProfile (Standard Package A-F), ServiceFeePackageVersion, SpecialPercentage, MerchantPackageAssignment, Default/Active/Paused logic, Effective Date
- **MCP Domain:** MCPAccount, MCPLedgerEntry (Recharge/TransactionDeduction/AdvertisingDeduction/ManualCredit/ManualDebit/Refund/Freeze/Unfreeze/Reversal), MCPRechargeRequest, MCPRefundRequest (foundation), MCPAdjustmentRequest, MCPAdjustmentDecision
- **Governance Cross-Cutting:** RBAC evaluation, MarketAccess check, AuditLog, EntityTimeline, Maker/Checker separation, terms/disclaimer version acceptance, file access security

For each domain, define:

- Purpose and boundary
- Key entities
- Key invariants
- Dependencies on Phase 0
- Interfaces to other domains
- File storage boundary (adapter + metadata, no production cloud keys)

### 4. PHASE_1_STATE_MACHINES.md

Complete state machines for:

- Merchant: Draft → PendingKYC → KYCSubmitted → KYCRejected → KYCApproved → AwaitingMCPTopup → Active → Suspended → ClosurePending → Closed
- Transaction (Phase 1 only receipt/request foundation): Pending → WaitingMember → Completed / Expired
- ServiceFeeProfile: Active / Paused / PendingChange
- MCPAdjustmentRequest: Draft → PendingApproval → Approved / Rejected → Executed / Cancelled
- MCPRechargeRequest: Pending → Processing → Completed / Failed
- MCPRefundRequest (foundation): Pending → UnderReview → Approved / Rejected

For each state machine include:

- State table with description
- Allowed transitions
- Transition triggers
- Required side effects (audit, notification, ledger)
- Concurrent state constraints

### 5. PHASE_1_ERD_PROPOSAL.md

Proposed Drizzle schema extension for Phase 1 entities. Use Drizzle Zod/TS syntax. All entities must include:

- UUID primary keys
- `market_id` references (where applicable)
- `created_at` / `updated_at` audit fields
- `archived_at` for soft delete where applicable
- Exact `numeric` types (via Drizzle `numeric()` which maps to PostgreSQL numeric)
- Proper foreign key constraints
- Index proposals

Key entities:

```
merchant_branches          — One Merchant ID per branch
merchant_profiles          — Display data (logo, banner, gallery, about, hours, social)
merchant_applications      — Registration flow state
merchant_kyc               — Business cert + PIC ID + status
merchant_documents         — KYC file metadata (not binary)
merchant_status_history    — Status change audit
merchant_referrals         — Referrer relationship

service_fee_profiles       — Master package definitions (A-F 2.5%-25%)
service_fee_versions       — Versioned rate + effective period
merchant_package_assignments — Merchant-to-package mapping with status
special_percentages        — Admin-created custom rates

mcp_accounts               — Per-merchant MCP balance
mcp_ledger_entries         — Append-only MCP ledger
mcp_recharge_requests      — Recharge workflow
mcp_refund_requests        — Refund workflow (foundation)
mcp_adjustment_requests    — Maker/Checker adjustment workflow
mcp_adjustment_decisions   — Checker approval/rejection record
```

### 6. PHASE_1_SCHEMA_AND_MIGRATION_PLAN.md

Migration plan:

- Next migration ID: 0002 (after existing 0001)
- Migration ordering: Merchant base entities → Package entities → MCP entities
- Migration strategy (create table only; no data migration)
- Rollback strategy
- Checksum update plan
- Seed idempotency consideration

### 7. PHASE_1_API_AND_PERMISSION_MATRIX.md

Proposed API endpoints and their permission requirements:

- Merchant registration, KYC, profile, package management, MCP operations
- Admin merchant review/approval/suspend/close
- Admin MCP recharge/refund/adjustment review
- Permission naming convention per Admin PRD examples: `merchant.view`, `merchant.approve`, `merchant.package.assign`, `merchant.mcp.adjust`
- Market access scope for each endpoint
- Auth guard strategy (use existing Phase 0 guard framework)

### 8. PHASE_1_MCP_LEDGER_INVARIANTS.md

MCP ledger invariants:

- Append-only immutable ledger
- Exact numeric (PostgreSQL `numeric`), no floating point
- Idempotency key on every write
- Compensating entry for reversals (never delete/update)
- No negative balance (enforced at application layer)
- Current balance = SUM of all un-reversed ledger entries
- All entry types defined with direction (CREDIT/DEBIT)
- Maker/Checker for Manual Credit and Manual Debit
- Maker != Checker enforced
- No amount threshold exception per D-002 (C-03)
- Recharge via Payment Gateway with idempotent callback
- Administrative refund with review/approval flow
- Suspension preserves MCP balance

### 9. PHASE_1_ACCEPTANCE_PLAN.md

Test and acceptance plan:

- Unit test targets per domain module
- Integration test targets (database transactions, idempotency, state transitions)
- E2E scenarios (merchant registration → KYC → activation → MCP top-up)
- Acceptance criteria mapped from Admin PRD (AC-01 through AC-12) and Merchant PRD
- CI job strategy (new test jobs for merchant-domain, mcp-domain)

### 10. PHASE_1_DEFERRED_ITEMS.md

Items explicitly deferred from Phase 1:

- Member purchase transaction
- QR scan transaction
- Receipt engine (processing/confirmation)
- MCP sale deduction (transaction engine)
- iPoint reward
- Wallet engine
- Commission
- Redemption
- Advertising center
- Production payment integration
- Production payout
- Merchant Group UI (field reservation only)
- Merchant staff/sub-account permissions

## Domain Constraints (must follow)

### Merchant Group (Phase 1 minimal)

- `group_id` field reservation only
- Group is an association for reporting; no group-level permissions or shared MCP
- One branch = one Merchant ID
- Merchant Branch carries the Merchant ID (public identifier)

### Manual Recharge

- Merchant submits request
- Admin reviews and approves
- Approved → MCP credited via ledger entry
- General review ≠ Maker/Checker (recharge approval does not require dual approval)
- Maker/Checker only applies to Manual Credit/Debit adjustments

### Manual MCP Adjustment

- Credit AND Debit both require Maker/Checker
- Maker cannot be Checker
- No amount threshold exception

### Refund (Phase 1)

- Phase 1 does request/review/ledger foundation only
- No real bank or Payment Gateway refund execution
- Refund processing implemented as foundation; actual money movement deferred

### Storage

- File adapter pattern and metadata records
- No production cloud keys committed
- KYC files must be private (access-controlled)
- Implementation of actual storage provider deferred to Phase 1 implementation

### Phase 1 Exclusions

- No member purchase transaction
- No QR scan transaction
- No receipt engine
- No MCP sale deduction
- No iPoint reward
- No wallet engine
- No commission
- No redemption
- No advertising center
- No production payment integration
- No production payout

## Git Discipline

- Only planning documents under `docs/06-phase-reports/p1-s1/`
- No production code
- No schema migrations
- No API implementations
- Commit messages: `docs(p1-s1): <description>`
- Push to `task/p1-s1-baseline-domain-map`
- Do NOT push to main

## Completion Checklist

- [ ] All 10 documents created
- [ ] Documents committed to `task/p1-s1-baseline-domain-map`
- [ ] Branch pushed to remote
- [ ] Remote verified (SHA matches)
- [ ] Documents reviewed for business rule compliance
- [ ] No production code created
- [ ] No main branch modification
- [ ] No Phase 1 branch created

## Prohibited

- Do NOT modify any file outside `docs/06-phase-reports/p1-s1/`
- Do NOT create database migrations
- Do NOT implement API endpoints
- Do NOT create UI components
- Do NOT modify existing production code
- Do NOT create phase/1-\* branch
- Do NOT push to main
- Do NOT force push
