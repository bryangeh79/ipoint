import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';
import { BadRequestException } from '@nestjs/common';

describe('ZodValidationPipe', () => {
  const testSchema = z.object({
    name: z.string().min(2).max(100),
    age: z.number().int().positive(),
  });

  const pipe = new ZodValidationPipe(testSchema);

  it('should pass valid data through', () => {
    const input = { name: 'John', age: 30 };
    const result = pipe.transform(input);
    expect(result).toEqual(input);
  });

  it('should throw BadRequestException for invalid data', () => {
    const input = { name: 'J', age: -5 };
    expect(() => pipe.transform(input)).toThrow(BadRequestException);
  });

  it('should throw BadRequestException with validation details', () => {
    const input = { name: '', age: -1 };
    try {
      pipe.transform(input);
      expect.unreachable('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as Record<
        string,
        unknown
      >;
      expect(response.message).toBe('Validation failed');
      expect(response.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(response.details)).toBe(true);
      expect((response.details as Array<unknown>).length).toBeGreaterThan(0);
    }
  });

  it('should reject extra properties', () => {
    const input = { name: 'John', age: 30, extraField: 'should not be here' };
    expect(() => pipe.transform(input)).toThrow(BadRequestException);
  });

  it('should transform string numbers to numbers when using coerce', () => {
    const coercingSchema = z.object({
      count: z.coerce.number().int().positive(),
    });
    const coercingPipe = new ZodValidationPipe(coercingSchema);
    const result = coercingPipe.transform({ count: '5' });
    expect(result).toEqual({ count: 5 });
  });
});
