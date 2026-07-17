import { z } from 'zod';

const serverEnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  AUTH_OTP_PEPPER: z.string().min(32),
  AUTH_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  AUTH_REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(2_592_000),
  AUTH_OTP_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  AUTH_OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  AUTH_OTP_RESEND_COOLDOWN_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(30),
  AUTH_IDEMPOTENCY_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(86_400),
  AUTH_REGISTRATION_EMAIL_RATE_LIMIT_COUNT: z.coerce
    .number()
    .int()
    .positive()
    .default(3),
  AUTH_REGISTRATION_EMAIL_RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60),
  AUTH_REGISTRATION_IP_RATE_LIMIT_COUNT: z.coerce
    .number()
    .int()
    .positive()
    .default(5),
  AUTH_REGISTRATION_IP_RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60),
  AUTH_LOGIN_EMAIL_RATE_LIMIT_COUNT: z.coerce
    .number()
    .int()
    .positive()
    .default(5),
  AUTH_LOGIN_EMAIL_RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(300),
  AUTH_LOGIN_IP_RATE_LIMIT_COUNT: z.coerce
    .number()
    .int()
    .positive()
    .default(10),
  AUTH_LOGIN_IP_RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(300),
  AUTH_PASSWORD_RESET_EMAIL_RATE_LIMIT_COUNT: z.coerce
    .number()
    .int()
    .positive()
    .default(3),
  AUTH_PASSWORD_RESET_EMAIL_RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(300),
  AUTH_PASSWORD_RESET_IP_RATE_LIMIT_COUNT: z.coerce
    .number()
    .int()
    .positive()
    .default(5),
  AUTH_PASSWORD_RESET_IP_RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(300),
  AUTH_MEMBER_PUBLIC_ID_PREFIX: z.string().min(1).default('IPM'),
  AUTH_MEMBER_PUBLIC_ID_LENGTH: z.coerce
    .number()
    .int()
    .min(6)
    .max(16)
    .default(10),
  AUTH_MEMBER_REFERRAL_CODE_LENGTH: z.coerce
    .number()
    .int()
    .min(6)
    .max(16)
    .default(8),
  APP_VERSION: z.string().default('0.0.0'),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function parseServerEnvironment(
  environment: NodeJS.ProcessEnv,
): ServerEnvironment {
  return serverEnvironmentSchema.parse(environment);
}
