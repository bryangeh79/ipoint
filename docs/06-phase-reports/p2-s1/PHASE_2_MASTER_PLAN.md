---
title: Phase 2 Master Plan
phase: P2-S1
status: freeze
implementation_authorized: false
date: 2026-07-17
---

# Phase 2 Master Plan

## 1. Purpose

Phase 2 defines the Member Core architecture and contract freeze for a single account, multi-market member platform.

This phase is documentation only. It freezes the product direction, domain boundaries, API contracts, state machines, and test strategy before any implementation work is authorized.

## 2. Phase 2 scope

### In scope

- Member registration
- Email OTP Level 1
- Login, refresh token, logout
- Password reset
- One account per member
- Account Country captured at registration and changed only through admin review
- Current Market switch among enabled markets
- Member ID
- Unique referral code
- Single direct referrer with no self-referral and no cycles
- Terms and disclaimer acceptance
- Member profile
- Member KYC Level 1 and Level 2
- Member status lifecycle
- Personal QR identity foundation with rotation and revocation
- Merchant discovery foundation
- Multi-market preferences
- Admin member management
- Account Country change review
- Member audit log and entity timeline
- UI, API, and PostgreSQL end-to-end planning

### Out of scope

- Transactions
- Receipts
- QR payments
- MCP debit flows
- Wallet balances beyond member-facing shells
- Ledgers beyond read-only planning references
- Rewards
- Commissions
- Agent upgrades
- Redemptions
- Advertising
- Production provider integrations
- Cross-market transfers
- Team rewards

## 3. Locked rules

1. One Account means one platform account per member.
2. Account Country is set at registration and can only change through admin review.
3. Current Market is switchable among enabled markets and does not change Account Country.
4. Referral code is unique per member and each member has one direct referrer only.
5. QR identity must be unpredictable, non-sensitive, rotatable, and revocable.
6. KYC Level 1 and Member Status are independent concepts.

## 4. Dependencies

### Existing production baseline

- `apps/api/src/auth/` for login, session, OTP, refresh, logout, and password reset patterns
- `apps/api/src/platform-access/` for RBAC, market access, audit, and redaction patterns
- `apps/api/src/merchant/` for ownership guards, idempotency patterns, and timeline/audit reuse
- `packages/database/schema/index.ts` for current accounts, sessions, OTP, markets, roles, permissions, market access, audit logs, and entity timelines

### Documentation baseline

- `docs/03-architecture/01_iPoint_System_Architecture_V1.0.md`
- `docs/03-architecture/03_iPoint_Database_ERD_and_Ledger_Specification_V1.0.md`
- `docs/03-architecture/04_iPoint_API_Contract_Specification_V1.0.md`
- `docs/06-phase-reports/p1-s1/*`
- `docs/05-roadmap/07_iPoint_MVP_Roadmap_and_Acceptance_V1.0.md`

## 5. Proposed sub-phase breakdown

P2-S1 is the contract freeze and governance update. Later sub-phases are listed only as planning order.

| Sub-phase | Focus | Output |
|---|---|---|
| P2-S1 | Architecture and contract freeze | These documents, plus governance updates |
| P2-S2 | Member identity and profile foundation | Implementation design for member profile and status storage |
| P2-S3 | Market preference and current-market switching | Member market preference behavior and APIs |
| P2-S4 | Referral and QR identity | Referral graph, QR token lifecycle, rotation, revocation |
| P2-S5 | KYC and status lifecycle | KYC cases, documents, review flows, status separation |
| P2-S6 | Merchant discovery read model | Discovery list, branch detail, and market-sensitive filtering |
| P2-S7 | Admin member management | Suspend, reactivate, referral correction, country change review |
| P2-S8 | Audit and timeline surfaces | Member timeline, audit, admin review history |
| P2-S9 | UI, API, and PostgreSQL E2E plan | Cross-layer verification matrix and acceptance gates |

## 6. Deliverable order

1. Freeze domain boundaries and data model assumptions.
2. Freeze API route families and access rules.
3. Freeze state machines and error codes.
4. Freeze security, privacy, and idempotency rules.
5. Freeze test and E2E coverage.
6. Record unresolved decisions explicitly.
7. Update governance files to reflect D-014 and the Phase 2 authorization state.

## 7. Definition of done for P2-S1

- All Phase 2 freeze documents exist under `docs/06-phase-reports/p2-s1/`.
- `DECISION_LOG.md` records D-014.
- `PHASE_REGISTRY.md` reflects Phase 2 authorization and P2-S1 in progress.
- No code, schema, migration, or UI file is changed.
- No later-phase business behavior is introduced.
- Scope leakage is explicitly checked and reported.
