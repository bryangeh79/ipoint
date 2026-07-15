# iPoint Document Authority Order

> Established: 2026-07-16
> Source: Project Master Control §2 + OpenClaw Baseline Acknowledgment V1.1
> This file defines the hierarchy for resolving document conflicts. It is stable and changes only when new document types are added to the authority system.

---

## 1. Authority hierarchy

When documents conflict, use this order (lower number wins):

| Rank | Source | Notes |
|---|---|---|
| **1** | Bryan's latest explicit written decision | Highest authority; overrides all documents |
| **2** | Latest ChatGPT Command Center Phase Brief, Correction Notice, or acceptance decision | Current execution authority |
| **3** | Latest approved **Admin PRD** | Platform backend baseline |
| **4** | Latest **Member PRD V1.1** (International Architecture Update) | Supersedes Member PRD V1.0 Baseline |
| **5** | Latest approved **Merchant PRD** | Merchant application baseline |
| **6** | **iPoint Product Design System** | UI/UX single source of truth |
| **7** | **Project Master Control** + **Engineering Starter Pack** | Governance and execution baseline |
| **8** | Member PRD V1.0 Baseline | Historical reference only; V1.1 wins on conflict |
| **9** | Approved commission mechanism document | Agent commission baseline |
| **10** | Complete App Flow + machine-readable flow specification | Process reference |
| **11** | Early business-planning drafts (e.g., ipoint.docx) | Business background only; not engineering authority |
| **12** | Screenshots and JPEG visual references | Visual reference only; must not infer design tokens |

## 2. Priority rules

- **Newer approved PRD wins** over older version of the same document.
- **Example and provisional numbers** (e.g., RM388, 1 iPoint = RM1, reward percentages, advertising prices, commission rates) are NOT universal hard-coded rules. They must follow the latest approved market and rule configuration.
- **Old "not entering development" language** in early drafts is superseded by later approved PRDs that explicitly approve the feature.
- **Screenshots** are visual reference only. Codex workers must not sample colors, spacing, or typography from images. The Product Design System is the sole visual authority.

## 3. Conflict handling

- OpenClaw must **never silently resolve a conflict** between authoritative documents.
- If two documents at the same rank conflict, escalate to ChatGPT Command Center with:
  - Exact conflicting text from both documents
  - Recommendation based on project coherence
- Record the resolution in `DECISION_LOG.md`.

## 4. Reference classification

| Classification | Description | Examples |
|---|---|---|
| **Authoritative** | Direct engineering authority | PRDs, PMC, Design System |
| **Process** | Defines how to work | Starter Pack, Operating Rules |
| **Historical** | Business background only | ipoint.docx drafts |
| **Reference** | Visual or flow guidance | Screenshots, App Flow PNG |
