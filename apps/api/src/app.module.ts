import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module.js';
import { ConfigService } from './config/config.service.js';
import { HealthModule } from './health/health.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { PlatformAccessModule } from './platform-access/platform-access.module.js';
import { MerchantModule } from './merchant/merchant.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { MarketModule } from './market/market.module.js';
import { CountryChangeModule } from './country-change/country-change.module.js';
import { KycModule } from './kyc/kyc.module.js';
import { AdminKycModule } from './admin-kyc/admin-kyc.module.js';
import { DiscoveryModule } from './discovery/discovery.module.js';
import { AdminMemberModule } from './admin-member/admin-member.module.js';
import { AdminRewardModule } from './admin-reward/admin-reward.module.js';
import { RewardModule } from './reward/reward.module.js';
import { WalletModule } from './wallet/wallet.module.js';
import { DailyJobModule } from './daily-job/job.module.js';
import { TransactionModule } from './transaction/transaction.module.js';
import { AgentActivationModule } from './agent-activation/agent-activation.module.js';
import { ReferralModule } from './referral/referral.module.js';
import { CommissionModule } from './commission/commission.module.js';
import { RedemptionModule } from './redemption/redemption.module.js';
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
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers.idempotency-key',
              'req.body.memberQrToken',
              'req.body.password',
              'req.body.refreshToken',
              'res.headers.set-cookie',
            ],
            censor: '[REDACTED]',
          },
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
    ProfileModule,
    MarketModule,
    CountryChangeModule,
    KycModule,
    AdminKycModule,
    DiscoveryModule,
    AdminMemberModule,
    AdminRewardModule,
    RewardModule,
    WalletModule,
    DailyJobModule,
    TransactionModule,
    AgentActivationModule,
    ReferralModule,
    CommissionModule,
    RedemptionModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
