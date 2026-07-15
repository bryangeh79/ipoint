import { z } from 'zod';

export const marketCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(16)
  .regex(/^[A-Z0-9_-]+$/);

export const timezoneSchema = z
  .string()
  .trim()
  .refine(
    (value) => {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid IANA timezone' },
  );
