// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../auth/AuthProvider.tsx';
import { ForgotPasswordPage } from '../../pages/ForgotPasswordPage.tsx';
import { ResetPasswordPage } from '../../pages/ResetPasswordPage.tsx';
import { LoginPage } from '../../pages/LoginPage.tsx';
import { ApiClient, ApiError } from '@ipoint/api-client';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'auth.forgotPasswordTitle': 'Reset your password',
        'auth.forgotPasswordButton': 'Send Reset Code',
        'auth.forgotPasswordSubmitting': 'Sending...',
        'auth.forgotPasswordSent':
          "If this email is registered, you'll receive a reset code.",
        'auth.email': 'Email',
        'auth.emailPlaceholder': 'you@example.com',
        'auth.login': 'Log In',
        'auth.resetPasswordTitle': 'Set a new password',
        'auth.verifyOtpDescription':
          'We sent a 6-digit code to your email. Enter it below to continue.',
        'auth.otpCode': 'Verification Code',
        'auth.otpDigitLabel': 'Digit {position}',
        'auth.submitOtp': 'Verify Code',
        'auth.newPassword': 'New Password',
        'auth.confirmNewPassword': 'Confirm New Password',
        'auth.passwordMinLength': 'Password must be at least 12 characters',
        'auth.passwordMismatch': 'Passwords do not match',
        'auth.resetPasswordButton': 'Reset Password',
        'auth.resetPasswordSubmitting': 'Resetting...',
        'auth.resetPasswordSuccess':
          'Password reset successful! You can now log in with your new password.',
        'auth.otpInvalid': 'Wrong code. ? attempt(s) remaining.',
        'auth.otpRequired': 'Please enter the 6-digit verification code',
        'auth.somethingWentWrong': 'Something went wrong. Please try again.',
        'auth.networkError': 'Network error. Please check your connection.',
        'auth.passwordResetSuccessDescription':
          'Your password has been reset. Redirecting to login...',
        'auth.resendCode': 'Resend Code',
        'auth.resendCooldown': 'Resend in {seconds}s',
        'common.retry': 'Retry',
        'common.error': 'Something went wrong',
        'common.loading': 'Loading...',
        'errors.offline': 'You are offline',
        'register.fieldRequired': 'This field is required',
        'register.invalidEmail': 'Please enter a valid email address',
        'register.invalidReferralCode':
          'Referral code must be at least 8 alphanumeric characters',
      };
      if (options) {
        let result = key;
        if (options.position !== undefined)
          result = result.replace('{position}', String(options.position));
        if (options.seconds !== undefined)
          result = result.replace('{seconds}', String(options.seconds));
        if (options.attempts !== undefined)
          result = result.replace('{attempts}', String(options.attempts));
        return result;
      }
      return translations[key] ?? key;
    },
    i18n: {
      language: 'en',
    },
  }),
}));

function createTestClient() {
  const client = new ApiClient('http://localhost:3000/api/v1');
  vi.spyOn(client, 'attemptSessionRestore').mockResolvedValue(false);
  vi.spyOn(client, 'get').mockRejectedValue(
    new ApiError(401, {
      code: 'AUTH_SESSION_INVALID',
      message: 'Not authenticated',
    }),
  );
  return client;
}

function renderPasswordResetFlow(
  client: ApiClient,
  initialRoute = '/forgot-password',
) {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <AuthProvider apiClient={client} autoRestore={false}>
        <Routes>
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('PasswordReset flow', () => {
  let client: ApiClient;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client = createTestClient();
    user = userEvent.setup({ advanceTimers: () => vi.advanceTimersByTime(1) });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('ForgotPasswordPage', () => {
    it('shows email field', () => {
      renderPasswordResetFlow(client);
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Send Reset Code' }),
      ).toBeInTheDocument();
    });

    it('calls password-reset/initiate on submit', async () => {
      renderPasswordResetFlow(client);

      const mockPost = vi.spyOn(client, 'post').mockResolvedValue({
        data: {
          otp_id: 'reset-otp-id',
          expires_at: new Date().toISOString(),
        },
        requestId: 'req-1',
      });

      await user.type(screen.getByLabelText('Email'), 'user@example.com');
      await user.click(screen.getByRole('button', { name: 'Send Reset Code' }));

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith(
          '/auth/password-reset/initiate',
          { email: 'user@example.com' },
          { skipAuth: true },
        );
      });
    });

    it('navigates to reset-password on success', async () => {
      renderPasswordResetFlow(client);

      vi.spyOn(client, 'post').mockResolvedValue({
        data: {
          otp_id: 'otp-for-reset',
          expires_at: new Date().toISOString(),
        },
        requestId: 'req-1',
      });

      await user.type(screen.getByLabelText('Email'), 'user@example.com');
      await user.click(screen.getByRole('button', { name: 'Send Reset Code' }));
      await vi.runAllTimersAsync();

      await waitFor(() => {
        // Should be on the reset-password page now
        expect(screen.getByText('Set a new password')).toBeInTheDocument();
      });
    });
  });

  describe('ResetPasswordPage - full flow', () => {
    it('shows OTP input when navigated from forgot-password', async () => {
      // Navigate directly to reset-password with otp_id
      renderPasswordResetFlow(client, '/reset-password?otp_id=test-otp-id');

      await waitFor(() => {
        expect(
          screen.getByText(
            'We sent a 6-digit code to your email. Enter it below to continue.',
          ),
        ).toBeInTheDocument();
      });

      // Should show 6 digit inputs
      const digits = screen.getAllByRole('textbox');
      expect(digits).toHaveLength(6);
    });

    it('validates OTP and shows password form on success', async () => {
      renderPasswordResetFlow(client, '/reset-password?otp_id=test-otp-id');

      vi.spyOn(client, 'post').mockResolvedValueOnce({
        data: { verified: true },
        requestId: 'req-1',
      });

      // Enter 6 digits
      const digits = screen.getAllByRole('textbox');
      await user.type(digits[0], '1');
      await user.type(digits[1], '2');
      await user.type(digits[2], '3');
      await user.type(digits[3], '4');
      await user.type(digits[4], '5');
      await user.type(digits[5], '6');

      await user.click(screen.getByRole('button', { name: 'Verify Code' }));
      await vi.runAllTimersAsync();

      await waitFor(() => {
        // Should now show new password form
        expect(screen.getByLabelText('New Password')).toBeInTheDocument();
        expect(
          screen.getByLabelText('Confirm New Password'),
        ).toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: 'Reset Password' }),
        ).toBeInTheDocument();
      });
    });

    it('completes password reset and redirects to login', async () => {
      renderPasswordResetFlow(client, '/reset-password?otp_id=test-otp-id');

      // Step 1: Verify OTP
      vi.spyOn(client, 'post')
        .mockResolvedValueOnce({
          data: { verified: true },
          requestId: 'req-1',
        })
        // Step 2: Complete password reset
        .mockResolvedValueOnce({
          data: undefined,
          requestId: 'req-2',
        });

      // Enter 6 digits
      const digits = screen.getAllByRole('textbox');
      await user.type(digits[0], '1');
      await user.type(digits[1], '2');
      await user.type(digits[2], '3');
      await user.type(digits[3], '4');
      await user.type(digits[4], '5');
      await user.type(digits[5], '6');

      await user.click(screen.getByRole('button', { name: 'Verify Code' }));
      await vi.runAllTimersAsync();

      // Step 2: Enter new password
      await waitFor(() => {
        expect(screen.getByLabelText('New Password')).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText('New Password'), 'newPassword123!');
      await user.type(
        screen.getByLabelText('Confirm New Password'),
        'newPassword123!',
      );

      await user.click(screen.getByRole('button', { name: 'Reset Password' }));
      await vi.runAllTimersAsync();

      // Should show success message
      await waitFor(() => {
        expect(
          screen.getByText(/Password reset successful/i),
        ).toBeInTheDocument();
      });

      // After timeout, should redirect to login
      vi.advanceTimersByTime(3000);

      await waitFor(() => {
        expect(screen.getByText('Log In')).toBeInTheDocument();
      });
    });

    it('shows error on invalid OTP', async () => {
      renderPasswordResetFlow(client, '/reset-password?otp_id=test-otp-id');

      vi.spyOn(client, 'post').mockRejectedValue(
        new ApiError(400, {
          code: 'AUTH_OTP_INVALID',
          message: 'Invalid OTP code',
        }),
      );

      // Enter 6 digits
      const digits = screen.getAllByRole('textbox');
      await user.type(digits[0], '1');
      await user.type(digits[1], '2');
      await user.type(digits[2], '3');
      await user.type(digits[3], '4');
      await user.type(digits[4], '5');
      await user.type(digits[5], '6');

      await user.click(screen.getByRole('button', { name: 'Verify Code' }));
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText(/Wrong code/i)).toBeInTheDocument();
      });
    });
  });
});
