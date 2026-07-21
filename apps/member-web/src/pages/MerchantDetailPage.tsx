import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  PageHeader,
  Card,
  Badge,
  Alert,
  Button,
  EmptyState,
  Skeleton,
} from '@ipoint/ui';
import {
  Store,
  MapPin,
  Phone,
  Globe,
  Mail,
  Clock,
  ArrowLeft,
  ImageOff,
  ExternalLink,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useAbortController } from '../hooks/useAbortController';
import type { MerchantDetailResponse } from '../api/types';

type FetchState = 'loading' | 'success' | 'error';

export function MerchantDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id: merchantId } = useParams<{ id: string }>();
  const abortController = useAbortController();

  const [merchant, setMerchant] = useState<MerchantDetailResponse | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const [notFound, setNotFound] = useState(false);

  const fetchMerchant = useCallback(async () => {
    if (!merchantId) return;
    setFetchState('loading');
    setError(null);
    setNotFound(false);

    try {
      const response = await apiClient.get<MerchantDetailResponse>(
        `/members/merchants/${encodeURIComponent(merchantId)}`,
        { signal: abortController.signal },
      );
      setMerchant(response.data);
      setFetchState('success');
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const apiErr = err as { status?: number; body?: { code?: string } };
      if (apiErr.status === 404) {
        setNotFound(true);
        setFetchState('error');
      } else {
        setError(t('merchants.loadMerchantError'));
        setFetchState('error');
      }
    }
  }, [merchantId, abortController, t]);

  useEffect(() => {
    void fetchMerchant();
  }, [fetchMerchant]);

  const handleImageError = useCallback((url: string) => {
    setBrokenImages((prev) => new Set(prev).add(url));
  }, []);

  const handleBack = useCallback(() => {
    void navigate('/merchants');
  }, [navigate]);

  const isExternalUrlSafe = useCallback((url: string | null): boolean => {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, []);

  const buildMapsUrl = useCallback(
    (lat: number | null, lng: number | null): string | null => {
      if (lat === null || lng === null) return null;
      return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    },
    [],
  );

  const buildWazeUrl = useCallback(
    (lat: number | null, lng: number | null): string | null => {
      if (lat === null || lng === null) return null;
      return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
    },
    [],
  );

  const openNowBadge = () => {
    if (!merchant) return null;
    if (merchant.openNow === 'OPEN')
      return <Badge tone="success">{t('merchants.open')}</Badge>;
    if (merchant.openNow === 'CLOSED')
      return <Badge tone="neutral">{t('merchants.closed')}</Badge>;
    return null;
  };

  // Loading
  if (fetchState === 'loading') {
    return (
      <>
        <PageHeader
          title={t('merchants.pageTitle')}
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              aria-label={t('merchants.backToMerchants')}
            >
              <ArrowLeft size={18} />
            </Button>
          }
        />
        <div className="ip-merchant-detail-skeleton">
          <Skeleton width="100%" height="200px" />
          <Skeleton width="70%" height="28px" />
          <Skeleton width="50%" height="20px" />
          <Skeleton width="100%" height="120px" />
        </div>
      </>
    );
  }

  // Error / not found
  if (fetchState === 'error') {
    return (
      <>
        <PageHeader
          title={
            notFound
              ? t('merchants.merchantNotFound')
              : t('merchants.pageTitle')
          }
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              aria-label={t('merchants.backToMerchants')}
            >
              <ArrowLeft size={18} />
            </Button>
          }
        />
        {notFound ? (
          <EmptyState
            icon={<Store size={48} />}
            title={t('merchants.merchantNotFound')}
            description={t('merchants.merchantNotFoundDescription')}
            action={
              <Button variant="secondary" onClick={handleBack}>
                {t('merchants.backToMerchants')}
              </Button>
            }
          />
        ) : (
          <Alert tone="error" title={t('merchants.loadMerchantError')}>
            <p>{error}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void fetchMerchant()}
            >
              {t('merchants.retryMerchant')}
            </Button>
          </Alert>
        )}
      </>
    );
  }

  if (!merchant) return null;

  const mapsUrl = buildMapsUrl(
    merchant.coordinates?.latitude ?? null,
    merchant.coordinates?.longitude ?? null,
  );
  const wazeUrl = buildWazeUrl(
    merchant.coordinates?.latitude ?? null,
    merchant.coordinates?.longitude ?? null,
  );
  const hasLogo = merchant.logoUrl && !brokenImages.has(merchant.logoUrl);
  const hasBanner = merchant.bannerUrl && !brokenImages.has(merchant.bannerUrl);

  return (
    <>
      <PageHeader
        title={merchant.displayName}
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            aria-label={t('merchants.backToMerchants')}
          >
            <ArrowLeft size={18} />
          </Button>
        }
      />

      {/* Banner */}
      {hasBanner && (
        <div className="ip-merchant-detail__banner">
          <img
            src={merchant.bannerUrl!}
            alt={`${merchant.displayName} banner`}
            className="ip-merchant-detail__banner-img"
            onError={() => handleImageError(merchant.bannerUrl!)}
          />
        </div>
      )}

      <div
        className="ip-merchant-detail"
        role="region"
        aria-label={merchant.displayName}
      >
        {/* Main info */}
        <Card className="ip-merchant-detail__header">
          <div className="ip-merchant-detail__header-content">
            <div className="ip-merchant-detail__logo-wrapper">
              {hasLogo ? (
                <img
                  src={merchant.logoUrl!}
                  alt={`${merchant.displayName} logo`}
                  className="ip-merchant-detail__logo"
                  onError={() => handleImageError(merchant.logoUrl!)}
                />
              ) : (
                <div
                  className="ip-merchant-detail__logo-fallback"
                  aria-hidden="true"
                >
                  <Store size={32} />
                </div>
              )}
            </div>
            <div className="ip-merchant-detail__title-section">
              <h2 className="ip-merchant-detail__name">
                {merchant.displayName}
              </h2>
              {merchant.branchName && (
                <p className="ip-merchant-detail__branch">
                  {merchant.branchName}
                </p>
              )}
              <div className="ip-merchant-detail__badges">
                {merchant.category && (
                  <Badge tone="neutral">{merchant.category.name}</Badge>
                )}
                {openNowBadge()}
                {merchant.isOnline && !merchant.isOffline && (
                  <Badge tone="success">{t('merchants.statusOnline')}</Badge>
                )}
                {!merchant.isOnline && merchant.isOffline && (
                  <Badge tone="neutral">{t('merchants.statusOffline')}</Badge>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Contact info */}
        <Card className="ip-merchant-detail__section">
          <h3 className="ip-merchant-detail__section-title">
            {t('merchants.address')}
          </h3>
          <div className="ip-merchant-detail__info-grid">
            {/* Address */}
            <div className="ip-merchant-detail__info-item">
              <MapPin size={16} aria-hidden="true" />
              <span>
                {String(merchant.address ?? t('merchants.noAddress'))}
              </span>
            </div>

            {/* Phone */}
            {merchant.phone && (
              <div className="ip-merchant-detail__info-item">
                <Phone size={16} aria-hidden="true" />
                <a
                  href={`tel:${merchant.phone}`}
                  className="ip-merchant-detail__link"
                >
                  {merchant.phone}
                </a>
              </div>
            )}

            {/* Website */}
            {merchant.website && isExternalUrlSafe(merchant.website) && (
              <div className="ip-merchant-detail__info-item">
                <Globe size={16} aria-hidden="true" />
                <a
                  href={merchant.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ip-merchant-detail__link"
                >
                  {t('merchants.website')}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              </div>
            )}

            {/* Email */}
            {merchant.email && (
              <div className="ip-merchant-detail__info-item">
                <Mail size={16} aria-hidden="true" />
                <a
                  href={`mailto:${merchant.email}`}
                  className="ip-merchant-detail__link"
                >
                  {merchant.email}
                </a>
              </div>
            )}
          </div>
        </Card>

        {/* Directions */}
        {(mapsUrl || wazeUrl) && (
          <Card className="ip-merchant-detail__section">
            <h3 className="ip-merchant-detail__section-title">
              {t('merchants.getDirections')}
            </h3>
            <div className="ip-merchant-detail__direction-buttons">
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ip-button ip-button--secondary ip-button--md"
                >
                  {t('merchants.googleMaps')}
                </a>
              )}
              {wazeUrl && (
                <a
                  href={wazeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ip-button ip-button--secondary ip-button--md"
                >
                  {t('merchants.waze')}
                </a>
              )}
            </div>
          </Card>
        )}

        {/* Operating Hours */}
        {Boolean(merchant.businessHours) && (
          <Card className="ip-merchant-detail__section">
            <h3 className="ip-merchant-detail__section-title">
              <Clock size={16} aria-hidden="true" />
              {t('merchants.operatingHours')}
            </h3>
            <MerchantBusinessHours hours={merchant.businessHours} />
          </Card>
        )}

        {/* About Us */}
        <Card className="ip-merchant-detail__section">
          <h3 className="ip-merchant-detail__section-title">
            {t('merchants.aboutUs')}
          </h3>
          <p className="ip-merchant-detail__about-text">
            {merchant.aboutUs || t('merchants.noAbout')}
          </p>
        </Card>

        {/* Gallery */}
        {merchant.gallery && merchant.gallery.length > 0 && (
          <Card className="ip-merchant-detail__section">
            <h3 className="ip-merchant-detail__section-title">
              {t('merchants.gallery')}
            </h3>
            <div className="ip-merchant-detail__gallery">
              {merchant.gallery.map((item, idx) => (
                <div
                  key={`${item.url}-${idx}`}
                  className="ip-merchant-detail__gallery-item"
                >
                  {!brokenImages.has(item.url) ? (
                    <img
                      src={item.url}
                      alt={`${merchant.displayName} photo ${idx + 1}`}
                      className="ip-merchant-detail__gallery-img"
                      onError={() => handleImageError(item.url)}
                      loading="lazy"
                    />
                  ) : (
                    <div
                      className="ip-merchant-detail__gallery-fallback"
                      aria-hidden="true"
                    >
                      <ImageOff size={24} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Packages / service info (display only) */}
        {merchant.packages && merchant.packages.length > 0 && (
          <Card className="ip-merchant-detail__section">
            <h3 className="ip-merchant-detail__section-title">
              {t('merchants.promotion')}
            </h3>
            <div className="ip-merchant-detail__packages">
              {merchant.packages.map((pkg) => (
                <div key={pkg.code} className="ip-merchant-detail__package">
                  <span className="ip-merchant-detail__package-name">
                    {pkg.name}
                  </span>
                  <Badge tone={pkg.isDefault ? 'success' : 'neutral'}>
                    {pkg.rate}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Business Hours Display                                             */
/* ------------------------------------------------------------------ */

interface WeeklyInterval {
  open: string;
  close: string;
}

type WeeklySchedule = Partial<Record<string, WeeklyInterval[]>>;

const DAY_ORDER = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const DAY_LABELS: Record<string, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

function MerchantBusinessHours({ hours }: { hours: unknown }) {
  const { t } = useTranslation();

  if (!hours || typeof hours !== 'object' || Array.isArray(hours)) {
    return <p className="ip-text-muted">{t('merchants.unknownStatus')}</p>;
  }

  const schedule = hours as WeeklySchedule;
  const hasSchedule = Object.values(schedule).some(Array.isArray);

  if (!hasSchedule) {
    return <p className="ip-text-muted">{t('merchants.unknownStatus')}</p>;
  }

  const today = new Date()
    .toLocaleDateString('en-US', { weekday: 'long' })
    .toLowerCase();

  return (
    <div className="ip-merchant-detail__hours">
      {DAY_ORDER.map((day) => {
        const intervals = schedule[day];
        const isToday = day === today;

        return (
          <div
            key={day}
            className={`ip-merchant-detail__hours-row ${isToday ? 'ip-merchant-detail__hours-row--today' : ''}`}
          >
            <span className="ip-merchant-detail__hours-day">
              {DAY_LABELS[day] ?? day}
              {isToday && <Badge tone="brand">{t('merchants.open')}</Badge>}
            </span>
            <span className="ip-merchant-detail__hours-time">
              {Array.isArray(intervals) && intervals.length > 0
                ? intervals
                    .map((interval) => `${interval.open} – ${interval.close}`)
                    .join(', ')
                : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
