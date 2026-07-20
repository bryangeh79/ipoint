import { useCallback, useRef, useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Input, FormField, Alert } from '@ipoint/ui';
import { apiClient } from '../api/client';
import { ApiError } from '@ipoint/api-client';
import { isValidEmail } from '../utils/validation';
import { PublicLayout } from '../layouts/PublicLayout';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ForgotState = 'form' | 'submitting' | 'success' | 'error';

/* ------------------------------------------------------------------ */
/*  ForgotPasswordPage                                                 */
/* ------------------------------------------------------------------ */

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const emailRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ForgotState>('form');
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [developmentCode, setDevelopmentCode] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (state === 'submitting') return;

      // Validate
      const email = emailRef.current?.value?.trim().toLowerCase() ?? '';
      if (!email || !isValidEmail(email)) {
        setFieldError(t('register.invalidEmail'));
        return;
      }
      setFieldError(null);
      setGlobalError(null);
      setDevelopmentCode(null);

      setState('submitting');

      try {
        const response = await apiClient.post<{
          otp_id: string;
          expires_at: string;
          development_code?: string;
        }>('/auth/password-reset/initiate', { email }, { skipAuth: true });

        // Note development_code if present (dev/test env only)
        const devCode = response.data.development_code;
        if (devCode) {
          setDevelopmentCode(devCode);
        }

        // Navigate to reset-password with OTP ID
        void navigate(
          `/reset-password?otp_id=${encodeURIComponent(response.data.otp_id)}&purpose=password-reset`,
          { replace: true },
        );
      } catch (error: unknown) {
        setState('error');

        if (error instanceof ApiError) {
          if (error.status === 429) {
            const msg = Array.isArray(error.body.message)
              ? (error.body.message[0] ?? t('auth.somethingWentWrong'))
              : (error.body.message ?? t('auth.somethingWentWrong'));
            setGlobalError(msg);
            return;
          }
          if (error.status === 0) {
            setGlobalError(t('auth.networkError'));
            return;
          }

          // All other errors still show neutral message
          // (even validation errors — don't reveal if email exists)
          setState('success');
          return;
        }

        // Still neutral for non-ApiError
        setState('success');
      }
    },
    [state, t, navigate],
  );

  const isSubmitting = state === 'submitting';
  const showNeutral = state === 'success';

  return (
    <PublicLayout>
      <h1 className="ip-page-header__title">{t('auth.forgotPasswordTitle')}</h1>

      {/* Error */}
      {state === 'error' && globalError && (
        <Alert tone="error" className="ip-mb-3">
          <p>{globalError}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setState('form');
              setGlobalError(null);
            }}
            className="ip-mt-2"
          >
            {t('common.retry')}
          </Button>
        </Alert>
      )}

      {/* Neutral success message */}
      {showNeutral && (
        <Alert tone="info" className="ip-mb-3">
          <p>{t('auth.forgotPasswordSent')}</p>
        </Alert>
      )}

      {/* Development code hint (non-production only) */}
      {developmentCode && (
        <Alert tone="info" className="ip-mb-3">
          <p>
            <strong>Development code:</strong> {developmentCode}
          </p>
        </Alert>
      )}

      {!showNeutral && (
        <form onSubmit={handleSubmit} noValidate>
          <p
            className="ip-text-muted"
            style={{
              color: 'var(--ip-color-text-muted)',
              marginBottom: 'var(--ip-space-3)',
            }}
          >
            {t('auth.forgotPasswordTitle')}
          </p>

          <FormField
            label={t('auth.email')}
            htmlFor="forgot-email"
            error={fieldError ?? undefined}
          >
            <Input
              ref={emailRef}
              id="forgot-email"
              type="email"
              autoComplete="email"
              placeholder={t('auth.emailPlaceholder')}
              error={!!fieldError}
              disabled={isSubmitting}
              required
            />
          </FormField>

          <Button
            type="submit"
            variant="primary"
            fullWidth
            loading={isSubmitting}
            loadingLabel={t('auth.forgotPasswordSubmitting')}
            disabled={isSubmitting}
            className="ip-mt-3"
          >
            {t('auth.forgotPasswordButton')}
          </Button>
        </form>
      )}

      {/* Back to login */}
      <div style={{ textAlign: 'center', marginTop: 'var(--ip-space-3)' }}>
        <Link to="/login">{t('auth.login')}</Link>
      </div>
    </PublicLayout>
  );
}
