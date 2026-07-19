import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Input, FormField, Alert, Spinner } from '@ipoint/ui';
import { apiClient } from '../api/client.ts';
import { ApiError, createIdempotencyKey } from '@ipoint/api-client';
import { isMinLength } from '../utils/validation.ts';
import { PublicLayout } from '../layouts/PublicLayout.tsx';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ResetStep = 'otp' | 'password' | 'submitting' | 'success' | 'error';

interface ResetState {
  step: ResetStep;
  otpId: string;
  fieldErrors: { code?: string; password?: string; confirmPassword?: string };
  globalError: string | null;
  errorTitle: string | null;
  resendCooldown: number;
  resending: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const OTP_LENGTH = 6;
/* ------------------------------------------------------------------ */
/*  ResetPasswordPage                                                  */
/* ------------------------------------------------------------------ */

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const initialOtpId = searchParams.get('otp_id') ?? '';

  const [state, setState] = useState<ResetState>({
    step: 'otp',
    otpId: initialOtpId,
    fieldErrors: {},
    globalError: null,
    errorTitle: null,
    resendCooldown: 0,
    resending: false,
  });

  // Digit inputs
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const digitRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Password inputs
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  // Navigate back if no otp_id
  useEffect(() => {
    if (!initialOtpId) {
      void navigate('/forgot-password', { replace: true });
    }
  }, [initialOtpId, navigate]);

  // Resend cooldown
  useEffect(() => {
    if (state.resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setState((prev) => {
        if (prev.resendCooldown <= 1) {
          return { ...prev, resendCooldown: 0 };
        }
        return { ...prev, resendCooldown: prev.resendCooldown - 1 };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [state.resendCooldown]);

  /* ---- Digit handlers ---- */

  const handleDigitChange = useCallback((index: number, value: string) => {
    const digit = value.replace(/\D/g, '');
    if (digit.length > 1) return;

    setDigits((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });

    if (digit && index < OTP_LENGTH - 1) {
      digitRefs.current[index + 1]?.focus();
    }
  }, []);

  const handleDigitKeyDown = useCallback(
    (index: number, event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Backspace' && !digits[index] && index > 0) {
        digitRefs.current[index - 1]?.focus();
      }
      if (event.key === 'ArrowLeft' && index > 0) {
        digitRefs.current[index - 1]?.focus();
      }
      if (event.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
        digitRefs.current[index + 1]?.focus();
      }
    },
    [digits],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLInputElement>) => {
      event.preventDefault();
      const pasted = event.clipboardData.getData('text').replace(/\D/g, '');
      if (pasted.length !== OTP_LENGTH) return;
      setDigits(pasted.split(''));
      digitRefs.current[OTP_LENGTH - 1]?.focus();
    },
    [],
  );

  /* ---- Verify OTP ---- */

  const handleVerifyOtp = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (state.step !== 'otp') return;

      const code = digits.join('');
      if (code.length !== OTP_LENGTH) {
        setState((prev) => ({
          ...prev,
          fieldErrors: { code: t('auth.otpRequired') },
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        globalError: null,
        fieldErrors: {},
      }));

      try {
        // Verify the OTP via password-reset verify endpoint
        await apiClient.post<{ verified: boolean }>(
          '/auth/password-reset/verify',
          { otp_id: state.otpId, code },
          { skipAuth: true },
        );

        // OTP verified — move to password step
        setState((prev) => ({
          ...prev,
          step: 'password',
          globalError: null,
          fieldErrors: {},
        }));
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          const code = error.body.code;

          if (code === 'AUTH_OTP_INVALID') {
            setState((prev) => ({
              ...prev,
              fieldErrors: { code: t('auth.otpInvalid', { attempts: '?' }) },
            }));
            setDigits(Array(OTP_LENGTH).fill(''));
            digitRefs.current[0]?.focus();
            return;
          }

          if (code === 'AUTH_OTP_EXPIRED') {
            setState((prev) => ({
              ...prev,
              globalError: t('auth.otpExpired'),
              errorTitle: code,
            }));
            return;
          }

          if (code === 'AUTH_OTP_ATTEMPTS_EXHAUSTED') {
            setState((prev) => ({
              ...prev,
              globalError: t('auth.otpExhausted'),
              errorTitle: code,
            }));
            return;
          }

          setState((prev) => ({
            ...prev,
            globalError: error.body.message ?? t('auth.somethingWentWrong'),
            errorTitle: code ?? t('common.error'),
          }));
          return;
        }

        setState((prev) => ({
          ...prev,
          globalError: t('auth.somethingWentWrong'),
          errorTitle: t('common.error'),
        }));
      }
    },
    [digits, state.step, state.otpId, t],
  );

  /* ---- Resend ---- */

  const handleResend = useCallback(async () => {
    // Password reset has no dedicated resend endpoint.
    // Navigate back to forgot-password to re-initiate with email.
    navigate('/forgot-password', { replace: true });
  }, [navigate]);

  /* ---- Complete password reset ---- */

  const handleCompleteReset = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (state.step !== 'password') return;

      const password = passwordRef.current?.value ?? '';
      const confirmPassword = confirmPasswordRef.current?.value ?? '';
      const fieldErrors: { password?: string; confirmPassword?: string } = {};

      if (!password) {
        fieldErrors.password = t('register.fieldRequired');
      } else if (!isMinLength(password, 12)) {
        fieldErrors.password = t('auth.passwordMinLength');
      }

      if (!confirmPassword) {
        fieldErrors.confirmPassword = t('register.fieldRequired');
      } else if (password !== confirmPassword) {
        fieldErrors.confirmPassword = t('auth.passwordMismatch');
      }

      if (Object.keys(fieldErrors).length > 0) {
        setState((prev) => ({ ...prev, fieldErrors }));
        return;
      }

      setState((prev) => ({
        ...prev,
        step: 'submitting',
        fieldErrors: {},
        globalError: null,
      }));

      try {
        const idempotencyKey = createIdempotencyKey();
        await apiClient.post(
          '/auth/password-reset/complete',
          {
            otp_id: state.otpId,
            new_password: password,
            idempotency_key: idempotencyKey,
          },
          { skipAuth: true },
        );

        // 204 — success, redirect to login
        setState((prev) => ({ ...prev, step: 'success' }));

        // Redirect to login after brief delay
        setTimeout(() => {
          navigate('/login', { replace: true });
        }, 3000);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          if (error.status === 400) {
            setState((prev) => ({
              ...prev,
              step: 'password',
              globalError: error.body.message ?? t('auth.somethingWentWrong'),
              errorTitle: error.body.code ?? t('common.error'),
            }));
            return;
          }
          if (error.status === 0) {
            setState((prev) => ({
              ...prev,
              step: 'password',
              globalError: t('auth.networkError'),
              errorTitle: t('errors.offline'),
            }));
            return;
          }
          setState((prev) => ({
            ...prev,
            step: 'password',
            globalError: error.body.message ?? t('auth.somethingWentWrong'),
            errorTitle: error.body.code ?? t('common.error'),
          }));
          return;
        }
        setState((prev) => ({
          ...prev,
          step: 'password',
          globalError: t('auth.somethingWentWrong'),
          errorTitle: t('common.error'),
        }));
      }
    },
    [state.step, state.otpId, t, navigate],
  );

  /* ---- Retry handler ---- */

  const handleRetry = useCallback(() => {
    setState((prev) => ({
      ...prev,
      globalError: null,
      errorTitle: null,
      fieldErrors: {},
      step: 'otp',
    }));
  }, []);

  /* ---- Render ---- */

  const isSubmitting = state.step === 'submitting';
  const showResendOnError =
    state.step === 'otp' &&
    (state.globalError === t('auth.otpExpired') ||
      state.globalError === t('auth.otpExhausted'));

  // On success, show confirmation
  if (state.step === 'success') {
    return (
      <PublicLayout>
        <Alert tone="success" className="ip-mb-3">
          <p>{t('auth.resetPasswordSuccess')}</p>
          <p style={{ marginTop: 'var(--ip-space-1)' }}>
            {t('auth.passwordResetSuccessDescription')}
          </p>
        </Alert>
        <Spinner size="md" label={t('common.loading')} />
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <h1 className="ip-page-header__title">{t('auth.resetPasswordTitle')}</h1>

      {/* Global error */}
      {state.globalError && (
        <Alert
          tone="error"
          title={state.errorTitle ?? t('common.error')}
          className="ip-mb-3"
        >
          <p>{state.globalError}</p>
          {showResendOnError ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleResend}
              loading={state.resending}
              className="ip-mt-2"
            >
              {t('auth.resendCode')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRetry}
              className="ip-mt-2"
            >
              {t('common.retry')}
            </Button>
          )}
        </Alert>
      )}

      {/* OTP step */}
      {state.step === 'otp' && !state.globalError && (
        <form onSubmit={handleVerifyOtp} noValidate>
          <p
            className="ip-text-muted"
            style={{
              color: 'var(--ip-color-text-muted)',
              marginBottom: 'var(--ip-space-3)',
            }}
          >
            {t('auth.verifyOtpDescription')}
          </p>

          <FormField
            label={t('auth.otpCode')}
            htmlFor="reset-otp-digit-0"
            error={state.fieldErrors.code}
          >
            <div
              style={{
                display: 'flex',
                gap: 'var(--ip-space-2)',
                justifyContent: 'center',
              }}
              role="group"
              aria-label={t('auth.otpCode')}
            >
              {digits.map((digit, index) => (
                <Input
                  key={index}
                  ref={(el) => {
                    digitRefs.current[index] = el;
                  }}
                  id={`reset-otp-digit-${index}`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigitChange(index, e.target.value)}
                  onKeyDown={(e) => handleDigitKeyDown(index, e)}
                  onPaste={index === 0 ? handlePaste : undefined}
                  aria-label={t('auth.otpDigitLabel', { position: index + 1 })}
                  autoFocus={index === 0}
                  style={{
                    width: '48px',
                    height: '56px',
                    textAlign: 'center',
                    fontSize: 'var(--ip-font-size-heading-md)',
                    fontWeight: 700,
                  }}
                />
              ))}
            </div>
          </FormField>

          <Button
            type="submit"
            variant="primary"
            fullWidth
            disabled={digits.join('').length !== OTP_LENGTH}
            className="ip-mt-3"
          >
            {t('auth.submitOtp')}
          </Button>
        </form>
      )}

      {/* Resend link (otp step, no error) */}
      {state.step === 'otp' && !state.globalError && (
        <div style={{ textAlign: 'center', marginTop: 'var(--ip-space-3)' }}>
          {state.resendCooldown > 0 ? (
            <span className="ip-text-muted ip-text-sm">
              {t('auth.resendCooldown', { seconds: state.resendCooldown })}
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResend}
              loading={state.resending}
              disabled={state.resendCooldown > 0}
            >
              {t('auth.resendCode')}
            </Button>
          )}
        </div>
      )}

      {/* Password step */}
      {state.step === 'password' && (
        <form onSubmit={handleCompleteReset} noValidate>
          <p
            className="ip-text-muted"
            style={{
              color: 'var(--ip-color-text-muted)',
              marginBottom: 'var(--ip-space-3)',
            }}
          >
            {t('auth.resetPasswordTitle')}
          </p>

          <FormField
            label={t('auth.newPassword')}
            htmlFor="reset-new-password"
            error={state.fieldErrors.password}
          >
            <Input
              ref={passwordRef}
              id="reset-new-password"
              type="password"
              autoComplete="new-password"
              error={!!state.fieldErrors.password}
              disabled={isSubmitting}
              required
              minLength={12}
            />
          </FormField>

          <FormField
            label={t('auth.confirmNewPassword')}
            htmlFor="reset-confirm-password"
            error={state.fieldErrors.confirmPassword}
          >
            <Input
              ref={confirmPasswordRef}
              id="reset-confirm-password"
              type="password"
              autoComplete="new-password"
              error={!!state.fieldErrors.confirmPassword}
              disabled={isSubmitting}
              required
            />
          </FormField>

          <Button
            type="submit"
            variant="primary"
            fullWidth
            loading={isSubmitting}
            loadingLabel={t('auth.resetPasswordSubmitting')}
            disabled={isSubmitting}
            className="ip-mt-3"
          >
            {t('auth.resetPasswordButton')}
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
