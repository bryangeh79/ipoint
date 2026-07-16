import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AccessAdministrationService } from './access-administration.service.js';
import { AuditService } from './audit.service.js';
import { MarketService } from './market.service.js';
import { RbacGuard } from './rbac.guard.js';
import { RbacService } from './rbac.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    AuditService,
    MarketService,
    RbacService,
    RbacGuard,
    AccessAdministrationService,
  ],
  exports: [
    AuditService,
    MarketService,
    RbacService,
    RbacGuard,
    AccessAdministrationService,
  ],
})
export class PlatformAccessModule {}
