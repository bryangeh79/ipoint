CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE merchant_branches
  ADD COLUMN is_publicly_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN is_online boolean NOT NULL DEFAULT false,
  ADD COLUMN is_offline boolean NOT NULL DEFAULT false,
  ADD COLUMN coordinates point,
  ADD COLUMN display_order integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT merchant_branches_coordinates_check CHECK (
    coordinates IS NULL
    OR (
      coordinates[0] BETWEEN -180 AND 180
      AND coordinates[1] BETWEEN -90 AND 90
    )
  ),
  ADD CONSTRAINT merchant_branches_display_order_check CHECK (display_order >= 0),
  ADD CONSTRAINT merchant_branches_id_market_unique UNIQUE (id, market_id);

-- Current-market discovery contract:
-- status = ACTIVE, is_publicly_visible = true, then deterministic
-- display_order/name/id ordering. Existing branches remain hidden until reviewed.
CREATE INDEX merchant_branches_discovery_idx
  ON merchant_branches (market_id, is_publicly_visible, display_order, name, id)
  WHERE status = 'ACTIVE';

-- PostgreSQL point stores x/y as longitude/latitude respectively.
CREATE INDEX merchant_branches_coordinates_gist_idx
  ON merchant_branches USING gist (coordinates point_ops)
  WHERE status = 'ACTIVE'
    AND is_publicly_visible = true
    AND coordinates IS NOT NULL;

CREATE INDEX merchant_branches_name_search_idx
  ON merchant_branches USING gin (name gin_trgm_ops)
  WHERE status = 'ACTIVE' AND is_publicly_visible = true;

CREATE INDEX merchant_profiles_about_search_idx
  ON merchant_profiles USING gin (about_us gin_trgm_ops)
  WHERE about_us IS NOT NULL;

CREATE TABLE merchant_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT merchant_categories_market_code_unique UNIQUE (market_id, code),
  CONSTRAINT merchant_categories_id_market_unique UNIQUE (id, market_id),
  CONSTRAINT merchant_categories_code_check CHECK (btrim(code) <> ''),
  CONSTRAINT merchant_categories_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT merchant_categories_sort_order_check CHECK (sort_order >= 0)
);

CREATE INDEX merchant_categories_market_active_idx
  ON merchant_categories (market_id, is_active, sort_order, name);

CREATE TABLE merchant_branch_categories (
  merchant_branch_id uuid NOT NULL,
  category_id uuid NOT NULL,
  market_id uuid NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_branch_id, category_id),
  CONSTRAINT merchant_branch_categories_branch_market_fk
    FOREIGN KEY (merchant_branch_id, market_id)
    REFERENCES merchant_branches(id, market_id) ON DELETE RESTRICT,
  CONSTRAINT merchant_branch_categories_category_market_fk
    FOREIGN KEY (category_id, market_id)
    REFERENCES merchant_categories(id, market_id) ON DELETE RESTRICT
);

CREATE INDEX merchant_branch_categories_category_idx
  ON merchant_branch_categories (market_id, category_id, merchant_branch_id);

CREATE UNIQUE INDEX merchant_branch_categories_primary_unique
  ON merchant_branch_categories (merchant_branch_id)
  WHERE is_primary = true;
