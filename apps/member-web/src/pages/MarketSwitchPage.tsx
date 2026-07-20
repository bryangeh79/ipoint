import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader, Card, Badge, Skeleton, Alert, Button } from '@ipoint/ui';
import { Globe, MapPin, CheckCircle } from 'lucide-react';
import { apiClient } from '../api/client';
import { useAbortController } from '../hooks/useAbortController';

interface Market {
  id: string;
  code: string;
  name: string;
  currency: string;
  isActive: boolean;
  isCurrent?: boolean;
}

interface ProfileInfo {
  countryCode?: string;
  marketCode?: string;
}

type FetchState = 'idle' | 'loading' | 'error' | 'success';
type SwitchState = 'idle' | 'switching' | 'success' | 'error';

export function MarketSwitchPage() {
  const { t } = useTranslation();
  const abortController = useAbortController();

  const [markets, setMarkets] = useState<Market[]>([]);
  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [switchState, setSwitchState] = useState<SwitchState>('idle');
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [currentMarketCode, setCurrentMarketCode] = useState<string | null>(
    null,
  );

  const fetchData = useCallback(async () => {
    setFetchState('loading');
    setFetchError(null);
    try {
      // Fetch both markets list and current profile in parallel
      const [marketsRes, profileRes] = await Promise.all([
        apiClient.get<{ data: Market[] }>('/markets', {
          signal: abortController.signal,
        }),
        apiClient.get<{ data: ProfileInfo }>('/profile', {
          signal: abortController.signal,
        }),
      ]);

      const marketsData = ((marketsRes.data as Record<string, unknown>)?.data ??
        marketsRes.data) as Market[];
      const profileData = ((profileRes.data as Record<string, unknown>)?.data ??
        profileRes.data) as ProfileInfo;

      setProfile(profileData);
      setCurrentMarketCode(profileData.marketCode ?? null);

      // Mark current market
      const updatedMarkets = marketsData.map((m: Market) => ({
        ...m,
        isCurrent: m.code === profileData.marketCode,
      }));
      setMarkets(updatedMarkets);
      setFetchState('success');
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setFetchState('error');
      setFetchError(t('common.error'));
    }
  }, [abortController, t]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleSwitch = useCallback(
    async (marketCode: string) => {
      if (switchState === 'switching') return;
      setSwitchState('switching');
      setSwitchError(null);

      try {
        await apiClient.post('/markets/switch', { marketCode });
        setCurrentMarketCode(marketCode);
        setMarkets((prev) =>
          prev.map((m) => ({ ...m, isCurrent: m.code === marketCode })),
        );
        setSwitchState('success');

        // Reset success state after a delay
        setTimeout(() => setSwitchState('idle'), 3000);
      } catch {
        setSwitchState('error');
        setSwitchError(t('market.switchFailed'));
      }
    },
    [switchState, t],
  );

  if (fetchState === 'loading') {
    return (
      <>
        <PageHeader title={t('market.switchTitle')} />
        <Card>
          <Skeleton width="100%" height="60px" />
          <Skeleton width="100%" height="60px" />
          <Skeleton width="100%" height="60px" />
        </Card>
      </>
    );
  }

  if (fetchState === 'error') {
    return (
      <>
        <PageHeader title={t('market.switchTitle')} />
        <Alert tone="error" title={t('common.error')}>
          <p>{fetchError}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void fetchData()}
          >
            {t('common.retry')}
          </Button>
        </Alert>
      </>
    );
  }

  const currentMarket = markets.find((m) => m.isCurrent);

  return (
    <>
      <PageHeader title={t('market.switchTitle')} />

      {/* Account Country vs Current Market distinction */}
      <Card>
        <div className="ip-market-info">
          <div className="ip-market-info__item">
            <MapPin size={18} aria-hidden="true" />
            <span>
              <strong>{t('market.accountCountryLabel')}:</strong>{' '}
              {profile?.countryCode || '—'}
            </span>
          </div>
          <div className="ip-market-info__item">
            <Globe size={18} aria-hidden="true" />
            <span>
              <strong>{t('market.marketLabel')}:</strong>{' '}
              {currentMarketCode || '—'}
            </span>
          </div>
        </div>
      </Card>

      {/* Success alert */}
      {switchState === 'success' && (
        <Alert tone="success" title={t('market.switchConfirmTitle')}>
          <p>
            {t('market.switchConfirmMessage', {
              market: currentMarket?.name ?? currentMarketCode,
            })}
          </p>
          <p className="ip-text-sm">{t('market.refreshNote')}</p>
        </Alert>
      )}

      {/* Error alert */}
      {switchState === 'error' && switchError && (
        <Alert tone="error" title={t('common.error')}>
          <p>{switchError}</p>
        </Alert>
      )}

      {/* Current Market Highlight */}
      {currentMarket && (
        <Card>
          <h3 className="ip-section-title">{t('market.currentMarket')}</h3>
          <div className="ip-market-current">
            <div className="ip-market-flag ip-market-flag--current">
              {currentMarket.code.slice(0, 2)}
            </div>
            <div>
              <strong>{currentMarket.name}</strong>
              <Badge tone="success">{t('profile.kycApproved')}</Badge>
            </div>
            <CheckCircle size={20} aria-hidden="true" />
          </div>
        </Card>
      )}

      {/* Available Markets */}
      <Card>
        <h3 className="ip-section-title">{t('market.availableMarkets')}</h3>
        <div className="ip-market-list">
          {markets.length === 0 && (
            <p className="ip-text-muted">{t('common.comingSoonDescription')}</p>
          )}
          {markets
            .filter((m) => !m.isCurrent)
            .map((market) => (
              <div
                key={market.id}
                className={`ip-market-card ${!market.isActive ? 'ip-market-card--disabled' : ''}`}
              >
                <div className="ip-market-card__info">
                  <div className="ip-market-flag">
                    {market.code.slice(0, 2)}
                  </div>
                  <div>
                    <strong>{market.name}</strong>
                    <span className="ip-text-muted">{market.currency}</span>
                  </div>
                </div>
                <div className="ip-market-card__action">
                  {market.isActive ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={switchState === 'switching'}
                      disabled={switchState === 'switching'}
                      onClick={() => handleSwitch(market.code)}
                    >
                      {t('market.switchTo', { market: market.name })}
                    </Button>
                  ) : (
                    <Badge tone="neutral">{t('market.comingSoon')}</Badge>
                  )}
                </div>
              </div>
            ))}
        </div>
      </Card>
    </>
  );
}
