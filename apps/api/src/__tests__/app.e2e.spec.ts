import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import supertest from 'supertest';
import { AppModule } from '../app.module.js';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter.js';

describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/test');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', 'silent');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', {
      exclude: ['health/live', 'health/ready'],
    });
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        errorHttpStatusCode: 400,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health/live', () => {
    it('should return 200 with status ok', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/health/live')
        .expect(200);

      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('service', 'ipoint-api');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('version', '0.0.0');
    });
  });

  describe('GET /health/ready', () => {
    it('should return 200 with readiness checks', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/health/ready')
        .expect(200);

      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('service', 'ipoint-api');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('version', '0.0.0');
      expect(res.body).toHaveProperty('checks');
      expect(res.body.checks).toEqual({ config: 'ok' });
    });
  });

  describe('GET /api/v1/health', () => {
    it('should 404 because health routes are not under /api/v1 prefix', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/health/live')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toHaveProperty('code');
      expect(res.body).toHaveProperty('requestId');
      expect(res.body).toHaveProperty('timestamp');
    });
  });

  describe('GET /api/v1/docs', () => {
    it('should return Swagger UI HTML', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/docs')
        .expect(200);

      expect(res.text).toContain('swagger');
      expect(res.text).toContain('Swagger UI');
    });
  });

  describe('GET /nonexistent-route', () => {
    it('should return 404 with standard error format', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/nonexistent-route')
        .expect(404);

      expect(res.body).toEqual({
        error: {
          code: 'HTTP_404',
          message: expect.any(String),
        },
        requestId: expect.any(String),
        timestamp: expect.any(String),
      });
    });
  });

  describe('x-request-id header passing', () => {
    it('should echo back provided x-request-id', async () => {
      const customId = 'custom-test-request-id-456';
      const res = await supertest(app.getHttpServer())
        .get('/health/live')
        .set('x-request-id', customId)
        .expect(200);

      expect(res.headers['x-request-id']).toBe(customId);
    });

    it('should generate a request ID when not provided', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/health/live')
        .expect(200);

      expect(res.headers['x-request-id']).toBeDefined();
      expect(typeof res.headers['x-request-id']).toBe('string');
    });
  });
});
