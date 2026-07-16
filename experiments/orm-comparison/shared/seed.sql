INSERT INTO markets (id, public_id, code, currency, timezone, status, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'mkt_my',
  'MY',
  'MYR',
  'Asia/Kuala_Lumpur',
  'ACTIVE',
  now()
);

INSERT INTO wallets (
  id, public_id, market_id, owner_type, owner_id, currency, balance, version, updated_at
)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  'wal_poc_primary',
  '00000000-0000-4000-8000-000000000001',
  'MEMBER',
  '00000000-0000-4000-8000-000000000003',
  'MYR',
  0,
  0,
  now()
);

INSERT INTO versioned_rules (
  id, public_id, market_id, rule_type, scope_key, version, status,
  effective_from, payload, created_by
)
VALUES (
  '00000000-0000-4000-8000-000000000004',
  'rule_poc_reward_v1',
  '00000000-0000-4000-8000-000000000001',
  'REWARD_RATE',
  'default',
  1,
  'ACTIVE',
  '2026-01-01T00:00:00Z',
  '{"rate":"0.00050000","unit":"DECIMAL_FRACTION"}',
  '00000000-0000-4000-8000-000000000005'
);
