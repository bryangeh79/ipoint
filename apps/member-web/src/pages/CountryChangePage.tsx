import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PageHeader,
  Card,
  FormField,
  Select,
  Textarea,
  Button,
  Alert,
  Skeleton,
  Badge,
} from '@ipoint/ui';
import { MapPin, Clock, CheckCircle, XCircle, ArrowRight } from 'lucide-react';
import { apiClient } from '../api/client.ts';
import { useAbortController } from '../hooks/useAbortController.ts';
import { isMinLength } from '../utils/validation.ts';

interface CountryChangeStatus {
  status: 'none' | 'pending' | 'approved' | 'rejected';
  targetCountry?: string;
  reason?: string;
  submittedAt?: string;
  approvedAt?: string;
  rejectReason?: string;
}

interface ProfileInfo {
  countryCode?: string;
}

const SUPPORTED_COUNTRIES = [
  { code: 'MY', nameKey: 'countryMY' },
  { code: 'SG', nameKey: 'countrySG' },
  { code: 'VN', nameKey: 'countryVN' },
  { code: 'TH', nameKey: 'countryTH' },
  { code: 'ID', nameKey: 'countryID' },
  { code: 'PH', nameKey: 'countryPH' },
];

type FetchState = 'idle' | 'loading' | 'error' | 'success';
type SubmitState = 'idle' | 'submitting' | 'success' | 'error';
type SubmittableView = 'form' | 'pending' | 'approved' | 'rejected';

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function CountryChangePage() {
  const { t } = useTranslation();
  const abortController = useAbortController();
  const submittedRef = useRef(false);

  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [currentCountry, setCurrentCountry] = useState<string | null>(null);
  const [changeStatus, setChangeStatus] = useState<CountryChangeStatus | null>(
    null,
  );

  const [targetCountry, setTargetCountry] = useState('');
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setFetchState('loading');
    setFetchError(null);
    try {
      const [profileRes, statusRes] = await Promise.all([
        apiClient.get<{ data: ProfileInfo }>('/profile', {
          signal: abortController.signal,
        }),
        apiClient
          .get<{ data: CountryChangeStatus }>('/country-change/status', {
            signal: abortController.signal,
          })
          .catch(() => ({ data: { data: { status: 'none' as const } } })),
      ]);

      const profileData =
        profileRes.data?.data ?? (profileRes.data as ProfileInfo);
      const statusData =
        statusRes.data?.data ?? (statusRes.data as CountryChangeStatus);

      setCurrentCountry(profileData.countryCode ?? null);
      setChangeStatus(statusData);
      setFetchState('success');
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setFetchState('error');
      setFetchError(err instanceof Error ? err.message : t('common.error'));
    }
  }, [abortController, t]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const validate = useCallback((): boolean => {
    if (!targetCountry) {
      setFieldError(t('register.countryRequired'));
      return false;
    }
    if (!isMinLength(reason, 10)) {
      setFieldError(t('country.reasonMinLength'));
      return false;
    }
    setFieldError(null);
    return true;
  }, [targetCountry, reason, t]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (submittedRef.current || submitState === 'submitting') return;
      submittedRef.current = true;

      if (!validate()) {
        submittedRef.current = false;
        return;
      }

      setSubmitState('submitting');
      setSubmitError(null);

      try {
        const res = await apiClient.post<{ data: CountryChangeStatus }>(
          '/country-change/request',
          {
            targetCountry,
            reason: reason.trim(),
          },
        );
        const newStatus = res.data?.data ?? (res.data as CountryChangeStatus);
        setChangeStatus(newStatus);
        setSubmitState('success');
        submittedRef.current = false;
      } catch (err: unknown) {
        submittedRef.current = false;
        setSubmitState('error');
        setSubmitError(
          err instanceof Error ? err.message : t('country.submitFailed'),
        );
      }
    },
    [targetCountry, reason, validate, submitState, t],
  );

  if (fetchState === 'loading') {
    return (
      <>
        <PageHeader title={t('country.title')} />
        <Card>
          <Skeleton width="100%" height="40px" />
          <Skeleton width="100%" height="80px" />
        </Card>
      </>
    );
  }

  if (fetchState === 'error') {
    return (
      <>
        <PageHeader title={t('country.title')} />
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

  const currentView: SubmittableView =
    !changeStatus || changeStatus.status === 'none'
      ? 'form'
      : changeStatus.status;

  return (
    <>
      <PageHeader title={t('country.title')} />

      {/* Current Account Country */}
      <Card>
        <div className="ip-country-current">
          <MapPin size={20} aria-hidden="true" />
          <div>
            <span className="ip-country-current__label">
              {t('country.currentCountry')}
            </span>
            <strong>{currentCountry || '—'}</strong>
          </div>
        </div>
      </Card>

      {/* Status-based content */}
      {currentView === 'form' && (
        <>
          {submitState === 'success' && (
            <Alert tone="success" title={t('country.submitSuccess')} />
          )}
          {submitState === 'error' && submitError && (
            <Alert tone="error" title={t('common.error')}>
              <p>{submitError}</p>
            </Alert>
          )}

          <Card>
            <form onSubmit={handleSubmit} noValidate>
              <FormField
                label={t('country.targetCountry')}
                htmlFor="country-target"
                error={fieldError && !reason ? fieldError : undefined}
              >
                <Select
                  id="country-target"
                  value={targetCountry}
                  onChange={(e) => {
                    setTargetCountry(e.target.value);
                    setFieldError(null);
                  }}
                >
                  <option value="">{t('country.selectCountry')}</option>
                  {SUPPORTED_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {t(`country.${c.nameKey}`)} ({c.code})
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField
                label={t('country.reason')}
                htmlFor="country-reason"
                error={fieldError && targetCountry ? fieldError : undefined}
              >
                <Textarea
                  id="country-reason"
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setFieldError(null);
                  }}
                  placeholder={t('country.reasonPlaceholder')}
                  rows={4}
                  maxLength={500}
                />
              </FormField>

              <div className="ip-form-actions">
                <Button
                  type="submit"
                  variant="primary"
                  loading={submitState === 'submitting'}
                  loadingLabel={t('country.submitting')}
                  disabled={submitState === 'submitting'}
                  fullWidth
                >
                  {t('country.submit')}
                </Button>
              </div>
            </form>
          </Card>
        </>
      )}

      {currentView === 'pending' && changeStatus && (
        <Card>
          <div className="ip-country-status">
            <Clock size={32} aria-hidden="true" />
            <h3>{t('country.pendingTitle')}</h3>
            <Badge tone="warning">{t('country.pendingStatus')}</Badge>
            {changeStatus.submittedAt && (
              <p className="ip-text-sm">
                {t('country.pendingDate', {
                  date: formatDate(changeStatus.submittedAt),
                })}
              </p>
            )}
            {changeStatus.targetCountry && (
              <p className="ip-text-sm">
                <ArrowRight size={14} aria-hidden="true" />
                {t('country.targetCountry')}: {changeStatus.targetCountry}
              </p>
            )}
          </div>
        </Card>
      )}

      {currentView === 'approved' && changeStatus && (
        <Card>
          <div className="ip-country-status">
            <CheckCircle size={32} aria-hidden="true" />
            <h3>{t('country.approvedTitle')}</h3>
            <Badge tone="success">{t('profile.kycApproved')}</Badge>
            {changeStatus.approvedAt && (
              <p className="ip-text-sm">
                {t('country.approvedDate', {
                  date: formatDate(changeStatus.approvedAt),
                })}
              </p>
            )}
          </div>
        </Card>
      )}

      {currentView === 'rejected' && changeStatus && (
        <Card>
          <div className="ip-country-status">
            <XCircle size={32} aria-hidden="true" />
            <h3>{t('country.rejectedTitle')}</h3>
            <Badge tone="error">{t('profile.kycRejected')}</Badge>
            {changeStatus.rejectReason && (
              <p className="ip-text-sm">
                {t('country.rejectedReason', {
                  reason: changeStatus.rejectReason,
                })}
              </p>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setChangeStatus({ status: 'none' });
                setSubmitState('idle');
                setTargetCountry('');
                setReason('');
              }}
            >
              {t('country.resubmit')}
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}
