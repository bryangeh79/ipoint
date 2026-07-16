import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module.js';
import { ConfigService } from './config/config.service.js';
import { HealthModule } from './health/health.module.js';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        pinoHttp: {
          level: configService.logLevel,
          transport:
            configService.isDevelopment
              ? { target: 'pino-pretty', options: { colorize: true } }
              : undefined,
          customProps: (req) => ({
            requestId:
              ((req as unknown) as Record<string, unknown>)['requestId'] as string,
          }),
          serializers: {
            req: (req) => ({
              method: req.method,
              url: req.url,
              requestId:
                ((req as unknown) as Record<string, unknown>)['requestId'] as string,
            }),
            res: (res) => ({
              statusCode: res.statusCode,
            }),
          },
        },
      }),
    }),
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
