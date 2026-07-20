// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../auth/AuthProvider';
import { useAuth } from '../../auth/useAuth';
import { ApiClient } from '@ipoint/api-client';

// Create a test client that doesn't actually make network requests
function createTestClient() {
  const client = new ApiClient('http://localhost:3000/api/v1');
  return client;
}

function TestConsumer() {
  const { isAuthenticated, isLoading, user, error } = useAuth();
  return (
    <div>
      <span data-testid="loading">{isLoading.toString()}</span>
      <span data-testid="authenticated">{isAuthenticated.toString()}</span>
      <span data-testid="user">{user ? user.email : 'null'}</span>
      <span data-testid="error">{error ?? 'null'}</span>
    </div>
  );
}

function renderWithAuth(client: ApiClient, autoRestore = false) {
  return render(
    <MemoryRouter>
      <AuthProvider apiClient={client} autoRestore={autoRestore}>
        <TestConsumer />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AuthProvider', () => {
  let client: ApiClient;

  beforeEach(() => {
    // Prevent live fetch calls by default
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    client = createTestClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts in loading state when autoRestore is true', () => {
    renderWithAuth(client, true);
    expect(screen.getByTestId('loading').textContent).toBe('true');
  });

  it('is not loading when autoRestore is false', () => {
    renderWithAuth(client, false);
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('authenticated').textContent).toBe('false');
  });

  it('attempts session restore on mount with autoRestore', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: 'fresh-token',
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
            name: 'Test User',
            createdAt: new Date().toISOString(),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    renderWithAuth(client, true);

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
  });
});
