import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  merchantApiIdempotencyKeys,
  merchantPackageAssignments,
  merchantPackageChangeRequests,
  serviceFeeProfiles,
  serviceFeeVersions,
  specialPercentages,
  type Database,
} from '@ipoint/database';
import { and, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import type {
  AssignPackageDto,
  CreatePackageProfileDto,
  CreatePackageVersionDto,
  CreateSpecialPercentageDto,
  PackageChangeRequestDto,
  UpdatePackageVersionDto,
} from './dto/package.dto.js';
import type { MerchantRequestContext } from './merchant.service.js';

type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

@Injectable()
export class PackageService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  createProfile(
    marketId: string,
    adminUserId: string,
    input: CreatePackageProfileDto,
    key: string,
    context: MerchantRequestContext,
  ) {
    return this.idempotent(
      `package.profile.create:${marketId}:${adminUserId}`,
      key,
      input,
      async (tx) => {
        await this.assertMarket(tx, marketId);
        try {
          const rows = await tx
            .insert(serviceFeeProfiles)
            .values({
              code: input.code,
              name: input.name,
              description: input.description,
              marketId,
            })
            .returning();
          const profile = rows[0];
          if (!profile)
            throw new Error('Package profile insert returned no row.');
          await this.appendAudit(tx, {
            adminUserId,
            marketId,
            action: 'SERVICE_FEE_PROFILE_CREATED',
            entityType: 'SERVICE_FEE_PROFILE',
            entityId: profile.id,
            after: profile,
            context,
          });
          return profile;
        } catch (error) {
          if (databaseCode(error) === '23505') {
            throw new ConflictException({
              code: 'PACKAGE_CODE_CONFLICT',
              message: 'The package code already exists.',
            });
          }
          throw error;
        }
      },
    );
  }

  createVersion(
    marketId: string,
    packageId: string,
    adminUserId: string,
    input: CreatePackageVersionDto,
    key: string,
    context: MerchantRequestContext,
  ) {
    return this.idempotent(
      `package.version.create:${packageId}:${adminUserId}`,
      key,
      input,
      async (tx) => {
        const profile = await this.getProfile(tx, packageId);
        if (profile.marketId && profile.marketId !== marketId)
          this.marketMismatch();
        const effectiveFrom = new Date(input.effective_from);
        const effectiveTo = input.effective_to
          ? new Date(input.effective_to)
          : undefined;
        if (effectiveTo && effectiveTo <= effectiveFrom) {
          throw new BadRequestException({
            code: 'PACKAGE_EFFECTIVE_WINDOW_INVALID',
            message: 'effective_to must be later than effective_from.',
          });
        }
        try {
          const rows = await tx
            .insert(serviceFeeVersions)
            .values({
              serviceFeeProfileId: packageId,
              marketId,
              rate: normalizeDecimal(input.rate),
              effectiveFrom,
              effectiveTo,
              status: 'DRAFT',
            })
            .returning();
          const version = rows[0];
          if (!version)
            throw new Error('Package version insert returned no row.');
          await this.appendAudit(tx, {
            adminUserId,
            marketId,
            action: 'SERVICE_FEE_VERSION_CREATED',
            entityType: 'SERVICE_FEE_VERSION',
            entityId: version.id,
            after: version,
            context,
          });
          return version;
        } catch (error) {
          if (databaseCode(error) === '23P01') {
            throw new ConflictException({
              code: 'PACKAGE_EFFECTIVE_WINDOW_OVERLAP',
              message: 'The effective window overlaps another version.',
            });
          }
          throw error;
        }
      },
    );
  }

  activateVersion(
    marketId: string,
    packageId: string,
    versionId: string,
    adminUserId: string,
    key: string,
    context: MerchantRequestContext,
  ) {
    return this.idempotent(
      `package.version.activate:${versionId}:${adminUserId}`,
      key,
      { marketId, packageId, versionId },
      async (tx) => {
        const rows = await tx.execute<{
          id: string;
          service_fee_profile_id: string;
          market_id: string | null;
          status: string;
          effective_from: Date;
          effective_to: Date | null;
        }>(sql`select id, service_fee_profile_id, market_id, status, effective_from, effective_to
               from service_fee_versions where id = ${versionId} for update`);
        const version = rows.rows[0];
        if (!version || version.service_fee_profile_id !== packageId)
          this.notFound();
        if (version.market_id !== marketId) this.marketMismatch();
        if (!['DRAFT', 'SCHEDULED'].includes(version.status)) {
          throw new ConflictException({
            code: 'PACKAGE_VERSION_TRANSITION_INVALID',
            message: `Version cannot be activated from ${version.status}.`,
          });
        }
        const now = new Date();
        if (version.effective_to && new Date(version.effective_to) <= now) {
          throw new ConflictException({
            code: 'PACKAGE_VERSION_EXPIRED',
            message: 'An expired effective window cannot be activated.',
          });
        }
        const status =
          new Date(version.effective_from) > now ? 'SCHEDULED' : 'ACTIVE';
        const updated = await tx
          .update(serviceFeeVersions)
          .set({ status })
          .where(eq(serviceFeeVersions.id, versionId))
          .returning();
        await this.appendAudit(tx, {
          adminUserId,
          marketId,
          action: 'SERVICE_FEE_VERSION_ACTIVATED',
          entityType: 'SERVICE_FEE_VERSION',
          entityId: versionId,
          before: { status: version.status },
          after: { status },
          context,
        });
        return updated[0];
      },
    );
  }

  updateDraftVersion(
    marketId: string,
    packageId: string,
    versionId: string,
    adminUserId: string,
    input: UpdatePackageVersionDto,
    key: string,
    context: MerchantRequestContext,
  ) {
    return this.idempotent(
      `package.version.update:${versionId}:${adminUserId}`,
      key,
      input,
      async (tx) => {
        const current = await this.lockVersion(
          tx,
          versionId,
          packageId,
          marketId,
        );
        if (current.status !== 'DRAFT') {
          throw new ConflictException({
            code: 'PACKAGE_VERSION_IMMUTABLE',
            message: 'Only a draft package version can be edited.',
          });
        }
        const effectiveFrom = input.effective_from
          ? new Date(input.effective_from)
          : new Date(current.effective_from);
        const effectiveTo = input.effective_to
          ? new Date(input.effective_to)
          : current.effective_to
            ? new Date(current.effective_to)
            : undefined;
        if (effectiveTo && effectiveTo <= effectiveFrom) {
          throw new BadRequestException({
            code: 'PACKAGE_EFFECTIVE_WINDOW_INVALID',
            message: 'effective_to must be later than effective_from.',
          });
        }
        try {
          const rows = await tx
            .update(serviceFeeVersions)
            .set({
              ...(input.rate ? { rate: normalizeDecimal(input.rate) } : {}),
              ...(input.effective_from ? { effectiveFrom } : {}),
              ...(input.effective_to ? { effectiveTo } : {}),
            })
            .where(eq(serviceFeeVersions.id, versionId))
            .returning();
          await this.appendAudit(tx, {
            adminUserId,
            marketId,
            action: 'SERVICE_FEE_VERSION_UPDATED',
            entityType: 'SERVICE_FEE_VERSION',
            entityId: versionId,
            before: current,
            after: rows[0],
            context,
          });
          return rows[0];
        } catch (error) {
          if (databaseCode(error) === '23P01') {
            throw new ConflictException({
              code: 'PACKAGE_EFFECTIVE_WINDOW_OVERLAP',
              message: 'The effective window overlaps another version.',
            });
          }
          throw error;
        }
      },
    );
  }

  cancelVersion(
    marketId: string,
    packageId: string,
    versionId: string,
    adminUserId: string,
    key: string,
    context: MerchantRequestContext,
  ) {
    return this.idempotent(
      `package.version.cancel:${versionId}:${adminUserId}`,
      key,
      { marketId, packageId, versionId },
      async (tx) => {
        const current = await this.lockVersion(
          tx,
          versionId,
          packageId,
          marketId,
        );
        if (!['DRAFT', 'SCHEDULED', 'ACTIVE'].includes(current.status)) {
          throw new ConflictException({
            code: 'PACKAGE_VERSION_TRANSITION_INVALID',
            message: `Version cannot be cancelled from ${current.status}.`,
          });
        }
        const activeReference = await tx.execute(sql`
          select 1 from merchant_package_assignments
          where service_fee_version_id = ${versionId} and status = 'ACTIVE' limit 1
        `);
        if (activeReference.rows.length > 0) {
          throw new ConflictException({
            code: 'PACKAGE_VERSION_IN_ACTIVE_USE',
            message:
              'An actively assigned package version cannot be cancelled.',
          });
        }
        const rows = await tx
          .update(serviceFeeVersions)
          .set({ status: 'CANCELLED' })
          .where(eq(serviceFeeVersions.id, versionId))
          .returning();
        await this.appendAudit(tx, {
          adminUserId,
          marketId,
          action: 'SERVICE_FEE_VERSION_CANCELLED',
          entityType: 'SERVICE_FEE_VERSION',
          entityId: versionId,
          before: { status: current.status },
          after: { status: 'CANCELLED' },
          context,
        });
        return rows[0];
      },
    );
  }

  createSpecialPercentage(
    marketId: string,
    adminUserId: string,
    input: CreateSpecialPercentageDto,
    key: string,
    context: MerchantRequestContext,
  ) {
    return this.idempotent(
      `package.special.create:${marketId}:${adminUserId}`,
      key,
      input,
      async (tx) => {
        await this.assertMarket(tx, marketId);
        const rows = await tx
          .insert(specialPercentages)
          .values({
            marketId,
            rate: normalizeDecimal(input.rate),
            description: input.description,
            createdByAdminUserId: adminUserId,
          })
          .returning();
        const special = rows[0];
        if (!special)
          throw new Error('Special percentage insert returned no row.');
        await this.appendAudit(tx, {
          adminUserId,
          marketId,
          action: 'SPECIAL_PERCENTAGE_CREATED',
          entityType: 'SPECIAL_PERCENTAGE',
          entityId: special.id,
          after: special,
          context,
        });
        return special;
      },
    );
  }

  assign(
    marketId: string,
    branchId: string,
    adminUserId: string,
    input: AssignPackageDto,
    key: string,
    context: MerchantRequestContext,
  ) {
    return this.idempotent(
      `package.assignment.create:${branchId}:${adminUserId}`,
      key,
      input,
      async (tx) => {
        await this.lockBranch(tx, branchId, marketId);
        if (input.service_fee_version_id) {
          await this.assertVersionAssignable(
            tx,
            input.service_fee_version_id,
            marketId,
          );
        } else if (input.special_percentage_id) {
          const special = await tx
            .select({
              id: specialPercentages.id,
              marketId: specialPercentages.marketId,
            })
            .from(specialPercentages)
            .where(eq(specialPercentages.id, input.special_percentage_id))
            .limit(1);
          if (!special[0]) this.notFound();
          if (special[0].marketId !== marketId) this.marketMismatch();
        }
        const existing = await tx.execute<{ count: string }>(sql`
          select count(*)::text as count from merchant_package_assignments
          where merchant_branch_id = ${branchId}
        `);
        const isFirst = existing.rows[0]?.count === '0';
        const isDefault = isFirst || input.is_default;
        if (isDefault) {
          await tx
            .update(merchantPackageAssignments)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(eq(merchantPackageAssignments.merchantBranchId, branchId));
        }
        const rows = await tx
          .insert(merchantPackageAssignments)
          .values({
            merchantBranchId: branchId,
            serviceFeeVersionId: input.service_fee_version_id,
            specialPercentageId: input.special_percentage_id,
            status: 'ACTIVE',
            isDefault,
          })
          .returning();
        const assignment = rows[0];
        if (!assignment)
          throw new Error('Package assignment insert returned no row.');
        await this.appendAudit(tx, {
          adminUserId,
          marketId,
          action: 'MERCHANT_PACKAGE_ASSIGNED',
          entityType: 'MERCHANT_PACKAGE_ASSIGNMENT',
          entityId: assignment.id,
          after: assignment,
          context,
        });
        return assignment;
      },
    );
  }

  setDefault(
    marketId: string,
    branchId: string,
    assignmentId: string,
    adminUserId: string,
    key: string,
    context: MerchantRequestContext,
  ) {
    return this.idempotent(
      `package.assignment.default:${assignmentId}:${adminUserId}`,
      key,
      { marketId, branchId, assignmentId },
      async (tx) => {
        await this.lockBranch(tx, branchId, marketId);
        const target = await this.lockAssignment(tx, assignmentId, branchId);
        if (target.status !== 'ACTIVE') {
          throw new ConflictException({
            code: 'PACKAGE_ASSIGNMENT_NOT_ACTIVE',
            message: 'Only an active assignment can be the default.',
          });
        }
        await tx
          .update(merchantPackageAssignments)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(merchantPackageAssignments.merchantBranchId, branchId));
        const rows = await tx
          .update(merchantPackageAssignments)
          .set({ isDefault: true, updatedAt: new Date() })
          .where(eq(merchantPackageAssignments.id, assignmentId))
          .returning();
        await this.appendAudit(tx, {
          adminUserId,
          marketId,
          action: 'MERCHANT_PACKAGE_DEFAULT_SET',
          entityType: 'MERCHANT_PACKAGE_ASSIGNMENT',
          entityId: assignmentId,
          before: { is_default: target.is_default },
          after: { is_default: true },
          context,
        });
        return rows[0];
      },
    );
  }

  async listAvailable(branchId: string) {
    return this.database.db.transaction(async (tx) => {
      const branch = await this.lockBranch(tx, branchId);
      await this.syncVersionLifecycle(tx, branch.market_id);
      const result = await tx.execute(sql`
        select a.id as assignment_id, a.status, a.is_default,
             v.id as service_fee_version_id, v.rate as version_rate,
             v.status as version_status, v.effective_from, v.effective_to,
             p.id as package_id, p.code, p.name, p.description,
             sp.id as special_percentage_id, sp.rate as special_rate
      from merchant_package_assignments a
      left join service_fee_versions v on v.id = a.service_fee_version_id
      left join service_fee_profiles p on p.id = v.service_fee_profile_id
      left join special_percentages sp on sp.id = a.special_percentage_id
      where a.merchant_branch_id = ${branchId}
      order by a.is_default desc, a.created_at asc
      `);
      return { items: result.rows };
    });
  }

  pause(
    branchId: string,
    assignmentId: string,
    accountId: string,
    key: string,
    context: MerchantRequestContext,
  ) {
    return this.changeAssignmentStatus(
      branchId,
      assignmentId,
      accountId,
      'PAUSED',
      key,
      context,
    );
  }

  resume(
    branchId: string,
    assignmentId: string,
    accountId: string,
    key: string,
    context: MerchantRequestContext,
  ) {
    return this.changeAssignmentStatus(
      branchId,
      assignmentId,
      accountId,
      'ACTIVE',
      key,
      context,
    );
  }

  requestChange(
    branchId: string,
    accountId: string,
    input: PackageChangeRequestDto,
    key: string,
    context: MerchantRequestContext,
  ) {
    return this.idempotent(
      `package.change.request:${branchId}:${accountId}`,
      key,
      input,
      async (tx) => {
        const branch = await this.lockBranch(tx, branchId);
        await this.assertVersionAssignable(
          tx,
          input.service_fee_version_id,
          branch.market_id,
        );
        try {
          const rows = await tx
            .insert(merchantPackageChangeRequests)
            .values({
              merchantBranchId: branchId,
              requestedServiceFeeVersionId: input.service_fee_version_id,
              requestedByAccountId: accountId,
              reason: input.reason,
            })
            .returning();
          const request = rows[0];
          if (!request)
            throw new Error('Package change request insert returned no row.');
          await this.audit.appendWithinTransaction(tx, {
            actor: { type: 'ACCOUNT', id: accountId },
            action: 'MERCHANT_PACKAGE_CHANGE_REQUESTED',
            entity: { type: 'MERCHANT_PACKAGE_CHANGE_REQUEST', id: request.id },
            marketId: branch.market_id,
            after: request,
            result: 'SUCCESS',
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            summary: 'Merchant requested a service-fee package change.',
          });
          return request;
        } catch (error) {
          if (databaseCode(error) === '23505') {
            throw new ConflictException({
              code: 'PACKAGE_CHANGE_ALREADY_PENDING',
              message: 'A package change request is already pending.',
            });
          }
          throw error;
        }
      },
    );
  }

  private changeAssignmentStatus(
    branchId: string,
    assignmentId: string,
    accountId: string,
    status: 'ACTIVE' | 'PAUSED',
    key: string,
    context: MerchantRequestContext,
  ) {
    return this.idempotent(
      `package.assignment.${status.toLowerCase()}:${assignmentId}:${accountId}`,
      key,
      { branchId, assignmentId, status },
      async (tx) => {
        const branch = await this.lockBranch(tx, branchId);
        const assignment = await this.lockAssignment(
          tx,
          assignmentId,
          branchId,
        );
        if (assignment.status === status) return assignment;
        if (status === 'PAUSED') {
          const active = await tx.execute<{ id: string }>(sql`
            select id from merchant_package_assignments
            where merchant_branch_id = ${branchId} and status = 'ACTIVE'
            order by is_default desc, created_at asc for update
          `);
          if (active.rows.length <= 1) {
            throw new ConflictException({
              code: 'PACKAGE_LAST_ACTIVE_CANNOT_PAUSE',
              message: 'The last active package assignment cannot be paused.',
            });
          }
          if (assignment.is_default) {
            const replacement = active.rows.find(
              (row) => row.id !== assignmentId,
            );
            if (!replacement) throw new Error('Default replacement not found.');
            await tx
              .update(merchantPackageAssignments)
              .set({ isDefault: false, updatedAt: new Date() })
              .where(eq(merchantPackageAssignments.id, assignmentId));
            await tx
              .update(merchantPackageAssignments)
              .set({ isDefault: true, updatedAt: new Date() })
              .where(eq(merchantPackageAssignments.id, replacement.id));
          }
        } else if (assignment.service_fee_version_id) {
          await this.assertVersionAssignable(
            tx,
            assignment.service_fee_version_id,
            branch.market_id,
          );
        }
        const rows = await tx
          .update(merchantPackageAssignments)
          .set({
            status,
            isDefault: status === 'PAUSED' ? false : assignment.is_default,
            version: sql`${merchantPackageAssignments.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(merchantPackageAssignments.id, assignmentId))
          .returning();
        await this.audit.appendWithinTransaction(tx, {
          actor: { type: 'ACCOUNT', id: accountId },
          action: `MERCHANT_PACKAGE_${status === 'ACTIVE' ? 'RESUMED' : 'PAUSED'}`,
          entity: { type: 'MERCHANT_PACKAGE_ASSIGNMENT', id: assignmentId },
          marketId: branch.market_id,
          before: { status: assignment.status },
          after: { status },
          result: 'SUCCESS',
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          summary: `Merchant package assignment ${status.toLowerCase()}.`,
        });
        return rows[0];
      },
    );
  }

  private async assertMarket(tx: DatabaseTransaction, marketId: string) {
    const rows = await tx.execute(
      sql`select id from markets where id = ${marketId} and status = 'ACTIVE'`,
    );
    if (rows.rows.length !== 1) this.notFound();
  }

  private async getProfile(tx: DatabaseTransaction, id: string) {
    const rows = await tx
      .select()
      .from(serviceFeeProfiles)
      .where(eq(serviceFeeProfiles.id, id))
      .limit(1);
    if (!rows[0]) this.notFound();
    return rows[0];
  }

  private async lockBranch(
    tx: DatabaseTransaction,
    branchId: string,
    marketId?: string,
  ) {
    const result = await tx.execute<{ id: string; market_id: string }>(sql`
      select id, market_id from merchant_branches where id = ${branchId} for update
    `);
    const branch = result.rows[0];
    if (!branch) this.notFound();
    if (marketId && branch.market_id !== marketId) this.marketMismatch();
    return branch;
  }

  private async lockAssignment(
    tx: DatabaseTransaction,
    assignmentId: string,
    branchId: string,
  ) {
    const result = await tx.execute<{
      id: string;
      status: 'ACTIVE' | 'PAUSED' | 'PENDING_CHANGE';
      is_default: boolean;
      service_fee_version_id: string | null;
    }>(sql`select id, status, is_default, service_fee_version_id
           from merchant_package_assignments
           where id = ${assignmentId} and merchant_branch_id = ${branchId} for update`);
    const assignment = result.rows[0];
    if (!assignment) this.notFound();
    return assignment;
  }

  private async assertVersionAssignable(
    tx: DatabaseTransaction,
    versionId: string,
    marketId: string,
  ) {
    await this.syncVersionLifecycle(tx, marketId);
    const rows = await tx.execute<{ id: string }>(sql`
      select id from service_fee_versions
      where id = ${versionId} and market_id = ${marketId} and status = 'ACTIVE'
        and effective_from <= now() and (effective_to is null or effective_to > now())
    `);
    if (rows.rows.length !== 1) {
      throw new ConflictException({
        code: 'PACKAGE_VERSION_NOT_ASSIGNABLE',
        message: 'The package version is not active for this market.',
      });
    }
  }

  private async lockVersion(
    tx: DatabaseTransaction,
    versionId: string,
    packageId: string,
    marketId: string,
  ) {
    const result = await tx.execute<{
      id: string;
      service_fee_profile_id: string;
      market_id: string | null;
      status: string;
      rate: string;
      effective_from: Date;
      effective_to: Date | null;
    }>(sql`select id, service_fee_profile_id, market_id, status, rate,
                  effective_from, effective_to
           from service_fee_versions where id = ${versionId} for update`);
    const version = result.rows[0];
    if (!version || version.service_fee_profile_id !== packageId)
      this.notFound();
    if (version.market_id !== marketId) this.marketMismatch();
    return version;
  }

  private async syncVersionLifecycle(
    tx: DatabaseTransaction,
    marketId: string,
  ) {
    const expired = await tx.execute<{ id: string }>(sql`
      update service_fee_versions set status = 'EXPIRED'
      where market_id = ${marketId} and status in ('SCHEDULED', 'ACTIVE')
        and effective_to is not null and effective_to <= now()
      returning id
    `);
    const activated = await tx.execute<{ id: string }>(sql`
      update service_fee_versions set status = 'ACTIVE'
      where market_id = ${marketId} and status = 'SCHEDULED'
        and effective_from <= now() and (effective_to is null or effective_to > now())
      returning id
    `);
    for (const [status, rows] of [
      ['EXPIRED', expired.rows],
      ['ACTIVE', activated.rows],
    ] as const) {
      for (const row of rows) {
        await this.audit.appendWithinTransaction(tx, {
          actor: { type: 'SYSTEM' },
          action: `SERVICE_FEE_VERSION_${status}`,
          entity: { type: 'SERVICE_FEE_VERSION', id: row.id },
          marketId,
          after: { status },
          result: 'SUCCESS',
          summary: `Service-fee version transitioned to ${status.toLowerCase()}.`,
        });
      }
    }
  }

  private appendAudit(
    tx: DatabaseTransaction,
    input: {
      adminUserId: string;
      marketId: string;
      action: string;
      entityType: string;
      entityId: string;
      before?: unknown;
      after?: unknown;
      context: MerchantRequestContext;
    },
  ) {
    return this.audit.appendWithinTransaction(tx, {
      actor: { type: 'ADMIN_USER', id: input.adminUserId },
      action: input.action,
      entity: { type: input.entityType, id: input.entityId },
      marketId: input.marketId,
      before: input.before,
      after: input.after,
      result: 'SUCCESS',
      requestId: input.context.requestId,
      ipAddress: input.context.ipAddress,
      summary: input.action.replaceAll('_', ' ').toLowerCase(),
    });
  }

  private idempotent<T>(
    scope: string,
    key: string,
    payload: unknown,
    work: (tx: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    const requestHash = hashPayload(payload);
    return this.database.db.transaction(async (tx) => {
      const claimed = await tx
        .insert(merchantApiIdempotencyKeys)
        .values({ scope, key, requestHash })
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
              eq(merchantApiIdempotencyKeys.key, key),
            ),
          )
          .limit(1);
        const row = existing[0];
        if (!row || row.requestHash !== requestHash || row.response === null) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_KEY_CONFLICT',
            message: 'The Idempotency-Key cannot be reused for this request.',
          });
        }
        return row.response as T;
      }
      const response = await work(tx);
      await tx
        .update(merchantApiIdempotencyKeys)
        .set({ response, statusCode: 200, updatedAt: new Date() })
        .where(eq(merchantApiIdempotencyKeys.id, claimed[0]?.id ?? ''));
      return response;
    });
  }

  private marketMismatch(): never {
    throw new BadRequestException({
      code: 'PACKAGE_MARKET_MISMATCH',
      message: 'The package entity does not belong to the route market.',
    });
  }

  private notFound(): never {
    throw new NotFoundException({
      code: 'PACKAGE_NOT_FOUND',
      message: 'Package entity not found.',
    });
  }
}

function normalizeDecimal(value: string): string {
  const [whole = '0', fraction = ''] = value.trim().split('.');
  return `${BigInt(whole).toString()}.${fraction.padEnd(6, '0')}`;
}

function hashPayload(payload: unknown): string {
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
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}

function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = 'cause' in error ? error.cause : error;
  if (!candidate || typeof candidate !== 'object' || !('code' in candidate))
    return undefined;
  return typeof candidate.code === 'string' ? candidate.code : undefined;
}
