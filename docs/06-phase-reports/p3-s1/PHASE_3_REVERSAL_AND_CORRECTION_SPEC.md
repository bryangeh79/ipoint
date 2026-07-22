# Phase 3 Reversal and Correction Specification

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357

---

## 1. Core Principle

**LOCKED:** Existing ledger entries are immutable. Corrections must use compensating entries. No destructive ledger mutation.

---

## 2. Reversal Types

### Full Reversal

Cancel an entire ledger entry by creating an equal opposing entry.

```
Original:   +100.00 iPoint (REWARD_ACCRUAL)
Reversal:   -100.00 iPoint (REVERSAL, reversal_of=original_entry_id)
Net effect: 0.00 iPoint
```

### Partial Correction

Adjust a portion of a previous entry.

```
Original:   +100.00 iPoint (REWARD_ACCRUAL)
Correction:  -30.00 iPoint (CORRECTION, reversal_of=original_entry_id, reason="over-accrual")
Net effect:  70.00 iPoint
```

---

## 3. Reversal Entry Fields

Every reversal/compensating entry must include:

| Field           | Required | Description                                    |
| --------------- | -------- | ---------------------------------------------- |
| amount          | ✅       | Negative of (or partial to) original amount    |
| entry_type      | ✅       | 'REVERSAL' or 'CORRECTION'                     |
| reversal_of     | ✅       | FK to the original ledger entry being reversed |
| reason          | ✅       | Human-readable explanation                     |
| actor_id        | ✅       | Who performed the reversal (admin UUID)        |
| idempotency_key | ✅       | Prevents duplicate reversal                    |
| correlation_id  | ✅       | Links reversal to original event chain         |

---

## 4. Reward Plan Reversal

When a reward plan is reversed:

1. Create compensating wallet entries for ALL previously accrued amounts
2. Set reward_plan.status = 'REVERSED'
3. Set reward_plan.reversed_at = current UTC timestamp
4. Future accruals must be stopped (worker checks status before processing)

**Idempotency:** The reversal operation must be idempotent — repeating the reversal request must not create duplicate compensating entries.

---

## 5. Future Accrual Stop

When a reward plan is reversed or suspended:

- Settlement worker must check plan status before each accrual
- Only ACTIVE plans are eligible for daily accrual
- Reversed/Suspended/Capped/Completed plans are skipped
- No new entries are created for non-ACTIVE plans

---

## 6. Scope Boundaries

**LOCKED — OUT OF SCOPE for Phase 3:**

- Full refund workflow (Phase 4+)
- Dispute workflow (Phase 4+)
- Merchant transaction cancellation (Phase 4+)
- Admin adjustment screen (Phase 7+)
- Maker/Checker approval workflow (Phase 7+)
- Operator adjustment endpoint (Phase 7+)

**Phase 3 covers only:**

- Underlying domain and ledger contracts for compensation
- Reversal table design and relationships
- Reward plan state transitions related to reversal
- Idempotent compensating entry creation

---

## 7. Reconciliation

Reversal and correction operations must produce audit log entries with:

- Correlation to original ledger entry
- Actor attribution
- Reason documentation
- Balance impact calculation

A reconciliation function (design only, not implement) should be able to:

- Sum all entries per account
- Verify balance matches
- Identify entries without proper reversal linkage
- Flag imbalance for manual review
