/**
 * KYC API hook — manages KYC data lifecycle with in-memory state only.
 *
 * Security constraints:
 * - NEVER store KYC data in localStorage or sessionStorage
 * - NEVER cache KYC API responses
 * - NEVER include identity number in URL parameters
 * - NEVER log file contents to console
 * - Use NetworkOnly strategy for KYC API calls
 * - Clear KYC in-memory state on logout
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  type ApiResponse,
  createIdempotencyKey,
} from '@ipoint/api-client';
import { apiClient } from '../api/client';
import type {
  MemberKycResponse,
  KycStatus,
  KycIdentificationType,
  KycDocumentType,
} from '../api/types';

export type SaveFieldPayload = Partial<{
  legalFullName: string;
  identificationType: KycIdentificationType;
  identificationNumber: string;
  dateOfBirth: string;
  nationality: string;
  residentialAddress: Record<string, string>;
}>;

export interface KycState {
  data: MemberKycResponse | null;
  isLoading: boolean;
  error: string | null;
  errorCode: string | null;
}

export interface DocumentUploadState {
  isUploading: boolean;
  progress: number;
  error: string | null;
}

const KYC_BASE_PATH = '/members/me/kyc';

/**
 * Parse ApiError into a user-friendly error code.
 */
function parseErrorCode(error: unknown): { message: string; code: string } {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 0:
        return {
          message: 'Network error. Please check your connection.',
          code: 'NETWORK_ERROR',
        };
      case 401:
        return {
          message: 'Session expired. Please log in again.',
          code: 'SESSION_EXPIRED',
        };
      case 403:
        return {
          message: 'Account suspended or closed.',
          code: 'ACCOUNT_INACTIVE',
        };
      case 404:
        return { message: 'KYC case not found.', code: 'KYC_NOT_FOUND' };
      case 409: {
        const code = error.body.code ?? '';
        if (code === 'KYC_DOCUMENT_LIMIT_EXCEEDED') {
          return { message: 'Maximum document limit reached.', code };
        }
        if (code === 'KYC_DUPLICATE_DOCUMENT') {
          return { message: 'Duplicate document detected.', code };
        }
        if (code === 'KYC_IDEMPOTENCY_CONFLICT') {
          return { message: 'This action was already completed.', code };
        }
        if (code === 'KYC_INVALID_STATE') {
          return {
            message: 'KYC is not in the right state for this action.',
            code,
          };
        }
        return { message: 'Conflict. Please refresh and try again.', code };
      }
      case 413:
        return {
          message: 'File exceeds maximum size (15MB).',
          code: 'KYC_FILE_TOO_LARGE',
        };
      case 429:
        return {
          message: 'Too many attempts. Please wait and try again.',
          code: 'RATE_LIMITED',
        };
      case 400:
        return {
          message:
            typeof error.body.message === 'string'
              ? error.body.message
              : Array.isArray(error.body.message)
                ? error.body.message.join(' ')
                : 'Please check your input.',
          code: error.body.code ?? 'VALIDATION_ERROR',
        };
      default:
        return {
          message:
            typeof error.body.message === 'string'
              ? error.body.message
              : Array.isArray(error.body.message)
                ? error.body.message.join(' ')
                : error.message || 'Something went wrong.',
          code: 'UNKNOWN',
        };
    }
  }
  return { message: 'Something went wrong.', code: 'UNKNOWN' };
}

/**
 * Hook to fetch and manage KYC case data.
 * In-memory state only — never cached to storage.
 */
export function useKyc() {
  const [state, setState] = useState<KycState>({
    data: null,
    isLoading: true,
    error: null,
    errorCode: null,
  });

  const fetchKyc = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
      errorCode: null,
    }));
    try {
      const response: ApiResponse<MemberKycResponse> =
        await apiClient.get<MemberKycResponse>(KYC_BASE_PATH);
      setState({
        data: response.data,
        isLoading: false,
        error: null,
        errorCode: null,
      });
    } catch (error: unknown) {
      const parsed = parseErrorCode(error);
      setState({
        data: null,
        isLoading: false,
        error: parsed.message,
        errorCode: parsed.code,
      });
      if (error instanceof ApiError && error.status === 401) {
        apiClient.clearSession();
      }
    }
  }, []);

  useEffect(() => {
    void fetchKyc();
  }, [fetchKyc]);

  const clearKycState = useCallback(() => {
    setState({ data: null, isLoading: false, error: null, errorCode: null });
  }, []);

  return { state, fetchKyc, clearKycState };
}

/**
 * Save a KYC draft field via PATCH endpoint.
 * Returns the updated response or throws ApiError.
 */
export async function saveDraftField(
  payload: SaveFieldPayload,
  signal?: AbortSignal,
): Promise<MemberKycResponse> {
  const response: ApiResponse<MemberKycResponse> =
    await apiClient.patch<MemberKycResponse>(KYC_BASE_PATH, payload, {
      signal,
    });
  return response.data;
}

/**
 * Create a new KYC draft (NOT_STARTED → DRAFT).
 */
export async function createKycDraft(
  signal?: AbortSignal,
): Promise<MemberKycResponse> {
  const response: ApiResponse<MemberKycResponse> =
    await apiClient.post<MemberKycResponse>(
      KYC_BASE_PATH,
      { idempotencyKey: createIdempotencyKey() },
      { signal },
    );
  return response.data;
}

/**
 * Submit KYC draft for review.
 */
export async function submitKyc(
  signal?: AbortSignal,
): Promise<MemberKycResponse> {
  const response: ApiResponse<MemberKycResponse> =
    await apiClient.post<MemberKycResponse>(
      `${KYC_BASE_PATH}/submit`,
      { idempotencyKey: createIdempotencyKey() },
      { signal },
    );
  return response.data;
}

/**
 * Resubmit KYC after MORE_INFO_REQUIRED or REVERIFICATION_REQUIRED.
 */
export async function resubmitKyc(
  signal?: AbortSignal,
): Promise<MemberKycResponse> {
  const response: ApiResponse<MemberKycResponse> =
    await apiClient.post<MemberKycResponse>(
      `${KYC_BASE_PATH}/resubmit`,
      { idempotencyKey: createIdempotencyKey() },
      { signal },
    );
  return response.data;
}

/**
 * Add document metadata to KYC draft.
 */
export async function addDocumentMetadata(
  payload: {
    documentType: string;
    mimeType: string;
    size: number;
    checksum: string;
  },
  signal?: AbortSignal,
): Promise<MemberKycResponse> {
  const response: ApiResponse<MemberKycResponse> =
    await apiClient.post<MemberKycResponse>(
      `${KYC_BASE_PATH}/documents`,
      payload,
      { signal },
    );
  return response.data;
}

/**
 * Compute SHA-256 checksum of a file client-side.
 */
export async function computeChecksum(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hook to upload a KYC document with progress and abort support.
 */
export function useDocumentUpload() {
  const [uploadState, setUploadState] = useState<DocumentUploadState>({
    isUploading: false,
    progress: 0,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const upload = useCallback(
    async (
      file: File,
      documentType: string,
    ): Promise<MemberKycResponse | null> => {
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'application/pdf'];
      if (!allowedMimeTypes.includes(file.type)) {
        setUploadState({
          isUploading: false,
          progress: 0,
          error: 'Only JPEG, PNG, and PDF files are accepted.',
        });
        return null;
      }
      if (file.size > 15 * 1024 * 1024) {
        setUploadState({
          isUploading: false,
          progress: 0,
          error: 'File exceeds maximum size (15MB).',
        });
        return null;
      }

      setUploadState({ isUploading: true, progress: 0, error: null });
      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        // Compute SHA-256 checksum
        const checksum = await computeChecksum(file);

        // Add document metadata
        const result = await addDocumentMetadata(
          {
            documentType,
            mimeType: file.type,
            size: file.size,
            checksum,
          },
          abortController.signal,
        );

        setUploadState({ isUploading: false, progress: 100, error: null });
        return result;
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          setUploadState({ isUploading: false, progress: 0, error: null });
          return null;
        }
        const parsed = parseErrorCode(error);
        setUploadState({
          isUploading: false,
          progress: 0,
          error: parsed.message,
        });
        return null;
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setUploadState({ isUploading: false, progress: 0, error: null });
  }, []);

  const clearError = useCallback(() => {
    setUploadState((prev) => ({ ...prev, error: null }));
  }, []);

  return { uploadState, upload, cancel, clearError };
}
