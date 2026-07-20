import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Input, FormField, Alert } from '@ipoint/ui';
import { ApiError } from '@ipoint/api-client';
import { isValidEmail } from '../utils/validation';
import { validateReturnUrl } from '../utils/url';
import { useAuth } from '../auth/useAuth';
import { PublicLayout } from '../layouts/PublicLayout';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LoginState {
  kind: 'form' | 'submitting' | 'error';
  fieldErrors: { email?: string; password?: string };
  globalError: string | null;
  errorTitle: string | null;
}

/* ------------------------------------------------------------------ */
/*  LoginPage                                                          */
/* ------------------------------------------------------------------ */

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated, login } = useAuth();
  const [searchParams] = useSearchParams();

  const returnUrl = validateReturnUrl(searchParams.get('returnUrl'));

  const [state, setState] = useState<LoginState>({
    kind: 'form',
    fieldErrors: {},
    globalError: null,
    errorTitle: null,
  });

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Redirect if already authenticated (useEffect to avoid concurrent render hooks mismatch)
  useEffect(() => {
    if (isAuthenticated) {
      void navigate(returnUrl ?? '/', { replace: true });
    }
  }, [isAuthenticated, navigate, returnUrl]);

  const validate = useCallback((): {
    email?: string;
    password?: string;
  } | null => {
    const errors: { email?: string; password?: string } = {};
    const email = emailRef.current?.value?.trim() ?? '';
    const password = passwordRef.current?.value ?? '';

    if (!email) {
      errors.email = t('register.fieldRequired');
    } else if (!isValidEmail(email)) {
      errors.email = t('register.invalidEmail');
    }

    if (!password) {
      errors.password = t('register.fieldRequired');
    }

    return Object.keys(errors).length > 0 ? errors : null;
  }, [t]);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (state.kind === 'submitting') return;

      const fieldErrors = validate();
      if (fieldErrors) {
        setState({
          kind: 'form',
          fieldErrors,
          globalError: null,
          errorTitle: null,
        });
        return;
      }

      const email = emailRef.current?.value?.trim().toLowerCase() ?? '';
      const password = passwordRef.current?.value ?? '';

      setState({
        kind: 'submitting',
        fieldErrors: {},
        globalError: null,
        errorTitle: null,
      });

      try {
        await login(email, password);

        // If login succeeded, redirect
        const target = returnUrl ?? '/';
        void navigate(target, { replace: true });
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          const code = error.body.code;
          const message = Array.isArray(error.body.message)
            ? (error.body.message[0] ?? null)
            : error.body.message;

          // Don't reveal which field is wrong — unified error
          if (code === 'AUTH_INVALID_CREDENTIALS') {
            setState({
              kind: 'error',
              fieldErrors: {},
              globalError: t('auth.invalidCredentials'),
              errorTitle: null,
            });
            return;
          }

          // Account inactive (suspended)
          if (code === 'AUTH_ACCOUNT_INACTIVE') {
            // Backend may send a more specific message
            if (message?.toLowerCase().includes('suspend')) {
              setState({
                kind: 'error',
                fieldErrors: {},
                globalError: t('auth.accountSuspended'),
                errorTitle: null,
              });
              return;
            }
            if (message?.toLowerCase().includes('close')) {
              setState({
                kind: 'error',
                fieldErrors: {},
                globalError: t('auth.accountClosed'),
                errorTitle: null,
              });
              return;
            }
            // Generic inactive
            setState({
              kind: 'error',
              fieldErrors: {},
              globalError: message ?? t('auth.somethingWentWrong'),
              errorTitle: code ?? t('common.error'),
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
          setState({
            kind: 'error',
            fieldErrors: {},
            globalError: message ?? t('auth.somethingWentWrong'),
            errorTitle: code ?? t('common.error'),
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
    [state.kind, validate, login, navigate, returnUrl, t],
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

  return (
    <PublicLayout>
      <h1 className="ip-page-header__title">{t('auth.login')}</h1>

      {/* Error */}
      {state.kind === 'error' && (
        <Alert tone="error" className="ip-mb-3">
          <p>{state.globalError}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRetry}
            className="ip-mt-2"
          >
            {t('common.retry')}
          </Button>
        </Alert>
      )}

      <form onSubmit={handleSubmit} noValidate>
        {/* Email */}
        <FormField
          label={t('auth.email')}
          htmlFor="login-email"
          error={state.fieldErrors.email}
        >
          <Input
            ref={emailRef}
            id="login-email"
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
          htmlFor="login-password"
          error={state.fieldErrors.password}
        >
          <Input
            ref={passwordRef}
            id="login-password"
            type="password"
            autoComplete="current-password"
            error={!!state.fieldErrors.password}
            disabled={isSubmitting}
            required
          />
        </FormField>

        {/* Submit */}
        <Button
          type="submit"
          variant="primary"
          fullWidth
          loading={isSubmitting}
          loadingLabel={t('auth.loginSubmitting')}
          disabled={isSubmitting}
          className="ip-mt-3"
        >
          {t('auth.loginButton')}
        </Button>
      </form>

      {/* Links */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 'var(--ip-space-2)',
          fontSize: 'var(--ip-font-size-body-sm)',
        }}
      >
        <Link to="/forgot-password">{t('auth.forgotPassword')}</Link>
        <Link to="/register">{t('auth.register')}</Link>
      </div>
    </PublicLayout>
  );
}
