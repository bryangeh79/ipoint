/**
 * Commission Module DI Wiring Regression Test
 *
 * Verifies that CommissionModule can compile without DI errors.
 * Guards against missing provider imports (e.g., RbacGuard needing RbacService).
 */

import { Test } from '@nestjs/testing';
import { describe, expect, it, beforeAll, vi } from 'vitest';
import { CommissionModule } from './commission.module.js';

describe('CommissionModule DI Wiring', () => {
  beforeAll(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', 'silent');
    vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv('AUTH_OTP_PEPPER', 'commission-di-test-otp-pepper-32chars');
    vi.stubEnv('AUTH_OTP_TTL_SECONDS', '600');
    vi.stubEnv('AUTH_ACCESS_TTL_SECONDS', '900');
    vi.stubEnv('AUTH_REFRESH_TTL_SECONDS', '2592000');
    vi.stubEnv('AUTH_IDEMPOTENCY_TTL_SECONDS', '86400');
  });

  it('compiles without UnknownDependenciesException', async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [CommissionModule],
    }).compile();

    expect(moduleFixture).toBeDefined();

    // Verify key providers are resolvable
    const rbacGuard = moduleFixture.get('RbacGuard');
    expect(rbacGuard).toBeDefined();

    const rbacService = moduleFixture.get('RbacService');
    expect(rbacService).toBeDefined();

    await moduleFixture.close();
  });
});
