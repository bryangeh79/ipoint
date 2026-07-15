# iPoint Decision Log (Append-only)

> Rules:
> - Every entry is append-only. **No entry may be deleted or silently overwritten.**
> - Superseded entries are marked with `SUPERSEDED` and linked to the replacing Decision ID.
> - Each entry: Decision ID / Date / Source / Old Rule / New Decision / Reason / Affected Files / Affected Phases / Migration / Approver / Basis / Status

---

## D-001: Governance file creation

| Field | Value |
|---|---|
| **Decision ID** | D-001 |
| **Date** | 2026-07-16 |
| **Source** | OpenClaw Persistent Project Memory Plan (ChatGPT APPROVED WITH CHANGES) |
| **Old Rule** | No persistent governance files existed on project-master-baseline |
| **New Decision** | Create 7 governance files: AGENTS.md, DOCUMENT_AUTHORITY.md, OPENCLAW_OPERATING_RULES.md, BASELINE_ACKNOWLEDGMENT_V1.1.md, DECISION_LOG.md, OPEN_QUESTIONS.md, PHASE_REGISTRY.md |
| **Reason** | Prevent context loss on session restart; GitHub is sole persistent memory |
| **Affected Files** | AGENTS.md, docs/00-master/DOCUMENT_AUTHORITY.md, docs/00-master/OPENCLAW_OPERATING_RULES.md, docs/00-master/BASELINE_ACKNOWLEDGMENT_V1.1.md, docs/00-master/DECISION_LOG.md, docs/00-master/OPEN_QUESTIONS.md, docs/00-master/PHASE_REGISTRY.md |
| **Affected Phases** | NONE (pre-Phase governance) |
| **Migration** | NONE |
| **Approver** | ChatGPT Command Center |
| **Basis** | APPROVED WITH CHANGES (2026-07-16) |
| **Status** | **APPROVED** |

---

## D-002: Baseline Acknowledgment V1.1 Correction

| Field | Value |
|---|---|
| **Decision ID** | D-002 |
| **Date** | 2026-07-16 |
| **Source** | ChatGPT Command Center review of Baseline Acknowledgment |
| **Old Rule** | Original Baseline Acknowledgment (pre-V1.1) |
| **New Decision** | Apply 10 corrections: C-01 (Phase order), C-02 (Member QR token), C-03 (Maker/Checker no threshold), C-04 (Receipt 60 min locked), C-05 (Redemption refund no cap recalc), C-06 (market_id scope), C-07 (Merchant ID per branch), C-08 (Merchant staff moved to OPEN), C-09 (ORM neutral), C-10 (Git status reporting) |
| **Reason** | Correct inaccuracies and resolve open questions in baseline understanding |
| **Affected Files** | docs/00-master/BASELINE_ACKNOWLEDGMENT_V1.1.md, docs/00-master/OPEN_QUESTIONS.md, docs/00-master/PHASE_REGISTRY.md |
| **Affected Phases** | NONE (pre-Phase governance) |
| **Migration** | NONE |
| **Approver** | ChatGPT Command Center |
| **Basis** | CHANGES REQUIRED → resubmitted → approved directionally |
| **Status** | **APPROVED** |

---

## D-003: Persistent Project Memory Plan approval

| Field | Value |
|---|---|
| **Decision ID** | D-003 |
| **Date** | 2026-07-16 |
| **Source** | OpenClaw Persistent Project Memory Plan proposal |
| **Old Rule** | No structured project memory plan |
| **New Decision** | Create 7 governance files as specified in the plan; follow 10 amendments |
| **Reason** | Enable session-resilient project memory; GitHub as single source of truth |
| **Affected Files** | AGENTS.md, docs/00-master/DOCUMENT_AUTHORITY.md, docs/00-master/OPENCLAW_OPERATING_RULES.md, docs/00-master/BASELINE_ACKNOWLEDGMENT_V1.1.md, docs/00-master/DECISION_LOG.md, docs/00-master/OPEN_QUESTIONS.md, docs/00-master/PHASE_REGISTRY.md |
| **Affected Phases** | NONE (pre-Phase governance) |
| **Migration** | NONE |
| **Approver** | ChatGPT Command Center |
| **Basis** | APPROVED WITH CHANGES (2026-07-16) |
| **Status** | **APPROVED** |

---

*— End of current entries. New decisions must be appended below —*
