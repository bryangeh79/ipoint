import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import supertest from 'supertest';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';

describe('App (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/test');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv(
      'AUTH_OTP_PEPPER',
      'test-otp-pepper-with-at-least-32-characters',
    );
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', 'silent');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app, { enableShutdownHooks: false });
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health/live', () => {
    it('should return 200 with status ok', async () => {
      const res = await supertest(server).get('/health/live').expect(200);

      const body = res.body as Record<string, unknown>;
      expect(body).toHaveProperty('status', 'ok');
      expect(body).toHaveProperty('service', 'ipoint-api');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('version', '0.0.0');
    });
  });

  describe('GET /health/ready', () => {
    it('should return 200 with readiness checks', async () => {
      const res = await supertest(server).get('/health/ready').expect(200);

      const body = res.body as Record<string, unknown>;
      expect(body).toHaveProperty('status', 'ok');
      expect(body).toHaveProperty('service', 'ipoint-api');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('version', '0.0.0');
      expect(body).toHaveProperty('checks');
      expect(body['checks']).toEqual({ config: 'ok' });
    });
  });

  describe('GET /api/v1/health', () => {
    it('should 404 because health routes are not under /api/v1 prefix', async () => {
      const res = await supertest(server)
        .get('/api/v1/health/live')
        .expect(404);

      const body = res.body as Record<string, unknown>;
      expect(body).toHaveProperty('error');
      expect(body['error']).toEqual(
        expect.objectContaining({ code: 'HTTP_404' }) as unknown,
      );
      expect(body).toHaveProperty('requestId');
      expect(body).toHaveProperty('timestamp');
    });
  });

  describe('GET /api/v1/docs', () => {
    it('should return Swagger UI HTML', async () => {
      const res = await supertest(server).get('/api/v1/docs').expect(200);

      expect(res.text).toContain('swagger');
      expect(res.text).toContain('Swagger UI');
    });
  });

  describe('GET /nonexistent-route', () => {
    it('should return 404 with standard error format', async () => {
      const res = await supertest(server).get('/nonexistent-route').expect(404);

      expect(res.body as unknown).toEqual({
        error: {
          code: 'HTTP_404',
          message: expect.any(String) as unknown,
        },
        requestId: expect.any(String) as unknown,
        timestamp: expect.any(String) as unknown,
      });
    });
  });

  describe('x-request-id header passing', () => {
    it('should echo back provided x-request-id', async () => {
      const customId = 'custom-test-request-id-456';
      const res = await supertest(server)
        .get('/health/live')
        .set('x-request-id', customId)
        .expect(200);

      expect(res.headers['x-request-id']).toBe(customId);
    });

    it('should generate a request ID when not provided', async () => {
      const res = await supertest(server).get('/health/live').expect(200);

      expect(res.headers['x-request-id']).toBeDefined();
      expect(typeof res.headers['x-request-id']).toBe('string');
    });
  });
});
