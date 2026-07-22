# Phase 3 Decimal Strategy

> **File:** PHASE_3_DECIMAL_STRATEGY.md
> **Author:** Agent 0 — Contract & Integration Lead
> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357

---

## 1. Existing MCP Ledger Precision (Codebase Reference)

Audited in `packages/database/schema/index.ts`:

```typescript
// mcp_ledger_entries — existing pattern
amount: numeric('amount', { precision: 38, scale: 10 }).notNull(),
balanceBefore: numeric('balance_before', { precision: 38, scale: 10 }).notNull(),
balanceAfter: numeric('balance_after', { precision: 38, scale: 10 }).notNull(),
```

**Current convention:** `precision: 38, scale: 10` for all monetary/ledger fields.

---

## 2. Proposed Precision for Phase 3

| Field | Database Type | MCP Match? | Recommendation | Decision Status |
|---|---|---|---|---|
| Wallet balance | `numeric(38,10)` | ✅ Match | **Recommended — identical to MCP** | DECISION_REQUIRED |
| Wallet entry amount | `numeric(38,10)` | ✅ Match | **Recommended — identical to MCP** | DECISION_REQUIRED |
| Wallet balance_before | `numeric(38,10)` | ✅ Match | **Recommended — identical to MCP** | DECISION_REQUIRED |
| Wallet balance_after | `numeric(38,10)` | ✅ Match | **Recommended — identical to MCP** | DECISION_REQUIRED |
| Reward plan total_earned | `numeric(38,10)` | ✅ Match | **Recommended** | DECISION_REQUIRED |
| Reward plan cap_amount | `numeric(38,10)` | ✅ Match | **Recommended** | DECISION_REQUIRED |
| Reward source transaction_amount | `numeric(38,10)` | ✅ Match | **Recommended** | DECISION_REQUIRED |
| Daily accrual amount | `numeric(38,10)` | ✅ Match | **Recommended** | DECISION_REQUIRED |
| Rule version rate | `numeric(12,8)` | ❌ Different | **Recommended** — 8 decimal places for percentages | DECISION_REQUIRED |

---

## 3. Rationale for `numeric(38,10)` Match

### Supporting Arguments

| Argument | Detail |
|---|---|
| **Consistency** | Same format as MCP ledger avoids cognitive overhead for developers and DBAs |
| **Reconciliation** | Matching precision simplifies future cross-system reconciliation queries |
| **Storage cost** | Difference between `numeric(38,10)` and `numeric(20,4)` is negligible at expected transaction volumes |
| **Future-proofing** | 38 digits supports large-scale deployments without schema changes |
| **Max precision** | PostgreSQL numeric is variable-length; `numeric(38,10)` uses 22 bytes max — same as smaller values |

### Arguments against matching

| Argument | Counter |
|---|---|
| iPoint is not currency — lower precision may suffice | Wallet is financial infrastructure; precision cost is negligible |
| Smaller precision is easier to display | Display formatting is independent of storage precision |
| MCP handles real money; iPoint is loyalty points | iPoint has contractual value; treating it with monetary precision is safer |

**Recommendation:** **Use `numeric(38,10)` for all Phase 3 ledger/balance/amount fields** to match MCP convention. This is the lowest-risk choice. If command center prefers a smaller precision, `numeric(20,4)` is the fallback.

---

## 4. Rule Version Rate Precision

| Option | Precision | Max Expressible | Min Expressible |
|---|---|---|---|
| A: `numeric(12,8)` | 12 total, 8 fractional | 9999.99999999 | 0.00000001 |
| B: `numeric(8,6)` | 8 total, 6 fractional | 99.999999 | 0.000001 |
| C: `numeric(10,7)` | 10 total, 7 fractional | 999.9999999 | 0.0000001 |

**Recommendation:** `numeric(12,8)` — supports rates from 0.000001% (0.00000001) to 9999.99999999%. More than adequate for any realistic reward rate. Offers 8 decimal places for fractional percentage rates.

---

## 5. Smallest Supported iPoint Unit

| Option | Unit | Display Example | When Useful |
|---|---|---|---|
| 1 | Whole iPoint | 1,234 | Simplest, least flexible |
| 0.01 | 2 decimal places | 1,234.56 | Like cents |
| 0.000001 | 6 decimal places | 1,234.567890 | High precision for micro-accruals |
| 0.0000000001 | 10 decimal places | 1,234.5678901234 | Full precision matching DB |

**Recommendation:** `0.01` (2 decimal places) for display to members, with `0.000001` (6 decimal places) for internal computation. Storage uses full `numeric(38,10)` precision.

**Decision:** Marked as **DECISION_REQUIRED**. The recommendation is:
- **Display precision:** 2 decimal places to members
- **Calculation precision:** 6 decimal places internally
- **Storage precision:** 10 decimal places (matching DB column)
- **Rounding mode applied at display boundary**

---

## 6. Rounding Mode

| Operation | Recommended Mode | Rationale | Decision Status |
|---|---|---|---|
| Accrual calculation (amount × rate) | **HALF_UP** | Standard financial rounding; most predictable for members | DECISION_REQUIRED |
| Cap comparison | **HALF_UP** | Must match accrual rounding direction | DECISION_REQUIRED |
| Display formatting | **HALF_DOWN** | Prevents display of "phantom" fractional rounding up | DECISION_REQUIRED |
| Ledger summation | **No rounding** | Exact arithmetic; never round ledger totals | N/A |
| API serialization | **No rounding** | Return exact stored value as string | N/A |

### Rounding Mode Comparison

| Mode | Description | Use Case |
|---|---|---|
| `HALF_UP` | Round 0.5 upward | Most common financial rounding |
| `HALF_DOWN` | Round 0.5 downward | Reduces upward rounding bias |
| `HALF_EVEN` | Round to nearest even (banker's) | Reduces bias in large datasets |
| `UP` / `CEILING` | Always round up | Rarely used |
| `DOWN` / `FLOOR` | Always round down | Commission calculations |

**Recommendation:** `HALF_UP` for all accrual operations. This is the most intuitive for members and matches the behavior of most financial systems.

---

## 7. Accrual Calculation Order

### Step-by-Step (Recommended)

```
1. raw_accrual = purchase_amount × rule_rate      (no rounding)
2. Apply cap comparison:
   IF total_earned + rounded(raw_accrual, 6dp, HALF_UP) > cap_amount:
      accrual = cap_amount - total_earned           (capped)
   ELSE:
      accrual = rounded(raw_accrual, 6dp, HALF_UP)  (normal)
3. Store accrual amount in numeric(38,10)
4. Update total_earned = total_earned + accrual
```

### Rationale for per-step rounding

- Round accrual before cap comparison to prevent micro-fraction overflow
- Cap comparison uses rounded accrual (not raw) to ensure determinism
- `total_earned` ≤ `cap_amount` invariant is guaranteed

### Alternative (no intermediate rounding)

- Compare `total_earned + raw_accrual > cap_amount` before rounding
- Risk: `total_earned` may exceed `cap_amount` by a micro-fraction after rounding

**DECISION_REQUIRED:** Per-step rounding (recommended) vs. no intermediate rounding.

---

## 8. Cap Comparison Strategy

| Variant | Behavior | Recommended? |
|---|---|---|
| Cap before rounding | `total_earned + rounded(accrual) > cap → cap - total_earned` | **Recommended** |
| Cap after rounding raw | `total_earned + raw > cap → rounded(cap - total_earned)` | Valid but may yield slightly different amounts |
| Exact cap (fail on exceed) | `total_earned + accrual > cap → error` | Not recommended — prevents natural cap behavior |

**Recommendation:** Cap before rounding (`total_earned + rounded(accrual) > cap → accrual = cap - total_earned`). This is the most intuitive for business users.

---

## 9. API Serialization

| Format | Example | Pros | Cons | Recommendation |
|---|---|---|---|---|
| **String** | `"1234.56"` | Lossless, no floating-point issues | Clients must parse | **Recommended** |
| Number | `1234.56` | Native JSON | Lossy for high precision | Not recommended |
| Object | `{value: "1234.56"}` | Self-describing | Verbose | Over-engineered for MVP |

**Recommendation:** **String serialization for all numeric monetary fields.** This matches financial API best practices (Stripe, Square, etc.).

---

## 10. Frontend Display Precision

| Market Type | Display Precision | Example | Notes |
|---|---|---|---|
| Default | 2 decimal places | 1,234.56 iPoint | Matches member expectations |
| High-precision markets | 4 decimal places | 1,234.5678 iPoint | If micro-accrual is significant |
| Admin UI | Full stored precision | 1,234.5678901234 iPoint | For audit/reconciliation |

**Decision:** **DECISION_REQUIRED.** Recommend 2 decimal places as default with a future option for locale-aware precision.

---

## 11. Summary of DECISION_REQUIRED Items

| # | Item | Recommendation | Escalate If |
|---|---|---|---|
| 1 | Wallet balance precision | `numeric(38,10)` match MCP | Command Center prefers smaller |
| 2 | Wallet entry precision | `numeric(38,10)` match MCP | Command Center prefers smaller |
| 3 | Reward plan precision | `numeric(38,10)` | Command Center prefers smaller |
| 4 | Rule version rate precision | `numeric(12,8)` | Command Center needs more/fewer decimals |
| 5 | Smallest iPoint unit (display) | 2 decimal places (0.01) | Members require whole numbers only |
| 6 | Smallest iPoint unit (calculation) | 6 decimal places (0.000001) | Higher precision needed |
| 7 | Rounding mode | `HALF_UP` | Business requires banker's rounding |
| 8 | Accrual calc order | Per-step rounding | Command Center wants no intermediate rounding |
| 9 | Cap comparison | Rounded accrual vs cap | Exact mathematics required |
| 10 | API serialization | String | Force number (not recommended) |
| 11 | Frontend display precision | 2 dp default, locale-aware later | Specific market demand |

### Why the recommendation is `numeric(38,10)` despite the many DECISION_REQUIRED markers

The existing `PHASE_3_DECIMAL_AND_CURRENCY_SPEC.md` marked every field as DECISION_REQUIRED. This document **narrows the decision to a single binary choice**: **match MCP (38,10) vs smaller custom precision**.

If Command Center approves `(38,10)` across the board, all 11 items collapse to:
- Precision: `(38,10)` — **ACCEPTED**
- Rounding: `HALF_UP` — **ACCEPTED**
- Display: 2dp string — **ACCEPTED**

This strategy converts 11 independent decisions into 1 batch decision.
