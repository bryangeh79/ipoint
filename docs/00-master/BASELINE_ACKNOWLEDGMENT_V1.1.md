# iPoint Baseline Acknowledgment V1.1 — Consolidated Authoritative Baseline

> **Status:** CONSOLIDATED AUTHORITATIVE BASELINE V1.1
> **Date:** 2026-07-16
> **Author:** OpenClaw (project general manager)
> **Approval:** ChatGPT Command Center — APPROVED AFTER V1.1 CORRECTION
> **Purpose:** Single self-contained baseline document. No external session history required.
> **Conflict rule:** This consolidated document replaces all prior baseline acknowledgment drafts. V1.1 Correction (10 items) has been directly integrated into the rules below — no separate appendix needed.

---

## 1. File Authority Order

When documents conflict, use this hierarchy (lower number wins):

| Rank | Source | Notes |
|---|---|---|
| 1 | Bryan's latest explicit written decision | Highest authority; overrides all documents |
| 2 | Latest ChatGPT Command Center Phase Brief, Correction Notice, or acceptance decision | Current execution authority |
| 3 | Latest approved **Admin PRD** | Platform backend baseline |
| 4 | Latest **Member PRD V1.1** (International Architecture Update) | Supersedes Member PRD V1.0 Baseline |
| 5 | Latest approved **Merchant PRD** | Merchant application baseline |
| 6 | **iPoint Product Design System** | UI/UX single source of truth |
| 7 | **Project Master Control** + **Engineering Starter Pack** | Governance and execution baseline |
| 8 | Member PRD V1.0 Baseline | Historical reference only; V1.1 wins on conflict |
| 9 | Approved commission mechanism document | Agent commission baseline |
| 10 | Complete App Flow + machine-readable flow specification | Process reference |
| 11 | Early business-planning drafts (e.g., ipoint.docx) | Business background only; not engineering authority |
| 12 | Screenshots and JPEG visual references | Visual reference only; must not infer design tokens |

**Conflict handling:** OpenClaw must never silently resolve a conflict. Record and escalate to ChatGPT. Newer approved documents override older versions of the same type.

---

## 2. Locked Items

### 2.1 Locked Product Rules

| # | Rule | Source |
|---|---|---|
| L-01 | One Account + Multi Market | Member PRD V1.1, PMC |
| L-02 | Account Country ≠ Current Market | Member PRD V1.1, PMC |
| L-03 | Market isolation: merchants, banners, wallets, redemption, ads follow Current Market | Member PRD V1.1 |
| L-04 | Cross-market consumption → iPoint credits consumption-market wallet | Member PRD V1.1 |
| L-05 | Single-market independent iPoint Wallet; no cross-market wallet transfer | Member PRD V1.1 |
| L-06 | Member universal QR with short-lived rotating signed security token (not permanent static QR). Merchant Receipt Dynamic QR is a separate scenario. | PMC, V1.1 C-02 |
| L-07 | One store/branch = one independent Merchant ID. Merchant Group is an upper-level association that does not replace the store's Merchant ID. V1 only reserves `group_id`; no Group UI. | V1.1 C-07 |
| L-08 | MCP precharge model + immutable ledger | Merchant PRD, Admin PRD |
| L-09 | Merchant can own multiple Service Fee Packages. Single active package hides selection; multiple active packages show selection at transaction time. | Merchant PRD, PMC |
| L-10 | Transaction Snapshot: save complete rule/package calculation snapshot at confirmation | PMC, DB-ERD |
| L-11 | Pending Receipt valid for 60 minutes. MVP locks this value as a centralized constant; not open to Admin UI adjustment in V1. | V1.1 C-04 |
| L-12 | Normal confirmed merchant transaction is not destructively cancellable. Only governed reversal via compensating entries. | Merchant PRD, PMC |
| L-13 | Daily iPoint distribution at each market's local 00:00 boundary (IANA timezone) | Admin PRD, PMC |
| L-14 | Append-only ledgers: MCP, iPoint, Commission. No physical deletion. Reversals use compensating entries. | Admin PRD, DB-ERD |
| L-15 | Admin Role + Market Access + Action Permission (three-dimensional permission model) | Admin PRD, PMC |
| L-16 | Maker/Checker: ALL manual MCP/iPoint Credit and Debit require dual approval. No amount threshold exception exists. Maker and Checker must not be the same person. | Admin PRD, V1.1 C-03 |
| L-17 | UI/UX follows official Product Design System. Screenshots are visual reference only — must not sample colors/spacing/typography from images. | PMC, Design System |
| L-18 | Registration: Email + OTP + Password. Forgot password via Email OTP. | Member PRD V1.0 |
| L-19 | KYC Level 1 (Email verified). Level 2 (Full Name + Phone + Address) required before redemption and agent upgrade. | Member PRD V1.0 |
| L-20 | Referral relationship is permanent. | Member PRD V1.0 |
| L-21 | Member bottom navigation fixed: Home, Merchants, Wallet, Team, Profile | Member PRD V1.0, Design System |
| L-22 | Merchant Login Email is immutable; cannot be modified | Merchant PRD V1.0 |
| L-23 | No guest mode. Registration required before system entry. | Member PRD V1.0 |
| L-24 | Terms/Privacy Policy/Disclaimer acceptance recorded with version number | Member PRD V1.0 |
| L-25 | Redemption Refund only returns wallet points. Original Reward Plan cap and progress are NOT modified, reopened, or recalculated. | V1.1 C-05 |
| L-26 | Merchants may set minimum KYC condition (100 MCP) for activation. After activation, MCP may fall below 100. | Merchant PRD V1.0 |
| L-27 | Merchant can pause/resume their own Service Fee Profiles. Cannot pause the last active profile. | Merchant PRD V1.0 |

### 2.2 Locked Engineering Principles

| # | Principle | Source |
|---|---|---|
| E-01 | V1 uses Modular Monolith with explicit domain boundaries for future microservice extraction | Admin PRD, PMC |
| E-02 | PostgreSQL is the single source of truth | PMC |
| E-03 | Redis only for cache, distributed locks, OTP, rate limiting, job coordination. Never sole source of truth for balances or transaction state. | PMC |
| E-04 | Exact decimal arithmetic for amounts, percentages, points, commissions. No floating point. | PMC, DB-ERD |
| E-05 | Atomic transaction confirmation creating/receipt/package snapshot/MCP debit/reward entitlement/commission entitlement/audit/outbox in one transaction | PMC |
| E-06 | Idempotency keys for critical writes: transaction confirmation, payment callbacks, manual adjustment execution, reward settlement, redemption confirmation, commission posting, webhook processing | PMC, API Spec |
| E-07 | UTC storage for all timestamps. Market-local processing uses IANA timezone. | PMC, DB-ERD |
| E-08 | Public identifiers (Member ID, Merchant ID, Transaction ID, Receipt ID) separated from internal UUIDs | PMC, DB-ERD |
| E-09 | Versioned database migrations. Forward-tested. Rollback strategy documented. | PMC, DB-ERD |
| E-10 | Ledger, transaction, approval, and audit records never physically deleted | PMC, DB-ERD |
| E-11 | Server-side authorization on every protected action. Never trust client-market identifier without server-side validation. | PMC, API Spec |
| E-12 | Complete privileged-action audit: who, when, where, what object, what action, before/after values, reason, result | PMC |
| E-13 | Secrets outside Git. `.env.example` with names/descriptions only. | PMC |
| E-14 | All market-scoped business records must carry `market_id`. Global identity entities (Account, Admin User) excluded. | V1.1 C-06 |
| E-15 | Monetary amounts: Currency Code + high-precision Decimal. Percentages: high-precision Decimal with explicit unit. | Admin PRD, DB-ERD |
| E-16 | Rule records: Version + Effective From/To + Scope + Status + Audit | Admin PRD |
| E-17 | Soft delete via `archived_at` / `status` on applicable entities | Admin PRD |
| E-18 | RDBMS (ORM/Schema/Migration tool) to be approved by ChatGPT during Phase 0 technical decision | V1.1 C-09 |
| E-19 | Admin only Web + PWA. No native iOS/Android Admin app. | Admin PRD D-01 |
| E-20 | Admin UI uses unified Design System: white background, green primary, dark text, rounded cards, responsive layout | Admin PRD D-02 |
| E-21 | Admin permissions simplified: Role + Market Access + Action Permission only. No complex department hierarchy. | Admin PRD D-03 |
| E-22 | Dual approval (Maker/Checker) ONLY for manual MCP and iPoint adjustments. No other operations require it. | Admin PRD D-05 |
| E-23 | Referral relationship modification: no Maker/Checker required, but Super Admin only, with reason and audit log | Admin PRD D-06 |
| E-24 | iPoint reward rate is floating type. Read at time of daily 00:00 distribution. | Admin PRD D-07 |
| E-25 | Rule adjustments affect only future, unissued rewards. Already distributed rewards never recalculated. | Admin PRD D-08 |
| E-26 | Redemption rate locked at order submission time. Subsequent rule changes do not affect submitted orders. | Admin PRD D-09 |
| E-27 | Merchant service fee percentage locked at transaction time. No retroactive recalculation. | Admin PRD D-11 |
| E-28 | Commission rules locked at original business event time. No retroactive recalculation. | Admin PRD D-13 |
| E-29 | All dynamic commercial rules: versioned + effective time + market scope + scope + audit | Admin PRD D-14 |
| E-30 | Used rules, ledger, and transaction records: disable/expire/reverse/archive only. No physical delete. | Admin PRD D-15 |

---

## 3. Configurable Items

All items below must use versioned rule tables with market scope, effective time range, status, audit history, and historical calculation locking. Values must not be hard-coded.

| # | Item | Reference Value (MVP) | Configurability |
|---|---|---|---|
| C-01 | Merchant standard service-fee percentages (A-F) | 2.5% / 5% / 10% / 15% / 20% / 25% | Per-package adjustable via Admin |
| C-02 | Merchant special percentages | e.g., 8%, 12% | Admin can create custom percentages |
| C-03 | Daily reward percentages (by package) | Up to 0.05%/day (C-F packages) | Floating rate; read at 00:00 distribution |
| C-04 | Redemption rates | 1 iPoint ≈ RM1 (provisional reference) | Per-market configurable |
| C-05 | Agent fee | RM388 (Malaysia baseline) | Per-market configurable |
| C-06 | Member consumption commission: Gen 1 | 1% of company-received service fee | Per-market/level configurable |
| C-07 | Member consumption commission: Gen 2 | 0.5% of company-received service fee | Per-market/level configurable |
| C-08 | Merchant referral commission | 0.5% of company-received service fee, one generation | Configurable |
| C-09 | Agent-upgrade commission: Gen 1 | RM88 | Per-market configurable |
| C-10 | Agent-upgrade commission: Gen 2 | RM38 | Per-market configurable |
| C-11 | Advertisement MCP fees | TBD | Backend configurable |
| C-12 | KYC requirements | L1: Email / L2: Name+Phone+Address | Per-market configurable conditions |
| C-13 | Risk limits and thresholds | TBD | Backend configurable |
| C-14 | Data retention policy | Per-market legal requirement | Per-market configurable |
| C-15 | Reward rate min/max and decimal precision | Not yet defined | Configurable validation rules (see OPEN O-06) |

---

## 4. Deferred Items (Not for MVP)

Engineering may design extensibility boundaries (interfaces, enum values, Feature Flag placeholders). Must NOT implement production functionality.

| # | Item | Source | Reason |
|---|---|---|---|
| D-01 | Cross-market wallet transfer | Member PRD V1.1, PMC | Explicitly excluded |
| D-02 | Automatic cash withdrawal | PMC, Roadmap | Risk and compliance not ready |
| D-03 | Cross-border settlement | PMC, Roadmap | High regulation |
| D-04 | Licensed e-wallet functionality | PMC, Admin PRD | Requires financial license |
| D-05 | Consumer lending / microloans | Admin PRD, Roadmap | High regulation |
| D-06 | IPO subscription execution | Admin PRD, Roadmap | Securities/financial operations |
| D-07 | Five-level team performance rewards (differential model) | PMC, Roadmap | Business rules not finalized |
| D-08 | Advertisement bidding (Ad Bidding) | Admin PRD, Roadmap | V1 only basic placement |
| D-09 | AI risk decision engine | Admin PRD, Roadmap | V1 uses rule-based risk flags |
| D-10 | Advanced recommendation engine | Roadmap | V1 not implementing |
| D-11 | SMS notification channel | Admin PRD | Reserved; V1 uses Email/Push/In-App |
| D-12 | Merchant Group/chain reporting | Merchant PRD V1.0 | Only reserved group_id field |
| D-13 | Complex redemption marketplace | Admin PRD | V1 has basic catalog |
| D-14 | Dynamic Member QR | Member PRD V1.1 | V1 uses unified QR with secure token only |

---

## 5. Open Items (Pending Decision)

See detailed tracking in `OPEN_QUESTIONS.md`. Summary:

| # | Item | Blocks Phase |
|---|---|---|
| O-01 | Merchant Group activation rules and timeline | No (field reservation only) |
| O-02 | Agent course system verification method | Medium (Phase 6) |
| O-03 | Advertisement MCP fee pricing model | No |
| O-04 | Merchant staff / sub-account permissions (moved from LOCKED per V1.1 C-08) | No (data reservation only) |
| O-05 | Agent fees by market (amounts and currency) | No (CONFIGURABLE) |
| O-06 | Reward rate min/max and decimal precision | No (CONFIGURABLE) |
| O-07 | Special merchant service fee range and authorization conditions | No (CONFIGURABLE) |
| O-08 | Market-specific KYC / data retention / legal compliance | No (build minimum baseline) |
| O-09 | PWA admin approval operation scope | No |
| O-10 | Long-term inactive member/agent handling | No |

---

## 6. Roles and Permissions

| Role | Persona | Responsibility |
|---|---|---|
| **Bryan** | Final business decision owner | Approves commercial rules, product scope, major delivery priorities |
| **ChatGPT Command Center** | Product commander & architecture authority | Defines Big Phases, approves architecture, reviews evidence, issues APPROVED / CHANGES REQUIRED / REJECTED / READY FOR NEXT PHASE |
| **OpenClaw** | Project general manager | **Does not write code.** Decomposes phases, dispatches Codex CLI, prevents conflicts, collects evidence, reports to ChatGPT |
| **Codex CLI workers** | Engineering executors | Writes code, tests, migrations, technical evidence within assigned scope. Must read AGENTS.md + CODEX_WORKFLOW_RULES.md + Phase Brief before implementation |

**OpenClaw may not:** write code, change LOCKED rules, invent features, redesign UI, change tech stack, bypass tests, approve its own Big Phase, merge to `main`, hard-code CONFIGURABLE values, implement DEFERRED modules, invent OPEN behavior.

**Codex CLI may not:** expand scope, reinterpret LOCKED rules, hard-code CONFIGURABLE values, push directly to `main`.

---

## 7. Big Phase Execution Flow

### 7.1 Lifecycle

```
ChatGPT issues Big Phase Brief
       ↓
OpenClaw proposes Small Phase breakdown + dependency graph + file ownership + migration order
       ↓
ChatGPT approves or corrects breakdown
       ↓
OpenClaw dispatches Codex CLI workers to isolated task branches
       ↓
Codex workers implement, test, commit
       ↓
OpenClaw verifies completeness, produces consolidated report
       ↓
ChatGPT reviews logic, architecture, code, UI/UX, tests, Git history, risks
       ↓
Rework until ChatGPT issues a final decision
```

### 7.2 Phase Order (Corrected per V1.1 C-01)

| Phase | Scope |
|---|---|
| **Phase 0** | General ledger technical skeleton, DB foundation, Auth framework, RBAC, Market module, Audit infrastructure, Design System tokens, ORM/Schema tool approval |
| **Phase 1** | Merchant Onboarding + MCP Ledger |
| **Phase 2** | Member Core (Profile, KYC, QR, merchant discovery, wallet shell, referral) |
| **Phase 3** | iPoint Wallet Ledger + Reward Plan + 00:00 Daily Job |
| **Phase 4** | Transaction Engine |
| **Phase 5** | Agent & Commission Engine |
| **Phase 6** | Redemption Center |
| **Phase 7** | Admin Operations |
| **Phase 8** | Advertising & Content |
| **Phase 9** | Reporting, Risk & Audit |
| **Phase 10** | Full Integration & E2E |
| **Phase 11** | Security, Performance & Production Readiness |

MCP Ledger (Phase 1) and iPoint Ledger (Phase 3) are independent and not coupled. Commission Ledger follows Phase 5.

### 7.3 Definition of Done (every Small Phase)

All applicable: Scope implemented / Formatting passes / Lint passes / Type check passes / Build passes / Unit tests pass / Integration tests pass / E2E evidence / Migration forward-tested + rollback documented / Security and permission checks covered / UI states (loading/empty/error/success/disabled/expired/suspended/permission-denied/offline/retry) covered / Git commit with conventional message / OpenClaw report complete / ChatGPT approves.

### 7.4 Parallel Work Conflict Prevention

- Only one Codex worker touches database schema per Small Phase
- Migration IDs centrally assigned by OpenClaw
- Ledger Service framework completed in Phase 0; subsequent phases extend Entry Type only
- Market module completed first in Phase 0; subsequent phases read-only reference
- Transaction backend (Phase 4) completed before frontend UI assignment
- Design Tokens defined once as shared package; all frontend workers reference same source

### 7.5 Completion States (ChatGPT only)

`APPROVED` / `CHANGES REQUIRED` / `REJECTED` / `READY FOR NEXT PHASE`. OpenClaw may not declare a Phase complete.

---

## 8. Core System Understanding

### 8.1 One Account + Multi Market

One Member account operates across multiple markets. Each market has independent merchants, banners, wallets, redemption centers, reward rules. What does NOT change with Current Market: Login, Profile, iPoint ID, Referral relationships, Account Country.

### 8.2 Account Country vs Current Market

| Concept | Definition | Mutability |
|---|---|---|
| **Account Country** | Registered jurisdiction at signup | Not self-modifiable. Can apply for Admin change (suggested: once per year). |
| **Current Market** | Member's current browsing/operating context | Freely switchable from enabled market list |

Switching Current Market refreshes: Merchants, Banners, Wallet view, Redemption, Ads. Does NOT affect: Login, Profile, Identity.

### 8.3 Market-Specific Wallets

One member: N wallets for N markets. Wallet balances must NOT be merged globally. Each wallet has independent immutable ledger. Wallet snapshot update and ledger append in same DB transaction. No cross-market transfer (DEFERRED).

Cross-market consumption example: Malaysia member spending in Vietnam earns iPoint in the **Vietnam market wallet**. Determined by merchant's market, not member's Account Country or Current Market.

### 8.4 MCP (Merchant Credit Point)

- Merchant prepaid credit: 1 MCP = RM1 (top-up ratio)
- Transaction: deducts MCP = gross sale × service fee %
- Insufficient MCP → transaction rejected, Top-up CTA shown
- MCP Ledger: append-only immutable
- Manual MCP adjustment: requires Maker/Checker dual approval (no threshold exception)
- Suspended merchant: MCP preserved. Reactivate → MCP available again.
- Closed merchant: can apply for MCP refund (Admin review required)

### 8.5 Merchant Package (Service Fee Profiles)

Six standard packages: A=2.5% / B=5% / C=10% / D=15% / E=20% / F=25%. Admin may create special percentages (e.g., 8%, 12%). Single active package → transaction page hides selection. Multiple active packages → transaction page shows dropdown. Transaction locks package version + percentage. Retroactive adjustment prohibited.

### 8.6 Receipt and 60-Minute Window

POS/Bridge generates Pending Receipt → member scans within 60 minutes → Completed. >60 minutes → Expired. Unique constraint prevents duplicate binding. 60 minutes is MVP-locked as a centralized constant (not Admin-adjustable in V1).

### 8.7 Transaction Snapshot

Every confirmed transaction saves immutable snapshot:
```
Transaction ID + Receipt ID
Merchant/Branch + Consumption Market + Member
Gross Amount + Currency
Package Version + Service Fee % + Amount
MCP Debit Amount
Reward Rule Version + Calculation Inputs
Commission Rule Version + Calculation Inputs
Confirmation Time
```

### 8.8 Daily 00:00 iPoint Distribution

- Triggered per market local time (IANA timezone)
- Reads effective reward rule version at distribution time
- Creates Reward Entitlement → daily settlement job → writes iPoint Ledger
- Idempotent (same market/date cannot run twice)
- Single item failure does not roll back entire batch
- Retriable (idempotent, no duplicate credits)
- Admin panel: view job runs, success/failure counts, error details
- Super Admin: emergency pause available

### 8.9 Append-Only Ledgers

| Ledger | Usage | Entry Types |
|---|---|---|
| **MCP Ledger** | Merchant MCP changes | Recharge / Transaction Deduction / Advertising / Manual Credit-Debit / Refund / Freeze-Unfreeze / Reversal |
| **iPoint Ledger** | Member point changes | Daily Reward / Redemption Debit / Redemption Refund / Manual Credit-Debit / Reversal / Freeze-Unfreeze |
| **Commission Ledger** | Commission changes | Entitlement / Qualification / Payment / Cancel / Freeze |

Every ledger entry: Internal ID / Wallet-Account ID / Market ID / Direction / Amount / Entry Type / Source Entity / Idempotency Key / Rule Version / Effective Timestamp / Actor / Approval ID / Reversal-of ID / Metadata.

### 8.10 Agent and Three Commission Types

| Commission Type | Generations | Basis | Value (Malaysia baseline) |
|---|---|---|---|
| Member Consumption | Gen 1 / Gen 2 | Company-received service fee | 1% / 0.5% |
| Merchant Referral | One generation only | Company-received service fee | 0.5% |
| Agent Upgrade Fee | Gen 1 / Gen 2 | Fixed amount | RM88 / RM38 |

Agent activation chain: Level 2 KYC → Pay agent fee (RM388, CONFIGURABLE) → Complete company course → Admin/system validation → Activate Agent status.

Commission states: Pending → Qualified → Paid / Cancelled / Frozen. Five-level team performance rewards = DEFERRED.

### 8.11 Admin Permission Model

Three dimensions:
1. **Role**: Super Admin / Admin / Finance / Customer Service / Viewer
2. **Market Access**: Which markets visible/operable
3. **Action Permission**: `member.view`, `merchant.approve`, `wallet.adjust`, etc.

Suggested base roles:
- **Super Admin**: all permissions, limited count, mandatory 2FA
- **Admin**: daily operations, no unauthorized financial adjustments
- **Finance**: MCP/refund/commission/reconciliation/export, no system settings by default
- **Customer Service**: query/tickets/notes, cannot modify assets
- **Viewer**: read-only

Maker/Checker dual approval: ONLY for manual MCP/iPoint Credit and Debit. No other operation requires it. No threshold exception.

### 8.12 Redemption

Member selects Current Market wallet → browse market catalog → submit order. Order locks: redemption rate, required iPoint amount, rule version. Subsequent rate changes do NOT affect submitted orders.

Order states: Pending → Approved → Processing → Shipped → Completed / Rejected / Cancelled / Refunded.

Rejection/cancellation refund: returns wallet points via iPoint Ledger compensating entry. Original Reward Plan cap and progress are NOT modified, reopened, or recalculated (V1.1 C-05).

### 8.13 Product Design System

- **Primary color:** Green (`#20B366`), **Secondary:** Gold, white backgrounds, neutral grays, semantic success/warning/error/info
- **Typography:** Inter (Latin), Noto Sans SC/TC (Chinese), Noto Sans (VN/SEA). H1/H2/H3/Body/Caption.
- **Spacing:** 8pt system. **Radius:** 12-20px. **Icons:** Lucide or Material Outlined.
- **Buttons:** Primary Green / Secondary Outline / Danger Red / Disabled Gray
- **Member navigation:** Bottom: Home / Merchants / Wallet / Team / Profile
- **Core UX:** QR within 2 taps / Simplicity over decoration / Mobile-first / Information hierarchy first
- **Required states per screen:** Loading / Empty / Error / Success / Disabled / Expired / Suspended / Permission Denied / Offline / Retry
- **Governance:** All UI changes require Design System review. Screenshots are visual reference only — Codex workers must NOT sample colors, spacing, or typography from images.

---

## 9. Current Project Status

| Item | Status |
|---|---|
| **Baseline Acknowledgment** | ✅ APPROVED AFTER V1.1 CORRECTION |
| **PR #2** (docs: iPoint engineering starter pack) | 🔄 UNDER REVIEW |
| **Current Authorized Phase** | ❌ NONE |
| **Phase 0** | ❌ NOT_AUTHORIZED |
| **Phase 1** | ❌ NOT_AUTHORIZED |

### Currently Allowed
- Read and analyze project documentation
- Update governance files
- Prepare Phase breakdown proposals for ChatGPT review
- Escalate conflicts and open questions

### Currently Prohibited
- Start Phase 0, assign Codex CLI to production code, merge PR #2
- Delete/clean/stash/batch-add untracked files
- Change LOCKED rules, hard-code CONFIGURABLE values
- Implement DEFERRED modules, invent OPEN behavior
- Announce Phase completion without ChatGPT approval

---

## 10. Reporting Rules and Templates

### OpenClaw Execution Report Template

```markdown
# iPoint Phase Execution Report
## Phase Information
- Big Phase: <name> | Small Phase: <id> | Assigned CLI: <worker>
- Branch: <task-branch> | Status: Ready for Review / Needs Rework / Blocked

## Completed Scope
<summary>

## Git Commits
- SHA: <full> | Message: <conventional> | Files changed: <list>

## Test Results
- Format/Lint/TypeCheck/Build: pass/fail
- Unit: X/Y | Integration: X/Y | E2E: pass/fail (evidence)

## UI/UX Verification
- Design System: ✅/❌ | Desktop/Mobile evidence: <screenshot> | Deviations: <list>

## Database and API Changes
<new tables, fields, endpoints, migration numbers>

## Security and Permissions
<authorization impact>

## Risks and Issues
<known risks>

## Outstanding Work
<remaining items>

## Recommended Next Action
Ready for review / Needs rework / Blocked
```

### Communication Rules

- All reports and escalation to ChatGPT Command Center
- Do not depend on session history — GitHub is the only persistent memory
- Do not silently resolve document conflicts
- Do not deliver incomplete evidence (missing tests = incomplete)

---

*End of Consolidated Authoritative Baseline V1.1. This document is self-contained and does not require external session history for interpretation.*
