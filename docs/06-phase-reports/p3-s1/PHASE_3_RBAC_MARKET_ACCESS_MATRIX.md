# Phase 3 RBAC and Market Access Matrix

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357

---

## 1. Roles

| Role | Description |
|---|---|
| **Member** | iPoint app end-user. Owns wallets. |
| **Admin** | System operator. Manages rules, plans, corrections. |
| **Super Admin** | Cross-market admin. Can access all markets. |
| **Market Admin** | Admin scoped to specific markets via `market_access` table. |

---

## 2. Permission Matrix

| Operation | Member | Super Admin | Market Admin | Notes |
|---|---|---|---|---|
| **Wallet** | | | | |
| View own wallets (list) | ✅ Own only | ✅ All | ✅ Own market | |
| View own wallet detail | ✅ Own only | ✅ All | ✅ Own market | |
| View own wallet entries | ✅ Own only | ✅ All | ✅ Own market | |
| View another member's wallet | ❌ | ✅ | ✅ (own market) | |
| **Rewards** | | | | |
| View own reward plans | ✅ Own only | ✅ All | ✅ Own market | |
| View own reward accruals | ✅ Own only | ✅ All | ✅ Own market | |
| Create reward plan | ❌ | ✅ | ✅ (own market) | Admin-only |
| Modify reward plan | ❌ | ✅ | ✅ (own market) | Status transitions |
| Create rule version | ❌ | ✅ | ❌ | Super Admin only |
| **Corrections** | | | | |
| Create reversal entry | ❌ | ✅ | ✅ (own market) | Admin-only |
| Create adjustment entry | ❌ | ✅ | ✅ (own market) | Admin-only |
| **Admin Operations** | | | | |
| View all wallets | ❌ | ✅ | ✅ (own market) | |
| View reward plan statuses | ❌ | ✅ | ✅ (own market) | |
| Daily settlement status | ❌ | ✅ | ✅ (own market) | Read-only |
| **Reports** | | | | |
| Balance reconciliation | ❌ | ✅ | ✅ (own market) | |
| Accrual audit report | ❌ | ✅ | ✅ (own market) | |

---

## 3. Market Access Enforcement

Market access for admin users is managed via the existing `market_access` table:

```sql
market_access
├── admin_user_id (FK→admin_users)
├── market_id (FK→markets)
├── status (ACTIVE/INACTIVE)
└── UNIQUE (admin_user_id, market_id)
```

Market Admin scope:
- Can only perform wallet/reward operations within assigned markets
- Cannot create cross-market rule versions (Super Admin only)
- Cannot access wallets from unauthorized markets

Super Admin scope:
- All markets
- Rule version creation
- System configuration

---

## 4. API Authorization Patterns

### Member Endpoints

```
GET /api/v1/wallets
  → Auth Guard (valid JWT)
  → Filter: WHERE member_id = :auth_member_id

GET /api/v1/wallets/:id
  → Auth Guard
  → Load wallet
  → Verify: wallet.member_id = :auth_member_id
  → If fail: 403 FORBIDDEN

GET /api/v1/wallets/:id/entries
  → Auth Guard
  → Verify wallet ownership
  → Return paginated entries
```

### Admin Endpoints

```
GET /api/v1/admin/wallets
  → Auth Guard + Admin Guard
  → Market Admin: filter by own market_access
  → Super Admin: no market filter

POST /api/v1/admin/reward-plans
  → Auth Guard + Admin Guard
  → Market Admin: only own markets
  → Super Admin: any market

POST /api/v1/admin/wallets/:id/reversal
  → Auth Guard + Admin Guard
  → Market Admin: verify wallet's market is in own access
  → Create compensating entry
```

---

## 5. Member Self-Service vs Admin Operations

| Operation | Member Self-Service | Admin |
|---|---|---|
| View balance | ✅ Read-only | ✅ Read-only |
| View ledger history | ✅ Read-only | ✅ Read-only |
| Create reward plan | ❌ | ✅ |
| Suspend/resume reward plan | ❌ | ✅ |
| Create rule version | ❌ | ✅ (Super Admin) |
| Wallet reversal | ❌ | ✅ |
| Balance adjustment | ❌ | ✅ (deferred Phase 7+) |

---

## 6. Extensibility for Future Phases

The matrix includes columns for future roles (Agent, Merchant) and future operations (Redemption, Withdrawal). These are placeholders only and are **NOT implemented in Phase 3**.

| Future Operation | Member | Agent | Merchant Admin |
|---|---|---|---|
| Redeem iPoints (Phase 6) | ✅ | N/A | Manage catalog |
| Withdraw (deferred) | ✅ | N/A | N/A |
| View commission (Phase 5) | N/A | ✅ | N/A |
