import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  PageHeader,
  Card,
  FormField,
  Input,
  Select,
  Button,
  Alert,
  Skeleton,
} from '@ipoint/ui';
import { Lock, ArrowLeft } from 'lucide-react';
import { apiClient } from '../api/client';
import { useAbortController } from '../hooks/useAbortController';
import { isNonEmpty, isPhoneNumber } from '../utils/validation';

interface ProfileData {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  birthDate?: string;
  gender?: string;
  kycStatus: string;
  countryCode?: string;
  createdAt: string;
}

interface FieldErrors {
  name?: string;
  phone?: string;
  birthDate?: string;
  gender?: string;
}

type FetchState = 'idle' | 'loading' | 'error' | 'success';
type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

export function ProfileEditPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const abortController = useAbortController();
  const formRef = useRef<HTMLFormElement>(null);
  const submittedRef = useRef(false);

  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState('');
  const [email, setEmail] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const fetchProfile = useCallback(async () => {
    setFetchState('loading');
    setFetchError(null);
    try {
      const response = await apiClient.get<{ data: ProfileData }>('/profile', {
        signal: abortController.signal,
      });
      const data = response.data?.data ?? response.data;
      setEmail(data.email ?? '');
      setName(data.name ?? '');
      setPhone(data.phone ?? '');
      setBirthDate(data.birthDate ?? '');
      setGender(data.gender ?? '');
      setFetchState('success');
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setFetchState('error');
      setFetchError(t('common.error'));
    }
  }, [abortController, t]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  // Unsaved changes warning
  useEffect(() => {
    if (!isDirty) return;

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const validateField = useCallback(
    (field: string, value: string): string | undefined => {
      switch (field) {
        case 'name': {
          if (!isNonEmpty(value)) return t('profile.nameMinLength');
          return undefined;
        }
        case 'phone': {
          if (value && !isPhoneNumber(value)) return t('profile.invalidPhone');
          return undefined;
        }
        default:
          return undefined;
      }
    },
    [t],
  );

  const validateForm = useCallback((): boolean => {
    const errors: FieldErrors = {};
    const nameErr = validateField('name', name);
    if (nameErr) errors.name = nameErr;
    const phoneErr = validateField('phone', phone);
    if (phoneErr) errors.phone = phoneErr;
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [name, phone, validateField]);

  const initialLoadComplete = useRef(false);

  // Mark initial load as complete after first successful fetch
  useEffect(() => {
    if (fetchState === 'success' && !initialLoadComplete.current) {
      initialLoadComplete.current = true;
    }
  }, [fetchState]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (submittedRef.current || submitState === 'submitting') return;
      submittedRef.current = true;

      if (!validateForm()) {
        submittedRef.current = false;
        return;
      }

      setSubmitState('submitting');
      setSubmitError(null);
      setServerErrors({});

      try {
        await apiClient.patch('/profile', {
          name: name.trim(),
          phone: phone.trim() || undefined,
          birthDate: birthDate || undefined,
          gender: gender || undefined,
        });
        setSubmitState('success');
        void navigate('/profile');
      } catch (err: unknown) {
        submittedRef.current = false;
        setSubmitState('error');
        if (err instanceof Error) {
          // Try to extract field-level errors from the API error body
          const apiErr = err as {
            status?: number;
            body?: { errors?: Record<string, string> };
          };
          if (apiErr.body?.errors) {
            setServerErrors(apiErr.body.errors as FieldErrors);
          }
          const errBodyMsg = (apiErr.body as { message?: string | string[] })
            ?.message;
          const errMsg = Array.isArray(errBodyMsg)
            ? (errBodyMsg[0] ?? err.message)
            : (errBodyMsg ?? err.message);
          setSubmitError(errMsg);
        } else {
          setSubmitError(t('common.error'));
        }
      }
    },
    [name, phone, birthDate, gender, validateForm, navigate, submitState, t],
  );

  const handleFieldChange = useCallback((field: string, value: string) => {
    // Mark form as dirty on user interaction (only after initial load)
    if (initialLoadComplete.current) {
      setIsDirty(true);
    }

    // Clear field error on change
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    setServerErrors((prev) => ({ ...prev, [field]: undefined }));

    switch (field) {
      case 'name':
        setName(value);
        break;
      case 'phone':
        setPhone(value);
        break;
      case 'birthDate':
        setBirthDate(value);
        break;
      case 'gender':
        setGender(value);
        break;
    }
  }, []);

  if (fetchState === 'loading') {
    return (
      <>
        <PageHeader title={t('profile.edit')} />
        <Card>
          <Skeleton width="100%" height="40px" />
          <Skeleton width="100%" height="40px" />
          <Skeleton width="100%" height="40px" />
          <Skeleton width="100%" height="40px" />
        </Card>
      </>
    );
  }

  if (fetchState === 'error') {
    return (
      <>
        <PageHeader title={t('profile.edit')} />
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

  return (
    <>
      <PageHeader
        title={t('profile.edit')}
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/profile')}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>{t('profile.cancelButton')}</span>
          </Button>
        }
      />

      {submitState === 'error' && submitError && (
        <Alert tone="error" title={t('common.error')}>
          <p>{submitError}</p>
        </Alert>
      )}

      <Card>
        <form ref={formRef} onSubmit={handleSubmit} noValidate>
          {/* Email — read only */}
          <FormField
            label={t('profile.email')}
            htmlFor="edit-email"
            hint={t('profile.emailReadOnly')}
          >
            <div className="ip-input-with-icon">
              <Lock size={16} aria-hidden="true" />
              <Input
                id="edit-email"
                type="email"
                value={email}
                readOnly
                disabled
              />
            </div>
          </FormField>

          {/* Display Name */}
          <FormField
            label={t('profile.displayName')}
            htmlFor="edit-name"
            error={fieldErrors.name || serverErrors.name}
          >
            <Input
              id="edit-name"
              type="text"
              value={name}
              onChange={(e) => handleFieldChange('name', e.target.value)}
              error={!!(fieldErrors.name || serverErrors.name)}
              placeholder={t('profile.displayName')}
              maxLength={100}
            />
          </FormField>

          {/* Phone */}
          <FormField
            label={t('profile.phone')}
            htmlFor="edit-phone"
            optional
            error={fieldErrors.phone || serverErrors.phone}
          >
            <Input
              id="edit-phone"
              type="tel"
              value={phone}
              onChange={(e) => handleFieldChange('phone', e.target.value)}
              error={!!(fieldErrors.phone || serverErrors.phone)}
              placeholder="+60123456789"
              maxLength={20}
            />
          </FormField>

          {/* Birth Date */}
          <FormField
            label={t('profile.birthDate')}
            htmlFor="edit-birthdate"
            optional
          >
            <Input
              id="edit-birthdate"
              type="date"
              value={birthDate}
              onChange={(e) => handleFieldChange('birthDate', e.target.value)}
            />
          </FormField>

          {/* Gender */}
          <FormField label={t('profile.gender')} htmlFor="edit-gender" optional>
            <Select
              id="edit-gender"
              value={gender}
              onChange={(e) => handleFieldChange('gender', e.target.value)}
            >
              <option value="">—</option>
              <option value="male">{t('profile.genderMale')}</option>
              <option value="female">{t('profile.genderFemale')}</option>
              <option value="other">{t('profile.genderOther')}</option>
              <option value="unspecified">
                {t('profile.genderPreferNotToSay')}
              </option>
            </Select>
          </FormField>

          <div className="ip-form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate('/profile')}
            >
              {t('profile.cancelButton')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={submitState === 'submitting'}
              loadingLabel={t('profile.submittingButton')}
              disabled={submitState === 'submitting'}
            >
              {t('profile.submitButton')}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
