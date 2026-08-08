export const ADS_CONTENT_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'ACTIVE',
  'PAUSED',
  'EXPIRED',
  'ARCHIVED',
] as const;

export type AdsContentStatus = (typeof ADS_CONTENT_STATUSES)[number];

export interface AdsContentActor {
  adminUserId: string;
  currentMarketId?: string;
  requestId?: string;
  ipAddress?: string;
}

export type AdsContentErrorCode =
  | 'ADS_CONTENT_NOT_FOUND'
  | 'ADS_CONTENT_MARKET_MISMATCH'
  | 'ADS_CONTENT_INVALID_TRANSITION'
  | 'ADS_CONTENT_INVALID_SCHEDULE'
  | 'ADS_CONTENT_INVALID_CONTENT'
  | 'ADS_CONTENT_STALE_VERSION'
  | 'ADS_CONTENT_IDEMPOTENCY_CONFLICT'
  | 'ADS_CONTENT_IDEMPOTENCY_KEY_REQUIRED'
  | 'ADS_CONTENT_DUPLICATE'
  | 'ADS_CONTENT_PLACEMENT_INACTIVE'
  | 'ADS_CONTENT_FEE_CONFIG_UNAVAILABLE';

export class AdsContentError extends Error {
  constructor(
    public readonly code: AdsContentErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AdsContentError';
  }
}

export interface AdminListResponse<T> {
  market_id: string;
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface MemberHomeContentResponse {
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
    body: string;
    cover_media_url: string | null;
    cover_alt_text: string | null;
    is_promoted: boolean;
    sponsor_label: string | null;
    published_at: string | null;
  }>;
}
