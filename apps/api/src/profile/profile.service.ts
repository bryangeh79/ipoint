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

  async getProfile(accountId: string): Promise<ProfileResponse> {
    const memberId = await this.resolveMemberId(accountId);
    const rows = await this.database.db
      .select()
      .from(memberProfiles)
      .where(eq(memberProfiles.memberId, memberId))
      .limit(1);
    if (!rows[0]) {
      // Auto-create default profile
      const now = new Date();
      const defaults = {
        memberId,
        displayName: '',
        fullName: null,
        phone: null,
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

    if (input.displayName !== undefined) {
      const trimmed = input.displayName.trim();
      if (trimmed.length < 2 || trimmed.length > 50)
        throw displayNameInvalidError();
      if (trimmed.length === 0) throw displayNameInvalidError();
    }

    if (input.phone !== undefined) {
      if (!/^\+[1-9]\d{6,14}$/.test(input.phone)) throw phoneInvalidError();
      const existing = await this.database.db
        .select({ id: memberProfiles.id })
        .from(memberProfiles)
        .where(
          sql`${memberProfiles.phone} = ${input.phone} AND ${memberProfiles.memberId} != ${memberId}`,
        )
        .limit(1);
      if (existing[0]) throw phoneDuplicateError();
    }

    if (input.birthDate !== undefined) {
      const birth = new Date(input.birthDate);
      if (Number.isNaN(birth.getTime()) || birth >= new Date())
        throw birthDateInvalidError();
      const now = new Date();
      let age = now.getFullYear() - birth.getFullYear();
      const monthDiff = now.getMonth() - birth.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate()))
        age--;
      if (age < 18) throw ageVerificationFailedError();
    }

    if (
      input.gender !== undefined &&
      !['male', 'female', 'prefer_not_to_say'].includes(input.gender)
    ) {
      throw genderInvalidError();
    }

    const updateData: Record<string, unknown> = {};
    const fields = [
      'displayName',
      'fullName',
      'phone',
      'birthDate',
      'address',
      'avatarObjectKey',
      'language',
      'locale',
      'marketingOptIn',
    ] as const;
    for (const field of fields) {
      const key = field as keyof UpdateProfileInput;
      if (input[key] !== undefined) {
        updateData[field] = input[key];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return this.getProfile(accountId);
    }

    const upsertValues: Record<string, unknown> = {
      memberId,
      displayName: input.displayName ?? '',
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
