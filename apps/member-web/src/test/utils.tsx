import {
  render,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { type ReactElement, type ReactNode } from 'react';
import { AuthProvider } from '../auth/AuthProvider.tsx';
import { apiClient } from '../api/client.ts';

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Initial route for MemoryRouter */
  initialRoute?: string;
  /** Whether to enable auto-session-restore (default: false for tests) */
  autoRestore?: boolean;
}

/**
 * Render a component wrapped with all necessary providers:
 * - AuthProvider (with session restore disabled)
 * - MemoryRouter (for routing context)
 *
 * This allows components using useAuth() and useLocation() to work.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult {
  const { initialRoute = '/', autoRestore = false, ...renderOptions } = options;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthProvider apiClient={apiClient} autoRestore={autoRestore}>
        <MemoryRouter initialEntries={[initialRoute]}>{children}</MemoryRouter>
      </AuthProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

/**
 * Render a route within auth/router context.
 * Useful for testing specific routes/pages with proper context.
 */
export function renderRoute(
  path: string,
  element: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult {
  return renderWithProviders(
    <Routes>
      <Route path={path} element={element} />
      <Route path="*" element={<div>Not found</div>} />
    </Routes>,
    options,
  );
}

/**
 * Creates a mock API client for testing.
 * Resets state between tests.
 */
export function createMockApiClient() {
  const mockClient = {
    ...apiClient,
    isAuthenticated: false,
    _accessToken: null as string | null,
    onSessionExpired: null as (() => void) | null,
    setTokens: vi.fn(),
    clearSession: vi.fn(),
    attemptSessionRestore: vi.fn().mockResolvedValue(false),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
    login: vi.fn(),
  };

  return mockClient;
}
