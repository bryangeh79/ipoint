import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  adminUsers,
  commissionRateVersions,
  marketAccess,
  markets,
  memberMarketPreferences,
  merchantApiIdempotencyKeys,
  merchantBranches,
  redemptionRateMarketRules,
  rewardRuleVersions,
  type Database,
} from '@ipoint/database';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import { RbacService } from '../platform-access/rbac.service.js';
import {
  marketAccessDeniedError,
  marketContextMismatchError,
  marketDeactivationConfirmationRequiredError,
  marketDeactivationDependencyError,
  marketIdempotencyConflictError,
  marketIdempotencyKeyRequiredError,
  marketInvalidFieldError,
  marketNoChangesError,
  marketNotFoundError,
  marketPermissionDeniedError,
  marketReasonRequiredError,
  marketSelectionRequiredError,
  marketUpdateFailedError,
} from './market-owner.errors.js';
import type {
  MarketDetailResponse,
  MarketOwnerActor,
  UpdateMarketCommand,
  UpdateMarketResponse,
} from './market-owner.types.js';
import { MarketOwnerError } from './market-owner.types.js';

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type DbExecutor = Database | DbTransaction;

/** Controlled change surface of the markets registry (owner allowlist). */
type MarketControlledField =
  | 'status'
  | 'name'
  | 'currencyCode'
  | 'timezone'
  | 'defaultLocale';

/** Idempotency scope namespace for the OWNER update command. */
const MARKET_OWNER_IDEMPOTENCY_SCOPE = 'market.owner.update';

/** Advisory-lock namespace for the owner market-update serialization. */
const MARKET_OWNER_LOCK_NAMESPACE = 0x5f7_0006n; // owner domain constant

/** BCP-47-style locale grammar (transport + owner shared). */
export const MARKET_LOCALE_PATTERN = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/u;

/**
 * P7-S6E secured market owner (D-048 implementer scope, Phase 7 market
 * domain). The secured owner command for the `markets` registry lives in
 * `apps/api/src/market/` as a NEW module — the existing member-facing
 * behavior (`MarketService.getMarket` / `updateMarket`,
 * `MarketController`) is untouched.
 *
 * Owner contract (every control lives HERE — an in-process caller gets
 * the exact same enforcement as the HTTP route):
 *
 * 1. `market.manage` permission re-checked server-side (canonical
 *    catalog, SUPER_ADMIN only, marketScoped, step-up required at the
 *    route).
 * 2. Admin identity validation (authenticated ADMIN_USER actor, ACTIVE
 *    admin + account, non-revoked market grant, ACTIVE market).
 * 3. Selected-market enforcement: a server-owned Current Admin Market is
 *    required.
 * 4. Resource-market consistency: the command market MUST equal the
 *    server Current Admin Market (MARKET_CONTEXT_MISMATCH otherwise).
 * 5. Controlled change surface only: status (ACTIVE ↔ INACTIVE — the
 *    reachable transition is ACTIVE → INACTIVE because the guard and the
 *    owner both require an ACTIVE market), name (trim 1..200),
 *    currencyCode (3 uppercase letters), timezone (valid IANA),
 *    defaultLocale (BCP-47-style). No batch, no cross-market replication,
 *    no silent defaults. Unknown fields are rejected by the strict
 *    transport DTO AND by the owner's field allowlist.
 * 6. Deactivation (ACTIVE → INACTIVE) requires the explicit
 *    `deactivationConfirmed` flag plus a dependency check: active
 *    merchants, members with an enabled market preference, and active /
 *    future configuration references (reward rule versions,
 *    commission rate versions, redemption rate rules) block the
 *    transition (MARKET_DEACTIVATION_DEPENDENCY).
 * 7. Mandatory reason (trim, 1..500).
 * 8. Mandatory Idempotency-Key (operation-scoped: unique (scope, key)
 *    mechanism row) + canonical payload hash (sorted keys + sha256);
 *    same key + same payload replays the original result, same key +
 *    different payload → 409 MARKET_IDEMPOTENCY_CONFLICT.
 * 9. Transaction-scoped advisory lock per market (exactly one winner
 *    under a concurrent race; the losing command waits then observes the
 *    winner's row and returns a stable conflict / replay).
 * 10. Atomic immutable audit: the market row update + the idempotency
 *     claim/response + the privileged audit row all commit in ONE
 *     transaction (any failure rolls everything back).
 *
 * Read projection (`getMarketDetail`) is `market.read` (ALL roles,
 * marketScoped) and reports the explicit blocked state (`configured:
 * false`) for a market that is not ACTIVE — no cross-market fallback.
 */
@Injectable()
export class MarketOwnerService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  // ─── Read projection (market.read, ALL roles, marketScoped) ────────

  /**
   * Selected-market registry read: id, code, name, status, currency,
   * timezone, default locale and timestamps. A market that is not ACTIVE
   * is reported with the explicit blocked state (`configured: false`, no
   * fallback). Over HTTP the canonical RbacGuard denies non-ACTIVE
   * markets with 403 first (guard = first boundary); `configured: false`
   * is the defensive in-process signal.
   */
  async getMarketDetail(marketId: string): Promise<MarketDetailResponse> {
    const row = await this.marketRow(marketId);
    if (!row) throw marketNotFoundError();
    return this.toDetailResponse(row);
  }

  // ─── Secured update owner command ─────────────────────────────────

  /**
   * Apply a controlled update to the selected market.
   *
   * `marketId` is the route resource; `command` carries the controlled
   * fields plus the mandatory `reason` and `idempotencyKey` (the owner
   * re-enforces them even when an in-process caller omits them at the
   * type level). `deactivationConfirmed` is the server-side explicit
   * confirmation for the ACTIVE → INACTIVE transition.
   */
  async updateMarket(
    actor: MarketOwnerActor,
    marketId: string,
    command: UpdateMarketCommand,
  ): Promise<UpdateMarketResponse> {
    // ── 1+2. Identity + permission (server-side, in-process-safe) ────
    if (!actor?.adminUserId) throw marketPermissionDeniedError();
    const allowed = await this.rbac.isAllowed({
      adminUserId: actor.adminUserId,
      permission: 'market.manage',
    });
    if (!allowed) throw marketPermissionDeniedError();

    // ── 7. Mandatory reason (blank/overlength rejected) ──────────────
    const reason = command.reason?.trim() ?? '';
    if (!reason || reason.length > 500) throw marketReasonRequiredError();

    // ── 8. Mandatory Idempotency-Key ─────────────────────────────────
    const idempotencyKey = command.idempotencyKey?.trim() ?? '';
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw marketIdempotencyKeyRequiredError();
    }

    // ── 3+4. Selected-market + resource-market consistency ───────────
    if (!actor.currentMarketId) throw marketSelectionRequiredError();
    if (actor.currentMarketId !== marketId) {
      throw marketContextMismatchError();
    }
    await this.assertMarketAccess(
      this.database.db,
      actor.adminUserId,
      marketId,
    );
    const market = await this.marketRow(marketId);
    if (!market) throw marketNotFoundError();

    // ── 5. Controlled change surface (field allowlist + formats) ─────
    const requested = this.pickControlledFields(command);
    if (requested.length === 0) throw marketNoChangesError();
    const normalized = this.validateFields(requested);

    // ── 8. Canonical payload hash (sorted keys + sha256). The digest is
    //    computed from the REQUEST (normalized requested fields + market +
    //    reason) — not from the current-state diff — so a same-key/same-
    //    payload replay is deterministic even after the market row
    //    changed. ──────────────────────────────────────────────────────
    const payloadHash = canonicalPayloadHash({
      marketId,
      ...Object.fromEntries(
        normalized.map((change) => [change.field, change.after]),
      ),
      reason,
    });

    const scope = `${MARKET_OWNER_IDEMPOTENCY_SCOPE}:${marketId}:${actor.adminUserId}`;
    const lockKey = marketOwnerLockKey(marketId);

    // ── 9/10/6/8: atomic update with lock, dependency re-check,
    //    idempotency claim and privileged audit — one transaction. ────
    try {
      return await this.database.runTransaction(async (tx) => {
        // 9. Serialize the whole operation per market. The lock is
        // transaction-scoped: it auto-releases at commit/rollback, so a
        // losing concurrent command waits, then observes the winner's row
        // and returns a stable conflict (or the exact replay).
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

        // 8. Claim the operation key FIRST — before any current-state
        // comparison — so a same-key/same-payload replay returns the
        // stored result even when the market row already reflects the
        // payload (and a same-key/different-payload conflict is stable).
        // On any later throw the claim rolls back with the transaction so
        // the same key can be retried after correction.
        const claimed = await tx
          .insert(merchantApiIdempotencyKeys)
          .values({ scope, key: idempotencyKey, requestHash: payloadHash })
          .onConflictDoNothing({
            target: [
              merchantApiIdempotencyKeys.scope,
              merchantApiIdempotencyKeys.key,
            ],
          })
          .returning({ id: merchantApiIdempotencyKeys.id });

        if (claimed.length === 0) {
          const existing = await tx
            .select()
            .from(merchantApiIdempotencyKeys)
            .where(
              and(
                eq(merchantApiIdempotencyKeys.scope, scope),
                eq(merchantApiIdempotencyKeys.key, idempotencyKey),
              ),
            )
            .limit(1);
          const row = existing[0];
          if (
            !row ||
            row.response === null ||
            row.requestHash !== payloadHash
          ) {
            throw marketIdempotencyConflictError();
          }
          return row.response as unknown as UpdateMarketResponse;
        }

        // Re-read the market inside the lock: the authoritative before
        // values and the ACTIVE status (a concurrent deactivation must
        // not race past the owner).
        const lockedMarket = await this.marketRowTx(tx, marketId);
        if (!lockedMarket) throw marketNotFoundError();
        if (lockedMarket.status !== 'ACTIVE') throw marketAccessDeniedError();
        const lockedChanges = normalized
          .filter(
            (change) =>
              change.after !== this.marketValue(lockedMarket, change.field),
          )
          .map((change) => ({
            ...change,
            before: this.marketValue(lockedMarket, change.field),
          }));
        if (lockedChanges.length === 0) throw marketNoChangesError();
        const lockedStatusChange = lockedChanges.find(
          (change) => change.field === 'status',
        );
        if (
          lockedStatusChange &&
          lockedStatusChange.before === 'ACTIVE' &&
          lockedStatusChange.after === 'INACTIVE' &&
          command.deactivationConfirmed !== true
        ) {
          throw marketDeactivationConfirmationRequiredError();
        }

        // 6. Deactivation dependency check inside the lock (the same key
        // retried after a failed dependency check gets a fresh gate).
        if (
          lockedStatusChange &&
          lockedStatusChange.before === 'ACTIVE' &&
          lockedStatusChange.after === 'INACTIVE'
        ) {
          await this.assertNoDeactivationDependencies(
            tx,
            marketId,
            lockedMarket.code,
          );
        }

        // ── Controlled UPDATE of the market row ──────────────────────
        const updateValues = Object.fromEntries(
          lockedChanges.map((change) => [change.field, change.after]),
        ) as Partial<typeof markets.$inferInsert>;
        const updated = await tx
          .update(markets)
          .set({ ...updateValues, updatedAt: new Date() })
          .where(eq(markets.id, marketId))
          .returning();
        const updatedRow = updated[0];
        if (!updatedRow) throw marketUpdateFailedError();

        // 10. Atomic immutable audit — same transaction as the update.
        await this.audit.appendWithinTransaction(tx, {
          actor: { type: 'ADMIN_USER', id: actor.adminUserId },
          action: 'market.owner.update',
          entity: { type: 'market', id: marketId },
          marketId,
          before: Object.fromEntries(
            lockedChanges.map((change) => [change.field, change.before]),
          ),
          after: Object.fromEntries(
            lockedChanges.map((change) => [change.field, change.after]),
          ),
          reason,
          result: 'SUCCESS',
          requestId: actor.requestId ?? idempotencyKey,
          ipAddress: actor.ipAddress,
          summary: `Administrator updated market ${lockedMarket.code}: ${lockedChanges.map((change) => `${change.field} ${String(change.before)} → ${String(change.after)}`).join(', ')}.`,
        });

        const response: UpdateMarketResponse = {
          id: updatedRow.id,
          code: updatedRow.code,
          name: updatedRow.name,
          status: updatedRow.status,
          currencyCode: updatedRow.currencyCode,
          timezone: updatedRow.timezone,
          defaultLocale: updatedRow.defaultLocale,
          updatedAt: updatedRow.updatedAt.toISOString(),
          changed: lockedChanges.map((change) => ({
            field: change.field,
            before: change.before,
            after: change.after,
          })),
          idempotencyDigest: payloadHash,
        };

        // 8. Persist the original result for exact replay.
        await tx
          .update(merchantApiIdempotencyKeys)
          .set({ response, statusCode: 200, updatedAt: new Date() })
          .where(eq(merchantApiIdempotencyKeys.id, claimed[0]?.id ?? ''));

        return response;
      });
    } catch (error) {
      // Owner rejections propagate verbatim; unexpected persistence errors
      // surface as MARKET_UPDATE_FAILED (never swallowed into a 2xx).
      if (error instanceof MarketOwnerError) {
        throw error;
      }
      throw marketUpdateFailedError();
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private pickControlledFields(
    command: UpdateMarketCommand,
  ): Array<{ field: MarketControlledField; value: unknown }> {
    const picked: Array<{ field: MarketControlledField; value: unknown }> = [];
    if (command.status !== undefined)
      picked.push({ field: 'status', value: command.status });
    if (command.name !== undefined)
      picked.push({ field: 'name', value: command.name });
    if (command.currencyCode !== undefined)
      picked.push({ field: 'currencyCode', value: command.currencyCode });
    if (command.timezone !== undefined)
      picked.push({ field: 'timezone', value: command.timezone });
    if (command.defaultLocale !== undefined)
      picked.push({ field: 'defaultLocale', value: command.defaultLocale });
    return picked;
  }

  /**
   * Format validation of every requested field (transport is only the
   * fast-fail; the owner re-validates). Returns the normalized values so
   * trims are applied exactly once.
   */
  private validateFields(
    requested: ReadonlyArray<{
      field: MarketControlledField;
      value: unknown;
    }>,
  ): Array<{ field: MarketControlledField; before: unknown; after: unknown }> {
    const problems: Array<{ field: string; message: string }> = [];
    const resolved: Array<{
      field: MarketControlledField;
      before: unknown;
      after: unknown;
    }> = [];

    for (const { field, value } of requested) {
      switch (field) {
        case 'name': {
          const name = typeof value === 'string' ? value.trim() : '';
          if (!name || name.length > 200) {
            problems.push({
              field,
              message: 'Market name must be 1..200 characters.',
            });
          } else {
            resolved.push({ field, before: undefined, after: name });
          }
          break;
        }
        case 'currencyCode': {
          const currencyCode = typeof value === 'string' ? value.trim() : '';
          if (!/^[A-Z]{3}$/u.test(currencyCode)) {
            problems.push({
              field,
              message: 'Currency code must be 3 uppercase letters.',
            });
          } else {
            resolved.push({ field, before: undefined, after: currencyCode });
          }
          break;
        }
        case 'timezone': {
          const timezone = typeof value === 'string' ? value.trim() : '';
          if (!isValidIanaTimezone(timezone)) {
            problems.push({
              field,
              message: 'Timezone must be a valid IANA timezone identifier.',
            });
          } else {
            resolved.push({ field, before: undefined, after: timezone });
          }
          break;
        }
        case 'defaultLocale': {
          const defaultLocale = typeof value === 'string' ? value.trim() : '';
          if (!MARKET_LOCALE_PATTERN.test(defaultLocale)) {
            problems.push({
              field,
              message: 'Locale must be a BCP-47-style locale (e.g. en-MY).',
            });
          } else {
            resolved.push({ field, before: undefined, after: defaultLocale });
          }
          break;
        }
        case 'status': {
          if (value !== 'ACTIVE' && value !== 'INACTIVE') {
            problems.push({
              field,
              message: 'Status must be ACTIVE or INACTIVE.',
            });
          } else {
            resolved.push({ field, before: undefined, after: value });
          }
          break;
        }
        default:
          // Owner field allowlist: unknown fields never reach the update.
          // (Typed exhaustively; the union has exactly five members.)
          problems.push({ field, message: 'Unknown field.' });
      }
    }

    if (problems.length > 0) {
      throw marketInvalidFieldError({
        fields: problems,
      });
    }
    return resolved;
  }

  private marketValue(
    row: {
      status: 'ACTIVE' | 'INACTIVE';
      name: string;
      currencyCode: string;
      timezone: string;
      defaultLocale: string;
    },
    field: MarketControlledField,
  ): unknown {
    return row[field];
  }

  /**
   * Active-resource dependency check for ACTIVE → INACTIVE: merchants
   * with an ACTIVE branch, members with an enabled market preference, and
   * active/future configuration references (reward rule versions,
   * commission rate versions by market code, active redemption rate
   * rules). Admin market grants are deliberately NOT a dependency: the
   * current admin's own grant is active by definition (the guard requires
   * it to reach this surface), and grant lifecycle belongs to
   * `rbac.market.grant` — treating grants as a dependency would make
   * deactivation unreachable and is therefore documented behavior.
   */
  private async assertNoDeactivationDependencies(
    tx: DbExecutor,
    marketId: string,
    marketCode: string,
  ): Promise<void> {
    const now = new Date();
    const [
      branches,
      preferences,
      rewardRules,
      commissionRates,
      redemptionRules,
    ] = await Promise.all([
      tx
        .select({ id: merchantBranches.id })
        .from(merchantBranches)
        .where(
          and(
            eq(merchantBranches.marketId, marketId),
            eq(merchantBranches.status, 'ACTIVE'),
          ),
        )
        .limit(1),
      tx
        .select({ id: memberMarketPreferences.id })
        .from(memberMarketPreferences)
        .where(
          and(
            eq(memberMarketPreferences.marketId, marketId),
            eq(memberMarketPreferences.isEnabled, true),
          ),
        )
        .limit(1),
      tx
        .select({ id: rewardRuleVersions.id })
        .from(rewardRuleVersions)
        .where(
          and(
            eq(rewardRuleVersions.marketId, marketId),
            isNull(rewardRuleVersions.archivedAt),
            or(
              isNull(rewardRuleVersions.effectiveTo),
              gt(rewardRuleVersions.effectiveTo, now),
            ),
          ),
        )
        .limit(1),
      tx
        .select({ id: commissionRateVersions.id })
        .from(commissionRateVersions)
        .where(
          and(
            eq(commissionRateVersions.market, marketCode),
            or(
              isNull(commissionRateVersions.effectiveUntil),
              gt(commissionRateVersions.effectiveUntil, now),
            ),
          ),
        )
        .limit(1),
      tx
        .select({ id: redemptionRateMarketRules.id })
        .from(redemptionRateMarketRules)
        .where(
          and(
            eq(redemptionRateMarketRules.marketCode, marketCode),
            eq(redemptionRateMarketRules.isActive, true),
          ),
        )
        .limit(1),
    ]);
    if (
      branches[0] ||
      preferences[0] ||
      rewardRules[0] ||
      commissionRates[0] ||
      redemptionRules[0]
    ) {
      throw marketDeactivationDependencyError();
    }
  }

  /** Grant + ACTIVE market + ACTIVE admin (revoked grants are denied). */
  private async assertMarketAccess(
    db: DbExecutor,
    adminUserId: string,
    marketId: string,
  ): Promise<void> {
    const rows = await db
      .select({ id: adminUsers.id })
      .from(marketAccess)
      .innerJoin(adminUsers, eq(adminUsers.id, marketAccess.adminUserId))
      .innerJoin(markets, eq(markets.id, marketAccess.marketId))
      .where(
        and(
          eq(marketAccess.adminUserId, adminUserId),
          eq(marketAccess.marketId, marketId),
          isNull(marketAccess.revokedAt),
          eq(adminUsers.status, 'ACTIVE'),
          eq(markets.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    if (!rows[0]) throw marketAccessDeniedError();
  }

  private async marketRow(marketId: string): Promise<
    | {
        id: string;
        code: string;
        name: string;
        status: 'ACTIVE' | 'INACTIVE';
        currencyCode: string;
        timezone: string;
        defaultLocale: string;
        createdAt: Date;
        updatedAt: Date;
      }
    | undefined
  > {
    return this.marketRowTx(this.database.db, marketId);
  }

  private async marketRowTx(
    db: DbExecutor,
    marketId: string,
  ): Promise<
    | {
        id: string;
        code: string;
        name: string;
        status: 'ACTIVE' | 'INACTIVE';
        currencyCode: string;
        timezone: string;
        defaultLocale: string;
        createdAt: Date;
        updatedAt: Date;
      }
    | undefined
  > {
    const rows = await db
      .select({
        id: markets.id,
        code: markets.code,
        name: markets.name,
        status: markets.status,
        currencyCode: markets.currencyCode,
        timezone: markets.timezone,
        defaultLocale: markets.defaultLocale,
        createdAt: markets.createdAt,
        updatedAt: markets.updatedAt,
      })
      .from(markets)
      .where(eq(markets.id, marketId))
      .limit(1);
    return rows[0];
  }

  private toDetailResponse(
    row: NonNullable<Awaited<ReturnType<MarketOwnerService['marketRow']>>>,
  ): MarketDetailResponse {
    return {
      market_id: row.id,
      market_code: row.code,
      name: row.name,
      status: row.status,
      currency_code: row.currencyCode,
      timezone: row.timezone,
      default_locale: row.defaultLocale,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      configured: row.status === 'ACTIVE',
    };
  }
}

// ─── Field validators ───────────────────────────────────────────────

/**
 * IANA timezone validation (Intl-based): a value is valid only when the
 * platform resolves it as a real timezone identifier.
 */
export function isValidIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

// ─── Canonical payload hash (sorted keys + sha256) ──────────────────

/**
 * Canonical payload hash for idempotency correlation (owner pattern):
 * keys sorted recursively, then sha256 hex.
 */
export function canonicalPayloadHash(payload: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(sortJson(payload)))
    .digest('hex');
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJson(nested)]),
    );
  }
  return value;
}

// ─── Owner advisory-lock key ────────────────────────────────────────

/** Market-scoped advisory lock key (FNV-1a over the owner namespace). */
export function marketOwnerLockKey(marketId: string): bigint {
  const input = `p7s6e:market-owner-update:${marketId}`;
  let hash = MARKET_OWNER_LOCK_NAMESPACE;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * BigInt(1099511628211)) & BigInt('0xFFFFFFFFFFFFFFFF');
  }
  return hash & BigInt('0x7FFFFFFFFFFFFFFF');
}
