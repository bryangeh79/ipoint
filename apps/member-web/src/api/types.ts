/**
 * Domain types used across member-web pages.
 * These mirror the backend API response shapes.
 */

export interface MemberProfile {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  countryCode?: string;
  kycStatus: 'not_started' | 'pending' | 'approved' | 'rejected';
  createdAt: string;
  updatedAt: string;
}

export interface Market {
  id: string;
  code: string;
  name: string;
  currency: string;
  isActive: boolean;
}

export interface Merchant {
  id: string;
  name: string;
  description?: string;
  logoUrl?: string;
  category?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  distance?: number;
  isActive: boolean;
}

export interface KYCStatus {
  status: 'not_started' | 'pending' | 'approved' | 'rejected';
  documentTypes?: string[];
  submittedAt?: string;
  approvedAt?: string;
  rejectReason?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
