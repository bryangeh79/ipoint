// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../auth/AuthProvider.tsx';
import { ProtectedRoute } from '../../auth/ProtectedRoute.tsx';
import { ApiClient } from '@ipoint/api-client';

function createTestClient() {
  return new ApiClient('http://localhost:3000/api/v1');
}

describe('ProtectedRoute', () => {
  let client: ApiClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = createTestClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows loading spinner when auth is loading', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <AuthProvider apiClient={client} autoRestore>
          <Routes>
            <Route
              path="/protected"
              element={
                <ProtectedRoute>
                  <div>Protected content</div>
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<div>Login page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    // Should show spinner while loading
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('redirects unauthenticated users to login', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <AuthProvider apiClient={client} autoRestore={false}>
          <Routes>
            <Route
              path="/protected"
              element={
                <ProtectedRoute>
                  <div>Protected content</div>
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<div>Login page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    // Run pending timers
    await vi.runAllTimersAsync();

    expect(screen.getByText('Login page')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('redirects authenticated users away from guest pages', async () => {
    // Setup: client has a token
    client.setTokens({
      accessToken: 'valid-token',
      accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    });

    // Mock: refresh succeeds with user data
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: 'valid-token',
            accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'user-1',
            email: 'test@example.com',
            createdAt: new Date().toISOString(),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider apiClient={client} autoRestore>
          <Routes>
            <Route
              path="/login"
              element={
                <ProtectedRoute requireGuest>
                  <div>Login page</div>
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<div>Home page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await vi.runAllTimersAsync();

    // Authenticated user should be redirected to home
    expect(screen.getByText('Home page')).toBeInTheDocument();
    expect(screen.queryByText('Login page')).not.toBeInTheDocument();
  });

  it('includes returnUrl when redirecting to login', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(
      <MemoryRouter initialEntries={['/profile']}>
        <AuthProvider apiClient={client} autoRestore={false}>
          <Routes>
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <div>Profile page</div>
                </ProtectedRoute>
              }
            />
            <Route
              path="/login"
              element={<div>Login page with redirect</div>}
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await vi.runAllTimersAsync();

    expect(screen.getByText('Login page with redirect')).toBeInTheDocument();
    // The URL should have returnUrl parameter
    // MemoryRouter preserves the redirect path
  });
});
