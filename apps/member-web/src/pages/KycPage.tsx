/**
 * KYC Overview Page — displays current KYC status and actions.
 *
 * Security:
 * - No KYC data stored in localStorage/sessionStorage
 * - No identity number in URL parameters
 * - No caching of KYC API responses
 * - NetworkOnly strategy enforced
 */

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PageHeader,
  Card,
  Button,
  Spinner,
  Alert,
  Badge,
  EmptyState,
  Dialog,
} from '@ipoint/ui';
import {
  BadgeCheck,
  FileText,
  Clock,
  AlertTriangle,
  RefreshCcw,
  Info,
  ShieldAlert,
  Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useKyc,
  createKycDraft,
  submitKyc,
  resubmitKyc,
  type KycState,
} from '../hooks/useKyc';
import type { MemberKycResponse } from '../api/types';
import { apiClient } from '../api/client';

/**
 * Status display configuration.
 */
interface StatusConfig {
  badgeTone:
    | 'neutral'
    | 'success'
    | 'warning'
    | 'error'
    | 'info'
    | 'brand'
    | 'gold';
  icon: React.ReactNode;
}

const STATUS_CONFIGS: Record<string, StatusConfig> = {
  NOT_STARTED: { badgeTone: 'neutral', icon: <Info size={20} /> },
  DRAFT: { badgeTone: 'info', icon: <FileText size={20} /> },
  SUBMITTED: { badgeTone: 'warning', icon: <Clock size={20} /> },
  UNDER_REVIEW: { badgeTone: 'warning', icon: <Clock size={20} /> },
  APPROVED: { badgeTone: 'success', icon: <BadgeCheck size={20} /> },
  REJECTED: { badgeTone: 'error', icon: <AlertTriangle size={20} /> },
  MORE_INFO_REQUIRED: { badgeTone: 'info', icon: <Info size={20} /> },
  REVERIFICATION_REQUIRED: {
    badgeTone: 'warning',
    icon: <RefreshCcw size={20} />,
  },
};

function getStatusConfig(status: string): StatusConfig {
  return (
    STATUS_CONFIGS[status] ?? { badgeTone: 'neutral', icon: <Info size={20} /> }
  );
}

/** Maximum length for legal full name display. */
const MAX_LEGAL_NAME_LENGTH = 500;

interface KycOverviewContentProps {
  kyc: MemberKycResponse;
  onRefresh: () => void;
  onStart: () => void;
  onContinue: () => void;
  onEdit: () => void;
  onResubmit: () => void;
  onSubmit: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function KycOverviewContent({
  kyc,
  onRefresh,
  onStart,
  onContinue,
  onEdit,
  onResubmit,
  onSubmit,
  t,
}: KycOverviewContentProps) {
  const status = kyc.status;
  const config = getStatusConfig(status);
  const statusLabel = t(`kyc.status.${status.toLowerCase()}` as string);

  switch (status) {
    case 'NOT_STARTED':
      return (
        <Card>
          <EmptyState
            icon={<BadgeCheck size={48} />}
            title={t('kyc.title')}
            description={t('kyc.overview.notStarted')}
            action={
              <Button variant="primary" onClick={onStart}>
                {t('kyc.overview.startButton')}
              </Button>
            }
          />
        </Card>
      );

    case 'DRAFT':
      return (
        <div
          className="kyc-overview"
          style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
        >
          <Card>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                marginBottom: '1rem',
              }}
            >
              <Badge tone={config.badgeTone}>{statusLabel}</Badge>
            </div>
            <p>{t('kyc.overview.draftExists')}</p>
            {kyc.legalFullName && (
              <p style={{ marginTop: '0.5rem' }}>
                <strong>{t('kyc.form.legalFullName')}:</strong>{' '}
                {kyc.legalFullName.length > MAX_LEGAL_NAME_LENGTH
                  ? `${kyc.legalFullName.slice(0, MAX_LEGAL_NAME_LENGTH)}...`
                  : kyc.legalFullName}
              </p>
            )}
            <div style={{ marginTop: '1rem' }}>
              <Button variant="primary" onClick={onContinue}>
                {t('kyc.overview.continueDraft')}
              </Button>
            </div>
          </Card>
        </div>
      );

    case 'SUBMITTED':
    case 'UNDER_REVIEW':
      return (
        <Card>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            <Badge tone={config.badgeTone}>{statusLabel}</Badge>
          </div>
          <p>{t('kyc.overview.submitted')}</p>
          {kyc.submittedAt && (
            <p style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
              {t('kyc.overview.submittedDate', {
                date: new Date(kyc.submittedAt).toLocaleDateString(),
              })}
            </p>
          )}
          <p style={{ marginTop: '0.5rem' }}>
            {t('kyc.overview.underReviewDescription')}
          </p>
        </Card>
      );

    case 'APPROVED':
      return (
        <Card>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            <Badge tone={config.badgeTone}>{statusLabel}</Badge>
          </div>
          <p>{t('kyc.overview.approved')}</p>
          <p style={{ marginTop: '0.5rem' }}>
            {t('kyc.overview.approvedDescription')}
          </p>
        </Card>
      );

    case 'REJECTED':
      return (
        <Card>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            <Badge tone={config.badgeTone}>{statusLabel}</Badge>
          </div>
          <p>{t('kyc.overview.rejected')}</p>
          {/* Note: rejection reason is displayed from API; no admin internal notes shown */}
          <div style={{ marginTop: '1rem' }}>
            <Button variant="primary" onClick={onEdit}>
              {t('kyc.overview.resubmitAction')}
            </Button>
          </div>
        </Card>
      );

    case 'MORE_INFO_REQUIRED':
      return (
        <Card>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            <Badge tone={config.badgeTone}>{statusLabel}</Badge>
          </div>
          <p>{t('kyc.overview.moreInfoRequired')}</p>
          <div style={{ marginTop: '1rem' }}>
            <Button variant="primary" onClick={onEdit}>
              {t('kyc.overview.moreInfoAction')}
            </Button>
          </div>
        </Card>
      );

    case 'REVERIFICATION_REQUIRED':
      return (
        <Card>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            <Badge tone={config.badgeTone}>{statusLabel}</Badge>
          </div>
          <p>{t('kyc.overview.reverificationRequired')}</p>
          <div style={{ marginTop: '1rem' }}>
            <Button variant="primary" onClick={onResubmit}>
              {t('kyc.overview.reverificationAction')}
            </Button>
          </div>
        </Card>
      );

    default:
      return null;
  }
}

/**
 * Main KYC page component.
 */
export function KycPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { state, fetchKyc, clearKycState } = useKyc();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [resubmitLoading, setResubmitLoading] = useState(false);

  const handleStartVerification = useCallback(async () => {
    try {
      await createKycDraft();
      navigate('/kyc/form');
    } catch {
      // Error handled by input state
    }
  }, [navigate]);

  const handleContinueDraft = useCallback(() => {
    navigate('/kyc/form');
  }, [navigate]);

  const handleEdit = useCallback(() => {
    navigate('/kyc/form');
  }, [navigate]);

  const handleResubmit = useCallback(async () => {
    setResubmitLoading(true);
    setSubmitError(null);
    try {
      await resubmitKyc();
      await fetchKyc();
    } catch (error: unknown) {
      setSubmitError(
        error instanceof Error ? error.message : 'Failed to resubmit',
      );
    } finally {
      setResubmitLoading(false);
    }
  }, [fetchKyc]);

  const handleSubmitConfirm = useCallback(async () => {
    setShowSubmitConfirm(false);
    setSubmitLoading(true);
    setSubmitError(null);
    try {
      await submitKyc();
      await fetchKyc();
    } catch (error: unknown) {
      setSubmitError(
        error instanceof Error ? error.message : 'Submission failed',
      );
    } finally {
      setSubmitLoading(false);
    }
  }, [fetchKyc]);

  const navigateToDocuments = useCallback(() => {
    navigate('/kyc/documents');
  }, [navigate]);

  // Redirect on 401
  if (state.errorCode === 'SESSION_EXPIRED') {
    return (
      <div style={{ padding: '2rem' }}>
        <Card>
          <Alert tone="error" title={t('auth.sessionExpired')} />
        </Card>
      </div>
    );
  }

  // Loading state
  if (state.isLoading) {
    return (
      <div>
        <PageHeader title={t('kyc.title')} />
        <Card>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              minHeight: '200px',
            }}
          >
            <Spinner size="lg" />
          </div>
        </Card>
      </div>
    );
  }

  // Error state
  if (state.error && !state.data) {
    return (
      <div>
        <PageHeader title={t('kyc.title')} />
        <Card>
          <Alert
            tone="error"
            title={state.error}
            onDismiss={() => {}}
            dismissLabel={t('common.retry')}
          />
          <div style={{ marginTop: '1rem' }}>
            <Button variant="secondary" onClick={fetchKyc}>
              {t('common.retry')}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const kyc = state.data;

  if (!kyc) {
    return (
      <div>
        <PageHeader title={t('kyc.title')} />
        <Card>
          <EmptyState
            icon={<ShieldAlert size={48} />}
            title={t('kyc.title')}
            description={t('kyc.overview.notStarted')}
            action={
              <Button variant="primary" onClick={handleStartVerification}>
                {t('kyc.overview.startButton')}
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t('kyc.title')} />
      <KycOverviewContent
        kyc={kyc}
        onRefresh={fetchKyc}
        onStart={handleStartVerification}
        onContinue={handleContinueDraft}
        onEdit={handleEdit}
        onResubmit={handleResubmit}
        onSubmit={() => setShowSubmitConfirm(true)}
        t={t}
      />

      {/* Submit error alert */}
      {submitError && (
        <div style={{ marginTop: '1rem' }}>
          <Alert tone="error" title={submitError} />
        </div>
      )}

      {/* Loading overlay for submit/resubmit */}
      {(submitLoading || resubmitLoading) && (
        <Card>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              minHeight: '100px',
            }}
          >
            <Spinner size="md" />
          </div>
        </Card>
      )}

      {/* Submit confirmation dialog */}
      {showSubmitConfirm && (
        <Dialog
          open={showSubmitConfirm}
          onClose={() => setShowSubmitConfirm(false)}
          title={t('kyc.submit.confirmTitle')}
        >
          <p>{t('kyc.submit.confirmDescription')}</p>
          <div
            style={{
              display: 'flex',
              gap: '1rem',
              justifyContent: 'flex-end',
              marginTop: '1.5rem',
            }}
          >
            <Button
              variant="secondary"
              onClick={() => setShowSubmitConfirm(false)}
            >
              {t('kyc.submit.cancel')}
            </Button>
            <Button variant="primary" onClick={handleSubmitConfirm}>
              {t('kyc.submit.confirm')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

export default KycPage;
