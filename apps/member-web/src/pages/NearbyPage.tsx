import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  PageHeader,
  Card,
  Badge,
  Alert,
  Button,
  EmptyState,
  Skeleton,
  Select,
  FormField,
} from '@ipoint/ui';
import {
  MapPin,
  Store,
  Navigation,
  ChevronRight,
  Crosshair,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useAbortController } from '../hooks/useAbortController';
import type {
  MerchantListItem,
  PaginatedResponse,
  CategoryResponse,
  OpenNowStatus,
} from '../api/types';

type FetchState =
  | 'idle'
  | 'getting-location'
  | 'loading'
  | 'success'
  | 'error'
  | 'denied'
  | 'unavailable'
  | 'timeout';

interface CoordState {
  latitude: number;
  longitude: number;
}

export function NearbyPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const abortController = useAbortController();

  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [merchants, setMerchants] = useState<MerchantListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<CoordState | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categories, setCategories] = useState<CategoryResponse[]>([]);
  const [radius, setRadius] = useState(5);

  const watchIdRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Load categories
  useEffect(() => {
    const load = async () => {
      try {
        const response = await apiClient.get<CategoryResponse[]>(
          '/members/merchant-categories',
          { signal: abortController.signal },
        );
        if (mountedRef.current) {
          setCategories(response.data);
        }
      } catch {
        // Non-critical
      }
    };
    void load();
  }, [abortController]);

  // Get location
  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      if (mountedRef.current) {
        setFetchState('unavailable');
      }
      return;
    }

    setFetchState('getting-location');

    // Check permission state
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((permState) => {
        if (permState.state === 'denied') {
          if (mountedRef.current) {
            setFetchState('denied');
          }
          return;
        }
      })
      .catch(() => {
        // Permission API not supported — continue anyway
      });

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        if (!mountedRef.current) return;
        const { latitude, longitude } = position.coords;
        setCoords({ latitude, longitude });
        setFetchState('loading');
        void fetchNearbyMerchants(latitude, longitude);
      },
      (geoError) => {
        if (!mountedRef.current) return;
        switch (geoError.code) {
          case geoError.PERMISSION_DENIED:
            setFetchState('denied');
            break;
          case geoError.POSITION_UNAVAILABLE:
            setFetchState('unavailable');
            break;
          case geoError.TIMEOUT:
            setFetchState('timeout');
            break;
          default:
            setFetchState('unavailable');
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 300000, // 5 min cache
      },
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch nearby merchants
  const fetchNearbyMerchants = useCallback(
    async (latitude: number, longitude: number) => {
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('latitude', String(latitude));
        params.set('longitude', String(longitude));
        params.set('radius', String(radius));
        params.set('page', '1');
        params.set('pageSize', '50');
        if (categoryFilter) {
          params.set('category', categoryFilter);
        }

        const response = await apiClient.get<
          PaginatedResponse<MerchantListItem>
        >(`/members/merchants/nearby?${params.toString()}`, {
          signal: abortController.signal,
        });

        if (mountedRef.current) {
          setMerchants(response.data.items);
          setFetchState('success');
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (mountedRef.current) {
          setError(t('nearby.loadError'));
          setFetchState('error');
        }
      }
    },
    [radius, categoryFilter, abortController, t],
  );

  // Initial location request
  useEffect(() => {
    requestLocation();
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [requestLocation]);

  // Re-fetch when radius or category changes
  const refreshWithFilters = useCallback(() => {
    if (coords) {
      setFetchState('loading');
      void fetchNearbyMerchants(coords.latitude, coords.longitude);
    }
  }, [coords, fetchNearbyMerchants]);

  useEffect(() => {
    if (coords && (fetchState === 'success' || fetchState === 'loading')) {
      void fetchNearbyMerchants(coords.latitude, coords.longitude);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius, categoryFilter]);

  const handleMerchantClick = useCallback(
    (merchantId: string) => {
      void navigate(`/merchants/${encodeURIComponent(merchantId)}`);
    },
    [navigate],
  );

  const openNowBadge = (openNow: OpenNowStatus | undefined) => {
    if (openNow === 'OPEN')
      return <Badge tone="success">{t('merchants.open')}</Badge>;
    if (openNow === 'CLOSED')
      return <Badge tone="neutral">{t('merchants.closed')}</Badge>;
    return null;
  };

  // Render loading location
  if (fetchState === 'getting-location') {
    return (
      <>
        <PageHeader title={t('nearby.title')} />
        <Card>
          <div className="ip-nearby-loading">
            <Skeleton width="100%" height="80px" />
            <Skeleton width="100%" height="80px" />
            <Skeleton width="100%" height="80px" />
            <p className="ip-nearby-loading__text">
              <Crosshair size={16} aria-hidden="true" />
              {t('nearby.loadingLocation')}
            </p>
          </div>
        </Card>
      </>
    );
  }

  // Permission denied
  if (fetchState === 'denied') {
    return (
      <>
        <PageHeader title={t('nearby.title')} />
        <EmptyState
          icon={<MapPin size={48} />}
          title={t('nearby.noLocationAccess')}
          description={t('nearby.noLocationAccessDescription')}
        />
      </>
    );
  }

  // Unavailable
  if (fetchState === 'unavailable') {
    return (
      <>
        <PageHeader title={t('nearby.title')} />
        <EmptyState
          icon={<Navigation size={48} />}
          title={t('nearby.locationUnavailable')}
          description={t('nearby.locationUnavailableDescription')}
          action={
            <Button variant="secondary" onClick={requestLocation}>
              {t('nearby.retryLocation')}
            </Button>
          }
        />
      </>
    );
  }

  // Timeout
  if (fetchState === 'timeout') {
    return (
      <>
        <PageHeader title={t('nearby.title')} />
        <EmptyState
          icon={<Navigation size={48} />}
          title={t('nearby.locationTimeout')}
          description={t('nearby.locationTimeoutDescription')}
          action={
            <Button variant="secondary" onClick={requestLocation}>
              {t('nearby.retryLocation')}
            </Button>
          }
        />
      </>
    );
  }

  // Loading merchants
  if (fetchState === 'loading') {
    return (
      <>
        <PageHeader title={t('nearby.title')} />
        <Card>
          <div className="ip-nearby-loading">
            <Skeleton width="100%" height="80px" />
            <Skeleton width="100%" height="80px" />
            <Skeleton width="100%" height="80px" />
            <p className="ip-nearby-loading__text">
              <MapPin size={16} aria-hidden="true" />
              {t('nearby.loadingMerchants')}
            </p>
          </div>
        </Card>
      </>
    );
  }

  // Error
  if (fetchState === 'error') {
    return (
      <>
        <PageHeader title={t('nearby.title')} />
        <Alert tone="error" title={t('nearby.loadError')}>
          <p>{error}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (coords) {
                void fetchNearbyMerchants(coords.latitude, coords.longitude);
              } else {
                requestLocation();
              }
            }}
          >
            {t('nearby.retryLoad')}
          </Button>
        </Alert>
      </>
    );
  }

  // Success
  return (
    <>
      <PageHeader title={t('nearby.title')} />

      {/* Filters */}
      <div className="ip-nearby-filters">
        <div className="ip-nearby-filter-row">
          <FormField
            label={t('nearby.categoryFilter')}
            htmlFor="nearby-category"
            className="ip-nearby-filter-field"
          >
            <Select
              id="nearby-category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">{t('nearby.allCategories')}</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.code}>
                  {cat.name}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            label={t('nearby.radiusOptions')}
            htmlFor="nearby-radius"
            className="ip-nearby-filter-field"
          >
            <Select
              id="nearby-radius"
              value={String(radius)}
              onChange={(e) => setRadius(Number(e.target.value))}
            >
              {[1, 3, 5, 10, 25, 50].map((r) => (
                <option key={r} value={String(r)}>
                  {t('nearby.radiusKm', { value: r })}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <p className="ip-nearby-result-count">
          {merchants.length > 0
            ? t('nearby.radius', { radius })
            : t('nearby.noNearbyMerchants')}
        </p>
      </div>

      {/* Empty */}
      {merchants.length === 0 && (
        <EmptyState
          icon={<MapPin size={48} />}
          title={t('nearby.noNearbyMerchants')}
          description={t('nearby.noNearbyMerchantsDescription')}
        />
      )}

      {/* Results */}
      {merchants.length > 0 && (
        <div className="ip-nearby-list">
          <p className="ip-nearby-sort-info">{t('nearby.sortByDistance')}</p>
          {merchants.map((merchant) => (
            <Card
              key={merchant.merchantId}
              interactive
              className="ip-nearby-card"
              onClick={() => handleMerchantClick(merchant.merchantId)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  handleMerchantClick(merchant.merchantId);
                }
              }}
              role="button"
              aria-label={`${merchant.displayName} - ${merchant.distance !== undefined ? t('nearby.distanceAway', { distance: `${merchant.distance.toFixed(1)} km` }) : ''}`}
            >
              <div className="ip-nearby-card__info">
                <strong className="ip-nearby-card__name">
                  {merchant.displayName}
                </strong>
                {merchant.branchName && (
                  <span className="ip-nearby-card__branch">
                    {merchant.branchName}
                  </span>
                )}
                <div className="ip-nearby-card__meta">
                  {merchant.category && (
                    <Badge tone="neutral">{merchant.category.name}</Badge>
                  )}
                  {openNowBadge(merchant.openNow)}
                </div>
              </div>
              <div className="ip-nearby-card__distance-section">
                {merchant.distance !== undefined && (
                  <span className="ip-nearby-card__distance">
                    {t('merchants.distanceKm', {
                      distance: merchant.distance.toFixed(1),
                    })}
                  </span>
                )}
                <ChevronRight size={18} aria-hidden="true" />
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
