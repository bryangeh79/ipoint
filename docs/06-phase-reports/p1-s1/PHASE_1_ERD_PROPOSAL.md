---
title: Phase 1 ERD Proposal
phase: P1-S1
status: planning-only
implementation_authorized: false
orm: drizzle
database: postgresql
date: 2026-07-16
---

# Phase 1 ERD Proposal

## 1. Modeling decisions

- This is proposed TypeScript/Drizzle design, not production schema or migration.
- Internal keys are UUID. `merchant_branches.public_merchant_id` is the branch public identifier.
- All applicable business tables carry `market_id`; global identities remain in Phase 0.
- `numeric` values cross the TypeScript boundary as strings/decimal-safe values.
- Mutable catalog/profile records may use `archived_at`; append-only ledger/history/approval/terms/KYC submission evidence has event timestamps only and is never soft-deleted.
- `merchant_groups` is a proper Phase 1 entity. It owns the Account/Market relationship, and every `merchant_branches.merchant_group_id` is a non-null foreign key. Single-branch merchants receive a default group.
- Merchant primary email is always the immutable `accounts.email`. No Merchant Profile primary/contact email field exists, and Admin has no mutation path for it.
- Application, KYC and Operational status are independent enums. Operational activation is derived from approved Application, approved KYC and the MCP activation condition.

## 2. Relationship summary

```text
accounts 1--* merchant_groups *--1 markets
merchant_groups 1--* merchant_branches --1 merchant_profiles
markets 1--* merchant_branches --* merchant_documents/status_history/referrals
merchant_branches 1--* merchant_applications
merchant_branches 1--* merchant_kyc_submissions 1--* merchant_kyc_reviews
merchant_branches 1--* merchant_package_assignments *--1 service_fee_versions
merchant_branches 1--1 mcp_accounts 1--* mcp_ledger_entries
mcp_accounts 1--* recharge/refund/adjustment requests
mcp_adjustment_requests 1--1 mcp_adjustment_decisions
```

## 3. Proposed Drizzle schema fragments

```ts
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  boolean,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { accounts, adminUsers, markets } from './phase-0-schema.js';

const utc = (name: string) =>
  timestamp(name, { withTimezone: true, precision: 6 });
const audit = {
  createdAt: utc('created_at').notNull().defaultNow(),
  updatedAt: utc('updated_at').notNull().defaultNow(),
};
const archival = { archivedAt: utc('archived_at') };

export const merchantApplicationStatus = pgEnum('merchant_application_status', [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'RESUBMISSION_REQUIRED',
  'APPROVED',
  'REJECTED',
]);
export const merchantKycStatus = pgEnum('merchant_kyc_status', [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'RESUBMISSION_REQUIRED',
  'APPROVED',
  'REJECTED',
]);
export const merchantOperationalStatus = pgEnum('merchant_operational_status', [
  'PENDING_APPLICATION',
  'PENDING_KYC',
  'PENDING_MCP',
  'ACTIVE',
  'SUSPENDED',
  'CLOSURE_PENDING',
  'CLOSED',
]);
export const profileKind = pgEnum('service_fee_profile_kind', ['STANDARD']);
export const ruleState = pgEnum('service_fee_rule_state', [
  'DRAFT',
  'SCHEDULED',
  'ACTIVE',
  'EXPIRED',
  'CANCELLED',
]);
export const assignmentState = pgEnum('merchant_package_assignment_state', [
  'ACTIVE',
  'PAUSED',
  'PENDING_CHANGE',
]);
export const direction = pgEnum('mcp_direction', ['CREDIT', 'DEBIT']);
export const mcpEntryType = pgEnum('mcp_entry_type', [
  'RECHARGE',
  'ADVERTISING_DEDUCTION',
  'MANUAL_CREDIT',
  'MANUAL_DEBIT',
  'REFUND',
  'FREEZE',
  'UNFREEZE',
  'REVERSAL',
]);
export const rechargeState = pgEnum('mcp_recharge_state', [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);
export const refundState = pgEnum('mcp_refund_state', [
  'PENDING',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
]);
export const adjustmentState = pgEnum('mcp_adjustment_state', [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'EXECUTED',
  'CANCELLED',
]);

export const merchantGroups = pgTable(
  'merchant_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    createdAt: utc('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('merchant_groups_account_idx').on(t.accountId),
    index('merchant_groups_market_idx').on(t.marketId),
  ],
);

export const merchantBranches = pgTable(
  'merchant_branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantGroupId: uuid('merchant_group_id')
      .notNull()
      .references(() => merchantGroups.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    publicMerchantId: text('public_merchant_id').notNull(),
    merchantType: text('merchant_type').notNull(),
    legalName: text('legal_name').notNull(),
    operationalStatus: merchantOperationalStatus('operational_status')
      .notNull()
      .default('PENDING_APPLICATION'),
    version: integer('version').notNull().default(1),
    activatedAt: utc('activated_at'),
    closedAt: utc('closed_at'),
    ...audit,
    ...archival,
  },
  (t) => [
    unique('merchant_branches_public_id_unique').on(t.publicMerchantId),
    index('merchant_branches_market_status_idx').on(
      t.marketId,
      t.operationalStatus,
    ),
    index('merchant_branches_group_idx').on(t.merchantGroupId),
  ],
);

export const merchantProfiles = pgTable(
  'merchant_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantBranchId: uuid('merchant_branch_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    displayName: text('display_name').notNull(),
    phone: text('phone'),
    address: text('address'),
    logoObjectKey: text('logo_object_key'),
    bannerObjectKey: text('banner_object_key'),
    gallery: jsonb('gallery').notNull().default([]),
    about: text('about'),
    businessHours: jsonb('business_hours').notNull().default({}),
    website: text('website'),
    whatsapp: text('whatsapp'),
    socials: jsonb('socials').notNull().default({}),
    ...audit,
    ...archival,
  },
  (t) => [
    unique('merchant_profiles_branch_unique').on(t.merchantBranchId),
    index('merchant_profiles_market_idx').on(t.marketId),
  ],
);

export const merchantApplications = pgTable(
  'merchant_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantBranchId: uuid('merchant_branch_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    status: merchantApplicationStatus('status').notNull().default('DRAFT'),
    version: integer('version').notNull().default(1),
    submittedAt: utc('submitted_at'),
    reviewedAt: utc('reviewed_at'),
    reviewedByAdminUserId: uuid('reviewed_by_admin_user_id').references(
      () => adminUsers.id,
      { onDelete: 'restrict' },
    ),
    reviewReason: text('review_reason'),
    ...audit,
  },
  (t) => [
    unique('merchant_applications_branch_unique').on(t.merchantBranchId),
    index('merchant_applications_market_status_idx').on(t.marketId, t.status),
  ],
);

export const merchantKycCases = pgTable(
  'merchant_kyc_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantBranchId: uuid('merchant_branch_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    status: merchantKycStatus('status').notNull().default('DRAFT'),
    version: integer('version').notNull().default(1),
    ...audit,
  },
  (t) => [
    unique('merchant_kyc_cases_branch_unique').on(t.merchantBranchId),
    index('merchant_kyc_cases_market_status_idx').on(t.marketId, t.status),
  ],
);

export const merchantKycSubmissions = pgTable(
  'merchant_kyc_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantKycCaseId: uuid('merchant_kyc_case_id')
      .notNull()
      .references(() => merchantKycCases.id, { onDelete: 'restrict' }),
    merchantBranchId: uuid('merchant_branch_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    submissionVersion: integer('submission_version').notNull(),
    picName: text('pic_name'),
    requirementsVersion: text('requirements_version').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    submittedAt: utc('submitted_at').notNull(),
    createdAt: utc('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('merchant_kyc_submission_branch_version_unique').on(
      t.merchantBranchId,
      t.submissionVersion,
    ),
    index('merchant_kyc_submission_case_time_idx').on(
      t.merchantKycCaseId,
      t.submittedAt,
    ),
  ],
);

export const merchantKycReviews = pgTable(
  'merchant_kyc_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantKycSubmissionId: uuid('merchant_kyc_submission_id')
      .notNull()
      .references(() => merchantKycSubmissions.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    reviewerAdminUserId: uuid('reviewer_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    decision: merchantKycStatus('decision').notNull(),
    reason: text('reason').notNull(),
    decidedAt: utc('decided_at').notNull(),
    createdAt: utc('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('merchant_kyc_review_submission_unique').on(
      t.merchantKycSubmissionId,
    ),
  ],
);

export const merchantDocuments = pgTable(
  'merchant_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantBranchId: uuid('merchant_branch_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    merchantKycSubmissionId: uuid('merchant_kyc_submission_id')
      .notNull()
      .references(() => merchantKycSubmissions.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    documentType: text('document_type').notNull(),
    objectKey: text('object_key').notNull(),
    originalFilename: text('original_filename').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: numeric('byte_size', { precision: 20, scale: 0 }).notNull(),
    sha256: text('sha256').notNull(),
    scanStatus: text('scan_status').notNull().default('PENDING'),
    classification: text('classification').notNull().default('PRIVATE_KYC'),
    ...audit,
    ...archival,
  },
  (t) => [
    unique('merchant_documents_object_key_unique').on(t.objectKey),
    index('merchant_documents_kyc_submission_idx').on(
      t.merchantKycSubmissionId,
    ),
    index('merchant_documents_market_idx').on(t.marketId),
  ],
);

export const merchantStatusHistory = pgTable(
  'merchant_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantBranchId: uuid('merchant_branch_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    fromStatus: merchantOperationalStatus('from_status'),
    toStatus: merchantOperationalStatus('to_status').notNull(),
    actorAdminUserId: uuid('actor_admin_user_id').references(
      () => adminUsers.id,
      { onDelete: 'restrict' },
    ),
    reason: text('reason'),
    createdAt: utc('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('merchant_status_history_branch_time_idx').on(
      t.merchantBranchId,
      t.createdAt,
    ),
    index('merchant_status_history_market_time_idx').on(
      t.marketId,
      t.createdAt,
    ),
  ],
);

export const merchantReferrals = pgTable(
  'merchant_referrals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantBranchId: uuid('merchant_branch_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    referrerType: text('referrer_type').notNull(),
    referrerPublicId: text('referrer_public_id').notNull(),
    recordedByAccountId: uuid('recorded_by_account_id').references(
      () => accounts.id,
      { onDelete: 'restrict' },
    ),
    correctedByAdminUserId: uuid('corrected_by_admin_user_id').references(
      () => adminUsers.id,
      { onDelete: 'restrict' },
    ),
    correctionReason: text('correction_reason'),
    ...audit,
    ...archival,
  },
  (t) => [
    uniqueIndex('merchant_referrals_active_unique')
      .on(t.merchantBranchId)
      .where(sql`${t.archivedAt} is null`),
    index('merchant_referrals_referrer_idx').on(
      t.referrerType,
      t.referrerPublicId,
    ),
  ],
);

export const merchantTermsAcceptances = pgTable(
  'merchant_terms_acceptances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantBranchId: uuid('merchant_branch_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    documentType: text('document_type').notNull(),
    documentVersion: text('document_version').notNull(),
    locale: text('locale').notNull(),
    ipAddress: text('ip_address'),
    device: text('device'),
    acceptedAt: utc('accepted_at').notNull(),
    createdAt: utc('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('merchant_terms_acceptance_unique').on(
      t.merchantBranchId,
      t.documentType,
      t.documentVersion,
    ),
    index('merchant_terms_market_time_idx').on(t.marketId, t.acceptedAt),
  ],
);
```

### Package domain

```ts
export const serviceFeeProfiles = pgTable(
  'service_fee_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: profileKind('kind').notNull().default('STANDARD'),
    ...audit,
    ...archival,
  },
  (t) => [
    uniqueIndex('service_fee_profiles_market_code_active_unique')
      .on(t.marketId, t.code)
      .where(sql`${t.archivedAt} is null`),
  ],
);

export const serviceFeeVersions = pgTable(
  'service_fee_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceFeeProfileId: uuid('service_fee_profile_id')
      .notNull()
      .references(() => serviceFeeProfiles.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    ratePercent: numeric('rate_percent', { precision: 12, scale: 6 }).notNull(),
    status: ruleState('status').notNull().default('DRAFT'),
    effectiveFrom: utc('effective_from').notNull(),
    effectiveTo: utc('effective_to'),
    createdByAdminUserId: uuid('created_by_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    ...audit,
  },
  (t) => [
    unique('service_fee_versions_profile_version_unique').on(
      t.serviceFeeProfileId,
      t.version,
    ),
    index('service_fee_versions_effective_idx').on(
      t.marketId,
      t.status,
      t.effectiveFrom,
    ),
    check(
      'service_fee_versions_rate_check',
      sql`${t.ratePercent} > 0`,
    ),
    check(
      'service_fee_versions_period_check',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
);

export const specialPercentages = pgTable(
  'special_percentages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    ratePercent: numeric('rate_percent', { precision: 12, scale: 6 }).notNull(),
    version: integer('version').notNull(),
    status: ruleState('status').notNull().default('DRAFT'),
    effectiveFrom: utc('effective_from').notNull(),
    effectiveTo: utc('effective_to'),
    approvedByAdminUserId: uuid('approved_by_admin_user_id').references(
      () => adminUsers.id,
      { onDelete: 'restrict' },
    ),
    reason: text('reason').notNull(),
    ...audit,
    ...archival,
  },
  (t) => [
    index('special_percentages_effective_idx').on(
      t.marketId,
      t.status,
      t.effectiveFrom,
    ),
    check(
      'special_percentages_rate_check',
      sql`${t.ratePercent} > 0`,
    ),
  ],
);

export const merchantPackageAssignments = pgTable(
  'merchant_package_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantBranchId: uuid('merchant_branch_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    serviceFeeVersionId: uuid('service_fee_version_id').references(
      () => serviceFeeVersions.id,
      { onDelete: 'restrict' },
    ),
    specialPercentageId: uuid('special_percentage_id').references(
      () => specialPercentages.id,
      { onDelete: 'restrict' },
    ),
    status: assignmentState('status').notNull().default('ACTIVE'),
    isDefault: boolean('is_default').notNull().default(false),
    effectiveFrom: utc('effective_from').notNull(),
    effectiveTo: utc('effective_to'),
    ...audit,
    ...archival,
  },
  (t) => [
    index('merchant_package_assignments_branch_status_idx').on(
      t.merchantBranchId,
      t.status,
    ),
    uniqueIndex('merchant_package_assignments_default_unique')
      .on(t.merchantBranchId)
      .where(
        sql`${t.isDefault} = true and ${t.status} = 'ACTIVE' and ${t.archivedAt} is null`,
      ),
    check(
      'merchant_package_assignments_source_check',
      sql`num_nonnulls(${t.serviceFeeVersionId}, ${t.specialPercentageId}) = 1`,
    ),
  ],
);
```

### MCP domain

```ts
export const mcpAccounts = pgTable(
  'mcp_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantBranchId: uuid('merchant_branch_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    unitCode: text('unit_code').notNull().default('MCP'),
    status: text('status').notNull().default('ACTIVE'),
    nextSequence: numeric('next_sequence', { precision: 20, scale: 0 })
      .notNull()
      .default('1'),
    ...audit,
    ...archival,
  },
  (t) => [
    unique('mcp_accounts_branch_unique').on(t.merchantBranchId),
    unique('mcp_accounts_branch_market_unique').on(
      t.merchantBranchId,
      t.marketId,
    ),
    index('mcp_accounts_market_status_idx').on(t.marketId, t.status),
  ],
);

export const mcpLedgerEntries = pgTable(
  'mcp_ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mcpAccountId: uuid('mcp_account_id')
      .notNull()
      .references(() => mcpAccounts.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    sequence: numeric('sequence', { precision: 20, scale: 0 }).notNull(),
    entryType: mcpEntryType('entry_type').notNull(),
    direction: direction('direction').notNull(),
    amount: numeric('amount', { precision: 24, scale: 8 }).notNull(),
    balanceDelta: numeric('balance_delta', {
      precision: 24,
      scale: 8,
    }).notNull(),
    availableDelta: numeric('available_delta', {
      precision: 24,
      scale: 8,
    }).notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    approvalRequestId: uuid('approval_request_id'),
    reversalOfEntryId: uuid('reversal_of_entry_id'),
    metadata: jsonb('metadata').notNull().default({}),
    effectiveAt: utc('effective_at').notNull(),
    createdAt: utc('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('mcp_ledger_account_sequence_unique').on(t.mcpAccountId, t.sequence),
    unique('mcp_ledger_account_idempotency_unique').on(
      t.mcpAccountId,
      t.idempotencyKey,
    ),
    uniqueIndex('mcp_ledger_reversal_unique')
      .on(t.reversalOfEntryId)
      .where(sql`${t.reversalOfEntryId} is not null`),
    index('mcp_ledger_account_effective_idx').on(t.mcpAccountId, t.effectiveAt),
    index('mcp_ledger_source_idx').on(t.sourceType, t.sourceId),
    check('mcp_ledger_amount_positive_check', sql`${t.amount} > 0`),
  ],
);

export const mcpRechargeRequests = pgTable(
  'mcp_recharge_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mcpAccountId: uuid('mcp_account_id')
      .notNull()
      .references(() => mcpAccounts.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    requestedByAccountId: uuid('requested_by_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 24, scale: 8 }).notNull(),
    channel: text('channel').notNull(),
    status: rechargeState('status').notNull().default('PENDING'),
    idempotencyKey: text('idempotency_key').notNull(),
    providerEventId: text('provider_event_id'),
    reviewedByAdminUserId: uuid('reviewed_by_admin_user_id').references(
      () => adminUsers.id,
      { onDelete: 'restrict' },
    ),
    reviewReason: text('review_reason'),
    ledgerEntryId: uuid('ledger_entry_id').references(
      () => mcpLedgerEntries.id,
      { onDelete: 'restrict' },
    ),
    ...audit,
  },
  (t) => [
    unique('mcp_recharge_account_idempotency_unique').on(
      t.mcpAccountId,
      t.idempotencyKey,
    ),
    uniqueIndex('mcp_recharge_provider_event_unique')
      .on(t.providerEventId)
      .where(sql`${t.providerEventId} is not null`),
    index('mcp_recharge_market_status_idx').on(t.marketId, t.status),
    check('mcp_recharge_amount_positive_check', sql`${t.amount} > 0`),
  ],
);

export const mcpRefundRequests = pgTable(
  'mcp_refund_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mcpAccountId: uuid('mcp_account_id')
      .notNull()
      .references(() => mcpAccounts.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    requestedByAccountId: uuid('requested_by_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 24, scale: 8 }).notNull(),
    status: refundState('status').notNull().default('PENDING'),
    reason: text('reason').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    reviewedByAdminUserId: uuid('reviewed_by_admin_user_id').references(
      () => adminUsers.id,
      { onDelete: 'restrict' },
    ),
    reviewReason: text('review_reason'),
    ledgerEntryId: uuid('ledger_entry_id').references(
      () => mcpLedgerEntries.id,
      { onDelete: 'restrict' },
    ),
    ...audit,
  },
  (t) => [
    unique('mcp_refund_account_idempotency_unique').on(
      t.mcpAccountId,
      t.idempotencyKey,
    ),
    index('mcp_refund_market_status_idx').on(t.marketId, t.status),
    check('mcp_refund_amount_positive_check', sql`${t.amount} > 0`),
  ],
);

export const mcpAdjustmentRequests = pgTable(
  'mcp_adjustment_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mcpAccountId: uuid('mcp_account_id')
      .notNull()
      .references(() => mcpAccounts.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    makerAdminUserId: uuid('maker_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    entryType: mcpEntryType('entry_type').notNull(),
    amount: numeric('amount', { precision: 24, scale: 8 }).notNull(),
    reason: text('reason').notNull(),
    evidence: jsonb('evidence').notNull().default({}),
    status: adjustmentState('status').notNull().default('DRAFT'),
    idempotencyKey: text('idempotency_key').notNull(),
    ledgerEntryId: uuid('ledger_entry_id').references(
      () => mcpLedgerEntries.id,
      { onDelete: 'restrict' },
    ),
    version: integer('version').notNull().default(1),
    ...audit,
  },
  (t) => [
    unique('mcp_adjustment_account_idempotency_unique').on(
      t.mcpAccountId,
      t.idempotencyKey,
    ),
    index('mcp_adjustment_market_status_idx').on(t.marketId, t.status),
    check('mcp_adjustment_amount_positive_check', sql`${t.amount} > 0`),
    check(
      'mcp_adjustment_type_check',
      sql`${t.entryType} in ('MANUAL_CREDIT','MANUAL_DEBIT')`,
    ),
  ],
);

export const mcpAdjustmentDecisions = pgTable(
  'mcp_adjustment_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adjustmentRequestId: uuid('adjustment_request_id')
      .notNull()
      .references(() => mcpAdjustmentRequests.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    checkerAdminUserId: uuid('checker_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    decision: text('decision').notNull(),
    reason: text('reason').notNull(),
    decidedAt: utc('decided_at').notNull().defaultNow(),
    createdAt: utc('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('mcp_adjustment_decision_request_unique').on(t.adjustmentRequestId),
    index('mcp_adjustment_decision_checker_time_idx').on(
      t.checkerAdminUserId,
      t.decidedAt,
    ),
    check(
      'mcp_adjustment_decision_value_check',
      sql`${t.decision} in ('APPROVED','REJECTED')`,
    ),
  ],
);

export const insertRechargeSchema = createInsertSchema(mcpRechargeRequests, {
  amount: (schema) => schema.regex(/^\d+(\.\d{1,8})?$/u),
});
export const selectLedgerEntrySchema = createSelectSchema(mcpLedgerEntries);
```

## 4. Additional database enforcement planned

- Deferrable/self foreign key from `mcp_ledger_entries.reversal_of_entry_id` to ledger ID and entry-type/opposite-delta checks.
- Immutable triggers reject `UPDATE` and `DELETE` on MCP ledger entries, operational status history, terms acceptances, MCP adjustment decisions, KYC submissions and KYC review evidence. These tables have no soft-delete column; corrections append compensation or superseding evidence.
- MerchantGroup and every child branch must have the same `market_id`. No group-level permission, shared MCP or group-level settlement relationship is modeled. O-01 is resolved for the Phase 1 structural boundary.
- Account email is the only Merchant primary email. No Merchant table duplicates it, and neither Merchant nor Admin input may update it.
- Application Review writes only `MerchantApplicationStatus`; KYC Review writes only `MerchantKycStatus`; activation policy derives `MerchantOperationalStatus`. Suspend/reactivate update only Operational Status and preserve MCP.
- Standard package identities record A=2.5, B=5, C=10, D=15, E=20 and F=25.
- Maximum allowed special percentage remains OPEN per O-07.
- P1-S2 special-percentage production constraint is blocked until Command Center decision.
- No implementation may invent maximum, minimum business increment or approval threshold.
- Exclusion constraints for overlapping active effective periods where appropriate.
- Transactional service checks for market equality, group ownership, maker != checker, last-active/default package and non-negative MCP; cross-table rules cannot be trusted to DTO validation alone.
