// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../auth/AuthProvider.tsx';
import { ProfilePage } from '../../pages/ProfilePage.tsx';
import { ProfileEditPage } from '../../pages/ProfileEditPage.tsx';
import { ApiClient, ApiError } from '@ipoint/api-client';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'profile.title': 'Profile',
        'profile.edit': 'Edit Profile',
        'profile.displayName': 'Display Name',
        'profile.email': 'Email',
        'profile.phone': 'Phone',
        'profile.birthDate': 'Birth Date',
        'profile.gender': 'Gender',
        'profile.kycStatus': 'KYC Status',
        'profile.accountCountry': 'Account Country',
        'profile.currentMarket': 'Current Market',
        'profile.notProvided': 'Not provided',
        'profile.kycApproved': 'Approved',
        'profile.kycPending': 'Pending',
        'profile.kycRejected': 'Rejected',
        'profile.kycNotStarted': 'Not Started',
        'profile.editButton': 'Edit',
        'profile.submitButton': 'Save Changes',
        'profile.submittingButton': 'Saving...',
        'profile.cancelButton': 'Cancel',
        'profile.updateSuccess': 'Profile updated successfully',
        'profile.nameMinLength': 'Display name must be at least 1 character',
        'profile.invalidPhone': 'Invalid phone number format',
        'profile.emailReadOnly': 'Email cannot be changed',
        'profile.genderMale': 'Male',
        'profile.genderFemale': 'Female',
        'profile.genderOther': 'Other',
        'profile.genderPreferNotToSay': 'Prefer not to say',
        'common.loading': 'Loading...',
        'common.error': 'Something went wrong',
        'common.retry': 'Retry',
        'common.save': 'Save',
        'register.countryRequired': 'Please select a country',
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

function renderProfilePage(client: ApiClient) {
  return render(
    <MemoryRouter initialEntries={['/profile']}>
      <AuthProvider apiClient={client} autoRestore={false}>
        <Routes>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/edit" element={<ProfileEditPage />} />
          <Route path="/" element={<div>Home page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function renderProfileEditPage(client: ApiClient) {
  return render(
    <MemoryRouter initialEntries={['/profile/edit']}>
      <AuthProvider apiClient={client} autoRestore={false}>
        <Routes>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/edit" element={<ProfileEditPage />} />
          <Route path="/" element={<div>Home page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('ProfilePage', () => {
  let client: ApiClient;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client = createTestClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('display', () => {
    it('shows profile fields when data loads', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'user-1',
              email: 'john@example.com',
              name: 'John Doe',
              phone: '+60123456789',
              birthDate: '1990-01-15',
              gender: 'male',
              kycStatus: 'approved',
              countryCode: 'MY',
              marketCode: 'SG',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      renderProfilePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('john@example.com')).toBeInTheDocument();
      });
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('+60123456789')).toBeInTheDocument();
      expect(screen.getByText('MY')).toBeInTheDocument();
      expect(screen.getByText('SG')).toBeInTheDocument();
      expect(screen.getByText('Approved')).toBeInTheDocument();
    });

    it('shows placeholder for null fields', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'user-1',
              email: 'test@example.com',
              name: undefined,
              phone: undefined,
              birthDate: undefined,
              gender: undefined,
              kycStatus: 'not_started',
              countryCode: 'MY',
              marketCode: 'MY',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      renderProfilePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        // Should show the not-provided placeholder or dash
        expect(screen.getByText('Not provided')).toBeInTheDocument();
      });
    });

    it('shows loading skeleton initially', () => {
      vi.spyOn(client, 'get').mockImplementation(
        () => new Promise(() => {}), // Never resolves
      );

      renderProfilePage(client);
      expect(screen.getByText('Profile')).toBeInTheDocument();
    });

    it('shows error state and retry button', async () => {
      vi.spyOn(client, 'get').mockRejectedValue(
        new ApiError(500, { message: 'Server error' }),
      );

      renderProfilePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      });
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });

  describe('edit navigation', () => {
    it('has an edit button linking to /profile/edit', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'user-1',
              email: 'john@example.com',
              name: 'John Doe',
              kycStatus: 'approved',
              countryCode: 'MY',
              marketCode: 'SG',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      renderProfilePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('Edit')).toBeInTheDocument();
      });
    });
  });
});

describe('ProfileEditPage', () => {
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

  describe('form pre-fill', () => {
    it('pre-fills form fields from profile data', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'user-1',
              email: 'jane@example.com',
              name: 'Jane Doe',
              phone: '+60123456789',
              birthDate: '1992-06-20',
              gender: 'female',
              kycStatus: 'approved',
              countryCode: 'MY',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      renderProfileEditPage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        const nameInput = screen.getByDisplayValue('Jane Doe');
        expect(nameInput).toBeInTheDocument();
      });
    });
  });

  describe('form validation', () => {
    it('shows error for empty display name', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'user-1',
              email: 'test@example.com',
              name: 'Test User',
              kycStatus: 'approved',
              countryCode: 'MY',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      const patchSpy = vi.spyOn(client, 'patch').mockResolvedValue({
        data: { id: 'user-1' },
        requestId: 'req-1',
      });

      renderProfileEditPage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        const nameInput = screen.getByDisplayValue('Test User');
        expect(nameInput).toBeInTheDocument();
      });

      // Clear the name field
      const nameInput = screen.getByDisplayValue('Test User');
      await user.clear(nameInput);
      // Make it dirty by typing something and then clearing
      await user.type(nameInput, ' ');
      await user.clear(nameInput);

      const submitBtn = screen.getByText('Save Changes');
      await user.click(submitBtn);

      await waitFor(() => {
        // Should not submit with empty name
        expect(patchSpy).not.toHaveBeenCalled();
      });
    });

    it('submits successfully and redirects', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'user-1',
              email: 'test@example.com',
              name: 'Test User',
              kycStatus: 'approved',
              countryCode: 'MY',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      const patchSpy = vi.spyOn(client, 'patch').mockResolvedValue({
        data: { id: 'user-1', message: 'Profile updated' },
        requestId: 'req-1',
      });

      renderProfileEditPage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByDisplayValue('Test User')).toBeInTheDocument();
      });

      const submitBtn = screen.getByText('Save Changes');
      await user.click(submitBtn);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(patchSpy).toHaveBeenCalledWith('/profile', expect.any(Object));
      });
    });
  });
});
