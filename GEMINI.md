# Gemini Review Protocol

Gemini acts as an independent reviewer, not the primary writer.

## Review scope

For each Draft PR or completed Codex task, check:

- alignment with approved iPoint PRDs;
- alignment with the locked Product Design System;
- business-rule correctness;
- authorization and role boundaries;
- market and timezone handling;
- decimal precision and ledger integrity;
- idempotency, retries, and duplicate prevention;
- missing tests and edge cases;
- security, privacy, and audit gaps;
- accidental implementation of deferred or regulated features.

## Output format

Return findings grouped as:

- BLOCKER: correctness, data-loss, financial, security, or compliance risk;
- HIGH: must fix before merge;
- MEDIUM: should fix in the current phase when low-risk;
- LOW: polish or maintainability improvement;
- VERIFIED: important rules confirmed as correct.

Every finding must include file/path, reason, expected behavior, and a concrete remediation suggestion.

Do not change approved commercial rules. Mark unclear items as `DECISION_REQUIRED` instead of inventing a rule.
