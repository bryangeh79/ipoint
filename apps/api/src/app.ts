import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthStatus } from '@ipoint/types';

export interface HealthDependencies {
  checkDatabase: () => Promise<void>;
  checkRedis: () => Promise<void>;
}

export interface AppOptions {
  appVersion: string;
  health: HealthDependencies;
  logger?: boolean;
}

function healthPayload(
  status: HealthStatus['status'],
  version: string,
): HealthStatus {
  return {
    status,
    service: 'ipoint-api',
    timestamp: new Date().toISOString(),
    version,
  };
}

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? true,
    disableRequestLogging: false,
  });

  app.get('/health/live', () => healthPayload('ok', options.appVersion));

  app.get('/health/ready', async (_request, reply) => {
    try {
      await Promise.all([
        options.health.checkDatabase(),
        options.health.checkRedis(),
      ]);
      return healthPayload('ok', options.appVersion);
    } catch (error) {
      app.log.error({ err: error }, 'Readiness dependency check failed');
      return reply
        .code(503)
        .send(healthPayload('degraded', options.appVersion));
    }
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        requestId: request.id,
      },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Unhandled request error');
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        requestId: request.id,
      },
    });
  });

  return app;
}
