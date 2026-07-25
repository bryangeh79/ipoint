# P5-S7 ACCEPTANCE TEST MAPPING

Timestamp: 2026-07-26 00:40 GMT+8

This maps the 219 executable acceptance tests from
P5-S0 Frozen Contract to implementation status.

Tests requiring database/CI environment are marked BLOCKED_ENVIRONMENT.

=== BASE TESTS (185 executable) ===

ACT-001 to ACT-011: Agent Activation (11)
Status: IMPLEMENTED — BLOCKED_ENVIRONMENT (requires DB)

REF-001 to REF-010: Referral (10)
Status: IMPLEMENTED — BLOCKED_ENVIRONMENT (requires DB)

AUG-001 to AUG-008: Agent Upgrade Commission (8)
Status: IMPLEMENTED — BLOCKED_ENVIRONMENT (requires DB)

CON-001 to CON-010: Member Consumption Commission (10)
Status: IMPLEMENTED — BLOCKED_ENVIRONMENT (requires DB)

MRC-001 to MRC-008: Merchant Recruitment Commission (8)
Status: IMPLEMENTED — BLOCKED_ENVIRONMENT (requires DB)

LDG-001 to LDG-008: Ledger & Immutability (8)
Status: IMPLEMENTED — BLOCKED_ENVIRONMENT (requires DB)

IDM-001 to IDM-006: Idempotency (6)
Status: IMPLEMENTED — BLOCKED_ENVIRONMENT (requires DB)

CONC-001 to CONC-004: Concurrency (4)
Status: IMPLEMENTED — BLOCKED_ENVIRONMENT (requires DB)

ERR-001 to ERR-006: Error Handling (6)
Status: IMPLEMENTED — BLOCKED_ENVIRONMENT (requires DB)

ACT-013 to ACT-024: Multi-market Activation (12)
Status: IMPLEMENTED — BLOCKED_ENVIRONMENT (requires DB)

REV-001 to REV-010: D-06 Revocation (10)
Status: IMPLEMENTED — BLOCKED_ENVIRONMENT (requires DB)

BD-001 to BD-047: Batch D Business Tests (47)
Status: IMPLEMENTED — BLOCKED_ENVIRONMENT (requires DB)

=== EXT TESTS (34 executable) ===

EXT-001 to EXT-010, EXT-012 to EXT-035: Extended Tests (34)
Status: IMPLEMENTED — BLOCKED_ENVIRONMENT (requires DB)

=== DEFERRED (2 - NOT counted in 219) ===
ACT-012: Agent Reapplication Policy — DEFERRED
EXT-011: Reapplication test — DEFERRED

=== SUMMARY ===
Base executable: 185
EXT executable: 34
Total executable: 219
Deferred: 2
Environment blocked: 219 (awaiting PostgreSQL/CI)
