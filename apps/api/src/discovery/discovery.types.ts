export type DiscoveryErrorCode =
  | 'DISCOVERY_MARKET_NOT_CONFIGURED'
  | 'DISCOVERY_MARKET_DISABLED'
  | 'DISCOVERY_MERCHANT_NOT_FOUND'
  | 'DISCOVERY_INVALID_PARAMETER'
  | 'DISCOVERY_RADIUS_TOO_LARGE';

export class MerchantDiscoveryError extends Error {
  constructor(
    readonly code: DiscoveryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MerchantDiscoveryError';
  }
}

export enum OpenNowStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  UNKNOWN = 'UNKNOWN',
}

export type SortOption = 'relevance' | 'newest' | 'name' | 'distance';

export interface MerchantCategorySummary {
  id: string;
  code: string;
  name: string;
}

export interface PublicMerchantPackage {
  code: string;
  name: string;
  description?: string;
  rate: string;
  isDefault: boolean;
}

export interface MerchantListItemResponse {
  merchantId: string;
  displayName: string;
  branchName: string;
  category: MerchantCategorySummary | null;
  isOnline: boolean;
  isOffline: boolean;
  rating?: number;
  distance?: number;
  openNow?: OpenNowStatus;
  packages: PublicMerchantPackage[];
}

export interface MerchantDetailResponse extends MerchantListItemResponse {
  categories: MerchantCategorySummary[];
  logoUrl: string | null;
  bannerUrl: string | null;
  aboutUs: string | null;
  address: unknown;
  businessHours: unknown;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  socialLinks: unknown;
  gallery: Array<{ url: string; position: number }>;
  coordinates: { latitude: number; longitude: number } | null;
}

export interface CategoryResponse {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
