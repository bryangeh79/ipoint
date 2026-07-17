# P2-S5 Final Delivery Report

> **Status:** P2-S5 FINAL HARDENING COMPLETE — AWAITING COMMAND CENTER REVIEW
> **Date:** 2026-07-18
> **Execution Engine:** Codex CLI
> **OpenClaw Subagent Used:** NO

## Session Information

| Field | Value |
|---|---|
| **Codex Version** | 0.144.5 |
| **Model** | gpt-5.6-sol |
| **Start Time** | 2026-07-18 04:14 UTC+8 |
| **End Time** | 2026-07-18 04:25 UTC+8 |

## Source Control

| Field | SHA |
|---|---|
| **Base SHA** (phase/2-member-core-multi-market) | `8f4a35d126bf19c744d4b45e357b5c1bada1ec3d` |
| **Schema/Migration commit** | `ba9b0e14` |
| **Service Hardening commit** | `824cf28d` |
| **Country Change + Error code propagation commit** | `b8c5c20f` |
| **Final Task remote SHA** | `b8c5c20f` (task/p2-s5-member-profile-integration) |
| **Final Phase remote SHA** | `8f4a35d1` (phase/2-member-core-multi-market) |
| **Branch sync** | NOT YET INTEGRATED — task branch has 16 commits ahead of phase branch |

## Migration

**File:** `packages/database/migrations/0010_member_profile_phone_and_default_market_hardening.sql`

**Phone verification columns:**
- `phone_normalized` text (nullable)
- `phone_verification_status` text NOT NULL DEFAULT 'NOT_PROVIDED'
- `phone_changed_at` timestamptz(6) (nullable)
- `phone_verified_at` timestamptz(6) (nullable)

**CHECK constraints (4 total):**
1. `check_phone_verification_status` — IN ('NOT_PROVIDED', 'PENDING', 'VERIFIED')
2. `check_phone_null_consistency` — phone IS NULL → all fields consistent
3. `check_phone_pending_consistency` — pending/unverified → normalized set, verified_at null
4. `check_phone_verified_consistency` — VERIFIED → normalized and verified_at both set

**Unique index:**
- `member_profiles_phone_normalized_unique` — platform-wide unique partial index WHERE NOT NULL

**display_name:**
- `ALTER TABLE member_profiles ALTER COLUMN display_name DROP NOT NULL`

**No duplicate is_current index on member_market_preferences** (already exists from P2-S2 migration 0007)

## Schema Changes

**`packages/database/schema/index.ts`:**
- Added `export type PhoneVerificationStatus = 'NOT_PROVIDED' | 'PENDING' | 'VERIFIED'`
- Added `phoneNormalized`, `phoneVerificationStatus`, `phoneChangedAt`, `phoneVerifiedAt` fields
- Added CHECK constraints in Drizzle schema definition
- Changed `displayName` to nullable

**`packages/database/src/expected-schema.ts`:**
- Updated column ordering to include `phone_changed_at` before `phone_verified_at`

**`packages/database/migrations/checksums.json`:**
- Added SHA256 for 0010 migration

## Phone Verification Rules

| State | phone | phone_normalized | phone_verification_status | phone_verified_at |
|---|---|---|---|---|
| Not provided | NULL | NULL | NOT_PROVIDED | NULL |
| Set/changed (pending) | SET | E.164 normalized | PENDING | NULL |
| Verified | SET | SET | VERIFIED | SET |
| Cleared | NULL | NULL | NOT_PROVIDED | NULL |

- Application layer cannot directly set VERIFIED or phoneVerifiedAt
- DTO explicitly strips phoneVerificationStatus and phoneVerifiedAt fields
- `phoneChangedAt` updated when phone changes

## Phone Uniqueness Rules

- `phone_normalized` is platform-wide unique (not per-market, not per-country)
- NULL values allowed for multiple rows (no phone provided)
- Different formats of same number normalize to same value and conflict at DB level
- Unique partial index is the final consistency enforcement
- Service layer uniqueness check provides UX optimization only

## Fallback Market Configuration Rules

- `DEFAULT_FALLBACK_MARKET_CODE` env var configurable (default: `MY`)
- Config schema validated in `packages/config/src/index.ts`
- Injected via `ConfigService` in NestJS

**Initialization priority:**
1. Look up `accounts.account_country` against ACTIVE markets (case-insensitive)
2. If no match, look up `DEFAULT_FALLBACK_MARKET_CODE` against ACTIVE markets
3. If fallback not found or not ACTIVE → stable `CONFIG_ERROR`
4. No "first ACTIVE" record or ORDER BY/LIMIT 1 fallback

## Profile Tests Coverage

| Test case | Status |
|---|---|
| GET own profile | Implemented |
| PATCH displayName valid | Implemented |
| PATCH displayName null/empty | Implemented (transform to null) |
| PATCH displayName whitespace only | Implemented (transform to null) |
| PATCH displayName too short | Implemented (error) |
| PATCH phone E.164 valid | Implemented (status → PENDING) |
| PATCH phone duplicate | Implemented (error, no member ID leak) |
| PATCH phone cleared | Implemented (status → NOT_PROVIDED) |
| PATCH phoneVerificationStatus directly | Stripped by DTO (strict mode) |
| PATCH phoneVerifiedAt directly | Stripped by DTO (strict mode) |
| PATCH birthDate future | Implemented (error) |
| PATCH gender invalid | Implemented (error) |
| PATCH account_country | Rejected (z.undefined) |
| PATCH referralCode | Rejected (not in DTO) |
| PATCH public_member_id | Rejected (not in DTO) |

## Market Tests Coverage

| Test case | Status |
|---|---|
| GET has current market | Implemented |
| GET initialized via account_country | Implemented |
| GET fallback when country not available | Implemented |
| GET fallback not configured | Implemented (CONFIG_ERROR) |
| GET fallback disabled | Implemented (CONFIG_ERROR) |
| PATCH normal switch | Implemented (transactional) |
| PATCH disabled market | Implemented (error) |
| PATCH non-existent market | Implemented (error) |
| PATCH duplicate idempotent | Implemented |
| PATCH concurrent only one current | Implemented (row-level locking) |
| PATCH does not modify account_country | Implemented |
| PATCH does not modify referral/KYC | Implemented |

## Country Change Tests Coverage

| Test case | Status |
|---|---|
| GET no pending | Implemented |
| GET with pending | Implemented |
| POST valid request | Implemented |
| POST same country rejected | Implemented |
| POST requested country disabled | Implemented |
| POST concurrent only one pending | Implemented (23505 → stable error) |
| DELETE cancel pending | Implemented |
| DELETE approved/rejected cannot cancel | Implemented |
| DELETE idempotent | Implemented |

## Concurrency Tests

| Test case | Status |
|---|---|
| Market: parallel GET init one current | Implemented (ON CONFLICT DO NOTHING) |
| Market: parallel PATCH one current | Implemented (SELECT FOR UPDATE) |
| Country Change: concurrent POST one pending | Implemented (unique index + error catch) |
| Profile: concurrent phone conflict | Implemented (DB unique index) |

## Audit/Timeline Tests

Service-level audit log and entity timeline recording exists in the codebase but requires database-backed E2E tests to validate.

## Verification Commands

> **Note:** The sandbox runtime could not execute these commands directly. They must be run from the host terminal in `C:\AI_WORKSPACE\iPoint App` with `pnpm install` already completed.

### Required verification:
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:api
pnpm test:database
pnpm db:checksum
pnpm db:migrate
pnpm db:seed
pnpm db:seed
pnpm db:drift
pnpm openapi:validate
```

These commands should be run against an isolated test database.

**Expected runtime environment:**
- Node: v26.4.0
- pnpm: 9.15.9
- DATABASE_URL: isolated test PostgreSQL instance

## Scope Leakage

- ✅ No P2-S6 (KYC Level 2) work implemented
- ✅ No P2-S7 (Merchant Discovery) work implemented
- ✅ No P2-S8 (Admin Member Management) work implemented
- ✅ No P2-S9 (UI Integration) work implemented
- ✅ No main PR or main merge attempted
- ✅ No modifications to migrations 0000-0009
- ✅ No modifications to LOCKED business rules
- ✅ Production SMS Provider still DEFERRED

## Repository Hygiene

- ✅ Task branch: `task/p2-s5-member-profile-integration`
- ✅ Phase branch: `phase/2-member-core-multi-market`
- ✅ No force push, reset, or amending of pushed history
- ✅ No bulk-adding untracked files
- ✅ No stash operations

## Phase Status

| Item | Status |
|---|---|
| **P2-S5** | **CHANGES_REQUIRED** (under active completion) |
| **P2-S6 and beyond** | **NOT_AUTHORIZED** |
| **Main PR / Main Merge** | **NOT_AUTHORIZED** |
