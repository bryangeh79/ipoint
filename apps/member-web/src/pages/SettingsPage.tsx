import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageHeader, Card, Switch, Button, Skeleton, Alert } from '@ipoint/ui';
import { Globe, MapPin, LogOut, Info, ChevronRight } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { apiClient } from '../api/client';
import { useAbortController } from '../hooks/useAbortController';

interface ProfileInfo {
  countryCode?: string;
  marketCode?: string;
}

type FetchState = 'idle' | 'loading' | 'error' | 'success';

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const abortController = useAbortController();

  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const fetchProfile = useCallback(async () => {
    setFetchState('loading');
    setFetchError(null);
    try {
      const response = await apiClient.get<{ data: ProfileInfo }>('/profile', {
        signal: abortController.signal,
      });
      const data = response.data?.data ?? response.data;
      setProfile(data);
      setFetchState('success');
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setFetchState('error');
      setFetchError(err instanceof Error ? err.message : t('common.error'));
    }
  }, [abortController, t]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  const handleLanguageChange = useCallback(
    (checked: boolean) => {
      const newLang = checked ? 'zh' : 'en';
      void i18n.changeLanguage(newLang);
    },
    [i18n],
  );

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      setLoggingOut(false);
    }
  }, [logout]);

  const countryNames: Record<string, string> = {
    MY: 'Malaysia',
    SG: 'Singapore',
    VN: 'Vietnam',
    TH: 'Thailand',
    ID: 'Indonesia',
    PH: 'Philippines',
  };

  return (
    <>
      <PageHeader title={t('settings.title')} />

      {/* Language */}
      <Card>
        <h3 className="ip-section-title">{t('settings.language')}</h3>
        <Switch
          checked={i18n.language === 'zh'}
          onCheckedChange={handleLanguageChange}
          label={
            i18n.language === 'zh'
              ? t('settings.languageZh')
              : t('settings.languageEn')
          }
          description={
            i18n.language === 'zh' ? 'Switch to English' : '切换到中文'
          }
        />
      </Card>

      {/* Account Country */}
      <Card>
        <h3 className="ip-section-title">{t('settings.accountCountry')}</h3>
        {fetchState === 'loading' ? (
          <Skeleton width="120px" height="20px" />
        ) : fetchState === 'error' ? (
          <Alert tone="error">
            <p>{fetchError}</p>
          </Alert>
        ) : (
          <div className="ip-settings-row">
            <MapPin size={18} aria-hidden="true" />
            <span>
              {profile?.countryCode
                ? `${countryNames[profile.countryCode] ?? profile.countryCode} (${profile.countryCode})`
                : '—'}
            </span>
          </div>
        )}
      </Card>

      {/* Current Market */}
      <Card>
        <h3 className="ip-section-title">{t('settings.currentMarket')}</h3>
        {fetchState === 'loading' ? (
          <Skeleton width="120px" height="20px" />
        ) : fetchState === 'error' ? (
          <Alert tone="error">
            <p>{fetchError}</p>
          </Alert>
        ) : (
          <div className="ip-settings-row">
            <Globe size={18} aria-hidden="true" />
            <span>{profile?.marketCode || '—'}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/market')}
            >
              {t('settings.changeMarket')}
              <ChevronRight size={14} aria-hidden="true" />
            </Button>
          </div>
        )}
      </Card>

      {/* Logout */}
      <Card>
        <h3 className="ip-section-title">{t('settings.account')}</h3>
        <Button
          variant="danger"
          fullWidth
          loading={loggingOut}
          loadingLabel={t('settings.logout')}
          onClick={() => void handleLogout()}
        >
          <LogOut size={18} aria-hidden="true" />
          <span>{t('settings.logout')}</span>
        </Button>
      </Card>

      {/* App Version */}
      <Card>
        <h3 className="ip-section-title">{t('settings.appVersion')}</h3>
        <div className="ip-settings-row">
          <Info size={18} aria-hidden="true" />
          <span>{t('settings.version')}</span>
        </div>
      </Card>
    </>
  );
}
