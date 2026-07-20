import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  PageHeader,
  Card,
  Badge,
  Skeleton,
  Alert,
  Button,
  EmptyState,
} from '@ipoint/ui';
import {
  QrCode,
  Store,
  ShieldCheck,
  Wallet,
  Globe,
  MapPin,
  ChevronRight,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useAbortController } from '../hooks/useAbortController';

interface ProfileData {
  id: string;
  name?: string;
  email: string;
  countryCode?: string;
  marketCode?: string;
  kycStatus: 'not_started' | 'pending' | 'approved' | 'rejected';
  status?: string;
  createdAt: string;
}

type FetchState = 'idle' | 'loading' | 'error' | 'success';

function QuickCard({
  icon,
  title,
  description,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  onClick?: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <Card
      interactive
      className="ip-quick-card"
      onClick={onClick}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick();
            }
          : undefined
      }
      role={onClick ? 'button' : undefined}
      aria-label={title}
    >
      <div className="ip-quick-card__icon">{icon}</div>
      <div className="ip-quick-card__content">
        <strong>{title}</strong>
        {description && (
          <span className="ip-text-sm ip-text-muted">{description}</span>
        )}
      </div>
      <div className="ip-quick-card__action">
        {badge || <ChevronRight size={18} aria-hidden="true" />}
      </div>
    </Card>
  );
}

export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const abortController = useAbortController();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    setFetchState('loading');
    setFetchError(null);
    try {
      const response = await apiClient.get<{ data: ProfileData }>('/profile', {
        signal: abortController.signal,
      });
      const data = response.data?.data ?? response.data;
      setProfile(data);
      setFetchState('success');
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setFetchState('error');
      setFetchError(t('common.error'));
    }
  }, [abortController, t]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  // Loading state
  if (fetchState === 'loading') {
    return (
      <>
        <PageHeader title={t('home.title')} description={t('home.subtitle')} />
        <div className="ip-home-skeleton">
          <Skeleton width="60%" height="28px" />
          <Skeleton width="100%" height="80px" />
          <Skeleton width="100%" height="80px" />
          <Skeleton width="100%" height="80px" />
          <Skeleton width="100%" height="80px" />
        </div>
      </>
    );
  }

  // Error state
  if (fetchState === 'error') {
    return (
      <>
        <PageHeader title={t('home.title')} description={t('home.subtitle')} />
        <Alert tone="error" title={t('common.error')}>
          <p>{fetchError}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void fetchProfile()}
          >
            {t('common.retry')}
          </Button>
        </Alert>
      </>
    );
  }

  const kycBadgeTone =
    profile?.kycStatus === 'approved'
      ? 'success'
      : profile?.kycStatus === 'pending'
        ? 'warning'
        : profile?.kycStatus === 'rejected'
          ? 'error'
          : 'neutral';

  const kycBadgeText =
    profile?.kycStatus === 'approved'
      ? t('home.kycApprovedLabel')
      : profile?.kycStatus === 'pending'
        ? t('profile.kycPending')
        : profile?.kycStatus === 'rejected'
          ? t('profile.kycRejected')
          : t('home.kycVerifyNow');

  return (
    <>
      <PageHeader
        title={t('home.welcomeMessage', {
          name: profile?.name || t('profile.notProvided'),
        })}
        description={t('home.subtitle')}
      />

      {/* Account Status Alert */}
      {profile?.status === 'suspended' && (
        <Alert tone="error" title={t('home.accountStatus')}>
          <p>{t('home.accountSuspended')}</p>
        </Alert>
      )}

      {/* Market / Country Info */}
      <Card>
        <div className="ip-home-market">
          <div className="ip-home-market__item">
            <MapPin size={16} aria-hidden="true" />
            <span>
              {t('home.accountCountryLabel')}:{' '}
              <strong>{profile?.countryCode || '—'}</strong>
            </span>
          </div>
          <div className="ip-home-market__item">
            <Globe size={16} aria-hidden="true" />
            <span>
              {t('home.currentMarketLabel')}:{' '}
              <strong>{profile?.marketCode || '—'}</strong>
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/market')}
            >
              {t('home.switchMarket')}
            </Button>
          </div>
        </div>
      </Card>

      {/* Quick Actions */}
      <h2 className="ip-section-title">{t('home.quickActions')}</h2>

      <QuickCard
        icon={<QrCode size={24} />}
        title={t('home.myQr')}
        description={t('home.myQrDescription')}
        onClick={() => navigate('/qr')}
      />

      <QuickCard
        icon={<Store size={24} />}
        title={t('merchants.title')}
        description={t('home.merchantDiscoveryDescription')}
        onClick={() => navigate('/merchants')}
      />

      <QuickCard
        icon={<ShieldCheck size={24} />}
        title={t('home.kycStatus')}
        description={t('home.kycStatusDescription')}
        onClick={() => navigate('/kyc')}
        badge={
          profile ? (
            <Badge tone={kycBadgeTone}>{kycBadgeText}</Badge>
          ) : undefined
        }
      />

      {/* Wallet — Coming Soon (Phase 3 NOT_AUTHORIZED) */}
      <Card>
        <EmptyState
          icon={<Wallet size={24} />}
          title={t('home.wallet')}
          description={t('home.walletComingSoon')}
        />
      </Card>
    </>
  );
}
