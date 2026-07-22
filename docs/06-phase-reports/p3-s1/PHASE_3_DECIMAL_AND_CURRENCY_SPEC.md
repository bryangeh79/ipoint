# Phase 3 Decimal and Currency Specification

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357

---

## 1. Ground Rules

**LOCKED:**
- Do not use `float`, `real` or JavaScript `Number` for authoritative financial calculation.
- All monetary and iPoint values must use database `numeric` or equivalent exact decimal type.
- No arbitrary precision/rounding choice may be invented without being marked `DECISION_REQUIRED`.

---

## 2. Precision Specifications

| Field | Database Type | Rationale | Decision Status |
|---|---|---|---|
| Wallet balance | `numeric(38,10)` | Matches MCP ledger convention; supports large balances with 10 decimal places | **DECISION_REQUIRED** |
| Wallet entry amount | `numeric(38,10)` | Same as balance precision | **DECISION_REQUIRED** |
| Transaction amount (source) | `numeric(38,10)` | Maximum precision for purchase amounts | **DECISION_REQUIRED** |
| Reward plan total_earned | `numeric(38,10)` | Accumulated reward precision | **DECISION_REQUIRED** |
| Reward plan cap_amount | `numeric(38,10)` | Cap comparison precision | **DECISION_REQUIRED** |
| Daily accrual amount | `numeric(38,10)` | Per-day reward entry | **DECISION_REQUIRED** |
| Rule version rate | `numeric(12,8)` | Percentage rate (e.g. 0.00000001 = 0.000001%) | **DECISION_REQUIRED** |
| Percentage precision | `numeric(8,6)` | e.g. 1.5% = 0.015000, 0.01% = 0.000100 | **DECISION_REQUIRED** |

**Note:** All precision values should be reviewed by the Command Center. The recommended starting point is `numeric(38,10)` to match existing MCP conventions, but smaller precisions may be more appropriate for reward amounts.

---

## 3. Rounding Mode

| Operation | Rounding Mode | Decision Status |
|---|---|---|
| Accrual calculation (amount × rate) | **DECISION_REQUIRED** | HALF_UP recommended |
| Cap comparison | **DECISION_REQUIRED** | Must use same precision as cap |
| Ledger summation | No rounding (exact sum) | N/A — exact arithmetic |
| API serialization | **DECISION_REQUIRED** | Truncate or round for display |
| Frontend display | **DECISION_REQUIRED** | Localized formatting |

**Options for rounding mode:**
- `HALF_UP` (most common financial rounding)
- `HALF_DOWN` (banker's rounding variant)
- `HALF_EVEN` (banker's rounding, reduces bias in large datasets)
- `UP` / `DOWN` (explicit ceiling/floor)

---

## 4. Smallest Supported Units

**DECISION_REQUIRED:** What is the smallest supported iPoint unit?

Options:
- 1 iPoint (no decimals)
- 0.01 iPoint (2 decimal places, like cents)
- 0.000001 iPoint (6 decimal places)
- 0.0000000001 iPoint (10 decimal places, matching database precision)

The choice affects:
- Minimum reward accrual
- Display formatting
- User communication
- Rounding complexity

---

## 5. Currency Amount Precision

**DECISION_REQUIRED:** Transaction currency precision.

Each market may have its own currency (e.g., MYR with 2 decimal places, JPY with 0 decimal places). The wallet/reward system must handle:
- Currency-aware amount formatting (per market currency)
- Cross-currency comparison only at exchange points (deferred)
- Value storage at full precision regardless of display format

---

## 6. Accrual Calculation Order

**DECISION_REQUIRED:** The order of operations in daily accrual calculation.

Example with configurable rate:
```
purchase_amount × rate = daily_accrual_amount
```

But if caps, tiers, or percentages interact:
```
IF purchase_amount × rate > cap
  THEN accrual = cap
  ELSE accrual = purchase_amount × rate
```

Intermediate rounding: Should each step be rounded before the next step, or should rounding only happen at the final result?

---

## 7. Cap Comparison Precision

**DECISION_REQUIRED:** When comparing `total_earned` against `cap_amount`:

- Should comparison occur before or after rounding the accrual amount?
- What happens if `total_earned + accrual > cap` — should accrual be capped to `cap - total_earned`?

---

## 8. API Serialization

**DECISION_REQUIRED:** How are decimal values serialized in JSON API responses?

Options:
- String (recommended for financial APIs): `"1000.50"`
- Number: `1000.5` (lossy for some precisions)
- Object: `{ value: "1000.50", currency: "MYR" }`

Recommendation: String representation for precision preservation.

---

## 9. Frontend Display Precision

**DECISION_REQUIRED:** How many decimal places to display to members?

- 2 decimal places (common currency format, e.g., "1,234.56 iPoint")
- 4 decimal places (higher precision, e.g., "1,234.5678 iPoint")
- Locale-aware (different markets may display differently)

---

## 10. Summary of DECISION_REQUIRED Items

| # | Item | Options |
|---|---|---|
| 1 | Wallet balance precision | numeric(38,10) / numeric(20,4) / numeric(18,2) |
| 2 | Wallet entry amount precision | Same as balance / different |
| 3 | Transaction amount precision | Same as balance / different |
| 4 | Reward plan total_earned precision | Same as balance / smaller |
| 5 | Daily accrual amount precision | Same as balance / smaller |
| 6 | Rule version rate precision | numeric(12,8) / numeric(8,6) |
| 7 | Rounding mode | HALF_UP / HALF_DOWN / HALF_EVEN |
| 8 | Smallest iPoint unit | 1 / 0.01 / 0.000001 / 0.0000000001 |
| 9 | Currency precision per market | Per-market / unified |
| 10 | Calculation order | Before rounding / per-step rounding |
| 11 | Cap comparison precision | Same as cap / same as balance |
| 12 | API serialization | String / Number / Object |
| 13 | Frontend display precision | 2 dp / 4 dp / locale-aware |
