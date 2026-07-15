# iPoint Baseline Acknowledgment V1.1

> Date: 2026-07-16
> Author: OpenClaw (project general manager)
> Status: APPROVED AFTER V1.1 CORRECTION
> Conflict rule: Where this document conflicts with the pre-V1.1 Baseline Acknowledgment, **V1.1 Correction content wins**.

---

## Part A: Original Baseline Acknowledgment (abridged)

*This section contains the agreed baseline understanding of iPoint. Full original text is retained in OpenClaw session history. The authoritative summary below captures all LOCKED, CONFIGURABLE, DEFERRED, and OPEN items.*

### LOCKED product rules

- One Account + Multi Market
- Account Country ≠ Current Market
- Market isolation: merchants, banners, wallets, redemption, ads follow Current Market
- Cross-market consumption → iPoint credits consumption-market wallet
- Single-market independent iPoint Wallet; no cross-market transfer
- Member universal QR (short-lived secure token, not permanent static QR)
- Merchant public ID per branch
- MCP precharge model + immutable ledger
- Merchant can own multiple packages; single-package hides selection, multi-package shows selection at transaction time
- Transaction Snapshot: save complete rule/package calculation snapshot
- Pending Receipt valid for 60 minutes (MVP locked, technically centralized constant)
- Normal confirmed merchant transaction not destructively cancellable (governed reversal only)
- Daily iPoint distribution at market-local 00:00
- Append-only ledgers: MCP, iPoint, Commission
- Admin Role + Market Access + Action Permission
- Maker/Checker: ALL manual MCP/iPoint Credit/Debit require dual approval. No amount threshold exception.
- UI/UX follows official Product Design System
- Registration: Email + OTP + Password
- KYC Level 1 (Email) → Level 2 (Name+Phone+Address) required before redemption and agent upgrade
- Referral relationship is permanent
- Member bottom navigation: Home, Merchants, Wallet, Team, Profile
- Merchant Login Email is immutable

### LOCKED engineering principles

- V1 uses Modular Monolith
- PostgreSQL is source of truth
- Redis only for cache/lock/queue
- Exact decimal arithmetic; no floating point
- Atomic transaction confirmation
- Idempotency keys for critical writes and jobs
- UTC storage + IANA market timezone processing
- Public identifiers separated from internal keys
- Versioned database migrations
- Ledger/transaction/approval/audit records never physically deleted
- Server-side authorization on every protected action
- Complete privileged-action audit
- Secrets outside Git
- All market-scoped business records must carry `market_id`; global identity entities (Account, Admin User) excluded
- Modular Monolith with explicit domain boundaries for future microservice extraction
- Monetary amounts: Currency Code + high-precision Decimal
- Percentages: high-precision Decimal with explicit unit
- Rule records: Version + Effective From/To + Scope + Status + Audit
- Soft delete via `archived_at` / `status`
- Timeline and Audit indexed by entity type + entity ID
- ORM/Schema/Migration tools: to be approved by ChatGPT Command Center during Phase 0 technical decision

### CONFIGURABLE items

| Item | Reference value (MVP) | Notes |
|---|---|---|
| Merchant service-fee percentages (A-F) | 2.5% / 5% / 10% / 15% / 20% / 25% | Standard packages adjustable |
| Merchant special percentages | e.g., 8%, 12% | System must support custom percentages |
| Daily reward percentages | Up to 0.05%/day (C-F packages) | Floating rate, read at 00:00 distribution |
| Redemption rates | 1 iPoint ≈ RM1 (provisional) | Per-market configurable |
| Agent fee | RM388 (Malaysia baseline) | Per-market configurable |
| Member consumption commission | Gen 1: 1%, Gen 2: 0.5% | Per-market/level configurable |
| Merchant referral commission | 0.5% (one generation only) | Configurable |
| Agent-upgrade commission | RM88 / RM38 | Per-market configurable |
| Advertisement MCP fees | TBD | Backend configurable |
| KYC requirements | L1: Email / L2: Name+Phone+Address | Per-market configurable |
| Risk limits and thresholds | TBD | Backend configurable |
| Data retention policy | Per-market legal requirement | Per-market configurable |

### DEFERRED items (not for MVP)

Cross-market wallet transfer / Auto cash withdrawal / Cross-border settlement / Licensed e-wallet / Consumer lending / IPO subscription / Five-level team performance rewards (differential model) / Advertisement bidding / AI risk decision engine / Advanced recommendation engine / SMS notification channel / Merchant Group/chain reporting / Complex redemption marketplace / Dynamic Member QR (MVP uses unified QR with secure token only)

### OPEN items (see `OPEN_QUESTIONS.md` for current state)

Originally 12 items; after V1.1 Correction: 10 items remain open. See the dedicated `OPEN_QUESTIONS.md` file for current status.

---

## Part B: V1.1 Correction

*This appendix contains binding corrections to the original Baseline Acknowledgment. Where any inconsistency exists, the V1.1 Correction below governs.*

### C-01 Phase order correction

**Deleted:** "Ledger/Wallet infrastructure must be completed in Phase 1"
**Corrected Phase sequence:**

| Phase | Scope |
|---|---|
| **Phase 0** | General ledger technical skeleton, DB foundation, Auth framework, RBAC, Market module, Audit infrastructure, Design System tokens |
| **Phase 1** | **Merchant Onboarding + MCP Ledger** |
| **Phase 3** | **iPoint Wallet Ledger + Reward Plan + 00:00 Job** |

MCP Ledger (Phase 1) and iPoint Ledger (Phase 3) are not coupled. Commission Ledger follows Phase 6.

### C-02 Member QR correction

- **User experience:** one unified Member QR for all scenarios (merchant scan, referral, identity)
- **Security implementation:** short-lived / rotating / signed token, not a permanent static image. Token issued by backend, periodically refreshed, admin-forced rotation supported.
- **MVP scope:** no dynamic QR (member generates different QR for different purposes), but the QR token itself is dynamically secured.
- **Merchant Receipt Dynamic QR** (60-minute recovery flow) is a separate scenario with its own security mechanism.

### C-03 Maker/Checker correction

- **Removed from OPEN** (was O-04)
- **Confirmed:** ALL manual MCP/iPoint Credit/Debit require Maker/Checker dual approval. No amount threshold exception exists.

### C-04 Receipt 60 minutes correction

- **Removed from OPEN** (was O-10)
- **Confirmed:** MVP locks 60 minutes. Technically managed as a centralized constant. Admin UI adjustment not available in V1.

### C-05 Redemption refund correction

- **Removed from OPEN** (was O-12)
- **Confirmed:** Redemption refund only returns wallet points. Original Reward Plan cap and progress are NOT modified, reopened, or recalculated.

### C-06 market_id correction

**Corrected rule:** All **market-scoped** business records must carry `market_id`. Global identity entities (Account, Admin User) are excluded.

### C-07 Merchant ID correction

**Corrected rule:** One physical store/branch = one independent Merchant ID. Merchant Group is an upper-level association concept that does not replace the store's Merchant ID. V1 only reserves the `group_id` field without implementing Group management UI.

### C-08 Merchant staff correction

- **Moved from LOCKED to OPEN:** "Merchant app does not develop team/sub-account permissions" is temporarily removed from LOCKED and recorded as an unresolved document conflict.
- **Engineering constraint:** Only data boundary reservation allowed (e.g., `merchant_staff` table structure, permission enum reservation). No Staff UI implementation.
- See `OPEN_QUESTIONS.md` (O-04 revised).

### C-09 ORM neutrality correction

- Removed all references to Prisma as a preset technology.
- All occurrences of "Prisma Schema" → "database schema definition", "Prisma migration" → "versioned database migration".
- ORM/Schema/Migration tool to be approved by ChatGPT Command Center during Phase 0 technical decision.

### C-10 Git status correction

- A working directory with untracked files must NOT be described as "clean".
- Correct reporting: report tracked modifications and untracked file count/categories separately.
- Untracked files: not deleted, not cleaned, not stashed, not batch-added.

### Correction authority

- This V1.1 Correction is approved by ChatGPT Command Center.
- All 10 corrections are binding.
- Any future session that finds a discrepancy between the Original Baseline Acknowledgment and this Correction must follow this Correction.
