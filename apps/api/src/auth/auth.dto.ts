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

export type LoginDto = z.infer<typeof loginSchema>;
export type RefreshDto = z.infer<typeof refreshSchema>;
export type IssueOtpDto = z.infer<typeof issueOtpSchema>;
export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
