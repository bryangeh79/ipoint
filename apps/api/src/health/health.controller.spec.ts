import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller.js';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { RedisClientService } from '../redis/redis.client.js';

describe('HealthController', () => {
  let controller: HealthController;

  const databaseHealthy = vi.fn<() => Promise<boolean>>();
  const redisAvailable = vi.fn<() => Promise<boolean>>();

  beforeEach(async () => {
    vi.clearAllMocks();
    // Set required env vars
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/test');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv(
      'AUTH_OTP_PEPPER',
      'test-otp-pepper-with-at-least-32-characters',
    );

    databaseHealthy.mockResolvedValue(true);
    redisAvailable.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        ConfigService,
        {
          provide: DatabaseService,
          useValue: {
            pool: {
              query: vi.fn(async () => {
                if (!(await databaseHealthy())) throw new Error('db down');
                return { rows: [{ '?column?': 1 }] };
              }),
            },
          },
        },
        {
          provide: RedisClientService,
          useValue: { isAvailable: redisAvailable },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('checkLiveness', () => {
    it('should return status ok with service info', () => {
      const result = controller.checkLiveness();

      expect(result).toHaveProperty('status', 'ok');
      expect(result).toHaveProperty('service', 'ipoint-api');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('version', '0.0.0');
      expect(typeof result.timestamp).toBe('string');
    });
  });

  describe('checkReadiness', () => {
    it('should report ok when config, database and redis all pass', async () => {
      const result = await controller.checkReadiness();

      expect(result).toHaveProperty('status', 'ok');
      expect(result).toHaveProperty('service', 'ipoint-api');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('version', '0.0.0');
      expect(result.checks).toEqual({
        config: 'ok',
        database: 'ok',
        redis: 'ok',
      });
    });

    it('should report degraded when the database is unavailable', async () => {
      databaseHealthy.mockResolvedValue(false);

      const result = await controller.checkReadiness();

      expect(result.status).toBe('degraded');
      expect(result.checks.database).toBe('unavailable');
      expect(result.checks.redis).toBe('ok');
    });

    it('should report degraded when redis is unavailable', async () => {
      redisAvailable.mockResolvedValue(false);

      const result = await controller.checkReadiness();

      expect(result.status).toBe('degraded');
      expect(result.checks.database).toBe('ok');
      expect(result.checks.redis).toBe('unavailable');
    });
  });
});
