// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../auth/AuthProvider.tsx';
import { CountryChangePage } from '../../pages/CountryChangePage.tsx';
import { ApiClient, ApiError } from '@ipoint/api-client';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'country.title': 'Change Account Country',
        'country.currentCountry': 'Current Account Country',
        'country.targetCountry': 'Target Country',
        'country.selectCountry': 'Select a country',
        'country.reason': 'Reason for change',
        'country.reasonPlaceholder':
          'Please explain why you need to change your account country',
        'country.reasonMinLength': 'Reason must be at least 10 characters',
        'country.submit': 'Submit Request',
        'country.submitting': 'Submitting...',
        'country.pendingTitle': 'Change Request Submitted',
        'country.pendingStatus': 'Under Review',
        'country.pendingDate': 'Submitted on {date}',
        'country.approvedTitle': 'Change Approved',
        'country.approvedDate': 'Approved on {date}',
        'country.rejectedTitle': 'Change Rejected',
        'country.rejectedReason': 'Reason: {reason}',
        'country.resubmit': 'Submit a new request',
        'country.submitSuccess':
          'Account country change request submitted successfully.',
        'country.submitFailed': 'Failed to submit request. Please try again.',
        'country.duplicatePending':
          'You already have a pending request. Please wait for it to be reviewed.',
        'country.countryMY': 'Malaysia',
        'country.countrySG': 'Singapore',
        'country.countryVN': 'Vietnam',
        'country.countryTH': 'Thailand',
        'country.countryID': 'Indonesia',
        'country.countryPH': 'Philippines',
        'profile.kycApproved': 'Approved',
        'profile.kycPending': 'Pending',
        'profile.kycRejected': 'Rejected',
        'register.countryRequired': 'Please select a country',
        'common.loading': 'Loading...',
        'common.error': 'Something went wrong',
        'common.retry': 'Retry',
      };
      if (options) {
        return (
          translations[key]?.replace(/\{(\w+)\}/g, (_, k) =>
            String(options[k] ?? ''),
          ) ?? key
        );
      }
      return translations[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

function createTestClient() {
  const client = new ApiClient('http://localhost:3000/api/v1');
  vi.spyOn(client, 'attemptSessionRestore').mockResolvedValue(false);
  return client;
}

function renderCountryChangePage(client: ApiClient) {
  return render(
    <MemoryRouter initialEntries={['/country-change']}>
      <AuthProvider apiClient={client} autoRestore={false}>
        <Routes>
          <Route path="/country-change" element={<CountryChangePage />} />
          <Route path="/" element={<div>Home page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('CountryChangePage', () => {
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

  describe('country list', () => {
    it('shows current country and target country dropdown', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'u1',
              email: 'test@example.com',
              countryCode: 'MY',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        if (path === '/country-change/status') {
          return {
            data: { status: 'none' },
            requestId: 'req-2',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      renderCountryChangePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('MY')).toBeInTheDocument();
      });

      // Should show the country select
      expect(screen.getByText('Select a country')).toBeInTheDocument();
      // Should show the reason textarea placeholder
      expect(
        screen.getByPlaceholderText(
          'Please explain why you need to change your account country',
        ),
      ).toBeInTheDocument();
    });
  });

  describe('submit', () => {
    it('submits a country change request', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'u1',
              email: 'test@example.com',
              countryCode: 'MY',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        if (path === '/country-change/status') {
          return {
            data: { status: 'none' },
            requestId: 'req-2',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      const postSpy = vi.spyOn(client, 'post').mockResolvedValue({
        data: {
          status: 'pending',
          targetCountry: 'SG',
          submittedAt: '2025-06-01T00:00:00Z',
        },
        requestId: 'req-3',
      });

      renderCountryChangePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('MY')).toBeInTheDocument();
      });

      // Select target country
      const select = screen.getByRole('combobox');
      await user.selectOptions(select, 'SG');
      await vi.runAllTimersAsync();

      // Type reason
      const textarea = screen.getByPlaceholderText(
        'Please explain why you need to change your account country',
      );
      await user.type(textarea, 'Moving to Singapore for work');

      // Submit
      await user.click(screen.getByText('Submit Request'));
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(postSpy).toHaveBeenCalledWith('/country-change/request', {
          targetCountry: 'SG',
          reason: 'Moving to Singapore for work',
        });
      });
    });

    it('prevents duplicate submit', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'u1',
              email: 'test@example.com',
              countryCode: 'MY',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        if (path === '/country-change/status') {
          return {
            data: { status: 'none' },
            requestId: 'req-2',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      const postSpy = vi.spyOn(client, 'post').mockResolvedValue({
        data: {
          status: 'pending',
          targetCountry: 'SG',
          submittedAt: '2025-06-01T00:00:00Z',
        },
        requestId: 'req-3',
      });

      renderCountryChangePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('MY')).toBeInTheDocument();
      });

      const select = screen.getByRole('combobox');
      await user.selectOptions(select, 'SG');
      const textarea = screen.getByPlaceholderText(
        'Please explain why you need to change your account country',
      );
      await user.type(textarea, 'Moving to Singapore for work');
      await user.click(screen.getByText('Submit Request'));
      await vi.runAllTimersAsync();

      // postSpy should have been called exactly once even if we try to submit again
      await user.click(screen.getByText('Submit Request'));
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(postSpy).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('status display', () => {
    it('shows pending status', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'u1',
              email: 'test@example.com',
              countryCode: 'MY',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        if (path === '/country-change/status') {
          return {
            data: {
              status: 'pending',
              targetCountry: 'SG',
              submittedAt: '2025-06-01T00:00:00Z',
            },
            requestId: 'req-2',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      renderCountryChangePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(
          screen.getByText('Change Request Submitted'),
        ).toBeInTheDocument();
      });
      expect(screen.getByText('Under Review')).toBeInTheDocument();
    });

    it('shows approved status', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'u1',
              email: 'test@example.com',
              countryCode: 'SG',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        if (path === '/country-change/status') {
          return {
            data: {
              status: 'approved',
              targetCountry: 'SG',
              approvedAt: '2025-06-15T00:00:00Z',
            },
            requestId: 'req-2',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      renderCountryChangePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('Change Approved')).toBeInTheDocument();
      });
    });

    it('shows rejected status', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'u1',
              email: 'test@example.com',
              countryCode: 'MY',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        if (path === '/country-change/status') {
          return {
            data: {
              status: 'rejected',
              targetCountry: 'SG',
              rejectReason: 'Insufficient documentation provided.',
            },
            requestId: 'req-2',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      renderCountryChangePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('Change Rejected')).toBeInTheDocument();
      });
      expect(
        screen.getByText('Reason: Insufficient documentation provided.'),
      ).toBeInTheDocument();
      expect(screen.getByText('Submit a new request')).toBeInTheDocument();
    });
  });

  describe('error handling', () => {
    it('shows retry on network error', async () => {
      vi.spyOn(client, 'get').mockRejectedValue(
        new ApiError(0, { message: 'Network failure' }),
      );

      renderCountryChangePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      });
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    it('shows error when submit fails', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'u1',
              email: 'test@example.com',
              countryCode: 'MY',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        if (path === '/country-change/status') {
          return {
            data: { status: 'none' },
            requestId: 'req-2',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      vi.spyOn(client, 'post').mockRejectedValue(
        new ApiError(500, { message: 'Server error' }),
      );

      renderCountryChangePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('MY')).toBeInTheDocument();
      });

      const select = screen.getByRole('combobox');
      await user.selectOptions(select, 'SG');
      const textarea = screen.getByPlaceholderText(
        'Please explain why you need to change your account country',
      );
      await user.type(textarea, 'Moving to Singapore for work');

      await user.click(screen.getByText('Submit Request'));
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(
          screen.getByText('Failed to submit request. Please try again.'),
        ).toBeInTheDocument();
      });
    });
  });
});
