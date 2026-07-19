// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../auth/AuthProvider.tsx';
import { RegisterPage } from '../../pages/RegisterPage.tsx';
import { ApiClient } from '@ipoint/api-client';
import { apiClient } from '../../api/client.ts';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'auth.registerTitle': 'Create your iPoint account',
        'auth.email': 'Email',
        'auth.password': 'Password',
        'auth.confirmPassword': 'Confirm Password',
        'auth.passwordMinLength': 'Password must be at least 12 characters',
        'auth.passwordMismatch': 'Passwords do not match',
        'auth.referralCode': 'Referral Code (optional)',
        'auth.referralCodeHint':
          'Enter an 8+ character alphanumeric referral code',
        'auth.accountCountry': 'Account Country',
        'auth.selectCountry': 'Select your country',
        'auth.termsLabel': 'I accept the Terms and Conditions',
        'auth.disclaimerLabel': 'I acknowledge the Disclaimer',
        'auth.privacyLabel': 'I accept the Privacy Policy',
        'auth.submitRegister': 'Create Account',
        'auth.submittingRegister': 'Creating account...',
        'auth.emailAlreadyRegistered':
          'This email is already registered. Please log in.',
        'auth.emailAlreadyRegisteredLink': 'Log in here',
        'auth.haveAccount': 'Already have an account?',
        'auth.login': 'Log In',
        'auth.networkError': 'Network error. Please check your connection.',
        'auth.somethingWentWrong': 'Something went wrong. Please try again.',
        'auth.emailPlaceholder': 'you@example.com',
        'auth.retry': 'Retry',
        'common.error': 'Something went wrong',
        'errors.offline': 'You are offline',
        'register.fieldRequired': 'This field is required',
        'register.invalidEmail': 'Please enter a valid email address',
        'register.invalidReferralCode':
          'Referral code must be at least 8 alphanumeric characters',
        'register.termsRequired': 'You must accept the Terms and Conditions',
        'register.disclaimerRequired': 'You must acknowledge the Disclaimer',
        'register.privacyRequired': 'You must accept the Privacy Policy',
        'register.countryRequired': 'Please select a country',
      };
      if (options) {
        return key.replace('{attempts}', String(options.attempts));
      }
      return translations[key] ?? key;
    },
    i18n: {
      language: 'en',
    },
  }),
}));

// Mock the apiClient
vi.mock('../../api/client.ts', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    login: vi.fn(),
    setTokens: vi.fn(),
    clearSession: vi.fn(),
    attemptSessionRestore: vi.fn().mockResolvedValue(false),
    isAuthenticated: false,
    onSessionExpired: null,
  },
}));

function renderRegisterPage(
  client: ApiClient,
  { initialRoute = '/register' } = {},
) {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <AuthProvider apiClient={client} autoRestore={false}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<div>Login page</div>} />
          <Route path="/register/verify" element={<div>Verify OTP page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function createTestClient() {
  const client = new ApiClient('http://localhost:3000/api/v1');
  return client;
}

describe('RegisterPage', () => {
  let client: ApiClient;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client = createTestClient();
    user = userEvent.setup({ advanceTimers: () => vi.advanceTimersByTime(1) });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function fillEmail(email: string) {
    const input = screen.getByLabelText('Email');
    return user.type(input, email);
  }

  function fillPassword(password: string) {
    const input = screen.getByLabelText('Password');
    return user.type(input, password);
  }

  function fillConfirmPassword(password: string) {
    const input = screen.getAllByLabelText('Confirm Password')[0];
    return user.type(input, password);
  }

  async function selectCountry() {
    const select = screen.getByLabelText('Account Country');
    await user.selectOptions(select, 'MY');
  }

  async function agreeToTerms() {
    const terms = screen.getByLabelText('I accept the Terms and Conditions');
    await user.click(terms);
  }

  async function agreeToDisclaimer() {
    const disclaimer = screen.getByLabelText('I acknowledge the Disclaimer');
    await user.click(disclaimer);
  }

  async function agreeToPrivacy() {
    const privacy = screen.getByLabelText('I accept the Privacy Policy');
    await user.click(privacy);
  }

  async function submitForm(client: ApiClient) {
    const mockPost = client.post as ReturnType<typeof vi.fn>;
    if (mockPost.mockResolvedValue) {
      // mock already set
    }
    const submitButton = screen.getByRole('button', { name: 'Create Account' });
    await user.click(submitButton);
  }

  describe('form validation', () => {
    it('requires email', async () => {
      renderRegisterPage(client);
      const submit = screen.getByRole('button', { name: 'Create Account' });
      await user.click(submit);

      await waitFor(() => {
        expect(screen.getByText('This field is required')).toBeInTheDocument();
      });
    });

    it('requires valid email format', async () => {
      renderRegisterPage(client);
      await fillEmail('invalid');
      await user.click(screen.getByRole('button', { name: 'Create Account' }));

      await waitFor(() => {
        expect(
          screen.getByText('Please enter a valid email address'),
        ).toBeInTheDocument();
      });
    });

    it('requires password', async () => {
      renderRegisterPage(client);
      await fillEmail('test@example.com');
      await user.click(screen.getByRole('button', { name: 'Create Account' }));

      await waitFor(() => {
        expect(screen.getByText('This field is required')).toBeInTheDocument();
      });
    });

    it('requires password of at least 12 characters', async () => {
      renderRegisterPage(client);
      await fillEmail('test@example.com');
      await fillPassword('short');
      await user.click(screen.getByRole('button', { name: 'Create Account' }));

      await waitFor(() => {
        expect(
          screen.getByText('Password must be at least 12 characters'),
        ).toBeInTheDocument();
      });
    });

    it('requires confirm password', async () => {
      renderRegisterPage(client);
      await fillEmail('test@example.com');
      await fillPassword('password123456');
      await user.click(screen.getByRole('button', { name: 'Create Account' }));

      await waitFor(() => {
        expect(screen.getByText('This field is required')).toBeInTheDocument();
      });
    });

    it('requires passwords to match', async () => {
      renderRegisterPage(client);
      await fillEmail('test@example.com');
      await fillPassword('password123456');
      await fillConfirmPassword('different');
      await user.click(screen.getByRole('button', { name: 'Create Account' }));

      await waitFor(() => {
        expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
      });
    });

    it('requires country selection', async () => {
      renderRegisterPage(client);
      await fillEmail('test@example.com');
      await fillPassword('password123456');
      await fillConfirmPassword('password123456');
      await agreeToTerms();
      await agreeToDisclaimer();
      await agreeToPrivacy();
      await user.click(screen.getByRole('button', { name: 'Create Account' }));

      await waitFor(() => {
        expect(screen.getByText('Please select a country')).toBeInTheDocument();
      });
    });

    it('requires terms checkbox', async () => {
      renderRegisterPage(client);
      await fillEmail('test@example.com');
      await fillPassword('password123456');
      await fillConfirmPassword('password123456');
      await selectCountry();
      await agreeToDisclaimer();
      await agreeToPrivacy();
      await user.click(screen.getByRole('button', { name: 'Create Account' }));

      await waitFor(() => {
        expect(
          screen.getByText('You must accept the Terms and Conditions'),
        ).toBeInTheDocument();
      });
    });
  });

  describe('API calls', () => {
    it('calls registration initiate API on valid form submit', async () => {
      renderRegisterPage(client);
      const mockPost = vi.spyOn(client, 'post').mockResolvedValue({
        data: { otp_id: 'test-otp-id', expires_at: new Date().toISOString() },
        requestId: 'req-1',
      });

      await fillEmail('test@example.com');
      await fillPassword('validPassword123');
      await fillConfirmPassword('validPassword123');
      await selectCountry();
      await agreeToTerms();
      await agreeToDisclaimer();
      await agreeToPrivacy();

      const submit = screen.getByRole('button', { name: 'Create Account' });
      await user.click(submit);

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith(
          '/auth/registration/initiate',
          expect.objectContaining({
            email: 'test@example.com',
            account_country: 'MY',
            terms_version: expect.any(String),
            disclaimer_version: expect.any(String),
            privacy_version: expect.any(String),
          }),
          { skipAuth: true },
        );
      });
    });

    it('submits with optional referral code', async () => {
      renderRegisterPage(client);
      const mockPost = vi.spyOn(client, 'post').mockResolvedValue({
        data: { otp_id: 'test-otp-id', expires_at: new Date().toISOString() },
        requestId: 'req-1',
      });

      await fillEmail('test@example.com');
      await fillPassword('validPassword123');
      await fillConfirmPassword('validPassword123');
      await selectCountry();
      await agreeToTerms();
      await agreeToDisclaimer();
      await agreeToPrivacy();

      // Enter referral code
      const referralInput = screen.getByLabelText('Referral Code (optional)');
      await user.type(referralInput, 'REFERRAL123');

      const submit = screen.getByRole('button', { name: 'Create Account' });
      await user.click(submit);

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith(
          '/auth/registration/initiate',
          expect.objectContaining({
            email: 'test@example.com',
            referral_code: 'REFERRAL123',
          }),
          { skipAuth: true },
        );
      });
    });

    it('navigates to verify page on successful initiate', async () => {
      renderRegisterPage(client);
      vi.spyOn(client, 'post').mockResolvedValue({
        data: { otp_id: 'otp-abc-123', expires_at: new Date().toISOString() },
        requestId: 'req-1',
      });

      await fillEmail('test@example.com');
      await fillPassword('validPassword123');
      await fillConfirmPassword('validPassword123');
      await selectCountry();
      await agreeToTerms();
      await agreeToDisclaimer();
      await agreeToPrivacy();

      await user.click(screen.getByRole('button', { name: 'Create Account' }));
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('Verify OTP page')).toBeInTheDocument();
      });
    });

    it('shows error on duplicate email (409)', async () => {
      renderRegisterPage(client);
      vi.spyOn(client, 'post').mockRejectedValue(
        new (await import('@ipoint/api-client')).ApiError(409, {
          code: 'AUTH_MEMBER_ALREADY_EXISTS',
          message: 'Member already exists',
        }),
      );

      await fillEmail('existing@example.com');
      await fillPassword('validPassword123');
      await fillConfirmPassword('validPassword123');
      await selectCountry();
      await agreeToTerms();
      await agreeToDisclaimer();
      await agreeToPrivacy();

      await user.click(screen.getByRole('button', { name: 'Create Account' }));
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(
          screen.getByText(/This email is already registered/i),
        ).toBeInTheDocument();
      });

      // Should have a login link
      expect(screen.getByText('Log in here')).toBeInTheDocument();
    });

    it('shows network error on status 0', async () => {
      renderRegisterPage(client);
      vi.spyOn(client, 'post').mockRejectedValue(
        new (await import('@ipoint/api-client')).ApiError(0, {
          code: 'NETWORK_OFFLINE',
          message: 'Network request failed.',
        }),
      );

      await fillEmail('test@example.com');
      await fillPassword('validPassword123');
      await fillConfirmPassword('validPassword123');
      await selectCountry();
      await agreeToTerms();
      await agreeToDisclaimer();
      await agreeToPrivacy();

      await user.click(screen.getByRole('button', { name: 'Create Account' }));
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText(/Network error/i)).toBeInTheDocument();
      });

      // Should have a retry button
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    it('prevents double submit while request is in flight', async () => {
      renderRegisterPage(client);
      const mockPost = vi.spyOn(client, 'post').mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  data: {
                    otp_id: 'otp-id',
                    expires_at: new Date().toISOString(),
                  },
                  requestId: 'req-1',
                }),
              100000, // Long delay
            );
          }),
      );

      await fillEmail('test@example.com');
      await fillPassword('validPassword123');
      await fillConfirmPassword('validPassword123');
      await selectCountry();
      await agreeToTerms();
      await agreeToDisclaimer();
      await agreeToPrivacy();

      // Click submit twice quickly
      const submit = screen.getByRole('button', { name: 'Create Account' });
      await user.click(submit);
      await user.click(submit);

      // Should only have been called once
      expect(mockPost).toHaveBeenCalledTimes(1);
    });
  });
});
