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

/* ------------------------------------------------------------------ */
/*  P7-S6A selected-market Admin Package Operations                    */
/*                                                                     */
/*  Append-only section (do not move or merge). DTOs mirror the        */
/*  Phase 7 adapter (`apps/api/src/admin-package-ops`, read-only       */
/*  projections over the frozen Phase 1 package owner rows) and the    */
/*  frozen Phase 1 owner write commands (package version create/       */
/*  activate and per-merchant assignment/set-default).                 */
/*                                                                     */
/*  The market in every URL path is validated server-side against the  */
/*  server-owned Current Admin Market by the canonical RbacGuard       */
/*  (mismatch returns 409 MARKET_CONTEXT_MISMATCH); the client never   */
/*  invents a market. Rates are exact decimal strings (numeric(12,6))  */
/*  and are never parsed client-side. Writes require an                */
/*  Idempotency-Key and are passed through untouched (owner            */
/*  semantics). Special-percentage creation is intentionally NOT       */
/*  exposed here (owner gap: the frozen command cannot record the      */
/*  mandatory §7.3 reason).                                            */
/* ------------------------------------------------------------------ */

export interface AdminPackageVersionDto {
  id: string;
  profile_id: string;
  /** Exact decimal string (numeric(12,6)), e.g. "2.500000" — never a float. */
  rate: string;
  status: 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  effective_from: string;
  effective_to: string | null;
  created_at: string;
}

export interface AdminPackageProfileDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  versions: AdminPackageVersionDto[];
}

export interface AdminPackageCatalogDto {
  marketId: string;
  items: AdminPackageProfileDto[];
}

export interface AdminSpecialPercentageDto {
  id: string;
  /** Exact decimal string (numeric(12,6)), e.g. "12.500000" — never a float. */
  rate: string;
  description: string | null;
  created_by_admin_user_id: string;
  created_at: string;
}

export interface AdminSpecialPercentageListDto {
  marketId: string;
  items: AdminSpecialPercentageDto[];
}

/**
 * Create input for a special percentage (D-051 secured owner command).
 * The server enforces the exact-decimal rate (numeric(12,6), (0, 100]),
 * the mandatory description and the mandatory 1..500-char reason.
 */
export interface AdminSpecialPercentageCreateInput {
  /** Exact decimal string (numeric(12,6)), e.g. "12.500000". */
  rate: string;
  description: string;
  /** Mandatory operator reason (frozen contract §7.3, D-051). */
  reason: string;
}

/** Create result (owner-resolved values, S6A surface field style). */
export interface AdminSpecialPercentageCreateResultDto {
  id: string;
  /** Exact decimal string (numeric(12,6)) — the owner-normalized value. */
  rate: string;
  description: string | null;
  reason: string;
  marketId: string;
  market: string;
  created_by: string;
  created_at: string;
}

/** Owner command input: create a draft version of a standard package. */
export interface AdminPackageVersionCreateInput {
  rate: string;
  effective_from: string;
  effective_to?: string;
}

/** Owner command input: explicitly assign a package source to one branch. */
export interface AdminPackageAssignmentInput {
  service_fee_version_id?: string;
  special_percentage_id?: string;
  is_default?: boolean;
}

/**
 * P7-S6A Admin Package Operations client.
 *
 * Read surfaces: selected-market package catalog and the privileged
 * (Super Admin, step-up, audited) special-percentage list. Write
 * surfaces: typed pass-throughs of the frozen Phase 1 owner commands used
 * for configuration and explicit per-merchant reassignment — never a
 * direct table write and never a duplicate of owner logic. The
 * special-percentage create delegates to the D-051-secured owner command
 * (mandatory Idempotency-Key + reason, step-up required).
 */
export class AdminPackageOpsApiClient {
  constructor(private readonly client: ApiClient) {}

  /** Selected-market standard package catalog (profiles + versions). */
  async packageCatalog(marketId: string): Promise<AdminPackageCatalogDto> {
    return (
      await this.client.get<AdminPackageCatalogDto>(
        `/admin/package-ops/markets/${encodeURIComponent(marketId)}/packages`,
      )
    ).data;
  }

  /**
   * Privileged selected-market special-percentage list. Requires the
   * SUPER_ADMIN-only permission and a fresh step-up grant token; every
   * view is audited server-side.
   */
  async specialPercentages(
    marketId: string,
    stepUpToken?: string,
  ): Promise<AdminSpecialPercentageListDto> {
    const headers: Record<string, string> = {};
    if (stepUpToken) headers['x-step-up-token'] = stepUpToken;
    return (
      await this.client.get<AdminSpecialPercentageListDto>(
        `/admin/package-ops/markets/${encodeURIComponent(marketId)}/special-percentages`,
        { headers },
      )
    ).data;
  }

  /**
   * Create a special percentage (Super Admin only, D-051 secured owner
   * command). The Idempotency-Key is mandatory and passed through
   * untouched: same key + same payload replays the original result; same
   * key + different payload returns 409. Requires a fresh step-up grant
   * token (x-step-up-token); the server enforces the mandatory reason.
   */
  async createSpecialPercentage(
    marketId: string,
    input: AdminSpecialPercentageCreateInput,
    idempotencyKey: string,
    stepUpToken?: string,
  ): Promise<AdminSpecialPercentageCreateResultDto> {
    const headers: Record<string, string> = {};
    if (stepUpToken) headers['x-step-up-token'] = stepUpToken;
    return (
      await this.client.post<AdminSpecialPercentageCreateResultDto>(
        `/admin/package-ops/markets/${encodeURIComponent(marketId)}/special-percentages`,
        input,
        { idempotencyKey, headers },
      )
    ).data;
  }

  /** Owner command: create a DRAFT version of a standard package. */
  async createPackageVersion(
    marketId: string,
    packageId: string,
    input: AdminPackageVersionCreateInput,
    idempotencyKey: string,
  ): Promise<AdminPackageVersionDto> {
    return (
      await this.client.post<AdminPackageVersionDto>(
        `/admin/markets/${encodeURIComponent(marketId)}/packages/${encodeURIComponent(packageId)}/versions`,
        input,
        { idempotencyKey },
      )
    ).data;
  }

  /** Owner command: activate (or schedule) a package version. */
  async activatePackageVersion(
    marketId: string,
    packageId: string,
    versionId: string,
    idempotencyKey: string,
  ): Promise<AdminPackageVersionDto> {
    return (
      await this.client.patch<AdminPackageVersionDto>(
        `/admin/markets/${encodeURIComponent(marketId)}/packages/${encodeURIComponent(packageId)}/versions/${encodeURIComponent(versionId)}/activate`,
        undefined,
        { idempotencyKey },
      )
    ).data;
  }

  /** Owner command: explicitly assign a package source to one merchant branch. */
  async assignMerchantPackage(
    marketId: string,
    branchId: string,
    input: AdminPackageAssignmentInput,
    idempotencyKey: string,
  ): Promise<{ id: string }> {
    return (
      await this.client.post<{ id: string }>(
        `/admin/markets/${encodeURIComponent(marketId)}/merchants/${encodeURIComponent(branchId)}/packages/assignments`,
        input,
        { idempotencyKey },
      )
    ).data;
  }

  /** Owner command: set the default assignment for a merchant branch. */
  async setDefaultMerchantPackage(
    marketId: string,
    branchId: string,
    assignmentId: string,
    idempotencyKey: string,
  ): Promise<{ id: string }> {
    return (
      await this.client.patch<{ id: string }>(
        `/admin/markets/${encodeURIComponent(marketId)}/merchants/${encodeURIComponent(branchId)}/packages/assignments/${encodeURIComponent(assignmentId)}/set-default`,
        undefined,
        { idempotencyKey },
      )
    ).data;
  }
}

/* ------------------------------------------------------------------ */
/*  P7-S6B selected-market Admin Reward Configuration                  */
/*                                                                     */
/*  Append-only section (do not move or merge). DTOs mirror the        */
/*  Phase 7 adapter (`apps/api/src/admin-reward-ops`, read projection  */
/*  + orchestrated create over the frozen Phase 3 reward owner) and    */
/*  the frozen contract §7.1 (decisions P7-OD-04 / P7-OD-05, D-046).  */
/*                                                                     */
/*  The market in every URL path is validated server-side against the  */
/*  server-owned Current Admin Market by the canonical RbacGuard       */
/*  (mismatch returns 409 MARKET_CONTEXT_MISMATCH); the client never   */
/*  invents a market. Rates are exact decimal strings in %/day         */
/*  (0%–0.05%/day, at most six decimals, package A–F maxima) and are   */
/*  never parsed client-side. createRule requires an Idempotency-Key   */
/*  and a mandatory reason; the same key + same payload replays the    */
/*  original result, the same key + different payload returns 409.     */
/*  Activation is only ever at a strictly future market-local 00:00    */
/*  (market-local AND resolved UTC are returned).                      */
/* ------------------------------------------------------------------ */

export interface AdminRewardPackageReferenceDto {
  code: string;
  /** Exact decimal string (%/day), e.g. "0.0125" — never a float. */
  max_rate_per_day: string;
}

export type AdminRewardWindowStatus =
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'SUPERSEDED'
  | 'EXPIRED'
  | 'ARCHIVED';

export interface AdminRewardRuleVersionDto {
  id: string;
  name: string;
  description: string | null;
  /** Exact decimal string (%/day), e.g. "0.050000" — never a float. */
  reward_rate: string;
  cap_type: string;
  cap_value: string;
  minimum_reward: string;
  /** `A`–`F` when created through this surface; null otherwise. */
  package_reference: string | null;
  /** Resolved UTC instant of the market-local 00:00 activation. */
  effective_from_utc: string;
  /** Market-local wall time of the activation (IANA market timezone). */
  effective_from_local: string;
  /** Effective window end (earlier of next version start and explicit effective_to). */
  effective_until_utc: string | null;
  effective_until_local: string | null;
  /** IANA market timezone used for the local resolutions. */
  timezone: string;
  window_status: AdminRewardWindowStatus;
  market_id: string | null;
  created_by: string;
  created_at: string;
}

export interface AdminRewardRuleListDto {
  marketId: string;
  timezone: string;
  packages: AdminRewardPackageReferenceDto[];
  rules: AdminRewardRuleVersionDto[];
}

/** Schedule input: §7.1 package reference, exact %/day rate, market-local date. */
export interface AdminRewardRuleCreateInput {
  package_reference: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  /** Exact decimal string (%/day), 0%–0.05%, at most 6 decimals. */
  rate: string;
  /** Market-local calendar date (YYYY-MM-DD) of the activation 00:00. */
  effective_date: string;
  /** Mandatory privileged-write reason (§7 / §15). */
  reason: string;
  description?: string;
}

export interface AdminRewardRuleCreateResultDto {
  id: string;
  package_reference: string;
  /** Exact decimal string (%/day). */
  reward_rate: string;
  effective_date: string;
  effective_from_utc: string;
  effective_from_local: string;
  timezone: string;
  market_id: string;
  created_by: string;
  created_at: string;
}

/**
 * P7-S6B Admin Reward Configuration client.
 *
 * Read surface: selected-market reward schedule with §7.1 package
 * references (all admin roles holding `reward.rule.read`). Write surface:
 * schedule a new rule version (SUPER_ADMIN-only `reward.rule.schedule`,
 * mandatory Idempotency-Key + reason). The server delegates the single
 * `reward_rule_versions` insert to the frozen Phase 3 owner command — this
 * client is a typed pass-through, never a direct table write.
 */
export class AdminRewardOpsApiClient {
  constructor(private readonly client: ApiClient) {}

  /** Selected-market reward schedule with package references + windows. */
  async listRules(marketId: string): Promise<AdminRewardRuleListDto> {
    return (
      await this.client.get<AdminRewardRuleListDto>(
        `/admin/reward-ops/markets/${encodeURIComponent(marketId)}/rules`,
      )
    ).data;
  }

  /**
   * Schedule a reward rule version (Super Admin only). The Idempotency-Key
   * is mandatory and passed through untouched: same key + same payload
   * replays the original result; same key + different payload returns 409.
   */
  async createRule(
    marketId: string,
    input: AdminRewardRuleCreateInput,
    idempotencyKey: string,
  ): Promise<AdminRewardRuleCreateResultDto> {
    return (
      await this.client.post<AdminRewardRuleCreateResultDto>(
        `/admin/reward-ops/markets/${encodeURIComponent(marketId)}/rules`,
        input,
        { idempotencyKey },
      )
    ).data;
  }
}

/* ------------------------------------------------------------------ */
/*  P7-S6C Admin Redemption Rate Configuration                         */
/* ------------------------------------------------------------------ */

/** One redemption rate version, projected for the selected market. */
export interface AdminRedemptionRateVersionDto {
  id: string;
  /** Canonical conversion rate type (`POINTS_PER_CURRENCY`). */
  rate_type: string;
  /** Full technical precision (up to 10 decimals) — exact string. */
  rate_value: string;
  /** Display-only value with at most 6 decimals (never stored/rounded). */
  display_rate: string;
  /** Resolved UTC instant of the market-local 00:00 activation. */
  effective_from_utc: string;
  /** Market-local wall time of the activation (IANA market timezone). */
  effective_from_local: string;
  /** Effective window end (market-local / UTC), null when open. */
  effective_until_utc: string | null;
  effective_until_local: string | null;
  /**
   * Window status of the version inside the market chain. `CANCELLED` is
   * the explicit state of a voided scheduled version (append-only
   * cancellation event, D-053 §9) — cancelled versions never become
   * effective and never close or supersede a predecessor window.
   */
  window_status:
    | 'SCHEDULED'
    | 'ACTIVE'
    | 'SUPERSEDED'
    | 'EXPIRED'
    | 'CANCELLED';
  created_by: string;
  created_at: string;
}

/** The approved §7.2 configuration bounds of the selected market. */
export interface AdminRedemptionRateConfigDto {
  /** Exact initial rate (local currency per 1 iPoint). */
  initial_rate: string;
  /** Exact minimum rate — validation bound (below → rejected). */
  minimum_rate: string;
  /** Exact maximum rate — validation bound (above → rejected). */
  maximum_rate: string;
  currency: string;
  display_unit: string;
  /** §7.2 technical precision ceiling (10). */
  technical_decimals: number;
  /** §7.2 display precision ceiling (6). */
  display_decimals: number;
}

/** Selected-market redemption rate configuration read model. */
export interface AdminRedemptionRateListDto {
  market_id: string;
  market_code: string;
  timezone: string;
  /**
   * `true` when the market has an approved rate configuration; `false`
   * means the market is blocked (no fallback to any other market).
   */
  configured: boolean;
  /** The approved bounds when `configured`; `null` when blocked. */
  config: AdminRedemptionRateConfigDto | null;
  /** All `POINTS_PER_CURRENCY` versions of the market (newest first). */
  rates: AdminRedemptionRateVersionDto[];
}

/** Create input: exact rate string, market-local date, mandatory reason. */
export interface AdminRedemptionRateCreateInput {
  /** Exact decimal string (local currency per 1 iPoint), ≤10 decimals. */
  rate_value: string;
  /** Market-local calendar date (YYYY-MM-DD) of the activation 00:00. */
  effective_date: string;
  /** Mandatory privileged-write reason (§7 / §15). */
  reason: string;
}

export interface AdminRedemptionRateCreateResultDto {
  id: string;
  rate_type: string;
  /** Full technical precision (up to 10 decimals) — exact string. */
  rate_value: string;
  /** Display-only value with at most 6 decimals. */
  display_rate: string;
  effective_date: string;
  effective_from_utc: string;
  effective_from_local: string;
  timezone: string;
  market_id: string;
  created_by: string;
  created_at: string;
}

/** Cancel input: the mandatory operator reason (D-053 §9/§11). */
export interface AdminRedemptionRateCancelInput {
  /** Mandatory privileged-write reason (1..500 chars). */
  reason: string;
}

/**
 * Cancel result: the append-only immutable cancellation event (D-053 §9).
 * The immutable rate-version row is never updated or deleted; the resolver
 * ignores cancelled versions forever.
 */
export interface AdminRedemptionRateCancelResultDto {
  /** Cancellation event id (immutable row in the cancellations table). */
  id: string;
  /** The cancelled rate-version id (its immutable row is untouched). */
  rate_version_id: string;
  market_id: string;
  /** Normalized exact rate of the cancelled version. */
  rate_value: string;
  /** Resolved UTC instant of the cancelled version's activation. */
  effective_from_utc: string;
  /** Mandatory operator reason stored on the cancellation event. */
  reason: string;
  cancelled_by: string;
  cancelled_at: string;
}

/**
 * P7-S6C Admin Redemption Rate Configuration client.
 *
 * Read surface: selected-market redemption rate configuration with the
 * approved §7.2 per-market bounds (all admin roles holding
 * `redemption.rate.read`) — a market without an approved configuration is
 * explicitly blocked (`configured: false`) and the surface never falls
 * back to Malaysia or any other market. Write surface: create a rate
 * version (SUPER_ADMIN-only `redemption.rate.manage`, mandatory
 * Idempotency-Key + reason) and cancel a scheduled, not-yet-effective
 * version (same gate; append-only immutable cancellation event, D-053
 * §9). The server delegates the single `redemption_rate_versions` insert
 * and the append-only cancellation event to the secured Phase 6 owner
 * commands — this client is a typed pass-through, never a direct table
 * write. Rates are exact decimal strings and are never parsed.
 */
export class AdminRedemptionOpsApiClient {
  constructor(private readonly client: ApiClient) {}

  /** Selected-market redemption rate configuration + versions. */
  async listRates(marketId: string): Promise<AdminRedemptionRateListDto> {
    return (
      await this.client.get<AdminRedemptionRateListDto>(
        `/admin/redemption-ops/markets/${encodeURIComponent(marketId)}/rates`,
      )
    ).data;
  }

  /**
   * Create a redemption rate version (Super Admin only). The
   * Idempotency-Key is mandatory and passed through untouched: same key +
   * same payload replays the original result; same key + different payload
   * returns 409.
   */
  async createRate(
    marketId: string,
    input: AdminRedemptionRateCreateInput,
    idempotencyKey: string,
  ): Promise<AdminRedemptionRateCreateResultDto> {
    return (
      await this.client.post<AdminRedemptionRateCreateResultDto>(
        `/admin/redemption-ops/markets/${encodeURIComponent(marketId)}/rates`,
        input,
        { idempotencyKey },
      )
    ).data;
  }

  /**
   * Cancel a scheduled, not-yet-effective redemption rate version (Super
   * Admin only). Append-only (D-053 §9): the immutable rate-version row is
   * never updated or deleted; the response is the new cancellation event.
   * The Idempotency-Key is mandatory and passed through untouched: same
   * key + same payload replays the original cancellation; same key +
   * different payload returns 409. Active/expired/historically-used
   * versions are rejected with 409 `REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE`
   * and a second cancellation with 409 `REDEMPTION_RATE_ALREADY_CANCELLED`.
   */
  async cancelRate(
    marketId: string,
    versionId: string,
    input: AdminRedemptionRateCancelInput,
    idempotencyKey: string,
  ): Promise<AdminRedemptionRateCancelResultDto> {
    return (
      await this.client.post<AdminRedemptionRateCancelResultDto>(
        `/admin/redemption-ops/markets/${encodeURIComponent(marketId)}/rates/${encodeURIComponent(versionId)}/cancel`,
        input,
        { idempotencyKey },
      )
    ).data;
  }
}

/* ------------------------------------------------------------------ */
/*  P7-S6D Admin Commission Rate Configuration                         */
/* ------------------------------------------------------------------ */

/** Window status of a commission rate version inside its market chain. */
export type AdminCommissionRateWindowStatus =
  | 'ACTIVE'
  | 'SCHEDULED'
  | 'SUPERSEDED'
  | 'EXPIRED';

/** One commission rate version, projected for the selected market. */
export interface AdminCommissionRateVersionDto {
  id: string;
  commission_type: string;
  generation: number;
  /** PERCENTAGE or FIXED (frozen commission-type contract, D-054 §6). */
  rate_type: string;
  /** Full technical precision (up to 10 decimals) — exact string. */
  rate_value: string;
  /** Display-only value with at most 6 decimals (never stored/rounded). */
  display_rate: string;
  /** Resolved UTC instant of the market-local 00:00 activation. */
  effective_from_utc: string;
  /** Market-local wall time of the activation (IANA market timezone). */
  effective_from_local: string;
  /**
   * Projected window end: the earlier of the next version's start and an
   * explicit `effective_until` (null = open window / no successor).
   */
  effective_until_utc: string | null;
  effective_until_local: string | null;
  window_status: AdminCommissionRateWindowStatus;
  /** Durable operator reason (D-054 §11); null on legacy pre-0032 rows. */
  reason: string | null;
  created_by: string;
  created_at: string;
}

/** Frozen taxonomy entry for the configuration UI (D-054 §6). */
export interface AdminCommissionTaxonomyEntryDto {
  commission_type: string;
  /** FIXED or PERCENTAGE — the frozen rate type for this commission type. */
  rate_type: string;
  /** Allowed generations for this commission type (0, 1 and/or 2). */
  generations: number[];
}

/**
 * One (commission_type, generation) definition of the selected market:
 * the current effective version, the scheduled future versions and the
 * full immutable history.
 */
export interface AdminCommissionRateDefinitionDto {
  commission_type: string;
  generation: number;
  /** Frozen rate type for this commission type. */
  rate_type: string;
  /** The version whose window covers now (owner resolution), or null. */
  current: AdminCommissionRateVersionDto | null;
  /** Strictly-future versions, soonest first. */
  scheduled: AdminCommissionRateVersionDto[];
  /** Every version of this definition, newest first. */
  history: AdminCommissionRateVersionDto[];
}

/** Selected-market commission rate configuration read model. */
export interface AdminCommissionRateListDto {
  market_id: string;
  market_code: string;
  timezone: string;
  /** Market currency — FIXED rates are denominated in it. */
  currency: string;
  /**
   * `true` when the market is present and ACTIVE (the owner only manages
   * ACTIVE markets); `false` means the market is blocked for rate
   * management (explicit state, never a fallback to another market).
   */
  configured: boolean;
  /** Frozen commission taxonomy (display/UI only — the owner enforces). */
  taxonomy: AdminCommissionTaxonomyEntryDto[];
  /** Per (commission_type, generation) configuration of the market. */
  definitions: AdminCommissionRateDefinitionDto[];
}

/** Create input: frozen taxonomy fields, exact rate, date, reason. */
export interface AdminCommissionRateCreateInput {
  /** AGENT_UPGRADE | MEMBER_CONSUMPTION | MERCHANT_RECRUITMENT | AGENT_ACTIVATION_FEE. */
  commission_type:
    | 'AGENT_UPGRADE'
    | 'MEMBER_CONSUMPTION'
    | 'MERCHANT_RECRUITMENT'
    | 'AGENT_ACTIVATION_FEE';
  /** Generation (0 | 1 | 2) — membership per type is the owner's enforcement. */
  generation: number;
  /** PERCENTAGE or FIXED — the frozen match with the type is the owner's. */
  rate_type: 'PERCENTAGE' | 'FIXED';
  /** Exact decimal string (NUMERIC(38,10) compatible), ≤10 decimals. */
  rate_value: string;
  /** Market-local calendar date (YYYY-MM-DD) of the activation 00:00. */
  effective_date: string;
  /** Mandatory privileged-write reason (1..500 chars, D-054 §11). */
  reason: string;
}

export interface AdminCommissionRateCreateResultDto {
  id: string;
  commission_type: string;
  generation: number;
  rate_type: string;
  /** Full technical precision (up to 10 decimals) — exact string. */
  rate_value: string;
  /** Display-only value with at most 6 decimals. */
  display_rate: string;
  effective_date: string;
  effective_from_utc: string;
  effective_from_local: string;
  timezone: string;
  market_id: string;
  created_by: string;
  created_at: string;
}

/**
 * P7-S6D Admin Commission Rate Configuration client.
 *
 * Read surface: selected-market commission rate configuration with the
 * frozen taxonomy, every (commission_type, generation) definition
 * (current effective version, scheduled versions, full immutable history)
 * and the projected windows in market-local time AND resolved UTC (all
 * admin roles holding `commission.rate.read`). Write surface: create a
 * rate version (SUPER_ADMIN-only `commission.rate.manage`, mandatory
 * Idempotency-Key + reason). The server delegates the single
 * `commission_rate_version` insert to the secured Phase 5 owner command
 * (`RateManagementService.createRateVersion`, D-054) — this client is a
 * typed pass-through, never a direct table write. Rates are exact decimal
 * strings and are never parsed.
 */
export class AdminCommissionOpsApiClient {
  constructor(private readonly client: ApiClient) {}

  /** Selected-market commission rate configuration + definitions. */
  async listRates(marketId: string): Promise<AdminCommissionRateListDto> {
    return (
      await this.client.get<AdminCommissionRateListDto>(
        `/admin/commission-ops/markets/${encodeURIComponent(marketId)}/rates`,
      )
    ).data;
  }

  /**
   * Create a commission rate version (Super Admin only). The
   * Idempotency-Key is mandatory and passed through untouched: same key +
   * same payload replays the original result; same key + different payload
   * returns 409.
   */
  async createRate(
    marketId: string,
    input: AdminCommissionRateCreateInput,
    idempotencyKey: string,
  ): Promise<AdminCommissionRateCreateResultDto> {
    return (
      await this.client.post<AdminCommissionRateCreateResultDto>(
        `/admin/commission-ops/markets/${encodeURIComponent(marketId)}/rates`,
        input,
        { idempotencyKey },
      )
    ).data;
  }
}

/**
 * P7-S6E Admin Market Configuration client (secured market owner).
 *
 * Read surface: the selected-market registry projection (`market.read`,
 * all Admin roles, marketScoped) — id, code, name, status, currency code,
 * IANA timezone, default locale, timestamps and the explicit blocked
 * state (`configured: false` for a market that is not ACTIVE — never a
 * fallback). Write surface: a controlled update of the selected market
 * (`market.manage`, SUPER_ADMIN only, marketScoped, step-up required,
 * mandatory Idempotency-Key + reason) — status (ACTIVE → INACTIVE with
 * explicit deactivation confirmation + dependency validation),
 * name / currencyCode / timezone / defaultLocale with format validation.
 * The server owner commits the row update + idempotency claim + privileged
 * audit in one transaction; this client is a typed pass-through, never a
 * direct table write.
 */
export interface AdminMarketDetailDto {
  market_id: string;
  market_code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  currency_code: string;
  timezone: string;
  default_locale: string;
  created_at: string;
  updated_at: string;
  /**
   * `true` when the market is present and ACTIVE; `false` means the
   * market is blocked for configuration (explicit state, no fallback).
   */
  configured: boolean;
}

/** One controlled field difference applied by the update. */
export interface AdminMarketFieldChangeDto {
  field: string;
  before: unknown;
  after: unknown;
}

/** Controlled update input (at least one controlled field + reason). */
export interface AdminMarketUpdateInput {
  status?: 'ACTIVE' | 'INACTIVE';
  name?: string;
  currencyCode?: string;
  timezone?: string;
  defaultLocale?: string;
  /** Mandatory privileged-write reason (1..500 chars). */
  reason: string;
  /** Explicit confirmation for the ACTIVE → INACTIVE transition. */
  deactivationConfirmed?: boolean;
}

/** Secured market update result (replayed verbatim on same-key replay). */
export interface AdminMarketUpdateResultDto {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  currencyCode: string;
  timezone: string;
  defaultLocale: string;
  updatedAt: string;
  changed: AdminMarketFieldChangeDto[];
  /** Canonical payload digest (sha256 hex) of the committed command. */
  idempotencyDigest: string;
}

export class AdminMarketOpsApiClient {
  constructor(private readonly client: ApiClient) {}

  /** Selected-market registry read projection (market.read). */
  async getMarket(marketId: string): Promise<AdminMarketDetailDto> {
    return (
      await this.client.get<AdminMarketDetailDto>(
        `/admin/market-ops/markets/${encodeURIComponent(marketId)}`,
      )
    ).data;
  }

  /**
   * Controlled update of the selected market (Super Admin; step-up
   * required server-side). The Idempotency-Key is mandatory and passed
   * through untouched: same key + same payload replays the original
   * result; same key + different payload returns 409.
   */
  async updateMarket(
    marketId: string,
    input: AdminMarketUpdateInput,
    idempotencyKey: string,
  ): Promise<AdminMarketUpdateResultDto> {
    return (
      await this.client.patch<AdminMarketUpdateResultDto>(
        `/admin/market-ops/markets/${encodeURIComponent(marketId)}`,
        input,
        { idempotencyKey },
      )
    ).data;
  }
}

/* ------------------------------------------------------------------ */
/*  P7-S7B Admin iPoint Adjustment Operations client                  */
/* ------------------------------------------------------------------ */

/**
 * P7-S7B Admin iPoint Adjustment Operations client (SEC-01 §6 / P7-S1
 * §17; frozen owner `WalletAdjustmentOwnerService` behind the Phase 7
 * adapter `AdminIpointAdjustOpsController`).
 *
 * Maker/Checker workflow: create (durable DRAFT) → submit (DRAFT →
 * SUBMITTED) → decide (SUBMITTED → APPROVED | REJECTED) → execute
 * (APPROVED → EXECUTING → EXECUTED | FAILED). The typed methods are
 * pass-throughs of the frozen SEC-01 owner commands — never a direct
 * table write and never a duplicate of owner logic.
 *
 * Transport contracts (SEC-01 §6.3): the server Current Admin Market is
 * enforced by the canonical RbacGuard (`marketScoped` permissions); the
 * `Idempotency-Key` header is mandatory on create (same key + same
 * payload replays the stored request; same key + different payload
 * returns 409); checker decide/execute require a fresh step-up grant via
 * the `x-step-up-token` header (catalog `stepUpRequired`).
 */

/** One iPoint adjustment request row (owner view, projected). */
export interface AdminIpointAdjustmentDto {
  id: string;
  walletAccountId: string;
  memberId: string;
  marketId: string;
  direction: 'CREDIT' | 'DEBIT';
  /** Exact decimal string (numeric(38,10)) — never parsed client-side. */
  amount: string;
  state:
    | 'DRAFT'
    | 'SUBMITTED'
    | 'APPROVED'
    | 'REJECTED'
    | 'EXECUTING'
    | 'EXECUTED'
    | 'FAILED';
  reasonCode: string;
  explanation: string;
  caseReference: string;
  /** Opaque attachment reference (never contents). */
  attachmentReference: string | null;
  makerAdminUserId: string;
  checkerAdminUserId: string | null;
  submittedAt: string | null;
  executedAt: string | null;
  failedAt: string | null;
  priorRequestId: string | null;
  ledgerEntryId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Immutable decision history row (P7-OD-11/18). */
export interface AdminIpointAdjustmentDecisionDto {
  id: string;
  adjustmentRequestId: string;
  marketId: string;
  checkerAdminUserId: string;
  decision: 'APPROVED' | 'REJECTED';
  reason: string;
  decidedAt: string;
}

/** Bounded Finance queue projection (state-filterable, paginated). */
export interface AdminIpointAdjustmentQueueDto {
  marketId: string;
  items: AdminIpointAdjustmentDto[];
  limit: number;
  offset: number;
}

/** Request detail incl. the immutable decision history. */
export interface AdminIpointAdjustmentDetailDto {
  request: AdminIpointAdjustmentDto;
  decisions: AdminIpointAdjustmentDecisionDto[];
}

/** Maker create command input (P7-OD-11 evidence contract). */
export interface AdminIpointAdjustmentCreateInput {
  walletAccountId: string;
  direction: 'CREDIT' | 'DEBIT';
  /** Exact decimal string (≤10 decimals, >0). */
  amount: string;
  reasonCode: string;
  explanation: string;
  caseReference: string;
  /** Opaque attachment reference (≤500 chars; never contents). */
  attachmentReference?: string;
  /** Replacement linkage for an immutable REJECTED request (P7-OD-18). */
  priorRequestId?: string;
}

/** Checker decision command input. */
export interface AdminIpointAdjustmentDecisionInput {
  decision: 'APPROVED' | 'REJECTED';
  /** Mandatory 1..2000 chars. */
  reason: string;
  /** Checker explicitly requires an opaque attachment reference. */
  requireAttachment?: boolean;
}

/** Maker-form support projection (market rules + reason codes). */
export interface AdminIpointAdjustmentConfigDto {
  marketId: string;
  marketCode: string;
  timezone: string;
  currency: string;
  /**
   * `true` when the market is ACTIVE and has a rules row; `false` means
   * the market is blocked for adjustments (explicit state, no fallback).
   */
  configured: boolean;
  rule: {
    marketCode: string;
    softCap: string;
    hardCap: string;
    secureEvidenceAvailable: boolean;
    isActive: boolean;
  } | null;
  reasonCodes: {
    code: string;
    label: string;
    isHighRisk: boolean;
    isActive: boolean;
  }[];
}

/** Wallet/member lookup row for the maker screen (masked). */
export interface AdminIpointWalletLookupDto {
  walletId: string;
  memberId: string;
  memberPublicId: string;
  displayName: string | null;
  marketId: string;
  /** Exact decimal string — never parsed client-side. */
  availableBalance: string;
  archived: boolean;
}

export class AdminIpointAdjustOpsApiClient {
  constructor(private readonly client: ApiClient) {}

  /**
   * Maker create (durable DRAFT). The Idempotency-Key is mandatory and
   * passed through untouched: same key + same payload replays the stored
   * request; same key + different payload returns 409.
   */
  async createAdjustment(
    marketId: string,
    input: AdminIpointAdjustmentCreateInput,
    idempotencyKey: string,
  ): Promise<AdminIpointAdjustmentDto> {
    return (
      await this.client.post<AdminIpointAdjustmentDto>(
        `/admin/ipoint-adjust-ops/markets/${encodeURIComponent(marketId)}/adjustments`,
        input,
        { idempotencyKey },
      )
    ).data;
  }

  /** Maker submit (DRAFT -> SUBMITTED). */
  async submitAdjustment(
    marketId: string,
    requestId: string,
  ): Promise<AdminIpointAdjustmentDto> {
    return (
      await this.client.post<AdminIpointAdjustmentDto>(
        `/admin/ipoint-adjust-ops/markets/${encodeURIComponent(marketId)}/adjustments/${encodeURIComponent(requestId)}/submit`,
      )
    ).data;
  }

  /**
   * Checker decide (SUBMITTED -> APPROVED | REJECTED). Requires a fresh
   * step-up grant token (`x-step-up-token`); the server enforces the
   * maker/checker inequality, caps routing and evidence rules.
   */
  async decideAdjustment(
    marketId: string,
    requestId: string,
    input: AdminIpointAdjustmentDecisionInput,
    stepUpToken?: string,
  ): Promise<AdminIpointAdjustmentDto> {
    const headers: Record<string, string> = {};
    if (stepUpToken) headers['x-step-up-token'] = stepUpToken;
    return (
      await this.client.post<AdminIpointAdjustmentDto>(
        `/admin/ipoint-adjust-ops/markets/${encodeURIComponent(marketId)}/adjustments/${encodeURIComponent(requestId)}/decision`,
        input,
        { headers },
      )
    ).data;
  }

  /**
   * Checker execute (APPROVED -> EXECUTING -> EXECUTED | FAILED).
   * Requires a fresh step-up grant token (`x-step-up-token`). Above-soft
   * execution stays disabled until secure evidence storage is enabled
   * server-side.
   */
  async executeAdjustment(
    marketId: string,
    requestId: string,
    stepUpToken?: string,
  ): Promise<AdminIpointAdjustmentDto> {
    const headers: Record<string, string> = {};
    if (stepUpToken) headers['x-step-up-token'] = stepUpToken;
    return (
      await this.client.post<AdminIpointAdjustmentDto>(
        `/admin/ipoint-adjust-ops/markets/${encodeURIComponent(marketId)}/adjustments/${encodeURIComponent(requestId)}/execute`,
        undefined,
        { headers },
      )
    ).data;
  }

  /** Finance queue projection (state-filterable, paginated, newest first). */
  async listAdjustments(
    marketId: string,
    options: { state?: string; limit?: number; offset?: number } = {},
  ): Promise<AdminIpointAdjustmentQueueDto> {
    const params = new URLSearchParams();
    if (options.state) params.set('state', options.state);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined)
      params.set('offset', String(options.offset));
    const suffix = params.toString();
    return (
      await this.client.get<AdminIpointAdjustmentQueueDto>(
        `/admin/ipoint-adjust-ops/markets/${encodeURIComponent(marketId)}/adjustments${suffix ? `?${suffix}` : ''}`,
      )
    ).data;
  }

  /** Request detail incl. the immutable decision history. */
  async getAdjustment(
    marketId: string,
    requestId: string,
  ): Promise<AdminIpointAdjustmentDetailDto> {
    return (
      await this.client.get<AdminIpointAdjustmentDetailDto>(
        `/admin/ipoint-adjust-ops/markets/${encodeURIComponent(marketId)}/adjustments/${encodeURIComponent(requestId)}`,
      )
    ).data;
  }

  /** Maker-form support projection (market rules + reason codes). */
  async getAdjustmentConfig(
    marketId: string,
  ): Promise<AdminIpointAdjustmentConfigDto> {
    return (
      await this.client.get<AdminIpointAdjustmentConfigDto>(
        `/admin/ipoint-adjust-ops/markets/${encodeURIComponent(marketId)}/config`,
      )
    ).data;
  }

  /** Wallet/member lookup for the maker screen (masked). */
  async searchWallets(
    marketId: string,
    query: string,
  ): Promise<AdminIpointWalletLookupDto[]> {
    const params = new URLSearchParams({ query });
    return (
      await this.client.get<AdminIpointWalletLookupDto[]>(
        `/admin/ipoint-adjust-ops/markets/${encodeURIComponent(marketId)}/wallets?${params.toString()}`,
      )
    ).data;
  }
}

/* ------------------------------------------------------------------ */
/*  P7-S8 Admin Agent Operations                                       */
/* ------------------------------------------------------------------ */

/** Agent lifecycle statuses (frozen P5-S2 contract, read projection). */
export type AdminAgentOpsStatus =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_CONFIRMED'
  | 'COURSE_PENDING'
  | 'COURSE_COMPLETED'
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'DEACTIVATED'
  | 'REJECTED';

/** Explicit agent capability state of the selected market (no fallback). */
export type AdminAgentOpsCapabilityState =
  | 'CONFIGURED'
  | 'AGENT_FEE_NOT_CONFIGURED';

export interface AdminAgentOpsCapabilityDto {
  state: AdminAgentOpsCapabilityState;
  activation_fee: string | null;
  currency: string | null;
  fee_rate_version_id: string | null;
}

export interface AdminAgentListItemDto {
  agent_id: string;
  member_id: string;
  public_member_id: string;
  member_display_name: string | null;
  status: AdminAgentOpsStatus;
  market: string;
  activation_fee: string | null;
  activation_fee_currency: string;
  activated_at: string | null;
  created_at: string;
}

export interface AdminAgentListQuery {
  q?: string;
  status?: AdminAgentOpsStatus;
  limit?: number;
  offset?: number;
}

export interface AdminAgentListDto {
  market_id: string;
  market_code: string;
  capability: AdminAgentOpsCapabilityDto;
  items: AdminAgentListItemDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminAgentStatusHistoryEntryDto {
  log_id: string;
  from_status: AdminAgentOpsStatus | null;
  to_status: AdminAgentOpsStatus;
  changed_by: string | null;
  changed_by_type: string;
  reason: string | null;
  changed_at: string;
}

export interface AdminAgentDetailDto extends AdminAgentListItemDto {
  payment_reference: string | null;
  payment_confirmed_at: string | null;
  course_reference: string | null;
  course_enrolled_at: string | null;
  course_completed_at: string | null;
  course_confirmed_by: string | null;
  approved_at: string | null;
  activated_by: string | null;
  fee_rate_version_id: string | null;
  rejection_reason: string | null;
  reactivation_count: number;
  revoked_at: string | null;
  revoked_by: string | null;
  revocation_reason: string | null;
  updated_at: string;
  status_history: AdminAgentStatusHistoryEntryDto[];
}

export interface AdminAgentStatusActionInput {
  reason?: string;
}

export interface AdminAgentStatusActionResultDto {
  agent_id: string;
  status: AdminAgentOpsStatus;
  updated_at: string;
}

/**
 * P7-S8 Admin Agent Operations client.
 *
 * Read surface: market-scoped agent list/search/detail projection
 * (`agent.read`) with the explicit capability state — a market is
 * agent-capable only when an effective AGENT_ACTIVATION_FEE version
 * exists; otherwise `AGENT_FEE_NOT_CONFIGURED` (never a fallback fee).
 * Write surface: suspend/reactivate/deactivate (`agent.activation.manage`)
 * delegate 1:1 to the frozen Phase 5 owner commands with the server
 * Current Admin Market; the reason is mandatory for suspend/deactivate.
 * Agent Reapplication Policy is OPEN (not implemented) — no reapplication
 * surface exists here.
 */
export class AdminAgentOpsApiClient {
  constructor(private readonly client: ApiClient) {}

  /** Selected-market agent list/search (status + free-text filters). */
  async listAgents(
    marketId: string,
    options: AdminAgentListQuery = {},
  ): Promise<AdminAgentListDto> {
    const params = new URLSearchParams();
    if (options.q) params.set('q', options.q);
    if (options.status) params.set('status', options.status);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined)
      params.set('offset', String(options.offset));
    const suffix = params.toString();
    return (
      await this.client.get<AdminAgentListDto>(
        `/admin/agent-ops/markets/${encodeURIComponent(marketId)}/agents${suffix ? `?${suffix}` : ''}`,
      )
    ).data;
  }

  /** Agent detail with the append-only owner status history. */
  async getAgent(
    marketId: string,
    agentId: string,
  ): Promise<AdminAgentDetailDto> {
    return (
      await this.client.get<AdminAgentDetailDto>(
        `/admin/agent-ops/markets/${encodeURIComponent(marketId)}/agents/${encodeURIComponent(agentId)}`,
      )
    ).data;
  }

  /** Suspend an ACTIVE agent (reason required; owner transition + log). */
  async suspendAgent(
    marketId: string,
    agentId: string,
    reason: string,
  ): Promise<AdminAgentStatusActionResultDto> {
    return (
      await this.client.post<AdminAgentStatusActionResultDto>(
        `/admin/agent-ops/markets/${encodeURIComponent(marketId)}/agents/${encodeURIComponent(agentId)}/suspend`,
        { reason },
      )
    ).data;
  }

  /** Reactivate a SUSPENDED agent (owner increments the reactivation count). */
  async reactivateAgent(
    marketId: string,
    agentId: string,
  ): Promise<AdminAgentStatusActionResultDto> {
    return (
      await this.client.post<AdminAgentStatusActionResultDto>(
        `/admin/agent-ops/markets/${encodeURIComponent(marketId)}/agents/${encodeURIComponent(agentId)}/reactivate`,
      )
    ).data;
  }

  /** Deactivate an ACTIVE agent (reason required; terminal state). */
  async deactivateAgent(
    marketId: string,
    agentId: string,
    reason: string,
  ): Promise<AdminAgentStatusActionResultDto> {
    return (
      await this.client.post<AdminAgentStatusActionResultDto>(
        `/admin/agent-ops/markets/${encodeURIComponent(marketId)}/agents/${encodeURIComponent(agentId)}/deactivate`,
        { reason },
      )
    ).data;
  }
}

/* ------------------------------------------------------------------ */
/*  P7-S8 Admin Redemption Fulfilment Operations                       */
/* ------------------------------------------------------------------ */

/** The six operational fulfilment/refund status queues (P7-S8 §6.2). */
export type AdminFulfilmentQueueStatus =
  | 'READY_FOR_PICKUP'
  | 'BACKORDERED'
  | 'FULFILMENT_SUSPENDED'
  | 'FULFILMENT_EXCEPTION'
  | 'REFUND_PENDING'
  | 'REFUNDED';

export interface AdminFulfilmentLinkDto {
  fulfilment_id: string;
  fulfilment_type: string;
  fulfilment_status: string;
  tracking_number: string | null;
  courier: string | null;
  failure_reason: string | null;
  retry_count: number;
  max_retries: number;
  created_at: string;
}

export interface AdminRefundLinkDto {
  refund_request_id: string;
  refund_status: string;
  refund_amount: string;
  maker_id: string;
  checker_id: string | null;
  decided_at: string | null;
  executed_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
}

export interface AdminShippingRecoveryLinkDto {
  recovery_id: string;
  recovery_status: string;
  amount: string;
  currency: string;
  retry_count: number;
  max_retries: number;
  failed_at: string | null;
}

export interface AdminFulfilmentQueueItemDto {
  order_id: string;
  order_reference: string;
  member_id: string;
  public_member_id: string;
  item_name: string;
  item_sku: string | null;
  total_points: string;
  quantity: string;
  backorder_quantity: string;
  status: string;
  confirmed_at: string | null;
  ready_for_pickup_at: string | null;
  backordered_at: string | null;
  fulfilled_at: string | null;
  updated_at: string;
  fulfilment: AdminFulfilmentLinkDto | null;
  refund: AdminRefundLinkDto | null;
  shipping_recovery: AdminShippingRecoveryLinkDto | null;
}

export interface AdminFulfilmentQueueDto {
  market_id: string;
  market_code: string;
  status: AdminFulfilmentQueueStatus;
  /** Active redemption rate rule present (canonical D-053 §6 source). */
  rate_configured: boolean;
  items: AdminFulfilmentQueueItemDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminFulfilmentQueueOverviewDto {
  market_id: string;
  market_code: string;
  rate_configured: boolean;
  counts: Record<AdminFulfilmentQueueStatus, number>;
}

export interface AdminOrderAuditEntryDto {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_type: string;
  actor_id: string | null;
  reason: string | null;
  result: string;
  request_id: string | null;
  occurred_at: string;
}

export interface AdminRedemptionOrderDto {
  order_id: string;
  order_reference: string;
  member_id: string;
  public_member_id: string;
  item_name: string;
  item_sku: string | null;
  status: string;
  total_points: string;
  quantity: string;
  backorder_quantity: string;
  rate_value: string;
  confirmed_at: string | null;
  ready_for_pickup_at: string | null;
  backordered_at: string | null;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminOrderDetailDto {
  market_id: string;
  market_code: string;
  order: AdminRedemptionOrderDto;
  fulfilment: AdminFulfilmentLinkDto | null;
  refund: AdminRefundLinkDto | null;
  shipping_recovery: AdminShippingRecoveryLinkDto | null;
  audit: AdminOrderAuditEntryDto[];
}

export interface AdminFulfilmentOperationResultDto {
  ok: true;
  order_id?: string;
  fulfilment_id?: string;
  status?: string;
  updated_at: string;
}

export interface AdminRefundRequestViewDto {
  refund_request_id: string;
  order_id: string;
  order_reference: string;
  status: string;
  refund_amount: string;
  reason: string;
  maker_id: string;
  checker_id: string | null;
  maker_notes: string | null;
  checker_notes: string | null;
  prior_order_status: string | null;
  decided_at: string | null;
  executed_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminRefundQueueDto {
  market_id: string;
  market_code: string;
  items: AdminRefundRequestViewDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminRefundStatusHistoryEntryDto {
  id: string;
  action: string;
  reason: string | null;
  result: string;
  actor_id: string | null;
  occurred_at: string;
}

export interface AdminRefundDetailDto extends AdminRefundRequestViewDto {
  status_history: AdminRefundStatusHistoryEntryDto[];
}

/**
 * P7-S8 Admin Redemption Fulfilment Operations client.
 *
 * Read surface (`redemption.order.read`): the six fulfilment status
 * queues + overview counts, order detail with the owner-owned audit
 * history, and the SEC-02 refund queue/detail/status-history read face.
 * Write surface (`redemption.fulfilment.manage`): suspend/resume/retry
 * delegate 1:1 to the frozen Phase 6 owner commands; the reason is
 * mandatory for suspend. No refund write exists on this surface.
 */
export class AdminRedemptionFulfilmentOpsApiClient {
  constructor(private readonly client: ApiClient) {}

  /** Six-status fulfilment queue overview (counts + rate capability). */
  async queueOverview(
    marketId: string,
  ): Promise<AdminFulfilmentQueueOverviewDto> {
    return (
      await this.client.get<AdminFulfilmentQueueOverviewDto>(
        `/admin/redemption-fulfilment-ops/markets/${encodeURIComponent(marketId)}/queues`,
      )
    ).data;
  }

  /** One operational status queue (paginated, newest first). */
  async queue(
    marketId: string,
    status: AdminFulfilmentQueueStatus,
    options: { limit?: number; offset?: number } = {},
  ): Promise<AdminFulfilmentQueueDto> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined)
      params.set('offset', String(options.offset));
    const suffix = params.toString();
    return (
      await this.client.get<AdminFulfilmentQueueDto>(
        `/admin/redemption-fulfilment-ops/markets/${encodeURIComponent(marketId)}/queues/${status}${suffix ? `?${suffix}` : ''}`,
      )
    ).data;
  }

  /** Order detail with fulfilment, refund, recovery and owner audit. */
  async orderDetail(
    marketId: string,
    orderId: string,
  ): Promise<AdminOrderDetailDto> {
    return (
      await this.client.get<AdminOrderDetailDto>(
        `/admin/redemption-fulfilment-ops/markets/${encodeURIComponent(marketId)}/orders/${encodeURIComponent(orderId)}`,
      )
    ).data;
  }

  /** Order audit history (owner-owned immutable rows, newest first). */
  async orderAudit(
    marketId: string,
    orderId: string,
  ): Promise<AdminOrderAuditEntryDto[]> {
    return (
      await this.client.get<AdminOrderAuditEntryDto[]>(
        `/admin/redemption-fulfilment-ops/markets/${encodeURIComponent(marketId)}/orders/${encodeURIComponent(orderId)}/audit`,
      )
    ).data;
  }

  /** Suspend an order (reason required; owner transition + audit). */
  async suspendOrder(
    marketId: string,
    orderId: string,
    reason: string,
  ): Promise<AdminFulfilmentOperationResultDto> {
    return (
      await this.client.post<AdminFulfilmentOperationResultDto>(
        `/admin/redemption-fulfilment-ops/markets/${encodeURIComponent(marketId)}/orders/${encodeURIComponent(orderId)}/suspend`,
        { reason },
      )
    ).data;
  }

  /** Resume a suspended order (owner resolves the target status). */
  async resumeOrder(
    marketId: string,
    orderId: string,
  ): Promise<AdminFulfilmentOperationResultDto> {
    return (
      await this.client.post<AdminFulfilmentOperationResultDto>(
        `/admin/redemption-fulfilment-ops/markets/${encodeURIComponent(marketId)}/orders/${encodeURIComponent(orderId)}/resume`,
      )
    ).data;
  }

  /** Retry a FAILED fulfilment (admin failure recovery, OD-26). */
  async retryFulfilment(
    marketId: string,
    fulfilmentId: string,
  ): Promise<AdminFulfilmentOperationResultDto> {
    return (
      await this.client.post<AdminFulfilmentOperationResultDto>(
        `/admin/redemption-fulfilment-ops/markets/${encodeURIComponent(marketId)}/fulfilments/${encodeURIComponent(fulfilmentId)}/retry`,
      )
    ).data;
  }

  /** Refund queue (SEC-02 read face; status-filterable). */
  async refundQueue(
    marketId: string,
    options: { status?: string; limit?: number; offset?: number } = {},
  ): Promise<AdminRefundQueueDto> {
    const params = new URLSearchParams();
    if (options.status) params.set('status', options.status);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined)
      params.set('offset', String(options.offset));
    const suffix = params.toString();
    return (
      await this.client.get<AdminRefundQueueDto>(
        `/admin/redemption-fulfilment-ops/markets/${encodeURIComponent(marketId)}/refunds${suffix ? `?${suffix}` : ''}`,
      )
    ).data;
  }

  /** Refund detail with the REFUND_* status history (SEC-02 read face). */
  async refundDetail(
    marketId: string,
    refundRequestId: string,
  ): Promise<AdminRefundDetailDto> {
    return (
      await this.client.get<AdminRefundDetailDto>(
        `/admin/redemption-fulfilment-ops/markets/${encodeURIComponent(marketId)}/refunds/${encodeURIComponent(refundRequestId)}`,
      )
    ).data;
  }
}

/* ------------------------------------------------------------------ */
/*  P7-S9 Admin Audit Viewer                                           */
/* ------------------------------------------------------------------ */

/** Masked limited-view audit entry (every role incl. Support). */
export interface AdminAuditEntryDto {
  id: string;
  occurredAt: string;
  actorType: string;
  actorId: string | null;
  marketId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  result: string;
  reason: string | null;
  requestId: string | null;
  masked: true;
  beforeMasked: unknown;
  afterMasked: unknown;
}

/** Full stored evidence (audit.sensitive-diff.view, step-up + reason). */
export interface AdminAuditRawEntryDto {
  id: string;
  occurredAt: string;
  actorType: string;
  actorId: string | null;
  marketId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  result: string;
  reason: string | null;
  requestId: string | null;
  ipAddress: string | null;
  raw: true;
  before: unknown;
  after: unknown;
}

export interface AdminAuditListDto {
  asOf: string;
  marketId: string;
  items: AdminAuditEntryDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminAuditListQuery {
  actorType?: 'ACCOUNT' | 'ADMIN_USER' | 'SYSTEM';
  action?: string;
  entityType?: string;
  result?: 'SUCCESS' | 'FAILURE' | 'DENIED';
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

/**
 * P7-S9 Admin Audit Viewer client.
 *
 * Read-only, market-scoped projections over the immutable audit_logs table
 * (`audit.read`): filtered/searchable masked list and single-entry masked
 * view. The raw evidence view (`audit.sensitive-diff.view`) carries the
 * recorded sensitive-access reason and a fresh MFA step-up token as
 * headers; the Support template is not granted that permission (support
 * never reads raw ledgers). No write method exists on this client — the
 * surface is read-only by construction.
 */
export class AdminAuditOpsApiClient {
  constructor(private readonly client: ApiClient) {}

  /** Selected-market masked audit list (filters + free-text + pagination). */
  async listEntries(
    marketId: string,
    options: AdminAuditListQuery = {},
  ): Promise<AdminAuditListDto> {
    const params = new URLSearchParams();
    if (options.actorType) params.set('actorType', options.actorType);
    if (options.action) params.set('action', options.action);
    if (options.entityType) params.set('entityType', options.entityType);
    if (options.result) params.set('result', options.result);
    if (options.from) params.set('from', options.from);
    if (options.to) params.set('to', options.to);
    if (options.q) params.set('q', options.q);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined)
      params.set('offset', String(options.offset));
    const suffix = params.toString();
    return (
      await this.client.get<AdminAuditListDto>(
        `/admin/audit-ops/markets/${encodeURIComponent(marketId)}/entries${suffix ? `?${suffix}` : ''}`,
      )
    ).data;
  }

  /** One masked audit entry. */
  async getEntry(
    marketId: string,
    entryId: string,
  ): Promise<AdminAuditEntryDto> {
    return (
      await this.client.get<AdminAuditEntryDto>(
        `/admin/audit-ops/markets/${encodeURIComponent(marketId)}/entries/${encodeURIComponent(entryId)}`,
      )
    ).data;
  }

  /**
   * Raw audit evidence (`audit.sensitive-diff.view`). The reason is
   * mandatory (recorded, 8–500 chars) and a fresh step-up grant token is
   * required; the server enforces both plus the permission (Support is
   * denied).
   */
  async getRawEntry(
    marketId: string,
    entryId: string,
    input: { reason: string; stepUpToken?: string },
  ): Promise<AdminAuditRawEntryDto> {
    const headers: Record<string, string> = {
      'x-sensitive-access-reason': input.reason,
    };
    if (input.stepUpToken) headers['x-step-up-token'] = input.stepUpToken;
    return (
      await this.client.get<AdminAuditRawEntryDto>(
        `/admin/audit-ops/markets/${encodeURIComponent(marketId)}/entries/${encodeURIComponent(entryId)}/raw`,
        { headers },
      )
    ).data;
  }
}

/* ------------------------------------------------------------------ */
/*  P7-S9 Admin Basic Reports                                          */
/* ------------------------------------------------------------------ */

export type AdminReportFreshnessState = 'FRESH' | 'STALE' | 'UNAVAILABLE';

export type AdminReportUnavailableReason =
  | 'NO_DURABLE_SOURCE'
  | 'SOURCE_QUERY_FAILED';

export interface AdminReportStateDto {
  id: string;
  key: string;
  name: string;
  definition: string;
  definitionVersion: number;
  freshnessClass: 'QUEUE' | 'KPI';
  permission: 'report.read';
  source: string;
  state: AdminReportFreshnessState;
  unavailableReason?: AdminReportUnavailableReason;
  stale: boolean;
  unavailable: boolean;
  asOf: string;
  queryDurationMs?: number;
  value?: Record<string, unknown>;
}

export interface AdminReportCatalogDto {
  asOf: string;
  marketId: string;
  items: AdminReportStateDto[];
}

export interface AdminReportDetailDto extends AdminReportStateDto {
  marketId: string;
}

/**
 * P7-S9 Admin Basic Reports client.
 *
 * Market-scoped, on-screen, bounded operational reports (`report.read`):
 * the catalog discloses asOf / freshness / stale / unavailable per report
 * and an unavailable source is never presented as a fabricated zero.
 * There is deliberately NO export method on this client — Command Center
 * §7 explicitly prohibits CSV/download export.
 */
export class AdminReportOpsApiClient {
  constructor(private readonly client: ApiClient) {}

  /** Selected-market report catalog with per-report freshness state. */
  async listReports(marketId: string): Promise<AdminReportCatalogDto> {
    return (
      await this.client.get<AdminReportCatalogDto>(
        `/admin/report-ops/markets/${encodeURIComponent(marketId)}/reports`,
      )
    ).data;
  }

  /** One report detail (503 when UNAVAILABLE or explicitly STALE). */
  async getReport(
    marketId: string,
    reportId: string,
  ): Promise<AdminReportDetailDto> {
    return (
      await this.client.get<AdminReportDetailDto>(
        `/admin/report-ops/markets/${encodeURIComponent(marketId)}/reports/${encodeURIComponent(reportId)}`,
      )
    ).data;
  }
}

/* ------------------------------------------------------------------ */
/*  P8-S1 Ads & Content Operations                                    */
/* ------------------------------------------------------------------ */

export type AdsContentStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'EXPIRED'
  | 'ARCHIVED';

export interface AdPlacementDto {
  id: string;
  market_id: string;
  code: string;
  name: string;
  description: string | null;
  position: number;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  version: number;
}

export interface AdDto {
  id: string;
  public_id: string;
  market_id: string;
  placement_id: string;
  placement_code?: string;
  placement_name?: string;
  fee_config_id: string | null;
  title: string;
  summary: string | null;
  creative_media_url: string;
  creative_alt_text: string;
  target_url: string | null;
  is_sponsored: true;
  sponsor_label: string;
  status: AdsContentStatus;
  schedule_start_at: string | null;
  schedule_end_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface ContentArticleDto {
  id: string;
  public_id: string;
  market_id: string;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  cover_media_url: string | null;
  cover_alt_text: string | null;
  is_promoted: boolean;
  sponsor_label: string | null;
  status: AdsContentStatus;
  publish_at: string | null;
  unpublish_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface AdsContentListDto<T> {
  market_id: string;
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface MemberHomeContentDto {
  market_id: string;
  as_of: string;
  ads: Array<{
    public_id: string;
    placement_code: string;
    title: string;
    summary: string | null;
    creative_media_url: string;
    creative_alt_text: string;
    target_url: string | null;
    is_sponsored: true;
    sponsor_label: string;
  }>;
  articles: Array<{
    public_id: string;
    slug: string;
    title: string;
    excerpt: string;
    cover_media_url: string | null;
    cover_alt_text: string | null;
    is_promoted: boolean;
    sponsor_label: string | null;
    published_at: string | null;
  }>;
}

export class AdminAdsContentApiClient {
  constructor(private readonly client: ApiClient) {}

  async placements(
    marketId: string,
  ): Promise<{ market_id: string; items: AdPlacementDto[] }> {
    return (
      await this.client.get<{ market_id: string; items: AdPlacementDto[] }>(
        `/admin/ads-content/markets/${encodeURIComponent(marketId)}/placements`,
      )
    ).data;
  }

  async createPlacement(
    marketId: string,
    input: {
      code: string;
      name: string;
      description?: string | null;
      position: number;
      reason: string;
    },
    idempotencyKey: string,
  ): Promise<AdPlacementDto> {
    return (
      await this.client.post<AdPlacementDto>(
        `/admin/ads-content/markets/${encodeURIComponent(marketId)}/placements`,
        input,
        { idempotencyKey },
      )
    ).data;
  }

  async listAds(
    marketId: string,
    options: { status?: AdsContentStatus; q?: string } = {},
  ): Promise<AdsContentListDto<AdDto>> {
    return (
      await this.client.get<AdsContentListDto<AdDto>>(
        `${this.base(marketId)}/ads${queryString(options)}`,
      )
    ).data;
  }

  async getAd(marketId: string, adId: string): Promise<AdDto> {
    return (
      await this.client.get<AdDto>(
        `${this.base(marketId)}/ads/${encodeURIComponent(adId)}`,
      )
    ).data;
  }

  async createAd(
    marketId: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<AdDto> {
    return (
      await this.client.post<AdDto>(`${this.base(marketId)}/ads`, input, {
        idempotencyKey,
      })
    ).data;
  }

  async updateAd(
    marketId: string,
    adId: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<AdDto> {
    return (
      await this.client.patch<AdDto>(
        `${this.base(marketId)}/ads/${encodeURIComponent(adId)}`,
        input,
        { idempotencyKey },
      )
    ).data;
  }

  async transitionAd(
    marketId: string,
    adId: string,
    status: AdsContentStatus,
    expectedVersion: number,
    reason: string,
    idempotencyKey: string,
  ): Promise<AdDto> {
    return (
      await this.client.post<AdDto>(
        `${this.base(marketId)}/ads/${encodeURIComponent(adId)}/status`,
        { status, expectedVersion, reason },
        { idempotencyKey },
      )
    ).data;
  }

  async listArticles(
    marketId: string,
    options: { status?: AdsContentStatus; q?: string } = {},
  ): Promise<AdsContentListDto<ContentArticleDto>> {
    return (
      await this.client.get<AdsContentListDto<ContentArticleDto>>(
        `${this.base(marketId)}/articles${queryString(options)}`,
      )
    ).data;
  }

  async createArticle(
    marketId: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<ContentArticleDto> {
    return (
      await this.client.post<ContentArticleDto>(
        `${this.base(marketId)}/articles`,
        input,
        { idempotencyKey },
      )
    ).data;
  }

  async updateArticle(
    marketId: string,
    articleId: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<ContentArticleDto> {
    return (
      await this.client.patch<ContentArticleDto>(
        `${this.base(marketId)}/articles/${encodeURIComponent(articleId)}`,
        input,
        { idempotencyKey },
      )
    ).data;
  }

  async transitionArticle(
    marketId: string,
    articleId: string,
    status: AdsContentStatus,
    expectedVersion: number,
    reason: string,
    idempotencyKey: string,
  ): Promise<ContentArticleDto> {
    return (
      await this.client.post<ContentArticleDto>(
        `${this.base(marketId)}/articles/${encodeURIComponent(articleId)}/status`,
        { status, expectedVersion, reason },
        { idempotencyKey },
      )
    ).data;
  }

  private base(marketId: string): string {
    return `/admin/ads-content/markets/${encodeURIComponent(marketId)}`;
  }
}

export class MemberAdsContentApiClient {
  constructor(private readonly client: ApiClient) {}
  async home(): Promise<MemberHomeContentDto> {
    return (
      await this.client.get<MemberHomeContentDto>('/members/content/home')
    ).data;
  }
}

/* ------------------------------------------------------------------ */
/*  P8-S5B Member Wallet / Reward / Team / Redemption clients          */
/*                                                                     */
/*  Append-only section (do not move or merge). Member-domain          */
/*  adapters over the frozen Phase 3/5/6 member controllers:           */
/*    wallet:     GET /wallets, GET /wallets/:id,                      */
/*                GET /wallets/:id/entries (limit/offset paging)       */
/*    reward:     GET /rewards/plans (member-scoped, page paging)      */
/*    referral:   GET /referral/tree (anonymized tree + own code)      */
/*    agent:      GET /agent/status (optional market code filter)      */
/*    commission: GET /commission/summary,                             */
/*                GET /commission/ledger (limit/offset paging)         */
/*    redemption: GET /redemption/catalog (page paging),               */
/*                GET /redemption/catalog/:itemId,                     */
/*                GET /redemption/catalog/:itemId/quote,               */
/*                POST /redemption/orders (idempotency key in body)    */
/*                                                                     */
/*  All monetary amounts are exact decimal strings and are passed      */
/*  through untouched. The member scope is derived server-side from    */
/*  the authenticated actor; the client never invents a market id.     */
/* ------------------------------------------------------------------ */

/* ---- P8-S5B Member Wallet ---- */

export type MemberWalletEntryType =
  | 'PENDING'
  | 'AVAILABLE'
  | 'REVERSED'
  | 'COMPENSATION'
  | 'ADJUSTMENT';

/** GET /wallets — one wallet account per market for the member. */
export interface MemberWalletAccountDto {
  id: string;
  memberId: string;
  marketId: string;
  pendingBalance: string;
  availableBalance: string;
  reversedBalance: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** GET /wallets/:id/entries — immutable ledger entry (newest first). */
export interface MemberWalletEntryDto {
  id: string;
  walletAccountId: string;
  memberId: string;
  marketId: string;
  entrySequence: number;
  entryType: MemberWalletEntryType;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  idempotencyKey: string;
  referenceType: string | null;
  referenceId: string | null;
  description: string | null;
  reason: string | null;
  actorId: string | null;
  marketTimezone: string | null;
  createdAt: string;
}

export interface MemberWalletEntriesPageDto {
  entries: MemberWalletEntryDto[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * P8-S5B member wallet adapter. Balances are exact decimal strings;
 * the wallet surface carries no currency (currency is resolved per
 * market in the consuming app).
 */
export class MemberWalletApiClient {
  constructor(private readonly client: ApiClient) {}

  /** All wallets of the authenticated member (one per market). */
  async listWallets(): Promise<MemberWalletAccountDto[]> {
    return (await this.client.get<MemberWalletAccountDto[]>('/wallets')).data;
  }

  async getWallet(id: string): Promise<MemberWalletAccountDto> {
    return (
      await this.client.get<MemberWalletAccountDto>(
        `/wallets/${encodeURIComponent(id)}`,
      )
    ).data;
  }

  /** Paginated immutable ledger history for one wallet, newest first. */
  async walletEntries(
    id: string,
    query: { limit?: number; offset?: number } = {},
  ): Promise<MemberWalletEntriesPageDto> {
    return (
      await this.client.get<MemberWalletEntriesPageDto>(
        `/wallets/${encodeURIComponent(id)}/entries${queryString(query)}`,
      )
    ).data;
  }
}

/* ---- P8-S5B Member Reward ---- */

export type MemberRewardPlanStatus =
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'CAPPED'
  | 'SUSPENDED'
  | 'REVERSED'
  | 'COMPLETED';

/** GET /rewards/plans — a member reward (accrual) plan. */
export interface MemberRewardPlanDto {
  id: string;
  sourceType: string;
  sourceId: string;
  memberId: string;
  marketId: string;
  merchantId: string;
  status: MemberRewardPlanStatus;
  totalEarned: string;
  capAmount: string | null;
  snapshot: Record<string, unknown> | null;
  ruleVersionId: string | null;
  activatedAt: string | null;
  completedAt: string | null;
  reversedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberRewardPlansPageDto {
  items: MemberRewardPlanDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * P8-S5B member reward adapter. Reward amounts are exact decimal
 * strings (totalEarned / capAmount).
 */
export class MemberRewardApiClient {
  constructor(private readonly client: ApiClient) {}

  /** Member reward plans (accrual records), paginated. */
  async plans(
    query: {
      page?: number;
      pageSize?: number;
      status?: MemberRewardPlanStatus;
    } = {},
  ): Promise<MemberRewardPlansPageDto> {
    return (
      await this.client.get<MemberRewardPlansPageDto>(
        `/rewards/plans${queryString(query)}`,
      )
    ).data;
  }
}

/* ---- P8-S5B Member Team (referral / agent / commission) ---- */

/** GET /referral/tree — anonymized tree plus the member's own code. */
export interface MemberReferralTreeDto {
  myCode: string;
  referrer: { maskedReference: string; isAgent: boolean } | null;
  referrals: {
    g1Count: number;
    g2Count: number;
    g1Agents: number;
    g2Agents: number;
  };
}

/** GET /agent/status — agent activation status (nullable when none). */
export interface MemberAgentActivationStatusDto {
  activationId: string;
  status: string;
  market: string;
  activatedAt: string | null;
  currency: string;
  feeRateVersionId: string | null;
  activationFee: string | null;
  activationFeeCurrency: string;
  paymentReference: string | null;
  courseReference: string | null;
  rejectionReason: string | null;
  revocationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberCommissionMarketSummaryDto {
  market: string;
  currency: string;
  totalEarned: string;
  entryCount: number;
}

/** GET /commission/summary — per-market totals with grand total. */
export interface MemberCommissionSummaryDto {
  memberId: string;
  markets: MemberCommissionMarketSummaryDto[];
  grandTotal: string;
  currency: string;
}

/** GET /commission/ledger — one commission ledger entry. */
export interface MemberCommissionLedgerEntryDto {
  id: string;
  publicReference: string;
  beneficiaryId: string;
  sourceType: string;
  sourceReference: string;
  market: string;
  currency: string;
  amount: string;
  generation: number;
  entryType: string;
  postingStatus: string;
  effectiveTime: string;
  createdAt: string;
  reversalLinkage: string | null;
  auditLinkage: string | null;
  notes: string | null;
}

export interface MemberCommissionLedgerPageDto {
  entries: MemberCommissionLedgerEntryDto[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * P8-S5B member team adapter: referral tree, agent activation status
 * and commission summary/ledger. Amounts are exact decimal strings.
 */
export class MemberTeamApiClient {
  constructor(private readonly client: ApiClient) {}

  /** Anonymized referral tree with the member's own referral code. */
  async referralTree(): Promise<MemberReferralTreeDto> {
    return (
      await this.client.get<MemberReferralTreeDto>('/referral/tree?depth=2')
    ).data;
  }

  /**
   * Agent activation status. Without a market the server returns the
   * most recent activation across markets.
   */
  async agentStatus(
    market?: string,
  ): Promise<MemberAgentActivationStatusDto | null> {
    const query = market ? `?market=${encodeURIComponent(market)}` : '';
    return (
      await this.client.get<MemberAgentActivationStatusDto | null>(
        `/agent/status${query}`,
      )
    ).data;
  }

  /** Per-market commission totals with grand total (exact strings). */
  async commissionSummary(): Promise<MemberCommissionSummaryDto> {
    return (
      await this.client.get<MemberCommissionSummaryDto>('/commission/summary')
    ).data;
  }

  /** Paginated commission ledger for the authenticated member. */
  async commissionLedger(
    query: {
      market?: string;
      status?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<MemberCommissionLedgerPageDto> {
    return (
      await this.client.get<MemberCommissionLedgerPageDto>(
        `/commission/ledger${queryString(query)}`,
      )
    ).data;
  }
}

/* ---- P8-S5B Member Redemption ---- */

export type MemberRedemptionItemType =
  | 'PHYSICAL'
  | 'DIGITAL_VOUCHER'
  | 'SERVICE';

export type MemberRedemptionFulfilmentMode =
  | 'DELIVERY'
  | 'PICKUP'
  | 'DELIVERY_OR_PICKUP'
  | 'DIGITAL'
  | 'SERVICE';

export type MemberRedemptionCatalogQuery = {
  page?: number;
  pageSize?: number;
  query?: string;
  itemType?: MemberRedemptionItemType;
  fulfilmentMode?: MemberRedemptionFulfilmentMode;
  sort?: 'name:asc' | 'name:desc' | 'sortOrder:asc';
};

/** GET /redemption/catalog — one catalogue row for the member market. */
export interface MemberRedemptionCatalogItemDto {
  id: string;
  name: string;
  sku: string | null;
  itemType: string;
  fiatReferenceValue: string;
  fiatCurrency: string;
  inventoryMode: string;
  fulfilmentMode: string;
  imageUrl: string | null;
  tags: string[];
  isFeatured: boolean;
  sortOrder: number;
}

export interface MemberRedemptionCatalogPageDto {
  items: MemberRedemptionCatalogItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** GET /redemption/catalog/:itemId — item detail with version + terms. */
export interface MemberRedemptionItemDetailDto {
  id: string;
  marketId: string;
  name: string;
  description: string | null;
  itemType: string;
  fiatReferenceValue: string;
  fiatCurrency: string;
  inventoryMode: string;
  imageUrl: string | null;
  terms: string | null;
  fulfilmentMode: string;
  tags: string[];
  isFeatured: boolean;
  effectiveFrom: string;
  effectiveUntil: string | null;
  version: number;
}

/** GET /redemption/catalog/:itemId/quote — server-locked point cost. */
export interface MemberRedemptionQuoteDto {
  quoteId: string;
  catalogItemId: string;
  marketId: string;
  rateVersionId: string;
  rateSnapshot: Record<string, unknown>;
  unroundedPointCost: string;
  postedPointCost: string;
  quantity: number;
  payloadHash: string;
  expiresAt: string;
  createdAt: string;
}

/** POST /redemption/orders — owner confirm payload (P6-S4). */
export interface MemberRedemptionOrderInput {
  quoteId: string;
  idempotencyKey: string;
  expectedItemVersion: number;
  expectedTotalPoints: string;
  expectedQuantity: string;
  fulfilment: {
    type: 'DELIVERY' | 'PICKUP';
    deliveryAddress?: {
      name: string;
      phone: string;
      line1: string;
      line2?: string;
      city: string;
      state?: string;
      postcode: string;
      country: string;
    };
    pickupLocationId?: string;
  };
  termsAcceptance: { accepted: true; termsVersion: string };
  shippingPaymentIntentReference?: string;
}

/** POST /redemption/orders response — confirmed order. */
export interface MemberRedemptionOrderDto {
  id: string;
  orderReference: string;
  marketId: string;
  memberId: string;
  itemId: string;
  walletAccountId: string;
  walletEntryId: string;
  quoteId: string;
  status: string;
  totalPointCost: string;
  quantity: string;
  backorderQuantity: string;
  itemSnapshot: Record<string, unknown>;
  rateSnapshot: Record<string, unknown>;
  idempotencyKey: string | null;
  confirmedAt: string;
  createdAt: string;
}

/**
 * P8-S5B member redemption adapter. The catalogue and quotes are
 * resolved against the member's server-selected current market; the
 * confirm-order idempotency key travels inside the owner payload.
 */
export class MemberRedemptionApiClient {
  constructor(private readonly client: ApiClient) {}

  /** Member catalogue for the server-resolved current market. */
  async catalog(
    query: MemberRedemptionCatalogQuery = {},
  ): Promise<MemberRedemptionCatalogPageDto> {
    return (
      await this.client.get<MemberRedemptionCatalogPageDto>(
        `/redemption/catalog${queryString(query)}`,
      )
    ).data;
  }

  /** Catalogue item detail (includes catalog version and terms text). */
  async itemDetail(itemId: string): Promise<MemberRedemptionItemDetailDto> {
    return (
      await this.client.get<MemberRedemptionItemDetailDto>(
        `/redemption/catalog/${encodeURIComponent(itemId)}`,
      )
    ).data;
  }

  /** Server-locked quote for an item + quantity (rate locked at quote time). */
  async quote(itemId: string, quantity = 1): Promise<MemberRedemptionQuoteDto> {
    return (
      await this.client.get<MemberRedemptionQuoteDto>(
        `/redemption/catalog/${encodeURIComponent(itemId)}/quote?quantity=${quantity}`,
      )
    ).data;
  }

  /**
   * Confirm a redemption order (Direct Atomic Debit). The idempotency
   * key is part of the owner payload: same key + same payload replays
   * the existing order; same key + different payload is rejected with
   * REDEMPTION_IDEMPOTENCY_MISMATCH.
   */
  async confirmOrder(
    input: MemberRedemptionOrderInput,
  ): Promise<MemberRedemptionOrderDto> {
    return (
      await this.client.post<MemberRedemptionOrderDto>(
        '/redemption/orders',
        input,
      )
    ).data;
  }
}

function queryString<T>(options: T): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(
    options as Record<string, unknown>,
  )) {
    if (value === undefined || value === '') continue;
    if (typeof value === 'string') params.set(key, value);
    else if (typeof value === 'number' || typeof value === 'boolean') {
      params.set(key, `${value}`);
    }
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/* ------------------------------------------------------------------ */
/*  P8-S5C Merchant Transaction typed client (append-only section)     */
/*                                                                     */
/*  Typed adapter over the frozen Phase 4 merchant transaction         */
/*  controller (`apps/api/src/transaction/transaction.controller.ts`,  */
/*  `@Controller('merchant/transactions')`):                           */
/*    history: GET /merchant/transactions (cursor paging)              */
/*    receipt: GET /merchant/transactions/:transactionNumber           */
/*    preview: POST /merchant/transactions/preview                     */
/*             (Idempotency-Key + x-market-id headers required)        */
/*    confirm: POST /merchant/transactions/:previewSessionId/confirm   */
/*             (Idempotency-Key header required)                       */
/*                                                                     */
/*  All monetary amounts are exact decimal strings passed through      */
/*  untouched; JavaScript Number is never used for amounts. The        */
/*  preview market context is the merchant's persisted `x-market-id`   */
/*  header (the client never invents a market id). Reversal/refund     */
/*  endpoints exist on the frozen controller but are intentionally     */
/*  NOT exposed here (G-05(a) preview/confirm/receipt/history only).   */
/* ------------------------------------------------------------------ */

/** GET /merchant/transactions — cursor-paged confirmed history. */
export interface MerchantTransactionListQuery {
  cursor?: string;
  limit?: number;
  status?: 'CONFIRMED';
  marketCode?: string;
  dateFrom?: string;
  dateTo?: string;
  branchId?: string;
  merchantReceiptNumber?: string;
  transactionNumber?: string;
}

/**
 * Receipt fields shared by list rows, transaction detail, and the
 * confirm response (`receiptData`). Mirrors the frozen read DTO
 * (`transaction-read.dto.ts`) and `TransactionReceiptData`.
 */
export interface MerchantTransactionReceiptDto {
  transactionNumber: string;
  status: 'CONFIRMED';
  merchant: {
    merchantId: string;
    merchantName: string;
    branchName: string | null;
  };
  member: {
    maskedReference: string;
    displayName: string | null;
  };
  market: { marketCode: string };
  currency: string;
  purchaseAmount: string;
  package: {
    packageName: string;
    serviceFeeRate: string;
  };
  serviceFeeAmount: string;
  reward: {
    rewardRate: string;
    dailyRewardAmount: string;
    rewardCap: string;
    rewardStartBusinessDate: string;
  };
  merchantReceiptNumber: string | null;
  transactionNote: string | null;
  transactionTime: string;
}

/** Merchant receipt row: receipt base plus the MCP debit projection. */
export interface MerchantTransactionListItemDto extends MerchantTransactionReceiptDto {
  mcpDeducted: string;
  mcpBalanceAfter: string;
}

/** GET /merchant/transactions response — newest first, cursor paging. */
export interface MerchantTransactionListPageDto {
  items: MerchantTransactionListItemDto[];
  nextCursor: string | null;
}

/** POST /merchant/transactions/preview — preview session request. */
export interface MerchantTransactionPreviewRequest {
  amount: string;
  memberQrToken: string;
  packageId?: string;
  marketId?: string;
  transactionNote?: string;
}

/** POST /merchant/transactions/preview response — server quote. */
export interface MerchantTransactionPreviewDto {
  previewSessionId: string;
  protectedMemberReference: string;
  amount: string;
  currency: string;
  selectedPackage: {
    name: string;
    rate: string;
  };
  serviceFeeRate: string;
  estimatedMcpDebit: string;
  currentMcpBalance: string;
  estimatedMcpBalanceAfter: string;
  mcpSufficient: boolean;
  confirmAllowed: boolean;
  mcpShortfall: string;
  rewardRate: string;
  expectedDailyRewardAmount: string;
  rewardCap: string;
  rewardStartDate: string;
  transactionMarket: {
    code: string;
    timezone: string;
  };
  previewExpiresAt: string;
}

/** POST /merchant/transactions/:previewSessionId/confirm — request body. */
export interface MerchantTransactionConfirmRequest {
  merchantReceiptNumber?: string;
}

/** POST /merchant/transactions/:previewSessionId/confirm — response. */
export interface MerchantTransactionConfirmDto {
  transactionNumber: string;
  status: 'CONFIRMED';
  transactionTime: string;
  merchant: MerchantTransactionReceiptDto['merchant'];
  market: { marketCode: string };
  currency: string;
  amount: string;
  serviceFee: string;
  mcpDeducted: string;
  mcpBalanceAfter: string;
  dailyRewardAmount: string;
  rewardCap: string;
  rewardStartBusinessDate: string;
  receiptData: MerchantTransactionReceiptDto;
}

/**
 * P8-S5C merchant transaction adapter.
 *
 * `preview` and `confirm` are idempotent commands: the caller supplies
 * ONE key per logical order attempt (created once, reused on retry,
 * reset after success — P8-S5b M-1 lesson). The `x-market-id` header
 * on preview is the merchant's persisted market context; the client
 * never invents a market id.
 */
export class MerchantTransactionApiClient {
  constructor(private readonly client: ApiClient) {}

  /** Confirmed transaction history, newest first (cursor paging). */
  async list(
    query: MerchantTransactionListQuery = {},
  ): Promise<MerchantTransactionListPageDto> {
    return (
      await this.client.get<MerchantTransactionListPageDto>(
        `/merchant/transactions${queryString(query)}`,
      )
    ).data;
  }

  /** Single confirmed transaction (receipt view). */
  async detail(
    transactionNumber: string,
  ): Promise<MerchantTransactionListItemDto> {
    return (
      await this.client.get<MerchantTransactionListItemDto>(
        `/merchant/transactions/${encodeURIComponent(transactionNumber)}`,
      )
    ).data;
  }

  /** Create a preview session (quote). Idempotency-Key + x-market-id. */
  async preview(
    input: MerchantTransactionPreviewRequest,
    marketId: string,
    idempotencyKey: string,
  ): Promise<MerchantTransactionPreviewDto> {
    return (
      await this.client.post<MerchantTransactionPreviewDto>(
        '/merchant/transactions/preview',
        input,
        { marketId, idempotencyKey },
      )
    ).data;
  }

  /** Confirm a preview session. Idempotency-Key header required. */
  async confirm(
    previewSessionId: string,
    input: MerchantTransactionConfirmRequest,
    idempotencyKey: string,
  ): Promise<MerchantTransactionConfirmDto> {
    return (
      await this.client.post<MerchantTransactionConfirmDto>(
        `/merchant/transactions/${encodeURIComponent(previewSessionId)}/confirm`,
        input,
        { idempotencyKey },
      )
    ).data;
  }
}
