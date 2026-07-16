import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApplication } from './app.setup.js';
import { ConfigService } from './config/config.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Use Pino logger
  const logger = app.get(Logger);
  app.useLogger(logger);

  const configService = app.get(ConfigService);
  configureApplication(app);

  const host = configService.host;
  const port = configService.port;
  await app.listen(port, host);

  logger.log(
    `iPoint API server running on http://${host}:${port}`,
    'Bootstrap',
  );
  logger.log(
    `Swagger docs available at http://${host}:${port}/api/v1/docs`,
    'Bootstrap',
  );
}

bootstrap().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
