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
  type AnyPgColumn,
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
export const sessionActorPurpose = pgEnum('session_actor_purpose', [
  'ACCOUNT',
  'ADMIN',
]);
export const adminMfaFactorStatus = pgEnum('admin_mfa_factor_status', [
  'UNVERIFIED',
  'ACTIVE',
  'DISABLED',
  'REVOKED',
]);
export const adminMfaChallengePurpose = pgEnum('admin_mfa_challenge_purpose', [
  'ENROLLMENT',
  'LOGIN',
  'RECOVERY',
  'STEP_UP',
]);
export const adminMfaChallengeStatus = pgEnum('admin_mfa_challenge_status', [
  'PENDING',
  'CONSUMED',
  'EXHAUSTED',
  'EXPIRED',
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

/** P8-S1 shared lifecycle for platform ads and published content. */
export const adsContentStatus = pgEnum('ads_content_status', [
  'DRAFT',
  'SCHEDULED',
  'ACTIVE',
  'PAUSED',
  'EXPIRED',
  'ARCHIVED',
]);

export const adPlacementStatus = pgEnum('ad_placement_status', [
  'ACTIVE',
  'INACTIVE',
  'ARCHIVED',
]);

export const adFeeConfigStatus = pgEnum('ad_fee_config_status', [
  'DRAFT',
  'SCHEDULED',
  'ACTIVE',
  'EXPIRED',
  'ARCHIVED',
]);

/** P8-S2 advanced financial reconciliation enums. */
export const reconciliationKind = pgEnum('reconciliation_kind', [
  'MCP',
  'IPOINT',
  'TRANSACTION_LEDGER',
  'COMMISSION',
  'REFUND',
  'REDEMPTION',
]);
export const reconciliationRunStatus = pgEnum('reconciliation_run_status', [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export const reconciliationExceptionStatus = pgEnum(
  'reconciliation_exception_status',
  ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CLOSED'],
);
export const reconciliationExceptionClassification = pgEnum(
  'reconciliation_exception_classification',
  [
    'AMOUNT_MISMATCH',
    'MISSING_EXPECTED',
    'UNEXPECTED_EXTRA',
    'REFERENCE_MISMATCH',
    'STATUS_MISMATCH',
    'LEDGER_INVARIANT_VIOLATION',
  ],
);
export const reconciliationItemStatus = pgEnum('reconciliation_item_status', [
  'MATCHED',
  'MISMATCHED',
  'MISSING',
  'UNEXPECTED',
]);

/** P8-S3 risk / fraud / operational controls enums. */
export const riskIndicatorCategory = pgEnum('risk_indicator_category', [
  'SUSPICIOUS_TRANSACTION',
  'DUPLICATE_REPLAY',
  'ABNORMAL_ADJUSTMENT',
  'RATE_CONFIG_ANOMALY',
  'CROSS_MARKET_VIOLATION',
  'ACCOUNT_ADMIN_ABUSE',
  'SECURITY_EVENT',
  'REVIEW_QUEUE',
]);
export const riskEventSeverity = pgEnum('risk_event_severity', [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);
export const riskRunStatus = pgEnum('risk_run_status', [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export const riskEventStatus = pgEnum('risk_event_status', ['FLAGGED']);
export const riskReviewStatus = pgEnum('risk_review_status', [
  'OPEN',
  'IN_REVIEW',
  'RESOLVED',
]);
export const riskReviewDecision = pgEnum('risk_review_decision', [
  'NO_ACTION',
  'WATCH',
  'ESCALATED',
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
  // P7-S7A D-046 conformance lifecycle values (P7-OD-03/10/11):
  // DRAFT -> SUBMITTED -> APPROVED | REJECTED -> EXECUTING -> EXECUTED | FAILED
  'SUBMITTED',
  'EXECUTING',
  'FAILED',
]);
export const ipointAdjustmentState = pgEnum('ipoint_adjustment_state', [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'EXECUTED',
  'FAILED',
]);
export const ipointAdjustmentDirection = pgEnum('ipoint_adjustment_direction', [
  'CREDIT',
  'DEBIT',
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
    actorPurpose: sessionActorPurpose('actor_purpose')
      .notNull()
      .default('ACCOUNT'),
    adminUserId: uuid('admin_user_id'),
    idleExpiresAt: utcTimestamp('idle_expires_at'),
    absoluteExpiresAt: utcTimestamp('absolute_expires_at'),
    familyCreatedAt: utcTimestamp('family_created_at'),
    familyMaxExpiresAt: utcTimestamp('family_max_expires_at'),
    mfaRecoveryUsed: boolean('mfa_recovery_used').notNull().default(false),
    currentAdminMarketId: uuid('current_admin_market_id').references(
      () => markets.id,
      { onDelete: 'restrict' },
    ),
    currentAdminMarketSelectedAt: utcTimestamp(
      'current_admin_market_selected_at',
    ),
    marketContextVersion: integer('market_context_version')
      .notNull()
      .default(1),
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
    check(
      'sessions_admin_policy_check',
      sql`(${table.actorPurpose} = 'ACCOUNT' and ${table.adminUserId} is null) or (${table.actorPurpose} = 'ADMIN' and ${table.adminUserId} is not null and ${table.idleExpiresAt} is not null and ${table.absoluteExpiresAt} is not null and ${table.familyCreatedAt} is not null and ${table.familyMaxExpiresAt} is not null and ${table.idleExpiresAt} <= ${table.absoluteExpiresAt} and ${table.absoluteExpiresAt} <= ${table.familyMaxExpiresAt})`,
    ),
    index('sessions_admin_active_idx')
      .on(table.adminUserId, table.absoluteExpiresAt)
      .where(
        sql`${table.actorPurpose} = 'ADMIN' and ${table.revokedAt} is null`,
      ),
    check(
      'sessions_admin_market_context_check',
      sql`(${table.currentAdminMarketId} is null and ${table.currentAdminMarketSelectedAt} is null) or (${table.currentAdminMarketId} is not null and ${table.currentAdminMarketSelectedAt} is not null)`,
    ),
    check(
      'sessions_market_context_version_check',
      sql`${table.marketContextVersion} > 0`,
    ),
    index('sessions_current_admin_market_idx').on(
      table.currentAdminMarketId,
      table.marketContextVersion,
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

export const adminMfaFactors = pgTable(
  'admin_mfa_factors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    factorType: text('factor_type').notNull().default('TOTP'),
    secretCiphertext: text('secret_ciphertext').notNull(),
    secretNonce: text('secret_nonce').notNull(),
    secretAuthTag: text('secret_auth_tag').notNull(),
    keyId: text('key_id').notNull(),
    algorithm: text('algorithm').notNull().default('AES-256-GCM'),
    status: adminMfaFactorStatus('status').notNull().default('UNVERIFIED'),
    lastAcceptedCounter: bigint('last_accepted_counter', { mode: 'number' }),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    failedWindowStartedAt: utcTimestamp('failed_window_started_at'),
    lockedUntil: utcTimestamp('locked_until'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    confirmedAt: utcTimestamp('confirmed_at'),
    disabledAt: utcTimestamp('disabled_at'),
    revokedAt: utcTimestamp('revoked_at'),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('admin_mfa_factors_active_unique')
      .on(table.adminUserId)
      .where(sql`${table.status} = 'ACTIVE'`),
    index('admin_mfa_factors_admin_status_idx').on(
      table.adminUserId,
      table.status,
    ),
    check('admin_mfa_factors_totp_check', sql`${table.factorType} = 'TOTP'`),
    check(
      'admin_mfa_factors_crypto_check',
      sql`${table.algorithm} = 'AES-256-GCM' and char_length(${table.secretCiphertext}) > 0 and char_length(${table.secretNonce}) > 0 and char_length(${table.secretAuthTag}) > 0 and char_length(${table.keyId}) > 0`,
    ),
    check(
      'admin_mfa_factors_attempts_check',
      sql`${table.failedAttempts} >= 0`,
    ),
    check(
      'admin_mfa_factors_counter_check',
      sql`${table.lastAcceptedCounter} is null or ${table.lastAcceptedCounter} >= 0`,
    ),
    check('admin_mfa_factors_version_check', sql`${table.version} > 0`),
  ],
);

export const adminMfaRecoveryCodes = pgTable(
  'admin_mfa_recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    factorId: uuid('factor_id')
      .notNull()
      .references(() => adminMfaFactors.id, { onDelete: 'restrict' }),
    codeHash: text('code_hash').notNull(),
    hashAlgorithm: text('hash_algorithm').notNull().default('scrypt'),
    hashVersion: integer('hash_version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    consumedAt: utcTimestamp('consumed_at'),
    revokedAt: utcTimestamp('revoked_at'),
  },
  (table) => [
    unique('admin_mfa_recovery_codes_unique').on(
      table.factorId,
      table.codeHash,
    ),
    index('admin_mfa_recovery_codes_available_idx')
      .on(table.factorId, table.createdAt)
      .where(sql`${table.consumedAt} is null and ${table.revokedAt} is null`),
    check(
      'admin_mfa_recovery_codes_hash_check',
      sql`char_length(${table.codeHash}) >= 64`,
    ),
    check(
      'admin_mfa_recovery_codes_state_check',
      sql`${table.consumedAt} is null or ${table.revokedAt} is null`,
    ),
  ],
);

export const adminMfaChallenges = pgTable(
  'admin_mfa_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    challengeHash: text('challenge_hash').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    factorId: uuid('factor_id').references(() => adminMfaFactors.id, {
      onDelete: 'restrict',
    }),
    sessionId: uuid('session_id').references(() => sessions.id, {
      onDelete: 'restrict',
    }),
    purpose: adminMfaChallengePurpose('purpose').notNull(),
    status: adminMfaChallengeStatus('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    requestHash: text('request_hash'),
    requestContext: jsonb('request_context').notNull().default({}),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    expiresAt: utcTimestamp('expires_at').notNull(),
    consumedAt: utcTimestamp('consumed_at'),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    unique('admin_mfa_challenges_hash_unique').on(table.challengeHash),
    index('admin_mfa_challenges_subject_idx').on(
      table.adminUserId,
      table.purpose,
      table.status,
      table.expiresAt,
    ),
    check(
      'admin_mfa_challenges_hash_check',
      sql`char_length(${table.challengeHash}) = 64`,
    ),
    check(
      'admin_mfa_challenges_attempts_check',
      sql`${table.attempts} >= 0 and ${table.attempts} <= ${table.maxAttempts}`,
    ),
    check(
      'admin_mfa_challenges_expiry_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check('admin_mfa_challenges_version_check', sql`${table.version} > 0`),
  ],
);

export const adminStepUpGrants = pgTable(
  'admin_step_up_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    grantHash: text('grant_hash').notNull(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'restrict' }),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    factorId: uuid('factor_id')
      .notNull()
      .references(() => adminMfaFactors.id, { onDelete: 'restrict' }),
    actionClass: text('action_class').notNull(),
    marketId: uuid('market_id').references(() => markets.id, {
      onDelete: 'restrict',
    }),
    targetHash: text('target_hash'),
    issuedAt: utcTimestamp('issued_at').notNull().defaultNow(),
    expiresAt: utcTimestamp('expires_at').notNull(),
    usedAt: utcTimestamp('used_at'),
    revokedAt: utcTimestamp('revoked_at'),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    unique('admin_step_up_grants_hash_unique').on(table.grantHash),
    index('admin_step_up_grants_session_idx')
      .on(table.sessionId, table.expiresAt)
      .where(sql`${table.usedAt} is null and ${table.revokedAt} is null`),
    check(
      'admin_step_up_grants_hash_check',
      sql`char_length(${table.grantHash}) = 64`,
    ),
    check(
      'admin_step_up_grants_expiry_check',
      sql`${table.expiresAt} > ${table.issuedAt} and ${table.expiresAt} <= ${table.issuedAt} + interval '10 minutes'`,
    ),
    check('admin_step_up_grants_version_check', sql`${table.version} > 0`),
  ],
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
    // D-051: durable mandatory operator reason (migration 0033). Legacy
    // rows keep NULL (never backfilled); new rows are enforced 1..500 by
    // the owner command and the DB CHECK.
    reason: text('reason'),
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
    // P7-S7A D-046 conformance columns (migration 0035). Nullable so legacy
    // rows keep their original freeform representation; the conformed owner
    // requires them for every NEW request.
    reasonCode: varchar('reason_code', { length: 100 }),
    caseReference: varchar('case_reference', { length: 200 }),
    attachmentReference: varchar('attachment_reference', { length: 500 }),
    checkerAdminUserId: uuid('checker_admin_user_id').references(
      () => adminUsers.id,
      { onDelete: 'restrict' },
    ),
    submittedAt: utcTimestamp('submitted_at'),
    executedAt: utcTimestamp('executed_at'),
    failedAt: utcTimestamp('failed_at'),
    idempotencyScope: varchar('idempotency_scope', { length: 200 }),
    priorRequestId: uuid('prior_request_id').references(
      (): AnyPgColumn => mcpAdjustmentRequests.id,
      { onDelete: 'restrict' },
    ),
  },
  (table) => [
    check('mcp_adjustment_amount_check', sql`${table.amount} > 0`),
    check(
      'mcp_adjustment_entry_type_check',
      sql`${table.entryType} in ('MANUAL_CREDIT', 'MANUAL_DEBIT')`,
    ),
    check('mcp_adjustment_version_check', sql`${table.version} > 0`),
    uniqueIndex('mcp_adjustment_idempotency_scope_key_unique')
      .on(table.idempotencyScope, table.idempotencyKey)
      .where(sql`${table.idempotencyScope} is not null`),
    check(
      'mcp_adjustment_reason_code_check',
      sql`${table.reasonCode} is null or (char_length(btrim(${table.reasonCode})) between 1 and 100)`,
    ),
    check(
      'mcp_adjustment_case_reference_check',
      sql`${table.caseReference} is null or (char_length(btrim(${table.caseReference})) between 1 and 200)`,
    ),
    check(
      'mcp_adjustment_attachment_reference_check',
      sql`${table.attachmentReference} is null or (char_length(btrim(${table.attachmentReference})) between 1 and 500)`,
    ),
    // Distinct server-derived Maker/Checker identities (P7-OD-10 runtime
    // inequality + hard database guarantee).
    check(
      'mcp_adjustment_checker_inequality',
      sql`${table.checkerAdminUserId} is null or ${table.checkerAdminUserId} <> ${table.makerAdminUserId}`,
    ),
  ],
);

export const mcpAdjustmentMarketRules = pgTable(
  'mcp_adjustment_market_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketCode: varchar('market_code', { length: 8 }).notNull(),
    softCap: numeric('soft_cap', { precision: 38, scale: 10 }).notNull(),
    hardCap: numeric('hard_cap', { precision: 38, scale: 10 }).notNull(),
    secureEvidenceAvailable: boolean('secure_evidence_available')
      .notNull()
      .default(false),
    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('mcp_adjustment_market_rules_market_unique').on(table.marketCode),
    check(
      'mcp_adjustment_market_rules_soft_cap_check',
      sql`${table.softCap} > 0`,
    ),
    check(
      'mcp_adjustment_market_rules_hard_cap_check',
      sql`${table.hardCap} >= ${table.softCap}`,
    ),
    check(
      'mcp_adjustment_market_rules_version_check',
      sql`${table.version} > 0`,
    ),
  ],
);

export const mcpAdjustmentReasonCodes = pgTable(
  'mcp_adjustment_reason_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketCode: varchar('market_code', { length: 8 }).notNull(),
    code: varchar('code', { length: 100 }).notNull(),
    label: varchar('label', { length: 200 }).notNull(),
    isHighRisk: boolean('is_high_risk').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('mcp_adjustment_reason_codes_market_code_unique').on(
      table.marketCode,
      table.code,
    ),
    check(
      'mcp_adjustment_reason_codes_code_check',
      sql`char_length(btrim(${table.code})) between 1 and 100`,
    ),
    check(
      'mcp_adjustment_reason_codes_label_check',
      sql`char_length(btrim(${table.label})) between 1 and 200`,
    ),
    check(
      'mcp_adjustment_reason_codes_version_check',
      sql`${table.version} > 0`,
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

export const ipointAdjustmentMarketRules = pgTable(
  'ipoint_adjustment_market_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketCode: varchar('market_code', { length: 8 }).notNull(),
    softCap: numeric('soft_cap', { precision: 38, scale: 10 }).notNull(),
    hardCap: numeric('hard_cap', { precision: 38, scale: 10 }).notNull(),
    secureEvidenceAvailable: boolean('secure_evidence_available')
      .notNull()
      .default(false),
    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('ipoint_adjustment_market_rules_market_unique').on(table.marketCode),
    check(
      'ipoint_adjustment_market_rules_soft_cap_check',
      sql`${table.softCap} > 0`,
    ),
    check(
      'ipoint_adjustment_market_rules_hard_cap_check',
      sql`${table.hardCap} >= ${table.softCap}`,
    ),
    check(
      'ipoint_adjustment_market_rules_version_check',
      sql`${table.version} > 0`,
    ),
  ],
);

export const ipointAdjustmentReasonCodes = pgTable(
  'ipoint_adjustment_reason_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketCode: varchar('market_code', { length: 8 }).notNull(),
    code: varchar('code', { length: 100 }).notNull(),
    label: varchar('label', { length: 200 }).notNull(),
    isHighRisk: boolean('is_high_risk').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('ipoint_adjustment_reason_codes_market_code_unique').on(
      table.marketCode,
      table.code,
    ),
    check(
      'ipoint_adjustment_reason_codes_code_check',
      sql`char_length(btrim(${table.code})) between 1 and 100`,
    ),
    check(
      'ipoint_adjustment_reason_codes_label_check',
      sql`char_length(btrim(${table.label})) between 1 and 200`,
    ),
    check(
      'ipoint_adjustment_reason_codes_version_check',
      sql`${table.version} > 0`,
    ),
  ],
);

export const ipointAdjustmentRequests = pgTable(
  'ipoint_adjustment_requests',
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
    direction: ipointAdjustmentDirection('direction').notNull(),
    amount: numeric('amount', { precision: 38, scale: 10 }).notNull(),
    state: ipointAdjustmentState('state').notNull().default('DRAFT'),
    reasonCode: varchar('reason_code', { length: 100 }).notNull(),
    explanation: text('explanation').notNull(),
    caseReference: varchar('case_reference', { length: 200 }).notNull(),
    attachmentReference: varchar('attachment_reference', { length: 500 }),
    makerAdminUserId: uuid('maker_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    checkerAdminUserId: uuid('checker_admin_user_id').references(
      () => adminUsers.id,
      { onDelete: 'restrict' },
    ),
    submittedAt: utcTimestamp('submitted_at'),
    executedAt: utcTimestamp('executed_at'),
    failedAt: utcTimestamp('failed_at'),
    idempotencyScope: varchar('idempotency_scope', { length: 200 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    priorRequestId: uuid('prior_request_id').references(
      (): AnyPgColumn => ipointAdjustmentRequests.id,
      { onDelete: 'restrict' },
    ),
    ledgerEntryId: uuid('ledger_entry_id').references(
      () => memberWalletEntries.id,
      { onDelete: 'restrict' },
    ),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('ipoint_adjustment_requests_idempotency_unique').on(
      table.idempotencyScope,
      table.idempotencyKey,
    ),
    check('ipoint_adjustment_requests_amount_check', sql`${table.amount} > 0`),
    check(
      'ipoint_adjustment_requests_version_check',
      sql`${table.version} > 0`,
    ),
    check(
      'ipoint_adjustment_requests_reason_code_check',
      sql`char_length(btrim(${table.reasonCode})) between 1 and 100`,
    ),
    check(
      'ipoint_adjustment_requests_explanation_check',
      sql`char_length(btrim(${table.explanation})) between 1 and 2000`,
    ),
    check(
      'ipoint_adjustment_requests_case_reference_check',
      sql`char_length(btrim(${table.caseReference})) between 1 and 200`,
    ),
    check(
      'ipoint_adjustment_requests_attachment_reference_check',
      sql`${table.attachmentReference} is null or (char_length(btrim(${table.attachmentReference})) between 1 and 500)`,
    ),
    check(
      'ipoint_adjustment_requests_checker_inequality',
      sql`${table.checkerAdminUserId} is null or ${table.checkerAdminUserId} <> ${table.makerAdminUserId}`,
    ),
    check(
      'ipoint_adjustment_requests_payload_hash_check',
      sql`char_length(${table.payloadHash}) = 64`,
    ),
    check(
      'ipoint_adjustment_requests_request_hash_check',
      sql`char_length(${table.requestHash}) = 64`,
    ),
    index('ipoint_adjustment_requests_state_market_idx').on(
      table.state,
      table.marketId,
    ),
    index('ipoint_adjustment_requests_wallet_idx').on(table.walletAccountId),
  ],
);

export const ipointAdjustmentDecisions = pgTable(
  'ipoint_adjustment_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adjustmentRequestId: uuid('adjustment_request_id')
      .notNull()
      .references(() => ipointAdjustmentRequests.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    checkerAdminUserId: uuid('checker_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    decision: varchar('decision', { length: 20 }).notNull(),
    reason: text('reason').notNull(),
    decidedAt: utcTimestamp('decided_at').notNull().defaultNow(),
  },
  (table) => [
    unique('ipoint_adjustment_decisions_request_unique').on(
      table.adjustmentRequestId,
    ),
    check(
      'ipoint_adjustment_decisions_value_check',
      sql`${table.decision} in ('APPROVED', 'REJECTED')`,
    ),
    check(
      'ipoint_adjustment_decisions_reason_check',
      sql`char_length(btrim(${table.reason})) between 1 and 2000`,
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
    reason: text('reason'),
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
    check(
      'chk_reward_rule_versions_reason',
      sql`${table.reason} is null or (char_length(btrim(${table.reason})) between 1 and 500)`,
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
    feeRateVersionId: uuid('fee_rate_version_id').references(
      () => commissionRateVersions.id,
      { onDelete: 'restrict' },
    ),
    activationFee: numeric('activation_fee', { precision: 38, scale: 10 }),
    activationFeeCurrency: varchar('activation_fee_currency', { length: 3 })
      .notNull()
      .default('MYR'),
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
    check(
      'chk_agent_fee_currency',
      sql`${table.activationFeeCurrency} = upper(${table.activationFeeCurrency})`,
    ),
    check(
      'chk_agent_fee_pair',
      sql`(${table.feeRateVersionId} is null and ${table.activationFee} is null) or (${table.feeRateVersionId} is not null and ${table.activationFee} is not null)`,
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
    reason: text('reason'),
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
      sql`${table.commissionType} in ('AGENT_UPGRADE', 'MEMBER_CONSUMPTION', 'MERCHANT_RECRUITMENT', 'AGENT_ACTIVATION_FEE')`,
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

// ─── Phase 8: Ads & Content Operations ───────────────────────────────

export const adPlacements = pgTable(
  'ad_placements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    code: varchar('code', { length: 80 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    description: text('description'),
    position: integer('position').notNull().default(0),
    status: adPlacementStatus('status').notNull().default('ACTIVE'),
    createdByAdminUserId: uuid('created_by_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    updatedByAdminUserId: uuid('updated_by_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [
    unique('ad_placements_market_code_unique').on(table.marketId, table.code),
    unique('ad_placements_id_market_unique').on(table.id, table.marketId),
    index('ad_placements_market_status_position_idx').on(
      table.marketId,
      table.status,
      table.position,
    ),
    check(
      'ad_placements_code_check',
      sql`char_length(btrim(${table.code})) between 1 and 80`,
    ),
    check(
      'ad_placements_name_check',
      sql`char_length(btrim(${table.name})) between 1 and 160`,
    ),
    check('ad_placements_position_check', sql`${table.position} >= 0`),
    check('ad_placements_version_check', sql`${table.version} > 0`),
    check(
      'ad_placements_archive_check',
      sql`(${table.status} = 'ARCHIVED' and ${table.archivedAt} is not null) or (${table.status} <> 'ARCHIVED' and ${table.archivedAt} is null)`,
    ),
  ],
);

/**
 * C-11 configurable advertisement MCP fee structure. P8-S1 intentionally
 * seeds no commercial values and exposes no debit command until an approved
 * pricing model and a callable frozen MCP-owner extension are available.
 */
export const adFeeConfigs = pgTable(
  'ad_fee_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    amount: numeric('amount', { precision: 38, scale: 10 }).notNull(),
    currencyCode: varchar('currency_code', { length: 3 }).notNull(),
    effectiveFrom: utcTimestamp('effective_from').notNull(),
    effectiveTo: utcTimestamp('effective_to'),
    status: adFeeConfigStatus('status').notNull().default('DRAFT'),
    reason: text('reason').notNull(),
    createdByAdminUserId: uuid('created_by_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [
    unique('ad_fee_configs_market_version_unique').on(
      table.marketId,
      table.version,
    ),
    unique('ad_fee_configs_id_market_unique').on(table.id, table.marketId),
    index('ad_fee_configs_market_status_effective_idx').on(
      table.marketId,
      table.status,
      table.effectiveFrom,
    ),
    check('ad_fee_configs_version_check', sql`${table.version} > 0`),
    check('ad_fee_configs_amount_check', sql`${table.amount} > 0`),
    check(
      'ad_fee_configs_currency_check',
      sql`${table.currencyCode} ~ '^[A-Z]{3}$'`,
    ),
    check(
      'ad_fee_configs_reason_check',
      sql`char_length(btrim(${table.reason})) between 1 and 500`,
    ),
    check(
      'ad_fee_configs_window_check',
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
    check(
      'ad_fee_configs_archive_check',
      sql`(${table.status} = 'ARCHIVED' and ${table.archivedAt} is not null) or (${table.status} <> 'ARCHIVED' and ${table.archivedAt} is null)`,
    ),
  ],
);

export const ads = pgTable(
  'ads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicId: uuid('public_id').notNull().defaultRandom(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    placementId: uuid('placement_id').notNull(),
    feeConfigId: uuid('fee_config_id'),
    title: varchar('title', { length: 180 }).notNull(),
    summary: text('summary'),
    creativeMediaUrl: text('creative_media_url').notNull(),
    creativeAltText: varchar('creative_alt_text', { length: 240 }).notNull(),
    targetUrl: text('target_url'),
    isSponsored: boolean('is_sponsored').notNull().default(true),
    sponsorLabel: varchar('sponsor_label', { length: 80 }).notNull(),
    status: adsContentStatus('status').notNull().default('DRAFT'),
    scheduleStartAt: utcTimestamp('schedule_start_at'),
    scheduleEndAt: utcTimestamp('schedule_end_at'),
    createdByAdminUserId: uuid('created_by_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    updatedByAdminUserId: uuid('updated_by_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [
    unique('ads_public_id_unique').on(table.publicId),
    unique('ads_id_market_unique').on(table.id, table.marketId),
    foreignKey({
      columns: [table.placementId, table.marketId],
      foreignColumns: [adPlacements.id, adPlacements.marketId],
      name: 'ads_placement_market_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.feeConfigId, table.marketId],
      foreignColumns: [adFeeConfigs.id, adFeeConfigs.marketId],
      name: 'ads_fee_config_market_fk',
    }).onDelete('restrict'),
    index('ads_market_status_schedule_idx').on(
      table.marketId,
      table.status,
      table.scheduleStartAt,
      table.scheduleEndAt,
    ),
    index('ads_placement_status_idx').on(table.placementId, table.status),
    check(
      'ads_title_check',
      sql`char_length(btrim(${table.title})) between 1 and 180`,
    ),
    check(
      'ads_creative_url_check',
      sql`char_length(btrim(${table.creativeMediaUrl})) between 1 and 2000`,
    ),
    check(
      'ads_alt_text_check',
      sql`char_length(btrim(${table.creativeAltText})) between 1 and 240`,
    ),
    check(
      'ads_sponsor_label_check',
      sql`char_length(btrim(${table.sponsorLabel})) between 1 and 80`,
    ),
    check('ads_sponsored_check', sql`${table.isSponsored} = true`),
    check('ads_version_check', sql`${table.version} > 0`),
    check(
      'ads_schedule_window_check',
      sql`${table.scheduleEndAt} is null or (${table.scheduleStartAt} is not null and ${table.scheduleEndAt} > ${table.scheduleStartAt})`,
    ),
    check(
      'ads_archive_check',
      sql`(${table.status} = 'ARCHIVED' and ${table.archivedAt} is not null) or (${table.status} <> 'ARCHIVED' and ${table.archivedAt} is null)`,
    ),
  ],
);

export const contentArticles = pgTable(
  'content_articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicId: uuid('public_id').notNull().defaultRandom(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    slug: varchar('slug', { length: 160 }).notNull(),
    title: varchar('title', { length: 180 }).notNull(),
    excerpt: text('excerpt').notNull(),
    body: text('body').notNull(),
    coverMediaUrl: text('cover_media_url'),
    coverAltText: varchar('cover_alt_text', { length: 240 }),
    isPromoted: boolean('is_promoted').notNull().default(false),
    sponsorLabel: varchar('sponsor_label', { length: 80 }),
    status: adsContentStatus('status').notNull().default('DRAFT'),
    publishAt: utcTimestamp('publish_at'),
    unpublishAt: utcTimestamp('unpublish_at'),
    authorAdminUserId: uuid('author_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    updatedByAdminUserId: uuid('updated_by_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [
    unique('content_articles_public_id_unique').on(table.publicId),
    unique('content_articles_market_slug_unique').on(
      table.marketId,
      table.slug,
    ),
    unique('content_articles_id_market_unique').on(table.id, table.marketId),
    index('content_articles_market_status_schedule_idx').on(
      table.marketId,
      table.status,
      table.publishAt,
      table.unpublishAt,
    ),
    check(
      'content_articles_slug_check',
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check(
      'content_articles_title_check',
      sql`char_length(btrim(${table.title})) between 1 and 180`,
    ),
    check(
      'content_articles_excerpt_check',
      sql`char_length(btrim(${table.excerpt})) between 1 and 500`,
    ),
    check(
      'content_articles_body_check',
      sql`char_length(btrim(${table.body})) between 1 and 50000`,
    ),
    check('content_articles_version_check', sql`${table.version} > 0`),
    check(
      'content_articles_promoted_label_check',
      sql`(${table.isPromoted} = false) or char_length(btrim(${table.sponsorLabel})) between 1 and 80`,
    ),
    check(
      'content_articles_schedule_window_check',
      sql`${table.unpublishAt} is null or (${table.publishAt} is not null and ${table.unpublishAt} > ${table.publishAt})`,
    ),
    check(
      'content_articles_archive_check',
      sql`(${table.status} = 'ARCHIVED' and ${table.archivedAt} is not null) or (${table.status} <> 'ARCHIVED' and ${table.archivedAt} is null)`,
    ),
  ],
);

export const adsContentIdempotencyKeys = pgTable(
  'ads_content_idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    operation: varchar('operation', { length: 80 }).notNull(),
    key: varchar('key', { length: 200 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    response: jsonb('response'),
    statusCode: integer('status_code'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('ads_content_idempotency_scope_unique').on(
      table.adminUserId,
      table.marketId,
      table.operation,
      table.key,
    ),
    check(
      'ads_content_idempotency_hash_check',
      sql`char_length(${table.requestHash}) = 64`,
    ),
    check(
      'ads_content_idempotency_result_check',
      sql`(${table.response} is null and ${table.statusCode} is null) or (${table.response} is not null and ${table.statusCode} between 200 and 599)`,
    ),
  ],
);

/**
 * P8-S2 Advanced Financial Reconciliation. Detection + review + traceability
 * only: these tables are the reconciliation domain's own record. Frozen
 * ledgers/balances/orders are read, never written, by this domain.
 */
export const reconciliationRuns = pgTable(
  'reconciliation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicId: uuid('public_id').notNull().defaultRandom(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    kind: reconciliationKind('kind').notNull(),
    status: reconciliationRunStatus('status').notNull().default('PENDING'),
    windowStartAt: utcTimestamp('window_start_at').notNull(),
    windowEndAt: utcTimestamp('window_end_at').notNull(),
    expectedTotal: numeric('expected_total', {
      precision: 38,
      scale: 10,
    }),
    actualTotal: numeric('actual_total', { precision: 38, scale: 10 }),
    differenceTotal: numeric('difference_total', {
      precision: 38,
      scale: 10,
    }),
    matchedCount: integer('matched_count'),
    mismatchedCount: integer('mismatched_count'),
    exceptionCount: integer('exception_count'),
    summary: jsonb('summary'),
    failureReason: text('failure_reason'),
    startedAt: utcTimestamp('started_at'),
    completedAt: utcTimestamp('completed_at'),
    failedAt: utcTimestamp('failed_at'),
    cancelledAt: utcTimestamp('cancelled_at'),
    runByAdminUserId: uuid('run_by_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [
    unique('reconciliation_runs_public_id_unique').on(table.publicId),
    unique('reconciliation_runs_id_market_unique').on(table.id, table.marketId),
    check(
      'reconciliation_runs_window_check',
      sql`${table.windowEndAt} > ${table.windowStartAt}`,
    ),
    check('reconciliation_runs_version_check', sql`${table.version} > 0`),
    check(
      'reconciliation_runs_totals_check',
      sql`(${table.status} = 'COMPLETED' and ${table.expectedTotal} is not null and ${table.actualTotal} is not null and ${table.differenceTotal} is not null and ${table.matchedCount} is not null and ${table.mismatchedCount} is not null and ${table.exceptionCount} is not null) or (${table.status} <> 'COMPLETED')`,
    ),
    check(
      'reconciliation_runs_timestamps_check',
      sql`(${table.status} = 'PENDING' and ${table.startedAt} is null and ${table.completedAt} is null and ${table.failedAt} is null and ${table.cancelledAt} is null) or (${table.status} = 'RUNNING' and ${table.startedAt} is not null and ${table.completedAt} is null and ${table.failedAt} is null and ${table.cancelledAt} is null) or (${table.status} = 'COMPLETED' and ${table.startedAt} is not null and ${table.completedAt} is not null and ${table.failedAt} is null and ${table.cancelledAt} is null) or (${table.status} = 'FAILED' and ${table.startedAt} is not null and ${table.failedAt} is not null and ${table.completedAt} is null and ${table.cancelledAt} is null) or (${table.status} = 'CANCELLED' and ${table.cancelledAt} is not null and ${table.completedAt} is null and ${table.failedAt} is null)`,
    ),
    check(
      'reconciliation_runs_failure_reason_check',
      sql`(${table.status} = 'FAILED' and char_length(btrim(coalesce(${table.failureReason}, ''))) between 1 and 2000) or (${table.status} <> 'FAILED')`,
    ),
    check(
      'reconciliation_runs_archive_check',
      sql`${table.archivedAt} is null or ${table.archivedAt} >= ${table.createdAt}`,
    ),
    index('reconciliation_runs_market_kind_status_idx').on(
      table.marketId,
      table.kind,
      table.status,
      table.createdAt,
    ),
    index('reconciliation_runs_market_window_idx').on(
      table.marketId,
      table.windowStartAt,
      table.windowEndAt,
    ),
  ],
);

export const reconciliationRunItems = pgTable(
  'reconciliation_run_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').notNull(),
    marketId: uuid('market_id').notNull(),
    referenceType: varchar('reference_type', { length: 40 }).notNull(),
    referenceId: text('reference_id').notNull(),
    status: reconciliationItemStatus('status').notNull(),
    expectedAmount: numeric('expected_amount', {
      precision: 38,
      scale: 10,
    }).notNull(),
    actualAmount: numeric('actual_amount', {
      precision: 38,
      scale: 10,
    }).notNull(),
    differenceAmount: numeric('difference_amount', {
      precision: 38,
      scale: 10,
    }).notNull(),
    evidence: jsonb('evidence').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('reconciliation_run_items_id_market_unique').on(
      table.id,
      table.marketId,
    ),
    foreignKey({
      columns: [table.runId, table.marketId],
      foreignColumns: [reconciliationRuns.id, reconciliationRuns.marketId],
      name: 'reconciliation_run_items_run_market_fk',
    }).onDelete('restrict'),
    unique('reconciliation_run_items_reference_unique').on(
      table.runId,
      table.marketId,
      table.referenceType,
      table.referenceId,
    ),
    check(
      'reconciliation_run_items_ref_type_check',
      sql`char_length(btrim(${table.referenceType})) between 1 and 40`,
    ),
    check(
      'reconciliation_run_items_ref_id_check',
      sql`char_length(btrim(${table.referenceId})) between 1 and 120`,
    ),
    check(
      'reconciliation_run_items_evidence_check',
      sql`jsonb_typeof(${table.evidence}) = 'object'`,
    ),
    index('reconciliation_run_items_run_status_idx').on(
      table.runId,
      table.status,
      table.createdAt,
    ),
  ],
);

export const reconciliationExceptions = pgTable(
  'reconciliation_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').notNull(),
    marketId: uuid('market_id').notNull(),
    kind: reconciliationKind('kind').notNull(),
    referenceType: varchar('reference_type', { length: 40 }).notNull(),
    referenceId: text('reference_id').notNull(),
    expectedAmount: numeric('expected_amount', {
      precision: 38,
      scale: 10,
    }).notNull(),
    actualAmount: numeric('actual_amount', {
      precision: 38,
      scale: 10,
    }).notNull(),
    differenceAmount: numeric('difference_amount', {
      precision: 38,
      scale: 10,
    }).notNull(),
    classification:
      reconciliationExceptionClassification('classification').notNull(),
    status: reconciliationExceptionStatus('status').notNull().default('OPEN'),
    investigationNotes: text('investigation_notes'),
    acknowledgedByAdminUserId: uuid('acknowledged_by_admin_user_id').references(
      () => adminUsers.id,
      { onDelete: 'restrict' },
    ),
    acknowledgedAt: utcTimestamp('acknowledged_at'),
    resolvedByAdminUserId: uuid('resolved_by_admin_user_id').references(
      () => adminUsers.id,
      { onDelete: 'restrict' },
    ),
    resolvedAt: utcTimestamp('resolved_at'),
    closedByAdminUserId: uuid('closed_by_admin_user_id').references(
      () => adminUsers.id,
      { onDelete: 'restrict' },
    ),
    closedAt: utcTimestamp('closed_at'),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [
    unique('reconciliation_exceptions_id_market_unique').on(
      table.id,
      table.marketId,
    ),
    foreignKey({
      columns: [table.runId, table.marketId],
      foreignColumns: [reconciliationRuns.id, reconciliationRuns.marketId],
      name: 'reconciliation_exceptions_run_market_fk',
    }).onDelete('restrict'),
    unique('reconciliation_exceptions_run_reference_unique').on(
      table.runId,
      table.marketId,
      table.referenceType,
      table.referenceId,
    ),
    check(
      'reconciliation_exceptions_ref_type_check',
      sql`char_length(btrim(${table.referenceType})) between 1 and 40`,
    ),
    check(
      'reconciliation_exceptions_ref_id_check',
      sql`char_length(btrim(${table.referenceId})) between 1 and 120`,
    ),
    check('reconciliation_exceptions_version_check', sql`${table.version} > 0`),
    check(
      'reconciliation_exceptions_notes_check',
      sql`${table.investigationNotes} is null or char_length(${table.investigationNotes}) between 1 and 10000`,
    ),
    check(
      'reconciliation_exceptions_timestamps_check',
      sql`(${table.status} = 'OPEN' and ${table.acknowledgedByAdminUserId} is null and ${table.acknowledgedAt} is null and ${table.resolvedByAdminUserId} is null and ${table.resolvedAt} is null and ${table.closedByAdminUserId} is null and ${table.closedAt} is null) or (${table.status} = 'ACKNOWLEDGED' and ${table.acknowledgedByAdminUserId} is not null and ${table.acknowledgedAt} is not null and ${table.resolvedByAdminUserId} is null and ${table.resolvedAt} is null and ${table.closedByAdminUserId} is null and ${table.closedAt} is null) or (${table.status} = 'RESOLVED' and ${table.acknowledgedByAdminUserId} is not null and ${table.acknowledgedAt} is not null and ${table.resolvedByAdminUserId} is not null and ${table.resolvedAt} is not null and ${table.closedByAdminUserId} is null and ${table.closedAt} is null) or (${table.status} = 'CLOSED' and ${table.acknowledgedByAdminUserId} is not null and ${table.acknowledgedAt} is not null and ${table.resolvedByAdminUserId} is not null and ${table.resolvedAt} is not null and ${table.closedByAdminUserId} is not null and ${table.closedAt} is not null)`,
    ),
    check(
      'reconciliation_exceptions_archive_check',
      sql`${table.archivedAt} is null or ${table.archivedAt} >= ${table.createdAt}`,
    ),
    index('reconciliation_exceptions_market_status_idx').on(
      table.marketId,
      table.status,
      table.createdAt,
    ),
    index('reconciliation_exceptions_run_idx').on(table.runId, table.createdAt),
  ],
);

export const reconciliationIdempotencyKeys = pgTable(
  'reconciliation_idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    operation: varchar('operation', { length: 80 }).notNull(),
    key: varchar('key', { length: 200 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    response: jsonb('response'),
    statusCode: integer('status_code'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('reconciliation_idempotency_scope_unique').on(
      table.adminUserId,
      table.marketId,
      table.operation,
      table.key,
    ),
    check(
      'reconciliation_idempotency_hash_check',
      sql`char_length(${table.requestHash}) = 64`,
    ),
    check(
      'reconciliation_idempotency_result_check',
      sql`(${table.response} is null and ${table.statusCode} is null) or (${table.response} is not null and ${table.statusCode} between 200 and 599)`,
    ),
  ],
);

/**
 * P8-S3 Risk / Fraud / Operational Controls. DETECTION + REVIEW +
 * TRACEABILITY only: detectors are read-only queries over frozen financial /
 * audit / security tables and never write to them. No enforcement
 * side-effects (no freeze/block/debit/disable), no invented thresholds
 * (operator-configurable definition config), E-30 reject-delete everywhere.
 */
export const riskIndicatorDefinitions = pgTable(
  'risk_indicator_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 100 }).notNull(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    category: riskIndicatorCategory('category').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    enabled: boolean('enabled').notNull().default(true),
    config: jsonb('config').notNull().default({}),
    severity: riskEventSeverity('severity').notNull().default('MEDIUM'),
    version: integer('version').notNull().default(1),
    supersededById: uuid('superseded_by_id').references(
      (): AnyPgColumn => riskIndicatorDefinitions.id,
      { onDelete: 'restrict' },
    ),
    supersededAt: utcTimestamp('superseded_at'),
    createdByAdminUserId: uuid('created_by_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [
    unique('risk_indicator_definitions_id_market_unique').on(
      table.id,
      table.marketId,
    ),
    unique('risk_indicator_definitions_code_version_unique').on(
      table.marketId,
      table.code,
      table.version,
    ),
    check(
      'risk_indicator_definitions_code_check',
      sql`char_length(btrim(${table.code})) between 1 and 100`,
    ),
    check(
      'risk_indicator_definitions_name_check',
      sql`char_length(btrim(${table.name})) between 1 and 200`,
    ),
    check(
      'risk_indicator_definitions_description_check',
      sql`${table.description} is null or char_length(${table.description}) between 1 and 2000`,
    ),
    check(
      'risk_indicator_definitions_config_check',
      sql`jsonb_typeof(${table.config}) = 'object'`,
    ),
    check(
      'risk_indicator_definitions_version_check',
      sql`${table.version} > 0`,
    ),
    check(
      'risk_indicator_definitions_supersede_consistency',
      sql`(${table.supersededById} is null and ${table.supersededAt} is null) or (${table.supersededById} is not null and ${table.supersededAt} is not null and ${table.supersededById} <> ${table.id})`,
    ),
    check(
      'risk_indicator_definitions_archive_check',
      sql`${table.archivedAt} is null or ${table.archivedAt} >= ${table.createdAt}`,
    ),
    index('risk_indicator_definitions_market_category_idx').on(
      table.marketId,
      table.category,
      table.enabled,
      table.version,
    ),
    index('risk_indicator_definitions_code_idx').on(
      table.marketId,
      table.code,
      table.version,
    ),
  ],
);

export const riskDetectionRuns = pgTable(
  'risk_detection_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicId: uuid('public_id').notNull().defaultRandom(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    category: riskIndicatorCategory('category').notNull(),
    status: riskRunStatus('status').notNull().default('PENDING'),
    windowStartAt: utcTimestamp('window_start_at').notNull(),
    windowEndAt: utcTimestamp('window_end_at').notNull(),
    definitionsScanned: integer('definitions_scanned'),
    eventsDetected: integer('events_detected'),
    summary: jsonb('summary'),
    failureReason: text('failure_reason'),
    startedAt: utcTimestamp('started_at'),
    completedAt: utcTimestamp('completed_at'),
    failedAt: utcTimestamp('failed_at'),
    cancelledAt: utcTimestamp('cancelled_at'),
    runByAdminUserId: uuid('run_by_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [
    unique('risk_detection_runs_public_id_unique').on(table.publicId),
    unique('risk_detection_runs_id_market_unique').on(table.id, table.marketId),
    check(
      'risk_detection_runs_window_check',
      sql`${table.windowEndAt} > ${table.windowStartAt}`,
    ),
    check('risk_detection_runs_version_check', sql`${table.version} > 0`),
    check(
      'risk_detection_runs_totals_check',
      sql`(${table.status} = 'COMPLETED' and ${table.definitionsScanned} is not null and ${table.eventsDetected} is not null) or (${table.status} <> 'COMPLETED')`,
    ),
    check(
      'risk_detection_runs_timestamps_check',
      sql`(${table.status} = 'PENDING' and ${table.startedAt} is null and ${table.completedAt} is null and ${table.failedAt} is null and ${table.cancelledAt} is null) or (${table.status} = 'RUNNING' and ${table.startedAt} is not null and ${table.completedAt} is null and ${table.failedAt} is null and ${table.cancelledAt} is null) or (${table.status} = 'COMPLETED' and ${table.startedAt} is not null and ${table.completedAt} is not null and ${table.failedAt} is null and ${table.cancelledAt} is null) or (${table.status} = 'FAILED' and ${table.startedAt} is not null and ${table.failedAt} is not null and ${table.completedAt} is null and ${table.cancelledAt} is null) or (${table.status} = 'CANCELLED' and ${table.cancelledAt} is not null and ${table.completedAt} is null and ${table.failedAt} is null)`,
    ),
    check(
      'risk_detection_runs_failure_reason_check',
      sql`(${table.status} = 'FAILED' and char_length(btrim(coalesce(${table.failureReason}, ''))) between 1 and 2000) or (${table.status} <> 'FAILED')`,
    ),
    check(
      'risk_detection_runs_archive_check',
      sql`${table.archivedAt} is null or ${table.archivedAt} >= ${table.createdAt}`,
    ),
    index('risk_detection_runs_market_category_status_idx').on(
      table.marketId,
      table.category,
      table.status,
      table.createdAt,
    ),
    index('risk_detection_runs_market_window_idx').on(
      table.marketId,
      table.windowStartAt,
      table.windowEndAt,
    ),
  ],
);

export const riskEvents = pgTable(
  'risk_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').notNull(),
    marketId: uuid('market_id').notNull(),
    indicatorId: uuid('indicator_id').notNull(),
    indicatorCode: varchar('indicator_code', { length: 100 }).notNull(),
    indicatorVersion: integer('indicator_version').notNull(),
    category: riskIndicatorCategory('category').notNull(),
    severity: riskEventSeverity('severity').notNull(),
    entityType: varchar('entity_type', { length: 40 }).notNull(),
    entityId: text('entity_id').notNull(),
    entityMarketId: uuid('entity_market_id').references(() => markets.id, {
      onDelete: 'restrict',
    }),
    payload: jsonb('payload').notNull(),
    detectionMetadata: jsonb('detection_metadata').notNull(),
    status: riskEventStatus('status').notNull().default('FLAGGED'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('risk_events_id_market_unique').on(table.id, table.marketId),
    foreignKey({
      columns: [table.runId, table.marketId],
      foreignColumns: [riskDetectionRuns.id, riskDetectionRuns.marketId],
      name: 'risk_events_run_market_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.indicatorId, table.marketId],
      foreignColumns: [
        riskIndicatorDefinitions.id,
        riskIndicatorDefinitions.marketId,
      ],
      name: 'risk_events_indicator_market_fk',
    }).onDelete('restrict'),
    unique('risk_events_run_reference_unique').on(
      table.runId,
      table.marketId,
      table.indicatorCode,
      table.entityType,
      table.entityId,
    ),
    check(
      'risk_events_entity_type_check',
      sql`char_length(btrim(${table.entityType})) between 1 and 40`,
    ),
    check(
      'risk_events_entity_id_check',
      sql`char_length(btrim(${table.entityId})) between 1 and 120`,
    ),
    check(
      'risk_events_code_check',
      sql`char_length(btrim(${table.indicatorCode})) between 1 and 100`,
    ),
    check(
      'risk_events_indicator_version_check',
      sql`${table.indicatorVersion} > 0`,
    ),
    check(
      'risk_events_payload_check',
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
    check(
      'risk_events_metadata_check',
      sql`jsonb_typeof(${table.detectionMetadata}) = 'object'`,
    ),
    check('risk_events_status_check', sql`${table.status} = 'FLAGGED'`),
    index('risk_events_market_status_idx').on(
      table.marketId,
      table.status,
      table.createdAt,
    ),
    index('risk_events_market_category_idx').on(
      table.marketId,
      table.category,
      table.createdAt,
    ),
    index('risk_events_run_idx').on(table.runId, table.createdAt),
    index('risk_events_indicator_idx').on(table.indicatorId, table.createdAt),
  ],
);

export const riskReviewQueue = pgTable(
  'risk_review_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id').notNull(),
    marketId: uuid('market_id').notNull(),
    status: riskReviewStatus('status').notNull().default('OPEN'),
    assignedAdminUserId: uuid('assigned_admin_user_id').references(
      () => adminUsers.id,
      { onDelete: 'restrict' },
    ),
    decision: riskReviewDecision('decision'),
    decisionReason: text('decision_reason'),
    notes: text('notes'),
    resolvedByAdminUserId: uuid('resolved_by_admin_user_id').references(
      () => adminUsers.id,
      { onDelete: 'restrict' },
    ),
    resolvedAt: utcTimestamp('resolved_at'),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [
    unique('risk_review_queue_id_market_unique').on(table.id, table.marketId),
    unique('risk_review_queue_event_market_unique').on(
      table.eventId,
      table.marketId,
    ),
    foreignKey({
      columns: [table.eventId, table.marketId],
      foreignColumns: [riskEvents.id, riskEvents.marketId],
      name: 'risk_review_queue_event_market_fk',
    }).onDelete('restrict'),
    check('risk_review_queue_version_check', sql`${table.version} > 0`),
    check(
      'risk_review_queue_decision_consistency',
      sql`(${table.decision} is null and ${table.decisionReason} is null) or (${table.decision} is not null and char_length(btrim(${table.decisionReason})) between 1 and 2000)`,
    ),
    check(
      'risk_review_queue_notes_check',
      sql`${table.notes} is null or char_length(${table.notes}) between 1 and 20000`,
    ),
    check(
      'risk_review_queue_timestamps_check',
      sql`(${table.status} = 'OPEN' and ${table.assignedAdminUserId} is null and ${table.resolvedByAdminUserId} is null and ${table.resolvedAt} is null) or (${table.status} = 'IN_REVIEW' and ${table.assignedAdminUserId} is not null and ${table.resolvedByAdminUserId} is null and ${table.resolvedAt} is null) or (${table.status} = 'RESOLVED' and ${table.assignedAdminUserId} is not null and ${table.decision} is not null and ${table.resolvedByAdminUserId} is not null and ${table.resolvedAt} is not null)`,
    ),
    check(
      'risk_review_queue_archive_check',
      sql`${table.archivedAt} is null or ${table.archivedAt} >= ${table.createdAt}`,
    ),
    index('risk_review_queue_market_status_idx').on(
      table.marketId,
      table.status,
      table.createdAt,
    ),
    index('risk_review_queue_event_idx').on(table.eventId, table.createdAt),
    index('risk_review_queue_assignee_status_idx').on(
      table.assignedAdminUserId,
      table.status,
      table.createdAt,
    ),
  ],
);

export const riskIdempotencyKeys = pgTable(
  'risk_idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    operation: varchar('operation', { length: 80 }).notNull(),
    key: varchar('key', { length: 200 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    response: jsonb('response'),
    statusCode: integer('status_code'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('risk_idempotency_scope_unique').on(
      table.adminUserId,
      table.marketId,
      table.operation,
      table.key,
    ),
    check(
      'risk_idempotency_hash_check',
      sql`char_length(${table.requestHash}) = 64`,
    ),
    check(
      'risk_idempotency_result_check',
      sql`(${table.response} is null and ${table.statusCode} is null) or (${table.response} is not null and ${table.statusCode} between 200 and 599)`,
    ),
  ],
);

import {
  redemptionRateVersions,
  redemptionRateMarketRules,
  redemptionRateCancellations,
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
  redemptionRateMarketRules,
  redemptionRateCancellations,
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
  mcpAdjustmentMarketRules,
  mcpAdjustmentReasonCodes,
  ipointAdjustmentMarketRules,
  ipointAdjustmentReasonCodes,
  ipointAdjustmentRequests,
  ipointAdjustmentDecisions,
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
  adPlacements,
  adFeeConfigs,
  ads,
  contentArticles,
  adsContentIdempotencyKeys,
  reconciliationRuns,
  reconciliationRunItems,
  reconciliationExceptions,
  reconciliationIdempotencyKeys,
  reconciliationKind,
  reconciliationRunStatus,
  reconciliationExceptionStatus,
  reconciliationExceptionClassification,
  reconciliationItemStatus,
  riskIndicatorDefinitions,
  riskDetectionRuns,
  riskEvents,
  riskReviewQueue,
  riskIdempotencyKeys,
  riskIndicatorCategory,
  riskEventSeverity,
  riskRunStatus,
  riskEventStatus,
  riskReviewStatus,
  riskReviewDecision,
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
