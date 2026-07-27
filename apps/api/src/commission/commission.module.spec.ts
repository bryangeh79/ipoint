import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../database/database.service.js';
import { CompensationService } from '../domain/commission/compensation.service.js';
import { CommissionModule } from './commission.module.js';

describe('CommissionModule', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('provides and exports CompensationService for transaction correction wiring', async () => {
    vi.stubEnv(
      'DATABASE_URL',
      'postgresql://ipoint:test@127.0.0.1:5432/ipoint',
    );
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379');
    vi.stubEnv('AUTH_OTP_PEPPER', 'commission-module-test-pepper-32-chars');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', 'silent');

    const moduleRef = await Test.createTestingModule({
      imports: [CommissionModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({})
      .compile();

    expect(moduleRef.get(CompensationService)).toBeInstanceOf(
      CompensationService,
    );
    await moduleRef.close();
  });
});
