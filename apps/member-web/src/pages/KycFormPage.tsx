/**
 * KYC Personal Information Form — multi-section form with server-side save on blur.
 *
 * Security:
 * - No PII stored in localStorage/sessionStorage
 * - No identity number in URL parameters
 * - No caching of form data
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PageHeader,
  Card,
  Button,
  Input,
  Select,
  FormField,
  Alert,
  Spinner,
} from '@ipoint/ui';
import { ArrowLeft, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useKyc, saveDraftField, createKycDraft } from '../hooks/useKyc';
import { ApiError } from '@ipoint/api-client';
import type { KycIdentificationType } from '../api/types';

/** Client-side identification number validation (matches backend regex). */
const ID_NUMBER_REGEX = /^[A-Za-z0-9][A-Za-z0-9 ./-]{2,63}$/u;

/** Date of birth format regex. */
const DOB_REGEX = /^\d{4}-\d{2}-\d{2}$/u;

/** Nationality format (ISO 3166-1 alpha-2). */
const NATIONALITY_REGEX = /^[A-Za-z]{2}$/u;

/** Maximum length for legal full name. */
const MAX_LEGAL_NAME_LENGTH = 500;

interface FormErrors {
  legalFullName?: string;
  identificationType?: string;
  identificationNumber?: string;
  dateOfBirth?: string;
  nationality?: string;
  addressStreet?: string;
  addressCity?: string;
  addressState?: string;
  addressPostalCode?: string;
  addressCountry?: string;
  general?: string;
}

interface FormValues {
  legalFullName: string;
  identificationType: KycIdentificationType | '';
  identificationNumber: string;
  dateOfBirth: string;
  nationality: string;
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressPostalCode: string;
  addressCountry: string;
}

const IDENTIFICATION_TYPE_OPTIONS = [
  { value: '', label: '' },
  { value: 'PASSPORT', labelKey: 'kyc.form.identificationTypePassport' },
  { value: 'NATIONAL_ID', labelKey: 'kyc.form.identificationTypeNationalId' },
  {
    value: 'DRIVING_LICENSE',
    labelKey: 'kyc.form.identificationTypeDrivingLicense',
  },
  {
    value: 'RESIDENCE_PERMIT',
    labelKey: 'kyc.form.identificationTypeResidencePermit',
  },
  { value: 'OTHER', labelKey: 'kyc.form.identificationTypeOther' },
];

function validateForm(values: FormValues): FormErrors {
  const errors: FormErrors = {};

  if (!values.legalFullName.trim()) {
    errors.legalFullName = 'Field is required';
  } else if (values.legalFullName.trim().length > MAX_LEGAL_NAME_LENGTH) {
    errors.legalFullName = `Maximum ${MAX_LEGAL_NAME_LENGTH} characters`;
  }

  if (!values.identificationType) {
    errors.identificationType = 'Field is required';
  }

  if (!values.identificationNumber.trim()) {
    errors.identificationNumber = 'Field is required';
  } else if (!ID_NUMBER_REGEX.test(values.identificationNumber.trim())) {
    errors.identificationNumber = 'Invalid identification number format';
  }

  if (!values.dateOfBirth.trim()) {
    errors.dateOfBirth = 'Field is required';
  } else if (!DOB_REGEX.test(values.dateOfBirth.trim())) {
    errors.dateOfBirth = 'Use YYYY-MM-DD format';
  } else {
    const date = new Date(`${values.dateOfBirth}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      errors.dateOfBirth = 'Invalid date';
    } else if (date > new Date()) {
      errors.dateOfBirth = 'Date cannot be in the future';
    }
  }

  if (!values.nationality.trim()) {
    errors.nationality = 'Field is required';
  } else if (!NATIONALITY_REGEX.test(values.nationality.trim())) {
    errors.nationality = 'Enter a 2-letter country code';
  }

  if (!values.addressStreet.trim()) errors.addressStreet = 'Field is required';
  if (!values.addressCity.trim()) errors.addressCity = 'Field is required';
  if (!values.addressState.trim()) errors.addressState = 'Field is required';
  if (!values.addressPostalCode.trim())
    errors.addressPostalCode = 'Field is required';
  if (!values.addressCountry.trim())
    errors.addressCountry = 'Field is required';

  return errors;
}

/**
 * KYC Form Page — personal information and address sections.
 */
export function KycFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { state, fetchKyc } = useKyc();

  const [values, setValues] = useState<FormValues>({
    legalFullName: '',
    identificationType: '',
    identificationNumber: '',
    dateOfBirth: '',
    nationality: '',
    addressStreet: '',
    addressCity: '',
    addressState: '',
    addressPostalCode: '',
    addressCountry: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'success' | 'error' | 'dirty'
  >('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load existing KYC data into form
  useEffect(() => {
    if (state.data && initialLoad) {
      const kyc = state.data;
      setValues({
        legalFullName: kyc.legalFullName ?? '',
        identificationType:
          (kyc.identificationType as KycIdentificationType) ?? '',
        identificationNumber: kyc.identificationNumber ?? '',
        dateOfBirth: kyc.dateOfBirth ?? '',
        nationality: kyc.nationality ?? '',
        addressStreet: '',
        addressCity: '',
        addressState: '',
        addressPostalCode: '',
        addressCountry: '',
      });

      // Parse residential address if available
      if (kyc.residentialAddress) {
        const addr = kyc.residentialAddress as Record<string, string>;
        setValues((prev) => ({
          ...prev,
          addressStreet: addr.street ?? addr.streetAddress ?? '',
          addressCity: addr.city ?? '',
          addressState: addr.state ?? '',
          addressPostalCode: addr.postalCode ?? addr.postal_code ?? '',
          addressCountry: addr.country ?? '',
        }));
      }

      setInitialLoad(false);
    }
  }, [state.data, initialLoad]);

  // If no KYC data or NOT_STARTED, create a draft
  useEffect(() => {
    if (!state.isLoading && !state.data) {
      void handleCreateDraft();
    }
  }, [state.isLoading, state.data]);

  const handleCreateDraft = useCallback(async () => {
    try {
      await createKycDraft();
      await fetchKyc();
    } catch {
      // handled by fetchKyc
    }
  }, [fetchKyc]);

  const handleChange = useCallback((field: keyof FormValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setSaveStatus('dirty');
    // Clear field error on change
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  }, []);

  const handleBlur = useCallback(
    async (field: keyof FormValues) => {
      const value = values[field];
      const payload: Record<string, string> = {};

      // Skip if value is empty or same as initial (only for certain fields)
      if (field === 'identificationNumber' && !value.trim()) return;
      if (field === 'legalFullName' && !value.trim()) return;
      if (field === 'nationality' && !value.trim()) return;
      if (field === 'dateOfBirth' && !value.trim()) return;
      if (field === 'identificationType' && !value) return;

      // Map field to API field
      switch (field) {
        case 'legalFullName':
          payload.legalFullName = value.trim();
          break;
        case 'identificationType':
          if (value) payload.identificationType = value;
          else return;
          break;
        case 'identificationNumber':
          if (value.trim()) payload.identificationNumber = value.trim();
          else return;
          break;
        case 'dateOfBirth':
          if (value.trim()) payload.dateOfBirth = value.trim();
          else return;
          break;
        case 'nationality':
          if (value.trim()) payload.nationality = value.trim().toUpperCase();
          else return;
          break;
        default:
          return; // Address fields saved together via explicit save
      }

      if (Object.keys(payload).length === 0) return;

      // Cancel any in-flight save
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setSaveStatus('saving');
      setSaveError(null);

      try {
        await saveDraftField(payload, controller.signal);
        setSaveStatus('success');
        // Reset success after 2 seconds
        setTimeout(() => {
          setSaveStatus((prev) => (prev === 'success' ? 'idle' : prev));
        }, 2000);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        if (error instanceof ApiError) {
          if (error.body.code === 'KYC_IDENTIFICATION_NUMBER_INVALID') {
            setErrors((prev) => ({
              ...prev,
              identificationNumber: 'Invalid format',
            }));
          }
        }
        setSaveStatus('error');
        setSaveError(
          error instanceof Error
            ? error.message
            : 'Failed to save. Please try again.',
        );
      }
    },
    [values],
  );

  const handleSaveAll = useCallback(async () => {
    const validationErrors = validateForm(values);
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      setSaveStatus('error');
      setSaveError('Please check all required fields');
      return;
    }

    // Cancel any in-flight save
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSaveStatus('saving');
    setSaveError(null);

    try {
      // Save identity fields
      const identityPayload: Record<string, string> = {
        legalFullName: values.legalFullName.trim(),
        identificationType: values.identificationType,
        identificationNumber: values.identificationNumber.trim(),
        dateOfBirth: values.dateOfBirth.trim(),
        nationality: values.nationality.trim().toUpperCase(),
      };
      await saveDraftField(identityPayload, controller.signal);

      // Save address fields
      const addressPayload = {
        residentialAddress: {
          street: values.addressStreet.trim(),
          city: values.addressCity.trim(),
          state: values.addressState.trim(),
          postalCode: values.addressPostalCode.trim(),
          country: values.addressCountry.trim(),
        },
      };
      await saveDraftField(addressPayload, controller.signal);

      setSaveStatus('success');
      setTimeout(() => {
        setSaveStatus('idle');
      }, 2000);
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (error instanceof ApiError) {
        if (error.body.code === 'KYC_IDENTIFICATION_NUMBER_INVALID') {
          setErrors((prev) => ({
            ...prev,
            identificationNumber: 'Invalid format',
          }));
        }
      }
      setSaveStatus('error');
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Failed to save. Please try again.',
      );
    }
  }, [values]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (state.isLoading && initialLoad) {
    return (
      <div>
        <PageHeader
          title={t('kyc.form.title')}
          actions={
            <Button variant="ghost" onClick={() => navigate('/kyc')}>
              <ArrowLeft size={16} /> {t('common.back')}
            </Button>
          }
        />
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

  return (
    <div>
      <PageHeader
        title={t('kyc.form.title')}
        actions={
          <Button variant="ghost" onClick={() => navigate('/kyc')}>
            <ArrowLeft size={16} /> {t('common.back')}
          </Button>
        }
      />

      {/* Save status indicator */}
      {saveStatus === 'success' && (
        <div style={{ marginBottom: '1rem' }}>
          <Alert tone="success" title={t('kyc.form.saveSuccess')} />
        </div>
      )}
      {saveStatus === 'error' && saveError && (
        <div style={{ marginBottom: '1rem' }}>
          <Alert tone="error" title={saveError} />
        </div>
      )}

      {/* Identity Section */}
      <Card>
        <h3
          style={{
            marginBottom: '1.5rem',
            fontSize: '1.125rem',
            fontWeight: 600,
          }}
        >
          {t('kyc.form.sectionIdentity')}
        </h3>

        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
        >
          <FormField
            label={t('kyc.form.legalFullName')}
            htmlFor="kyc-legal-name"
            error={errors.legalFullName}
          >
            <Input
              id="kyc-legal-name"
              value={values.legalFullName}
              onChange={(e) => handleChange('legalFullName', e.target.value)}
              onBlur={() => handleBlur('legalFullName')}
              placeholder={t('kyc.form.legalFullNamePlaceholder')}
              maxLength={MAX_LEGAL_NAME_LENGTH}
              error={!!errors.legalFullName}
            />
          </FormField>

          <FormField
            label={t('kyc.form.identificationType')}
            htmlFor="kyc-id-type"
            error={errors.identificationType}
          >
            <Select
              id="kyc-id-type"
              value={values.identificationType}
              onChange={(e) =>
                handleChange('identificationType', e.target.value)
              }
              onBlur={() => handleBlur('identificationType')}
              error={!!errors.identificationType}
            >
              <option value="">
                {t('kyc.form.identificationTypePlaceholder')}
              </option>
              {IDENTIFICATION_TYPE_OPTIONS.filter((o) => o.value).map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey as string)}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            label={t('kyc.form.identificationNumber')}
            htmlFor="kyc-id-number"
            hint={t('kyc.form.identificationNumberHint')}
            error={errors.identificationNumber}
          >
            <Input
              id="kyc-id-number"
              value={values.identificationNumber}
              onChange={(e) =>
                handleChange('identificationNumber', e.target.value)
              }
              onBlur={() => handleBlur('identificationNumber')}
              error={!!errors.identificationNumber}
            />
          </FormField>

          <FormField
            label={t('kyc.form.dateOfBirth')}
            htmlFor="kyc-dob"
            error={errors.dateOfBirth}
          >
            <Input
              id="kyc-dob"
              value={values.dateOfBirth}
              onChange={(e) => handleChange('dateOfBirth', e.target.value)}
              onBlur={() => handleBlur('dateOfBirth')}
              placeholder={t('kyc.form.dateOfBirthPlaceholder')}
              error={!!errors.dateOfBirth}
            />
          </FormField>

          <FormField
            label={t('kyc.form.nationality')}
            htmlFor="kyc-nationality"
            error={errors.nationality}
          >
            <Input
              id="kyc-nationality"
              value={values.nationality}
              onChange={(e) =>
                handleChange('nationality', e.target.value.toUpperCase())
              }
              onBlur={() => handleBlur('nationality')}
              placeholder={t('kyc.form.nationalityPlaceholder')}
              maxLength={2}
              error={!!errors.nationality}
            />
          </FormField>
        </div>
      </Card>

      {/* Address Section */}
      <div style={{ marginTop: '1.5rem' }}>
        <Card>
          <h3
            style={{
              marginBottom: '1.5rem',
              fontSize: '1.125rem',
              fontWeight: 600,
            }}
          >
            {t('kyc.form.sectionAddress')}
          </h3>

          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
          >
            <FormField
              label={t('kyc.form.addressStreet')}
              htmlFor="kyc-address-street"
              error={errors.addressStreet}
            >
              <Input
                id="kyc-address-street"
                value={values.addressStreet}
                onChange={(e) => handleChange('addressStreet', e.target.value)}
                error={!!errors.addressStreet}
              />
            </FormField>

            <FormField
              label={t('kyc.form.addressCity')}
              htmlFor="kyc-address-city"
              error={errors.addressCity}
            >
              <Input
                id="kyc-address-city"
                value={values.addressCity}
                onChange={(e) => handleChange('addressCity', e.target.value)}
                error={!!errors.addressCity}
              />
            </FormField>

            <FormField
              label={t('kyc.form.addressState')}
              htmlFor="kyc-address-state"
              error={errors.addressState}
            >
              <Input
                id="kyc-address-state"
                value={values.addressState}
                onChange={(e) => handleChange('addressState', e.target.value)}
                error={!!errors.addressState}
              />
            </FormField>

            <FormField
              label={t('kyc.form.addressPostalCode')}
              htmlFor="kyc-address-postal"
              error={errors.addressPostalCode}
            >
              <Input
                id="kyc-address-postal"
                value={values.addressPostalCode}
                onChange={(e) =>
                  handleChange('addressPostalCode', e.target.value)
                }
                error={!!errors.addressPostalCode}
              />
            </FormField>

            <FormField
              label={t('kyc.form.addressCountry')}
              htmlFor="kyc-address-country"
              error={errors.addressCountry}
            >
              <Input
                id="kyc-address-country"
                value={values.addressCountry}
                onChange={(e) =>
                  handleChange('addressCountry', e.target.value.toUpperCase())
                }
                error={!!errors.addressCountry}
              />
            </FormField>
          </div>
        </Card>
      </div>

      {/* Submit section */}
      <div
        style={{
          marginTop: '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Button variant="secondary" onClick={() => navigate('/kyc/documents')}>
          {t('kyc.documents.title')}
        </Button>
        <Button
          variant="primary"
          onClick={handleSaveAll}
          loading={saveStatus === 'saving'}
        >
          <Save size={16} />
          {saveStatus === 'saving'
            ? t('kyc.form.submitting')
            : t('common.save')}
        </Button>
      </div>
    </div>
  );
}

export default KycFormPage;
