# P5-S0: Agent & Commission Engine — Contract Freeze

**Phase:** Phase 5  
**Sprint:** P5-S0 (Documentation & Architecture)  
**Status:** P5-S0 ACCEPTED AND CONTRACT FROZEN  
**Last Updated:** 2026-07-25  
**Executor:** OpenClaw sub-agent (deepseek/deepseek-v4-flash)  
**Authorization Reference:** Command Center P5-S0 Branch Creation & Contract Draft Authorization (2026-07-25 14:27 GMT+8)

---

## Table of Contents

1. [Purpose and Scope](#1-purpose-and-scope)
2. [Terminology](#2-terminology)
3. [Actors and Permissions](#3-actors-and-permissions)
4. [Agent Activation Lifecycle](#4-agent-activation-lifecycle)
5. [Referral Ownership](#5-referral-ownership)
6. [Referral-Tree Invariants](#6-referral-tree-invariants)
7. [Commission Source Matrix](#7-commission-source-matrix)
8. [Eligibility Rules](#8-eligibility-rules)
9. [Exact Formulas](#9-exact-formulas)
10. [Rate Versioning](#10-rate-versioning)
11. [Market and Currency Rules](#11-market-and-currency-rules)
12. [Decimal and Rounding Rules](#12-decimal-and-rounding-rules)
13. [Snapshot Rules](#13-snapshot-rules)
14. [Immutable Ledger Model](#14-immutable-ledger-model)
15. [Commission State Machine](#15-commission-state-machine)
16. [Idempotency](#16-idempotency)
17. [Concurrency and Lock Ordering](#17-concurrency-and-lock-ordering)
18. [Reversal/Refund Compensation](#18-reversalrefund-compensation)
19. [Suspension and Deactivation](#19-suspension-and-deactivation)
20. [Audit Requirements](#20-audit-requirements)
21. [Privacy Projections](#21-privacy-projections)
22. [Fraud Controls](#22-fraud-controls)
23. [Proposed Database Schema](#23-proposed-database-schema)
24. [Constraints and Indexes](#24-constraints-and-indexes)
25. [Proposed APIs](#25-proposed-apis)
26. [Error Codes](#26-error-codes)
27. [Acceptance Test Matrix](#27-acceptance-test-matrix)
28. [Deferred Scope](#28-deferred-scope)
29. [Bryan Open Decisions — ALL 26 RESOLVED](#29-bryan-open-decisions--all-26-numbered-decisions-resolved--final-document-audit-pending)
30. [Proposed P5-S1 through P5-S8 Breakdown](#30-proposed-p5-s1-through-p5-s8-breakdown)

---

## 1. Purpose and Scope

### 1.1 Purpose

The Agent & Commission Engine is the system responsible for:

- Managing the **agent (代理) activation lifecycle** — from application through activation, suspension, and deactivation.
- Recording and enforcing **referral relationships** (who referred whom) as a global account-level relationship.
- Computing, earning, and tracking **commissions** generated from multiple sources (agent upgrades, member consumption, merchant recruitment).
- Maintaining an **immutable commission ledger** that preserves historical snapshots of rate versions, calculation bases, and audit trails.
- Supporting **reversal/refund compensation** through exact-opposite ledger entries without mutating original records.
- Projecting commission data to different actor views (agent, admin) with appropriate privacy constraints.

### 1.2 Scope

**IN SCOPE (P5-S0 contractual):**

- Agent activation state machine (10 states defined)
- Referral ownership rules and tree invariants
- Commission source definitions and eligibility rules
- Exact commission formulas (Agent Upgrade G1/G2, Member Consumption G1/G2, Merchant Recruitment)
- Rate versioning and snapshot rules
- Market/currency isolation and decimal precision rules
- Immutable ledger model and state machine
- Idempotency and concurrency rules
- Reversal/refund compensation rules
- Suspension/deactivation rules for commission eligibility
- Audit and privacy projection requirements
- Fraud control framework
- Proposed DB schema, indexes, APIs, error codes, and test matrix
- Bryan Open Decisions (26 items) — ALL 26 NUMBERED DECISIONS RESOLVED. D-01, D-05, D-06, D-07, D-08, D-09, D-10, D-11, D-12, D-13, D-14, D-15, D-16, D-17, D-18, D-19, D-20, D-21, D-22, D-23, D-24, D-25, D-26 now APPROVED_AND_FROZEN. D-02, D-03, D-04 marked NOT_APPLICABLE

**OUT OF SCOPE (P5-S0 contractual):**

- Five-Level Team Reward (DEFERRED — see Section 28)
- Actual production implementation of controllers, services, migrations (P5-S1 onwards)
- Payout/withdrawal mechanics (future authorization)
- Expiry rules (future authorization)
- Admin Adjustment UI (future authorization)
- Tax withholding (DEFERRED — future phase)
- KYC integration (DEFERRED — future phase for payout/wallet gate only)

### 1.3 Document Authority

This contract inherits authority from:

- **DOCUMENT_AUTHORITY.md** — governance document hierarchy
- **Phase 3 Wallet/Reward Contract** (frozen at P3 baseline `2ed57f4e`)
- **Phase 4 Transaction/Correction Contract** (frozen at P4 baseline `87ea05aa` / governance `8f04a8ac`)

---

## 2. Terminology

| Term                           | Definition                                                                                                                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent (代理)**               | A member who has completed the agent activation process (fee + course + approval) and holds ACTIVE status.                                                                                                                    |
| **Referral Code (推荐码)**     | A unique alphanumeric code assigned to every member, used to identify the referring party.                                                                                                                                    |
| **Referrer (推荐人)**          | The member whose referral code was used during registration. A global account-level relationship.                                                                                                                             |
| **Referee (被推荐人)**         | The member who registered using a referrer's referral code.                                                                                                                                                                   |
| **Direct Referral (直接推荐)** | The immediate referrer of a member. One account has exactly one direct referrer (or none).                                                                                                                                    |
| **Generation (代)**            | The distance from a member in the referral tree. G1 = direct referrer, G2 = referrer's referrer.                                                                                                                              |
| **Agent Activation**           | The process by which a member becomes an ACTIVE agent, requiring RM388 fee payment (MY market default; other markets: market-configurable per D-08 frozen), course completion, qualification approval, and system activation. |
| **Commission (佣金)**          | A monetary reward earned by an ACTIVE agent based on defined source events, computed by exact formulas.                                                                                                                       |
| **Ledger Entry**               | An immutable record of a commission event. Never modified or deleted.                                                                                                                                                         |
| **Reversal Compensation**      | An exact-opposite ledger entry created when an original transaction is reversed or refunded.                                                                                                                                  |
| **Rate Version**               | A versioned set of commission rates. Each ledger entry references the rate version at time of calculation.                                                                                                                    |
| **Service Fee (服务费)**       | The recognized merchant service fee as confirmed by the Phase 4 Transaction Engine.                                                                                                                                           |
| **Market (市场)**              | An independent operational region (e.g., MY, SG). Commission balances are per-market.                                                                                                                                         |
| **Source Event**               | The business event that triggers commission calculation (e.g., agent activation, transaction confirmation).                                                                                                                   |

---

## 3. Actors and Permissions

### 3.1 Actors

| Actor             | Description                                                                      |
| ----------------- | -------------------------------------------------------------------------------- |
| **Member**        | Any registered iPoint member. Has a unique referral code. Can refer others.      |
| **Agent**         | A member with ACTIVE agent status. Eligible to earn commissions.                 |
| **Administrator** | Internal iPoint admin with commission-related permissions (view, adjust, audit). |
| **System**        | Automated processes: commission engine, ledger writer, compensation handler.     |

### 3.2 Permission Matrix

| Action                              | Member | Agent | Admin        | System                     |
| ----------------------------------- | ------ | ----- | ------------ | -------------------------- |
| View own referral code              | ✅     | ✅    | ✅           | ✅                         |
| View own referral tree (anonymized) | ✅     | ✅    | ✅           | ✅                         |
| View own commission ledger          | ❌     | ✅    | ✅           | ✅                         |
| View other's commission ledger      | ❌     | ❌    | ✅           | ✅                         |
| View own commission projections     | ❌     | ✅    | ✅           | ✅                         |
| Create admin adjustment             | ❌     | ❌    | ✅ (Maker)   | ✅                         |
| Approve admin adjustment            | ❌     | ❌    | ✅ (Checker) | ✅                         |
| View source transactions (own)      | ✅     | ✅    | ✅           | ✅                         |
| View source transactions (other)    | ❌     | ❌    | ✅           | ✅                         |
| Trigger commission recalculation    | ❌     | ❌    | ❌           | ✅ (via idempotent replay) |
| Suspend/deactivate agent            | ❌     | ❌    | ✅           | ✅                         |

---

## 4. Agent Activation Lifecycle

### 4.1 State Machine

```
                  ┌──────────────────────┐
                  │     NOT_APPLIED      │
                  └──────────┬───────────┘
                             │ Apply (submit agent application)
                             ▼
                  ┌──────────────────────┐
                  │    PENDING_PAYMENT   │
                  └──────────┬───────────┘
                             │ Payment confirmed (RM388 — MY market default; other markets: market-configurable per D-08 frozen)
                             ▼
                  ┌──────────────────────┐
                  │  PAYMENT_CONFIRMED   │
                  └──────────┬───────────┘
                             │ Course enrolled/registered
                             ▼
                  ┌──────────────────────┐
                  │    COURSE_PENDING    │
                  └──────────┬───────────┘
                             │ Course completed
                             ▼
                  ┌──────────────────────┐
                  │   COURSE_COMPLETED   │
                  └──────────┬───────────┘
                             │ Qualification approval submitted
                             ▼
                  ┌──────────────────────┐
                  │  PENDING_APPROVAL    │◄──── Awaiting admin approval
                  └──────────┬───────────┘
                             │ Admin approval + system activation (atomic)
                             ▼
                  ┌──────────────────────┐
                  │       ACTIVE          │◄──── Agent can earn commissions
                  └──────┬────────┬──────┘
                         │        │
              Suspend    │        │  Deactivate
              (only from │        │
               ACTIVE)   │        │
                         ▼        ▼
              ┌──────────────┐  ┌──────────────┐
              │  SUSPENDED   │  │ DEACTIVATED  │
              └──────┬───────┘  └──────────────┘
                     │ Reactivate
                     ├─────────────────────────────► ACTIVE
                     │ (if conditions met)
                     │
              Can also transition: ◄──────────────────
              DEACTIVATED → NOT_APPLIED (if re-application allowed — OPEN)
              REJECTED    → reapplication flow [OPEN]
              COURSE_COMPLETED → REJECTED (by admin; alternative to PENDING_APPROVAL)
              Any pre-ACTIVE state → REJECTED (by admin)

                  ┌──────────────────────┐
                  │      REJECTED        │
                  └──────────────────────┘
```

### 4.2 State Definitions

**FROZEN:**

| State             | Code                | Description                                                                                                                     | Eligible for Commission |
| ----------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Not Applied       | `NOT_APPLIED`       | Member has not applied for agent status                                                                                         | ❌                      |
| Pending Payment   | `PENDING_PAYMENT`   | Application submitted, awaiting fee (MY: RM388; other markets: market-configurable per D-08 frozen)                             | ❌                      |
| Payment Confirmed | `PAYMENT_CONFIRMED` | Fee received by system (MY: RM388; other markets: market-configurable per D-08 frozen)                                          | ❌                      |
| Course Pending    | `COURSE_PENDING`    | Awaiting course completion                                                                                                      | ❌                      |
| Course Completed  | `COURSE_COMPLETED`  | Training course fulfilled                                                                                                       | ❌                      |
| Pending Approval  | `PENDING_APPROVAL`  | Qualification approval submitted, awaiting admin review                                                                         | ❌                      |
| Active            | `ACTIVE`            | Fully activated agent (admin approval + system activation completed atomically)                                                 | ✅                      |
| Suspended         | `SUSPENDED`         | Temporarily suspended from **ACTIVE** only; no new commission during suspension; no holding period (D-01 frozen: Direct EARNED) | ❌ (during suspension)  |
| Deactivated       | `DEACTIVATED`       | Permanently deactivated from **ACTIVE** only; no future commission; existing EARNED preserved                                   | ❌ (new events)         |
| Rejected          | `REJECTED`          | Application rejected at any pre-ACTIVE stage (including PENDING_APPROVAL)                                                       | ❌                      |

**OPEN (for Bryan):**

- Whether DEACTIVATED can re-apply (transition to NOT_APPLIED)
- Whether Course can be re-taken after FAIL
- Treatment of courses in markets without physical training infrastructure
- Whether PENDING_APPROVAL has a maximum waiting period

**Non-numbered Product Open Items (2):**

1. **Agent Reapplication Policy** — Whether a REJECTED applicant can re-apply (transition back to NOT_APPLIED or PENDING_PAYMENT).
   This is NOT numbered D-27; it is a standalone Open Item.
   **Blocking:** Does NOT block P5-S1 schema (schema is compatible either way).

2. **Merchant/Branch Attribution Change Policy** — Whether committed merchant/branch attribution records can be changed (policy decision outside D-15 scope).
   Error code MERCHANT_ATTRIBUTION_CHANGE_REJECTED reserved; behavior pending Bryan.
   **Blocking:** Does NOT block P5-S1 schema (schema is compatible either way).

### 4.3 Activation Requirements

An agent **must** satisfy all four conditions before reaching ACTIVE:

| #   | Requirement                                                              | Verification                                                            | Notes                                                                                                                |
| --- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | Fee paid (MY: RM388; other markets: market-configurable per D-08 frozen) | Payment gateway confirmation                                            | MY default RM388; other markets must configure before opening. Fee Version applies prospectively only — no backfill. |
| 2   | Company course completed                                                 | Course system completion record                                         | Course content out of scope                                                                                          |
| 3   | Qualification approved                                                   | Admin approval                                                          | Criteria out of scope                                                                                                |
| 4   | System activated                                                         | Admin approval command atomically transitions PENDING_APPROVAL → ACTIVE | No separate toggle; approval and activation are a single atomic operation                                            |

### 4.4 Activation Timing

- Agent Activation **date-time** (effective_time) is the system timestamp (activated_at) when the ACTIVE state is entered via the atomic approval+activation action.
- This timestamp is used for:
  - Determining when commission eligibility begins.
  - Snapshot of commission rates at time of activation (for rate version reference).
  - Recorded as effective_time in the commission ledger entry.

---

## 5. Referral Ownership

### 5.1 Core Rules

**FROZEN:**

1. **Unique Referral Code:** Every member receives exactly one unique referral code upon registration. This code is globally unique across all markets.
2. **One Direct Referrer:** A member can have at most one (1) direct referrer. Once set, the referrer relationship is **immutable** — it cannot be changed, transferred, or re-assigned.
3. **Self-Referral Prohibited:** A member cannot refer themselves. System must prevent a referral code from being used with the same account.
4. **Referral Cycle Prohibited:** Referral relationships must form a directed acyclic graph (DAG). Cycles (A refers B, B refers A, or longer cycles) are prohibited at registration time.
5. **Global Relationship:** The referral relationship is a **global account relationship**. It is not market-specific. A member referred in Market MY who later moves to Market SG retains the same referrer.
6. **No Compression:** If an upstream agent is not ACTIVE or is disqualified, the referral tree does **not** compress or skip generations. An ineligible beneficiary does not cause the commission to "move up" to the next eligible agent. The commission for that generation is simply not earned (no alternative beneficiary).
7. **No Beneficiary Substitution:** No mechanism exists to substitute a different beneficiary for any generation.

**CONFIGURABLE:**

- Referral code format and length (must be alphanumeric, case-insensitive by default)

### 5.2 Referral Code Assignment

- Created at member registration.
- Must be unique across all members.
- Should be resistant to guessability (minimum length + checksum or random generation).
- Referral code is a permanent identifier; it cannot be recycled or reassigned after member deactivation/deletion.

### 5.3 Referral Relationship Recording

On new member registration:

```
IF referral_code provided AND valid:
  referrer = lookup member by referral_code
  IF referrer.id == new_member.id → REJECT (self-referral)
  IF creates cycle → REJECT (cycle detected via ancestor traversal)
  SET new_member.referrer_id = referrer.id
  INSERT referral_record (referee_id, referrer_id, created_at)
ELSE:
  new_member.referrer_id = NULL (no referrer)
```

### 5.4 Referral Relationship Immutability (APPROVED_AND_FROZEN)

Once committed:

- referrer_id is **immutable forever** — cannot be updated, corrected, or reassigned under any circumstances.
- No exceptions. No system-level correction. No admin correction. No time-limited window.
- This immutability is permanent and applies retrospectively to all existing referral relationships.
- **D-15 frozen:** Completely disallow correction (Option A).

---

## 6. Referral-Tree Invariants

The following invariants must be enforced by the system at all times:

| #   | Invariant                                                          | Enforcement Point                                           | Violation Action                    |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------- |
| 1   | Each member has 0 or 1 referrer                                    | Registration, attempted unauthorized update                 | Reject                              |
| 2   | No member can refer themselves                                     | Registration                                                | Reject with SELF_REFERRAL error     |
| 3   | No directed cycles in referral graph                               | Registration (ancestor walk), attempted unauthorized update | Reject with REFERRAL_CYCLE error    |
| 4   | Referral code is unique                                            | Registration, Code generation                               | Reject                              |
| 5   | Referral code is permanent                                         | Never                                                       | Not applicable                      |
| 6   | Referrer_id is immutable forever — no exceptions, no corrections   | Update, attempted unauthorized update                       | Reject with REFERRAL_IMMUTABLE      |
| 7   | Agent cannot have commission eligibility before ACTIVE             | Commission calculation                                      | Check agent status                  |
| 8   | Maximum depth of commission calculation = 2 (G1, G2)               | Commission calculation                                      | G3+ ignored                         |
| 9   | Each source event + generation produces at most 1 commission entry | Commission writing                                          | Idempotency check                   |
| 10  | No compression of ineligible beneficiaries                         | Commission calculation                                      | Skip generation, do not re-allocate |

---

## 7. Commission Source Matrix

**FROZEN:**

| Source               | Type                               | Generation(s)       | Rate Base                                                                                        | Beneficiary                             |
| -------------------- | ---------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------- |
| Agent Upgrade        | Activation of new agent            | G1, G2              | Fixed amount (RM88/RM38 — MY market default; other markets: market-configurable per D-09 frozen) | Referrer (G1), Referrer's referrer (G2) |
| Member Consumption   | Recognized transaction service fee | G1, G2              | Service fee × rate                                                                               | Referrer (G1), Referrer's referrer (G2) |
| Merchant Recruitment | Recognized merchant service fee    | G1 (one generation) | Service fee × rate                                                                               | The member who recruited the merchant   |

### 7.1 Source Event Details

#### Agent Upgrade Commission

- **Trigger:** A member completes the full activation process and enters ACTIVE status.
- **Not triggered by:** Payment alone, course completion alone, or approval alone.
- **Rate:** Fixed amounts: G1 = RM88, G2 = RM38 (MY market default; other markets: market-configurable per D-09 frozen). MY defaults apply; other markets must configure. Rate Version applies prospectively only — no backfill. Historical activations are NOT recalculated.
- **Max per source and generation:** One (1) commission entry per activation, per generation. If the same referrer refers multiple agents, each activation generates separate G1 commissions.
- **Calculation timing:** At the Confirm time of the activation event (activated_at / effective_time).
- **Snapshot captured:**
  - activation event ID
  - activation ACTIVE timestamp
  - activation payment market
  - activation payment reference
  - fixed commission rate version
  - G1/G2 beneficiary snapshot
  - beneficiary status at activation time

#### Member Consumption Commission

- **Trigger:** A transaction's recognized service fee is confirmed by the Phase 4 Transaction Engine at CONFIRMED status.
- **Not based on:** Gross transaction amount. The basis is the **confirmed merchant service fee snapshot** from the transaction engine at Confirm time.
- **Rate:** G1 = 1.0% of recognized service fee, G2 = 0.5% of recognized service fee.
- **Calculation timing:** At **Transaction Confirm Time.** The commission engine uses the immutable service-fee snapshot confirmed by Phase 4 at Confirm time. Commission is calculated immediately on Confirm. Subsequent reversal/refund is handled via exact-opposite compensation entries (see Section 18), not by delaying original commission creation.

#### Merchant Recruitment Commission

- **Trigger:** A transaction is CONFIRMED. The merchant's attribution (recruiter) is looked up at Confirm time. Commission is calculated immediately using the service-fee snapshot at Confirm time.
- **Not based on:** Merchant turnover or total sales.
- **Rate:** 0.5% of recognized service fee.
- **One generation only:** The member who recruited the merchant (the referrer at merchant registration).
- **Who recruits:** The member whose referral code was used when the merchant registered as a merchant account on iPoint.
- **Recruiter eligibility (D-05 frozen — ACTIVE per transaction):** The merchant recruiter must be ACTIVE at the time of each transaction's Confirm time. If the recruiter is not ACTIVE at Confirm time, no commission is earned for that transaction. ACTIVE status is checked per transaction, not only at merchant registration time.
- **Parent vs Branch Attribution (D-19 frozen):** Parent-level merchant transactions use parent-level recruiter attribution. Branch-level transactions use branch-specific recruiter attribution. There is NO fallback to parent recruiter if branch recruiter is inactive — independent branch attribution, no inheritance.

### 7.2 Rate Summary Table

**FROZEN — MY defaults; other markets market-configurable per D-09 frozen:**

| Commission Type      | G1 Rate                                                                              | G2 Rate                                                                              | Basis                  |
| -------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------- |
| Agent Upgrade        | RM88 (fixed — MY market default; other markets: market-configurable per D-09 frozen) | RM38 (fixed — MY market default; other markets: market-configurable per D-09 frozen) | Per activation event   |
| Member Consumption   | 1.0%                                                                                 | 0.5%                                                                                 | Recognized service fee |
| Merchant Recruitment | 0.5%                                                                                 | N/A                                                                                  | Recognized service fee |

---

## 8. Eligibility Rules

**FROZEN:**

### 8.1 Agent Status Eligibility

| Condition                                       | Effect                               |
| ----------------------------------------------- | ------------------------------------ |
| Referrer is ACTIVE at time of source event      | ✅ Commission is earned              |
| Referrer is NOT_APPLIED                         | ❌ No commission for that generation |
| Referrer is PENDING_PAYMENT                     | ❌                                   |
| Referrer is PAYMENT_CONFIRMED                   | ❌                                   |
| Referrer is COURSE_PENDING                      | ❌                                   |
| Referrer is COURSE_COMPLETED                    | ❌                                   |
| Referrer is PENDING_APPROVAL                    | ❌                                   |
| Referrer is SUSPENDED at time of source event   | ❌ No commission for that generation |
| Referrer is DEACTIVATED at time of source event | ❌ No commission for that generation |
| Referrer is REJECTED                            | ❌                                   |

**Merchant Recruiter (D-05 frozen — ACTIVE per transaction):**

- Merchant recruiter must be ACTIVE at the time of **each** transaction's Confirm time.
- If merchant recruiter is not ACTIVE at Confirm time: no Merchant Recruitment commission for that transaction.
- ACTIVE status is evaluated per transaction independently.
- This is a **frozen** rule per D-05 (Option A).

**Branch/No Fallback Rule (D-19 frozen):**

- Branch transactions are attributed to the branch's own recruiter.
- If the branch has no recruiter or the branch recruiter is not ACTIVE at Confirm time, the commission is NOT earned — there is NO fallback to the parent merchant's recruiter.
- This rule enforces independent branch attribution per D-19 frozen.

### 8.2 Generation Eligibility

**FROZEN — Generations are independent:**

- G1: The direct referrer. Must be an ACTIVE agent at source event time.
- G2: The referrer's referrer. Must be an ACTIVE agent at source event time.
- **G1 and G2 eligibility is INDEPENDENT.** Each generation's eligibility is evaluated separately against its fixed beneficiary.
- If G1 referrer is not ACTIVE: G1 commission is not generated. G2's eligibility is unaffected — G2 receives their G2 commission if they are ACTIVE.
- If G2 referrer is not ACTIVE: G2 commission is not generated. G1 receives their commission if they are ACTIVE.
- **No compression:** If G1 is ineligible, G2 does not "move up" to G1. G2 receives G2 rate, not G1 rate.
- **No reallocation:** Ineligible commission for a generation is simply not generated. No alternative beneficiary receives that generation's commission.

### 8.3 Source Event Eligibility

| Commission Type      | Event must be...                 | Notes                                                                                              |
| -------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------- |
| Agent Upgrade        | First-time activation of referee | Each activation pays at most once                                                                  |
| Member Consumption   | Transaction CONFIRMED            | Calculated at Transaction CONFIRMED time. Subsequent REVERSED/REFUNDED creates compensation entry. |
| Merchant Recruitment | Transaction CONFIRMED            | Calculated at Transaction CONFIRMED time. Subsequent REVERSED/REFUNDED creates compensation entry. |

### 8.4 Timing Eligibility

- Commission is calculated and recorded at the **Transaction CONFIRMED time** (not when initiated, and not waiting for a correction/refund window).
- The snapshot used is the state at Confirm time: service-fee snapshot, rate version, and agent status at that moment.
- Any subsequent transaction status change (REVERSED, REFUNDED) is handled through Compensation Entries (see Section 18), not by modifying or retroactively adjusting the original commission.
- Agent Upgrade: At the moment activated_at (effective_time) is committed.
- Member Consumption: At Transaction CONFIRMED time (service_fee_confirmed_at).
- Merchant Recruitment: At Transaction CONFIRMED time.

### 8.5 Agent Revocation Eligibility Cut-off

**FROZEN (D-06 — T1 Exact Revocation Timestamp):**

Agent upgrade commissions for Agent Upgrade / Member Consumption / Merchant Recruitment source events apply the following cut-off rule when the upstream agent's activation has been revoked:

```
eligible = (agent_status_at_source = ACTIVE) AND (source_event_time < revoked_at OR revoked_at IS NULL)
```

- **agent_status_at_source**: The ACTIVE/not-ACTIVE status of the beneficiary agent at the source event time.
- **revoked_at**: The exact system timestamp (T1) when the agent's activation was revoked (NULL if never revoked).
- **source_event_time**: The timestamp of the source event being evaluated.

**Rules:**

1. If the agent was ACTIVE at source_event_time **and** their activation had not yet been revoked (source_event_time < revoked_at), the commission is eligible.
2. If the agent was ACTIVE at source_event_time but their activation was later revoked, the pre-revocation commission is **retained** — no clawback (D-06 frozen).
3. If the agent was **not** ACTIVE at source_event_time, the commission is ineligible regardless of revocation status.
4. This rule applies uniformly to: Agent Upgrade (G1/G2), Member Consumption (G1/G2), and Merchant Recruitment.
5. **Implementation:** The eligibility check MUST evaluate both `agent_status_at_source = ACTIVE` AND `(source_event_time < revoked_at OR revoked_at IS NULL)` as a single combined predicate.

---

## 9. Exact Formulas

### 9.1 Agent Upgrade Commission

```
G1_commission = DECIMAL("88.00")    [MY default; other markets market-configurable per D-09 frozen]
G2_commission = DECIMAL("38.00")    [MY default; other markets market-configurable per D-09 frozen]

Constraints:
  - Only one G1 entry per activation event
  - Only one G2 entry per activation event
  - G1 (referrer) must be ACTIVE at activation_timestamp
  - G2 (referrer's referrer) must be ACTIVE at activation_timestamp
  - G1 and G2 eligibility is evaluated **independently**.
    - If G1 is not ACTIVE → no G1 commission, G2 still evaluated independently
    - If G2 is not ACTIVE → no G2 commission, G1 still proceeds
  - Payment alone does NOT trigger commission
```

### 9.2 Member Consumption Commission

```
recognized_service_fee = transaction.service_fee_amount   [from Phase 4 Transaction Engine]

G1_commission = recognized_service_fee × DECIMAL("0.01")     [1%]
G2_commission = recognized_service_fee × DECIMAL("0.005")    [0.5%]

Constraints:
  - recognized_service_fee is the confirmed, immutable service fee at Confirm time
  - Not based on gross transaction amount
  - G1 referrer must be ACTIVE at transaction CONFIRMED time
  - G2 referrer's referrer must be ACTIVE at transaction CONFIRMED time
  - G1 and G2 eligibility is evaluated **independently**.
    - If G1 is not ACTIVE → no G1 commission, G2 still evaluated independently
    - If G2 is not ACTIVE → no G2 commission, G1 still proceeds
  - Calculated at Transaction CONFIRMED time using Confirm-time snapshot
  - Subsequent reversal/refund does NOT retroactively affect original entry
```

### 9.3 Merchant Recruitment Commission

```
recognized_service_fee = transaction.service_fee_amount   [from Phase 4 Transaction Engine]

Commission = recognized_service_fee × DECIMAL("0.005")    [0.5%]

Constraints:
  - One generation only
  - Beneficiary is the member who recruited the merchant (merchant.recruiter_member_id)
  - Merchant must have a registered recruiter member
  - **D-05 frozen: Merchant recruiter must be ACTIVE at each transaction Confirm time.**
    ACTIVE status is checked per transaction, not only at merchant registration time.
    If recruiter is not ACTIVE at Confirm time: no commission for that transaction.
```

### 9.4 Reversal/Refund Compensation

```
compensation_amount = original_entry.amount × DECIMAL("-1.0000000000")

Entry type: REVERSAL_COMPENSATION or REFUND_COMPENSATION
Original entry: locked by reversal_linkage
New entry: exact opposite of original entry amount
```

### 9.5 Rounding Application

**FROZEN:**

1. **Independent line rounding (D-24 frozen):** Each commission entry is independently rounded at posting scale before storage. There is no cross-entry aggregation or allocation of rounding residuals.
2. **Rounding mode:** `HALF_UP` (java.math.RoundingMode.HALF_UP / equivalent).
3. **Calculation scale:** All intermediary arithmetic uses 10 decimal places (10dp). Final result is rounded to **posting scale** (currency minor unit; 2dp for MYR/SGD).
4. **Residual (D-25 frozen):** Sub-minor-unit residuals below posting scale are **not allocated**. The company retains residuals. They are recorded in the snapshot for audit-only purposes — no ledger entry is created for the residual.
5. **Zero-rounded (D-26 frozen):** If the commission amount rounds to zero at posting scale, the entry is **skipped and logged** (see Section 12.6). No zero-amount ledger entry is created.
6. **Rounding formula:**
   ```
   unrounded_amount = DECIMAL calculation at 10dp precision
   posted_amount    = ROUND_HALF_UP(unrounded_amount, posting_scale)
   residual_amount  = unrounded_amount - posted_amount  (absolute magnitude < 10^(-posting_scale))
   ```
   If `ABS(posted_amount) < 10^(-posting_scale)` (i.e., rounds to zero), the entry is skipped per D-26.

---

## 10. Rate Versioning

### 10.1 Rate Version Schema

Each commission rate must be versioned and stored immutably.

**Rate Version Record:**

| Field           | Type           | Description                                                     |
| --------------- | -------------- | --------------------------------------------------------------- |
| rate_version_id | UUID           | Unique version identifier                                       |
| commission_type | VARCHAR        | One of: AGENT_UPGRADE, MEMBER_CONSUMPTION, MERCHANT_RECRUITMENT |
| generation      | INT            | 1 or 2 (0 for single-gen types)                                 |
| market          | VARCHAR(2)     | Market code (MY, SG, etc.)                                      |
| rate_value      | NUMERIC(38,10) | The rate value (decimal percentage or fixed amount)             |
| rate_type       | VARCHAR        | PERCENTAGE or FIXED                                             |
| effective_from  | TIMESTAMPTZ    | Start of validity                                               |
| effective_until | TIMESTAMPTZ    | End of validity (NULL = current)                                |
| created_by      | VARCHAR        | Who created this rate version                                   |
| created_at      | TIMESTAMPTZ    | When created                                                    |

### 10.2 Snapshot Rules

- Every commission ledger entry must reference the **rate_version_id** that was effective at the time of the source event.
- Historical rate versions are **immutable** — they cannot be changed after creation.
- When a rate changes, a new rate version is created with a new effective_from timestamp.
- Rate changes may be scheduled (future effective_from) but only one version can be effective at any point in time for a given (commission_type, generation, market) combination.
- Commission is always calculated using the rate effective at **source event time**, not at payout time or any later time.

### 10.3 Rate Change Impact

- Rate changes are **prospective only**.
- Existing, already-calculated commission entries are **not** recalculated or adjusted when rates change.
- Rate changes do not trigger re-processing of historical events.

---

## 11. Market and Currency Rules

**FROZEN:**

**D-07 (APPROVED_AND_FROZEN):** Activation Market migration rules are frozen. Agent Upgrade commission market = activation payment market. Account Country change = new market requires independent activation (re-pay + re-course + re-approval). No cross-market transfer or backfill.

### 11.1 Market Assignment

| Commission Type      | Market                               | Rule                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent Upgrade        | Market of the **activation payment** | The market where the activation fee was processed (MY: RM388; other markets: market-configurable per D-08 frozen). [D-07 frozen: Agent Upgrade market = activation payment market; Account Country change requires new independent activation — see below] |
| Member Consumption   | Market of the **transaction**        | The market where the transaction service fee was recognized                                                                                                                                                                                                |
| Merchant Recruitment | Market of the **transaction**        | Same as Member Consumption                                                                                                                                                                                                                                 |

**D-07 Frozen Rules:**

- Agent Qualification is Market-specific.
- Agent Upgrade commission market = market of the activation payment.
- Original market retains agent permanently (once ACTIVE, market is fixed per original activation).
- Account Country change: new market requires **independent activation** (re-pay + re-course + re-approval). The agent does NOT transfer or migrate their existing activation.
- An agent can hold ACTIVE status in multiple markets independently (e.g., MY ACTIVE + SG ACTIVE).
- No cross-market transfer of activation status. No cross-market transfer of commission balances. No cross-market backfill.

### 11.2 Market Isolation

1. Commission balances are **per-market**.
2. **No automatic FX conversion** between markets.
3. **No cross-market ledger merging.**
4. A single agent can have commission balances in **multiple markets** simultaneously.
5. Each ledger entry belongs to exactly one market.
6. All commission calculations within a market use the market's native currency.

### 11.3 Currency

- All amounts within a market are denominated in the market's native currency:
  - MY → MYR (RM)
  - SG → SGD
  - (Other markets as applicable)
- Currency is recorded per ledger entry.
- FX conversion, if ever needed, is a separate future concern (OUT OF SCOPE for P5-S0).

---

## 12. Decimal and Rounding Rules

**FROZEN — All precision and rounding decisions (D-21 through D-26) are APPROVED_AND_FROZEN.**

### 12.1 Storage Precision

All monetary amounts in the commission engine use:

```
NUMERIC(38, 10)   -- database storage
```

### 12.2 Calculation — Decimal Arithmetic Only

- All arithmetic must use **decimal arithmetic** (not floating-point).
- Multiplications: `DECIMAL(a, b) * DECIMAL(c, d) = DECIMAL(a+c, b+d)`.
- Use exact numeric types in all application-layer code. No `float`, `double`, or JavaScript `Number` for commission arithmetic.
- API inputs/outputs use **decimal strings** (e.g., `"88.00"`, `"0.5000000000"`).

### 12.3 Calculation Scale — 10dp (D-21 frozen)

All intermediary arithmetic uses **10 decimal places** (10dp):

```
Calculation scale = 10 decimal places
NUMERIC result of intermediary calculations at 10dp precision
```

- Full storage precision (`NUMERIC(38,10)`) is available but calculations must be carried out at 10dp.
- The final unrounded result is computed at 10dp before rounding to posting scale.

### 12.4 Posting Scale — Currency Minor Unit (D-22 frozen)

Ledger amounts are stored at posting scale (currency minor unit):

| Currency        | Posting Scale                | Example        |
| --------------- | ---------------------------- | -------------- |
| MYR (RM)        | 2 decimal places             | `"88.00"`      |
| SGD             | 2 decimal places             | `"12.50"`      |
| (Other markets) | Currency-specific minor unit | TBD per market |

- The `amount` field in `commission_ledger` stores the value **rounded to posting scale**.
- API responses display amounts at posting scale (2dp for MYR/SGD).
- The unrounded value is preserved in the `rate_snapshot` JSONB for audit.

### 12.8 Display Scale — Always Matches Currency Posting Scale (D-23 APPROVED_AND_FROZEN)

**D-23 frozen (Option C):** Display Scale always matches currency Posting Scale. API responses and UI display amounts at the same precision as posting scale (2dp for MYR/SGD). There is no separate display precision. Sub-cent precision is never shown to agents or admins.

- All display contexts (agent portal, admin panel, CSV exports) use posting scale precision.
- The `rate_snapshot.unrounded_amount` is available for audit but never displayed in user-facing contexts.

### 12.9 No Minimum Posting Threshold (D-20 APPROVED_AND_FROZEN)

**D-20 frozen:** There is no minimum posting amount per commission entry. Any commission that rounds to a non-zero value at posting scale is posted. There is no minimum threshold below which commissions are suppressed or held back.

- This does NOT override the zero-rounded skip behavior (D-26): if the commission rounds to exactly zero at posting scale, it is still skipped.
- Any non-zero rounded amount, however small, is posted as a ledger entry.
- No aggregation or batching of sub-threshold commissions.

### 12.5 Rounding Mode — HALF_UP (D-24 frozen)

```
Rounding Mode: HALF_UP (java.math.RoundingMode.HALF_UP / equivalent)
```

- Rounding is applied **independently per commission entry** (line-level rounding).
- Each entry is rounded from its own 10dp calculation result to posting scale.
- No cross-entry aggregation or allocation of rounding differences.

### 12.6 Residual and Zero-Rounded Handling (D-25, D-26 frozen)

**Residual (D-25 frozen — not allocated):**

- The difference between the unrounded (10dp) amount and the rounded (posting scale) amount is the **residual**.
- Residuals are **not allocated** to any party. They are retained by the company.
- Residual amounts are recorded in the snapshot for **audit-only** purposes.
- No ledger entry is created for residual amounts.

**Zero-Rounded (D-26 frozen — skip and log):**

- If the commission amount rounds to **zero** at posting scale (i.e., `ABS(ROUND_HALF_UP(unrounded, posting_scale)) < 10^(-posting_scale)`), the entry is **skipped**.
- No zero-amount ledger entry is created.
- The skip is recorded in the `commission_processing` record with `completion_outcome = 'SKIPPED_ZERO_AMOUNT'`.
- An audit log entry is created for the skipped entry.

**Rounding workflow:**

```
1. Calculate commission at 10dp precision → unrounded_amount
2. Round unrounded_amount HALF_UP to posting_scale → posted_amount
3. Compute residual = unrounded_amount - posted_amount
4. IF ABS(posted_amount) >= 10^(-posting_scale):
     → Create ledger entry with amount = posted_amount
     → Store (unrounded_amount, posted_amount, residual) in rate_snapshot
   ELSE:
     → Skip ledger entry
     → Set processing outcome = SKIPPED_ZERO_AMOUNT
     → Log audit record
```

### 12.7 Summary of Frozen Precision Parameters

| Parameter                 | Value                                                 | Decided By               |
| ------------------------- | ----------------------------------------------------- | ------------------------ |
| Storage type              | `NUMERIC(38,10)`                                      | Section 12.1             |
| Calculation type          | Decimal arithmetic (no float)                         | Section 12.2             |
| Calculation scale         | 10 decimal places (10dp)                              | D-21 APPROVED_AND_FROZEN |
| Posting scale             | Currency minor unit (2dp MYR/SGD)                     | D-22 APPROVED_AND_FROZEN |
| Display scale             | Matches posting scale (2dp MYR/SGD)                   | D-23 APPROVED_AND_FROZEN |
| Rounding mode             | HALF_UP                                               | D-24 APPROVED_AND_FROZEN |
| Line-level rounding       | Independent per entry                                 | D-24 APPROVED_AND_FROZEN |
| Residual handling         | Not allocated — audit only                            | D-25 APPROVED_AND_FROZEN |
| Zero-rounded skip         | Skip and log                                          | D-26 APPROVED_AND_FROZEN |
| Minimum posting threshold | None (no minimum)                                     | D-20 APPROVED_AND_FROZEN |
| Commission amount basis   | Gross commission (no withholding)                     | D-12 APPROVED_AND_FROZEN |
| Display-only (Phase 5)    | No wallet transfer, no withdrawal, no payout, no PAID | D-10 APPROVED_AND_FROZEN |
| API format                | Decimal strings                                       | Section 12.2             |

---

## 13. Snapshot Rules

### 13.1 What Must Be Snapshot

Each commission ledger entry must capture an immutable snapshot of the data that influenced its calculation:

| Snapshot Field           | Description                                                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rate_version_id          | The commission rate version effective at source event time                                                                                                                               |
| rate_value               | The actual rate value used (copied from rate version at calculation time)                                                                                                                |
| source_event_time        | The timestamp of the source event                                                                                                                                                        |
| source_amount            | The raw amount before rate application (service fee or fixed amount)                                                                                                                     |
| calculation_basis_amount | The final basis amount after any adjustments                                                                                                                                             |
| calculation_scale        | The calculation precision used (frozen: 10)                                                                                                                                              |
| posting_scale            | The posting scale applied (2 for MYR/SGD)                                                                                                                                                |
| rounding_mode            | The rounding mode applied (frozen: HALF_UP)                                                                                                                                              |
| unrounded_amount         | The commission amount at full calculation scale (10dp) before rounding                                                                                                                   |
| posted_amount            | The commission amount after rounding to posting scale                                                                                                                                    |
| residual_amount          | The difference: unrounded_amount - posted_amount (for audit only)                                                                                                                        |
| market                   | The market at time of calculation                                                                                                                                                        |
| currency                 | The currency at time of calculation                                                                                                                                                      |
| agent_status_at_source   | The agent status at source event time (for audit)                                                                                                                                        |
| activation_id            | The agent activation UUID for which eligibility is being evaluated                                                                                                                       |
| revoked_at               | The T1 revocation timestamp of the beneficiary's activation (NULL if never revoked)                                                                                                      |
| reactivated_at           | The timestamp of the beneficiary's most recent reactivation (NULL if never reactivated)                                                                                                  |
| eligibility_result       | Boolean: true if commission is eligible, false if ineligible (per Section 8.5 cut-off rule)                                                                                              |
| eligibility_reason       | Human-readable reason for the eligibility result (e.g., "ACTIVE at source time, not revoked", "ACTIVE at source time but revoked before source_event_time", "not ACTIVE at source time") |

### 13.2 Snapshot Immutability

Once a ledger entry is committed:

- The snapshot is **immutable**.
- No field in the snapshot can be modified.
- If a rate is later changed, historical entries retain their original snapshot.

---

## 14. Immutable Ledger Model

### 14.1 Ledger Entry Structure

**FROZEN:** Ledger is append-only and immutable.

**D-12 frozen:** Commission amount = gross commission. No withholding, no deduction, no tax reduction applied to the commission amount. The `amount` field is the full earned commission before any future withholding.

Each ledger entry:

| Field               | Type           | Description                                                                                                                                                                                                                                                                                                  |
| ------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| entry_id            | UUID           | Unique ledger entry identifier                                                                                                                                                                                                                                                                               |
| public_reference    | VARCHAR        | Human-readable reference (e.g., "COM-20260725-XXXXX")                                                                                                                                                                                                                                                        |
| beneficiary_id      | UUID           | The agent member ID who earns this commission                                                                                                                                                                                                                                                                |
| source_type         | VARCHAR        | Business source: AGENT_ACTIVATION, MEMBER_CONSUMPTION, MERCHANT_TRANSACTION, CORRECTION_EXECUTION, ADMIN_ADJUSTMENT — see Section 14.2                                                                                                                                                                       |
| source_reference    | VARCHAR        | Reference to the source event (e.g., activation_id, transaction_id)                                                                                                                                                                                                                                          |
| market              | VARCHAR(2)     | Market code                                                                                                                                                                                                                                                                                                  |
| currency            | VARCHAR(3)     | ISO currency code (e.g., MYR, SGD)                                                                                                                                                                                                                                                                           |
| amount              | NUMERIC(38,10) | Posted commission amount rounded to posting scale (positive = earn, negative = compensation). This is **gross commission** — no withholding, tax, or deductions applied (D-12 frozen). MYR/SGD = 2dp per D-22 frozen. The unrounded value is stored in rate_snapshot.                                        |
| rate_version_id     | UUID           | Rate version used for calculation                                                                                                                                                                                                                                                                            |
| rate_snapshot       | JSONB          | Full rate details at calculation time. Includes: rate_version_id, rate_value, calculation_scale (10), posting_scale (2), rounding_mode (HALF_UP), unrounded_amount, posted_amount, residual_amount.                                                                                                          |
| calculation_basis   | NUMERIC(38,10) | The basis amount used (service fee or fixed)                                                                                                                                                                                                                                                                 |
| generation          | INT            | Generation (1, 2, or 0 for single-gen)                                                                                                                                                                                                                                                                       |
| entry_type          | VARCHAR        | Economic type: AGENT_UPGRADE_G1_EARN, AGENT_UPGRADE_G2_EARN, MEMBER_CONSUMPTION_G1_EARN, MEMBER_CONSUMPTION_G2_EARN, MERCHANT_RECRUITMENT_EARN, REVERSAL_COMPENSATION, REFUND_COMPENSATION, ADMIN_ADJUSTMENT. LOCKED at creation, never updated. See Section 14.2 for source_type vs entry_type distinction. |
| posting_status      | VARCHAR        | Fixed at creation: **EARNED (frozen: Direct Earned per D-01)**. Commission is always EARNED immediately upon calculation. No PENDING status used. This field is the initial bookkeeping classification — use `current_status` for operational queries.                                                       |
| canonical_entry_key | VARCHAR(255)   | Server-derived canonical entry key for internal deduplication (see Section 16).                                                                                                                                                                                                                              |
| processing_id       | UUID           | Optional FK to commission_processing                                                                                                                                                                                                                                                                         |
| effective_time      | TIMESTAMP      | When the source event occurred                                                                                                                                                                                                                                                                               |
| created_at          | TIMESTAMP      | When this ledger entry was created                                                                                                                                                                                                                                                                           |
| reversal_linkage    | UUID           | NULL or the original entry_id that this compensates                                                                                                                                                                                                                                                          |
| audit_linkage       | VARCHAR        | Link to audit event, if any                                                                                                                                                                                                                                                                                  |
| notes               | TEXT           | Optional notes (e.g., admin adjustment reason)                                                                                                                                                                                                                                                               |

### 14.2 Source Types and Entry Types

**FROZEN — Two distinct concepts.**

- **`source_type`** (business source): Identifies the business event that triggered commission calculation.
  Values: `AGENT_ACTIVATION`, `MEMBER_CONSUMPTION`, `MERCHANT_TRANSACTION`, `CORRECTION_EXECUTION`, `ADMIN_ADJUSTMENT`.
  This field answers _"What business event caused this commission?"_

- **`entry_type`** (economic type): Identifies the economic nature of the ledger entry.
  Values: `AGENT_UPGRADE_G1_EARN`, `AGENT_UPGRADE_G2_EARN`, `MEMBER_CONSUMPTION_G1_EARN`, `MEMBER_CONSUMPTION_G2_EARN`, `MERCHANT_RECRUITMENT_EARN`, `REVERSAL_COMPENSATION`, `REFUND_COMPENSATION`, `ADMIN_ADJUSTMENT`.
  This field answers _"What type of commission event is this?"_

**Mapping from source_type to expected entry_type values:**

| source_type          | Possible entry_types                                   |
| -------------------- | ------------------------------------------------------ |
| AGENT_ACTIVATION     | AGENT_UPGRADE_G1_EARN, AGENT_UPGRADE_G2_EARN           |
| MEMBER_CONSUMPTION   | MEMBER_CONSUMPTION_G1_EARN, MEMBER_CONSUMPTION_G2_EARN |
| MERCHANT_TRANSACTION | MERCHANT_RECRUITMENT_EARN                              |
| CORRECTION_EXECUTION | REVERSAL_COMPENSATION, REFUND_COMPENSATION             |
| ADMIN_ADJUSTMENT     | ADMIN_ADJUSTMENT                                       |

**FROZEN:**

| entry_type                 | Description                                                                |
| -------------------------- | -------------------------------------------------------------------------- |
| AGENT_UPGRADE_G1_EARN      | Agent upgrade commission, generation 1                                     |
| AGENT_UPGRADE_G2_EARN      | Agent upgrade commission, generation 2                                     |
| MEMBER_CONSUMPTION_G1_EARN | Member consumption commission, generation 1                                |
| MEMBER_CONSUMPTION_G2_EARN | Member consumption commission, generation 2                                |
| MERCHANT_RECRUITMENT_EARN  | Merchant recruitment commission                                            |
| REVERSAL_COMPENSATION      | Compensation for transaction reversal                                      |
| REFUND_COMPENSATION        | Compensation for transaction refund                                        |
| ADMIN_ADJUSTMENT           | Manual adjustment by admin — Maker/Checker (D-13/D-14 APPROVED_AND_FROZEN) |

**DEFERRED (future authorization):**

| Source Type Code | Description                 |
| ---------------- | --------------------------- |
| EXPIRY           | Commission expiry reversal  |
| PAYOUT           | Commission payout deduction |

**D-10 frozen — Phase 5 is Display-only:** PAID, PAYOUT, and wallet transfer are NOT available in Phase 5. No commission payout, withdrawal, or wallet transfer functionality. PAID status is a future concern only.

### 14.3 Immutability Rules

1. **No UPDATE.** Ledger entries are INSERT-only.
2. **No DELETE.** Ledger entries cannot be removed.
3. **No in-place modification.** Errors are corrected via compensating entries, not by altering the original.
4. **commission_ledger is NEVER UPDATED.** The initial economic classification is fixed at creation and cannot be changed.
5. **Current operational status is derived** from append-only `commission_status_event` records, not from the ledger entry itself.
6. **Compensation does NOT modify the original Entry.** Reversals/refunds are handled by creating new compensation entries (REVERSAL_COMPENSATION or REFUND_COMPENSATION) linked via reversal_linkage.
7. **Reversal linkage** is set at creation time for compensation entries.

---

## 15. Commission State Machine

### 15.1 Entry Type (Fixed at Creation)

**FROZEN:** Entry type is set at ledger entry creation time and is never updated.

| Entry Type                 | Description                                                                |
| -------------------------- | -------------------------------------------------------------------------- |
| AGENT_UPGRADE_G1_EARN      | Agent upgrade commission, generation 1                                     |
| AGENT_UPGRADE_G2_EARN      | Agent upgrade commission, generation 2                                     |
| MEMBER_CONSUMPTION_G1_EARN | Member consumption commission, generation 1                                |
| MEMBER_CONSUMPTION_G2_EARN | Member consumption commission, generation 2                                |
| MERCHANT_RECRUITMENT_EARN  | Merchant recruitment commission                                            |
| REVERSAL_COMPENSATION      | Compensation entry for source event reversal                               |
| REFUND_COMPENSATION        | Compensation entry for source event refund                                 |
| ADMIN_ADJUSTMENT           | Manual adjustment by admin — Maker/Checker (D-13/D-14 APPROVED_AND_FROZEN) |

**IMPORTANT:** `entry_type` is the **economic classification** (what type of commission this entry represents). `posting_status` is a **separate column** that holds the initial bookkeeping classification. **Per D-01 frozen: posting_status is always EARNED.** There is no PENDING status. `current_status` is derived from the latest `commission_status_event`, not from `posting_status`.

**D-10 frozen — PAID is a future phase concern:** PAID status is NOT used in Phase 5. Phase 5 is display-only (no wallet transfer, no withdrawal, no payout). PAID status transitions are deferred to a future phase. No PAID-related status events exist in this contract.

### 15.2 Status Events (Append-only commission_status_event)

Status changes are tracked via **append-only events**, not by updating the ledger entry:

```
commission_ledger entry created with posting_status = EARNED
  ↓
commission_status_event: { event_id, entry_id, from_status: null, to_status: EARNED, reason: "created (D-01 frozen: Direct Earned)", ... }
```

**Simplified State Machine (D-01 frozen — Direct EARNED):**

- Every commission is created directly as EARNED. No PENDING state.
- No PENDING→EARNED transition needed.
- No PENDING→CANCELLED transition needed.
- No release event, no holding period, no release jobs.
- Commission is earned at calculation time and remains EARNED in the ledger.
- Subsequent reversals/refunds create compensation entries; the original EARNED entry is never modified.

Current effective status (`current_status`) is projected from the **latest** status event for each entry.

### 15.3 Allowable Status Transitions (D-01 simplified)

| From   | To                     | Trigger                    | Authorization | Notes                                         |
| ------ | ---------------------- | -------------------------- | ------------- | --------------------------------------------- |
| (null) | EARNED                 | Commission calculation     | System        | Initial creation — D-01 frozen: Direct EARNED |
| EARNED | (no direct transition) | Compensation via new entry | System        | Frozen                                        |

**Frozen notes:**

- **D-01 (APPROVED_AND_FROZEN):** Direct EARNED. No PENDING state exists. No CANCELLED state exists for post-earning cancellation.
- **D-02, D-03, D-04 (NOT_APPLICABLE_UNDER_D01_B):** These decisions are not applicable because D-01 resolved to Option B (Direct EARNED). No PENDING release event, holding period, or PENDING+suspension handling needed.
- **Error codes for CANCELLED are not required** (post-earning cancellation not enabled per D-01 frozen).
- All commissions are created with `posting_status = EARNED` and `to_status = EARNED` in the status event.

---

## 16. Idempotency

### 16.1 Key Separation: Transport / Canonical Processing / Canonical Entry

The system uses **three distinct idempotency key types**:

| Key Type                      | Location                                         | Purpose                                                                                      | Format                                                                                                             |
| ----------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Transport Idempotency-Key** | HTTP `Idempotency-Key` header                    | Client-provided request deduplication token for HTTP-level retries. Not stored in ledger.    | UUID (client-generated)                                                                                            |
| **Canonical Processing Key**  | `commission_processing.canonical_processing_key` | Server-derived key identifying a unique processing attempt. Deduplicates processing records. | `market + ":" + source_type + ":" + source_reference`                                                              |
| **Canonical Entry Key**       | `commission_ledger.canonical_entry_key`          | Server-derived key identifying a unique commission entry. Deduplicates ledger entries.       | `market + ":" + source_type + ":" + source_reference + ":" + beneficiary_id + ":" + generation + ":" + entry_type` |

**Note:** commission_processing can record event processing that results in zero commission ledger entries (e.g., no ACTIVE beneficiary found). This is expected behavior — not all source events produce commission entries. The processing record captures the outcome regardless of whether entries were generated.

**FROZEN:** All Canonical Keys include the market prefix for domain isolation.

| Commission Type       | Canonical Entry Key Components                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| Agent Upgrade G1      | `market + ":" + activation_id + ":" + beneficiary_id + ":" + generation(1) + ":" + AGENT_UPGRADE_G1_EARN`       |
| Agent Upgrade G2      | `market + ":" + activation_id + ":" + beneficiary_id + ":" + generation(2) + ":" + AGENT_UPGRADE_G2_EARN`       |
| Member Consumption G1 | `market + ":" + transaction_id + ":" + beneficiary_id + ":" + generation(1) + ":" + MEMBER_CONSUMPTION_G1_EARN` |
| Member Consumption G2 | `market + ":" + transaction_id + ":" + beneficiary_id + ":" + generation(2) + ":" + MEMBER_CONSUMPTION_G2_EARN` |
| Merchant Recruitment  | `market + ":" + transaction_id + ":" + beneficiary_id + ":" + generation(0) + ":" + MERCHANT_RECRUITMENT_EARN`  |
| Reversal Compensation | `market + ":" + correction_execution_id + ":" + original_entry_id + ":REVERSAL_COMPENSATION`                    |
| Refund Compensation   | `market + ":" + correction_execution_id + ":" + original_entry_id + ":REFUND_COMPENSATION`                      |

**Key Separation Rationale:**

- **Transport Idempotency-Key (header):** The client-provided UUID for HTTP request deduplication. Solely used to detect duplicate HTTP requests.
- **Canonical Processing Key (server-derived):** Identifies a unique processing scope. Stored in `commission_processing.canonical_processing_key`. Ensures a given source event is processed at most once.
- **Canonical Entry Key (server-derived):** Identifies a unique commission ledger entry. Stored in `commission_ledger.canonical_entry_key`. Ensures no duplicate ledger entries even if processing is retried.

### 16.2 Idempotency Guarantees

The system must guarantee:

| Scenario                               | Behavior                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| Same key + same payload, replayed      | Return original result (no duplicate)                                        |
| Same key + different payload, replayed | Reject with IDEMPOTENCY_KEY_MISMATCH error                                   |
| Concurrent processing, same key        | First writer wins; second returns original result or blocks (see Section 17) |
| Retry after timeout                    | Safe — returns original result                                               |
| Partial state crash                    | On recovery, idempotency table allows safe resumption                        |
| Cross-market event                     | Separate idempotency domains per market                                      |

### 16.3 Idempotency Tables

The commission_processing table records each processing attempt. A single source event may produce:

- Zero ledger entries (e.g., no ACTIVE beneficiary found — commission eligibility check fails for all generations)
- One ledger entry (e.g., only G1 beneficiary is ACTIVE)
- Multiple ledger entries (e.g., G1 and G2 both ACTIVE, each receiving their own entry)

The processing status reflects the overall outcome:

- `COMPLETED`: all expected entries written successfully
- `FAILED`: no entries written, processing error
- `IN_FLIGHT`: processing in progress

A dedicated idempotency tracking table stores:

| Field                    | Type         | Description                                                     |
| ------------------------ | ------------ | --------------------------------------------------------------- |
| canonical_processing_key | VARCHAR(255) | Canonical Processing Key (server-derived, unique)               |
| processing_id            | UUID         | FK to commission_processing (NOT directly to commission_ledger) |
| request_hash             | VARCHAR(64)  | SHA-256 hash of the full request payload                        |
| status                   | VARCHAR      | IN_FLIGHT / COMPLETED / FAILED                                  |
| created_at               | TIMESTAMP    | First request time                                              |
| completed_at             | TIMESTAMP    | Completion time                                                 |

A single processing run may produce zero, one, or multiple ledger entries. The `canonical_processing_key` table references the `commission_processing` record (not individual ledger entries), because a single idempotent processing scope covers all entries written for that source event.

### 16.4 Processing Outcome Status

The system records a **Processing Outcome** for each commission processing attempt. This replaces the need for a `COMMISSION_INELIGIBLE_AGENT` error code:

| Outcome                  | Description                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CREATED`                | One or more commission ledger entries were created successfully (at least one entry)                                                                         |
| `SKIPPED_INELIGIBLE`     | All generations skipped because no beneficiary was ACTIVE — no commission liability created, no ledger entry generated (D-17 frozen: No Liability, no Entry) |
| `SKIPPED_NO_BENEFICIARY` | No beneficiary found for the given source event                                                                                                              |
| `SKIPPED_ZERO_AMOUNT`    | Commission amount rounded to zero at posting scale; entry skipped and logged                                                                                 |
| `FAILED`                 | Processing error — no entries written                                                                                                                        |

**Rules:**

- `completion_outcome = CREATED` means **at least one** commission ledger entry was created.
- Each generation's individual result (CREATED, SKIPPED_INELIGIBLE, SKIPPED_NO_BENEFICIARY, SKIPPED_ZERO_AMOUNT) is recorded in `commission_processing_result` (per-generation granularity, `outcome` field). AGENT_REVOKED_AT_SOURCE_TIME is recorded in `result.reason`, not in the outcome field.
- There is **no** `CREATED_WITH_SKIPS` outcome. The global `completion_outcome = CREATED` applies whenever at least one entry is created, regardless of whether some generations were skipped.
- **Aggregation rule:** If any generation's result is CREATED, the overall processing outcome is CREATED. If all generations are SKIPPED, the overall outcome is SKIPPED_INELIGIBLE.

These outcomes are recorded in the `commission_processing.completion_outcome` field.

---

## 17. Concurrency and Lock Ordering

### 17.1 Lock Scope

- Commission calculation and ledger writing must be done within a **database transaction**.
- Lock granularity: **per beneficiary member** for a single commission calculation.
- Lock ordering: lock members in a **canonical sorted order** (sorted beneficiary member IDs ascending) to prevent deadlocks.

### 17.2 Lock Hierarchy

```
Canonical Lock Order:
1. Lock source event record (aligned with Phase 4 lock ordering)
2. Collect all beneficiary member IDs
3. Sort beneficiary IDs in ascending order
4. Lock beneficiaries in sorted order
5. Verify idempotency keys
6. Write commission_processing record
7. Write commission_ledger entries
8. Write commission_status_event entries
9. Release all locks
```

### 17.3 Concurrent Processing Rules

- If two events try to write a commission for the same agent simultaneously, the idempotency check combined with database constraints ensures only one succeeds.
- Optimistic locking is acceptable for non-critical reads; pessimistic locking (SELECT FOR UPDATE) for commission write operations.
- Deadlock detection: if a deadlock occurs, retry with exponential backoff [PROPOSED].

### 17.4 Reversal/Refund Concurrency

- Reversal compensation must lock the **original ledger entry** for update check before writing the compensation entry.
- If a compensation is already written (canonical_entry_key exists), return the existing result.

---

## 18. Reversal/Refund Compensation

### 18.1 Trigger Conditions

**Requirement:** Compensation processing requires the Phase 4 Correction Engine to be available and operational. Commission compensation entries MUST NOT be created independently; they are only created in response to Phase 4 Correction Execution events.

Compensation is triggered when:

| Source Event                   | Compensation Type                                                                                   | Trigger                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Member Consumption transaction | REVERSAL_COMPENSATION                                                                               | Transaction enters REVERSED final state (Phase 4)                                                          |
| Member Consumption transaction | REFUND_COMPENSATION                                                                                 | Transaction enters REFUNDED final state (Phase 4)                                                          |
| Agent Upgrade                  | **APPROVED_AND_FROZEN — NO CLAWBACK** (D-06: T1 Exact Revocation Timestamp; no historical clawback) | Agent activation revoked after activation — commissions NOT clawed back; no compensation entries generated |

### 18.2 Compensation Rules

**FROZEN:**

1. **Find all original commission entries** linked to the source event (transaction, activation, etc.).
2. **Do NOT modify or delete** original entries.
3. **Create exact opposite compensation entry:**
   - `amount = original_amount × (-1)`
   - `entry_type = REVERSAL_COMPENSATION` or `REFUND_COMPENSATION`
   - `reversal_linkage = original_entry_id`
   - All other snapshot fields copied from the original entry.
4. **Use the original posted amount** for the compensation amount (not recalculated at current rates).
5. **Atomic execution:** All compensations for one source event are written in a single database transaction.
6. **Idempotent execution:** If the system crashes mid-write, replay is safe.
7. **Link to Phase 4 Correction Request/Execution:** the compensation ledger entries reference the Correction Request/Execution ID that triggered the reversal.
8. **Original entry's entry_type/posting_status is NOT modified.** The original entry's current_status continues to be derived from commission_status_event. Whether the original economic amount has been partially or fully compensated is derived separately from linked compensation entries.

### 18.3 Agent Upgrade Reversal (APPROVED_AND_FROZEN — D-06)

**Decision (Bryan):** APPROVED_AND_FROZEN — T1 Exact Revocation Timestamp; no historical clawback.

- **Frozen rule:** Agent Upgrade commissions are **permanently earned** at activation time. If an agent activation is revoked, the G1/G2 upgrade commissions are **not clawed back**. No reversal compensation entries are generated for Agent Upgrade revocation.
- **Cut-off = T1 (Exact Revocation Effective Timestamp):** The exact system timestamp when the revocation is process-effective. Cleanly separates pre-cut-off from post-cut-off with no ambiguity.
- **Historical preservation:** Upgrade commissions paid **before** the revocation effective timestamp are preserved. No retroactive clawback. No modification to existing ledger entries.
- **No compensation entries:** The activation reversal does NOT generate REVERSAL_COMPENSATION or REFUND_COMPENSATION entries for G1/G2 upgrade commissions. The revocation of the activation itself is still processed (status change), but no commission clawback occurs.
- **Agent upgrade commissions — before revocation: retain (keep), no compensation, no modification.**
- **Implementation:** No reversal compensation entries are generated for Agent Upgrade revocation, regardless of whether the revocation timestamp is pre-cut-off or post-cut-off. The activation reversal is processed as a status change only; commission entries remain untouched.\*\*

---

## 19. Suspension and Deactivation

### 19.1 Suspension

| Aspect                               | Rule                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Commission during suspension         | **Not earned.** Source events occurring during suspension do not generate commission for the suspended agent.                |
| Pending commission during suspension | **Not applicable (D-01 frozen: Direct EARNED).** All commissions are EARNED at calculation time. There is no PENDING status. |
| Reactivation                         | If agent is reactivated, future source events become eligible again. Past events during suspension remain ineligible.        |
| Retroactive eligibility              | **No.** Suspension periods cannot be "made good" retroactively.                                                              |

### 19.2 Deactivation

**FROZEN (D-16 APPROVED_AND_FROZEN):**

| Aspect                        | Rule                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| Commission after deactivation | **Not earned.** No future source events generate commission, including past referrals' transactions. |
| Already-earned commission     | **Preserved.** EARNED commissions remain in the ledger. No clawback of pre-deactivation commissions. |
| Already-pending commission    | **Not applicable (D-01 frozen: Direct EARNED).** No PENDING commissions exist.                       |
| Re-application                | OPEN (Open Item): Whether a deactivated agent can re-apply.                                          |

**D-16 frozen — No future commission at all:** A DEACTIVATED agent does not earn commission on any source events occurring after deactivation. This includes:

- Agent Upgrade commissions from past referrals' downstream activations
- Member Consumption commissions from past referrals' transactions
- Merchant Recruitment commissions from past merchant attributions

**Eligibility check:** At source event time, `agent_status_at_source = DEACTIVATED` results in `SKIPPED_INELIGIBLE`. No historical retroactive effect on pre-deactivation commissions.

### 19.3 Notification Requirements

- Both suspension and deactivation must generate audit trail entries.
- Notification to agent (via system message/email) recommended but not mandatory for P5-S0 core scope.

---

## 20. Audit Requirements

### 20.1 Audit Trails

The commission engine must support the following audit capabilities:

| Audit Requirement                               | Implementation                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every ledger entry has an immutable audit trail | Ledger entries are INSERT-only; all state changes tracked via status transition log                                                                                                                                                                                                                                                                                                  |
| All rate version changes tracked                | Rate version table records creator, timestamp, effective range                                                                                                                                                                                                                                                                                                                       |
| Admin adjustments logged                        | Admin adjustment entries in ledger with maker/checker info                                                                                                                                                                                                                                                                                                                           |
| Reversal/refund compensation linked to original | reversal_linkage field                                                                                                                                                                                                                                                                                                                                                               |
| Source event traceability                       | source_reference links each commission to its originating event                                                                                                                                                                                                                                                                                                                      |
| Full history of status transitions              | Dedicated `commission_status_event` table. Current status is projected by taking the LATEST `to_status` for each `entry_id` from the append-only event log.                                                                                                                                                                                                                          |
| Audit trail projection derivation               | The `commission_status_event` table is append-only. For any point in time, the current status of a commission entry is derived as: `SELECT DISTINCT ON (entry_id) to_status FROM commission_status_event WHERE entry_id = ? ORDER BY entry_id, event_sequence DESC, changed_at DESC, event_id DESC`. All past transitions remain visible in the event log and are never overwritten. |
| Who performed admin actions                     | actor_id and actor_type on admin actions                                                                                                                                                                                                                                                                                                                                             |

### 20.2 Audit Tables

```
commission_status_event:
  event_id (PK)
  entry_id (FK -> commission_ledger)
  from_status
  to_status
  changed_by (actor_id)
  changed_by_type (SYSTEM, ADMIN, AGENT)
  changed_at
  reason
  event_sequence (BIGINT)
```

### 20.3 Retention

- Ledger entries: **Permanent** — no deletion or archival for the foreseeable future.
- Audit logs: **Permanent** — tied to ledger entry lifecycle.
- Rate versions: **Permanent** — required for historical calculation verification.
- Retention periods subject to legal/compliance requirements. Economic records are permanently retained but physical retention must comply with applicable regulations.

---

## 21. Privacy Projections

### 21.1 View Projections

| Viewer             | Can See                                                       | Cannot See                              |
| ------------------ | ------------------------------------------------------------- | --------------------------------------- |
| Agent (self)       | Own commission entries (amounts, status, dates, source types) | Other agents' commission entries        |
| Agent (self)       | Own downline anonymized tree (counts only, no names)          | Specific identities of downline members |
| Admin              | All commission entries (full detail)                          | N/A                                     |
| Member (non-agent) | Own referral code, basic tree info (no commission)            | Commission amounts, agent-specific data |

### 21.2 Data Masking Rules

- For agent self-service: Referral tree view shows generation counts but **anonymizes** individual names/contacts of downline members unless explicit permission is granted.
- For admin: Full visibility with search capability.
- For external audit: Full visibility with time-bound access tokens [PROPOSED].

### 21.3 Regulatory Considerations

- Personal data (member names, contacts) in commission source references must be handled according to applicable data protection regulations (GDPR/PDPA equivalent).
- Commission ledger entries contain member IDs (UUIDs), not PII.
- Referral relationships may constitute personal data — future compliance review recommended.

---

## 22. Fraud Controls

### 22.1 Preventive Controls

| Control                         | Description                                                  |
| ------------------------------- | ------------------------------------------------------------ |
| Self-referral prevention        | System rejects registration with own referral code           |
| Cycle detection                 | Ancestor traversal on every referral link creation           |
| Duplicate commission prevention | Canonical entry keys prevent double-counting                 |
| Rate version integrity          | Rates are versioned and immutable; no real-time manipulation |
| Status-check on calculation     | Agent must be ACTIVE at source event time                    |
| One commission per source+gen   | Unique constraint on canonical_entry_key                     |

### 22.2 Detective Controls

| Control                       | Description                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Anomalous commission patterns | Admin reporting on outlier earners (e.g., >3σ from mean) [PROPOSED thresholds; CONFIGURABLE via admin settings]                                  |
| Rapid activation chains       | Detect mass activation → commission farming patterns [PROPOSED rules; CONFIGURABLE thresholds]                                                   |
| Suspicious referral patterns  | Detect referral tree anomalies (e.g., single referrer with thousands of direct referrals) [PROPOSED thresholds; CONFIGURABLE via admin settings] |
| Merchant self-recruitment     | Detect circular merchant recruitment (merchant referring itself)                                                                                 |
| Rate of change monitoring     | Alert on unusual commission accrual rates                                                                                                        |

### 22.3 Corrective Controls

| Control                       | Description                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| Admin adjustment entries      | Maker/Checker authorized adjustments with full audit trail (D-13/D-14 APPROVED_AND_FROZEN) |
| Commission cancellation       | **Not applicable (D-01 frozen: Direct EARNED).** No PENDING state exists for cancellation. |
| Agent suspension/deactivation | Immediate cessation of commission eligibility                                              |
| Reversal compensation         | Full claw-back via opposite entries                                                        |
| Rate version rollback         | New rate version can supersede, but existing entries not recalculated                      |

### 22.4 Fraud Escalation

- All fraud-related commission cancellations/suspensions must be logged with:
  - Detecting entity (system rule / admin review)
  - Evidence reference
  - Action taken
  - Escalation level (if applicable)

---

## 23. Proposed Database Schema

### 23.1 agent_activation

```sql
CREATE TABLE agent_activation (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID NOT NULL REFERENCES member(id),
    status          VARCHAR(20) NOT NULL DEFAULT 'NOT_APPLIED',
    -- Status values: NOT_APPLIED, PENDING_PAYMENT, PAYMENT_CONFIRMED,
    --                COURSE_PENDING, COURSE_COMPLETED, PENDING_APPROVAL,
    --                ACTIVE, SUSPENDED, DEACTIVATED, REJECTED
    payment_reference        VARCHAR(255),
    payment_confirmed_at     TIMESTAMPTZ,
    course_completed_at      TIMESTAMPTZ,
    course_enrolled_at       TIMESTAMPTZ,
    course_reference         VARCHAR(255),   -- PROPOSED
    course_confirmed_by      UUID,           -- PROPOSED
    approved_at              TIMESTAMPTZ,
    activated_at             TIMESTAMPTZ,
    activated_by             UUID, -- FK target: Admin Identity schema (P5-S1). Represents atomic approval+activation action.
    market                   VARCHAR(2) NOT NULL,
    currency                 VARCHAR(3) NOT NULL DEFAULT 'MYR',
    rejection_reason         TEXT,
    reactivation_count       INT NOT NULL DEFAULT 0,
    revoked_at               TIMESTAMPTZ,
    revoked_by               UUID,
    revocation_reason        TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_agent_member_market UNIQUE (member_id, market),  -- D-07 frozen: multi-market independent activation allowed. Each member can have one activation record per market (MY, SG, etc.).
    CONSTRAINT chk_agent_status CHECK (status IN (
        'NOT_APPLIED', 'PENDING_PAYMENT', 'PAYMENT_CONFIRMED',
        'COURSE_PENDING', 'COURSE_COMPLETED', 'PENDING_APPROVAL',
        'ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'REJECTED'
    ))
);
```

### 23.2 agent_activation_status_log

```sql
CREATE TABLE agent_activation_status_log (
    log_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activation_id   UUID NOT NULL REFERENCES agent_activation(id),
    from_status     VARCHAR(20),
    to_status       VARCHAR(20) NOT NULL,
    changed_by      UUID,
    changed_by_type VARCHAR(20) NOT NULL, -- SYSTEM, ADMIN, AGENT
    reason          TEXT,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 23.3 referral_relationship

```sql
CREATE TABLE referral_relationship (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referee_id      UUID NOT NULL REFERENCES member(id),
    referrer_id     UUID NOT NULL REFERENCES member(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- referrer_id is permanently immutable after commit (D-15 frozen)
    CONSTRAINT uq_referral_referee UNIQUE (referee_id),
    CONSTRAINT chk_no_self_referral CHECK (referee_id <> referrer_id)
);
```

### 23.4 commission_processing

```sql
CREATE TABLE commission_processing (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_processing_key VARCHAR(255) NOT NULL,  -- Server-derived processing key
    source_type         VARCHAR(30) NOT NULL,
    source_reference    VARCHAR(255) NOT NULL,
    request_hash        VARCHAR(64) NOT NULL,  -- SHA-256
    status              VARCHAR(20) NOT NULL DEFAULT 'IN_FLIGHT',
    completion_outcome  VARCHAR(30),  -- CREATED, SKIPPED_INELIGIBLE, SKIPPED_NO_BENEFICIARY, SKIPPED_ZERO_AMOUNT, FAILED
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    CONSTRAINT uq_processing_key UNIQUE (canonical_processing_key),
    CONSTRAINT chk_processing_status CHECK (status IN ('IN_FLIGHT', 'COMPLETED', 'FAILED')),
    CONSTRAINT chk_processing_outcome CHECK (completion_outcome IS NULL OR completion_outcome IN ('CREATED', 'SKIPPED_INELIGIBLE', 'SKIPPED_NO_BENEFICIARY', 'SKIPPED_ZERO_AMOUNT', 'FAILED'))
);
```

### 23.5 commission_rate_version

```sql
CREATE TABLE commission_rate_version (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    commission_type VARCHAR(30) NOT NULL,
    -- Types: AGENT_UPGRADE, MEMBER_CONSUMPTION, MERCHANT_RECRUITMENT
    generation      INT NOT NULL,  -- 1, 2, or 0 for single-gen
    market          VARCHAR(2) NOT NULL,
    rate_value      NUMERIC(38,10) NOT NULL,
    rate_type       VARCHAR(10) NOT NULL DEFAULT 'PERCENTAGE',
    -- Types: PERCENTAGE, FIXED
    effective_from  TIMESTAMPTZ NOT NULL,
    effective_until TIMESTAMPTZ,
    created_by      UUID NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_rate_type CHECK (rate_type IN ('PERCENTAGE', 'FIXED')),
    CONSTRAINT chk_generation CHECK (generation IN (0, 1, 2)),
    CONSTRAINT uq_rate_period EXCLUDE USING gist (
        commission_type WITH =,
        generation WITH =,
        market WITH =,
        tstzrange(effective_from, COALESCE(effective_until, 'infinity'::timestamptz), '[)') WITH &&
    ),
    CONSTRAINT chk_rate_effective_range CHECK (effective_until IS NULL OR effective_until > effective_from)
);

-- Prerequisite: Run CREATE EXTENSION IF NOT EXISTS btree_gist; before creating this table.
-- The EXCLUDE constraint using btree_gist ensures no overlapping effective periods
-- for the same (commission_type, generation, market) combination.
```

### 23.6 commission_ledger

```sql
CREATE TABLE commission_ledger (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_reference    VARCHAR(30) NOT NULL,
    beneficiary_id      UUID NOT NULL REFERENCES member(id),
    source_type         VARCHAR(30) NOT NULL,
    source_reference    VARCHAR(255) NOT NULL,
    market              VARCHAR(2) NOT NULL,
    currency            VARCHAR(3) NOT NULL,
    amount              NUMERIC(38,10) NOT NULL,  -- Stored at posting scale (2dp for MYR/SGD per D-22 frozen). Unrounded value in rate_snapshot.
    rate_version_id     UUID REFERENCES commission_rate_version(id),
    rate_snapshot       JSONB,  -- Contains: rate_version_id, rate_value, calculation_scale, posting_scale, rounding_mode, unrounded_amount, posted_amount, residual_amount
    calculation_basis   NUMERIC(38,10),
    generation          INT NOT NULL DEFAULT 0,
    entry_type          VARCHAR(40) NOT NULL,
    posting_status      VARCHAR(20) NOT NULL DEFAULT 'EARNED',  -- D-01 frozen: Always EARNED. No PENDING status.
    canonical_entry_key VARCHAR(255) NOT NULL,  -- Server-derived canonical entry key for internal deduplication
    processing_id       UUID REFERENCES commission_processing(id),
    effective_time      TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reversal_linkage    UUID REFERENCES commission_ledger(id),
    audit_linkage       VARCHAR(255),
    notes               TEXT,
    CONSTRAINT chk_entry_type CHECK (entry_type IN (
        'AGENT_UPGRADE_G1_EARN', 'AGENT_UPGRADE_G2_EARN',
        'MEMBER_CONSUMPTION_G1_EARN', 'MEMBER_CONSUMPTION_G2_EARN',
        'MERCHANT_RECRUITMENT_EARN', 'REVERSAL_COMPENSATION',
        'REFUND_COMPENSATION', 'ADMIN_ADJUSTMENT'
    )),
    -- D-01 frozen: posting_status is always EARNED. No PENDING allowed.
    -- Commission is directly EARNED at calculation time per D-01 (APPROVED_AND_FROZEN).
    CONSTRAINT chk_posting_status CHECK (posting_status = 'EARNED'),
    CONSTRAINT uq_ledger_entry_key UNIQUE (canonical_entry_key),
    CONSTRAINT uq_ledger_public_ref UNIQUE (public_reference)
);
```

### 23.7 commission_status_event

```sql
CREATE TABLE commission_status_event (
    event_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id            UUID NOT NULL REFERENCES commission_ledger(id),
    from_status         VARCHAR(20),
    to_status           VARCHAR(20) NOT NULL,
    changed_by          UUID,
    changed_by_type     VARCHAR(20) NOT NULL,
    reason              TEXT,
    changed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_sequence      BIGINT NOT NULL,  -- Allocated by MAX(event_sequence) + 1 within transaction, locked per entry_id
    CONSTRAINT uq_status_event_sequence UNIQUE (entry_id, event_sequence),
    -- D-01 frozen: Only EARNED status. No PENDING, no CANCELLED. Commission is Direct Earned per D-01.
    CONSTRAINT chk_status_to CHECK (to_status IN ('EARNED')),
    CONSTRAINT chk_status_from CHECK (from_status IS NULL OR from_status IN ('EARNED')),
    CONSTRAINT chk_changed_by_type CHECK (changed_by_type IN ('SYSTEM', 'ADMIN', 'AGENT'))
);
```

**Design note:** The commission_status_event table does NOT have its own `status` column. Each event IS the status change record itself — the `from_status` and `to_status` fields capture the transition. No separate event-level status is needed. The `UNIQUE(entry_id, event_sequence)` constraint ensures a strict ordering of events per entry.

**D-01 design simplification (Direct EARNED):**

- Every commission entry is created with `to_status = EARNED` in its first (and only) status event.
- No PENDING status exists. No CANCELLED status exists.
- The status_event table records the initial creation event; no transition events are needed.
- This simplifies the state machine, eliminates release jobs, and eliminates holding periods.

**event_sequence allocation:** Allocated atomically within the transaction by locking by `entry_id` and computing `MAX(event_sequence) + 1`. Concurrent events for the same `entry_id` cannot receive the same sequence. First event starts at 1.

**commission_status_event Fields:**
| Field | Type | Description |
|-------|------|-------------|
| event_id | UUID (PK) | Unique event identifier, auto-generated |
| entry_id | UUID (FK → commission_ledger) | The commission ledger entry this status change relates to |
| from_status | VARCHAR(20) | Previous status (NULL for first event) |
| to_status | VARCHAR(20) | New status after this event (NOT NULL) |
| changed_by | UUID | Actor ID who triggered the status change (SYSTEM process ID, ADMIN member ID, or AGENT member ID) |
| changed_by_type | VARCHAR(20) | Type of actor: SYSTEM, ADMIN, AGENT |
| reason | TEXT | Human-readable reason for the status change |
| changed_at | TIMESTAMPTZ | When the status change occurred (NOT NULL, DEFAULT NOW()) |
| event_sequence | BIGINT | Monotonically increasing sequence per entry_id; enables deterministic ordering |

**Status Projection Query:**

```sql
-- Derive current_status for each commission ledger entry
SELECT DISTINCT ON (cse.entry_id)
    cse.entry_id,
    cse.to_status AS current_status,
    cse.changed_at AS status_changed_at,
    cse.reason AS last_change_reason
FROM commission_status_event cse
ORDER BY cse.entry_id, cse.event_sequence DESC, cse.changed_at DESC, cse.event_id DESC;
```

**Current status explanation:** The `current_status` of any commission entry is always projected from the append-only `commission_status_event` table by taking the latest `to_status` for each `entry_id`. The ORDER BY uses `event_sequence DESC, changed_at DESC, event_id DESC` as tiebreakers to ensure deterministic ordering. The original ledger `posting_status` is the initial classification and NEVER changes. Under D-01 frozen, every entry has exactly one status event with `to_status = EARNED`.

### 23.8 idempotency_key

```sql
-- Transport-level idempotency tracking (HTTP Idempotency-Key header)
CREATE TABLE idempotency_key (
    key                 VARCHAR(255) PRIMARY KEY,
    processing_id       UUID NOT NULL REFERENCES commission_processing(id),  -- FK to commission_processing only; NOT directly to commission_ledger
    request_hash        VARCHAR(64) NOT NULL,  -- SHA-256
    status              VARCHAR(20) NOT NULL DEFAULT 'IN_FLIGHT',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ
);
```

### 23.9 merchant_attribution (FROZEN — D-18/D-19 resolved)

**D-18 frozen (Option A — Permanent):** effective_until = NULL (permanent). No time-limited or first-N scope.
**D-19 frozen (Option B — Independent Branch Recruiter):** Each branch can have its own recruiter independently.
**D-15 frozen (Referral Correction completely disallowed — Member Referral Only):** Referral relationships are permanently immutable. Branch attribution immutability is a separate concern (see Merchant Attribution Change Policy).

```sql
CREATE TABLE merchant_attribution (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_account_id   UUID NOT NULL, -- FK target: frozen Merchant entity (P5-S1)
    branch_id             UUID,           -- FK target: Branch entity. NULL = parent-level attribution
    recruiter_member_id   UUID NOT NULL REFERENCES member(id),
    attributed_entity_type VARCHAR(20) NOT NULL DEFAULT 'MERCHANT',  -- 'MERCHANT' = parent, 'BRANCH' = branch-specific
    attribution_source    VARCHAR(30) NOT NULL DEFAULT 'REGISTRATION',
    attribution_scope     VARCHAR(30) NOT NULL DEFAULT 'PERMANENT',  -- PERMANENT only (D-18 frozen)
    effective_from        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_until       TIMESTAMPTZ DEFAULT NULL,  -- Always NULL (D-18: permanent)
    supersedes_attribution_id UUID REFERENCES merchant_attribution(id),  -- DEFERRED — not part of P5-S0 schema
    created_by            UUID NOT NULL,
    correction_linkage    UUID,              -- DEFERRED — not part of P5-S0 schema
    audit_reference       VARCHAR(255),
    CONSTRAINT chk_attribution_entity_type CHECK (attributed_entity_type IN ('MERCHANT', 'BRANCH')),
    CONSTRAINT chk_attribution_source CHECK (attribution_source IN ('REGISTRATION', 'ADMIN_ASSIGNMENT')),
    CONSTRAINT chk_attribution_scope CHECK (attribution_scope IN ('PERMANENT')),
    CONSTRAINT chk_attribution_entity_target CHECK (
      (attributed_entity_type = 'MERCHANT' AND branch_id IS NULL)
      OR
      (attributed_entity_type = 'BRANCH' AND branch_id IS NOT NULL)
    ),
    CONSTRAINT chk_permanent_attribution CHECK (
      attribution_scope = 'PERMANENT' AND effective_until IS NULL
    )
);

-- Partial unique indexes for merchant attribution
CREATE UNIQUE INDEX uq_merchant_attribution_merchant
ON merchant_attribution (merchant_account_id)
WHERE attributed_entity_type = 'MERCHANT' AND branch_id IS NULL;

CREATE UNIQUE INDEX uq_merchant_attribution_branch
ON merchant_attribution (branch_id)
WHERE attributed_entity_type = 'BRANCH' AND branch_id IS NOT NULL;
```

---

### 23.10 commission_processing_result [PROPOSED]

Logs the outcome of each commission processing attempt, including skipped entries:

```sql
CREATE TABLE commission_processing_result (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    processing_id   UUID NOT NULL REFERENCES commission_processing(id),
    beneficiary_id  UUID REFERENCES member(id),  -- NULLABLE: NULL when outcome = SKIPPED_NO_BENEFICIARY
    generation      INT NOT NULL DEFAULT 0,
    entry_type      VARCHAR(40),  -- NULL for source-level skips (SKIPPED_NO_BENEFICIARY at processing level)
    unrounded_amount NUMERIC(38,10),  -- Full precision (10dp) before rounding
    posted_amount   NUMERIC(38,10),  -- Rounded to posting scale. NULL if skipped.
    residual_amount NUMERIC(38,10),  -- unrounded_amount - posted_amount. For audit only.
    rounding_mode   VARCHAR(10) NOT NULL DEFAULT 'HALF_UP',
    calculation_scale INT NOT NULL DEFAULT 10,
    posting_scale   INT NOT NULL DEFAULT 2,
    outcome         VARCHAR(30) NOT NULL,  -- CREATED, SKIPPED_INELIGIBLE, SKIPPED_NO_BENEFICIARY, SKIPPED_ZERO_AMOUNT
    reason          TEXT,  -- Includes eligibility_result, eligibility_reason, and AGENT_REVOKED_AT_SOURCE_TIME details from snapshot
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_processing_result_outcome CHECK (outcome IN (
        'CREATED', 'SKIPPED_INELIGIBLE', 'SKIPPED_NO_BENEFICIARY', 'SKIPPED_ZERO_AMOUNT'
    )),
    CONSTRAINT chk_skip_no_beneficiary CHECK (
        (outcome = 'SKIPPED_NO_BENEFICIARY' AND beneficiary_id IS NULL)
        OR (outcome <> 'SKIPPED_NO_BENEFICIARY' AND beneficiary_id IS NOT NULL)
    )
);
```

**Design note:** This table enables audit of commission processing outcomes including zero-rounded skips (D-26 frozen) and revocation-based ineligibility (Section 8.5). Each processing run produces one result row per evaluated beneficiary-generation combination. The `unrounded_amount`, `posted_amount`, and `residual_amount` fields capture the full precision audit trail (D-25 frozen). The `reason` field stores the eligibility_result and eligibility_reason from the processing snapshot. AGENT_REVOKED_AT_SOURCE_TIME is recorded in the `reason` field, not as a separate outcome value.

---

### 23.11 commission_adjustment_request

Maker/Checker workflow for admin commission adjustments (D-13/D-14 APPROVED_AND_FROZEN).

```sql
CREATE TABLE commission_adjustment_request (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_reference    VARCHAR(30) NOT NULL,
    beneficiary_id      UUID NOT NULL REFERENCES member(id),
    amount              NUMERIC(38,10) NOT NULL,
    market              VARCHAR(2) NOT NULL,
    currency            VARCHAR(3) NOT NULL,
    reason              TEXT NOT NULL,
    audit_reference     VARCHAR(255),
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING_CHECKER',
    -- Status values: PENDING_CHECKER, APPROVED, REJECTED
    maker_id            UUID NOT NULL,  -- FK: Admin who created the request (from auth principal)
    checker_id          UUID,           -- FK: Admin who approved/rejected (from auth principal)
    maker_notes         TEXT,
    checker_notes       TEXT,
    ledger_entry_id     UUID REFERENCES commission_ledger(id),
    decided_at          TIMESTAMPTZ,    -- When checker approved/rejected
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_adjustment_public_ref UNIQUE (public_reference),
    CONSTRAINT uq_adjustment_ledger_entry UNIQUE (ledger_entry_id),
    CONSTRAINT chk_adjustment_status CHECK (status IN ('PENDING_CHECKER', 'APPROVED', 'REJECTED')),
    CONSTRAINT chk_adjustment_nonzero CHECK (amount <> 0),
    CONSTRAINT chk_maker_checker_different CHECK (maker_id <> checker_id),
    CONSTRAINT chk_decided_fields CHECK (
        (status = 'PENDING_CHECKER' AND checker_id IS NULL AND decided_at IS NULL AND ledger_entry_id IS NULL)
        OR
        (status = 'APPROVED' AND checker_id IS NOT NULL AND decided_at IS NOT NULL AND ledger_entry_id IS NOT NULL)
        OR
        (status = 'REJECTED' AND checker_id IS NOT NULL AND decided_at IS NOT NULL AND ledger_entry_id IS NULL)
    )
);

CREATE INDEX idx_adjustment_beneficiary ON commission_adjustment_request (beneficiary_id);
CREATE INDEX idx_adjustment_status ON commission_adjustment_request (status);
CREATE INDEX idx_adjustment_maker ON commission_adjustment_request (maker_id);
CREATE INDEX idx_adjustment_checker ON commission_adjustment_request (checker_id);
CREATE INDEX idx_adjustment_created ON commission_adjustment_request (created_at DESC);
```

**Design note:** The `chk_decided_fields` constraint enforces state integrity:

- PENDING_CHECKER: checker_id, decided_at, ledger_entry_id must all be NULL.
- APPROVED: checker_id, decided_at, ledger_entry_id must all be set.
- REJECTED: checker_id, decided_at set; ledger_entry_id must be NULL (no ledger entry created).

**Atomic approval transaction (commit contract):** The checker approval API (`POST /admin/commission-adjustments/{id}/approve`) MUST execute the following atomically within a single database transaction: (1) INSERT into commission_ledger (entry_type = ADMIN_ADJUSTMENT), (2) INSERT into commission_status_event (entry_id, to_status = 'EARNED'), (3) UPDATE commission_adjustment_request SET status = 'APPROVED', checker_id = auth_principal, decided_at = NOW(), ledger_entry_id = new_ledger_entry.id. If any step fails, the entire transaction rolls back — no partial state is persisted. The UNIQUE(ledger_entry_id) constraint ensures at most one ledger entry per adjustment request, preventing duplicate financial entries on retry.

The `chk_maker_checker_different` constraint ensures maker_id != checker_id per D-14 frozen.
The `chk_adjustment_nonzero` constraint prevents zero-amount adjustments per D-13 frozen.
The `status` CHECK constraint limits to the three valid states.

---

## 24. Constraints and Indexes

### 24.1 Constraints

| Table                   | Constraint                         | Type                                                                                                                                                                                                                           | Purpose                                                                                                               |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| agent_activation        | `uq_agent_member_market`           | UNIQUE(member_id, market)                                                                                                                                                                                                      | D-07 frozen: One activation record per member per market (MY, SG, etc.) — enables multi-market independent activation |
| agent_activation        | `chk_agent_status`                 | CHECK                                                                                                                                                                                                                          | Valid status values                                                                                                   |
| referral_relationship   | `uq_referral_referee`              | UNIQUE(referee_id)                                                                                                                                                                                                             | One referrer per member                                                                                               |
| referral_relationship   | `chk_no_self_referral`             | CHECK                                                                                                                                                                                                                          | Self-referral prevention                                                                                              |
| merchant_attribution    | `uq_merchant_attribution_merchant` | UNIQUE(merchant_account_id) WHERE attributed_entity_type = 'MERCHANT'                                                                                                                                                          | D-19 frozen: At most one parent-level attribution per merchant                                                        |
| merchant_attribution    | `uq_merchant_attribution_branch`   | UNIQUE(branch_id) WHERE branch_id IS NOT NULL                                                                                                                                                                                  | D-19 frozen: At most one attribution per branch                                                                       |
| commission_ledger       | `uq_ledger_entry_key`              | UNIQUE(canonical_entry_key)                                                                                                                                                                                                    | Canonical entry key deduplication                                                                                     |
| commission_ledger       | `uq_ledger_public_ref`             | UNIQUE(public_reference)                                                                                                                                                                                                       | Public reference uniqueness                                                                                           |
| commission_ledger       | `chk_entry_type`                   | CHECK (entry_type IN ('AGENT_UPGRADE_G1_EARN','AGENT_UPGRADE_G2_EARN','MEMBER_CONSUMPTION_G1_EARN','MEMBER_CONSUMPTION_G2_EARN','MERCHANT_RECRUITMENT_EARN','REVERSAL_COMPENSATION','REFUND_COMPENSATION','ADMIN_ADJUSTMENT')) | Valid entry type values                                                                                               |
| commission_ledger       | `chk_posting_status`               | CHECK (posting_status = 'EARNED')                                                                                                                                                                                              | D-01 frozen: Only EARNED allowed. No PENDING.                                                                         |
| commission_processing   | `chk_processing_status`            | CHECK (status IN ('IN_FLIGHT','COMPLETED','FAILED'))                                                                                                                                                                           | Valid processing status                                                                                               |
| commission_processing   | `chk_processing_outcome`           | CHECK (completion_outcome IS NULL OR completion_outcome IN ('CREATED','SKIPPED_INELIGIBLE','SKIPPED_NO_BENEFICIARY','SKIPPED_ZERO_AMOUNT','FAILED'))                                                                           | Valid processing outcomes (AGENT_REVOKED_AT_SOURCE_TIME is per-generation only, not overall outcome)                  |
| commission_processing   | `uq_processing_key`                | UNIQUE(canonical_processing_key)                                                                                                                                                                                               | Processing deduplication                                                                                              |
| commission_rate_version | `uq_rate_period`                   | EXCLUDE USING gist (commission_type WITH =, generation WITH =, market WITH =, tstzrange(effective_from, COALESCE(effective_until, 'infinity'::timestamptz), '[)') WITH &&)                                                     | No overlapping effective periods. Requires btree_gist extension.                                                      |
| commission_rate_version | `chk_rate_effective_range`         | CHECK (effective_until IS NULL OR effective_until > effective_from)                                                                                                                                                            | Valid effective range                                                                                                 |
| commission_status_event | `uq_status_event_sequence`         | UNIQUE(entry_id, event_sequence)                                                                                                                                                                                               | Strict event ordering per entry                                                                                       |
| commission_status_event | `chk_status_to`                    | CHECK (to_status IN ('EARNED'))                                                                                                                                                                                                | D-01 frozen: Only EARNED status. No PENDING, no CANCELLED.                                                            |
| commission_status_event | `chk_status_from`                  | CHECK (from_status IS NULL OR from_status IN ('EARNED'))                                                                                                                                                                       | D-01 frozen: Only EARNED status values allowed.                                                                       |
| commission_status_event | `chk_changed_by_type`              | CHECK (changed_by_type IN ('SYSTEM','ADMIN','AGENT'))                                                                                                                                                                          | Valid actor types                                                                                                     |
| idempotency_key         | PK on key                          | PRIMARY KEY                                                                                                                                                                                                                    | Transport idempotency guarantee                                                                                       |

### 24.2 Indexes

| Table                       | Index                               | Columns                                               | Purpose                                                       |
| --------------------------- | ----------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| agent_activation            | `idx_activation_member_status`      | (member_id, status)                                   | Fast lookup by member + status                                |
| agent_activation            | `idx_activation_status`             | (status)                                              | Admin filtering by status                                     |
| agent_activation            | `idx_activation_market`             | (market)                                              | Market-based queries                                          |
| referral_relationship       | `idx_referral_referrer`             | (referrer_id)                                         | Find all referrals by a referrer                              |
| commission_ledger           | `idx_ledger_beneficiary`            | (beneficiary_id)                                      | Agent's own commissions                                       |
| commission_ledger           | `idx_ledger_beneficiary_entry_type` | (beneficiary_id, entry_type)                          | Filter by beneficiary + entry_type                            |
| commission_ledger           | `idx_ledger_beneficiary_posting`    | (beneficiary_id, posting_status)                      | Filter by beneficiary + posting status                        |
| commission_ledger           | `idx_ledger_source`                 | (source_type, source_reference)                       | Find commissions from a source event                          |
| commission_ledger           | `idx_ledger_effective_time`         | (effective_time)                                      | Time-range queries                                            |
| commission_ledger           | `idx_ledger_reversal`               | (reversal_linkage)                                    | Find compensation entries                                     |
| commission_ledger           | `idx_ledger_market`                 | (market)                                              | Market-based queries                                          |
| commission_ledger           | `idx_ledger_entry_key`              | (canonical_entry_key)                                 | Fast canonical key lookup                                     |
| commission_rate_version     | `idx_rate_effective`                | (commission_type, generation, market, effective_from) | Rate lookup at time                                           |
| agent_activation_status_log | `idx_activation_log_activation`     | (activation_id)                                       | Status history                                                |
| commission_processing       | `idx_processing_key`                | (canonical_processing_key)                            | Processing key lookup                                         |
| commission_processing       | `idx_processing_source`             | (source_type, source_reference)                       | Lookup by source                                              |
| commission_status_event     | `idx_status_event_entry_seq`        | (entry_id, event_sequence DESC)                       | Status history for a ledger entry with deterministic ordering |
| merchant_attribution        | `idx_attribution_merchant_account`  | (merchant_account_id)                                 | Merchant lookup                                               |

### 24.3 Index Design Notes

- Composite indexes on `(beneficiary_id, entry_type)` and `(beneficiary_id, posting_status)` support the most common agent query patterns. The current operational status (`current_status`) is derived from the `commission_status_event` projection, not from the ledger directly.
- The rate version GiST index (EXCLUDE) supports the most common lookup: find the rate effective at a given time for a commission type, generation, and market, while preventing overlapping effective periods.
- The source index supports reversal/refund compensation lookup: find all ledger entries for a given source event.
- The `(entry_id, event_sequence DESC)` index on `commission_status_event` supports the deterministic status projection query with ordering by event_sequence.

---

## 25. Proposed APIs

### 25.1 Agent Activation APIs

#### `POST /api/v1/agent/apply`

- **Description:** Submit agent application
- **Auth:** Member token
- **Request:**
  ```json
  {
    "market": "MY"
  }
  ```
  (member_id is extracted from auth principal)
- **Response:** `{ "activation_id": "uuid", "status": "PENDING_PAYMENT", "payment_instructions": {...} }`
- **Idempotent:** Yes (member_id is unique)

#### `POST /api/v1/agent/confirm-payment`

- **Description:** Confirm activation-fee payment (webhook or admin action). MY default = RM388; other markets market-configurable per D-08 frozen. Amount validated from Payment Record.
- **Auth:** System or Admin token
- **Request:**
  ```json
  {
    "activation_id": "uuid",
    "payment_reference": "PAY-12345"
  }
  ```
- **Response:** `{ "activation_id": "uuid", "status": "PAYMENT_CONFIRMED" }`

#### `POST /api/v1/agent/enroll-course`

- **Description:** Enroll agent in company course (triggers COURSE_PENDING)
- **Auth:** System token
- **Request:** `{ "activation_id": "uuid" }`
- **Response:** `{ "activation_id": "uuid", "status": "COURSE_PENDING" }`

#### `POST /api/v1/agent/complete-course`

- **Description:** Record course completion (COURSE_PENDING → COURSE_COMPLETED)
- **Auth:** System token
- **Request:**
  ```json
  {
    "activation_id": "uuid"
  }
  ```
- **Response:** `{ "activation_id": "uuid", "status": "COURSE_COMPLETED" }`

#### `POST /api/v1/admin/agent-activations/{id}/approve`

- **Description:** Admin approves and activates agent in a single atomic operation
- **Auth:** Admin token
- **Request:** (none; id is path parameter)
- **Response:**
  ```json
  {
    "activation_id": "uuid",
    "status": "ACTIVE",
    "activated_at": "2026-07-25T14:30:00Z",
    "commission_triggered": true
  }
  ```
- **Side Effects:** Atomic completion of approval + ACTIVE status + Agent Upgrade Commission calculation trigger
- **D-01 frozen:** Commission is directly EARNED. `current_status` is always `EARNED`.

#### `POST /api/v1/admin/agent-activations/{id}/suspend`

- **Description:** Suspend an active agent
- **Auth:** Admin token
- **Request:**
  ```json
  {
    "reason": "string"
  }
  ```
  (activation_id is path parameter)
- **Response:** `{ "activation_id": "uuid", "status": "SUSPENDED" }`

#### `POST /api/v1/admin/agent-activations/{id}/reactivate`

- **Description:** Reactivate a suspended agent
- **Auth:** Admin token
- **Request:** (none; id is path parameter)
- **Response:** `{ "activation_id": "uuid", "status": "ACTIVE" }`

#### `POST /api/v1/admin/agent-activations/{id}/deactivate`

- **Description:** Permanently deactivate an agent
- **Auth:** Admin token
- **Request:**
  ```json
  {
    "reason": "string"
  }
  ```
  (activation_id is path parameter)
- **Response:** `{ "activation_id": "uuid", "status": "DEACTIVATED" }`

#### `GET /api/v1/agent/status`

- **Description:** Get agent activation status
- **Auth:** Member token
- **Response:**
  ```json
  {
    "activation_id": "uuid",
    "status": "ACTIVE",
    "activated_at": "2026-07-25T14:30:00Z",
    "market": "MY"
  }
  ```

### 25.2 Commission Query APIs

#### `POST /api/v1/commission/calculate`

- **Description:** Trigger commission calculation for a source event (system internal)
- **Auth:** System token
- **Request:**
  ```json
  {
    "source_type": "MEMBER_CONSUMPTION",
    "source_reference": "TXN-uuid"
  }
  ```
  (Idempotency-Key is passed as HTTP header, not in request body)
- **Headers:** `Idempotency-Key: <uuid>` (client-provided transport deduplication token)
- **Response (D-01 frozen — Direct EARNED):**

  ```json
  {
    "entries": [
      {
        "entry_id": "uuid",
        "beneficiary_id": "uuid",
        "source_type": "MEMBER_CONSUMPTION",
        "entry_type": "MEMBER_CONSUMPTION_G1_EARN",
        "amount": "1.50",
        "current_status": "EARNED"
      }
    ],
    "processing_outcome": "CREATED"
  }
  ```

- **Idempotent:** Yes (server uses Canonical Processing Key for deduplication; Transport Idempotency-Key header for HTTP-level deduplication)

#### `GET /api/v1/commission/ledger`

- **Description:** Get commission ledger for current agent
- **Auth:** Member token (agent only)
- **Query Params:** `?market=MY&current_status=EARNED&limit=20&offset=0`
- **Response (D-01 frozen — Direct EARNED):**
  ```json
  {
    "entries": [
      {
        "entry_id": "uuid",
        "public_reference": "COM-20260725-00001",
        "source_type": "MEMBER_CONSUMPTION",
        "entry_type": "MEMBER_CONSUMPTION_G1_EARN",
        "amount": "1.50",
        "currency": "MYR",
        "current_status": "EARNED",
        "effective_time": "2026-07-25T14:30:00Z",
        "created_at": "2026-07-25T14:31:00Z"
      }
    ],
    "total": 150,
    "limit": 20,
    "offset": 0
  }
  ```
  **D-01 frozen:** `current_status` is always `EARNED`. No PENDING status exists.

#### `GET /api/v1/commission/ledger/{entry_id}`

- **Description:** Get single ledger entry detail
- **Auth:** Member token (if own entry) or Admin token
- **Response (D-01 frozen — Direct EARNED):**
  ```json
  {
    "entry_id": "uuid",
    "public_reference": "COM-20260725-00001",
    "beneficiary_id": "uuid",
    "source_type": "MEMBER_CONSUMPTION",
    "entry_type": "MEMBER_CONSUMPTION_G1_EARN",
    "source_reference": "TXN-uuid",
    "market": "MY",
    "currency": "MYR",
    "amount": "1.50",
    "calculation_basis": "150.00",
    "rate_version_id": "uuid",
    "generation": 1,
    "current_status": "EARNED",
    "effective_time": "2026-07-25T14:30:00Z",
    "created_at": "2026-07-25T14:31:00Z"
  }
  ```
  **D-01 frozen:** `current_status` is always `EARNED`.

#### `GET /api/v1/commission/summary`

- **Description:** Get commission summary by market
- **Auth:** Member token (agent only)
- **Response (D-01 frozen — Direct EARNED):**

  `balances_by_status` maps status strings to totals. Per D-01 frozen, only `EARNED` status exists.

  ```json
  {
    "markets": {
      "MY": {
        "balances_by_status": {
          "EARNED": "2500.00"
        },
        "currency": "MYR"
      },
      "SG": {
        "balances_by_status": {
          "EARNED": "1200.00"
        },
        "currency": "SGD"
      }
    }
  }
  ```

  **D-01 frozen:** Only `EARNED` status key exists. No PENDING. No CANCELLED.

### 25.3 Admin Commission APIs

#### `GET /api/v1/admin/commission/ledger`

- **Description:** Search all commission entries (admin)
- **Auth:** Admin token
- **Query Params:** `?beneficiary_id=uuid&entry_type=MEMBER_CONSUMPTION_G1_EARN&current_status=EARNED&market=MY&from=2026-07-01&to=2026-07-25&limit=20&offset=0`
- **Response:** Paginated commission entries

#### `POST /api/v1/admin/commission-adjustments`

- **Description:** Create admin adjustment entry (maker action) — D-13/D-14 APPROVED_AND_FROZEN
- **Auth:** Admin token (Maker) — maker_id extracted from auth principal
- **Request:**
  ```json
  {
    "beneficiary_id": "uuid",
    "amount": "100.00",
    "market": "MY",
    "currency": "MYR",
    "reason": "Correction for miscalculation on TXN-12345",
    "audit_reference": "ADM-20260725-001"
  }
  ```
- **Response:** `{ "adjustment_id": "uuid", "status": "PENDING_CHECKER" }`

#### `POST /api/v1/admin/commission-adjustments/{id}/approve`

- **Description:** Approve a pending adjustment (checker action) — D-13/D-14 APPROVED_AND_FROZEN
- **Auth:** Admin token (Checker) — checker_id extracted from auth principal (must differ from maker_id per D-14 frozen)
- **Request:** (none, idempotent by {id})
- **Response:** `{ "adjustment_id": "uuid", "status": "APPROVED", "entry_id": "uuid" }`

#### `POST /api/v1/admin/commission-adjustments/{id}/reject`

- **Description:** Reject a pending adjustment — D-13/D-14 APPROVED_AND_FROZEN
- **Auth:** Admin token (Checker) — checker_id extracted from auth principal (must differ from maker_id per D-14 frozen)
- **Request:** `{ "reason": "string" }`
- **Response:** `{ "adjustment_id": "uuid", "status": "REJECTED" }`

#### `POST /api/v1/admin/commission/reprocess`

- **Description:** Re-process commission for a source event (idempotent)
- **Auth:** Admin token
- **Request:**
  ```json
  {
    "source_type": "MEMBER_CONSUMPTION",
    "source_reference": "TXN-uuid"
  }
  ```
- **Response:** Existing or new ledger entries

#### `GET /api/v1/admin/commission/audit`

- **Description:** Audit log for commission entries
- **Auth:** Admin token
- **Query Params:** `?entry_id=uuid&limit=50&offset=0`
- **Response:** Status transition log

### 25.4 Referral APIs

#### `POST /api/v1/referral/register`

- **Description:** Record referral during member registration
- **Auth:** System token (internal)
- **Request:**
  ```json
  {
    "referee_id": "uuid",
    "referrer_code": "ABC123"
  }
  ```
- **Response:** `{ "referral_id": "uuid", "referrer_id": "uuid" }`

#### `GET /api/v1/referral/tree`

- **Description:** Get referral tree (anonymized for agents)
- **Auth:** Member token
- **Query Params:** `?depth=2`
- **Response:**
  ```json
  {
    "my_code": "ABC123",
    "referrer": {
      "masked_reference": "***",
      "is_agent": true
    },
    "referrals": {
      "g1_count": 45,
      "g2_count": 120,
      "g1_agents": 12,
      "g2_agents": 35
    }
  }
  ```

---

## 26. Error Codes

### 26.1 Agent Activation Errors

| Code                            | HTTP Status | Message                                              | Description                                      |
| ------------------------------- | ----------- | ---------------------------------------------------- | ------------------------------------------------ |
| AGENT_ALREADY_APPLIED           | 409         | Member already has an active agent application       | Each member can only have one active application |
| AGENT_ALREADY_ACTIVE            | 409         | Member is already an active agent                    | Cannot re-apply if already ACTIVE                |
| AGENT_INVALID_STATUS_TRANSITION | 400         | Invalid status transition from {current} to {target} | Status machine violation                         |
| AGENT_PAYMENT_REQUIRED          | 400         | Agent payment required before proceeding             | Payment step not completed                       |
| AGENT_COURSE_REQUIRED           | 400         | Course completion required before proceeding         | Course not completed                             |
| AGENT_APPROVAL_REQUIRED         | 400         | Admin approval required before activation            | Not yet approved                                 |
| AGENT_NOT_FOUND                 | 404         | Agent activation record not found                    | Invalid activation_id                            |
| AGENT_MARKET_MISMATCH           | 400         | Agent market does not match event market             | Cross-market constraint                          |

### 26.2 Referral Errors

| Code                                 | HTTP Status | Message                                                        | Description                                                                        |
| ------------------------------------ | ----------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| REFERRAL_CODE_INVALID                | 400         | Referral code not found                                        | Code does not match any member                                                     |
| REFERRAL_SELF                        | 400         | Cannot refer yourself                                          | Self-referral prevention                                                           |
| REFERRAL_CYCLE                       | 400         | Referral would create a cycle                                  | DAG invariant violation                                                            |
| REFERRAL_ALREADY_EXISTS              | 409         | Member already has a referrer                                  | One referrer per member rule                                                       |
| REFERRAL_IMMUTABLE                   | 409         | Referral relationship is immutable — cannot be corrected       | D-15 frozen: Member Referral Only. No corrections allowed, no exceptions.          |
| MERCHANT_ATTRIBUTION_CHANGE_REJECTED | 409         | Merchant attribution change not permitted under current policy | Merchant attribution change policy is a separate Open Item (not governed by D-15). |

### 26.3 Commission Errors

| Code                           | HTTP Status | Message                                                | Description                                                                                                                              |
| ------------------------------ | ----------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| COMMISSION_SOURCE_NOT_FOUND    | 404         | Source event not found                                 | Invalid source_reference                                                                                                                 |
| COMMISSION_SOURCE_CONFLICT     | 409         | Source already processed with different payload        | Processing already exists for this source; if payload matches, return existing result (idempotent). If payload differs, reject with 409. |
| COMMISSION_RATE_NOT_FOUND      | 500         | No commission rate found for (type, gen, market, time) | Missing rate configuration                                                                                                               |
| COMMISSION_INVALID_SOURCE_TYPE | 400         | Unknown commission source type                         | Invalid source_type                                                                                                                      |
| COMMISSION_MARKET_MISMATCH     | 400         | Source event market does not match                     | Cross-market constraint                                                                                                                  |

### 26.4 Idempotency Errors

| Code                      | HTTP Status | Message                                          | Description                    |
| ------------------------- | ----------- | ------------------------------------------------ | ------------------------------ |
| IDEMPOTENCY_KEY_MISMATCH  | 409         | Idempotency key exists with different payload    | Same key, different payload    |
| IDEMPOTENCY_KEY_IN_FLIGHT | 409         | Request with this key is already being processed | Concurrent processing detected |

### 26.5 Ledger Errors

| Code                             | HTTP Status | Message                                               | Description                       |
| -------------------------------- | ----------- | ----------------------------------------------------- | --------------------------------- |
| LEDGER_ENTRY_NOT_FOUND           | 404         | Commission ledger entry not found                     | Invalid entry_id                  |
| COMPENSATION_ALREADY_EXISTS      | 409         | Compensation entry already exists for this correction | Duplicate compensation prevention |
| LEDGER_INVALID_STATUS_TRANSITION | 400         | Invalid status transition                             | State machine violation           |
| LEDGER_AMOUNT_MISMATCH           | 400         | Amount does not match calculation basis               | Validation failure                |

**Note (D-01 frozen):** CANCELLED-related errors are not required. Post-earning cancellation is not enabled per D-01 (Direct EARNED). Commission is always EARNED at calculation time; no PENDING→CANCELLED transition exists.

### 26.6 Admin Adjustment Errors (D-13/D-14 APPROVED_AND_FROZEN)

| Code                          | HTTP Status | Message                                                      | Description                                                                  |
| ----------------------------- | ----------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| ADJUSTMENT_NOT_FOUND          | 404         | Adjustment request not found                                 | Invalid adjustment_id                                                        |
| ADJUSTMENT_INVALID_STATUS     | 409         | Adjustment request is not in PENDING_CHECKER status          | Cannot approve/reject an adjustment that is not PENDING_CHECKER              |
| ADJUSTMENT_ALREADY_DECIDED    | 409         | Adjustment request has already been decided                  | Cannot approve/reject an already decided adjustment                          |
| ADJUSTMENT_APPROVAL_CONFLICT  | 409         | Adjustment has a conflicting approval state                  | Concurrent approve/reject conflict detected                                  |
| ADJUSTMENT_CHECKER_REQUIRED   | 400         | Checker approval required                                    | Two-person rule — all adjustments require a Checker (D-14 frozen)            |
| ADJUSTMENT_MAKER_CHECKER_SAME | 409         | Maker and checker cannot be the same person                  | Maker/Checker segregation (D-14 frozen)                                      |
| ADJUSTMENT_INVALID_AMOUNT     | 400         | Adjustment amount must be non-zero                           | Zero-amount adjustment not allowed                                           |
| KYC_LEVEL_2_REQUIRED          | 403         | KYC Level 2 verification required for payout/wallet transfer | Reserved for future payout/wallet gate (D-11 frozen: Phase 5 earning 不受限) |

### 26.7 Payout/Wallet Errors (D-10 APPROVED_AND_FROZEN — Display-only Phase 5)

| Code                          | HTTP Status | Message                                        | Description                                                       |
| ----------------------------- | ----------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| WALLET_TRANSFER_NOT_AVAILABLE | 503         | Wallet transfer not available in current phase | Reserved for future phase — Phase 5 is display-only (D-10 frozen) |
| PAYOUT_NOT_AVAILABLE          | 503         | Payout not available in current phase          | Reserved for future phase — Phase 5 is display-only (D-10 frozen) |

### 26.8 General Errors

| Code             | HTTP Status | Message                   | Description              |
| ---------------- | ----------- | ------------------------- | ------------------------ |
| UNAUTHORIZED     | 401         | Authentication required   | Missing or invalid token |
| FORBIDDEN        | 403         | Insufficient permissions  | AuthZ failure            |
| INTERNAL_ERROR   | 500         | Internal server error     | Unhandled exception      |
| VALIDATION_ERROR | 400         | Request validation failed | Invalid input            |

---

## 27. Acceptance Test Matrix

### 27.1 Agent Activation Tests (10 tests)

| ID      | Test                                                 | Expected Result                                                                                                                                              | Type                          |
| ------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| ACT-001 | Member applies for agent — full happy path           | Status flows: NOT_APPLIED → PENDING_PAYMENT → PAYMENT_CONFIRMED → COURSE_PENDING → COURSE_COMPLETED → PENDING_APPROVAL → ACTIVE                              | Positive                      |
| ACT-002 | Member applies twice                                 | Second request rejected with AGENT_ALREADY_APPLIED                                                                                                           | Negative                      |
| ACT-003 | Rejection at any pre-ACTIVE stage                    | Status → REJECTED, no commission earned                                                                                                                      | Negative                      |
| ACT-004 | ACTIVE agent triggers upgrade commission             | G1 and G2 receive commission entries with EARNED status (D-01 frozen)                                                                                        | Positive                      |
| ACT-007 | Payment confirmation without valid payment reference | Payment validation failure                                                                                                                                   | Negative                      |
| ACT-008 | Course completion before payment                     | Transition rejected: payment not confirmed                                                                                                                   | Negative                      |
| ACT-009 | Approval before payment+courses                      | Transition rejected                                                                                                                                          | Negative                      |
| ACT-010 | Activation without approval                          | Transition rejected                                                                                                                                          | Negative                      |
| ACT-011 | Deactivate an ACTIVE agent                           | Status → DEACTIVATED, no future commission                                                                                                                   | Positive                      |
| ACT-012 | Reactivate DEACTIVATED agent                         | **DEFERRED — NOT AUTHORIZED.** Agent Reapplication Policy is an Open Item (non-numbered). No re-activation path defined. Must NOT be implemented in Phase 5. | **DEFERRED / NOT AUTHORIZED** |

### 27.2 Referral Tests (10 tests)

| ID      | Test                                                | Expected Result                                                                                      | Type              |
| ------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------- |
| REF-001 | Member registers with valid referral code           | Referral relationship created, referrer assigned                                                     | Positive          |
| REF-002 | Member registers without referral code              | No referrer assigned                                                                                 | Positive          |
| REF-003 | Member registers with own referral code             | Rejected with REFERRAL_SELF                                                                          | Negative          |
| REF-004 | Referral cycle prevention (A→B→A)                   | Rejected with REFERRAL_CYCLE                                                                         | Negative          |
| REF-005 | Referral cycle prevention (A→B→C→A)                 | Rejected with REFERRAL_CYCLE                                                                         | Negative          |
| REF-006 | Referral code not found                             | Rejected with REFERRAL_CODE_INVALID                                                                  | Negative          |
| REF-007 | Member already has referrer tries to set another    | Rejected with REFERRAL_ALREADY_EXISTS                                                                | Negative          |
| REF-008 | Referrer not ACTIVE at source event — G1 skip       | No G1 commission for that event                                                                      | Negative          |
| REF-009 | Referrer ACTIVE but G2 not ACTIVE                   | G1 commission created, G2 skipped                                                                    | Positive/Negative |
| REF-010 | Referral relationship persists across market change | Same referrer after market switch [CONDITIONAL ON schema: depends on final commission_ledger schema] | Positive          |

### 27.3 Agent Upgrade Commission Tests (8 tests)

| ID      | Test                                           | Expected Result                                                                                            | Type     |
| ------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------- |
| AUG-001 | New agent activated — G1 ACTIVE                | G1 receives RM88 (or market rate), status EARNED (D-01 frozen)                                             | Positive |
| AUG-002 | New agent activated — G1 and G2 both ACTIVE    | G1 RM88, G2 RM38, both EARNED (D-01 frozen)                                                                | Positive |
| AUG-003 | New agent activated — G1 ACTIVE, G2 not ACTIVE | Only G1 receives RM88, status EARNED                                                                       | Positive |
| AUG-004 | New agent activated — G1 not ACTIVE            | G1 commission skipped; G2 still independently evaluated. If G2 is ACTIVE, G2 receives commission (EARNED). | Positive |
| AUG-005 | Payment only, no activation                    | No commission triggered                                                                                    | Negative |
| AUG-006 | Same referrer activates multiple agents        | Each activation generates separate G1 commissions                                                          | Positive |
| AUG-007 | Agent upgrade commission rate change           | New activation uses new rate, old activations retain old rate                                              | Positive |
| AUG-008 | Activation with idempotent replay              | Repeated call returns same result, no duplicate                                                            | Positive |

### 27.4 Member Consumption Commission Tests (10 tests)

| ID      | Test                                             | Expected Result                                                                                            | Type      |
| ------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | --------- |
| CON-001 | Transaction confirmed — G1 ACTIVE                | G1 receives service_fee × 1%, status EARNED (D-01 frozen)                                                  | Positive  |
| CON-002 | Transaction confirmed — G1 and G2 ACTIVE         | G1 = fee × 1%, G2 = fee × 0.5%, both EARNED                                                                | Positive  |
| CON-003 | Transaction confirmed — G1 ACTIVE, G2 not ACTIVE | Only G1 commission created, EARNED                                                                         | Positive  |
| CON-004 | Transaction confirmed — G1 not ACTIVE            | G1 commission skipped; G2 still evaluated independently. If G2 is ACTIVE, G2 receives commission (EARNED). | Positive  |
| CON-005 | Transaction reversed                             | Original entries unchanged, compensation entries created                                                   | Positive  |
| CON-006 | Transaction refunded                             | Original entries unchanged, refund compensation created                                                    | Positive  |
| CON-007 | Zero service fee transaction                     | Commission rounds to zero → SKIPPED_ZERO_AMOUNT, no ledger entry (D-26 frozen)                             | Edge case |
| CON-008 | Large service fee — precision check              | Amount computed to full decimal precision                                                                  | Positive  |
| CON-009 | Multiple transactions same agent                 | Each generates separate commission entries                                                                 | Positive  |
| CON-010 | Transaction after rate change                    | Commission uses rate at transaction time                                                                   | Positive  |

### 27.5 Merchant Recruitment Commission Tests (8 tests)

| ID      | Test                                             | Expected Result                                                                                                                                                    | Type                                        |
| ------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| MRC-001 | Merchant has recruiter — transaction confirmed   | Recruiter receives service_fee × 0.5%, status EARNED                                                                                                               | Positive                                    |
| MRC-002 | Merchant has no recruiter                        | No merchant recruitment commission                                                                                                                                 | Negative                                    |
| MRC-003 | Transaction reversed                             | Compensation entry created                                                                                                                                         | Positive                                    |
| MRC-004 | Recruiter not ACTIVE at transaction time         | **D-05 frozen (ACTIVE per transaction — Option A):** No commission. Recruiter must be ACTIVE at each transaction Confirm time.                                     | **Negative (fixed — not config-dependent)** |
| MRC-005 | Merchant recruited by self                       | Self-recruitment detection                                                                                                                                         | Negative                                    |
| MRC-006 | Multiple transactions — same merchant/recruiter  | Each generates separate commission                                                                                                                                 | Positive                                    |
| MRC-007 | Merchant recruitment — generation limit          | Only G1 (single gen), no G2                                                                                                                                        | Positive                                    |
| MRC-008 | Non-zero merchant commission below posting scale | Residual not allocated (D-25 frozen). If amount rounds to zero at posting scale → SKIPPED_ZERO_AMOUNT (D-26 frozen). Zero service fee scenario covered by CON-007. | Edge case                                   |

### 27.6 Ledger & Immutability Tests (8 tests)

| ID      | Test                                        | Expected Result                                                                    | Type     |
| ------- | ------------------------------------------- | ---------------------------------------------------------------------------------- | -------- |
| LDG-001 | Commission entry created with EARNED status | Entry exists with correct fields, posting_status = EARNED, current_status = EARNED | Positive |
| LDG-002 | Attempt to UPDATE ledger entry              | Rejected (constraint or application rule)                                          | Negative |
| LDG-003 | Attempt to DELETE ledger entry              | Rejected                                                                           | Negative |
| LDG-004 | Reversal compensation entry created         | Opposite amount, reversal_linkage set                                              | Positive |
| LDG-005 | Compensation entry references original      | reversal_linkage = original entry_id                                               | Positive |
| LDG-006 | Rate snapshot immutable after creation      | Snapshot fields not changed                                                        | Positive |
| LDG-007 | Public reference uniqueness                 | Duplicate public reference rejected                                                | Negative |
| LDG-008 | Agent sees own commissions only             | Privacy projection enforced                                                        | Positive |

### 27.7 Idempotency Tests (6 tests)

| ID      | Test                                    | Expected Result                             | Type     |
| ------- | --------------------------------------- | ------------------------------------------- | -------- |
| IDM-001 | Same key + same payload replayed        | Returns original result, no duplicate entry | Positive |
| IDM-002 | Same key + different payload            | Rejected with IDEMPOTENCY_KEY_MISMATCH      | Negative |
| IDM-003 | Concurrent requests same key            | Only one entry created                      | Positive |
| IDM-004 | Crash recovery — replay idempotent      | Safe, no duplicate                          | Positive |
| IDM-005 | Different keys for different source+gen | Each creates separate entry                 | Positive |
| IDM-006 | Compensation idempotency                | Reversal/refund compensation replay safe    | Positive |

### 27.8 Concurrency Tests (4 tests)

| ID       | Test                                               | Expected Result                                 | Type     |
| -------- | -------------------------------------------------- | ----------------------------------------------- | -------- |
| CONC-001 | Two activation events for same agent concurrently  | Only one activation succeeds                    | Positive |
| CONC-002 | Two transactions for same beneficiary concurrently | Both commissions written correctly              | Positive |
| CONC-003 | Transaction and its reversal concurrently          | Ordering preserved, no partial state            | Positive |
| CONC-004 | Lock ordering — no deadlock                        | Multiple beneficiary commissions handled safely | Positive |

### 27.9 Admin Adjustment Tests — Maker/Checker (21 tests — ADJ-001~021)

**D-13/D-14 APPROVED_AND_FROZEN:** Admin adjustment with full Maker/Checker workflow is confirmed Phase 5 scope. All adjustments require a Checker; no Maker-only threshold exception.

| ID      | Test                                                                        | Expected Result                                                                            | Type     |
| ------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------- |
| ADJ-001 | Admin adjustment — maker submits new adjustment                             | Adjustment created with status PENDING_CHECKER, maker_id set from auth principal           | Positive |
| ADJ-002 | Admin adjustment — checker approves                                         | Status transitions to APPROVED, commission_ledger entry created with ADMIN_ADJUSTMENT type | Positive |
| ADJ-003 | Admin adjustment — checker rejects                                          | Status transitions to REJECTED, no ledger entry created                                    | Positive |
| ADJ-004 | Admin adjustment without checker (maker tries to approve own)               | Rejected with ADJUSTMENT_CHECKER_REQUIRED                                                  | Negative |
| ADJ-005 | Admin adjustment — maker == checker                                         | Rejected with ADJUSTMENT_MAKER_CHECKER_SAME (409)                                          | Negative |
| ADJ-006 | Admin adjustment zero amount                                                | Rejected with ADJUSTMENT_INVALID_AMOUNT (400)                                              | Negative |
| ADJ-007 | Admin adjustment — positive amount                                          | Ledger entry created with amount = +value                                                  | Positive |
| ADJ-008 | Admin adjustment — negative amount                                          | Ledger entry created with amount = -value                                                  | Positive |
| ADJ-009 | Admin adjustment — adjustment for non-existent member                       | Rejected with appropriate 404 error                                                        | Negative |
| ADJ-010 | Admin adjustment — reason field required                                    | Rejected with VALIDATION_ERROR if reason missing                                           | Negative |
| ADJ-011 | Admin adjustment — amount exceeds maximum precision                         | Rejected with VALIDATION_ERROR                                                             | Negative |
| ADJ-012 | Admin adjustment — amount rounds to zero at posting scale                   | Rejected with ADJUSTMENT_INVALID_AMOUNT (cannot create zero-amount adjustment)             | Negative |
| ADJ-013 | Admin adjustment — non-admin token                                          | 403 FORBIDDEN                                                                              | Negative |
| ADJ-014 | Admin adjustment — approve already-approved adjustment                      | Rejected with appropriate status error                                                     | Negative |
| ADJ-015 | Admin adjustment — approve already-rejected adjustment                      | Rejected with appropriate status error                                                     | Negative |
| ADJ-016 | Admin adjustment — reject already-approved adjustment                       | Rejected with appropriate status error                                                     | Negative |
| ADJ-017 | Admin adjustment — reject already-rejected adjustment                       | Rejected with appropriate status error                                                     | Negative |
| ADJ-018 | Admin adjustment — maker_id extracted from auth principal, not request body | Client-supplied maker_id rejected with FORBIDDEN                                           | Negative |
| ADJ-019 | Admin adjustment — checker_id extracted from auth principal on approve      | Approver identity from token, not request body                                             | Positive |
| ADJ-020 | Admin adjustment audit trail                                                | Maker, checker, timestamps, before/after snapshot recorded                                 | Positive |
| ADJ-021 | Admin adjustment — public reference format                                  | ADJ-YYYYMMDD-NNNNN format enforced                                                         | Positive |

### 27.10 Error Handling Tests (6 tests)

| ID      | Test                                            | Expected Result                 | Type     |
| ------- | ----------------------------------------------- | ------------------------------- | -------- |
| ERR-001 | Invalid agent status transition                 | AGENT_INVALID_STATUS_TRANSITION | Negative |
| ERR-002 | Commission for non-existent source              | COMMISSION_SOURCE_NOT_FOUND     | Negative |
| ERR-003 | Missing rate configuration                      | COMMISSION_RATE_NOT_FOUND       | Negative |
| ERR-004 | Unauthorized access to commission API           | 401 UNAUTHORIZED                | Negative |
| ERR-005 | Forbidden access (member + others' commissions) | 403 FORBIDDEN                   | Negative |
| ERR-006 | Invalid decimal string amount                   | VALIDATION_ERROR                | Negative |

### 27.11 Test Count Summary

| Category                                                               | Tests   |
| ---------------------------------------------------------------------- | ------- |
| Agent Activation                                                       | 10      |
| Referral                                                               | 10      |
| Agent Upgrade Commission                                               | 8       |
| Member Consumption Commission                                          | 10      |
| Merchant Recruitment Commission                                        | 8       |
| Ledger & Immutability                                                  | 8       |
| Idempotency                                                            | 6       |
| Concurrency                                                            | 4       |
| Admin Adjustment (Maker/Checker) — ADJ-001~021                         | 21      |
| Batch D Decision Tests (D-10 through D-23) — BD-001~047                | 47      |
| Error Handling                                                         | 6       |
| D-07 Activation Market (ACT-013 ~ ACT-024)                             | 12      |
| Decimal Precision (DEC-001 ~ DEC-012)                                  | 12      |
| Branch Recruiter Attribution (BRN-001 ~ BRN-014)                       | 14      |
| D-06 Agent Upgrade Revocation (REV-001 ~ REV-010)                      | 10      |
| **Base Tests**                                                         | **185** |
| Additional Critical Tests (EXT-001 ~ EXT-035 (excl. EXT-011 deferred)) | 34      |
| **Executable Total**                                                   | **219** |
| Deferred                                                               | 2       |

### 27.12 Additional Critical Tests (35 tests)

| ID      | Test                                                                              | Expected Result                                                                                                                                                                                                                                                                                                                                         | Type                          |
| ------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| EXT-001 | Duplicate idempotency key, same payload                                           | Returns original result                                                                                                                                                                                                                                                                                                                                 | Positive                      |
| EXT-002 | Duplicate idempotency key, different payload                                      | IDEMPOTENCY_KEY_MISMATCH                                                                                                                                                                                                                                                                                                                                | Negative                      |
| EXT-003 | Concurrent commission calc same source                                            | Exactly one entry created                                                                                                                                                                                                                                                                                                                               | Concurrency                   |
| EXT-004 | Commission calc — source event market mismatch                                    | Correct market commission created                                                                                                                                                                                                                                                                                                                       | Edge                          |
| EXT-005 | Commission calc — beneficiary across markets                                      | Separate entries per market                                                                                                                                                                                                                                                                                                                             | Positive                      |
| EXT-006 | Rate version not found for market                                                 | COMMISSION_RATE_NOT_FOUND                                                                                                                                                                                                                                                                                                                               | Negative                      |
| EXT-007 | Reversal compensation — idempotent replay                                         | Same compensation returned                                                                                                                                                                                                                                                                                                                              | Positive                      |
| EXT-008 | Reversal compensation — original not modified                                     | Original entry unchanged                                                                                                                                                                                                                                                                                                                                | Positive                      |
| EXT-009 | Agent SUSPENDED — source event during suspension                                  | No commission for suspended period                                                                                                                                                                                                                                                                                                                      | Negative                      |
| EXT-010 | Agent DEACTIVATED — source event after deactivation                               | No commission                                                                                                                                                                                                                                                                                                                                           | Negative                      |
| EXT-011 | Agent reactivated — source event after reactivation                               | **DEFERRED — NOT AUTHORIZED.** Agent Reapplication Policy is an Open Item. Re-activation from DEACTIVATED is not defined. This test must NOT be executed in Phase 5.                                                                                                                                                                                    | **DEFERRED / NOT AUTHORIZED** |
| EXT-012 | Privacy: agent sees own commissions only                                          | Own commissions, not others                                                                                                                                                                                                                                                                                                                             | Positive                      |
| EXT-013 | Privacy: agent sees anonymized referral tree                                      | Counts only, no member IDs                                                                                                                                                                                                                                                                                                                              | Positive                      |
| EXT-014 | Admin adjustment maker/checker segregation                                        | Maker ≠ Checker enforced                                                                                                                                                                                                                                                                                                                                | Negative                      |
| EXT-015 | Commission calculation generation independence                                    | G1 ineligible → G2 still evaluated                                                                                                                                                                                                                                                                                                                      | Positive                      |
| EXT-016 | No compression rule enforcement                                                   | Ineligible G2 → no re-allocation to G1                                                                                                                                                                                                                                                                                                                  | Positive                      |
| EXT-017 | Public reference format validation                                                | COM-YYYYMMDD-NNNNN format enforced                                                                                                                                                                                                                                                                                                                      | Positive                      |
| EXT-018 | Cross-market balance isolation                                                    | MY and SG balances separate                                                                                                                                                                                                                                                                                                                             | Positive                      |
| EXT-019 | G1 missing + G2 traversal — referral chain                                        | G1 absent (not ACTIVE/not agent), G2 eligible: G2 commission created independently                                                                                                                                                                                                                                                                      | Positive                      |
| EXT-020 | Concurrent rate update during commission calc                                     | Commission uses snapshot at source event time even while rate is being updated                                                                                                                                                                                                                                                                          | Concurrency                   |
| EXT-021 | Overlapping rate period — enforcement                                             | GiST EXCLUDE constraint prevents overlapping effective ranges                                                                                                                                                                                                                                                                                           | Negative                      |
| EXT-022 | Transaction confirm + refund sequence                                             | Original commission created on confirm; refund triggers compensation entry                                                                                                                                                                                                                                                                              | Positive                      |
| EXT-023 | Atomic compensation — multiple linked entries                                     | All compensation entries for one source written in single transaction                                                                                                                                                                                                                                                                                   | Positive                      |
| EXT-024 | Different correction execution IDs cannot over-compensate the same original entry | Full compensation once only per original entry. Replay idempotent — same correction execution replayed returns same result. Cumulative compensated amount <= original absolute amount. No duplicate financial liability reversal across correction executions for the same original entry.                                                              | Positive/Negative             |
| EXT-025 | Atomic compensation chain failure rollback                                        | A transaction produces three commissions (G1/G2/Merchant). Correction generates three compensation entries. If the second or third compensation write fails, the entire transaction must roll back. No partial compensation ledger entries remain. commission_processing must NOT be COMPLETED. On retry, all three compensations are safely generated. | Positive                      |
| EXT-026 | Self API member_id spoof rejection                                                | Member self-service APIs (POST /api/v1/agent/... / GET /api/v1/commission/...) must extract member_id from auth principal (JWT token), NOT from request body. Client-supplied member_id must be rejected with FORBIDDEN.                                                                                                                                | Negative                      |
| EXT-027 | Maker self-approve rejection                                                      | Same admin cannot be both maker and checker for same adjustment                                                                                                                                                                                                                                                                                         | Negative                      |
| EXT-028 | Referral Immutability Enforcement                                                 | Committed referral relationship A → B. Attempt to update A's referrer_id to C (or any other correction). System must reject with REFERRAL_IMMUTABLE (409). No correction event, no partial writes, no Referral Versioning — referral relationships are permanently immutable (Member Referral Only). Does NOT apply to branch attribution.              | Negative                      |
| EXT-029 | Status projection ORDER BY correctness                                            | commission_status_event query with event_sequence ORDER BY returns correct latest status                                                                                                                                                                                                                                                                | Positive                      |
| EXT-030 | Below-scale amount — less than posting scale minimum                              | Amount too small to round to posting scale: handled per D-25 frozen (residual not allocated) and D-26 frozen (skip and log)                                                                                                                                                                                                                             | Edge case                     |
| EXT-031 | Rounded-to-zero commission                                                        | Commission rounds to 0.00 at posting scale: skip and log per D-26 frozen. No zero-amount ledger entry.                                                                                                                                                                                                                                                  | Edge case                     |
| EXT-032 | One processing — multiple ledger entries                                          | Single source event produces G1 + G2 entries under one processing_id                                                                                                                                                                                                                                                                                    | Positive                      |
| EXT-033 | PAID status unavailable — deferred                                                | PAID is a future deferred scope; current projection correctly does not include PAID                                                                                                                                                                                                                                                                     | Positive                      |
| EXT-034 | Transport vs canonical key divergence                                             | Transport Idempotency-Key header and Canonical Entry Key are distinct; internal dedup uses canonical entry key only                                                                                                                                                                                                                                     | Positive                      |
| EXT-035 | No partial ledger state                                                           | commission_processing status does not include PARTIAL; processing is either IN_FLIGHT, COMPLETED, or FAILED                                                                                                                                                                                                                                             | Positive                      |

### 27.13 D-07 Activation Market Tests (12 tests)

**D-07 frozen:** Agent Upgrade commission market = activation payment market. Account Country change requires new independent activation (re-pay + re-course + re-approval). No cross-market transfer or backfill.

| ID      | Test                                                                    | Expected Result                                                                                                                                                            | Type     |
| ------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ACT-013 | Member ACTIVE in MY changes country to SG                               | MY activation remains ACTIVE. SG market shows NOT_APPLIED. No automatic market transfer.                                                                                   | Positive |
| ACT-014 | SG member applies for agent — SG fee version                            | Agent activation in SG uses SG fee configuration (per D-08 frozen: market-configurable). No cross-market fee lookup.                                                       | Positive |
| ACT-015 | SG application — payment not completed                                  | Status remains PENDING_PAYMENT. No commission triggered. Upgrade G1/G2 not generated.                                                                                      | Negative |
| ACT-016 | SG application — payment confirmed, course not started                  | Status remains PAYMENT_CONFIRMED. Cannot advance to PENDING_APPROVAL without course.                                                                                       | Negative |
| ACT-017 | SG application — course completed, approval not submitted               | Status remains COURSE_COMPLETED. Cannot reach ACTIVE without admin approval.                                                                                               | Negative |
| ACT-018 | SG application — full activation (pay + course + approval)              | Status flows NOT_APPLIED → PENDING_PAYMENT → PAYMENT_CONFIRMED → COURSE_PENDING → COURSE_COMPLETED → PENDING_APPROVAL → ACTIVE. SG activation is independent of MY status. | Positive |
| ACT-019 | MY ACTIVE agent completes SG activation                                 | MY activation remains unchanged. SG activation is a separate record with its own activated_at. Both markets show ACTIVE.                                                   | Positive |
| ACT-020 | MY ACTIVE agent earns MY upgrade commission before SG activation        | MY upgrade commissions recorded in MY ledger only. SG ledger unaffected.                                                                                                   | Positive |
| ACT-021 | SG activation triggers upgrade commission — SG rate version             | SG agent upgrade commission uses SG rate version (per D-09 frozen: market-configurable). SG commissions credited to SG ledger.                                             | Positive |
| ACT-022 | Same member, MY ACTIVE + SG ACTIVE — independent commission eligibility | Each market generates independent commissions. MY source events use MY status. SG source events use SG status. No cross-contamination.                                     | Positive |
| ACT-023 | SUSPEND in MY market — SG ACTIVE independently                          | MY SUSPENDED stops MY commission eligibility. SG ACTIVE continues earning SG commissions. Each market's status is independent.                                             | Positive |
| ACT-024 | No cross-market backfill                                                | SG activation (activated_at = T2) does NOT generate commission for source events in MY that occurred before T2. No historical commission migration.                        | Negative |

### 27.14 Decimal Precision Tests (12 tests)

**D-21 through D-26 frozen.** Tests verify calculation scale (10dp), posting scale (2dp), HALF_UP rounding, independent line rounding, residual handling, and zero-rounded skip behavior.

| ID      | Test                                                 | Expected Result                                                                                                                | Type      |
| ------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------- |
| DEC-001 | Standard 10dp calculation — intermediary precision   | Commission calculated at 10dp precision (e.g., 123.4567890123), not truncated earlier                                          | Positive  |
| DEC-002 | HALF_UP rounding at posting scale — round up         | 2.345 rounds to 2.35 at posting scale (2dp)                                                                                    | Positive  |
| DEC-003 | HALF_UP rounding at posting scale — round down       | 2.344 rounds to 2.34 at posting scale (2dp)                                                                                    | Positive  |
| DEC-004 | Independent line rounding — two entries, same source | G1 and G2 entries independently rounded; no cross-entry aggregation                                                            | Positive  |
| DEC-005 | Residual not allocated — audit only                  | Residual = unrounded - posted. Not stored in ledger; present in rate_snapshot. No separate entry.                              | Positive  |
| DEC-006 | Zero-rounded commission — skipped and logged         | ABS(amount) < 0.005 at posting scale → SKIPPED_ZERO_AMOUNT, no ledger entry, processed logged                                  | Edge case |
| DEC-007 | Large precision multiplication — 10dp chain          | (a × b × c) at 10dp produces correct result, rounding only at final posting step                                               | Positive  |
| DEC-008 | Negative amount rounding — reversal compensation     | Negative amounts rounded HALF_UP at posting scale same as positive amounts                                                     | Positive  |
| DEC-009 | API decimal string at posting scale                  | Amount `1.50` displayed as `"1.50"`, not `"1.5000000000"` (frozen per D-22)                                                    | Positive  |
| DEC-010 | Snapshot contains all precision fields               | rate_snapshot JSONB includes calculation_scale, posting_scale, rounding_mode, unrounded_amount, posted_amount, residual_amount | Positive  |
| DEC-011 | No floating point in calculation                     | Float arithmetic never used for commission calculation; engine uses decimal types                                              | Negative  |
| DEC-012 | Decimal string input validation — invalid            | Non-decimal string rejected (e.g., `"abc"`, `1.23e4`)                                                                          | Negative  |

### 27.15 Branch Recruiter Attribution Tests (14 tests)

**D-19 frozen:** Each branch has independent recruiter (Option B). D-15 (Member Referral Only) does NOT extend to branch attribution. Merchant attribution change policy is a separate Open Item.

| ID      | Test                                                                         | Expected Result                                                                                                                                                                         | Type      |
| ------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| BRN-001 | Parent merchant registered with recruiter                                    | merchant_attribution created with attributed_entity_type = 'MERCHANT', branch_id = NULL, recruiter set                                                                                  | Positive  |
| BRN-002 | Branch registered with independent recruiter                                 | merchant_attribution created with attributed_entity_type = 'BRANCH', branch_id = branch UUID, recruiter set independently of parent                                                     | Positive  |
| BRN-003 | Branch registered without recruiter (no referral code)                       | merchant_attribution not created for this branch; no branch-level recruiter                                                                                                             | Edge case |
| BRN-004 | Parent and branch have different recruiters                                  | Parent recruiter earns 0.5% of parent transactions; branch recruiter earns 0.5% of branch transactions independently                                                                    | Positive  |
| BRN-005 | Parent recruiter not ACTIVE at transaction time — branch recruiter IS ACTIVE | Parent transaction: no merchant recruitment commission (D-05 frozen). Branch transaction: branch recruiter receives commission (if ACTIVE). Each evaluated independently per D-05.      | Positive  |
| BRN-006 | Branch recruiter not ACTIVE at transaction time — parent recruiter IS ACTIVE | Branch transaction: no merchant recruitment commission. Parent recruiter does NOT receive branch commission as fallback (D-19 frozen: independent branch attribution — no inheritance). | Negative  |
| BRN-007 | merchant_attribution UNIQUE constraint — two parent attributions             | Second parent attribution rejected (uq_merchant_attribution_merchant). At most one parent-level recruiter per merchant.                                                                 | Negative  |
| BRN-008 | Merchant Attribution Change Policy — admin attempts to reassign recruiter    | Rejected with MERCHANT_ATTRIBUTION_CHANGE_REJECTED (409). Branch attribution change policy is a separate Open Item (not governed by D-15).                                              | Negative  |
| BRN-009 | UNIQUE constraint — duplicate parent attribution for same merchant           | Rejected by uq_merchant_attribution_merchant. At most one parent attribution per merchant.                                                                                              | Negative  |
| BRN-010 | UNIQUE constraint — duplicate branch attribution for same branch             | Rejected by uq_merchant_attribution_branch. At most one attribution per branch.                                                                                                         | Negative  |
| BRN-011 | Entity-target CHECK — MERCHANT with non-NULL branch_id                       | Rejected by chk_attribution_entity_target. MERCHANT type must have branch_id = NULL.                                                                                                    | Negative  |
| BRN-012 | Entity-target CHECK — BRANCH with NULL branch_id                             | Rejected by chk_attribution_entity_target. BRANCH type must have branch_id NOT NULL.                                                                                                    | Negative  |
| BRN-013 | Permanent CHECK — non-PERMANENT scope or non-NULL effective_until            | Rejected by chk_permanent_attribution. Only PERMANENT scope with NULL effective_until allowed.                                                                                          | Negative  |
| BRN-014 | Branch transaction — branch recruiter inactive, no fallback to parent        | No merchant recruitment commission for that branch transaction. Parent recruiter NOT eligible as fallback (D-19 frozen — no inheritance).                                               | Negative  |

### 27.16 D-06 Agent Upgrade Revocation Tests (10 tests)

**D-06 frozen (APPROVED_AND_FROZEN — T1 Exact Revocation Timestamp; no historical clawback).** Agent upgrade commissions earned at activation time are permanently retained. Activation revocation does NOT trigger compensation entries for G1/G2 upgrade commissions. The Section 8.5 cut-off rule applies: `eligible = (agent_status_at_source = ACTIVE) AND (source_event_time < revoked_at OR revoked_at IS NULL)`.

| ID      | Test                                                                                | Expected Result                                                                                                                                                                                                                                                                   | Type     |
| ------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| REV-001 | Agent ACTIVE before revocation — Agent Upgrade commission eligible                  | G1 receives RM88, G2 receives RM38, both EARNED (D-01 frozen). Source_event_time < revoked_at (or revoked_at IS NULL). eligibility_result = true.                                                                                                                                 | Positive |
| REV-002 | Activation revoked — no compensation entries for pre-revocation upgrade commissions | Activation status changes to DEACTIVATED/REVOKED; no REVERSAL_COMPENSATION or REFUND_COMPENSATION entries for G1/G2 upgrade commissions that were earned before T1. Original commission entries remain untouched.                                                                 | Positive |
| REV-003 | Activation revoked — original pre-revocation upgrade entries still EARNED           | After revocation, original G1/G2 entries (source_event_time < revoked_at) still have current_status = EARNED (not modified, not CANCELLED).                                                                                                                                       | Positive |
| REV-004 | Activation revoked — no negative amount entries for pre-revocation commissions      | Ledger has no negative entries linked to this revocation for commissions earned before T1. Compensation is NOT created.                                                                                                                                                           | Negative |
| REV-005 | Multiple activations — one revoked, others preserved                                | G1/G2 commissions for revoked activation (source_event_time < revoked_at) retained; G1/G2 commissions for other activations entirely unaffected                                                                                                                                   | Positive |
| REV-006 | Revocation replayed — idempotent                                                    | Same revocation processed again returns same result; no duplicate compensation entries for pre-revocation commissions                                                                                                                                                             | Positive |
| REV-007 | Member Consumption source event — source_event_time BEFORE beneficiary revocation   | Source_event_time < revoked_at. Beneficiary was ACTIVE at source_event_time. Commission eligible and EARNED.                                                                                                                                                                      | Positive |
| REV-008 | Member Consumption source event — source_event_time AFTER beneficiary revocation    | Source_event_time > revoked_at. Beneficiary was ACTIVE at source_event_time but activation was already revoked. Commission is **skipped** with result.reason = `AGENT_REVOKED_AT_SOURCE_TIME`. No clawback needed because commission was never earned for post-revocation events. | Negative |
| REV-009 | Cut-off verification — revocation timestamp recorded                                | Revocation event records T1 (Exact Revocation Effective Timestamp); `revoked_at` set in agent_activation; snapshot captures `revoked_at`, `eligibility_result`, `eligibility_reason`                                                                                              | Positive |
| REV-010 | No clawback of upgrade commission for ANY revocation reason                         | Regardless of revocation reason (fraud, policy violation, voluntary), pre-revocation upgrade commissions (source_event_time < revoked_at) are NEVER clawed back                                                                                                                   | Positive |

### 27.17 Batch D — D-10 through D-23 Decision Tests (47 tests — BD-001~047)

**D-10 through D-23 frozen (APPROVED_AND_FROZEN).** Tests cover all Batch D decisions: D-10 (Display-only), D-11 (KYC Level 2 future gate), D-12 (Gross Commission), D-13/D-14 (Admin Adjustment Maker/Checker), D-16 (No future commission after deactivation), D-17 (No Liability), D-20 (No minimum posting), D-23 (Display = Posting Scale).

**D-10/D-11: 1-7 (7 tests)**

| ID     | Test                                                   | Expected Result                                                                                   | Type     |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | -------- |
| BD-001 | D-10: No PAID status in Phase 5                        | commission_status_event to_status does not include PAID; PAID is a future deferred scope          | Positive |
| BD-002 | D-10: Summary shows EARNED only                        | GET /api/v1/commission/summary returns balances_by_status with only EARNED key                    | Positive |
| BD-003 | D-10: Ledger entries do not reference PAID             | No PAID-related status events or transitions exist in Phase 5                                     | Positive |
| BD-004 | D-11: Phase 5 earning 不受限                           | Agent earns commission based on ACTIVE status; no KYC check for earning in Phase 5                | Positive |
| BD-005 | D-11: Agent earns without KYC                          | Agent with no KYC status earns commission in Phase 5 (earning 不受限)                             | Positive |
| BD-006 | D-10: posting_status = EARNED DDL constraint           | commission_ledger.CHECK (posting_status = 'EARNED') enforces D-01 frozen; no NULL or other values | Positive |
| BD-007 | D-10: KYC_LEVEL_2_REQUIRED error code reserved in docs | Error code table documents KYC_LEVEL_2_REQUIRED (403) as reserved for future payout/wallet gate   | Positive |

**D-12: 8-11 (4 tests)**

| ID     | Test                                      | Expected Result                                                                                   | Type     |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------- | -------- |
| BD-008 | D-12: No withholding — no deduction field | Commission ledger entry has no deduction or withheld_amount field                                 | Positive |
| BD-009 | D-12: Amount field is gross               | commission_ledger.amount reflects gross commission before any future withholding                  | Positive |
| BD-010 | D-12: No tax reduction visible            | No withholding rate tables or deduction amounts in commission_ledger or snapshot                  | Positive |
| BD-011 | D-12: API response shows gross amount     | GET /api/v1/commission/ledger returns amount = full earned commission with no deduction breakdown | Positive |

**D-13/D-14: 12-27 (16 tests)**

| ID     | Test                                                  | Expected Result                                                                                                   | Type     |
| ------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------- |
| BD-012 | D-13: Maker submits adjustment → PENDING_CHECKER      | POST /admin/commission-adjustments creates record with status = PENDING_CHECKER, maker_id set from auth principal | Positive |
| BD-013 | D-13: Zero amount rejected                            | POST with amount = 0 returns ADJUSTMENT_INVALID_AMOUNT (400)                                                      | Negative |
| BD-014 | D-13: Pending status fields after submit              | Adjustment_id exists with status PENDING_CHECKER; checker_id, decided_at, ledger_entry_id all NULL                | Positive |
| BD-015 | D-13: Positive amount creates ledger entry on approve | Checker approves; commission_ledger entry created with amount = +value, entry_type = ADMIN_ADJUSTMENT             | Positive |
| BD-016 | D-13: Negative amount creates ledger entry on approve | Checker approves negative adjustment; commission_ledger entry created with amount = -value                        | Positive |
| BD-017 | D-13: Maker_id from auth principal enforced           | Client-supplied maker_id in request body rejected with FORBIDDEN; maker_id extracted from JWT token               | Negative |
| BD-018 | D-13: Reason field required                           | POST without reason returns VALIDATION_ERROR (400)                                                                | Negative |
| BD-019 | D-13: Amount exceeds max precision rejected           | Amount with >10dp precision returns VALIDATION_ERROR (400)                                                        | Negative |
| BD-020 | D-14: All adjustments require checker                 | No Maker-only threshold exception; every adjustment must be approved/rejected by a separate Checker               | Positive |
| BD-021 | D-14: Maker_id != checker_id enforced                 | Approve with same admin as maker returns ADJUSTMENT_MAKER_CHECKER_SAME (409)                                      | Negative |
| BD-022 | D-14: DDL chk_maker_checker_different constraint      | commission_adjustment_request.CHECK (maker_id <> checker_id) prevents self-approval at DB level                   | Positive |
| BD-023 | D-14: Approve → APPROVED with ledger entry            | After approve: status = APPROVED, checker_id set, decided_at set, ledger_entry_id IS NOT NULL                     | Positive |
| BD-024 | D-14: Reject → REJECTED, no ledger entry              | After reject: status = REJECTED, checker_id set, decided_at set, ledger_entry_id IS NULL                          | Positive |
| BD-025 | D-14: Maker = Checker same person                     | Approve/reject with same admin ID as maker returns ADJUSTMENT_MAKER_CHECKER_SAME (409)                            | Negative |
| BD-026 | D-14: Approve already-approved adjustment             | Second approve returns ADJUSTMENT_ALREADY_DECIDED (409) — no duplicate ledger entry                               | Negative |
| BD-027 | D-14: Reject already-rejected adjustment              | Second reject returns ADJUSTMENT_ALREADY_DECIDED (409) — no state mutation                                        | Negative |

**D-16/D-17: 28-38 (11 tests)**

| ID     | Test                                                 | Expected Result                                                                                             | Type     |
| ------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------- |
| BD-028 | D-16: No commission after deactivation               | Source events after DEACTIVATED timestamp produce no commission; outcome = SKIPPED_INELIGIBLE               | Negative |
| BD-029 | D-16: Pre-deactivation commission preserved          | Commission entries created before DEACTIVATED remain EARNED — no clawback                                   | Positive |
| BD-030 | D-16: Past referral transactions after deactivation  | Referral's transactions after deactivation date generate no commission for the deactivated agent            | Negative |
| BD-031 | D-16: No commission during SUSPENDED period          | Source events while SUSPENDED produce no commission                                                         | Negative |
| BD-032 | D-16: Reactivate = SUSPENDED → ACTIVE only           | Reactivation from SUSPENDED transitions to ACTIVE; no commission retroactively earned for suspension period | Positive |
| BD-033 | D-16: DEACTIVATED → NOT_APPLIED not implemented      | DEACTIVATED agent cannot re-apply; Agent Reapplication Policy is an Open Item — NOT implemented in Phase 5  | Negative |
| BD-034 | D-17: No liability for ineligible generation         | G1 not ACTIVE → no G1 commission liability; no ledger entry; processing outcome = SKIPPED_INELIGIBLE        | Positive |
| BD-035 | D-17: Company does not incur cost                    | Platform ledger shows no debit for ineligible generation; company expense = RM0 for that generation         | Positive |
| BD-036 | D-17: No pool reallocation                           | No pool mechanism; ineligible generation simply not generated, not reallocated to any party                 | Positive |
| BD-037 | D-17: SKIPPED_INELIGIBLE processing outcome          | commission_processing.completion_outcome = 'SKIPPED_INELIGIBLE' when all generations ineligible             | Positive |
| BD-038 | D-17: Zero entries created for ineligible generation | commission_ledger has no rows for the ineligible beneficiary-generation combination                         | Positive |

**D-20/D-23: 39-47 (9 tests)**

| ID     | Test                                              | Expected Result                                                                                   | Type      |
| ------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------- |
| BD-039 | D-20: RM0.01 posted                               | Commission of RM0.01 is posted (not suppressed)                                                   | Positive  |
| BD-040 | D-20: Zero-rounded still skipped                  | RM0.001 rounds to RM0.00 → SKIPPED_ZERO_AMOUNT (D-26 governs zero-rounded, not minimum threshold) | Edge case |
| BD-041 | D-20: No aggregation — independent evaluation     | Each commission independently evaluated; no batch minimum applied                                 | Positive  |
| BD-042 | D-20: Sub-penny non-zero amount posted            | Commission of RM0.005 rounds to RM0.01 at 2dp → posted because non-zero after rounding            | Positive  |
| BD-043 | D-20: Multiple small entries posted independently | Two commissions of RM0.001 each rounds to RM0.00 each → both SKIPPED; not aggregated to RM0.01    | Positive  |
| BD-044 | D-23: Display = Posting Scale — 2dp               | All agent-facing API responses display amounts at 2dp (currency minor unit)                       | Positive  |
| BD-045 | D-23: No sub-cent precision in display            | Unrounded amount (12.3456789012) displayed as "12.35" at 2dp; unrounded not shown to agent        | Positive  |
| BD-046 | D-23: Admin audit shows unrounded amount          | Admin audit endpoint shows both posted_amount (2dp) and unrounded_amount (10dp)                   | Positive  |
| BD-047 | D-23: Summary API displays at posting scale       | GET /api/v1/commission/summary balance values at 2dp                                              | Positive  |

---

## 28. Deferred Scope

The following items are explicitly **DEFERRED** and must NOT be implemented in Phase 5:

### 28.1 Five-Level Team Reward

**DEFERRED — NOT AUTHORIZED FOR ANY PHASE 5 SPRINT.**

- No definitions for: ratios, thresholds, headcounts, compression, advancement, demotion, or degradation rules.
- No design work or architecture prep for Five-Level Team Reward.
- This contract does not reference, define, or constrain any Five-Level mechanics.
- Future analysis must start from scratch with a new PRD and architecture review.

### 28.2 Commission Payout

**DEFERRED — requires future authorization.**

- Payout trigger, payout method, payout schedule.
- Integration with payment gateway.
- PAID status transitions.

### 28.3 Commission Expiry

**DEFERRED — requires future authorization.**

- Time-based commission expiry rules.
- EXPIRY source type and reversal entries.

### 28.4 Tax Withholding

**DEFERRED — D-12 frozen (APPROVED_AND_FROZEN): No withholding, Gross Commission in Phase 5.**

- Withholding tax rates per market — DEFERRED to future phase.
- Tax reporting — DEFERRED to future phase.
- D-12 frozen: commission amount = gross commission. No withholding, no deduction, no tax reduction applied in Phase 5.

### 28.5 Webhook Notifications

**DEFERRED — not required for P5-S0 core.**

- Commission earned notifications.
- Status change webhooks.

### 28.6 Administrator UI

**DEFERRED — admin UI implementation is a separate workstream.**

### 28.7 Deferred Test Scenarios

The following test scenarios are explicitly **DEFERRED** and must NOT be counted in the executable test total. They are listed here for future reference and must not be implemented until separately authorized.

| Test ID | Description                                         | Reason for Deferral                                                                        |
| ------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| ACT-012 | Reactivate DEACTIVATED agent                        | Agent Reapplication Policy is an Open Item — no re-activation path defined for DEACTIVATED |
| EXT-011 | Agent reactivated — source event after reactivation | Agent Reapplication Policy is an Open Item — re-activation from DEACTIVATED is not defined |

---

## 29. Bryan Open Decisions — ALL 26 NUMBERED DECISIONS RESOLVED — FINAL DOCUMENT AUDIT PENDING

### Decision Matrix

| #    | Decision Area                                                  | Options                                                                                                                                                                                                                  | Recommendation                                | Recommendation Rationale                                                                                                                                                                                                                                                                                                                                                                                                                               | Product Impact                                                                                                                                                | Financial Impact                                                                                                             | Fraud / Compliance Impact                                                                                                                              | Data Model Impact                                                                                                                                                                                           | API Impact                                                                                               | Blocks                                              | Bryan Decision                                                                                                           |
| ---- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| D-01 | **PENDING vs. direct EARNED**                                  | (A) All commissions go PENDING first, released by event/time (B) All commissions go directly to EARNED at calculation time (C) Hybrid: some sources EARNED, some PENDING                                                 | **(B) Direct EARNED**                         | Simpler implementation; no holding period complexity; no release event dependency; agent sees earned commission immediately. PENDING state adds operational overhead and confusion. (UPDATED)                                                                                                                                                                                                                                                          | All commissions visible immediately; no release mechanism to build; simpler UX                                                                                | No direct financial impact; company loses opportunity to hold funds                                                          | No holding period = no reversal window for fraud detection; compensation via opposite entries still works                                              | No PENDING→EARNED transition logic needed; state machine simpler                                                                                                                                            | No release API needed                                                                                    | P5-S1 (ledger architecture)                         | **APPROVED_AND_FROZEN — Direct EARNED**                                                                                  |
| D-02 | **PENDING Release Event**                                      | (A) Time-based (e.g., 7-day holding) (B) Event-based (e.g., admin approval) (C) Transaction-based (e.g., no reversal in N days)                                                                                          | —                                             | Only relevant if D-01 = (A) or (C)                                                                                                                                                                                                                                                                                                                                                                                                                     | Release mechanism must be built                                                                                                                               | Holding period provides float                                                                                                | Holding period allows fraud detection before funds released                                                                                            | Needs release_job or release_event table                                                                                                                                                                    | Release API endpoint                                                                                     | ❌ No (unless D-01=A)                               | **NOT_APPLICABLE_UNDER_D01_B**                                                                                           |
| D-03 | **Holding Period**                                             | (A) No holding period (B) 7 days (C) 14 days (D) 30 days (E) Market-configurable                                                                                                                                         | —                                             | Only relevant if D-01 = (A) or (C)                                                                                                                                                                                                                                                                                                                                                                                                                     | Commission visibility delayed                                                                                                                                 | Longer period = more company float; agent dissatisfaction if too long                                                        | Longer = more fraud detection time                                                                                                                     | Needs holding_expires_at field                                                                                                                                                                              | N/A                                                                                                      | ❌ No (unless D-01=A)                               | **NOT_APPLICABLE_UNDER_D01_B**                                                                                           |
| D-04 | **PENDING status + Agent SUSPENDED**                           | (A) Cancel PENDING on suspension (B) Hold PENDING; release when reactivated (C) Release PENDING even if currently SUSPENDED                                                                                              | **(B) Hold PENDING; release on reactivation** | Agent was ACTIVE when commission was calculated; suspension is a temporary state. Commission was earned in good faith before suspension.                                                                                                                                                                                                                                                                                                               | Commission not lost during temporary suspension                                                                                                               | No financial impact to company (funds still held)                                                                            | Fairness: agent earned while ACTIVE; suspension shouldn't retroactively cancel                                                                         | Needs PENDING status handling in suspension logic                                                                                                                                                           | Adjust status query                                                                                      | ❌ No                                               | **NOT_APPLICABLE_UNDER_D01_B**                                                                                           |
| D-05 | **Merchant Recruiter ACTIVE per transaction**                  | (A) Recruiter must be ACTIVE at time of each transaction (B) Recruiter only needs to be ACTIVE at merchant registration time (C) Recruiter must be ACTIVE at first transaction after registration only                   | **(A) ACTIVE at each transaction**            | Consistency with Member Consumption rules; prevents inactive agents from earning ongoing commissions for past recruitment (UPDATED)                                                                                                                                                                                                                                                                                                                    | Fewer merchant recruitment commissions paid; simpler rules                                                                                                    | Reduced commission expense if recruiter becomes inactive                                                                     | Prevents inactive/terminated agents from earning ongoing commissions                                                                                   | No additional model change                                                                                                                                                                                  | No additional API                                                                                        | P5-S4 (merchant recruitment impl)                   | **APPROVED_AND_FROZEN — ACTIVE per transaction (Option A)**                                                              |
| D-06 | **Agent Activation revocation → claw back upgrade commission** | (A) Yes — claw back G1/G2 upgrade commission (B) No — keep commission (C) Only claw back if revocation within N days                                                                                                     | **(B) No — keep commission**                  | Bryan decision: **APPROVED_AND_FROZEN — T1 Exact Revocation Timestamp; no historical clawback.** Rationale: Protecting agent confidence; reversing historical earnings creates trust issues. Cut-off = T1 (Exact Revocation Effective Timestamp) — the exact system timestamp when the revocation is process-effective. Agent upgrade commissions before revocation: retain, no compensation, no modification.                                         | No reversal entries for Agent Upgrade revocation                                                                                                              | Company does not recover paid upgrade commission                                                                             | No clawback means less financial disincentive for activation farming, but protects legitimate agent earnings                                           | No change needed — compensation entry simply not created                                                                                                                                                    | No API change                                                                                            | ✅ NONE (resolved — no longer blocking)             | **APPROVED_AND_FROZEN — T1 Exact Revocation Timestamp; no historical clawback**                                          |
| D-07 | **Account Country change → Activation Market**                 | (A) Market stays with original activation — new market requires independent activation (re-pay + re-course + re-approval) (B) Market follows member's current country (C) Agent must re-activate in new market           | **(A) Market stays with original activation** | Simplest; market is fixed once activation is complete; avoids complex market migration logic. Agent Qualification is Market-specific; original market permanent; new market requires independent activation. Sub-flows (D-07A/B/C) are no longer pending — the resolution incorporates all three sub-steps into the independent activation requirement (re-pay fee + re-complete course + re-obtain approval).                                         | Agent keeps original market commission; can hold multi-market ACTIVE status.                                                                                  | Impacts which market's commission rate applies per activation.                                                               | Prevents market-shopping (activate in one market, move to another for better rates). Independent activation per market maintains compliance integrity. | No change — UNIQUE(member_id, market) ensures one activation record per market per member.                                                                                                                  | No change                                                                                                | ✅ NONE (frozen — no longer blocking)               | **APPROVED_AND_FROZEN — Option A (re-pay + re-course + re-approval)**                                                    |
| D-08 | **Activation Fee — Market Configurable**                       | (A) MY-specific (RM388); other markets set own fee (B) Global fixed fee (C) Market-configurable                                                                                                                          | **(C) Market-configurable**                   | Does NOT block MY-only schema (MY defaults apply). Blocks non-MY market config. Each market may have different economic conditions; fixed MYR amount may not be appropriate in SGD market.                                                                                                                                                                                                                                                             | Activation fee varies by market                                                                                                                               | Revenue from activation fees varies by market                                                                                | Different fee levels may attract different risk profiles                                                                                               | Market-specific fee in config table                                                                                                                                                                         | GET /config/agent-fee                                                                                    | Does not block MY-only P5-S1. Blocks non-MY config. | **APPROVED_AND_FROZEN — Market-configurable (Option C)**                                                                 |
| D-09 | **Upgrade Commission Amounts — Market Configurable**           | (A) Global fixed amounts (B) Market-configurable with defaults                                                                                                                                                           | **(B) Market-configurable with MY defaults**  | Does NOT block MY-only schema (MY defaults apply). Blocks non-MY market config. Market conditions differ; same reasoning as D-08.                                                                                                                                                                                                                                                                                                                      | Upgrade commission varies by market                                                                                                                           | Commission expense varies by market                                                                                          | Fair to agents across markets                                                                                                                          | Part of rate_version table (already designed)                                                                                                                                                               | Part of rate version API                                                                                 | Does not block MY-only P5-S1. Blocks non-MY config. | **APPROVED_AND_FROZEN — Market-configurable with MY defaults (Option B)**                                                |
| D-10 | **Commission — Withdrawable, Transferable, or Display-only**   | (A) Display-only (can only see, no payout yet) (B) Transferable to wallet (C) Withdrawable to bank (D) Hybrid phased: Wallet Transfer + Bank Withdrawal; Phase 5 = Display-only                                          | **(D) Hybrid phased**                         | Bryan decision: **APPROVED_AND_FROZEN — Option D: final target Wallet Transfer + Bank Withdrawal; Phase 5 = Display-only.** Phase 5 is display-only. No wallet transfer, no withdrawal, no payout, no PAID. Section 28 updated: Phase 5 scope is display-only. Section 15 updated: PAID is future only. Section 25: no payout/wallet API in Phase 5 scope. Error codes WALLET_TRANSFER_NOT_AVAILABLE and PAYOUT_NOT_AVAILABLE reserved for future use. | No payout/wallet module needed in Phase 5                                                                                                                     | No cash flow impact in Phase 5                                                                                               | No payout/withdrawal in Phase 5 = no KYC gate needed yet                                                                                               | No payout module in Phase 5                                                                                                                                                                                 | No payout APIs in Phase 5                                                                                | ❌ No (P5-S0 scope unaffected)                      | **APPROVED_AND_FROZEN — Option D: final target Wallet Transfer + Bank Withdrawal; Phase 5 = Display-only**               |
| D-11 | **Commission Payout / Wallet Transfer KYC Requirement**        | (A) KYC Level 1 (B) KYC Level 2 for future wallet/withdrawal. Phase 5 earning 不受限. (C) Market-configurable (D) Display-only MVP — no payout/wallet transfer enabled, do not trigger                                   | **(B) KYC Level 2**                           | Bryan decision: **APPROVED_AND_FROZEN — Option B: KYC Level 2 for future wallet/withdrawal. Phase 5 earning 不受限.** KYC gate is a future requirement. No KYC integration in Phase 5. Agent earns commission based on ACTIVE status; no new KYC earning gate introduced. Error code KYC_LEVEL_2_REQUIRED (403) reserved for future payout/wallet gate.                                                                                                | No additional gating on commission earning in Phase 5                                                                                                         | No impact                                                                                                                    | No KYC friction for commission earning in Phase 5                                                                                                      | No change                                                                                                                                                                                                   | No change                                                                                                | ❌ No                                               | **APPROVED_AND_FROZEN — Option B: KYC Level 2 for future wallet/withdrawal. Phase 5 earning 不受限.**                    |
| D-12 | **Tax/Withholding**                                            | (A) No withholding (B) Withholding at source per market rate (C) Agent self-declares                                                                                                                                     | **(A) No withholding**                        | Bryan decision: **APPROVED_AND_FROZEN — No withholding, Gross Commission.** Section 14 updated: commission amount = gross commission. No tax withholding in Phase 5. Section 28 updated: tax/withholding deferred to future phase.                                                                                                                                                                                                                     | Commission amounts are gross — full rate applies                                                                                                              | No withholding reduces company admin burden                                                                                  | No withholding compliance needed in Phase 5                                                                                                            | No withholding rate table needed                                                                                                                                                                            | All API amounts are gross                                                                                | ❌ No (P5-S0 scope unaffected)                      | **APPROVED_AND_FROZEN — No withholding, Gross Commission (Option A)**                                                    |
| D-13 | **Admin Adjustment**                                           | (A) Maker only (B) Maker/Checker (two-person rule) (C) Only System-triggered adjustments                                                                                                                                 | **(B) Maker/Checker**                         | Bryan decision: **APPROVED_AND_FROZEN — Maker/Checker Adjustment.** commission*adjustment_request table DDL added to Section 23. Section 25: Admin Adjustment API 正式化（非 conditional）. Error codes ADJUSTMENT*\* codes added. Full request schema defined. Not conditional — P5-S6 includes admin adjustment as confirmed scope.                                                                                                                  | Admin adjustment workflow confirmed as Phase 5 scope                                                                                                          | Reduced fraud risk from internal abuse                                                                                       | Strong SOX-style control with two-person rule                                                                                                          | commission_adjustment_request table with maker/checker fields                                                                                                                                               | maker/checker fields in API; POST /adjustments, approve, reject                                          | P5-S6 (admin adjustment)                            | **APPROVED_AND_FROZEN — Maker/Checker (Option B)**                                                                       |
| D-14 | **Maker/Checker — Scope**                                      | (A) All admin adjustments require checker (B) Adjustments below threshold maker-only (C) Only negative adjustments require checker                                                                                       | **(A) All adjustments require checker**       | Bryan decision: **APPROVED_AND_FROZEN — All adjustments need Checker.** No threshold exception, no Maker-only exception. API enforcement: maker_id <> checker_id. Consistent with SOX-style control.                                                                                                                                                                                                                                                   | All admin adjustments require two-person approval                                                                                                             | Prevents any single-admin abuse regardless of amount                                                                         | No threshold-based gaps                                                                                                                                | maker_id, checker_id both required in commission_adjustment_request                                                                                                                                         | API enforces maker_id <> checker_id                                                                      | P5-S6 (maker/checker)                               | **APPROVED_AND_FROZEN — All adjustments require Checker (Option A)**                                                     |
| D-15 | **Referral Correction**                                        | (A) Completely disallow correction (B) Admin audited correction, prospective only (recommended) (C) Time-limited correction window (D) Special retroactive correction (requires separate approval + compensation ledger) | **(A) Completely disallow correction**        | Bryan decision: APPROVED_AND_FROZEN — Option A (Member Referral Only). Referral relationships are permanently immutable. No correction mechanism, no correction_event table, no Referral Versioning concept. No admin correction API. Simpler data model, no conditional scope. Does NOT extend to branch attribution — merchant attribution change policy is a separate Open Item (see D-19).                                                         | Zero correction operational cost; no admin workflow                                                                                                           | No financial impact                                                                                                          | Eliminates correction-related fraud risk entirely for referral relationships                                                                           | No referral_correction_event table needed; no Referral Versioning                                                                                                                                           | No POST /admin/referral/correct API                                                                      | ✅ NONE (no longer blocking)                        | **APPROVED_AND_FROZEN — Option A (completely disallow correction — Member Referral Only)**                               |
| D-16 | **Agent DEACTIVATED → future commissions on past referrals**   | (A) No future commission at all (B) Continue earning on past referrals' transactions (C) Continue earning but only up to G1                                                                                              | **(A) No future commission**                  | Bryan decision: **APPROVED_AND_FROZEN — No future commission after deactivation.** Section 19 updated: frozen rule. No commission on any source events after deactivation, including past referrals' transactions. Existing EARNED preserved. Clear D-06 and D-16 rules consolidated.                                                                                                                                                                  | Deactivated agents stop earning entirely — clean break                                                                                                        | Commission expense decreases                                                                                                 | Clean break; no ongoing obligation                                                                                                                     | No change                                                                                                                                                                                                   | No change                                                                                                | ❌ No                                               | **APPROVED_AND_FROZEN — No future commission (Option A)**                                                                |
| D-17 | **Ineligible Commission — company retains vs. not generated**  | (A) Company retains (commission not generated = company saves) (B) Company does not retain (pool reallocation — DEFERRED)                                                                                                | **(A) Company retains**                       | Bryan decision: **APPROVED_AND_FROZEN — No Liability, no Entry.** Ineligible generation: no Commission Liability created; no Ledger Entry generated; no pending pool allocation. Economic effect: the platform does not incur that commission cost. Section 13/16 updated: processing = SKIPPED_INELIGIBLE.                                                                                                                                            | Ineligible commission = no cost to company                                                                                                                    | Reduces commission expense                                                                                                   | No fraud risk                                                                                                                                          | No additional modeling                                                                                                                                                                                      | No additional API                                                                                        | ❌ No                                               | **APPROVED_AND_FROZEN — No Liability, no Entry (Option A)**                                                              |
| D-18 | **Merchant Referral — Permanent**                              | (A) Permanent — recruiter earns on all future transactions (B) Time-limited (e.g., 1 year) (C) Only first N transactions                                                                                                 | **(A) Permanent**                             | Bryan decision: APPROVED_AND_FROZEN — Option A (permanent). effective_until = NULL. Merchant recruiter earns 0.5% on all future transactions indefinitely. No time limit, no first-N limit. Permanent attribution simplifies data model and audit.                                                                                                                                                                                                     | Recruiter earns on all future merchant transactions forever                                                                                                   | Significant long-term commission liability                                                                                   | Higher long-term liability managed via rate versioning                                                                                                 | effective_until always NULL; attribution_scope = PERMANENT only                                                                                                                                             | No scope-related API parameters                                                                          | ✅ NONE (no longer blocking)                        | **APPROVED_AND_FROZEN — Option A (permanent)**                                                                           |
| D-19 | **Branch Recruiter Rules**                                     | (A) All Branches inherit Parent Merchant Recruiter (B) Each Branch has independent Recruiter (C) Default inherit, Admin can reassign (D) MVP: inherit Parent; Branch-specific attribution deferred (future phase)        | **(B) Each Branch has independent Recruiter** | Bryan decision: APPROVED_AND_FROZEN — Option B. Each branch has its own independent recruiter. merchant_attribution table extended with branch_id (nullable), attributed_entity_type (MERCHANT/BRANCH). UNIQUE(merchant_account_id) for parent; UNIQUE(branch_id) for branches. Merchant attribution change policy is a separate Open Item — D-15 does NOT extend to branch attribution. 8 new tests + 6 schema tests (BRN-001~014).                   | Each branch independently creates 0.5% commission liability; parent-level and branch-level recruiters can be different per D-05 per-transaction ACTIVE check. | Higher commission liability per branch — each branch can have separate recruiter earning 0.5% indefinitely (D-18 permanent). | Independent branch attribution; change policy is a separate Open Item.                                                                                 | branch_id (nullable), attributed_entity_type, UNIQUE(merchant_account_id) WHERE entity_type=MERCHANT, UNIQUE(branch_id) WHERE branch_id NOT NULL, chk_attribution_entity_target, chk_permanent_attribution. | Merchant/branch onboarding APIs include branch_id and attributed_entity_type for independent assignment. | ✅ NONE (no longer blocking)                        | **APPROVED_AND_FROZEN — Option B (each branch independent); merchant attribution change policy is a separate Open Item** |
| D-20 | **Minimum Posting Threshold**                                  | (A) No minimum posting amount (B) Minimum amount per commission entry (e.g., RM0.01) (C) Aggregate minimum for batch                                                                                                     | **(A) No minimum**                            | Bryan decision: **APPROVED_AND_FROZEN — No minimum posting threshold.** Section 12 updated: no minimum posting threshold. Any non-zero rounded amount is posted. Does not override D-26 zero-rounded skip. P5-S7 blocker removed.                                                                                                                                                                                                                      | No commissions suppressed                                                                                                                                     | None                                                                                                                         | No fraud impact                                                                                                                                        | No change                                                                                                                                                                                                   | No change                                                                                                | ✅ NONE (resolved)                                  | **APPROVED_AND_FROZEN — No minimum (Option A)**                                                                          |
| D-21 | **Calculation Scale**                                          | (A) 10 decimal places (10dp) (B) Full storage precision (38,10) (C) Match posting scale                                                                                                                                  | **(A) 10dp**                                  | 10dp provides sufficient precision for all intermediary calculations. Full 38,10 is overkill and may cause performance issues. Matching posting scale loses precision in multi-step arithmetic.                                                                                                                                                                                                                                                        | Consistent precision layer                                                                                                                                    | Negligible                                                                                                                   | None                                                                                                                                                   | NUMERIC(38,10) storage unaffected; calculation uses NUMERIC(38,10) with 10dp intermediary                                                                                                                   | No API change                                                                                            | ✅ NONE (resolved)                                  | **APPROVED_AND_FROZEN**                                                                                                  |
| D-22 | **Posting Scale**                                              | (A) Currency minor unit (2dp for MYR/SGD) (B) 4 decimal places (C) Match calculation scale                                                                                                                               | **(A) 2dp**                                   | 2dp matches standard currency representation. 4dp would show sub-cent amounts that cannot be paid out. Matching calculation scale defeats purpose of separate posting scale.                                                                                                                                                                                                                                                                           | Standard currency display                                                                                                                                     | Minor rounding to 2dp                                                                                                        | None                                                                                                                                                   | Posted amount stored as NUMERIC(38,10) but rounded to 2dp                                                                                                                                                   | 2dp in API responses                                                                                     | ✅ NONE (resolved)                                  | **APPROVED_AND_FROZEN**                                                                                                  |
| D-23 | **Display Scale**                                              | (A) Currency standard (2dp for MYR/SGD) (B) 4 decimal places (C) Match Posting Scale                                                                                                                                     | **(C) Match Posting Scale**                   | Bryan decision: **APPROVED_AND_FROZEN — Option C: Display Scale always matches currency Posting Scale.** Section 12 updated: display scale matches posting scale. No separate display precision. P5-S6 display-scale blocker removed.                                                                                                                                                                                                                  | Clean UX                                                                                                                                                      | None                                                                                                                         | None                                                                                                                                                   | No data model impact                                                                                                                                                                                        | 2dp formatted in API responses                                                                           | ✅ NONE (no longer blocking)                        | **APPROVED_AND_FROZEN — Option C: Display Scale always matches currency Posting Scale**                                  |
| D-24 | **Line-Level Rounding**                                        | (A) 独立舍入 (Independent rounding per line) (B) 汇总分配 (Aggregate allocation) (C) 其他 (Other)                                                                                                                        | **(A) Independent rounding per line**         | Each commission entry is independently rounded at posting scale before storage. Simplest implementation; no cross-entry dependency.                                                                                                                                                                                                                                                                                                                    | No visible impact on agents                                                                                                                                   | Negligible                                                                                                                   | No fraud risk                                                                                                                                          | No additional tables needed for Option A                                                                                                                                                                    | No API change                                                                                            | ✅ NONE (resolved)                                  | **APPROVED_AND_FROZEN**                                                                                                  |
| D-25 | **Sub-minor-unit Residual**                                    | (A) 不分配 (Do not allocate — company retains) (B) 批次累计 (Batch accumulation) (C) Pool (Distribution to pool)                                                                                                         | **(A) Do not allocate — company retains**     | Simplest implementation; sub-minor-unit amounts are negligible individually. Accumulation (B) adds tracking complexity. Pool redistribution (C) requires allocation algorithm.                                                                                                                                                                                                                                                                         | No visible impact on agents                                                                                                                                   | Company retains sub-minor-unit residuals                                                                                     | No fraud risk                                                                                                                                          | No additional tables needed for Option A                                                                                                                                                                    | No API change                                                                                            | ✅ NONE (resolved)                                  | **APPROVED_AND_FROZEN**                                                                                                  |
| D-26 | **Zero-rounded Commission Handling**                           | (A) 跳过并记录 (Skip and log) (B) 创建零 (Create zero-amount entry) (C) 异常 (Raise exception)                                                                                                                           | **(A) Skip and log**                          | Creating a zero-amount ledger entry adds noise and storage waste. Raising an exception would incorrectly treat it as an error. Logging allows auditability without ledger bloat.                                                                                                                                                                                                                                                                       | Clean ledger; no zero entries                                                                                                                                 | None                                                                                                                         | Skipped entries logged for audit                                                                                                                       | No zero-amount entries in ledger                                                                                                                                                                            | logger entry in processing result                                                                        | ✅ NONE (resolved)                                  | **APPROVED_AND_FROZEN**                                                                                                  |

**Resolved and frozen: 23 (D-01, D-05, D-06, D-07, D-08, D-09, D-10, D-11, D-12, D-13, D-14, D-15, D-16, D-17, D-18, D-19, D-20, D-21, D-22, D-23, D-24, D-25, D-26)**
**Not applicable: 3 (D-02, D-03, D-04)**
**Remaining open: 0 numbered decisions**
**Non-numbered Product Open Items: 2**

1. **Agent Reapplication Policy** — Whether a REJECTED applicant can re-apply (transition back to NOT_APPLIED or PENDING_PAYMENT). **Not implemented until separately authorized.**
2. **Merchant/Branch Attribution Change Policy** — Whether committed merchant/branch attribution records can be changed (policy decision outside D-15 scope); Error code MERCHANT_ATTRIBUTION_CHANGE_REJECTED reserved; behavior pending Bryan. **Not implemented until separately authorized.**

**Blocks resolved — no numbered-decision blockers:**

- **P5-S1:** ✅ NONE — D-01, D-07, D-08/D-09 all APPROVED_AND_FROZEN
- **P5-S2:** ✅ NONE — Reactivation is SUSPENDED → ACTIVE only; no DEACTIVATED re-activation path (Open Item)
- **P5-S3:** ✅ NONE — D-15, D-18, D-19 all APPROVED_AND_FROZEN
- **P5-S4:** ✅ NONE — D-05, D-21~D-26 all APPROVED_AND_FROZEN
- **P5-S5:** ✅ NONE — D-06 APPROVED_AND_FROZEN
- **P5-S6:** ✅ NONE — D-13, D-14, D-23 all APPROVED_AND_FROZEN (admin adjustment no longer conditional; display scale resolved)
- **P5-S7:** ✅ NONE — D-20 APPROVED_AND_FROZEN (no minimum posting threshold)
- **P5-S8:** ✅ NONE

---

## 30. Proposed P5-S1 through P5-S8 Breakdown

**Important:** All Open Decisions that block implementation (see Section 29 Blocks column) must be resolved by Bryan and frozen by Command Center **before** P5-S0 is accepted and P5-S1 is authorized. No business rule decisions may be deferred to P5-S8.

**Updated dependencies (post D-07 freeze):** D-01 and D-07 are now APPROVED_AND_FROZEN and no longer block P5-S1. D-07 (Option A: re-pay + re-course + re-approval) resolves activation market migration rules completely — sub-flows D-07A/B/C are incorporated into the independent activation requirement.

### Conditional Scope Rules (R1-30)

The following capabilities are now **CONFIRMED (APPROVED_AND_FROZEN)** in Phase 5. No remaining conditional capabilities block Phase 5 scope:

- ✅ **Admin Adjustment (D-13/D-14)** — APPROVED_AND_FROZEN; Maker/Checker workflow confirmed
- ✅ ~~Referral Correction (D-15)~~ — APPROVED_AND_FROZEN; Completely disallow correction (Option A)
- ✅ ~~Branch-specific recruiter (D-19)~~ — APPROVED_AND_FROZEN; Independent per branch (Option B)
- ✅ ~~Decimal precision configuration (D-21~D-26)~~ — RESOLVED; APPROVED_AND_FROZEN
- ✅ ~~Display Scale (D-23)~~ — APPROVED_AND_FROZEN; Display = Posting Scale
- ✅ ~~Minimum Posting Threshold (D-20)~~ — APPROVED_AND_FROZEN; No minimum threshold
- ✅ ~~PENDING status / release events / holding periods~~ — D-01 resolved: NOT_APPLICABLE
- ✅ ~~CANCELLED status / PENDING→CANCELLED transition~~ — D-01 resolved: NOT_APPLICABLE
- ❌ Payout/PAID status/Expiry — **Deferred** to future phase (D-10 frozen: Phase 5 is display-only)
- ❌ Tax withholding — **Deferred** to future phase (D-12 frozen: no withholding in Phase 5)
- ❌ KYC gating — **Deferred** to future phase (D-11 frozen: KYC only for payout/wallet, not Phase 5 earning)
- ❌ Admin UI — Separate workstream

### P5-S1: Domain Schema & Frozen Invariants

**Scope:**

- Database migrations (agent_activation, referral_relationship, commission_rate_version, idempotency)
- Domain entities and type definitions
- Frozen invariant enforcement (referral DAG, unique codes, status checks)
- Canonical key tables
- Commission processing result table
- Seed rate versions for first market
- No commission calculation logic yet

**Dependencies:** Phase 4 Transaction Engine schema; Bryan decisions:

- D-01: ✅ **RESOLVED** (APPROVED_AND_FROZEN — Direct EARNED; no longer blocking)
- D-07: ✅ **APPROVED_AND_FROZEN** — fully resolved (Option A: re-pay + re-course + re-approval; no longer blocking)
- D-08/D-09: ✅ **RESOLVED** (APPROVED_AND_FROZEN — MY defaults; other markets configurable; non-MY config design needed but does not block MY-only schema)

### P5-S2: Agent Activation Lifecycle

**Scope:**

- Full 10-state activation state machine
- Activation CRUD APIs (apply, confirm-payment, enroll-course, complete-course, approve-activate, suspend, reactivate, deactivate, reject)
- Status transition validation
- Activation status log (append-only)
- Enrollment and course tracking fields
- **Reactivation: SUSPENDED → ACTIVE only.** No DEACTIVATED re-activation path (Open Item — not implemented until separately authorized).

**Dependencies:** P5-S1

### P5-S3: Global Referral Ownership & Attribution

**Scope:**

- Referral relationship recording (during member registration) — permanently immutable (D-15 frozen)
- Referral tree query (anonymized for agents, full for admin)
- Merchant attribution model (merchant_attribution table) — with branch_id and attributed_entity_type (D-19 frozen)
- Cycle detection at registration time
- Branch recruiter attribution with UNIQUE constraints (D-19 frozen: each branch independent)
- D-15 immutability: No referral correction mechanism, no correction_event table, no Referral Versioning, no POST /admin/referral/correct API
- Merchant entity reference support

**Dependencies:** P5-S1

### P5-S4: Commission Calculation & Immutable Ledger

**Scope:**

- Agent Upgrade commission (G1, G2)
- Member Consumption commission (G1, G2)
- Merchant Recruitment commission (D-05 frozen — ACTIVE per transaction, Option A)
- Immutable ledger writing (append-only commission_ledger)
- Commission status event log (append-only commission_status_event)
- Rate version lookup at source event time
- Merchant recruiter eligibility (D-05 frozen — ACTIVE per transaction; no longer config-dependent)
- Calculation scale (D-21 frozen — 10dp)
- Posting scale (D-22 frozen — currency minor unit, 2dp MYR/SGD)
- Line-level rounding (D-24 frozen — independent per entry)
- Residual handling (D-25 frozen — not allocated, audit only)
- Zero-rounded skip and log (D-26 frozen)

**Dependencies:** P5-S1, P5-S2, P5-S3
**Updated:** D-05 is ✅ RESOLVED (APPROVED_AND_FROZEN — Option A). Merchant recruiter ACTIVE per transaction is a fixed rule, not config-dependent.

### P5-S5: Correction Compensation & Idempotency

**Scope:**

- Integration with Phase 4 Correction Engine
- Compensation entry creation (REVERSAL/REFUND compensation types)
- Agent revocation eligibility cut-off enforcement (D-06 frozen: no clawback; cut-off = T1 Exact Revocation Timestamp)
- Idempotent processing (same correction execution = same result)
- Atomic multi-entry compensation (all linked entries in one transaction)
- Processing result tracking (commission_processing table)

**Dependencies:** P5-S4, Phase 4 Correction Engine

### P5-S6: Query & Admin Capabilities (D-13/D-14/D-23 APPROVED_AND_FROZEN)

**Scope:**

- Commission ledger query APIs (GET /commission/ledger, /summary, /{entry_id})
- Admin search/filter APIs for commission data
- Admin adjustment API ✅ **CONFIRMED** (D-13/D-14 APPROVED_AND_FROZEN)
  - POST /api/v1/admin/commission-adjustments (maker from auth principal)
  - POST /api/v1/admin/commission-adjustments/{id}/approve (separate checker action; maker_id <> checker_id enforced)
  - POST /api/v1/admin/commission-adjustments/{id}/reject
- Commission reprocess API (idempotent)
- Admin audit log API
- Rate version management API (admin)
- Display scale (D-23 ✅ APPROVED_AND_FROZEN)

**Dependencies:** P5-S4

### P5-S7: Security, Concurrency, Performance & Regression

**Scope:**

- Concurrency/lock ordering (canonical: sort beneficiary IDs ascending)
- Deadlock detection and retry (CONFIGURABLE)
- Fraud detection controls (anomaly monitoring, not frozen rules)
- Security: auth principal enforcement (no client-supplied member_id)
- Security: maker/checker segregation (D-14 frozen: all adjustments require checker)
- Privacy: referral tree anonymization
- Load testing (high transaction volume)
- Performance optimization (index tuning)
- **No minimum posting threshold** (D-20 ✅ APPROVED_AND_FROZEN — no longer conditional)
- Decimal precision edge cases (D-21~D-26 frozen)
- Security penetration testing
- Governance evidence collection

**Dependencies:** P5-S4, P5-S5, P5-S6

### P5-S8: Final Verification & Governance Closure

**Scope:**

- Verify implementation conforms to frozen contract
- Full acceptance test suite execution
- Governance documentation
- Decision log update
- Phase 5 acceptance report
- Baseline commit
- Formal Phase 5 closure
- All P5-S1 through P5-S7 deliverables verified

## **Dependencies:** P5-S1, P5-S2, P5-S3, P5-S4, P5-S5, P5-S6, P5-S7

### Sprint Diagram (Updated - All Decisions Resolved)

```
P5-S1 ──► P5-S2 ──► P5-S3 ──► P5-S4 ──► P5-S5 ──► P5-S6 ──► P5-S7 ──► P5-S8

All 26 numbered decisions resolved. No CONDITIONAL capabilities remain.
No numbered-decision blockers remain for any sprint.

Frozen decisions resolved in P5-S0:
  D-01 (Direct EARNED) — ✅ Contract frozen
  D-05 (ACTIVE per transaction) — ✅ Contract frozen
  D-07 (Account Country change) — ✅ APPROVED_AND_FROZEN (Option A: re-pay + re-course + re-approval)
  D-08 (Market-configurable fee) — ✅ Contract frozen
  D-09 (Market-configurable upgrade commission) — ✅ Contract frozen
  D-10 (Display-only Phase 5) — ✅ APPROVED_AND_FROZEN (Batch D)
  D-11 (KYC future gate) — ✅ APPROVED_AND_FROZEN (Batch D)
  D-12 (No withholding, Gross Commission) — ✅ APPROVED_AND_FROZEN (Batch D)
  D-13 (Admin Adjustment — Maker/Checker) — ✅ APPROVED_AND_FROZEN (Batch D)
  D-14 (All adjustments need Checker) — ✅ APPROVED_AND_FROZEN (Batch D)
  D-15 (Referral Correction) — ✅ APPROVED_AND_FROZEN (Option A: completely disallow correction; Batch C)
  D-16 (No future commission after deactivation) — ✅ APPROVED_AND_FROZEN (Batch D)
  D-17 (No Liability, no Entry) — ✅ APPROVED_AND_FROZEN (Batch D)
  D-18 (Merchant Referral — Permanent) — ✅ APPROVED_AND_FROZEN (Option A: permanent; Batch C)
  D-19 (Branch Recruiter Rules) — ✅ APPROVED_AND_FROZEN (Option B: each branch independent; Batch C)
  D-20 (No minimum posting threshold) — ✅ APPROVED_AND_FROZEN (Batch D)
  D-21 (Calculation Scale = 10dp) — ✅ APPROVED_AND_FROZEN (Batch B)
  D-22 (Posting Scale = currency minor unit) — ✅ APPROVED_AND_FROZEN (Batch B)
  D-23 (Display = Posting Scale) — ✅ APPROVED_AND_FROZEN (Batch D)
  D-24 (Independent line rounding) — ✅ APPROVED_AND_FROZEN (Batch B)
  D-25 (Residual not allocated) — ✅ APPROVED_AND_FROZEN (Batch B)
  D-26 (Skip and log zero-rounded) — ✅ APPROVED_AND_FROZEN (Batch B)
  D-02, D-03, D-04 — NOT_APPLICABLE_UNDER_D01_B
```

---

## Appendices

### Appendix A: Frozen Rules Summary

All frozen rules from this contract are consolidated below. These represent the authoritative business rules that implementors must follow.

- **Referral Rules (7) — D-15 frozen (Member Referral Only):** Unique referral code, one direct referrer, no self-referral, no cycles, global relationship, no compression, no beneficiary substitution. Referral relationships are **permanently immutable** — no corrections allowed, no exceptions. REFERRAL_IMMUTABLE (409) returned on any update attempt. Does NOT extend to branch attribution.

- **Activation Rules (4):** Four requirements (RM388 fee — MY market default; other markets: market-configurable per D-08 frozen) + course + approval + system activation; 10-status state machine; ACTIVE before commission.

- **Commission Rules (7):** Agent Upgrade (G1 RM88, G2 RM38 — MY market default; other markets: market-configurable per D-09 frozen, per activation); Member Consumption (G1 1%, G2 0.5%, of service fee); Merchant Recruitment (0.5% of service fee, one generation, recruiter must be ACTIVE at each transaction per D-05 frozen); no compression; max one per source+generation.

- **Ledger Rules (7):** Append-only; no UPDATE/DELETE; economic classification fixed at creation; status changes via independent commission_status_event; reversal linkage for compensation; rate version snapshot; per-market isolation.

- **Commission Status Rules (D-01 frozen):** Direct EARNED at calculation time. No PENDING status. No CANCELLED status. No release events. No holding periods. No PENDING→EARNED or PENDING→CANCELLED transitions. D-02, D-03, D-04 marked NOT_APPLICABLE_UNDER_D01_B.

- **Merchant Recruiter Eligibility (D-05 frozen):** Recruiter must be ACTIVE at each transaction Confirm time. Checked per transaction independently. Not config-dependent. Fixed rule.

- **Financial Rules (12):** numeric(38,10) storage; decimal arithmetic; calculation scale = 10dp (D-21 frozen); posting scale = currency minor unit / 2dp MYR/SGD (D-22 frozen); HALF_UP rounding (D-24 frozen); independent line-level rounding (D-24 frozen); residual not allocated (D-25 frozen); zero-rounded skip and log (D-26 frozen); decimal string APIs; no floating point.

- **Display & Posting Rules (3) — D-20/D-23 frozen:** Display scale = posting scale (2dp MYR/SGD, D-23 frozen). No minimum posting threshold (D-20 frozen). Any non-zero rounded amount posted; zero-rounded still skipped per D-26.

- **Admin Adjustment Rules (3) — D-13/D-14 frozen:** All adjustments require Maker/Checker workflow. Maker submits, Checker approves or rejects. maker_id <> checker_id enforced. No Maker-only exception, no threshold exception. ADJUSTMENT_CHECKER_REQUIRED (400), ADJUSTMENT_MAKER_CHECKER_SAME (409), ADJUSTMENT_INVALID_AMOUNT (400) error codes.

- **D-16 frozen (Deactivation):** DEACTIVATED agent earns NO future commission on ANY source events, including past referrals' transactions. Pre-deactivation commissions preserved. SKIPPED_INELIGIBLE outcome.

- **D-17 frozen (Ineligible):** No commission liability created; no ledger entry generated; processing = SKIPPED_INELIGIBLE. Platform does not incur commission cost.

- **D-10 frozen (Display-only Phase 5):** Phase 5 is display-only. No wallet transfer, no withdrawal, no payout, no PAID. WALLET_TRANSFER_NOT_AVAILABLE (503) and PAYOUT_NOT_AVAILABLE (503) error codes reserved for future.

- **D-11 frozen (KYC future gate):** KYC Level 2 required for future payout/wallet gate. NOT required for Phase 5 earning.

- **D-12 frozen (Gross Commission):** Commission amount = gross commission. No withholding, no deduction, no tax reduction in Phase 5. Tax/withholding deferred to future phase.

- **Market Rules (8) — D-07 frozen:** Per-source-event market; no FX conversion; no cross-market merge; multi-market balances; source event market assignment; Agent Upgrade market = activation payment market; Account Country change requires new independent activation (re-pay + re-course + re-approval); multi-market ACTIVE status allowed; no cross-market backfill.

- **Idempotency Rules (5):** Three-key separation (Transport / Canonical Processing / Canonical Entry); canonical key composition; same key + same payload → return original; same key + different payload → reject; concurrent → first writer wins; crash-safe.

- **Compensation Rules (5):** No modify/delete original; exact opposite amount; reversal linkage; atomic execution; idempotent.

### Appendix B: Reserved Identifiers

| Prefix  | Purpose                     | Example               |
| ------- | --------------------------- | --------------------- |
| `COM-`  | Commission public reference | `COM-20260725-00001`  |
| `ADJ-`  | Admin adjustment reference  | `ADJ-20260725-00001`  |
| `AACT-` | Agent activation reference  | `AACT-20260725-00001` |

### Appendix C: Document References

| Reference                               | Description                                       |
| --------------------------------------- | ------------------------------------------------- |
| Phase 3 Wallet/Reward Contract          | Frozen baseline: `2ed57f4e`                       |
| Phase 4 Transaction/Correction Contract | Tech baseline: `87ea05aa`, Governance: `8f04a8ac` |
| PROJECT_MASTER_CONTROL.md               | Operating authority map                           |
| DOCUMENT_AUTHORITY.md                   | Document hierarchy                                |
| OPENCLAW_OPERATING_RULES.md             | Role boundaries                                   |
| DECISION_LOG.md                         | Governance decisions                              |
| PHASE_REGISTRY.md                       | Phase authorization status                        |

---

_End of P5-S0 Frozen Contract_

**Status:** TECHNICAL DRAFT PASSED — ALL 26 NUMBERED DECISIONS RESOLVED — FINAL DOCUMENT AUDIT PENDING  
**Batch D decisions frozen (this batch):** D-10, D-11, D-12, D-13, D-14, D-16, D-17, D-20, D-23  
**Batch A decisions frozen:** D-01, D-05, D-07, D-08, D-09  
**Batch B decisions frozen:** D-21, D-22, D-24, D-25, D-26  
**Batch C decisions frozen:** D-15, D-18, D-19  
**D-06 frozen:** APPROVED_AND_FROZEN — T1 Exact Revocation Timestamp; no historical clawback  
**Not applicable:** D-02, D-03, D-04  
**Remaining open:** 0 numbered decisions  
**Open Items:** 2 (Agent Reapplication Policy + Merchant/Branch Attribution Change Policy)  
**Total resolved and frozen:** 23  
**Total remaining open numbered decisions:** 0  
**P5-S0 ACCEPTED — P5-S0 CONTRACT FROZEN — P5-S1 NOT YET AUTHORIZED**  
**Date:** 2026-07-25  
**Author:** OpenClaw sub-agent (deepseek/deepseek-v4-flash)
