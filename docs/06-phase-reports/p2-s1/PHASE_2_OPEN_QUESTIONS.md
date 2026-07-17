---
title: Phase 2 Open Questions
phase: P2-S1
status: freeze
implementation_authorized: false
date: 2026-07-17
---

# Phase 2 Open Questions

## O-01: Current market persistence model

| Field | Value |
|---|---|
| ID | O-01 |
| Description | Should Current Market be stored as a member preference row, a session-level context, or both with a single authoritative source? |
| Impact | Member market switching and discovery cache behavior |
| Status | OPEN |
| Decision needed by | Before P2-S3 implementation |

## O-02: QR token format and rotation cadence

| Field | Value |
|---|---|
| ID | O-02 |
| Description | Should the QR token be pure signed token, token pointer, or short-lived display payload, and what is the default rotation cadence? |
| Impact | QR rendering, revocation, and merchant verification |
| Status | OPEN |
| Decision needed by | Before P2-S4 implementation |

## O-03: KYC retention and purge policy

| Field | Value |
|---|---|
| ID | O-03 |
| Description | What is the minimum retention period for private KYC documents and review evidence by market? |
| Impact | Storage, compliance, and deletion/archival policy |
| Status | OPEN |
| Decision needed by | Before P2-S5 implementation |

## O-04: Merchant discovery ranking rules

| Field | Value |
|---|---|
| ID | O-04 |
| Description | What ranking factors are allowed for discovery search and list ordering in the member app? |
| Impact | Search UX and merchant list behavior |
| Status | OPEN |
| Decision needed by | Before P2-S6 implementation |

## O-05: Country-change review SLA and cooldown

| Field | Value |
|---|---|
| ID | O-05 |
| Description | Is there a cooldown, maximum pending request count, or SLA for account-country change review? |
| Impact | Admin workload and abuse control |
| Status | OPEN |
| Decision needed by | Before P2-S7 implementation |

## O-06: Member closed-state visibility

| Field | Value |
|---|---|
| ID | O-06 |
| Description | What read-only data, if any, remains visible after a member is closed? |
| Impact | Support, audit, and account recovery |
| Status | OPEN |
| Decision needed by | Before P2-S7 implementation |

