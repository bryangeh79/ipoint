import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Input, Alert, FormField, Spinner } from '@ipoint/ui';
import { apiClient } from '../api/client.ts';
import { ApiError, createIdempotencyKey } from '@ipoint/api-client';
import { PublicLayout } from '../layouts/PublicLayout.tsx';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type OtpStep = 'verify-otp' | 'complete-submitting';

interface OtpState {
  step: OtpStep;
  /** The current OTP ID (may be updated after resend) */
  otpId: string;
  /** Non-field error */
  error: string | null;
  errorTitle: string | null;
  /** Resend cooldown seconds remaining (0 = can resend) */
  resendCooldown: number;
  /** True while resend request is in flight */
  resending: boolean;
  /** Remaining attempts (only shown on AUTH_OTP_INVALID) */
  attemptsRemaining: number | null;
  /** Whether the OTP has been verified (moved to complete step) */
  verified: boolean;
}

/* ------------------------------------------------------------------ */
/*  OTP_LENGTH                                                         */
/* ------------------------------------------------------------------ */

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

/* ------------------------------------------------------------------ */
/*  VerifyOtpPage                                                      */
/* ------------------------------------------------------------------ */

export function VerifyOtpPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const initialOtpId = searchParams.get('otp_id') ?? '';

  const [otpState, setOtpState] = useState<OtpState>(() => ({
    step: 'verify-otp',
    otpId: initialOtpId,
    error: null,
    errorTitle: null,
    resendCooldown: 0,
    resending: false,
    attemptsRemaining: null,
    verified: false,
  }));

  // Individual digit refs
  const digitRefs = useRef<(HTMLInputElement | null)[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  // State for digit values (controlled inputs for auto-focus behavior)
  const [digits, setDigits] = useState<string[]>(() =>
    Array(OTP_LENGTH).fill(''),
  );

  // Resend cooldown timer
  useEffect(() => {
    if (otpState.resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setOtpState((prev) => {
        const next = prev.resendCooldown - 1;
        if (next <= 0) {
          return { ...prev, resendCooldown: 0 };
        }
        return { ...prev, resendCooldown: next };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [otpState.resendCooldown]);

  // Navigate to forgot if no otp_id
  useEffect(() => {
    if (!initialOtpId) {
      navigate('/forgot-password', { replace: true });
    }
  }, [initialOtpId, navigate]);

  /* ---- Digit input handler ---- */

  const handleDigitChange = useCallback(
    (index: number, value: string) => {
      // Only accept single digits
      const digit = value.replace(/\D/g, '');
      if (digit.length > 1) return; // blocks pasting multiple digits into one field

      setDigits((prev) => {
        const next = [...prev];
        next[index] = digit;
        return next;
      });

      // Auto-advance to next field
      if (digit && index < OTP_LENGTH - 1) {
        digitRefs.current[index + 1]?.focus();
      }

      // Clear any previous error
      if (otpState.error) {
        setOtpState((prev) => ({
          ...prev,
          error: null,
          attemptsRemaining: null,
        }));
      }
    },
    [otpState.error],
  );

  const handleDigitKeyDown = useCallback(
    (index: number, event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Backspace' && !digits[index] && index > 0) {
        // Move back on backspace when current field is empty
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

  const handleDigitPaste = useCallback(
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

  const handleVerify = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (otpState.step !== 'verify-otp') return;

      const code = digits.join('');
      if (code.length !== OTP_LENGTH) {
        setOtpState((prev) => ({
          ...prev,
          error: t('auth.otpRequired'),
          errorTitle: null,
        }));
        return;
      }

      setOtpState((prev) => ({
        ...prev,
        error: null,
        errorTitle: null,
      }));

      try {
        const response = await apiClient.post<{ verified: boolean }>(
          '/auth/registration/verify',
          { otp_id: otpState.otpId, code },
          { skipAuth: true },
        );

        if (response.data.verified) {
          // OTP verified — proceed to completion
          setOtpState((prev) => ({
            ...prev,
            verified: true,
            step: 'complete-submitting',
          }));

          await completeRegistration(otpState.otpId);
        }
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          const code = error.body.code;

          if (code === 'AUTH_OTP_INVALID') {
            // Try to extract attempts remaining from message
            const match = error.message.match(/(\d+)\s+attempt/i);
            const attempts = match ? parseInt(match[1], 10) : null;

            setOtpState((prev) => ({
              ...prev,
              error: t('auth.otpInvalid', { attempts: attempts ?? '?' }),
              errorTitle: error.body.code,
              attemptsRemaining: attempts,
              verified: false,
            }));
            // Clear digits for retry
            setDigits(Array(OTP_LENGTH).fill(''));
            digitRefs.current[0]?.focus();
            return;
          }

          if (code === 'AUTH_OTP_EXPIRED') {
            setOtpState((prev) => ({
              ...prev,
              error: t('auth.otpExpired'),
              errorTitle: error.body.code,
            }));
            return;
          }

          if (code === 'AUTH_OTP_ATTEMPTS_EXHAUSTED') {
            setOtpState((prev) => ({
              ...prev,
              error: t('auth.otpExhausted'),
              errorTitle: error.body.code,
            }));
            return;
          }

          if (error.status === 0) {
            setOtpState((prev) => ({
              ...prev,
              error: t('auth.networkError'),
              errorTitle: t('errors.offline'),
            }));
            return;
          }

          // Generic error
          setOtpState((prev) => ({
            ...prev,
            error: error.body.message ?? t('auth.somethingWentWrong'),
            errorTitle: error.body.code ?? t('common.error'),
          }));
          return;
        }

        setOtpState((prev) => ({
          ...prev,
          error: t('auth.somethingWentWrong'),
          errorTitle: t('common.error'),
        }));
      }
    },
    [digits, otpState.step, otpState.otpId, t, navigate],
  );

  /* ---- Complete registration ---- */

  const completeRegistration = useCallback(
    async (otpId: string) => {
      const idempotencyKey = createIdempotencyKey();

      try {
        const response = await apiClient.post<{
          accountId: string;
          memberId: string;
          publicMemberId: string;
          referralCode: string;
        }>(
          '/auth/registration/complete',
          { otp_id: otpId, idempotency_key: idempotencyKey },
          { skipAuth: true },
        );

        // Store tokens — the complete endpoint also returns tokens
        // The tokens come back as the response body
        // We need to call the refresh endpoint to get tokens
        // The complete endpoint returns account info but doesn't set tokens
        // We need to do a login flow here or have the backend set tokens
        // Based on the controller, completeRegistration returns accountId, memberId, etc.
        // The backend may issue tokens in cookies on complete

        // Try to restore session (backend should have set refresh cookie)
        const restored = await apiClient.attemptSessionRestore();
        if (!restored) {
          // Fallback: navigate to login
          navigate('/login', { replace: true });
          return;
        }

        // Navigate to home
        navigate('/', { replace: true });
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          if (error.status === 409) {
            // Idempotency conflict — already completed, try to restore session
            const restored = await apiClient.attemptSessionRestore();
            if (restored) {
              navigate('/', { replace: true });
              return;
            }
          }
        }

        setOtpState((prev) => ({
          ...prev,
          step: 'verify-otp',
          verified: false,
          error: t('auth.somethingWentWrong'),
          errorTitle: t('common.error'),
        }));
      }
    },
    [navigate, t],
  );

  /* ---- Resend OTP ---- */

  const handleResend = useCallback(async () => {
    if (otpState.resendCooldown > 0 || otpState.resending) return;

    setOtpState((prev) => ({ ...prev, resending: true }));

    try {
      const response = await apiClient.post<{ otp_id: string }>(
        '/auth/registration/resend',
        { otp_id: otpState.otpId },
        { skipAuth: true },
      );

      const newOtpId = response.data.otp_id;
      setOtpState((prev) => ({
        ...prev,
        otpId: newOtpId,
        error: null,
        errorTitle: null,
        resendCooldown: RESEND_COOLDOWN_SECONDS,
        resending: false,
        attemptsRemaining: null,
        verified: false,
      }));
      setDigits(Array(OTP_LENGTH).fill(''));
      digitRefs.current[0]?.focus();

      // Update URL param
      navigate(`/register/verify?otp_id=${encodeURIComponent(newOtpId)}`, {
        replace: true,
      });
    } catch (error: unknown) {
      setOtpState((prev) => ({ ...prev, resending: false }));

      if (error instanceof ApiError) {
        if (error.status === 429) {
          // Cooldown still active — could extract retry-after
          const retryAfter =
            error.body.retryAfterSeconds ?? RESEND_COOLDOWN_SECONDS;
          setOtpState((prev) => ({
            ...prev,
            resendCooldown: retryAfter,
            error: null,
          }));
          return;
        }

        setOtpState((prev) => ({
          ...prev,
          error: error.body.message ?? t('auth.somethingWentWrong'),
          errorTitle: error.body.code ?? t('common.error'),
        }));
        return;
      }

      setOtpState((prev) => ({
        ...prev,
        error: t('auth.somethingWentWrong'),
        errorTitle: t('common.error'),
      }));
    }
  }, [
    otpState.otpId,
    otpState.resendCooldown,
    otpState.resending,
    t,
    navigate,
  ]);

  /* ---- Helper: show resend button ---- */

  const showResend =
    otpState.step === 'verify-otp' &&
    (otpState.error === t('auth.otpExpired') ||
      otpState.error === t('auth.otpExhausted'));

  /* ---- Render ---- */

  const isVerifying = otpState.step === 'verify-otp';
  const isCompleting = otpState.step === 'complete-submitting';

  return (
    <PublicLayout>
      <h1 className="ip-page-header__title">{t('auth.verifyOtpTitle')}</h1>
      <p
        className="ip-text-muted ip-mb-3"
        style={{
          color: 'var(--ip-color-text-muted)',
          marginBottom: 'var(--ip-space-3)',
        }}
      >
        {t('auth.verifyOtpDescription')}
      </p>

      {/* Error alert */}
      {otpState.error && (
        <Alert
          tone={
            otpState.error === t('auth.otpExpired') ||
            otpState.error === t('auth.otpExhausted')
              ? 'warning'
              : 'error'
          }
          title={otpState.errorTitle ?? t('common.error')}
          className="ip-mb-3"
        >
          <p>{otpState.error}</p>
          {showResend && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleResend}
              loading={otpState.resending}
              className="ip-mt-2"
            >
              {t('auth.resendCode')}
            </Button>
          )}
        </Alert>
      )}

      {/* Completing state */}
      {isCompleting && (
        <div style={{ textAlign: 'center', padding: 'var(--ip-space-4) 0' }}>
          <Spinner size="lg" label={t('auth.completeSubmitting')} />
          <p style={{ marginTop: 'var(--ip-space-2)' }}>
            {t('auth.completeSubmitting')}
          </p>
        </div>
      )}

      {/* OTP form */}
      {isVerifying && (
        <form ref={formRef} onSubmit={handleVerify} noValidate>
          <FormField label={t('auth.otpCode')} htmlFor="otp-digit-0">
            <div
              className="ip-otp-input-group"
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
                  id={`otp-digit-${index}`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigitChange(index, e.target.value)}
                  onKeyDown={(e) => handleDigitKeyDown(index, e)}
                  onPaste={index === 0 ? handleDigitPaste : undefined}
                  aria-label={t('auth.otpDigitLabel', { position: index + 1 })}
                  disabled={isCompleting}
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

          {/* Submit */}
          <Button
            type="submit"
            variant="primary"
            fullWidth
            loading={
              isVerifying && otpState.step === 'verify-otp' && !otpState.error
            }
            loadingLabel={t('auth.submittingOtp')}
            disabled={isVerifying && digits.join('').length !== OTP_LENGTH}
            className="ip-mt-3"
          >
            {t('auth.submitOtp')}
          </Button>
        </form>
      )}

      {/* Resend link (non-expired/exhausted state) */}
      {isVerifying && !showResend && (
        <div
          style={{
            textAlign: 'center',
            marginTop: 'var(--ip-space-3)',
          }}
        >
          {otpState.resendCooldown > 0 ? (
            <span className="ip-text-muted ip-text-sm">
              {t('auth.resendCooldown', { seconds: otpState.resendCooldown })}
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResend}
              loading={otpState.resending}
              disabled={otpState.resendCooldown > 0}
            >
              {t('auth.resendCode')}
            </Button>
          )}
        </div>
      )}
    </PublicLayout>
  );
}
