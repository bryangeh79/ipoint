# Phase 4 Contract Clarification — MCP Insufficiency Behavior

> **Clarification ID:** P4-CL-001
> **Date:** 2026-07-23
> **Source:** ChatGPT Command Center — P4-S2 Acceptance
> **Applies to:** P4-D07 (Insufficient MCP), P4-D24 (Preview does not reserve MCP)
> **Status:** APPROVED

---

## Option B (Adopted)

Preview may still be created when MCP is insufficient.

The Preview response must include clear insufficiency indicators:

| Field               | Type      | Description                                                       |
| ------------------- | --------- | ----------------------------------------------------------------- |
| `mcpSufficient`     | `boolean` | Whether current MCP covers the estimated debit                    |
| `confirmAllowed`    | `boolean` | Whether confirm would succeed (same as mcpSufficient for Batch A) |
| `currentMcpBalance` | `string`  | Current MCP balance (decimal string)                              |
| `estimatedMcpDebit` | `string`  | Amount that would be debited at Confirm                           |
| `mcpShortfall`      | `string`  | Additional MCP needed (0 if sufficient)                           |

### Rules

1. Preview MUST still be created and returned even when MCP is insufficient.
2. Preview MUST NOT debit MCP.
3. Preview MUST NOT reserve MCP.
4. Preview MUST NOT create a Transaction Number.
5. Preview MUST NOT create Reward source, plan, or wallet entries.
6. Preview MUST NOT create confirmed financial records.

### Confirm Behavior (P4-S3)

Confirm backend MUST independently recheck MCP sufficiency:

- If MCP is insufficient at Confirm time → reject with dedicated `TRANSACTION_INSUFFICIENT_MCP` error.
- No confirmed Transaction created.
- No MCP debited.
- No Reward Source created.
- No Wallet Ledger entry created.
- No partial financial state left behind.
- The frontend `confirmAllowed` flag is informational only; Confirm MUST NOT rely on it.

---

## Replaces

This clarification supplements P4-D07 and P4-D24. Where conflict exists, this clarification wins.

## Affected Changes

- `transaction.dto.ts` — add `mcpSufficient`, `confirmAllowed`, `mcpShortfall` to Preview response
- `transaction.service.ts` — calculate insufficiency fields in Preview logic
- `transaction.errors.ts` — add `TRANSACTION_INSUFFICIENT_MCP` error code
- `transaction-preview.integration.spec.ts` — update MCP insufficiency test to expect explicit fields
