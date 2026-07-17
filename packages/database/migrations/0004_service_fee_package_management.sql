CREATE TYPE service_fee_version_status AS ENUM (
  'DRAFT', 'SCHEDULED', 'ACTIVE', 'EXPIRED', 'CANCELLED'
);

CREATE TYPE package_change_request_status AS ENUM (
  'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'
);

ALTER TABLE service_fee_profiles
  ADD COLUMN market_id uuid REFERENCES markets(id) ON DELETE RESTRICT;

ALTER TABLE service_fee_versions
  ALTER COLUMN status DROP DEFAULT;
ALTER TABLE service_fee_versions
  ALTER COLUMN status TYPE service_fee_version_status
  USING CASE status::text
    WHEN 'ACTIVE' THEN 'ACTIVE'::service_fee_version_status
    ELSE 'DRAFT'::service_fee_version_status
  END;
ALTER TABLE service_fee_versions
  ALTER COLUMN status SET DEFAULT 'DRAFT';

CREATE TABLE merchant_package_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_branch_id uuid NOT NULL REFERENCES merchant_branches(id) ON DELETE RESTRICT,
  requested_service_fee_version_id uuid NOT NULL REFERENCES service_fee_versions(id) ON DELETE RESTRICT,
  requested_by_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  status package_change_request_status NOT NULL DEFAULT 'PENDING',
  reason text NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT merchant_package_change_requests_reason_check CHECK (length(trim(reason)) > 0)
);
CREATE UNIQUE INDEX merchant_package_change_requests_open_unique
  ON merchant_package_change_requests (merchant_branch_id)
  WHERE status = 'PENDING';

CREATE FUNCTION protect_service_fee_reference_data() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'special_percentages' THEN
    RAISE EXCEPTION 'special percentages are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM merchant_package_assignments
    WHERE service_fee_version_id = OLD.id
  ) AND (
    NEW.rate IS DISTINCT FROM OLD.rate OR
    NEW.effective_from IS DISTINCT FROM OLD.effective_from OR
    NEW.effective_to IS DISTINCT FROM OLD.effective_to
  ) THEN
    RAISE EXCEPTION 'assigned service fee version fields are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER special_percentages_immutable
BEFORE UPDATE OR DELETE ON special_percentages
FOR EACH ROW EXECUTE FUNCTION protect_service_fee_reference_data();

CREATE TRIGGER assigned_service_fee_version_immutable
BEFORE UPDATE ON service_fee_versions
FOR EACH ROW EXECUTE FUNCTION protect_service_fee_reference_data();
