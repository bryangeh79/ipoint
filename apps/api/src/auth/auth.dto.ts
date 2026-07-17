import { z } from 'zod';

export const loginSchema = z
  .object({
    email: z.email().trim().toLowerCase(),
    password: z.string().min(12).max(256),
  })
  .strict();

export const refreshSchema = z
  .object({ refresh_token: z.string().trim().min(32).max(512) })
  .strict();

export const issueOtpSchema = z
  .object({
    destination: z.email().trim().toLowerCase(),
    purpose: z.enum(['EMAIL_VERIFICATION', 'PASSWORD_RESET']),
  })
  .strict();

export const verifyOtpSchema = z
  .object({
    otp_id: z.uuid(),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/u),
  })
  .strict();

export const resetPasswordSchema = z
  .object({
    otp_id: z.uuid(),
    new_password: z.string().min(12).max(256),
  })
  .strict();

export const registrationInitiateSchema = z
  .object({
    email: z.email().trim().toLowerCase(),
    password: z.string().min(12).max(256),
    idempotency_key: z.string().trim().min(8).max(128).optional(),
    account_country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/u),
    referral_code: z
      .string()
      .trim()
      .min(8)
      .max(64)
      .regex(/^[A-Za-z0-9]+$/u)
      .nullable()
      .optional(),
    terms_version: z.string().trim().min(1).max(64),
    disclaimer_version: z.string().trim().min(1).max(64),
    privacy_version: z.string().trim().min(1).max(64),
    locale: z.string().trim().min(2).max(32),
  })
  .strict();

export const registrationResendSchema = z.object({ otp_id: z.uuid() }).strict();

export const registrationCompleteSchema = z
  .object({
    otp_id: z.uuid(),
    idempotency_key: z.string().trim().min(8).max(128),
  })
  .strict();

export const passwordResetInitiateSchema = z
  .object({
    email: z.email().trim().toLowerCase(),
  })
  .strict();

export const passwordResetVerifySchema = verifyOtpSchema;

export const passwordResetCompleteSchema = z
  .object({
    otp_id: z.uuid(),
    new_password: z.string().min(12).max(256),
    idempotency_key: z.string().trim().min(8).max(128),
  })
  .strict();

export type LoginDto = z.infer<typeof loginSchema>;
export type RefreshDto = z.infer<typeof refreshSchema>;
export type IssueOtpDto = z.infer<typeof issueOtpSchema>;
export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
export type RegistrationInitiateDto = z.infer<
  typeof registrationInitiateSchema
>;
export type RegistrationResendDto = z.infer<typeof registrationResendSchema>;
export type RegistrationCompleteDto = z.infer<
  typeof registrationCompleteSchema
>;
export type PasswordResetInitiateDto = z.infer<
  typeof passwordResetInitiateSchema
>;
export type PasswordResetVerifyDto = z.infer<typeof passwordResetVerifySchema>;
export type PasswordResetCompleteDto = z.infer<
  typeof passwordResetCompleteSchema
>;
