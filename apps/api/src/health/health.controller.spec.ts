import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller.js';
import { ConfigService } from '../config/config.service.js';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    // Set required env vars
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/test');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [ConfigService],
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
    it('should return status ok with readiness checks', () => {
      const result = controller.checkReadiness();

      expect(result).toHaveProperty('status', 'ok');
      expect(result).toHaveProperty('service', 'ipoint-api');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('version', '0.0.0');
      expect(result).toHaveProperty('checks');
      expect(result.checks).toEqual({ config: 'ok' });
    });
  });
});
