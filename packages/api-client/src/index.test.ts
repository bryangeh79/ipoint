// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-base-to-string */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AdminApiClient,
  AdminDashboardCatalogDto,
  AdminDashboardMetricDetailDto,
  AdminMerchantApiClient,
  ApiClient,
  ApiError,
} from './index.js';

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
      // Ensure nothing in storage (environment-agnostic check)
      if (typeof localStorage !== 'undefined') {
        expect(localStorage.length).toBe(0);
      }
      if (typeof sessionStorage !== 'undefined') {
        expect(sessionStorage.length).toBe(0);
      }
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

describe('AdminApiClient', () => {
  it('uses the exact P7-S2 login and MFA DTO contracts', async () => {
    const core = createClient();
    const client = new AdminApiClient(core);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'MFA_REQUIRED',
            mfa_challenge_id: 'challenge'.repeat(4),
            expires_at: '2026-08-01T12:00:00.000Z',
          }),
          { status: 202, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            accessExpiresAt: '2026-08-01T12:15:00.000Z',
            refreshExpiresAt: '2026-08-08T12:00:00.000Z',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const challenge = await client.beginLogin({
      email: 'admin@example.com',
      password: 'Admin-Password-123!',
    });
    await client.completeMfaChallenge({
      challenge_id: challenge.mfa_challenge_id,
      code: '123456',
    });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(`${BASE_URL}/auth/admin/login`);
    expect(JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body))).toEqual({
      challenge_id: 'challenge'.repeat(4),
      code: '123456',
    });
    expect(core.isAuthenticated).toBe(true);
  });

  it('uses exact bootstrap, markets, selection and sessions paths', async () => {
    const core = createClient();
    core.setTokens({
      accessToken: 'access-token',
      accessExpiresAt: '2026-08-01T12:15:00.000Z',
    });
    const client = new AdminApiClient(core);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    await client.bootstrap();
    await client.markets();
    await client.selectCurrentMarket({
      market_id: 'market-1',
      expected_context_version: 4,
    });
    await client.sessions();
    await client.currentSession();
    await client.revokeSession('session/unsafe');
    await client.revokeAllSessions();

    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual([
      `${BASE_URL}/admin/bootstrap`,
      `${BASE_URL}/admin/me/markets`,
      `${BASE_URL}/admin/me/current-market`,
      `${BASE_URL}/admin/sessions`,
      `${BASE_URL}/admin/sessions/current`,
      `${BASE_URL}/admin/sessions/session%2Funsafe`,
      `${BASE_URL}/admin/sessions`,
    ]);
    expect(JSON.parse(String(fetchSpy.mock.calls[2]?.[1]?.body))).toEqual({
      market_id: 'market-1',
      expected_context_version: 4,
    });
  });

  it('uses the exact P7-S4A dashboard metrics paths', async () => {
    const core = createClient();
    core.setTokens({
      accessToken: 'access-token',
      accessExpiresAt: '2026-08-01T12:15:00.000Z',
    });
    const client = new AdminApiClient(core);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    await client.dashboardMetrics();
    await client.dashboardMetricDetail('M14');
    await client.dashboardMetricDetail('M99');

    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual([
      `${BASE_URL}/admin/dashboard/metrics`,
      `${BASE_URL}/admin/dashboard/metrics/M14`,
      `${BASE_URL}/admin/dashboard/metrics/M99`,
    ]);
  });

  it('shapes the P7-S4A dashboard catalog and detail DTOs', async () => {
    const core = createClient();
    core.setTokens({
      accessToken: 'access-token',
      accessExpiresAt: '2026-08-01T12:15:00.000Z',
    });
    const client = new AdminApiClient(core);
    const catalogBody: AdminDashboardCatalogDto = {
      asOf: '2026-08-03T00:00:00.000Z',
      marketId: 'market-1',
      items: [
        {
          id: 'M01',
          name: 'Members',
          definition: 'Member count.',
          definitionVersion: 1,
          freshnessClass: 'KPI',
          currencyDimension: false,
          permission: 'dashboard.view',
          source: 'member_market_preferences',
          state: 'FRESH',
          asOf: '2026-08-03T00:00:00.000Z',
          value: { kind: 'COUNT', count: 3 },
        },
        {
          id: 'M10',
          name: 'Unavailable',
          definition: 'No durable source.',
          definitionVersion: 1,
          freshnessClass: 'KPI',
          currencyDimension: false,
          permission: 'dashboard.view',
          source: 'none',
          state: 'UNAVAILABLE',
          unavailableReason: 'NO_DURABLE_SOURCE',
          asOf: '2026-08-03T00:00:00.000Z',
        },
      ],
    };
    const detailBody: AdminDashboardMetricDetailDto = {
      id: 'M14',
      name: 'MCP Available Balance',
      definition: 'Available balance.',
      definitionVersion: 1,
      freshnessClass: 'KPI',
      currencyDimension: true,
      permission: 'dashboard.view',
      source: 'mcp_accounts',
      state: 'FRESH',
      asOf: '2026-08-03T00:00:00.000Z',
      marketId: 'market-1',
      value: {
        kind: 'BALANCE',
        currency: 'MYR',
        totalAvailableBalance: '1.0000000000',
      },
      drillDown: {
        metricId: 'M14',
        marketId: 'market-1',
        marketScope: 'SELECTED',
        permission: 'dashboard.view',
        masking: true,
        metricFilter: null,
        timeBoundary: null,
      },
    };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(catalogBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(detailBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const catalog = await client.dashboardMetrics();
    const detail = await client.dashboardMetricDetail('M14');

    expect(catalog).toEqual(catalogBody);
    expect(detail).toEqual(detailBody);
    expect(fetchSpy.mock.calls[0]?.[1]).not.toHaveProperty(
      'headers.x-market-id',
    );
  });

  it.each([
    'SESSION_IDLE_EXPIRED',
    'SESSION_ABSOLUTE_EXPIRED',
    'SESSION_FAMILY_EXPIRED',
    'SESSION_REUSE_DETECTED',
    'SESSION_REVOKED',
  ])(
    'preserves terminal session code %s without refresh replay',
    async (code) => {
      const core = createClient();
      core.setTokens({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accessExpiresAt: '2026-08-01T12:15:00.000Z',
      });
      const expired = vi.fn();
      core.onSessionExpired = expired;
      const fetchSpy = mockFetch(401, { code, message: 'Session ended.' });

      await expect(core.get('/admin/bootstrap')).rejects.toMatchObject({
        body: { code },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(expired).toHaveBeenCalledWith(code);
      expect(core.isAuthenticated).toBe(false);
    },
  );
});

describe('AdminMerchantApiClient (P7-S5B merchant operations)', () => {
  const merchantApi = new AdminMerchantApiClient(createClient());
  const MARKET = '11111111-1111-1111-1111-111111111111';
  const BRANCH = '22222222-2222-2222-2222-222222222222';
  const ACCOUNT = '33333333-3333-3333-3333-333333333333';

  function lastCall(mock: ReturnType<typeof mockFetch>) {
    return {
      url: mock.mock.calls[0]?.[0] as string,
      init: mock.mock.calls[0]?.[1] as RequestInit,
    };
  }

  it('lists merchant applications with query parameters (owner queue)', async () => {
    const mock = mockFetch(200, [{ application_id: 'app-1' }]);
    const result = await merchantApi.merchantApplications(MARKET, {
      status: 'SUBMITTED',
      limit: 25,
      offset: 50,
    });
    expect(result[0]?.application_id).toBe('app-1');
    const { url, init } = lastCall(mock);
    expect(url).toBe(
      `${BASE_URL}/admin/markets/${MARKET}/merchants/applications?status=SUBMITTED&limit=25&offset=50`,
    );
    expect(init.method).toBe('GET');
  });

  it('lists merchants with search and paging (owner list)', async () => {
    const mock = mockFetch(200, { items: [], limit: 10, offset: 0 });
    const result = await merchantApi.merchantList(MARKET, {
      query: 'kopitiam',
      status: 'ACTIVE',
      limit: 10,
    });
    expect(result.items).toEqual([]);
    const { url } = lastCall(mock);
    expect(url).toContain('/admin/markets/');
    expect(url).toContain('merchants?query=kopitiam&status=ACTIVE&limit=10');
  });

  it('fetches the branch detail from the Phase 7 adapter', async () => {
    const mock = mockFetch(200, {
      branch_id: BRANCH,
      market_id: MARKET,
      profile: { display_name: 'Branch A' },
      application: { status: 'SUBMITTED' },
      kyc: { current: null, previous: null },
      packages: { items: [] },
      mcp: null,
    });
    const result = await merchantApi.merchantBranchDetail(MARKET, BRANCH);
    expect(result.profile.display_name).toBe('Branch A');
    expect(result.mcp).toBeNull();
    const { url } = lastCall(mock);
    expect(url).toBe(
      `${BASE_URL}/admin/markets/${MARKET}/merchants/${BRANCH}/detail`,
    );
  });

  it('reviews an application via the owner command with Idempotency-Key', async () => {
    const mock = mockFetch(200, {
      application_id: 'app-1',
      branch_id: BRANCH,
      application_status: 'APPROVED',
      operational_status: 'PENDING_KYC',
    });
    const result = await merchantApi.reviewMerchantApplication(
      MARKET,
      BRANCH,
      { decision: 'APPROVED', reason: 'All good' },
      'idem-1',
    );
    expect(result.application_status).toBe('APPROVED');
    const { init } = lastCall(mock);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      decision: 'APPROVED',
      reason: 'All good',
    });
    expect((init.headers as Headers).get('idempotency-key')).toBe('idem-1');
  });

  it('reads the KYC review detail (audit-of-view surface)', async () => {
    const mock = mockFetch(200, {
      submission_id: 'kyc-1',
      status: 'UNDER_REVIEW',
      data: {},
      branch_id: BRANCH,
      merchant_id: 'M-1',
      market_id: MARKET,
      previous: null,
    });
    const result = await merchantApi.merchantKycReviewDetail(MARKET, BRANCH);
    expect(result.status).toBe('UNDER_REVIEW');
    const { url } = lastCall(mock);
    expect(url).toBe(
      `${BASE_URL}/admin/markets/${MARKET}/merchants/${BRANCH}/kyc/review`,
    );
  });

  it('reviews KYC with rejected fields for resubmission', async () => {
    const mock = mockFetch(200, {
      review_id: 'r-1',
      submission_id: 'kyc-1',
      branch_id: BRANCH,
      kyc_status: 'RESUBMISSION_REQUIRED',
      operational_status: 'PENDING_KYC',
      reason: 'Fix documents',
      rejected_fields: ['business_certification'],
      reviewed_at: '2026-01-01T00:00:00.000Z',
    });
    const result = await merchantApi.reviewMerchantKyc(
      MARKET,
      BRANCH,
      {
        decision: 'RESUBMISSION_REQUIRED',
        reason: 'Fix documents',
        rejected_fields: ['business_certification'],
      },
      'idem-kyc',
    );
    expect(result.kyc_status).toBe('RESUBMISSION_REQUIRED');
    const { init } = lastCall(mock);
    expect(JSON.parse(String(init.body)).rejected_fields).toEqual([
      'business_certification',
    ]);
    expect((init.headers as Headers).get('idempotency-key')).toBe('idem-kyc');
  });

  it('suspends and reactivates through owner commands', async () => {
    const fetchMock = mockFetch(200, {
      branch_id: BRANCH,
      operational_status: 'SUSPENDED',
    });
    const suspended = await merchantApi.suspendMerchant(
      MARKET,
      BRANCH,
      { reason: 'Compliance' },
      'idem-suspend',
    );
    expect(suspended.operational_status).toBe('SUSPENDED');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/suspend');

    fetchMock.mockReset();
    mockFetch(200, {
      branch_id: BRANCH,
      operational_status: 'ACTIVE',
    });
    const active = await merchantApi.reactivateMerchant(
      MARKET,
      BRANCH,
      { reason: 'Resolved' },
      'idem-reactivate',
    );
    expect(active.operational_status).toBe('ACTIVE');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/reactivate');
  });

  it('closes a merchant through the owner command', async () => {
    const mock = mockFetch(200, {
      branch_id: BRANCH,
      operational_status: 'CLOSED',
    });
    const result = await merchantApi.closeMerchant(
      MARKET,
      BRANCH,
      { reason: 'Business ended' },
      'idem-close',
    );
    expect(result.operational_status).toBe('CLOSED');
    expect(mock.mock.calls[0]?.[0]).toBe(
      `${BASE_URL}/admin/markets/${MARKET}/merchants/${BRANCH}/close`,
    );
  });

  it('reads bounded MCP account, reconciliation, and ledger summaries', async () => {
    const fetchMock = mockFetch(200, {
      id: ACCOUNT,
      branch_id: BRANCH,
      market_id: MARKET,
      available_balance: '1000.00000000',
      total_balance: '1000.00000000',
      status: 'ACTIVE',
      version: 1,
    });
    const account = await merchantApi.merchantMcpAccount(MARKET, ACCOUNT);
    expect(account.total_balance).toBe('1000.00000000');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${BASE_URL}/admin/markets/${MARKET}/mcp/accounts/${ACCOUNT}`,
    );

    fetchMock.mockReset();
    mockFetch(200, {
      account_id: ACCOUNT,
      stored: { total: '1000.00000000', available: '1000.00000000' },
      computed: {
        total: '1000.0000000000',
        available: '1000.0000000000',
        entries: 1,
      },
      matches: true,
    });
    const reconcile = await merchantApi.merchantMcpReconcile(MARKET, ACCOUNT);
    expect(reconcile.matches).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${BASE_URL}/admin/markets/${MARKET}/mcp/accounts/${ACCOUNT}/reconcile`,
    );

    fetchMock.mockReset();
    mockFetch(200, { items: [], limit: 10, offset: 0 });
    await merchantApi.merchantMcpLedger(MARKET, ACCOUNT, {
      limit: 10,
      offset: 0,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/ledger?limit=10&offset=0');
  });
});
