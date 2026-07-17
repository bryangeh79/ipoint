CREATE TYPE member_email_otp_purpose AS ENUM ('REGISTRATION', 'PASSWORD_RESET');

CREATE TABLE auth_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  response_hash text,
  response jsonb,
  status_code integer,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  expires_at timestamptz(6) NOT NULL,
  CONSTRAINT auth_idempotency_scope_key_unique UNIQUE (scope, key),
  CONSTRAINT auth_idempotency_request_hash_check CHECK (char_length(request_hash) = 64),
  CONSTRAINT auth_idempotency_response_hash_check CHECK (
    response_hash IS NULL OR char_length(response_hash) = 64
  ),
  CONSTRAINT auth_idempotency_result_check CHECK (
    (response IS NULL AND status_code IS NULL)
    OR (response IS NOT NULL AND status_code BETWEEN 200 AND 299)
  )
);

CREATE TABLE member_email_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose member_email_otp_purpose NOT NULL,
  member_id uuid REFERENCES members(id) ON DELETE RESTRICT,
  account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  email text NOT NULL,
  account_country text,
  password_hash text,
  referral_code text,
  referrer_member_id uuid REFERENCES members(id) ON DELETE RESTRICT,
  terms_version text,
  disclaimer_version text,
  privacy_version text,
  locale text,
  otp_hash text NOT NULL,
  otp_version integer NOT NULL DEFAULT 1,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL,
  expires_at timestamptz(6) NOT NULL,
  resend_available_at timestamptz(6) NOT NULL,
  verified_at timestamptz(6),
  used_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT member_email_otps_email_check CHECK (email = lower(email)),
  CONSTRAINT member_email_otps_attempts_check CHECK (attempts >= 0),
  CONSTRAINT member_email_otps_max_attempts_check CHECK (max_attempts > 0),
  CONSTRAINT member_email_otps_version_check CHECK (otp_version > 0),
  CONSTRAINT member_email_otps_code_hash_only_check CHECK (char_length(otp_hash) = 64),
  CONSTRAINT member_email_otps_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT member_email_otps_resend_check CHECK (resend_available_at >= created_at),
  CONSTRAINT member_email_otps_registration_payload_check CHECK (
    (purpose = 'REGISTRATION' AND account_country IS NOT NULL AND password_hash IS NOT NULL AND terms_version IS NOT NULL AND disclaimer_version IS NOT NULL AND privacy_version IS NOT NULL AND locale IS NOT NULL)
    OR
    (purpose = 'PASSWORD_RESET' AND account_country IS NULL AND password_hash IS NULL AND terms_version IS NULL AND disclaimer_version IS NULL AND privacy_version IS NULL)
  )
);

CREATE UNIQUE INDEX member_email_otps_active_unique
  ON member_email_otps (email, purpose)
  WHERE used_at IS NULL;
CREATE INDEX member_email_otps_account_idx ON member_email_otps (account_id);
CREATE INDEX member_email_otps_member_idx ON member_email_otps (member_id);
