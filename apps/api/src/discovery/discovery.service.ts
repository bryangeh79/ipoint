import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import { MarketService } from '../market/market.service.js';
import { MarketError } from '../market/market.types.js';
import type {
  MerchantListQuery,
  MerchantNearbyQuery,
} from './discovery.dto.js';
import {
  discoveryInvalidParameterError,
  discoveryMarketDisabledError,
  discoveryMarketNotConfiguredError,
  discoveryMerchantNotFoundError,
  discoveryRadiusTooLargeError,
} from './discovery.errors.js';
import {
  OpenNowStatus,
  type CategoryResponse,
  type MerchantCategorySummary,
  type MerchantDetailResponse,
  type MerchantListItemResponse,
  type PaginatedResponse,
  type PublicMerchantPackage,
  type SortOption,
} from './discovery.types.js';

const APPROXIMATE_KM_PER_DEGREE = 111.32;

interface CurrentMarketContext {
  id: string;
  timezone: string;
}

interface DiscoveryRow extends QueryResultRow {
  merchant_id: string;
  display_name: string;
  branch_name: string;
  category: MerchantCategorySummary | null;
  categories: MerchantCategorySummary[];
  is_online: boolean;
  is_offline: boolean;
  distance: number | null;
  packages: PublicMerchantPackage[];
  logo_url: string | null;
  banner_url: string | null;
  about_us: string | null;
  address: unknown;
  business_hours: unknown;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  social_links: unknown;
  gallery: Array<{ url: string; position: number }>;
  longitude: number | null;
  latitude: number | null;
}

interface WeeklyInterval {
  open: string;
  close: string;
}

type WeeklySchedule = Partial<Record<string, WeeklyInterval[]>>;

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

function isTime(value: unknown): value is string {
  return (
    typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)
  );
}

function minutesFromTime(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

@Injectable()
export class DiscoveryService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MarketService) private readonly marketService: MarketService,
  ) {}

  async resolveCurrentMarket(accountId: string): Promise<CurrentMarketContext> {
    let marketId: string;
    try {
      const memberMarket = await this.marketService.getMarket(accountId);
      marketId = memberMarket.currentMarket.id;
    } catch (error) {
      if (error instanceof MarketError) {
        if (
          error.code === 'MARKET_NOT_ACTIVE' ||
          error.code === 'MARKET_NOT_ENABLED'
        ) {
          throw discoveryMarketDisabledError();
        }
        throw discoveryMarketNotConfiguredError();
      }
      throw error;
    }

    if (!marketId) throw discoveryMarketNotConfiguredError();
    const result = await this.database.pool.query<{
      status: string;
      timezone: string;
    }>(
      `select status, timezone
         from markets
        where id = $1`,
      [marketId],
    );
    const market = result.rows[0];
    if (!market) throw discoveryMarketNotConfiguredError();
    if (market.status !== 'ACTIVE') throw discoveryMarketDisabledError();
    return { id: marketId, timezone: market.timezone };
  }

  async listMerchants(
    accountId: string,
    filters: MerchantListQuery,
  ): Promise<PaginatedResponse<MerchantListItemResponse>> {
    this.validateCoordinatesAndRadius(filters);
    const market = await this.resolveCurrentMarket(accountId);
    const rows = await this.queryMerchants(market.id, filters);
    const withOpenStatus = rows.map((row) => ({
      row,
      openNow: this.isOpenNow(row.business_hours, market.timezone),
    }));
    const filtered = withOpenStatus.filter(({ openNow }) => {
      if (filters.openNow === undefined) return true;
      return filters.openNow
        ? openNow === OpenNowStatus.OPEN
        : openNow === OpenNowStatus.CLOSED;
    });
    return this.paginate(
      filtered.map(({ row, openNow }) => this.toListResponse(row, openNow)),
      filters.page,
      filters.pageSize,
    );
  }

  async getMerchant(
    accountId: string,
    merchantBranchId: string,
  ): Promise<MerchantDetailResponse> {
    const market = await this.resolveCurrentMarket(accountId);
    const rows = await this.queryMerchants(market.id, {}, merchantBranchId);
    const row = rows[0];
    if (!row) throw discoveryMerchantNotFoundError();
    const openNow = this.isOpenNow(row.business_hours, market.timezone);
    return {
      ...this.toListResponse(row, openNow),
      categories: row.categories,
      logoUrl: row.logo_url,
      bannerUrl: row.banner_url,
      aboutUs: row.about_us,
      address: row.address,
      businessHours: row.business_hours,
      phone: row.phone,
      whatsapp: row.whatsapp,
      website: row.website,
      socialLinks: row.social_links,
      gallery: row.gallery,
      coordinates:
        row.latitude === null || row.longitude === null
          ? null
          : { latitude: row.latitude, longitude: row.longitude },
    };
  }

  async getCategories(accountId: string): Promise<CategoryResponse[]> {
    const market = await this.resolveCurrentMarket(accountId);
    const result = await this.database.pool.query<CategoryResponse>(
      `select id, code, name, sort_order as "sortOrder"
         from merchant_categories
        where market_id = $1
          and is_active = true
        order by sort_order, lower(name), id`,
      [market.id],
    );
    return result.rows;
  }

  async findNearby(
    accountId: string,
    latitude: number,
    longitude: number,
    radius: number,
    filters: Pick<MerchantNearbyQuery, 'page' | 'pageSize' | 'category'>,
  ): Promise<PaginatedResponse<MerchantListItemResponse>> {
    if (radius > 50) throw discoveryRadiusTooLargeError();
    const listFilters: MerchantListQuery = {
      page: filters.page,
      pageSize: filters.pageSize,
      category: filters.category,
      latitude,
      longitude,
      radius,
      sort: 'distance',
    };
    return this.listMerchants(accountId, listFilters);
  }

  isOpenNow(businessHours: unknown, marketTimezone: string): OpenNowStatus {
    if (
      !businessHours ||
      typeof businessHours !== 'object' ||
      Array.isArray(businessHours)
    ) {
      return OpenNowStatus.UNKNOWN;
    }

    const schedule = businessHours as WeeklySchedule;
    const hasSchedule = Object.values(schedule).some(Array.isArray);
    if (!hasSchedule) return OpenNowStatus.UNKNOWN;

    let weekday: string;
    let currentMinutes: number;
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: marketTimezone,
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date());
      weekday =
        parts.find((part) => part.type === 'weekday')?.value.toLowerCase() ??
        '';
      const hour = Number(
        parts.find((part) => part.type === 'hour')?.value ?? Number.NaN,
      );
      const minute = Number(
        parts.find((part) => part.type === 'minute')?.value ?? Number.NaN,
      );
      if (!weekday || !Number.isFinite(hour) || !Number.isFinite(minute)) {
        return OpenNowStatus.UNKNOWN;
      }
      currentMinutes = hour * 60 + minute;
    } catch {
      return OpenNowStatus.UNKNOWN;
    }

    const dayIndex = WEEKDAYS.indexOf(weekday as (typeof WEEKDAYS)[number]);
    if (dayIndex < 0) return OpenNowStatus.UNKNOWN;
    const previousDay = WEEKDAYS[(dayIndex + 6) % 7];
    const todayIntervals = schedule[weekday] ?? [];
    const previousIntervals = schedule[previousDay ?? ''] ?? [];
    if (!Array.isArray(todayIntervals) || !Array.isArray(previousIntervals)) {
      return OpenNowStatus.UNKNOWN;
    }

    const validInterval = (interval: WeeklyInterval): boolean =>
      isTime(interval?.open) && isTime(interval?.close);
    if (
      !todayIntervals.every(validInterval) ||
      !previousIntervals.every(validInterval)
    ) {
      return OpenNowStatus.UNKNOWN;
    }

    const openToday = todayIntervals.some((interval) => {
      const open = minutesFromTime(interval.open);
      const close = minutesFromTime(interval.close);
      if (close > open) return currentMinutes >= open && currentMinutes < close;
      if (close < open) return currentMinutes >= open;
      return false;
    });
    const openFromPreviousDay = previousIntervals.some((interval) => {
      const open = minutesFromTime(interval.open);
      const close = minutesFromTime(interval.close);
      return close < open && currentMinutes < close;
    });

    return openToday || openFromPreviousDay
      ? OpenNowStatus.OPEN
      : OpenNowStatus.CLOSED;
  }

  private validateCoordinatesAndRadius(filters: MerchantListQuery): void {
    const latitude = filters.latitude;
    const longitude = filters.longitude;
    if ((latitude === undefined) !== (longitude === undefined)) {
      throw discoveryInvalidParameterError(
        'Latitude and longitude must be provided together.',
      );
    }
    if (
      latitude !== undefined &&
      (latitude < -90 || latitude > 90 || !Number.isFinite(latitude))
    ) {
      throw discoveryInvalidParameterError('Latitude is out of range.');
    }
    if (
      longitude !== undefined &&
      (longitude < -180 || longitude > 180 || !Number.isFinite(longitude))
    ) {
      throw discoveryInvalidParameterError('Longitude is out of range.');
    }
    if (filters.radius !== undefined) {
      if (filters.radius > 50) throw discoveryRadiusTooLargeError();
      if (filters.radius <= 0 || latitude === undefined) {
        throw discoveryInvalidParameterError(
          'A positive radius requires coordinates.',
        );
      }
    }
    if (filters.sort === 'distance' && latitude === undefined) {
      throw discoveryInvalidParameterError(
        'Coordinates are required for distance sorting.',
      );
    }
  }

  private async queryMerchants(
    marketId: string,
    filters: Partial<MerchantListQuery>,
    merchantId?: string,
  ): Promise<DiscoveryRow[]> {
    const values: unknown[] = [marketId];
    const addValue = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };
    const conditions = [
      'b.market_id = $1',
      "b.status = 'ACTIVE'",
      'b.is_publicly_visible = true',
    ];

    if (merchantId) {
      const ref = addValue(merchantId);
      conditions.push(`(b.merchant_id = ${ref} or b.id::text = ${ref})`);
    }
    if (filters.category) {
      const ref = addValue(filters.category);
      conditions.push(`exists (
        select 1
          from merchant_branch_categories fbc
          join merchant_categories fc
            on fc.id = fbc.category_id
           and fc.market_id = fbc.market_id
         where fbc.merchant_branch_id = b.id
           and fbc.market_id = b.market_id
           and fc.is_active = true
           and (lower(fc.code) = lower(${ref}) or fc.id::text = ${ref})
      )`);
    }
    if (filters.merchantType === 'ONLINE') {
      conditions.push('b.is_online = true and b.is_offline = false');
    } else if (filters.merchantType === 'OFFLINE') {
      conditions.push('b.is_online = false and b.is_offline = true');
    } else if (filters.merchantType === 'HYBRID') {
      conditions.push('b.is_online = true and b.is_offline = true');
    }
    if (filters.isOnline !== undefined) {
      conditions.push(`b.is_online = ${addValue(filters.isOnline)}`);
    }
    if (filters.isOffline !== undefined) {
      conditions.push(`b.is_offline = ${addValue(filters.isOffline)}`);
    }
    if (filters.city) {
      conditions.push(
        `lower(coalesce(mp.address ->> 'city', '')) = lower(${addValue(filters.city)})`,
      );
    }
    if (filters.region) {
      conditions.push(
        `lower(coalesce(mp.address ->> 'region', '')) = lower(${addValue(filters.region)})`,
      );
    }

    let queryRef: string | undefined;
    if (filters.query) {
      queryRef = addValue(filters.query);
      conditions.push(`(
        b.name % ${queryRef}
        or mg.name % ${queryRef}
        or coalesce(mp.about_us, '') % ${queryRef}
        or b.name ilike '%' || ${queryRef} || '%'
        or mg.name ilike '%' || ${queryRef} || '%'
        or coalesce(mp.about_us, '') ilike '%' || ${queryRef} || '%'
      )`);
    }

    let longitudeRef: string | undefined;
    let latitudeRef: string | undefined;
    if (filters.longitude !== undefined && filters.latitude !== undefined) {
      longitudeRef = addValue(filters.longitude);
      latitudeRef = addValue(filters.latitude);
      if (filters.radius !== undefined) {
        const radiusDegreesRef = addValue(
          filters.radius / APPROXIMATE_KM_PER_DEGREE,
        );
        conditions.push('b.coordinates is not null');
        conditions.push(
          `b.coordinates <@ circle(point(${longitudeRef}, ${latitudeRef}), ${radiusDegreesRef})`,
        );
      }
    }

    const distanceExpression =
      longitudeRef && latitudeRef
        ? `round(((b.coordinates <-> point(${longitudeRef}, ${latitudeRef})) * ${APPROXIMATE_KM_PER_DEGREE})::numeric, 3)::double precision`
        : 'null::double precision';
    const orderBy = this.orderBySql(
      filters.sort ?? 'relevance',
      queryRef,
      longitudeRef,
      latitudeRef,
    );

    const result = await this.database.pool.query<DiscoveryRow>(
      `select
         b.merchant_id,
         mg.name as display_name,
         b.name as branch_name,
         primary_category.category,
         coalesce(all_categories.categories, '[]'::jsonb) as categories,
         b.is_online,
         b.is_offline,
         ${distanceExpression} as distance,
         packages.packages,
         mp.logo_url,
         mp.banner_url,
         mp.about_us,
         mp.address,
         mp.business_hours,
         mp.phone,
         mp.whatsapp,
         mp.website,
         mp.social_links,
         coalesce(gallery.gallery, '[]'::jsonb) as gallery,
         case when b.coordinates is null then null else b.coordinates[0] end as longitude,
         case when b.coordinates is null then null else b.coordinates[1] end as latitude
       from merchant_branches b
       join merchant_groups mg on mg.id = b.merchant_group_id
       join merchant_profiles mp on mp.merchant_branch_id = b.id
       join lateral (
         select jsonb_agg(
                  jsonb_build_object(
                    'code', sfp.code,
                    'name', sfp.name,
                    'description', sfp.description,
                    'rate', sfv.rate::text,
                    'isDefault', mpa.is_default
                  )
                  order by mpa.is_default desc, sfp.name, mpa.id
                ) as packages
           from merchant_package_assignments mpa
           join service_fee_versions sfv
             on sfv.id = mpa.service_fee_version_id
            and sfv.status = 'ACTIVE'
            and sfv.effective_from <= now()
            and (sfv.effective_to is null or sfv.effective_to > now())
           join service_fee_profiles sfp
             on sfp.id = sfv.service_fee_profile_id
          where mpa.merchant_branch_id = b.id
            and mpa.status = 'ACTIVE'
            and (sfv.market_id is null or sfv.market_id = b.market_id)
            and (sfp.market_id is null or sfp.market_id = b.market_id)
         having count(*) > 0
       ) packages on true
       left join lateral (
         select jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name) as category
           from merchant_branch_categories bc
           join merchant_categories c
             on c.id = bc.category_id
            and c.market_id = bc.market_id
          where bc.merchant_branch_id = b.id
            and bc.market_id = b.market_id
            and c.is_active = true
          order by bc.is_primary desc, c.sort_order, lower(c.name), c.id
          limit 1
       ) primary_category on true
       left join lateral (
         select jsonb_agg(
                  jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name)
                  order by bc.is_primary desc, c.sort_order, lower(c.name), c.id
                ) as categories
           from merchant_branch_categories bc
           join merchant_categories c
             on c.id = bc.category_id
            and c.market_id = bc.market_id
          where bc.merchant_branch_id = b.id
            and bc.market_id = b.market_id
            and c.is_active = true
       ) all_categories on true
       left join lateral (
         select jsonb_agg(
                  jsonb_build_object('url', g.media_url, 'position', g.position)
                  order by g.position, g.id
                ) as gallery
           from merchant_profile_gallery_entries g
          where g.merchant_profile_id = mp.id
       ) gallery on true
      where ${conditions.join('\n        and ')}
      order by ${orderBy}`,
      values,
    );
    return result.rows;
  }

  private orderBySql(
    sort: SortOption,
    queryRef?: string,
    longitudeRef?: string,
    latitudeRef?: string,
  ): string {
    if (sort === 'distance' && longitudeRef && latitudeRef) {
      return `b.coordinates <-> point(${longitudeRef}, ${latitudeRef}), lower(b.name), b.id`;
    }
    if (sort === 'newest') {
      return 'b.created_at desc, lower(b.name), b.id';
    }
    if (sort === 'name') {
      return 'lower(b.name), b.id';
    }
    if (queryRef) {
      return `greatest(similarity(b.name, ${queryRef}), similarity(mg.name, ${queryRef}), similarity(coalesce(mp.about_us, ''), ${queryRef})) desc, lower(b.name), b.id`;
    }
    return 'b.display_order, lower(b.name), b.id';
  }

  private toListResponse(
    row: DiscoveryRow,
    openNow: OpenNowStatus,
  ): MerchantListItemResponse {
    return {
      merchantId: row.merchant_id,
      displayName: row.display_name,
      branchName: row.branch_name,
      category: row.category,
      isOnline: row.is_online,
      isOffline: row.is_offline,
      ...(row.distance === null ? {} : { distance: row.distance }),
      openNow,
      packages: row.packages,
    };
  }

  private paginate<T>(
    items: T[],
    page: number,
    pageSize: number,
  ): PaginatedResponse<T> {
    const total = items.length;
    const offset = (page - 1) * pageSize;
    return {
      items: items.slice(offset, offset + pageSize),
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }
}
