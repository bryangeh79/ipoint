// ---------------------------------------------------------------------------
// OpenAPI Consistency — Reflection-based verification
//
// NOTE: vitest uses esbuild for transpilation, which does NOT emit
// TypeScript's `design:paramtypes` metadata (emitDecoratorMetadata is a
// tsc-only feature). Because SwaggerModule.createDocument relies on this
// metadata, we cannot generate a full Swagger document inside vitest.
//
// Instead, this test reads the Swagger-related decorator metadata directly
// from the controller prototype and verifies that all expected endpoints
// have the required annotations.
// ---------------------------------------------------------------------------

import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { AuthController } from '../auth/auth.controller.js';

interface EndpointCheck {
  path: string;
  methodName: string;
  authRequired: boolean;
  successStatus: number;
  hasRequestBody: boolean;
}

const expectedEndpoints: EndpointCheck[] = [
  // 3.1 Login & Session
  {
    path: '/auth/login',
    methodName: 'login',
    authRequired: false,
    successStatus: 200,
    hasRequestBody: true,
  },
  {
    path: '/auth/member/login',
    methodName: 'memberLogin',
    authRequired: false,
    successStatus: 200,
    hasRequestBody: true,
  },
  {
    path: '/auth/refresh',
    methodName: 'refresh',
    authRequired: false,
    successStatus: 200,
    hasRequestBody: true,
  },
  {
    path: '/auth/member/refresh',
    methodName: 'memberRefresh',
    authRequired: false,
    successStatus: 200,
    hasRequestBody: true,
  },
  {
    path: '/auth/logout',
    methodName: 'logout',
    authRequired: true,
    successStatus: 204,
    hasRequestBody: false,
  },
  {
    path: '/auth/member/logout',
    methodName: 'memberLogout',
    authRequired: true,
    successStatus: 204,
    hasRequestBody: false,
  },
  // 3.2 Registration Flow
  {
    path: '/auth/registration/initiate',
    methodName: 'initiateRegistration',
    authRequired: false,
    successStatus: 202,
    hasRequestBody: true,
  },
  {
    path: '/auth/member/register',
    methodName: 'memberInitiateRegistration',
    authRequired: false,
    successStatus: 202,
    hasRequestBody: true,
  },
  {
    path: '/auth/registration/verify',
    methodName: 'verifyRegistrationOtp',
    authRequired: false,
    successStatus: 200,
    hasRequestBody: true,
  },
  {
    path: '/auth/member/register/verify',
    methodName: 'memberVerifyRegistrationOtp',
    authRequired: false,
    successStatus: 200,
    hasRequestBody: true,
  },
  {
    path: '/auth/registration/complete',
    methodName: 'completeRegistration',
    authRequired: false,
    successStatus: 200,
    hasRequestBody: true,
  },
  {
    path: '/auth/member/register/complete',
    methodName: 'memberCompleteRegistration',
    authRequired: false,
    successStatus: 200,
    hasRequestBody: true,
  },
  {
    path: '/auth/registration/resend',
    methodName: 'resendRegistrationOtp',
    authRequired: false,
    successStatus: 202,
    hasRequestBody: true,
  },
  {
    path: '/auth/member/register/resend-otp',
    methodName: 'memberResendRegistrationOtp',
    authRequired: false,
    successStatus: 202,
    hasRequestBody: true,
  },
  // 3.3 Password Reset Flow
  {
    path: '/auth/password-reset/initiate',
    methodName: 'initiatePasswordReset',
    authRequired: false,
    successStatus: 202,
    hasRequestBody: true,
  },
  {
    path: '/auth/member/password-reset/request',
    methodName: 'memberInitiatePasswordReset',
    authRequired: false,
    successStatus: 202,
    hasRequestBody: true,
  },
  {
    path: '/auth/password-reset/verify',
    methodName: 'verifyPasswordResetOtp',
    authRequired: false,
    successStatus: 200,
    hasRequestBody: true,
  },
  {
    path: '/auth/member/password-reset/verify',
    methodName: 'memberVerifyPasswordResetOtp',
    authRequired: false,
    successStatus: 200,
    hasRequestBody: true,
  },
  {
    path: '/auth/password-reset/complete',
    methodName: 'completePasswordReset',
    authRequired: false,
    successStatus: 204,
    hasRequestBody: true,
  },
  {
    path: '/auth/member/password-reset/complete',
    methodName: 'memberCompletePasswordReset',
    authRequired: false,
    successStatus: 204,
    hasRequestBody: true,
  },
  // 3.4 General OTP
  {
    path: '/auth/otp/issue',
    methodName: 'issueOtp',
    authRequired: false,
    successStatus: 202,
    hasRequestBody: true,
  },
  {
    path: '/auth/otp/verify',
    methodName: 'verifyOtp',
    authRequired: false,
    successStatus: 200,
    hasRequestBody: true,
  },
  {
    path: '/auth/password/reset',
    methodName: 'resetPassword',
    authRequired: false,
    successStatus: 204,
    hasRequestBody: true,
  },
];

function getMethod(name: string): object | undefined {
  const proto = AuthController.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, name);
  return desc?.value as object | undefined;
}

function getApiOperation(name: string): Record<string, unknown> | undefined {
  const method = getMethod(name);
  if (!method) return undefined;
  return Reflect.getMetadata('swagger/apiOperation', method) as Record<string, unknown> | undefined;
}

function getApiResponses(name: string): Record<string, unknown> | undefined {
  const method = getMethod(name);
  if (!method) return undefined;
  return Reflect.getMetadata('swagger/apiResponse', method) as Record<string, unknown> | undefined;
}

function getApiParameters(name: string): unknown[] | undefined {
  const method = getMethod(name);
  if (!method) return undefined;
  return Reflect.getMetadata('swagger/apiParameters', method) as unknown[] | undefined;
}

function getApiSecurity(name: string): unknown[] | undefined {
  const method = getMethod(name);
  if (!method) return undefined;
  return Reflect.getMetadata('swagger/apiSecurity', method) as unknown[] | undefined;
}

describe('OpenAPI Consistency (Reflection)', () => {
  // @ApiTags on controller class
  it('should have @ApiTags("Auth") on controller', () => {
    const tags = Reflect.getMetadata('swagger/apiUseTags', AuthController) as unknown[] | undefined;
    expect(tags).toBeDefined();
    expect(Array.isArray(tags)).toBe(true);
    expect(tags).toContain('Auth');
  });

  // Verify controller has all expected methods
  it(
    'should include all ' +
      expectedEndpoints.length +
      ' expected endpoint methods',
    () => {
      const missing: string[] = [];
      for (const ep of expectedEndpoints) {
        const method = getMethod(ep.methodName);
        if (!method) {
          missing.push(ep.methodName);
        }
      }
      expect(missing).toEqual([]);
    },
  );

  // Per-endpoint metadata checks
  for (const ep of expectedEndpoints) {
    describe(ep.methodName + ' -> ' + ep.path, () => {
      it('should have @ApiOperation (summary + description)', () => {
        const operation = getApiOperation(ep.methodName);
        expect(operation).toBeDefined();
        expect(typeof operation!.summary).toBe('string');
        expect((operation!.summary as string).length).toBeGreaterThan(0);
        expect(typeof operation!.description).toBe('string');
        expect((operation!.description as string).length).toBeGreaterThan(0);
      });

      it(
        'should have @ApiResponse for success status ' + ep.successStatus,
        () => {
          const responses = getApiResponses(ep.methodName);
          expect(responses).toBeDefined();
          expect(
            (responses as Record<string, unknown>)[String(ep.successStatus)],
          ).toBeDefined();
        },
      );

      it('should have error response descriptions mentioning AUTH_ error codes', () => {
        const responses = getApiResponses(ep.methodName);
        expect(responses).toBeDefined();
        const hasErrorDesc = Object.entries(responses!).some(
          ([status, resp]) =>
            Number(status) >= 400 &&
            typeof resp === 'object' &&
            resp !== null &&
            'description' in (resp as Record<string, unknown>) &&
            ((resp as Record<string, unknown>).description as string).includes(
              'AUTH_',
            ),
        );
        expect(hasErrorDesc).toBe(true);
      });

      it('should have summary length 5-120 chars', () => {
        const operation = getApiOperation(ep.methodName);
        if (operation) {
          const summary = operation.summary as string;
          expect(summary.length).toBeGreaterThanOrEqual(5);
          expect(summary.length).toBeLessThanOrEqual(120);
        }
      });

      if (ep.authRequired) {
        it('should have @ApiBearerAuth security', () => {
          const security = getApiSecurity(ep.methodName);
          expect(security).toBeDefined();
          const hasBearer = (security as unknown[]).some(
            (s: unknown) =>
              (s as Record<string, unknown>)['bearer'] !== undefined,
          );
          expect(hasBearer).toBe(true);
        });
      }

      if (ep.hasRequestBody) {
        it('should have @ApiBody with object schema', () => {
          const params = getApiParameters(ep.methodName);
          expect(params).toBeDefined();
          const bodyParam = (params as unknown[]).find(
            (p: unknown) => (p as Record<string, unknown>)['in'] === 'body',
          );
          expect(bodyParam).toBeDefined();
          const schema = (bodyParam as Record<string, unknown>)['schema'] as
            | Record<string, unknown>
            | undefined;
          expect(schema).toBeDefined();
          expect(schema!['type']).toBe('object');
        });
      }
    });
  }
});
