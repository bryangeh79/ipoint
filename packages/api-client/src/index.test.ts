// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient, ApiError } from './index.js';

const BASE_URL = 'http://localhost:3000/api/v1';

function createClient(): ApiClient {
  return new ApiClient(BASE_URL);
}

function mockFetch(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
    }),
  );
}

function mockFetchError(error: Error) {
  return vi.spyOn(globalThis, 'fetch').mockRejectedValue(error);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ApiClient', () => {
  describe('token storage', () => {
    it('stores tokens in memory only', () => {
      const client = createClient();
      expect(client.isAuthenticated).toBe(false);

      client.setTokens({
        accessToken: 'test-token',
        accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      expect(client.isAuthenticated).toBe(true);
      // Ensure nothing in storage
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    });

    it('clears session and resets state', () => {
      const client = createClient();
      client.setTokens({
        accessToken: 'test-token',
        accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      });
      client.clearSession();
      expect(client.isAuthenticated).toBe(false);
    });
  });

  describe('GET requests', () => {
    it('sends GET with auth header', async () => {
      const client = createClient();
      client.setTokens({
        accessToken: 'my-token',
        accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      const mock = mockFetch(200, { items: [] });

      const response = await client.get('/items');

      expect(response.data).toEqual({ items: [] });

      const callUrl = mock.mock.calls[0]?.[0] as string;
      const callInit = mock.mock.calls[0]?.[1] as RequestInit;
      expect(callUrl).toBe(`${BASE_URL}/items`);
      expect(callInit.method).toBe('GET');
      expect((callInit.headers as Headers).get('authorization')).toBe(
        'Bearer my-token',
      );
    });

    it('sends GET without auth when skipAuth is true', async () => {
      const client = createClient();
      client.setTokens({
        accessToken: 'my-token',
        accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      const mock = mockFetch(200, { ok: true });

      await client.get('/public', { skipAuth: true });

      const callInit = mock.mock.calls[0]?.[1] as RequestInit;
      expect((callInit.headers as Headers).get('authorization')).toBeNull();
    });
  });

  describe('POST requests', () => {
    it('sends JSON body', async () => {
      const client = createClient();
      client.setTokens({
        accessToken: 't',
        accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      const mock = mockFetch(201, { id: 1 });
      const response = await client.post('/items', { name: 'test' });

      expect(response.data).toEqual({ id: 1 });

      const callInit = mock.mock.calls[0]?.[1] as RequestInit;
      expect(callInit.method).toBe('POST');
      expect((callInit.headers as Headers).get('content-type')).toBe(
        'application/json',
      );
      expect(callInit.body).toBe(JSON.stringify({ name: 'test' }));
    });

    it('sends FormData without JSON content-type header', async () => {
      const client = createClient();
      client.setTokens({
        accessToken: 't',
        accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      const fd = new FormData();
      fd.append('file', new Blob(['test']), 'test.txt');

      const mock = mockFetch(201, { url: 'test.txt' });
      await client.upload('/upload', fd);

      const callInit = mock.mock.calls[0]?.[1] as RequestInit;
      expect(callInit.method).toBe('POST');
      // When FormData is sent, fetch sets content-type automatically with boundary
      expect(callInit.body).toBe(fd);
    });
  });

  describe('401 handling with single-flight refresh', () => {
    it('refreshes token and retries the original request once on 401', async () => {
      const client = createClient();
      client.setTokens({
        accessToken: 'old-token',
        accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      let callCount = 0;
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(
          async (url: RequestInfo | URL, init?: RequestInit) => {
            const path = typeof url === 'string' ? url : url.toString();
            callCount++;

            // First call to /items -> 401
            if (path === `${BASE_URL}/items` && callCount === 1) {
              return new Response(JSON.stringify({ message: 'Unauthorized' }), {
                status: 401,
                headers: { 'content-type': 'application/json' },
              });
            }

            // Refresh endpoint
            if (path === `${BASE_URL}/auth/refresh`) {
              return new Response(
                JSON.stringify({
                  accessToken: 'new-token',
                  accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
                }),
                {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                },
              );
            }

            // Retried /items -> success
            if (path === `${BASE_URL}/items` && callCount === 3) {
              return new Response(JSON.stringify({ data: 'success' }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              });
            }

            return new Response('Not found', { status: 404 });
          },
        );

      const response = await client.get('/items');

      expect(response.data).toEqual({ data: 'success' });
      expect(client.isAuthenticated).toBe(true);
      // 3 calls: 1) /items (401)  2) /auth/refresh  3) /items (retry)
      expect(callCount).toBe(3);
    });

    it('single-flight: concurrent 401s share one refresh', async () => {
      const client = createClient();
      client.setTokens({
        accessToken: 'old-token',
        accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      let refreshCount = 0;

      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          const path = typeof url === 'string' ? url : url.toString();

          // All non-refresh requests return 401 initially
          if (path === `${BASE_URL}/auth/refresh`) {
            refreshCount++;
            return new Response(
              JSON.stringify({
                accessToken: `new-token-${refreshCount}`,
                accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
              }),
              {
                status: 200,
                headers: { 'content-type': 'application/json' },
              },
            );
          }

          // Simulate: first time they all get 401, retry gets 200
          const authHeader = (init?.headers as Headers)?.get('authorization');
          if (authHeader === 'Bearer new-token-1') {
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }

          return new Response(JSON.stringify({ message: 'Unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          });
        },
      );

      // Fire 3 concurrent requests
      const results = await Promise.all([
        client.get('/items/1'),
        client.get('/items/2'),
        client.get('/items/3'),
      ]);

      expect(results).toHaveLength(3);
      // Only 1 refresh should have happened
      expect(refreshCount).toBe(1);
    });

    it('refresh failure clears session and throws', async () => {
      const client = createClient();
      client.setTokens({
        accessToken: 'old-token',
        accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      const onExpired = vi.fn();
      client.onSessionExpired = onExpired;

      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (url: RequestInfo | URL) => {
          const path = typeof url === 'string' ? url : url.toString();

          if (path === `${BASE_URL}/auth/refresh`) {
            return new Response(
              JSON.stringify({ message: 'Invalid refresh' }),
              {
                status: 401,
                headers: { 'content-type': 'application/json' },
              },
            );
          }

          return new Response(JSON.stringify({ message: 'Unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          });
        },
      );

      await expect(client.get('/items')).rejects.toThrow(ApiError);
      expect(client.isAuthenticated).toBe(false);
      expect(onExpired).toHaveBeenCalled();
    });

    it('does not attempt refresh on 401 with skipAuth', async () => {
      const client = createClient();
      client.setTokens({
        accessToken: 't',
        accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      );

      await expect(client.get('/public', { skipAuth: true })).rejects.toThrow(
        ApiError,
      );
    });
  });

  describe('network errors and timeout', () => {
    it('throws ApiError with NETWORK_OFFLINE on network failure', async () => {
      const client = createClient();
      client.setTokens({
        accessToken: 't',
        accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      mockFetchError(new TypeError('Failed to fetch'));

      const error = await client.get('/items').catch((e) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(0);
      expect(error.body.code).toBe('NETWORK_OFFLINE');
    });

    it('throws ApiError with REQUEST_TIMEOUT when timeoutMs is exceeded', async () => {
      const client = createClient();
      client.setTokens({
        accessToken: 't',
        accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      // Mock fetch to listen to the abort signal and reject when aborted
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (signal) {
              if (signal.aborted) {
                reject(
                  new DOMException('The operation was aborted', 'AbortError'),
                );
                return;
              }
              signal.addEventListener('abort', () => {
                reject(
                  new DOMException('The operation was aborted', 'AbortError'),
                );
              });
            }
            // Never resolve otherwise
          }),
      );

      // The timeout should make the promise reject
      const promise = client.get('/items', { timeoutMs: 100 });
      vi.advanceTimersByTime(150);

      const error = await promise.catch((e) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.body.code).toBe('REQUEST_TIMEOUT');
    });
  });

  describe('request options', () => {
    it('passes marketId header', async () => {
      const client = createClient();
      client.setTokens({
        accessToken: 't',
        accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      const mock = mockFetch(200, {});
      await client.get('/items', { marketId: 'my-market' });

      const callInit = mock.mock.calls[0]?.[1] as RequestInit;
      expect((callInit.headers as Headers).get('x-market-id')).toBe(
        'my-market',
      );
    });

    it('passes idempotencyKey header', async () => {
      const client = createClient();
      client.setTokens({
        accessToken: 't',
        accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      const mock = mockFetch(200, {});
      await client.post('/items', {}, { idempotencyKey: 'key-123' });

      const callInit = mock.mock.calls[0]?.[1] as RequestInit;
      expect((callInit.headers as Headers).get('idempotency-key')).toBe(
        'key-123',
      );
    });
  });

  describe('attemptSessionRestore', () => {
    it('attempts refresh and restores session on success', async () => {
      const client = createClient();

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            accessToken: 'restored-token',
            accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

      const result = await client.attemptSessionRestore();
      expect(result).toBe(true);
      expect(client.isAuthenticated).toBe(true);
    });

    it('fails gracefully when no refresh cookie exists', async () => {
      const client = createClient();

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const result = await client.attemptSessionRestore();
      expect(result).toBe(false);
      expect(client.isAuthenticated).toBe(false);
    });
  });

  describe('ApiError', () => {
    it('constructs with status and body', () => {
      const error = new ApiError(400, {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
      });
      expect(error.status).toBe(400);
      expect(error.body.code).toBe('VALIDATION_ERROR');
      expect(error.message).toBe('Invalid input');
      expect(error.isNetworkError).toBe(false);
      expect(error.isUnauthenticated).toBe(false);
      expect(error.isMarketAccessError).toBe(false);
    });

    it('detects market access error', () => {
      const error = new ApiError(403, {
        code: 'MARKET_ACCESS_DENIED',
        message: 'Market access restricted',
      });
      expect(error.isMarketAccessError).toBe(true);
    });
  });

  describe('describeApiError', () => {
    it('handles unexpected errors', async () => {
      const { describeApiError } = await import('./index.js');
      const result = describeApiError('string error');
      expect(result.kind).toBe('error');
      expect(result.title).toBe('Unexpected error');
    });

    it('categorizes timeout errors', async () => {
      const { describeApiError } = await import('./index.js');
      const error = new ApiError(0, { code: 'REQUEST_TIMEOUT' });
      const result = describeApiError(error);
      expect(result.kind).toBe('offline');
    });
  });
});
