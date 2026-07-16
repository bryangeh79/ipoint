import {
  PipeTransform,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import type { ZodSchema, ZodError } from 'zod';

/**
 * A NestJS PipeTransform that validates input against a Zod schema.
 * Use with `@Body()`, `@Query()`, or `@Param()` decorators.
 *
 * Example:
 * ```typescript
 * @Post()
 * create(@Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserDto) {
 *   // dto is already validated and typed by Zod
 * }
 * ```
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const error = result.error as ZodError;
      const formatted = error.issues.map(
        (issue: { path: (string | number | symbol)[]; message: string; code?: string }) => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code ?? 'unknown',
        }),
      );
      throw new BadRequestException({
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: formatted,
      });
    }
    return result.data;
  }
}
