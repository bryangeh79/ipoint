import { Inject, Injectable } from '@nestjs/common';
import { memberProfiles, members } from '@ipoint/database';
import { eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
  ageVerificationFailedError,
  birthDateInvalidError,
  displayNameInvalidError,
  genderInvalidError,
  phoneDuplicateError,
  phoneInvalidError,
  profileNotFoundError,
} from './profile.errors.js';
import type { ProfileResponse, UpdateProfileInput } from './profile.types.js';

@Injectable()
export class ProfileService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  private async resolveMemberId(accountId: string): Promise<string> {
    const rows = await this.database.db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.accountId, accountId))
      .limit(1);
    if (!rows[0]) throw profileNotFoundError();
    return rows[0].id;
  }

  private toResponse(row: typeof memberProfiles.$inferSelect): ProfileResponse {
    return {
      id: row.id,
      memberId: row.memberId,
      displayName: row.displayName,
      fullName: row.fullName,
      phone: row.phone,
      phoneNormalized: row.phoneNormalized,
      phoneVerificationStatus: row.phoneVerificationStatus,
      phoneVerifiedAt: row.phoneVerifiedAt?.toISOString() ?? null,
      phoneChangedAt: row.phoneChangedAt?.toISOString() ?? null,
      birthDate: row.birthDate,
      address: row.address as Record<string, unknown> | null,
      avatarObjectKey: row.avatarObjectKey,
      language: row.language,
      locale: row.locale,
      marketingOptIn: row.marketingOptIn,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Normalize a phone number to canonical E.164 format.
   * Only removes non-digit characters after the leading +.
   */
  private normalizeE164(phone: string): string {
    // Strip all non-digit characters after the leading +
    const digits = phone.slice(1).replace(/\D/g, '');
    return `+${digits}`;
  }

  /**
   * Check uniqueness of a phone number using the normalized form.
   */
  private async checkPhoneUniqueness(
    phone: string,
    memberId: string,
  ): Promise<void> {
    const normalized = this.normalizeE164(phone);
    const existing = await this.database.db
      .select({ id: memberProfiles.id })
      .from(memberProfiles)
      .where(
        sql`${memberProfiles.phoneNormalized} = ${normalized} AND ${memberProfiles.memberId} != ${memberId}`,
      )
      .limit(1);
    if (existing[0]) throw phoneDuplicateError();
  }

  /**
   * Validate E.164 format and normalize.
   * Returns the normalized version.
   */
  private validateAndNormalizePhone(phone: string): string {
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw phoneInvalidError();
    return this.normalizeE164(phone);
  }

  async getProfile(accountId: string): Promise<ProfileResponse> {
    const memberId = await this.resolveMemberId(accountId);
    const rows = await this.database.db
      .select()
      .from(memberProfiles)
      .where(eq(memberProfiles.memberId, memberId))
      .limit(1);
    if (!rows[0]) {
      // Auto-create default profile with null displayName (no forced '')
      const now = new Date();
      const defaults = {
        memberId,
        displayName: null,
        fullName: null,
        phone: null,
        phoneNormalized: null,
        phoneVerificationStatus: 'NOT_PROVIDED',
        phoneVerifiedAt: null,
        phoneChangedAt: null,
        birthDate: null,
        address: null,
        avatarObjectKey: null,
        language: null,
        locale: null,
        marketingOptIn: false,
        createdAt: now,
        updatedAt: now,
      };
      const inserted = await this.database.db
        .insert(memberProfiles)
        .values(defaults as typeof memberProfiles.$inferInsert)
        .onConflictDoNothing({ target: memberProfiles.memberId })
        .returning();
      if (inserted[0]) return this.toResponse(inserted[0]);
      const reRead = await this.database.db
        .select()
        .from(memberProfiles)
        .where(eq(memberProfiles.memberId, memberId))
        .limit(1);
      if (!reRead[0]) throw profileNotFoundError();
      return this.toResponse(reRead[0]);
    }
    return this.toResponse(rows[0]);
  }

  async updateProfile(
    accountId: string,
    input: UpdateProfileInput,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _metadata: Record<string, unknown>,
  ): Promise<ProfileResponse> {
    const memberId = await this.resolveMemberId(accountId);

    // Validate displayName: allow null/undefined (no change), reject too short
    if (input.displayName !== undefined) {
      if (input.displayName !== null) {
        const trimmed = input.displayName.trim();
        if (trimmed.length < 2 || trimmed.length > 50)
          throw displayNameInvalidError();
        if (trimmed.length === 0) throw displayNameInvalidError();
      }
    }

    // Phone validation: E.164 + uniqueness via phoneNormalized
    let phoneNormalized: string | null = null;
    if (input.phone !== undefined) {
      if (input.phone !== null) {
        phoneNormalized = this.validateAndNormalizePhone(input.phone);
        await this.checkPhoneUniqueness(input.phone, memberId);
      }
      // phone cleared -> set verification to NOT_PROVIDED
    }

    // Birth date validation
    if (input.birthDate !== undefined) {
      if (input.birthDate !== null) {
        const birth = new Date(input.birthDate);
        if (Number.isNaN(birth.getTime()) || birth >= new Date())
          throw birthDateInvalidError();
        const now = new Date();
        let age = now.getFullYear() - birth.getFullYear();
        const monthDiff = now.getMonth() - birth.getMonth();
        if (
          monthDiff < 0 ||
          (monthDiff === 0 && now.getDate() < birth.getDate())
        )
          age--;
        if (age < 18) throw ageVerificationFailedError();
      }
    }

    // Gender validation
    if (
      input.gender !== undefined &&
      !['male', 'female', 'prefer_not_to_say'].includes(input.gender)
    ) {
      throw genderInvalidError();
    }

    // Build updateData from input fields
    const updateData: Record<string, unknown> = {};
    const fields: (keyof UpdateProfileInput)[] = [
      'displayName',
      'fullName',
      'birthDate',
      'address',
      'avatarObjectKey',
      'language',
      'locale',
      'marketingOptIn',
    ];
    for (const field of fields) {
      if (input[field] !== undefined) {
        updateData[field] = input[field] === null ? null : input[field];
      }
    }

    // Phone-specific handling
    if (input.phone !== undefined) {
      if (input.phone === null) {
        updateData['phone'] = null;
        updateData['phoneNormalized'] = null;
        updateData['phoneVerificationStatus'] = 'NOT_PROVIDED';
        updateData['phoneChangedAt'] = null;
        updateData['phoneVerifiedAt'] = null;
      } else {
        updateData['phone'] = input.phone;
        updateData['phoneNormalized'] = phoneNormalized;
        updateData['phoneVerificationStatus'] = 'PENDING';
        updateData['phoneChangedAt'] = new Date();
        updateData['phoneVerifiedAt'] = null;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return this.getProfile(accountId);
    }

    // Upsert: use onConflictDoUpdate to either insert or update
    const upsertValues: Record<string, unknown> = {
      memberId,
      ...updateData,
    };

    const inserted = await this.database.db
      .insert(memberProfiles)
      .values(upsertValues as typeof memberProfiles.$inferInsert)
      .onConflictDoUpdate({
        target: memberProfiles.memberId,
        set: updateData as Partial<typeof memberProfiles.$inferInsert>,
      })
      .returning();

    return this.toResponse(
      (inserted[0] ??
        (await this.getProfile(
          accountId,
        ))) as unknown as typeof memberProfiles.$inferSelect,
    );
  }
}
