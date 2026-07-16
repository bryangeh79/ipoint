CREATE TYPE account_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'ARCHIVED');
CREATE TYPE credential_type AS ENUM ('PASSWORD');
CREATE TYPE otp_purpose AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'STEP_UP');
CREATE TYPE market_status AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE admin_status AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE actor_type AS ENUM ('ACCOUNT', 'ADMIN_USER', 'SYSTEM');
CREATE TYPE event_result AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL,
  email text NOT NULL,
  account_country text NOT NULL,
  status account_status NOT NULL DEFAULT 'PENDING',
  email_verified_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  archived_at timestamptz(6),
  CONSTRAINT accounts_public_id_unique UNIQUE (public_id),
  CONSTRAINT accounts_email_unique UNIQUE (email),
  CONSTRAINT accounts_email_normalized_check CHECK (email = lower(email)),
  CONSTRAINT accounts_country_code_check CHECK (char_length(account_country) = 2)
);
CREATE INDEX accounts_status_idx ON accounts (status);

CREATE TABLE credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  type credential_type NOT NULL DEFAULT 'PASSWORD',
  secret_hash text NOT NULL,
  hash_algorithm text NOT NULL,
  hash_version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  revoked_at timestamptz(6),
  CONSTRAINT credentials_account_type_unique UNIQUE (account_id, type),
  CONSTRAINT credentials_hash_only_check CHECK (char_length(secret_hash) >= 32)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  family_id uuid NOT NULL,
  access_token_hash text NOT NULL,
  refresh_token_hash text NOT NULL,
  user_agent text,
  ip_address text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  last_seen_at timestamptz(6) NOT NULL DEFAULT now(),
  expires_at timestamptz(6) NOT NULL,
  revoked_at timestamptz(6),
  revoke_reason text,
  replaced_by_session_id uuid,
  CONSTRAINT sessions_access_token_hash_unique UNIQUE (access_token_hash),
  CONSTRAINT sessions_refresh_token_hash_unique UNIQUE (refresh_token_hash),
  CONSTRAINT sessions_token_hashes_only_check CHECK (
    char_length(access_token_hash) = 64 AND char_length(refresh_token_hash) = 64
  ),
  CONSTRAINT sessions_expiry_check CHECK (expires_at > created_at)
);
ALTER TABLE sessions
  ADD CONSTRAINT sessions_replaced_by_fk
  FOREIGN KEY (replaced_by_session_id) REFERENCES sessions(id) ON DELETE RESTRICT;
CREATE INDEX sessions_account_active_idx ON sessions (account_id, expires_at);

CREATE TABLE otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  destination text NOT NULL,
  purpose otp_purpose NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  expires_at timestamptz(6) NOT NULL,
  verified_at timestamptz(6),
  consumed_at timestamptz(6),
  CONSTRAINT otps_code_hash_only_check CHECK (char_length(code_hash) = 64),
  CONSTRAINT otps_attempts_check CHECK (attempts >= 0 AND attempts <= max_attempts),
  CONSTRAINT otps_expiry_check CHECK (expires_at > created_at)
);
CREATE INDEX otps_destination_purpose_idx ON otps (destination, purpose);

CREATE TABLE security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  result event_result NOT NULL,
  ip_address text,
  user_agent text,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX security_events_account_time_idx ON security_events (account_id, occurred_at);

CREATE TABLE markets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  status market_status NOT NULL DEFAULT 'INACTIVE',
  currency_code text NOT NULL,
  timezone text NOT NULL,
  default_locale text NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  archived_at timestamptz(6),
  CONSTRAINT markets_code_unique UNIQUE (code),
  CONSTRAINT markets_code_check CHECK (code = upper(code) AND char_length(code) BETWEEN 2 AND 8),
  CONSTRAINT markets_currency_check CHECK (
    currency_code = upper(currency_code) AND char_length(currency_code) = 3
  )
);

CREATE TABLE admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  status admin_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  archived_at timestamptz(6),
  CONSTRAINT admin_users_account_unique UNIQUE (account_id)
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  archived_at timestamptz(6),
  CONSTRAINT roles_code_unique UNIQUE (code)
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  description text NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT permissions_code_unique UNIQUE (code)
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  assigned_by_admin_user_id uuid REFERENCES admin_users(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  revoked_at timestamptz(6)
);
CREATE UNIQUE INDEX role_assignments_active_unique
  ON role_assignments (admin_user_id, role_id) WHERE revoked_at IS NULL;
CREATE INDEX role_assignments_admin_idx ON role_assignments (admin_user_id);

CREATE TABLE market_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  granted_by_admin_user_id uuid REFERENCES admin_users(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  revoked_at timestamptz(6)
);
CREATE UNIQUE INDEX market_access_active_unique
  ON market_access (admin_user_id, market_id) WHERE revoked_at IS NULL;
CREATE INDEX market_access_admin_idx ON market_access (admin_user_id);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type actor_type NOT NULL,
  actor_id uuid,
  market_id uuid REFERENCES markets(id) ON DELETE RESTRICT,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  result event_result NOT NULL,
  request_id text,
  ip_address text,
  occurred_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_actor_time_idx ON audit_logs (actor_type, actor_id, occurred_at);
CREATE INDEX audit_logs_entity_time_idx ON audit_logs (entity_type, entity_id, occurred_at);
CREATE INDEX audit_logs_market_time_idx ON audit_logs (market_id, occurred_at);

CREATE TABLE entity_timelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  event_type text NOT NULL,
  actor_type actor_type NOT NULL,
  actor_id uuid,
  market_id uuid REFERENCES markets(id) ON DELETE RESTRICT,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX entity_timelines_entity_time_idx
  ON entity_timelines (entity_type, entity_id, occurred_at);

CREATE FUNCTION reject_append_only_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is prohibited', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE TRIGGER entity_timelines_append_only
  BEFORE UPDATE OR DELETE ON entity_timelines
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
-- acceptance mutation
