/**
 * Commission Rate Owner — domain types (D-054, CG-04 gate).
 *
 * Mirrors the accepted D-050 (Phase 3 reward rule) / D-053 (Phase 6
 * redemption rate) owner contracts: a server-created actor/context object
 * and an owner command. The client can never supply an authoritative actor
 * or market — every control is re-enforced inside
 * `RateManagementService.createRateVersion`.
 *
 * @packageDocumentation
 */

/**
 * Server-created actor/context for the secured commission-rate owner.
 * Built by the controller from the authenticated session (CurrentActor),
 * the RbacGuard-resolved Current Admin Market, the request correlation id
 * and the IP address. Caller-supplied `createdBy` values are never
 * accepted anywhere on this surface.
 */
export interface CommissionRateAdminActor {
  /** Authenticated ADMIN_USER principal id (server-asserted). */
  adminUserId: string;
  /** Server Current Admin Market (UUID, from `adminMarketContext`). */
  currentMarketId?: string;
  /** Market-context version for the selected market. */
  marketContextVersion?: number;
  /** Request correlation id (server-attributed). */
  requestId?: string;
  /** Client IP evidence for the privileged audit trail. */
  ipAddress?: string;
}

/**
 * Secured commission-rate owner create command (D-054 §5-§12).
 *
 * `market` is the canonical market CODE (e.g. 'MY'). It must equal the
 * code of the server Current Admin Market (the owner resolves the market
 * row by `actor.currentMarketId` and compares — a mismatch is 409).
 * `effectiveFrom` must be the exact UTC instant of a strictly future
 * market-local 00:00 in the selected market's IANA timezone. `effectiveUntil`
 * is optional (NULL = open-ended; half-open [effectiveFrom, effectiveUntil)
 * windows; a successor may start exactly at its predecessor's stored end).
 * The Idempotency-Key and the operator `reason` are mandatory.
 */
export interface CreateRateVersionCommand {
  /** Canonical market code (2-letter uppercase, e.g. 'MY'). */
  market: string;
  /** AGENT_UPGRADE | MEMBER_CONSUMPTION | MERCHANT_RECRUITMENT | AGENT_ACTIVATION_FEE. */
  commissionType: string;
  /** 0 (single-gen) | 1 (G1) | 2 (G2) — validated per commission type. */
  generation: number;
  /** Exact rate as a decimal string (NUMERIC(38,10), ≤10 technical decimals). */
  rateValue: string;
  /** PERCENTAGE or FIXED — must match the frozen commission-type contract. */
  rateType: string;
  /** UTC ISO instant of a strictly future market-local 00:00. */
  effectiveFrom: string;
  /** Optional end of the half-open window (UTC ISO, after effectiveFrom). */
  effectiveUntil?: string | null;
  /** Optional IANA timezone evidence; must equal the selected market's. */
  timezone?: string;
  /** Mandatory non-blank operator reason (1..500 chars). */
  reason: string;
  /** Mandatory Idempotency-Key (1..200 chars, operation-scoped). */
  idempotencyKey: string;
}

/**
 * Result returned by the secured owner create command (also the exact
 * payload persisted for idempotent replay).
 */
export interface CreateRateVersionResponse {
  /** The created rate version UUID. */
  id: string;
  /** Commission type. */
  commissionType: string;
  /** Generation. */
  generation: number;
  /** Canonical market code. */
  market: string;
  /** Market UUID (server Current Admin Market). */
  marketId: string;
  /** Market currency code (FIXED rates are denominated in it). */
  currency: string;
  /** The exact rate value as stored (decimal string). */
  rateValue: string;
  /** Rate type: PERCENTAGE or FIXED. */
  rateType: string;
  /** Resolved UTC instant of the market-local midnight (ISO 8601). */
  effectiveFrom: string;
  /** Market-local wall time of the activation instant. */
  effectiveFromLocal: string;
  /** IANA timezone of the selected market (storage evidence). */
  timezone: string;
  /** End of the half-open window (null = open-ended). */
  effectiveUntil: string | null;
  /** The durable operator reason. */
  reason: string;
  /** Admin UUID who created this rate version (server actor). */
  createdBy: string;
  /** When this version was created (ISO 8601). */
  createdAt: string;
}
