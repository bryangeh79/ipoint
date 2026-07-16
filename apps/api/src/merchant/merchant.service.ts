import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  accounts,
  credentials,
  markets,
  mcpAccounts,
  merchantAccountAccess,
  merchantApiIdempotencyKeys,
  merchantApplicationReviews,
  merchantApplications,
  merchantApplicationSubmissions,
  merchantBranches,
  merchantGroups,
  merchantKycSubmissions,
  merchantProfileGalleryEntries,
  merchantProfiles,
  merchantReferrals,
  merchantStatusHistory,
  merchantTermsAcceptances,
  type Database,
} from '@ipoint/database';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AuthService } from '../auth/auth.service.js';
import { PasswordHasher } from '../auth/password-hasher.js';
import type { RequestActor } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import { MarketService } from '../platform-access/market.service.js';
import type {
  MerchantApplicationQueueDto,
  MerchantStatusActionDto,
  ReviewMerchantApplicationDto,
  SubmitMerchantApplicationDto,
} from './dto/application.dto.js';
import type {
  AddGalleryEntryDto,
  UpdateMerchantProfileDto,
} from './dto/profile.dto.js';
import type { RegisterMerchantDto } from './dto/registration.dto.js';
import {
  merchantBadRequest,
  merchantConflict,
  merchantErrorCodes,
  merchantForbidden,
  merchantNotFound,
} from './merchant.errors.js';

type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type OperationalStatus =
  | 'PENDING_APPLICATION'
  | 'PENDING_KYC'
  | 'PENDING_MCP'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'CLOSURE_PENDING'
  | 'CLOSED';

export interface MerchantRequestContext {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

interface TransitionActor {
  type: 'ACCOUNT' | 'ADMIN_USER' | 'SYSTEM';
  id: string;
}

@Injectable()
export class MerchantService {
  private readonly passwordHasher = new PasswordHasher();

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(MarketService) private readonly marketService: MarketService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async register(
    input: RegisterMerchantDto,
    idempotencyKey: string,
    context: MerchantRequestContext,
  ) {
    const email = input.email.trim().toLowerCase();
    const secretHash = await this.passwordHasher.hash(input.password);
    return this.idempotent(
      `merchant.register:${email}`,
      idempotencyKey,
      input,
      201,
      async (tx) => {
        const activeMarkets = await this.marketService.list();
        if (!activeMarkets.some((market) => market.id === input.market_id)) {
          merchantBadRequest(
            'MERCHANT_MARKET_INVALID',
            'The selected market is not active.',
          );
        }

        try {
          await this.auth.verifyOtp(input.otp_id, input.otp_code, {
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            requestId: context.requestId,
          });
        } catch {
          merchantBadRequest(
            merchantErrorCodes.otpInvalid,
            'The email verification OTP is invalid.',
          );
        }

        const consumed = await tx.execute<{ id: string }>(sql`
          update otps
          set consumed_at = now()
          where id = ${input.otp_id}
            and destination = ${email}
            and purpose = 'EMAIL_VERIFICATION'
            and verified_at is not null
            and consumed_at is null
            and expires_at > now()
          returning id
        `);
        if (consumed.rows.length !== 1) {
          merchantBadRequest(
            merchantErrorCodes.otpInvalid,
            'The email verification OTP does not match this registration.',
          );
        }

        try {
          const accountRows = await tx
            .insert(accounts)
            .values({
              publicId: `acct_${randomUUID()}`,
              email,
              accountCountry: input.account_country,
              status: 'ACTIVE',
              emailVerifiedAt: new Date(),
            })
            .returning({ id: accounts.id });
          const accountId = accountRows[0]?.id;
          if (!accountId) throw new Error('Account insert returned no id.');

          await tx.insert(credentials).values({
            accountId,
            type: 'PASSWORD',
            secretHash,
            hashAlgorithm: 'scrypt',
            hashVersion: 1,
          });

          const groupRows = await tx
            .insert(merchantGroups)
            .values({
              accountId,
              marketId: input.market_id,
              name: input.group_name ?? input.display_name,
            })
            .returning({ id: merchantGroups.id });
          const groupId = groupRows[0]?.id;
          if (!groupId)
            throw new Error('Merchant group insert returned no id.');

          await tx.insert(merchantAccountAccess).values({
            accountId,
            merchantGroupId: groupId,
            accessType: 'PRIMARY_OWNER',
          });

          const merchantId = await this.nextMerchantId(
            tx,
            input.market_id,
            input.channel,
          );
          const branchRows = await tx
            .insert(merchantBranches)
            .values({
              merchantGroupId: groupId,
              merchantId,
              marketId: input.market_id,
              name: input.display_name,
              status: 'PENDING_APPLICATION',
            })
            .returning({ id: merchantBranches.id });
          const branchId = branchRows[0]?.id;
          if (!branchId)
            throw new Error('Merchant branch insert returned no id.');

          await tx.insert(merchantProfiles).values({
            merchantBranchId: branchId,
            phone: input.phone,
            address: input.address,
          });
          await tx.insert(merchantApplications).values({
            merchantBranchId: branchId,
          });
          await tx.insert(mcpAccounts).values({
            merchantBranchId: branchId,
            marketId: input.market_id,
          });
          await tx.insert(merchantTermsAcceptances).values({
            accountId,
            merchantBranchId: branchId,
            termsVersion: input.terms_version,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            locale: input.locale,
          });
          if (input.referral_account_id) {
            await tx.insert(merchantReferrals).values({
              merchantBranchId: branchId,
              referrerAccountId: input.referral_account_id,
            });
          }
          await tx.insert(merchantStatusHistory).values({
            merchantBranchId: branchId,
            newStatus: 'PENDING_APPLICATION',
            changedByActorType: 'ACCOUNT',
            changedByActorId: accountId,
            reason: 'Merchant registration created.',
          });

          const response = {
            branch_id: branchId,
            merchant_id: merchantId,
            group_id: groupId,
          };
          await this.audit.appendWithinTransaction(tx, {
            actor: { type: 'ACCOUNT', id: accountId },
            action: 'merchant.register',
            entity: { type: 'merchant_branch', id: branchId },
            marketId: input.market_id,
            after: response,
            result: 'SUCCESS',
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            summary:
              'Merchant account, default group, and first branch created.',
          });
          return response;
        } catch (error) {
          if (isUniqueViolation(error)) {
            merchantConflict(
              merchantErrorCodes.registrationConflict,
              'This merchant registration already exists.',
            );
          }
          throw error;
        }
      },
    );
  }

  async assertOwnership(
    accountId: string,
    branchId: string,
    marketId: string | undefined,
  ): Promise<void> {
    const rows = await this.database.db
      .select({ marketId: merchantBranches.marketId })
      .from(merchantBranches)
      .innerJoin(
        merchantAccountAccess,
        eq(
          merchantAccountAccess.merchantGroupId,
          merchantBranches.merchantGroupId,
        ),
      )
      .where(
        and(
          eq(merchantBranches.id, branchId),
          eq(merchantAccountAccess.accountId, accountId),
          eq(merchantAccountAccess.accessType, 'PRIMARY_OWNER'),
        ),
      )
      .limit(1);
    const owned = rows[0];
    if (!owned) {
      merchantForbidden(
        merchantErrorCodes.ownershipDenied,
        'The authenticated account does not own this merchant branch.',
      );
    }
    if (!marketId || marketId !== owned.marketId) {
      merchantForbidden(
        merchantErrorCodes.marketMismatch,
        'The requested market does not match the merchant branch.',
      );
    }
  }

  async getProfile(branchId: string) {
    const rows = await this.database.db
      .select({
        branchId: merchantBranches.id,
        merchantId: merchantBranches.merchantId,
        marketId: merchantBranches.marketId,
        displayName: merchantBranches.name,
        email: accounts.email,
        phone: merchantProfiles.phone,
        address: merchantProfiles.address,
        about: merchantProfiles.aboutUs,
        businessHours: merchantProfiles.businessHours,
        website: merchantProfiles.website,
        whatsapp: merchantProfiles.whatsapp,
        socials: merchantProfiles.socialLinks,
        logoObjectKey: merchantProfiles.logoUrl,
        bannerObjectKey: merchantProfiles.bannerUrl,
      })
      .from(merchantBranches)
      .innerJoin(
        merchantGroups,
        eq(merchantGroups.id, merchantBranches.merchantGroupId),
      )
      .innerJoin(accounts, eq(accounts.id, merchantGroups.accountId))
      .innerJoin(
        merchantProfiles,
        eq(merchantProfiles.merchantBranchId, merchantBranches.id),
      )
      .where(eq(merchantBranches.id, branchId))
      .limit(1);
    const profile = rows[0];
    if (!profile) merchantNotFound();
    const gallery = await this.database.db
      .select({
        id: merchantProfileGalleryEntries.id,
        object_key: merchantProfileGalleryEntries.mediaUrl,
        position: merchantProfileGalleryEntries.position,
      })
      .from(merchantProfileGalleryEntries)
      .innerJoin(
        merchantProfiles,
        eq(
          merchantProfiles.id,
          merchantProfileGalleryEntries.merchantProfileId,
        ),
      )
      .where(eq(merchantProfiles.merchantBranchId, branchId))
      .orderBy(merchantProfileGalleryEntries.position);
    return {
      branch_id: profile.branchId,
      merchant_id: profile.merchantId,
      market_id: profile.marketId,
      display_name: profile.displayName,
      primary_email: profile.email,
      phone: profile.phone,
      address: profile.address,
      about: profile.about,
      business_hours: profile.businessHours,
      website: profile.website,
      whatsapp: profile.whatsapp,
      socials: profile.socials,
      logo_object_key: profile.logoObjectKey,
      banner_object_key: profile.bannerObjectKey,
      gallery,
    };
  }

  async updateProfile(
    branchId: string,
    accountId: string,
    input: UpdateMerchantProfileDto,
    idempotencyKey: string,
    context: MerchantRequestContext,
  ) {
    return this.idempotent(
      `merchant.profile.update:${accountId}:${branchId}`,
      idempotencyKey,
      input,
      200,
      async (tx) => {
        const beforeRows = await tx
          .select({ branch: merchantBranches, profile: merchantProfiles })
          .from(merchantBranches)
          .innerJoin(
            merchantProfiles,
            eq(merchantProfiles.merchantBranchId, merchantBranches.id),
          )
          .where(eq(merchantBranches.id, branchId))
          .limit(1);
        const before = beforeRows[0];
        if (!before) merchantNotFound();
        if (input.display_name !== undefined) {
          await tx
            .update(merchantBranches)
            .set({ name: input.display_name, updatedAt: new Date() })
            .where(eq(merchantBranches.id, branchId));
        }
        await tx
          .update(merchantProfiles)
          .set({
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
            ...(input.address !== undefined ? { address: input.address } : {}),
            ...(input.about !== undefined ? { aboutUs: input.about } : {}),
            ...(input.business_hours !== undefined
              ? { businessHours: input.business_hours }
              : {}),
            ...(input.website !== undefined ? { website: input.website } : {}),
            ...(input.whatsapp !== undefined
              ? { whatsapp: input.whatsapp }
              : {}),
            ...(input.socials !== undefined
              ? { socialLinks: input.socials }
              : {}),
            ...(input.logo_object_key !== undefined
              ? { logoUrl: input.logo_object_key }
              : {}),
            ...(input.banner_object_key !== undefined
              ? { bannerUrl: input.banner_object_key }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(merchantProfiles.merchantBranchId, branchId));
        const response = await this.profileWithinTransaction(tx, branchId);
        await this.audit.appendWithinTransaction(tx, {
          actor: { type: 'ACCOUNT', id: accountId },
          action: 'merchant.profile.update',
          entity: { type: 'merchant_branch', id: branchId },
          marketId: before.branch.marketId,
          before: { branch: before.branch, profile: before.profile },
          after: response,
          result: 'SUCCESS',
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          summary: 'Merchant profile updated.',
        });
        return response;
      },
    );
  }

  async addGalleryEntry(
    branchId: string,
    accountId: string,
    input: AddGalleryEntryDto,
    idempotencyKey: string,
    context: MerchantRequestContext,
  ) {
    return this.idempotent(
      `merchant.profile.gallery.add:${accountId}:${branchId}`,
      idempotencyKey,
      input,
      201,
      async (tx) => {
        const profileRows = await tx
          .select({
            id: merchantProfiles.id,
            marketId: merchantBranches.marketId,
          })
          .from(merchantProfiles)
          .innerJoin(
            merchantBranches,
            eq(merchantBranches.id, merchantProfiles.merchantBranchId),
          )
          .where(eq(merchantProfiles.merchantBranchId, branchId))
          .for('update')
          .limit(1);
        const profile = profileRows[0];
        if (!profile) merchantNotFound();
        const entries = await tx
          .select({ position: merchantProfileGalleryEntries.position })
          .from(merchantProfileGalleryEntries)
          .where(
            eq(merchantProfileGalleryEntries.merchantProfileId, profile.id),
          );
        if (entries.length >= 10) {
          merchantConflict(
            merchantErrorCodes.galleryLimit,
            'A merchant profile can contain at most 10 gallery entries.',
          );
        }
        const used = new Set(entries.map((entry) => entry.position));
        const position = input.position ?? firstAvailablePosition(used);
        if (used.has(position)) {
          merchantConflict(
            'MERCHANT_GALLERY_POSITION_CONFLICT',
            'The requested gallery position is already in use.',
          );
        }
        const inserted = await tx
          .insert(merchantProfileGalleryEntries)
          .values({
            merchantProfileId: profile.id,
            mediaUrl: input.object_key,
            position,
          })
          .returning({
            id: merchantProfileGalleryEntries.id,
            object_key: merchantProfileGalleryEntries.mediaUrl,
            position: merchantProfileGalleryEntries.position,
          });
        const response = inserted[0];
        if (!response) throw new Error('Gallery insert returned no row.');
        await this.audit.appendWithinTransaction(tx, {
          actor: { type: 'ACCOUNT', id: accountId },
          action: 'merchant.profile.gallery.add',
          entity: { type: 'merchant_branch', id: branchId },
          marketId: profile.marketId,
          after: response,
          result: 'SUCCESS',
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          summary: 'Merchant gallery metadata added.',
        });
        return response;
      },
    );
  }

  async submitApplication(
    branchId: string,
    accountId: string,
    input: SubmitMerchantApplicationDto,
    idempotencyKey: string,
    context: MerchantRequestContext,
  ) {
    return this.idempotent(
      `merchant.application.submit:${accountId}:${branchId}`,
      idempotencyKey,
      input,
      201,
      async (tx) => {
        const rows = await tx
          .select({
            application: merchantApplications,
            branch: merchantBranches,
            profile: merchantProfiles,
          })
          .from(merchantApplications)
          .innerJoin(
            merchantBranches,
            eq(merchantBranches.id, merchantApplications.merchantBranchId),
          )
          .innerJoin(
            merchantProfiles,
            eq(merchantProfiles.merchantBranchId, merchantBranches.id),
          )
          .where(eq(merchantApplications.merchantBranchId, branchId))
          .for('update')
          .limit(1);
        const current = rows[0];
        if (!current) merchantNotFound();
        if (
          current.application.status !== 'DRAFT' &&
          current.application.status !== 'RESUBMISSION_REQUIRED'
        ) {
          invalidTransition(current.application.status, 'SUBMITTED');
        }
        const terms = await tx
          .select({ id: merchantTermsAcceptances.id })
          .from(merchantTermsAcceptances)
          .where(eq(merchantTermsAcceptances.merchantBranchId, branchId))
          .limit(1);
        if (terms.length === 0) {
          merchantBadRequest(
            'MERCHANT_TERMS_REQUIRED',
            'Versioned terms acceptance is required before submission.',
          );
        }
        const versionRows = await tx
          .select({ version: merchantApplicationSubmissions.submissionVersion })
          .from(merchantApplicationSubmissions)
          .where(
            eq(
              merchantApplicationSubmissions.merchantApplicationId,
              current.application.id,
            ),
          )
          .orderBy(desc(merchantApplicationSubmissions.submissionVersion))
          .limit(1);
        const submissionVersion = (versionRows[0]?.version ?? 0) + 1;
        const snapshot = {
          branch: {
            merchant_id: current.branch.merchantId,
            display_name: current.branch.name,
            market_id: current.branch.marketId,
          },
          profile: {
            phone: current.profile.phone,
            address: current.profile.address,
            about: current.profile.aboutUs,
            business_hours: current.profile.businessHours,
            website: current.profile.website,
            whatsapp: current.profile.whatsapp,
            socials: current.profile.socialLinks,
            logo_object_key: current.profile.logoUrl,
            banner_object_key: current.profile.bannerUrl,
          },
          application_data: input.application_data,
        };
        const submissionRows = await tx
          .insert(merchantApplicationSubmissions)
          .values({
            merchantApplicationId: current.application.id,
            submissionVersion,
            submittedData: snapshot,
          })
          .returning({
            id: merchantApplicationSubmissions.id,
            submittedAt: merchantApplicationSubmissions.submittedAt,
          });
        await tx
          .update(merchantApplications)
          .set({
            status: 'SUBMITTED',
            version: current.application.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(merchantApplications.id, current.application.id));
        const response = {
          application_id: current.application.id,
          status: 'SUBMITTED' as const,
          submission_id: submissionRows[0]?.id,
          submission_version: submissionVersion,
          submitted_at: submissionRows[0]?.submittedAt,
        };
        await this.audit.appendWithinTransaction(tx, {
          actor: { type: 'ACCOUNT', id: accountId },
          action: 'merchant.application.submit',
          entity: { type: 'merchant_application', id: current.application.id },
          marketId: current.branch.marketId,
          before: { status: current.application.status },
          after: response,
          result: 'SUCCESS',
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          summary: `Merchant application changed from ${current.application.status} to SUBMITTED.`,
        });
        return response;
      },
    );
  }

  async getApplication(branchId: string) {
    const rows = await this.database.db
      .select({
        application: merchantApplications,
        branchStatus: merchantBranches.status,
      })
      .from(merchantApplications)
      .innerJoin(
        merchantBranches,
        eq(merchantBranches.id, merchantApplications.merchantBranchId),
      )
      .where(eq(merchantApplications.merchantBranchId, branchId))
      .limit(1);
    const current = rows[0];
    if (!current) merchantNotFound();
    const [submissions, reviews] = await Promise.all([
      this.database.db
        .select({
          id: merchantApplicationSubmissions.id,
          version: merchantApplicationSubmissions.submissionVersion,
          submitted_at: merchantApplicationSubmissions.submittedAt,
        })
        .from(merchantApplicationSubmissions)
        .where(
          eq(
            merchantApplicationSubmissions.merchantApplicationId,
            current.application.id,
          ),
        )
        .orderBy(desc(merchantApplicationSubmissions.submissionVersion)),
      this.database.db
        .select({
          id: merchantApplicationReviews.id,
          decision: merchantApplicationReviews.decision,
          reason: merchantApplicationReviews.reason,
          decided_at: merchantApplicationReviews.decidedAt,
        })
        .from(merchantApplicationReviews)
        .where(
          eq(
            merchantApplicationReviews.merchantApplicationId,
            current.application.id,
          ),
        )
        .orderBy(desc(merchantApplicationReviews.decidedAt)),
    ]);
    return {
      application_id: current.application.id,
      status: current.application.status,
      operational_status: current.branchStatus,
      submissions,
      reviews,
    };
  }

  async listApplications(marketId: string, query: MerchantApplicationQueueDto) {
    const where = query.status
      ? and(
          eq(merchantBranches.marketId, marketId),
          eq(merchantApplications.status, query.status),
        )
      : eq(merchantBranches.marketId, marketId);
    return this.database.db
      .select({
        application_id: merchantApplications.id,
        branch_id: merchantBranches.id,
        merchant_id: merchantBranches.merchantId,
        display_name: merchantBranches.name,
        application_status: merchantApplications.status,
        operational_status: merchantBranches.status,
        updated_at: merchantApplications.updatedAt,
      })
      .from(merchantApplications)
      .innerJoin(
        merchantBranches,
        eq(merchantBranches.id, merchantApplications.merchantBranchId),
      )
      .where(where)
      .orderBy(merchantApplications.updatedAt)
      .limit(query.limit)
      .offset(query.offset);
  }

  async reviewApplication(
    marketId: string,
    branchId: string,
    adminUserId: string,
    input: ReviewMerchantApplicationDto,
    idempotencyKey: string,
    context: MerchantRequestContext,
  ) {
    return this.idempotent(
      `admin.merchant.application.review:${adminUserId}:${marketId}:${branchId}`,
      idempotencyKey,
      input,
      200,
      async (tx) => {
        const rows = await tx
          .select({
            application: merchantApplications,
            branch: merchantBranches,
          })
          .from(merchantApplications)
          .innerJoin(
            merchantBranches,
            eq(merchantBranches.id, merchantApplications.merchantBranchId),
          )
          .where(eq(merchantApplications.merchantBranchId, branchId))
          .for('update')
          .limit(1);
        let current = rows[0];
        if (!current) merchantNotFound();
        this.assertMarket(current.branch.marketId, marketId);
        if (
          current.application.status !== 'SUBMITTED' &&
          current.application.status !== 'UNDER_REVIEW'
        ) {
          invalidTransition(current.application.status, input.decision);
        }
        if (current.application.status === 'SUBMITTED') {
          const started = await tx
            .update(merchantApplications)
            .set({
              status: 'UNDER_REVIEW',
              version: current.application.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(merchantApplications.id, current.application.id))
            .returning();
          await this.audit.appendWithinTransaction(tx, {
            actor: { type: 'ADMIN_USER', id: adminUserId },
            action: 'merchant.application.review.start',
            entity: {
              type: 'merchant_application',
              id: current.application.id,
            },
            marketId,
            before: { status: 'SUBMITTED' },
            after: { status: 'UNDER_REVIEW' },
            reason: input.reason,
            result: 'SUCCESS',
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            summary: 'Merchant application review started.',
          });
          current = {
            ...current,
            application: started[0] ?? current.application,
          };
        }
        await tx.insert(merchantApplicationReviews).values({
          merchantApplicationId: current.application.id,
          reviewerAdminUserId: adminUserId,
          decision: input.decision,
          reason: input.reason,
        });
        await tx
          .update(merchantApplications)
          .set({
            status: input.decision,
            version: current.application.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(merchantApplications.id, current.application.id));
        await this.audit.appendWithinTransaction(tx, {
          actor: { type: 'ADMIN_USER', id: adminUserId },
          action: `merchant.application.${input.decision.toLowerCase()}`,
          entity: { type: 'merchant_application', id: current.application.id },
          marketId,
          before: { status: 'UNDER_REVIEW' },
          after: { status: input.decision },
          reason: input.reason,
          result: 'SUCCESS',
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          summary: `Merchant application review decided ${input.decision}.`,
        });
        const operationalStatus =
          await this.evaluateOperationalStatusWithinTransaction(
            tx,
            current.branch,
            { type: 'ADMIN_USER', id: adminUserId },
            'Application review changed activation inputs.',
            context,
          );
        return {
          application_id: current.application.id,
          branch_id: branchId,
          application_status: input.decision,
          operational_status: operationalStatus,
        };
      },
    );
  }

  async suspend(
    marketId: string,
    branchId: string,
    adminUserId: string,
    input: MerchantStatusActionDto,
    idempotencyKey: string,
    context: MerchantRequestContext,
  ) {
    return this.adminStatusTransition(
      'suspend',
      marketId,
      branchId,
      adminUserId,
      input,
      idempotencyKey,
      context,
    );
  }

  async reactivate(
    marketId: string,
    branchId: string,
    adminUserId: string,
    input: MerchantStatusActionDto,
    idempotencyKey: string,
    context: MerchantRequestContext,
  ) {
    return this.adminStatusTransition(
      'reactivate',
      marketId,
      branchId,
      adminUserId,
      input,
      idempotencyKey,
      context,
    );
  }

  async close(
    marketId: string,
    branchId: string,
    adminUserId: string,
    input: MerchantStatusActionDto,
    idempotencyKey: string,
    context: MerchantRequestContext,
  ) {
    return this.adminStatusTransition(
      'close',
      marketId,
      branchId,
      adminUserId,
      input,
      idempotencyKey,
      context,
    );
  }

  async reevaluateOperationalStatus(
    branchId: string,
    actor: TransitionActor,
    reason: string,
    context: MerchantRequestContext = {},
  ): Promise<OperationalStatus> {
    return this.database.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(merchantBranches)
        .where(eq(merchantBranches.id, branchId))
        .for('update')
        .limit(1);
      const branch = rows[0];
      if (!branch) merchantNotFound();
      return this.evaluateOperationalStatusWithinTransaction(
        tx,
        branch,
        actor,
        reason,
        context,
      );
    });
  }

  private async adminStatusTransition(
    action: 'suspend' | 'reactivate' | 'close',
    marketId: string,
    branchId: string,
    adminUserId: string,
    input: MerchantStatusActionDto,
    idempotencyKey: string,
    context: MerchantRequestContext,
  ) {
    return this.idempotent(
      `admin.merchant.${action}:${adminUserId}:${marketId}:${branchId}`,
      idempotencyKey,
      input,
      200,
      async (tx) => {
        const rows = await tx
          .select()
          .from(merchantBranches)
          .where(eq(merchantBranches.id, branchId))
          .for('update')
          .limit(1);
        let branch = rows[0];
        if (!branch) merchantNotFound();
        this.assertMarket(branch.marketId, marketId);
        const actor = { type: 'ADMIN_USER' as const, id: adminUserId };

        if (action === 'suspend') {
          if (branch.status !== 'ACTIVE') {
            invalidTransition(branch.status, 'SUSPENDED');
          }
          branch = await this.recordOperationalTransition(
            tx,
            branch,
            'SUSPENDED',
            actor,
            input.reason,
            context,
          );
        } else if (action === 'reactivate') {
          if (branch.status !== 'SUSPENDED') {
            invalidTransition(branch.status, 'REACTIVATE');
          }
          const derived = await this.deriveOperationalStatus(tx, branch.id);
          branch = await this.recordOperationalTransition(
            tx,
            branch,
            derived,
            actor,
            input.reason,
            context,
          );
        } else {
          if (branch.status === 'CLOSED') {
            invalidTransition(branch.status, 'CLOSED');
          }
          if (branch.status !== 'CLOSURE_PENDING') {
            branch = await this.recordOperationalTransition(
              tx,
              branch,
              'CLOSURE_PENDING',
              actor,
              input.reason,
              context,
            );
          }
          branch = await this.recordOperationalTransition(
            tx,
            branch,
            'CLOSED',
            actor,
            input.reason,
            context,
          );
        }
        return { branch_id: branch.id, operational_status: branch.status };
      },
    );
  }

  private async evaluateOperationalStatusWithinTransaction(
    tx: DatabaseTransaction,
    branch: typeof merchantBranches.$inferSelect,
    actor: TransitionActor,
    reason: string,
    context: MerchantRequestContext,
  ): Promise<OperationalStatus> {
    if (branch.status === 'SUSPENDED' || branch.status === 'CLOSED') {
      return branch.status;
    }
    const derived = await this.deriveOperationalStatus(tx, branch.id);
    if (derived === branch.status) return branch.status;
    const updated = await this.recordOperationalTransition(
      tx,
      branch,
      derived,
      actor,
      reason,
      context,
    );
    return updated.status;
  }

  private async deriveOperationalStatus(
    tx: DatabaseTransaction,
    branchId: string,
  ): Promise<OperationalStatus> {
    const applicationRows = await tx
      .select({ status: merchantApplications.status })
      .from(merchantApplications)
      .where(eq(merchantApplications.merchantBranchId, branchId))
      .limit(1);
    if (applicationRows[0]?.status !== 'APPROVED') {
      return 'PENDING_APPLICATION';
    }
    const kycRows = await tx
      .select({ status: merchantKycSubmissions.status })
      .from(merchantKycSubmissions)
      .where(eq(merchantKycSubmissions.merchantBranchId, branchId))
      .orderBy(desc(merchantKycSubmissions.submissionVersion))
      .limit(1);
    if (kycRows[0]?.status !== 'APPROVED') return 'PENDING_KYC';
    const mcpRows = await tx
      .select({
        meetsActivationThreshold: sql<boolean>`${mcpAccounts.availableBalance} >= 100`,
      })
      .from(mcpAccounts)
      .where(eq(mcpAccounts.merchantBranchId, branchId))
      .limit(1);
    const activeHistory = await tx
      .select({ id: merchantStatusHistory.id })
      .from(merchantStatusHistory)
      .where(
        and(
          eq(merchantStatusHistory.merchantBranchId, branchId),
          eq(merchantStatusHistory.newStatus, 'ACTIVE'),
        ),
      )
      .limit(1);
    return mcpRows[0]?.meetsActivationThreshold || activeHistory.length > 0
      ? 'ACTIVE'
      : 'PENDING_MCP';
  }

  private async recordOperationalTransition(
    tx: DatabaseTransaction,
    branch: typeof merchantBranches.$inferSelect,
    nextStatus: OperationalStatus,
    actor: TransitionActor,
    reason: string,
    context: MerchantRequestContext,
  ) {
    const rows = await tx
      .update(merchantBranches)
      .set({
        status: nextStatus,
        version: branch.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(merchantBranches.id, branch.id),
          eq(merchantBranches.version, branch.version),
        ),
      )
      .returning();
    const updated = rows[0];
    if (!updated) {
      merchantConflict(
        'MERCHANT_VERSION_CONFLICT',
        'The merchant branch changed during this request.',
      );
    }
    await tx.insert(merchantStatusHistory).values({
      merchantBranchId: branch.id,
      previousStatus: branch.status,
      newStatus: nextStatus,
      changedByActorType: actor.type,
      changedByActorId: actor.id,
      reason,
    });
    await this.audit.appendWithinTransaction(tx, {
      actor,
      action: `merchant.operational.${nextStatus.toLowerCase()}`,
      entity: { type: 'merchant_branch', id: branch.id },
      marketId: branch.marketId,
      before: { status: branch.status },
      after: { status: nextStatus },
      reason,
      result: 'SUCCESS',
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      summary: `Merchant operational status changed from ${branch.status} to ${nextStatus}.`,
    });
    return updated;
  }

  private async nextMerchantId(
    tx: DatabaseTransaction,
    marketId: string,
    channel: string,
  ): Promise<string> {
    const counter = await tx.execute<{ last_number: string }>(sql`
      insert into merchant_id_counters (market_id, channel, last_number)
      values (${marketId}, ${channel}, 1)
      on conflict (market_id, channel)
      do update set last_number = merchant_id_counters.last_number + 1
      returning last_number::text
    `);
    const number = counter.rows[0]?.last_number;
    if (!number) throw new Error('Merchant ID counter returned no value.');
    const marketRows = await tx
      .select({ code: markets.code })
      .from(markets)
      .where(eq(markets.id, marketId))
      .limit(1);
    const marketCode = marketRows[0]?.code;
    if (!marketCode) throw new Error('Market not found for Merchant ID.');
    return `${marketCode.toLowerCase()}_${channel}_${number.padStart(6, '0')}`;
  }

  private async profileWithinTransaction(
    tx: DatabaseTransaction,
    branchId: string,
  ) {
    const rows = await tx
      .select({
        branch_id: merchantBranches.id,
        display_name: merchantBranches.name,
        phone: merchantProfiles.phone,
        address: merchantProfiles.address,
        about: merchantProfiles.aboutUs,
        business_hours: merchantProfiles.businessHours,
        website: merchantProfiles.website,
        whatsapp: merchantProfiles.whatsapp,
        socials: merchantProfiles.socialLinks,
        logo_object_key: merchantProfiles.logoUrl,
        banner_object_key: merchantProfiles.bannerUrl,
      })
      .from(merchantBranches)
      .innerJoin(
        merchantProfiles,
        eq(merchantProfiles.merchantBranchId, merchantBranches.id),
      )
      .where(eq(merchantBranches.id, branchId))
      .limit(1);
    const response = rows[0];
    if (!response) merchantNotFound();
    return response;
  }

  private assertMarket(
    branchMarketId: string,
    requestedMarketId: string,
  ): void {
    if (branchMarketId !== requestedMarketId) {
      merchantForbidden(
        merchantErrorCodes.marketMismatch,
        'The requested market does not match the merchant branch.',
      );
    }
  }

  private async idempotent<T>(
    scope: string,
    key: string,
    payload: unknown,
    statusCode: number,
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
        const existingRows = await tx
          .select()
          .from(merchantApiIdempotencyKeys)
          .where(
            and(
              eq(merchantApiIdempotencyKeys.scope, scope),
              eq(merchantApiIdempotencyKeys.key, key),
            ),
          )
          .limit(1);
        const existing = existingRows[0];
        if (!existing || existing.requestHash !== requestHash) {
          merchantConflict(
            merchantErrorCodes.idempotencyConflict,
            'The Idempotency-Key was already used with another request.',
          );
        }
        if (existing.response === null || existing.statusCode === null) {
          merchantConflict(
            merchantErrorCodes.idempotencyConflict,
            'The previous idempotent request has no reusable result.',
          );
        }
        return existing.response as T;
      }
      const response = await work(tx);
      await tx
        .update(merchantApiIdempotencyKeys)
        .set({ response, statusCode, updatedAt: new Date() })
        .where(eq(merchantApiIdempotencyKeys.id, claimed[0]?.id ?? ''));
      return response;
    });
  }
}

export function deriveMerchantOperationalStatus(input: {
  applicationApproved: boolean;
  kycApproved: boolean;
  meetsActivationThreshold: boolean;
  previouslyActivated?: boolean;
}): OperationalStatus {
  if (!input.applicationApproved) return 'PENDING_APPLICATION';
  if (!input.kycApproved) return 'PENDING_KYC';
  return input.meetsActivationThreshold || input.previouslyActivated
    ? 'ACTIVE'
    : 'PENDING_MCP';
}

function invalidTransition(from: string, to: string): never {
  merchantConflict(
    merchantErrorCodes.invalidTransition,
    `Merchant state cannot change from ${from} to ${to}.`,
  );
}

function firstAvailablePosition(used: Set<number>): number {
  for (let position = 1; position <= 10; position += 1) {
    if (!used.has(position)) return position;
  }
  return 10;
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

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = 'cause' in error ? error.cause : error;
  return Boolean(
    candidate &&
    typeof candidate === 'object' &&
    'code' in candidate &&
    candidate.code === '23505',
  );
}

export function requireAccountActor(actor: RequestActor | undefined): string {
  if (!actor || actor.type !== 'ACCOUNT') {
    merchantForbidden(
      merchantErrorCodes.ownershipDenied,
      'A merchant account session is required.',
    );
  }
  return actor.accountId;
}

export function requireAdminActor(actor: RequestActor | undefined): string {
  if (!actor?.adminUserId) {
    merchantForbidden(
      'AUTH_PERMISSION_DENIED',
      'Admin permission is required.',
    );
  }
  return actor.adminUserId;
}
