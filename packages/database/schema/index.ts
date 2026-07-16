import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const utcTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true, precision: 6 });

export const accountStatus = pgEnum('account_status', [
  'PENDING',
  'ACTIVE',
  'SUSPENDED',
  'LOCKED',
  'ARCHIVED',
]);
export const credentialType = pgEnum('credential_type', ['PASSWORD']);
export const otpPurpose = pgEnum('otp_purpose', [
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET',
  'STEP_UP',
]);
export const marketStatus = pgEnum('market_status', ['ACTIVE', 'INACTIVE']);
export const adminStatus = pgEnum('admin_status', [
  'ACTIVE',
  'SUSPENDED',
  'ARCHIVED',
]);
export const actorType = pgEnum('actor_type', [
  'ACCOUNT',
  'ADMIN_USER',
  'SYSTEM',
]);
export const eventResult = pgEnum('event_result', [
  'SUCCESS',
  'FAILURE',
  'DENIED',
]);

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
export const mcpEntryType = pgEnum('mcp_entry_type', [
  'RECHARGE',
  'TRANSACTION_DEDUCTION',
  'ADVERTISING_DEDUCTION',
  'MANUAL_CREDIT',
  'MANUAL_DEBIT',
  'REFUND',
  'FREEZE',
  'UNFREEZE',
  'REVERSAL',
]);
export const mcpDirection = pgEnum('mcp_direction', ['CREDIT', 'DEBIT']);
export const adjustmentState = pgEnum('adjustment_state', [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'EXECUTED',
  'CANCELLED',
]);
export const rechargeState = pgEnum('recharge_state', [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);
export const refundState = pgEnum('refund_state', [
  'PENDING',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
]);
export const serviceFeeStatus = pgEnum('service_fee_status', [
  'ACTIVE',
  'PAUSED',
  'PENDING_CHANGE',
]);
export const authAccountAccessType = pgEnum('auth_account_access_type', [
  'PRIMARY_OWNER',
]);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicId: text('public_id').notNull(),
    email: text('email').notNull(),
    accountCountry: text('account_country').notNull(),
    status: accountStatus('status').notNull().default('PENDING'),
    emailVerifiedAt: utcTimestamp('email_verified_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [
    unique('accounts_public_id_unique').on(table.publicId),
    unique('accounts_email_unique').on(table.email),
    check(
      'accounts_email_normalized_check',
      sql`${table.email} = lower(${table.email})`,
    ),
    check(
      'accounts_country_code_check',
      sql`char_length(${table.accountCountry}) = 2`,
    ),
    index('accounts_status_idx').on(table.status),
  ],
);

export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    type: credentialType('type').notNull().default('PASSWORD'),
    secretHash: text('secret_hash').notNull(),
    hashAlgorithm: text('hash_algorithm').notNull(),
    hashVersion: integer('hash_version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    revokedAt: utcTimestamp('revoked_at'),
  },
  (table) => [
    unique('credentials_account_type_unique').on(table.accountId, table.type),
    check(
      'credentials_hash_only_check',
      sql`char_length(${table.secretHash}) >= 32`,
    ),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    familyId: uuid('family_id').notNull(),
    accessTokenHash: text('access_token_hash').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    lastSeenAt: utcTimestamp('last_seen_at').notNull().defaultNow(),
    expiresAt: utcTimestamp('expires_at').notNull(),
    revokedAt: utcTimestamp('revoked_at'),
    revokeReason: text('revoke_reason'),
    replacedBySessionId: uuid('replaced_by_session_id'),
    accessExpiresAt: utcTimestamp('access_expires_at').notNull(),
  },
  (table) => [
    unique('sessions_access_token_hash_unique').on(table.accessTokenHash),
    unique('sessions_refresh_token_hash_unique').on(table.refreshTokenHash),
    index('sessions_account_active_idx').on(table.accountId, table.expiresAt),
    check(
      'sessions_token_hashes_only_check',
      sql`
      char_length(${table.accessTokenHash}) = 64
      and char_length(${table.refreshTokenHash}) = 64
    `,
    ),
    check(
      'sessions_expiry_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      'sessions_access_expiry_check',
      sql`${table.accessExpiresAt} > ${table.createdAt} and ${table.accessExpiresAt} <= ${table.expiresAt}`,
    ),
  ],
);

export const otps = pgTable(
  'otps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').references(() => accounts.id, {
      onDelete: 'restrict',
    }),
    destination: text('destination').notNull(),
    purpose: otpPurpose('purpose').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    expiresAt: utcTimestamp('expires_at').notNull(),
    verifiedAt: utcTimestamp('verified_at'),
    consumedAt: utcTimestamp('consumed_at'),
  },
  (table) => [
    index('otps_destination_purpose_idx').on(table.destination, table.purpose),
    check(
      'otps_code_hash_only_check',
      sql`char_length(${table.codeHash}) = 64`,
    ),
    check(
      'otps_attempts_check',
      sql`${table.attempts} >= 0 and ${table.attempts} <= ${table.maxAttempts}`,
    ),
    check('otps_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const securityEvents = pgTable(
  'security_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').references(() => accounts.id, {
      onDelete: 'restrict',
    }),
    eventType: text('event_type').notNull(),
    result: eventResult('result').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: utcTimestamp('occurred_at').notNull().defaultNow(),
  },
  (table) => [
    index('security_events_account_time_idx').on(
      table.accountId,
      table.occurredAt,
    ),
  ],
);

export const markets = pgTable(
  'markets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    status: marketStatus('status').notNull().default('INACTIVE'),
    currencyCode: text('currency_code').notNull(),
    timezone: text('timezone').notNull(),
    defaultLocale: text('default_locale').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [
    unique('markets_code_unique').on(table.code),
    check(
      'markets_code_check',
      sql`${table.code} = upper(${table.code}) and char_length(${table.code}) between 2 and 8`,
    ),
    check(
      'markets_currency_check',
      sql`${table.currencyCode} = upper(${table.currencyCode}) and char_length(${table.currencyCode}) = 3`,
    ),
  ],
);

export const adminUsers = pgTable(
  'admin_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    displayName: text('display_name').notNull(),
    status: adminStatus('status').notNull().default('ACTIVE'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [unique('admin_users_account_unique').on(table.accountId)],
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [unique('roles_code_unique').on(table.code)],
);

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    description: text('description').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [unique('permissions_code_unique').on(table.code)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'restrict' }),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);

export const roleAssignments = pgTable(
  'role_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    assignedByAdminUserId: uuid('assigned_by_admin_user_id').references(
      () => adminUsers.id,
      { onDelete: 'restrict' },
    ),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    revokedAt: utcTimestamp('revoked_at'),
  },
  (table) => [
    uniqueIndex('role_assignments_active_unique')
      .on(table.adminUserId, table.roleId)
      .where(sql`${table.revokedAt} is null`),
    index('role_assignments_admin_idx').on(table.adminUserId),
  ],
);

export const marketAccess = pgTable(
  'market_access',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    grantedByAdminUserId: uuid('granted_by_admin_user_id').references(
      () => adminUsers.id,
      { onDelete: 'restrict' },
    ),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    revokedAt: utcTimestamp('revoked_at'),
  },
  (table) => [
    uniqueIndex('market_access_active_unique')
      .on(table.adminUserId, table.marketId)
      .where(sql`${table.revokedAt} is null`),
    index('market_access_admin_idx').on(table.adminUserId),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorType: actorType('actor_type').notNull(),
    actorId: uuid('actor_id'),
    marketId: uuid('market_id').references(() => markets.id, {
      onDelete: 'restrict',
    }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    result: eventResult('result').notNull(),
    requestId: text('request_id'),
    ipAddress: text('ip_address'),
    occurredAt: utcTimestamp('occurred_at').notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_actor_time_idx').on(
      table.actorType,
      table.actorId,
      table.occurredAt,
    ),
    index('audit_logs_entity_time_idx').on(
      table.entityType,
      table.entityId,
      table.occurredAt,
    ),
    index('audit_logs_market_time_idx').on(table.marketId, table.occurredAt),
  ],
);

export const entityTimelines = pgTable(
  'entity_timelines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    eventType: text('event_type').notNull(),
    actorType: actorType('actor_type').notNull(),
    actorId: uuid('actor_id'),
    marketId: uuid('market_id').references(() => markets.id, {
      onDelete: 'restrict',
    }),
    summary: text('summary').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: utcTimestamp('occurred_at').notNull().defaultNow(),
  },
  (table) => [
    index('entity_timelines_entity_time_idx').on(
      table.entityType,
      table.entityId,
      table.occurredAt,
    ),
  ],
);

export const merchantGroups = pgTable('merchant_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'restrict' }),
  marketId: uuid('market_id')
    .notNull()
    .references(() => markets.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
});

export const merchantAccountAccess = pgTable(
  'merchant_account_access',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    merchantGroupId: uuid('merchant_group_id')
      .notNull()
      .references(() => merchantGroups.id, { onDelete: 'restrict' }),
    accessType: authAccountAccessType('access_type')
      .notNull()
      .default('PRIMARY_OWNER'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('merchant_account_access_account_group_unique').on(
      table.accountId,
      table.merchantGroupId,
    ),
  ],
);

export const merchantBranches = pgTable(
  'merchant_branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantGroupId: uuid('merchant_group_id')
      .notNull()
      .references(() => merchantGroups.id, { onDelete: 'restrict' }),
    merchantId: text('merchant_id').notNull(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    status: merchantOperationalStatus('status')
      .notNull()
      .default('PENDING_APPLICATION'),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('merchant_branches_merchant_id_unique').on(table.merchantId),
    index('merchant_branches_group_idx').on(table.merchantGroupId),
    index('merchant_branches_merchant_id_idx').on(table.merchantId),
    check('merchant_branches_version_check', sql`${table.version} > 0`),
  ],
);

export const merchantProfiles = pgTable(
  'merchant_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantBranchId: uuid('merchant_branch_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    logoUrl: text('logo_url'),
    bannerUrl: text('banner_url'),
    aboutUs: text('about_us'),
    businessHours: jsonb('business_hours'),
    phone: text('phone'),
    whatsapp: text('whatsapp'),
    website: text('website'),
    socialLinks: jsonb('social_links'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('merchant_profiles_branch_unique').on(table.merchantBranchId),
  ],
);

export const merchantProfileGalleryEntries = pgTable(
  'merchant_profile_gallery_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantProfileId: uuid('merchant_profile_id')
      .notNull()
      .references(() => merchantProfiles.id, { onDelete: 'restrict' }),
    mediaUrl: text('media_url').notNull(),
    position: integer('position').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('merchant_profile_gallery_position_unique').on(
      table.merchantProfileId,
      table.position,
    ),
    check(
      'merchant_profile_gallery_position_check',
      sql`${table.position} between 1 and 10`,
    ),
  ],
);

export const merchantApplications = pgTable(
  'merchant_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantBranchId: uuid('merchant_branch_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    status: merchantApplicationStatus('status').notNull().default('DRAFT'),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('merchant_applications_branch_unique').on(table.merchantBranchId),
    check('merchant_applications_version_check', sql`${table.version} > 0`),
  ],
);

export const merchantApplicationSubmissions = pgTable(
  'merchant_application_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantApplicationId: uuid('merchant_application_id')
      .notNull()
      .references(() => merchantApplications.id, { onDelete: 'restrict' }),
    submissionVersion: integer('submission_version').notNull(),
    submittedData: jsonb('submitted_data').notNull(),
    submittedAt: utcTimestamp('submitted_at').notNull().defaultNow(),
  },
  (table) => [
    unique('merchant_application_submission_version_unique').on(
      table.merchantApplicationId,
      table.submissionVersion,
    ),
    check(
      'merchant_application_submission_version_check',
      sql`${table.submissionVersion} > 0`,
    ),
  ],
);

export const merchantApplicationReviews = pgTable(
  'merchant_application_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantApplicationId: uuid('merchant_application_id')
      .notNull()
      .references(() => merchantApplications.id, { onDelete: 'restrict' }),
    reviewerAdminUserId: uuid('reviewer_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    decision: merchantApplicationStatus('decision').notNull(),
    reason: text('reason').notNull(),
    decidedAt: utcTimestamp('decided_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'merchant_application_reviews_decision_check',
      sql`${table.decision} in ('APPROVED', 'REJECTED', 'RESUBMISSION_REQUIRED')`,
    ),
  ],
);

export const merchantKycSubmissions = pgTable(
  'merchant_kyc_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantBranchId: uuid('merchant_branch_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    status: merchantKycStatus('status').notNull().default('DRAFT'),
    submissionVersion: integer('submission_version').notNull(),
    submittedData: jsonb('submitted_data').notNull(),
    submittedAt: utcTimestamp('submitted_at').notNull().defaultNow(),
  },
  (table) => [
    unique('merchant_kyc_submission_branch_version_unique').on(
      table.merchantBranchId,
      table.submissionVersion,
    ),
    check(
      'merchant_kyc_submission_version_check',
      sql`${table.submissionVersion} > 0`,
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
    reviewerAdminUserId: uuid('reviewer_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    decision: merchantKycStatus('decision').notNull(),
    reason: text('reason').notNull(),
    decidedAt: utcTimestamp('decided_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'merchant_kyc_reviews_decision_check',
      sql`${table.decision} in ('APPROVED', 'REJECTED', 'RESUBMISSION_REQUIRED')`,
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
    documentType: text('document_type').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'bigint' }).notNull(),
    sha256Hash: text('sha256_hash').notNull(),
    objectKey: text('object_key').notNull(),
    uploadedAt: utcTimestamp('uploaded_at').notNull().defaultNow(),
  },
  (table) => [
    index('merchant_documents_branch_idx').on(table.merchantBranchId),
    check(
      'merchant_documents_file_size_check',
      sql`${table.fileSizeBytes} > 0`,
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
    referrerAccountId: uuid('referrer_account_id').references(
      () => accounts.id,
      { onDelete: 'restrict' },
    ),
    referredAt: utcTimestamp('referred_at').notNull().defaultNow(),
  },
  (table) => [
    unique('merchant_referrals_branch_unique').on(table.merchantBranchId),
  ],
);

export const merchantTermsAcceptances = pgTable(
  'merchant_terms_acceptances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    merchantBranchId: uuid('merchant_branch_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    termsVersion: text('terms_version').notNull(),
    acceptedAt: utcTimestamp('accepted_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    locale: text('locale'),
  },
  (table) => [
    unique('merchant_terms_acceptance_unique').on(
      table.accountId,
      table.merchantBranchId,
      table.termsVersion,
    ),
  ],
);

export const merchantStatusHistory = pgTable(
  'merchant_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantBranchId: uuid('merchant_branch_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    previousStatus: merchantOperationalStatus('previous_status'),
    newStatus: merchantOperationalStatus('new_status').notNull(),
    changedByActorType: text('changed_by_actor_type').notNull(),
    changedByActorId: text('changed_by_actor_id').notNull(),
    reason: text('reason'),
    changedAt: utcTimestamp('changed_at').notNull().defaultNow(),
  },
  (table) => [
    index('merchant_status_history_branch_idx').on(table.merchantBranchId),
  ],
);

export const merchantIdCounters = pgTable(
  'merchant_id_counters',
  {
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    channel: text('channel').notNull(),
    lastNumber: bigint('last_number', { mode: 'bigint' }).notNull().default(0n),
  },
  (table) => [
    primaryKey({ columns: [table.marketId, table.channel] }),
    check(
      'merchant_id_counters_channel_check',
      sql`${table.channel} ~ '^[a-z0-9]+$'`,
    ),
    check('merchant_id_counters_number_check', sql`${table.lastNumber} >= 0`),
  ],
);

export const serviceFeeProfiles = pgTable(
  'service_fee_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [unique('service_fee_profiles_code_unique').on(table.code)],
);

export const serviceFeeVersions = pgTable(
  'service_fee_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceFeeProfileId: uuid('service_fee_profile_id')
      .notNull()
      .references(() => serviceFeeProfiles.id, { onDelete: 'restrict' }),
    rate: numeric('rate', { precision: 12, scale: 6 }).notNull(),
    effectiveFrom: utcTimestamp('effective_from').notNull(),
    effectiveTo: utcTimestamp('effective_to'),
    status: serviceFeeStatus('status').notNull().default('ACTIVE'),
    marketId: uuid('market_id').references(() => markets.id, {
      onDelete: 'restrict',
    }),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'service_fee_versions_rate_check',
      sql`${table.rate} > 0 and ${table.rate} <= 100`,
    ),
    check(
      'service_fee_versions_period_check',
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
  ],
);

export const specialPercentages = pgTable(
  'special_percentages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rate: numeric('rate', { precision: 12, scale: 6 }).notNull(),
    createdByAdminUserId: uuid('created_by_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    description: text('description'),
    marketId: uuid('market_id').references(() => markets.id, {
      onDelete: 'restrict',
    }),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'special_percentages_rate_check',
      sql`${table.rate} > 0 and ${table.rate} <= 100`,
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
    serviceFeeVersionId: uuid('service_fee_version_id').references(
      () => serviceFeeVersions.id,
      { onDelete: 'restrict' },
    ),
    specialPercentageId: uuid('special_percentage_id').references(
      () => specialPercentages.id,
      { onDelete: 'restrict' },
    ),
    status: serviceFeeStatus('status').notNull().default('ACTIVE'),
    isDefault: boolean('is_default').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('merchant_package_assignments_branch_status_idx').on(
      table.merchantBranchId,
      table.status,
    ),
    uniqueIndex('merchant_package_assignments_active_default_unique')
      .on(table.merchantBranchId)
      .where(sql`${table.isDefault} = true and ${table.status} = 'ACTIVE'`),
    check(
      'merchant_package_assignments_source_check',
      sql`num_nonnulls(${table.serviceFeeVersionId}, ${table.specialPercentageId}) = 1`,
    ),
    check(
      'merchant_package_assignments_version_check',
      sql`${table.version} > 0`,
    ),
  ],
);

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
    availableBalance: numeric('available_balance', {
      precision: 24,
      scale: 8,
    })
      .notNull()
      .default('0'),
    totalBalance: numeric('total_balance', { precision: 24, scale: 8 })
      .notNull()
      .default('0'),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('mcp_accounts_branch_unique').on(table.merchantBranchId),
    check(
      'mcp_accounts_available_balance_check',
      sql`${table.availableBalance} >= 0`,
    ),
    check('mcp_accounts_total_balance_check', sql`${table.totalBalance} >= 0`),
    check('mcp_accounts_version_check', sql`${table.version} > 0`),
  ],
);

export const mcpLedgerEntries = pgTable(
  'mcp_ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mcpAccountId: uuid('mcp_account_id')
      .notNull()
      .references(() => mcpAccounts.id, { onDelete: 'restrict' }),
    sequence: bigint('sequence', { mode: 'bigint' }).notNull(),
    entryType: mcpEntryType('entry_type').notNull(),
    direction: mcpDirection('direction').notNull(),
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
    sourceId: text('source_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    approvalRequestId: uuid('approval_request_id'),
    reversalOfEntryId: uuid('reversal_of_entry_id'),
    metadata: jsonb('metadata').notNull().default({}),
    effectiveAt: utcTimestamp('effective_at').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('mcp_ledger_account_sequence_unique').on(
      table.mcpAccountId,
      table.sequence,
    ),
    unique('mcp_ledger_account_idempotency_unique').on(
      table.mcpAccountId,
      table.idempotencyKey,
    ),
    uniqueIndex('mcp_ledger_reversal_unique')
      .on(table.reversalOfEntryId)
      .where(sql`${table.reversalOfEntryId} is not null`),
    foreignKey({
      columns: [table.reversalOfEntryId],
      foreignColumns: [table.id],
      name: 'mcp_ledger_reversal_fk',
    }).onDelete('restrict'),
    check('mcp_ledger_amount_check', sql`${table.amount} > 0`),
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
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('mcp_recharge_account_idempotency_unique').on(
      table.mcpAccountId,
      table.idempotencyKey,
    ),
    uniqueIndex('mcp_recharge_provider_event_unique')
      .on(table.providerEventId)
      .where(sql`${table.providerEventId} is not null`),
    check('mcp_recharge_amount_check', sql`${table.amount} > 0`),
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
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('mcp_refund_account_idempotency_unique').on(
      table.mcpAccountId,
      table.idempotencyKey,
    ),
    check('mcp_refund_amount_check', sql`${table.amount} > 0`),
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
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('mcp_adjustment_account_idempotency_unique').on(
      table.mcpAccountId,
      table.idempotencyKey,
    ),
    check('mcp_adjustment_amount_check', sql`${table.amount} > 0`),
    check(
      'mcp_adjustment_entry_type_check',
      sql`${table.entryType} in ('MANUAL_CREDIT', 'MANUAL_DEBIT')`,
    ),
    check('mcp_adjustment_version_check', sql`${table.version} > 0`),
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
    decidedAt: utcTimestamp('decided_at').notNull().defaultNow(),
  },
  (table) => [
    unique('mcp_adjustment_decision_request_unique').on(
      table.adjustmentRequestId,
    ),
    check(
      'mcp_adjustment_decision_value_check',
      sql`${table.decision} in ('APPROVED', 'REJECTED')`,
    ),
  ],
);

export const schema = {
  accounts,
  credentials,
  sessions,
  otps,
  securityEvents,
  markets,
  adminUsers,
  roles,
  permissions,
  rolePermissions,
  roleAssignments,
  marketAccess,
  auditLogs,
  entityTimelines,
  merchantGroups,
  merchantAccountAccess,
  merchantBranches,
  merchantProfiles,
  merchantProfileGalleryEntries,
  merchantApplications,
  merchantApplicationSubmissions,
  merchantApplicationReviews,
  merchantKycSubmissions,
  merchantKycReviews,
  merchantDocuments,
  merchantReferrals,
  merchantTermsAcceptances,
  merchantStatusHistory,
  merchantIdCounters,
  serviceFeeProfiles,
  serviceFeeVersions,
  specialPercentages,
  merchantPackageAssignments,
  mcpAccounts,
  mcpLedgerEntries,
  mcpRechargeRequests,
  mcpRefundRequests,
  mcpAdjustmentRequests,
  mcpAdjustmentDecisions,
};
