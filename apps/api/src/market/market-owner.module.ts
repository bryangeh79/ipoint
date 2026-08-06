import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { MarketOwnerController } from './market-owner.controller.js';
import { MarketOwnerService } from './market-owner.service.js';

/**
 * P7-S6E secured market owner module (Phase 7, new).
 *
 * The secured owner command for the `markets` registry
 * (`MarketOwnerService.updateMarket`) lives here — in the Phase 7 market
 * domain — as a NEW module. The existing member-facing behavior
 * (`MarketService` / `MarketController`, `members/me/market`) is
 * untouched.
 *
 * Every owner-level control is enforced inside
 * `MarketOwnerService.updateMarket`: the `market.manage` permission
 * re-check (SUPER_ADMIN only, marketScoped), the server-owned Current
 * Admin Market equality (MARKET_CONTEXT_MISMATCH otherwise), the
 * non-revoked ACTIVE-market grant, the controlled change surface
 * (status ACTIVE → INACTIVE with explicit confirmation + dependency
 * validation; name/currencyCode/timezone/defaultLocale with format
 * validation), the mandatory reason, the operation-scoped idempotency
 * with the canonical payload hash (replay / 409 conflict) and the atomic
 * immutable audit (row + idempotency claim + audit in ONE transaction
 * under a market-scoped advisory lock).
 *
 * The HTTP surface (`MarketOwnerController`) adds only the Phase 7 read
 * projection (`market.read`, ALL roles, marketScoped), the actor build
 * from the RbacGuard `adminMarketContext`, the Idempotency-Key / reason
 * transport and the owner error → HTTP mapping. The canonical RbacGuard
 * enforces permission + step-up + market scope as the first boundary.
 */
@Module({
  imports: [AuthModule, DatabaseModule, PlatformAccessModule],
  controllers: [MarketOwnerController],
  providers: [MarketOwnerService],
  exports: [MarketOwnerService],
})
export class MarketOwnerModule {}
