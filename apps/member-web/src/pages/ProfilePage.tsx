import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageHeader, Card, Badge, Skeleton, Alert, Button } from '@ipoint/ui';
import {
  User,
  Mail,
  Phone,
  Calendar,
  VenusMars,
  ShieldCheck,
  MapPin,
  Globe,
  Pencil,
} from 'lucide-react';
import { apiClient } from '../api/client.ts';
import { useAbortController } from '../hooks/useAbortController.ts';

interface ProfileData {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  birthDate?: string;
  gender?: string;
  kycStatus: 'not_started' | 'pending' | 'approved' | 'rejected';
  countryCode?: string;
  marketCode?: string;
  createdAt: string;
}

type FetchState = 'idle' | 'loading' | 'error' | 'success';

function getKycBadgeTone(
  status: ProfileData['kycStatus'],
): 'success' | 'warning' | 'error' | 'neutral' {
  switch (status) {
    case 'approved':
      return 'success';
    case 'pending':
      return 'warning';
    case 'rejected':
      return 'error';
    default:
      return 'neutral';
  }
}

function getKycLabel(
  t: (key: string) => string,
  status: ProfileData['kycStatus'],
): string {
  switch (status) {
    case 'approved':
      return t('profile.kycApproved');
    case 'pending':
      return t('profile.kycPending');
    case 'rejected':
      return t('profile.kycRejected');
    default:
      return t('profile.kycNotStarted');
  }
}

function formatGender(gender?: string): string {
  if (!gender || gender === 'unspecified') return '';
  switch (gender.toLowerCase()) {
    case 'male':
      return 'Male';
    case 'female':
      return 'Female';
    default:
      return gender;
  }
}

function ProfileField({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
}) {
  return (
    <div className="ip-profile-field">
      <div className="ip-profile-field__icon">{icon}</div>
      <div className="ip-profile-field__content">
        <span className="ip-profile-field__label">{label}</span>
        <span className="ip-profile-field__value">{value || '—'}</span>
      </div>
    </div>
  );
}

export function ProfilePage() {
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
      // Handle both wrapped and unwrapped responses
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

  if (fetchState === 'loading') {
    return (
      <>
        <PageHeader title={t('profile.title')} />
        <Card>
          <div className="ip-profile-skeleton">
            <Skeleton width="100%" height="40px" />
            <Skeleton width="80%" height="20px" />
            <Skeleton width="60%" height="20px" />
            <Skeleton width="70%" height="20px" />
            <Skeleton width="50%" height="20px" />
          </div>
        </Card>
      </>
    );
  }

  if (fetchState === 'error') {
    return (
      <>
        <PageHeader title={t('profile.title')} />
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

  if (!profile) {
    return (
      <>
        <PageHeader title={t('profile.title')} />
        <Card>
          <p>{t('common.loading')}</p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('profile.title')}
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate('/profile/edit')}
          >
            <Pencil size={16} aria-hidden="true" />
            <span>{t('profile.editButton')}</span>
          </Button>
        }
      />

      <Card>
        <div className="ip-profile-header">
          <div className="ip-profile-avatar" aria-hidden="true">
            <User size={32} />
          </div>
          <div>
            <h2 className="ip-profile-name">
              {profile.name || t('profile.notProvided')}
            </h2>
            <Badge tone={getKycBadgeTone(profile.kycStatus)}>
              {getKycLabel(t, profile.kycStatus)}
            </Badge>
          </div>
        </div>

        <div className="ip-profile-fields">
          <ProfileField
            icon={<Mail size={18} />}
            label={t('profile.email')}
            value={profile.email}
          />
          <ProfileField
            icon={<Phone size={18} />}
            label={t('profile.phone')}
            value={profile.phone}
          />
          <ProfileField
            icon={<Calendar size={18} />}
            label={t('profile.birthDate')}
            value={profile.birthDate}
          />
          <ProfileField
            icon={<VenusMars size={18} />}
            label={t('profile.gender')}
            value={formatGender(profile.gender)}
          />
          <ProfileField
            icon={<ShieldCheck size={18} />}
            label={t('profile.kycStatus')}
            value={getKycLabel(t, profile.kycStatus)}
          />
        </div>
      </Card>

      <Card>
        <h3 className="ip-section-title">{t('profile.accountCountry')}</h3>
        <ProfileField
          icon={<MapPin size={18} />}
          label={t('profile.accountCountry')}
          value={profile.countryCode}
        />
      </Card>

      <Card>
        <h3 className="ip-section-title">{t('profile.currentMarket')}</h3>
        <ProfileField
          icon={<Globe size={18} />}
          label={t('profile.currentMarket')}
          value={profile.marketCode}
        />
      </Card>
    </>
  );
}
