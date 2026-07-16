import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigService } from './config.service.js';

describe('ConfigService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
    process.env.REDIS_URL = 'redis://localhost:6379';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should validate and return environment config', () => {
    const service = new ConfigService();
    expect(service.port).toBe(3000);
    expect(service.host).toBe('0.0.0.0');
    expect(service.logLevel).toBe('info');
    expect(service.appVersion).toBe('0.0.0');
    expect(service.databaseUrl).toBe('postgresql://localhost:5432/test');
    expect(service.redisUrl).toBe('redis://localhost:6379');
  });

  it('should reflect NODE_ENV state', () => {
    process.env.NODE_ENV = 'production';
    const service = new ConfigService();
    expect(service.isDevelopment).toBe(false);
    expect(service.isProduction).toBe(true);
    expect(service.isTest).toBe(false);
  });

  it('should throw on missing DATABASE_URL', () => {
    delete process.env.DATABASE_URL;
    expect(() => new ConfigService()).toThrow();
  });

  it('should throw on invalid URL', () => {
    process.env.REDIS_URL = 'not-a-valid-url';
    expect(() => new ConfigService()).toThrow();
  });

  it('should expose raw config', () => {
    const service = new ConfigService();
    expect(service.raw.NODE_ENV).toBe('development');
    expect(service.raw.PORT).toBe(3000);
  });
});
