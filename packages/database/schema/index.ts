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
  pgTable,
  point,
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
    check(
      'reward_rule_versions_rate_check',
      sql`${table.rewardRate} >= 0`,
    ),
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
    check(
      'reward_plans_total_earned_check',
      sql`${table.totalEarned} >= 0`,
    ),
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
    unique('reward_sources_type_id_unique').on(table.sourceType, table.sourceId),
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
};
