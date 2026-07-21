/**
 * KYC Document Upload Page — secure file upload with SHA-256 checksum.
 *
 * Security:
 * - NEVER store uploaded files in cache/storage
 * - NEVER log file contents to console
 * - Sanitize filenames before display
 * - Abort on page unload
 * - Double-submit prevention
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PageHeader,
  Card,
  Button,
  Select,
  FormField,
  Alert,
  Spinner,
  EmptyState,
} from '@ipoint/ui';
import {
  ArrowLeft,
  Upload,
  FileText,
  X,
  RefreshCcw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useKyc, useDocumentUpload, type KycState } from '../hooks/useKyc';
import { ApiError } from '@ipoint/api-client';
import type { MemberKycDocumentResponse, KycDocumentType } from '../api/types';

/** Allowed MIME types. */
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const;

/** Maximum file size (15MB). */
const MAX_FILE_SIZE = 15 * 1024 * 1024;

/** Maximum number of documents. */
const MAX_DOCUMENTS = 10;

/** Document type options for the select. */
const DOCUMENT_TYPE_OPTIONS: { value: string; labelKey: string }[] = [
  {
    value: 'IDENTITY_FRONT',
    labelKey: 'kyc.documents.documentTypeIdentityFront',
  },
  {
    value: 'IDENTITY_BACK',
    labelKey: 'kyc.documents.documentTypeIdentityBack',
  },
  { value: 'PASSPORT', labelKey: 'kyc.documents.documentTypePassport' },
  {
    value: 'PROOF_OF_ADDRESS',
    labelKey: 'kyc.documents.documentTypeProofOfAddress',
  },
  { value: 'SELFIE', labelKey: 'kyc.documents.documentTypeSelfie' },
  { value: 'OTHER', labelKey: 'kyc.documents.documentTypeOther' },
];

/**
 * Sanitize a filename for display — strip path separators and control chars.
 */
function sanitizeFilename(filename: string): string {
  return (
    filename
      .replace(/[/\\<>:"|?*]/g, '_')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim() || 'unnamed_file'
  );
}

/**
 * Format file size for display.
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB'];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

interface SelectedFile {
  file: File;
  documentType: string;
}

/**
 * KYC Document Upload Page.
 */
export function KycDocumentsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { state, fetchKyc } = useKyc();
  const { uploadState, upload, cancel, clearError } = useDocumentUpload();

  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [selectedDocType, setSelectedDocType] = useState<string>('');
  const [uploadedDocs, setUploadedDocs] = useState<MemberKycDocumentResponse[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const beforeUnloadHandlerRef = useRef<
    ((e: BeforeUnloadEvent) => void) | null
  >(null);

  // Sync uploaded docs from KYC state
  useEffect(() => {
    if (state.data?.documents) {
      setUploadedDocs(state.data.documents);
    }
  }, [state.data?.documents]);

  // Handle beforeunload to cancel uploads
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (uploadState.isUploading) {
        cancel();
        e.preventDefault();
        e.returnValue = '';
      }
    };
    beforeUnloadHandlerRef.current = handler;
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      // Abort any in-flight upload on unmount
      cancel();
    };
  }, [uploadState.isUploading, cancel]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      const file = files?.[0];
      if (!file) return;
      setError(null);

      // Validate MIME type
      if (
        !ALLOWED_MIME_TYPES.includes(
          file.type as (typeof ALLOWED_MIME_TYPES)[number],
        )
      ) {
        setError(t('kyc.documents.invalidType'));
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        setError(t('kyc.documents.tooLarge'));
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      // Validate document count
      if (uploadedDocs.length >= MAX_DOCUMENTS) {
        setError(t('kyc.documents.maxDocuments', { count: MAX_DOCUMENTS }));
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      setSelectedFile({ file, documentType: selectedDocType || 'OTHER' });
    },
    [selectedDocType, uploadedDocs.length, t],
  );

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;

    // Double-submit prevention
    if (uploadState.isUploading) return;

    setError(null);
    clearError();
    setIsSubmitting(true);

    try {
      const result = await upload(selectedFile.file, selectedFile.documentType);

      if (result) {
        // Update uploaded docs from response
        setUploadedDocs(result.documents);
        setSelectedFile(null);
        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedFile, upload, uploadState.isUploading, clearError]);

  const handleCancelUpload = useCallback(() => {
    cancel();
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [cancel]);

  const handleRetry = useCallback(async () => {
    if (!selectedFile) return;
    setError(null);
    clearError();
    await upload(selectedFile.file, selectedFile.documentType);
  }, [selectedFile, upload, clearError]);

  const handleNavigateToSubmit = useCallback(() => {
    navigate('/kyc');
  }, [navigate]);

  return (
    <div>
      <PageHeader
        title={t('kyc.documents.title')}
        actions={
          <Button variant="ghost" onClick={() => navigate('/kyc/form')}>
            <ArrowLeft size={16} /> {t('common.back')}
          </Button>
        }
      />

      <Card>
        <p style={{ marginBottom: '1rem' }}>{t('kyc.documents.description')}</p>
        <p
          style={{
            marginBottom: '1.5rem',
            fontSize: '0.875rem',
            color: 'var(--color-text-secondary)',
          }}
        >
          {t('kyc.documents.supportFormats')}
        </p>

        {/* Upload error */}
        {error && (
          <div style={{ marginBottom: '1rem' }}>
            <Alert tone="error" title={error} />
          </div>
        )}

        {/* Upload error from hook */}
        {uploadState.error && (
          <div style={{ marginBottom: '1rem' }}>
            <Alert
              tone="error"
              title={uploadState.error}
              dismissLabel={t('kyc.documents.uploadRetry')}
              onDismiss={handleRetry}
            />
          </div>
        )}

        {/* Document type + file picker */}
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: '200px', flex: 1 }}>
            <FormField
              label={t('kyc.documents.documentType')}
              htmlFor="kyc-doc-type"
            >
              <Select
                id="kyc-doc-type"
                value={selectedDocType}
                onChange={(e) => setSelectedDocType(e.target.value)}
              >
                <option value="">
                  {t('kyc.documents.selectDocumentType')}
                </option>
                {DOCUMENT_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.pdf"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
              id="kyc-file-input"
            />
            <Button
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={
                uploadedDocs.length >= MAX_DOCUMENTS || uploadState.isUploading
              }
            >
              <FileText size={16} />
              {t('kyc.documents.chooseFile')}
            </Button>
          </div>

          {uploadState.isUploading && (
            <Button variant="danger" onClick={handleCancelUpload}>
              <X size={16} />
              {t('kyc.documents.cancel')}
            </Button>
          )}
        </div>

        {/* Selected file info */}
        {selectedFile && !uploadState.isUploading && (
          <div
            style={{
              marginTop: '1rem',
              padding: '0.75rem',
              border: '1px solid var(--color-border)',
              borderRadius: '0.5rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <p style={{ fontWeight: 500 }}>
                {t('kyc.documents.fileSelected', {
                  filename: sanitizeFilename(selectedFile.file.name),
                })}
              </p>
              <p
                style={{
                  fontSize: '0.875rem',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {formatFileSize(selectedFile.file.size)}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button
                variant="secondary"
                onClick={() => {
                  setSelectedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                <X size={16} />
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={handleUpload}
                disabled={isSubmitting}
                loading={uploadState.isUploading}
              >
                <Upload size={16} />
                {uploadState.isUploading
                  ? t('kyc.documents.uploading')
                  : t('kyc.documents.uploadButton')}
              </Button>
            </div>
          </div>
        )}

        {/* Upload progress */}
        {uploadState.isUploading && (
          <div
            style={{
              marginTop: '1rem',
              padding: '0.75rem',
              border: '1px solid var(--color-border)',
              borderRadius: '0.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
            }}
          >
            <Spinner size="sm" />
            <span>{t('kyc.documents.uploading')}</span>
          </div>
        )}
      </Card>

      {/* Document list */}
      <div style={{ marginTop: '1.5rem' }}>
        <Card>
          <h3
            style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}
          >
            {t('kyc.documents.title')}
          </h3>

          {uploadedDocs.length === 0 ? (
            <EmptyState
              icon={<FileText size={24} />}
              title=""
              description={t('kyc.documents.noDocuments')}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              {uploadedDocs.map((doc) => (
                <div
                  key={doc.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.75rem',
                    border: '1px solid var(--color-border)',
                    borderRadius: '0.5rem',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                    }}
                  >
                    <CheckCircle2 size={20} color="var(--color-success)" />
                    <div>
                      <p style={{ fontWeight: 500 }}>
                        {t(
                          `kyc.documents.documentType${
                            doc.documentType.charAt(0) +
                            doc.documentType.slice(1).toLowerCase()
                          }`,
                          doc.documentType,
                        )}
                      </p>
                      <p
                        style={{
                          fontSize: '0.875rem',
                          color: 'var(--color-text-secondary)',
                        }}
                      >
                        {formatFileSize(doc.size)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {uploadedDocs.length > 0 && (
            <p
              style={{
                marginTop: '0.75rem',
                fontSize: '0.875rem',
                color: 'var(--color-text-secondary)',
              }}
            >
              {uploadedDocs.length}/{MAX_DOCUMENTS}{' '}
              {t('kyc.documents.maxDocuments', {
                count: MAX_DOCUMENTS,
              }).replace(/\d+/, '')}
            </p>
          )}
        </Card>
      </div>

      {/* Navigation */}
      <div
        style={{
          marginTop: '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Button variant="secondary" onClick={() => navigate('/kyc/form')}>
          <ArrowLeft size={16} /> {t('kyc.form.title')}
        </Button>
        <Button variant="primary" onClick={handleNavigateToSubmit}>
          {t('kyc.submit.button')}
        </Button>
      </div>
    </div>
  );
}

export default KycDocumentsPage;
