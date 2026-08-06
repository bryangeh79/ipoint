// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-base-to-string */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AdminApiClient,
  AdminDashboardCatalogDto,
  AdminDashboardMetricDetailDto,
  AdminKycOpsApiClient,
  AdminKycOpsCaseDetailDto,
  AdminKycOpsListPageDto,
  AdminKycOpsMerchantDetailDto,
  AdminKycOpsMerchantQueueDto,
  AdminKycOpsMerchantReviewResultDto,
  AdminMemberOpsListPageDto,
  AdminMemberOpsNotesPageDto,
  AdminMemberOpsProfileDto,
  AdminMerchantApiClient,
  AdminPackageCatalogDto,
  AdminPackageOpsApiClient,
  AdminPackageVersionDto,
  AdminSpecialPercentageCreateResultDto,
  AdminSpecialPercentageListDto,
  AdminRewardOpsApiClient,
  AdminRewardRuleListDto,
  AdminRewardRuleVersionDto,
  AdminRewardRuleCreateResultDto,
  AdminCommissionOpsApiClient,
  AdminCommissionRateListDto,
  AdminCommissionRateCreateResultDto,
  AdminMarketOpsApiClient,
  AdminMarketDetailDto,
  AdminMarketUpdateResultDto,
  AdminIpointAdjustOpsApiClient,
  AdminIpointAdjustmentDto,
  AdminIpointAdjustmentQueueDto,
  AdminIpointAdjustmentDetailDto,
  AdminRedemptionOpsApiClient,
  AdminRedemptionRateListDto,
  AdminRedemptionRateCreateResultDto,
  AdminRedemptionRateCancelResultDto,
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

/* ------------------------------------------------------------------ */
/*  P7-S5A Admin Member Operations client tests (append-only section)  */
/* ------------------------------------------------------------------ */

describe('AdminApiClient Member Operations (P7-S5A)', () => {
  const listPageBody: AdminMemberOpsListPageDto = {
    marketId: 'market-1',
    members: [
      {
        publicMemberId: 'mem_1',
        displayName: null,
        email: 'a***@example.com',
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
        accountCountry: 'MY',
        currentMarketId: 'market-1',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  };

  const profileBody: AdminMemberOpsProfileDto = {
    publicMemberId: 'mem_1',
    displayName: null,
    email: 'a***@example.com',
    status: 'ACTIVE',
    kycLevel: 'LEVEL_1',
    accountCountry: 'MY',
    currentMarketId: 'market-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    closedAt: null,
    profile: {
      fullName: 'J*** M****** D**',
      phone: '********6789',
      phoneVerificationStatus: 'VERIFIED',
      birthDate: null,
      address: null,
      locale: 'en-MY',
      language: 'en',
    },
    kyc: null,
    marketPreferences: [
      {
        marketId: 'market-1',
        marketCode: 'MA',
        isEnabled: true,
        isCurrent: true,
        sortOrder: 0,
        lastSelectedAt: null,
      },
    ],
    notes: [],
    statusHistory: [],
  };

  const notesPageBody: AdminMemberOpsNotesPageDto = {
    notes: [
      {
        id: 'note-1',
        adminUserId: 'admin-1',
        marketId: 'market-1',
        content: 'Follow up.',
        isInternal: true,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  };

  it('uses the exact P7-S5A member operations paths with URL encoding', async () => {
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

    await client.memberOpsList({ page: 2, pageSize: 50, status: 'SUSPENDED' });
    await client.memberOpsDetail('mem/unsafe');
    await client.memberOpsSuspend('mem/unsafe', {
      reason: 'r',
      idempotencyKey: 'k1',
    });
    await client.memberOpsReactivate('mem_1', {
      reason: 'r',
      idempotencyKey: 'k1',
    });
    await client.memberOpsClose('mem_1', {
      reason: 'r',
      confirmationText: 'CONFIRM',
      idempotencyKey: 'k1',
    });
    await client.memberOpsRevokeSessions('mem_1', {
      reason: 'r',
      idempotencyKey: 'k1',
    });
    await client.memberOpsRequireReverification('mem_1', {
      reason: 'r',
      idempotencyKey: 'k1',
    });
    await client.memberOpsAddNote('mem_1', {
      content: 'n',
      isInternal: true,
      idempotencyKey: 'k1',
    });
    await client.memberOpsNotes('mem_1', { page: 1, pageSize: 10 });

    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual([
      `${BASE_URL}/admin/member-ops/members?page=2&pageSize=50&status=SUSPENDED`,
      `${BASE_URL}/admin/member-ops/members/mem%2Funsafe`,
      `${BASE_URL}/admin/member-ops/members/mem%2Funsafe/suspend`,
      `${BASE_URL}/admin/member-ops/members/mem_1/reactivate`,
      `${BASE_URL}/admin/member-ops/members/mem_1/close`,
      `${BASE_URL}/admin/member-ops/members/mem_1/revoke-sessions`,
      `${BASE_URL}/admin/member-ops/members/mem_1/require-reverification`,
      `${BASE_URL}/admin/member-ops/members/mem_1/notes`,
      `${BASE_URL}/admin/member-ops/members/mem_1/notes?page=1&pageSize=10`,
    ]);
    expect(JSON.parse(String(fetchSpy.mock.calls[3]?.[1]?.body))).toEqual({
      reason: 'r',
      idempotencyKey: 'k1',
    });
    expect(JSON.parse(String(fetchSpy.mock.calls[4]?.[1]?.body))).toEqual({
      reason: 'r',
      confirmationText: 'CONFIRM',
      idempotencyKey: 'k1',
    });
  });

  it('never sends a market query parameter on the member list', async () => {
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
    await client.memberOpsList({ page: 1 });
    const url = String(fetchSpy.mock.calls[0]?.[0]);
    expect(url).not.toMatch(/market/);
    expect(url).toBe(`${BASE_URL}/admin/member-ops/members?page=1`);
  });

  it('round-trips the list, detail, and notes DTO shapes', async () => {
    const core = createClient();
    core.setTokens({
      accessToken: 'access-token',
      accessExpiresAt: '2026-08-01T12:15:00.000Z',
    });
    const client = new AdminApiClient(core);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(listPageBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(profileBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(notesPageBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const list = await client.memberOpsList();
    const detail = await client.memberOpsDetail('mem_1');
    const notes = await client.memberOpsNotes('mem_1');

    expect(list).toEqual(listPageBody);
    expect(detail).toEqual(profileBody);
    expect(notes).toEqual(notesPageBody);
    // No client-supplied market header on any member ops request.
    for (const call of fetchSpy.mock.calls) {
      expect(call[1]).not.toHaveProperty('headers.x-market-id');
    }
  });
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

/* ────────────────────────────────────────────────────────────────────────
 * P7-S5C Admin KYC Operations client tests (append-only block)
 * ──────────────────────────────────────────────────────────────────────── */

describe('AdminKycOpsApiClient (P7-S5C KYC review + privacy)', () => {
  const CASE = '33333333-3333-4333-8333-333333333333';
  const BRANCH = '44444444-4444-4444-8444-444444444444';

  function kycOpsClient(): AdminKycOpsApiClient {
    return new AdminKycOpsApiClient(new ApiClient(BASE_URL));
  }

  it('lists member KYC cases with query parameters and no client market', async () => {
    const client = kycOpsClient();
    const page: AdminKycOpsListPageDto = {
      items: [
        {
          id: CASE,
          marketId: '11111111-1111-4111-8111-111111111111',
          status: 'SUBMITTED',
          levelRequested: 'LEVEL_2',
          member: {
            publicMemberId: 'mem_public_1',
            displayName: null,
            email: 'j***@example.com',
            accountCountry: 'MY',
            status: 'ACTIVE',
            kycLevel: 'LEVEL_1',
          },
          submittedAt: '2026-08-01T00:00:00.000Z',
          reviewedAt: null,
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      marketId: '11111111-1111-4111-8111-111111111111',
    };
    const fetchMock = mockFetch(200, page);
    const result = await client.memberKycList({ status: 'SUBMITTED', page: 1 });
    expect(result.total).toBe(1);
    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain('/admin/kyc-ops/members?status=SUBMITTED');
    // The client never sends a market parameter.
    expect(String(url)).not.toMatch(/[?&]market/);
  });

  it('reads the masked member case detail from the adapter path', async () => {
    const client = kycOpsClient();
    const fetchMock = mockFetch(200, {
      id: CASE,
      marketId: '11111111-1111-4111-8111-111111111111',
      status: 'SUBMITTED',
      levelRequested: 'LEVEL_2',
      member: {
        publicMemberId: 'mem_public_1',
        displayName: null,
        email: 'j***@example.com',
        accountCountry: 'MY',
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      },
      submittedAt: '2026-08-01T00:00:00.000Z',
      reviewedAt: null,
      updatedAt: '2026-08-01T00:00:00.000Z',
      version: 1,
      legalFullName: 'J*** M*** D***',
      identificationType: 'NATIONAL_ID',
      identificationNumber: '****1234',
      dateOfBirth: null,
      nationality: 'MY',
      residentialAddress: null,
      accountCountrySnapshot: 'MY',
      submissionMarketId: '11111111-1111-4111-8111-111111111111',
      consentVersion: 'test-v1',
      reviewedByAdminUserId: null,
      decisionReason: null,
      reverificationRequiredAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      documents: [],
      history: [],
      evidenceAccess: {
        masked: true,
        rawDocumentContent: false,
        audited: true,
      },
    } satisfies AdminKycOpsCaseDetailDto);
    const detail = await client.memberKycDetail(CASE);
    expect(detail.legalFullName).toBe('J*** M*** D***');
    expect(detail.evidenceAccess.masked).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${BASE_URL}/admin/kyc-ops/members/${CASE}`,
    );
  });

  it('sends the recorded reason and step-up token as headers on evidence views', async () => {
    const client = kycOpsClient();
    const fetchMock = mockFetch(200, {
      id: CASE,
      marketId: '11111111-1111-4111-8111-111111111111',
      status: 'SUBMITTED',
      levelRequested: 'LEVEL_2',
      member: {
        publicMemberId: 'mem_public_1',
        displayName: null,
        email: 'j***@example.com',
        accountCountry: 'MY',
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      },
      submittedAt: '2026-08-01T00:00:00.000Z',
      reviewedAt: null,
      updatedAt: '2026-08-01T00:00:00.000Z',
      version: 1,
      legalFullName: 'Jane Mildred Doe',
      identificationType: 'NATIONAL_ID',
      identificationNumber: '****1234',
      dateOfBirth: '1990-01-02',
      nationality: 'MY',
      residentialAddress: { line1: '1 Test Street' },
      accountCountrySnapshot: 'MY',
      submissionMarketId: '11111111-1111-4111-8111-111111111111',
      consentVersion: 'test-v1',
      reviewedByAdminUserId: null,
      decisionReason: null,
      reverificationRequiredAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      documents: [],
      history: [],
      evidenceAccess: {
        masked: false,
        rawDocumentContent: false,
        audited: true,
      },
    } satisfies AdminKycOpsCaseDetailDto);
    const evidence = await client.memberKycEvidence(CASE, {
      reason: 'Identity verification review',
      stepUpToken: 'grant-token',
    });
    expect(evidence.evidenceAccess.masked).toBe(false);
    expect(evidence.dateOfBirth).toBe('1990-01-02');
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('x-sensitive-access-reason')).toBe(
      'Identity verification review',
    );
    expect(headers.get('x-step-up-token')).toBe('grant-token');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/evidence');
  });

  it('invokes the member review action with the Idempotency-Key header', async () => {
    const client = kycOpsClient();
    const fetchMock = mockFetch(200, {
      id: CASE,
      marketId: '11111111-1111-4111-8111-111111111111',
      status: 'UNDER_REVIEW',
      levelRequested: 'LEVEL_2',
      member: {
        publicMemberId: 'mem_public_1',
        displayName: null,
        email: 'j***@example.com',
        accountCountry: 'MY',
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      },
      submittedAt: '2026-08-01T00:00:00.000Z',
      reviewedAt: null,
      updatedAt: '2026-08-01T00:00:00.000Z',
      version: 1,
      legalFullName: 'Jane Mildred Doe',
      identificationType: 'NATIONAL_ID',
      identificationNumber: '****1234',
      dateOfBirth: '1990-01-02',
      nationality: 'MY',
      residentialAddress: { line1: '1 Test Street' },
      accountCountrySnapshot: 'MY',
      submissionMarketId: '11111111-1111-4111-8111-111111111111',
      consentVersion: 'test-v1',
      reviewedByAdminUserId: null,
      decisionReason: 'Documents verified',
      reverificationRequiredAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      documents: [],
      history: [],
      evidenceAccess: {
        masked: false,
        rawDocumentContent: false,
        audited: false,
      },
    } satisfies AdminKycOpsCaseDetailDto);
    const result = await client.memberKycAction(
      CASE,
      'start-review',
      { reason: 'Starting document review' },
      'idem-1',
    );
    expect(result.status).toBe('UNDER_REVIEW');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `${BASE_URL}/admin/kyc-ops/members/${CASE}/start-review`,
    );
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('idempotency-key')).toBe('idem-1');
  });

  it('lists merchant KYC submissions with paging and no client market', async () => {
    const client = kycOpsClient();
    const queue: AdminKycOpsMerchantQueueDto = {
      items: [
        {
          submission_id: 'sub-1',
          branch_id: BRANCH,
          merchant_id: 'MERCH-1',
          display_name: 'Acme Sdn Bhd',
          status: 'SUBMITTED',
          submission_version: 1,
          submitted_at: '2026-08-01T00:00:00.000Z',
          reviewed_at: null,
        },
      ],
      marketId: '11111111-1111-4111-8111-111111111111',
      limit: 50,
      offset: 0,
    };
    const fetchMock = mockFetch(200, queue);
    const result = await client.merchantKycList({ status: 'SUBMITTED' });
    expect(result.items[0]?.display_name).toBe('Acme Sdn Bhd');
    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain('/admin/kyc-ops/merchants?status=SUBMITTED');
    expect(String(url)).not.toMatch(/[?&]market/);
  });

  it('reads merchant masked detail and evidence with reason headers', async () => {
    const client = kycOpsClient();
    mockFetch(200, {
      branch_id: BRANCH,
      merchant_id: 'MERCH-1',
      market_id: '11111111-1111-4111-8111-111111111111',
      display_name: 'Acme Sdn Bhd',
      current: {
        submission_id: 'sub-1',
        submission_version: 1,
        status: 'SUBMITTED',
        submitted_at: '2026-08-01T00:00:00.000Z',
        data: { business_certification: { registration_number: '***2345' } },
        review: null,
      },
      previous: null,
      evidenceAccess: {
        masked: true,
        rawDocumentContent: false,
        audited: true,
      },
    } satisfies AdminKycOpsMerchantDetailDto);
    const detail = await client.merchantKycDetail(BRANCH);
    expect(detail.evidenceAccess.masked).toBe(true);

    const fetchMock = mockFetch(200, {
      branch_id: BRANCH,
      merchant_id: 'MERCH-1',
      market_id: '11111111-1111-4111-8111-111111111111',
      display_name: 'Acme Sdn Bhd',
      current: {
        submission_id: 'sub-1',
        submission_version: 1,
        status: 'UNDER_REVIEW',
        submitted_at: '2026-08-01T00:00:00.000Z',
        data: {
          business_certification: { registration_number: '202001012345' },
        },
        review: null,
      },
      previous: null,
      evidenceAccess: {
        masked: false,
        rawDocumentContent: false,
        audited: true,
      },
    } satisfies AdminKycOpsMerchantDetailDto);
    const evidence = await client.merchantKycEvidence(BRANCH, {
      reason: 'Business verification review',
      stepUpToken: 'grant-token',
    });
    expect(evidence.evidenceAccess.masked).toBe(false);
    const lastCall = fetchMock.mock.calls.at(-1) ?? [];
    const [url, init] = lastCall;
    expect(String(url)).toBe(
      `${BASE_URL}/admin/kyc-ops/merchants/${BRANCH}/evidence`,
    );
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('x-sensitive-access-reason')).toBe(
      'Business verification review',
    );
    expect(headers.get('x-step-up-token')).toBe('grant-token');
  });

  it('decides a merchant KYC submission with the Idempotency-Key header', async () => {
    const client = kycOpsClient();
    const fetchMock = mockFetch(200, {
      review_id: 'review-1',
      submission_id: 'sub-1',
      branch_id: BRANCH,
      kyc_status: 'APPROVED',
      operational_status: 'ACTIVE',
      reason: 'Documents verified',
      rejected_fields: [],
      reviewed_at: '2026-08-01T01:00:00.000Z',
    } satisfies AdminKycOpsMerchantReviewResultDto);
    const result = await client.merchantKycReview(
      BRANCH,
      { decision: 'APPROVED', reason: 'Documents verified' },
      'idem-review',
    );
    expect(result.kyc_status).toBe('APPROVED');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `${BASE_URL}/admin/kyc-ops/merchants/${BRANCH}/review`,
    );
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('idempotency-key')).toBe('idem-review');
    expect(JSON.parse(String((init as RequestInit | undefined)?.body))).toEqual(
      { decision: 'APPROVED', reason: 'Documents verified' },
    );
  });

  it('propagates server evidence-gating errors as ApiError', async () => {
    const client = kycOpsClient();
    mockFetch(422, { code: 'SENSITIVE_VIEW_REASON_REQUIRED' });
    await expect(
      client.memberKycEvidence(CASE, { reason: 'short' }),
    ).rejects.toMatchObject({
      status: 422,
      body: { code: 'SENSITIVE_VIEW_REASON_REQUIRED' },
    });
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * P7-S6A Admin Package Operations client tests (append-only block)
 * ──────────────────────────────────────────────────────────────────────── */

describe('AdminPackageOpsApiClient (P7-S6A package configuration)', () => {
  const MARKET = '11111111-1111-4111-8111-111111111111';
  const PACKAGE = '22222222-2222-4222-8222-222222222222';
  const VERSION = '33333333-3333-4333-8333-333333333333';
  const BRANCH = '44444444-4444-4444-8444-444444444444';

  function packageOpsClient(): AdminPackageOpsApiClient {
    return new AdminPackageOpsApiClient(new ApiClient(BASE_URL));
  }

  it('reads the selected-market package catalog with exact decimal rates', async () => {
    const client = packageOpsClient();
    const catalog: AdminPackageCatalogDto = {
      marketId: MARKET,
      items: [
        {
          id: PACKAGE,
          code: 'A',
          name: 'Standard Package A',
          description: 'Standard merchant service-fee package A.',
          versions: [
            {
              id: VERSION,
              profile_id: PACKAGE,
              rate: '2.500000',
              status: 'ACTIVE',
              effective_from: '1970-01-01T00:00:00.000Z',
              effective_to: null,
              created_at: '2026-08-01T00:00:00.000Z',
            },
          ],
        },
      ],
    };
    const fetchSpy = mockFetch(200, catalog);

    const result = await client.packageCatalog(MARKET);

    expect(result.items[0]?.code).toBe('A');
    // Exact decimal strings are never parsed client-side.
    expect(result.items[0]?.versions[0]?.rate).toBe('2.500000');
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      `${BASE_URL}/admin/package-ops/markets/${MARKET}/packages`,
    );
  });

  it('passes the step-up token for the privileged special-percentage read', async () => {
    const client = packageOpsClient();
    const body: AdminSpecialPercentageListDto = {
      marketId: MARKET,
      items: [
        {
          id: 'special-1',
          rate: '12.500000',
          description: 'Special launch partner',
          created_by_admin_user_id: 'admin-1',
          created_at: '2026-08-01T00:00:00.000Z',
        },
      ],
    };
    const fetchMock = mockFetch(200, body);

    const result = await client.specialPercentages(MARKET, 'stepup-token');

    expect(result.items[0]?.rate).toBe('12.500000');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `${BASE_URL}/admin/package-ops/markets/${MARKET}/special-percentages`,
    );
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('x-step-up-token')).toBe('stepup-token');
  });

  it('creates a package version through the owner command with an Idempotency-Key', async () => {
    const client = packageOpsClient();
    const version: AdminPackageVersionDto = {
      id: VERSION,
      profile_id: PACKAGE,
      rate: '2.500000',
      status: 'DRAFT',
      effective_from: '2027-01-01T00:00:00.000Z',
      effective_to: '2027-06-01T00:00:00.000Z',
      created_at: '2026-08-01T00:00:00.000Z',
    };
    const fetchMock = mockFetch(201, version);

    const result = await client.createPackageVersion(
      MARKET,
      PACKAGE,
      {
        rate: '2.5',
        effective_from: '2027-01-01T00:00:00.000Z',
        effective_to: '2027-06-01T00:00:00.000Z',
      },
      'idem-create',
    );

    expect(result.rate).toBe('2.500000');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `${BASE_URL}/admin/markets/${MARKET}/packages/${PACKAGE}/versions`,
    );
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('idempotency-key')).toBe('idem-create');
    expect(JSON.parse(String((init as RequestInit | undefined)?.body))).toEqual(
      {
        rate: '2.5',
        effective_from: '2027-01-01T00:00:00.000Z',
        effective_to: '2027-06-01T00:00:00.000Z',
      },
    );
  });

  it('activates a package version through the owner command', async () => {
    const client = packageOpsClient();
    const fetchMock = mockFetch(200, {
      id: VERSION,
      profile_id: PACKAGE,
      rate: '4.000000',
      status: 'ACTIVE',
      effective_from: '2026-01-01T00:00:00.000Z',
      effective_to: '2027-01-01T00:00:00.000Z',
      created_at: '2026-08-01T00:00:00.000Z',
    } satisfies AdminPackageVersionDto);

    const result = await client.activatePackageVersion(
      MARKET,
      PACKAGE,
      VERSION,
      'idem-activate',
    );

    expect(result.status).toBe('ACTIVE');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `${BASE_URL}/admin/markets/${MARKET}/packages/${PACKAGE}/versions/${VERSION}/activate`,
    );
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('idempotency-key')).toBe('idem-activate');
  });

  it('assigns and sets default through the explicit owner reassignment commands', async () => {
    const client = packageOpsClient();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'assign-1' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'assign-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const assigned = await client.assignMerchantPackage(
      MARKET,
      BRANCH,
      { service_fee_version_id: VERSION, is_default: true },
      'idem-assign',
    );
    const madeDefault = await client.setDefaultMerchantPackage(
      MARKET,
      BRANCH,
      'assign-1',
      'idem-default',
    );

    expect(assigned.id).toBe('assign-1');
    expect(madeDefault.id).toBe('assign-1');
    const [assignUrl, assignInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(assignUrl)).toBe(
      `${BASE_URL}/admin/markets/${MARKET}/merchants/${BRANCH}/packages/assignments`,
    );
    expect(
      JSON.parse(String((assignInit as RequestInit | undefined)?.body)),
    ).toEqual({ service_fee_version_id: VERSION, is_default: true });
    const [defaultUrl, defaultInit] = fetchMock.mock.calls[1] ?? [];
    expect(String(defaultUrl)).toBe(
      `${BASE_URL}/admin/markets/${MARKET}/merchants/${BRANCH}/packages/assignments/assign-1/set-default`,
    );
    const headers = new Headers(
      (defaultInit as RequestInit | undefined)?.headers,
    );
    expect(headers.get('idempotency-key')).toBe('idem-default');
  });

  it('propagates step-up gating errors from the privileged read', async () => {
    const client = packageOpsClient();
    mockFetch(403, { code: 'MFA_STEP_UP_REQUIRED' });
    await expect(client.specialPercentages(MARKET)).rejects.toMatchObject({
      status: 403,
      body: { code: 'MFA_STEP_UP_REQUIRED' },
    });
  });

  it('creates a special percentage through the D-051 secured owner command', async () => {
    const client = packageOpsClient();
    const result: AdminSpecialPercentageCreateResultDto = {
      id: 'special-new',
      rate: '21.750000',
      description: 'Rewire integration partner',
      reason: 'Approved ops review — rewire evidence',
      marketId: MARKET,
      market: 'MA',
      created_by: 'admin-1',
      created_at: '2026-08-02T00:00:00.000Z',
    };
    const fetchMock = mockFetch(201, result);

    const created = await client.createSpecialPercentage(
      MARKET,
      {
        rate: '21.75',
        description: 'Rewire integration partner',
        reason: 'Approved ops review — rewire evidence',
      },
      'idem-special',
      'stepup-token',
    );

    expect(created).toEqual(result);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `${BASE_URL}/admin/package-ops/markets/${MARKET}/special-percentages`,
    );
    const initObj = init as RequestInit | undefined;
    expect(initObj?.method ?? 'GET').toBe('POST');
    const headers = new Headers(initObj?.headers);
    expect(headers.get('idempotency-key')).toBe('idem-special');
    expect(headers.get('x-step-up-token')).toBe('stepup-token');
    expect(JSON.parse(String(initObj?.body))).toEqual({
      rate: '21.75',
      description: 'Rewire integration partner',
      reason: 'Approved ops review — rewire evidence',
    });
  });

  it('creates a special percentage without a step-up token header when absent', async () => {
    const client = packageOpsClient();
    const fetchMock = mockFetch(201, {
      id: 'special-new',
      rate: '21.750000',
      description: 'Partner',
      reason: 'Approved',
      marketId: MARKET,
      market: 'MA',
      created_by: 'admin-1',
      created_at: '2026-08-02T00:00:00.000Z',
    });

    await client.createSpecialPercentage(
      MARKET,
      { rate: '21.75', description: 'Partner', reason: 'Approved' },
      'idem-special-2',
    );

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `${BASE_URL}/admin/package-ops/markets/${MARKET}/special-percentages`,
    );
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('idempotency-key')).toBe('idem-special-2');
    expect(headers.get('x-step-up-token')).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * P7-S6B Admin Reward Configuration client tests (append-only block)
 * ──────────────────────────────────────────────────────────────────────── */

describe('AdminRewardOpsApiClient (P7-S6B reward configuration)', () => {
  const MARKET = '11111111-1111-4111-8111-111111111111';
  const VERSION = '55555555-5555-4555-8555-555555555555';

  function rewardOpsClient(): AdminRewardOpsApiClient {
    return new AdminRewardOpsApiClient(new ApiClient(BASE_URL));
  }

  it('reads the selected-market reward schedule with exact decimal rates', async () => {
    const client = rewardOpsClient();
    const schedule: AdminRewardRuleListDto = {
      marketId: MARKET,
      timezone: 'Asia/Kuala_Lumpur',
      packages: [
        { code: 'A', max_rate_per_day: '0.0125' },
        { code: 'B', max_rate_per_day: '0.025' },
        { code: 'C', max_rate_per_day: '0.05' },
      ],
      rules: [
        {
          id: VERSION,
          name: 'Package A Reward Rate',
          description: null,
          reward_rate: '0.0125',
          cap_type: 'NONE',
          cap_value: '0',
          minimum_reward: '0',
          package_reference: 'A',
          effective_from_utc: '2026-08-31T16:00:00.000Z',
          effective_from_local: '2026-09-01 00:00:00',
          effective_until_utc: null,
          effective_until_local: null,
          timezone: 'Asia/Kuala_Lumpur',
          window_status: 'ACTIVE',
          market_id: MARKET,
          created_by: 'admin-1',
          created_at: '2026-08-04T00:00:00.000Z',
        },
      ],
    };
    const fetchSpy = mockFetch(200, schedule);

    const result = await client.listRules(MARKET);

    expect(result.packages[0]?.max_rate_per_day).toBe('0.0125');
    expect(result.rules[0]?.reward_rate).toBe('0.0125');
    expect(result.rules[0]?.effective_from_local).toBe('2026-09-01 00:00:00');
    expect(result.rules[0]?.window_status).toBe('ACTIVE');
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      `${BASE_URL}/admin/reward-ops/markets/${MARKET}/rules`,
    );
  });

  it('schedules a rule version with the mandatory Idempotency-Key and reason', async () => {
    const client = rewardOpsClient();
    const result: AdminRewardRuleCreateResultDto = {
      id: VERSION,
      package_reference: 'B',
      reward_rate: '0.025',
      effective_date: '2026-09-01',
      effective_from_utc: '2026-08-31T16:00:00.000Z',
      effective_from_local: '2026-09-01 00:00:00',
      timezone: 'Asia/Kuala_Lumpur',
      market_id: MARKET,
      created_by: 'admin-1',
      created_at: '2026-08-04T00:00:00.000Z',
    };
    const fetchMock = mockFetch(201, result);

    const scheduled = await client.createRule(
      MARKET,
      {
        package_reference: 'B',
        rate: '0.025',
        effective_date: '2026-09-01',
        reason: 'Q3 rate review',
      },
      'idem-reward-create',
    );

    expect(scheduled.id).toBe(VERSION);
    expect(scheduled.reward_rate).toBe('0.025');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `${BASE_URL}/admin/reward-ops/markets/${MARKET}/rules`,
    );
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('idempotency-key')).toBe('idem-reward-create');
    expect(JSON.parse(String((init as RequestInit | undefined)?.body))).toEqual(
      {
        package_reference: 'B',
        rate: '0.025',
        effective_date: '2026-09-01',
        reason: 'Q3 rate review',
      },
    );
  });

  it('passes exact decimal strings through untouched (never parsed)', async () => {
    const client = rewardOpsClient();
    const schedule: AdminRewardRuleListDto = {
      marketId: MARKET,
      timezone: 'UTC',
      packages: [{ code: 'F', max_rate_per_day: '0.05' }],
      rules: [
        {
          id: VERSION,
          name: 'Package F Reward Rate',
          description: null,
          reward_rate: '0.000001',
          cap_type: 'NONE',
          cap_value: '0',
          minimum_reward: '0',
          package_reference: 'F',
          effective_from_utc: '2026-09-01T00:00:00.000Z',
          effective_from_local: '2026-09-01 00:00:00',
          effective_until_utc: null,
          effective_until_local: null,
          timezone: 'UTC',
          window_status: 'SCHEDULED',
          market_id: MARKET,
          created_by: 'admin-1',
          created_at: '2026-08-04T00:00:00.000Z',
        },
      ],
    };
    const fetchSpy = mockFetch(200, schedule);

    const result = await client.listRules(MARKET);

    // Six-decimal exact strings survive the round trip byte-for-byte.
    expect(result.rules[0]?.reward_rate).toBe('0.000001');
    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toContain('/admin/reward-ops/markets/');
  });

  it('propagates permission and idempotency errors from the write surface', async () => {
    const client = rewardOpsClient();
    mockFetch(403, { code: 'PERMISSION_DENIED' });
    await expect(
      client.createRule(
        MARKET,
        {
          package_reference: 'C',
          rate: '0.05',
          effective_date: '2026-09-01',
          reason: 'Ops review',
        },
        'idem-conflict',
      ),
    ).rejects.toMatchObject({
      status: 403,
      body: { code: 'PERMISSION_DENIED' },
    });

    mockFetch(409, { code: 'REWARD_IDEMPOTENCY_CONFLICT' });
    await expect(
      client.createRule(
        MARKET,
        {
          package_reference: 'C',
          rate: '0.05',
          effective_date: '2026-09-01',
          reason: 'Ops review',
        },
        'idem-conflict',
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: 'REWARD_IDEMPOTENCY_CONFLICT' },
    });
  });
});

describe('AdminRedemptionOpsApiClient (P7-S6C redemption rate configuration)', () => {
  const MARKET = '11111111-1111-4111-8111-111111111111';
  const VERSION = '66666666-6666-4666-8666-666666666666';

  function redemptionOpsClient(): AdminRedemptionOpsApiClient {
    return new AdminRedemptionOpsApiClient(new ApiClient(BASE_URL));
  }

  it('reads the selected-market configuration with exact bounds and rates', async () => {
    const client = redemptionOpsClient();
    const config: AdminRedemptionRateListDto = {
      market_id: MARKET,
      market_code: 'MY',
      timezone: 'Asia/Kuala_Lumpur',
      configured: true,
      config: {
        initial_rate: '1',
        minimum_rate: '0.5',
        maximum_rate: '2',
        currency: 'MYR',
        display_unit: 'RM per 1 iPoint',
        technical_decimals: 10,
        display_decimals: 6,
      },
      rates: [
        {
          id: VERSION,
          rate_type: 'POINTS_PER_CURRENCY',
          rate_value: '1.1234567890',
          display_rate: '1.123457',
          effective_from_utc: '2026-08-31T16:00:00.000Z',
          effective_from_local: '2026-09-01 00:00:00',
          effective_until_utc: null,
          effective_until_local: null,
          window_status: 'ACTIVE',
          created_by: 'admin-1',
          created_at: '2026-08-04T00:00:00.000Z',
        },
      ],
    };
    const fetchSpy = mockFetch(200, config);

    const result = await client.listRates(MARKET);

    expect(result.configured).toBe(true);
    expect(result.config?.minimum_rate).toBe('0.5');
    expect(result.config?.maximum_rate).toBe('2');
    // Full technical precision survives; display is ≤6 and display-only.
    expect(result.rates[0]?.rate_value).toBe('1.1234567890');
    expect(result.rates[0]?.display_rate).toBe('1.123457');
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      `${BASE_URL}/admin/redemption-ops/markets/${MARKET}/rates`,
    );
  });

  it('surfaces the explicit blocked state for unapproved markets', async () => {
    const client = redemptionOpsClient();
    const blocked: AdminRedemptionRateListDto = {
      market_id: MARKET,
      market_code: 'SG',
      timezone: 'Asia/Singapore',
      configured: false,
      config: null,
      rates: [],
    };
    mockFetch(200, blocked);

    const result = await client.listRates(MARKET);

    expect(result.configured).toBe(false);
    expect(result.config).toBeNull();
    expect(result.rates).toEqual([]);
  });

  it('creates a rate version with the mandatory Idempotency-Key and reason', async () => {
    const client = redemptionOpsClient();
    const result: AdminRedemptionRateCreateResultDto = {
      id: VERSION,
      rate_type: 'POINTS_PER_CURRENCY',
      rate_value: '1.0000000000',
      display_rate: '1',
      effective_date: '2026-09-01',
      effective_from_utc: '2026-08-31T16:00:00.000Z',
      effective_from_local: '2026-09-01 00:00:00',
      timezone: 'Asia/Kuala_Lumpur',
      market_id: MARKET,
      created_by: 'admin-1',
      created_at: '2026-08-04T00:00:00.000Z',
    };
    const fetchSpy = mockFetch(201, result);

    const created = await client.createRate(
      MARKET,
      {
        rate_value: '1.0000000000',
        effective_date: '2026-09-01',
        reason: 'Malaysia initial rate baseline',
      },
      'idem-redemption-1',
    );

    expect(created.id).toBe(VERSION);
    expect(created.rate_value).toBe('1.0000000000');
    expect(created.display_rate).toBe('1');
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `${BASE_URL}/admin/redemption-ops/markets/${MARKET}/rates`,
    );
    const headers = new Headers(init?.headers);
    expect(headers.get('idempotency-key')).toBe('idem-redemption-1');
  });

  it('passes exact decimal strings through untouched (never parsed)', async () => {
    const client = redemptionOpsClient();
    const body = JSON.stringify({
      id: VERSION,
      rate_type: 'POINTS_PER_CURRENCY',
      rate_value: '1.1234567890',
      display_rate: '1.123457',
      effective_date: '2026-09-01',
      effective_from_utc: '2026-08-31T16:00:00.000Z',
      effective_from_local: '2026-09-01 00:00:00',
      timezone: 'Asia/Kuala_Lumpur',
      market_id: MARKET,
      created_by: 'admin-1',
      created_at: '2026-08-04T00:00:00.000Z',
    });
    const fetchSpy = mockFetch(201, JSON.parse(body) as unknown);

    const result = await client.createRate(
      MARKET,
      {
        rate_value: '1.1234567890',
        effective_date: '2026-09-01',
        reason: 'Precision check',
      },
      'idem-redemption-2',
    );

    // The ten-decimal technical string survives byte-for-byte.
    expect(result.rate_value).toBe('1.1234567890');
    expect(fetchSpy.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        rate_value: '1.1234567890',
        effective_date: '2026-09-01',
        reason: 'Precision check',
      }),
    );
  });

  it('propagates permission, blocked-market and idempotency errors', async () => {
    const client = redemptionOpsClient();
    mockFetch(403, { code: 'PERMISSION_DENIED' });
    await expect(
      client.createRate(
        MARKET,
        {
          rate_value: '1.5',
          effective_date: '2026-09-01',
          reason: 'Ops review',
        },
        'idem-conflict',
      ),
    ).rejects.toMatchObject({
      status: 403,
      body: { code: 'PERMISSION_DENIED' },
    });

    mockFetch(422, { code: 'REDEMPTION_RATE_MARKET_BLOCKED' });
    await expect(
      client.createRate(
        MARKET,
        {
          rate_value: '1.5',
          effective_date: '2026-09-01',
          reason: 'Ops review',
        },
        'idem-conflict-2',
      ),
    ).rejects.toMatchObject({
      status: 422,
      body: { code: 'REDEMPTION_RATE_MARKET_BLOCKED' },
    });

    mockFetch(409, { code: 'REDEMPTION_IDEMPOTENCY_CONFLICT' });
    await expect(
      client.createRate(
        MARKET,
        {
          rate_value: '1.5',
          effective_date: '2026-09-01',
          reason: 'Ops review',
        },
        'idem-conflict',
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: 'REDEMPTION_IDEMPOTENCY_CONFLICT' },
    });
  });

  it('cancels a scheduled version with the mandatory Idempotency-Key and reason', async () => {
    const client = redemptionOpsClient();
    const result: AdminRedemptionRateCancelResultDto = {
      id: '44444444-4444-4444-8444-444444444444',
      rate_version_id: VERSION,
      market_id: MARKET,
      rate_value: '1.5',
      effective_from_utc: '2026-08-31T16:00:00.000Z',
      reason: 'Scheduled baseline no longer required',
      cancelled_by: 'admin-1',
      cancelled_at: '2026-08-04T01:00:00.000Z',
    };
    const fetchSpy = mockFetch(200, result);

    const cancelled = await client.cancelRate(
      MARKET,
      VERSION,
      { reason: 'Scheduled baseline no longer required' },
      'idem-cancel-1',
    );

    expect(cancelled.id).toBe(result.id);
    expect(cancelled.rate_version_id).toBe(VERSION);
    expect(cancelled.reason).toBe('Scheduled baseline no longer required');
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `${BASE_URL}/admin/redemption-ops/markets/${MARKET}/rates/${VERSION}/cancel`,
    );
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      reason: 'Scheduled baseline no longer required',
    });
    const headers = new Headers(init?.headers);
    expect(headers.get('idempotency-key')).toBe('idem-cancel-1');
  });

  it('propagates cancel rejections (already cancelled / cannot cancel / not found)', async () => {
    const client = redemptionOpsClient();
    mockFetch(409, { code: 'REDEMPTION_RATE_ALREADY_CANCELLED' });
    await expect(
      client.cancelRate(
        MARKET,
        VERSION,
        { reason: 'Second attempt' },
        'idem-cancel-2',
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: 'REDEMPTION_RATE_ALREADY_CANCELLED' },
    });

    mockFetch(409, { code: 'REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE' });
    await expect(
      client.cancelRate(
        MARKET,
        VERSION,
        { reason: 'Active version' },
        'idem-cancel-3',
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: 'REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE' },
    });

    mockFetch(404, { code: 'REDEMPTION_RATE_VERSION_NOT_FOUND' });
    await expect(
      client.cancelRate(
        MARKET,
        VERSION,
        { reason: 'Unknown version' },
        'idem-cancel-4',
      ),
    ).rejects.toMatchObject({
      status: 404,
      body: { code: 'REDEMPTION_RATE_VERSION_NOT_FOUND' },
    });
  });
});

describe('AdminCommissionOpsApiClient (P7-S6D commission rate configuration)', () => {
  const MARKET = '77777777-7777-4777-8777-777777777777';

  function commissionOpsClient(): AdminCommissionOpsApiClient {
    return new AdminCommissionOpsApiClient(new ApiClient(BASE_URL));
  }

  it('reads the selected-market configuration with taxonomy + definitions', async () => {
    const client = commissionOpsClient();
    const config: AdminCommissionRateListDto = {
      market_id: MARKET,
      market_code: 'MY',
      timezone: 'Asia/Kuala_Lumpur',
      currency: 'MYR',
      configured: true,
      taxonomy: [
        {
          commission_type: 'AGENT_UPGRADE',
          rate_type: 'FIXED',
          generations: [1, 2],
        },
      ],
      definitions: [
        {
          commission_type: 'AGENT_UPGRADE',
          generation: 1,
          rate_type: 'FIXED',
          current: {
            id: 'version-1',
            commission_type: 'AGENT_UPGRADE',
            generation: 1,
            rate_type: 'FIXED',
            rate_value: '388.0000000000',
            display_rate: '388',
            effective_from_utc: '2026-07-24T16:00:00.000Z',
            effective_from_local: '2026-07-25 00:00:00',
            effective_until_utc: null,
            effective_until_local: null,
            window_status: 'ACTIVE',
            reason: null,
            created_by: 'admin-1',
            created_at: '2026-07-24T00:00:00.000Z',
          },
          scheduled: [],
          history: [],
        },
      ],
    };
    const fetchSpy = mockFetch(200, config);

    const result = await client.listRates(MARKET);

    expect(result.market_code).toBe('MY');
    expect(result.taxonomy[0]?.generations).toEqual([1, 2]);
    expect(result.definitions[0]?.current?.rate_value).toBe('388.0000000000');
    expect(result.definitions[0]?.current?.display_rate).toBe('388');
    expect(result.definitions[0]?.current?.window_status).toBe('ACTIVE');
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      `${BASE_URL}/admin/commission-ops/markets/${MARKET}/rates`,
    );
  });

  it('creates a rate version with the mandatory Idempotency-Key and reason', async () => {
    const client = commissionOpsClient();
    const result: AdminCommissionRateCreateResultDto = {
      id: 'version-2',
      commission_type: 'MEMBER_CONSUMPTION',
      generation: 1,
      rate_type: 'PERCENTAGE',
      rate_value: '1.1234567890',
      display_rate: '1.123457',
      effective_date: '2026-09-01',
      effective_from_utc: '2026-08-31T16:00:00.000Z',
      effective_from_local: '2026-09-01 00:00:00',
      timezone: 'Asia/Kuala_Lumpur',
      market_id: MARKET,
      created_by: 'admin-1',
      created_at: '2026-08-30T00:00:00.000Z',
    };
    const fetchMock = mockFetch(201, result);

    const created = await client.createRate(
      MARKET,
      {
        commission_type: 'MEMBER_CONSUMPTION',
        generation: 1,
        rate_type: 'PERCENTAGE',
        rate_value: '1.1234567890',
        effective_date: '2026-09-01',
        reason: 'Q3 rate review',
      },
      'idem-commission-create',
    );

    expect(created.id).toBe('version-2');
    expect(created.rate_value).toBe('1.1234567890');
    expect(created.display_rate).toBe('1.123457');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `${BASE_URL}/admin/commission-ops/markets/${MARKET}/rates`,
    );
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('idempotency-key')).toBe('idem-commission-create');
    expect(JSON.parse(String((init as RequestInit | undefined)?.body))).toEqual(
      {
        commission_type: 'MEMBER_CONSUMPTION',
        generation: 1,
        rate_type: 'PERCENTAGE',
        rate_value: '1.1234567890',
        effective_date: '2026-09-01',
        reason: 'Q3 rate review',
      },
    );
  });

  it('passes exact decimal strings through untouched (never parsed)', async () => {
    const client = commissionOpsClient();
    const config: AdminCommissionRateListDto = {
      market_id: MARKET,
      market_code: 'MY',
      timezone: 'UTC',
      currency: 'MYR',
      configured: true,
      taxonomy: [],
      definitions: [
        {
          commission_type: 'AGENT_ACTIVATION_FEE',
          generation: 0,
          rate_type: 'FIXED',
          current: {
            id: 'version-3',
            commission_type: 'AGENT_ACTIVATION_FEE',
            generation: 0,
            rate_type: 'FIXED',
            rate_value: '0.0000010000',
            display_rate: '0.000001',
            effective_from_utc: '2026-09-01T00:00:00.000Z',
            effective_from_local: '2026-09-01 00:00:00',
            effective_until_utc: null,
            effective_until_local: null,
            window_status: 'ACTIVE',
            reason: null,
            created_by: 'admin-1',
            created_at: '2026-08-04T00:00:00.000Z',
          },
          scheduled: [],
          history: [],
        },
      ],
    };
    const fetchSpy = mockFetch(200, config);

    const result = await client.listRates(MARKET);

    // Ten-decimal exact strings survive the round trip byte-for-byte.
    expect(result.definitions[0]?.current?.rate_value).toBe('0.0000010000');
    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toContain('/admin/commission-ops/markets/');
  });

  it('propagates permission and idempotency errors from the write surface', async () => {
    const client = commissionOpsClient();
    mockFetch(403, { code: 'COMMISSION_RATE_PERMISSION_DENIED' });
    await expect(
      client.createRate(
        MARKET,
        {
          commission_type: 'AGENT_UPGRADE',
          generation: 1,
          rate_type: 'FIXED',
          rate_value: '88',
          effective_date: '2026-09-01',
          reason: 'Ops review',
        },
        'idem-conflict',
      ),
    ).rejects.toMatchObject({
      status: 403,
      body: { code: 'COMMISSION_RATE_PERMISSION_DENIED' },
    });

    mockFetch(409, { code: 'COMMISSION_RATE_IDEMPOTENCY_CONFLICT' });
    await expect(
      client.createRate(
        MARKET,
        {
          commission_type: 'AGENT_UPGRADE',
          generation: 1,
          rate_type: 'FIXED',
          rate_value: '88',
          effective_date: '2026-09-01',
          reason: 'Ops review',
        },
        'idem-conflict',
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: 'COMMISSION_RATE_IDEMPOTENCY_CONFLICT' },
    });
  });
});

describe('AdminMarketOpsApiClient (P7-S6E market configuration)', () => {
  const MARKET = '88888888-8888-4888-8888-888888888888';

  function marketOpsClient(): AdminMarketOpsApiClient {
    return new AdminMarketOpsApiClient(new ApiClient(BASE_URL));
  }

  it('reads the selected-market registry projection (market.read)', async () => {
    const client = marketOpsClient();
    const detail: AdminMarketDetailDto = {
      market_id: MARKET,
      market_code: 'MY',
      name: 'Malaysia',
      status: 'ACTIVE',
      currency_code: 'MYR',
      timezone: 'Asia/Kuala_Lumpur',
      default_locale: 'en-MY',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      configured: true,
    };
    const fetchSpy = mockFetch(200, detail);

    const result = await client.getMarket(MARKET);

    expect(result.market_code).toBe('MY');
    expect(result.currency_code).toBe('MYR');
    expect(result.configured).toBe(true);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      `${BASE_URL}/admin/market-ops/markets/${MARKET}`,
    );
  });

  it('updates the market with the mandatory Idempotency-Key and reason', async () => {
    const client = marketOpsClient();
    const result: AdminMarketUpdateResultDto = {
      id: MARKET,
      code: 'MY',
      name: 'Malaysia Renamed',
      status: 'ACTIVE',
      currencyCode: 'MYR',
      timezone: 'Asia/Kuala_Lumpur',
      defaultLocale: 'en-MY',
      updatedAt: '2026-08-06T00:00:00.000Z',
      changed: [
        { field: 'name', before: 'Malaysia', after: 'Malaysia Renamed' },
      ],
      idempotencyDigest: 'a'.repeat(64),
    };
    const fetchSpy = mockFetch(200, result);

    const updated = await client.updateMarket(
      MARKET,
      { name: 'Malaysia Renamed', reason: 'Rebranding' },
      'idem-market-update',
    );

    expect(updated.name).toBe('Malaysia Renamed');
    expect(updated.changed[0]).toEqual({
      field: 'name',
      before: 'Malaysia',
      after: 'Malaysia Renamed',
    });
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${BASE_URL}/admin/market-ops/markets/${MARKET}`);
    expect((init as RequestInit | undefined)?.method).toBe('PATCH');
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('idempotency-key')).toBe('idem-market-update');
    expect(JSON.parse(String((init as RequestInit | undefined)?.body))).toEqual(
      { name: 'Malaysia Renamed', reason: 'Rebranding' },
    );
  });

  it('passes the deactivation confirmation and status through untouched', async () => {
    const client = marketOpsClient();
    const result: AdminMarketUpdateResultDto = {
      id: MARKET,
      code: 'MY',
      name: 'Malaysia',
      status: 'INACTIVE',
      currencyCode: 'MYR',
      timezone: 'Asia/Kuala_Lumpur',
      defaultLocale: 'en-MY',
      updatedAt: '2026-08-06T00:00:00.000Z',
      changed: [{ field: 'status', before: 'ACTIVE', after: 'INACTIVE' }],
      idempotencyDigest: 'b'.repeat(64),
    };
    const fetchSpy = mockFetch(200, result);

    const updated = await client.updateMarket(
      MARKET,
      { status: 'INACTIVE', deactivationConfirmed: true, reason: 'Wind-down' },
      'idem-market-deactivate',
    );

    expect(updated.status).toBe('INACTIVE');
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${BASE_URL}/admin/market-ops/markets/${MARKET}`);
    expect(JSON.parse(String((init as RequestInit | undefined)?.body))).toEqual(
      {
        status: 'INACTIVE',
        deactivationConfirmed: true,
        reason: 'Wind-down',
      },
    );
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('idempotency-key')).toBe('idem-market-deactivate');
  });
});

describe('AdminIpointAdjustOpsApiClient (P7-S7B manual iPoint adjustment)', () => {
  const MARKET = '99999999-9999-4999-8999-999999999999';
  const REQUEST = '88888888-8888-4888-8888-888888888888';

  function ipointClient(): AdminIpointAdjustOpsApiClient {
    return new AdminIpointAdjustOpsApiClient(new ApiClient(BASE_URL));
  }

  function requestView(
    overrides: Partial<AdminIpointAdjustmentDto> = {},
  ): AdminIpointAdjustmentDto {
    return {
      id: REQUEST,
      walletAccountId: '77777777-7777-4777-8777-777777777777',
      memberId: '66666666-6666-4666-8666-666666666666',
      marketId: MARKET,
      direction: 'CREDIT',
      amount: '5000',
      state: 'DRAFT',
      reasonCode: 'OPERATIONAL_CORRECTION',
      explanation: 'Ops correction for a processing error.',
      caseReference: 'CASE-001',
      attachmentReference: null,
      makerAdminUserId: '11111111-1111-4111-8111-111111111111',
      checkerAdminUserId: null,
      submittedAt: null,
      executedAt: null,
      failedAt: null,
      priorRequestId: null,
      ledgerEntryId: null,
      version: 1,
      createdAt: '2026-08-06T00:00:00.000Z',
      updatedAt: '2026-08-06T00:00:00.000Z',
      ...overrides,
    };
  }

  it('creates an adjustment with the mandatory Idempotency-Key (maker)', async () => {
    const client = ipointClient();
    const fetchSpy = mockFetch(201, requestView());

    const created = await client.createAdjustment(
      MARKET,
      {
        walletAccountId: '77777777-7777-4777-8777-777777777777',
        direction: 'CREDIT',
        amount: '5000',
        reasonCode: 'OPERATIONAL_CORRECTION',
        explanation: 'Ops correction for a processing error.',
        caseReference: 'CASE-001',
      },
      'idem-ipoint-create-1',
    );

    expect(created.state).toBe('DRAFT');
    expect(created.amount).toBe('5000');
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `${BASE_URL}/admin/ipoint-adjust-ops/markets/${MARKET}/adjustments`,
    );
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('idempotency-key')).toBe('idem-ipoint-create-1');
    expect(JSON.parse(String((init as RequestInit | undefined)?.body))).toEqual(
      {
        walletAccountId: '77777777-7777-4777-8777-777777777777',
        direction: 'CREDIT',
        amount: '5000',
        reasonCode: 'OPERATIONAL_CORRECTION',
        explanation: 'Ops correction for a processing error.',
        caseReference: 'CASE-001',
      },
    );
  });

  it('passes the exact amount string through untouched (never parsed)', async () => {
    const client = ipointClient();
    const fetchSpy = mockFetch(201, requestView({ amount: '0.0000000001' }));

    const created = await client.createAdjustment(
      MARKET,
      {
        walletAccountId: '77777777-7777-4777-8777-777777777777',
        direction: 'DEBIT',
        amount: '0.0000000001',
        reasonCode: 'EXACT_OPPOSITE_COMPENSATION',
        explanation: 'Tiny exact-opposite correction.',
        caseReference: 'CASE-002',
      },
      'idem-ipoint-create-2',
    );

    expect(created.amount).toBe('0.0000000001');
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toContain('/admin/ipoint-adjust-ops/markets/');
    expect(
      JSON.parse(String((init as RequestInit | undefined)?.body)),
    ).toMatchObject({ amount: '0.0000000001' });
  });

  it('passes the step-up token for checker decide and execute (x-step-up-token)', async () => {
    const client = ipointClient();
    const decided = requestView({ state: 'APPROVED' });
    const fetchSpy = mockFetch(200, decided);

    await client.decideAdjustment(
      MARKET,
      REQUEST,
      { decision: 'APPROVED', reason: 'Evidence verified.' },
      'stepup-checker-1',
    );
    let [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `${BASE_URL}/admin/ipoint-adjust-ops/markets/${MARKET}/adjustments/${REQUEST}/decision`,
    );
    let headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('x-step-up-token')).toBe('stepup-checker-1');
    expect(JSON.parse(String((init as RequestInit | undefined)?.body))).toEqual(
      {
        decision: 'APPROVED',
        reason: 'Evidence verified.',
      },
    );

    // Execute: no body, step-up token still passed.
    mockFetch(200, requestView({ state: 'EXECUTED' }));
    await client.executeAdjustment(MARKET, REQUEST, 'stepup-execute-1');
    [url, init] = fetchSpy.mock.calls[1] ?? [];
    expect(String(url)).toBe(
      `${BASE_URL}/admin/ipoint-adjust-ops/markets/${MARKET}/adjustments/${REQUEST}/execute`,
    );
    headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('x-step-up-token')).toBe('stepup-execute-1');
    expect((init as RequestInit | undefined)?.body).toBeUndefined();
  });

  it('lists the Finance queue with state filter and reads the detail', async () => {
    const client = ipointClient();
    const queue: AdminIpointAdjustmentQueueDto = {
      marketId: MARKET,
      items: [requestView({ state: 'SUBMITTED' })],
      limit: 50,
      offset: 0,
    };
    const fetchSpy = mockFetch(200, queue);

    const list = await client.listAdjustments(MARKET, { state: 'SUBMITTED' });

    expect(list.items[0]?.state).toBe('SUBMITTED');
    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `${BASE_URL}/admin/ipoint-adjust-ops/markets/${MARKET}/adjustments?state=SUBMITTED`,
    );

    const detail: AdminIpointAdjustmentDetailDto = {
      request: requestView({ state: 'REJECTED' }),
      decisions: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          adjustmentRequestId: REQUEST,
          marketId: MARKET,
          checkerAdminUserId: '22222222-2222-4222-8222-222222222222',
          decision: 'REJECTED',
          reason: 'Missing supporting evidence.',
          decidedAt: '2026-08-06T01:00:00.000Z',
        },
      ],
    };
    mockFetch(200, detail);
    const got = await client.getAdjustment(MARKET, REQUEST);
    expect(got.request.state).toBe('REJECTED');
    expect(got.decisions[0]?.decision).toBe('REJECTED');
  });

  it('propagates maker/checker conflict (403) and idempotency conflict (409) with owner codes', async () => {
    const client = ipointClient();
    mockFetch(403, { code: 'WALLET_ADJUSTMENT_MAKER_CHECKER_CONFLICT' });
    await expect(
      client.decideAdjustment(
        MARKET,
        REQUEST,
        { decision: 'APPROVED', reason: 'Self approval must fail.' },
        'stepup-self',
      ),
    ).rejects.toMatchObject({
      status: 403,
      body: { code: 'WALLET_ADJUSTMENT_MAKER_CHECKER_CONFLICT' },
    });

    mockFetch(409, { code: 'WALLET_ADJUSTMENT_IDEMPOTENCY_CONFLICT' });
    await expect(
      client.createAdjustment(
        MARKET,
        {
          walletAccountId: '77777777-7777-4777-8777-777777777777',
          direction: 'CREDIT',
          amount: '5000',
          reasonCode: 'OPERATIONAL_CORRECTION',
          explanation: 'Same key, different payload.',
          caseReference: 'CASE-003',
        },
        'idem-conflict-1',
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: 'WALLET_ADJUSTMENT_IDEMPOTENCY_CONFLICT' },
    });
  });
});
