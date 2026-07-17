export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
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
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    const message = Array.isArray(body.message)
      ? body.message.join(' ')
      : body.message;
    super(message ?? `Request failed with status ${status}.`);
    this.name = 'ApiError';
  }

  get isMarketAccessError(): boolean {
    return (
      this.status === 403 &&
      /market/i.test(`${this.body.code ?? ''} ${this.message}`)
    );
  }
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  marketId?: string;
  idempotencyKey?: string;
  anonymous?: boolean;
  retryAfterRefresh?: boolean;
}

export class ApiClient {
  private refreshPromise?: Promise<boolean>;

  constructor(
    private readonly baseUrl: string,
    private readonly storageKey: string,
  ) {}

  get tokens(): AuthTokens | undefined {
    const value = window.localStorage.getItem(this.storageKey);
    if (!value) return undefined;
    try {
      return JSON.parse(value) as AuthTokens;
    } catch {
      window.localStorage.removeItem(this.storageKey);
      return undefined;
    }
  }

  setTokens(tokens: AuthTokens): void {
    window.localStorage.setItem(this.storageKey, JSON.stringify(tokens));
    window.dispatchEvent(new CustomEvent('ipoint:session-changed'));
  }

  clearSession(): void {
    window.localStorage.removeItem(this.storageKey);
    window.dispatchEvent(new CustomEvent('ipoint:session-expired'));
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const tokens = await this.request<AuthTokens>('/auth/login', {
      method: 'POST',
      body: { email, password },
      anonymous: true,
    });
    this.setTokens(tokens);
    return tokens;
  }

  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set('accept', 'application/json');
    if (options.body !== undefined)
      headers.set('content-type', 'application/json');
    if (options.marketId) headers.set('x-market-id', options.marketId);
    if (options.idempotencyKey)
      headers.set('idempotency-key', options.idempotencyKey);
    const tokens = this.tokens;
    if (!options.anonymous && tokens)
      headers.set('authorization', `Bearer ${tokens.accessToken}`);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      throw new ApiError(0, {
        code: 'NETWORK_OFFLINE',
        message:
          error instanceof Error ? error.message : 'Network request failed.',
      });
    }

    if (
      response.status === 401 &&
      !options.anonymous &&
      options.retryAfterRefresh !== false &&
      (await this.refresh())
    ) {
      return this.request<T>(path, { ...options, retryAfterRefresh: false });
    }

    if (!response.ok) throw await toApiError(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async refresh(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh().finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  private async performRefresh(): Promise<boolean> {
    const refreshToken = this.tokens?.refreshToken;
    if (!refreshToken) {
      this.clearSession();
      return false;
    }
    try {
      const tokens = await this.request<AuthTokens>('/auth/refresh', {
        method: 'POST',
        body: { refresh_token: refreshToken },
        anonymous: true,
        retryAfterRefresh: false,
      });
      this.setTokens(tokens);
      return true;
    } catch {
      this.clearSession();
      return false;
    }
  }
}

export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function describeApiError(error: unknown): {
  title: string;
  detail: string;
  kind: 'offline' | 'forbidden' | 'market' | 'expired' | 'validation' | 'error';
} {
  if (!(error instanceof ApiError))
    return { title: 'Unexpected error', detail: String(error), kind: 'error' };
  if (error.status === 0)
    return { title: 'You are offline', detail: error.message, kind: 'offline' };
  if (error.status === 401)
    return { title: 'Session expired', detail: error.message, kind: 'expired' };
  if (error.isMarketAccessError)
    return {
      title: 'Market access denied',
      detail: error.message,
      kind: 'market',
    };
  if (error.status === 403)
    return {
      title: 'Permission denied',
      detail: error.message,
      kind: 'forbidden',
    };
  if (error.status === 400 || error.status === 422)
    return {
      title: 'Check the highlighted information',
      detail: error.message,
      kind: 'validation',
    };
  return {
    title: error.body.code ?? 'Request failed',
    detail: error.message,
    kind: 'error',
  };
}

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
