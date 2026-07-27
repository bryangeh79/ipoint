/**
 * Commission Module DI Wiring Regression Test
 *
 * Verifies that CommissionModule can compile without DI errors.
 * Guards against missing provider imports (e.g., RbacGuard needing RbacService).
 */

import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { CommissionModule } from './commission.module.js';

describe('CommissionModule DI Wiring', () => {
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
