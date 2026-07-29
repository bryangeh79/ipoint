import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSequence,
  pgTable,
  point,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
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
export const memberEmailOtpPurpose = pgEnum('member_email_otp_purpose', [
  'REGISTRATION',
  'PASSWORD_RESET',
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
export const mcpAccountStatus = pgEnum('mcp_account_status', [
  'ACTIVE',
  'FROZEN',
  'CLOSED',
]);
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
export const serviceFeeVersionStatus = pgEnum('service_fee_version_status', [
  'DRAFT',
  'SCHEDULED',
  'ACTIVE',
  'EXPIRED',
  'CANCELLED',
]);
export const packageChangeRequestStatus = pgEnum(
  'package_change_request_status',
  ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
);
export const authAccountAccessType = pgEnum('auth_account_access_type', [
  'PRIMARY_OWNER',
  'OWNER',
  'ADMIN',
  'CASHIER',
]);
export const rewardPlanStatus = pgEnum('reward_plan_status', [
  'SCHEDULED',
  'ACTIVE',
  'CAPPED',
  'SUSPENDED',
  'REVERSED',
  'COMPLETED',
]);
export const rewardCapType = pgEnum('reward_cap_type', [
  'NONE',
  'FLAT',
  'RATIO',
]);
export const memberStatus = pgEnum('member_status', [
  'PENDING_EMAIL_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'CLOSED',
]);
export const memberKycLevel = pgEnum('member_kyc_level', [
  'NONE',
  'LEVEL_1',
  'LEVEL_2',
]);

export type PhoneVerificationStatus = 'NOT_PROVIDED' | 'PENDING' | 'VERIFIED';

export const memberReferralSource = pgEnum('member_referral_source', [
  'REGISTRATION',
  'ADMIN_CORRECTION',
]);
export const memberReferralStatus = pgEnum('member_referral_status', [
  'ACTIVE',
  'VOIDED',
]);
export const memberReferralHistoryEventType = pgEnum(
  'member_referral_history_event_type',
  ['ASSIGNED', 'CORRECTED', 'VOIDED'],
);
export const memberQrIdentityStatus = pgEnum('member_qr_identity_status', [
  'ACTIVE',
  'ROTATED',
  'REVOKED',
]);
export const memberKycCaseStatus = pgEnum('member_kyc_case_status', [
  'NOT_STARTED',
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'MORE_INFO_REQUIRED',
  'REVERIFICATION_REQUIRED',
]);
export const memberKycIdentificationType = pgEnum(
  'member_kyc_identification_type',
  ['PASSPORT', 'NATIONAL_ID', 'DRIVING_LICENSE', 'RESIDENCE_PERMIT', 'OTHER'],
);
export const memberKycDocumentScanStatus = pgEnum(
  'member_kyc_document_scan_status',
  ['PENDING', 'CLEAN', 'BLOCKED'],
);
export const memberAccountCountryChangeRequestStatus = pgEnum(
  'member_account_country_change_request_status',
  ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
);
export const memberWalletEntryType = pgEnum('member_wallet_entry_type', [
  'PENDING',
  'AVAILABLE',
  'REVERSED',
  'COMPENSATION',
  'ADJUSTMENT',
  'REDEMPTION_DEBIT',
  'REDEMPTION_REFUND',
]);

export const dailyJobStatus = pgEnum('daily_job_status', [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
]);
export const transactionStatus = pgEnum('transaction_status', [
  'DRAFT',
  'PREVIEWED',
  'CONFIRMED',
  'REVERSAL_REQUESTED',
  'REFUND_REQUESTED',
  'REVERSED',
  'REFUNDED',
  'REJECTED',
  'FAILED',
  'EXPIRED',
]);
export const transactionIdempotencyOperation = pgEnum(
  'transaction_idempotency_operation',
  ['PREVIEW', 'CONFIRM'],
);
export const transactionIdempotencyStatus = pgEnum(
  'transaction_idempotency_status',
  ['IN_PROGRESS', 'COMPLETED', 'FAILED'],
);
export const transactionAuditEventType = pgEnum(
  'transaction_audit_event_type',
  ['PREVIEW_CREATED', 'CONFIRMED', 'FAILED', 'EXPIRED'],
);
export const correctionRequestType = pgEnum('correction_request_type', [
  'REVERSAL',
  'REFUND',
]);
export const correctionRequestStatus = pgEnum('correction_request_status', [
  'REQUESTED',
  'EXECUTED',
  'REJECTED',
]);
export const agentActivationStatus = pgEnum('agent_activation_status', [
  'NOT_APPLIED',
  'PENDING_PAYMENT',
  'PAYMENT_CONFIRMED',
  'COURSE_PENDING',
  'COURSE_COMPLETED',
  'PENDING_APPROVAL',
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
  'REJECTED',
]);

export const transactionNumberSequence = pgSequence(
  'transaction_number_sequence',
  {
    startWith: 1,
    increment: 1,
    cycle: false,
  },
);

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

export const authIdempotencyKeys = pgTable(
  'auth_idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseHash: text('response_hash'),
    response: jsonb('response'),
    statusCode: integer('status_code'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    expiresAt: utcTimestamp('expires_at').notNull(),
  },
  (table) => [
    unique('auth_idempotency_scope_key_unique').on(table.scope, table.key),
    check(
      'auth_idempotency_request_hash_check',
      sql`char_length(${table.requestHash}) = 64`,
    ),
    check(
      'auth_idempotency_response_hash_check',
      sql`${table.responseHash} is null or char_length(${table.responseHash}) = 64`,
    ),
    check(
      'auth_idempotency_result_check',
      sql`(${table.response} is null and ${table.statusCode} is null) or (${table.response} is not null and ${table.statusCode} between 200 and 299)`,
    ),
  ],
);

export const memberEmailOtps = pgTable(
  'member_email_otps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purpose: memberEmailOtpPurpose('purpose').notNull(),
    memberId: uuid('member_id').references(() => members.id, {
      onDelete: 'restrict',
    }),
    accountId: uuid('account_id').references(() => accounts.id, {
      onDelete: 'restrict',
    }),
    email: text('email').notNull(),
    accountCountry: text('account_country'),
    passwordHash: text('password_hash'),
    referralCode: text('referral_code'),
    referrerMemberId: uuid('referrer_member_id').references(() => members.id, {
      onDelete: 'restrict',
    }),
    termsVersion: text('terms_version'),
    disclaimerVersion: text('disclaimer_version'),
    privacyVersion: text('privacy_version'),
    locale: text('locale'),
    otpHash: text('otp_hash').notNull(),
    otpVersion: integer('otp_version').notNull().default(1),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    expiresAt: utcTimestamp('expires_at').notNull(),
    resendAvailableAt: utcTimestamp('resend_available_at').notNull(),
    verifiedAt: utcTimestamp('verified_at'),
    usedAt: utcTimestamp('used_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('member_email_otps_active_unique')
      .on(table.email, table.purpose)
      .where(sql`${table.usedAt} is null`),
    index('member_email_otps_account_idx').on(table.accountId),
    index('member_email_otps_member_idx').on(table.memberId),
    check(
      'member_email_otps_email_check',
      sql`${table.email} = lower(${table.email})`,
    ),
    check('member_email_otps_attempts_check', sql`${table.attempts} >= 0`),
    check(
      'member_email_otps_max_attempts_check',
      sql`${table.maxAttempts} > 0`,
    ),
    check('member_email_otps_version_check', sql`${table.otpVersion} > 0`),
    check(
      'member_email_otps_code_hash_only_check',
      sql`char_length(${table.otpHash}) = 64`,
    ),
    check(
      'member_email_otps_expiry_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      'member_email_otps_resend_check',
      sql`${table.resendAvailableAt} >= ${table.createdAt}`,
    ),
    check(
      'member_email_otps_registration_payload_check',
      sql`
        (${table.purpose} = 'REGISTRATION' and ${table.accountCountry} is not null and ${table.passwordHash} is not null and ${table.termsVersion} is not null and ${table.disclaimerVersion} is not null and ${table.privacyVersion} is not null and ${table.locale} is not null)
        or
        (${table.purpose} = 'PASSWORD_RESET' and ${table.accountCountry} is null and ${table.passwordHash} is null and ${table.termsVersion} is null and ${table.disclaimerVersion} is null and ${table.privacyVersion} is null)
      `,
    ),
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

export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    publicMemberId: text('public_member_id').notNull(),
    referralCode: text('referral_code').notNull(),
    status: memberStatus('status')
      .notNull()
      .default('PENDING_EMAIL_VERIFICATION'),
    kycLevel: memberKycLevel('kyc_level').notNull().default('NONE'),
    closedAt: utcTimestamp('closed_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [
    unique('members_account_unique').on(table.accountId),
    unique('members_public_member_id_unique').on(table.publicMemberId),
    unique('members_referral_code_unique').on(table.referralCode),
    index('members_status_idx').on(table.status),
  ],
);

export const memberProfiles = pgTable(
  'member_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    displayName: text('display_name'),
    fullName: text('full_name'),
    phone: text('phone'),
    phoneNormalized: text('phone_normalized'),
    phoneVerificationStatus: text('phone_verification_status')
      .$type<PhoneVerificationStatus>()
      .notNull()
      .default('NOT_PROVIDED'),
    phoneChangedAt: timestamp('phone_changed_at', {
      withTimezone: true,
      precision: 6,
    }),
    phoneVerifiedAt: timestamp('phone_verified_at', {
      withTimezone: true,
      precision: 6,
    }),
    birthDate: date('birth_date'),
    address: jsonb('address'),
    avatarObjectKey: text('avatar_object_key'),
    language: text('language'),
    locale: text('locale'),
    marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [
    unique('member_profiles_member_unique').on(table.memberId),
    uniqueIndex('member_profiles_phone_normalized_unique')
      .on(table.phoneNormalized)
      .where(sql`${table.phoneNormalized} is not null`),
    check(
      'check_phone_verification_status',
      sql`${table.phoneVerificationStatus} in ('NOT_PROVIDED', 'PENDING', 'VERIFIED')`,
    ),
    check(
      'check_phone_null_consistency',
      sql`(${table.phone} is null and ${table.phoneNormalized} is null and ${table.phoneVerificationStatus} = 'NOT_PROVIDED' and ${table.phoneVerifiedAt} is null) or (${table.phone} is not null)`,
    ),
    check(
      'check_phone_pending_consistency',
      sql`(${table.phoneVerificationStatus} in ('NOT_PROVIDED', 'PENDING') and ${table.phoneNormalized} is not null and ${table.phoneVerifiedAt} is null) or (${table.phoneVerificationStatus} = 'VERIFIED') or (${table.phone} is null and ${table.phoneVerificationStatus} = 'NOT_PROVIDED')`,
    ),
    check(
      'check_phone_verified_consistency',
      sql`(${table.phoneVerificationStatus} = 'VERIFIED' and ${table.phoneNormalized} is not null and ${table.phoneVerifiedAt} is not null) or (${table.phoneVerificationStatus} != 'VERIFIED')`,
    ),
  ],
);

export const memberMarketPreferences = pgTable(
  'member_market_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    isEnabled: boolean('is_enabled').notNull().default(true),
    isCurrent: boolean('is_current').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    lastSelectedAt: utcTimestamp('last_selected_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('member_market_preferences_member_market_unique').on(
      table.memberId,
      table.marketId,
    ),
    uniqueIndex('member_market_preferences_current_unique')
      .on(table.memberId)
      .where(sql`${table.isCurrent} = true`),
    check(
      'member_market_preferences_current_enabled_check',
      sql`${table.isCurrent} = false or ${table.isEnabled} = true`,
    ),
    check(
      'member_market_preferences_sort_order_check',
      sql`${table.sortOrder} >= 0`,
    ),
  ],
);

export const memberReferrals = pgTable(
  'member_referrals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    referrerMemberId: uuid('referrer_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    referralCodeSnapshot: text('referral_code_snapshot').notNull(),
    source: memberReferralSource('source').notNull(),
    status: memberReferralStatus('status').notNull().default('ACTIVE'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('member_referrals_active_unique')
      .on(table.memberId)
      .where(sql`${table.status} = 'ACTIVE'`),
    index('member_referrals_referrer_idx').on(table.referrerMemberId),
    check(
      'member_referrals_self_reference_check',
      sql`${table.memberId} <> ${table.referrerMemberId}`,
    ),
  ],
);

export const memberReferralHistory = pgTable(
  'member_referral_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    oldReferrerMemberId: uuid('old_referrer_member_id').references(
      () => members.id,
      { onDelete: 'restrict' },
    ),
    newReferrerMemberId: uuid('new_referrer_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    eventType: memberReferralHistoryEventType('event_type').notNull(),
    correctionReason: text('correction_reason').notNull(),
    authorizedActorType: actorType('authorized_actor_type').notNull(),
    authorizedActorId: uuid('authorized_actor_id'),
    requestId: text('request_id').notNull(),
    occurredAt: utcTimestamp('occurred_at').notNull().defaultNow(),
  },
  (table) => [
    index('member_referral_history_member_time_idx').on(
      table.memberId,
      table.occurredAt,
    ),
    check(
      'member_referral_history_self_reference_check',
      sql`${table.memberId} <> ${table.newReferrerMemberId}`,
    ),
    check(
      'member_referral_history_old_new_reference_check',
      sql`${table.oldReferrerMemberId} is null or ${table.oldReferrerMemberId} <> ${table.newReferrerMemberId}`,
    ),
  ],
);

export const memberTermsAcceptances = pgTable(
  'member_terms_acceptances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    documentType: text('document_type').notNull(),
    documentVersion: text('document_version').notNull(),
    locale: text('locale'),
    acceptedAt: utcTimestamp('accepted_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    deviceFingerprint: text('device_fingerprint'),
  },
  (table) => [
    unique('member_terms_acceptance_unique').on(
      table.memberId,
      table.documentType,
      table.documentVersion,
    ),
  ],
);

export const memberQrIdentities = pgTable(
  'member_qr_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    publicQrId: text('public_qr_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    status: memberQrIdentityStatus('status').notNull().default('ACTIVE'),
    rotatedFromId: uuid('rotated_from_id'),
    rotatedToId: uuid('rotated_to_id'),
    issuedAt: utcTimestamp('issued_at').notNull().defaultNow(),
    expiresAt: utcTimestamp('expires_at'),
    revokedAt: utcTimestamp('revoked_at'),
    reason: text('reason'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('member_qr_identities_public_qr_id_unique').on(table.publicQrId),
    unique('member_qr_identities_token_hash_unique').on(table.tokenHash),
    uniqueIndex('member_qr_identities_active_unique')
      .on(table.memberId)
      .where(sql`${table.status} = 'ACTIVE'`),
    foreignKey({
      columns: [table.rotatedFromId],
      foreignColumns: [table.id],
      name: 'member_qr_identities_rotated_from_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.rotatedToId],
      foreignColumns: [table.id],
      name: 'member_qr_identities_rotated_to_fk',
    }).onDelete('restrict'),
    check(
      'member_qr_identities_token_hash_only_check',
      sql`char_length(${table.tokenHash}) = 64`,
    ),
  ],
);

export const memberKycCases = pgTable(
  'member_kyc_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    status: memberKycCaseStatus('status').notNull().default('NOT_STARTED'),
    version: integer('version').notNull().default(1),
    levelRequested: memberKycLevel('level_requested').notNull(),
    legalFullName: text('legal_full_name'),
    identificationType: memberKycIdentificationType('identification_type'),
    identificationNumber: text('identification_number'),
    dateOfBirth: date('date_of_birth'),
    nationality: text('nationality'),
    residentialAddress: jsonb('residential_address'),
    accountCountrySnapshot: text('account_country_snapshot'),
    submissionMarketId: uuid('submission_market_id').references(
      () => markets.id,
      { onDelete: 'restrict' },
    ),
    consentVersion: text('consent_version'),
    submittedAt: utcTimestamp('submitted_at'),
    reviewedAt: utcTimestamp('reviewed_at'),
    reviewedByAdminUserId: uuid('reviewed_by_admin_user_id').references(
      () => adminUsers.id,
      { onDelete: 'restrict' },
    ),
    decisionReason: text('decision_reason'),
    reverificationRequiredAt: utcTimestamp('reverification_required_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('member_kyc_cases_member_unique').on(table.memberId),
    index('member_kyc_cases_market_idx').on(table.marketId),
    index('member_kyc_cases_submission_market_idx').on(
      table.submissionMarketId,
    ),
    check('member_kyc_cases_version_check', sql`${table.version} > 0`),
    check(
      'member_kyc_cases_nationality_check',
      sql`${table.nationality} is null or (${table.nationality} = upper(${table.nationality}) and char_length(${table.nationality}) = 2)`,
    ),
    check(
      'member_kyc_cases_account_country_snapshot_check',
      sql`${table.accountCountrySnapshot} is null or (${table.accountCountrySnapshot} = upper(${table.accountCountrySnapshot}) and char_length(${table.accountCountrySnapshot}) = 2)`,
    ),
    check(
      'member_kyc_cases_residential_address_check',
      sql`${table.residentialAddress} is null or jsonb_typeof(${table.residentialAddress}) = 'object'`,
    ),
    check(
      'member_kyc_cases_level_2_submission_fields_check',
      sql`${table.levelRequested} <> 'LEVEL_2' or ${table.status} in ('NOT_STARTED', 'DRAFT') or (${table.legalFullName} is not null and btrim(${table.legalFullName}) <> '' and ${table.identificationType} is not null and ${table.identificationNumber} is not null and btrim(${table.identificationNumber}) <> '' and ${table.dateOfBirth} is not null and ${table.nationality} is not null and ${table.residentialAddress} is not null and ${table.accountCountrySnapshot} is not null and ${table.submissionMarketId} is not null and ${table.consentVersion} is not null and btrim(${table.consentVersion}) <> '' and ${table.submittedAt} is not null)`,
    ),
  ],
);

export const memberKycIdempotencyKeys = pgTable(
  'member_kyc_idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    response: jsonb('response'),
    statusCode: integer('status_code'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('member_kyc_idempotency_scope_key_unique').on(
      table.scope,
      table.key,
    ),
    check(
      'member_kyc_idempotency_request_hash_check',
      sql`char_length(${table.requestHash}) = 64`,
    ),
    check(
      'member_kyc_idempotency_result_check',
      sql`(${table.response} is null and ${table.statusCode} is null) or (${table.response} is not null and ${table.statusCode} between 100 and 599)`,
    ),
  ],
);

export const memberKycDocuments = pgTable(
  'member_kyc_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberKycCaseId: uuid('member_kyc_case_id')
      .notNull()
      .references(() => memberKycCases.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    documentType: text('document_type').notNull(),
    objectKey: text('object_key').notNull(),
    originalFilename: text('original_filename').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: numeric('byte_size', { precision: 20, scale: 0 }).notNull(),
    sha256: text('sha256').notNull(),
    scanStatus: memberKycDocumentScanStatus('scan_status')
      .notNull()
      .default('PENDING'),
    classification: text('classification').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [
    unique('member_kyc_documents_object_key_unique').on(table.objectKey),
    index('member_kyc_documents_case_idx').on(table.memberKycCaseId),
    check('member_kyc_documents_byte_size_check', sql`${table.byteSize} > 0`),
  ],
);

export const memberAccountCountryChangeRequests = pgTable(
  'member_account_country_change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    currentCountry: text('current_country').notNull(),
    requestedCountry: text('requested_country').notNull(),
    status: memberAccountCountryChangeRequestStatus('status')
      .notNull()
      .default('PENDING'),
    reason: text('reason').notNull(),
    reviewedByAdminUserId: uuid('reviewed_by_admin_user_id').references(
      () => adminUsers.id,
      { onDelete: 'restrict' },
    ),
    reviewReason: text('review_reason'),
    submittedAt: utcTimestamp('submitted_at').notNull().defaultNow(),
    reviewedAt: utcTimestamp('reviewed_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('member_account_country_change_requests_pending_unique')
      .on(table.memberId)
      .where(sql`${table.status} = 'PENDING'`),
    index('member_account_country_change_requests_account_idx').on(
      table.accountId,
    ),
    check(
      'member_account_country_change_requests_current_country_check',
      sql`${table.currentCountry} = upper(${table.currentCountry}) and char_length(${table.currentCountry}) = 2`,
    ),
    check(
      'member_account_country_change_requests_requested_country_check',
      sql`${table.requestedCountry} = upper(${table.requestedCountry}) and char_length(${table.requestedCountry}) = 2`,
    ),
  ],
);

export const memberStatusHistory = pgTable(
  'member_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    fromStatus: memberStatus('from_status'),
    toStatus: memberStatus('to_status').notNull(),
    actorType: actorType('actor_type').notNull(),
    actorId: uuid('actor_id'),
    reason: text('reason'),
    occurredAt: utcTimestamp('occurred_at').notNull().defaultNow(),
  },
  (table) => [
    index('member_status_history_member_time_idx').on(
      table.memberId,
      table.occurredAt,
    ),
  ],
);

export const adminMemberNotes = pgTable(
  'admin_member_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    content: text('content').notNull(),
    isInternal: boolean('is_internal').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'admin_member_notes_content_not_empty_check',
      sql`char_length(btrim(${table.content})) > 0`,
    ),
    check(
      'admin_member_notes_content_max_length_check',
      sql`char_length(${table.content}) <= 5000`,
    ),
    index('admin_member_notes_member_created_at_idx').on(
      table.memberId,
      table.createdAt,
    ),
  ],
);

export const memberKycHistory = pgTable(
  'member_kyc_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberKycCaseId: uuid('member_kyc_case_id')
      .notNull()
      .references(() => memberKycCases.id, { onDelete: 'restrict' }),
    eventType: text('event_type').notNull(),
    actorType: actorType('actor_type').notNull(),
    actorId: uuid('actor_id'),
    summary: text('summary').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: utcTimestamp('occurred_at').notNull().defaultNow(),
  },
  (table) => [
    index('member_kyc_history_case_time_idx').on(
      table.memberKycCaseId,
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
    isPubliclyVisible: boolean('is_publicly_visible').notNull().default(false),
    isOnline: boolean('is_online').notNull().default(false),
    isOffline: boolean('is_offline').notNull().default(false),
    coordinates: point('coordinates', { mode: 'xy' }),
    displayOrder: integer('display_order').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('merchant_branches_merchant_id_unique').on(table.merchantId),
    index('merchant_branches_group_idx').on(table.merchantGroupId),
    index('merchant_branches_merchant_id_idx').on(table.merchantId),
    index('merchant_branches_discovery_idx')
      .on(
        table.marketId,
        table.isPubliclyVisible,
        table.displayOrder,
        table.name,
        table.id,
      )
      .where(sql`${table.status} = 'ACTIVE'`),
    index('merchant_branches_coordinates_gist_idx')
      .using('gist', table.coordinates.asc().op('point_ops'))
      .where(
        sql`${table.status} = 'ACTIVE' and ${table.isPubliclyVisible} = true and ${table.coordinates} is not null`,
      ),
    index('merchant_branches_name_search_idx')
      .using('gin', table.name.asc().op('gin_trgm_ops'))
      .where(
        sql`${table.status} = 'ACTIVE' and ${table.isPubliclyVisible} = true`,
      ),
    unique('merchant_branches_id_market_unique').on(table.id, table.marketId),
    check(
      'merchant_branches_coordinates_check',
      sql`${table.coordinates} is null or (${table.coordinates}[0] between -180 and 180 and ${table.coordinates}[1] between -90 and 90)`,
    ),
    check(
      'merchant_branches_display_order_check',
      sql`${table.displayOrder} >= 0`,
    ),
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
    address: jsonb('address'),
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
    index('merchant_profiles_about_search_idx')
      .using('gin', table.aboutUs.asc().op('gin_trgm_ops'))
      .where(sql`${table.aboutUs} is not null`),
  ],
);

export const merchantCategories = pgTable(
  'merchant_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('merchant_categories_market_code_unique').on(
      table.marketId,
      table.code,
    ),
    unique('merchant_categories_id_market_unique').on(table.id, table.marketId),
    index('merchant_categories_market_active_idx').on(
      table.marketId,
      table.isActive,
      table.sortOrder,
      table.name,
    ),
    check('merchant_categories_code_check', sql`btrim(${table.code}) <> ''`),
    check('merchant_categories_name_check', sql`btrim(${table.name}) <> ''`),
    check('merchant_categories_sort_order_check', sql`${table.sortOrder} >= 0`),
  ],
);

export const merchantBranchCategories = pgTable(
  'merchant_branch_categories',
  {
    merchantBranchId: uuid('merchant_branch_id').notNull(),
    categoryId: uuid('category_id').notNull(),
    marketId: uuid('market_id').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.merchantBranchId, table.categoryId] }),
    foreignKey({
      columns: [table.merchantBranchId, table.marketId],
      foreignColumns: [merchantBranches.id, merchantBranches.marketId],
      name: 'merchant_branch_categories_branch_market_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.categoryId, table.marketId],
      foreignColumns: [merchantCategories.id, merchantCategories.marketId],
      name: 'merchant_branch_categories_category_market_fk',
    }).onDelete('restrict'),
    index('merchant_branch_categories_category_idx').on(
      table.marketId,
      table.categoryId,
      table.merchantBranchId,
    ),
    uniqueIndex('merchant_branch_categories_primary_unique')
      .on(table.merchantBranchId)
      .where(sql`${table.isPrimary} = true`),
  ],
);

export const merchantApiIdempotencyKeys = pgTable(
  'merchant_api_idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    response: jsonb('response'),
    statusCode: integer('status_code'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('merchant_api_idempotency_scope_key_unique').on(
      table.scope,
      table.key,
    ),
    check(
      'merchant_api_idempotency_request_hash_check',
      sql`char_length(${table.requestHash}) = 64`,
    ),
    check(
      'merchant_api_idempotency_result_check',
      sql`(${table.response} is null and ${table.statusCode} is null) or (${table.response} is not null and ${table.statusCode} between 200 and 299)`,
    ),
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
    marketId: uuid('market_id').references(() => markets.id, {
      onDelete: 'restrict',
    }),
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
    status: serviceFeeVersionStatus('status').notNull().default('DRAFT'),
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

export const merchantPackageChangeRequests = pgTable(
  'merchant_package_change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantBranchId: uuid('merchant_branch_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    requestedServiceFeeVersionId: uuid('requested_service_fee_version_id')
      .notNull()
      .references(() => serviceFeeVersions.id, { onDelete: 'restrict' }),
    requestedByAccountId: uuid('requested_by_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    status: packageChangeRequestStatus('status').notNull().default('PENDING'),
    reason: text('reason').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('merchant_package_change_requests_open_unique')
      .on(table.merchantBranchId)
      .where(sql`${table.status} = 'PENDING'`),
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
      precision: 38,
      scale: 10,
    })
      .notNull()
      .default('0'),
    totalBalance: numeric('total_balance', { precision: 38, scale: 10 })
      .notNull()
      .default('0'),
    status: mcpAccountStatus('status').notNull().default('ACTIVE'),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('mcp_accounts_branch_unique').on(table.merchantBranchId),
    unique('mcp_accounts_id_market_unique').on(table.id, table.marketId),
    foreignKey({
      columns: [table.merchantBranchId, table.marketId],
      foreignColumns: [merchantBranches.id, merchantBranches.marketId],
      name: 'mcp_accounts_branch_market_fk',
    }).onDelete('restrict'),
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
    amount: numeric('amount', { precision: 38, scale: 10 }).notNull(),
    balanceDelta: numeric('balance_delta', {
      precision: 38,
      scale: 10,
    }).notNull(),
    availableDelta: numeric('available_delta', {
      precision: 38,
      scale: 10,
    }).notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    reason: text('reason').notNull(),
    approvalRequestId: uuid('approval_request_id'),
    reversalOfEntryId: uuid('reversal_of_entry_id'),
    metadata: jsonb('metadata').notNull().default({}),
    effectiveAt: utcTimestamp('effective_at').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('mcp_ledger_entries_id_account_unique').on(
      table.id,
      table.mcpAccountId,
    ),
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
    amount: numeric('amount', { precision: 38, scale: 10 }).notNull(),
    channel: text('channel').notNull(),
    status: rechargeState('status').notNull().default('PENDING'),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    reviewPayloadHash: text('review_payload_hash'),
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
    amount: numeric('amount', { precision: 38, scale: 10 }).notNull(),
    status: refundState('status').notNull().default('PENDING'),
    reason: text('reason').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
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
    amount: numeric('amount', { precision: 38, scale: 10 }).notNull(),
    reason: text('reason').notNull(),
    evidence: jsonb('evidence').notNull().default({}),
    status: adjustmentState('status').notNull().default('DRAFT'),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
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

export const memberWalletAccounts = pgTable(
  'member_wallet_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    pendingBalance: numeric('pending_balance', {
      precision: 38,
      scale: 10,
    })
      .notNull()
      .default('0'),
    availableBalance: numeric('available_balance', {
      precision: 38,
      scale: 10,
    })
      .notNull()
      .default('0'),
    reversedBalance: numeric('reversed_balance', {
      precision: 38,
      scale: 10,
    })
      .notNull()
      .default('0'),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [
    unique('member_wallet_accounts_member_market_unique').on(
      table.memberId,
      table.marketId,
    ),
    check(
      'member_wallet_accounts_pending_balance_check',
      sql`${table.pendingBalance} >= 0`,
    ),
    check(
      'member_wallet_accounts_available_balance_check',
      sql`${table.availableBalance} >= 0`,
    ),
    check(
      'member_wallet_accounts_reversed_balance_check',
      sql`${table.reversedBalance} >= 0`,
    ),
    check('member_wallet_accounts_version_check', sql`${table.version} > 0`),
  ],
);

export const memberWalletEntries = pgTable(
  'member_wallet_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletAccountId: uuid('wallet_account_id')
      .notNull()
      .references(() => memberWalletAccounts.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    entrySequence: bigint('entry_sequence', { mode: 'bigint' }).notNull(),
    entryType: memberWalletEntryType('entry_type').notNull(),
    amount: numeric('amount', { precision: 38, scale: 10 }).notNull(),
    balanceBefore: numeric('balance_before', {
      precision: 38,
      scale: 10,
    }).notNull(),
    balanceAfter: numeric('balance_after', {
      precision: 38,
      scale: 10,
    }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    referenceType: text('reference_type'),
    referenceId: text('reference_id'),
    description: text('description'),
    reason: text('reason'),
    actorId: text('actor_id'),
    marketTimezone: text('market_timezone'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('member_wallet_entries_wallet_sequence_unique').on(
      table.walletAccountId,
      table.entrySequence,
    ),
    unique('member_wallet_entries_idempotency_key_unique').on(
      table.idempotencyKey,
    ),
    index('member_wallet_entries_member_market_idx').on(
      table.memberId,
      table.marketId,
    ),
    index('member_wallet_entries_reference_idx').on(
      table.referenceType,
      table.referenceId,
    ),
    check('member_wallet_entries_amount_check', sql`${table.amount} > 0`),
  ],
);

export const rewardRuleVersions = pgTable(
  'reward_rule_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    effectiveFrom: utcTimestamp('effective_from').notNull(),
    effectiveTo: utcTimestamp('effective_to'),
    rewardRate: numeric('reward_rate', { precision: 38, scale: 10 }).notNull(),
    capType: rewardCapType('cap_type').notNull().default('NONE'),
    capValue: numeric('cap_value', { precision: 38, scale: 10 })
      .notNull()
      .default('0'),
    minimumReward: numeric('minimum_reward', { precision: 38, scale: 10 })
      .notNull()
      .default('0'),
    marketId: uuid('market_id').references(() => markets.id, {
      onDelete: 'restrict',
    }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    archivedAt: utcTimestamp('archived_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('reward_rule_versions_market_effective_idx').on(
      table.marketId,
      table.effectiveFrom,
    ),
    check('reward_rule_versions_rate_check', sql`${table.rewardRate} >= 0`),
    check(
      'reward_rule_versions_cap_value_check',
      sql`(${table.capType} = 'NONE' and ${table.capValue} = 0) or (${table.capType} != 'NONE' and ${table.capValue} > 0)`,
    ),
    check(
      'reward_rule_versions_minimum_reward_check',
      sql`${table.minimumReward} >= 0`,
    ),
    check(
      'reward_rule_versions_period_check',
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
  ],
);

export const rewardPlans = pgTable(
  'reward_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    status: rewardPlanStatus('status').notNull().default('SCHEDULED'),
    totalEarned: numeric('total_earned', { precision: 38, scale: 10 })
      .notNull()
      .default('0'),
    capAmount: numeric('cap_amount', { precision: 38, scale: 10 }),
    snapshot: jsonb('snapshot'),
    ruleVersionId: uuid('rule_version_id').references(
      () => rewardRuleVersions.id,
      { onDelete: 'restrict' },
    ),
    activatedAt: utcTimestamp('activated_at'),
    completedAt: utcTimestamp('completed_at'),
    reversedAt: utcTimestamp('reversed_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('reward_plans_source_unique').on(
      table.sourceType,
      table.sourceId,
      table.memberId,
      table.marketId,
    ),
    index('reward_plans_member_market_status_idx').on(
      table.memberId,
      table.marketId,
      table.status,
    ),
    index('reward_plans_status_idx').on(table.status),
    check('reward_plans_total_earned_check', sql`${table.totalEarned} >= 0`),
  ],
);

export const rewardSources = pgTable(
  'reward_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    transactionAmount: numeric('transaction_amount', {
      precision: 38,
      scale: 10,
    }).notNull(),
    currency: text('currency').notNull(),
    merchantPackageSnapshot: jsonb('merchant_package_snapshot'),
    serviceFeeSnapshot: jsonb('service_fee_snapshot'),
    rewardRuleVersionId: uuid('reward_rule_version_id').references(
      () => rewardRuleVersions.id,
      { onDelete: 'restrict' },
    ),
    consumed: boolean('consumed').notNull().default(false),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('reward_sources_type_id_unique').on(
      table.sourceType,
      table.sourceId,
    ),
    unique('reward_sources_source_unique').on(
      table.sourceType,
      table.sourceId,
      table.memberId,
      table.marketId,
    ),
    index('reward_sources_member_idx').on(table.memberId),
    check(
      'reward_sources_transaction_amount_check',
      sql`${table.transactionAmount} > 0`,
    ),
  ],
);

export const dailyJobRuns = pgTable(
  'daily_job_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobType: text('job_type').notNull(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    localBusinessDate: date('local_business_date').notNull(),
    status: dailyJobStatus('status').notNull().default('PENDING'),
    startedAt: utcTimestamp('started_at'),
    completedAt: utcTimestamp('completed_at'),
    totalEntitlements: integer('total_entitlements').notNull().default(0),
    processedCount: integer('processed_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    errorDetail: text('error_detail'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('daily_job_runs_type_market_date_unique').on(
      table.jobType,
      table.marketId,
      table.localBusinessDate,
    ),
    index('daily_job_runs_status_idx').on(table.status),
    index('daily_job_runs_market_date_idx').on(
      table.marketId,
      table.localBusinessDate,
    ),
    check(
      'daily_job_runs_job_type_check',
      sql`char_length(${table.jobType}) > 0`,
    ),
    check(
      'daily_job_runs_total_entitlements_check',
      sql`${table.totalEntitlements} >= 0`,
    ),
    check(
      'daily_job_runs_processed_count_check',
      sql`${table.processedCount} >= 0`,
    ),
    check('daily_job_runs_failed_count_check', sql`${table.failedCount} >= 0`),
  ],
);

export const rewardDailyAccruals = pgTable(
  'reward_daily_accruals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rewardPlanId: uuid('reward_plan_id')
      .notNull()
      .references(() => rewardPlans.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    rewardRuleVersionId: uuid('reward_rule_version_id').references(
      () => rewardRuleVersions.id,
      { onDelete: 'restrict' },
    ),
    marketTimezone: text('market_timezone').notNull(),
    marketLocalDate: date('market_local_date').notNull(),
    executedAtUtc: utcTimestamp('executed_at_utc').notNull(),
    amount: numeric('amount', { precision: 38, scale: 10 }).notNull(),
    ledgerEntryType: memberWalletEntryType('ledger_entry_type').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    auditCorrelationId: uuid('audit_correlation_id'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('reward_daily_accruals_idempotency_unique').on(
      table.rewardPlanId,
      table.marketLocalDate,
      table.ledgerEntryType,
    ),
    unique('reward_daily_accruals_idempotency_key_unique').on(
      table.idempotencyKey,
    ),
    index('reward_daily_accruals_member_market_idx').on(
      table.memberId,
      table.marketId,
    ),
    index('reward_daily_accruals_plan_date_idx').on(
      table.rewardPlanId,
      table.marketLocalDate,
    ),
    check('reward_daily_accruals_amount_check', sql`${table.amount} > 0`),
    check(
      'reward_daily_accruals_idempotency_check',
      sql`char_length(${table.idempotencyKey}) > 0`,
    ),
  ],
);

export const marketTransactionSettings = pgTable(
  'market_transaction_settings',
  {
    marketId: uuid('market_id')
      .primaryKey()
      .references(() => markets.id, { onDelete: 'restrict' }),
    currencyCode: text('currency_code').notNull(),
    currencyScale: integer('currency_scale').notNull(),
    minimumTransactionAmount: numeric('minimum_transaction_amount', {
      precision: 38,
      scale: 10,
    }).notNull(),
    maximumTransactionAmount: numeric('maximum_transaction_amount', {
      precision: 38,
      scale: 10,
    }).notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('market_transaction_settings_market_currency_unique').on(
      table.marketId,
      table.currencyCode,
    ),
    check(
      'market_transaction_settings_currency_check',
      sql`${table.currencyCode} = upper(${table.currencyCode}) and char_length(${table.currencyCode}) = 3`,
    ),
    check(
      'market_transaction_settings_currency_scale_check',
      sql`${table.currencyScale} between 0 and 10`,
    ),
    check(
      'market_transaction_settings_amount_range_check',
      sql`${table.minimumTransactionAmount} > 0 and ${table.maximumTransactionAmount} >= ${table.minimumTransactionAmount}`,
    ),
  ],
);

export const transactionPreviewSessions = pgTable(
  'transaction_preview_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: transactionStatus('status').notNull().default('DRAFT'),
    merchantBranchId: uuid('merchant_branch_id').notNull(),
    merchantAccountId: uuid('merchant_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    createdByStaffAccountId: uuid('created_by_staff_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    protectedMemberReference: text('protected_member_reference').notNull(),
    marketId: uuid('market_id').notNull(),
    currency: text('currency').notNull(),
    purchaseAmount: numeric('purchase_amount', {
      precision: 38,
      scale: 10,
    }).notNull(),
    transactionNote: text('transaction_note'),
    merchantPackageAssignmentId: uuid('merchant_package_assignment_id')
      .notNull()
      .references(() => merchantPackageAssignments.id, {
        onDelete: 'restrict',
      }),
    merchantPackageVersion: integer('merchant_package_version').notNull(),
    merchantPackageSnapshot: jsonb('merchant_package_snapshot').notNull(),
    serviceFeeRate: numeric('service_fee_rate', {
      precision: 38,
      scale: 10,
    }).notNull(),
    serviceFeeAmount: numeric('service_fee_amount', {
      precision: 38,
      scale: 10,
    }).notNull(),
    estimatedMcpDebit: numeric('estimated_mcp_debit', {
      precision: 38,
      scale: 10,
    }).notNull(),
    rewardRuleVersionId: uuid('reward_rule_version_id')
      .notNull()
      .references(() => rewardRuleVersions.id, { onDelete: 'restrict' }),
    rewardRate: numeric('reward_rate', {
      precision: 38,
      scale: 10,
    }).notNull(),
    rewardPrincipal: numeric('reward_principal', {
      precision: 38,
      scale: 10,
    }).notNull(),
    rewardCap: numeric('reward_cap', {
      precision: 38,
      scale: 10,
    }).notNull(),
    dailyRewardAmount: numeric('daily_reward_amount', {
      precision: 38,
      scale: 10,
    }).notNull(),
    rewardStartBusinessDate: date('reward_start_business_date').notNull(),
    marketTimezone: text('market_timezone').notNull(),
    roundingMode: text('rounding_mode').notNull().default('HALF_UP'),
    previewedAt: utcTimestamp('previewed_at'),
    confirmedAt: utcTimestamp('confirmed_at'),
    expiresAt: utcTimestamp('expires_at').default(
      sql`now() + interval '60 minutes'`,
    ),
    failureCode: text('failure_code'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.merchantBranchId, table.marketId],
      foreignColumns: [merchantBranches.id, merchantBranches.marketId],
      name: 'transaction_preview_sessions_branch_market_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.marketId, table.currency],
      foreignColumns: [
        marketTransactionSettings.marketId,
        marketTransactionSettings.currencyCode,
      ],
      name: 'transaction_preview_sessions_market_currency_fk',
    }).onDelete('restrict'),
    index('transaction_preview_sessions_merchant_status_idx').on(
      table.merchantBranchId,
      table.status,
      table.expiresAt,
    ),
    index('transaction_preview_sessions_member_idx').on(
      table.memberId,
      table.createdAt,
    ),
    check(
      'transaction_preview_sessions_amount_check',
      sql`${table.purchaseAmount} > 0`,
    ),
    check(
      'transaction_preview_sessions_note_check',
      sql`${table.transactionNote} is null or char_length(${table.transactionNote}) <= 200`,
    ),
    check(
      'transaction_preview_sessions_member_reference_check',
      sql`btrim(${table.protectedMemberReference}) <> ''`,
    ),
    check(
      'transaction_preview_sessions_package_version_check',
      sql`${table.merchantPackageVersion} > 0`,
    ),
    check(
      'transaction_preview_sessions_package_snapshot_check',
      sql`jsonb_typeof(${table.merchantPackageSnapshot}) = 'object'`,
    ),
    check(
      'transaction_preview_sessions_service_fee_check',
      sql`${table.serviceFeeRate} > 0 and ${table.serviceFeeRate} <= 100 and ${table.serviceFeeAmount} >= 0`,
    ),
    check(
      'transaction_preview_sessions_mcp_check',
      sql`${table.estimatedMcpDebit} >= 0`,
    ),
    check(
      'transaction_preview_sessions_reward_check',
      sql`${table.rewardRate} >= 0 and ${table.rewardPrincipal} = ${table.purchaseAmount} and ${table.rewardCap} >= 0 and ${table.dailyRewardAmount} >= 0 and ${table.dailyRewardAmount} <= ${table.rewardCap}`,
    ),
    check(
      'transaction_preview_sessions_rounding_check',
      sql`${table.roundingMode} = 'HALF_UP'`,
    ),
    check(
      'transaction_preview_sessions_expiry_check',
      sql`${table.expiresAt} = ${table.createdAt} + interval '60 minutes' or (${table.status} = 'CONFIRMED' and ${table.expiresAt} is null)`,
    ),
    check(
      'transaction_preview_sessions_state_check',
      sql`(${table.status} = 'DRAFT' and ${table.previewedAt} is null and ${table.confirmedAt} is null)
        or (${table.status} = 'PREVIEWED' and ${table.previewedAt} is not null and ${table.confirmedAt} is null)
        or (${table.status} = 'CONFIRMED' and ${table.previewedAt} is not null and ${table.confirmedAt} is not null)
        or (${table.status} in ('FAILED', 'EXPIRED') and ${table.confirmedAt} is null)`,
    ),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    previewSessionId: uuid('preview_session_id')
      .notNull()
      .references(() => transactionPreviewSessions.id, {
        onDelete: 'restrict',
      }),
    transactionNumber: bigint('transaction_number', { mode: 'bigint' })
      .notNull()
      .default(sql`nextval('transaction_number_sequence')`),
    merchantReceiptNumber: text('merchant_receipt_number'),
    status: transactionStatus('status').notNull().default('CONFIRMED'),
    merchantBranchId: uuid('merchant_branch_id').notNull(),
    merchantAccountId: uuid('merchant_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    confirmedByStaffAccountId: uuid('confirmed_by_staff_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    protectedMemberReference: text('protected_member_reference').notNull(),
    marketId: uuid('market_id').notNull(),
    currency: text('currency').notNull(),
    purchaseAmount: numeric('purchase_amount', {
      precision: 38,
      scale: 10,
    }).notNull(),
    transactionNote: text('transaction_note'),
    merchantPackageAssignmentId: uuid('merchant_package_assignment_id')
      .notNull()
      .references(() => merchantPackageAssignments.id, {
        onDelete: 'restrict',
      }),
    merchantPackageVersion: integer('merchant_package_version').notNull(),
    merchantPackageSnapshot: jsonb('merchant_package_snapshot').notNull(),
    rewardRuleVersionId: uuid('reward_rule_version_id')
      .notNull()
      .references(() => rewardRuleVersions.id, { onDelete: 'restrict' }),
    rewardRate: numeric('reward_rate', {
      precision: 38,
      scale: 10,
    }).notNull(),
    rewardPrincipal: numeric('reward_principal', {
      precision: 38,
      scale: 10,
    }).notNull(),
    rewardCap: numeric('reward_cap', {
      precision: 38,
      scale: 10,
    }).notNull(),
    dailyRewardAmount: numeric('daily_reward_amount', {
      precision: 38,
      scale: 10,
    }).notNull(),
    rewardStartBusinessDate: date('reward_start_business_date').notNull(),
    marketTimezone: text('market_timezone').notNull(),
    roundingMode: text('rounding_mode').notNull().default('HALF_UP'),
    confirmedAt: utcTimestamp('confirmed_at').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('transactions_preview_session_unique').on(table.previewSessionId),
    unique('transactions_number_unique').on(table.transactionNumber),
    unique('transactions_id_market_unique').on(table.id, table.marketId),
    uniqueIndex('transactions_merchant_receipt_unique')
      .on(table.merchantBranchId, table.merchantReceiptNumber)
      .where(sql`${table.merchantReceiptNumber} is not null`),
    foreignKey({
      columns: [table.merchantBranchId, table.marketId],
      foreignColumns: [merchantBranches.id, merchantBranches.marketId],
      name: 'transactions_branch_market_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.marketId, table.currency],
      foreignColumns: [
        marketTransactionSettings.marketId,
        marketTransactionSettings.currencyCode,
      ],
      name: 'transactions_market_currency_fk',
    }).onDelete('restrict'),
    index('transactions_merchant_time_idx').on(
      table.merchantBranchId,
      table.confirmedAt.desc(),
    ),
    index('transactions_member_time_idx').on(
      table.memberId,
      table.confirmedAt.desc(),
    ),
    check(
      'transactions_status_check',
      sql`${table.status} in ('CONFIRMED', 'REVERSAL_REQUESTED', 'REFUND_REQUESTED', 'REVERSED', 'REFUNDED', 'REJECTED')`,
    ),
    check('transactions_number_check', sql`${table.transactionNumber} > 0`),
    check(
      'transactions_receipt_check',
      sql`${table.merchantReceiptNumber} is null or btrim(${table.merchantReceiptNumber}) <> ''`,
    ),
    check('transactions_amount_check', sql`${table.purchaseAmount} > 0`),
    check(
      'transactions_note_check',
      sql`${table.transactionNote} is null or char_length(${table.transactionNote}) <= 200`,
    ),
    check(
      'transactions_member_reference_check',
      sql`btrim(${table.protectedMemberReference}) <> ''`,
    ),
    check(
      'transactions_package_version_check',
      sql`${table.merchantPackageVersion} > 0`,
    ),
    check(
      'transactions_package_snapshot_check',
      sql`jsonb_typeof(${table.merchantPackageSnapshot}) = 'object'`,
    ),
    check(
      'transactions_reward_check',
      sql`${table.rewardRate} >= 0 and ${table.rewardPrincipal} = ${table.purchaseAmount} and ${table.rewardCap} >= 0 and ${table.dailyRewardAmount} >= 0 and ${table.dailyRewardAmount} <= ${table.rewardCap}`,
    ),
    check(
      'transactions_rounding_check',
      sql`${table.roundingMode} = 'HALF_UP'`,
    ),
  ],
);

export const transactionServiceFees = pgTable(
  'transaction_service_fees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id').notNull(),
    currency: text('currency').notNull(),
    rate: numeric('rate', { precision: 38, scale: 10 }).notNull(),
    principal: numeric('principal', { precision: 38, scale: 10 }).notNull(),
    amount: numeric('amount', { precision: 38, scale: 10 }).notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('transaction_service_fees_transaction_unique').on(
      table.transactionId,
    ),
    foreignKey({
      columns: [table.transactionId, table.marketId],
      foreignColumns: [transactions.id, transactions.marketId],
      name: 'transaction_service_fees_transaction_market_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.marketId, table.currency],
      foreignColumns: [
        marketTransactionSettings.marketId,
        marketTransactionSettings.currencyCode,
      ],
      name: 'transaction_service_fees_market_currency_fk',
    }).onDelete('restrict'),
    check(
      'transaction_service_fees_value_check',
      sql`${table.rate} > 0 and ${table.rate} <= 100 and ${table.principal} > 0 and ${table.amount} >= 0`,
    ),
  ],
);

export const transactionMcpDebits = pgTable(
  'transaction_mcp_debits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id').notNull(),
    marketId: uuid('market_id').notNull(),
    mcpAccountId: uuid('mcp_account_id').notNull(),
    mcpLedgerEntryId: uuid('mcp_ledger_entry_id').notNull(),
    amount: numeric('amount', { precision: 38, scale: 10 }).notNull(),
    balanceAfter: numeric('balance_after', {
      precision: 38,
      scale: 10,
    }).notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('transaction_mcp_debits_transaction_unique').on(table.transactionId),
    unique('transaction_mcp_debits_ledger_unique').on(table.mcpLedgerEntryId),
    foreignKey({
      columns: [table.transactionId, table.marketId],
      foreignColumns: [transactions.id, transactions.marketId],
      name: 'transaction_mcp_debits_transaction_market_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.mcpAccountId, table.marketId],
      foreignColumns: [mcpAccounts.id, mcpAccounts.marketId],
      name: 'transaction_mcp_debits_account_market_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.mcpLedgerEntryId, table.mcpAccountId],
      foreignColumns: [mcpLedgerEntries.id, mcpLedgerEntries.mcpAccountId],
      name: 'transaction_mcp_debits_ledger_account_fk',
    }).onDelete('restrict'),
    check(
      'transaction_mcp_debits_value_check',
      sql`${table.amount} > 0 and ${table.balanceAfter} >= 0`,
    ),
  ],
);

export const transactionRewardLinks = pgTable(
  'transaction_reward_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'restrict' }),
    rewardSourceId: uuid('reward_source_id')
      .notNull()
      .references(() => rewardSources.id, { onDelete: 'restrict' }),
    rewardPlanId: uuid('reward_plan_id')
      .notNull()
      .references(() => rewardPlans.id, { onDelete: 'restrict' }),
    rewardRuleVersionId: uuid('reward_rule_version_id')
      .notNull()
      .references(() => rewardRuleVersions.id, { onDelete: 'restrict' }),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('transaction_reward_links_transaction_unique').on(
      table.transactionId,
    ),
    unique('transaction_reward_links_source_unique').on(table.rewardSourceId),
    unique('transaction_reward_links_plan_unique').on(table.rewardPlanId),
  ],
);

export const transactionIdempotencyRecords = pgTable(
  'transaction_idempotency_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantBranchId: uuid('merchant_branch_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    operation: transactionIdempotencyOperation('operation').notNull(),
    keyHash: text('key_hash').notNull(),
    requestHash: text('request_hash').notNull(),
    status: transactionIdempotencyStatus('status')
      .notNull()
      .default('IN_PROGRESS'),
    previewSessionId: uuid('preview_session_id').references(
      () => transactionPreviewSessions.id,
      { onDelete: 'restrict' },
    ),
    transactionId: uuid('transaction_id').references(() => transactions.id, {
      onDelete: 'restrict',
    }),
    response: jsonb('response'),
    statusCode: integer('status_code'),
    requestId: text('request_id'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('transaction_idempotency_records_key_unique').on(
      table.merchantBranchId,
      table.operation,
      table.keyHash,
    ),
    index('transaction_idempotency_records_preview_idx').on(
      table.previewSessionId,
    ),
    check(
      'transaction_idempotency_records_hash_check',
      sql`char_length(${table.keyHash}) = 64 and char_length(${table.requestHash}) = 64`,
    ),
    check(
      'transaction_idempotency_records_target_check',
      sql`(${table.operation} = 'PREVIEW' and ${table.transactionId} is null)
        or (${table.operation} = 'CONFIRM' and ${table.previewSessionId} is not null)`,
    ),
    check(
      'transaction_idempotency_records_response_check',
      sql`(${table.status} = 'IN_PROGRESS' and ${table.response} is null and ${table.statusCode} is null)
        or (${table.status} in ('COMPLETED', 'FAILED') and ${table.response} is not null and ${table.statusCode} between 200 and 599)`,
    ),
  ],
);

export const transactionAuditReferences = pgTable(
  'transaction_audit_references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: transactionAuditEventType('event_type').notNull(),
    auditLogId: uuid('audit_log_id')
      .notNull()
      .references(() => auditLogs.id, { onDelete: 'restrict' }),
    previewSessionId: uuid('preview_session_id')
      .notNull()
      .references(() => transactionPreviewSessions.id, {
        onDelete: 'restrict',
      }),
    transactionId: uuid('transaction_id').references(() => transactions.id, {
      onDelete: 'restrict',
    }),
    idempotencyRecordId: uuid('idempotency_record_id').references(
      () => transactionIdempotencyRecords.id,
      {
        onDelete: 'restrict',
      },
    ),
    previewCreatorAccountId: uuid('preview_creator_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    confirmerAccountId: uuid('confirmer_account_id').references(
      () => accounts.id,
      { onDelete: 'restrict' },
    ),
    merchantAccountId: uuid('merchant_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    staffAccountId: uuid('staff_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    protectedMemberReference: text('protected_member_reference').notNull(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    currency: text('currency').notNull(),
    purchaseAmount: numeric('purchase_amount', {
      precision: 38,
      scale: 10,
    }).notNull(),
    merchantPackageAssignmentId: uuid('merchant_package_assignment_id')
      .notNull()
      .references(() => merchantPackageAssignments.id, {
        onDelete: 'restrict',
      }),
    merchantPackageVersion: integer('merchant_package_version').notNull(),
    serviceFeeRate: numeric('service_fee_rate', {
      precision: 38,
      scale: 10,
    }).notNull(),
    rewardRuleVersionId: uuid('reward_rule_version_id')
      .notNull()
      .references(() => rewardRuleVersions.id, { onDelete: 'restrict' }),
    requestId: text('request_id'),
    clientChannel: text('client_channel').notNull(),
    previewedAt: utcTimestamp('previewed_at').notNull(),
    confirmedAt: utcTimestamp('confirmed_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('transaction_audit_references_audit_log_unique').on(
      table.auditLogId,
    ),
    index('transaction_audit_references_preview_idx').on(
      table.previewSessionId,
      table.createdAt,
    ),
    check(
      'transaction_audit_references_event_check',
      sql`(${table.eventType} = 'CONFIRMED' and ${table.transactionId} is not null and ${table.confirmerAccountId} is not null and ${table.confirmedAt} is not null)
        or (${table.eventType} <> 'CONFIRMED' and ${table.transactionId} is null and ${table.confirmerAccountId} is null and ${table.confirmedAt} is null)`,
    ),
    check(
      'transaction_audit_references_value_check',
      sql`${table.purchaseAmount} > 0 and ${table.merchantPackageVersion} > 0 and ${table.serviceFeeRate} > 0 and ${table.serviceFeeRate} <= 100
        and btrim(${table.protectedMemberReference}) <> '' and btrim(${table.clientChannel}) <> ''`,
    ),
  ],
);

export const correctionRequests = pgTable(
  'correction_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'restrict' }),
    merchantBranchId: uuid('merchant_branch_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    requestType: correctionRequestType('request_type').notNull(),
    status: correctionRequestStatus('status').notNull().default('REQUESTED'),
    reasonCode: text('reason_code').notNull(),
    reasonNote: text('reason_note'),
    requestedByAccountId: uuid('requested_by_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    keyHash: text('key_hash').notNull(),
    payloadHash: text('payload_hash').notNull(),
    response: jsonb('response').notNull(),
    executedAt: utcTimestamp('executed_at'),
    rejectedAt: utcTimestamp('rejected_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('correction_requests_transaction_type_unique').on(
      table.transactionId,
      table.requestType,
    ),
    unique('correction_requests_branch_type_key_unique').on(
      table.merchantBranchId,
      table.requestType,
      table.keyHash,
    ),
    uniqueIndex('correction_requests_active_transaction_unique')
      .on(table.transactionId)
      .where(sql`${table.status} = 'REQUESTED'`),
    index('correction_requests_branch_created_idx').on(
      table.merchantBranchId,
      table.createdAt,
    ),
    check(
      'correction_requests_reason_code_check',
      sql`btrim(${table.reasonCode}) <> '' and char_length(${table.reasonCode}) <= 64`,
    ),
    check(
      'correction_requests_reason_note_check',
      sql`${table.reasonNote} is null or char_length(${table.reasonNote}) <= 500`,
    ),
    check(
      'correction_requests_hash_check',
      sql`char_length(${table.keyHash}) = 64 and char_length(${table.payloadHash}) = 64`,
    ),
    check(
      'correction_requests_result_check',
      sql`(${table.status} = 'REQUESTED' and ${table.executedAt} is null and ${table.rejectedAt} is null)
        or (${table.status} = 'EXECUTED' and ${table.executedAt} is not null and ${table.rejectedAt} is null)
        or (${table.status} = 'REJECTED' and ${table.executedAt} is null and ${table.rejectedAt} is not null)`,
    ),
  ],
);

export const correctionExecutions = pgTable(
  'correction_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    correctionRequestId: uuid('correction_request_id')
      .notNull()
      .references(() => correctionRequests.id, { onDelete: 'restrict' }),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'restrict' }),
    executionKeyHash: text('execution_key_hash').notNull(),
    payloadHash: text('payload_hash').notNull(),
    mcpLedgerEntryId: uuid('mcp_ledger_entry_id')
      .notNull()
      .references(() => mcpLedgerEntries.id, { onDelete: 'restrict' }),
    walletLedgerEntryId: uuid('wallet_ledger_entry_id').references(
      () => memberWalletEntries.id,
      { onDelete: 'restrict' },
    ),
    rewardSourceId: uuid('reward_source_id')
      .notNull()
      .references(() => rewardSources.id, { onDelete: 'restrict' }),
    rewardPlanId: uuid('reward_plan_id')
      .notNull()
      .references(() => rewardPlans.id, { onDelete: 'restrict' }),
    response: jsonb('response').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('correction_executions_request_unique').on(
      table.correctionRequestId,
    ),
    unique('correction_executions_mcp_ledger_unique').on(
      table.mcpLedgerEntryId,
    ),
    uniqueIndex('correction_executions_wallet_ledger_unique')
      .on(table.walletLedgerEntryId)
      .where(sql`${table.walletLedgerEntryId} is not null`),
    check(
      'correction_executions_hash_check',
      sql`char_length(${table.executionKeyHash}) = 64 and char_length(${table.payloadHash}) = 64`,
    ),
  ],
);

// Phase 5: Agent & Commission Engine
export const agentActivations = pgTable(
  'agent_activation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    status: agentActivationStatus('status').notNull().default('NOT_APPLIED'),
    paymentReference: varchar('payment_reference', { length: 255 }),
    paymentConfirmedAt: utcTimestamp('payment_confirmed_at'),
    courseCompletedAt: utcTimestamp('course_completed_at'),
    courseEnrolledAt: utcTimestamp('course_enrolled_at'),
    courseReference: varchar('course_reference', { length: 255 }),
    courseConfirmedBy: uuid('course_confirmed_by'),
    approvedAt: utcTimestamp('approved_at'),
    activatedAt: utcTimestamp('activated_at'),
    activatedBy: uuid('activated_by'),
    market: varchar('market', { length: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('MYR'),
    rejectionReason: text('rejection_reason'),
    reactivationCount: integer('reactivation_count').notNull().default(0),
    revokedAt: utcTimestamp('revoked_at'),
    revokedBy: uuid('revoked_by'),
    revocationReason: text('revocation_reason'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('uq_agent_member_market').on(table.memberId, table.market),
    index('idx_activation_member_status').on(table.memberId, table.status),
    index('idx_activation_status').on(table.status),
    index('idx_activation_market').on(table.market),
    check('chk_agent_market', sql`${table.market} = upper(${table.market})`),
    check(
      'chk_agent_currency',
      sql`${table.currency} = upper(${table.currency})`,
    ),
    check('chk_agent_reactivation_count', sql`${table.reactivationCount} >= 0`),
  ],
);

export const agentActivationStatusLogs = pgTable(
  'agent_activation_status_log',
  {
    logId: uuid('log_id').primaryKey().defaultRandom(),
    activationId: uuid('activation_id')
      .notNull()
      .references(() => agentActivations.id, { onDelete: 'restrict' }),
    fromStatus: agentActivationStatus('from_status'),
    toStatus: agentActivationStatus('to_status').notNull(),
    changedBy: uuid('changed_by'),
    changedByType: varchar('changed_by_type', { length: 20 }).notNull(),
    reason: text('reason'),
    changedAt: utcTimestamp('changed_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_activation_log_activation').on(table.activationId),
    check(
      'chk_activation_log_changed_by_type',
      sql`${table.changedByType} in ('SYSTEM', 'ADMIN', 'AGENT')`,
    ),
  ],
);

export const referralRelationships = pgTable(
  'referral_relationship',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    refereeId: uuid('referee_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    referrerId: uuid('referrer_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('uq_referral_referee').on(table.refereeId),
    index('idx_referral_referrer').on(table.referrerId),
    check(
      'chk_no_self_referral',
      sql`${table.refereeId} <> ${table.referrerId}`,
    ),
  ],
);

export const commissionProcessing = pgTable(
  'commission_processing',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    canonicalProcessingKey: varchar('canonical_processing_key', {
      length: 255,
    }).notNull(),
    sourceType: varchar('source_type', { length: 30 }).notNull(),
    sourceReference: varchar('source_reference', { length: 255 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('IN_FLIGHT'),
    completionOutcome: varchar('completion_outcome', { length: 30 }),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    completedAt: utcTimestamp('completed_at'),
  },
  (table) => [
    unique('uq_processing_key').on(table.canonicalProcessingKey),
    index('idx_processing_key').on(table.canonicalProcessingKey),
    index('idx_processing_source').on(table.sourceType, table.sourceReference),
    check(
      'chk_processing_status',
      sql`${table.status} in ('IN_FLIGHT', 'COMPLETED', 'FAILED')`,
    ),
    check(
      'chk_processing_outcome',
      sql`${table.completionOutcome} is null or ${table.completionOutcome} in ('CREATED', 'SKIPPED_INELIGIBLE', 'SKIPPED_NO_BENEFICIARY', 'SKIPPED_ZERO_AMOUNT', 'FAILED')`,
    ),
    check(
      'chk_processing_request_hash',
      sql`char_length(${table.requestHash}) = 64`,
    ),
  ],
);

export const commissionRateVersions = pgTable(
  'commission_rate_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    commissionType: varchar('commission_type', { length: 30 }).notNull(),
    generation: integer('generation').notNull(),
    market: varchar('market', { length: 2 }).notNull(),
    rateValue: numeric('rate_value', { precision: 38, scale: 10 }).notNull(),
    rateType: varchar('rate_type', { length: 10 })
      .notNull()
      .default('PERCENTAGE'),
    effectiveFrom: utcTimestamp('effective_from').notNull(),
    effectiveUntil: utcTimestamp('effective_until'),
    createdBy: uuid('created_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_rate_effective').on(
      table.commissionType,
      table.generation,
      table.market,
      table.effectiveFrom,
    ),
    check(
      'chk_commission_type',
      sql`${table.commissionType} in ('AGENT_UPGRADE', 'MEMBER_CONSUMPTION', 'MERCHANT_RECRUITMENT')`,
    ),
    check('chk_rate_type', sql`${table.rateType} in ('PERCENTAGE', 'FIXED')`),
    check('chk_generation', sql`${table.generation} in (0, 1, 2)`),
    check('chk_rate_value', sql`${table.rateValue} >= 0`),
    check('chk_rate_market', sql`${table.market} = upper(${table.market})`),
    check(
      'chk_rate_effective_range',
      sql`${table.effectiveUntil} is null or ${table.effectiveUntil} > ${table.effectiveFrom}`,
    ),
    // EXCLUDE constraint using gist to prevent overlapping effective periods
    // Requires btree_gist extension
    sql`CONSTRAINT uq_rate_period EXCLUDE USING gist (
      commission_type WITH =,
      generation WITH =,
      market WITH =,
      tstzrange(effective_from, COALESCE(effective_until, 'infinity'::timestamptz), '[)') WITH &&
    )`,
  ],
);

export const commissionLedger = pgTable(
  'commission_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicReference: varchar('public_reference', { length: 30 }).notNull(),
    beneficiaryId: uuid('beneficiary_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    sourceType: varchar('source_type', { length: 30 }).notNull(),
    sourceReference: varchar('source_reference', { length: 255 }).notNull(),
    market: varchar('market', { length: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    amount: numeric('amount', { precision: 38, scale: 10 }).notNull(),
    rateVersionId: uuid('rate_version_id').references(
      () => commissionRateVersions.id,
      { onDelete: 'restrict' },
    ),
    rateSnapshot: jsonb('rate_snapshot'),
    calculationBasis: numeric('calculation_basis', {
      precision: 38,
      scale: 10,
    }),
    generation: integer('generation').notNull().default(0),
    entryType: varchar('entry_type', { length: 40 }).notNull(),
    postingStatus: varchar('posting_status', { length: 20 })
      .notNull()
      .default('EARNED'),
    canonicalEntryKey: varchar('canonical_entry_key', {
      length: 255,
    }).notNull(),
    processingId: uuid('processing_id').references(
      () => commissionProcessing.id,
      {
        onDelete: 'restrict',
      },
    ),
    effectiveTime: utcTimestamp('effective_time').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    reversalLinkage: uuid('reversal_linkage'),
    auditLinkage: varchar('audit_linkage', { length: 255 }),
    notes: text('notes'),
  },
  (table) => [
    unique('uq_ledger_entry_key').on(table.canonicalEntryKey),
    unique('uq_ledger_public_ref').on(table.publicReference),
    index('idx_ledger_beneficiary').on(table.beneficiaryId),
    index('idx_ledger_beneficiary_entry_type').on(
      table.beneficiaryId,
      table.entryType,
    ),
    index('idx_ledger_beneficiary_posting').on(
      table.beneficiaryId,
      table.postingStatus,
    ),
    index('idx_ledger_source').on(table.sourceType, table.sourceReference),
    index('idx_ledger_effective_time').on(table.effectiveTime),
    index('idx_ledger_reversal').on(table.reversalLinkage),
    index('idx_ledger_market').on(table.market),
    index('idx_ledger_entry_key').on(table.canonicalEntryKey),
    foreignKey({
      columns: [table.reversalLinkage],
      foreignColumns: [table.id],
      name: 'commission_ledger_reversal_linkage_fkey',
    }).onDelete('restrict'),
    check(
      'chk_entry_type',
      sql`${table.entryType} in ('AGENT_UPGRADE_G1_EARN', 'AGENT_UPGRADE_G2_EARN', 'MEMBER_CONSUMPTION_G1_EARN', 'MEMBER_CONSUMPTION_G2_EARN', 'MERCHANT_RECRUITMENT_EARN', 'REVERSAL_COMPENSATION', 'REFUND_COMPENSATION', 'ADMIN_ADJUSTMENT')`,
    ),
    check('chk_posting_status', sql`${table.postingStatus} = 'EARNED'`),
    check('chk_ledger_generation', sql`${table.generation} in (0, 1, 2)`),
  ],
);

export const commissionStatusEvents = pgTable(
  'commission_status_event',
  {
    eventId: uuid('event_id').primaryKey().defaultRandom(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => commissionLedger.id, { onDelete: 'restrict' }),
    fromStatus: varchar('from_status', { length: 20 }),
    toStatus: varchar('to_status', { length: 20 }).notNull(),
    changedBy: uuid('changed_by'),
    changedByType: varchar('changed_by_type', { length: 20 }).notNull(),
    reason: text('reason'),
    changedAt: utcTimestamp('changed_at').notNull().defaultNow(),
    eventSequence: bigint('event_sequence', { mode: 'bigint' }).notNull(),
  },
  (table) => [
    unique('uq_status_event_sequence').on(table.entryId, table.eventSequence),
    index('idx_status_event_entry_seq').on(
      table.entryId,
      table.eventSequence.desc(),
    ),
    check('chk_status_to', sql`${table.toStatus} = 'EARNED'`),
    check(
      'chk_status_from',
      sql`${table.fromStatus} is null or ${table.fromStatus} = 'EARNED'`,
    ),
    check(
      'chk_changed_by_type',
      sql`${table.changedByType} in ('SYSTEM', 'ADMIN', 'AGENT')`,
    ),
    check('chk_status_event_sequence', sql`${table.eventSequence} > 0`),
  ],
);

export const transactionCommissionDispatch = pgTable(
  'transaction_commission_dispatch',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'restrict' }),
    eventType: varchar('event_type', { length: 40 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    availableAt: utcTimestamp('available_at').notNull().defaultNow(),
    lockedAt: utcTimestamp('locked_at'),
    lockedBy: varchar('locked_by', { length: 64 }),
    lastError: text('last_error'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    completedAt: utcTimestamp('completed_at'),
  },
  (table) => [
    unique('uq_dispatch_event').on(table.transactionId, table.eventType),
    index('idx_dispatch_pending')
      .on(table.availableAt, table.status)
      .where(sql`${table.status} = 'PENDING'`),
    index('idx_dispatch_stale')
      .on(table.lockedAt, table.status)
      .where(sql`${table.status} = 'PROCESSING'`),
    check(
      'chk_dispatch_status',
      sql`${table.status} in ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')`,
    ),
    check(
      'chk_dispatch_attempts',
      sql`${table.attempts} >= 0 and ${table.attempts} <= ${table.maxAttempts}`,
    ),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_key',
  {
    key: varchar('key', { length: 255 }).primaryKey(),
    processingId: uuid('processing_id')
      .notNull()
      .references(() => commissionProcessing.id, { onDelete: 'restrict' }),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('IN_FLIGHT'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    completedAt: utcTimestamp('completed_at'),
  },
  (table) => [
    check(
      'chk_idempotency_status',
      sql`${table.status} in ('IN_FLIGHT', 'COMPLETED', 'FAILED')`,
    ),
    check(
      'chk_idempotency_request_hash',
      sql`char_length(${table.requestHash}) = 64`,
    ),
  ],
);

export const merchantAttributions = pgTable(
  'merchant_attribution',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantAccountId: uuid('merchant_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => merchantBranches.id, {
      onDelete: 'restrict',
    }),
    recruiterMemberId: uuid('recruiter_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    attributedEntityType: varchar('attributed_entity_type', { length: 20 })
      .notNull()
      .default('MERCHANT'),
    attributionSource: varchar('attribution_source', { length: 30 })
      .notNull()
      .default('REGISTRATION'),
    attributionScope: varchar('attribution_scope', { length: 30 })
      .notNull()
      .default('PERMANENT'),
    effectiveFrom: utcTimestamp('effective_from').notNull().defaultNow(),
    effectiveUntil: utcTimestamp('effective_until'),
    supersedesAttributionId: uuid('supersedes_attribution_id'),
    createdBy: uuid('created_by').notNull(),
    correctionLinkage: uuid('correction_linkage'),
    auditReference: varchar('audit_reference', { length: 255 }),
  },
  (table) => [
    uniqueIndex('uq_merchant_attribution_merchant')
      .on(table.merchantAccountId)
      .where(
        sql`${table.attributedEntityType} = 'MERCHANT' and ${table.branchId} is null`,
      ),
    uniqueIndex('uq_merchant_attribution_branch')
      .on(table.branchId)
      .where(
        sql`${table.attributedEntityType} = 'BRANCH' and ${table.branchId} is not null`,
      ),
    index('idx_attribution_merchant_account').on(table.merchantAccountId),
    foreignKey({
      columns: [table.supersedesAttributionId],
      foreignColumns: [table.id],
      name: 'merchant_attribution_supersedes_fkey',
    }).onDelete('restrict'),
    check(
      'chk_attribution_entity_type',
      sql`${table.attributedEntityType} in ('MERCHANT', 'BRANCH')`,
    ),
    check(
      'chk_attribution_source',
      sql`${table.attributionSource} in ('REGISTRATION', 'ADMIN_ASSIGNMENT')`,
    ),
    check(
      'chk_attribution_scope',
      sql`${table.attributionScope} = 'PERMANENT'`,
    ),
    check(
      'chk_attribution_entity_target',
      sql`(${table.attributedEntityType} = 'MERCHANT' and ${table.branchId} is null) or (${table.attributedEntityType} = 'BRANCH' and ${table.branchId} is not null)`,
    ),
    check(
      'chk_permanent_attribution',
      sql`${table.attributionScope} = 'PERMANENT' and ${table.effectiveUntil} is null`,
    ),
    check(
      'chk_attribution_deferred_fields',
      sql`${table.supersedesAttributionId} is null and ${table.correctionLinkage} is null`,
    ),
  ],
);

export const commissionProcessingResults = pgTable(
  'commission_processing_result',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    processingId: uuid('processing_id')
      .notNull()
      .references(() => commissionProcessing.id, { onDelete: 'restrict' }),
    beneficiaryId: uuid('beneficiary_id').references(() => members.id, {
      onDelete: 'restrict',
    }),
    generation: integer('generation').notNull().default(0),
    entryType: varchar('entry_type', { length: 40 }),
    unroundedAmount: numeric('unrounded_amount', { precision: 38, scale: 10 }),
    postedAmount: numeric('posted_amount', { precision: 38, scale: 10 }),
    residualAmount: numeric('residual_amount', { precision: 38, scale: 10 }),
    roundingMode: varchar('rounding_mode', { length: 10 })
      .notNull()
      .default('HALF_UP'),
    calculationScale: integer('calculation_scale').notNull().default(10),
    postingScale: integer('posting_scale').notNull().default(2),
    outcome: varchar('outcome', { length: 30 }).notNull(),
    reason: text('reason'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'chk_processing_result_outcome',
      sql`${table.outcome} in ('CREATED', 'SKIPPED_INELIGIBLE', 'SKIPPED_NO_BENEFICIARY', 'SKIPPED_ZERO_AMOUNT')`,
    ),
    check(
      'chk_skip_no_beneficiary',
      sql`(${table.outcome} = 'SKIPPED_NO_BENEFICIARY' and ${table.beneficiaryId} is null) or (${table.outcome} <> 'SKIPPED_NO_BENEFICIARY' and ${table.beneficiaryId} is not null)`,
    ),
    check('chk_result_generation', sql`${table.generation} in (0, 1, 2)`),
    check('chk_rounding_mode', sql`${table.roundingMode} = 'HALF_UP'`),
    check('chk_calculation_scale', sql`${table.calculationScale} = 10`),
    check('chk_posting_scale', sql`${table.postingScale} between 0 and 10`),
  ],
);

export const commissionAdjustmentRequests = pgTable(
  'commission_adjustment_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicReference: varchar('public_reference', { length: 30 }).notNull(),
    beneficiaryId: uuid('beneficiary_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 38, scale: 10 }).notNull(),
    market: varchar('market', { length: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    reason: text('reason').notNull(),
    auditReference: varchar('audit_reference', { length: 255 }),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PENDING_CHECKER'),
    makerId: uuid('maker_id').notNull(),
    checkerId: uuid('checker_id'),
    makerNotes: text('maker_notes'),
    checkerNotes: text('checker_notes'),
    ledgerEntryId: uuid('ledger_entry_id').references(
      () => commissionLedger.id,
      {
        onDelete: 'restrict',
      },
    ),
    decidedAt: utcTimestamp('decided_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('uq_adjustment_public_ref').on(table.publicReference),
    unique('uq_adjustment_ledger_entry').on(table.ledgerEntryId),
    index('idx_adjustment_beneficiary').on(table.beneficiaryId),
    index('idx_adjustment_status').on(table.status),
    index('idx_adjustment_maker').on(table.makerId),
    index('idx_adjustment_checker').on(table.checkerId),
    index('idx_adjustment_created').on(table.createdAt),
    check(
      'chk_adjustment_status',
      sql`${table.status} in ('PENDING_CHECKER', 'APPROVED', 'REJECTED')`,
    ),
    check('chk_adjustment_nonzero', sql`${table.amount} <> 0`),
    check(
      'chk_maker_checker_different',
      sql`${table.checkerId} is null or ${table.makerId} <> ${table.checkerId}`,
    ),
    check(
      'chk_decided_fields',
      sql`(${table.status} = 'PENDING_CHECKER' and ${table.checkerId} is null and ${table.decidedAt} is null and ${table.ledgerEntryId} is null) or (${table.status} = 'APPROVED' and ${table.checkerId} is not null and ${table.decidedAt} is not null and ${table.ledgerEntryId} is not null) or (${table.status} = 'REJECTED' and ${table.checkerId} is not null and ${table.decidedAt} is not null and ${table.ledgerEntryId} is null)`,
    ),
  ],
);

import {
  redemptionRateVersions,
  redemptionCatalogItems,
  redemptionQuotes,
  redemptionOrders,
  redemptionInventory,
  redemptionFulfilments,
  redemptionPickupLocations,
  redemptionWaitlistEntries,
  redemptionVoucherCodes,
  redemptionRefundRequests,
  redemptionShippingPayments,
  redemptionTermsAcceptances,
  redemptionAuditLog,
  redemptionCatalogStatus,
  redemptionItemType,
  redemptionOwnership,
  redemptionFulfilmentMode,
  redemptionInventoryMode,
  redemptionOrderStatus,
  redemptionQuoteStatus,
  redemptionWaitlistStatus,
  redemptionFulfilmentType,
  redemptionFulfilmentStatus,
  redemptionRefundRequestStatus,
  redemptionShippingPaymentStatus,
  redemptionRateType,
  redemptionExceptionSeverity,
  redemptionShippingPaymentRecoveryStatus,
  redemptionFulfilmentExceptions,
  redemptionFulfilmentAudit,
  redemptionShippingPaymentRecovery,
} from './redemption.js';

export {
  redemptionRateVersions,
  redemptionCatalogItems,
  redemptionQuotes,
  redemptionOrders,
  redemptionInventory,
  redemptionFulfilments,
  redemptionPickupLocations,
  redemptionWaitlistEntries,
  redemptionVoucherCodes,
  redemptionRefundRequests,
  redemptionShippingPayments,
  redemptionTermsAcceptances,
  redemptionAuditLog,
  redemptionFulfilmentExceptions,
  redemptionFulfilmentAudit,
  redemptionShippingPaymentRecovery,
  redemptionCatalogStatus,
  redemptionItemType,
  redemptionOwnership,
  redemptionFulfilmentMode,
  redemptionInventoryMode,
  redemptionOrderStatus,
  redemptionQuoteStatus,
  redemptionWaitlistStatus,
  redemptionFulfilmentType,
  redemptionFulfilmentStatus,
  redemptionRefundRequestStatus,
  redemptionShippingPaymentStatus,
  redemptionRateType,
  redemptionExceptionSeverity,
  redemptionShippingPaymentRecoveryStatus,
};

export const schema = {
  accounts,
  credentials,
  sessions,
  otps,
  authIdempotencyKeys,
  memberEmailOtps,
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
  members,
  memberProfiles,
  memberMarketPreferences,
  memberReferrals,
  memberReferralHistory,
  memberTermsAcceptances,
  memberQrIdentities,
  memberKycCases,
  memberKycIdempotencyKeys,
  memberKycDocuments,
  memberAccountCountryChangeRequests,
  memberStatusHistory,
  memberKycHistory,
  merchantGroups,
  merchantAccountAccess,
  merchantBranches,
  merchantProfiles,
  merchantCategories,
  merchantBranchCategories,
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
  merchantPackageChangeRequests,
  mcpAccounts,
  mcpLedgerEntries,
  mcpRechargeRequests,
  mcpRefundRequests,
  mcpAdjustmentRequests,
  mcpAdjustmentDecisions,
  memberWalletAccounts,
  memberWalletEntries,
  rewardRuleVersions,
  rewardPlans,
  rewardSources,
  dailyJobRuns,
  rewardDailyAccruals,
  marketTransactionSettings,
  transactionPreviewSessions,
  transactions,
  transactionServiceFees,
  transactionMcpDebits,
  transactionRewardLinks,
  transactionIdempotencyRecords,
  transactionAuditReferences,
  correctionRequests,
  correctionExecutions,
  agentActivations,
  agentActivationStatusLogs,
  referralRelationships,
  commissionProcessing,
  commissionRateVersions,
  commissionLedger,
  commissionStatusEvents,
  transactionCommissionDispatch,
  idempotencyKeys,
  merchantAttributions,
  commissionProcessingResults,
  commissionAdjustmentRequests,
  redemptionRateVersions,
  redemptionCatalogItems,
  redemptionQuotes,
  redemptionOrders,
  redemptionInventory,
  redemptionFulfilments,
  redemptionPickupLocations,
  redemptionWaitlistEntries,
  redemptionVoucherCodes,
  redemptionRefundRequests,
  redemptionShippingPayments,
  redemptionTermsAcceptances,
  redemptionAuditLog,
  redemptionFulfilmentExceptions,
  redemptionFulfilmentAudit,
  redemptionShippingPaymentRecovery,
};
