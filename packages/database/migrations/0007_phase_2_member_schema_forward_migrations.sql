CREATE TYPE member_status AS ENUM (
  'PENDING_EMAIL_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'CLOSED'
);
CREATE TYPE member_kyc_level AS ENUM ('NONE', 'LEVEL_1', 'LEVEL_2');
CREATE TYPE member_referral_source AS ENUM ('REGISTRATION', 'ADMIN_CORRECTION');
CREATE TYPE member_referral_status AS ENUM ('ACTIVE', 'VOIDED');
CREATE TYPE member_referral_history_event_type AS ENUM (
  'ASSIGNED', 'CORRECTED', 'VOIDED'
);
CREATE TYPE member_qr_identity_status AS ENUM ('ACTIVE', 'ROTATED', 'REVOKED');
CREATE TYPE member_kyc_case_status AS ENUM (
  'NOT_STARTED', 'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED',
  'REJECTED', 'MORE_INFO_REQUIRED', 'REVERIFICATION_REQUIRED'
);
CREATE TYPE member_kyc_document_scan_status AS ENUM ('PENDING', 'CLEAN', 'BLOCKED');
CREATE TYPE member_account_country_change_request_status AS ENUM (
  'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'
);

CREATE TABLE members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  public_member_id text NOT NULL,
  referral_code text NOT NULL,
  status member_status NOT NULL DEFAULT 'PENDING_EMAIL_VERIFICATION',
  kyc_level member_kyc_level NOT NULL DEFAULT 'NONE',
  closed_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  archived_at timestamptz(6),
  CONSTRAINT members_account_unique UNIQUE (account_id),
  CONSTRAINT members_public_member_id_unique UNIQUE (public_member_id),
  CONSTRAINT members_referral_code_unique UNIQUE (referral_code),
  CONSTRAINT members_closed_at_check CHECK (
    (status <> 'CLOSED' AND closed_at IS NULL) OR
    (status = 'CLOSED' AND closed_at IS NOT NULL)
  )
);
CREATE INDEX members_status_idx ON members (status);

CREATE TABLE member_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  full_name text,
  phone text,
  birth_date date,
  address jsonb,
  avatar_object_key text,
  language text,
  locale text,
  marketing_opt_in boolean NOT NULL DEFAULT false,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  archived_at timestamptz(6),
  CONSTRAINT member_profiles_member_unique UNIQUE (member_id)
);

CREATE TABLE member_market_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  is_enabled boolean NOT NULL DEFAULT true,
  is_current boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  last_selected_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT member_market_preferences_member_market_unique UNIQUE (member_id, market_id),
  CONSTRAINT member_market_preferences_current_enabled_check CHECK (
    is_current = false OR is_enabled = true
  ),
  CONSTRAINT member_market_preferences_sort_order_check CHECK (sort_order >= 0)
);
CREATE UNIQUE INDEX member_market_preferences_current_unique
  ON member_market_preferences (member_id)
  WHERE is_current = true;

CREATE TABLE member_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  referrer_member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  referral_code_snapshot text NOT NULL,
  source member_referral_source NOT NULL,
  status member_referral_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT member_referrals_self_reference_check CHECK (member_id <> referrer_member_id)
);
CREATE UNIQUE INDEX member_referrals_active_unique
  ON member_referrals (member_id)
  WHERE status = 'ACTIVE';
CREATE INDEX member_referrals_referrer_idx ON member_referrals (referrer_member_id);

CREATE TABLE member_referral_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  old_referrer_member_id uuid REFERENCES members(id) ON DELETE RESTRICT,
  new_referrer_member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  event_type member_referral_history_event_type NOT NULL,
  correction_reason text NOT NULL,
  authorized_actor_type actor_type NOT NULL,
  authorized_actor_id uuid,
  request_id text NOT NULL,
  occurred_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT member_referral_history_self_reference_check CHECK (
    member_id <> new_referrer_member_id
  ),
  CONSTRAINT member_referral_history_old_new_reference_check CHECK (
    old_referrer_member_id IS NULL OR old_referrer_member_id <> new_referrer_member_id
  )
);
CREATE INDEX member_referral_history_member_time_idx
  ON member_referral_history (member_id, occurred_at);

CREATE TABLE member_terms_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  document_type text NOT NULL,
  document_version text NOT NULL,
  locale text,
  accepted_at timestamptz(6) NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  device_fingerprint text,
  CONSTRAINT member_terms_acceptance_unique
    UNIQUE (member_id, document_type, document_version)
);

CREATE TABLE member_qr_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  public_qr_id text NOT NULL,
  token_hash text NOT NULL,
  status member_qr_identity_status NOT NULL DEFAULT 'ACTIVE',
  rotated_from_id uuid,
  rotated_to_id uuid,
  issued_at timestamptz(6) NOT NULL DEFAULT now(),
  expires_at timestamptz(6),
  revoked_at timestamptz(6),
  reason text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT member_qr_identities_public_qr_id_unique UNIQUE (public_qr_id),
  CONSTRAINT member_qr_identities_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT member_qr_identities_token_hash_only_check CHECK (char_length(token_hash) = 64),
  CONSTRAINT member_qr_identities_rotated_from_fk
    FOREIGN KEY (rotated_from_id) REFERENCES member_qr_identities(id) ON DELETE RESTRICT,
  CONSTRAINT member_qr_identities_rotated_to_fk
    FOREIGN KEY (rotated_to_id) REFERENCES member_qr_identities(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX member_qr_identities_active_unique
  ON member_qr_identities (member_id)
  WHERE status = 'ACTIVE';

CREATE TABLE member_kyc_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  status member_kyc_case_status NOT NULL DEFAULT 'NOT_STARTED',
  version integer NOT NULL DEFAULT 1,
  level_requested member_kyc_level NOT NULL,
  submitted_at timestamptz(6),
  reviewed_at timestamptz(6),
  reviewed_by_admin_user_id uuid REFERENCES admin_users(id) ON DELETE RESTRICT,
  decision_reason text,
  reverification_required_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT member_kyc_cases_member_unique UNIQUE (member_id),
  CONSTRAINT member_kyc_cases_version_check CHECK (version > 0)
);
CREATE INDEX member_kyc_cases_market_idx ON member_kyc_cases (market_id);

CREATE TABLE member_kyc_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_kyc_case_id uuid NOT NULL REFERENCES member_kyc_cases(id) ON DELETE RESTRICT,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  document_type text NOT NULL,
  object_key text NOT NULL,
  original_filename text NOT NULL,
  content_type text NOT NULL,
  byte_size numeric(20,0) NOT NULL,
  sha256 text NOT NULL,
  scan_status member_kyc_document_scan_status NOT NULL DEFAULT 'PENDING',
  classification text NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  archived_at timestamptz(6),
  CONSTRAINT member_kyc_documents_object_key_unique UNIQUE (object_key),
  CONSTRAINT member_kyc_documents_byte_size_check CHECK (byte_size > 0)
);
CREATE INDEX member_kyc_documents_case_idx ON member_kyc_documents (member_kyc_case_id);

CREATE TABLE member_account_country_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  current_country text NOT NULL,
  requested_country text NOT NULL,
  status member_account_country_change_request_status NOT NULL DEFAULT 'PENDING',
  reason text NOT NULL,
  reviewed_by_admin_user_id uuid REFERENCES admin_users(id) ON DELETE RESTRICT,
  review_reason text,
  submitted_at timestamptz(6) NOT NULL DEFAULT now(),
  reviewed_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT member_account_country_change_requests_current_country_check CHECK (
    current_country = upper(current_country) AND char_length(current_country) = 2
  ),
  CONSTRAINT member_account_country_change_requests_requested_country_check CHECK (
    requested_country = upper(requested_country) AND char_length(requested_country) = 2
  )
);
CREATE UNIQUE INDEX member_account_country_change_requests_pending_unique
  ON member_account_country_change_requests (member_id)
  WHERE status = 'PENDING';
CREATE INDEX member_account_country_change_requests_account_idx
  ON member_account_country_change_requests (account_id);

CREATE TABLE member_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  from_status member_status,
  to_status member_status NOT NULL,
  actor_type actor_type NOT NULL,
  actor_id uuid,
  reason text,
  occurred_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX member_status_history_member_time_idx
  ON member_status_history (member_id, occurred_at);

CREATE TABLE member_kyc_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_kyc_case_id uuid NOT NULL REFERENCES member_kyc_cases(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  actor_type actor_type NOT NULL,
  actor_id uuid,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX member_kyc_history_case_time_idx
  ON member_kyc_history (member_kyc_case_id, occurred_at);

CREATE TRIGGER member_referral_history_append_only
  BEFORE UPDATE OR DELETE ON member_referral_history
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE TRIGGER member_terms_acceptances_append_only
  BEFORE UPDATE OR DELETE ON member_terms_acceptances
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE TRIGGER member_status_history_append_only
  BEFORE UPDATE OR DELETE ON member_status_history
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE TRIGGER member_kyc_history_append_only
  BEFORE UPDATE OR DELETE ON member_kyc_history
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
