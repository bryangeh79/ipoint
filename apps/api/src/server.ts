import { PrismaClient } from '@prisma/client';
import { parseServerEnvironment } from '@ipoint/config';
import { Redis } from 'ioredis';
import { buildApp } from './app.js';

const environment = parseServerEnvironment(process.env);
const prisma = new PrismaClient();
const redis = new Redis(environment.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

const app = buildApp({
  appVersion: environment.APP_VERSION,
  health: {
    checkDatabase: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    checkRedis: async () => {
      if (redis.status === 'wait') await redis.connect();
      await redis.ping();
    },
  },
});

app.addHook('onClose', async () => {
  await Promise.all([
    prisma.$disconnect(),
    redis.quit().catch(() => undefined),
  ]);
});

try {
  await app.listen({ host: environment.HOST, port: environment.PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'API failed to start');
  process.exitCode = 1;
}
