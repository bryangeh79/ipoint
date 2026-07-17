ALTER TABLE merchant_profiles
  ADD COLUMN address jsonb;

CREATE TABLE merchant_api_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  response jsonb,
  status_code integer,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT merchant_api_idempotency_scope_key_unique UNIQUE (scope, key),
  CONSTRAINT merchant_api_idempotency_request_hash_check
    CHECK (char_length(request_hash) = 64),
  CONSTRAINT merchant_api_idempotency_result_check
    CHECK (
      (response IS NULL AND status_code IS NULL)
      OR
      (response IS NOT NULL AND status_code BETWEEN 200 AND 299)
    )
);
