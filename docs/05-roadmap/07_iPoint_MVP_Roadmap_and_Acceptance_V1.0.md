# iPoint MVP Roadmap and Acceptance V1.0

## 1. MVP objective

Prove the complete operational loop:

> Approved merchant transaction -> MCP is deducted correctly -> Member receives market-specific iPoint reward according to the locked rule version -> Admin can trace, review, reconcile, and operate the entire flow.

The MVP must establish reliable foundations for Member, Merchant, and Admin applications without activating high-regulation future financial products.

## 2. Recommended Big Phases

### Phase 0 — Engineering Foundation

- Confirm actual technology stack and repository structure
- Create root `AGENTS.md`
- Establish formatting, lint, type check, tests, build, CI, environment validation, migration framework, logging, and local development commands
- Establish Design System tokens and shared component strategy
- Establish branch, commit, report, and Definition of Done rules
- Produce initial architecture decision records

### Phase 1 — Identity, Auth, Roles, and Multi-Market Foundation

- Registration, login, reset, email verification, consent
- Account, Member, Merchant, Admin role model
- Account Country and Current Market
- Market configuration, locale, currency, timezone
- Admin role, market access, and action permission foundation

### Phase 2 — Member Core

- Member profile and public ID
- KYC Level 1/2 framework
- Universal QR
- Merchant discovery, details, and maps link
- Market wallet shell and ledger history UI
- Referral code and team foundation

### Phase 3 — Merchant Core and MCP

- Merchant onboarding, profile, KYC, media, branch ID
- Package assignments and multi-package selection eligibility
- MCP wallet/ledger, calculator, top-up requests, status controls
- Admin merchant review and MCP operations

### Phase 4 — Transaction Engine

- Transaction draft and 60-minute receipt
- Member QR scan
- Package selection
- Authoritative service-fee calculation
- Atomic confirmation and MCP debit
- Transaction/receipt search and history
- Duplicate prevention and audit

### Phase 5 — iPoint Reward Engine

- Reward-rule versioning
- Reward entitlement creation
- Market-local 00:00 settlement
- iPoint ledger and wallet snapshot
- Batch monitoring, retry, reconciliation, and Admin controls

### Phase 6 — Agent and Commission Engine

- Referral relationships
- Agent activation workflow
- Course, KYC, and payment condition tracking
- First/second generation consumption commission
- One-generation merchant referral commission
- First/second generation agent-upgrade fee commission
- Commission status and Admin review

The five-level team performance reward remains deferred until final business approval.

### Phase 7 — Redemption Center

- Market catalog and configurable redemption rate
- KYC and balance eligibility
- Redemption order and iPoint debit/hold
- Fulfillment statuses and compensating refund entries

### Phase 8 — Admin Operations

- Complete operational dashboards and search
- Rule version management
- Maker/Checker manual MCP and iPoint adjustment
- Risk cases, audit, reports, export controls
- Settlement and reconciliation operations

### Phase 9 — Advertising and Content

- Merchant advertisement submission using MCP
- Market targeting
- Admin review, scheduling, approval, and debit
- Member banners and content delivery

### Phase 10 — Reporting, Risk, and Audit

- Financial-like reconciliation reports
- Operational reports
- Risk flags and case workflow
- Audit completeness and privileged-action reporting

### Phase 11 — Full Integration and E2E

- End-to-end Member, Merchant, and Admin journeys
- Cross-market scenarios
- Failure and recovery scenarios
- UI consistency review
- Regression suite

### Phase 12 — Security, Performance, and Production Readiness

- Security hardening
- Performance/load testing
- Backup restore rehearsal
- Migration rehearsal
- Monitoring and incident runbooks
- UAT and release readiness

## 3. MVP locked scope

- One Account + Multi Market
- Member, Merchant, Admin surfaces
- Merchant service-fee packages and approved special rates
- MCP precharge wallet and ledger
- Merchant/member QR transaction
- Immutable confirmed transaction snapshot
- Market-specific iPoint wallet and daily settlement
- Basic approved commission mechanisms
- Redemption Center baseline
- Admin review, configuration, audit, and Maker/Checker controls
- Official Product Design System compliance

## 4. Configurable values

The system must support controlled configuration and versioning for:

- Merchant service-fee percentages
- Special merchant percentages
- Daily reward percentages
- Redemption rates
- Agent fee by market
- Commission percentages and fixed amounts
- Advertisement MCP fees
- Limits, status policies, and KYC conditions

Current examples such as RM388 or 1 iPoint = RM1 must not become universal hard-coded assumptions.

## 5. Deferred scope

Do not implement without a new explicit decision:

- Cross-market wallet transfer
- Automatic cash withdrawal
- Cross-border settlement
- Licensed e-wallet functionality
- Consumer lending
- IPO subscription execution
- Final five-level team performance rewards
- Advertisement bidding
- AI-based risk decisioning
- Advanced recommendation engine

## 6. Big Phase acceptance gate

A Big Phase is accepted only when:

- Approved scope is complete
- Product rules match the authoritative documents
- Architecture boundaries are respected
- Applicable tests pass
- UI complies with the Design System
- Security and authorization are verified
- Migrations and recovery are documented
- All work has traceable commits
- OpenClaw submits a consolidated report
- ChatGPT Command Center issues approval

## 7. Critical MVP E2E acceptance scenario

1. Admin creates/enables a market and effective package/reward rules.
2. Merchant completes onboarding and approval.
3. Merchant receives an active package and sufficient MCP.
4. Member registers, verifies email, and has a universal QR.
5. Merchant enters a sale, selects a package if applicable, scans the member QR, and confirms.
6. The system creates unique Transaction ID and Receipt ID and atomically deducts the correct MCP amount.
7. The reward entitlement is created under the consumption market with the correct rule version.
8. At market-local 00:00, the member receives the correct iPoint ledger credit exactly once.
9. Admin can trace the transaction, calculation snapshot, MCP entry, reward entitlement, settlement entry, actor, rule version, and audit events.
10. Reconciliation reproduces the wallet balances from ledger entries.

Failure of any step blocks MVP acceptance.
