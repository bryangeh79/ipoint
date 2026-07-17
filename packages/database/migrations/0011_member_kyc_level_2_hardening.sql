-- 0011: Member KYC Level 2 submission data, snapshots, and idempotency

CREATE TYPE member_kyc_identification_type AS ENUM (
  'PASSPORT',
  'NATIONAL_ID',
  'DRIVING_LICENSE',
  'RESIDENCE_PERMIT',
  'OTHER'
);

ALTER TABLE member_kyc_cases
  ADD COLUMN legal_full_name text,
  ADD COLUMN identification_type member_kyc_identification_type,
  ADD COLUMN identification_number text,
  ADD COLUMN date_of_birth date,
  ADD COLUMN nationality text,
  ADD COLUMN residential_address jsonb,
  ADD COLUMN account_country_snapshot text,
  ADD COLUMN submission_market_id uuid REFERENCES markets(id) ON DELETE RESTRICT,
  ADD COLUMN consent_version text;

ALTER TABLE member_kyc_cases
  ADD CONSTRAINT member_kyc_cases_nationality_check CHECK (
    nationality IS NULL OR (
      nationality = upper(nationality) AND char_length(nationality) = 2
    )
  ),
  ADD CONSTRAINT member_kyc_cases_account_country_snapshot_check CHECK (
    account_country_snapshot IS NULL OR (
      account_country_snapshot = upper(account_country_snapshot)
      AND char_length(account_country_snapshot) = 2
    )
  ),
  ADD CONSTRAINT member_kyc_cases_residential_address_check CHECK (
    residential_address IS NULL OR jsonb_typeof(residential_address) = 'object'
  ),
  ADD CONSTRAINT member_kyc_cases_level_2_submission_fields_check CHECK (
    level_requested <> 'LEVEL_2'
    OR status IN ('NOT_STARTED', 'DRAFT')
    OR (
      legal_full_name IS NOT NULL
      AND btrim(legal_full_name) <> ''
      AND identification_type IS NOT NULL
      AND identification_number IS NOT NULL
      AND btrim(identification_number) <> ''
      AND date_of_birth IS NOT NULL
      AND nationality IS NOT NULL
      AND residential_address IS NOT NULL
      AND account_country_snapshot IS NOT NULL
      AND submission_market_id IS NOT NULL
      AND consent_version IS NOT NULL
      AND btrim(consent_version) <> ''
      AND submitted_at IS NOT NULL
    )
  );

CREATE INDEX member_kyc_cases_submission_market_idx
  ON member_kyc_cases (submission_market_id);

CREATE TABLE member_kyc_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  response jsonb,
  status_code integer,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT member_kyc_idempotency_scope_key_unique UNIQUE (scope, key),
  CONSTRAINT member_kyc_idempotency_request_hash_check CHECK (
    char_length(request_hash) = 64
  ),
  CONSTRAINT member_kyc_idempotency_result_check CHECK (
    (response IS NULL AND status_code IS NULL)
    OR (response IS NOT NULL AND status_code BETWEEN 100 AND 599)
  )
);
