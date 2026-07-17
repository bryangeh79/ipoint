import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ConfigService } from './config/config.service.js';

interface ApplicationSetupOptions {
  enableShutdownHooks?: boolean;
  scanSwaggerRoutes?: boolean;
}

export function configureApplication(
  app: INestApplication,
  options: ApplicationSetupOptions = {},
): void {
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

  const configService = app.get(ConfigService);
  const swaggerConfig = new DocumentBuilder()
    .setTitle('iPoint API')
    .setDescription('iPoint Backend API')
    .setVersion(configService.appVersion)
    .addServer(`http://localhost:${configService.port}`)
    .build();
  const document =
    options.scanSwaggerRoutes === false
      ? { ...swaggerConfig, paths: {} }
      : SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/v1/docs', app, document);

  if (options.enableShutdownHooks ?? true) {
    app.enableShutdownHooks();
  }
}
