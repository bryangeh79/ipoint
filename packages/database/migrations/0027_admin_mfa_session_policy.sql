-- 0027: Phase 7 Admin MFA and canonical session policy
-- Forward-only. Existing account sessions remain ACCOUNT sessions and are not
-- upgraded to Admin authority.

CREATE TYPE session_actor_purpose AS ENUM ('ACCOUNT', 'ADMIN');
CREATE TYPE admin_mfa_factor_status AS ENUM ('UNVERIFIED', 'ACTIVE', 'DISABLED', 'REVOKED');
CREATE TYPE admin_mfa_challenge_purpose AS ENUM ('ENROLLMENT', 'LOGIN', 'RECOVERY', 'STEP_UP');
CREATE TYPE admin_mfa_challenge_status AS ENUM ('PENDING', 'CONSUMED', 'EXHAUSTED', 'EXPIRED');

ALTER TABLE sessions
  ADD COLUMN actor_purpose session_actor_purpose NOT NULL DEFAULT 'ACCOUNT',
  ADD COLUMN admin_user_id uuid REFERENCES admin_users(id) ON DELETE RESTRICT,
  ADD COLUMN idle_expires_at timestamptz(6),
  ADD COLUMN absolute_expires_at timestamptz(6),
  ADD COLUMN family_created_at timestamptz(6),
  ADD COLUMN family_max_expires_at timestamptz(6),
  ADD COLUMN mfa_recovery_used boolean NOT NULL DEFAULT false;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_admin_policy_check CHECK (
    (actor_purpose = 'ACCOUNT' AND admin_user_id IS NULL)
    OR
    (actor_purpose = 'ADMIN'
      AND admin_user_id IS NOT NULL
      AND idle_expires_at IS NOT NULL
      AND absolute_expires_at IS NOT NULL
      AND family_created_at IS NOT NULL
      AND family_max_expires_at IS NOT NULL
      AND idle_expires_at <= absolute_expires_at
      AND absolute_expires_at <= family_max_expires_at)
  );

CREATE INDEX sessions_admin_active_idx
  ON sessions (admin_user_id, absolute_expires_at)
  WHERE actor_purpose = 'ADMIN' AND revoked_at IS NULL;

CREATE TABLE admin_mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  factor_type text NOT NULL DEFAULT 'TOTP',
  secret_ciphertext text NOT NULL,
  secret_nonce text NOT NULL,
  secret_auth_tag text NOT NULL,
  key_id text NOT NULL,
  algorithm text NOT NULL DEFAULT 'AES-256-GCM',
  status admin_mfa_factor_status NOT NULL DEFAULT 'UNVERIFIED',
  last_accepted_counter bigint,
  failed_attempts integer NOT NULL DEFAULT 0,
  failed_window_started_at timestamptz(6),
  locked_until timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  confirmed_at timestamptz(6),
  disabled_at timestamptz(6),
  revoked_at timestamptz(6),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT admin_mfa_factors_totp_check CHECK (factor_type = 'TOTP'),
  CONSTRAINT admin_mfa_factors_crypto_check CHECK (
    algorithm = 'AES-256-GCM'
    AND char_length(secret_ciphertext) > 0
    AND char_length(secret_nonce) > 0
    AND char_length(secret_auth_tag) > 0
    AND char_length(key_id) > 0
  ),
  CONSTRAINT admin_mfa_factors_attempts_check CHECK (failed_attempts >= 0),
  CONSTRAINT admin_mfa_factors_counter_check CHECK (last_accepted_counter IS NULL OR last_accepted_counter >= 0),
  CONSTRAINT admin_mfa_factors_version_check CHECK (version > 0)
);

CREATE UNIQUE INDEX admin_mfa_factors_active_unique
  ON admin_mfa_factors (admin_user_id)
  WHERE status = 'ACTIVE';
CREATE INDEX admin_mfa_factors_admin_status_idx
  ON admin_mfa_factors (admin_user_id, status);

CREATE TABLE admin_mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factor_id uuid NOT NULL REFERENCES admin_mfa_factors(id) ON DELETE RESTRICT,
  code_hash text NOT NULL,
  hash_algorithm text NOT NULL DEFAULT 'scrypt',
  hash_version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  consumed_at timestamptz(6),
  revoked_at timestamptz(6),
  CONSTRAINT admin_mfa_recovery_codes_hash_check CHECK (char_length(code_hash) >= 64),
  CONSTRAINT admin_mfa_recovery_codes_state_check CHECK (consumed_at IS NULL OR revoked_at IS NULL),
  CONSTRAINT admin_mfa_recovery_codes_unique UNIQUE (factor_id, code_hash)
);

CREATE INDEX admin_mfa_recovery_codes_available_idx
  ON admin_mfa_recovery_codes (factor_id, created_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE admin_mfa_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_hash text NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  factor_id uuid REFERENCES admin_mfa_factors(id) ON DELETE RESTRICT,
  session_id uuid REFERENCES sessions(id) ON DELETE RESTRICT,
  purpose admin_mfa_challenge_purpose NOT NULL,
  status admin_mfa_challenge_status NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  request_hash text,
  request_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  expires_at timestamptz(6) NOT NULL,
  consumed_at timestamptz(6),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT admin_mfa_challenges_hash_check CHECK (char_length(challenge_hash) = 64),
  CONSTRAINT admin_mfa_challenges_attempts_check CHECK (attempts >= 0 AND attempts <= max_attempts),
  CONSTRAINT admin_mfa_challenges_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT admin_mfa_challenges_version_check CHECK (version > 0)
);

CREATE INDEX admin_mfa_challenges_subject_idx
  ON admin_mfa_challenges (admin_user_id, purpose, status, expires_at);

CREATE TABLE admin_step_up_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_hash text NOT NULL UNIQUE,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  factor_id uuid NOT NULL REFERENCES admin_mfa_factors(id) ON DELETE RESTRICT,
  action_class text NOT NULL,
  market_id uuid REFERENCES markets(id) ON DELETE RESTRICT,
  target_hash text,
  issued_at timestamptz(6) NOT NULL DEFAULT now(),
  expires_at timestamptz(6) NOT NULL,
  used_at timestamptz(6),
  revoked_at timestamptz(6),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT admin_step_up_grants_hash_check CHECK (char_length(grant_hash) = 64),
  CONSTRAINT admin_step_up_grants_expiry_check CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '10 minutes'),
  CONSTRAINT admin_step_up_grants_version_check CHECK (version > 0)
);

CREATE INDEX admin_step_up_grants_session_idx
  ON admin_step_up_grants (session_id, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;
