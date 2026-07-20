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
  kind: 'offline' | 'forbidden' | 'market' | 'expired' | 'validation' | 'error';
} {
  if (!(error instanceof ApiError)) {
    return { title: 'Unexpected error', detail: String(error), kind: 'error' };
  }
  if (error.status === 0) {
    return { title: 'You are offline', detail: error.message, kind: 'offline' };
  }
  if (error.status === 401) {
    return { title: 'Session expired', detail: error.message, kind: 'expired' };
  }
  if (error.isMarketAccessError) {
    return {
      title: 'Market access denied',
      detail: error.message,
      kind: 'market',
    };
  }
  if (error.status === 403) {
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
  public onSessionExpired: (() => void) | null = null;

  constructor(private readonly baseUrl: string) {}

  /* ---- token management ---- */

  get isAuthenticated(): boolean {
    return this._accessToken !== null;
  }

  setTokens(tokens: AuthTokens): void {
    this._accessToken = tokens.accessToken;
    this._refreshToken = tokens.refreshToken ?? null;
  }

  clearSession(): void {
    this._accessToken = null;
    this._refreshToken = null;
    this.refreshPromise = null;
    dispatchSessionEvent('session-cleared');
    this.onSessionExpired?.();
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
    return this.request<T>('GET', path, undefined, options);
  }

  async post<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body, options);
  }

  async upload<T>(
    path: string,
    formData: FormData,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, formData, {
      ...options,
      headers: { ...options?.headers },
    });
  }

  async put<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, body, options);
  }

  async patch<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    return this.request<T>('PATCH', path, body, options);
  }

  async delete<T>(
    path: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path, undefined, options);
  }

  /* ---- login (convenience) ---- */

  async login(email: string, password: string): Promise<AuthTokens> {
    const response = await this.request<AuthTokens>(
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

  private async request<T>(
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
