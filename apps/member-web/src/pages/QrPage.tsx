import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PageHeader,
  Card,
  Alert,
  Button,
  EmptyState,
  Skeleton,
} from '@ipoint/ui';
import { QrCode, RefreshCw } from 'lucide-react';
import { apiClient } from '../api/client';
import { useAbortController } from '../hooks/useAbortController';

type FetchState = 'loading' | 'unavailable' | 'error';

/**
 * QrPage displays the member's QR code for merchant scanning.
 *
 * Currently the backend QR identity endpoint is not yet implemented,
 * so this page shows a "QR unavailable" state indicating the feature
 * is not ready. When the backend provides a `GET /members/me/qr` or
 * similar endpoint returning a `publicQrId`, this page should be
 * updated to generate a QR code from that public identifier.
 *
 * Security principles:
 * - No internal UUID is ever encoded in a QR payload
 * - No token, email, phone, or KYC data is rendered
 * - No localStorage/sessionStorage is used for QR data
 * - NetworkOnly service worker strategy (no SW caching of QR payloads)
 * - Accessible labels and text fallbacks are provided
 */
export function QrPage() {
  const { t } = useTranslation();
  const abortController = useAbortController();
  const mountedRef = useRef(true);

  const [fetchState, setFetchState] = useState<FetchState>('loading');
  const [onlineState, setOnlineState] = useState<'online' | 'offline'>(
    navigator.onLine ? 'online' : 'offline',
  );

  // Monitor online/offline status
  useEffect(() => {
    const goOnline = () => {
      if (mountedRef.current) setOnlineState('online');
    };
    const goOffline = () => {
      if (mountedRef.current) setOnlineState('offline');
    };

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  /**
   * Fetch QR availability status from the backend.
   * Currently the QR feature is not implemented on the backend,
   * so this will always show "unavailable". This function is
   * designed to be updated when the backend QR endpoint ships.
   */
  const checkAvailability = useCallback(async () => {
    setFetchState('loading');
    try {
      // Attempt to fetch QR status — will 404 until backend ships
      await apiClient.get('/members/me/qr', {
        signal: abortController.signal,
      });
      // If we get here, backend has QR — update to use it
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;

      // 404 = not implemented yet (expected)
      const isNotFound =
        typeof err === 'object' &&
        err !== null &&
        'response' in err &&
        typeof (err as { response?: { status?: number } }).response?.status ===
          'number' &&
        (err as { response: { status: number } }).response.status === 404;

      if (isNotFound) {
        if (mountedRef.current) setFetchState('unavailable');
      } else {
        if (mountedRef.current) setFetchState('error');
      }
    }
  }, [abortController]);

  useEffect(() => {
    void checkAvailability();
    return () => {
      mountedRef.current = false;
    };
  }, [checkAvailability]);

  const handleRetry = useCallback(() => {
    void checkAvailability();
  }, [checkAvailability]);

  const isOffline = onlineState === 'offline';

  // Loading state
  if (fetchState === 'loading') {
    return (
      <>
        <PageHeader title={t('qr.title')} />
        <div className="ip-qr-page">
          <Card>
            <div className="ip-qr-loading">
              <Skeleton width="240px" height="240px" />
              <Skeleton width="160px" height="20px" />
            </div>
          </Card>
        </div>
      </>
    );
  }

  // Error state (API/network error)
  if (fetchState === 'error') {
    return (
      <>
        <PageHeader title={t('qr.title')} />
        <div className="ip-qr-page">
          <Card>
            <Alert tone="error" title={t('qr.error')}>
              <p>{t('qr.errorDescription')}</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRetry}
                disabled={isOffline}
              >
                {t('qr.retry')}
              </Button>
            </Alert>
          </Card>
        </div>
      </>
    );
  }

  // QR unavailable state — backend QR endpoint not yet implemented
  return (
    <>
      <PageHeader title={t('qr.title')} />

      {/* Offline banner */}
      {isOffline && (
        <Alert
          tone="warning"
          title={t('qr.offline')}
          className="ip-qr-offline-banner"
        >
          <p>{t('qr.offlineDescription')}</p>
        </Alert>
      )}

      <div className="ip-qr-page">
        <Card className="ip-qr-card">
          <EmptyState
            icon={<QrCode size={48} aria-hidden="true" />}
            title={t('qr.qrNotAvailable')}
            description={t('qr.qrNotAvailableDescription')}
          />

          {/* Scannable hint */}
          <p className="ip-qr-hint" aria-live="polite">
            {t('qr.qrNotAvailableHint')}
          </p>

          {/* Refresh/retry button */}
          <div className="ip-qr-actions">
            <Button
              variant="secondary"
              size="md"
              onClick={handleRetry}
              disabled={isOffline}
              aria-label={t('qr.refreshHint')}
            >
              <RefreshCw size={18} aria-hidden="true" />
              <span>{t('qr.refresh')}</span>
            </Button>
          </div>
        </Card>

        {/* Security note */}
        <p className="ip-qr-security-note">
          <QrCode size={14} aria-hidden="true" />
          {t('qr.codeExpires')}
        </p>
      </div>
    </>
  );
}
