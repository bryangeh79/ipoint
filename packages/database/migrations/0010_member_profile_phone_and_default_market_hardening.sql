-- 0010: Member Profile phone verification, display_name nullable, default market hardening
-- Adds phone verification columns, CHECK constraints, unique index, display_name nullable

-- 1. Phone verification columns
ALTER TABLE member_profiles
  ADD COLUMN IF NOT EXISTS phone_normalized text,
  ADD COLUMN IF NOT EXISTS phone_verification_status text NOT NULL DEFAULT 'NOT_PROVIDED',
  ADD COLUMN IF NOT EXISTS phone_changed_at timestamptz(6),
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz(6);

-- 2. CHECK constraint: phone_verification_status must be valid enum
ALTER TABLE member_profiles
  ADD CONSTRAINT check_phone_verification_status
  CHECK (phone_verification_status IN ('NOT_PROVIDED', 'PENDING', 'VERIFIED'));

-- 3. CHECK constraint: When phone is NULL, verification fields must be consistent
ALTER TABLE member_profiles
  ADD CONSTRAINT check_phone_null_consistency
  CHECK (
    (phone IS NULL AND phone_normalized IS NULL AND phone_verification_status = 'NOT_PROVIDED' AND phone_verified_at IS NULL)
    OR
    (phone IS NOT NULL)
  );

-- 4. CHECK constraint: When phone exists but not verified, normalized must be set
ALTER TABLE member_profiles
  ADD CONSTRAINT check_phone_pending_consistency
  CHECK (
    (phone_verification_status IN ('NOT_PROVIDED', 'PENDING') AND phone_normalized IS NOT NULL AND phone_verified_at IS NULL)
    OR
    (phone_verification_status = 'VERIFIED')
    OR
    (phone IS NULL AND phone_verification_status = 'NOT_PROVIDED')
  );

-- 5. CHECK constraint: VERIFIED status requires normalized and verified_at
ALTER TABLE member_profiles
  ADD CONSTRAINT check_phone_verified_consistency
  CHECK (
    (phone_verification_status = 'VERIFIED' AND phone_normalized IS NOT NULL AND phone_verified_at IS NOT NULL)
    OR
    (phone_verification_status != 'VERIFIED')
  );

-- 6. Platform-wide unique partial index on normalized phone (where provided)
CREATE UNIQUE INDEX IF NOT EXISTS member_profiles_phone_normalized_unique
  ON member_profiles (phone_normalized)
  WHERE phone_normalized IS NOT NULL;

-- 7. Make display_name nullable
ALTER TABLE member_profiles
  ALTER COLUMN display_name DROP NOT NULL;

-- 8. Verify existing is_current unique index exists (P2-S2 already created it)
-- DO NOT create a duplicate - it already exists from migration 0007
