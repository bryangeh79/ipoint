// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../auth/AuthProvider.tsx';
import { LoginPage } from '../../pages/LoginPage.tsx';
import { ApiClient, ApiError } from '@ipoint/api-client';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'auth.login': 'Log In',
        'auth.email': 'Email',
        'auth.password': 'Password',
        'auth.forgotPassword': 'Forgot Password?',
        'auth.register': 'Create Account',
        'auth.emailPlaceholder': 'you@example.com',
        'auth.loginButton': 'Log In',
        'auth.loginSubmitting': 'Logging in...',
        'auth.invalidCredentials': 'Invalid email or password',
        'auth.accountSuspended': 'Account suspended. Please contact support.',
        'auth.accountClosed': 'Account closed.',
        'auth.somethingWentWrong': 'Something went wrong. Please try again.',
        'auth.networkError': 'Network error. Please check your connection.',
        'auth.retry': 'Retry',
        'register.fieldRequired': 'This field is required',
        'register.invalidEmail': 'Please enter a valid email address',
        'common.retry': 'Retry',
        'common.error': 'Something went wrong',
        'errors.offline': 'You are offline',
      };
      return translations[key] ?? key;
    },
    i18n: {
      language: 'en',
    },
  }),
}));

function createTestClient() {
  const client = new ApiClient('http://localhost:3000/api/v1');

  // Suppress the actual HTTP calls since we are mocking login specifically
  vi.spyOn(client, 'attemptSessionRestore').mockResolvedValue(false);
  vi.spyOn(client, 'get').mockRejectedValue(
    new ApiError(401, { code: 'AUTH_SESSION_INVALID' }),
  );

  return client;
}

function renderLoginPage(client: ApiClient, initialRoute = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <AuthProvider apiClient={client} autoRestore={false}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Home page</div>} />
          <Route
            path="/forgot-password"
            element={<div>Forgot password page</div>}
          />
          <Route path="/register" element={<div>Register page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  let client: ApiClient;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client = createTestClient();
    user = userEvent.setup({ advanceTimers: () => vi.advanceTimersByTime(1) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('form validation', () => {
    it('does not submit empty form', async () => {
      const loginSpy = vi.spyOn(client, 'login').mockResolvedValue({
        accessToken: 'token',
        accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      renderLoginPage(client);
      const submit = screen.getByRole('button', { name: 'Log In' });
      await user.click(submit);

      // Should show validation errors, not call login
      expect(loginSpy).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.getByText('This field is required')).toBeInTheDocument();
      });
    });

    it('validates email format', async () => {
      renderLoginPage(client);
      const emailInput = screen.getByLabelText('Email');
      await user.type(emailInput, 'not-an-email');

      const submit = screen.getByRole('button', { name: 'Log In' });
      await user.click(submit);

      await waitFor(() => {
        expect(
          screen.getByText('Please enter a valid email address'),
        ).toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows unified invalid credentials error on 401 AUTH_INVALID_CREDENTIALS', async () => {
      renderLoginPage(client);
      vi.spyOn(client, 'login').mockRejectedValue(
        new ApiError(401, {
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Invalid credentials',
        }),
      );

      const emailInput = screen.getByLabelText('Email');
      await user.type(emailInput, 'test@example.com');
      const passwordInput = screen.getByLabelText('Password');
      await user.type(passwordInput, 'validPassword123');

      await user.click(screen.getByRole('button', { name: 'Log In' }));
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(
          screen.getByText('Invalid email or password'),
        ).toBeInTheDocument();
      });

      // Should have a retry button
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    it('shows account suspended message for AUTH_ACCOUNT_INACTIVE with suspend', async () => {
      renderLoginPage(client);
      vi.spyOn(client, 'login').mockRejectedValue(
        new ApiError(401, {
          code: 'AUTH_ACCOUNT_INACTIVE',
          message: 'Account is suspended',
        }),
      );

      await user.type(screen.getByLabelText('Email'), 'test@example.com');
      await user.type(screen.getByLabelText('Password'), 'validPassword123');
      await user.click(screen.getByRole('button', { name: 'Log In' }));
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(
          screen.getByText('Account suspended. Please contact support.'),
        ).toBeInTheDocument();
      });
    });

    it('shows account closed message for AUTH_ACCOUNT_INACTIVE with close', async () => {
      renderLoginPage(client);
      vi.spyOn(client, 'login').mockRejectedValue(
        new ApiError(401, {
          code: 'AUTH_ACCOUNT_INACTIVE',
          message: 'Account is closed',
        }),
      );

      await user.type(screen.getByLabelText('Email'), 'test@example.com');
      await user.type(screen.getByLabelText('Password'), 'validPassword123');
      await user.click(screen.getByRole('button', { name: 'Log In' }));
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('Account closed.')).toBeInTheDocument();
      });
    });

    it('shows network error on status 0', async () => {
      renderLoginPage(client);
      vi.spyOn(client, 'login').mockRejectedValue(
        new ApiError(0, {
          code: 'NETWORK_OFFLINE',
          message: 'Network request failed.',
        }),
      );

      await user.type(screen.getByLabelText('Email'), 'test@example.com');
      await user.type(screen.getByLabelText('Password'), 'validPassword123');
      await user.click(screen.getByRole('button', { name: 'Log In' }));
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(
          screen.getByText('Network error. Please check your connection.'),
        ).toBeInTheDocument();
      });
    });
  });

  describe('successful login', () => {
    it('redirects to home on successful login', async () => {
      renderLoginPage(client);
      vi.spyOn(client, 'login').mockResolvedValue({
        accessToken: 'new-token',
        accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      // Mock members/me call that AuthProvider makes after login
      vi.spyOn(client, 'get').mockResolvedValue({
        data: {
          id: 'user-1',
          email: 'test@example.com',
          createdAt: new Date().toISOString(),
        },
        requestId: 'req-1',
      });

      await user.type(screen.getByLabelText('Email'), 'test@example.com');
      await user.type(screen.getByLabelText('Password'), 'validPassword123');
      await user.click(screen.getByRole('button', { name: 'Log In' }));
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('Home page')).toBeInTheDocument();
      });
    });
  });

  describe('navigation links', () => {
    it('has a link to forgot-password', () => {
      renderLoginPage(client);
      const forgotLink = screen.getByText('Forgot Password?');
      expect(forgotLink).toBeInTheDocument();
      expect(forgotLink.closest('a')).toHaveAttribute(
        'href',
        '/forgot-password',
      );
    });

    it('has a link to register', () => {
      renderLoginPage(client);
      const registerLink = screen.getByText('Create Account');
      expect(registerLink).toBeInTheDocument();
      expect(registerLink.closest('a')).toHaveAttribute('href', '/register');
    });
  });
});
