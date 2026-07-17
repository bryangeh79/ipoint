import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module.js';
import { ConfigService } from './config/config.service.js';
import { HealthModule } from './health/health.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { PlatformAccessModule } from './platform-access/platform-access.module.js';
import { MerchantModule } from './merchant/merchant.module.js';
import { CountryChangeModule } from './country-change/country-change.module.js';
import {
  RequestIdMiddleware,
  resolveRequestId,
} from './common/middleware/request-id.middleware.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        pinoHttp: {
          level: configService.logLevel,
          genReqId: (req, res) => {
            const requestId = resolveRequestId(req.headers['x-request-id']);
            (req as unknown as Record<string, unknown>)['requestId'] =
              requestId;
            res.setHeader('x-request-id', requestId);
            return requestId;
          },
          customProps: (req) => ({
            requestId: ((req as unknown as Record<string, unknown>)[
              'requestId'
            ] ?? req.id) as string,
          }),
        },
      }),
    }),
    HealthModule,
    DatabaseModule,
    AuthModule,
    PlatformAccessModule,
    MerchantModule,
    CountryChangeModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
