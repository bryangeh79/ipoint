/**
 * D-051 — Phase 1 special-percentage owner command types.
 *
 * The secured owner command (`PackageService.createSpecialPercentage`)
 * accepts a server-resolved actor and a validated command. Neither the
 * admin user id nor the market can be supplied by the client — both come
 * from the server guard/context (D-051 §1, §6): `adminUserId` from the
 * authenticated ADMIN_USER session, `currentMarketId` from the canonical
 * RbacGuard market context (`adminMarketContext`).
 */

import type { CreateSpecialPercentageDto } from './dto/package.dto.js';

/**
 * Server-resolved actor for the special-percentage owner command
 * (mirrors the accepted D-054 `CommissionRateAdminActor` shape).
 */
export interface SpecialPercentageAdminActor {
  /** Authenticated admin user id — never client-supplied. */
  adminUserId: string;
  /**
   * Server Current Admin Market (UUID). Optional on the type only so a
   * direct in-process caller without a resolved market is rejected by
   * the owner selection check (D-051 §1) rather than crashing — the
   * client can never supply it.
   */
  currentMarketId?: string;
  /** Market context version from the admin session. */
  marketContextVersion?: number;
  /** Request correlation id (server-issued). */
  requestId?: string;
  /** Client IP address (server-observed). */
  ipAddress?: string;
}

/**
 * Owner create command: the validated DTO plus the mandatory
 * Idempotency-Key (header, server-required).
 */
export interface CreateSpecialPercentageCommand extends CreateSpecialPercentageDto {
  idempotencyKey: string;
}

/**
 * Owner create response returned to the caller.
 */
export interface CreateSpecialPercentageResponse {
  id: string;
  rate: string;
  description: string | null;
  reason: string;
  marketId: string;
  market: string;
  createdBy: string;
  createdAt: string;
}
