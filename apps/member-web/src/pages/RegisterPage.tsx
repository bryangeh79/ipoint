import { useCallback, useState, useRef, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Input, Select, Checkbox, FormField, Alert } from '@ipoint/ui';
import { apiClient } from '../api/client';
import { ApiError, createIdempotencyKey } from '@ipoint/api-client';
import { isValidEmail, isMinLength } from '../utils/validation';
import { PublicLayout } from '../layouts/PublicLayout';

/* ------------------------------------------------------------------ */
/*  Field error types                                                  */
/* ------------------------------------------------------------------ */

type FieldName =
  | 'email'
  | 'password'
  | 'confirmPassword'
  | 'referralCode'
  | 'accountCountry'
  | 'terms'
  | 'disclaimer'
  | 'privacy';

type FieldErrors = Partial<Record<FieldName, string>>;

interface PageState {
  kind: 'form' | 'submitting' | 'error' | 'redirect';
  fieldErrors: FieldErrors;
  globalError: string | null;
  errorTitle: string | null;
}

/* ------------------------------------------------------------------ */
/*  Countries (active markets) — CONFIGURABLE list                     */
/* ------------------------------------------------------------------ */

interface CountryOption {
  code: string;
  name: string;
}

const ACTIVE_COUNTRIES: CountryOption[] = [
  { code: 'MY', name: 'Malaysia' },
  { code: 'SG', name: 'Singapore' },
  { code: 'TH', name: 'Thailand' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'PH', name: 'Philippines' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'TW', name: 'Taiwan' },
];

/* ------------------------------------------------------------------ */
/*  Terms / disclaimer / privacy versions — CONFIGURABLE               */
/* ------------------------------------------------------------------ */

const CURRENT_TERMS_VERSION = '1.0';
const CURRENT_DISCLAIMER_VERSION = '1.0';
const CURRENT_PRIVACY_VERSION = '1.0';

/* ------------------------------------------------------------------ */
/*  RegisterPage                                                       */
/* ------------------------------------------------------------------ */

export function RegisterPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [state, setState] = useState<PageState>({
    kind: 'form',
    fieldErrors: {},
    globalError: null,
    errorTitle: null,
  });

  // Form refs for uncontrolled inputs
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const referralCodeRef = useRef<HTMLInputElement>(null);
  const countryRef = useRef<HTMLSelectElement>(null);
  const termsRef = useRef<HTMLDivElement>(null);
  const disclaimerRef = useRef<HTMLDivElement>(null);
  const privacyRef = useRef<HTMLDivElement>(null);

  function isCheckboxChecked(
    ref: React.RefObject<HTMLDivElement | null>,
  ): boolean {
    if (!ref.current) return false;
    const input = ref.current.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    return input?.checked ?? false;
  }

  const validate = useCallback((): FieldErrors | null => {
    const errors: FieldErrors = {};
    const email = emailRef.current?.value?.trim().toLowerCase() ?? '';
    const password = passwordRef.current?.value ?? '';
    const confirmPassword = confirmPasswordRef.current?.value ?? '';
    const referralCode = referralCodeRef.current?.value?.trim() ?? '';
    const accountCountry = countryRef.current?.value ?? '';
    const terms = isCheckboxChecked(termsRef);
    const disclaimer = isCheckboxChecked(disclaimerRef);
    const privacy = isCheckboxChecked(privacyRef);

    // Email
    if (!email) {
      errors.email = t('register.fieldRequired');
    } else if (!isValidEmail(email)) {
      errors.email = t('register.invalidEmail');
    }

    // Password
    if (!password) {
      errors.password = t('register.fieldRequired');
    } else if (!isMinLength(password, 12)) {
      errors.password = t('auth.passwordMinLength');
    }

    // Confirm password
    if (!confirmPassword) {
      errors.confirmPassword = t('register.fieldRequired');
    } else if (password !== confirmPassword) {
      errors.confirmPassword = t('auth.passwordMismatch');
    }

    // Referral code (optional but must be valid if provided)
    if (referralCode && !/^[A-Za-z0-9]{8,}$/.test(referralCode)) {
      errors.referralCode = t('register.invalidReferralCode');
    }

    // Country
    if (!accountCountry) {
      errors.accountCountry = t('register.countryRequired');
    }

    // Consent checkboxes
    if (!terms) {
      errors.terms = t('register.termsRequired');
    }
    if (!disclaimer) {
      errors.disclaimer = t('register.disclaimerRequired');
    }
    if (!privacy) {
      errors.privacy = t('register.privacyRequired');
    }

    return Object.keys(errors).length > 0 ? errors : null;
  }, [t]);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();

      // Don't re-submit while submitting
      if (state.kind === 'submitting') return;

      // Validate
      const errors = validate();
      if (errors) {
        setState({
          kind: 'form',
          fieldErrors: errors,
          globalError: null,
          errorTitle: null,
        });
        return;
      }

      const email = emailRef.current?.value?.trim().toLowerCase() ?? '';
      const password = passwordRef.current?.value ?? '';
      const referralCode =
        (referralCodeRef.current?.value?.trim() ?? '') || undefined;
      const accountCountry = countryRef.current?.value ?? '';
      const idempotencyKey = createIdempotencyKey();

      setState({
        kind: 'submitting',
        fieldErrors: {},
        globalError: null,
        errorTitle: null,
      });

      try {
        const response = await apiClient.post<{
          otp_id: string;
          expires_at: string;
        }>(
          '/auth/registration/initiate',
          {
            email,
            password,
            account_country: accountCountry,
            referral_code: referralCode,
            terms_version: CURRENT_TERMS_VERSION,
            disclaimer_version: CURRENT_DISCLAIMER_VERSION,
            privacy_version: CURRENT_PRIVACY_VERSION,
            locale: i18n.language ?? 'en',
            idempotency_key: idempotencyKey,
          },
          { skipAuth: true },
        );

        // On success (202), navigate to OTP verification
        const otpId = response.data.otp_id;
        void navigate(`/register/verify?otp_id=${encodeURIComponent(otpId)}`);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          if (error.status === 409) {
            // AUTH_MEMBER_ALREADY_EXISTS or AUTH_IDEMPOTENCY_CONFLICT
            setState({
              kind: 'error',
              fieldErrors: {},
              globalError: t('auth.emailAlreadyRegistered'),
              errorTitle: null,
            });
            return;
          }

          if (error.status === 400 || error.status === 422) {
            // Zod validation errors — try to parse per-field errors
            const body = error.body;
            if (body.errors && typeof body.errors === 'object') {
              // Backend may return per-field validation errors
              const parsed: FieldErrors = {};
              for (const [key, msg] of Object.entries(
                body.errors as Record<string, unknown>,
              )) {
                const field = key as FieldName;
                parsed[field] = String(msg);
              }
              setState({
                kind: 'error',
                fieldErrors: parsed,
                globalError: null,
                errorTitle: t('errors.validationFailed'),
              });
              return;
            }

            // Generic bad request
            const genericMsg = Array.isArray(body.message)
              ? (body.message[0] ?? t('auth.somethingWentWrong'))
              : (body.message ?? t('auth.somethingWentWrong'));
            setState({
              kind: 'error',
              fieldErrors: {},
              globalError: genericMsg,
              errorTitle: error.body.code ?? t('common.error'),
            });
            return;
          }

          if (error.status === 0) {
            setState({
              kind: 'error',
              fieldErrors: {},
              globalError: t('auth.networkError'),
              errorTitle: t('errors.offline'),
            });
            return;
          }

          // Other errors
          const otherMsg = Array.isArray(error.body.message)
            ? (error.body.message[0] ?? t('auth.somethingWentWrong'))
            : (error.body.message ?? t('auth.somethingWentWrong'));
          setState({
            kind: 'error',
            fieldErrors: {},
            globalError: otherMsg,
            errorTitle: error.body.code ?? t('common.error'),
          });
          return;
        }

        // Non-ApiError (programming error)
        setState({
          kind: 'error',
          fieldErrors: {},
          globalError: t('auth.somethingWentWrong'),
          errorTitle: t('common.error'),
        });
      }
    },
    [state.kind, validate, navigate, t, i18n.language],
  );

  const handleRetry = useCallback(() => {
    setState({
      kind: 'form',
      fieldErrors: {},
      globalError: null,
      errorTitle: null,
    });
  }, []);

  const isSubmitting = state.kind === 'submitting';
  const isEmailAlreadyRegistered =
    state.kind === 'error' &&
    state.globalError === t('auth.emailAlreadyRegistered');

  return (
    <PublicLayout>
      <h1 className="ip-page-header__title">{t('auth.registerTitle')}</h1>

      {/* Already registered error */}
      {isEmailAlreadyRegistered && (
        <Alert tone="warning" className="ip-mb-3">
          <p>{t('auth.emailAlreadyRegistered')}</p>
          <Link to="/login">{t('auth.emailAlreadyRegisteredLink')}</Link>
        </Alert>
      )}

      {/* General error */}
      {state.kind === 'error' && !isEmailAlreadyRegistered && (
        <Alert
          tone="error"
          title={state.errorTitle ?? t('common.error')}
          className="ip-mb-3"
        >
          <p>{state.globalError}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRetry}
            className="ip-mt-2"
          >
            {t('auth.retry')}
          </Button>
        </Alert>
      )}

      <form onSubmit={handleSubmit} noValidate>
        {/* Email */}
        <FormField
          label={t('auth.email')}
          htmlFor="register-email"
          error={state.fieldErrors.email}
        >
          <Input
            ref={emailRef}
            id="register-email"
            type="email"
            autoComplete="email"
            placeholder={t('auth.emailPlaceholder')}
            error={!!state.fieldErrors.email}
            disabled={isSubmitting}
            required
          />
        </FormField>

        {/* Password */}
        <FormField
          label={t('auth.password')}
          htmlFor="register-password"
          error={state.fieldErrors.password}
        >
          <Input
            ref={passwordRef}
            id="register-password"
            type="password"
            autoComplete="new-password"
            error={!!state.fieldErrors.password}
            disabled={isSubmitting}
            required
            minLength={12}
          />
        </FormField>

        {/* Confirm Password */}
        <FormField
          label={t('auth.confirmPassword')}
          htmlFor="register-confirm-password"
          error={state.fieldErrors.confirmPassword}
        >
          <Input
            ref={confirmPasswordRef}
            id="register-confirm-password"
            type="password"
            autoComplete="new-password"
            error={!!state.fieldErrors.confirmPassword}
            disabled={isSubmitting}
            required
          />
        </FormField>

        {/* Referral Code */}
        <FormField
          label={t('auth.referralCode')}
          htmlFor="register-referral-code"
          hint={t('auth.referralCodeHint')}
          error={state.fieldErrors.referralCode}
          optional
        >
          <Input
            ref={referralCodeRef}
            id="register-referral-code"
            type="text"
            autoComplete="off"
            error={!!state.fieldErrors.referralCode}
            disabled={isSubmitting}
          />
        </FormField>

        {/* Account Country */}
        <FormField
          label={t('auth.accountCountry')}
          htmlFor="register-country"
          error={state.fieldErrors.accountCountry}
        >
          <Select
            ref={countryRef}
            id="register-country"
            error={!!state.fieldErrors.accountCountry}
            disabled={isSubmitting}
            defaultValue=""
          >
            <option value="" disabled>
              {t('auth.selectCountry')}
            </option>
            {ACTIVE_COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </Select>
        </FormField>

        {/* Consent checkboxes */}
        <FormField
          label=""
          htmlFor="register-terms"
          error={state.fieldErrors.terms}
        >
          <div ref={termsRef}>
            <Checkbox
              id="register-terms"
              label={t('auth.termsLabel')}
              error={!!state.fieldErrors.terms}
              disabled={isSubmitting}
              required
            />
          </div>
        </FormField>

        <FormField
          label=""
          htmlFor="register-disclaimer"
          error={state.fieldErrors.disclaimer}
        >
          <div ref={disclaimerRef}>
            <Checkbox
              id="register-disclaimer"
              label={t('auth.disclaimerLabel')}
              error={!!state.fieldErrors.disclaimer}
              disabled={isSubmitting}
              required
            />
          </div>
        </FormField>

        <FormField
          label=""
          htmlFor="register-privacy"
          error={state.fieldErrors.privacy}
        >
          <div ref={privacyRef}>
            <Checkbox
              id="register-privacy"
              label={t('auth.privacyLabel')}
              error={!!state.fieldErrors.privacy}
              disabled={isSubmitting}
              required
            />
          </div>
        </FormField>

        {/* Submit */}
        <Button
          type="submit"
          variant="primary"
          fullWidth
          loading={isSubmitting}
          loadingLabel={t('auth.submittingRegister')}
          disabled={isSubmitting}
          className="ip-mt-3"
        >
          {t('auth.submitRegister')}
        </Button>
      </form>

      {/* Login link */}
      <p
        className="ip-text-center ip-text-sm ip-mt-3"
        style={{ marginTop: 'var(--ip-space-3)', textAlign: 'center' }}
      >
        {t('auth.haveAccount')} <Link to="/login">{t('auth.login')}</Link>
      </p>
    </PublicLayout>
  );
}
