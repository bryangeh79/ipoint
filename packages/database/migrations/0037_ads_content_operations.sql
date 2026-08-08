-- 0037: P8-S1 Ads & Content Operations
--
-- Forward-only domain addition. Migrations 0000-0036 remain byte-identical.
-- Advertisement pricing stays CONFIGURABLE (C-11): this migration creates a
-- versioned market-scoped fee structure but deliberately seeds no commercial
-- values and performs no MCP debit.

CREATE TYPE ads_content_status AS ENUM (
  'DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'EXPIRED', 'ARCHIVED'
);
CREATE TYPE ad_placement_status AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
CREATE TYPE ad_fee_config_status AS ENUM (
  'DRAFT', 'SCHEDULED', 'ACTIVE', 'EXPIRED', 'ARCHIVED'
);

CREATE TABLE ad_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  code varchar(80) NOT NULL,
  name varchar(160) NOT NULL,
  description text,
  position integer NOT NULL DEFAULT 0,
  status ad_placement_status NOT NULL DEFAULT 'ACTIVE',
  created_by_admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  updated_by_admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  archived_at timestamptz(6),
  CONSTRAINT ad_placements_market_code_unique UNIQUE (market_id, code),
  CONSTRAINT ad_placements_id_market_unique UNIQUE (id, market_id),
  CONSTRAINT ad_placements_code_check CHECK (char_length(btrim(code)) BETWEEN 1 AND 80),
  CONSTRAINT ad_placements_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT ad_placements_position_check CHECK (position >= 0),
  CONSTRAINT ad_placements_version_check CHECK (version > 0),
  CONSTRAINT ad_placements_archive_check CHECK (
    (status = 'ARCHIVED' AND archived_at IS NOT NULL)
    OR (status <> 'ARCHIVED' AND archived_at IS NULL)
  )
);
CREATE INDEX ad_placements_market_status_position_idx
  ON ad_placements (market_id, status, position);

CREATE TABLE ad_fee_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  amount numeric(38,10) NOT NULL,
  currency_code varchar(3) NOT NULL,
  effective_from timestamptz(6) NOT NULL,
  effective_to timestamptz(6),
  status ad_fee_config_status NOT NULL DEFAULT 'DRAFT',
  reason text NOT NULL,
  created_by_admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  archived_at timestamptz(6),
  CONSTRAINT ad_fee_configs_market_version_unique UNIQUE (market_id, version),
  CONSTRAINT ad_fee_configs_id_market_unique UNIQUE (id, market_id),
  CONSTRAINT ad_fee_configs_version_check CHECK (version > 0),
  CONSTRAINT ad_fee_configs_amount_check CHECK (amount > 0),
  CONSTRAINT ad_fee_configs_currency_check CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT ad_fee_configs_reason_check CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  CONSTRAINT ad_fee_configs_window_check CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT ad_fee_configs_archive_check CHECK (
    (status = 'ARCHIVED' AND archived_at IS NOT NULL)
    OR (status <> 'ARCHIVED' AND archived_at IS NULL)
  )
);
CREATE INDEX ad_fee_configs_market_status_effective_idx
  ON ad_fee_configs (market_id, status, effective_from);

CREATE TABLE ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id uuid NOT NULL DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  placement_id uuid NOT NULL,
  fee_config_id uuid,
  title varchar(180) NOT NULL,
  summary text,
  creative_media_url text NOT NULL,
  creative_alt_text varchar(240) NOT NULL,
  target_url text,
  is_sponsored boolean NOT NULL DEFAULT true,
  sponsor_label varchar(80) NOT NULL,
  status ads_content_status NOT NULL DEFAULT 'DRAFT',
  schedule_start_at timestamptz(6),
  schedule_end_at timestamptz(6),
  created_by_admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  updated_by_admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  archived_at timestamptz(6),
  CONSTRAINT ads_public_id_unique UNIQUE (public_id),
  CONSTRAINT ads_id_market_unique UNIQUE (id, market_id),
  CONSTRAINT ads_placement_market_fk FOREIGN KEY (placement_id, market_id)
    REFERENCES ad_placements(id, market_id) ON DELETE RESTRICT,
  CONSTRAINT ads_fee_config_market_fk FOREIGN KEY (fee_config_id, market_id)
    REFERENCES ad_fee_configs(id, market_id) ON DELETE RESTRICT,
  CONSTRAINT ads_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 180),
  CONSTRAINT ads_creative_url_check CHECK (char_length(btrim(creative_media_url)) BETWEEN 1 AND 2000),
  CONSTRAINT ads_alt_text_check CHECK (char_length(btrim(creative_alt_text)) BETWEEN 1 AND 240),
  CONSTRAINT ads_sponsor_label_check CHECK (char_length(btrim(sponsor_label)) BETWEEN 1 AND 80),
  CONSTRAINT ads_sponsored_check CHECK (is_sponsored = true),
  CONSTRAINT ads_version_check CHECK (version > 0),
  CONSTRAINT ads_schedule_window_check CHECK (
    schedule_end_at IS NULL
    OR (schedule_start_at IS NOT NULL AND schedule_end_at > schedule_start_at)
  ),
  CONSTRAINT ads_archive_check CHECK (
    (status = 'ARCHIVED' AND archived_at IS NOT NULL)
    OR (status <> 'ARCHIVED' AND archived_at IS NULL)
  )
);
CREATE INDEX ads_market_status_schedule_idx
  ON ads (market_id, status, schedule_start_at, schedule_end_at);
CREATE INDEX ads_placement_status_idx ON ads (placement_id, status);

CREATE TABLE content_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id uuid NOT NULL DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  slug varchar(160) NOT NULL,
  title varchar(180) NOT NULL,
  excerpt text NOT NULL,
  body text NOT NULL,
  cover_media_url text,
  cover_alt_text varchar(240),
  is_promoted boolean NOT NULL DEFAULT false,
  sponsor_label varchar(80),
  status ads_content_status NOT NULL DEFAULT 'DRAFT',
  publish_at timestamptz(6),
  unpublish_at timestamptz(6),
  author_admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  updated_by_admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  archived_at timestamptz(6),
  CONSTRAINT content_articles_public_id_unique UNIQUE (public_id),
  CONSTRAINT content_articles_market_slug_unique UNIQUE (market_id, slug),
  CONSTRAINT content_articles_id_market_unique UNIQUE (id, market_id),
  CONSTRAINT content_articles_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT content_articles_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 180),
  CONSTRAINT content_articles_excerpt_check CHECK (char_length(btrim(excerpt)) BETWEEN 1 AND 500),
  CONSTRAINT content_articles_body_check CHECK (char_length(btrim(body)) BETWEEN 1 AND 50000),
  CONSTRAINT content_articles_version_check CHECK (version > 0),
  CONSTRAINT content_articles_promoted_label_check CHECK (
    is_promoted = false OR char_length(btrim(sponsor_label)) BETWEEN 1 AND 80
  ),
  CONSTRAINT content_articles_schedule_window_check CHECK (
    unpublish_at IS NULL OR (publish_at IS NOT NULL AND unpublish_at > publish_at)
  ),
  CONSTRAINT content_articles_archive_check CHECK (
    (status = 'ARCHIVED' AND archived_at IS NOT NULL)
    OR (status <> 'ARCHIVED' AND archived_at IS NULL)
  )
);
CREATE INDEX content_articles_market_status_schedule_idx
  ON content_articles (market_id, status, publish_at, unpublish_at);

CREATE TABLE ads_content_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  operation varchar(80) NOT NULL,
  key varchar(200) NOT NULL,
  request_hash varchar(64) NOT NULL,
  response jsonb,
  status_code integer,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT ads_content_idempotency_scope_unique
    UNIQUE (admin_user_id, market_id, operation, key),
  CONSTRAINT ads_content_idempotency_hash_check CHECK (char_length(request_hash) = 64),
  CONSTRAINT ads_content_idempotency_result_check CHECK (
    (response IS NULL AND status_code IS NULL)
    OR (response IS NOT NULL AND status_code BETWEEN 200 AND 599)
  )
);

-- E-30: domain history is archived, never physically deleted.
CREATE TRIGGER ad_placements_reject_delete
  BEFORE DELETE ON ad_placements FOR EACH ROW EXECUTE FUNCTION reject_delete();
CREATE TRIGGER ad_fee_configs_reject_delete
  BEFORE DELETE ON ad_fee_configs FOR EACH ROW EXECUTE FUNCTION reject_delete();
CREATE TRIGGER ads_reject_delete
  BEFORE DELETE ON ads FOR EACH ROW EXECUTE FUNCTION reject_delete();
CREATE TRIGGER content_articles_reject_delete
  BEFORE DELETE ON content_articles FOR EACH ROW EXECUTE FUNCTION reject_delete();

-- Canonical P8-S1 permissions. Existing controlled role templates are extended
-- explicitly; there is no Super Admin bypass and no unmanaged role expansion.
INSERT INTO permissions (code, description)
VALUES
  ('ads.view', 'View selected-market advertising operations.'),
  ('ads.manage', 'Manage selected-market advertising lifecycle.'),
  ('content.view', 'View selected-market content operations.'),
  ('content.manage', 'Manage selected-market content lifecycle.')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('ads.view', 'content.view')
WHERE r.code IN (
  'SUPER_ADMIN', 'OPERATIONS_ADMIN', 'FINANCE_OPERATOR',
  'FINANCE_APPROVER', 'KYC_REVIEWER', 'SUPPORT_READONLY_AUDITOR'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('ads.manage', 'content.manage')
WHERE r.code IN ('SUPER_ADMIN', 'OPERATIONS_ADMIN')
ON CONFLICT DO NOTHING;
