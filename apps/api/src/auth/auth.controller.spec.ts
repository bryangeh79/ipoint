import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../config/config.service.js';
import { AuthController } from './auth.controller.js';
import { AuthError } from './auth.errors.js';
import type { AuthService } from './auth.service.js';

function createController(options: { production?: boolean } = {}) {
  const auth = {
    login: vi.fn(),
    rotateRefreshToken: vi.fn(),
    logout: vi.fn(),
    issueOtp: vi.fn(),
    issuePasswordResetOtp: vi.fn(),
    verifyOtp: vi.fn(),
    resetPasswordFromOtp: vi.fn(),
  };
  const config = {
    isDevelopment: !options.production,
    isTest: false,
    isProduction: Boolean(options.production),
  } as ConfigService;
  return {
    auth,
    controller: new AuthController(auth as unknown as AuthService, config),
  };
}

const request = {
  headers: { 'user-agent': 'AuthControllerTest/1.0' },
  requestId: 'request-1',
} as unknown as Request;

describe('AuthController', () => {
  it('maps invalid credentials to a safe unauthorized response', async () => {
    const { auth, controller } = createController();
    auth.login.mockRejectedValue(
      new AuthError('AUTH_INVALID_CREDENTIALS', 'Invalid credentials.'),
    );
    await expect(
      controller.login(
        { email: 'merchant@example.com', password: 'valid-password-123' },
        '127.0.0.1',
        request,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('exposes an OTP code only outside production and never claims delivery', async () => {
    const issued = {
      id: '3e07665a-8517-43b9-ac58-0a8a2ef99814',
      code: '123456',
      expiresAt: new Date('2026-07-17T06:00:00Z'),
    };
    const development = createController();
    development.auth.issueOtp.mockResolvedValue(issued);
    await expect(
      development.controller.issueOtp(
        {
          destination: 'merchant@example.com',
          purpose: 'EMAIL_VERIFICATION',
        },
        '127.0.0.1',
        request,
      ),
    ).resolves.toMatchObject({
      delivery_status: 'NOT_SENT',
      development_code: '123456',
    });

    const production = createController({ production: true });
    production.auth.issueOtp.mockResolvedValue(issued);
    const response = await production.controller.issueOtp(
      {
        destination: 'merchant@example.com',
        purpose: 'EMAIL_VERIFICATION',
      },
      '127.0.0.1',
      request,
    );
    expect(response).not.toHaveProperty('development_code');
    expect(response.delivery_status).toBe('NOT_SENT');
  });

  it('maps rate limiting to HTTP 429', async () => {
    const { auth, controller } = createController();
    auth.issuePasswordResetOtp.mockRejectedValue(
      new AuthError('AUTH_RATE_LIMITED', 'Too many requests.'),
    );
    await expect(
      controller.issueOtp(
        {
          destination: 'merchant@example.com',
          purpose: 'PASSWORD_RESET',
        },
        '127.0.0.1',
        request,
      ),
    ).rejects.toMatchObject({ status: 429 });
  });
});
