# P2-S7 Delivery Report

> **Status:** P2-S7 DATABASE AND HTTP VERIFICATION COMPLETE — AWAITING COMMAND CENTER REVIEW
> **Date:** 2026-07-18
> **Execution Engine:** OpenAI Codex CLI
> **OpenClaw Subagent Used:** NO
> **Codex version:** 0.144.5
> **Model:** gpt-5.6-sol

---

## Source Control

| Field | SHA |
|---|---|
| **Governance base** (P2-S6 close) | `62c3cd7fd9e137abb426361c670a48254ed9d8ae` |
| **Implementation base** (Phase HEAD) | `62c3cd7fd9e137abb426361c670a48254ed9d8ae` |
| **P2-S7A** (Schema + Migration 0012) | `f2c25f1d1e3e72f3a0d7cc2f0b177f4d07507464` |
| **P2-S7B** (Discovery APIs) | `99b832c59184af29861bb22d18e943fd3f2e528f` |
| **P2-S7B fix** (Lint) | `23c7f5ec2bcc87e4c816b0a02e13c675d0a9a161` |
| **Tested Full SHA** | `23c7f5ec2bcc87e4c816b0a02e13c675d0a9a161` |
| **Task branch** | `task/p2-s7-member-merchant-discovery` |
| **Phase branch** | `phase/2-member-core-multi-market` |
| **Final Task SHA** | `23c7f5ec2bcc87e4c816b0a02e13c675d0a9a161` |
| **Final Phase SHA** | `23c7f5ec2bcc87e4c816b0a02e13c675d0a9a161` |
| **SHA consistency** | ✅ Task SHA = Phase SHA |

---

## PostgreSQL Environment

| Field | Value |
|---|---|
| **Version** | PostgreSQL 17.10 Alpine (Docker) |
| **Test database** | `ipoint_kyc_test` (isolated) |
| **DATABASE_URL** | `postgresql://ipoint:***@127.0.0.1:55432/ipoint_kyc_test` |

## Verification Results

| Command | Exit Code | Result |
|---|---|---|
| `pnpm format:check` | **0** | ✅ |
| `pnpm lint` | **0** | ✅ 0 errors, 0 warnings |
| `pnpm typecheck` | **0** | ✅ 13/13 workspace projects |
| `pnpm build` | **0** | ✅ All packages built |
| `pnpm test` | **0** | **431 passed, 0 failed, 0 skipped** |
| `pnpm test:api` | **0** | ✅ 410 API tests passed |
| `pnpm test:database` | **0** | ✅ 37 database tests passed |
| `pnpm openapi:validate` | **0** | ✅ 92 paths, 0 missing schemas, 0 duplicate operationId |
| `pnpm db:checksum` | **0** | ✅ 13 immutable checksums verified |
| `pnpm db:migrate` | **0** | ✅ All 13 migrations applied |
| `pnpm db:seed` (1st) | **0** | ✅ |
| `pnpm db:seed` (2nd) | **0** | ✅ Idempotent, no duplicates |
| `pnpm db:drift` | **0** | ✅ No schema drift detected |

### Test Files

| Test file | Tests | Status |
|---|---|---|
| `discovery.service.spec.ts` | 14 | ✅ All passed |
| `database.integration.test.ts` | 21 | ✅ All passed |
| `schema.unit.test.ts` | 16 | ✅ All passed |
| `market.http.integration.spec.ts` | 2 | ✅ All passed |
| `auth.http.integration.spec.ts` | 36 | ✅ All passed |
| `auth.integration.spec.ts` | 25 | ✅ All passed |
| `auth.performance.spec.ts` | 7 | ✅ All passed |
| `kyc.http.integration.spec.ts` | 5 | ✅ All passed |
| `admin-kyc.http.integration.spec.ts` | 12 | ✅ All passed |
| `merchant.integration.spec.ts` | 10 | ✅ All passed |
| Other unit tests | 283 | ✅ All passed |
| **TOTAL** | **431** | **✅ 0 failed, 0 skipped** |

### Fresh Migration

Empty database → all 13 migrations (0000-0012) applied ✅
- pg_trgm extension created ✅
- Discovery composite index created ✅
- GIST coordinate index created ✅
- Trigram name/about_us search indexes created ✅
- merchant_categories table created ✅
- merchant_branch_categories table created ✅

### Upgrade Migration

From P2-S6 state → 0012 applied successfully ✅
- All existing Merchant data retained ✅
- Packages, Member, Profile, Market, KYC data retained ✅
- Auth, RBAC, Audit data retained ✅
- No tables deleted ✅

---

## API Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/members/merchants` | List with filters, pagination, sorting |
| `GET` | `/members/merchants/:merchantId` | Detail (cross-market rejected) |
| `GET` | `/members/merchant-categories` | Categories for current market |
| `GET` | `/members/merchants/nearby` | Geospatial nearby query |

### List API Parameters

| Parameter | Type | Default | Max |
|---|---|---|---|
| `page` | integer | 1 | — |
| `pageSize` | integer | 20 | 100 |
| `query` | string | — | — |
| `category` | string | — | — |
| `merchantType` | enum | — | online/offline |
| `isOnline` | boolean | — | — |
| `isOffline` | boolean | — | — |
| `city` | string | — | — |
| `region` | string | — | — |
| `openNow` | boolean | — | — |
| `sort` | enum | default | relevance/newest/name/distance |
| `latitude` | float | — | ±90 |
| `longitude` | float | — | ±180 |
| `radius` | km | 5 | 50 |

### Current Market Isolation

- ✅ Current Market resolved via `member_market_preferences` (P2-S5 logic)
- ✅ No client-provided market parameter accepted
- ✅ Cross-market detail requests → 404
- ✅ Account Country NOT used as filter
- ✅ Market disabled → stable error

### Merchant Visibility Rules

| Condition | Visible |
|---|---|
| ACTIVE + approved + publicly visible + has active package | ✅ Yes |
| Pending | ❌ No |
| Rejected | ❌ No |
| Suspended | ❌ No |
| Closed | ❌ No |
| Public visibility OFF | ❌ No |
| No active package | ❌ No |
| Other market | ❌ No |

### Package Visibility

- Only active (status = ACTIVE) packages shown
- Effective within current date range
- Name, percentage, default flag returned
- No internal cost, commission calc, MCP data

### Nearby Design

| Parameter | Rule |
|---|---|
| Distance unit | kilometers |
| Max radius | 50 km |
| Calculation | PostgreSQL `point <->` operator |
| Default sort | distance ASC, then name ASC |
| Coordinate source | Database `merchant_branches.coordinates` only |
| No-coordinate merchants | Excluded from nearby results |
| Index | GIST index on `coordinates` |

### openNow Design

| State | Condition |
|---|---|
| `OPEN` | Current market local time within business hours |
| `CLOSED` | Current market local time outside business hours |
| `UNKNOWN` | No business hours data available |

- Timezone: `markets.timezone` for the member's current market
- Supports overnight hours, closed days, weekends
- Tested with `Asia/Kuala_Lumpur` (UTC+8) and another timezone

---

## Security Controls

| Protection | Status |
|---|---|
| Member auth required | ✅ No guest discovery |
| Current Market enforced server-side | ✅ |
| Cross-market detail blocked | ✅ (404) |
| Response field whitelist | ✅ |
| No MCP/balance data returned | ✅ |
| No KYC/admin notes returned | ✅ |
| No internal email returned | ✅ |
| No private object keys | ✅ |
| No storage credentials | ✅ |
| No client-injected coordinates | ✅ |
| Pagination upper limit | ✅ (max 100) |
| Radius upper limit | ✅ (max 50 km) |
| Coordinate range validation | ✅ |

---

## Performance Indexes

| Index | Table | Type | Purpose |
|---|---|---|---|
| `merchant_branches_discovery_idx` | merchant_branches | B-tree | market_id, is_publicly_visible, display_order, name, id (WHERE ACTIVE) |
| `merchant_branches_coordinates_gist_idx` | merchant_branches | GIST | coordinates (WHERE ACTIVE + visible) |
| `merchant_branches_name_search_idx` | merchant_branches | GIN trigram | name search (WHERE ACTIVE + visible) |
| `merchant_profiles_about_search_idx` | merchant_profiles | GIN trigram | about_us search |
| `merchant_categories_market_active_idx` | merchant_categories | B-tree | market_id, is_active, sort_order, name |
| `merchant_branch_categories_category_idx` | merchant_branch_categories | B-tree | market_id, category_id, merchant_branch_id |

### Query Baseline (Test Environment)

| Query | Expected Index Usage |
|---|---|
| List by market + visible | `merchant_branches_discovery_idx` |
| Category filter | `merchant_branch_categories_category_idx` |
| Keyword search (name) | `merchant_branches_name_search_idx` |
| Keyword search (about) | `merchant_profiles_about_search_idx` |
| Nearby + distance sort | `merchant_branches_coordinates_gist_idx` |
| Categories by market | `merchant_categories_market_active_idx` |

---

## Scope Leakage

| Feature | Status |
|---|---|
| Merchant reviews/ratings | ❌ NOT implemented |
| Coupons/Promos/Events | ❌ NOT implemented |
| Transactions/Receipts/QR | ❌ NOT implemented |
| Wallet/MCP/Reward | ❌ NOT implemented |
| Commission/Agent | ❌ NOT implemented |
| Redemption | ❌ NOT implemented |
| Admin/UI | ❌ NOT implemented |
| P2-S8 to P2-S9 | ✅ NOT_AUTHORIZED |
| Main PR / Main Merge | ✅ NOT_AUTHORIZED |

## Repository Hygiene

| Check | Result |
|---|---|
| `git status --short` | Clean |
| `git diff --check` | No whitespace errors |
| `git ls-files memory/` | Not tracked |
| `git ls-files .openclaw/` | Not tracked |
| No force push/reset/stash | ✅ Confirmed |
| No modifications to 0000-0011 | ✅ Confirmed |
