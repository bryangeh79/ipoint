/**
 * @ipoint/api-client — In-memory token API client with single-flight refresh.
 *
 * Design decisions:
 * - All tokens are held in-memory ONLY (never localStorage/sessionStorage).
 * - On page load / app init, call `attemptSessionRestore()` which issues a
 *   refresh request using the stored refresh token. If no refresh token is
 *   available (e.g. page reload), the server returns 401 and the user is
 *   unauthenticated.
 * - 401 interceptor triggers a single-flight token refresh, retrying the
 *   original request exactly once after a successful refresh.
 * - Refresh failures clear the in-memory session and must redirect to login.
 * - No infinite retry loops – exactly one retry per 401.
 *
 * Auth contract (backend):
 * - POST /auth/login -> body: { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt }
 * - POST /auth/refresh -> expects body: { refresh_token: string }
 * - POST /auth/logout -> requires Bearer Authorization header, returns 204
 */

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  accessExpiresAt: string;
  refreshExpiresAt?: string;
}

export interface ApiErrorBody {
  code?: string;
  message?: string | string[];
  errors?: unknown;
  requestId?: string;
  details?: Readonly<Record<string, unknown>>;
}

interface ApiErrorEnvelope {
  error?: ApiErrorBody;
  requestId?: string;
}

export class ApiError extends Error {
  public readonly requestId?: string;

  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    const message = Array.isArray(body.message)
      ? body.message.join(' ')
      : body.message;
    super(message ?? `Request failed with status ${status}.`);
    this.name = 'ApiError';
    this.requestId = body.requestId;
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isMarketAccessError(): boolean {
    return (
      this.status === 403 &&
      /market/i.test(`${this.body.code ?? ''} ${this.message}`)
    );
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Backward-compatible request options used by admin-web and merchant-web. */
export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  /** HTTP method (defaults to GET) */
  method?: string;
  /** Request body */
  body?: unknown;
  /** Market ID header */
  marketId?: string;
  /** Idempotency key for safe retries */
  idempotencyKey?: string;
  /** Skip auth header */
  anonymous?: boolean;
  /** Whether to retry after refresh (default true) */
  retryAfterRefresh?: boolean;
}

export interface RequestOptions {
  /** AbortSignal for cancellation / timeout */
  signal?: AbortSignal;
  /** Skip sending auth header (for login, register, password-reset etc.) */
  skipAuth?: boolean;
  /** Timeout in milliseconds (creates internal AbortSignal) */
  timeoutMs?: number;
  /** Market ID header */
  marketId?: string;
  /** Idempotency key for safe retries */
  idempotencyKey?: string;
  /** Additional headers */
  headers?: Record<string, string>;
}

export interface UploadOptions extends Omit<RequestOptions, 'skipAuth'> {
  /** Optional filename override */
  filename?: string;
}

export interface ApiResponse<T> {
  data: T;
  /** Echoed back from the server for tracing */
  requestId?: string;
}

/**
 * Session-change event detail.
 * Dispatched on `window` so that non-React code can react to auth changes.
 */
export interface SessionEventDetail {
  type: 'session-restored' | 'session-expired' | 'session-cleared';
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

const SESSION_RESTORED_EVENT = 'ipoint:session-restored';
const SESSION_EXPIRED_EVENT = 'ipoint:session-expired';

function dispatchSessionEvent(type: SessionEventDetail['type']): void {
  window.dispatchEvent(
    new CustomEvent<SessionEventDetail>(
      type === 'session-restored'
        ? SESSION_RESTORED_EVENT
        : SESSION_EXPIRED_EVENT,
      { detail: { type } },
    ),
  );
}

function createTimeoutSignal(ms: number): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('Timeout', 'TimeoutError')),
    ms,
  );
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function mergeSignals(...signals: (AbortSignal | undefined)[]): {
  signal: AbortSignal;
  clear: () => void;
} {
  const filtered = signals.filter(Boolean) as AbortSignal[];
  if (filtered.length === 0) {
    return { signal: new AbortController().signal, clear: () => {} };
  }
  if (filtered.length === 1) {
    return { signal: filtered[0] as AbortSignal, clear: () => {} };
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const sig of filtered) {
    if (sig.aborted) {
      controller.abort(sig.reason);
      return { signal: controller.signal, clear: () => {} };
    }
    sig.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    clear: () => {
      for (const sig of filtered) {
        sig.removeEventListener('abort', onAbort);
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Utility: describe API errors for UI consumption                   */
/* ------------------------------------------------------------------ */

export function describeApiError(error: unknown): {
  title: string;
  detail: string;
  kind:
    | 'offline'
    | 'forbidden'
    | 'market'
    | 'expired'
    | 'validation'
    | 'suspended'
    | 'conflict'
    | 'stale'
    | 'blocked'
    | 'error';
} {
  if (!(error instanceof ApiError)) {
    return { title: 'Unexpected error', detail: String(error), kind: 'error' };
  }
  if (error.status === 0) {
    return { title: 'You are offline', detail: error.message, kind: 'offline' };
  }
  const code = error.body.code;
  if (
    code &&
    [
      'SESSION_IDLE_EXPIRED',
      'SESSION_ABSOLUTE_EXPIRED',
      'SESSION_FAMILY_EXPIRED',
      'SESSION_REUSE_DETECTED',
      'SESSION_REVOKED',
      'ADMIN_AUTHENTICATION_REQUIRED',
    ].includes(code)
  ) {
    return { title: 'Session expired', detail: error.message, kind: 'expired' };
  }
  if (code === 'ADMIN_ACCOUNT_SUSPENDED') {
    return {
      title: 'Admin access suspended',
      detail: error.message,
      kind: 'suspended',
    };
  }
  if (
    code &&
    [
      'MARKET_ACCESS_DENIED',
      'MARKET_SELECTION_REQUIRED',
      'MARKET_CONTEXT_MISMATCH',
      'RESOURCE_MARKET_MISMATCH',
      'MARKET_INACTIVE',
    ].includes(code)
  ) {
    return {
      title:
        code === 'MARKET_CONTEXT_MISMATCH'
          ? 'Market context changed'
          : 'Market access denied',
      detail: error.message,
      kind: 'market',
    };
  }
  if (code === 'CAPABILITY_UNAVAILABLE' || code === 'FEATURE_DEFERRED') {
    return {
      title: 'Capability unavailable',
      detail: error.message,
      kind: 'blocked',
    };
  }
  if (code === 'DASHBOARD_DATA_STALE') {
    return { title: 'Data is stale', detail: error.message, kind: 'stale' };
  }
  if (
    error.status === 409 ||
    code?.endsWith('_CONFLICT') ||
    code === 'CONCURRENCY_STALE_VERSION'
  ) {
    return {
      title: 'Server state changed',
      detail: error.message,
      kind: 'conflict',
    };
  }
  if (error.status === 401) {
    return {
      title: 'Sign in required',
      detail: error.message,
      kind: 'expired',
    };
  }
  if (error.status === 403 || code === 'PERMISSION_DENIED') {
    return {
      title: 'Permission denied',
      detail: error.message,
      kind: 'forbidden',
    };
  }
  if (error.status === 400 || error.status === 422) {
    return {
      title: 'Check the highlighted information',
      detail: error.message,
      kind: 'validation',
    };
  }
  return {
    title: error.body.code ?? 'Request failed',
    detail: error.message,
    kind: 'error',
  };
}

export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

/* ------------------------------------------------------------------ */
/*  ApiClient                                                         */
/* ------------------------------------------------------------------ */

export class ApiClient {
  /** In-memory token storage – NEVER persisted to storage. */
  private _accessToken: string | null = null;

  /** In-memory refresh token – NEVER persisted to storage. */
  private _refreshToken: string | null = null;

  /** Single-flight refresh lock. */
  private refreshPromise: Promise<boolean> | null = null;

  /** Callback invoked when the session is cleared (e.g. refresh failure). */
  public onSessionExpired: ((code?: string) => void) | null = null;

  constructor(
    private readonly baseUrl: string,
    /** @deprecated Optional storage key — only kept for backward compatibility */
    _storageKey?: string,
  ) {
    void _storageKey;
  }

  /* ---- token management ---- */

  get isAuthenticated(): boolean {
    return this._accessToken !== null;
  }

  /** Backward-compatible tokens accessor for admin-web and merchant-web. */
  get tokens(): AuthTokens | undefined {
    if (!this._accessToken) return undefined;
    return {
      accessToken: this._accessToken,
      refreshToken: this._refreshToken ?? undefined,
      accessExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      refreshExpiresAt: new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    };
  }

  /** Backward-compatible public request method used by admin-web and merchant-web. */
  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const method = (options.method ?? 'GET').toUpperCase() as HttpMethod;
    const response = await this.executeRequest<T>(
      method,
      path,
      options.body,
      {
        headers: options.headers as Record<string, string>,
        marketId: options.marketId,
        idempotencyKey: options.idempotencyKey,
        skipAuth: options.anonymous,
      },
      new AbortController().signal,
    );
    return response.data;
  }

  setTokens(tokens: AuthTokens): void {
    this._accessToken = tokens.accessToken;
    this._refreshToken = tokens.refreshToken ?? null;
  }

  clearSession(code?: string): void {
    this._accessToken = null;
    this._refreshToken = null;
    this.refreshPromise = null;
    dispatchSessionEvent('session-cleared');
    this.onSessionExpired?.(code);
  }

  /**
   * Attempt to restore a session on app load by calling the refresh endpoint.
   * The refresh token is sent in the request body. On page load there is no
   * in-memory refresh token, so the server returns 401 and the session is
   * cleared (user must log in again).
   * Returns `true` if the session was restored.
   */
  async attemptSessionRestore(): Promise<boolean> {
    try {
      const tokens = await this.refreshRequest();
      this.setTokens(tokens);
      dispatchSessionEvent('session-restored');
      return true;
    } catch {
      this.clearSession();
      return false;
    }
  }

  /* ---- typed HTTP methods ---- */

  async get<T>(
    path: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    return this._request<T>('GET', path, undefined, options);
  }

  async post<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    return this._request<T>('POST', path, body, options);
  }

  async upload<T>(
    path: string,
    formData: FormData,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    return this._request<T>('POST', path, formData, {
      ...options,
      headers: { ...options?.headers },
    });
  }

  async put<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    return this._request<T>('PUT', path, body, options);
  }

  async patch<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    return this._request<T>('PATCH', path, body, options);
  }

  async delete<T>(
    path: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    return this._request<T>('DELETE', path, undefined, options);
  }

  /* ---- login (convenience) ---- */

  async login(email: string, password: string): Promise<AuthTokens> {
    const response = await this._request<AuthTokens>(
      'POST',
      '/auth/login',
      { email, password },
      { skipAuth: true },
    );
    this.setTokens(response.data);
    dispatchSessionEvent('session-restored');
    return response.data;
  }

  /* ---- core request method ---- */

  private async _request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    const { signal: timeoutSignal, clear: clearTimeout } = options?.timeoutMs
      ? createTimeoutSignal(options.timeoutMs)
      : { signal: undefined, clear: () => {} };

    const { signal: mergedSignal, clear: clearMerge } = mergeSignals(
      timeoutSignal,
      options?.signal,
    );

    try {
      return await this.executeRequest<T>(
        method,
        path,
        body,
        options,
        mergedSignal,
      );
    } finally {
      clearTimeout();
      clearMerge();
    }
  }

  private async executeRequest<T>(
    method: HttpMethod,
    path: string,
    body: unknown,
    options: RequestOptions | undefined,
    signal: AbortSignal,
  ): Promise<ApiResponse<T>> {
    const headers = new Headers(options?.headers);
    headers.set('accept', 'application/json');

    const isFormData = body instanceof FormData;
    if (!isFormData && body !== undefined) {
      headers.set('content-type', 'application/json');
    }
    if (options?.marketId) {
      headers.set('x-market-id', options.marketId);
    }
    if (options?.idempotencyKey) {
      headers.set('idempotency-key', options.idempotencyKey);
    }

    // Attach auth header unless skipAuth
    if (!options?.skipAuth && this._accessToken) {
      headers.set('authorization', `Bearer ${this._accessToken}`);
    }

    const fetchInit: RequestInit = {
      method,
      headers,
      signal,
    };

    if (body !== undefined) {
      fetchInit.body = isFormData ? body : JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, fetchInit);
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError(0, {
          code: 'REQUEST_TIMEOUT',
          message: 'Request timed out.',
        });
      }
      throw new ApiError(0, {
        code: 'NETWORK_OFFLINE',
        message:
          error instanceof Error ? error.message : 'Network request failed.',
      });
    }

    // ---- 401 handling with single-flight refresh ----
    if (response.status === 401 && !options?.skipAuth) {
      const originalError = await toApiError(response.clone());
      if (isTerminalAdminSessionCode(originalError.body.code)) {
        this.clearSession(originalError.body.code);
        throw originalError;
      }
      const refreshed = await this.singleFlightRefresh();
      if (refreshed) {
        // Retry the original request exactly once with the new token
        const retryHeaders = new Headers(options?.headers);
        retryHeaders.set('accept', 'application/json');
        if (!isFormData && body !== undefined) {
          retryHeaders.set('content-type', 'application/json');
        }
        if (options?.marketId) {
          retryHeaders.set('x-market-id', options.marketId);
        }
        if (options?.idempotencyKey) {
          retryHeaders.set('idempotency-key', options.idempotencyKey);
        }
        retryHeaders.set('authorization', `Bearer ${this._accessToken}`);

        const retryInit: RequestInit = {
          method,
          headers: retryHeaders,
          signal,
        };
        if (body !== undefined) {
          retryInit.body = isFormData ? body : JSON.stringify(body);
        }

        try {
          response = await fetch(`${this.baseUrl}${path}`, retryInit);
        } catch (error: unknown) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            throw new ApiError(0, {
              code: 'REQUEST_TIMEOUT',
              message: 'Request timed out.',
            });
          }
          throw new ApiError(0, {
            code: 'NETWORK_OFFLINE',
            message:
              error instanceof Error
                ? error.message
                : 'Network request failed.',
          });
        }
      } else {
        // Refresh failed — session is gone
        throw new ApiError(401, {
          code: 'SESSION_EXPIRED',
          message: 'Your session has expired. Please log in again.',
        });
      }
    }

    if (!response.ok) {
      throw await toApiError(response);
    }

    // Parse response body
    const contentType = response.headers.get('content-type') ?? '';
    let data: T;
    if (response.status === 204 || response.status === 205) {
      data = undefined as T;
    } else if (contentType.includes('application/json')) {
      data = (await response.json()) as T;
    } else {
      data = (await response.text()) as T;
    }

    const requestId = response.headers.get('x-request-id') ?? undefined;

    return {
      data,
      requestId,
    };
  }

  /* ---- single-flight token refresh ---- */

  private singleFlightRefresh(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.doRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<boolean> {
    if (!this._accessToken) {
      this.clearSession();
      return false;
    }
    try {
      const tokens = await this.refreshRequest();
      this.setTokens(tokens);
      return true;
    } catch {
      this.clearSession();
      return false;
    }
  }

  /**
   * Call the refresh endpoint. Sends the refresh token in the request body
   * as required by the actual backend contract.
   */
  private async refreshRequest(): Promise<AuthTokens> {
    const response = await fetch(`${this.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ refresh_token: this._refreshToken }),
    });

    if (!response.ok) {
      // Refresh failure means session is gone
      this.clearSession();
      throw await toApiError(response);
    }

    const data = (await response.json()) as AuthTokens;
    return data;
  }
}

/* ------------------------------------------------------------------ */
/*  Response -> ApiError converter                                     */
/* ------------------------------------------------------------------ */

async function toApiError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody = {};
  try {
    const payload = (await response.json()) as ApiErrorBody & ApiErrorEnvelope;
    body = payload.error
      ? { ...payload.error, requestId: payload.requestId }
      : payload;
  } catch {
    body = { message: response.statusText };
  }
  return new ApiError(response.status, body);
}

/* ------------------------------------------------------------------ */
/*  Phase 7 Admin Operations typed client                              */
/* ------------------------------------------------------------------ */

export interface AdminPasswordRequest {
  email: string;
  password: string;
}

export interface AdminLoginChallengeDto {
  code: 'MFA_REQUIRED';
  mfa_challenge_id: string;
  expires_at: string;
}

export interface AdminMfaEnrollmentStartDto {
  enrollment_challenge_id: string;
  otpauth_uri: string;
  expires_at: string;
}

export interface AdminMfaEnrollmentConfirmationDto {
  recovery_codes: string[];
}

export interface AdminMfaCodeRequest {
  challenge_id: string;
  code: string;
}

export interface AdminMfaRecoveryRequest {
  challenge_id: string;
  recovery_code: string;
}

export interface AdminStepUpStartRequest {
  action_class: string;
  market_id?: string;
  target?: string;
}

export interface AdminStepUpChallengeDto {
  step_up_challenge_id: string;
  expires_at: string;
}

export interface AdminStepUpVerificationDto {
  step_up_token: string;
  expires_at: string;
}

export interface AdminMfaResetRequest {
  target_admin_user_id: string;
  confirming_admin_user_id: string;
  reason: string;
  case_reference: string;
  step_up_token: string;
}

export interface AdminMfaResetResultDto {
  revokedSessions: number;
}

export interface AdminActorDto {
  id: string;
  accountId: string;
  displayName: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}

export interface AdminRoleDto {
  id: string;
  code: string;
  name: string;
}

export interface AdminMarketDto {
  id: string;
  code: string;
  name: string;
  currencyCode: string;
  timezone: string;
  locale: string;
  grantedAt: string;
  isSelected: boolean;
}

export interface AdminBootstrapDto {
  actor: AdminActorDto;
  roles: AdminRoleDto[];
  effectivePermissions: string[];
  accessibleMarkets: AdminMarketDto[];
  currentMarket: AdminMarketDto | null;
  contextVersion: number;
  availability: {
    operationalWorkspace: 'AVAILABLE' | 'MARKET_SELECTION_UNAVAILABLE';
  };
  asOf: string;
}

export interface AdminMarketListDto {
  items: AdminMarketDto[];
  currentMarketId: string | null;
  contextVersion: number;
  asOf: string;
}

export interface SelectCurrentAdminMarketRequest {
  market_id: string;
  expected_context_version: number;
}

export interface CurrentAdminMarketDto {
  marketId: string;
  contextVersion: number;
  selectedAt: string | null;
}

export interface AdminSessionDto {
  id: string;
  deviceLabel: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastActivityAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  familyMaxExpiresAt: string;
  current: boolean;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface AdminSessionPageDto {
  sessions: AdminSessionDto[];
}

export interface CurrentAdminSessionDto {
  valid: true;
  session_id: string;
  admin_user_id: string;
  mfa_recovery_used: boolean;
}

export interface AdminSessionRevocationSummaryDto {
  revokedCount: number;
}

/* ------------------------------------------------------------------ */
/*  P7-S4A Admin Dashboard read-model DTOs                            */
/* ------------------------------------------------------------------ */

/** Server-owned metric ids; the client never invents new ones. */
export type AdminDashboardMetricId =
  | 'M01'
  | 'M02'
  | 'M03'
  | 'M04'
  | 'M05'
  | 'M06'
  | 'M07'
  | 'M08'
  | 'M09'
  | 'M10'
  | 'M11'
  | 'M12'
  | 'M13'
  | 'M14';

export type AdminDashboardFreshnessState = 'FRESH' | 'STALE' | 'UNAVAILABLE';

export type AdminDashboardUnavailableReason =
  | 'NO_DURABLE_SOURCE'
  | 'SOURCE_QUERY_FAILED'
  | 'SOURCE_PERMISSION_DENIED';

export type AdminDashboardFreshnessClass = 'QUEUE' | 'KPI';

export interface AdminDashboardJobRunSnapshot {
  jobType: string;
  localBusinessDate: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedAt: string | null;
  completedAt: string | null;
  totalEntitlements: number;
  processedCount: number;
  failedCount: number;
}

export type AdminDashboardMetricValue =
  | { kind: 'COUNT'; count: number }
  | { kind: 'BREAKDOWN'; breakdown: Record<string, number> }
  | { kind: 'QUEUE_SUMMARY'; counts: Record<string, number> }
  | {
      kind: 'JOB_STATUS';
      latestRun: AdminDashboardJobRunSnapshot | null;
      statusCounts: Record<string, number>;
    }
  | {
      kind: 'CURRENCY_TOTALS';
      totals: Array<{
        currency: string;
        count: number;
        totalAmount: string;
      }>;
    }
  | { kind: 'BALANCE'; currency: string; totalAvailableBalance: string };

export interface AdminDashboardMetricState {
  id: AdminDashboardMetricId;
  name: string;
  definition: string;
  definitionVersion: number;
  freshnessClass: AdminDashboardFreshnessClass;
  currencyDimension: boolean;
  permission: string;
  source: string;
  state: AdminDashboardFreshnessState;
  unavailableReason?: AdminDashboardUnavailableReason;
  /** Source-query time of this metric (not the cache-read time). */
  asOf: string;
  value?: AdminDashboardMetricValue;
}

/** GET /admin/dashboard/metrics — selected-market catalog with state. */
export interface AdminDashboardCatalogDto {
  asOf: string;
  marketId: string;
  items: AdminDashboardMetricState[];
}

export interface AdminDashboardDrillDownReference {
  metricId: AdminDashboardMetricId;
  marketId: string;
  marketScope: 'SELECTED';
  permission: string;
  /** Masked drill-down is required for sensitive/financial metrics. */
  masking: boolean;
  metricFilter: string | null;
  timeBoundary: { from: string | null; to: string | null } | null;
}

/** GET /admin/dashboard/metrics/:metricId — single metric with drill-down. */
export interface AdminDashboardMetricDetailDto {
  id: AdminDashboardMetricId;
  name: string;
  definition: string;
  definitionVersion: number;
  freshnessClass: AdminDashboardFreshnessClass;
  currencyDimension: boolean;
  permission: string;
  source: string;
  state: AdminDashboardFreshnessState;
  unavailableReason?: AdminDashboardUnavailableReason;
  asOf: string;
  marketId: string;
  value?: AdminDashboardMetricValue;
  drillDown: AdminDashboardDrillDownReference;
}

/**
 * Exact typed surface consumed by Admin Web. Paths and DTO field names mirror
 * the accepted P7-S2 controllers; no shape probing or message parsing occurs.
 */
export class AdminApiClient {
  constructor(private readonly client: ApiClient) {}

  get isAuthenticated(): boolean {
    return this.client.isAuthenticated;
  }

  get tokens(): AuthTokens | undefined {
    return this.client.tokens;
  }

  set onSessionExpired(callback: ((code?: string) => void) | null) {
    this.client.onSessionExpired = callback;
  }

  clearSession(code?: string): void {
    this.client.clearSession(code);
  }

  async beginLogin(
    input: AdminPasswordRequest,
  ): Promise<AdminLoginChallengeDto> {
    return (
      await this.client.post<AdminLoginChallengeDto>(
        '/auth/admin/login',
        input,
        {
          skipAuth: true,
        },
      )
    ).data;
  }

  async startMfaEnrollment(
    input: AdminPasswordRequest,
  ): Promise<AdminMfaEnrollmentStartDto> {
    return (
      await this.client.post<AdminMfaEnrollmentStartDto>(
        '/auth/admin/mfa/enrollment/start',
        input,
        { skipAuth: true },
      )
    ).data;
  }

  async confirmMfaEnrollment(
    input: AdminMfaCodeRequest,
  ): Promise<AdminMfaEnrollmentConfirmationDto> {
    return (
      await this.client.post<AdminMfaEnrollmentConfirmationDto>(
        '/auth/admin/mfa/enrollment/confirm',
        input,
        { skipAuth: true },
      )
    ).data;
  }

  async completeMfaChallenge(input: AdminMfaCodeRequest): Promise<AuthTokens> {
    const tokens = (
      await this.client.post<AuthTokens>('/auth/admin/mfa/challenge', input, {
        skipAuth: true,
      })
    ).data;
    this.client.setTokens(tokens);
    dispatchSessionEvent('session-restored');
    return tokens;
  }

  async recoverWithMfa(input: AdminMfaRecoveryRequest): Promise<AuthTokens> {
    const tokens = (
      await this.client.post<AuthTokens>('/auth/admin/mfa/recovery', input, {
        skipAuth: true,
      })
    ).data;
    this.client.setTokens(tokens);
    dispatchSessionEvent('session-restored');
    return tokens;
  }

  async beginStepUp(
    input: AdminStepUpStartRequest,
  ): Promise<AdminStepUpChallengeDto> {
    return (
      await this.client.post<AdminStepUpChallengeDto>(
        '/auth/admin/mfa/step-up/challenge',
        input,
      )
    ).data;
  }

  async verifyStepUp(
    input: AdminMfaCodeRequest,
  ): Promise<AdminStepUpVerificationDto> {
    return (
      await this.client.post<AdminStepUpVerificationDto>(
        '/auth/admin/mfa/step-up/verify',
        input,
      )
    ).data;
  }

  async resetMfa(input: AdminMfaResetRequest): Promise<AdminMfaResetResultDto> {
    return (
      await this.client.post<AdminMfaResetResultDto>(
        '/auth/admin/mfa/reset',
        input,
      )
    ).data;
  }

  async bootstrap(): Promise<AdminBootstrapDto> {
    return (await this.client.get<AdminBootstrapDto>('/admin/bootstrap')).data;
  }

  async markets(): Promise<AdminMarketListDto> {
    return (await this.client.get<AdminMarketListDto>('/admin/me/markets'))
      .data;
  }

  async selectCurrentMarket(
    input: SelectCurrentAdminMarketRequest,
  ): Promise<CurrentAdminMarketDto> {
    return (
      await this.client.put<CurrentAdminMarketDto>(
        '/admin/me/current-market',
        input,
      )
    ).data;
  }

  async sessions(): Promise<AdminSessionPageDto> {
    return (await this.client.get<AdminSessionPageDto>('/admin/sessions')).data;
  }

  async currentSession(): Promise<CurrentAdminSessionDto> {
    return (
      await this.client.get<CurrentAdminSessionDto>('/admin/sessions/current')
    ).data;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.client.delete<void>(
      `/admin/sessions/${encodeURIComponent(sessionId)}`,
    );
  }

  async revokeAllSessions(): Promise<AdminSessionRevocationSummaryDto> {
    return (
      await this.client.delete<AdminSessionRevocationSummaryDto>(
        '/admin/sessions',
      )
    ).data;
  }

  /* ---- P7-S4A dashboard read models ---- */

  /**
   * Selected-market dashboard metric catalog with per-metric state.
   * The market comes from the server-selected Current Admin Market; no
   * client-supplied market id is sent (a mismatch returns 409).
   */
  async dashboardMetrics(): Promise<AdminDashboardCatalogDto> {
    return (
      await this.client.get<AdminDashboardCatalogDto>(
        '/admin/dashboard/metrics',
      )
    ).data;
  }

  /** One selected-market dashboard metric with its drill-down reference. */
  async dashboardMetricDetail(
    metricId: string,
  ): Promise<AdminDashboardMetricDetailDto> {
    return (
      await this.client.get<AdminDashboardMetricDetailDto>(
        `/admin/dashboard/metrics/${encodeURIComponent(metricId)}`,
      )
    ).data;
  }

  /* ---- P7-S5A selected-market Member Operations ---- */

  /**
   * Selected-market member list. The market is the server-selected Current
   * Admin Market; no market id is ever sent by the client (a mismatch or a
   * client market query parameter is rejected server-side).
   */
  async memberOpsList(
    query: AdminMemberOpsListQuery = {},
  ): Promise<AdminMemberOpsListPageDto> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      params.set(key, String(value));
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return (
      await this.client.get<AdminMemberOpsListPageDto>(
        `/admin/member-ops/members${suffix}`,
      )
    ).data;
  }

  /** Masked selected-market member detail (audit-of-view on the server). */
  async memberOpsDetail(
    publicMemberId: string,
  ): Promise<AdminMemberOpsProfileDto> {
    return (
      await this.client.get<AdminMemberOpsProfileDto>(
        `/admin/member-ops/members/${encodeURIComponent(publicMemberId)}`,
      )
    ).data;
  }

  async memberOpsSuspend(
    publicMemberId: string,
    input: AdminMemberOpsReasonRequest,
  ): Promise<AdminMemberOpsProfileDto> {
    return (
      await this.client.post<AdminMemberOpsProfileDto>(
        `/admin/member-ops/members/${encodeURIComponent(publicMemberId)}/suspend`,
        input,
      )
    ).data;
  }

  async memberOpsReactivate(
    publicMemberId: string,
    input: AdminMemberOpsReasonRequest,
  ): Promise<AdminMemberOpsProfileDto> {
    return (
      await this.client.post<AdminMemberOpsProfileDto>(
        `/admin/member-ops/members/${encodeURIComponent(publicMemberId)}/reactivate`,
        input,
      )
    ).data;
  }

  async memberOpsClose(
    publicMemberId: string,
    input: AdminMemberOpsCloseRequest,
  ): Promise<AdminMemberOpsProfileDto> {
    return (
      await this.client.post<AdminMemberOpsProfileDto>(
        `/admin/member-ops/members/${encodeURIComponent(publicMemberId)}/close`,
        input,
      )
    ).data;
  }

  async memberOpsRevokeSessions(
    publicMemberId: string,
    input: AdminMemberOpsReasonRequest,
  ): Promise<AdminMemberOpsProfileDto> {
    return (
      await this.client.post<AdminMemberOpsProfileDto>(
        `/admin/member-ops/members/${encodeURIComponent(publicMemberId)}/revoke-sessions`,
        input,
      )
    ).data;
  }

  async memberOpsRequireReverification(
    publicMemberId: string,
    input: AdminMemberOpsReasonRequest,
  ): Promise<AdminMemberOpsProfileDto> {
    return (
      await this.client.post<AdminMemberOpsProfileDto>(
        `/admin/member-ops/members/${encodeURIComponent(publicMemberId)}/require-reverification`,
        input,
      )
    ).data;
  }

  async memberOpsAddNote(
    publicMemberId: string,
    input: AdminMemberOpsNoteCreateRequest,
  ): Promise<AdminMemberOpsProfileDto> {
    return (
      await this.client.post<AdminMemberOpsProfileDto>(
        `/admin/member-ops/members/${encodeURIComponent(publicMemberId)}/notes`,
        input,
      )
    ).data;
  }

  /** Masked member notes list, paged, newest first. */
  async memberOpsNotes(
    publicMemberId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<AdminMemberOpsNotesPageDto> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      params.set(key, String(value));
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return (
      await this.client.get<AdminMemberOpsNotesPageDto>(
        `/admin/member-ops/members/${encodeURIComponent(publicMemberId)}/notes${suffix}`,
      )
    ).data;
  }
}

function isTerminalAdminSessionCode(code: string | undefined): boolean {
  return Boolean(
    code &&
    [
      'SESSION_IDLE_EXPIRED',
      'SESSION_ABSOLUTE_EXPIRED',
      'SESSION_FAMILY_EXPIRED',
      'SESSION_REUSE_DETECTED',
      'SESSION_REVOKED',
    ].includes(code),
  );
}

/* ------------------------------------------------------------------ */
/*  P7-S5A Admin Member Operations DTOs (append-only section)          */
/*  Selected-market surface over the frozen Phase 2 Admin Member       */
/*  owner commands. Field names mirror the accepted owner contracts.   */
/*  No wallet, ledger, or balance fields exist on this surface.        */
/* ------------------------------------------------------------------ */

export type AdminMemberOpsStatus =
  | 'PENDING_EMAIL_VERIFICATION'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'CLOSED';

export type AdminMemberOpsKycLevel = 'NONE' | 'LEVEL_1' | 'LEVEL_2';

export type AdminMemberOpsKycStatus =
  | 'NOT_STARTED'
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'MORE_INFO_REQUIRED'
  | 'REVERIFICATION_REQUIRED';

export type AdminMemberOpsSort =
  | 'createdAt:desc'
  | 'createdAt:asc'
  | 'publicMemberId:asc'
  | 'publicMemberId:desc';

/** Query shape for the selected-market member list. No market field exists. */
export interface AdminMemberOpsListQuery {
  page?: number;
  pageSize?: number;
  query?: string;
  status?: AdminMemberOpsStatus;
  accountCountry?: string;
  kycLevel?: AdminMemberOpsKycLevel;
  kycStatus?: AdminMemberOpsKycStatus;
  createdAfter?: string;
  createdBefore?: string;
  sort?: AdminMemberOpsSort;
}

/** Masked list row (email masked server-side). */
export interface AdminMemberOpsListItemDto {
  publicMemberId: string;
  displayName: string | null;
  email: string;
  status: AdminMemberOpsStatus;
  kycLevel: AdminMemberOpsKycLevel;
  accountCountry: string;
  currentMarketId: string;
  createdAt: string;
}

/** GET /admin/member-ops/members — selected-market paged list. */
export interface AdminMemberOpsListPageDto {
  marketId: string;
  members: AdminMemberOpsListItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminMemberOpsNoteDto {
  id: string;
  adminUserId: string;
  marketId: string;
  content: string;
  isInternal: boolean;
  createdAt: string;
}

export interface AdminMemberOpsStatusHistoryEntryDto {
  id: string;
  fromStatus: AdminMemberOpsStatus | null;
  toStatus: AdminMemberOpsStatus;
  actorType: string;
  actorId: string | null;
  reason: string | null;
  occurredAt: string;
}

/**
 * Masked selected-market member detail. All sensitive fields are masked by
 * the owner service; wallet/ledger/balance is never present.
 */
export interface AdminMemberOpsProfileDto {
  publicMemberId: string;
  displayName: string | null;
  email: string;
  status: AdminMemberOpsStatus;
  kycLevel: AdminMemberOpsKycLevel;
  accountCountry: string;
  currentMarketId: string;
  createdAt: string;
  closedAt: string | null;
  profile: {
    fullName: string | null;
    phone: string | null;
    phoneVerificationStatus: string;
    birthDate: string | null;
    address: Record<string, unknown> | null;
    locale: string | null;
    language: string | null;
  };
  kyc: {
    caseId: string;
    marketId: string;
    status: AdminMemberOpsKycStatus;
    levelRequested: string;
    legalFullName: string | null;
    identificationType: string | null;
    identificationNumber: string | null;
    submittedAt: string | null;
    reviewedAt: string | null;
    reverificationRequiredAt: string | null;
  } | null;
  marketPreferences: Array<{
    marketId: string;
    marketCode: string;
    isEnabled: boolean;
    isCurrent: boolean;
    sortOrder: number;
    lastSelectedAt: string | null;
  }>;
  notes: AdminMemberOpsNoteDto[];
  statusHistory: AdminMemberOpsStatusHistoryEntryDto[];
}

/** GET /admin/member-ops/members/:id/notes — masked notes, newest first. */
export interface AdminMemberOpsNotesPageDto {
  notes: AdminMemberOpsNoteDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** Shared body for reason-backed owner commands (suspend/reactivate/…). */
export interface AdminMemberOpsReasonRequest {
  reason: string;
  idempotencyKey: string;
}

/** Close requires the exact literal confirmation the owner schema demands. */
export interface AdminMemberOpsCloseRequest extends AdminMemberOpsReasonRequest {
  confirmationText: 'CONFIRM';
}

/** Create-note body (isInternal defaults false on the server). */
export interface AdminMemberOpsNoteCreateRequest {
  content: string;
  isInternal: boolean;
  idempotencyKey: string;
}

/*  P7-S5B selected-market Admin Merchant Operations                   */
/*                                                                     */
/*  Append-only section (do not move or merge). DTOs mirror the        */
/*  accepted Phase 1 owner endpoints and the Phase 7 branch-detail     */
/*  adapter (`apps/api/src/admin-merchant-ops`). The market in every   */
/*  URL path is validated server-side against the server-owned Current */
/*  Admin Market by the canonical RbacGuard (mismatch returns 409      */
/*  MARKET_CONTEXT_MISMATCH); the client never invents a market.       */
/*  Approved status actions require an Idempotency-Key header and are  */
/*  passed through untouched (owner semantics).                        */
/* ------------------------------------------------------------------ */

export type AdminMerchantApplicationQueueStatus =
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'RESUBMISSION_REQUIRED'
  | 'APPROVED'
  | 'REJECTED';

export interface AdminMerchantApplicationQueueQuery {
  status?: AdminMerchantApplicationQueueStatus;
  limit?: number;
  offset?: number;
}

export interface AdminMerchantApplicationQueueItemDto {
  application_id: string;
  branch_id: string;
  merchant_id: string;
  display_name: string;
  application_status: string;
  operational_status: string;
  updated_at: string;
}

export type AdminMerchantApplicationQueueDto =
  AdminMerchantApplicationQueueItemDto[];

export type AdminMerchantListStatus =
  | 'PENDING_APPLICATION'
  | 'PENDING_KYC'
  | 'PENDING_MCP'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'CLOSURE_PENDING'
  | 'CLOSED';

export interface AdminMerchantListQuery {
  query?: string;
  status?: AdminMerchantListStatus;
  limit?: number;
  offset?: number;
}

export interface AdminMerchantListItemDto {
  branch_id: string;
  merchant_id: string;
  name: string;
  status: string;
  market_id: string;
  created_at: string;
  application_status: string | null;
  kyc_status: string | null;
  mcp_account_id: string | null;
  available_balance: string | null;
}

export interface AdminMerchantListDto {
  items: AdminMerchantListItemDto[];
  limit: number;
  offset: number;
}

export type AdminMerchantReviewDecision =
  | 'APPROVED'
  | 'REJECTED'
  | 'RESUBMISSION_REQUIRED';

export interface AdminMerchantApplicationReviewInput {
  decision: AdminMerchantReviewDecision;
  reason: string;
}

export interface AdminMerchantApplicationReviewResultDto {
  application_id: string;
  branch_id: string;
  application_status: string;
  operational_status: string;
}

export interface AdminMerchantKycReviewDetailDto {
  submission_id: string;
  submission_version: number;
  status: string;
  submitted_at: string;
  data: Record<string, unknown>;
  review: {
    review_id: string;
    reviewer_id: string;
    decision: string;
    reason: string;
    rejected_fields: string[];
    reviewed_at: string;
  } | null;
  branch_id: string;
  merchant_id: string;
  market_id: string;
  previous: Record<string, unknown> | null;
}

export interface AdminMerchantKycReviewInput {
  decision: AdminMerchantReviewDecision;
  reason: string;
  rejected_fields?: string[];
}

export interface AdminMerchantKycReviewResultDto {
  review_id: string;
  submission_id: string;
  branch_id: string;
  kyc_status: string;
  operational_status: string;
  reason: string;
  rejected_fields: string[];
  reviewed_at: string;
}

export interface AdminMerchantStatusActionInput {
  reason: string;
}

export interface AdminMerchantStatusActionResultDto {
  branch_id: string;
  operational_status: string;
}

export interface AdminMerchantMcpAccountDto {
  id: string;
  branch_id: string;
  market_id: string;
  available_balance: string;
  total_balance: string;
  status: string;
  version: number;
}

export interface AdminMerchantMcpReconciliationDto {
  account_id: string;
  stored: { total: string; available: string };
  computed: { total: string; available: string; entries: number };
  matches: boolean;
}

export interface AdminMerchantMcpLedgerEntryDto {
  id: string;
  sequence: string;
  entryType: string;
  direction: string;
  amount: string;
  balanceDelta: string;
  availableDelta: string;
  sourceType: string;
  sourceId: string | null;
  reason: string | null;
  effectiveAt: string;
  createdAt: string;
  [key: string]: unknown;
}

export interface AdminMerchantMcpLedgerPageDto {
  items: AdminMerchantMcpLedgerEntryDto[];
  limit: number;
  offset: number;
}

export interface AdminMerchantLedgerQuery {
  limit?: number;
  offset?: number;
}

export interface AdminMerchantMcpSummaryDto {
  account: AdminMerchantMcpAccountDto;
  reconciliation: AdminMerchantMcpReconciliationDto | null;
  recent_ledger: AdminMerchantMcpLedgerPageDto | null;
}

export interface AdminMerchantPackageHistoryItemDto {
  assignment_id: string;
  service_fee_profile_id: string | null;
  service_fee_profile_code: string | null;
  service_fee_profile_name: string | null;
  service_fee_version_id: string | null;
  rate: string | null;
  effective_from: string | null;
  effective_to: string | null;
  special_percentage_id: string | null;
  special_percentage_rate: string | null;
  special_percentage_description: string | null;
  status: string;
  is_default: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AdminMerchantPackageHistoryDto {
  items: AdminMerchantPackageHistoryItemDto[];
  limit: number;
  offset: number;
}

export interface AdminMerchantBranchDetailDto {
  branch_id: string;
  merchant_id: string;
  market_id: string;
  profile: {
    branch_id: string;
    merchant_id: string;
    market_id: string;
    display_name: string;
    primary_email: string;
    phone: string | null;
    address: string | null;
    about: string | null;
    business_hours: string | null;
    website: string | null;
    whatsapp: string | null;
    socials: Record<string, unknown> | null;
    logo_object_key: string | null;
    banner_object_key: string | null;
    gallery: Array<{ id: string; object_key: string; position: number }>;
  };
  application: {
    application_id: string;
    status: string;
    operational_status: string;
    submissions: Array<{
      id: string;
      version: number;
      submitted_at: string;
    }>;
    reviews: Array<{
      id: string;
      decision: string;
      reason: string;
      decided_at: string;
    }>;
  };
  kyc: {
    current: Record<string, unknown> | null;
    previous: Record<string, unknown> | null;
  };
  packages: AdminMerchantPackageHistoryDto;
  mcp: AdminMerchantMcpSummaryDto | null;
}

/**
 * P7-S5B selected-market Admin Merchant Operations client.
 *
 * Self-contained addition to the Admin client surface: queues, list,
 * branch detail, approved status actions (owner commands), and bounded MCP
 * summaries. Actions send the Idempotency-Key header the owner commands
 * require; all responses are typed against the owner/adapter contracts.
 */
export class AdminMerchantApiClient {
  constructor(private readonly client: ApiClient) {}

  /** Owner queue: merchant applications pending review (selected market). */
  async merchantApplications(
    marketId: string,
    query: AdminMerchantApplicationQueueQuery = {},
  ): Promise<AdminMerchantApplicationQueueDto> {
    const search = new URLSearchParams();
    if (query.status) search.set('status', query.status);
    if (query.limit !== undefined) search.set('limit', String(query.limit));
    if (query.offset !== undefined) search.set('offset', String(query.offset));
    const suffix = search.size > 0 ? `?${search.toString()}` : '';
    return (
      await this.client.get<AdminMerchantApplicationQueueDto>(
        `/admin/markets/${encodeURIComponent(marketId)}/merchants/applications${suffix}`,
      )
    ).data;
  }

  /** Owner list: selected-market merchants (deterministic offset paging). */
  async merchantList(
    marketId: string,
    query: AdminMerchantListQuery = {},
  ): Promise<AdminMerchantListDto> {
    const search = new URLSearchParams();
    if (query.query) search.set('query', query.query);
    if (query.status) search.set('status', query.status);
    if (query.limit !== undefined) search.set('limit', String(query.limit));
    if (query.offset !== undefined) search.set('offset', String(query.offset));
    const suffix = search.size > 0 ? `?${search.toString()}` : '';
    return (
      await this.client.get<AdminMerchantListDto>(
        `/admin/markets/${encodeURIComponent(marketId)}/merchants${suffix}`,
      )
    ).data;
  }

  /**
   * Phase 7 branch-detail adapter read: profile, application, owner-masked
   * KYC, package history (read-only), and MCP summary.
   */
  async merchantBranchDetail(
    marketId: string,
    branchId: string,
  ): Promise<AdminMerchantBranchDetailDto> {
    return (
      await this.client.get<AdminMerchantBranchDetailDto>(
        `/admin/markets/${encodeURIComponent(marketId)}/merchants/${encodeURIComponent(branchId)}/detail`,
      )
    ).data;
  }

  /** Owner command: decide a merchant application (Idempotency-Key). */
  async reviewMerchantApplication(
    marketId: string,
    branchId: string,
    input: AdminMerchantApplicationReviewInput,
    idempotencyKey: string,
  ): Promise<AdminMerchantApplicationReviewResultDto> {
    return (
      await this.client.post<AdminMerchantApplicationReviewResultDto>(
        `/admin/markets/${encodeURIComponent(marketId)}/merchants/${encodeURIComponent(branchId)}/application/review`,
        input,
        { idempotencyKey },
      )
    ).data;
  }

  /** Owner surface: KYC review detail (audits MERCHANT_KYC_REVIEW_STARTED). */
  async merchantKycReviewDetail(
    marketId: string,
    branchId: string,
  ): Promise<AdminMerchantKycReviewDetailDto> {
    return (
      await this.client.get<AdminMerchantKycReviewDetailDto>(
        `/admin/markets/${encodeURIComponent(marketId)}/merchants/${encodeURIComponent(branchId)}/kyc/review`,
      )
    ).data;
  }

  /** Owner command: decide a merchant KYC review (Idempotency-Key). */
  async reviewMerchantKyc(
    marketId: string,
    branchId: string,
    input: AdminMerchantKycReviewInput,
    idempotencyKey: string,
  ): Promise<AdminMerchantKycReviewResultDto> {
    return (
      await this.client.post<AdminMerchantKycReviewResultDto>(
        `/admin/markets/${encodeURIComponent(marketId)}/merchants/${encodeURIComponent(branchId)}/kyc/review`,
        input,
        { idempotencyKey },
      )
    ).data;
  }

  /** Owner command: suspend (preserves MCP; Idempotency-Key). */
  async suspendMerchant(
    marketId: string,
    branchId: string,
    input: AdminMerchantStatusActionInput,
    idempotencyKey: string,
  ): Promise<AdminMerchantStatusActionResultDto> {
    return (
      await this.client.post<AdminMerchantStatusActionResultDto>(
        `/admin/markets/${encodeURIComponent(marketId)}/merchants/${encodeURIComponent(branchId)}/suspend`,
        input,
        { idempotencyKey },
      )
    ).data;
  }

  /** Owner command: reactivate a suspended merchant (Idempotency-Key). */
  async reactivateMerchant(
    marketId: string,
    branchId: string,
    input: AdminMerchantStatusActionInput,
    idempotencyKey: string,
  ): Promise<AdminMerchantStatusActionResultDto> {
    return (
      await this.client.post<AdminMerchantStatusActionResultDto>(
        `/admin/markets/${encodeURIComponent(marketId)}/merchants/${encodeURIComponent(branchId)}/reactivate`,
        input,
        { idempotencyKey },
      )
    ).data;
  }

  /** Owner command: close a merchant (Idempotency-Key). */
  async closeMerchant(
    marketId: string,
    branchId: string,
    input: AdminMerchantStatusActionInput,
    idempotencyKey: string,
  ): Promise<AdminMerchantStatusActionResultDto> {
    return (
      await this.client.post<AdminMerchantStatusActionResultDto>(
        `/admin/markets/${encodeURIComponent(marketId)}/merchants/${encodeURIComponent(branchId)}/close`,
        input,
        { idempotencyKey },
      )
    ).data;
  }

  /** Owner read: selected-market MCP account summary. */
  async merchantMcpAccount(
    marketId: string,
    accountId: string,
  ): Promise<AdminMerchantMcpAccountDto> {
    return (
      await this.client.get<AdminMerchantMcpAccountDto>(
        `/admin/markets/${encodeURIComponent(marketId)}/mcp/accounts/${encodeURIComponent(accountId)}`,
      )
    ).data;
  }

  /** Owner read: MCP reconciliation summary (stored vs computed). */
  async merchantMcpReconcile(
    marketId: string,
    accountId: string,
  ): Promise<AdminMerchantMcpReconciliationDto> {
    return (
      await this.client.get<AdminMerchantMcpReconciliationDto>(
        `/admin/markets/${encodeURIComponent(marketId)}/mcp/accounts/${encodeURIComponent(accountId)}/reconcile`,
      )
    ).data;
  }

  /** Owner read: bounded MCP ledger page (no raw export). */
  async merchantMcpLedger(
    marketId: string,
    accountId: string,
    query: AdminMerchantLedgerQuery = {},
  ): Promise<AdminMerchantMcpLedgerPageDto> {
    const search = new URLSearchParams();
    if (query.limit !== undefined) search.set('limit', String(query.limit));
    if (query.offset !== undefined) search.set('offset', String(query.offset));
    const suffix = search.size > 0 ? `?${search.toString()}` : '';
    return (
      await this.client.get<AdminMerchantMcpLedgerPageDto>(
        `/admin/markets/${encodeURIComponent(marketId)}/mcp/accounts/${encodeURIComponent(accountId)}/ledger${suffix}`,
      )
    ).data;
  }
}

/* ------------------------------------------------------------------ */
/*  P7-S5C Admin KYC Operations typed client (append-only section)     */
/* ------------------------------------------------------------------ */

export type AdminKycOpsStatus =
  | 'NOT_STARTED'
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'MORE_INFO_REQUIRED'
  | 'REVERIFICATION_REQUIRED';

export interface AdminKycOpsListQuery {
  status?: AdminKycOpsStatus;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminKycOpsMemberSummaryDto {
  publicMemberId: string;
  displayName: string | null;
  email: string;
  accountCountry: string;
  status: string;
  kycLevel: string;
}

export interface AdminKycOpsCaseListItemDto {
  id: string;
  marketId: string;
  status: AdminKycOpsStatus;
  levelRequested: string;
  member: AdminKycOpsMemberSummaryDto;
  submittedAt: string | null;
  reviewedAt: string | null;
  updatedAt: string;
}

export interface AdminKycOpsListPageDto {
  items: AdminKycOpsCaseListItemDto[];
  page: number;
  pageSize: number;
  total: number;
  /** Server-owned Current Admin Market the queue was bounded to. */
  marketId: string;
}

export interface AdminKycOpsDocumentDto {
  id: string;
  documentType: string;
  mimeType: string;
  size: number;
  checksum: string;
  scanStatus: string;
  createdAt: string;
}

export interface AdminKycOpsHistoryEntryDto {
  id: string;
  eventType: string;
  actorType: string;
  actorId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface AdminKycOpsEvidenceAccessDto {
  /** True when the response is the masked summary (evidence not revealed). */
  masked: boolean;
  /** Raw document content is never served on this surface. */
  rawDocumentContent: false;
  /** Every sensitive evidence view is audited server-side. */
  audited: boolean;
}

export interface AdminKycOpsCaseDetailDto extends AdminKycOpsCaseListItemDto {
  version: number;
  legalFullName: string | null;
  identificationType: string | null;
  identificationNumber: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  residentialAddress: Record<string, unknown> | null;
  accountCountrySnapshot: string | null;
  submissionMarketId: string | null;
  consentVersion: string | null;
  reviewedByAdminUserId: string | null;
  decisionReason: string | null;
  reverificationRequiredAt: string | null;
  createdAt: string;
  documents: AdminKycOpsDocumentDto[];
  history: AdminKycOpsHistoryEntryDto[];
  evidenceAccess: AdminKycOpsEvidenceAccessDto;
}

export interface AdminKycOpsEvidenceRequest {
  /** Recorded sensitive-access reason (server requires 8..500 chars). */
  reason: string;
  /** Fresh step-up grant token from /auth/admin/mfa/step-up/verify. */
  stepUpToken?: string;
}

export type AdminKycOpsActionId =
  | 'start-review'
  | 'request-more-info'
  | 'approve'
  | 'reject'
  | 'require-reverification';

export interface AdminKycOpsActionRequest {
  reason: string;
}

export type AdminKycOpsMerchantQueueStatus =
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'RESUBMISSION_REQUIRED';

export interface AdminKycOpsMerchantQueueQuery {
  status?: AdminKycOpsMerchantQueueStatus;
  limit?: number;
  offset?: number;
}

export interface AdminKycOpsMerchantQueueItemDto {
  submission_id: string;
  branch_id: string;
  merchant_id: string;
  display_name: string;
  status: string;
  submission_version: number;
  submitted_at: string | null;
  reviewed_at: string | null;
}

export interface AdminKycOpsMerchantQueueDto {
  items: AdminKycOpsMerchantQueueItemDto[];
  /** Server-owned Current Admin Market the queue was bounded to. */
  marketId: string;
  limit: number;
  offset: number;
}

export interface AdminKycOpsMerchantReviewInfoDto {
  review_id: string;
  reviewer_id: string;
  decision: string;
  reason: string;
  rejected_fields: string[];
  reviewed_at: string | null;
}

export interface AdminKycOpsMerchantSubmissionDetailDto {
  submission_id: string;
  submission_version: number;
  status: string;
  submitted_at: string | null;
  /** Masked (masked summary) or full (evidence) owner snapshot. */
  data: Record<string, unknown>;
  review: AdminKycOpsMerchantReviewInfoDto | null;
}

export interface AdminKycOpsMerchantDetailDto {
  branch_id: string;
  merchant_id: string;
  market_id: string;
  display_name: string;
  current: AdminKycOpsMerchantSubmissionDetailDto;
  previous: AdminKycOpsMerchantSubmissionDetailDto | null;
  evidenceAccess: AdminKycOpsEvidenceAccessDto;
}

export type AdminKycOpsMerchantReviewDecision =
  | 'APPROVED'
  | 'REJECTED'
  | 'RESUBMISSION_REQUIRED';

export interface AdminKycOpsMerchantReviewInput {
  decision: AdminKycOpsMerchantReviewDecision;
  reason: string;
  rejected_fields?: string[];
}

export interface AdminKycOpsMerchantReviewResultDto {
  review_id: string;
  submission_id: string;
  branch_id: string;
  kyc_status: string;
  operational_status: string;
  reason: string;
  rejected_fields: string[];
  reviewed_at: string | null;
}

/**
 * P7-S5C Admin KYC Operations client.
 *
 * Selected-market KYC review surface: member KYC queues/detail/actions and
 * merchant KYC queues/detail/review plus the §6.4 evidence endpoints. No
 * market id is ever sent by the client — the adapter derives the market
 * exclusively from the server-owned Current Admin Market. Evidence requests
 * carry the recorded sensitive-access reason and a fresh step-up token as
 * headers; raw document content is never requested or returned.
 */
export class AdminKycOpsApiClient {
  constructor(private readonly client: ApiClient) {}

  /** Selected-market member KYC queue (masked summaries). */
  async memberKycList(
    query: AdminKycOpsListQuery = {},
  ): Promise<AdminKycOpsListPageDto> {
    const search = new URLSearchParams();
    if (query.status) search.set('status', query.status);
    if (query.dateFrom) search.set('dateFrom', query.dateFrom);
    if (query.dateTo) search.set('dateTo', query.dateTo);
    if (query.page !== undefined) search.set('page', String(query.page));
    if (query.pageSize !== undefined)
      search.set('pageSize', String(query.pageSize));
    const suffix = search.size > 0 ? `?${search.toString()}` : '';
    return (
      await this.client.get<AdminKycOpsListPageDto>(
        `/admin/kyc-ops/members${suffix}`,
      )
    ).data;
  }

  /** Member KYC case detail — masked identity/contact summary. */
  async memberKycDetail(caseId: string): Promise<AdminKycOpsCaseDetailDto> {
    return (
      await this.client.get<AdminKycOpsCaseDetailDto>(
        `/admin/kyc-ops/members/${encodeURIComponent(caseId)}`,
      )
    ).data;
  }

  /**
   * Sensitive member KYC evidence. Requires the dedicated permission; the
   * server records the reason and step-up grant and audits every view.
   */
  async memberKycEvidence(
    caseId: string,
    input: AdminKycOpsEvidenceRequest,
  ): Promise<AdminKycOpsCaseDetailDto> {
    const headers: Record<string, string> = {
      'x-sensitive-access-reason': input.reason,
    };
    if (input.stepUpToken) headers['x-step-up-token'] = input.stepUpToken;
    return (
      await this.client.get<AdminKycOpsCaseDetailDto>(
        `/admin/kyc-ops/members/${encodeURIComponent(caseId)}/evidence`,
        { headers },
      )
    ).data;
  }

  /** Member KYC review action via the frozen owner command. */
  async memberKycAction(
    caseId: string,
    action: AdminKycOpsActionId,
    input: AdminKycOpsActionRequest,
    idempotencyKey: string,
  ): Promise<AdminKycOpsCaseDetailDto> {
    return (
      await this.client.post<AdminKycOpsCaseDetailDto>(
        `/admin/kyc-ops/members/${encodeURIComponent(caseId)}/${action}`,
        input,
        { idempotencyKey },
      )
    ).data;
  }

  /** Selected-market merchant KYC submissions queue (masked). */
  async merchantKycList(
    query: AdminKycOpsMerchantQueueQuery = {},
  ): Promise<AdminKycOpsMerchantQueueDto> {
    const search = new URLSearchParams();
    if (query.status) search.set('status', query.status);
    if (query.limit !== undefined) search.set('limit', String(query.limit));
    if (query.offset !== undefined) search.set('offset', String(query.offset));
    const suffix = search.size > 0 ? `?${search.toString()}` : '';
    return (
      await this.client.get<AdminKycOpsMerchantQueueDto>(
        `/admin/kyc-ops/merchants${suffix}`,
      )
    ).data;
  }

  /** Merchant KYC submission detail — masked summary. */
  async merchantKycDetail(
    branchId: string,
  ): Promise<AdminKycOpsMerchantDetailDto> {
    return (
      await this.client.get<AdminKycOpsMerchantDetailDto>(
        `/admin/kyc-ops/merchants/${encodeURIComponent(branchId)}`,
      )
    ).data;
  }

  /**
   * Sensitive merchant KYC evidence. Requires the dedicated permission; the
   * server records the reason and step-up grant and audits every view.
   */
  async merchantKycEvidence(
    branchId: string,
    input: AdminKycOpsEvidenceRequest,
  ): Promise<AdminKycOpsMerchantDetailDto> {
    const headers: Record<string, string> = {
      'x-sensitive-access-reason': input.reason,
    };
    if (input.stepUpToken) headers['x-step-up-token'] = input.stepUpToken;
    return (
      await this.client.get<AdminKycOpsMerchantDetailDto>(
        `/admin/kyc-ops/merchants/${encodeURIComponent(branchId)}/evidence`,
        { headers },
      )
    ).data;
  }

  /** Merchant KYC review decision via the frozen owner command. */
  async merchantKycReview(
    branchId: string,
    input: AdminKycOpsMerchantReviewInput,
    idempotencyKey: string,
  ): Promise<AdminKycOpsMerchantReviewResultDto> {
    return (
      await this.client.post<AdminKycOpsMerchantReviewResultDto>(
        `/admin/kyc-ops/merchants/${encodeURIComponent(branchId)}/review`,
        input,
        { idempotencyKey },
      )
    ).data;
  }
}
