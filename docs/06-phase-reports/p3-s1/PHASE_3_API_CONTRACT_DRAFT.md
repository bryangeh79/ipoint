# Phase 3 API Contract Draft

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357
> **Note:** Draft only. No API endpoints or controllers are implemented in P3-S1.

---

## 1. API Conventions

Phase 3 follows existing API conventions:
- Base path: `/api/v1`
- OpenAPI documentation via existing validation pipeline
- Zod validation for request/response schemas
- Consistent error code format
- Request ID header for audit correlation

---

## 2. Member Wallet Endpoints

### GET /api/v1/wallets

List the authenticated member's wallets across all accessible markets.

**Response:**
```json
{
  "wallets": [
    {
      "id": "uuid",
      "market_id": "uuid",
      "market_code": "MY",
      "currency": "MYR",
      "balance": "0.00",
      "status": "ACTIVE",
      "created_at": "2026-08-01T00:00:00.000000Z"
    }
  ],
  "total": 1
}
```

**Authorization:** Auth Guard + member ownership (automatic: member_id from token)

---

### GET /api/v1/wallets/:id

Get wallet detail with balance and summary.

**Response:**
```json
{
  "id": "uuid",
  "member_id": "uuid",
  "market_id": "uuid",
  "market_code": "MY",
  "currency": "MYR",
  "balance": "1500.50",
  "status": "ACTIVE",
  "recent_entries": [
    {
      "id": "uuid",
      "amount": "500.00",
      "entry_type": "REWARD_ACCRUAL",
      "created_at": "2026-08-01T00:00:00.000000Z"
    }
  ],
  "created_at": "2026-08-01T00:00:00.000000Z"
}
```

**Authorization:** Auth Guard + wallet.member_id == token.member_id OR admin access

---

### GET /api/v1/wallets/:id/entries

Paginated list of wallet ledger entries.

**Query params:**
- `page` (default 1)
- `limit` (default 20, max 100)
- `entry_type` (optional filter)
- `from_date` (optional)
- `to_date` (optional)

**Response:**
```json
{
  "entries": [
    {
      "id": "uuid",
      "amount": "500.00",
      "balance_before": "1000.50",
      "balance_after": "1500.50",
      "entry_type": "REWARD_ACCRUAL",
      "entry_subtype": "DAILY_ACCRUAL",
      "reward_plan_id": "uuid",
      "reversal_of": null,
      "created_at": "2026-08-01T00:00:00.000000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 1
}
```

---

## 3. Admin Wallet Endpoints

### GET /api/v1/admin/wallets

List all wallets (with market and member filters).

**Query params:**
- `member_id` (optional filter)
- `market_id` (optional filter)
- `status` (optional filter)
- `page`, `limit`

**Authorization:** Admin Guard + market_access scope

---

### GET /api/v1/admin/wallets/:id

Get wallet detail (same as member endpoint but admin-authorized).

---

### POST /api/v1/admin/wallets/:id/reversal

Create a compensating entry.

**Request:**
```json
{
  "amount": "-500.00",
  "original_entry_id": "uuid",
  "reason": "Double accrual correction",
  "idempotency_key": "reversal:uuid:original-entry-uuid"
}
```

**Response:**
```json
{
  "reversal_entry_id": "uuid",
  "new_balance": "1000.50"
}
```

---

## 4. Reward Plan Endpoints

### GET /api/v1/admin/reward-plans

List reward plans (with filters).

**Query params:**
- `member_id`, `market_id`, `merchant_id`
- `status` (SCHEDULED, ACTIVE, CAPPED, SUSPENDED, REVERSED, COMPLETED)
- `page`, `limit`

---

### GET /api/v1/admin/reward-plans/:id

Get reward plan detail including accrual summary.

---

### POST /api/v1/admin/reward-plans/:id/suspend

Suspend a reward plan (stop future accrual).

---

### POST /api/v1/admin/reward-plans/:id/resume

Resume a suspended reward plan.

---

### GET /api/v1/reward-plans (member)

Member's own reward plans.

**Authorization:** Auth Guard + member_id filter.

---

## 5. Rule Version Endpoints

### POST /api/v1/admin/reward-rule-versions

Create a new rule version.

**Request:**
```json
{
  "name": "MY 2026 Q3 Rate",
  "market_id": "uuid",
  "rate": "0.01",
  "rate_type": "PERCENTAGE",
  "effective_from": "2026-07-01",
  "effective_until": "2026-09-30"
}
```

**Authorization:** Super Admin only.

---

### GET /api/v1/admin/reward-rule-versions

List rule versions (with market and effective date filters).

---

## 6. Settlement Endpoints

### GET /api/v1/admin/settlement/status

Get settlement status per market.

**Response:**
```json
{
  "markets": [
    {
      "market_id": "uuid",
      "market_code": "MY",
      "last_settled_date": "2026-08-01",
      "next_settlement_date": "2026-08-02",
      "pending_plans": 5,
      "status": "READY"
    }
  ]
}
```

---

## 7. Error Codes

| Code | HTTP Status | Description |
|---|---|---|
| WALLET_NOT_FOUND | 404 | Wallet does not exist |
| WALLET_ACCESS_DENIED | 403 | Member does not own this wallet |
| WALLET_DUPLICATE_ENTRY | 409 | Idempotency key conflict |
| WALLET_INSUFFICIENT_BALANCE | 422 | Not enough available balance |
| REWARD_PLAN_NOT_FOUND | 404 | Reward plan does not exist |
| REWARD_PLAN_INVALID_STATE | 422 | Cannot perform action in current state |
| REWARD_PLAN_DUPLICATE | 409 | Reward plan already exists for source |
| REWARD_RULE_VERSION_NOT_FOUND | 404 | Rule version does not exist |
| REWARD_RULE_NO_EFFECTIVE_VERSION | 422 | No effective rule for this market+date |
| MARKET_ACCESS_DENIED | 403 | Admin not authorized for this market |

---

## 8. OpenAPI Validation

All endpoints must follow existing OpenAPI documentation conventions.

The `pnpm openapi:validate` command should pass after documenting Phase 3 endpoints in P3-S2+.

---

## 9. Rate Limiting

**DECISION_REQUIRED:** Rate limit strategy for wallet endpoints:
- Per-member: e.g., 100 requests/minute for wallet reads
- Per-IP: for admin endpoints
- No rate limit: internal worker-to-API calls
