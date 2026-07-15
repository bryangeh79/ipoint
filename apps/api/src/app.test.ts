import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';

describe('health endpoints', () => {
  it('reports liveness without checking dependencies', async () => {
    const checkDatabase = vi.fn<() => Promise<void>>();
    const checkRedis = vi.fn<() => Promise<void>>();
    const app = buildApp({
      appVersion: 'test',
      health: { checkDatabase, checkRedis },
      logger: false,
    });

    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'ipoint-api',
      version: 'test',
    });
    expect(checkDatabase).not.toHaveBeenCalled();
    expect(checkRedis).not.toHaveBeenCalled();
    await app.close();
  });

  it('reports degraded readiness when a dependency fails', async () => {
    const app = buildApp({
      appVersion: 'test',
      health: {
        checkDatabase: vi
          .fn()
          .mockRejectedValue(new Error('database unavailable')),
        checkRedis: vi.fn().mockResolvedValue(undefined),
      },
      logger: false,
    });

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'degraded' });
    await app.close();
  });
});
