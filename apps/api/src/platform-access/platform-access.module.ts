import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { AccessAdministrationService } from './access-administration.service.js';
import { AccessAdministrationController } from './access-administration.controller.js';
import { AdminMarketContextController } from './admin-market-context.controller.js';
import { AdminMarketContextService } from './admin-market-context.service.js';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';
import { MarketService } from './market.service.js';
import { RbacGuard } from './rbac.guard.js';
import { RbacService } from './rbac.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [
    AuditController,
    AccessAdministrationController,
    AdminMarketContextController,
  ],
  providers: [
    AuditService,
    MarketService,
    RbacService,
    RbacGuard,
    AccessAdministrationService,
    AdminMarketContextService,
  ],
  exports: [
    AuditService,
    MarketService,
    RbacService,
    RbacGuard,
    AccessAdministrationService,
    AdminMarketContextService,
  ],
})
export class PlatformAccessModule {}
